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
  let saved = '';
  try { saved = localStorage.getItem(NAME_KEY) || ''; } catch {}
  if (saved && !$('#login-name').value) $('#login-name').value = saved;
  (saved ? $('#password') : $('#login-name')).focus();
}

// Ponúkne uloženie mena a hesla do správcu hesiel prehliadača (Chrome, Edge, Android…).
// Funguje iba na HTTPS alebo localhost; inde sa ticho preskočí a ostane bežné automatické vyplnenie.
async function offerSavePassword(name, password) {
  if (!window.PasswordCredential || !navigator.credentials) return;
  try {
    // Správca má v kľúčenke iné "používateľské meno", aby sa neprepísalo s rodinným heslom.
    const id = me.role === 'admin' ? me.adminName + ' (správca)' : name;
    await navigator.credentials.store(new PasswordCredential({ id, password, name: id }));
  } catch {}
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
    } else {
      actions.append(button('↩', 'Vrátiť medzi požiadavky', () => patch(item, { status: 'requested' })));
      actions.append(del('Odstrániť z košíka'));
    }
  } else if (item.status === 'requested') {
    actions.append(del('Odstrániť požiadavku'));
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

// ---------- Vyúčtovanie nákupu ----------
// Jedlo: cena položky sa delí rovným dielom medzi tých, čo hlasovali; bez hlasu platí správca.
// Spoločné výdavky: delia sa rovným dielom medzi všetkých v nákupe, platiteľovi sa odpočítajú.
// Nákup na Rohlíku zaplatil správca, preto sa mu jeho suma tiež odpočíta.
// Bilancia > 0 = dopláca, < 0 = dostane späť. Súčet bilancií je vždy 0.
function computeSplit(entry) {
  const admin = me.adminName;
  const food = new Map();
  let unassigned = 0;
  let unassignedCount = 0;
  for (const item of entry.items) {
    const total = lineTotal(item);
    const eaters = item.eaters || [];
    if (!eaters.length) {
      unassigned += total;
      unassignedCount++;
      continue;
    }
    for (const name of eaters) food.set(name, (food.get(name) || 0) + total / eaters.length);
  }
  if (unassignedCount) food.set(admin, (food.get(admin) || 0) + unassigned);

  const expenses = entry.expenses || [];
  const people = new Set([admin, ...food.keys(), ...expenses.map((x) => x.payer)]);
  const expensesTotal = expenses.reduce((s, x) => s + x.amount, 0);
  const expenseShare = people.size ? expensesTotal / people.size : 0;
  const foodTotal = sum(entry.items);

  const rows = [...people].map((name) => {
    const paidExpenses = expenses.filter((x) => x.payer === name).reduce((s, x) => s + x.amount, 0);
    const paidShop = name === admin ? foodTotal : 0;
    const f = food.get(name) || 0;
    const paid = paidExpenses + paidShop;
    return { name, food: f, expenses: expenseShare, paid, balance: f + expenseShare - paid };
  });
  rows.sort((a, b) => b.balance - a.balance);
  return { rows, unassigned, unassignedCount, foodTotal, expensesTotal, people: people.size };
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderSplit(entry) {
  const s = computeSplit(entry);
  const box = el('div', 'split card');
  box.append(el('div', 'split-head', 'Kto koľko platí'));

  const list = el('ul', 'split-list');
  for (const r of s.rows) {
    const li = el('li', r.name === getName() ? 'me' : '');
    const left = el('span');
    left.append(el('span', 'split-name', r.name));
    const parts = ['jedlo ' + money(r.food)];
    if (s.expensesTotal) parts.push('výdavky ' + money(r.expenses));
    if (r.paid) parts.push('zaplatil(a) ' + money(r.paid));
    left.append(el('small', 'muted split-detail', parts.join(' · ')));
    if (r.name === me.adminName && s.unassignedCount) {
      left.append(el('small', 'muted split-detail', `jedlo vrátane ${money(s.unassigned)} za ${s.unassignedCount} ${plural(s.unassignedCount)} bez hlasu`));
    }
    const right = el('span', 'num');
    if (Math.abs(r.balance) < 0.005) {
      right.textContent = 'vyrovnané';
      right.classList.add('even');
    } else if (r.balance > 0) {
      right.append(el('small', 'muted', 'dopláca '), document.createTextNode(money(r.balance)));
      right.classList.add('owes');
    } else {
      right.append(el('small', 'muted', 'dostane '), document.createTextNode(money(-r.balance)));
      right.classList.add('gets');
    }
    li.append(left, right);
    list.append(li);
  }
  const total = el('li', 'total');
  total.append(
    el('span', '', s.expensesTotal ? 'Nákup + výdavky' : 'Nákup spolu'),
    el('span', 'num', s.expensesTotal ? `${money(s.foodTotal)} + ${money(s.expensesTotal)}` : money(s.foodTotal)),
  );
  list.append(total);
  box.append(list);
  box.append(el('p', 'hint', `Nákup na Rohlíku zaplatil ${me.adminName}. Výdavky sa delia medzi ${s.people} ${s.people === 1 ? 'osobu' : 'osoby/osôb'} rovným dielom.`));
  return box;
}
function plural(n) {
  return n === 1 ? 'položka' : n < 5 ? 'položky' : 'položiek';
}

// Spoločné výdavky: formulár + zoznam (vpravo vedľa nákupu).
const expenseDrafts = new Map(); // id nákupu -> rozpísané hodnoty formulára
function renderExpenses(entry) {
  const box = el('div', 'expenses card');
  box.append(el('div', 'split-head', 'Spoločné výdavky'));
  box.append(el('p', 'hint', 'Zaplatil niekto niečo za celú skupinu (drevo, benzín, chata…)? Zapíš to sem, rozpočíta sa medzi všetkých.'));

  const list = el('ul', 'expense-list');
  for (const x of entry.expenses || []) {
    const li = el('li');
    const left = el('span');
    left.append(el('span', 'split-name', x.description), el('small', 'muted split-detail', 'zaplatil(a) ' + x.payer));
    const right = el('span', 'expense-right');
    right.append(el('span', 'num', money(x.amount)));
    if (isAdmin() || getName() === x.addedBy || getName() === x.payer) {
      right.append(button('✕', 'Zmazať výdavok', () => {
        if (confirm('Zmazať výdavok „' + x.description + '“ (' + money(x.amount) + ')?')) {
          act('/api/archive/' + entry.id + '/expenses/' + x.id, { method: 'DELETE', body: { name: getName() } });
        }
      }, 'icon-btn danger small-icon'));
    }
    li.append(left, right);
    list.append(li);
  }
  if (!(entry.expenses || []).length) list.append(el('li', 'muted', 'Zatiaľ žiadne výdavky.'));
  box.append(list);

  const form = el('form', 'expense-form');
  const payer = el('input');
  payer.placeholder = 'Kto zaplatil';
  payer.maxLength = 40;
  payer.value = getName();
  payer.setAttribute('aria-label', 'Kto zaplatil');
  const desc = el('input');
  desc.placeholder = 'Za čo (napr. drevo)';
  desc.maxLength = 60;
  desc.required = true;
  desc.setAttribute('aria-label', 'Za čo');
  const amount = el('input');
  amount.type = 'number';
  amount.inputMode = 'decimal';
  amount.min = '0.01';
  amount.step = '0.01';
  amount.placeholder = 'Kč';
  amount.required = true;
  amount.setAttribute('aria-label', 'Suma v Kč');
  const submit = el('button', 'primary small', 'Pridať');
  submit.type = 'submit';
  form.append(payer, desc, amount, submit);

  // Live aktualizácia prekresľuje stránku: rozpísaný výdavok a kurzor sa musia zachovať.
  const draft = expenseDrafts.get(entry.id);
  const fields = { payer, desc, amount };
  for (const [key, input] of Object.entries(fields)) {
    input.dataset.draft = entry.id + ':' + key;
    if (draft && draft[key] !== undefined) input.value = draft[key];
    input.addEventListener('input', () => {
      const d = expenseDrafts.get(entry.id) || {};
      d[key] = input.value;
      expenseDrafts.set(entry.id, d);
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    const res = await act('/api/archive/' + entry.id + '/expenses', {
      method: 'POST',
      body: { payer: payer.value, description: desc.value, amount: amount.value, name: getName() },
    });
    submit.disabled = false;
    if (res) {
      expenseDrafts.delete(entry.id);
      desc.value = '';
      amount.value = '';
    }
  });
  box.append(form);
  return box;
}

// ---------- Archív ----------
// Rozbalené nákupy ostanú rozbalené aj po live aktualizácii.
const openArchive = new Set();
// current = aktuálny nákup na prvej stránke: vždy rozbalený.
function renderArchiveEntry(entry, current = false) {
  const details = document.createElement('details');
  details.className = 'card archive-entry' + (current ? ' is-current' : '');
  details.open = current || openArchive.has(entry.id);
  details.addEventListener('toggle', () => {
    if (details.open) openArchive.add(entry.id); else openArchive.delete(entry.id);
  });

  const expensesTotal = (entry.expenses || []).reduce((s, x) => s + x.amount, 0);
  const summary = document.createElement('summary');
  const title = el('div', 'archive-title', entry.title);
  const metaParts = ['kúpené ' + dateTime(entry.finalizedAt), entry.items.length + ' položiek'];
  if (expensesTotal) metaParts.push('výdavky ' + money(expensesTotal));
  const meta = el('div', 'muted small-text', metaParts.join(' · '));
  const left = el('div');
  left.append(title, meta);
  if (!current && entry.id === state.currentPurchaseId) title.append(' ', el('span', 'badge', 'aktuálny'));
  summary.append(left, el('div', 'archive-total', money(entry.total)));
  details.append(summary);

  const table = el('ul', 'archive-items');
  for (const item of entry.items) {
    const row = el('li');
    const name = el(item.url ? 'a' : 'span', '', item.name);
    if (item.url) { name.href = item.url; name.target = '_blank'; name.rel = 'noopener'; }
    const votes = el('div', 'votes');
    votes.append(...voteWidget(item, entry.id));
    row.append(name, el('span', 'muted', item.amount || ''), el('span', 'num', item.qty + '×'), el('span', 'num', money(lineTotal(item))), votes);
    table.append(row);
  }
  const main = el('div', 'purchase-main');
  main.append(
    el('p', 'hint archive-hint', 'Klikni na 🍽 Jedol(a) som pri všetkom, čo si jedol/pil. Za položky bez hlasu platí ' + me.adminName + '.'),
    table,
  );
  // Vpravo vedľa nákupu: spoločné výdavky a vyúčtovanie.
  const side = el('aside', 'purchase-side');
  side.append(renderExpenses(entry), renderSplit(entry));
  const body = el('div', 'purchase-body');
  body.append(main, side);
  details.append(body);

  if (isAdmin()) {
    const bar = el('div', 'archive-actions');
    bar.append(
      button('Premenovať', 'Premenovať nákup', () => {
        const t = prompt('Názov nákupu', entry.title);
        if (t && t.trim()) act('/api/archive/' + entry.id, { method: 'PATCH', body: { title: t } });
      }, 'ghost small'),
      button('Vrátiť do košíka', 'Vrátiť nákup späť do košíka', () => {
        const warn = (entry.expenses || []).length ? ' Spoločné výdavky pri ňom sa zmažú.' : '';
        if (confirm('Vrátiť „' + entry.title + '“ späť do košíka? Nákup zmizne z archívu.' + warn)) {
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
  // Zapamätať, v ktorom políčku výdavku bol kurzor, aby ho prekreslenie nezrušilo.
  const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.draft : null;
  renderAll();
  if (focused) {
    const target = $$('[data-draft]').find((i) => i.dataset.draft === focused && i.offsetParent !== null);
    if (target) {
      target.focus();
      try { target.setSelectionRange(target.value.length, target.value.length); } catch {}
    }
  }
}

function renderAll() {
  for (const group of $$('.group[data-status]')) {
    const status = group.dataset.status;
    const items = state.items.filter((i) => i.status === status);
    $('.list', group).replaceChildren(...items.map(renderItem));
    $('.empty', group).hidden = items.length > 0;
    $('.count', group).textContent = items.length ? '(' + items.length + ')' : '';
    for (const b of $$('[data-move], #purchase-btn', group)) b.hidden = !isAdmin() || items.length === 0;
    $('#sum-' + status).textContent = money(sum(items));
  }
  $('#prices-updated').textContent = state.pricesUpdatedAt ? 'Ceny z ' + dateTime(state.pricesUpdatedAt) : '';

  const archive = state.archive || [];
  // Aktuálny nákup (posledný kúpený) je na prvej stránke, kým David neklikne "Nový nákup".
  const current = archive.find((a) => a.id === state.currentPurchaseId);
  $('#current-section').hidden = !current;
  $('#current-slot').replaceChildren(...(current ? [renderArchiveEntry(current, true)] : []));
  $('#new-purchase-btn').hidden = !isAdmin() || !current;
  $('#sum-current').textContent = money(current ? current.total : 0);

  $('#archive-list').replaceChildren(...archive.map((a) => renderArchiveEntry(a)));
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

$('#purchase-btn').addEventListener('click', async () => {
  const cart = state.items.filter((i) => i.status === 'in_cart');
  const title = prompt(
    'Kúpené: ' + cart.length + ' položiek za ' + money(sum(cart)) + '.\n' +
      'Nákup sa uloží do archívu a ostane na prvej stránke na hlasovanie, kto čo zjedol.\n\nNázov nákupu:',
    'Nákup ' + new Date().toLocaleDateString('sk-SK'),
  );
  if (title === null) return;
  const res = await act('/api/shopping/purchase', { method: 'POST', body: { title } });
  if (res) setTimeout(() => $('#current-section').scrollIntoView({ behavior: 'smooth' }), 300);
});

$('#new-purchase-btn').addEventListener('click', () => {
  if (!confirm('Začať nový nákup? Aktuálny nákup zmizne z prvej stránky a ostane iba v archíve (hlasovať sa dá ďalej tam).')) return;
  act('/api/shopping/new-purchase', { method: 'POST' });
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
    const name = $('#login-name').value.trim();
    const password = $('#password').value;
    me = await api('/api/login', { method: 'POST', body: { password } });
    // Meno z prihlásenia sa použije ako meno v aplikácii (správca má vždy svoje meno).
    if (me.role !== 'admin' && name) setName(name);
    await offerSavePassword(name, password);
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

async function logout() {
  try { await api('/api/logout', { method: 'POST' }); } catch {}
  showLogin();
}
for (const id of ['#logout-btn', '#logout-top', '#logout-name']) $(id).addEventListener('click', logout);

// ---------- Štart ----------
(async () => {
  try {
    me = await api('/api/me');
    showApp();
  } catch {
    showLogin();
  }
})();
