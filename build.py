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
LIVE = ROOT / "data" / "live.json"
FLOWS = ROOT / "data" / "flows.json"

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


# ---------------------------------------------------------------------------
# Flow diagrams
#
# A paragraph of architecture prose is accurate and unread. The same information as a
# short left-to-right flow is graspable in a few seconds, so each project renders its
# mechanism as an SVG instead. The SVG is emitted into the HTML rather than drawn by
# script, so it is present with JavaScript disabled and readable by assistive tech.
# ---------------------------------------------------------------------------

KIND_CLASS = {"input": "n-in", "process": "n-proc", "store": "n-store",
              "guard": "n-guard", "output": "n-out"}

def flow_svg(flow):
    nodes = flow.get("nodes") or []
    if len(nodes) < 2:
        return ""
    n = len(nodes)
    # One column per node, laid out on a serpentine so six nodes still fit a narrow card.
    per_row = 3 if n > 4 else n
    rows = (n + per_row - 1) // per_row
    bw, bh = 150, 62
    gx, gy = 34, 40
    width = per_row * bw + (per_row - 1) * gx
    height = rows * bh + (rows - 1) * gy

    pos = {}
    for i, node in enumerate(nodes):
        r, c = divmod(i, per_row)
        # reverse odd rows so the path reads continuously rather than jumping back
        if r % 2:
            c = per_row - 1 - c
        pos[node["id"]] = (c * (bw + gx), r * (bh + gy))

    parts = [f'<svg class="flow" viewBox="0 0 {width} {height}" role="img" '
             f'aria-label="{e(flow.get("headline",""))}" preserveAspectRatio="xMidYMid meet">']
    parts.append('<defs><marker id="fa" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" '
                 'markerHeight="6" orient="auto-start-reverse">'
                 '<path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>')

    for edge in (flow.get("edges") or []):
        a, b = pos.get(edge.get("from")), pos.get(edge.get("to"))
        if not a or not b:
            continue
        if a[1] == b[1]:
            x1, y1 = a[0] + bw, a[1] + bh / 2
            x2, y2 = b[0], b[1] + bh / 2
            d = f"M{x1},{y1} L{x2 - 7},{y2}"
        else:
            x1, y1 = a[0] + bw / 2, a[1] + bh
            x2, y2 = b[0] + bw / 2, b[1]
            d = f"M{x1},{y1} C{x1},{y1 + 22} {x2},{y2 - 26} {x2},{y2 - 7}"
        parts.append(f'<path class="flow-edge" d="{d}" marker-end="url(#fa)"/>')

    for node in nodes:
        x, y = pos[node["id"]]
        cls = KIND_CLASS.get(node.get("kind"), "n-proc")
        sub = (node.get("sub") or "").strip()
        parts.append(f'<g class="flow-node {cls}" transform="translate({x},{y})">')
        parts.append(f'<rect width="{bw}" height="{bh}" rx="10"/>')
        parts.append(f'<text class="fn-label" x="{bw/2}" y="{26 if sub else 36}">{e(node["label"])}</text>')
        if sub:
            parts.append(f'<text class="fn-sub" x="{bw/2}" y="43">{e(sub[:30])}</text>')
        parts.append("</g>")

    parts.append("</svg>")
    return "".join(parts)


def flow_block(flow):
    if not flow:
        return ""
    punch = (flow.get("punchline") or "").strip()
    return (f'<div class="flow-wrap">{flow_svg(flow)}'
            + (f'<p class="flow-punch">{e(punch)}</p>' if punch else "")
            + "</div>")

def lead_card(repo, flow=None):
    signals = repo.get("engineering_signals") or []
    highlights = repo.get("highlights") or []
    # The flow punchline already states the single most interesting fact, so the prose
    # bullets only appear where there is no diagram to carry it.
    highlight_html = "" if flow else (
        f'<div class="block"><h4>What is interesting about it</h4>'
        f'<ul class="dashes">{bullets(highlights, 3)}</ul></div>' if highlights else "")
    stars = repo.get("stars") or 0
    star_html = (f'<span class="stat"><span class="stat-n">{stars}</span> stars</span>'
                 if stars else "")
    arch = repo.get("architecture") or ""
    if flow:
        arch_html = (f'<div class="block"><h4>How it works</h4>{flow_block(flow)}</div>')
    else:
        arch_html = (f'<div class="block"><h4>How it is built</h4><p>{e(arch[:700])}</p></div>'
                     if arch.strip() else "")
    trimmed = [s if len(s) <= 120 else s[:117].rsplit(" ", 1)[0] + "…" for s in signals[:4]]
    sig_html = (f'<div class="block"><h4>Verified in the repository</h4>'
                f'<ul class="ticks">{bullets(trimmed)}</ul></div>' if trimmed else "")
    return f"""
      <article class="lead" id="p-{e(repo['name'])}">
        <header class="lead-head">
          <h3>{e(repo['name'])}</h3>
          <p class="tagline">{e(repo['tagline'])}</p>
          <p class="meta">{star_html}<span class="lang">{e(repo.get('language') or '')}</span></p>
        </header>
        <p class="lede">{e((flow or {}).get("headline") or repo.get("what_it_does"))}</p>
        {arch_html}
        {highlight_html}
        {sig_html}
        <ul class="chips">{chips(repo.get('stack') or [], 14)}</ul>
        <p class="actions">{repo_links(repo)}</p>
      </article>"""

def small_card(repo, flow=None):
    stars = repo.get("stars") or 0
    star_html = f'<span class="stat"><span class="stat-n">{stars}</span>&#9733;</span>' if stars else ""
    highlights = repo.get("highlights") or []
    hl = f'<ul class="dashes small">{bullets(highlights, 2)}</ul>' if highlights else ""
    return f"""
        <article class="card" data-theme-card>
          <h4>{e(repo['name'])} {star_html}</h4>
          <p class="tagline">{e((flow or {}).get("headline") or repo["tagline"])}</p>
          {flow_block(flow) if flow else f"<p>{e((repo.get('what_it_does') or '')[:280])}</p>"}
          {hl if not flow else ""}
          <ul class="chips">{chips(repo.get('stack') or [], 8)}</ul>
          <p class="actions">{repo_links(repo)}</p>
        </article>"""

def main():
    data = json.loads(RESEARCH.read_text(encoding="utf-8"))
    repos = {r["name"]: r for r in data["repos"] if r.get("exists") is not False}
    contrib = dict(data["contributions"])

    # Live figures win over the research snapshot wherever both exist. The snapshot holds the
    # hand-verified prose; the API holds the numbers that move on their own.
    live = json.loads(LIVE.read_text(encoding="utf-8")) if LIVE.exists() else {}
    for name, stars in (live.get("stars") or {}).items():
        if name in repos:
            repos[name]["stars"] = stars
    for key, field in [("pr_merged", "merged_count"), ("pr_open", "open_count"),
                       ("pr_closed_unmerged", "closed_unmerged_count"), ("pr_total", "total_prs")]:
        if key in live:
            contrib[field] = live[key]

    # A repository created since the last research pass is shown with its own GitHub
    # description rather than being silently dropped from the page.
    for extra in (live.get("unresearched") or []):
        repos.setdefault(extra["name"], {
            "name": extra["name"], "exists": True,
            "tagline": extra["description"] or "Recently published; write-up pending.",
            "what_it_does": extra["description"] or "",
            "stack": [extra["language"]] if extra["language"] else [],
            "highlights": [], "engineering_signals": [],
            "stars": extra["stars"], "language": extra["language"],
            "url": extra["url"], "homepage": "", "topics": [],
        })

    flows = json.loads(FLOWS.read_text(encoding="utf-8")) if FLOWS.exists() else {}
    lead_html = "".join(lead_card(repos[n], flows.get(n)) for n in LEAD if n in repos)

    placed, theme_html = set(), []
    for title, blurb, names in THEMES:
        present = [repos[n] for n in names if n in repos]
        if not present:
            continue
        placed.update(r["name"] for r in present)
        cards = "".join(small_card(r, flows.get(r["name"])) for r in present)
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
        <div class="grid">{''.join(small_card(r, flows.get(r['name'])) for r in rest)}</div>
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
            .replace("{{EXTERNAL_REPOS}}", str(live.get("external_repo_count", 41)))
            .replace("{{STARS}}", str(live.get("total_stars", 345)))
            .replace("{{UPDATED}}", (live.get("generated_at", "") or "")[:10]))
    (ROOT / "index.html").write_text(page, encoding="utf-8", newline="\n")
    print(f"wrote index.html: {len(page)} bytes, {len(repos)} repos, "
          f"{len(LEAD)} lead cards, {len(theme_html)} theme sections")

if __name__ == "__main__":
    sys.exit(main())
