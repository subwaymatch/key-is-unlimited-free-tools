# Notes for coding agents

## Plain ASCII punctuation (enforced)

Write everything in this repository using ASCII punctuation only: code,
comments, docs, commit messages and UI strings alike.

- `-` for dashes. Never an em dash or an en dash.
- `'` and `"` for quotes. Never curly quotes.
- `...` for an ellipsis. Never the single-character ellipsis.
- `->` for an arrow.
- Words such as "yes", "no" and "warning" instead of status emoji or check
  marks. No emoji anywhere. No box-drawing characters; draw diagrams with
  `+`, `-`, `|` and `>`.

This is the repository's most frequently broken rule, because the characters
above are the default output style of most language models. Check your own diff
before committing:

```bash
npm run check:characters          # report offenders
npm run check:characters -- --fix # rewrite the unambiguous ones
```

CI fails on any violation. The full policy, including how to exempt a file that
genuinely needs non-ASCII characters, is in [CONTRIBUTING.md](CONTRIBUTING.md).

## Before you push

```bash
npm run lint
npm run typecheck
npm run check:characters
npm test
```

## Architecture in one paragraph

A Next.js static export (`output: "export"`) served from Cloudflare Workers
static assets, with no Worker script, so every request is a free static asset.
All conversion happens in the browser through ffmpeg.wasm: `lib/engine/`
wraps ffmpeg, `lib/useConversionQueue.ts` runs jobs one at a time, and
`components/` renders the UI. Nothing is uploaded. See [README.md](README.md)
for the details that matter, especially the WORKERFS mount, the 25 MiB
static-asset limit that keeps the ffmpeg core on a CDN, and the class-worker
path handling.
