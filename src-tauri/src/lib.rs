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

// One ingredient line. `name`/`pantry` are LLM-produced by the key-ingredient
// analysis call and empty/false until then; `name: ""` means "not analysed
// yet" and excludes the line from matching. Untouched across a launch resync
// since `diff_recipe_ids` reuses cached recipes as-is rather than re-reading
// them.
#[derive(Serialize, Deserialize, Clone, PartialEq)]
struct Ingredient {
    display: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    pantry: bool,
}

#[derive(Serialize, Deserialize, Clone)]
struct Recipe {
    id: String,
    title: String,
    description: String,
    ingredients: Vec<Ingredient>,
    // Added after the first release; serde(default) keeps an existing
    // recipes.json written without them loading instead of erroring.
    #[serde(default)]
    favorite: bool,
    #[serde(default)]
    total_time: String,
    #[serde(default, rename = "yield")]
    yield_: String,
    // Absolute path to the recipe's cover image (Mela's ZINDEX=0) as written
    // into the app data dir's `images/` at sync time, or empty if Mela has no
    // photo for it. A path, not a data: URI — these are full-resolution
    // originals (several MB each), so 215 of them base64'd into recipes.json
    // made the file ~7MB to parse on every launch. The frontend loads them
    // through Tauri's asset protocol instead (see convertFileSrc in
    // RecipeList/RecipeDetail), which streams from disk and lets the webview
    // cache and downscale them per display size.
    #[serde(default)]
    image: String,
    #[serde(default)]
    tags: Vec<String>,
    // Claude-analysed defining ingredients, most-defining first (asparagus
    // before the spring onion garnish). Empty means "not analysed yet" —
    // that's what analyze_new_recipes looks for. Never read from Mela;
    // untouched by a launch resync since already-cached recipes aren't
    // re-read (see diff_recipe_ids).
    #[serde(default)]
    key_ingredients: Vec<String>,
    // User-marked "never match this" (a vegan cheese sauce has no seasonal
    // produce story). Skipped by match_recipes and by analyze_new_recipes,
    // so excluding a recipe before its first analysis also saves the Claude
    // call. Set only via set_excluded; a Mela resync never touches it.
    #[serde(default)]
    excluded: bool,
}

// Mela stores ingredients as one blob of newline-separated lines, with
// "# SECTION" headers and blank lines mixed in. Those are dropped here at
// sync time (per the handoff design) rather than filtered by every reader.
fn parse_ingredient_lines(blob: &str) -> Vec<Ingredient> {
    blob.lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .map(|display| Ingredient {
            display: display.to_string(),
            name: String::new(),
            pantry: false,
        })
        .collect()
}

// Mela (Core Data) stores each recipe image one of two ways: small images
// inline in ZDATA with a one-byte prefix before the real bytes (observed as
// 0x01), or — past Core Data's external-storage threshold, which most
// photos exceed — ZDATA instead holds a 0x02-prefixed, NUL-terminated UUID
// string pointing to a same-named file under
// .Curcuma_SUPPORT/_EXTERNAL_DATA/ that holds the actual bytes with no
// prefix at all. Both forms are tried across every ZINDEX row for the
// recipe (multi-photo recipes keep the rest at later indices); the first
// one that sniffs as a real image wins, so a recipe whose ZINDEX 0 row
// happens to be missing or corrupt still finds its photo elsewhere.
fn cover_image_path(
    stmt: &mut rusqlite::Statement,
    external_dir: &std::path::Path,
    images_dir: &std::path::Path,
    recipe_id: &str,
    recipe_pk: i64,
) -> String {
    let Ok(rows) = stmt
        .query_map([recipe_pk], |row| row.get::<_, Vec<u8>>(0))
        .map(|rows| rows.filter_map(Result::ok).collect::<Vec<_>>())
    else {
        return String::new();
    };
    for data in rows {
        let bytes = match external_storage_uuid(&data) {
            Some(uuid) => match std::fs::read(external_dir.join(uuid)) {
                Ok(b) => b,
                Err(_) => continue,
            },
            None => match data.get(1..) {
                Some(b) => b.to_vec(),
                None => continue,
            },
        };
        if let Some(ext) = image_extension(&bytes) {
            if let Some(path) = write_cover_image(images_dir, recipe_id, ext, &bytes) {
                return path;
            }
        }
    }
    String::new()
}

/// Writes one recipe's cover image beside the recipes cache, named by recipe
/// ID so a re-sync overwrites in place rather than accumulating orphans.
/// Returns the absolute path as a string (what `Recipe.image` holds).
fn write_cover_image(
    images_dir: &std::path::Path,
    recipe_id: &str,
    ext: &str,
    bytes: &[u8],
) -> Option<String> {
    // Recipe IDs are Mela-generated UUID-ish strings, but they land in a
    // filename here, so anything that isn't plainly safe becomes '_' — a
    // stray '/' would otherwise write outside images_dir.
    let safe: String = recipe_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    if safe.is_empty() {
        return None;
    }
    std::fs::create_dir_all(images_dir).ok()?;
    let path = images_dir.join(format!("{safe}.{ext}"));
    std::fs::write(&path, bytes).ok()?;
    Some(path.to_string_lossy().into_owned())
}

// A Core Data external-storage marker: 0x02, then an ASCII UUID, then a
// trailing NUL — distinct in shape from both the 0x01-prefixed inline forms
// and the handful of legacy rows that hold neither.
fn external_storage_uuid(data: &[u8]) -> Option<&str> {
    let body = data.strip_prefix(&[0x02])?.strip_suffix(&[0x00])?;
    let s = std::str::from_utf8(body).ok()?;
    (s.len() == 36 && s.as_bytes().iter().all(|b| b.is_ascii_hexdigit() || *b == b'-'))
        .then_some(s)
}

/// Sniffs the format of a Mela image blob, returning the file extension to
/// store it under — the bytes themselves are written through untouched, so
/// this is purely "is this really an image, and what do I call the file".
///
/// Nothing is decoded or re-encoded any more: the originals are copied out
/// at full resolution and the webview scales them down for whatever slot
/// they land in. That also means HEIC needs no special case — WKWebView
/// renders it natively via the system codec, which the `image` crate can't.
fn image_extension(data: &[u8]) -> Option<&'static str> {
    if data.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if data.starts_with(b"RIFF") && data.get(8..12) == Some(b"WEBP") {
        Some("webp")
    } else if data.starts_with(b"MM\x00\x2a") || data.starts_with(b"II\x2a\x00") {
        Some("tiff")
    } else if data.get(4..12) == Some(b"ftypheic") {
        Some("heic")
    } else {
        None
    }
}

fn mela_db_path() -> PathBuf {
    let home = std::env::var("HOME").expect("HOME not set");
    PathBuf::from(home).join(
        "Library/Group Containers/66JC38RDUD.recipes.mela/Data/Curcuma.sqlite",
    )
}

fn open_mela_db(db_path: &PathBuf) -> Result<Connection, String> {
    // mode=ro opens a second reader connection; safe alongside Mela's own
    // open connection even when its WAL file is active.
    let uri = format!("file:{}?mode=ro", db_path.display());
    Connection::open_with_flags(
        &uri,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(|e| format!("failed to open Mela database: {e}"))
}

/// Cheap: only Z_PK and ZID, no ingredients/images/tags. The only query run
/// against every row on every launch — everything else is per-recipe and
/// only runs for recipes actually being (re)loaded.
fn recipe_ids(conn: &Connection) -> Result<Vec<(i64, String)>, String> {
    let mut stmt = conn
        .prepare("SELECT Z_PK, ZID FROM ZRECIPEOBJECT WHERE ZTITLE IS NOT NULL")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?.unwrap_or_default()))
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Full per-row read for one recipe (title/description/ingredients/favorite/
/// time/yield/image/tags). `image_stmt`/`tags_stmt` are prepared once by the
/// caller and threaded in so a batch of calls (`load_all_recipes`) doesn't
/// re-prepare them per row. `images_dir` is where cover photos get copied to
/// (see `cover_image_path`).
fn load_recipe(
    conn: &Connection,
    image_stmt: &mut rusqlite::Statement,
    tags_stmt: &mut rusqlite::Statement,
    external_data_dir: &std::path::Path,
    images_dir: &std::path::Path,
    pk: i64,
) -> Result<Recipe, String> {
    conn.query_row(
        "SELECT ZID, ZTITLE, ZTEXT, ZINGREDIENTS, ZFAVORITE, \
         COALESCE(NULLIF(ZTOTALTIME, ''), ZCOOKTIME, ZPREPTIME), ZYIELD \
         FROM ZRECIPEOBJECT WHERE Z_PK = ?1",
        [pk],
        |row| {
            let id = row.get::<_, Option<String>>(0)?.unwrap_or_default();
            Ok(Recipe {
                title: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                description: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                ingredients: parse_ingredient_lines(
                    &row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                ),
                favorite: row.get::<_, Option<i64>>(4)?.unwrap_or(0) == 1,
                total_time: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                yield_: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                image: cover_image_path(image_stmt, external_data_dir, images_dir, &id, pk),
                id,
                tags: tags_stmt
                    .query_map([pk], |r| r.get::<_, String>(0))
                    .map(|rows| rows.filter_map(Result::ok).collect())
                    .unwrap_or_default(),
                key_ingredients: Vec::new(),
                excluded: false,
            })
        },
    )
    .map_err(|e| e.to_string())
}

fn prepare_image_stmt(conn: &Connection) -> Result<rusqlite::Statement<'_>, String> {
    conn.prepare("SELECT ZDATA FROM ZRECIPEIMAGEOBJECT WHERE ZRECIPE = ?1 ORDER BY ZINDEX")
        .map_err(|e| e.to_string())
}

fn prepare_tags_stmt(conn: &Connection) -> Result<rusqlite::Statement<'_>, String> {
    conn.prepare(
        "SELECT t.ZTITLE FROM ZRECIPETAG t \
         JOIN Z_4TAGS j ON j.Z_5TAGS = t.Z_PK \
         WHERE j.Z_4RECIPES = ?1 ORDER BY t.ZTITLE",
    )
    .map_err(|e| e.to_string())
}

fn external_data_dir(db_path: &PathBuf) -> PathBuf {
    db_path
        .parent()
        .expect("Mela db path has a parent dir")
        .join(".Curcuma_SUPPORT/_EXTERNAL_DATA")
}

/// Loads every recipe from Mela (full scan). Used by `full_resync`; the
/// incremental `sync_on_launch` path uses `recipe_ids` + `load_recipe`
/// instead so it only reads rows that changed.
fn load_all_recipes(db_path: &PathBuf, images_dir: &std::path::Path) -> Result<Vec<Recipe>, String> {
    let conn = open_mela_db(db_path)?;
    let ids = recipe_ids(&conn)?;
    let mut image_stmt = prepare_image_stmt(&conn)?;
    let mut tags_stmt = prepare_tags_stmt(&conn)?;
    let external_dir = external_data_dir(db_path);
    let mut recipes: Vec<Recipe> = ids
        .into_iter()
        .map(|(pk, _)| {
            load_recipe(&conn, &mut image_stmt, &mut tags_stmt, &external_dir, images_dir, pk)
        })
        .collect::<Result<_, _>>()?;
    recipes.sort_by(|a, b| a.title.cmp(&b.title));
    Ok(recipes)
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

fn build_key_ingredient_prompt(recipes: &[Recipe]) -> String {
    let recipe_lines = recipes
        .iter()
        .map(|r| {
            let numbered = r
                .ingredients
                .iter()
                .enumerate()
                .map(|(i, ing)| format!("  {i}: {}", ing.display))
                .collect::<Vec<_>>()
                .join("\n");
            format!(
                "[{}] {} — {}\n{numbered}",
                r.id, r.title, r.description
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    format!(
        "Here are recipes from a home cook's collection, each with its\n\
        numbered ingredient lines:\n\n\
        {recipe_lines}\n\n\
        For each recipe, do two things:\n\n\
        1. Identify the 2-4 ingredients that actually define the dish — the\n\
        ones a shopper would build the meal around. Rank them most-defining\n\
        first. In \"asparagus and tofu stir fry\" the key ingredients are\n\
        asparagus and tofu; a spring onion garnish, oil, salt, and pantry\n\
        staples are NOT key ingredients. Prefer fresh produce and proteins\n\
        over seasonings and condiments. Use short singular ingredient names\n\
        (\"asparagus\", not \"2 bunches trimmed asparagus\").\n\n\
        2. For EVERY numbered ingredient line (all of them, in order), give\n\
        its canonical short singular name and whether it is a pantry staple\n\
        (kept in the cupboard/fridge, bought occasionally — oils, spices,\n\
        flour, tinned goods, dairy) or produce (fresh, bought weekly —\n\
        vegetables, fruit, fresh herbs, meat, fish). A line naming two\n\
        ingredients (\"salt and pepper\") gets ONE combined name, do not\n\
        split it into two lines.\n\n\
        Output in exactly this format, nothing else:\n\n\
        id: RECIPE_ID\n\
        key: ingredient, ingredient, ingredient\n\
        0 => name => produce\n\
        1 => name => pantry\n\
        (one numbered line per ingredient, covering every index)"
    )
}

/// Parses one recipe's analysis block: the `key:` line and every `n =>
/// name => produce|pantry` line. Returns (id, key_ingredients, per-index
/// name+pantry). An index line with more than two `=>` still parses — only
/// the first two split points matter, so a name containing "=>" is the sole
/// unhandled edge case, and it isn't one real ingredient names produce.
fn parse_key_ingredient_lines(
    answer: &str,
) -> Vec<(String, Vec<String>, Vec<(usize, String, bool)>)> {
    let mut out = Vec::new();
    let mut current: Option<(String, Vec<String>, Vec<(usize, String, bool)>)> = None;

    for raw_line in answer.lines() {
        let line = raw_line.trim().trim_start_matches('-').trim();
        if let Some(rest) = line.strip_prefix("id:") {
            if let Some(done) = current.take() {
                out.push(done);
            }
            current = Some((rest.trim().to_string(), Vec::new(), Vec::new()));
        } else if let Some(rest) = line.strip_prefix("key:") {
            if let Some((_, keys, _)) = current.as_mut() {
                *keys = rest
                    .split(',')
                    .map(|s| s.trim().to_lowercase())
                    .filter(|s| !s.is_empty())
                    .collect();
            }
        } else if let Some((_, _, indexed)) = current.as_mut() {
            let mut parts = line.splitn(3, "=>");
            let (Some(idx), Some(name), Some(kind)) =
                (parts.next(), parts.next(), parts.next())
            else {
                continue;
            };
            let Ok(idx) = idx.trim().parse::<usize>() else {
                continue;
            };
            let name = name.trim().to_lowercase();
            if name.is_empty() {
                continue;
            }
            let pantry = kind.trim().eq_ignore_ascii_case("pantry");
            indexed.push((idx, name, pantry));
        }
    }
    if let Some(done) = current.take() {
        out.push(done);
    }
    out
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

/// Trailing words that turn a produce head into a manufactured/derived
/// product rather than a form of the vegetable/fruit itself — "corn" is
/// produce, "corn tortillas" is a pantry staple made from corn. Extends the
/// trailing-noun rule below: a trailing noun normally means the *same*
/// ingredient stated more specifically ("sugar snap" -> "sugar snap peas"),
/// but these particular nouns mean a different, processed product instead.
/// ponytail: the known soft spot named in produce_matches' doc comment,
/// upgraded from a comment into code once a recipe ("Avocado-Black Bean
/// Tostadas", corn tortillas) actually ranked on the false match. Add words
/// here as real recipes surface more of them — the newsletter's produce
/// list is what determines which heads can even collide.
const NOT_A_PRODUCE_FORM: &[&str] = &[
    "tortilla", "tortillas", "flour", "starch", "vinegar", "syrup", "oil", "chip", "chips",
    "flake", "flakes", "powder", "extract", "meal", "bread", "cereal", "milk",
];

/// True if a produce name and a recipe's key ingredient name the same
/// ingredient. Both are split into plural-normalised words and compared
/// from the front, so one may *extend* the other with trailing words but
/// neither may add a leading qualifier:
///
/// - "sugar snap" == "sugar snap peas"  (the feed abbreviates, recipes don't)
/// - "corn"       != "corned beef"      (mid-word, not a word at all)
/// - "potato"     != "sweet potato"     (leading qualifier: different thing)
/// - "corn"       != "corn tortillas"   (trailing word names a product, not a form)
///
/// ponytail: comparing head words, not substrings and not full equality.
/// A leading qualifier makes a different ingredient with a different season
/// ("broccoli"/"broccolini", "potato"/"sweet potato", "broccoli"/"chinese
/// broccoli"), which is intended behaviour rather than a gap to fill.
/// Irregular plurals (leaf/leaves) and synonyms (capsicum/bell pepper,
/// beetroot/beets) stay out of scope until the newsletter publishes names
/// this misses.
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
    if shared == 0 || produce[..shared] != key[..shared] {
        return false;
    }
    let longer = if produce.len() > key.len() { &produce } else { &key };
    !longer[shared..].iter().any(|w| NOT_A_PRODUCE_FORM.contains(&w.as_str()))
}

// Season bitmask. Australia's calendar seasons (summer = Dec/Jan/Feb, etc.).
const SUMMER: u8 = 1 << 0;
const AUTUMN: u8 = 1 << 1;
const WINTER: u8 = 1 << 2;
const SPRING: u8 = 1 << 3;

/// The current Australian season from the system clock's local month.
/// Dec/Jan/Feb = summer, and so on down under.
fn current_season() -> u8 {
    use chrono::{Datelike, Local};
    match Local::now().month() {
        12 | 1 | 2 => SUMMER,
        3..=5 => AUTUMN,
        6..=8 => WINTER,
        _ => SPRING,
    }
}

/// Stable "what's generally in season" table for Australia, from Sustainable
/// Table's seasonal produce guide. Names are singular/lowercase to compare
/// via `produce_matches` the same way the newsletter's names do. This is the
/// second, lower-weighted matching layer under the live market update — it
/// doesn't change week to week, only with the season.
const SEASONAL_PRODUCE: &[(&str, u8)] = &[
    // Fruit
    ("apple", AUTUMN | WINTER | SPRING | SUMMER),
    ("apricot", SUMMER),
    ("avocado", AUTUMN | WINTER | SPRING | SUMMER),
    ("banana", AUTUMN | SPRING | SUMMER),
    ("blackberry", AUTUMN | SUMMER),
    ("blueberry", SPRING | SUMMER),
    ("boysenberry", SUMMER),
    ("cantaloupe", SPRING | SUMMER),
    ("cherry", SPRING | SUMMER),
    ("cumquat", AUTUMN | WINTER | SPRING),
    ("currant", SUMMER),
    ("custard apple", AUTUMN | WINTER),
    ("feijoa", AUTUMN | WINTER),
    ("fig", AUTUMN | SUMMER),
    ("grapefruit", AUTUMN | WINTER | SPRING | SUMMER),
    ("grape", AUTUMN | SUMMER),
    ("guava", AUTUMN),
    ("honeydew", SPRING | SUMMER),
    ("kiwi fruit", AUTUMN | WINTER),
    ("lemon", AUTUMN | WINTER | SPRING | SUMMER),
    ("lime", AUTUMN | WINTER | SPRING | SUMMER),
    ("loganberry", SUMMER),
    ("loquat", SPRING),
    ("lychee", SPRING | SUMMER),
    ("mango", AUTUMN | SPRING | SUMMER),
    ("mangosteen", AUTUMN),
    ("mulberry", SPRING | SUMMER),
    ("nashi", AUTUMN | WINTER),
    ("nectarine", SUMMER),
    ("orange", AUTUMN | WINTER | SPRING | SUMMER),
    ("papaya", AUTUMN | SPRING),
    ("passionfruit", AUTUMN | SUMMER),
    ("peach", AUTUMN | SUMMER),
    ("pear", AUTUMN | WINTER | SPRING | SUMMER),
    ("pepino", SPRING),
    ("persimmon", AUTUMN | WINTER),
    ("pineapple", WINTER | SPRING | SUMMER),
    ("plum", AUTUMN | SUMMER),
    ("pomegranate", AUTUMN),
    ("prickly pear", AUTUMN),
    ("quince", AUTUMN | WINTER),
    ("rambutan", AUTUMN | SUMMER),
    ("raspberry", AUTUMN | SUMMER),
    ("rhubarb", AUTUMN | WINTER | SPRING | SUMMER),
    ("starfruit", SPRING),
    ("strawberry", AUTUMN | SPRING | SUMMER),
    ("tamarillo", AUTUMN | WINTER | SPRING | SUMMER),
    ("tangelo", WINTER | SPRING),
    ("watermelon", SPRING | SUMMER),
    // Vegetables
    ("artichoke", AUTUMN | SPRING),
    ("asian greens", AUTUMN | WINTER | SPRING),
    ("asparagus", SPRING | SUMMER),
    ("bean", AUTUMN | SPRING | SUMMER),
    ("beetroot", AUTUMN | SPRING | SUMMER),
    ("broccoli", AUTUMN | WINTER | SPRING),
    ("broccolini", WINTER),
    ("broad bean", WINTER),
    ("brussels sprout", AUTUMN | WINTER | SPRING),
    ("cabbage", AUTUMN | WINTER | SPRING | SUMMER),
    ("capsicum", AUTUMN | WINTER | SPRING | SUMMER),
    ("carrot", AUTUMN | WINTER | SPRING | SUMMER),
    ("cauliflower", AUTUMN | WINTER | SPRING),
    ("celeriac", WINTER),
    ("celery", AUTUMN | WINTER | SPRING | SUMMER),
    ("corn", AUTUMN | SPRING | SUMMER),
    ("cucumber", AUTUMN | WINTER | SPRING | SUMMER),
    ("daikon", AUTUMN | SPRING | SUMMER),
    ("eggplant", AUTUMN | WINTER | SPRING | SUMMER),
    ("fennel", AUTUMN | WINTER | SPRING),
    ("horseradish", WINTER),
    ("kale", WINTER),
    ("kohlrabi", WINTER),
    ("leek", AUTUMN | WINTER | SPRING | SUMMER),
    ("lettuce", AUTUMN | WINTER | SPRING | SUMMER),
    ("mushroom", AUTUMN | WINTER | SPRING | SUMMER),
    ("okra", AUTUMN | WINTER | SPRING | SUMMER),
    ("onion", AUTUMN | WINTER | SPRING | SUMMER),
    ("parsnip", AUTUMN | WINTER | SPRING),
    ("pea", SPRING | SUMMER),
    ("potato", AUTUMN | WINTER | SPRING | SUMMER),
    ("pumpkin", AUTUMN | WINTER | SPRING),
    ("radish", WINTER | SPRING | SUMMER),
    ("shallot", AUTUMN | WINTER | SPRING | SUMMER),
    ("silverbeet", AUTUMN | WINTER | SPRING | SUMMER),
    ("snow pea", SUMMER),
    ("spinach", AUTUMN | WINTER | SPRING),
    ("spring onion", AUTUMN | WINTER | SPRING | SUMMER),
    ("squash", AUTUMN | SPRING | SUMMER),
    ("sugar snap", SUMMER),
    ("swede", AUTUMN | WINTER | SPRING),
    ("sweet potato", AUTUMN | WINTER | SPRING),
    ("tomato", AUTUMN | SPRING | SUMMER),
    ("turnip", AUTUMN | WINTER | SPRING),
    ("watercress", AUTUMN | SPRING | SUMMER),
    ("witlof", AUTUMN | SPRING),
    ("zucchini", AUTUMN | SPRING | SUMMER),
    // Herbs
    ("apple mint", SUMMER),
    ("basil", AUTUMN | SPRING | SUMMER),
    ("chervil", AUTUMN | SPRING | SUMMER),
    ("chilli", AUTUMN | SPRING | SUMMER),
    ("chive", AUTUMN | SPRING | SUMMER),
    ("coriander", AUTUMN | WINTER | SPRING | SUMMER),
    ("dill", AUTUMN | WINTER | SPRING | SUMMER),
    ("garlic", AUTUMN | SPRING | SUMMER),
    ("ginger", AUTUMN | WINTER | SPRING | SUMMER),
    ("lemongrass", AUTUMN | SPRING | SUMMER),
    ("makrut lime", AUTUMN | SPRING | SUMMER),
    ("mint", AUTUMN | WINTER | SPRING | SUMMER),
    ("oregano", AUTUMN | WINTER | SPRING | SUMMER),
    ("parsley", AUTUMN | WINTER | SPRING | SUMMER),
    ("rosemary", AUTUMN | WINTER | SPRING | SUMMER),
    ("sage", AUTUMN | SPRING),
    ("tarragon", AUTUMN | SUMMER),
    ("thai basil", SUMMER),
    ("thyme", AUTUMN | SUMMER),
    ("vietnamese mint", SUMMER),
];

/// The names from the seasonal table that are in season for the given season
/// mask. Returned lowercase/singular, ready for `produce_matches`.
fn seasonal_produce(season: u8) -> Vec<String> {
    SEASONAL_PRODUCE
        .iter()
        .filter(|(_, seasons)| seasons & season != 0)
        .map(|(name, _)| name.to_string())
        .collect()
}

// A key ingredient's base worth by rank: the first (most-defining) is worth
// the most, each subsequent one less, floored at 1. Rank 0 -> 4, 1 -> 3, ...
fn rank_weight(rank: usize) -> u32 {
    4u32.saturating_sub(rank as u32).max(1)
}

// A Dave's Pick (live market update) hit counts full; a seasonal-table-only
// hit counts a third as much, so a recipe built around this week's actual
// produce always outranks one that's merely in season generally, but the
// seasonal layer still separates and lifts recipes that would otherwise tie
// at zero.
const PICK_WEIGHT: u32 = 3;
const SEASONAL_WEIGHT: u32 = 1;

// Produce that didn't make the 2-4 item key list still counts, at the same
// worth as the lowest-ranked key ingredient. A noodle salad whose only key
// produce is cucumber is still carrying green onion, coriander, ginger and
// garlic, and rating it purely on the cucumber made it a coin flip between
// 0% and 100%. Median recipe here has 2 produce key ingredients and 3
// produce lines outside the key list, so this roughly doubles the evidence
// each rating rests on.
const SUPPORTING_WEIGHT: u32 = 1;

// What an *unmatched* supporting ingredient costs the denominator. Below
// PICK_WEIGHT on purpose: garlic is in 109 of 160 recipes here and has never
// been a market pick, so charging it a full slot taxed every savoury recipe
// for having aromatics. At 2 it still dilutes — fresh garlic is produce and
// should pull its weight when out of season — just less than it earns.
const SUPPORTING_COST: u32 = 2;

/// One in-season hit: the recipe's own ingredient name and the produce name
/// it matched. Both are kept because they come from different vocabularies
/// and each has a reader. `ingredient` is what the recipe calls it
/// ("brussels sprouts") — the chip row displays it and the detail pane looks
/// ingredient rows up by it. `produce` is the feed or seasonal-table name
/// ("brussels sprout") — the In Season tiles carry that, and it's what they
/// filter on.
///
/// Returning only `ingredient` is what made the tiles wrong: the frontend had
/// to re-derive the produce-side comparison `produce_matches` had already
/// done here, and an exact-string stand-in dropped every plural, casing or
/// abbreviation difference (`brussels sprout` vs `brussels sprouts`). Keeping
/// the pair means no caller has to re-match anything.
#[derive(Serialize, Clone, Debug, PartialEq)]
struct Match {
    ingredient: String,
    produce: String,
}

impl Match {
    fn new(ingredient: &str, produce: &str) -> Self {
        Self {
            ingredient: ingredient.to_string(),
            produce: produce.to_string(),
        }
    }
}

/// Rates a recipe 0.0–1.0 on how *defining* its in-season ingredients are,
/// across both layers: the live market update (`market`, weighted full) and
/// the stable seasonal table (`seasonal`, weighted lower). Each key
/// ingredient scores its rank weight times the best layer it hits; the
/// rating is that sum over the max possible (every *produce* key ingredient
/// a top-weighted market pick), so it's comparable across recipes regardless
/// of ingredient count. Returns the rating plus which matches came from each
/// layer. Rating 0 means no hit in either layer.
///
/// Pantry key ingredients are skipped entirely — both sides of the fraction.
/// Cream or stock can never be in season, so counting them as missed
/// opportunities capped a perfectly seasonal recipe well below 1.0 (a
/// cauliflower/potato/cream soup with both vegetables matching rated 48%).
/// The rating asks "are this recipe's seasonal-capable ingredients in
/// season", not "is every defining ingredient a market pick this week",
/// which nothing ever is.
///
/// Dropping them from the denominator *only* is a bug: a pantry ingredient
/// that matched a produce name still scored, pushing ratings past 100%
/// (Pasta alla Norma hit 108%). Skipping is the whole rule — if an
/// ingredient can't be in season, it can neither earn points nor cost them.
///
/// Produce *outside* the key list scores too, at `SUPPORTING_WEIGHT`. Rating
/// on key ingredients alone meant a recipe with one produce key ingredient
/// had a two-valued rating — 100% if it matched, 0% if not — while its other
/// produce lines went unread. Supporting produce can lift a recipe or dilute
/// it, but at the rank floor it can never outweigh what the recipe is
/// actually built around. It also costs less than a full slot when it misses
/// (`SUPPORTING_COST`) — see there — so the rating is clamped to 1.0.
fn rate_recipe(
    recipe: &Recipe,
    market: &[String],
    seasonal: &[String],
) -> (f32, Vec<Match>, Vec<Match>) {
    let is_pantry = |name: &str| {
        recipe
            .ingredients
            .iter()
            .any(|ing| ing.pantry && ing.name == name)
    };

    // Every produce ingredient that can earn points, as (weight, denominator
    // cost, name): key ingredients by rank, then the supporting produce lines
    // the key list left out. A key ingredient's slot costs what a perfect hit
    // on it would earn; a supporting one costs less than it earns, so
    // aromatics dilute a rating without dominating it.
    let mut weighted: Vec<(u32, u32, &String)> = recipe
        .key_ingredients
        .iter()
        .enumerate()
        .filter(|(_, key)| !is_pantry(key))
        .map(|(i, key)| (rank_weight(i), rank_weight(i) * PICK_WEIGHT, key))
        .collect();
    weighted.extend(
        recipe
            .ingredients
            .iter()
            .filter(|ing| {
                !ing.pantry
                    && !ing.name.is_empty()
                    && !recipe.key_ingredients.contains(&ing.name)
            })
            .map(|ing| (SUPPORTING_WEIGHT, SUPPORTING_COST, &ing.name)),
    );

    let mut score = 0u32;
    let mut max = 0u32;
    let mut market_matches = Vec::new();
    let mut seasonal_matches = Vec::new();
    for (weight, cost, name) in weighted {
        max += cost;
        if let Some(p) = market.iter().find(|p| produce_matches(p, name)) {
            score += weight * PICK_WEIGHT;
            market_matches.push(Match::new(name, p));
        } else if let Some(p) = seasonal.iter().find(|p| produce_matches(p, name)) {
            score += weight * SEASONAL_WEIGHT;
            seasonal_matches.push(Match::new(name, p));
        }
    }
    // Supporting produce earns more than its slot costs, so an all-supporting,
    // all-picks recipe can outscore its own denominator. Clamped rather than
    // rebalanced: the alternative is charging aromatics full price again.
    let rating = if max == 0 {
        0.0
    } else {
        (score as f32 / max as f32).min(1.0)
    };
    (rating, market_matches, seasonal_matches)
}

/// Copies everything Mela doesn't store onto a freshly-read recipe: the
/// `excluded` flag, the Claude-analysed `key_ingredients`, and the per-line
/// `name`/`pantry` classifications.
///
/// A fresh `load_recipe` sets all of these to empty/false, so any re-read
/// path that skips this silently throws away every Claude call the user has
/// paid for — `full_resync` used to carry `excluded` only, which un-analysed
/// the entire collection on one button press. Ingredient data is matched by
/// `display` (the verbatim Mela line) rather than by index, so an edit in
/// Mela that adds or reorders lines re-analyses only the lines that actually
/// changed instead of shifting every classification down by one.
fn carry_over_local_fields(fresh: &mut Recipe, cached: &Recipe) {
    fresh.excluded = cached.excluded;
    fresh.key_ingredients = cached.key_ingredients.clone();

    let by_display: HashMap<&str, &Ingredient> = cached
        .ingredients
        .iter()
        .filter(|i| !i.name.is_empty())
        .map(|i| (i.display.as_str(), i))
        .collect();
    for ingredient in fresh.ingredients.iter_mut() {
        if let Some(prev) = by_display.get(ingredient.display.as_str()) {
            ingredient.name = prev.name.clone();
            ingredient.pantry = prev.pantry;
        }
    }
}

/// Diffs Mela's current ID list against the cache: recipes whose ID is
/// already cached are trusted as-is (no re-read — this is the whole point of
/// the incremental sync), recipes gone from Mela are dropped, and the
/// remaining Mela `Z_PK`s are returned for the caller to `load_recipe` fresh.
/// Order follows `mela_ids`, matching Mela's own `ORDER BY ZTITLE`.
fn diff_recipe_ids(mela_ids: &[(i64, String)], cached: &[Recipe]) -> (Vec<i64>, Vec<Recipe>) {
    let cached_by_id: HashMap<&str, &Recipe> =
        cached.iter().map(|r| (r.id.as_str(), r)).collect();
    let mut new_pks = Vec::new();
    let mut kept = Vec::new();
    for (pk, id) in mela_ids {
        match cached_by_id.get(id.as_str()) {
            Some(recipe) => kept.push((*recipe).clone()),
            None => new_pks.push(*pk),
        }
    }
    (new_pks, kept)
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
            // Default effort spends ~20s deliberating before the first
            // token (measured via ttft_ms on this app's real batch
            // prompts) even though the task is pure extraction/classification,
            // not reasoning. low cuts that to ~1-2s with no quality drop
            // observed on this prompt shape.
            "--effort",
            "low",
            // The process inherits this app's own working directory, which
            // is inside a Claude Code project — without this, the CLI loads
            // ~/.claude's user-level settings (including any globally
            // enabled plugins) and can inject an unrelated system prompt via
            // a SessionStart hook, which has been observed to break the
            // rigid id:/key:/N=>name=>kind output format this call depends
            // on. Loading no settings sources keeps this call a clean,
            // isolated completion.
            "--setting-sources",
            "",
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

/// Cover photos copied out of Mela, one file per recipe ID. Lives beside
/// recipes.json so the whole cache is one directory to delete.
fn images_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("images"))
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
    /// Ingredient lines with an empty name in an otherwise-analysed recipe —
    /// what "Fix Now" offers to correct by hand. Only counted within
    /// analysed recipes: an unanalysed recipe's lines are all unfixed
    /// trivially and are already surfaced by unanalyzed_count/Sync Now.
    unfixed_count: usize,
}

/// Ingredient lines with an empty `name` belonging to a recipe that HAS been
/// analysed (non-empty `key_ingredients`) — a recipe whose analysis came
/// back incomplete (see the completeness check in `analyze_new_recipes`)
/// leaves exactly these lines behind for "Fix Now" to surface.
fn unfixed_ingredients(recipes: &[Recipe]) -> usize {
    recipes
        .iter()
        .filter(|r| !r.key_ingredients.is_empty() && !r.excluded)
        .flat_map(|r| r.ingredients.iter())
        .filter(|i| i.name.is_empty())
        .count()
}

/// Refreshes the produce cache only if the newsletter has posted a new entry
/// since last time (cheap feed GET always happens; the expensive Claude
/// extraction only runs on a cache miss). Shared by `sync_on_launch` and
/// `full_resync` so the two commands can't diverge on this part.
async fn sync_produce(
    app: &tauri::AppHandle,
    running: &State<'_, RunningChild>,
) -> Result<(ProduceResult, bool), String> {
    let _ = app.emit("status", format!("Checking {FEED_URL}..."));
    let (entry_title, entry_text, entry_html, entry_link, entry_id) =
        fetch_latest_entry(FEED_URL)?;

    let cached = load_produce_cache(app);
    let (produce, produce_from_cache) = match cached {
        Some(cache) if cache.entry_id == entry_id => {
            let _ = app.emit("status", "Using cached produce data.");
            (cache.produce, true)
        }
        _ => {
            let _ = app.emit("status", format!("Latest post: {entry_title}"));
            let _ = app.emit("status", "Identifying in-season produce...");
            let produce_prompt = build_produce_prompt(&entry_title, &entry_text);
            let produce_answer = run_claude(&produce_prompt, running, |_| {})?;
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
                app,
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
    Ok((produce, produce_from_cache))
}

fn sync_result(recipes: &[Recipe], produce: ProduceResult, produce_from_cache: bool) -> SyncResult {
    let unanalyzed_count = recipes
        .iter()
        .filter(|r| r.key_ingredients.is_empty() && !r.excluded)
        .count();
    SyncResult {
        produce,
        produce_from_cache,
        recipe_count: recipes.len(),
        unanalyzed_count,
        unfixed_count: unfixed_ingredients(recipes),
    }
}

/// Runs on app launch: syncs produce (see `sync_produce`), then diffs Mela's
/// recipe IDs against the cache and only reads rows that are new — recipes
/// already cached are trusted as-is, so an unchanged collection costs one
/// cheap ID-list query instead of a full per-recipe re-read (image decode
/// included). Edits made directly in Mela aren't picked up this way; use
/// "Resync from Mela" (`resync_recipe`) or the full-resync escape hatch
/// (`full_resync`) for that.
#[tauri::command]
async fn sync_on_launch(
    app: tauri::AppHandle,
    running: State<'_, RunningChild>,
) -> Result<SyncResult, String> {
    let (produce, produce_from_cache) = sync_produce(&app, &running).await?;

    let _ = app.emit("status", "Syncing recipes from Mela...");
    let conn = open_mela_db(&mela_db_path())?;
    let mela_ids = recipe_ids(&conn)?;
    if mela_ids.is_empty() {
        return Err(format!("No recipes found in {}", mela_db_path().display()));
    }
    let cached = load_recipes_cache(&app).unwrap_or_default();
    let (new_pks, mut recipes) = diff_recipe_ids(&mela_ids, &cached);

    let mut image_stmt = prepare_image_stmt(&conn)?;
    let mut tags_stmt = prepare_tags_stmt(&conn)?;
    let external_dir = external_data_dir(&mela_db_path());
    let images = images_dir(&app)?;
    for pk in new_pks {
        recipes.push(load_recipe(
            &conn,
            &mut image_stmt,
            &mut tags_stmt,
            &external_dir,
            &images,
            pk,
        )?);
    }

    recipes.sort_by(|a, b| a.title.cmp(&b.title));
    save_recipes_cache(&app, &recipes)?;

    let unanalyzed_count = recipes
        .iter()
        .filter(|r| r.key_ingredients.is_empty() && !r.excluded)
        .count();
    let _ = app.emit(
        "status",
        if unanalyzed_count > 0 {
            format!("{unanalyzed_count} new recipes detected.")
        } else {
            "Done.".to_string()
        },
    );
    Ok(sync_result(&recipes, produce, produce_from_cache))
}

/// Full-collection escape hatch: ignores the cache and re-reads every recipe
/// from Mela, same as `sync_on_launch` used to do unconditionally. Picks up
/// in-Mela edits across the whole collection; slow (full image
/// decode/re-encode per recipe), so it's explicit, not automatic.
#[tauri::command]
async fn full_resync(
    app: tauri::AppHandle,
    running: State<'_, RunningChild>,
) -> Result<SyncResult, String> {
    let (produce, produce_from_cache) = sync_produce(&app, &running).await?;

    let _ = app.emit("status", "Resyncing all recipes from Mela...");
    let mut recipes = load_all_recipes(&mela_db_path(), &images_dir(&app)?)?;
    if recipes.is_empty() {
        return Err(format!("No recipes found in {}", mela_db_path().display()));
    }
    // Mela stores none of `excluded`/`key_ingredients`/ingredient names, so a
    // fresh read starts them empty — without this the button would discard
    // every Claude analysis in the collection.
    let cached = load_recipes_cache(&app).unwrap_or_default();
    let cached_by_id: HashMap<&str, &Recipe> =
        cached.iter().map(|r| (r.id.as_str(), r)).collect();
    for r in recipes.iter_mut() {
        if let Some(prev) = cached_by_id.get(r.id.as_str()) {
            carry_over_local_fields(r, prev);
        }
    }
    save_recipes_cache(&app, &recipes)?;

    let _ = app.emit("status", "Done.");
    Ok(sync_result(&recipes, produce, produce_from_cache))
}

/// Re-reads a single recipe from Mela and splices it into the cache — the
/// per-recipe escape hatch for picking up an edit made directly in Mela
/// without paying for a full resync.
#[tauri::command]
fn resync_recipe(app: tauri::AppHandle, id: String) -> Result<Recipe, String> {
    let db_path = mela_db_path();
    let conn = open_mela_db(&db_path)?;
    let mela_ids = recipe_ids(&conn)?;
    let mut recipes = load_recipes_cache(&app).unwrap_or_default();

    let Some((pk, _)) = mela_ids.iter().find(|(_, mela_id)| mela_id == &id) else {
        recipes.retain(|r| r.id != id);
        save_recipes_cache(&app, &recipes)?;
        return Err("Recipe no longer exists in Mela".to_string());
    };

    let mut image_stmt = prepare_image_stmt(&conn)?;
    let mut tags_stmt = prepare_tags_stmt(&conn)?;
    let external_dir = external_data_dir(&db_path);
    let mut fresh = load_recipe(
        &conn,
        &mut image_stmt,
        &mut tags_stmt,
        &external_dir,
        &images_dir(&app)?,
        *pk,
    )?;

    match recipes.iter().position(|r| r.id == id) {
        Some(i) => {
            // See full_resync: `excluded`, `key_ingredients` and the per-line
            // names are ours, not Mela's, so a re-read must not clear them.
            carry_over_local_fields(&mut fresh, &recipes[i]);
            recipes[i] = fresh.clone();
        }
        None => recipes.push(fresh.clone()),
    }
    save_recipes_cache(&app, &recipes)?;
    Ok(fresh)
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
        .filter(|r| r.key_ingredients.is_empty() && !r.excluded)
        .cloned()
        .collect();
    if pending.is_empty() {
        return Ok(0);
    }

    let _ = app.emit(
        "status",
        format!("Analysing {} new recipes...", pending.len()),
    );
    let titles: HashMap<&str, &str> = pending
        .iter()
        .map(|r| (r.id.as_str(), r.title.as_str()))
        .collect();
    let total = pending.len();
    let mut seen = 0;
    let answer = run_claude(&build_key_ingredient_prompt(&pending), &running, |line| {
        // Each recipe block starts with its "id:" line as soon as it
        // streams back, so this fires once per recipe in the batch, in
        // order — real-time per-recipe progress without splitting the call
        // (the "id:" line arrives before that recipe's own lines, so this
        // reports the recipe now being analysed, not yet finished).
        let Some(id) = line.trim().strip_prefix("id:") else {
            return;
        };
        seen += 1;
        let title = titles.get(id.trim()).copied().unwrap_or(id.trim());
        let _ = app.emit("status", format!("Analysing {seen}/{total}: {title}"));
    })?;
    let parsed: HashMap<String, (Vec<String>, Vec<(usize, String, bool)>)> =
        parse_key_ingredient_lines(&answer)
            .into_iter()
            .map(|(id, keys, indexed)| (id, (keys, indexed)))
            .collect();
    if parsed.is_empty() {
        return Err("Claude returned no usable key ingredients".to_string());
    }

    let mut analyzed = 0;
    for recipe in recipes.iter_mut() {
        let Some((keys, indexed)) = parsed.get(&recipe.id) else {
            continue;
        };
        // Only mark the recipe done if every ingredient line came back —
        // a partial response leaves the unread lines unfixed (name: "")
        // rather than silently under-analysing the recipe.
        let complete = indexed.len() == recipe.ingredients.len()
            && (0..recipe.ingredients.len()).all(|i| indexed.iter().any(|(idx, ..)| *idx == i));
        if !complete {
            continue;
        }
        recipe.key_ingredients = keys.clone();
        for (idx, name, pantry) in indexed {
            if let Some(ing) = recipe.ingredients.get_mut(*idx) {
                ing.name = name.clone();
                ing.pantry = *pantry;
            }
        }
        analyzed += 1;
    }
    save_recipes_cache(&app, &recipes)?;

    let _ = app.emit("status", format!("Analysed {analyzed} recipes."));
    Ok(analyzed)
}

#[derive(Serialize, Clone)]
struct RankedRecipe {
    #[serde(flatten)]
    recipe: Recipe,
    /// 0.0–1.0 seasonal match rating (see `rate_recipe`), surfaced to the UI
    /// as a percentage rather than an ordinal rank.
    rating: f32,
    /// Ingredients that are this week's actual market-update picks, each
    /// paired with the produce name it matched (see `Match`).
    pick_matches: Vec<Match>,
    /// Ingredients in season per the stable seasonal table but not in this
    /// week's market update, each paired with the produce name it matched.
    seasonal_matches: Vec<Match>,
}

/// Rates cached recipes against this week's produce and the seasonal table
/// using the stored key_ingredients — no Claude call, so this is instant and
/// offline. Only analysed recipes can match; unanalysed ones rate 0 until
/// "Sync Now" runs.
#[tauri::command]
fn match_recipes(
    app: tauri::AppHandle,
    fruit: Vec<String>,
    vegetable: Vec<String>,
) -> Result<Vec<RankedRecipe>, String> {
    let market: Vec<String> = fruit.into_iter().chain(vegetable).collect();
    let seasonal = seasonal_produce(current_season());
    let recipes = load_recipes_cache(&app)
        .ok_or_else(|| "No cached recipes — sync hasn't run yet".to_string())?;
    if recipes.is_empty() {
        return Err("No recipes found in the local cache".to_string());
    }

    let mut ranked: Vec<RankedRecipe> = recipes
        .into_iter()
        .filter(|r| !r.excluded)
        .filter_map(|r| {
            let (rating, pick_matches, seasonal_matches) = rate_recipe(&r, &market, &seasonal);
            (rating > 0.0).then(|| RankedRecipe {
                recipe: r,
                rating,
                pick_matches,
                seasonal_matches,
            })
        })
        .collect();
    // Highest rating first, ties broken by title so the order is stable.
    ranked.sort_by(|a, b| {
        b.rating
            .partial_cmp(&a.rating)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.recipe.title.cmp(&b.recipe.title))
    });

    let _ = app.emit("status", format!("{} recipes match.", ranked.len()));
    Ok(ranked)
}

#[tauri::command]
fn list_recipes(app: tauri::AppHandle) -> Result<Vec<Recipe>, String> {
    Ok(load_recipes_cache(&app).unwrap_or_default())
}

#[derive(Serialize, Clone)]
struct SeasonalInfo {
    season: &'static str,
    produce: Vec<String>,
}

/// The stable seasonal-table produce that's in season right now, for the
/// "In Season" tab's second list (the market update is the first). Depends
/// only on the calendar, so it's a cheap standalone command.
#[tauri::command]
fn seasonal_in_season() -> SeasonalInfo {
    let season = current_season();
    SeasonalInfo {
        season: match season {
            SUMMER => "Summer",
            AUTUMN => "Autumn",
            WINTER => "Winter",
            _ => "Spring",
        },
        produce: seasonal_produce(season),
    }
}

/// Fixes an unanalysed ingredient line by hand — the "Fix Now" queue.
/// Clears every ingredient across the whole collection whose `display` is
/// byte-identical to `display` (not just the one row the user was looking
/// at), since Mela repeats the same line verbatim across many recipes
/// ("1 tsp salt") and fixing them one at a time would mean re-typing the
/// same name dozens of times.
#[tauri::command]
fn set_ingredient_name(
    app: tauri::AppHandle,
    display: String,
    name: String,
    pantry: bool,
) -> Result<Vec<Recipe>, String> {
    let name = name.trim().to_lowercase();
    if name.is_empty() {
        return Err("Name can't be empty".to_string());
    }
    let mut recipes = load_recipes_cache(&app)
        .ok_or_else(|| "No cached recipes — sync hasn't run yet".to_string())?;
    for recipe in recipes.iter_mut() {
        for ing in recipe.ingredients.iter_mut() {
            if ing.display == display {
                ing.name = name.clone();
                ing.pantry = pantry;
            }
        }
    }
    save_recipes_cache(&app, &recipes)?;
    Ok(recipes)
}

/// Marks a recipe as never-match (or un-marks it) — for recipes with no
/// seasonal-produce story at all, like a vegan cheese sauce. Returns the
/// updated cache so the frontend can re-derive its counts without a resync.
#[tauri::command]
fn set_excluded(
    app: tauri::AppHandle,
    id: String,
    excluded: bool,
) -> Result<Vec<Recipe>, String> {
    let mut recipes = load_recipes_cache(&app)
        .ok_or_else(|| "No cached recipes — sync hasn't run yet".to_string())?;
    let Some(recipe) = recipes.iter_mut().find(|r| r.id == id) else {
        return Err("Recipe not found in the local cache".to_string());
    };
    recipe.excluded = excluded;
    save_recipes_cache(&app, &recipes)?;
    Ok(recipes)
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

    fn encode(format: image::ImageFormat) -> Vec<u8> {
        let img = image::RgbImage::from_pixel(4, 4, image::Rgb([200, 50, 10]));
        let mut bytes = Vec::new();
        image::DynamicImage::ImageRgb8(img)
            .write_to(&mut std::io::Cursor::new(&mut bytes), format)
            .unwrap();
        bytes
    }

    #[test]
    fn sniffs_known_image_formats_to_their_extension() {
        for (format, ext) in [
            (image::ImageFormat::Jpeg, "jpg"),
            (image::ImageFormat::Png, "png"),
            (image::ImageFormat::WebP, "webp"),
            (image::ImageFormat::Tiff, "tiff"),
        ] {
            assert_eq!(image_extension(&encode(format)), Some(ext), "format {format:?}");
        }
        // HEIC is stored as-is and rendered by the system codec — the `image`
        // crate can't decode it, which is why nothing is transcoded here.
        assert_eq!(image_extension(b"1234ftypheicrest"), Some("heic"));
        assert_eq!(image_extension(b"not an image"), None);
    }

    #[test]
    fn cover_images_are_written_inside_the_images_dir() {
        let dir = std::env::temp_dir().join(format!("recipeapp-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);

        let path = write_cover_image(&dir, "ABC-123", "jpg", b"bytes").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"bytes");

        // A separator in the ID must not escape the directory.
        let escaped = write_cover_image(&dir, "../../evil", "jpg", b"x").unwrap();
        assert_eq!(std::path::Path::new(&escaped).parent(), Some(dir.as_path()));

        let _ = std::fs::remove_dir_all(&dir);
    }

    // A resync reads from Mela, which stores none of this — so if the
    // carry-over stops working the user loses every Claude call they've paid
    // for, silently, on one button press. That's what this pins.
    #[test]
    fn a_resync_keeps_analysis_that_mela_does_not_store() {
        let cached = Recipe {
            id: "r1".into(),
            title: "Fig Salad".into(),
            description: String::new(),
            ingredients: vec![
                Ingredient { display: "3 figs".into(), name: "fig".into(), pantry: false },
                Ingredient { display: "1 tsp salt".into(), name: "salt".into(), pantry: true },
            ],
            favorite: false,
            total_time: String::new(),
            yield_: String::new(),
            image: String::new(),
            tags: vec![],
            key_ingredients: vec!["fig".into()],
            excluded: true,
        };
        // What load_recipe returns: Mela's fields only, the rest empty.
        let mut fresh = Recipe {
            ingredients: vec![
                Ingredient { display: "3 figs".into(), name: String::new(), pantry: false },
                // Reordered + a new line, to prove matching is by display and
                // not by position.
                Ingredient { display: "1 lemon".into(), name: String::new(), pantry: false },
                Ingredient { display: "1 tsp salt".into(), name: String::new(), pantry: false },
            ],
            key_ingredients: vec![],
            excluded: false,
            ..cached.clone()
        };

        carry_over_local_fields(&mut fresh, &cached);

        assert_eq!(fresh.key_ingredients, vec!["fig".to_string()]);
        assert!(fresh.excluded);
        assert_eq!(fresh.ingredients[0].name, "fig");
        assert_eq!(fresh.ingredients[2].name, "salt");
        assert!(fresh.ingredients[2].pantry, "pantry flag must survive too");
        // Genuinely new line stays unanalysed rather than inheriting a
        // neighbour's name.
        assert_eq!(fresh.ingredients[1].name, "");
    }

    #[test]
    fn external_storage_uuid_matches_only_the_marker_shape() {
        let marker = b"\x022783EB62-CCAF-4A7F-9988-16E62506BD66\x00";
        assert_eq!(
            external_storage_uuid(marker),
            Some("2783EB62-CCAF-4A7F-9988-16E62506BD66")
        );
        assert_eq!(external_storage_uuid(b"\x01\xFF\xD8\xFFrest"), None);
        assert_eq!(external_storage_uuid(b"no marker at all"), None);
    }

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
            ingredients: vec![
                ing("figs", "fig", false),
                ing("goat cheese", "goat cheese", true),
            ],
            favorite: true,
            total_time: "25min".into(),
            yield_: "2".into(),
            image: "/tmp/images/abc.jpg".into(),
            tags: vec!["Salads".into()],
            key_ingredients: vec!["figs".into()],
            excluded: true,
        }];
        let json = serde_json::to_string(&recipes).unwrap();
        let parsed: Vec<Recipe> = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].title, "Fig Salad");
        assert_eq!(parsed[0].ingredients.len(), 2);
        assert_eq!(parsed[0].ingredients[0].display, "figs");
        assert_eq!(parsed[0].ingredients[0].name, "fig");
        assert!(parsed[0].ingredients[1].pantry);
        assert!(parsed[0].favorite);
        assert_eq!(parsed[0].total_time, "25min");
        assert_eq!(parsed[0].yield_, "2");
        assert_eq!(parsed[0].image, "/tmp/images/abc.jpg");
        assert_eq!(parsed[0].tags, vec!["Salads".to_string()]);
        assert_eq!(parsed[0].key_ingredients, vec!["figs".to_string()]);
        assert!(parsed[0].excluded);
    }

    // A recipes.json written before `excluded` existed must still load.
    #[test]
    fn recipe_without_excluded_field_defaults_to_included() {
        let json = r#"[{"id":"a","title":"T","description":"","ingredients":[]}]"#;
        let parsed: Vec<Recipe> = serde_json::from_str(json).unwrap();
        assert!(!parsed[0].excluded);
    }

    fn ing(display: &str, name: &str, pantry: bool) -> Ingredient {
        Ingredient {
            display: display.into(),
            name: name.into(),
            pantry,
        }
    }

    fn unfixed(display: &str) -> Ingredient {
        ing(display, "", false)
    }

    /// The ingredient names out of a match list. Most rating tests only care
    /// which ingredients matched; the ones that care *which produce name* they
    /// matched assert on the `Match` directly.
    fn names(matches: &[Match]) -> Vec<&str> {
        matches.iter().map(|m| m.ingredient.as_str()).collect()
    }

    fn recipe(id: &str, title: &str, keys: &[&str]) -> Recipe {
        Recipe {
            id: id.into(),
            title: title.into(),
            description: String::new(),
            ingredients: Vec::new(),
            favorite: false,
            total_time: String::new(),
            yield_: String::new(),
            image: String::new(),
            tags: Vec::new(),
            key_ingredients: keys.iter().map(|k| k.to_string()).collect(),
            excluded: false,
        }
    }

    #[test]
    fn parses_key_and_indexed_lines_and_skips_commentary() {
        let answer = "Here are the results:\n\
                      id: abc\n\
                      key: Asparagus, Tofu\n\
                      0 => asparagus => produce\n\
                      1 => tofu => pantry\n\
                      that's everything!\n\
                      id: def\n\
                      key: fig, goat cheese\n\
                      0 => fig => produce\n\
                      1 => goat cheese => pantry";
        let parsed = parse_key_ingredient_lines(answer);
        assert_eq!(parsed.len(), 2);
        let (id, keys, indexed) = &parsed[0];
        assert_eq!(id, "abc");
        // Lowercased so scoring can compare against produce names directly.
        assert_eq!(keys, &vec!["asparagus", "tofu"]);
        assert_eq!(indexed, &vec![(0, "asparagus".to_string(), false), (1, "tofu".to_string(), true)]);
        assert_eq!(parsed[1].0, "def");
    }

    // A line naming two ingredients ("salt and pepper") must not be split —
    // the index-completeness check depends on a strict 1:1 line mapping.
    #[test]
    fn parses_a_comma_in_the_name_without_splitting_it() {
        let answer = "id: abc\nkey: salt\n0 => salt, pepper => pantry";
        let parsed = parse_key_ingredient_lines(answer);
        assert_eq!(parsed[0].2, vec![(0, "salt, pepper".to_string(), true)]);
    }

    // The whole point of the redesign: a recipe built around in-season
    // produce must outrate one that merely garnishes with it.
    #[test]
    fn defining_ingredient_outrates_garnish() {
        let produce = vec!["asparagus".to_string()];
        let star = recipe("a", "Asparagus Stir Fry", &["asparagus", "tofu"]);
        let garnish = recipe("b", "Beef Pie", &["beef", "pastry", "asparagus"]);
        let (star_rating, picks, _) = rate_recipe(&star, &produce, &[]);
        let (garnish_rating, ..) = rate_recipe(&garnish, &produce, &[]);
        assert!(star_rating > garnish_rating);
        assert_eq!(names(&picks), vec!["asparagus"]);
    }

    // A market-update pick must outrate a seasonal-table-only hit: same key
    // ingredient rank, but the live pick is weighted higher.
    #[test]
    fn market_pick_outrates_seasonal_only() {
        let star = recipe("a", "Asparagus Stir Fry", &["asparagus"]);
        let (pick_rating, picks, seasonal) =
            rate_recipe(&star, &["asparagus".to_string()], &["asparagus".to_string()]);
        let (seasonal_rating, picks2, seasonal2) =
            rate_recipe(&star, &[], &["asparagus".to_string()]);
        assert!(pick_rating > seasonal_rating);
        assert_eq!(names(&picks), vec!["asparagus"]);
        assert!(seasonal.is_empty()); // market hit wins, not double-counted
        assert!(picks2.is_empty());
        assert_eq!(names(&seasonal2), vec!["asparagus"]);
    }

    // Each match carries the produce name it hit, not just the recipe's own
    // ingredient name. The two differ whenever produce_matches accepts a pair
    // that isn't byte-identical — a plural here — and the In Season tiles
    // filter on the produce side. Returning only the ingredient name forced
    // the frontend to re-derive this comparison, and its exact-string
    // stand-in showed "no recipes" for produce that plainly matched.
    #[test]
    fn a_match_carries_both_the_ingredient_and_the_produce_name() {
        let r = recipe("a", "Roast Sprouts", &["brussels sprouts"]);
        let (_, picks, _) = rate_recipe(&r, &["brussels sprout".to_string()], &[]);
        assert_eq!(
            picks,
            vec![Match::new("brussels sprouts", "brussels sprout")]
        );
    }

    // A perfect market match rates 1.0; no hit at all rates 0.0.
    #[test]
    fn rating_is_normalised_zero_to_one() {
        let r = recipe("a", "Asparagus", &["asparagus"]);
        assert_eq!(rate_recipe(&r, &["asparagus".to_string()], &[]).0, 1.0);
        assert_eq!(rate_recipe(&r, &[], &[]).0, 0.0);
    }

    // The seasonal table is keyed by an AU season bitmask; a winter query
    // must surface winter produce and exclude summer-only produce.
    #[test]
    fn seasonal_produce_filters_by_season() {
        let winter = seasonal_produce(WINTER);
        assert!(winter.contains(&"kale".to_string())); // winter-only
        assert!(winter.contains(&"broccoli".to_string())); // multi-season incl. winter
        assert!(!winter.contains(&"asparagus".to_string())); // spring/summer only
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

        // Flipped from the original soft-spot assertion once a real recipe
        // ("Avocado-Black Bean Tostadas") actually ranked on "corn" ==
        // "corn tortillas" — see NOT_A_PRODUCE_FORM.
        assert!(!produce_matches("apple", "apple cider vinegar"));
        assert!(!produce_matches("corn", "corn tortillas"));
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

    // Mela's "# SECTION" header lines and blank lines are dropped at parse
    // time, not by every reader downstream.
    #[test]
    fn parse_ingredient_lines_skips_headers_and_blanks() {
        let parsed = parse_ingredient_lines("# FILLING\n2 cloves garlic\n\n1 Tbsp olive oil\n");
        assert_eq!(
            parsed.iter().map(|i| i.display.as_str()).collect::<Vec<_>>(),
            vec!["2 cloves garlic", "1 Tbsp olive oil"]
        );
        assert!(parsed.iter().all(|i| i.name.is_empty() && !i.pantry));
    }

    // Fix Now only needs to surface lines in recipes that came back
    // incomplete — an unanalysed recipe's lines are all unfixed trivially
    // and are already covered by the Sync Now banner, so they must not
    // double-count here.
    #[test]
    fn unfixed_ingredients_only_counts_within_analysed_recipes() {
        let mut analysed = recipe("a", "Salad", &["fig"]);
        analysed.ingredients = vec![ing("figs", "fig", false), unfixed("mystery leaf")];
        let unanalysed = recipe("b", "New Recipe", &[]);
        // unanalysed has empty ingredients here, but even with lines it
        // shouldn't count — key_ingredients being empty excludes it.
        let mut unanalysed = unanalysed;
        unanalysed.ingredients = vec![unfixed("2 tbsp mystery sauce")];

        assert_eq!(unfixed_ingredients(&[analysed, unanalysed]), 1);
    }

    // A pantry key ingredient can never be in season, so it must not sit in
    // the denominator dragging the rating down. Cauliflower soup: both
    // vegetables match (one seasonal, one pick), cream can't — that should
    // read as a strong match, not the 48% it scored when cream counted.
    #[test]
    fn pantry_key_ingredients_are_left_out_of_the_denominator() {
        let mut soup = recipe("a", "Cauliflower Soup", &["cauliflower", "potato", "cream"]);
        soup.ingredients = vec![
            ing("1 head cauliflower", "cauliflower", false),
            ing("2 potatoes", "potato", false),
            ing("100ml cream", "cream", true),
        ];
        let (rating, picks, seasonal) = rate_recipe(
            &soup,
            &["potato".to_string()],
            &["cauliflower".to_string()],
        );
        assert_eq!(names(&picks), vec!["potato"]);
        assert_eq!(names(&seasonal), vec!["cauliflower"]);
        // cauliflower 4*1 + potato 3*3 = 13, over (4+3)*3 = 21 with cream out.
        assert!((rating - 13.0 / 21.0).abs() < 1e-6, "rating was {rating}");
    }

    // A pantry key ingredient whose name collides with in-season produce must
    // not score either — dropping it from the denominator alone let the
    // numerator run past it and rated Pasta alla Norma 108%.
    #[test]
    fn a_matching_pantry_key_ingredient_cannot_push_the_rating_past_one() {
        let mut norma = recipe("a", "Pasta alla Norma", &["eggplant", "tomato", "basil"]);
        norma.ingredients = vec![
            ing("1 eggplant", "eggplant", false),
            ing("400g tomatoes", "tomato", false),
            ing("dried basil", "basil", true), // pantry, but in the produce table
        ];
        let market = vec![
            "eggplant".to_string(),
            "tomato".to_string(),
            "basil".to_string(),
        ];
        let (rating, picks, _) = rate_recipe(&norma, &market, &[]);
        assert_eq!(rating, 1.0, "every produce key ingredient is a pick");
        assert_eq!(names(&picks), vec!["eggplant", "tomato"]); // basil is not a match
    }

    // Produce outside the key list still counts. The noodle salad's only
    // produce key ingredient is cucumber (udon and tahini are pantry), so
    // scoring the key list alone made its rating two-valued: 100% or 0%.
    #[test]
    fn supporting_produce_counts_but_cannot_outweigh_a_defining_ingredient() {
        let mut salad = recipe(
            "a",
            "Creamy Sesame Noodle Salad",
            &["udon noodles", "cucumber", "tahini"],
        );
        salad.ingredients = vec![
            ing("8 oz udon noodles", "udon noodles", true),
            ing("1 large cucumber", "cucumber", false),
            ing("1/2 cup green onion", "green onion", false),
            ing("1/2 cup cilantro", "cilantro", false),
            ing("3 Tbsp tahini", "tahini", true),
            ing("1 Tbsp minced ginger", "ginger", false),
        ];

        // Cucumber alone no longer buys a perfect score: the three
        // supporting produce lines are in the denominator now.
        let (cucumber_only, ..) = rate_recipe(&salad, &["cucumber".to_string()], &[]);
        assert!(
            cucumber_only < 1.0,
            "one key match shouldn't rate 100% with 3 unmatched produce lines, got {cucumber_only}"
        );
        // cucumber 3*3=9 over 9 + three supporting slots at 2 = 15.
        assert!((cucumber_only - 9.0 / 15.0).abs() < 1e-6, "got {cucumber_only}");

        // ...and supporting produce alone rates lower than the defining one.
        let (supporting_only, _, seasonal) = rate_recipe(
            &salad,
            &[],
            &["green onion".to_string(), "cilantro".to_string()],
        );
        assert!(
            supporting_only < cucumber_only,
            "supporting {supporting_only} should trail defining {cucumber_only}"
        );
        assert_eq!(names(&seasonal), vec!["green onion", "cilantro"]);
    }

    // Supporting produce earns 3 on a pick but only costs 2, so a recipe made
    // entirely of matching supporting produce scores past its denominator.
    // The clamp is what keeps the UI's percentage honest.
    #[test]
    fn supporting_produce_cannot_rate_above_one() {
        let mut r = recipe("a", "Aromatics", &["stock"]);
        r.ingredients = vec![
            ing("stock", "stock", true), // pantry: no key slot in the denominator
            ing("garlic", "garlic", false),
            ing("onion", "onion", false),
        ];
        let market = vec!["garlic".to_string(), "onion".to_string()];
        let (rating, ..) = rate_recipe(&r, &market, &[]);
        assert_eq!(rating, 1.0, "6/4 must clamp, not report 150%");
    }

    #[test]
    fn recipe_with_no_matching_key_ingredient_rates_zero() {
        let (rating, picks, seasonal) = rate_recipe(
            &recipe("a", "Beef Pie", &["beef", "pastry"]),
            &["asparagus".to_string()],
            &[],
        );
        assert_eq!(rating, 0.0);
        assert!(picks.is_empty());
        assert!(seasonal.is_empty());
    }

    // A launch resync must not wipe analysis: an id already in the cache is
    // reused as-is (no re-read), a genuinely new id is queued for
    // load_recipe so "Sync Now" can pick it up unanalysed.
    #[test]
    fn diff_keeps_cached_recipes_and_queues_only_new_ids() {
        let mut analysed = recipe("a", "Asparagus Stir Fry", &["asparagus", "tofu"]);
        analysed.ingredients = vec![ing("asparagus", "asparagus", false), ing("tofu", "tofu", false)];
        let cached = vec![analysed];

        let mela_ids = vec![(1, "a".to_string()), (2, "b".to_string())];
        let (new_pks, kept) = diff_recipe_ids(&mela_ids, &cached);

        assert_eq!(new_pks, vec![2]);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].key_ingredients, vec!["asparagus", "tofu"]);
        assert_eq!(kept[0].ingredients[0].name, "asparagus");
    }

    // A recipe removed from Mela must not survive the diff into the merged
    // cache, even though it's still present in the old cached list.
    #[test]
    fn diff_drops_recipes_no_longer_in_mela() {
        let cached = vec![recipe("a", "Salad", &[]), recipe("b", "Soup", &[])];
        let mela_ids = vec![(1, "a".to_string())]; // "b" deleted in Mela

        let (new_pks, kept) = diff_recipe_ids(&mela_ids, &cached);
        assert!(new_pks.is_empty());
        assert_eq!(kept.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), vec!["a"]);
    }

    // A recipes.json written before favorite/total_time/yield existed must
    // still load rather than failing the whole cache read.
    #[test]
    fn recipes_cache_loads_pre_metadata_json() {
        let json = r#"[{"id":"abc","title":"Fig Salad","description":"A salad","ingredients":[{"display":"figs"}]}]"#;
        let parsed: Vec<Recipe> = serde_json::from_str(json).unwrap();
        assert_eq!(parsed[0].title, "Fig Salad");
        assert!(!parsed[0].favorite);
        assert_eq!(parsed[0].total_time, "");
        assert_eq!(parsed[0].ingredients[0].display, "figs");
        assert_eq!(parsed[0].ingredients[0].name, "");
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
            full_resync,
            resync_recipe,
            analyze_new_recipes,
            match_recipes,
            list_recipes,
            seasonal_in_season,
            set_ingredient_name,
            set_excluded,
            cancel,
            open_recipe,
            open_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
