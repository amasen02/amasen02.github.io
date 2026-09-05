# diagif demo site

Static demo for [diagif](https://github.com/amasen02/diagif). It has no build step and makes no runtime requests outside this directory. The live playground loads normalized scenes from `assets/manifest.json` and mounts them through the bundled renderer.

The quickstart shown on the page assumes the source dependencies from diagif's own README are installed and `npm link` has exposed the checkout's `diagif` binary. `diagif auth --login codex` is the wrapper equivalent of running `codex login` directly.

## Serve locally

A local HTTP server is required because the page fetches the manifest and scene JSON files.

From the repository checkout, run:

```sh
python -m http.server 4173
```

Then open <http://localhost:4173/>.

The manifest format is:

```json
{
  "scenes": [{ "id": "scene-id", "title": "Scene title", "domain": "Domain", "file": "assets/scenes/scene-id.json" }],
  "gallery": [{ "id": "scene-id", "title": "Scene title", "domain": "Domain", "file": "assets/gallery/scene-id.gif" }]
}
```

All file paths are relative to the site root. Keep `assets/renderer.js`, `assets/fonts.css`, scene JSON, and GIF files local so the demo remains self-contained.
