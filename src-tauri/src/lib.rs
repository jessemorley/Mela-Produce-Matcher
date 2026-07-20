use rusqlite::Connection;
use serde::{Deserialize, Serialize};
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
            "SELECT ZID, ZTITLE, ZTEXT, ZINGREDIENTS FROM ZRECIPEOBJECT \
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

fn build_ranking_prompt(recipes: &[Recipe], produce: &[String], entry_title: &str) -> String {
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

    let produce_list = produce.join(", ");

    format!(
        "Here is a home cook's recipe collection (id, title, description,\n\
        ingredients), already filtered to ones that plausibly use this week's\n\
        in-season produce ({produce_list}) from the newsletter \"{entry_title}\":\n\n\
        {recipe_lines}\n\n\
        Rank these recipes from best fit to weakest fit against that produce list —\n\
        do not group by produce item, order the whole list purely by how well each\n\
        recipe matches what's in season right now. Only include genuine matches.\n\
        Output each one as a single line in exactly this format:\n\n\
        N. **Recipe Title** — id: RECIPE_ID — matches: ingredient, ingredient — fit: one-line reason"
    )
}

fn filter_recipes_by_produce<'a>(recipes: &'a [Recipe], produce: &[String]) -> Vec<&'a Recipe> {
    recipes
        .iter()
        .filter(|r| {
            let searchable = format!("{} {}", r.description, r.ingredients).to_lowercase();
            produce.iter().any(|p| searchable.contains(&p.to_lowercase()))
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
    let recipes = load_recipes(&mela_db_path())?;
    if recipes.is_empty() {
        return Err(format!("No recipes found in {}", mela_db_path().display()));
    }
    save_recipes_cache(&app, &recipes)?;

    let _ = app.emit("status", "Done.");
    Ok(SyncResult {
        produce,
        produce_from_cache,
        recipe_count: recipes.len(),
    })
}

#[derive(Serialize, Clone)]
struct MatchResult {
    recipe_count: usize,
    candidate_count: usize,
}

#[tauri::command]
async fn match_recipes(
    app: tauri::AppHandle,
    running: State<'_, RunningChild>,
    feed_title: String,
    fruit: Vec<String>,
    vegetable: Vec<String>,
) -> Result<MatchResult, String> {
    let produce: Vec<String> = fruit.into_iter().chain(vegetable).collect();
    let _ = app.emit("status", "Loading recipes...");
    let recipes = load_recipes_cache(&app)
        .ok_or_else(|| "No cached recipes — sync hasn't run yet".to_string())?;
    if recipes.is_empty() {
        return Err("No recipes found in the local cache".to_string());
    }
    let _ = app.emit("status", format!("Loaded {} recipes", recipes.len()));

    let candidates = filter_recipes_by_produce(&recipes, &produce);
    if candidates.is_empty() {
        return Err("No recipes match this week's produce".to_string());
    }
    let _ = app.emit(
        "status",
        format!(
            "Ranking {} matching recipes (of {})...",
            candidates.len(),
            recipes.len()
        ),
    );

    let candidate_recipes: Vec<Recipe> = candidates.into_iter().cloned().collect();
    let ranking_prompt = build_ranking_prompt(&candidate_recipes, &produce, &feed_title);
    run_claude(&ranking_prompt, &running, |line| {
        let _ = app.emit("suggestion-line", line);
    })?;

    let _ = app.emit("status", "Done.");
    Ok(MatchResult {
        recipe_count: recipes.len(),
        candidate_count: candidate_recipes.len(),
    })
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
        }];
        let json = serde_json::to_string(&recipes).unwrap();
        let parsed: Vec<Recipe> = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].title, "Fig Salad");
        assert_eq!(parsed[0].ingredients, "figs\ngoat cheese");
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
            match_recipes,
            list_recipes,
            cancel,
            open_recipe,
            open_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
