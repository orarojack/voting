import {
  $, $$, esc, api, fmt, icon, avatar, toast, openModal, setBusy, statusChip,
  BRAND_MARK, BALLOT_ILLUSTRATION, LOCK_ILLUSTRATION, renderResultBlock, renderStats, renderFooter,
} from './common.js';

const app = $('#app');

const state = {
  election: null,
  me: null,
  ballot: null,
  selections: {},
  active: 0,
};

// ---------------------------------------------------------------------------
// Boot + routing
// ---------------------------------------------------------------------------

$('#brand').innerHTML = `${BRAND_MARK}<span>Vote<b>Right</b></span>`;

const route = () => (location.hash.startsWith('#/results') ? 'results' : 'ballot');

async function boot() {
  try {
    state.election = await api('/api/election');
  } catch {
    app.innerHTML = emptyState('Unable to load the election', 'Please check your connection and refresh the page.');
    return;
  }
  document.title = `${state.election.title} – VoteRight`;
  $('#status').innerHTML = statusChip(state.election.status);
  $('#footer').innerHTML = renderFooter(state.election.title);

  try {
    state.me = await api('/api/me');
  } catch {
    state.me = null;
  }
  renderUserMenu();
  render();
}

window.addEventListener('hashchange', render);

async function render() {
  const r = route();
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === r));
  window.scrollTo({ top: 0 });
  if (r === 'results') return renderResults();
  if (!state.me) return renderLogin();
  return renderBallot();
}

function renderUserMenu() {
  const menu = $('#user-menu');
  if (!state.me) {
    menu.hidden = true;
    return;
  }
  menu.hidden = false;
  const label = state.me.name || state.me.email;
  menu.innerHTML = `
    <button class="user-btn" type="button" aria-haspopup="true" aria-expanded="false">
      ${avatar(label, null)}<span class="caret"></span>
    </button>
    <div class="user-dropdown" hidden>
      <div class="who"><strong>${esc(state.me.name || 'Registered voter')}</strong>${esc(state.me.email)}</div>
      <button type="button" data-act="logout">Sign out</button>
    </div>`;
  const btn = $('.user-btn', menu);
  const dd = $('.user-dropdown', menu);
  btn.onclick = (e) => {
    e.stopPropagation();
    dd.hidden = !dd.hidden;
    btn.setAttribute('aria-expanded', String(!dd.hidden));
  };
  document.addEventListener('click', () => (dd.hidden = true));
  $('[data-act=logout]', menu).onclick = async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    state.me = null;
    state.ballot = null;
    state.selections = {};
    renderUserMenu();
    location.hash = '#/';
    render();
  };
}

function emptyState(title, text, extra = '', art = BALLOT_ILLUSTRATION) {
  return `
    <div class="card empty" style="margin-top:8px">
      ${art}
      <h3>${esc(title)}</h3>
      <p>${esc(text)}</p>
      ${extra}
    </div>`;
}

// ---------------------------------------------------------------------------
// Sign in (registered email only)
// ---------------------------------------------------------------------------

function renderLogin() {
  app.innerHTML = `
    <div class="auth-wrap">
      <div class="card auth-card">
        ${LOCK_ILLUSTRATION}
        <h1>Sign in to vote</h1>
        <p>${esc(state.election.title)} is open to registered voters only. Enter the email address your administrator added.</p>
        <form id="email-form" novalidate>
          <div class="field">
            <label for="email">Email address</label>
            <input class="input" id="email" type="email" autocomplete="email" placeholder="you@example.com" required>
          </div>
          <button class="btn block lg" type="submit">Continue to ballot</button>
        </form>
        <div class="meta">${icon('lock').replace('<svg', '<svg style="width:13px;height:13px;vertical-align:-2px"')} One vote per email. Your ballot stays anonymous.</div>
      </div>
    </div>`;

  const form = $('#email-form');
  $('#email').focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const email = $('#email').value.trim();
    const btn = $('button[type=submit]', form);
    setBusy(btn, true, 'Checking…');
    try {
      await api('/api/auth/login', { method: 'POST', body: { email } });
      state.me = await api('/api/me');
      renderUserMenu();
      render();
    } catch (err) {
      toast(err.message, 'error');
      setBusy(btn, false);
    }
  };
}

// ---------------------------------------------------------------------------
// Ballot
// ---------------------------------------------------------------------------

const storeKey = () => `ballot:${state.me?.email}`;

function loadSelections() {
  try {
    state.selections = JSON.parse(sessionStorage.getItem(storeKey()) || '{}');
  } catch {
    state.selections = {};
  }
}

function saveSelections() {
  try {
    sessionStorage.setItem(storeKey(), JSON.stringify(state.selections));
  } catch {
    /* storage unavailable: selections just won't survive a refresh */
  }
}

function clearSelections() {
  try {
    sessionStorage.removeItem(storeKey());
  } catch {
    /* ignore */
  }
}

function resultsButton() {
  return state.election.resultsAvailable ? '<a class="btn" href="#/results">View results</a>' : '';
}

async function renderBallot() {
  const { election, me } = state;

  if (me.hasVoted) {
    const when = me.votedAt ? new Date(me.votedAt).toLocaleString() : '';
    app.innerHTML = emptyState(
      'Thanks — your vote is in!',
      `Your ballot was recorded${when ? ` on ${when}` : ''}. Each voter can vote once, and your choices are stored anonymously.`,
      resultsButton() || `<p style="margin:0">Results will be published ${election.resultsVisibility === 'hidden' ? 'by the administrator' : 'when voting closes'}.</p>`,
    );
    return;
  }
  if (election.status === 'draft') {
    app.innerHTML = emptyState("Voting hasn't opened yet", 'You are on the voter register. Come back once the administrator opens the election.');
    return;
  }
  if (election.status === 'closed') {
    app.innerHTML = emptyState('Voting has closed', 'The election is over and ballots are no longer being accepted.', resultsButton());
    return;
  }

  if (!state.ballot) {
    app.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    try {
      state.ballot = await api('/api/ballot');
    } catch (err) {
      app.innerHTML = emptyState('Unable to load your ballot', err.message);
      return;
    }
    loadSelections();
    const valid = new Set(state.ballot.positions.map((p) => String(p.id)));
    for (const k of Object.keys(state.selections)) if (!valid.has(k)) delete state.selections[k];
    const firstOpen = state.ballot.positions.findIndex((p) => !state.selections[p.id]);
    state.active = firstOpen < 0 ? 0 : firstOpen;
  }

  const positions = state.ballot.positions;
  if (positions.length === 0) {
    app.innerHTML = emptyState('Nothing to vote on yet', 'The administrator has not added any aspirants. Please check back later.');
    return;
  }

  drawBallot();
}

function drawBallot() {
  const { election } = state;
  const positions = state.ballot.positions;
  const p = positions[state.active];
  const chosen = state.selections[p.id];
  const done = positions.filter((x) => state.selections[x.id]).length;
  const isLast = state.active === positions.length - 1;

  app.innerHTML = `
    <div class="card hero">
      <div class="hero-body">
        <h1>${esc(election.title)} <span class="chip outline">${positions.length} position${positions.length === 1 ? '' : 's'}</span></h1>
        <p>${esc(election.description)}</p>
        <div class="chips">
          <span class="chip">One vote per position</span>
          <span class="chip">Anonymous ballot</span>
        </div>
      </div>
      <div class="hero-art" style="align-items:center">${BALLOT_ILLUSTRATION.replace('class="illus"', 'class="illus" style="width:220px"')}</div>
    </div>

    <div class="section-head">
      <div class="tabs-scroll">
        <div class="segmented" role="tablist">
          ${positions
            .map(
              (x, i) => `
              <button type="button" role="tab" data-tab="${i}" class="${i === state.active ? 'active' : ''}" aria-selected="${i === state.active}">
                ${state.selections[x.id] ? `<span class="tick">${icon('check')}</span>` : ''}${esc(x.title)}
              </button>`,
            )
            .join('')}
        </div>
      </div>
    </div>

    <div class="position-head">
      <div>
        <h2>${esc(p.title)}</h2>
        <p>${p.description ? esc(p.description) + ' · ' : ''}Choose one aspirant</p>
      </div>
      <span class="chip grey">Step ${state.active + 1} of ${positions.length}</span>
    </div>

    <div class="list" role="radiogroup" aria-label="${esc(p.title)}">
      ${p.aspirants
        .map((a, i) => {
          const picked = String(chosen) === String(a.id);
          return `
            <div class="row">
              <div class="rank"><span>${i + 1}</span></div>
              <button type="button" class="item selectable ${picked ? 'picked' : ''}" role="radio" aria-checked="${picked}" data-id="${a.id}">
                ${picked ? '<span class="your-pick">Your pick!</span>' : ''}
                ${avatar(a.name, a.photo, 'photo square')}
                <span class="info">
                  <span class="title">${esc(a.name)}</span>
                  <span class="desc">${esc(a.tagline || 'Aspirant for ' + p.title)}</span>
                  <span class="chips"><span class="chip">${esc(p.title)}</span></span>
                </span>
                <span class="hover-pill">${chosen ? 'Change vote to this!' : 'Vote for this!'}</span>
                <span class="check ${picked ? 'filled' : ''}">${icon('check')}</span>
              </button>
            </div>`;
        })
        .join('')}
    </div>

    <div class="ballot-bar">
      <div class="progress">
        <strong>${done} of ${positions.length} positions chosen</strong>
        <small>${done === positions.length ? 'All set — review your ballot and submit.' : 'You can change a pick any time before submitting.'}</small>
        <div class="track"><span style="width:${(done / positions.length) * 100}%"></span></div>
      </div>
      <div class="btns">
        ${state.active > 0 ? '<button type="button" class="btn light" data-act="prev">Back</button>' : ''}
        ${
          isLast || done === positions.length
            ? `<button type="button" class="btn" data-act="review" ${done ? '' : 'disabled'}>Review &amp; submit</button>`
            : `<button type="button" class="btn" data-act="next">Next position ${icon('arrows').replace('<svg', '<svg style="width:14px;height:14px"')}</button>`
        }
      </div>
    </div>`;

  $$('[data-tab]').forEach((b) => (b.onclick = () => go(Number(b.dataset.tab))));
  $$('.item.selectable').forEach(
    (b) =>
      (b.onclick = () => {
        state.selections[p.id] = Number(b.dataset.id);
        saveSelections();
        drawBallot();
      }),
  );
  $('[data-act=prev]')?.addEventListener('click', () => go(state.active - 1));
  $('[data-act=next]')?.addEventListener('click', () => go(state.active + 1));
  $('[data-act=review]')?.addEventListener('click', review);

  $('.segmented .active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
}

function go(index) {
  state.active = Math.max(0, Math.min(index, state.ballot.positions.length - 1));
  drawBallot();
  $('.section-head').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function review() {
  const positions = state.ballot.positions;
  const missing = positions.filter((p) => !state.selections[p.id]);

  const rows = positions
    .map((p) => {
      const a = p.aspirants.find((x) => x.id === state.selections[p.id]);
      return a
        ? `<div class="review-row">${avatar(a.name, a.photo)}<div><small>${esc(p.title)}</small><strong>${esc(a.name)}</strong></div><span class="check filled">${icon('check')}</span></div>`
        : `<div class="review-row"><span class="avatar" style="background:#e9edf3;color:#9aa2b1">?</span><div><small>${esc(p.title)}</small><strong style="color:var(--danger)">Not chosen yet</strong></div></div>`;
    })
    .join('');

  await openModal({
    className: 'wide',
    html: `
      <h2>Review your ballot</h2>
      <p class="sub">Make sure these are the aspirants you want. Once submitted, your vote is final.</p>
      <div class="review">${rows}</div>
      ${
        missing.length
          ? `<div class="notice red">${icon('info')}<span>Please choose an aspirant for: ${missing.map((m) => esc(m.title)).join(', ')}.</span></div>`
          : `<div class="notice">${icon('lock')}<span>Your choices are stored without your email address. Nobody — including the administrator — can see who you voted for.</span></div>`
      }
      <div class="footer">
        <button type="button" class="btn light" data-act="edit">Edit ballot</button>
        <button type="button" class="btn" data-act="submit" ${missing.length ? 'disabled' : ''}>Submit my vote</button>
      </div>`,
    onMount(modal, close) {
      $('[data-act=edit]', modal).onclick = () => {
        close();
        if (missing.length) go(positions.indexOf(missing[0]));
      };
      $('[data-act=submit]', modal).onclick = async (e) => {
        const btn = e.currentTarget;
        setBusy(btn, true, 'Submitting…');
        try {
          await api('/api/vote', { method: 'POST', body: { selections: state.selections } });
          close();
          clearSelections();
          state.me = await api('/api/me');
          state.election = await api('/api/election');
          celebrate();
        } catch (err) {
          setBusy(btn, false);
          toast(err.message, 'error');
          if (err.status === 409 || err.status === 403) {
            close();
            state.me = await api('/api/me').catch(() => state.me);
            state.election = await api('/api/election').catch(() => state.election);
            render();
          }
        }
      };
    },
  });
}

async function celebrate() {
  await openModal({
    className: 'center',
    html: `
      ${BALLOT_ILLUSTRATION}
      <h2>You voted!</h2>
      <p class="sub">Your ballot has been recorded anonymously. ${
        state.election.resultsAvailable ? 'You can now follow the <strong>live results</strong>.' : 'Results will be shared once voting closes.'
      }</p>
      <div class="footer"><button type="button" class="btn" data-act="ok" autofocus>Okay</button></div>`,
    onMount(modal, close) {
      $('[data-act=ok]', modal).onclick = () => close();
    },
  });
  if (state.election.resultsAvailable) location.hash = '#/results';
  else render();
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

async function renderResults() {
  app.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  let data;
  try {
    data = await api('/api/results');
  } catch (err) {
    app.innerHTML = emptyState('Results aren’t available yet', err.message, state.me && !state.me.hasVoted && state.election.status === 'open' ? '<a class="btn" href="#/">Go to your ballot</a>' : '');
    return;
  }
  const positions = data.positions.filter((p) => p.aspirants.length);
  if (!positions.length) {
    app.innerHTML = emptyState('No results to show', 'There are no positions with aspirants yet.');
    return;
  }

  const isLive = state.election.status === 'open';
  const cta = state.me
    ? state.me.hasVoted
      ? ''
      : isLive
        ? '<a class="btn lg" href="#/">' + icon('arrows').replace('<svg', '<svg style="width:15px;height:15px"') + ' Cast your vote</a>'
        : ''
    : isLive
      ? '<a class="btn lg" href="#/">' + icon('arrows').replace('<svg', '<svg style="width:15px;height:15px"') + ' Sign in to vote</a>'
      : '';

  app.innerHTML = `
    ${positions.map(renderResultBlock).join('')}
    ${
      cta
        ? `<div class="promo">
             <h3><mark>Vote</mark>, be counted<br>&amp; shape the outcome!</h3>
             <div class="side">${cta}<small>1 voter = 1 ballot · ${positions.length} position${positions.length === 1 ? '' : 's'}</small></div>
           </div>`
        : ''
    }
    ${renderStats(data.turnout)}
    <p style="text-align:center;color:var(--muted);font-size:12px;margin-top:28px">${isLive ? 'Live results — refresh to see the latest count.' : 'Final results.'}</p>`;
}

boot();
