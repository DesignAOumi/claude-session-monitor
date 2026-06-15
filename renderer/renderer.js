'use strict';

// ░░ State ░░
let latest = null;
let selectedId = null;
let userPinned = false; // true once the user clicks a row

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
