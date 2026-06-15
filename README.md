# Claude Session Monitor

A real-time, trading-terminal–style desktop dashboard that shows what your local
**Claude Code** sessions are doing — across every project — at a glance.

It reads the session transcripts that Claude Code writes to
`~/.claude/projects/**/*.jsonl`, watches them for changes, and renders a live
multi-panel dashboard. Read-only: it never modifies your Claude data.

> Run `npm start` to see it live. To add a screenshot here, capture the window
> and drop it at `docs/screenshot.png`, then reference it in this README.

## Plan usage strip (with reset countdowns)

A strip at the top (shown in both views) mirrors the Claude desktop app's **使用量** tab:

- **現在のセッション (5h)** — a live **countdown to reset**, computed automatically from
  your message timestamps (Claude's rolling 5-hour window). Also shows messages / output
  tokens used inside the current window.
- **週間制限** — live countdown to the next weekly reset (configurable weekday/time, default Thu 3:00).
- **利用クレジット** and **ルーティン/日** — usage bars.

### Automatic usage via the statusLine hook (recommended)

The session/weekly **percentages and exact reset times** can be captured **automatically** —
no API call, no credential access. Claude Code pipes a JSON object (including `rate_limits`
for subscribers) to a configurable **statusLine** command. Point it at the bundled capture
script and the monitor reads the real numbers:

Add to `~/.claude/settings.json`:

```json
"statusLine": {
  "type": "command",
  "command": "/bin/sh \"<path-to-repo>/scripts/statusline-usage.sh\""
}
```

The script writes `~/.claude/claude-monitor-usage.json` (and prints a short `5h 42% · 7d 12%`
status line). The monitor then shows the real session/weekly % and counts down to the exact
reset time. Values update whenever a Claude Code session is active; between sessions the last
captured values are shown.

Credits and daily-routine counts aren't included in that JSON, so those remain manual via
**⚙ 料金設定 → 使用量** (they rarely change). If the statusLine isn't set up, the session/weekly
cells fall back to manual % + the locally-estimated reset countdown.

## Two views

Switch anytime with the **しんぷる / くわしく** toggle in the top bar.

- **しんぷる (Simple)** — beginner-friendly. Answers the only three questions a newcomer
  has: *Do I need to do something?* / *What is it doing right now?* / *How far has it got?*
  - Big status pill per session: 🟢 **作業中** (working) · 🟡 **あなたの返信待ち** (waiting for you) · ⚪ **停止中** (stopped)
  - "Now doing…" in plain words with an icon (📖 reading a file, 💻 running a command, 🤔 thinking…)
  - Plain-language activity log with the **real content** (Claude's reply text, the actual Bash command, result/error snippets) — each entry expands to full text with a もっと見る toggle
  - Non-stopped sessions (running + waiting) appear as a **horizontal chip bar** pinned at the top; click one to show its detail below. **Split view** (toggle) shows up to **2** session details side by side. Running sessions have a pulsing green dot
  - A selected session stays open even if it goes idle — it is **not** auto-closed on a refresh; it only leaves the detail view when you pick something else or the session file disappears
  - When a session is **waiting on you**, its last reply is split into **確認事項** (questions you need to answer) and a **やることリスト** (to-dos). The to-dos are real checkboxes — click to check them off (purely visual, no side effects; the checked state is remembered)
  - Honest progress proxies: working time, number of steps, files touched, your message count, and an **activity pulse** sparkline
  - **Actual cost** you configure (flat plan fee + any additional charge) — not a token-based guess
- **くわしく (Detail)** — the technical trading-terminal dashboard described below.

## Features (Detail view)

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

## Cost display

Claude Code transcripts do **not** record what you are actually charged, so the app
does not show a token-based cost guess. Instead, open **⚙ 料金設定** in the top bar and
enter your **flat plan fee** (e.g. Claude Pro / Max) plus any **additional charge**.
That sum is shown as your real monthly cost (yen or USD), and is saved locally.

Token usage is still shown as *usage* (not money): per-session token counts and a
"生成トークンの推移" (output-token growth) chart.

## Privacy

Everything runs locally. The app only reads files under your own `~/.claude/projects`
directory and never sends anything over the network.

## License

MIT
