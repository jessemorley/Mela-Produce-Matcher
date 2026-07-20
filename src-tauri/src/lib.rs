use rusqlite::Connection;
use serde::Serialize;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::Emitter;
use tauri_plugin_opener::OpenerExt;

const DEFAULT_FEED_URL: &str = "https://www.harrisfarm.com.au/blogs/daves-market-update.atom";
const CLAUDE_MODEL: &str = "sonnet";

#[derive(Serialize, Clone)]
struct Recipe {
    id: String,
    title: String,
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
            "SELECT ZID, ZTITLE, ZINGREDIENTS FROM ZRECIPEOBJECT \
             WHERE ZTITLE IS NOT NULL ORDER BY ZTITLE",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Recipe {
                id: row.get::<_, Option<String>>(0)?.unwrap_or_default(),
                title: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                ingredients: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
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

fn fetch_latest_entry(feed_url: &str) -> Result<(String, String), String> {
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
    let content_html = extract_tag(entry_xml, "content");
    Ok((title, strip_tags(&content_html)))
}

fn build_prompt(recipes: &[Recipe], entry_title: &str, entry_text: &str) -> String {
    let recipe_lines = recipes
        .iter()
        .map(|r| {
            format!(
                "- [{}] {}: {}",
                r.id,
                r.title,
                r.ingredients.replace('\n', "; ")
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "Here is a home cook's recipe collection (id, title, ingredients):\n\n\
        {recipe_lines}\n\n\
        Here is this week's seasonal produce newsletter, \"{entry_title}\":\n\n\
        {entry_text}\n\n\
        First, extract the list of in-season produce mentioned in the newsletter.\n\
        Then find recipes from the collection that use that produce, and rank them\n\
        from best fit to weakest fit — do not group by produce item, order the\n\
        whole list purely by how well each recipe matches what's in season right\n\
        now. Only include genuine matches. Output each one as a single line in\n\
        exactly this format:\n\n\
        N. **Recipe Title** — id: RECIPE_ID — matches: ingredient, ingredient — fit: one-line reason"
    )
}

#[derive(Serialize, Clone)]
struct SuggestResult {
    recipe_count: usize,
    feed_title: String,
}

#[tauri::command]
async fn suggest(app: tauri::AppHandle, feed_url: Option<String>) -> Result<SuggestResult, String> {
    let feed_url = feed_url.unwrap_or_else(|| DEFAULT_FEED_URL.to_string());

    let _ = app.emit("status", "Loading recipes from Mela...");
    let db_path = mela_db_path();
    let recipes = load_recipes(&db_path)?;
    if recipes.is_empty() {
        return Err(format!("No recipes found in {}", db_path.display()));
    }
    let _ = app.emit("status", format!("Loaded {} recipes", recipes.len()));

    let _ = app.emit("status", format!("Fetching latest post from {feed_url}..."));
    let (entry_title, entry_text) = fetch_latest_entry(&feed_url)?;
    let _ = app.emit("status", format!("Latest post: {entry_title}"));

    let prompt = build_prompt(&recipes, &entry_title, &entry_text);

    let _ = app.emit("status", "Asking Claude for suggestions (this can take a minute)...");
    let mut child = Command::new("claude")
        .args(["-p", "--model", CLAUDE_MODEL])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to launch claude CLI: {e}"))?;

    child
        .stdin
        .take()
        .expect("stdin piped")
        .write_all(prompt.as_bytes())
        .map_err(|e| e.to_string())?;

    let stdout = child.stdout.take().expect("stdout piped");
    for line in BufReader::new(stdout).lines() {
        let line = line.map_err(|e| e.to_string())?;
        let _ = app.emit("suggestion-line", line);
    }

    let status = child.wait().map_err(|e| e.to_string())?;
    if !status.success() {
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

    let _ = app.emit("status", "Done.");
    Ok(SuggestResult {
        recipe_count: recipes.len(),
        feed_title: entry_title,
    })
}

#[tauri::command]
fn open_recipe(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let url = format!("mela://recipe/{id}");
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![suggest, open_recipe])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
