import {
  $, $$, esc, api, fmt, icon, avatar, toast, openModal, confirmDialog, setBusy, statusChip,
  BRAND_MARK, BALLOT_ILLUSTRATION, LOCK_ILLUSTRATION, renderResultBlock, renderStats,
} from './common.js';

const app = $('#app');
$('#brand').innerHTML = `${BRAND_MARK}<span>Vote<b>Right</b></span><span class="chip outline" style="margin-left:4px">Admin</span>`;

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'aspirants', label: 'Positions & aspirants' },
  { id: 'voters', label: 'Voters' },
  { id: 'results', label: 'Results' },
  { id: 'settings', label: 'Settings' },
];

const state = { me: null, election: null, voterFilter: 'all', voterQuery: '' };

const currentTab = () => {
  const id = location.hash.replace(/^#\/?/, '');
  return TABS.some((t) => t.id === id) ? id : 'overview';
};

// ---------------------------------------------------------------------------
// Boot / auth
// ---------------------------------------------------------------------------

async function boot() {
  try {
    state.me = await api('/api/admin/me');
  } catch {
    state.me = null;
  }
  if (!state.me) return renderLogin();
  renderUserMenu();
  await refreshElection();
  renderShell();
}

async function refreshElection() {
  state.election = await api('/api/election');
  $('#status').innerHTML = statusChip(state.election.status);
}

function renderLogin() {
  $('#user-menu').hidden = true;
  app.innerHTML = `
    <div class="auth-wrap">
      <div class="card auth-card">
        ${LOCK_ILLUSTRATION}
        <h1>Administrator sign in</h1>
        <p>Manage positions, aspirants, the voter register and results.</p>
        <form id="login" novalidate>
          <div class="field">
            <label for="email">Admin email</label>
            <input class="input" id="email" type="email" autocomplete="username" required autofocus>
          </div>
          <div class="field">
            <label for="password">Password</label>
            <input class="input" id="password" type="password" autocomplete="current-password" required>
          </div>
          <button class="btn block lg" type="submit">Sign in</button>
        </form>
        <div class="meta">Credentials are set with ADMIN_EMAIL and ADMIN_PASSWORD in the server's .env file.</div>
      </div>
    </div>`;
  $('#email').focus();
  $('#login').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#login button[type=submit]');
    setBusy(btn, true, 'Signing in…');
    try {
      await api('/api/admin/login', { method: 'POST', body: { email: $('#email').value, password: $('#password').value } });
      boot();
    } catch (err) {
      toast(err.message, 'error');
      setBusy(btn, false);
    }
  };
}

function renderUserMenu() {
  const menu = $('#user-menu');
  menu.hidden = false;
  menu.innerHTML = `
    <button class="user-btn" type="button" aria-haspopup="true">${avatar('Admin', null)}<span class="caret"></span></button>
    <div class="user-dropdown" hidden>
      <div class="who"><strong>Administrator</strong>${esc(state.me.email)}</div>
      <button type="button" data-act="voter-site">Open voter site</button>
      <button type="button" data-act="logout">Sign out</button>
    </div>`;
  const dd = $('.user-dropdown', menu);
  $('.user-btn', menu).onclick = (e) => {
    e.stopPropagation();
    dd.hidden = !dd.hidden;
  };
  document.addEventListener('click', () => (dd.hidden = true));
  $('[data-act=voter-site]', menu).onclick = () => window.open('/', '_blank', 'noopener');
  $('[data-act=logout]', menu).onclick = async () => {
    await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
    location.hash = '';
    boot();
  };
}

// ---------------------------------------------------------------------------
// Shell + tabs
// ---------------------------------------------------------------------------

function renderShell() {
  const tab = currentTab();
  app.innerHTML = `
    <div class="admin-tabs">
      <div class="tabs-scroll">
        <div class="segmented" role="tablist">
          ${TABS.map((t) => `<button type="button" role="tab" data-tab="${t.id}" class="${t.id === tab ? 'active' : ''}">${t.label}</button>`).join('')}
        </div>
      </div>
    </div>
    <div id="panel"><div class="loading"><div class="spinner"></div></div></div>`;
  $$('[data-tab]').forEach((b) => (b.onclick = () => (location.hash = `#/${b.dataset.tab}`)));
  $('.segmented .active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  PANELS[tab]().catch((err) => {
    if (err.status === 401) return boot();
    $('#panel').innerHTML = `<div class="card empty"><h3>Something went wrong</h3><p>${esc(err.message)}</p></div>`;
  });
}

window.addEventListener('hashchange', () => state.me && renderShell());

const panel = () => $('#panel');
const plural = (n, word) => `${fmt(n)} ${word}${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

const STATUS_OPTIONS = [
  { id: 'draft', label: 'Draft', color: 'var(--amber)', text: 'Set up the election. Voters can sign in but cannot vote.' },
  { id: 'open', label: 'Open', color: 'var(--teal)', text: 'Registered voters can sign in and cast their ballot.' },
  { id: 'closed', label: 'Closed', color: 'var(--silver)', text: 'Voting is locked. Results publish if set to after close.' },
];

async function renderOverview() {
  const [{ election, turnout }, { positions }] = await Promise.all([api('/api/admin/overview'), api('/api/admin/positions')]);
  state.election = election;
  $('#status').innerHTML = statusChip(election.status);

  const emptyPositions = positions.filter((p) => p.aspirants.length === 0);
  const checks = [
    { ok: positions.length > 0, text: positions.length ? `${positions.length} position${positions.length === 1 ? '' : 's'} created` : 'Create at least one position (e.g. Chairperson, Secretary)', tab: 'aspirants' },
    { ok: positions.length > 0 && emptyPositions.length === 0, text: emptyPositions.length ? `Add aspirants to: ${emptyPositions.map((p) => p.title).join(', ')}` : `${election.aspirants} aspirant${election.aspirants === 1 ? '' : 's'} added`, tab: 'aspirants' },
    { ok: turnout.registered > 0, text: turnout.registered ? `${fmt(turnout.registered)} voter email${turnout.registered === 1 ? '' : 's'} registered` : 'Add the email addresses allowed to vote', tab: 'voters' },
    { ok: election.status !== 'draft', text: election.status === 'draft' ? 'Open voting when you are ready' : `Voting is ${election.status}`, tab: null },
  ];

  panel().innerHTML = `
    <div class="card hero">
      <div class="hero-body">
        <h1>${esc(election.title)} <span class="chip outline">${positions.length} position${positions.length === 1 ? '' : 's'}</span></h1>
        <p>${esc(election.description)}</p>
        <div class="chips">
          <span class="chip">${plural(election.aspirants, 'aspirant')}</span>
          <span class="chip">${plural(turnout.registered, 'voter')}</span>
          <span class="chip">${plural(turnout.voted, 'ballot')} cast</span>
        </div>
        <button class="link-btn" data-go="settings">${icon('edit')} Edit election details</button>
      </div>
      <div class="hero-art" style="align-items:center">${BALLOT_ILLUSTRATION.replace('class="illus"', 'class="illus" style="width:220px"')}</div>
    </div>

    <div class="grid-2" style="margin-top:22px">
      <div class="card card-pad">
        <div class="panel-head" style="margin-bottom:14px"><div><h2>Election status</h2><p>Control when voters can cast their ballot.</p></div></div>
        <div class="status-picker" style="grid-template-columns:1fr">
          ${STATUS_OPTIONS.map(
            (o) => `
            <button type="button" class="status-option ${election.status === o.id ? 'active' : ''}" data-status="${o.id}">
              <strong><span class="dot" style="background:${o.color}"></span>${o.label}${election.status === o.id ? ' <span class="chip">Current</span>' : ''}</strong>
              <span>${o.text}</span>
            </button>`,
          ).join('')}
        </div>
      </div>
      <div class="card card-pad">
        <div class="panel-head" style="margin-bottom:14px"><div><h2>Setup checklist</h2><p>Everything needed before opening the vote.</p></div></div>
        <div class="list" style="gap:10px">
          ${checks
            .map(
              (c) => `
              <div class="review-row">
                <span class="check ${c.ok ? 'filled' : ''}" style="margin:0;${c.ok ? '' : 'border-color:#d5dbe8;color:#d5dbe8'}">${icon('check')}</span>
                <div style="flex:1"><strong style="font-size:13px;font-weight:500">${esc(c.text)}</strong></div>
                ${c.tab && !c.ok ? `<button class="btn sm ghost" data-go="${c.tab}">Fix</button>` : ''}
              </div>`,
            )
            .join('')}
        </div>
        <div class="notice" style="margin:16px 0 0">${icon('info')}<span>Results visibility: <strong>${
          { live: 'live to everyone', after_close: 'published after voting closes', hidden: 'admin only' }[election.resultsVisibility]
        }</strong>. Change it in Settings.</span></div>
      </div>
    </div>

    ${renderStats(turnout)}`;

  $$('[data-go]').forEach((b) => (b.onclick = () => (location.hash = `#/${b.dataset.go}`)));
  $$('[data-status]').forEach(
    (b) =>
      (b.onclick = async () => {
        const status = b.dataset.status;
        if (status === election.status) return;
        if (status === 'open' && (emptyPositions.length || !positions.length || !turnout.registered)) {
          const ok = await confirmDialog({
            title: 'Open voting anyway?',
            message: 'Your setup checklist is incomplete. Positions without aspirants are skipped on the ballot.',
            confirmText: 'Open voting',
          });
          if (!ok) return;
        }
        if (status === 'closed') {
          const ok = await confirmDialog({ title: 'Close voting?', message: 'Voters will no longer be able to submit ballots. You can reopen it later.', confirmText: 'Close voting', danger: true });
          if (!ok) return;
        }
        await api('/api/admin/settings', { method: 'PUT', body: { status } });
        toast(`Election is now ${status === 'draft' ? 'in draft' : status}.`, 'success');
        renderOverview();
      }),
  );
}

// ---------------------------------------------------------------------------
// Positions & aspirants
// ---------------------------------------------------------------------------

async function renderAspirants() {
  const { positions } = await api('/api/admin/positions');

  panel().innerHTML = `
    <div class="panel-head">
      <div><h2>Positions &amp; aspirants</h2><p>Create each seat being contested, then add the aspirants vying for it.</p></div>
      <button class="btn" data-act="add-position">${icon('plus').replace('<svg', '<svg style="width:15px;height:15px"')} Add position</button>
    </div>
    ${
      positions.length
        ? positions
            .map(
              (p, i) => `
          <div class="card position-card" data-position="${p.id}">
            <div class="head">
              <div>
                <h3>${esc(p.title)} <span class="chip outline">${p.aspirants.length} aspirant${p.aspirants.length === 1 ? '' : 's'}</span></h3>
                <p>${esc(p.description || 'No description')}</p>
              </div>
              <div class="actions">
                <button class="icon-btn" data-act="up" title="Move up" ${i === 0 ? 'disabled style="opacity:.3"' : ''}>${icon('up')}</button>
                <button class="icon-btn" data-act="down" title="Move down" ${i === positions.length - 1 ? 'disabled style="opacity:.3"' : ''}>${icon('down')}</button>
                <button class="icon-btn" data-act="edit-position" title="Edit position">${icon('edit')}</button>
                <button class="icon-btn danger" data-act="delete-position" title="Delete position">${icon('trash')}</button>
              </div>
            </div>
            <div class="list">
              ${p.aspirants
                .map(
                  (a) => `
                <div class="item" data-aspirant="${a.id}">
                  ${avatar(a.name, a.photo, 'photo square')}
                  <div class="info">
                    <h3>${esc(a.name)}</h3>
                    <p>${esc(a.tagline || 'No tagline')}</p>
                    <div class="chips"><span class="chip">${esc(p.title)}</span>${a.photo ? '' : '<span class="chip amber">No photo</span>'}</div>
                  </div>
                  <div class="actions">
                    <button class="icon-btn" data-act="edit-aspirant" title="Edit aspirant">${icon('edit')}</button>
                    <button class="icon-btn danger" data-act="delete-aspirant" title="Remove aspirant">${icon('trash')}</button>
                  </div>
                </div>`,
                )
                .join('')}
            </div>
            <div class="add-row"><button class="link-btn" data-act="add-aspirant">${icon('plus')} Add an aspirant for ${esc(p.title)}</button></div>
          </div>`,
            )
            .join('')
        : `<div class="card empty">${BALLOT_ILLUSTRATION}<h3>No positions yet</h3><p>Start by adding the seats up for election — for example Chairperson, Secretary or Treasurer.</p><button class="btn" data-act="add-position">Add your first position</button></div>`
    }`;

  const byId = (id) => positions.find((p) => p.id === Number(id));

  $$('[data-act=add-position]').forEach((b) => (b.onclick = () => positionModal()));
  $$('[data-position]').forEach((card) => {
    const p = byId(card.dataset.position);
    $('[data-act=edit-position]', card).onclick = () => positionModal(p);
    $('[data-act=add-aspirant]', card).onclick = () => aspirantModal(positions, { positionId: p.id });
    $('[data-act=up]', card).onclick = () => movePosition(p.id, 'up');
    $('[data-act=down]', card).onclick = () => movePosition(p.id, 'down');
    $('[data-act=delete-position]', card).onclick = async () => {
      const ok = await confirmDialog({
        title: `Delete "${p.title}"?`,
        message: p.aspirants.length
          ? `This also removes its ${p.aspirants.length} aspirant(s) and any votes cast for them.`
          : 'This position will be removed from the ballot.',
        confirmText: 'Delete position',
        danger: true,
      });
      if (!ok) return;
      await api(`/api/admin/positions/${p.id}`, { method: 'DELETE' });
      toast('Position deleted.', 'success');
      renderAspirants();
    };
    $$('[data-aspirant]', card).forEach((row) => {
      const a = p.aspirants.find((x) => x.id === Number(row.dataset.aspirant));
      $('[data-act=edit-aspirant]', row).onclick = () => aspirantModal(positions, a);
      $('[data-act=delete-aspirant]', row).onclick = async () => {
        const ok = await confirmDialog({
          title: `Remove ${a.name}?`,
          message: 'They will be removed from the ballot along with any votes already cast for them.',
          confirmText: 'Remove aspirant',
          danger: true,
        });
        if (!ok) return;
        await api(`/api/admin/aspirants/${a.id}`, { method: 'DELETE' });
        toast('Aspirant removed.', 'success');
        renderAspirants();
      };
    });
  });
}

async function movePosition(id, direction) {
  await api(`/api/admin/positions/${id}/move`, { method: 'POST', body: { direction } });
  renderAspirants();
}

function positionModal(position) {
  return openModal({
    html: `
      <h2>${position ? 'Edit position' : 'Add a position'}</h2>
      <p class="sub">A seat on the ballot, such as Chairperson, Secretary or Treasurer.</p>
      <form id="position-form" novalidate>
        <div class="field">
          <label for="p-title">Position title</label>
          <input class="input" id="p-title" maxlength="80" placeholder="e.g. Secretary General" value="${esc(position?.title)}" required autofocus>
        </div>
        <div class="field">
          <label for="p-desc">Description <span style="font-weight:400;color:var(--muted)">(optional)</span></label>
          <textarea class="input" id="p-desc" maxlength="300" placeholder="What this role is responsible for">${esc(position?.description)}</textarea>
        </div>
        <div class="footer">
          <button type="button" class="btn light" data-act="cancel">Cancel</button>
          <button type="submit" class="btn">${position ? 'Save changes' : 'Add position'}</button>
        </div>
      </form>`,
    onMount(modal, close) {
      $('[data-act=cancel]', modal).onclick = () => close();
      $('#position-form', modal).onsubmit = async (e) => {
        e.preventDefault();
        const btn = $('button[type=submit]', modal);
        setBusy(btn, true, 'Saving…');
        const body = { title: $('#p-title', modal).value, description: $('#p-desc', modal).value };
        try {
          if (position) await api(`/api/admin/positions/${position.id}`, { method: 'PUT', body });
          else await api('/api/admin/positions', { method: 'POST', body });
          close();
          toast(position ? 'Position updated.' : 'Position added.', 'success');
          renderAspirants();
        } catch (err) {
          toast(err.message, 'error');
          setBusy(btn, false);
        }
      };
    },
  });
}

function aspirantModal(positions, aspirant) {
  const isEdit = Boolean(aspirant?.id);
  let file = null;
  let removePhoto = false;

  return openModal({
    className: 'wide',
    html: `
      <h2>${isEdit ? 'Edit aspirant' : 'Add an aspirant'}</h2>
      <p class="sub">Voters will see this photo, name and tagline on their ballot.</p>
      <form id="aspirant-form" novalidate>
        <div class="field">
          <label>Photo</label>
          <div class="photo-picker">
            <div id="preview-slot"></div>
            <div class="btns">
              <label class="btn sm ghost" style="cursor:pointer">${icon('upload').replace('<svg', '<svg style="width:14px;height:14px"')} Upload photo
                <input type="file" id="a-photo" accept="image/jpeg,image/png,image/webp,image/gif" class="sr-only">
              </label>
              <button type="button" class="link-btn" id="a-remove" style="font-size:12px">Remove photo</button>
              <span class="hint" style="font-size:11px;color:var(--muted)">JPG, PNG, WEBP or GIF · up to 5 MB · square works best</span>
            </div>
          </div>
        </div>
        <div class="field">
          <label for="a-name">Full name</label>
          <input class="input" id="a-name" maxlength="80" placeholder="e.g. Jane Wanjiku" value="${esc(aspirant?.name)}" required autofocus>
        </div>
        <div class="field">
          <label for="a-position">Vying for</label>
          <select class="input" id="a-position">
            ${positions.map((p) => `<option value="${p.id}" ${p.id === aspirant?.positionId ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="a-tagline">Tagline / short manifesto <span style="font-weight:400;color:var(--muted)">(optional)</span></label>
          <input class="input" id="a-tagline" maxlength="200" placeholder="e.g. Transparency and accountability for every member" value="${esc(aspirant?.tagline)}">
        </div>
        <div class="footer">
          <button type="button" class="btn light" data-act="cancel">Cancel</button>
          <button type="submit" class="btn">${isEdit ? 'Save changes' : 'Add aspirant'}</button>
        </div>
      </form>`,
    onMount(modal, close) {
      const slot = $('#preview-slot', modal);
      const nameInput = $('#a-name', modal);
      let objectUrl = null;

      const drawPreview = () => {
        const name = nameInput.value || 'New aspirant';
        if (file) {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          objectUrl = URL.createObjectURL(file);
          slot.innerHTML = `<img class="avatar preview" src="${objectUrl}" alt="">`;
        } else if (aspirant?.photo && !removePhoto) {
          slot.innerHTML = avatar(name, aspirant.photo, 'preview');
        } else if (nameInput.value) {
          slot.innerHTML = avatar(name, null, 'preview');
        } else {
          slot.innerHTML = `<span class="avatar preview">${icon('image')}</span>`;
        }
        $('#a-remove', modal).hidden = !(file || (aspirant?.photo && !removePhoto));
      };
      drawPreview();
      nameInput.addEventListener('input', () => !file && drawPreview());

      $('#a-photo', modal).onchange = (e) => {
        const f = e.target.files[0];
        if (!f) return;
        if (f.size > 5 * 1024 * 1024) {
          toast('Photo must be 5 MB or smaller.', 'error');
          e.target.value = '';
          return;
        }
        file = f;
        removePhoto = false;
        drawPreview();
      };
      $('#a-remove', modal).onclick = () => {
        file = null;
        removePhoto = true;
        $('#a-photo', modal).value = '';
        drawPreview();
      };
      $('[data-act=cancel]', modal).onclick = () => close();

      $('#aspirant-form', modal).onsubmit = async (e) => {
        e.preventDefault();
        const btn = $('button[type=submit]', modal);
        const form = new FormData();
        form.append('name', nameInput.value);
        form.append('positionId', $('#a-position', modal).value);
        form.append('tagline', $('#a-tagline', modal).value);
        if (file) form.append('photo', file);
        if (removePhoto) form.append('removePhoto', 'true');
        setBusy(btn, true, 'Saving…');
        try {
          if (isEdit) await api(`/api/admin/aspirants/${aspirant.id}`, { method: 'PUT', form });
          else await api('/api/admin/aspirants', { method: 'POST', form });
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          close();
          toast(isEdit ? 'Aspirant updated.' : 'Aspirant added.', 'success');
          renderAspirants();
        } catch (err) {
          toast(err.message, 'error');
          setBusy(btn, false);
        }
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Voters
// ---------------------------------------------------------------------------

async function renderVoters() {
  const { voters, turnout } = await api('/api/admin/voters');

  panel().innerHTML = `
    <div class="panel-head">
      <div><h2>Voter register</h2><p>Only these email addresses can sign in and vote. Each can vote once.</p></div>
      <span class="chip outline">${fmt(turnout.voted)} / ${fmt(turnout.registered)} voted</span>
    </div>

    <div class="grid-2">
      <div class="card card-pad">
        <h3 style="margin:0 0 14px;font-size:15px">Add one voter</h3>
        <form id="single-form" novalidate>
          <div class="field">
            <label for="v-email">Email address</label>
            <input class="input" id="v-email" type="email" placeholder="voter@example.com" required>
          </div>
          <div class="field">
            <label for="v-name">Name <span style="font-weight:400;color:var(--muted)">(optional)</span></label>
            <input class="input" id="v-name" maxlength="80" placeholder="e.g. John Otieno">
          </div>
          <button class="btn" type="submit">${icon('plus').replace('<svg', '<svg style="width:14px;height:14px"')} Add voter</button>
        </form>
      </div>
      <div class="card card-pad">
        <h3 style="margin:0 0 14px;font-size:15px">Add many at once</h3>
        <form id="bulk-form" novalidate>
          <div class="field">
            <label for="v-bulk">Email addresses</label>
            <textarea class="input" id="v-bulk" placeholder="Paste emails separated by commas, spaces or new lines" style="min-height:118px"></textarea>
            <span class="hint">Duplicates and existing voters are skipped automatically.</span>
          </div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <button class="btn" type="submit">Add all</button>
            <label class="btn ghost" style="cursor:pointer">${icon('upload').replace('<svg', '<svg style="width:14px;height:14px"')} Import CSV / TXT
              <input type="file" id="v-file" accept=".csv,.txt,text/csv,text/plain" class="sr-only">
            </label>
          </div>
        </form>
      </div>
    </div>

    <div class="card card-pad" style="margin-top:22px">
      <div class="panel-head" style="margin-bottom:14px">
        <div class="segmented" style="background:#f3f5f8">
          ${[
            ['all', `All (${voters.length})`],
            ['voted', `Voted (${turnout.voted})`],
            ['pending', `Not voted (${voters.length - turnout.voted})`],
          ]
            .map(([id, label]) => `<button type="button" data-filter="${id}" class="${state.voterFilter === id ? 'active' : ''}">${label}</button>`)
            .join('')}
        </div>
        <div class="search" style="min-width:min(260px,100%)">
          <input class="input" id="v-search" placeholder="Search voters" value="${esc(state.voterQuery)}">
          <span class="search-icon">${icon('search')}</span>
        </div>
      </div>
      <div id="voter-list"></div>
    </div>`;

  const drawList = () => {
    const q = state.voterQuery.toLowerCase();
    const list = voters.filter(
      (v) =>
        (state.voterFilter === 'all' || (state.voterFilter === 'voted') === v.hasVoted) &&
        (!q || v.email.toLowerCase().includes(q) || v.name.toLowerCase().includes(q)),
    );
    $('#voter-list').innerHTML = list.length
      ? `<div style="overflow-x:auto"><table class="voter-table">
          <thead><tr><th>Voter</th><th>Status</th><th class="hide-sm">Added</th><th></th></tr></thead>
          <tbody>
            ${list
              .map(
                (v) => `
              <tr data-voter="${v.id}">
                <td class="email"><div class="who">${avatar(v.name || v.email, null)}<div>${esc(v.email)}${v.name ? `<small>${esc(v.name)}</small>` : ''}</div></div></td>
                <td>${v.hasVoted ? `<span class="chip" title="${esc(new Date(v.votedAt).toLocaleString())}">Voted</span>` : '<span class="chip grey">Not voted</span>'}</td>
                <td class="hide-sm" style="color:var(--muted);font-size:12px">${esc(new Date(v.addedAt.replace(' ', 'T') + 'Z').toLocaleDateString())}</td>
                <td class="num"><button class="icon-btn danger" data-act="remove" title="Remove voter">${icon('trash')}</button></td>
              </tr>`,
              )
              .join('')}
          </tbody></table></div>`
      : `<div class="empty" style="padding:30px 0"><p style="margin:0">${voters.length ? 'No voters match this filter.' : 'No voters yet. Add the email addresses allowed to vote above.'}</p></div>`;

    $$('[data-voter]').forEach((row) => {
      const v = voters.find((x) => x.id === Number(row.dataset.voter));
      $('[data-act=remove]', row).onclick = async () => {
        const ok = await confirmDialog({
          title: `Remove ${v.email}?`,
          message: v.hasVoted
            ? 'They have already voted; their anonymous ballot stays counted, but they will no longer be able to sign in.'
            : 'They will no longer be able to sign in or vote.',
          confirmText: 'Remove voter',
          danger: true,
        });
        if (!ok) return;
        await api(`/api/admin/voters/${v.id}`, { method: 'DELETE' });
        toast('Voter removed.', 'success');
        renderVoters();
      };
    });
  };
  drawList();

  $$('[data-filter]').forEach(
    (b) =>
      (b.onclick = () => {
        state.voterFilter = b.dataset.filter;
        $$('[data-filter]').forEach((x) => x.classList.toggle('active', x === b));
        drawList();
      }),
  );
  $('#v-search').oninput = (e) => {
    state.voterQuery = e.target.value;
    drawList();
  };

  const addVoters = async (body, btn) => {
    setBusy(btn, true, 'Adding…');
    try {
      const r = await api('/api/admin/voters', { method: 'POST', body });
      const parts = [`${r.added} added`];
      if (r.duplicates) parts.push(`${r.duplicates} already registered`);
      if (r.invalid.length) parts.push(`${r.invalid.length} invalid skipped`);
      toast(parts.join(' · '), r.added ? 'success' : '');
      renderVoters();
    } catch (err) {
      toast(err.message, 'error');
      setBusy(btn, false);
    }
  };

  $('#single-form').onsubmit = (e) => {
    e.preventDefault();
    addVoters({ email: $('#v-email').value, name: $('#v-name').value }, $('#single-form button[type=submit]'));
  };
  $('#bulk-form').onsubmit = (e) => {
    e.preventDefault();
    addVoters({ emails: $('#v-bulk').value }, $('#bulk-form button[type=submit]'));
  };
  $('#v-file').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const text = await f.text();
    const emails = text.match(/[^\s,;"'<>()]+@[^\s,;"'<>()]+\.[^\s,;"'<>()]+/g) || [];
    $('#v-bulk').value = [...new Set(emails)].join('\n');
    toast(`Found ${emails.length} email${emails.length === 1 ? '' : 's'} in ${f.name}. Review and click "Add all".`);
    e.target.value = '';
  };
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

async function renderResults() {
  const data = await api('/api/admin/results');
  const positions = data.positions.filter((p) => p.aspirants.length);
  panel().innerHTML = `
    <div class="panel-head">
      <div><h2>Results</h2><p>${
        state.election.status === 'open' ? 'Live count — voting is still open.' : state.election.status === 'closed' ? 'Final count — voting is closed.' : 'Voting has not opened yet.'
      } Only admins see this page unless results are made public in Settings.</p></div>
      <button class="btn light" data-act="refresh">Refresh</button>
    </div>
    ${positions.length ? positions.map(renderResultBlock).join('') : `<div class="card empty">${BALLOT_ILLUSTRATION}<h3>No results yet</h3><p>Add positions and aspirants first.</p></div>`}
    ${renderStats(data.turnout)}`;
  $('[data-act=refresh]').onclick = () => renderResults().then(() => toast('Results refreshed.'));
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function renderSettings() {
  await refreshElection();
  const e = state.election;
  panel().innerHTML = `
    <div class="panel-head"><div><h2>Settings</h2><p>Election details shown to voters and who can see results.</p></div></div>
    <div class="card card-pad">
      <form id="settings-form" novalidate>
        <div class="field">
          <label for="s-title">Election title</label>
          <input class="input" id="s-title" maxlength="120" value="${esc(e.title)}" required>
        </div>
        <div class="field">
          <label for="s-desc">Description</label>
          <textarea class="input" id="s-desc" maxlength="600">${esc(e.description)}</textarea>
        </div>
        <div class="field">
          <label>Results visibility</label>
          <div class="status-picker">
            ${[
              ['after_close', 'After voting closes', 'Everyone can see results once you close the election.'],
              ['live', 'Live', 'Anyone can watch the count while voting is open.'],
              ['hidden', 'Admin only', 'Results are never shown publicly.'],
            ]
              .map(
                ([id, label, text]) => `
              <button type="button" class="status-option ${e.resultsVisibility === id ? 'active' : ''}" data-vis="${id}">
                <strong>${label}</strong><span>${text}</span>
              </button>`,
              )
              .join('')}
          </div>
        </div>
        <button class="btn" type="submit">Save settings</button>
      </form>
    </div>

    <div class="card card-pad" style="margin-top:22px">
      <h3 style="margin:0 0 14px;font-size:15px">Danger zone</h3>
      <div class="danger-zone">
        <div><strong>Reset all votes</strong><span>Deletes every ballot and lets all voters vote again. Use this after a test run.</span></div>
        <button class="btn danger" data-act="reset">Reset votes</button>
      </div>
    </div>`;

  let visibility = e.resultsVisibility;
  $$('[data-vis]').forEach(
    (b) =>
      (b.onclick = () => {
        visibility = b.dataset.vis;
        $$('[data-vis]').forEach((x) => x.classList.toggle('active', x === b));
      }),
  );

  $('#settings-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const btn = $('#settings-form button[type=submit]');
    setBusy(btn, true, 'Saving…');
    try {
      await api('/api/admin/settings', { method: 'PUT', body: { title: $('#s-title').value, description: $('#s-desc').value, resultsVisibility: visibility } });
      await refreshElection();
      toast('Settings saved.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
    setBusy(btn, false);
  };

  $('[data-act=reset]').onclick = () =>
    openModal({
      className: 'center',
      html: `
        <h2>Reset all votes?</h2>
        <p class="sub">This permanently deletes every ballot cast. Type <strong>RESET</strong> to confirm.</p>
        <div class="field"><input class="input" id="confirm-reset" autocomplete="off" style="text-align:center" autofocus></div>
        <div class="footer">
          <button class="btn light" data-act="cancel" type="button">Cancel</button>
          <button class="btn danger" data-act="go" type="button">Reset votes</button>
        </div>`,
      onMount(modal, close) {
        $('[data-act=cancel]', modal).onclick = () => close();
        $('[data-act=go]', modal).onclick = async () => {
          try {
            await api('/api/admin/reset-votes', { method: 'POST', body: { confirm: $('#confirm-reset', modal).value.trim() } });
            close();
            toast('All votes have been reset.', 'success');
          } catch (err) {
            toast(err.message, 'error');
          }
        };
      },
    });
}

const PANELS = {
  overview: renderOverview,
  aspirants: renderAspirants,
  voters: renderVoters,
  results: renderResults,
  settings: renderSettings,
};

boot();
