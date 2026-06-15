'use strict';

// ░░ State ░░
let latest = null;
let selectedId = null;
let userPinned = false; // true once the user clicks a row
let mode = 'simple'; // 'simple' (beginner) | 'detail' (technical)

// USD -> JPY conversion for the beginner-friendly money display (rough estimate).
const USD_JPY = 155;

// ░░ Formatters ░░
const fmtTokens = (n) => {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n | 0);
};
const fmtCost = (c) => {
  if (c >= 100) return '$' + c.toFixed(0);
  if (c >= 1) return '$' + c.toFixed(2);
  if (c > 0) return '$' + c.toFixed(3);
  return '$0';
};
const fmtAge = (ms) => {
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h';
  return Math.floor(h / 24) + 'd';
};
const two = (n) => String(n).padStart(2, '0');
const clockTime = (d) => `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
const hhmmss = (ts) => {
  if (!ts) return '--:--:--';
  const d = new Date(ts);
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
};

// Money in JPY (estimate) with the USD figure in parentheses.
const fmtMoney = (usd) => {
  if (!usd || usd <= 0) return '—';
  const yen = Math.round(usd * USD_JPY);
  const yenStr = yen >= 1 ? yen.toLocaleString() + '円' : '1円未満';
  const usdStr = usd >= 1 ? '$' + usd.toFixed(2) : '$' + usd.toFixed(3);
  return `約${yenStr} <em>(${usdStr})</em>`;
};

// Relative time in Japanese.
const fmtAgoJa = (ts) => {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return 'たった今';
  if (s < 60) return `${s}秒前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間前`;
  return `${Math.floor(h / 24)}日前`;
};
const fmtDurationJa = (ms) => {
  const m = Math.floor(ms / 60000);
  if (m < 1) return '1分未満';
  if (m < 60) return `${m}分`;
  const h = Math.floor(m / 60);
  return `${h}時間${m % 60}分`;
};

const modelShort = (m) => {
  if (!m) return '—';
  const id = m.toLowerCase();
  if (id.includes('opus')) return 'OPUS';
  if (id.includes('sonnet')) return 'SONNET';
  if (id.includes('haiku')) return 'HAIKU';
  return m.replace('claude-', '').toUpperCase().slice(0, 8);
};
const modelClass = (m) => {
  if (!m) return '';
  const id = m.toLowerCase();
  if (id.includes('opus')) return 'opus';
  if (id.includes('sonnet')) return 'sonnet';
  if (id.includes('haiku')) return 'haiku';
  return '';
};

const ACTIVITY_LABEL = {
  active: 'ACTIVE',
  running: 'RUNNING',
  thinking: 'THINKING',
  responding: 'REPLYING',
  processing: 'PROCESSING',
  awaiting: 'AWAITING',
  'tool-error': 'TOOL ERR',
  idle: 'IDLE',
};
const ACTIVITY_CLASS = {
  thinking: 'thinking',
  responding: 'responding',
  'tool-error': 'error',
};

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ░░ Plain-language mapping (beginner view) ░░
const TOOL_MAP = {
  Read: { emoji: '📖', now: 'ファイルを読んでいます', past: 'ファイルを読みました' },
  Edit: { emoji: '✏️', now: 'ファイルを編集しています', past: 'ファイルを編集しました' },
  Write: { emoji: '📝', now: 'ファイルを作成しています', past: 'ファイルを作成しました' },
  NotebookEdit: { emoji: '✏️', now: 'ノートを編集しています', past: 'ノートを編集しました' },
  Bash: { emoji: '💻', now: 'コマンドを実行しています', past: 'コマンドを実行しました' },
  Grep: { emoji: '🔍', now: 'コードを検索しています', past: 'コードを検索しました' },
  Glob: { emoji: '🔍', now: 'ファイルを探しています', past: 'ファイルを探しました' },
  Task: { emoji: '🤝', now: 'サブ作業を任せています', past: 'サブ作業を任せました' },
  Agent: { emoji: '🤝', now: 'サブ作業を任せています', past: 'サブ作業を任せました' },
  WebFetch: { emoji: '🌐', now: 'ウェブページを読んでいます', past: 'ウェブページを読みました' },
  WebSearch: { emoji: '🌐', now: 'ウェブで検索しています', past: 'ウェブで検索しました' },
  TodoWrite: { emoji: '📋', now: 'やることを整理しています', past: 'やることを整理しました' },
  TaskCreate: { emoji: '📋', now: 'タスクを作成しています', past: 'タスクを作成しました' },
};
const toolDesc = (name) =>
  TOOL_MAP[name] || { emoji: '🔧', now: 'ツールを使っています', past: 'ツールを使いました' };

function statusPlain(s) {
  const st = s.currentActivity.state;
  if (s.status === 'active') {
    if (st === 'responding') return { key: 'waiting', emoji: '🟡', label: 'あなたの返信待ち' };
    return { key: 'working', emoji: '🟢', label: '作業中' };
  }
  if (s.status === 'recent' && st === 'responding')
    return { key: 'waiting', emoji: '🟡', label: 'あなたの返信待ち' };
  return { key: 'stopped', emoji: '⚪', label: '停止中' };
}

function activityPlain(s) {
  if (s.status === 'idle') return { emoji: '💤', text: '待機しています', detail: '' };
  const st = s.currentActivity.state;
  const detail = s.currentActivity.detail || '';
  switch (st) {
    case 'thinking':
      return { emoji: '🤔', text: '考えています', detail: '' };
    case 'responding':
      return { emoji: '💬', text: '返事を書いています', detail: '' };
    case 'processing':
      return { emoji: '⚙️', text: '結果を確認しています', detail: '' };
    case 'awaiting':
      return { emoji: '📥', text: '指示を受け取りました', detail: '' };
    case 'tool-error':
      return { emoji: '⚠️', text: 'エラーに対応しています', detail: '' };
    case 'running': {
      const d = toolDesc(s.currentActivity.tool);
      return { emoji: d.emoji, text: d.now, detail };
    }
    default:
      return { emoji: '🔧', text: '作業しています', detail: '' };
  }
}

function feedPlain(item) {
  switch (item.kind) {
    case 'user':
      return { emoji: '🙋', txt: 'あなたが指示しました', detail: item.detail || '' };
    case 'assistant':
      return { emoji: '💬', txt: '返信しました', detail: '' };
    case 'result':
      return { emoji: '✅', txt: '結果を受け取りました', detail: '' };
    case 'error':
      return { emoji: '⚠️', txt: 'エラーがありました', detail: '' };
    case 'tool': {
      const d = toolDesc(item.label);
      return { emoji: d.emoji, txt: d.past, detail: item.detail || '' };
    }
    default:
      return { emoji: '•', txt: item.label || '', detail: item.detail || '' };
  }
}

// Activity "pulse": bucket recent feed events into bars so momentum is visible.
function pulseBars(feed, bins = 22) {
  if (!feed || feed.length < 2) {
    return Array.from({ length: bins }, () => '<span class="empty"></span>').join('');
  }
  const t0 = feed[0].ts || 0;
  const t1 = Math.max(feed[feed.length - 1].ts || t0, Date.now());
  const span = t1 - t0 || 1;
  const counts = new Array(bins).fill(0);
  for (const f of feed) {
    if (!f.ts) continue;
    let i = Math.floor(((f.ts - t0) / span) * bins);
    if (i >= bins) i = bins - 1;
    if (i < 0) i = 0;
    counts[i] += 1;
  }
  const max = Math.max(...counts, 1);
  return counts
    .map((c) => {
      if (!c) return '<span class="empty"></span>';
      const h = Math.max(8, Math.round((c / max) * 100));
      return `<span style="height:${h}%"></span>`;
    })
    .join('');
}

function simpleCard(s) {
  const st = statusPlain(s);
  const act = activityPlain(s);
  const fileOps =
    (s.tools.Read || 0) + (s.tools.Edit || 0) + (s.tools.Write || 0) + (s.tools.NotebookEdit || 0);
  const logs = [...s.feed]
    .reverse()
    .slice(0, 5)
    .map((item) => {
      const p = feedPlain(item);
      return `<div class="log-item">
        <span class="log-emoji">${p.emoji}</span>
        <span class="log-txt">${esc(p.txt)}</span>
        ${p.detail ? `<span class="now-detail" style="flex:0 1 auto">${esc(p.detail)}</span>` : ''}
        <span class="log-time">${fmtAgoJa(item.ts)}</span>
      </div>`;
    })
    .join('');

  return `
    <div class="scard ${st.key}">
      <div class="scard-top">
        <span class="status-pill ${st.key}">${st.emoji} ${st.label}</span>
        <span class="scard-proj">${esc(s.project || '—')}</span>
        <span class="scard-money">${fmtMoney(s.cost)}</span>
      </div>
      <div class="scard-title">いま取り組んでいること: <b>${esc(s.title || s.project || '—')}</b></div>
      <div class="scard-now">
        <span class="now-icon">${act.emoji}</span>
        <span class="now-text">${esc(act.text)}</span>
        ${act.detail ? `<span class="now-detail">${esc(act.detail)}</span>` : ''}
      </div>
      <div class="scard-chips">
        <span class="chip">⏱ 作業時間 <b>${fmtDurationJa(s.durationMs)}</b></span>
        <span class="chip">👣 ステップ数 <b>${s.toolCalls}</b></span>
        <span class="chip">📂 ファイル操作 <b>${fileOps}</b></span>
        <span class="chip">🙋 あなたの指示 <b>${s.userMessages}</b></span>
        <span class="chip">🕒 最終活動 <b>${fmtAgoJa(s.mtimeMs)}</b></span>
      </div>
      <div class="pulse-wrap">
        <div class="pulse-label">活動の波（最近の動きの多さ）</div>
        <div class="pulse-bars">${pulseBars(s.feed)}</div>
      </div>
      <div class="scard-log">
        <div class="log-head">やったこと（新しい順）</div>
        ${logs || '<div class="log-item">まだ記録がありません</div>'}
      </div>
    </div>`;
}

function renderSimple(data) {
  const { sessions, stats } = data;
  let working = 0;
  let waiting = 0;
  const live = [];
  const stopped = [];
  for (const s of sessions) {
    const k = statusPlain(s).key;
    if (k === 'working') working += 1;
    if (k === 'waiting') waiting += 1;
    if (k === 'stopped') stopped.push(s);
    else live.push(s);
  }

  // Summary banner
  document.getElementById('simple-summary').innerHTML = `
    <div class="sum-item working"><span class="sum-num">${working}</span><span class="sum-lbl">件が作業中</span></div>
    <div class="sum-item waiting"><span class="sum-num">${waiting}</span><span class="sum-lbl">件があなたの返信待ち</span></div>
    <div class="sum-item"><span class="sum-num">${sessions.length}</span><span class="sum-lbl">件を記録中</span></div>
    <div class="sum-spacer"></div>
    <div class="sum-money">これまでの推定利用料金 <b>${fmtMoney(stats.totalCost)}</b></div>`;

  // Cards: live (working / waiting) first, then a compact list of stopped ones.
  const listEl = document.getElementById('simple-list');
  let html = '';
  if (live.length) {
    html += live.map(simpleCard).join('');
  } else {
    html +=
      '<div class="simple-empty">いま動いているセッションはありません。<br>Claude Code で作業を始めると、ここにリアルタイムで表示されます。</div>';
  }

  if (stopped.length) {
    html += `<div class="simple-divider">── 停止中のセッション（${stopped.length}件）──</div>`;
    const shown = stopped.slice(0, 8);
    html += shown
      .map(
        (s) => `
        <div class="scard-compact">
          <span class="status-pill stopped">⚪ 停止中</span>
          <span class="scard-proj">${esc(s.project || '—')}</span>
          <span class="muted">最後の活動: ${fmtAgoJa(s.mtimeMs)} ・ ${fmtMoney(s.cost)}</span>
        </div>`
      )
      .join('');
    if (stopped.length > shown.length) {
      html += `<div class="simple-divider">ほか ${stopped.length - shown.length} 件</div>`;
    }
  }
  listEl.innerHTML = html;
}

// ░░ Rendering ░░
function render(data) {
  if (!data || data.error) return;
  latest = data;
  const { sessions, stats } = data;

  // auto-select most relevant session until the user pins one
  if (!userPinned || !sessions.some((s) => s.sessionId === selectedId)) {
    const active = sessions.find((s) => s.status === 'active');
    selectedId = (active || sessions[0] || {}).sessionId || null;
  }

  renderRibbon(stats);
  renderSessions(sessions);
  renderTicker(stats.feed);
  renderTools(stats.toolDistribution, stats.totalToolCalls);
  renderFeed(stats.feed);

  const sel = sessions.find((s) => s.sessionId === selectedId) || null;
  renderDetail(sel);
  renderCycle(sel);
  drawCostChart(sel);

  renderSimple(data);
}

function setMode(m) {
  mode = m;
  document.body.classList.toggle('mode-simple', m === 'simple');
  document.body.classList.toggle('mode-detail', m === 'detail');
  document
    .querySelectorAll('.mode-btn')
    .forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
  if (latest) render(latest);
}

function renderRibbon(s) {
  document.getElementById('s-active').textContent = s.active;
  document.getElementById('s-total').textContent = s.totalSessions;
  document.getElementById('s-projects').textContent = s.projectCount;
  document.getElementById('s-cost').textContent = fmtCost(s.totalCost);
  document.getElementById('s-tokens').textContent = fmtTokens(s.tokens.total);
  document.getElementById('s-tools').textContent = s.totalToolCalls.toLocaleString();
  document.getElementById('s-msgs').textContent = s.totalMessages.toLocaleString();

  const dot = document.getElementById('live-dot');
  if (s.active > 0) dot.classList.remove('stale');
  else dot.classList.add('stale');
}

function renderSessions(sessions) {
  const body = document.getElementById('sessions-body');
  document.getElementById('sessions-count').textContent = `${sessions.length} tracked`;
  body.innerHTML = sessions
    .map((s) => {
      const act = s.status === 'active' ? s.currentActivity.state : 'idle';
      const actLabel = ACTIVITY_LABEL[act] || act.toUpperCase();
      const actClass = ACTIVITY_CLASS[s.currentActivity.state] || '';
      const detail = s.status === 'active' ? esc(s.currentActivity.detail || '') : '';
      return `
      <div class="session-row ${s.sessionId === selectedId ? 'selected' : ''}" data-id="${s.sessionId}">
        <span class="dot ${s.status}"></span>
        <span class="s-name">
          <span class="s-proj">${esc(s.project || '—')}</span>
          <span class="s-title">${esc(s.title || '')}</span>
        </span>
        <span class="badge ${modelClass(s.model)}">${modelShort(s.model)}</span>
        <span class="s-activity ${actClass}">
          <span class="act-tag">${actLabel}</span>
          <span class="act-detail">${detail}</span>
        </span>
        <span class="num dim">${s.totalMessages}</span>
        <span class="num">${fmtTokens(s.tokens.total)}</span>
        <span class="num cost">${fmtCost(s.cost)}</span>
        <span class="num dim">${fmtAge(s.ageMs)}</span>
      </div>`;
    })
    .join('');

  body.querySelectorAll('.session-row').forEach((row) => {
    row.addEventListener('click', () => {
      selectedId = row.dataset.id;
      userPinned = true;
      render(latest);
    });
  });
}

function renderDetail(s) {
  const el = document.getElementById('detail-body');
  document.getElementById('detail-id').textContent = s ? s.sessionId.slice(0, 8) : '—';
  if (!s) {
    el.innerHTML = '<div class="empty">No session selected</div>';
    return;
  }
  const t = s.tokens;
  const total = t.total || 1;
  const pct = (n) => ((n / total) * 100).toFixed(1) + '%';
  el.innerHTML = `
    <div class="detail-title">${esc(s.title || s.project)}</div>
    <div class="detail-path" id="detail-open" title="Reveal in Finder">${esc(s.cwd || '')}${s.gitBranch ? '  ⑂ ' + esc(s.gitBranch) : ''}</div>
    <div class="kv-grid">
      <div class="kv"><span class="k">MODEL</span><span class="v">${modelShort(s.model)}</span></div>
      <div class="kv"><span class="k">EST. COST</span><span class="v green">${fmtCost(s.cost)}</span></div>
      <div class="kv"><span class="k">MESSAGES</span><span class="v">${s.totalMessages} <span style="color:var(--ink-faint);font-size:10px">(${s.userMessages}u / ${s.assistantMessages}a)</span></span></div>
      <div class="kv"><span class="k">TOOL CALLS</span><span class="v amber">${s.toolCalls}</span></div>
      <div class="kv"><span class="k">DURATION</span><span class="v">${fmtAge(s.durationMs)}</span></div>
      <div class="kv"><span class="k">LAST EVENT</span><span class="v">${fmtAge(s.ageMs)} ago</span></div>
    </div>
    <div class="tokenbar">
      <span class="tb-in" style="width:${pct(t.input)}"></span>
      <span class="tb-out" style="width:${pct(t.output)}"></span>
      <span class="tb-cw" style="width:${pct(t.cacheWrite)}"></span>
      <span class="tb-cr" style="width:${pct(t.cacheRead)}"></span>
    </div>
    <div class="token-legend">
      <span><i class="tb-in"></i>in ${fmtTokens(t.input)}</span>
      <span><i class="tb-out"></i>out ${fmtTokens(t.output)}</span>
      <span><i class="tb-cw"></i>cache-w ${fmtTokens(t.cacheWrite)}</span>
      <span><i class="tb-cr"></i>cache-r ${fmtTokens(t.cacheRead)}</span>
    </div>`;

  const open = document.getElementById('detail-open');
  if (open) open.addEventListener('click', () => window.monitor.openPath(s.cwd));
}

const CYCLE_STEPS = [
  { key: 'awaiting', label: 'Await' },
  { key: 'thinking', label: 'Think' },
  { key: 'running', label: 'Tool' },
  { key: 'processing', label: 'Result' },
  { key: 'responding', label: 'Reply' },
];
function renderCycle(s) {
  const el = document.getElementById('cycle');
  const state = s && s.status === 'active' ? s.currentActivity.state : 'idle';
  document.getElementById('cycle-state').textContent = s ? (ACTIVITY_LABEL[state] || state) : '—';
  el.innerHTML = CYCLE_STEPS.map((step, i) => {
    const on = step.key === state ? 'on' : '';
    const arrow = i < CYCLE_STEPS.length - 1 ? '<span class="cycle-arrow">▸</span>' : '';
    return `<div class="cycle-step ${on}"><span class="step-no">0${i + 1}</span>${step.label}</div>${arrow}`;
  }).join('');
}

function renderTools(dist, totalCalls) {
  const el = document.getElementById('tools-bars');
  document.getElementById('tools-meta').textContent = `${(totalCalls || 0).toLocaleString()} calls`;
  const entries = Object.entries(dist || {}).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const max = entries.length ? entries[0][1] : 1;
  if (!entries.length) {
    el.innerHTML = '<div class="empty">No tool calls yet</div>';
    return;
  }
  el.innerHTML = entries
    .map(
      ([name, n]) => `
      <div class="tool-row">
        <span class="t-name">${esc(name)}</span>
        <span class="t-track"><span class="t-fill" style="width:${((n / max) * 100).toFixed(1)}%"></span></span>
        <span class="t-count">${n}</span>
      </div>`
    )
    .join('');
}

function renderFeed(feed) {
  const el = document.getElementById('feed');
  document.getElementById('feed-meta').textContent = `${feed.length} events`;
  el.innerHTML = (feed || [])
    .map(
      (f) => `
      <div class="feed-row">
        <span class="f-time">${hhmmss(f.ts)}</span>
        <span class="f-kind ${f.kind}">${esc(f.label)}</span>
        <span class="f-proj">${esc(f.project || '')}</span>
        <span class="f-detail">${esc(f.detail || '')}</span>
      </div>`
    )
    .join('');
}

function renderTicker(feed) {
  const track = document.getElementById('ticker-track');
  const items = (feed || []).slice(0, 24);
  if (!items.length) {
    track.innerHTML = '<span class="ticker-item">awaiting activity…</span>';
    return;
  }
  const html = items
    .map(
      (f) =>
        `<span class="ticker-item"><span class="tk-tool">${esc(f.label)}</span> <b>${esc(f.project || '')}</b> ${esc(f.detail || '')}</span>`
    )
    .join('');
  track.innerHTML = html + html; // duplicate for seamless loop
  startTickerAnim();
}

let tickerRAF = null;
let tickerX = 0;
function startTickerAnim() {
  const track = document.getElementById('ticker-track');
  const container = document.getElementById('ticker');
  if (tickerRAF) cancelAnimationFrame(tickerRAF);
  const half = track.scrollWidth / 2;
  if (tickerX === 0) tickerX = container.clientWidth;
  const step = () => {
    tickerX -= 0.6;
    if (half > 0 && tickerX <= -half) tickerX += half;
    track.style.left = tickerX + 'px';
    tickerRAF = requestAnimationFrame(step);
  };
  step();
}

// ░░ Cost chart (cumulative, selected session) ░░
function drawCostChart(s) {
  const canvas = document.getElementById('chart-cost');
  const meta = document.getElementById('chart-cost-meta');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 300;
  const h = canvas.clientHeight || 120;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const series = (s && s.costSeries) || [];
  meta.textContent = s ? fmtCost(s.cost) : '$0';

  // baseline grid
  ctx.strokeStyle = 'rgba(120,130,90,0.08)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = (h / 4) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  if (series.length < 2) {
    ctx.fillStyle = '#595e49';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('insufficient data', 10, h / 2);
    return;
  }

  const pad = 6;
  const t0 = series[0].ts;
  const t1 = series[series.length - 1].ts || t0 + 1;
  const maxCost = series[series.length - 1].cost || 1;
  const x = (t) => pad + ((t - t0) / (t1 - t0 || 1)) * (w - pad * 2);
  const y = (c) => h - pad - (c / maxCost) * (h - pad * 2);

  // area
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(121,208,90,0.35)');
  grad.addColorStop(1, 'rgba(121,208,90,0.02)');
  ctx.beginPath();
  ctx.moveTo(x(t0), h - pad);
  for (const p of series) ctx.lineTo(x(p.ts), y(p.cost));
  ctx.lineTo(x(t1), h - pad);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // line
  ctx.beginPath();
  series.forEach((p, i) => (i ? ctx.lineTo(x(p.ts), y(p.cost)) : ctx.moveTo(x(p.ts), y(p.cost))));
  ctx.strokeStyle = '#79d05a';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // last point marker
  const last = series[series.length - 1];
  ctx.fillStyle = '#79d05a';
  ctx.beginPath();
  ctx.arc(x(last.ts), y(last.cost), 2.5, 0, Math.PI * 2);
  ctx.fill();
}

// ░░ Clock ░░
function tickClock() {
  const now = new Date();
  document.getElementById('clock-local').textContent = clockTime(now);
  const utc = `UTC ${two(now.getUTCHours())}:${two(now.getUTCMinutes())}`;
  document.getElementById('clock-utc').textContent = utc;
}

// ░░ Boot ░░
async function boot() {
  document.body.classList.add('mode-simple');
  document.getElementById('mode-toggle').addEventListener('click', (e) => {
    const btn = e.target.closest('.mode-btn');
    if (btn) setMode(btn.dataset.mode);
  });

  tickClock();
  setInterval(tickClock, 1000);

  try {
    const data = await window.monitor.getSessions();
    render(data);
  } catch (e) {
    console.error(e);
  }

  window.monitor.onUpdate((data) => render(data));
  window.monitor.onError((msg) => console.error('scan error:', msg));
  window.addEventListener('resize', () => {
    if (latest) drawCostChart(latest.sessions.find((s) => s.sessionId === selectedId));
  });
}

boot();
