/* Piaf — noyau : utilitaires, état, API, session, temps réel, boîtes de dialogue, routeur.
   Aucun innerHTML avec du contenu utilisateur : tout est construit avec h() / textContent. */
(() => {
'use strict';
const CFG = window.PIAF_CONFIG;
const Piaf = window.Piaf = { views: {} };

// ------------------------------------------------------------------ DOM
function appendKids(el, kids) {
  for (const k of kids.flat(Infinity)) { if (k == null || k === false) continue; el.append(k.nodeType ? k : document.createTextNode(String(k))); }
}
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  appendKids(el, kids);
  return el;
}
const $ = (s, el = document) => el.querySelector(s);

const ICONS = {
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14.5a5.5 5.5 0 0 1 4.5 5.5"/>',
  camera: '<path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/>', // tracés 24×24, icônes trait fin (constantes, jamais de contenu utilisateur)
  back: '<path d="M15 18l-6-6 6-6"/>', plus: '<path d="M12 5v14M5 12h14"/>', x: '<path d="M18 6L6 18M6 6l12 12"/>',
  send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>',
  clip: '<path d="M21.4 11.6l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  dots: '<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>',
  check: '<path d="M20 6L9 17l-5-5"/>', check2: '<path d="M18 6L7 17l-5-5"/><path d="M22 10l-9 9-2-2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.5"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  play: '<path d="M7 4l13 8-13 8z"/>', copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  reply: '<path d="M9 17l-5-5 5-5"/><path d="M4 12h11a5 5 0 0 1 5 5v2"/>', fwd: '<path d="M15 17l5-5-5-5"/><path d="M20 12H9a5 5 0 0 0-5 5v2"/>',
  pin: '<path d="M12 17v5"/><path d="M9 3h6l-1 7 3 3H7l3-3z"/>', trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  flag: '<path d="M5 21V4M5 4h12l-2 4 2 4H5"/>', ban: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  archive: '<path d="M3 4h18v4H3zM5 8v12h14V8M10 12h4"/>',
  mute: '<path d="M13.7 21a2 2 0 0 1-3.4 0M18 8a6 6 0 0 0-9.3-5M6 6a6 6 0 0 0-1 2c0 7-3 9-3 9h13M2 2l20 20"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>', user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M10 9l5 3-5 3z"/>', eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
  bubble: '<path d="M21 12a8 8 0 0 1-11.7 7.1L3 21l1.9-6.3A8 8 0 1 1 21 12z"/>', down: '<path d="M6 9l6 6 6-6"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>', pause: '<path d="M8 5v14M16 5v14"/>',
  poll: '<path d="M5 20V10M12 20V4M19 20v-7"/>', list: '<path d="M9 6h12M9 12h12M9 18h12M3.5 6l1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>', at: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.9 7.9"/>',
};
function icon(name, size = 22) {
  const s = h('span', { class: 'ico', 'aria-hidden': 'true' });
  s.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  return s;
}
function iconBtn(name, label, onclick, cls = '') {
  return h('button', { class: 'icon-btn ' + cls, type: 'button', 'aria-label': label, title: label, onclick }, icon(name));
}

// ------------------------------------------------------------------ stockage local (tolérant aux erreurs)
const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota / mode privé */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* */ } },
};

// ------------------------------------------------------------------ formats
const fmt = {
  time: (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
  dateTime: (iso) => new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }),
  dayKey: (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; },
  dayLabel(iso) {
    const d = new Date(iso), n = new Date(), y = new Date(); y.setDate(n.getDate() - 1);
    const same = (a, b) => a.toDateString() === b.toDateString();
    if (same(d, n)) return "Aujourd'hui"; if (same(d, y)) return 'Hier';
    return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === n.getFullYear() ? undefined : 'numeric' });
  },
  listTime(iso) {
    const d = new Date(iso), n = new Date(), diff = (n - d) / 864e5;
    if (d.toDateString() === n.toDateString()) return fmt.time(iso);
    if (diff < 2 && n.getDate() - d.getDate() === 1) return 'Hier';
    if (diff < 7) return d.toLocaleDateString('fr-FR', { weekday: 'short' });
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  },
  size(b) {
    if (b < 1024) return `${b} o`; if (b < 1048576) return `${(b / 1024).toFixed(0)} Ko`;
    return `${(b / 1048576).toFixed(b < 10485760 ? 1 : 0).replace('.', ',')} Mo`;
  },
  id8: (id) => `${id.slice(0, 4)} ${id.slice(4)}`,
};
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));

// Photos de profil : fichiers JPEG 256×256 dans le bucket privé `avatars`, chargés une fois par chemin (le chemin change à chaque nouvelle photo).
const avatarUrls = new Map();
function avatarUrl(path) {
  if (!avatarUrls.has(path)) avatarUrls.set(path, sb.storage.from('avatars').download(path)
    .then(({ data, error }) => { if (error || !data) throw error || new Error('vide'); return URL.createObjectURL(data); })
    .catch(() => { avatarUrls.delete(path); return null; }));
  return avatarUrls.get(path);
}
function avatar(name, size = 44, userId, pathOverride, square = false) {
  let hash = 0; for (const ch of name || '?') hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  const el = h('span', { class: 'avatar' + (square ? ' sq' : ''), style: { width: size + 'px', height: size + 'px', fontSize: size * 0.42 + 'px', '--hue': String(hash % 360) }, 'aria-hidden': 'true' }, [...(name || '?')][0].toUpperCase());
  const p = pathOverride || (userId && (S.me && userId === S.me.id ? S.me.avatar_path : S.avatars[userId]));
  if (p) avatarUrl(p).then((u) => { if (u) el.replaceChildren(h('img', { src: u, alt: '' })); });
  return el;
}

// Texte → nœuds, avec liens http(s) cliquables et sûrs.
function linkify(text) {
  const out = [], re = /https?:\/\/[^\s<>"']+/gi; let last = 0, m;
  while ((m = re.exec(text))) {
    let url = m[0]; const trail = url.match(/[.,;:!?)\]]+$/); if (trail) url = url.slice(0, -trail[0].length);
    let ok = false; try { const u = new URL(url); ok = u.protocol === 'http:' || u.protocol === 'https:'; } catch { /* */ }
    if (!ok) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(h('a', { href: url, target: '_blank', rel: 'noopener noreferrer nofollow', onclick: (e) => e.stopPropagation() }, url));
    last = m.index + url.length; re.lastIndex = last;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// ------------------------------------------------------------------ erreurs lisibles
const ERR = {
  not_authenticated: 'Votre session a expiré. Rouvrez l’application.',
  forbidden: 'Action non autorisée.', not_found: 'Introuvable.',
  blocked: 'Impossible d’échanger avec cette personne tant qu’un blocage est actif.',
  rate_limited: 'Trop d’actions en peu de temps. Réessayez dans un instant.',
  invalid_input: 'Contenu invalide.', window_expired: 'Le délai pour cette action est dépassé.',
  too_many_pins: '5 messages épinglés au maximum par conversation.', use_media_delete: 'Utilisez la suppression du média.',
  group_full: 'Un groupe est limité à 32 personnes.', last_member: 'Vous êtes la dernière personne du groupe : supprimez-le plutôt.', last_admin: 'Il faut au moins un administrateur.',
  bad_image: 'Image illisible. Essayez une photo JPEG ou PNG.',
  bad_type: 'Format non accepté. Photos : JPEG, PNG, WebP, GIF, HEIC. Vidéos : MP4, WebM, MOV.',
  file_too_large: 'Fichier trop volumineux.', upload_missing: 'Le fichier n’est pas arrivé sur le serveur. Réessayez.',
  delete_failed: 'Le fichier n’a pas pu être supprimé du serveur pour l’instant. Il reste masqué et la suppression sera retentée.',
  locked: 'Trop de tentatives. Réessayez plus tard.', invalid_credentials: 'Identifiant ou code secret incorrect.',
  invalid_name: 'Choisissez un nom d’affichage (1 à 40 caractères).', invalid_password: 'Le code secret doit faire entre 8 et 64 caractères.',
  signup_rate_limited: 'Trop de créations de comptes pour le moment. Réessayez plus tard.', signup_failed: 'Création du compte impossible. Réessayez.',
  server_misconfigured: 'Le service n’est pas encore configuré (voir README).', network: 'Pas de connexion. Réessayez quand le réseau revient.',
  poll_closed: 'Ce sondage est clos.', poll_has_votes: 'Impossible : des votes existent déjà sur ce sondage.', too_many_options: 'Un sondage accepte 12 options au maximum.', too_many_items: 'Une liste accepte 100 éléments au maximum (50 à sa création).',
  too_many_watches: 'Limite de suivis atteinte (10 par personne, 5 par discussion). Arrêtez-en un d’abord.',
  not_enabled: 'Cette fonction n’est pas encore activée sur le serveur.',
  quota_exceeded: 'Le quota de médias de cette discussion est atteint.',
  storage_cleanup_failed: 'Suppression des fichiers impossible pour l’instant ; le compte n’a pas été supprimé. Réessayez.',
};
class PiafError extends Error { constructor(code, extra) { super(code); this.code = code; Object.assign(this, extra); } }
function toCode(e) {
  if (e instanceof PiafError) return e.code;
  const msg = String(e?.message || e || '');
  if (/could not find the function|PGRST202/i.test(msg)) return 'not_enabled';
  for (const k of Object.keys(ERR)) if (msg === k || msg.includes(k)) return k;
  if (!navigator.onLine || /fetch|network|load failed|timeout/i.test(msg)) return 'network';
  return 'unknown';
}
function errText(e) {
  const c = typeof e === 'string' ? e : toCode(e);
  if (c === 'too_many_files') return `Maximum ${S.cfg.max_files_per_batch ?? 10} fichiers par envoi.`;
  if (c === 'file_too_large') return `Fichier trop volumineux (photo : ${fmt.size(S.cfg.photo_max_bytes ?? 10485760)} max, vidéo : ${fmt.size(S.cfg.video_max_bytes ?? 26214400)} max).`;
  return ERR[c] || 'Une erreur est survenue. Réessayez.';
}

// ------------------------------------------------------------------ état global + bus
const S = Piaf.S = { me: null, settings: { read_receipts: true, notifications: true }, cfg: {}, online: navigator.onLine, rt: 'CONNECTING', convs: [], route: { name: 'boot' }, avatars: {} };
const bus = Piaf.bus = (() => {
  const m = new Map();
  return {
    on(ev, fn) { if (!m.has(ev)) m.set(ev, new Set()); m.get(ev).add(fn); return () => m.get(ev).delete(fn); },
    emit(ev, p) { for (const fn of [...(m.get(ev) || [])]) { try { fn(p); } catch (e) { console.error(e); } } },
  };
})();

// ------------------------------------------------------------------ client Supabase + API
const sb = Piaf.sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'piaf-auth' },
  realtime: { params: { eventsPerSecond: 20 } },
});
async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw new PiafError(toCode(error), { detail: error.details });
  return data;
}
async function q(promise) { const { data, error } = await promise; if (error) throw new PiafError(toCode(error)); return data; }
async function fn(name, body, token) {
  let res;
  try {
    res = await fetch(`${CFG.supabaseUrl}/functions/v1/${name}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseKey, Authorization: `Bearer ${token || CFG.supabaseKey}` },
      body: JSON.stringify(body),
    });
  } catch { throw new PiafError('network'); }
  let data = null; try { data = await res.json(); } catch { /* */ }
  if (!res.ok) throw new PiafError(data?.error || 'unknown', { retryAfter: data?.retry_after });
  return data;
}
const accessToken = async () => (await sb.auth.getSession()).data.session?.access_token;
Piaf.api = {
  rpc, q, fn, accessToken,
  async media(body) { return fn('media', body, await accessToken()); },
};

async function applySession(sess) {
  const { error } = await sb.auth.setSession({ access_token: sess.access_token, refresh_token: sess.refresh_token });
  if (error) throw new PiafError('unknown');
}
Piaf.auth = {
  async signup(name, password) { const r = await fn('auth', { action: 'signup', display_name: name, password }); await applySession(r.session); return r; },
  async login(id, password) { const r = await fn('auth', { action: 'login', public_id: id, password }); await applySession(r.session); return r; },
  async deleteAccount(password) { await fn('auth', { action: 'delete_account', password }, await accessToken()); S.deleting = true; await sb.auth.signOut({ scope: 'local' }).catch(() => {}); S.deleting = false; },
  revokeOthers: () => sb.auth.signOut({ scope: 'others' }),
};

async function loadSession() {
  const uid = (await sb.auth.getSession()).data.session?.user.id;
  if (!uid) return false;
  try {
    const [me, set, cfg] = await Promise.all([
      q(sb.from('profiles').select('id,public_id,display_name,avatar_path,created_at').eq('id', uid).single()),
      q(sb.from('user_settings').select('read_receipts,notifications').eq('user_id', uid).single()),
      q(sb.from('app_config').select('key,value')),
    ]);
    S.me = me; S.settings = set; S.cfg = Object.fromEntries(cfg.map((c) => [c.key, Number(c.value)]));
    return true;
  } catch (e) {
    if (toCode(e) === 'network') { throw e; }
    return false; // session invalide / compte supprimé
  }
}
Piaf.loadSession = loadSession;

// ------------------------------------------------------------------ temps réel (un seul canal, nettoyé à la déconnexion)
let channel = null, everSubscribed = false;
function startRealtime() {
  if (channel) return;
  const on = (table, ev) => (p) => bus.emit(ev, p);
  channel = sb.channel('piaf-main')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, on('messages', 'msg'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'reactions' }, on('reactions', 'react'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'media' }, on('media', 'media'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, on('conversations', 'conv'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_members' }, on('members', 'member'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'polls' }, on('polls', 'poll'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'poll_options' }, on('poll_options', 'poll'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'todo_lists' }, on('todo_lists', 'todo'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'todo_items' }, on('todo_items', 'todo'))
    .subscribe((status) => {
      S.rt = status; bus.emit('net');
      if (status === 'SUBSCRIBED') { if (everSubscribed) bus.emit('resync'); everSubscribed = true; if (S.me) rpc('mark_delivered_all').catch(() => {}); }
    });
}
function stopRealtime() { if (channel) { sb.removeChannel(channel); channel = null; everSubscribed = false; } }

window.addEventListener('online', () => { S.online = true; bus.emit('net'); bus.emit('resync'); Piaf.flushOutbox?.(); sweepMedia(); });
window.addEventListener('offline', () => { S.online = false; bus.emit('net'); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { bus.emit('visible'); if (S.me) rpc('mark_delivered_all').catch(() => {}); } });
function sweepMedia() { if (S.me && navigator.onLine) Piaf.api.media({ action: 'sweep' }).catch(() => {}); }
Piaf.sweepMedia = sweepMedia;

// ------------------------------------------------------------------ conversations (liste partagée)
let convTimer = null, avatarsAt = 0; const avatarSeen = new Set();
async function refreshConvs() {
  S.convs = await rpc('list_conversations');
  try { S.mentions = Object.fromEntries((await rpc('my_unread_mentions')).map((r) => [r.conversation_id, r.n])); } catch { S.mentions = {}; } // nécessite la migration 009
  S.convsLoaded = true;
  bus.emit('convs');
  loadAvatars().catch(() => {});
}
async function loadAvatars() {
  const ids = [...new Set(S.convs.map((c) => c.other_id).filter(Boolean))]; if (!ids.length) return;
  // Économie de requêtes : on ne relit les photos que pour un nouveau contact, ou au plus toutes les 5 minutes
  const fresh = ids.some((id) => !avatarSeen.has(id));
  if (!fresh && Date.now() - avatarsAt < 300000) return; avatarsAt = Date.now(); ids.forEach((id) => avatarSeen.add(id));
  const rows = await q(sb.from('profiles').select('id,avatar_path').in('id', ids));
  let changed = false;
  for (const r of rows) if ((S.avatars[r.id] || null) !== (r.avatar_path || null)) { S.avatars[r.id] = r.avatar_path; changed = true; }
  if (changed) bus.emit('convs');
}
// Cadrage de la photo : la personne déplace et zoome l'image dans un cadre carré, le résultat est un petit JPEG 176×176 (qualité réduite pour économiser le stockage)
// (les métadonnées de l'original ne sont jamais envoyées). Renvoie le JPEG, ou null si la personne annule.
Piaf.cropPhoto = async (file, round = true) => {
  if (!/^image\//.test(file.type)) throw new PiafError('bad_type');
  let bmp; try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { throw new PiafError('bad_image'); }
  const V = Math.max(200, Math.min(300, innerWidth - 80)), min = Math.min(bmp.width, bmp.height);
  let zoom = 1, ox = 0, oy = 0; // ox, oy : décalage du centre de l'image par rapport au centre du cadre (en pixels du cadre)
  const clamp = () => { const dw = bmp.width * V / min * zoom, dh = bmp.height * V / min * zoom;
    ox = Math.max(-(dw - V) / 2, Math.min((dw - V) / 2, ox)); oy = Math.max(-(dh - V) / 2, Math.min((dh - V) / 2, oy)); };
  const paint = (ctx, size) => { const k = size / V, sc = V / min * zoom * k, dw = bmp.width * sc, dh = bmp.height * sc;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size); ctx.drawImage(bmp, size / 2 + ox * k - dw / 2, size / 2 + oy * k - dh / 2, dw, dh); };
  const cv = h('canvas', { class: 'crop-cv ' + (round ? 'round' : 'sq'), 'aria-label': 'Déplacez la photo pour la cadrer' });
  const dpr = Math.min(2, devicePixelRatio || 1); cv.width = cv.height = Math.round(V * dpr); cv.style.width = cv.style.height = V + 'px';
  const ctx = cv.getContext('2d');
  const draw = () => { clamp(); ctx.setTransform(1, 0, 0, 1, 0, 0); paint(ctx, cv.width); };
  const slider = h('input', { type: 'range', min: '1', max: '4', step: '0.01', value: '1', 'aria-label': 'Zoom', class: 'crop-zoom' });
  const setZoom = (z) => { zoom = Math.max(1, Math.min(4, z)); slider.value = String(zoom); draw(); };
  slider.addEventListener('input', () => setZoom(parseFloat(slider.value)));
  cv.addEventListener('wheel', (e) => { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)); }, { passive: false });
  const pts = new Map(); let pinch = 0;
  const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2) pinch = dist(); });
  cv.addEventListener('pointermove', (e) => { const p = pts.get(e.pointerId); if (!p) return;
    if (pts.size === 1) { ox += e.clientX - p.x; oy += e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; draw(); }
    else { p.x = e.clientX; p.y = e.clientY; const d = dist(); if (pinch > 0) setZoom(zoom * d / pinch); pinch = d; } });
  const up = (e) => { pts.delete(e.pointerId); pinch = 0; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  draw();
  return new Promise((res) => {
    let done = false; const fin = (v) => { if (!done) { done = true; bmp.close?.(); res(v); } };
    const l = modal({ title: round ? 'Cadrer la photo' : 'Cadrer la photo du groupe',
      body: [h('div', { class: 'crop-wrap' }, cv), h('label', { class: 'crop-zoom-row' }, h('span', { class: 'muted small' }, 'Zoom'), slider),
        h('p', { class: 'muted small' }, 'Faites glisser la photo avec le doigt, et utilisez le curseur (ou pincez) pour zoomer.')],
      actions: [{ label: 'Annuler', onClick: () => fin(null) },
        { label: 'Valider', primary: true, onClick: async () => {
          const c = document.createElement('canvas'); c.width = c.height = 176; paint(c.getContext('2d'), 176);
          const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.6)); if (!blob) { toast(errText(new PiafError('bad_image')), { error: true }); return false; }
          fin(blob); } }] });
    const orig = l.close; l.close = () => { fin(null); orig(); };
  });
};
async function uploadAvatar(folder, blob) {
  const path = folder + '/' + uuid() + '.jpg';
  const up = await sb.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg' }); if (up.error) throw up.error;
  return path;
}
Piaf.setAvatar = async (blob) => {
  const old = S.me.avatar_path;
  if (!blob) { await rpc('remove_avatar'); S.me.avatar_path = null; }
  else {
    const path = await uploadAvatar(S.me.id, blob);
    try { await rpc('set_avatar', { p_path: path }); } catch (e) { sb.storage.from('avatars').remove([path]).catch(() => {}); throw e; }
    S.me.avatar_path = path;
  }
  if (old) sb.storage.from('avatars').remove([old]).catch(() => {});
};
Piaf.setGroupAvatar = async (convId, blob) => {
  const old = Piaf.conv(convId)?.avatar_path; let path = null;
  if (blob) path = await uploadAvatar(convId, blob);
  try { await rpc('group_set_avatar', { p_conv: convId, p_path: path }); } catch (e) { if (path) sb.storage.from('avatars').remove([path]).catch(() => {}); throw e; }
  if (old) sb.storage.from('avatars').remove([old]).catch(() => {});
  await Piaf.refreshConvs();
};
Piaf.refreshConvs = () => { clearTimeout(convTimer); return new Promise((res) => { convTimer = setTimeout(() => refreshConvs().then(res, res), 500); }); }; // regroupe les rafales d'événements temps réel en un seul rechargement
Piaf.conv = (id) => S.convs.find((c) => c.conversation_id === id);
Piaf.convName = (c) => (c.nickname || c.other_name);

// ------------------------------------------------------------------ toasts, feuilles, dialogues
const layers = [];
function toast(msg, opts = {}) {
  const t = h('div', { class: 'toast' + (opts.error ? ' error' : ''), role: opts.error ? 'alert' : 'status' }, msg);
  $('#toasts').append(t); setTimeout(() => t.remove(), opts.ms || (opts.error ? 5000 : 2800));
}
function pushLayer(el, onClose) {
  const back = h('div', { class: 'backdrop' }); const wrap = h('div', { class: 'layer', role: 'dialog', 'aria-modal': 'true' }, back, el);
  const layer = { close() { wrap.remove(); const i = layers.indexOf(layer); if (i >= 0) layers.splice(i, 1); onClose?.(); } };
  back.addEventListener('click', () => layer.close());
  layers.push(layer); $('#layers').append(wrap);
  (el.querySelector('input,textarea,button') || el).focus?.({ preventScroll: true });
  return layer;
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && layers.length) layers[layers.length - 1].close(); });
function sheet(title, items, header) {
  let layer;
  const list = h('div', { class: 'sheet-list' }, items.filter(Boolean).map((it) => it.sep ? h('hr') :
    h('button', { class: 'sheet-item' + (it.danger ? ' danger' : ''), type: 'button', disabled: it.disabled, onclick: () => { layer.close(); it.onClick?.(); } },
      it.icon ? icon(it.icon, 20) : null, h('span', null, it.label))));
  const el = h('div', { class: 'sheet' }, h('div', { class: 'sheet-grip' }), title ? h('div', { class: 'sheet-title' }, title) : null, header || null, list);
  layer = pushLayer(el); return layer;
}
function modal({ title, body, actions }) {
  let layer;
  const el = h('div', { class: 'modal' }, title ? h('h2', null, title) : null, h('div', { class: 'modal-body' }, body),
    h('div', { class: 'modal-actions' }, actions.map((a) => h('button', { type: 'button', class: 'btn ' + (a.primary ? 'primary' : '') + (a.danger ? ' danger' : ''),
      onclick: async () => { if (a.onClick) { const r = await a.onClick(); if (r === false) return; } layer.close(); } }, a.label))));
  layer = pushLayer(el); return layer;
}
const confirmDialog = (title, text, label = 'Confirmer', danger = false) => new Promise((res) => {
  let done = false; const fin = (v) => { if (!done) { done = true; res(v); } };
  const l = modal({ title, body: h('p', null, text), actions: [{ label: 'Annuler', onClick: () => fin(false) }, { label, primary: true, danger, onClick: () => fin(true) }] });
  const orig = l.close; l.close = () => { fin(false); orig(); };
});
const promptDialog = (title, label, value = '', { type = 'text', max = 40, hint } = {}) => new Promise((res) => {
  const input = h('input', { type, value, maxlength: String(max), 'aria-label': label, autocomplete: type === 'password' ? 'current-password' : 'off' });
  let done = false; const fin = (v) => { if (!done) { done = true; res(v); } };
  const l = modal({ title, body: [h('label', { class: 'field' }, h('span', null, label), input), hint ? h('p', { class: 'muted small' }, hint) : null],
    actions: [{ label: 'Annuler', onClick: () => fin(null) }, { label: 'Valider', primary: true, onClick: () => fin(input.value) }] });
  const orig = l.close; l.close = () => { fin(null); orig(); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { fin(input.value); orig(); } });
});
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copié'); }
  catch { const t = h('textarea', { style: { position: 'fixed', opacity: '0' } }); t.value = text; document.body.append(t); t.select(); try { document.execCommand('copy'); toast('Copié'); } catch { toast('Copie impossible', { error: true }); } t.remove(); }
}
Object.assign(Piaf, { h, $, icon, iconBtn, store, fmt, uuid, avatar, linkify, errText, toCode, PiafError, toast, sheet, modal, confirmDialog, promptDialog, copyText, pushLayer, layers });

// ------------------------------------------------------------------ thème, viewport, notifications
function applyTheme() {
  const t = store.get('piaf-theme', 'auto');
  if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('meta[name=theme-color]').setAttribute('content', dark ? '#17120e' : '#fbf7f2');
}
Piaf.applyTheme = applyTheme; matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
function fitViewport() { // clavier mobile : la zone d'appli suit la hauteur réellement visible
  const vv = window.visualViewport;
  document.documentElement.style.setProperty('--app-h', (vv ? vv.height : innerHeight) + 'px');
  document.documentElement.style.setProperty('--app-top', (vv ? vv.offsetTop : 0) + 'px');
}
window.visualViewport?.addEventListener('resize', () => { fitViewport(); bus.emit('viewport'); });
window.visualViewport?.addEventListener('scroll', fitViewport);
addEventListener('resize', fitViewport);

Piaf.notify = async (title, body, hash, tag) => {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !S.settings.notifications) return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const opts = { body, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { hash } };
    if (reg) await reg.showNotification(title, opts); else new Notification(title, opts);
  } catch { /* plateforme sans notifications locales */ }
};

// ------------------------------------------------------------------ routeur (hash : compatible sous-répertoire GitHub Pages)
let current = null;
function parseRoute() {
  const p = (location.hash.replace(/^#\/?/, '') || '').split('/');
  const uuidRe = /^[0-9a-f-]{36}$/i;
  if (p[0] === 'c' && uuidRe.test(p[1] || '')) return { name: 'chat', id: p[1] };
  if (p[0] === 'm' && uuidRe.test(p[1] || '')) return { name: 'gallery', id: p[1] };
  if (p[0] === 'g' && p[1] === 'new') return { name: 'groupnew' };
  if (p[0] === 'g' && uuidRe.test(p[1] || '')) return p[2] === 'add' ? { name: 'groupadd', id: p[1] } : { name: 'group', id: p[1] };
  if (p[0] === 'new') return { name: 'new' };
  if (p[0] === 'settings') return { name: 'settings' };
  if (p[0] === 'talk2piaf') return { name: 'assistant' };
  return { name: 'home' };
}
Piaf.go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };
Piaf.back = (target) => { if (location.hash === target || (!location.hash && target === '#/')) render(); else location.replace(target); };
function render() {
  current?.destroy?.(); current = null; layers.slice().forEach((l) => l.close());
  const root = $('#app'); root.replaceChildren();
  if (!S.me) { current = Piaf.views.auth(); root.append(current.el); return; }
  const r = S.route = { ...parseRoute(), fromApp: true };
  const view = Piaf.views[r.name](r);
  current = view; root.append(view.el); view.mounted?.();
}
Piaf.render = render;
addEventListener('hashchange', render);

function netBanner() {
  const b = $('#netbar'); if (!S.me) { b.hidden = true; return; }
  if (!S.online) { b.hidden = false; b.textContent = 'Hors connexion — vos messages partiront dès le retour du réseau.'; b.className = 'netbar off'; }
  else if (S.rt !== 'SUBSCRIBED') { b.hidden = false; b.textContent = 'Reconnexion en cours…'; b.className = 'netbar'; }
  else b.hidden = true;
}
bus.on('net', netBanner);

// ------------------------------------------------------------------ démarrage / ouverture de session
Piaf.enter = async () => { // appelé après connexion ou création de compte
  const ok = await loadSession(); if (!ok) throw new PiafError('not_authenticated');
  startRealtime(); refreshConvs().catch(() => {}); sweepMedia(); Piaf.flushOutbox?.();
  if (!location.hash || location.hash === '#/') location.hash = '#/'; render();
};
sb.auth.onAuthStateChange((ev) => {
  if (ev === 'SIGNED_OUT' && S.me && !S.deleting) { // session révoquée à distance, compte supprimé ou jeton définitivement refusé
    S.me = null; stopRealtime(); netBanner(); render(); toast('Votre session s’est terminée. Reconnectez-vous avec votre identifiant et votre code secret.', { error: true, ms: 7000 });
  }
});
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); Piaf.installEvt = e; bus.emit('install'); });

// Démarrage après l'exécution de TOUS les scripts (les écrans sont définis dans views-*.js, chargés après ce fichier).
const start = async function boot() {
  fitViewport(); applyTheme();
  let ok = false;
  try { ok = await loadSession(); }
  catch { // hors ligne au démarrage avec une session locale : on affiche une erreur claire sans déconnecter
    $('#app').replaceChildren(h('div', { class: 'boot' }, h('p', null, 'Impossible de joindre le serveur.'), h('button', { class: 'btn primary', onclick: () => location.reload() }, 'Réessayer')));
    return;
  }
  if (ok) { startRealtime(); refreshConvs().catch(() => {}); sweepMedia(); }
  render();
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
