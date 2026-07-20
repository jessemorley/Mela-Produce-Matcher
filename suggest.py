#!/usr/bin/env python3
"""Suggest Mela recipes that use this week's seasonal produce.

Reads recipes straight from Mela's local database (read-only, safe to run
while Mela is open) and asks Claude to match them against the latest post on
Dave's Market Update, pulled from its Shopify-generated Atom feed.

Runs the suggestion through the `claude` CLI (Claude Code), so it uses your
Pro/Max subscription login rather than a metered API key.

Usage:
    python3 suggest.py
    python3 suggest.py --feed-url <other-shopify-blog>.atom
    python3 suggest.py --dry-run   # preview data pulled, skip the claude call
"""
import argparse
import os
import re
import sqlite3
import subprocess
import sys
import urllib.request
import xml.etree.ElementTree as ET

MELA_DB = os.path.expanduser(
    "~/Library/Group Containers/66JC38RDUD.recipes.mela/Data/Curcuma.sqlite"
)
DEFAULT_FEED_URL = "https://www.harrisfarm.com.au/blogs/daves-market-update.atom"
ATOM_NS = {"a": "http://www.w3.org/2005/Atom"}
MODEL = "sonnet"


def fetch_latest_entry(feed_url: str) -> tuple[str, str]:
    req = urllib.request.Request(feed_url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        root = ET.fromstring(resp.read())
    entry = root.find("a:entry", ATOM_NS)
    if entry is None:
        sys.exit(f"No entries found in feed {feed_url}")
    title = entry.findtext("a:title", default="", namespaces=ATOM_NS)
    content_html = entry.findtext("a:content", default="", namespaces=ATOM_NS)
    text = re.sub(r"<[^>]+>", " ", content_html)
    text = re.sub(r"\s+", " ", text).strip()
    return title, text


def load_recipes(db_path: str) -> list[dict]:
    # mode=ro opens a second reader connection; safe alongside Mela's own
    # open connection even when its WAL file is active.
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        "SELECT Z_PK AS id, ZTITLE AS title, ZINGREDIENTS AS ingredients "
        "FROM ZRECIPEOBJECT WHERE ZTITLE IS NOT NULL ORDER BY ZTITLE"
    ).fetchall()
    con.close()
    return [dict(r) for r in rows]


def build_prompt(recipes: list[dict], entry_title: str, entry_text: str) -> str:
    recipe_lines = "\n".join(
        f"- [{r['id']}] {r['title']}: {(r['ingredients'] or '').replace(chr(10), '; ')}"
        for r in recipes
    )
    return f"""Here is a home cook's recipe collection (id, title, ingredients):

{recipe_lines}

Here is this week's seasonal produce newsletter, "{entry_title}":

{entry_text}

First, extract the list of in-season produce mentioned in the newsletter.
Then find recipes from the collection that use that produce, and rank them
from best fit to weakest fit — do not group by produce item, order the
whole list purely by how well each recipe matches what's in season right
now. Only include genuine matches. Output each one as a single line in
exactly this format:

N. **Recipe Title** — matches: ingredient, ingredient — fit: one-line reason"""


BOLD, DIM, GREEN, CYAN, RESET = "\033[1m", "\033[2m", "\033[32m", "\033[36m", "\033[0m"


def colorize(line: str) -> str:
    line = re.sub(r"\*\*(.+?)\*\*", rf"{BOLD}\1{RESET}", line)
    line = re.sub(r"^\d+\.", lambda m: f"{GREEN}{m.group(0)}{RESET}", line)
    line = re.sub(r"\bfit:", f"{CYAN}fit:{RESET}", line)
    return line


def ask_claude(prompt: str) -> None:
    use_color = sys.stdout.isatty()
    proc = subprocess.Popen(
        ["claude", "-p", "--model", MODEL],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    proc.stdin.write(prompt)
    proc.stdin.close()
    for line in proc.stdout:
        line = line.rstrip("\n")
        print(colorize(line) if use_color else line)
    proc.wait()
    if proc.returncode != 0:
        sys.exit(f"claude CLI failed (exit {proc.returncode})")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--feed-url", default=DEFAULT_FEED_URL, help="Atom feed URL to pull the latest post from")
    parser.add_argument("--db", default=MELA_DB, help="path to Mela's Curcuma.sqlite")
    parser.add_argument("--dry-run", action="store_true", help="skip the claude call, just show what would be sent")
    args = parser.parse_args()

    def status(msg: str) -> None:
        print(msg, file=sys.stderr, flush=True)

    status("Loading recipes from Mela...")
    recipes = load_recipes(args.db)
    if not recipes:
        sys.exit(f"No recipes found in {args.db}")
    status(f"  loaded {len(recipes)} recipes")

    status(f"Fetching latest post from {args.feed_url}...")
    entry_title, entry_text = fetch_latest_entry(args.feed_url)
    status(f"  latest post: {entry_title!r}")
    prompt = build_prompt(recipes, entry_title, entry_text)

    if args.dry_run:
        print(f"Loaded {len(recipes)} recipes from {args.db}")
        print(f"Latest entry: {entry_title!r} ({len(entry_text)} chars) from {args.feed_url}")
        print("\n--- prompt preview (first 2000 chars) ---")
        print(prompt[:2000])
        return

    status("Asking Claude for suggestions (this can take a minute)...")
    ask_claude(prompt)


if __name__ == "__main__":
    main()
