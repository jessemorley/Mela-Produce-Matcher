use rusqlite::Connection;
use serde::Serialize;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use tauri::{Emitter, State};
use tauri_plugin_opener::OpenerExt;

const FEED_URL: &str = "https://www.harrisfarm.com.au/blogs/daves-market-update.atom";
const CLAUDE_MODEL: &str = "sonnet";
const CANCELLED: &str = "cancelled";

#[derive(Default)]
struct RunningChild(Mutex<Option<u32>>);

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

// Atom <link href="..."/> is self-closing, so extract_tag can't see it.
fn extract_link_href(entry_xml: &str) -> String {
    let Some(start) = entry_xml.find("<link") else { return String::new() };
    let rest = &entry_xml[start..];
    let Some(href) = rest.find("href=\"") else { return String::new() };
    let val = &rest[href + 6..];
    val.find('"').map(|end| val[..end].to_string()).unwrap_or_default()
}

fn fetch_latest_entry(feed_url: &str) -> Result<(String, String, String, String), String> {
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
    Ok((title, strip_tags(&content_html), content_html, link))
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

#[derive(Serialize, Clone)]
struct ProduceResult {
    feed_title: String,
    feed_link: String,
    feed_html: String,
    fruit: Vec<String>,
    vegetable: Vec<String>,
    pick: Vec<String>,
    featured: Vec<String>,
}

#[tauri::command]
async fn fetch_produce(
    app: tauri::AppHandle,
    running: State<'_, RunningChild>,
) -> Result<ProduceResult, String> {
    let _ = app.emit("status", format!("Fetching latest post from {FEED_URL}..."));
    let (entry_title, entry_text, entry_html, entry_link) = fetch_latest_entry(FEED_URL)?;
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
    let _ = app.emit("status", "Done.");
    let _ = app.emit(
        "produce",
        serde_json::json!({
            "fruit": &fruit,
            "vegetable": &vegetable,
            "pick": &pick,
            "featured": &featured,
        }),
    );

    Ok(ProduceResult {
        feed_title: entry_title,
        feed_link: entry_link,
        feed_html: entry_html,
        fruit,
        vegetable,
        pick,
        featured,
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
    let _ = app.emit("status", "Loading recipes from Mela...");
    let db_path = mela_db_path();
    let recipes = load_recipes(&db_path)?;
    if recipes.is_empty() {
        return Err(format!("No recipes found in {}", db_path.display()));
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(RunningChild::default())
        .invoke_handler(tauri::generate_handler![
            fetch_produce,
            match_recipes,
            cancel,
            open_recipe,
            open_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
