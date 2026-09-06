#!/usr/bin/env python3
"""Refresh the live figures from the GitHub API.

The page must not be a snapshot that quietly goes stale. This pulls the numbers that change
on their own — star counts, the repository list, and the merged/open/closed split of upstream
pull requests — and writes them to data/live.json. build.py prefers those values over the
frozen research snapshot, so a scheduled run keeps the site current without a human editing
anything.

What it deliberately does NOT touch: the hand-verified prose in data/research.json. Those
descriptions came from reading each repository, and regenerating them from an API blurb would
make the page worse, not fresher. A repository that appears after the last research pass shows
up with its own GitHub description and is listed for enrichment.

Usage:  python refresh.py            (needs `gh` authenticated, or GH_TOKEN in the environment)
"""

import json
import os
import pathlib
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).parent
OUT = ROOT / "data" / "live.json"
RESEARCH = ROOT / "data" / "research.json"
USER = "amasen02"
API = "https://api.github.com"


def api(path, params=None):
    """One authenticated GET. Uses GH_TOKEN when present, else the gh CLI's own auth."""
    url = f"{API}{path}"
    if params:
        url += "?" + "&".join(f"{k}={v}" for k, v in params.items())
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if token:
        req = urllib.request.Request(url, headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "amasen02-portfolio-refresh",
        })
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    # Local runs fall back to the gh CLI so no token has to be handled here.
    # Decode as UTF-8 explicitly: the default on Windows is the ANSI codepage, which throws
    # on the non-ASCII characters that appear in real repository descriptions.
    out = subprocess.run(["gh", "api", url.replace(API + "/", "")],
                         capture_output=True, text=True, check=True,
                         encoding="utf-8", errors="replace")
    return json.loads(out.stdout)


def fetch_repos():
    repos, page = [], 1
    while True:
        batch = api(f"/users/{USER}/repos", {"per_page": "100", "page": str(page), "type": "owner"})
        if not batch:
            break
        repos.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    return [r for r in repos if not r["fork"] and not r["private"]]


def fetch_prs():
    """Every pull request the user opened in a repository they do not own."""
    items, page = [], 1
    while page <= 5:
        data = api("/search/issues", {
            "q": f"type:pr+author:{USER}+-user:{USER}",
            "per_page": "100", "page": str(page),
        })
        batch = data.get("items", [])
        items.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    return items


def main():
    try:
        repos = fetch_repos()
        prs = fetch_prs()
    except Exception as error:  # noqa: BLE001 - a refresh failure must not break the site
        # Leave the previous live.json in place. A stale figure beats a broken build.
        print(f"refresh failed, keeping existing data: {type(error).__name__}: {error}", file=sys.stderr)
        return 1

    merged = [p for p in prs if (p.get("pull_request") or {}).get("merged_at")]
    open_prs = [p for p in prs if p["state"] == "open"]
    external_repos = {p["repository_url"].rsplit("/repos/", 1)[-1] for p in prs}

    known = set()
    if RESEARCH.exists():
        known = {r["name"] for r in json.loads(RESEARCH.read_text(encoding="utf-8"))["repos"]}

    live = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "repo_count": len(repos),
        "total_stars": sum(r["stargazers_count"] for r in repos),
        "external_repo_count": len(external_repos),
        "pr_total": len(prs),
        "pr_merged": len(merged),
        "pr_open": len(open_prs),
        "pr_closed_unmerged": len(prs) - len(merged) - len(open_prs),
        "stars": {r["name"]: r["stargazers_count"] for r in repos},
        # Repositories created since the last research pass. They are surfaced rather than
        # hidden, with their own GitHub description, and flagged for a proper write-up.
        "unresearched": [
            {"name": r["name"], "description": r["description"] or "",
             "language": r["language"] or "", "stars": r["stargazers_count"],
             "url": r["html_url"], "pushed_at": r["pushed_at"]}
            for r in repos if r["name"] not in known and r["name"] != f"{USER}.github.io"
        ],
        "merged_prs": [
            {"repo": p["repository_url"].rsplit("/repos/", 1)[-1],
             "title": p["title"], "url": p["html_url"],
             "merged_at": (p.get("pull_request") or {}).get("merged_at", "")}
            for p in merged
        ],
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(live, indent=2) + "\n", encoding="utf-8")
    print(f"live.json: {live['repo_count']} repos, {live['total_stars']} stars, "
          f"{live['pr_merged']} merged / {live['pr_open']} open across "
          f"{live['external_repo_count']} external repos, "
          f"{len(live['unresearched'])} awaiting a write-up")
    return 0


if __name__ == "__main__":
    sys.exit(main())
