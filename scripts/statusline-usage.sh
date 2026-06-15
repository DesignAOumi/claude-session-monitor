#!/bin/sh
# Claude Session Monitor — usage capture via Claude Code's statusLine hook.
#
# Claude Code pipes a JSON object to the statusLine command on each update. For
# subscribers it includes `rate_limits` (5-hour + 7-day usage % and reset times)
# that is NOT stored anywhere on disk otherwise. We persist that JSON so the
# monitor can read live usage without any API call or credential access, then
# print a short status line for the terminal.
#
# Configured in ~/.claude/settings.json as:
#   "statusLine": { "type": "command", "command": "/bin/sh \"<path>/statusline-usage.sh\"" }

input=$(cat)
out_file="$HOME/.claude/claude-monitor-usage.json"
printf '%s' "$input" > "$out_file" 2>/dev/null

# Best-effort concise status line (only if jq is available).
if command -v jq >/dev/null 2>&1; then
  five=$(printf '%s' "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty' 2>/dev/null)
  week=$(printf '%s' "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty' 2>/dev/null)
  dir=$(printf '%s' "$input" | jq -r '.workspace.current_dir // .cwd // empty' 2>/dev/null)
  out=""
  [ -n "$dir" ] && out="$(basename "$dir")"
  [ -n "$five" ] && out="$out  │  5h $(printf '%.0f' "$five" 2>/dev/null)%"
  [ -n "$week" ] && out="$out · 7d $(printf '%.0f' "$week" 2>/dev/null)%"
  printf '%s' "${out:-claude}"
else
  printf 'claude (monitor capturing usage)'
fi
