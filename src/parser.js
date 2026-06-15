'use strict';

const fs = require('fs');
const path = require('path');
const { estimateCost } = require('./pricing');

/** Turn a tool_use block into a short human label of what it's doing. */
function toolDetail(name, input) {
  if (!input || typeof input !== 'object') return '';
  // Show the last two path segments ("folder/file") so it's clear which file.
  const tail = (p) => {
    if (typeof p !== 'string') return '';
    const parts = p.split('/').filter(Boolean);
    return parts.slice(-2).join('/');
  };
  const clip = (s, n = 160) =>
    typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, n) : '';
  switch (name) {
    case 'Read':
    case 'Edit':
    case 'Write':
      return tail(input.file_path);
    case 'NotebookEdit':
      return tail(input.notebook_path);
    case 'Bash':
      // Both the human-readable intent and the actual command, when available.
      return input.description && input.command
        ? clip(`${input.description} › ${input.command}`)
        : clip(input.command || input.description);
    case 'Grep':
      return input.pattern
        ? `「${input.pattern}」を検索${input.path ? ` (${tail(input.path)})` : ''}`
        : '';
    case 'Glob':
      return input.pattern || '';
    case 'Task':
    case 'Agent':
      return clip(input.description || input.subagent_type);
    case 'WebFetch':
      return input.url || '';
    case 'WebSearch':
      return input.query || '';
    case 'TodoWrite':
      return '';
    default: {
      // Generic: first non-trivial string value in the input.
      for (const v of Object.values(input)) {
        if (typeof v === 'string' && v.length) return clip(v);
      }
      return '';
    }
  }
}

/** Extract a short, single-line snippet from a tool_result's content. */
function resultSnippet(content) {
  let text = '';
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    for (const b of content) {
      if (typeof b === 'string') text += ' ' + b;
      else if (b && b.type === 'text' && typeof b.text === 'string') text += ' ' + b.text;
      else if (b && typeof b.content === 'string') text += ' ' + b.content;
    }
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, 120);
}

/** Extract plain text from a message content (string or block array). */
function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join(' ');
}

function pushFeed(feed, item, max = 40) {
  feed.push(item);
  if (feed.length > max) feed.shift();
}

/**
 * Parse a single session JSONL file into a metrics object.
 * Returns null if the file has no usable events.
 */
function parseSessionFile(file, mtimeMs) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }

  const session = {
    sessionId: path.basename(file, '.jsonl'),
    file,
    mtimeMs: mtimeMs != null ? mtimeMs : Date.now(),
    cwd: null,
    project: null,
    gitBranch: null,
    version: null,
    title: null,
    model: null,
    firstTs: null,
    lastTs: null,
    userMessages: 0,
    assistantMessages: 0,
    tools: {},
    toolCalls: 0,
    tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 },
    cost: 0,
    currentActivity: { state: 'idle', tool: null, detail: '', ts: null },
    feed: [],
    // Cumulative usage timeline (one point per assistant message): used by the
    // "usage growth" chart. `tokens` = cumulative output tokens (work produced).
    usageSeries: [],
  };

  let cumCost = 0;
  let cumOut = 0;
  const toolById = {}; // tool_use_id -> { name, detail } so results know their source

  const lines = raw.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }

    const ts = o.timestamp ? Date.parse(o.timestamp) : null;
    if (ts) {
      if (session.firstTs == null || ts < session.firstTs) session.firstTs = ts;
      if (session.lastTs == null || ts > session.lastTs) session.lastTs = ts;
    }

    if (o.cwd && !session.cwd) {
      session.cwd = o.cwd;
      session.project = path.basename(o.cwd);
    }
    if (o.gitBranch && !session.gitBranch) session.gitBranch = o.gitBranch;
    if (o.version) session.version = o.version;

    // Session title (emitted as an ai-title event by Claude Code).
    if (o.type === 'ai-title') {
      session.title =
        o.title || o.text || (o.message && (o.message.title || o.message.text)) || session.title;
      continue;
    }

    const msg = o.message;
    const content = msg && msg.content;

    if (o.type === 'user') {
      // A "user" line can be real user input OR a tool_result returned to the model.
      const hasToolResult =
        Array.isArray(content) && content.some((b) => b && b.type === 'tool_result');
      if (hasToolResult) {
        for (const b of content) {
          if (b && b.type === 'tool_result') {
            const isErr = b.is_error === true;
            const src = toolById[b.tool_use_id] || null;
            const snip = resultSnippet(b.content);
            session.currentActivity = {
              state: isErr ? 'tool-error' : 'processing',
              tool: src ? src.name : null,
              detail: src ? src.detail : '',
              ts,
            };
            pushFeed(session.feed, {
              ts,
              kind: isErr ? 'error' : 'result',
              label: src ? src.name : isErr ? 'TOOL ERR' : 'RESULT',
              tool: src ? src.name : null,
              target: src ? src.detail : '',
              detail: snip,
            });
          }
        }
      } else if (!o.isMeta) {
        session.userMessages += 1;
        const t = textOf(content).trim();
        session.currentActivity = { state: 'awaiting', tool: null, detail: t.slice(0, 120), ts };
        pushFeed(session.feed, {
          ts,
          kind: 'user',
          label: 'USER',
          detail: t.slice(0, 200),
        });
      }
      continue;
    }

    if (o.type === 'assistant' && msg) {
      session.assistantMessages += 1;
      if (msg.model) session.model = msg.model;

      // Token + cost accounting.
      const u = msg.usage;
      if (u) {
        session.tokens.input += u.input_tokens || 0;
        session.tokens.output += u.output_tokens || 0;
        session.tokens.cacheWrite += u.cache_creation_input_tokens || 0;
        session.tokens.cacheRead += u.cache_read_input_tokens || 0;
        cumCost += estimateCost(msg.model, u);
        cumOut += u.output_tokens || 0;
        if (ts) session.usageSeries.push({ ts, tokens: cumOut });
      }

      if (Array.isArray(content)) {
        let lastBlock = null;
        for (const b of content) {
          if (!b || typeof b !== 'object') continue;
          lastBlock = b;
          if (b.type === 'tool_use') {
            session.toolCalls += 1;
            session.tools[b.name] = (session.tools[b.name] || 0) + 1;
            const detail = toolDetail(b.name, b.input);
            if (b.id) toolById[b.id] = { name: b.name, detail };
            session.currentActivity = { state: 'running', tool: b.name, detail, ts };
            pushFeed(session.feed, {
              ts,
              kind: 'tool',
              label: b.name,
              detail,
            });
          }
        }
        if (lastBlock) {
          if (lastBlock.type === 'thinking') {
            session.currentActivity = { state: 'thinking', tool: null, detail: '', ts };
          } else if (lastBlock.type === 'text') {
            const t = textOf(content).trim();
            session.currentActivity = { state: 'responding', tool: null, detail: t.slice(0, 120), ts };
            if (t)
              pushFeed(session.feed, { ts, kind: 'assistant', label: 'CLAUDE', detail: t.slice(0, 240) });
          }
        }
      }
      continue;
    }
  }

  session.tokens.total =
    session.tokens.input +
    session.tokens.output +
    session.tokens.cacheWrite +
    session.tokens.cacheRead;
  session.cost = cumCost;
  session.durationMs =
    session.firstTs != null && session.lastTs != null ? session.lastTs - session.firstTs : 0;
  session.totalMessages = session.userMessages + session.assistantMessages;

  if (!session.title) {
    session.title = session.project || session.sessionId.slice(0, 8);
  }

  if (session.firstTs == null && session.assistantMessages === 0 && session.userMessages === 0) {
    return null;
  }
  return session;
}

/** Classify status from how recently the file changed. */
function statusOf(mtimeMs, now) {
  const age = now - mtimeMs;
  if (age < 30_000) return 'active'; // touched in last 30s
  if (age < 5 * 60_000) return 'recent'; // last 5 min
  return 'idle';
}

module.exports = { parseSessionFile, statusOf, toolDetail };
