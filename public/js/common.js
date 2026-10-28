// Shared helpers for the voter app and the admin dashboard.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (form) opts.body = form;
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const fmt = (n) => Number(n || 0).toLocaleString();

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

const ICONS = {
  check: '<path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
  plus: '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  close: '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  search: '<circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 10.5V8a4 4 0 018 0v2.5" fill="none" stroke="currentColor" stroke-width="2"/>',
  info: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 11v5M12 7.6v.4" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  user: '<circle cx="12" cy="8.5" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4.5 20c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="10" r="1.8" fill="currentColor"/><path d="M4 17l5-4.5 3.5 3 3-2.5L20 17" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  up: '<path d="M6 14l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  down: '<path d="M6 10l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  arrows: '<path d="M5 7l5 5-5 5M12 7l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  upload: '<path d="M12 16V5M7.5 9.5L12 5l4.5 4.5M5 19h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  vote: '<path d="M7 11l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 14v5.5h16V14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>',
};

export const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

export const BRAND_MARK = `
  <svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
    <rect x="3" y="12" width="26" height="17" rx="4" fill="#13a89e"/>
    <rect x="3" y="12" width="26" height="5" rx="2.5" fill="#0b7a73"/>
    <rect x="9" y="3" width="14" height="14" rx="3" transform="rotate(-8 16 10)" fill="#e2553b"/>
    <path d="M12.2 9.8l2.6 2.4 5-5" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" transform="rotate(-8 16 10)"/>
  </svg>`;

export function laurel(color, cls = '') {
  // A small laurel branch; mirror it with .r for the right side.
  return `
    <svg class="laurel ${cls}" viewBox="0 0 12 26" aria-hidden="true" fill="${color}">
      <path d="M8.6 25c-3.4-3-5-7.4-4.3-12.6" fill="none" stroke="${color}" stroke-width="1.3" stroke-linecap="round"/>
      <ellipse cx="3.2" cy="20" rx="1.6" ry="3" transform="rotate(-38 3.2 20)"/>
      <ellipse cx="2.2" cy="14.6" rx="1.5" ry="2.8" transform="rotate(-12 2.2 14.6)"/>
      <ellipse cx="3.2" cy="9.4" rx="1.4" ry="2.6" transform="rotate(14 3.2 9.4)"/>
      <ellipse cx="5.6" cy="4.8" rx="1.3" ry="2.4" transform="rotate(34 5.6 4.8)"/>
      <ellipse cx="8.6" cy="19.2" rx="1.4" ry="2.6" transform="rotate(48 8.6 19.2)"/>
      <ellipse cx="7.8" cy="13.6" rx="1.3" ry="2.4" transform="rotate(58 7.8 13.6)"/>
      <ellipse cx="8.8" cy="8.6" rx="1.2" ry="2.2" transform="rotate(70 8.8 8.6)"/>
    </svg>`;
}

const RANK_COLORS = ['#e7b416', '#8e9ab3', '#e0603c'];
const RANK_CLASSES = ['gold', 'silver', 'bronze'];

// ---------------------------------------------------------------------------
// Avatars: photo, or initials on a colour derived from the name
// ---------------------------------------------------------------------------

const AVATAR_COLORS = ['#13a89e', '#7c6cf0', '#f08a5d', '#3d9be9', '#e2558a', '#2fb36b', '#d9a400', '#6b7a99'];

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

function colorFor(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function avatar(name, photo, cls = '') {
  if (photo) return `<img class="avatar ${cls}" src="${esc(photo)}" alt="${esc(name)}" loading="lazy">`;
  return `<span class="avatar ${cls}" style="background:${colorFor(name)}" aria-hidden="true">${esc(initials(name))}</span>`;
}

// ---------------------------------------------------------------------------
// Illustrations
// ---------------------------------------------------------------------------

export const BALLOT_ILLUSTRATION = `
  <svg class="illus" viewBox="0 0 220 150" aria-hidden="true">
    <circle cx="112" cy="78" r="62" fill="#eef1fb"/>
    <rect x="30" y="38" width="34" height="5" rx="2.5" fill="#e3e8f5"/>
    <rect x="22" y="54" width="22" height="5" rx="2.5" fill="#e3e8f5"/>
    <rect x="170" y="96" width="30" height="5" rx="2.5" fill="#e3e8f5"/>
    <g filter="drop-shadow(0 6px 10px rgba(80,90,140,.12))">
      <rect x="62" y="22" width="100" height="36" rx="8" fill="#fff"/>
      <rect x="74" y="32" width="46" height="5" rx="2.5" fill="#c8cfdf"/>
      <rect x="74" y="42" width="30" height="5" rx="2.5" fill="#13a89e" opacity=".5"/>
      <circle cx="146" cy="40" r="9" fill="#13a89e"/>
      <path d="M141.8 40.2l3 3 5.4-5.6" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
    <g filter="drop-shadow(0 6px 10px rgba(80,90,140,.10))">
      <rect x="70" y="66" width="92" height="32" rx="8" fill="#fff"/>
      <rect x="80" y="75" width="40" height="5" rx="2.5" fill="#d5dbe8"/>
      <rect x="80" y="85" width="26" height="5" rx="2.5" fill="#d5dbe8"/>
      <circle cx="146" cy="82" r="8" fill="#a9b3c7"/>
      <path d="M142.4 82.2l2.6 2.6 4.6-4.8" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
    <g opacity=".7">
      <rect x="76" y="106" width="86" height="28" rx="8" fill="#fff"/>
      <rect x="86" y="114" width="36" height="5" rx="2.5" fill="#e3e8f5"/>
      <rect x="86" y="123" width="22" height="5" rx="2.5" fill="#e3e8f5"/>
      <circle cx="146" cy="120" r="7" fill="#d5dbe8"/>
    </g>
  </svg>`;

export const LOCK_ILLUSTRATION = `
  <svg class="illus" viewBox="0 0 220 150" aria-hidden="true">
    <circle cx="110" cy="78" r="62" fill="#e8f7f5"/>
    <rect x="34" y="44" width="30" height="5" rx="2.5" fill="#cfece8"/>
    <rect x="160" y="104" width="28" height="5" rx="2.5" fill="#cfece8"/>
    <g filter="drop-shadow(0 8px 14px rgba(19,168,158,.18))">
      <rect x="66" y="40" width="88" height="62" rx="12" fill="#fff"/>
      <path d="M70 46l40 28 40-28" fill="none" stroke="#d2efeb" stroke-width="5" stroke-linejoin="round"/>
    </g>
    <circle cx="150" cy="98" r="20" fill="#13a89e"/>
    <rect x="142" y="96" width="16" height="12" rx="3" fill="#fff"/>
    <path d="M145.5 96v-3a4.5 4.5 0 019 0v3" fill="none" stroke="#fff" stroke-width="2.4"/>
  </svg>`;

// ---------------------------------------------------------------------------
// Toasts + modals
// ---------------------------------------------------------------------------

let toastRoot;
export function toast(message, type = '') {
  if (!toastRoot) {
    toastRoot = document.createElement('div');
    toastRoot.className = 'toasts';
    toastRoot.setAttribute('role', 'status');
    document.body.append(toastRoot);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  toastRoot.append(el);
  setTimeout(() => el.remove(), 3800);
}

/**
 * Opens a modal. `render(modalEl, close)` fills it and wires events.
 * Resolves with whatever value is passed to close().
 */
export function openModal({ className = '', html, onMount, dismissable = true }) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'modal-root';
    root.innerHTML = `
      <div class="modal ${className}" role="dialog" aria-modal="true">
        ${dismissable ? `<button class="close" type="button" aria-label="Close">${icon('close')}</button>` : ''}
        ${html}
      </div>`;
    const modal = root.firstElementChild;
    const prevFocus = document.activeElement;

    const close = (value) => {
      document.removeEventListener('keydown', onKey);
      root.remove();
      prevFocus?.focus?.();
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && dismissable) close(undefined);
    };

    if (dismissable) {
      root.addEventListener('mousedown', (e) => e.target === root && close(undefined));
      modal.querySelector('.close').addEventListener('click', () => close(undefined));
    }
    document.addEventListener('keydown', onKey);
    document.body.append(root);
    onMount?.(modal, close);
    (modal.querySelector('[autofocus]') || modal.querySelector('input, textarea, select, .btn'))?.focus();
  });
}

export function confirmDialog({ title, message, confirmText = 'Confirm', danger = false }) {
  return openModal({
    className: 'center',
    html: `
      <h2>${esc(title)}</h2>
      <p class="sub">${esc(message)}</p>
      <div class="footer">
        <button class="btn light" data-act="no" type="button">Cancel</button>
        <button class="btn ${danger ? 'danger' : ''}" data-act="yes" type="button" autofocus>${esc(confirmText)}</button>
      </div>`,
    onMount(modal, close) {
      modal.querySelector('[data-act=no]').onclick = () => close(false);
      modal.querySelector('[data-act=yes]').onclick = () => close(true);
    },
  }).then(Boolean);
}

export function setBusy(button, busy, label) {
  if (busy) {
    button.dataset.label = button.innerHTML;
    button.disabled = true;
    button.innerHTML = label || 'Please wait…';
  } else {
    button.disabled = false;
    if (button.dataset.label) button.innerHTML = button.dataset.label;
  }
}

// ---------------------------------------------------------------------------
// Status chip
// ---------------------------------------------------------------------------

const STATUS_LABEL = { draft: 'Not open yet', open: 'Voting open', closed: 'Voting closed' };

export function statusChip(status) {
  return `<span class="status-chip ${esc(status)}"><span class="dot"></span><span>${STATUS_LABEL[status] || status}</span></span>`;
}

// ---------------------------------------------------------------------------
// Results rendering (used by both voters and admin)
// ---------------------------------------------------------------------------

export function podium(aspirants) {
  // Visual order: 2nd, 1st, 3rd.
  const slots = [
    { a: aspirants[1], cls: 'second', place: 2 },
    { a: aspirants[0], cls: 'first', place: 1 },
    { a: aspirants[2], cls: 'third', place: 3 },
  ];
  return `
    <div class="podium">
      ${slots
        .map(({ a, cls, place }) => {
          const color = RANK_COLORS[place - 1];
          return `
            <div class="podium-col ${cls} ${a ? '' : 'empty'}">
              <div class="who">
                ${laurel(color, 'l')}
                ${a ? avatar(a.name, a.photo) : '<span class="avatar">–</span>'}
                ${laurel(color, 'r')}
              </div>
              <div class="block">
                <span class="name">${a ? esc(a.name) : '&nbsp;'}</span>
                <span class="place">${place}</span>
              </div>
            </div>`;
        })
        .join('')}
    </div>`;
}

export function rankCell(index) {
  const place = index + 1;
  if (index < 3) {
    const color = RANK_COLORS[index];
    return `<div class="rank ${RANK_CLASSES[index]}">${laurel(color, 'l')}<span>${place}</span>${laurel(color, 'r')}</div>`;
  }
  return `<div class="rank"><span>${place}</span></div>`;
}

export function renderResultBlock(position) {
  const total = position.totalVotes;
  const leader = position.aspirants[0];
  const tie = leader && position.aspirants[1] && position.aspirants[1].votes === leader.votes && leader.votes > 0;
  return `
    <section class="result-block">
      <div class="card hero">
        <div class="hero-body">
          <h1>${esc(position.title)} <span class="chip outline">${position.aspirants.length} aspirant${position.aspirants.length === 1 ? '' : 's'}</span></h1>
          <p>${esc(position.description || `Results for the ${position.title} seat.`)}</p>
          <div class="chips">
            <span class="chip">${fmt(total)} vote${total === 1 ? '' : 's'} cast</span>
            ${
              leader && leader.votes > 0
                ? tie
                  ? '<span class="chip amber">Tied at the top</span>'
                  : `<span class="chip">Leading: ${esc(leader.name)}</span>`
                : '<span class="chip grey">No votes yet</span>'
            }
          </div>
        </div>
        <div class="hero-art">${podium(position.aspirants)}</div>
      </div>
      <div class="list">
        ${position.aspirants
          .map((a, i) => {
            const pct = total ? Math.round((a.votes / total) * 1000) / 10 : 0;
            return `
              <div class="row">
                ${rankCell(i)}
                <div class="item">
                  ${avatar(a.name, a.photo, 'photo square')}
                  <div class="info">
                    <h3>${esc(a.name)}</h3>
                    <p>${esc(a.tagline || 'Aspirant for ' + position.title)}</p>
                    <div class="chips"><span class="chip">${esc(position.title)}</span></div>
                    <div class="bar"><span style="width:${pct}%"></span></div>
                  </div>
                  <div class="tally">
                    <span class="check ${i === 0 && a.votes > 0 && !tie ? 'filled' : ''}">${icon('check')}</span>
                    <span>${fmt(a.votes)}</span>
                    <span class="pct">${pct}%</span>
                  </div>
                </div>
              </div>`;
          })
          .join('')}
      </div>
    </section>`;
}

export function renderStats(turnout) {
  const pct = turnout.registered ? Math.round((turnout.voted / turnout.registered) * 100) : 0;
  return `
    <div class="stats">
      <div class="stat"><div class="num">${fmt(turnout.registered)}</div><div class="label">Registered voters</div></div>
      <div class="stat"><div class="num">${fmt(turnout.voted)}</div><div class="label">Ballots cast</div></div>
      <div class="stat"><div class="num teal">${pct}%</div><div class="label">Turnout</div></div>
    </div>`;
}

export function renderFooter(title) {
  const year = new Date().getFullYear();
  return `
    <footer class="site-footer">
      <svg class="big-mark" viewBox="0 0 24 24">${ICONS.vote.replaceAll('currentColor', '#fff')}</svg>
      <div class="container">
        <div class="cols">
          <div>
            <h4>Election</h4>
            <span>${esc(title)}</span>
            <a href="/">Cast your vote</a>
            <a href="/#/results">Results</a>
          </div>
          <div>
            <h4>How it works</h4>
            <span>Only registered emails can vote</span>
            <span>One vote per position</span>
            <span>Ballots are anonymous</span>
          </div>
          <div>
            <h4>Organisers</h4>
            <a href="/admin">Admin dashboard</a>
          </div>
        </div>
        <div class="bottom">
          <span>Copyright © ${year} VoteRight</span>
          <span>Secure · Anonymous · One person, one vote</span>
        </div>
      </div>
    </footer>`;
}
