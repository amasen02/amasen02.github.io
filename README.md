# amasen02.github.io

Portfolio for Ama Senevirathne, plus the interactive `diagif` demo at `/diagif/`.

`index.html` is generated. Do not edit it by hand:

```
python build.py
```

`build.py` reads `data/research.json` and `template.html`. Every project description and
figure on the page comes from that data file, which was extracted by reading each repository
and the GitHub API, so a claim on the page can always be traced back to its source.

The site makes zero external runtime requests. Fonts are self-hosted under `assets/fonts/`.
Every `http(s)` reference in the output is a link target, never an asset.
