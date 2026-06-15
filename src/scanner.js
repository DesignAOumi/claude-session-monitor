'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseSessionFile, statusOf } = require('./parser');

const PROJECTS_ROOT = path.join(os.homedir(), '.claude', 'projects');

// Cache parsed sessions keyed by file path. Re-parse only when size/mtime change.
const cache = new Map(); // file -> { mtimeMs, size, session }

function listSessionFiles(root) {
  const out = [];
  let dirs;
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const projDir = path.join(root, d.name);
    let files;
    try {
      files = fs.readdirSync(projDir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (f.endsWith('.jsonl')) out.push(path.join(projDir, f));
    }
  }
  return out;
}

function scan(root = PROJECTS_ROOT) {
  const now = Date.now();
  const files = listSessionFiles(root);
  const sessions = [];
  const live = new Set(files);

  for (const file of files) {
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      continue;
    }
    const cached = cache.get(file);
    let session;
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
      session = cached.session;
    } else {
      session = parseSessionFile(file, st.mtimeMs);
      cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, session });
    }
    if (!session) continue;
    session.status = statusOf(st.mtimeMs, now);
    session.ageMs = now - st.mtimeMs;
    sessions.push(session);
  }

  // Drop cache entries for files that vanished.
  for (const key of cache.keys()) {
    if (!live.has(key)) cache.delete(key);
  }

  // Most recently active first.
  sessions.sort((a, b) => b.mtimeMs - a.mtimeMs);

  return { sessions, stats: aggregate(sessions, now), generatedAt: now };
}

function aggregate(sessions, now) {
  const stats = {
    totalSessions: sessions.length,
    active: 0,
    recent: 0,
    idle: 0,
    totalCost: 0,
    tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 },
    toolDistribution: {},
    totalToolCalls: 0,
    totalMessages: 0,
    projects: new Set(),
    feed: [],
  };

  for (const s of sessions) {
    if (s.status === 'active') stats.active += 1;
    else if (s.status === 'recent') stats.recent += 1;
    else stats.idle += 1;

    stats.totalCost += s.cost;
    stats.tokens.input += s.tokens.input;
    stats.tokens.output += s.tokens.output;
    stats.tokens.cacheWrite += s.tokens.cacheWrite;
    stats.tokens.cacheRead += s.tokens.cacheRead;
    stats.totalToolCalls += s.toolCalls;
    stats.totalMessages += s.totalMessages;
    if (s.project) stats.projects.add(s.project);

    for (const [name, count] of Object.entries(s.tools)) {
      stats.toolDistribution[name] = (stats.toolDistribution[name] || 0) + count;
    }

    for (const item of s.feed) {
      stats.feed.push({ ...item, project: s.project, sessionId: s.sessionId });
    }
  }

  stats.tokens.total =
    stats.tokens.input + stats.tokens.output + stats.tokens.cacheWrite + stats.tokens.cacheRead;
  stats.projectCount = stats.projects.size;
  delete stats.projects;

  // Global live feed: newest first, capped.
  stats.feed.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  stats.feed = stats.feed.slice(0, 60);

  return stats;
}

module.exports = { scan, PROJECTS_ROOT };
