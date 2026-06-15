'use strict';

// ░░ State ░░
let latest = null;
let selectedId = null;
let userPinned = false; // true once the user clicks a row
let mode = 'simple'; // 'simple' (beginner) | 'detail' (technical)
let simpleSelection = []; // sessionIds shown in the beginner detail area (1, or up to 2 when split)
let splitMode = false; // show two session details side by side

// ░░ Billing (actual cost the user is really paying) ░░
// Token-based cost is intentionally NOT shown — Claude Code transcripts don't
// record real charges. The user enters their flat plan fee + any extra below.
const BILLING_DEFAULT = { currency: 'jpy', plan: 3100, additional: 0 }; // ≈ Pro $20/mo
let billing = loadBilling();

function loadBilling() {
  try {
    const raw = localStorage.getItem('cm_billing');
    if (raw) return { ...BILLING_DEFAULT, ...JSON.parse(raw) };
  } catch {}
  return { ...BILLING_DEFAULT };
}
function saveBilling(b) {
  billing = b;
  try {
    localStorage.setItem('cm_billing', JSON.stringify(b));
  } catch {}
}
const curSign = (c) => (c === 'usd' ? '$' : '¥');
const fmtAmount = (n, c = billing.currency) => {
  const v = Number(n) || 0;
  return c === 'usd' ? '$' + v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : '¥' + Math.round(v).toLocaleString();
};
// Headline actual cost = plan + additional (a fixed monthly figure).
const actualTotal = () => (Number(billing.plan) || 0) + (Number(billing.additional) || 0);
const fmtActual = () => fmtAmount(actualTotal());

// ░░ Plan usage (countdowns auto, percentages/credits entered by the user) ░░
const USAGE_DEFAULT = {
  sessionPct: null,
  weekPct: null,
  weekday: 4, // Thu (matches the desktop app default)
  weekhour: 3,
  routineUsed: 0,
  routineTotal: 5,
  creditUsed: null,
  creditLimit: null,
  creditBalance: null,
  creditReset: '',
};
let usage = loadUsage();
let usageWindow = null; // latest 5h-window info from the scanner (for live countdown)

function loadUsage() {
  try {
    const raw = localStorage.getItem('cm_usage');
    if (raw) return { ...USAGE_DEFAULT, ...JSON.parse(raw) };
  } catch {}
  return { ...USAGE_DEFAULT };
}
function saveUsage(u) {
  usage = u;
  try {
    localStorage.setItem('cm_usage', JSON.stringify(u));
  } catch {}
}

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];
const barLevel = (pct) => (pct >= 85 ? 'lvl-high' : pct >= 50 ? 'lvl-mid' : '');

function fmtCountdown(ms) {
  if (ms == null) return '—';
  if (ms <= 0) return 'まもなくリセット';
  let s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  s %= 86400;
  const h = Math.floor(s / 3600);
  s %= 3600;
  const m = Math.floor(s / 60);
  s %= 60;
  const hms = `${two(h)}:${two(m)}:${two(s)}`;
  return d > 0 ? `${d}日 ${hms}` : hms;
}
function nextWeeklyReset(weekday, hour) {
  const now = new Date();
  const r = new Date(now);
  r.setHours(hour || 0, 0, 0, 0);
  let diff = (weekday - now.getDay() + 7) % 7;
  if (diff === 0 && r.getTime() <= now.getTime()) diff = 7;
  r.setDate(now.getDate() + diff);
  return r.getTime();
}

// ░░ Formatters ░░
const fmtTokens = (n) => {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n | 0);
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
  if (s.status === 'active' && st !== 'responding') {
    return { key: 'working', emoji: '🟢', label: '作業中' };
  }
  // Ended on a reply (Claude is awaiting you). Keep it as "waiting" for up to 1h
  // so the task list doesn't disappear the moment it goes idle.
  if (st === 'responding' && s.ageMs < 60 * 60000) {
    return { key: 'waiting', emoji: '🟡', label: 'あなたの返信待ち' };
  }
  if (s.status === 'active') return { key: 'working', emoji: '🟢', label: '作業中' };
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
      return { emoji: '💬', text: '返事を書いています', detail: detail };
    case 'processing':
      return { emoji: '⚙️', text: '結果を確認しています', detail: detail };
    case 'awaiting':
      return { emoji: '📥', text: '指示を受け取りました', detail: detail };
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
      return { emoji: '🙋', txt: 'あなたの指示', detail: item.detail || '' };
    case 'assistant':
      return { emoji: '💬', txt: 'Claudeの返信', detail: item.detail || '' };
    case 'result': {
      const d = item.tool ? toolDesc(item.tool) : null;
      const txt = d ? d.past.replace(/しました$/, '結果を確認') : '結果を受け取りました';
      const detail = [item.target, item.detail].filter(Boolean).join(' → ');
      return { emoji: d ? d.emoji : '✅', txt, detail };
    }
    case 'error': {
      const detail = [item.target, item.detail].filter(Boolean).join(' → ');
      return { emoji: '⚠️', txt: 'エラーが発生', detail };
    }
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

// Which detail blocks are expanded to full text (persists across re-renders).
const expandedKeys = new Set();

// Checked task items — purely visual, no action; persisted so checks survive restarts.
const checkedKeys = new Set(loadChecked());
function loadChecked() {
  try {
    const raw = localStorage.getItem('cm_checked');
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}
function saveChecked() {
  try {
    localStorage.setItem('cm_checked', JSON.stringify([...checkedKeys]));
  } catch {}
}
const checkKey = (sessionId, text) => `${sessionId}::${String(text).trim().slice(0, 80)}`;

// Split Claude's last reply into 確認事項 (questions to answer) and やること (to-dos).
function parseWaiting(text) {
  const { intro, items } = parseTasks(text);
  const isQuestion = (s) =>
    /[?？]\s*$/.test(s) || /(ですか|ますか|でしょうか|どちら|どれ|いずれ|いかが)/.test(s);
  const questions = [];
  const todos = [];
  if (intro && isQuestion(intro)) questions.push(intro);
  for (const it of items) (isQuestion(it) ? questions : todos).push(it);
  return { intro, questions, todos, hasList: items.length > 0 };
}

// Render a collapsible full-text block with a もっと見る / とじる toggle.
function expandable(key, text) {
  const t = String(text || '');
  const exp = expandedKeys.has(key);
  const long = t.length > 70 || /\n/.test(t);
  return `<div class="exp-group">
      <div class="expandable ${exp ? 'expanded' : ''}">${esc(t)}</div>
      ${long ? `<button class="log-more" data-key="${esc(key)}">${exp ? '▲ とじる' : '▼ もっと見る（全文）'}</button>` : ''}
    </div>`;
}

// Pull bullet / numbered list items out of Claude's last reply for the task list.
function parseTasks(text) {
  if (!text) return { intro: '', items: [] };
  const lines = String(text).split(/\r?\n/);
  const bullet = /^\s*(?:[-*・▢□☐✓·]|[0-9０-９]{1,2}[.)、:]|[①-⑳]|[(（][0-9a-zA-Zａ-ｚ][)）])\s*(.+)$/;
  const items = [];
  const introLines = [];
  let started = false;
  for (const ln of lines) {
    const m = ln.match(bullet);
    if (m) {
      started = true;
      const t = m[1].trim();
      if (t) items.push(t);
    } else if (!started && ln.trim()) {
      introLines.push(ln.trim());
    }
  }
  return { intro: introLines.join(' ').slice(0, 280), items: items.slice(0, 12) };
}

function simpleCard(s) {
  const st = statusPlain(s);
  const waiting = st.key === 'waiting';
  const act = waiting
    ? { emoji: '✋', text: 'あなたの返答を待っています', detail: '' }
    : activityPlain(s);
  const fileOps =
    (s.tools.Read || 0) + (s.tools.Edit || 0) + (s.tools.Write || 0) + (s.tools.NotebookEdit || 0);

  const logs = [...s.feed]
    .reverse()
    .slice(0, 8)
    .map((item, idx) => {
      const p = feedPlain(item);
      const key = `${s.sessionId}|log|${item.ts || ''}|${idx}`;
      return `<div class="log-item">
        <span class="log-emoji">${p.emoji}</span>
        <div class="log-body">
          <div class="log-line"><span class="log-tag">${esc(p.txt)}</span><span class="log-time">${fmtAgoJa(item.ts)}</span></div>
          ${p.detail ? expandable(key, p.detail) : ''}
        </div>
      </div>`;
    })
    .join('');

  // Task-list block shown only while Claude is waiting on the user.
  let pending = '';
  if (waiting) {
    const { questions, todos, hasList } = parseWaiting(s.lastAssistantText);

    const confirmHtml = questions.length
      ? `<div class="sect-label confirm">❓ 確認事項（あなたの返答が必要）</div>
         <div class="confirm-list">${questions
           .map((q) => `<div class="confirm-item">${esc(q)}</div>`)
           .join('')}</div>`
      : '';

    const todoHtml = todos.length
      ? `<div class="sect-label todo">✅ やることリスト</div>
         <div class="task-list">${todos
           .map((it) => {
             const k = checkKey(s.sessionId, it);
             const on = checkedKeys.has(k);
             return `<div class="task-item ${on ? 'checked' : ''}" data-check="${esc(k)}">
                <span class="task-box">${on ? '☑' : '☐'}</span>
                <span class="task-txt">${esc(it)}</span>
              </div>`;
           })
           .join('')}</div>`
      : '';

    // Fallback: a prose message with no parsable list/question.
    const fallback =
      !questions.length && !todos.length
        ? `<div class="sect-label confirm">❓ 確認事項</div>
           <div class="confirm-list"><div class="confirm-item">${esc(
             (s.lastAssistantText || '（本文なし）').slice(0, 240)
           )}</div></div>`
        : '';

    pending = `
      <div class="pending-box">
        <div class="pending-head">✋ あなたの返答・指示を待っています</div>
        ${confirmHtml}
        ${todoHtml}
        ${fallback}
        <div class="pending-msg">
          <div class="pending-msg-label">Claudeからのメッセージ（全文）</div>
          ${expandable(`${s.sessionId}|pending`, s.lastAssistantText || '（本文なし）')}
        </div>
      </div>`;
  }

  return `
    <div class="scard ${st.key}">
      <div class="scard-top">
        <span class="status-pill ${st.key}">${st.emoji} ${st.label}</span>
        <span class="scard-proj">${esc(s.project || '—')}</span>
      </div>
      <div class="scard-title">いま取り組んでいること: <b>${esc(s.title || s.project || '—')}</b></div>
      <div class="scard-now">
        <span class="now-icon">${act.emoji}</span>
        <span class="now-text">${esc(act.text)}</span>
        ${act.detail ? `<span class="now-detail">${esc(act.detail)}</span>` : ''}
      </div>
      ${pending}
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
  const workingList = [];
  const waitingList = [];
  const stopped = [];
  for (const s of sessions) {
    const k = statusPlain(s).key;
    if (k === 'working') workingList.push(s);
    else if (k === 'waiting') waitingList.push(s);
    else stopped.push(s);
  }
  const working = workingList.length;
  const waiting = waitingList.length;

  // Summary banner
  document.getElementById('simple-summary').innerHTML = `
    <div class="sum-item working"><span class="sum-num">${working}</span><span class="sum-lbl">件が作業中</span></div>
    <div class="sum-item waiting"><span class="sum-num">${waiting}</span><span class="sum-lbl">件があなたの返信待ち</span></div>
    <div class="sum-item"><span class="sum-num">${sessions.length}</span><span class="sum-lbl">件を記録中</span></div>
    <div class="sum-spacer"></div>
    <div class="sum-money">今月の料金（実額） <b>${fmtActual()}</b><br>
      <span style="font-size:11px">プラン ${fmtAmount(billing.plan)}${(Number(billing.additional) || 0) > 0 ? ' ＋ 追加 ' + fmtAmount(billing.additional) : ''}　<a id="sum-edit" style="color:var(--amber);cursor:pointer">変更</a></span>
    </div>`;
  const sumEdit = document.getElementById('sum-edit');
  if (sumEdit) sumEdit.addEventListener('click', openSettings);

  // Non-stopped sessions become a horizontal chip bar; selecting one shows its
  // detail below. Up to 2 can be shown side by side when split view is on.
  const listEl = document.getElementById('simple-list');
  const liveSessions = [...workingList, ...waitingList]; // running first
  const liveIds = new Set(liveSessions.map((s) => s.sessionId));
  const allIds = new Set(sessions.map((s) => s.sessionId));

  // Keep a selected session open until it truly disappears (its file is gone) —
  // do NOT drop it just because it went idle, so the detail you're reading stays
  // open until the session actually ends.
  simpleSelection = simpleSelection.filter((id) => allIds.has(id));
  if (!simpleSelection.length && liveSessions.length) simpleSelection = [liveSessions[0].sessionId];
  if (!splitMode && simpleSelection.length > 1) simpleSelection = simpleSelection.slice(0, 1);

  // Chips: live sessions, plus any selected session that has since gone idle (pinned open).
  const chipSessions = [...liveSessions];
  for (const id of simpleSelection) {
    if (!liveIds.has(id)) {
      const s = sessions.find((x) => x.sessionId === id);
      if (s) chipSessions.push(s);
    }
  }

  let html = '';

  if (chipSessions.length) {
    const chips = chipSessions
      .map((s) => {
        const stp = statusPlain(s);
        const sel = simpleSelection.includes(s.sessionId);
        const a =
          stp.key === 'working' ? activityPlain(s) : { emoji: stp.key === 'waiting' ? '✋' : '📌' };
        const order = sel ? simpleSelection.indexOf(s.sessionId) + 1 : 0;
        return `<button class="live-chip ${stp.key} ${sel ? 'sel' : ''}" data-chip="${s.sessionId}" title="${esc(s.title || s.project || '')}">
            <span class="chip-dot ${stp.key}"></span>
            <span class="chip-proj">${esc(s.project || '—')}</span>
            <span class="chip-act">${a.emoji}</span>
            ${splitMode && order ? `<span class="chip-order">${order}</span>` : ''}
          </button>`;
      })
      .join('');

    html += `
      <div class="live-bar">
        <div class="live-bar-head">
          <span class="live-bar-title">🟢 稼働中・返信待ち（クリックで詳細）・${chipSessions.length}件</span>
          <button class="split-btn ${splitMode ? 'on' : ''}" id="split-btn">分割表示 ${splitMode ? 'ON' : 'OFF'}</button>
        </div>
        <div class="live-chips">${chips}</div>
      </div>`;

    const toShow = (splitMode ? simpleSelection.slice(0, 2) : simpleSelection.slice(0, 1))
      .map((id) => sessions.find((s) => s.sessionId === id))
      .filter(Boolean);
    const cards = toShow.length
      ? toShow.map(simpleCard).join('')
      : '<div class="simple-empty">上のセッションを選ぶと、ここに詳細が表示されます。</div>';
    html += `<div class="detail-area ${splitMode ? 'split' : ''}">${cards}</div>`;
  } else {
    html +=
      '<div class="simple-empty">いま動いているセッションはありません。<br>Claude Code で作業を始めると、ここにリアルタイムで表示されます。</div>';
  }

  const stoppedRest = stopped.filter((s) => !simpleSelection.includes(s.sessionId));
  if (stoppedRest.length) {
    html += `<div class="simple-divider">── 停止中のセッション（${stoppedRest.length}件）──</div>`;
    const shown = stoppedRest.slice(0, 8);
    html += shown
      .map(
        (s) => `
        <div class="scard-compact">
          <span class="status-pill stopped">⚪ 停止中</span>
          <span class="scard-proj">${esc(s.project || '—')}</span>
          <span class="muted">最後の活動: ${fmtAgoJa(s.mtimeMs)}</span>
        </div>`
      )
      .join('');
    if (stoppedRest.length > shown.length) {
      html += `<div class="simple-divider">ほか ${stoppedRest.length - shown.length} 件</div>`;
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
  usageWindow = data.stats.sessionWindow || null;
  renderUsageStrip();
}

function renderUsageStrip() {
  const sp = usage.sessionPct;
  const wp = usage.weekPct;
  const cUsed = Number(usage.creditUsed);
  const cLimit = Number(usage.creditLimit);
  const creditPct = cLimit > 0 ? (cUsed / cLimit) * 100 : null;
  const winInfo = usageWindow
    ? `枠内 ${usageWindow.msgCount}通 / ${fmtTokens(usageWindow.outTokens)} 生成`
    : 'アクティブな枠なし';

  const pctCell = (label, pct, subHtml, barExtra = '') => {
    const has = pct != null && pct !== '' && !Number.isNaN(Number(pct));
    const w = has ? Math.min(100, Number(pct)) : 0;
    const lvl = has ? barLevel(Number(pct)) : '';
    return `<div class="ug">
      <div class="ug-top"><span class="ug-label">${label}</span><span class="ug-pct">${has ? Number(pct) + '%' : '—'}</span></div>
      <div class="ug-bar ${lvl} ${barExtra}"><span style="width:${w}%"></span></div>
      <div class="ug-sub">${subHtml}</div>
    </div>`;
  };

  const creditSub = (() => {
    if (cLimit > 0 || cUsed > 0) {
      const bal = Number(usage.creditBalance);
      const hasBal = usage.creditBalance !== null && usage.creditBalance !== '' && !Number.isNaN(bal);
      const resetTxt = usage.creditReset ? ` ・ ${usage.creditReset} リセット` : '';
      return `$${(cUsed || 0).toFixed(2)} / $${(cLimit || 0).toFixed(0)}${hasBal ? ` ・ 残高 $${bal.toFixed(2)}` : ''}${resetTxt}`;
    }
    return '未設定（編集から入力）';
  })();

  const routinePct = usage.routineTotal > 0 ? (usage.routineUsed / usage.routineTotal) * 100 : 0;

  document.getElementById('usage-strip').innerHTML =
    pctCell('現在のセッション (5h)', sp, `⏳ リセットまで <b id="cd-session">—</b>`) +
    pctCell('週間制限', wp, `⏳ <b id="cd-week">—</b> (${WEEKDAY_JA[usage.weekday]} ${usage.weekhour}:00)`) +
    pctCell('利用クレジット', creditPct != null ? Math.round(creditPct) : null, creditSub, creditPct > 100 ? 'over' : '') +
    `<div class="ug">
      <div class="ug-top"><span class="ug-label">ルーティン/日</span><span class="ug-pct">${usage.routineUsed}/${usage.routineTotal}</span></div>
      <div class="ug-bar ${barLevel(routinePct)}"><span style="width:${Math.min(100, routinePct)}%"></span></div>
      <div class="ug-sub">${winInfo}</div>
    </div>` +
    `<button class="ug-edit" id="usage-edit">⚙ 編集</button>`;

  const ue = document.getElementById('usage-edit');
  if (ue) ue.addEventListener('click', openSettings);
  updateCountdowns();
}

function updateCountdowns() {
  const cdS = document.getElementById('cd-session');
  if (cdS) {
    const rem = usageWindow && !usageWindow.expired ? usageWindow.resetTs - Date.now() : null;
    cdS.textContent = usageWindow ? fmtCountdown(rem) : 'アクティブな枠なし';
    const sub = cdS.closest('.ug-sub');
    if (sub) sub.classList.toggle('urgent', rem != null && rem < 15 * 60000);
  }
  const cdW = document.getElementById('cd-week');
  if (cdW) cdW.textContent = fmtCountdown(nextWeeklyReset(usage.weekday, usage.weekhour) - Date.now());
}

// ░░ Settings modal ░░
let formCurrency = billing.currency;
function refreshFormSigns() {
  const sign = curSign(formCurrency);
  document.getElementById('sign-plan').textContent = sign;
  document.getElementById('sign-add').textContent = sign;
  document
    .querySelectorAll('#cur-seg .seg-btn')
    .forEach((b) => b.classList.toggle('active', b.dataset.cur === formCurrency));
  const plan = parseFloat(document.getElementById('in-plan').value) || 0;
  const add = parseFloat(document.getElementById('in-add').value) || 0;
  document.getElementById('form-total').textContent =
    '合計: ' + fmtAmount(plan + add, formCurrency);
}
const setVal = (id, v) => {
  const el = document.getElementById(id);
  if (el) el.value = v == null ? '' : v;
};
function openSettings() {
  formCurrency = billing.currency;
  setVal('in-plan', billing.plan);
  setVal('in-add', billing.additional);
  // usage manual fields
  setVal('u-session', usage.sessionPct);
  setVal('u-week', usage.weekPct);
  setVal('u-weekday', usage.weekday);
  setVal('u-weekhour', usage.weekhour);
  setVal('u-routine-used', usage.routineUsed);
  setVal('u-routine-total', usage.routineTotal);
  setVal('u-credit-used', usage.creditUsed);
  setVal('u-credit-limit', usage.creditLimit);
  setVal('u-credit-balance', usage.creditBalance);
  setVal('u-credit-reset', usage.creditReset);
  refreshFormSigns();
  document.getElementById('settings-overlay').classList.add('open');
}
function closeSettings() {
  document.getElementById('settings-overlay').classList.remove('open');
}
function wireSettings() {
  document.getElementById('gear-btn').addEventListener('click', openSettings);
  document.getElementById('settings-cancel').addEventListener('click', closeSettings);
  document.getElementById('settings-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'settings-overlay') closeSettings();
  });
  document.getElementById('cur-seg').addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn');
    if (b) {
      formCurrency = b.dataset.cur;
      refreshFormSigns();
    }
  });
  document.getElementById('in-plan').addEventListener('input', refreshFormSigns);
  document.getElementById('in-add').addEventListener('input', refreshFormSigns);
  document.getElementById('settings-save').addEventListener('click', () => {
    saveBilling({
      currency: formCurrency,
      plan: parseFloat(document.getElementById('in-plan').value) || 0,
      additional: parseFloat(document.getElementById('in-add').value) || 0,
    });
    const numOrNull = (id) => {
      const v = document.getElementById(id).value;
      return v === '' ? null : parseFloat(v);
    };
    saveUsage({
      sessionPct: numOrNull('u-session'),
      weekPct: numOrNull('u-week'),
      weekday: parseInt(document.getElementById('u-weekday').value, 10) || 0,
      weekhour: parseInt(document.getElementById('u-weekhour').value, 10) || 0,
      routineUsed: parseInt(document.getElementById('u-routine-used').value, 10) || 0,
      routineTotal: parseInt(document.getElementById('u-routine-total').value, 10) || 0,
      creditUsed: numOrNull('u-credit-used'),
      creditLimit: numOrNull('u-credit-limit'),
      creditBalance: numOrNull('u-credit-balance'),
      creditReset: document.getElementById('u-credit-reset').value || '',
    });
    closeSettings();
    if (latest) render(latest);
  });
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
  document.getElementById('s-cost').textContent = fmtActual();
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
        <span class="num">${s.toolCalls}</span>
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
      <div class="kv"><span class="k">STATUS</span><span class="v">${ACTIVITY_LABEL[s.status === 'active' ? s.currentActivity.state : 'idle'] || s.status}</span></div>
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

  const series = (s && s.usageSeries) || [];
  meta.textContent = s ? fmtTokens(s.tokens.output) + ' 生成' : '0';

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
  const maxTok = series[series.length - 1].tokens || 1;
  const x = (t) => pad + ((t - t0) / (t1 - t0 || 1)) * (w - pad * 2);
  const y = (c) => h - pad - (c / maxTok) * (h - pad * 2);

  // area
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(121,208,90,0.35)');
  grad.addColorStop(1, 'rgba(121,208,90,0.02)');
  ctx.beginPath();
  ctx.moveTo(x(t0), h - pad);
  for (const p of series) ctx.lineTo(x(p.ts), y(p.tokens));
  ctx.lineTo(x(t1), h - pad);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // line
  ctx.beginPath();
  series.forEach((p, i) => (i ? ctx.lineTo(x(p.ts), y(p.tokens)) : ctx.moveTo(x(p.ts), y(p.tokens))));
  ctx.strokeStyle = '#79d05a';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // last point marker
  const last = series[series.length - 1];
  ctx.fillStyle = '#79d05a';
  ctx.beginPath();
  ctx.arc(x(last.ts), y(last.tokens), 2.5, 0, Math.PI * 2);
  ctx.fill();
}

// ░░ Clock ░░
function tickClock() {
  const now = new Date();
  document.getElementById('clock-local').textContent = clockTime(now);
  const utc = `UTC ${two(now.getUTCHours())}:${two(now.getUTCMinutes())}`;
  document.getElementById('clock-utc').textContent = utc;
  updateCountdowns();
}

// ░░ Boot ░░
async function boot() {
  document.body.classList.add('mode-simple');
  document.getElementById('mode-toggle').addEventListener('click', (e) => {
    const btn = e.target.closest('.mode-btn');
    if (btn) setMode(btn.dataset.mode);
  });
  wireSettings();

  // Event delegation on the stable list: chips, split toggle, expand, checkboxes.
  document.getElementById('simple-list').addEventListener('click', (e) => {
    const splitBtn = e.target.closest('#split-btn');
    if (splitBtn) {
      splitMode = !splitMode;
      if (!splitMode) simpleSelection = simpleSelection.slice(0, 1);
      if (latest) renderSimple(latest);
      return;
    }
    const chip = e.target.closest('.live-chip');
    if (chip) {
      const id = chip.dataset.chip;
      if (splitMode) {
        const i = simpleSelection.indexOf(id);
        if (i >= 0) simpleSelection.splice(i, 1);
        else {
          if (simpleSelection.length >= 2) simpleSelection.shift();
          simpleSelection.push(id);
        }
      } else {
        simpleSelection = [id];
      }
      if (latest) renderSimple(latest);
      return;
    }
    const more = e.target.closest('.log-more');
    if (more) {
      const key = more.dataset.key;
      const block = more.previousElementSibling;
      if (expandedKeys.has(key)) {
        expandedKeys.delete(key);
        if (block) block.classList.remove('expanded');
        more.textContent = '▼ もっと見る（全文）';
      } else {
        expandedKeys.add(key);
        if (block) block.classList.add('expanded');
        more.textContent = '▲ とじる';
      }
      return;
    }
    // Checkboxes: visual only, no back-action — just remember what's checked.
    const task = e.target.closest('.task-item[data-check]');
    if (task) {
      const key = task.dataset.check;
      const box = task.querySelector('.task-box');
      if (checkedKeys.has(key)) {
        checkedKeys.delete(key);
        task.classList.remove('checked');
        if (box) box.textContent = '☐';
      } else {
        checkedKeys.add(key);
        task.classList.add('checked');
        if (box) box.textContent = '☑';
      }
      saveChecked();
    }
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
