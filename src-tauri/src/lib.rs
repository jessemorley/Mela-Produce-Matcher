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

fn build_produce_prompt(entry_title: &str, entry_text: &str) -> String {
    format!(
        "Here is this week's seasonal produce newsletter, \"{entry_title}\":\n\n\
        {entry_text}\n\n\
        List the in-season produce items it mentions (fruits, vegetables, herbs —\n\
        not brands, regions, or recipes) as a single comma-separated line, singular\n\
        form, nothing else. Example: apple, capsicum, corn, avocado, blueberry"
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
fn run_claude(prompt: &str, mut on_line: impl FnMut(&str)) -> Result<String, String> {
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

#[derive(Serialize, Clone)]
struct SuggestResult {
    recipe_count: usize,
    candidate_count: usize,
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

    let _ = app.emit("status", "Identifying in-season produce...");
    let produce_prompt = build_produce_prompt(&entry_title, &entry_text);
    let produce_answer = run_claude(&produce_prompt, |_| {})?;
    let produce: Vec<String> = produce_answer
        .trim()
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if produce.is_empty() {
        return Err("Could not identify any produce in the newsletter".to_string());
    }
    let _ = app.emit("status", format!("In season: {}", produce.join(", ")));

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
    let ranking_prompt = build_ranking_prompt(&candidate_recipes, &produce, &entry_title);
    run_claude(&ranking_prompt, |line| {
        let _ = app.emit("suggestion-line", line);
    })?;

    let _ = app.emit("status", "Done.");
    Ok(SuggestResult {
        recipe_count: recipes.len(),
        candidate_count: candidate_recipes.len(),
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
