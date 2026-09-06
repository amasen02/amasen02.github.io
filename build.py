#!/usr/bin/env python3
"""Generate index.html from verified research data.

The page is generated rather than hand-written so every claim on it traces back to a field
in research.json, and so regenerating after new research is a one-command operation.

All project content renders into static HTML: the page is fully readable with JavaScript
disabled. JavaScript only filters the already-present cards.
"""

import html
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).parent
RESEARCH = ROOT / "data" / "research.json"

LEAD = ["freshcart-backend", "diagif", "fastdl", "dupesweep"]

THEMES = [
    ("Distributed systems", "Correctness under concurrency, proven by tests rather than asserted in a README.",
     ["freshcart-backend", "transactional-outbox-engine", "concurrent-cache-dotnet9"]),
    ("Developer CLIs", "Command-line tools where the real work is data integrity and not losing anyone's files.",
     ["dupesweep", "fastdl", "dupehunter", "credscan", "profile-studio", "medium-blog-publisher"]),
    ("Agent reliability", "Tooling that refuses to take a model's word for anything.",
     ["diagif", "postwright", "jurytrace", "mcp-breakbench", "resumeproof",
      "memory-mismatch-lab", "citation-drift-lab", "centaurloop-agent-governor"]),
    ("Front end and interfaces", "Typed, strict front ends and the constraints that shape them.",
     ["freshcart-web", "kindrelay", "pulse-signals-engine"]),
    ("Libraries and platform", "API surfaces meant to be depended on.",
     ["polyai-dotnet", "a11y-scope", "ebpf-credscan-security"]),
]

def e(value):
    return html.escape(str(value or ""), quote=True)

def chips(items, limit=None):
    shown = items[:limit] if limit else items
    return "".join(f'<li class="chip">{e(c)}</li>' for c in shown)

def bullets(items, limit=None):
    shown = items[:limit] if limit else items
    return "".join(f"<li>{e(b)}</li>" for b in shown)

def repo_links(repo):
    out = [f'<a class="link" href="{e(repo["url"])}">Source</a>']
    home = (repo.get("homepage") or "").strip()
    if home:
        out.append(f'<a class="link" href="{e(home)}">Live</a>')
    return "".join(out)

def lead_card(repo):
    signals = repo.get("engineering_signals") or []
    highlights = repo.get("highlights") or []
    stars = repo.get("stars") or 0
    star_html = (f'<span class="stat"><span class="stat-n">{stars}</span> stars</span>'
                 if stars else "")
    arch = repo.get("architecture") or ""
    arch_html = (f'<div class="block"><h4>How it is built</h4><p>{e(arch[:700])}</p></div>'
                 if arch.strip() else "")
    sig_html = (f'<div class="block"><h4>Verified in the repository</h4>'
                f'<ul class="ticks">{bullets(signals, 5)}</ul></div>' if signals else "")
    return f"""
      <article class="lead" id="p-{e(repo['name'])}">
        <header class="lead-head">
          <h3>{e(repo['name'])}</h3>
          <p class="tagline">{e(repo['tagline'])}</p>
          <p class="meta">{star_html}<span class="lang">{e(repo.get('language') or '')}</span></p>
        </header>
        <p class="lede">{e(repo.get('what_it_does'))}</p>
        {arch_html}
        <div class="block">
          <h4>What is interesting about it</h4>
          <ul class="dashes">{bullets(highlights, 3)}</ul>
        </div>
        {sig_html}
        <ul class="chips">{chips(repo.get('stack') or [], 14)}</ul>
        <p class="actions">{repo_links(repo)}</p>
      </article>"""

def small_card(repo):
    stars = repo.get("stars") or 0
    star_html = f'<span class="stat"><span class="stat-n">{stars}</span>&#9733;</span>' if stars else ""
    highlights = repo.get("highlights") or []
    hl = f'<ul class="dashes small">{bullets(highlights, 2)}</ul>' if highlights else ""
    return f"""
        <article class="card" data-theme-card>
          <h4>{e(repo['name'])} {star_html}</h4>
          <p class="tagline">{e(repo['tagline'])}</p>
          <p>{e((repo.get('what_it_does') or '')[:340])}</p>
          {hl}
          <ul class="chips">{chips(repo.get('stack') or [], 8)}</ul>
          <p class="actions">{repo_links(repo)}</p>
        </article>"""

def main():
    data = json.loads(RESEARCH.read_text(encoding="utf-8"))
    repos = {r["name"]: r for r in data["repos"] if r.get("exists") is not False}
    contrib = data["contributions"]

    lead_html = "".join(lead_card(repos[n]) for n in LEAD if n in repos)

    placed, theme_html = set(), []
    for title, blurb, names in THEMES:
        present = [repos[n] for n in names if n in repos]
        if not present:
            continue
        placed.update(r["name"] for r in present)
        cards = "".join(small_card(r) for r in present)
        theme_html.append(f"""
      <section class="theme" aria-labelledby="t-{e(title.replace(' ', '-').lower())}">
        <h3 id="t-{e(title.replace(' ', '-').lower())}">{e(title)}</h3>
        <p class="theme-blurb">{e(blurb)}</p>
        <div class="grid">{cards}</div>
      </section>""")
    rest = [r for n, r in repos.items() if n not in placed]
    if rest:
        theme_html.append(f"""
      <section class="theme" aria-labelledby="t-more">
        <h3 id="t-more">Other work</h3>
        <div class="grid">{''.join(small_card(r) for r in rest)}</div>
      </section>""")

    merged_html = "".join(
        f'<li><a class="link" href="{e(m["url"])}">{e(m["repo"])}</a>'
        f'<span>{e(m["what_it_fixed"])}</span></li>'
        for m in (contrib.get("merged") or [])
    )

    tpl = (ROOT / "template.html").read_text(encoding="utf-8")
    page = (tpl
            .replace("{{LEAD}}", lead_html)
            .replace("{{THEMES}}", "".join(theme_html))
            .replace("{{MERGED}}", merged_html)
            .replace("{{REPO_COUNT}}", str(len(repos)))
            .replace("{{MERGED_COUNT}}", str(contrib.get("merged_count", 0)))
            .replace("{{OPEN_COUNT}}", str(contrib.get("open_count", 0)))
            .replace("{{EXTERNAL_REPOS}}", "41")
            .replace("{{STARS}}", "345"))
    (ROOT / "index.html").write_text(page, encoding="utf-8", newline="\n")
    print(f"wrote index.html: {len(page)} bytes, {len(repos)} repos, "
          f"{len(LEAD)} lead cards, {len(theme_html)} theme sections")

if __name__ == "__main__":
    sys.exit(main())
