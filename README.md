# Claude Session Monitor

A real-time, trading-terminal–style desktop dashboard that shows what your local
**Claude Code** sessions are doing — across every project — at a glance.

It reads the session transcripts that Claude Code writes to
`~/.claude/projects/**/*.jsonl`, watches them for changes, and renders a live
multi-panel dashboard. Read-only: it never modifies your Claude data.

> Run `npm start` to see it live. To add a screenshot here, capture the window
> and drop it at `docs/screenshot.png`, then reference it in this README.

## Features

- **All-projects session list** — every session under `~/.claude/projects`, newest first,
  with a live status dot: 🟢 active (touched <30s), 🟡 recent (<5min), ⚪ idle.
- **Live activity** — what each session is doing *right now*: thinking, running a tool
  (with the file/command it's touching), processing a result, or replying.
- **Execution cycle** — the current turn's stage highlighted: Await → Think → Tool → Result → Reply.
- **Token & cost accounting** — input / output / cache-write / cache-read tokens per session,
  with a rough USD cost estimate per model (see caveat below).
- **Cost growth chart** — cumulative estimated spend over the selected session's lifetime.
- **Tool usage breakdown** — which tools are used most (Bash, Edit, Read, …).
- **Global live feed + ticker** — a stream of recent events across all sessions.
- **Session focus panel** — model, branch, message counts, duration; click the path to reveal in Finder.

## Requirements

- macOS / Windows / Linux
- [Node.js](https://nodejs.org) 18+ and npm
- Claude Code installed and used at least once (so `~/.claude/projects` exists)

## Run

```bash
git clone https://github.com/DesignAOumi/claude-session-monitor.git
cd claude-session-monitor
npm install
npm start
```

The dashboard updates automatically as your Claude Code sessions run.

## How it works

```
~/.claude/projects/<project>/<session>.jsonl   ← Claude Code transcripts (source of truth)
        │  fs.watch (recursive) + 1.5s heartbeat
        ▼
   src/scanner.js   → lists & stats every session file (mtime-cached, re-parses only changed files)
   src/parser.js    → turns each JSONL into metrics (tokens, tools, activity, status)
   src/pricing.js   → rough USD cost estimate per model
        │  IPC (preload bridge)
        ▼
   renderer/        → the terminal-style dashboard (HTML / CSS / Canvas, no frameworks)
```

The only runtime dependency is Electron. Everything else is plain Node + vanilla JS.

## Cost estimate caveat

Costs are **rough estimates** derived from a static per-model price table in
[`src/pricing.js`](src/pricing.js) (Opus / Sonnet / Haiku tiers, with the standard
cache-write ×1.25 and cache-read ×0.1 multipliers). They are **not** billing-accurate —
treat them as a relative signal, and edit the table to match current pricing.

## Privacy

Everything runs locally. The app only reads files under your own `~/.claude/projects`
directory and never sends anything over the network.

## License

MIT
