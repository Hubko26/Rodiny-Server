'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const NAME_KEY = 'rodina.name';

let state = { items: [], archive: [], pricesUpdatedAt: null };
let me = { role: 'user', adminName: 'Správca' };
let events = null;

const isAdmin = () => me.role === 'admin';

function getName() {
  if (isAdmin()) return me.adminName;
  try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; }
}
function setName(name) {
  try { localStorage.setItem(NAME_KEY, name); } catch {}
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (res.status === 401 && path !== '/api/login') {
    showLogin();
    throw new Error('Neprihlásený');
  }
  if (!res.ok) throw new Error((data && data.error) || 'Chyba ' + res.status);
  return data;
}
async function act(path, options) {
  try { return await api(path, options); }
  catch (e) { alert(e.message); }
}

// ---------- Obrazovky ----------
function showOnly(id) {
  for (const el of ['login', 'name-screen', 'app']) $('#' + el).hidden = el !== id;
}
function showLogin() {
  if (events) { events.close(); events = null; }
  showOnly('login');
  $('#password').focus();
}
function showNameScreen() {
  showOnly('name-screen');
  $('#name-input').value = getName();
  $('#name-input').focus();
}
function showApp() {
  if (!getName()) return showNameScreen();
  showOnly('app');
  document.body.classList.toggle('is-admin', isAdmin());
  $('#user-btn').textContent = (isAdmin() ? '★ ' : '👤 ') + getName();
  $('#user-btn').disabled = isAdmin();
  $('#admin-hint-name').textContent = me.adminName;
  for (const el of $$('.admin-name')) el.textContent = me.adminName;
  showView();
  connect();
}

function showView() {
  const view = location.hash === '#archiv' ? 'archiv' : 'nakupy';
  $('#view-nakupy').hidden = view !== 'nakupy';
  $('#view-archiv').hidden = view !== 'archiv';
  for (const t of $$('.tab')) t.classList.toggle('active', t.dataset.view === view);
}
window.addEventListener('hashchange', showView);

// ---------- Live spojenie ----------
function setLive(on, text) {
  $('#live-status').className = 'dot ' + (on ? 'on' : 'off');
  $('#live-text').textContent = text;
}
function connect() {
  if (events) events.close();
  events = new EventSource('/api/shopping/events');
  events.onmessage = (e) => {
    state = JSON.parse(e.data);
    render();
    setLive(true, 'Naživo – zmeny ostatných vidíš hneď');
  };
  events.onerror = async () => {
    setLive(false, 'Spojenie prerušené, skúšam znova…');
    try { await api('/api/me'); } catch {}
  };
}

// ---------- Formátovanie ----------
const czk = new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK', maximumFractionDigits: 2 });
const money = (n) => (typeof n === 'number' ? czk.format(n) : '—');
const lineTotal = (i) => (typeof i.price === 'number' ? i.price * i.qty : 0);
const sum = (list) => list.reduce((s, i) => s + lineTotal(i), 0);
function dateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('sk-SK', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function button(label, title, onClick, cls = 'icon-btn') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = label;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.onclick = onClick;
  return b;
}

// ---------- Položka ----------
function renderItem(item) {
  const li = $('#item-tpl').content.firstElementChild.cloneNode(true);
  li.dataset.status = item.status;
  const link = item.url || null;
  for (const a of $$('a', li)) {
    if (link) a.href = link; else a.removeAttribute('href');
  }
  const img = $('img', li);
  if (item.image) img.src = item.image; else img.remove();
  $('.name', li).textContent = item.name;

  const metaParts = [item.amount];
  if (item.status === 'requested') {
    // Stĺpec „Požiadal(a)“: kto požiadavku vytvoril.
    const who = $('.who', li);
    who.hidden = false;
    const caption = document.createElement('span');
    caption.className = 'who-caption';
    caption.textContent = 'Požiadal(a)';
    who.append(caption);
    for (const name of String(item.addedBy || 'neznámy').split(', ')) {
      const pill = document.createElement('span');
      pill.className = 'who-pill';
      pill.textContent = name;
      who.append(pill);
    }
    who.title = 'Požiadal(a): ' + (item.addedBy || 'neznámy') + (item.addedAt ? ', ' + dateTime(item.addedAt) : '');
  } else if (item.addedBy) {
    metaParts.push('od ' + item.addedBy);
  }
  if (item.archived) metaParts.push('⚠ už sa nepredáva');
  $('.meta', li).textContent = metaParts.filter(Boolean).join(' · ');

  const priceEl = $('.price', li);
  const strong = document.createElement('span');
  strong.textContent = money(typeof item.price === 'number' ? item.price * item.qty : null);
  if (item.regularPrice && item.price < item.regularPrice) {
    strong.className = 'sale';
    strong.title = 'Akcia, bežne ' + money(item.regularPrice) + ' / ks';
  }
  priceEl.append(strong);
  if (item.qty > 1 && typeof item.price === 'number') {
    const unit = document.createElement('span');
    unit.className = 'unit';
    unit.textContent = money(item.price) + ' / ks';
    priceEl.append(unit);
  }

  const canEdit = isAdmin() || item.status === 'requested';
  $('.qty-val', li).textContent = item.qty + '×';
  $('.qty', li).classList.toggle('readonly', !canEdit);
  $('.minus', li).disabled = item.qty <= 1;
  $('.minus', li).onclick = () => patch(item, { qty: item.qty - 1 });
  $('.plus', li).onclick = () => patch(item, { qty: item.qty + 1 });

  const actions = $('.actions', li);
  const del = (q) => button('✕', q, () => {
    if (confirm(q + ': „' + item.name + '“?')) act('/api/shopping/items/' + item.id, { method: 'DELETE' });
  }, 'icon-btn danger');

  if (isAdmin()) {
    if (item.status === 'requested') {
      actions.append(button('🛒', 'Potvrdiť – dať do košíka', () => patch(item, { status: 'in_cart' }), 'icon-btn go'));
      actions.append(del('Zamietnuť požiadavku'));
    } else if (item.status === 'in_cart') {
      actions.append(button('✓', 'Kúpené', () => patch(item, { status: 'bought' }), 'icon-btn go'));
      actions.append(button('↩', 'Vrátiť medzi požiadavky', () => patch(item, { status: 'requested' })));
      actions.append(del('Odstrániť z košíka'));
    } else {
      actions.append(button('↩', 'Vrátiť do košíka', () => patch(item, { status: 'in_cart' })));
      actions.append(del('Odstrániť'));
    }
  } else if (item.status === 'requested') {
    actions.append(del('Odstrániť požiadavku'));
  }

  if (item.status === 'bought') {
    const votes = $('.votes', li);
    votes.hidden = false;
    votes.append(...voteWidget(item, null));
  }
  return li;
}

// ---------- Hlasovanie "kto to zjedol" ----------
function voteWidget(item, archiveId) {
  const eaters = item.eaters || [];
  const mine = eaters.includes(getName());
  const btn = button(mine ? '✓ Jedol(a) som' : '🍽 Jedol(a) som', mine ? 'Zrušiť môj hlas' : 'Označiť, že som to jedol/pil', () =>
    act('/api/vote', { method: 'POST', body: { itemId: item.id, archiveId, name: getName() } }),
  'vote-btn' + (mine ? ' on' : ''));

  const chips = document.createElement('div');
  chips.className = 'eaters';
  if (eaters.length) {
    for (const name of eaters) {
      const chip = document.createElement('span');
      chip.className = 'eater' + (name === getName() ? ' me' : '');
      chip.textContent = name;
      chips.append(chip);
    }
    const share = document.createElement('span');
    share.className = 'share muted';
    share.textContent = eaters.length > 1 ? 'po ' + money(lineTotal(item) / eaters.length) : 'celé ' + money(lineTotal(item));
    chips.append(share);
  } else {
    const none = document.createElement('span');
    none.className = 'muted';
    none.textContent = 'Zatiaľ nikto';
    chips.append(none);
  }
  return [btn, chips];
}

// Rozdelí ceny položiek medzi hlasujúcich rovným dielom.
function computeSplit(items) {
  const people = new Map();
  let unassigned = 0;
  let unassignedCount = 0;
  for (const item of items) {
    const total = lineTotal(item);
    const eaters = item.eaters || [];
    if (!eaters.length) {
      unassigned += total;
      unassignedCount++;
      continue;
    }
    for (const name of eaters) people.set(name, (people.get(name) || 0) + total / eaters.length);
  }
  // Za položky, za ktoré nikto nehlasoval, platí správca (David).
  if (unassignedCount) people.set(me.adminName, (people.get(me.adminName) || 0) + unassigned);
  const rows = [...people].sort((a, b) => b[1] - a[1]);
  return { rows, unassigned, unassignedCount, total: sum(items) };
}

function renderSplit(items) {
  const { rows, unassigned, unassignedCount, total } = computeSplit(items);
  const box = document.createElement('div');
  box.className = 'split card';
  const head = document.createElement('div');
  head.className = 'split-head';
  head.textContent = 'Kto koľko platí';
  box.append(head);

  const list = document.createElement('ul');
  list.className = 'split-list';
  const row = (label, amount, cls = '', note = '') => {
    const li = document.createElement('li');
    if (cls) li.className = cls;
    const a = document.createElement('span');
    a.textContent = label;
    if (note) {
      const n = document.createElement('small');
      n.className = 'muted';
      n.textContent = note;
      a.append(document.createElement('br'), n);
    }
    const b = document.createElement('span');
    b.className = 'num';
    b.textContent = money(amount);
    li.append(a, b);
    list.append(li);
  };
  const plural = (n) => (n === 1 ? 'položka' : n < 5 ? 'položky' : 'položiek');
  for (const [name, amount] of rows) {
    const note = name === me.adminName && unassignedCount
      ? `vrátane ${money(unassigned)} za ${unassignedCount} ${plural(unassignedCount)}, za ktoré nikto nehlasoval`
      : '';
    row(name, amount, name === getName() ? 'me' : '', note);
  }
  row('Spolu', total, 'total');
  box.append(list);
  return box;
}

function patch(item, body) {
  return act('/api/shopping/items/' + item.id, { method: 'PATCH', body });
}

// ---------- Archív ----------
// Rozbalené nákupy ostanú rozbalené aj po live aktualizácii.
const openArchive = new Set();
function renderArchiveEntry(entry) {
  const details = document.createElement('details');
  details.className = 'card archive-entry';
  details.open = openArchive.has(entry.id);
  details.addEventListener('toggle', () => {
    if (details.open) openArchive.add(entry.id); else openArchive.delete(entry.id);
  });

  const summary = document.createElement('summary');
  const title = document.createElement('div');
  title.className = 'archive-title';
  title.textContent = entry.title;
  const meta = document.createElement('div');
  meta.className = 'muted small-text';
  meta.textContent = dateTime(entry.finalizedAt) + ' · ' + entry.items.length + ' položiek';
  const left = document.createElement('div');
  left.append(title, meta);
  const total = document.createElement('div');
  total.className = 'archive-total';
  total.textContent = money(entry.total);
  summary.append(left, total);
  details.append(summary);

  const table = document.createElement('ul');
  table.className = 'archive-items';
  for (const item of entry.items) {
    const row = document.createElement('li');
    const name = document.createElement(item.url ? 'a' : 'span');
    if (item.url) { name.href = item.url; name.target = '_blank'; name.rel = 'noopener'; }
    name.textContent = item.name;
    const amount = document.createElement('span');
    amount.className = 'muted';
    amount.textContent = item.amount || '';
    const qty = document.createElement('span');
    qty.className = 'num';
    qty.textContent = item.qty + '×';
    const price = document.createElement('span');
    price.className = 'num';
    price.textContent = money(lineTotal(item));
    const votes = document.createElement('div');
    votes.className = 'votes';
    votes.append(...voteWidget(item, entry.id));
    row.append(name, amount, qty, price, votes);
    table.append(row);
  }
  const hint = document.createElement('p');
  hint.className = 'hint archive-hint';
  hint.textContent = 'Klikni na 🍽 Jedol(a) som pri všetkom, čo si jedol/pil. Za položky bez hlasu platí ' + me.adminName + '.';
  details.append(hint, table, renderSplit(entry.items));

  if (isAdmin()) {
    const bar = document.createElement('div');
    bar.className = 'archive-actions';
    bar.append(
      button('Premenovať', 'Premenovať nákup', () => {
        const t = prompt('Názov nákupu', entry.title);
        if (t && t.trim()) act('/api/archive/' + entry.id, { method: 'PATCH', body: { title: t } });
      }, 'ghost small'),
      button('Vrátiť medzi kúpené', 'Vrátiť nákup z archívu', () => {
        if (confirm('Vrátiť „' + entry.title + '“ z archívu späť medzi kúpené?')) {
          act('/api/archive/' + entry.id + '?action=reopen', { method: 'POST' });
        }
      }, 'ghost small'),
    );
    details.append(bar);
  }
  return details;
}

// ---------- Vykreslenie ----------
function render() {
  for (const group of $$('.group')) {
    const status = group.dataset.status;
    const items = state.items.filter((i) => i.status === status);
    $('.list', group).replaceChildren(...items.map(renderItem));
    $('.empty', group).hidden = items.length > 0;
    $('.count', group).textContent = items.length ? '(' + items.length + ')' : '';
    for (const b of $$('[data-move], #finalize-btn', group)) b.hidden = !isAdmin() || items.length === 0;
    $('#sum-' + status).textContent = money(sum(items));
    if (status === 'bought') {
      $('.vote-hint', group).hidden = items.length === 0;
      $('.split-slot', group).replaceChildren(...(items.length ? [renderSplit(items)] : []));
    }
  }
  $('#prices-updated').textContent = state.pricesUpdatedAt ? 'Ceny z ' + dateTime(state.pricesUpdatedAt) : '';

  const archive = state.archive || [];
  $('#archive-list').replaceChildren(...archive.map(renderArchiveEntry));
  $('#archive-empty').hidden = archive.length > 0;
  $('#archive-total').textContent = archive.length
    ? archive.length + ' nákupov · spolu ' + money(archive.reduce((s, a) => s + a.total, 0))
    : '';
}

// ---------- Akcie ----------
$('#add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#add-btn');
  $('#add-error').textContent = '';
  btn.disabled = true;
  btn.textContent = 'Načítavam…';
  try {
    await api('/api/shopping/items', {
      method: 'POST',
      body: { url: $('#url-input').value, qty: $('#qty-input').value, addedBy: getName() },
    });
    $('#url-input').value = '';
    $('#qty-input').value = 1;
  } catch (err) {
    $('#add-error').textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Pridať';
  }
});

for (const b of $$('[data-move]')) {
  b.addEventListener('click', () => {
    const [from, to] = b.dataset.move.split(':');
    act('/api/shopping/move', { method: 'POST', body: { from, to } });
  });
}

$('#finalize-btn').addEventListener('click', async () => {
  const bought = state.items.filter((i) => i.status === 'bought');
  const title = prompt(
    'Sfinalizovať ' + bought.length + ' kúpených položiek za ' + money(sum(bought)) + ' a presunúť do archívu.\n\nNázov nákupu:',
    'Nákup ' + new Date().toLocaleDateString('sk-SK'),
  );
  if (title === null) return;
  const res = await act('/api/shopping/finalize', { method: 'POST', body: { title } });
  if (res) location.hash = '#archiv';
});

$('#refresh-btn').addEventListener('click', async () => {
  const btn = $('#refresh-btn');
  btn.disabled = true;
  await act('/api/shopping/refresh-prices', { method: 'POST' });
  btn.disabled = false;
});

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    me = await api('/api/login', { method: 'POST', body: { password: $('#password').value } });
    $('#password').value = '';
    showApp();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});

$('#name-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#name-input').value.trim();
  if (!name) return;
  setName(name);
  showApp();
});

$('#user-btn').addEventListener('click', showNameScreen);

$('#logout-btn').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch {}
  showLogin();
});

// ---------- Štart ----------
(async () => {
  try {
    me = await api('/api/me');
    showApp();
  } catch {
    showLogin();
  }
})();
