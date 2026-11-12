// Rodinný server – zdieľaný nákupný zoznam (rohlik.cz).
// Bez závislostí: stačí Node.js 18+. Spustenie: node server.js
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'shopping.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');

// config.json obsahuje heslá a nie je v gite. Ak chýba, vytvorí sa z config.example.json.
const CONFIG_FILE = path.join(ROOT, 'config.json');
if (!fs.existsSync(CONFIG_FILE)) {
  fs.copyFileSync(path.join(ROOT, 'config.example.json'), CONFIG_FILE);
  console.warn('Vytvorený config.json z config.example.json – zmeň v ňom heslá!');
}
const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
const PORT = Number(process.env.PORT || config.port || 8080);
const PASSWORD = String(process.env.PASSWORD || config.password);
// Správca (David) má vlastné heslo: potvrdzuje požiadavky, finalizuje nákupy.
const ADMIN_NAME = String(config.adminName || 'Správca');
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || config.adminPassword || '');
const STATUSES = ['requested', 'in_cart', 'bought'];
const MAX_ITEMS = 300; // max položiek v aktuálnom nákupe (ochrana pred zahltením)
const PRICE_REFRESH_MS = 6 * 60 * 60 * 1000; // ceny obnovovať každých 6 h
const ROHLIK_API = 'https://www.rohlik.cz/api/v1';

fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- Session (podpísaný cookie, prežije reštart servera) ----------
if (!fs.existsSync(SECRET_FILE)) fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString('hex'));
const SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();
const SESSION_DAYS = 90;

function sign(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('hex');
}
// Token: "<expiracia>.<rola>.<podpis>". Heslá sú súčasťou podpisu:
// po zmene hesla sa všetci musia prihlásiť znova.
function makeSession(role) {
  const expires = Date.now() + SESSION_DAYS * 864e5;
  const payload = expires + '.' + role;
  return payload + '.' + sign(payload + PASSWORD + ADMIN_PASSWORD);
}
function sessionRole(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [expires, role, mac] = parts;
  const expected = sign(expires + '.' + role + PASSWORD + ADMIN_PASSWORD);
  if (mac.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  if (Number(expires) <= Date.now()) return null;
  return role === 'admin' ? 'admin' : 'user';
}
function safeEqual(a, b) {
  return typeof a === 'string' && a.length === b.length && b.length > 0 &&
    crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
function getCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}
function getRole(req) {
  return sessionRole(getCookie(req, 'session'));
}

// Brzda na hádanie hesla:
//  - max 10 zlých pokusov za 10 minút z jednej IP,
//  - poistka: max 30 zlých pokusov za 10 minút spolu zo všetkých IP
//    (útočník s mnohými IP adresami tak nestihne heslo uhádnuť; prihlásení ostávajú prihlásení).
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const PER_IP_LIMIT = 10;
const GLOBAL_LIMIT = 30;
const loginFailures = new Map(); // ip -> [časy]
let globalFailures = [];

// Hlavičkám X-Forwarded-For veríme iba vtedy, keď spojenie prišlo z tohto počítača
// (Tailscale Funnel). Klient si môže hlavičku poslať sám, preto berieme POSLEDNÚ
// hodnotu – tú pripája proxy, nie klient. Iné hlavičky (napr. CF-Connecting-IP) ignorujeme.
function isLoopback(addr) {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}
function clientIp(req) {
  const remote = req.socket.remoteAddress || '';
  if (!isLoopback(remote)) return remote;
  const chain = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  return chain.length ? chain[chain.length - 1] : remote;
}
function recent(list) {
  const now = Date.now();
  return list.filter((t) => now - t < LOGIN_WINDOW_MS);
}
function loginBlocked(ip) {
  globalFailures = recent(globalFailures);
  const list = recent(loginFailures.get(ip) || []);
  if (list.length) loginFailures.set(ip, list); else loginFailures.delete(ip);
  return list.length >= PER_IP_LIMIT || globalFailures.length >= GLOBAL_LIMIT;
}
function recordFailure(ip) {
  const now = Date.now();
  const list = loginFailures.get(ip) || [];
  list.push(now);
  loginFailures.set(ip, list);
  globalFailures.push(now);
  console.warn(`[${new Date().toISOString()}] Zlé heslo z ${ip} (spolu za 10 min: ${globalFailures.length})`);
}
// Pamäť nerastie donekonečna: staré záznamy sa raz za čas vyčistia.
setInterval(() => {
  for (const [ip, list] of loginFailures) {
    const r = recent(list);
    if (r.length) loginFailures.set(ip, r); else loginFailures.delete(ip);
  }
}, LOGIN_WINDOW_MS).unref();

// Jednoduchý limit pre drahšie akcie (volania na rohlik.cz).
const actionTimes = new Map(); // kľúč -> [časy]
function rateLimited(key, max, windowMs) {
  const now = Date.now();
  const list = (actionTimes.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) {
    actionTimes.set(key, list);
    return true;
  }
  list.push(now);
  actionTimes.set(key, list);
  return false;
}

// ---------- Dáta ----------
// data.items   – aktuálny nákup; každá položka má status requested | in_cart | bought
// data.archive – sfinalizované nákupy (história), najnovší prvý
function loadData() {
  let d;
  try {
    d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    d = {};
  }
  d.items = d.items || [];
  d.archive = d.archive || [];
  d.pricesUpdatedAt = d.pricesUpdatedAt || null;
  for (const item of d.items) {
    // Staršie dáta mali iba bought: true/false.
    if (!STATUSES.includes(item.status)) item.status = item.bought ? 'bought' : 'requested';
    delete item.bought;
  }
  return d;
}
let data = loadData();
function saveData() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_FILE);
  broadcast();
}

// ---------- Rohlík ----------
// Podporované tvary URL:
//   https://www.rohlik.cz/1294559-okurka-hadovka
//   https://www.rohlik.cz/c300102013-zelenina?productPopup=1294559-okurka
function parseRohlikUrl(input) {
  let url;
  try {
    url = new URL(String(input).trim());
  } catch {
    return null;
  }
  if (!/^(www\.)?rohlik\.cz$/i.test(url.hostname)) return null;
  const popup = url.searchParams.get('productPopup');
  const fromPopup = popup && popup.match(/^(\d+)/);
  if (fromPopup) return Number(fromPopup[1]);
  const fromPath = url.pathname.match(/^\/(\d+)(?:-|$)/);
  if (fromPath) return Number(fromPath[1]);
  return null;
}

async function rohlikGet(pathAndQuery) {
  const res = await fetch(ROHLIK_API + pathAndQuery, {
    headers: { 'User-Agent': 'Mozilla/5.0 (RodinnyServer)', Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error('Rohlík odpovedal ' + res.status);
  return res.json();
}

function effectivePrice(p) {
  if (!p || !p.price) return null;
  let amount = p.price.amount;
  for (const sale of p.sales || []) {
    const saleAmount = sale && sale.price && sale.price.amount;
    if (typeof saleAmount === 'number' && saleAmount < amount) amount = saleAmount;
  }
  return amount;
}

async function fetchProduct(id) {
  const [info, price] = await Promise.all([
    rohlikGet('/products/' + id),
    rohlikGet('/products/' + id + '/prices'),
  ]);
  return {
    productId: id,
    name: info.name,
    amount: info.textualAmount || '',
    image: (info.images && info.images[0]) || null,
    url: 'https://www.rohlik.cz/' + id + '-' + (info.slug || ''),
    price: effectivePrice(price),
    regularPrice: price && price.price ? price.price.amount : null,
    currency: (price && price.price && price.price.currency) || 'CZK',
    archived: !!info.archived,
  };
}

// Kúpeným položkám necháva zaplatenú cenu, obnovuje iba požiadavky a košík.
async function refreshPrices() {
  const open = data.items.filter((i) => i.status !== 'bought' && i.productId);
  const ids = [...new Set(open.map((i) => i.productId))];
  if (!ids.length) return;
  const byId = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const q = chunk.map((id) => 'products=' + id).join('&');
    const prices = await rohlikGet('/products/prices?' + q);
    for (const p of prices) byId.set(p.productId, p);
  }
  for (const item of open) {
    const p = byId.get(item.productId);
    if (!p) continue;
    item.price = effectivePrice(p);
    item.regularPrice = p.price ? p.price.amount : null;
  }
  data.pricesUpdatedAt = new Date().toISOString();
  saveData();
}

// ---------- Live aktualizácie (Server-Sent Events) ----------
const clients = new Set();
function broadcast() {
  const msg = 'data: ' + JSON.stringify(data) + '\n\n';
  for (const res of clients) res.write(msg);
}

// ---------- HTTP ----------
function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 64 * 1024) {
        reject(new Error('Príliš veľké'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('Neplatný JSON'));
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Zakázané');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Nenájdené');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
}

function cleanName(v) {
  return String(v || '').trim().slice(0, 40);
}

async function handleApi(req, res, url) {
  const { pathname } = url;
  const method = req.method;

  if (pathname === '/api/login' && method === 'POST') {
    const ip = clientIp(req);
    if (loginBlocked(ip)) return send(res, 429, { error: 'Veľa pokusov, skús o 10 minút.' });
    const body = await readBody(req);
    let role = null;
    if (safeEqual(body.password, ADMIN_PASSWORD)) role = 'admin';
    else if (safeEqual(body.password, PASSWORD)) role = 'user';
    if (!role) {
      recordFailure(ip);
      return send(res, 401, { error: 'Nesprávne heslo.' });
    }
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    return send(res, 200, { ok: true, role, adminName: ADMIN_NAME }, {
      'Set-Cookie': `session=${makeSession(role)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`,
    });
  }

  if (pathname === '/api/logout' && method === 'POST') {
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  const role = getRole(req);
  if (!role) return send(res, 401, { error: 'Neprihlásený.' });
  const isAdmin = role === 'admin';
  const adminOnly = () => send(res, 403, { error: 'Toto môže urobiť iba ' + ADMIN_NAME + '.' });

  if (pathname === '/api/me' && method === 'GET') return send(res, 200, { ok: true, role, adminName: ADMIN_NAME });

  if (pathname === '/api/shopping' && method === 'GET') return send(res, 200, data);

  if (pathname === '/api/shopping/events' && method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('data: ' + JSON.stringify(data) + '\n\n');
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      clients.delete(res);
    });
    return;
  }

  // Nová položka je vždy "Požiadavka na kúpu".
  if (pathname === '/api/shopping/items' && method === 'POST') {
    const body = await readBody(req);
    const productId = parseRohlikUrl(body.url);
    if (!productId) {
      return send(res, 400, { error: 'Vlož odkaz na konkrétny produkt z rohlik.cz (napr. https://www.rohlik.cz/1294559-okurka).' });
    }
    const qty = Math.max(1, Math.min(99, parseInt(body.qty, 10) || 1));
    const who = isAdmin ? ADMIN_NAME : cleanName(body.addedBy);

    // Ochrana pred zahltením: limit volaní na rohlik.cz a celkový počet položiek.
    if (rateLimited('add', 60, 60 * 1000)) {
      return send(res, 429, { error: 'Príliš veľa pridávania naraz, skús o chvíľu.' });
    }
    if (data.items.length >= MAX_ITEMS) {
      return send(res, 400, { error: `Zoznam je plný (${MAX_ITEMS} položiek). ${ADMIN_NAME} musí najprv sfinalizovať nákup.` });
    }

    const existing = data.items.find((i) => i.productId === productId && i.status === 'requested');
    if (existing) {
      existing.qty = Math.min(99, existing.qty + qty);
      if (who && !String(existing.addedBy || '').split(', ').includes(who)) {
        existing.addedBy = existing.addedBy ? existing.addedBy + ', ' + who : who;
      }
      saveData();
      return send(res, 200, { item: existing, merged: true });
    }

    let product;
    try {
      product = await fetchProduct(productId);
    } catch (e) {
      return send(res, 502, { error: 'Produkt sa nepodarilo načítať z rohlik.cz. Skontroluj odkaz.' });
    }
    const item = {
      id: crypto.randomUUID(),
      ...product,
      qty,
      note: cleanName(body.note),
      addedBy: who,
      addedAt: new Date().toISOString(),
      status: 'requested',
    };
    data.items.push(item);
    saveData();
    return send(res, 201, { item });
  }

  const itemMatch = pathname.match(/^\/api\/shopping\/items\/([\w-]+)$/);
  if (itemMatch) {
    const item = data.items.find((i) => i.id === itemMatch[1]);
    if (!item) return send(res, 404, { error: 'Položka neexistuje.' });
    // Ostatní môžu meniť iba požiadavky; košík a kúpené spravuje admin.
    if (!isAdmin && item.status !== 'requested') return adminOnly();
    if (method === 'PATCH') {
      const body = await readBody(req);
      if (body.status !== undefined) {
        if (!isAdmin) return adminOnly();
        if (!STATUSES.includes(body.status)) return send(res, 400, { error: 'Neplatný stav.' });
        item.status = body.status;
        item.statusAt = new Date().toISOString();
      }
      if (body.qty !== undefined) item.qty = Math.max(1, Math.min(99, parseInt(body.qty, 10) || 1));
      if (body.note !== undefined) item.note = cleanName(body.note);
      saveData();
      return send(res, 200, { item });
    }
    if (method === 'DELETE') {
      data.items = data.items.filter((i) => i !== item);
      saveData();
      return send(res, 200, { ok: true });
    }
  }

  // Hromadná zmena stavu, napr. všetky požiadavky do košíka, celý košík kúpený.
  if (pathname === '/api/shopping/move' && method === 'POST') {
    if (!isAdmin) return adminOnly();
    const body = await readBody(req);
    if (!STATUSES.includes(body.from) || !STATUSES.includes(body.to)) {
      return send(res, 400, { error: 'Neplatný stav.' });
    }
    const now = new Date().toISOString();
    for (const item of data.items) {
      if (item.status === body.from) {
        item.status = body.to;
        item.statusAt = now;
      }
    }
    saveData();
    return send(res, 200, { ok: true });
  }

  // Sfinalizovať nákup: kúpené položky sa presunú do archívu ako jeden historický nákup.
  if (pathname === '/api/shopping/finalize' && method === 'POST') {
    if (!isAdmin) return adminOnly();
    const body = await readBody(req);
    const bought = data.items.filter((i) => i.status === 'bought');
    if (!bought.length) return send(res, 400, { error: 'Nie je čo finalizovať, žiadna položka nie je kúpená.' });
    const total = bought.reduce((s, i) => s + (typeof i.price === 'number' ? i.price * i.qty : 0), 0);
    const now = new Date();
    const entry = {
      id: crypto.randomUUID(),
      title: String(body.title || '').trim().slice(0, 80) || 'Nákup ' + now.toLocaleDateString('sk-SK'),
      finalizedAt: now.toISOString(),
      finalizedBy: ADMIN_NAME,
      total: Math.round(total * 100) / 100,
      items: bought.map(({ status, statusAt, ...rest }) => rest),
    };
    data.archive.unshift(entry);
    data.items = data.items.filter((i) => i.status !== 'bought');
    saveData();
    return send(res, 201, { archive: entry });
  }

  const archiveMatch = pathname.match(/^\/api\/archive\/([\w-]+)$/);
  if (archiveMatch) {
    if (!isAdmin) return adminOnly();
    const entry = data.archive.find((a) => a.id === archiveMatch[1]);
    if (!entry) return send(res, 404, { error: 'Nákup v archíve neexistuje.' });
    if (method === 'PATCH') {
      const body = await readBody(req);
      if (body.title !== undefined) entry.title = String(body.title).trim().slice(0, 80) || entry.title;
      saveData();
      return send(res, 200, { archive: entry });
    }
    // Vrátiť z archívu späť medzi kúpené (napr. omylom finalizované).
    if (method === 'POST' && url.searchParams.get('action') === 'reopen') {
      for (const item of entry.items) data.items.push({ ...item, status: 'bought' });
      data.archive = data.archive.filter((a) => a !== entry);
      saveData();
      return send(res, 200, { ok: true });
    }
  }


  if (pathname === '/api/shopping/refresh-prices' && method === 'POST') {
    if (rateLimited('refresh', 1, 60 * 1000)) {
      return send(res, 429, { error: 'Ceny sa obnovovali pred chvíľou, skús o minútu.' });
    }
    try {
      await refreshPrices();
      return send(res, 200, { ok: true, pricesUpdatedAt: data.pricesUpdatedAt });
    } catch {
      return send(res, 502, { error: 'Rohlík teraz neodpovedá, skús neskôr.' });
    }
  }

  return send(res, 404, { error: 'Nenájdené.' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // Stránka nesmie byť vložená do cudzieho webu (clickjacking) a smie načítať
  // iba vlastné skripty/štýly a obrázky z CDN Rohlíka.
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' https://cdn.rohlik.cz; script-src 'self'; style-src 'self'; " +
      "connect-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
  );
  res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Metóda nie je povolená');
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: 'Chyba servera.' });
  }
});

server.listen(PORT, () => {
  console.log(`Rodinný server beží na http://localhost:${PORT}`);
});

setInterval(() => {
  refreshPrices().catch((e) => console.error('Obnova cien zlyhala:', e.message));
}, PRICE_REFRESH_MS);
