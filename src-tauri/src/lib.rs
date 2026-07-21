use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

const FEED_URL: &str = "https://www.harrisfarm.com.au/blogs/daves-market-update.atom";
const CLAUDE_MODEL: &str = "sonnet";
const CANCELLED: &str = "cancelled";

#[derive(Default)]
struct RunningChild(Mutex<Option<u32>>);

#[derive(Serialize, Deserialize, Clone)]
struct Recipe {
    id: String,
    title: String,
    description: String,
    ingredients: String,
    // Added after the first release; serde(default) keeps an existing
    // recipes.json written without them loading instead of erroring.
    #[serde(default)]
    favorite: bool,
    #[serde(default)]
    total_time: String,
    #[serde(default, rename = "yield")]
    yield_: String,
    // Claude-analysed defining ingredients, most-defining first (asparagus
    // before the spring onion garnish). Empty means "not analysed yet" —
    // that's what analyze_new_recipes looks for. Never read from Mela;
    // carried across every resync by merge_recipes.
    #[serde(default)]
    key_ingredients: Vec<String>,
}

fn mela_db_path() -> PathBuf {
    let home = std::env::var("HOME").expect("HOME not set");
    PathBuf::from(home).join(
        "Library/Group Containers/66JC38RDUD.recipes.mela/Data/Curcuma.sqlite",
    )
}

fn load_recipes(db_path: &PathBuf) -> Result<Vec<Recipe>, String> {
    // mode=ro opens a second reader connection; safe alongside Mela's own
    // open connection even when its WAL file is active.
    let uri = format!("file:{}?mode=ro", db_path.display());
    let conn = Connection::open_with_flags(
        &uri,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(|e| format!("failed to open Mela database: {e}"))?;

    let mut stmt = conn
        .prepare(
            "SELECT ZID, ZTITLE, ZTEXT, ZINGREDIENTS, ZFAVORITE, \
             COALESCE(NULLIF(ZTOTALTIME, ''), ZCOOKTIME, ZPREPTIME), ZYIELD \
             FROM ZRECIPEOBJECT \
             WHERE ZTITLE IS NOT NULL ORDER BY ZTITLE",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Recipe {
                id: row.get::<_, Option<String>>(0)?.unwrap_or_default(),
                title: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                description: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                ingredients: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                favorite: row.get::<_, Option<i64>>(4)?.unwrap_or(0) == 1,
                total_time: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                yield_: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                key_ingredients: Vec::new(),
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

fn extract_tag(xml: &str, tag: &str) -> String {
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let Some(start) = xml.find(&open) else { return String::new() };
    let Some(content_start) = xml[start..].find('>').map(|i| start + i + 1) else {
        return String::new();
    };
    let Some(end) = xml[content_start..].find(&close) else { return String::new() };
    xml[content_start..content_start + end].trim().to_string()
}

fn strip_tags(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

// Atom <link href="..."/> is self-closing, so extract_tag can't see it.
fn extract_link_href(entry_xml: &str) -> String {
    let Some(start) = entry_xml.find("<link") else { return String::new() };
    let rest = &entry_xml[start..];
    let Some(href) = rest.find("href=\"") else { return String::new() };
    let val = &rest[href + 6..];
    val.find('"').map(|end| val[..end].to_string()).unwrap_or_default()
}

/// Returns (title, stripped text, raw html, link href, atom entry id).
/// The entry id (not the link) is what we key the produce cache on — it's
/// the stable per-post identifier Atom guarantees, whereas the link is only
/// kept around for the "read full article" UI affordance.
fn fetch_latest_entry(feed_url: &str) -> Result<(String, String, String, String, String), String> {
    let body = ureq::get(feed_url)
        .set("User-Agent", "Mozilla/5.0")
        .call()
        .map_err(|e| format!("failed to fetch feed: {e}"))?
        .into_string()
        .map_err(|e| e.to_string())?;

    let Some(entry_start) = body.find("<entry") else {
        return Err(format!("no entries found in feed {feed_url}"));
    };
    let entry_end = body[entry_start..]
        .find("</entry>")
        .map(|i| entry_start + i)
        .unwrap_or(body.len());
    let entry_xml = &body[entry_start..entry_end];

    let title = extract_tag(entry_xml, "title");
    let content_html = extract_tag(entry_xml, "content")
        .trim_start_matches("<![CDATA[")
        .trim_end_matches("]]>")
        .to_string();
    let link = extract_link_href(entry_xml);
    let id = extract_tag(entry_xml, "id");
    Ok((title, strip_tags(&content_html), content_html, link, id))
}

/// Words stripped from the front of an ingredient line to find the item
/// itself: quantities, units and prep words. Stripped repeatedly, so
/// "2 large cloves garlic" reduces all the way down.
const LEADING_NOISE: &[&str] = &[
    "cup", "cups", "tbsp", "tbsps", "tsp", "tsps", "tablespoon", "tablespoons", "teaspoon",
    "teaspoons", "pound", "pounds", "lb", "lbs", "ounce", "ounces", "oz", "gram", "grams", "g",
    "kg", "ml", "l", "litre", "litres", "clove", "cloves", "can", "cans", "tin", "tins", "bunch",
    "bunches", "sprig", "sprigs", "slice", "slices", "pinch", "pinches", "handful", "handfuls",
    "package", "packages", "large", "medium", "small", "whole", "of", "fresh", "freshly", "dried",
    "ground", "chopped", "minced", "diced", "sliced", "grated", "toasted", "raw", "ripe", "extra",
    "virgin", "to",
];

/// Reduces a raw ingredient line ("2 large cloves garlic, minced") to the
/// item it names ("garlic"), so the same item written different ways lands
/// on one vocabulary entry and one pantry decision.
///
/// ponytail: prefix-stripping, not a parser. It handles the shapes Mela
/// recipes actually use — leading quantity, unit, prep word, and a trailing
/// clause after a comma or bracket. A line it can't reduce keeps more of its
/// text and just becomes its own vocabulary entry: a miss in the pantry
/// lookup (so the item shows as produce), never a crash. Roughly a fifth of
/// this collection's lines are long freeform prose like "for serving
/// basmati or jasmine rice"; those are the misses, and the per-ingredient
/// override menu is how they get fixed.
fn ingredient_name(line: &str) -> String {
    let mut s = line.to_lowercase().replace("&nbsp;", " ");
    // Drop bracketed asides — Mela writes prep notes as "((thoroughly washed))".
    while let (Some(open), Some(close)) = (s.find('('), s.rfind(')')) {
        if open >= close {
            break;
        }
        s.replace_range(open..=close, " ");
    }
    // Keep only the head clause: "garlic, minced" -> "garlic".
    let head = s.split(',').next().unwrap_or(&s).to_string();
    // Split on hyphens as well as whitespace so "extra-virgin olive oil"
    // strips the same way as "extra virgin olive oil".
    let mut words: Vec<&str> = head
        .split(|c: char| c.is_whitespace() || c == '-')
        .filter(|w| !w.is_empty())
        .collect();
    while let Some(first) = words.first() {
        let w = first.trim_matches(|c: char| !c.is_alphanumeric());
        // A token with no letters is a quantity ("2", "1/4", "200g" keeps
        // its unit so it is handled by the noise list after the digits go).
        let is_quantity = w.chars().all(|c| !c.is_alphabetic());
        let unit_suffix = w.trim_start_matches(|c: char| !c.is_alphabetic());
        if is_quantity || LEADING_NOISE.contains(&w) || LEADING_NOISE.contains(&unit_suffix) {
            words.remove(0);
        } else {
            break;
        }
    }
    words
        .iter()
        .map(|w| singular(w.trim_matches(|c: char| !c.is_alphanumeric())))
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Every distinct ingredient name across the collection, excluding Mela's
/// "# SECTION" header lines. This is the vocabulary the pantry set is built
/// from and looked up against.
fn ingredient_vocabulary(recipes: &[Recipe]) -> Vec<String> {
    let mut names: Vec<String> = recipes
        .iter()
        .flat_map(|r| r.ingredients.lines())
        .map(|l| l.trim())
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .map(ingredient_name)
        .filter(|n| !n.is_empty())
        .collect();
    names.sort();
    names.dedup();
    names
}

fn build_pantry_prompt(names: &[String]) -> String {
    let list = names.join("\n");
    format!(
        "Here is every distinct ingredient in a home cook's recipe collection,\n\
        one per line:\n\n\
        {list}\n\n\
        List the ones that are PANTRY items — things kept in the cupboard or\n\
        fridge and bought occasionally rather than shopped for fresh each week:\n\
        salt, pepper, oils, vinegars, flour, sugar, sweeteners, spices, dried\n\
        herbs, stock, tinned goods, sauces, condiments, nuts, seeds, grains,\n\
        pasta, rice, tofu, beans and pulses, dairy, eggs and water.\n\n\
        Do NOT list fresh produce: vegetables, fruit, fresh herbs, salad leaves,\n\
        mushrooms — anything bought fresh from the greengrocer. Judge the item\n\
        itself: \"onion\" is fresh produce, \"onion powder\" is pantry.\n\n\
        Output the pantry items only, one per line, copied exactly as spelled\n\
        above, nothing else."
    )
}

fn build_produce_prompt(entry_title: &str, entry_text: &str) -> String {
    format!(
        "Here is this week's seasonal produce newsletter, \"{entry_title}\":\n\n\
        {entry_text}\n\n\
        List the in-season produce items it mentions (fruits, vegetables, herbs —\n\
        not brands, regions, or recipes), singular form. Output up to four lines\n\
        in exactly this format, nothing else:\n\n\
        Fruit: apple, blueberry\n\
        Vegetable: capsicum, corn, avocado\n\
        Pick of the week: apple\n\
        Featured: blueberry, corn\n\n\
        Herbs count as vegetables. \"Pick of the week\" is the item the newsletter\n\
        names as its pick of the week. \"Featured\" lists items given particular\n\
        emphasis (called out as excellent quality or value right now). Every pick\n\
        or featured item must also appear, spelled identically, in the Fruit or\n\
        Vegetable line. Omit a line entirely if it has no items."
    )
}

fn build_key_ingredient_prompt(recipes: &[Recipe]) -> String {
    let recipe_lines = recipes
        .iter()
        .map(|r| {
            format!(
                "- [{}] {} — {}: {}",
                r.id,
                r.title,
                r.description,
                r.ingredients.replace('\n', "; ")
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "Here are recipes from a home cook's collection (id, title, description,\n\
        ingredients):\n\n\
        {recipe_lines}\n\n\
        For each recipe, identify the 2-4 ingredients that actually define the\n\
        dish — the ones a shopper would build the meal around. Rank them\n\
        most-defining first. In \"asparagus and tofu stir fry\" the key\n\
        ingredients are asparagus and tofu; a spring onion garnish, oil,\n\
        salt, and pantry staples are NOT key ingredients. Prefer fresh produce\n\
        and proteins over seasonings and condiments. Use short singular\n\
        ingredient names (\"asparagus\", not \"2 bunches trimmed asparagus\").\n\n\
        Output one line per recipe, in exactly this format, nothing else:\n\n\
        id: RECIPE_ID — key: ingredient, ingredient, ingredient"
    )
}

/// Parses the `id: X — key: a, b, c` lines back into (id, key_ingredients).
/// Unparseable lines (stray commentary) are skipped rather than failing the
/// whole batch — a recipe that misses out just stays unanalysed and gets
/// picked up by the next sync.
fn parse_key_ingredient_lines(answer: &str) -> Vec<(String, Vec<String>)> {
    answer
        .lines()
        .filter_map(|line| {
            let line = line.trim().trim_start_matches('-').trim();
            let rest = line.strip_prefix("id:")?;
            let (id, keys) = rest.split_once("—").or_else(|| rest.split_once(" - "))?;
            let keys = keys.trim().strip_prefix("key:")?;
            let keys: Vec<String> = keys
                .split(',')
                .map(|s| s.trim().to_lowercase())
                .filter(|s| !s.is_empty())
                .collect();
            if keys.is_empty() {
                return None;
            }
            Some((id.trim().to_string(), keys))
        })
        .collect()
}

/// Strips a trailing plural so "potatoes" and "potato" compare equal.
/// Handles the regular -s/-es cases only; "es" is kept when dropping just
/// the "s" already leaves a word (so "peas" -> "pea", but "tomatoes" ->
/// "tomato").
fn singular(word: &str) -> &str {
    if let Some(stem) = word.strip_suffix("es") {
        // "tomatoes"/"potatoes" drop the full "es"; "limes"/"grapes" only
        // the "s", which the strip_suffix('s') arm below handles.
        if stem.ends_with('o') || stem.ends_with("ch") || stem.ends_with("sh") {
            return stem;
        }
    }
    word.strip_suffix('s').unwrap_or(word)
}

/// True if a produce name and a recipe's key ingredient name the same
/// ingredient. Both are split into plural-normalised words and compared
/// from the front, so one may *extend* the other with trailing words but
/// neither may add a leading qualifier:
///
/// - "sugar snap" == "sugar snap peas"  (the feed abbreviates, recipes don't)
/// - "corn"       != "corned beef"      (mid-word, not a word at all)
/// - "potato"     != "sweet potato"     (leading qualifier: different thing)
///
/// ponytail: comparing head words, not substrings and not full equality.
/// A leading qualifier makes a different ingredient with a different season
/// ("broccoli"/"broccolini", "potato"/"sweet potato", "broccoli"/"chinese
/// broccoli"), which is intended behaviour rather than a gap to fill. The
/// known soft spot is the mirror case — "apple" also matches "apple cider
/// vinegar" — which needs a stop-list of non-produce heads only if a recipe
/// ever ranks on one. Irregular plurals (leaf/leaves) and synonyms
/// (capsicum/bell pepper, beetroot/beets) stay out of scope until the
/// newsletter publishes names this misses.
fn produce_matches(produce: &str, key: &str) -> bool {
    let normalise = |s: &str| {
        s.to_lowercase()
            .split(|c: char| !c.is_alphanumeric())
            .filter(|w| !w.is_empty())
            .map(|w| singular(w).to_string())
            .collect::<Vec<_>>()
    };
    let (produce, key) = (normalise(produce), normalise(key));
    let shared = produce.len().min(key.len());
    shared > 0 && produce[..shared] == key[..shared]
}

/// Scores a recipe against this week's produce by how *defining* the
/// matching ingredients are: the first key ingredient is worth the most,
/// each subsequent one less. Recipes with no key-ingredient hit score 0 and
/// are dropped by the caller.
fn score_recipe(recipe: &Recipe, produce: &[String]) -> (u32, Vec<String>) {
    let mut score = 0;
    let mut matched = Vec::new();
    for (i, key) in recipe.key_ingredients.iter().enumerate() {
        if produce.iter().any(|p| produce_matches(p, key)) {
            // Rank 0 scores 4, rank 1 scores 3, ... floored at 1.
            score += 4u32.saturating_sub(i as u32).max(1);
            matched.push(key.clone());
        }
    }
    (score, matched)
}

/// Carries analysed key_ingredients across a full Mela resync. `fresh` comes
/// straight from SQLite with empty key_ingredients; anything already
/// analysed in the old cache keeps its list, so only genuinely new recipes
/// come out unanalysed.
fn merge_recipes(fresh: Vec<Recipe>, cached: &[Recipe]) -> Vec<Recipe> {
    let known: HashMap<&str, &Vec<String>> = cached
        .iter()
        .map(|r| (r.id.as_str(), &r.key_ingredients))
        .collect();
    fresh
        .into_iter()
        .map(|mut r| {
            if let Some(keys) = known.get(r.id.as_str()) {
                r.key_ingredients = (*keys).clone();
            }
            r
        })
        .collect()
}

/// Runs `claude -p` with streaming output. Each completed line of the final
/// answer is passed to `on_line` as it arrives; the full answer is returned
/// at the end for callers (like the produce-extraction step) that just want
/// the whole result rather than a running stream.
fn run_claude(
    prompt: &str,
    running: &RunningChild,
    mut on_line: impl FnMut(&str),
) -> Result<String, String> {
    let mut child = Command::new("claude")
        .args([
            "-p",
            "--model",
            CLAUDE_MODEL,
            "--output-format",
            "stream-json",
            "--include-partial-messages",
            "--verbose",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to launch claude CLI: {e}"))?;

    *running.0.lock().unwrap() = Some(child.id());
    let result = run_claude_inner(&mut child, prompt, &mut on_line);
    *running.0.lock().unwrap() = None;
    result
}

fn run_claude_inner(
    child: &mut std::process::Child,
    prompt: &str,
    on_line: &mut impl FnMut(&str),
) -> Result<String, String> {
    child
        .stdin
        .take()
        .expect("stdin piped")
        .write_all(prompt.as_bytes())
        .map_err(|e| e.to_string())?;

    let stdout = child.stdout.take().expect("stdout piped");
    let mut line_buf = String::new();
    let mut full_answer = String::new();
    for line in BufReader::new(stdout).lines() {
        let line = line.map_err(|e| e.to_string())?;
        let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        if let Some(delta) = event["event"]["delta"]["text"].as_str() {
            full_answer.push_str(delta);
            line_buf.push_str(delta);
            while let Some(pos) = line_buf.find('\n') {
                let finished_line: String = line_buf.drain(..=pos).collect();
                let finished_line = finished_line.trim_end_matches('\n');
                if !finished_line.trim().is_empty() {
                    on_line(finished_line);
                }
            }
        }
    }
    if !line_buf.trim().is_empty() {
        on_line(line_buf.trim());
    }

    let status = child.wait().map_err(|e| e.to_string())?;
    if !status.success() {
        if is_kill_signal(&status) {
            return Err(CANCELLED.to_string());
        }
        let mut stderr_text = String::new();
        if let Some(mut stderr) = child.stderr.take() {
            use std::io::Read;
            let _ = stderr.read_to_string(&mut stderr_text);
        }
        return Err(format!(
            "claude CLI failed ({}): {}",
            status,
            stderr_text.trim()
        ));
    }

    Ok(full_answer)
}

#[cfg(unix)]
fn is_kill_signal(status: &std::process::ExitStatus) -> bool {
    use std::os::unix::process::ExitStatusExt;
    status.signal() == Some(9)
}

#[cfg(not(unix))]
fn is_kill_signal(_status: &std::process::ExitStatus) -> bool {
    false
}

fn parse_produce_line(answer: &str, label: &str) -> Vec<String> {
    answer
        .lines()
        .find_map(|line| line.trim().strip_prefix(label))
        .unwrap_or("")
        .trim_start_matches(':')
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

#[derive(Serialize, Deserialize, Clone)]
struct ProduceResult {
    feed_title: String,
    feed_link: String,
    feed_html: String,
    fruit: Vec<String>,
    vegetable: Vec<String>,
    pick: Vec<String>,
    featured: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct ProduceCache {
    entry_id: String,
    #[serde(flatten)]
    produce: ProduceResult,
}

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn produce_cache_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("produce_cache.json"))
}

fn recipes_cache_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("recipes.json"))
}

fn pantry_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("pantry.json"))
}

/// The pantry vocabulary: ingredient names (as produced by
/// `ingredient_name`) that are cupboard staples rather than fresh produce.
/// Built once by `build_pantry`, then corrected by hand from the detail
/// pane — nothing re-runs the LLM over it.
fn load_pantry(app: &tauri::AppHandle) -> Vec<String> {
    pantry_path(app)
        .ok()
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn save_pantry(app: &tauri::AppHandle, pantry: &[String]) -> Result<(), String> {
    let path = pantry_path(app)?;
    let json = serde_json::to_string_pretty(pantry).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

/// A missing or corrupt cache file is just a cache miss, never a hard error.
fn load_produce_cache(app: &tauri::AppHandle) -> Option<ProduceCache> {
    let path = produce_cache_path(app).ok()?;
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn save_produce_cache(app: &tauri::AppHandle, cache: &ProduceCache) -> Result<(), String> {
    let path = produce_cache_path(app)?;
    let json = serde_json::to_string_pretty(cache).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

fn load_recipes_cache(app: &tauri::AppHandle) -> Option<Vec<Recipe>> {
    let path = recipes_cache_path(app).ok()?;
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

// ponytail: full resync every launch. recipes.json has no per-row
// timestamp/hash to diff against yet — if Mela's SQLite read ever gets
// expensive enough to matter, add one and diff on ZID here instead of
// overwriting the whole file.
fn save_recipes_cache(app: &tauri::AppHandle, recipes: &[Recipe]) -> Result<(), String> {
    let path = recipes_cache_path(app)?;
    let json = serde_json::to_string_pretty(recipes).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

#[derive(Serialize, Clone)]
struct SyncResult {
    produce: ProduceResult,
    produce_from_cache: bool,
    recipe_count: usize,
    /// Recipes in the cache with no key_ingredients yet — what the "Sync
    /// Now" button offers to analyse.
    unanalyzed_count: usize,
    /// True when pantry.json doesn't exist yet, so the one-off
    /// ingredient-categorising call still needs to run.
    pantry_needed: bool,
}

/// Runs on app launch: refreshes the produce cache only if the newsletter
/// has posted a new entry since last time (cheap feed GET always happens;
/// the expensive Claude extraction only runs on a cache miss), and always
/// does a full resync of recipes.json from Mela's SQLite.
#[tauri::command]
async fn sync_on_launch(
    app: tauri::AppHandle,
    running: State<'_, RunningChild>,
) -> Result<SyncResult, String> {
    let _ = app.emit("status", format!("Checking {FEED_URL}..."));
    let (entry_title, entry_text, entry_html, entry_link, entry_id) =
        fetch_latest_entry(FEED_URL)?;

    let cached = load_produce_cache(&app);
    let (produce, produce_from_cache) = match cached {
        Some(cache) if cache.entry_id == entry_id => {
            let _ = app.emit("status", "Using cached produce data.");
            (cache.produce, true)
        }
        _ => {
            let _ = app.emit("status", format!("Latest post: {entry_title}"));
            let _ = app.emit("status", "Identifying in-season produce...");
            let produce_prompt = build_produce_prompt(&entry_title, &entry_text);
            let produce_answer = run_claude(&produce_prompt, &running, |_| {})?;
            let fruit = parse_produce_line(&produce_answer, "Fruit");
            let vegetable = parse_produce_line(&produce_answer, "Vegetable");
            let pick = parse_produce_line(&produce_answer, "Pick of the week");
            let featured = parse_produce_line(&produce_answer, "Featured");
            if fruit.is_empty() && vegetable.is_empty() {
                return Err("Could not identify any produce in the newsletter".to_string());
            }
            let produce = ProduceResult {
                feed_title: entry_title,
                feed_link: entry_link,
                feed_html: entry_html,
                fruit,
                vegetable,
                pick,
                featured,
            };
            save_produce_cache(
                &app,
                &ProduceCache {
                    entry_id,
                    produce: produce.clone(),
                },
            )?;
            (produce, false)
        }
    };
    let _ = app.emit(
        "produce",
        serde_json::json!({
            "fruit": &produce.fruit,
            "vegetable": &produce.vegetable,
            "pick": &produce.pick,
            "featured": &produce.featured,
        }),
    );

    let _ = app.emit("status", "Syncing recipes from Mela...");
    let fresh = load_recipes(&mela_db_path())?;
    if fresh.is_empty() {
        return Err(format!("No recipes found in {}", mela_db_path().display()));
    }
    let cached = load_recipes_cache(&app).unwrap_or_default();
    let recipes = merge_recipes(fresh, &cached);
    save_recipes_cache(&app, &recipes)?;

    let unanalyzed_count = recipes
        .iter()
        .filter(|r| r.key_ingredients.is_empty())
        .count();

    let _ = app.emit(
        "status",
        if unanalyzed_count > 0 {
            format!("{unanalyzed_count} new recipes detected.")
        } else {
            "Done.".to_string()
        },
    );
    Ok(SyncResult {
        produce,
        produce_from_cache,
        recipe_count: recipes.len(),
        unanalyzed_count,
        pantry_needed: load_pantry(&app).is_empty(),
    })
}

/// Analyses every cached recipe that has no key_ingredients yet, in one
/// Claude call, and writes the results back into recipes.json. Triggered by
/// the "Sync Now" button, not on launch.
#[tauri::command]
async fn analyze_new_recipes(
    app: tauri::AppHandle,
    running: State<'_, RunningChild>,
) -> Result<usize, String> {
    let mut recipes = load_recipes_cache(&app)
        .ok_or_else(|| "No cached recipes — sync hasn't run yet".to_string())?;
    let pending: Vec<Recipe> = recipes
        .iter()
        .filter(|r| r.key_ingredients.is_empty())
        .cloned()
        .collect();
    if pending.is_empty() {
        return Ok(0);
    }

    let _ = app.emit(
        "status",
        format!("Analysing {} new recipes...", pending.len()),
    );
    let answer = run_claude(&build_key_ingredient_prompt(&pending), &running, |_| {})?;
    let parsed: HashMap<String, Vec<String>> =
        parse_key_ingredient_lines(&answer).into_iter().collect();
    if parsed.is_empty() {
        return Err("Claude returned no usable key ingredients".to_string());
    }

    let mut analyzed = 0;
    for recipe in recipes.iter_mut() {
        if let Some(keys) = parsed.get(&recipe.id) {
            recipe.key_ingredients = keys.clone();
            analyzed += 1;
        }
    }
    save_recipes_cache(&app, &recipes)?;

    let _ = app.emit("status", format!("Analysed {analyzed} recipes."));
    Ok(analyzed)
}

#[derive(Serialize, Clone)]
struct RankedRecipe {
    #[serde(flatten)]
    recipe: Recipe,
    score: u32,
    matches: Vec<String>,
}

/// Ranks cached recipes against this week's produce using the stored
/// key_ingredients — no Claude call, so this is instant and offline. Only
/// analysed recipes can match; unanalysed ones score 0 until "Sync Now"
/// runs.
#[tauri::command]
fn match_recipes(
    app: tauri::AppHandle,
    fruit: Vec<String>,
    vegetable: Vec<String>,
) -> Result<Vec<RankedRecipe>, String> {
    let produce: Vec<String> = fruit.into_iter().chain(vegetable).collect();
    let recipes = load_recipes_cache(&app)
        .ok_or_else(|| "No cached recipes — sync hasn't run yet".to_string())?;
    if recipes.is_empty() {
        return Err("No recipes found in the local cache".to_string());
    }

    let mut ranked: Vec<RankedRecipe> = recipes
        .into_iter()
        .filter_map(|r| {
            let (score, matches) = score_recipe(&r, &produce);
            (score > 0).then(|| RankedRecipe {
                recipe: r,
                score,
                matches,
            })
        })
        .collect();
    // Highest score first, ties broken by title so the order is stable.
    ranked.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then_with(|| a.recipe.title.cmp(&b.recipe.title))
    });

    let _ = app.emit("status", format!("{} recipes match.", ranked.len()));
    Ok(ranked)
}

/// Builds the pantry vocabulary in one Claude call over every distinct
/// ingredient in the collection. Runs only when `pantry.json` is missing —
/// after that the set is corrected by hand via `set_pantry_item`, so adding
/// a recipe costs no LLM call at all.
#[tauri::command]
async fn build_pantry(
    app: tauri::AppHandle,
    running: State<'_, RunningChild>,
) -> Result<usize, String> {
    let recipes = load_recipes_cache(&app)
        .ok_or_else(|| "No cached recipes — sync hasn't run yet".to_string())?;
    let vocabulary = ingredient_vocabulary(&recipes);
    if vocabulary.is_empty() {
        return Ok(0);
    }

    let _ = app.emit(
        "status",
        format!("Categorising {} ingredients...", vocabulary.len()),
    );
    let answer = run_claude(&build_pantry_prompt(&vocabulary), &running, |_| {})?;

    // Keep only names that were in the vocabulary, so a reworded or invented
    // line can't enter the set and sit there unmatched forever.
    let known: std::collections::HashSet<&str> = vocabulary.iter().map(|s| s.as_str()).collect();
    let mut pantry: Vec<String> = answer
        .lines()
        .map(|l| l.trim().trim_start_matches('-').trim().to_lowercase())
        .filter(|l| known.contains(l.as_str()))
        .collect();
    pantry.sort();
    pantry.dedup();
    if pantry.is_empty() {
        return Err("Claude returned no usable pantry items".to_string());
    }
    save_pantry(&app, &pantry)?;

    let _ = app.emit(
        "status",
        format!(
            "Pantry set: {} of {} ingredients.",
            pantry.len(),
            vocabulary.len()
        ),
    );
    Ok(pantry.len())
}

#[tauri::command]
fn list_pantry(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    Ok(load_pantry(&app))
}

/// Moves one ingredient into or out of the pantry set — the per-row
/// "move to pantry" / "confirm as produce" menu. This is the only way the
/// set changes after the initial build.
#[tauri::command]
fn set_pantry_item(
    app: tauri::AppHandle,
    ingredient: String,
    is_pantry: bool,
) -> Result<Vec<String>, String> {
    let name = ingredient_name(&ingredient);
    if name.is_empty() {
        return Err("Not an ingredient".to_string());
    }
    let mut pantry = load_pantry(&app);
    match (is_pantry, pantry.iter().position(|p| *p == name)) {
        (true, None) => {
            pantry.push(name);
            pantry.sort();
        }
        (false, Some(i)) => {
            pantry.remove(i);
        }
        _ => return Ok(pantry), // already in the requested state
    }
    save_pantry(&app, &pantry)?;
    Ok(pantry)
}

#[tauri::command]
fn list_recipes(app: tauri::AppHandle) -> Result<Vec<Recipe>, String> {
    Ok(load_recipes_cache(&app).unwrap_or_default())
}

#[tauri::command]
fn cancel(running: State<'_, RunningChild>) -> Result<(), String> {
    if let Some(pid) = *running.0.lock().unwrap() {
        Command::new("kill")
            .args(["-9", &pid.to_string()])
            .status()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn open_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_recipe(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let url = format!("mela://recipe/{id}");
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_produce() -> ProduceResult {
        ProduceResult {
            feed_title: "Dave's Market Update".into(),
            feed_link: "https://example.com/post".into(),
            feed_html: "<p>hi</p>".into(),
            fruit: vec!["apple".into()],
            vegetable: vec!["corn".into()],
            pick: vec!["apple".into()],
            featured: vec![],
        }
    }

    #[test]
    fn produce_cache_round_trips_through_json() {
        let cache = ProduceCache {
            entry_id: "tag:shopify,2026:post-123".into(),
            produce: sample_produce(),
        };
        let json = serde_json::to_string(&cache).unwrap();
        let parsed: ProduceCache = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.entry_id, cache.entry_id);
        assert_eq!(parsed.produce.feed_title, cache.produce.feed_title);
        assert_eq!(parsed.produce.fruit, cache.produce.fruit);
    }

    #[test]
    fn recipes_cache_round_trips_through_json() {
        let recipes = vec![Recipe {
            id: "abc".into(),
            title: "Fig Salad".into(),
            description: "A salad".into(),
            ingredients: "figs\ngoat cheese".into(),
            favorite: true,
            total_time: "25min".into(),
            yield_: "2".into(),
            key_ingredients: vec!["figs".into()],
        }];
        let json = serde_json::to_string(&recipes).unwrap();
        let parsed: Vec<Recipe> = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].title, "Fig Salad");
        assert_eq!(parsed[0].ingredients, "figs\ngoat cheese");
        assert!(parsed[0].favorite);
        assert_eq!(parsed[0].total_time, "25min");
        assert_eq!(parsed[0].yield_, "2");
        assert_eq!(parsed[0].key_ingredients, vec!["figs".to_string()]);
    }

    fn recipe(id: &str, title: &str, keys: &[&str]) -> Recipe {
        Recipe {
            id: id.into(),
            title: title.into(),
            description: String::new(),
            ingredients: String::new(),
            favorite: false,
            total_time: String::new(),
            yield_: String::new(),
            key_ingredients: keys.iter().map(|k| k.to_string()).collect(),
        }
    }

    #[test]
    fn parses_key_ingredient_lines_and_skips_commentary() {
        let answer = "Here are the results:\n\
                      id: abc — key: Asparagus, Tofu\n\
                      - id: def — key: fig, goat cheese\n\
                      that's everything!";
        let parsed = parse_key_ingredient_lines(answer);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].0, "abc");
        // Lowercased so scoring can compare against produce names directly.
        assert_eq!(parsed[0].1, vec!["asparagus", "tofu"]);
        assert_eq!(parsed[1].0, "def");
    }

    // The whole point of the redesign: a recipe built around in-season
    // produce must outrank one that merely garnishes with it.
    #[test]
    fn defining_ingredient_outranks_garnish() {
        let produce = vec!["asparagus".to_string()];
        let star = recipe("a", "Asparagus Stir Fry", &["asparagus", "tofu"]);
        let garnish = recipe("b", "Beef Pie", &["beef", "pastry", "asparagus"]);
        let (star_score, matches) = score_recipe(&star, &produce);
        let (garnish_score, _) = score_recipe(&garnish, &produce);
        assert!(star_score > garnish_score);
        assert_eq!(matches, vec!["asparagus"]);
    }

    // The whole point of matching on word boundaries: a short produce name
    // must not match a longer unrelated ingredient that merely starts with
    // it. "corn" vs "corned beef" is the case that motivated the rule.
    #[test]
    fn produce_matches_on_word_boundaries_not_substrings() {
        // Same ingredient, including plurals and multi-word names.
        assert!(produce_matches("corn", "corn"));
        assert!(produce_matches("potato", "potatoes"));
        assert!(produce_matches("beetroot", "beetroots"));
        assert!(produce_matches("Apple", "apples")); // case-insensitive
        assert!(produce_matches("snow pea", "snow peas"));
        assert!(produce_matches("brussels sprout", "brussels sprouts"));

        // Different ingredient that merely shares a prefix.
        assert!(!produce_matches("corn", "corned beef"));
        assert!(!produce_matches("corn", "cornflour"));
        assert!(!produce_matches("pea", "peanut butter"));
        assert!(!produce_matches("lime", "limeade"));
        assert!(!produce_matches("orange", "oregano"));
    }

    // The feed abbreviates where recipes are explicit, so a trailing noun
    // must not break the match — but a *leading* qualifier names a
    // different ingredient. This asymmetry is the whole rule.
    #[test]
    fn trailing_words_extend_a_name_but_leading_words_change_it() {
        assert!(produce_matches("sugar snap", "sugar snap peas"));
        assert!(produce_matches("brussels sprout", "brussels sprouts"));

        assert!(!produce_matches("corn", "sweet corn"));
        assert!(!produce_matches("broccoli", "chinese broccoli"));

        // ponytail: known soft spot — a trailing extension that is not the
        // same ingredient. Harmless while no recipe ranks on it; if one
        // does, this is the assertion to flip.
        assert!(produce_matches("apple", "apple cider vinegar"));
    }

    // Synonyms are out of scope for equality matching. Pinned so the
    // limitation is visible rather than discovered as a silent miss.
    #[test]
    fn synonyms_do_not_match_without_an_alias_table() {
        assert!(!produce_matches("beetroot", "beets"));
        assert!(!produce_matches("capsicum", "bell pepper"));
    }

    // Varietals are separate ingredients with separate seasons, so these
    // stay unmatched on purpose — see the ponytail comment on
    // produce_matches before "fixing" either of them.
    #[test]
    fn varietals_are_distinct_ingredients() {
        assert!(!produce_matches("broccoli", "broccolini"));
        assert!(!produce_matches("potato", "sweet potato"));
        // ...but the plain forms still match their own plurals.
        assert!(produce_matches("broccoli", "broccoli"));
        assert!(produce_matches("sweet potato", "sweet potatoes"));
    }

    // The vocabulary only collapses variants if quantities, units and prep
    // words are stripped the same way every time.
    #[test]
    fn ingredient_name_reduces_a_line_to_the_item() {
        assert_eq!(ingredient_name("2 large cloves garlic, minced"), "garlic");
        assert_eq!(ingredient_name("3 Tbsp olive oil"), "olive oil");
        assert_eq!(ingredient_name("1 medium onion ((diced))"), "onion");
        assert_eq!(
            ingredient_name("3 pounds yukon gold potatoes, partially peeled"),
            "yukon gold potato"
        );
        // Variants of one item must land on the same name.
        assert_eq!(
            ingredient_name("2 garlic cloves"),
            ingredient_name("1 garlic clove")
        );
        assert_eq!(
            ingredient_name("1/4 cup extra-virgin olive oil"),
            ingredient_name("2 tbsp extra virgin olive oil")
        );
        // A line it can't reduce keeps its text rather than emptying out —
        // a pantry miss, not a crash.
        assert!(!ingredient_name("Sea salt and black pepper").is_empty());
    }

    // ingredientName() in RecipeDetail.jsx reimplements this to look rows up
    // in the pantry set, so the two must agree or an override never matches.
    // These are the shapes where a naive JS port diverged: non-ASCII letters
    // and inner punctuation must survive, since only the ends are trimmed.
    #[test]
    fn ingredient_name_keeps_inner_punctuation_and_non_ascii() {
        assert_eq!(ingredient_name("1 or 2 jalapeños, sliced"), "or 2 jalapeño");
        assert_eq!(ingredient_name("Cream and/or olive oil"), "cream and/or olive oil");
        assert!(ingredient_name("3 tablespoons/52 grams tamari").contains('/'));
    }

    #[test]
    fn vocabulary_is_deduplicated_and_skips_section_headers() {
        let mut a = recipe("a", "One", &[]);
        a.ingredients = "# FILLING\n2 cloves garlic\n1 Tbsp olive oil".into();
        let mut b = recipe("b", "Two", &[]);
        b.ingredients = "1 clove garlic, minced\n\n3 cups flour".into();

        let vocab = ingredient_vocabulary(&[a, b]);
        assert_eq!(vocab, vec!["flour", "garlic", "olive oil"]);
    }

    #[test]
    fn recipe_with_no_matching_key_ingredient_scores_zero() {
        let (score, matches) = score_recipe(
            &recipe("a", "Beef Pie", &["beef", "pastry"]),
            &["asparagus".to_string()],
        );
        assert_eq!(score, 0);
        assert!(matches.is_empty());
    }

    // A resync must not wipe analysis: known ids keep their key ingredients,
    // genuinely new ones come out empty so "Sync Now" picks them up.
    #[test]
    fn merge_preserves_analysis_and_leaves_new_recipes_unanalysed() {
        let cached = vec![recipe("a", "Asparagus Stir Fry", &["asparagus", "tofu"])];
        let fresh = vec![
            recipe("a", "Asparagus Stir Fry", &[]),
            recipe("b", "Brand New Recipe", &[]),
        ];
        let merged = merge_recipes(fresh, &cached);
        assert_eq!(merged[0].key_ingredients, vec!["asparagus", "tofu"]);
        assert!(merged[1].key_ingredients.is_empty());
        assert_eq!(
            merged.iter().filter(|r| r.key_ingredients.is_empty()).count(),
            1
        );
    }

    // A recipes.json written before favorite/total_time/yield existed must
    // still load rather than failing the whole cache read.
    #[test]
    fn recipes_cache_loads_pre_metadata_json() {
        let json = r#"[{"id":"abc","title":"Fig Salad","description":"A salad","ingredients":"figs"}]"#;
        let parsed: Vec<Recipe> = serde_json::from_str(json).unwrap();
        assert_eq!(parsed[0].title, "Fig Salad");
        assert!(!parsed[0].favorite);
        assert_eq!(parsed[0].total_time, "");
    }

    // The cache-hit/miss decision in sync_on_launch turns on this exact
    // comparison: same entry_id means reuse the cache, anything else
    // (including no cache at all) means refetch.
    #[test]
    fn cache_hit_requires_matching_entry_id() {
        let cache = ProduceCache {
            entry_id: "post-1".into(),
            produce: sample_produce(),
        };
        assert!(cache.entry_id == "post-1");
        assert!(cache.entry_id != "post-2");
    }

    #[test]
    fn corrupt_produce_cache_json_fails_to_parse_not_panics() {
        let result: Result<ProduceCache, _> = serde_json::from_str("not valid json");
        assert!(result.is_err());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(RunningChild::default())
        .invoke_handler(tauri::generate_handler![
            sync_on_launch,
            analyze_new_recipes,
            build_pantry,
            list_pantry,
            set_pantry_item,
            match_recipes,
            list_recipes,
            cancel,
            open_recipe,
            open_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
