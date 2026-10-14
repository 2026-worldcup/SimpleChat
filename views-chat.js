/* Piaf — conversation, envoi de médias, galerie, visionneuse, file d'envoi hors ligne. */
(() => {
'use strict';
const { h, icon, iconBtn, S, bus, api, fmt, avatar, toast, sheet, modal, confirmDialog, copyText, errText, toCode, store, sb, uuid, linkify, PiafError } = Piaf;
const CFG = window.PIAF_CONFIG;
const me = () => S.me.id;
const PAGE = 40;
const COLS = 'id,conversation_id,sender_id,client_id,kind,body,reply_to,forwarded,created_at,edited_at,deleted_at,pinned_at,delivered_at,read_at';
const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const MIME_BY_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };
const OK_MIME = new Set(Object.values(MIME_BY_EXT));
const mimeOf = (f) => (OK_MIME.has(f.type) ? f.type : MIME_BY_EXT[(f.name.split('.').pop() || '').toLowerCase()] || f.type || '');
const kindOf = (mime) => (mime.startsWith('image/') ? 'photo' : 'video');
const esc = (s) => s.replace(/[\\%_]/g, (c) => '\\' + c);

// ================================================================== URLs signées (cache court)
const urlCache = new Map();
Piaf.signedUrl = async (path, download) => {
  const key = path + '|' + (download || ''), hit = urlCache.get(key);
  if (hit && hit.exp > Date.now() + 30000) return hit.url;
  const { data, error } = await sb.storage.from('chat-media').createSignedUrl(path, 600, download ? { download } : undefined);
  if (error) throw new PiafError(toCode(error));
  urlCache.set(key, { url: data.signedUrl, exp: Date.now() + 600000 }); return data.signedUrl;
};
Piaf.signedUrls = async (paths) => {
  const need = paths.filter((p) => { const hit = urlCache.get(p + '|'); return !(hit && hit.exp > Date.now() + 30000); });
  if (need.length) {
    const { data } = await sb.storage.from('chat-media').createSignedUrls(need, 600);
    for (const r of data || []) if (r.signedUrl) urlCache.set(r.path + '|', { url: r.signedUrl, exp: Date.now() + 600000 });
  }
};

// ================================================================== file d'envoi (messages texte, hors ligne)
const outStore = { list: () => store.get('piaf-outbox', []), save: (l) => store.set('piaf-outbox', l) };
const setOut = (cid, patch) => outStore.save(outStore.list().map((i) => (i.client_id === cid ? { ...i, ...patch } : i)));
const delOut = (cid) => outStore.save(outStore.list().filter((i) => i.client_id !== cid));
async function dispatch(it) {
  setOut(it.client_id, { status: 'sending', err: null }); bus.emit('outbox', it.conv);
  try {
    const row = await api.rpc('send_message', { p_conv: it.conv, p_client_id: it.client_id, p_body: it.body, p_reply_to: it.reply_to || null, p_forwarded: !!it.forwarded });
    delOut(it.client_id); bus.emit('sent', row); return row;
  } catch (e) { setOut(it.client_id, { status: 'failed', err: toCode(e) }); bus.emit('outbox', it.conv); throw e; }
}
Piaf.queueMessage = (conv, body, o = {}) => {
  const it = { client_id: uuid(), conv, body, reply_to: o.reply_to || null, forwarded: !!o.forwarded, at: new Date().toISOString(), status: 'sending' };
  outStore.save([...outStore.list(), it]); return dispatch(it).catch(() => {});
};
let flushing = false;
Piaf.flushOutbox = async () => { // idempotent : le client_id empêche les doublons même si la réponse du serveur s'était perdue
  if (flushing || !S.me || !navigator.onLine) return; flushing = true;
  try { for (const it of outStore.list().filter((i) => i.status === 'sending' || (i.status === 'failed' && i.err === 'network'))) { try { await dispatch(it); } catch (e) { if (toCode(e) === 'network') break; } } }
  finally { flushing = false; }
};

// ================================================================== visionneuse plein écran
Piaf.openViewer = (items, start, { onChange } = {}) => {
  let i = start, layer; const stage = h('div', { class: 'viewer-stage' }); const info = h('div', { class: 'viewer-info' });
  async function show() {
    const m = items[i]; stage.replaceChildren(h('div', { class: 'spinner', role: 'status', 'aria-label': 'Chargement' }));
    info.replaceChildren(h('strong', null, m.name), h('span', null, `${m.kind === 'photo' ? 'Photo' : 'Vidéo'} · ${fmt.size(m.size_bytes)} · ${fmt.dateTime(m.created_at)}`));
    try {
      const url = await Piaf.signedUrl(m.path); if (items[i] !== m) return;
      stage.replaceChildren(m.kind === 'photo' ? h('img', { src: url, alt: m.name }) : h('video', { src: url, controls: true, playsinline: true, autoplay: true }));
    } catch (e) { stage.replaceChildren(h('p', { class: 'viewer-err' }, 'Ce média n’est plus disponible.')); }
  }
  const step = (d) => { const n = i + d; if (n >= 0 && n < items.length) { i = n; show(); } };
  async function download() {
    const m = items[i]; try { const url = await Piaf.signedUrl(m.path, m.name); const a = h('a', { href: url, download: m.name }); document.body.append(a); a.click(); a.remove();
      toast('Téléchargement lancé. Cela ne libère pas d’espace sur le serveur.'); } catch (e) { toast(errText(e), { error: true }); }
  }
  function remove() {
    const m = items[i]; const mine = m.uploader_id === me();
    sheet('Supprimer ce média', [
      { icon: 'eye', label: 'Supprimer pour moi', onClick: async () => { if (!(await confirmDialog('Supprimer pour vous ?', 'Le média disparaît de votre côté seulement. L’autre personne le garde et l’espace du serveur n’est PAS libéré.', 'Supprimer pour moi', true))) return;
          try { await api.rpc('delete_message_for_me', { p_id: m.message_id }); done(); toast('Média masqué pour vous'); } catch (e) { toast(errText(e), { error: true }); } } },
      mine ? { icon: 'trash', danger: true, label: 'Supprimer pour tout le monde', onClick: async () => { if (!(await confirmDialog('Supprimer pour tout le monde ?', 'Le fichier sera effacé du serveur et ne sera plus accessible dans l’application pour vous deux, ce qui libère de l’espace. Les copies déjà téléchargées ou capturées par l’autre personne ne peuvent pas être effacées.', 'Supprimer pour tous', true))) return;
          try { await api.media({ action: 'delete', id: m.id }); done(); toast('Média supprimé pour tous. Espace libéré.'); } catch (e) { toast(errText(e), { error: true, ms: 7000 }); onChange?.(); } } } :
        { icon: 'ban', label: 'Seul l’expéditeur peut supprimer pour tous', disabled: true },
    ]);
  }
  function done() { items.splice(i, 1); onChange?.(); if (!items.length) { layer.close(); return; } i = Math.min(i, items.length - 1); show(); }
  const key = (e) => { if (e.key === 'ArrowLeft') step(-1); if (e.key === 'ArrowRight') step(1); };
  const el = h('div', { class: 'viewer' },
    h('div', { class: 'viewer-bar' }, iconBtn('x', 'Fermer', () => layer.close()), info, iconBtn('download', 'Télécharger', download), iconBtn('trash', 'Supprimer', remove)),
    stage, items.length > 1 ? h('div', { class: 'viewer-nav' }, iconBtn('back', 'Précédent', () => step(-1)), iconBtn('back', 'Suivant', () => step(1), 'flip')) : null);
  layer = Piaf.pushLayer(el, () => document.removeEventListener('keydown', key)); document.addEventListener('keydown', key); show();
};

// ================================================================== conversation
Piaf.views.chat = (route) => {
  const convId = route.id;
  let conv = Piaf.conv(convId), destroyed = false, loading = false, hasMore = true, atBottom = true, newCount = 0, mediaBytes = 0;
  const msgs = new Map(), clientIds = new Set(), reactions = new Map(), mediaOf = new Map(), replies = new Map(), pins = new Map(), nodes = new Map();
  let replyTo = null, editing = null, tray = [], uploads = [], searchOpen = false, markTimer = null;
  const draftKey = 'piaf-draft:' + convId;
  const name = () => (conv ? Piaf.convName(conv) : 'Discussion');
  const cfg = () => S.cfg;

  // ------------------------------------------------ squelette
  const list = h('div', { class: 'msg-list', role: 'list', 'aria-live': 'polite', 'aria-relevant': 'additions' });
  const scroller = h('div', { class: 'msgs', onscroll: onScroll }, h('div', { class: 'older' }), list);
  const pill = h('button', { class: 'pill', type: 'button', hidden: true, onclick: () => scrollBottom(true) });
  const banner = h('div', { class: 'pinbar', hidden: true });
  const headTitle = h('button', { class: 'chat-title', type: 'button', onclick: () => profileSheet() });
  const header = h('header', { class: 'topbar chat-top' }, iconBtn('back', 'Retour aux discussions', () => Piaf.back('#/')), headTitle,
    iconBtn('search', 'Rechercher dans la conversation', () => openSearch()), iconBtn('dots', 'Menu de la discussion', () => chatMenu()));
  const trayEl = h('div', { class: 'tray', hidden: true }), uploadsEl = h('div', { class: 'uploads', hidden: true }), replyBar = h('div', { class: 'replybar', hidden: true });
  const ta = h('textarea', { rows: '1', placeholder: 'Message', 'aria-label': 'Écrire un message', maxlength: '4000', enterkeyhint: 'enter', oninput: onInput, onkeydown: (e) => {
    if (e.key === 'Enter' && !e.shiftKey && matchMedia('(pointer:fine)').matches) { e.preventDefault(); sendText(); } } });
  const fileInput = h('input', { type: 'file', multiple: true, accept: 'image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,video/mp4,video/webm,video/quicktime', hidden: true, onchange: () => { addFiles([...fileInput.files]); fileInput.value = ''; } });
  const sendBtn = h('button', { class: 'send', type: 'button', 'aria-label': 'Envoyer', onclick: sendText }, icon('send', 22));
  const composer = h('div', { class: 'composer' }, replyBar, trayEl, uploadsEl,
    h('div', { class: 'composer-row' }, iconBtn('clip', 'Joindre des photos ou vidéos', () => fileInput.click()), ta, sendBtn, fileInput));
  const searchPanel = h('div', { class: 'searchpanel', hidden: true });
  const el = h('div', { class: 'screen chat' }, header, banner, searchPanel, h('div', { class: 'msgs-wrap' }, scroller, pill), composer);

  // ------------------------------------------------ en-tête / blocage
  function drawHeader() {
    headTitle.replaceChildren(avatar(name(), 38), h('span', { class: 'chat-title-text' }, h('strong', null, name()),
      h('span', { class: 'muted small' }, conv ? (conv.blocked_by_me ? 'Contact bloqué' : 'Identifiant ' + fmt.id8(conv.other_public_id)) : '…')));
    const blocked = conv?.blocked_by_me;
    composer.classList.toggle('blocked', !!blocked);
    ta.disabled = !!blocked; sendBtn.disabled = !!blocked;
    ta.placeholder = blocked ? 'Contact bloqué' : 'Message';
  }
  function drawBanner() {
    const arr = [...pins.values()].sort((a, b) => (a.pinned_at < b.pinned_at ? 1 : -1));
    banner.hidden = !arr.length; if (!arr.length) return;
    const p = arr[(pinIdx++) % arr.length];
    banner.replaceChildren(icon('pin', 18), h('button', { type: 'button', class: 'pin-text', onclick: () => jumpTo(p.id) }, h('strong', null, arr.length > 1 ? `Épinglé (${arr.length})` : 'Épinglé'), h('span', null, snippet(p))));
  }
  let pinIdx = 0;
  const snippet = (m) => (m.deleted_at ? 'Message supprimé' : m.kind === 'media' ? '📎 Média' : (m.body || '').slice(0, 90));

  // ------------------------------------------------ données
  async function hydrate(rows) {
    const ids = rows.map((r) => r.id), mids = rows.filter((r) => r.kind === 'media').map((r) => r.id);
    const missing = [...new Set(rows.map((r) => r.reply_to).filter((x) => x && !msgs.has(x) && !replies.has(x)))];
    const [media, reacts, rep] = await Promise.all([
      mids.length ? api.q(sb.from('my_media').select('id,message_id,name,mime,kind,size_bytes,path,created_at,uploader_id').in('message_id', mids)) : [],
      ids.length ? api.q(sb.from('reactions').select('message_id,user_id,emoji').in('message_id', ids)) : [],
      missing.length ? api.q(sb.from('my_messages').select('id,sender_id,kind,body,deleted_at').in('id', missing)) : [],
    ]);
    for (const m of media) mediaOf.set(m.message_id, m);
    for (const id of ids) reactions.set(id, reacts.filter((r) => r.message_id === id));
    for (const r of rep) replies.set(r.id, r);
    for (const id of missing) if (!replies.has(id)) replies.set(id, null);
    Piaf.signedUrls(media.filter((m) => m.kind === 'photo').map((m) => m.path)).catch(() => {});
  }
  function upsert(row) {
    if (!S.settings.read_receipts) row = { ...row, read_at: null };
    const prev = msgs.get(row.id); msgs.set(row.id, prev ? { ...prev, ...row } : row); clientIds.add(row.client_id);
    const m = msgs.get(row.id); if (m.pinned_at && !m.deleted_at) pins.set(m.id, m); else pins.delete(m.id);
  }
  const visible = () => {
    const outs = outStore.list().filter((i) => i.conv === convId && !clientIds.has(i.client_id)).map((i) => ({ id: 'local:' + i.client_id, client_id: i.client_id, sender_id: me(), kind: 'text', body: i.body, reply_to: i.reply_to, forwarded: i.forwarded, created_at: i.at, _out: i }));
    return [...msgs.values(), ...outs].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));
  };
  async function loadOlder() {
    if (loading || !hasMore) return; loading = true;
    const first = [...msgs.values()].sort((a, b) => (a.created_at < b.created_at ? -1 : 1))[0];
    try {
      let qy = sb.from('my_messages').select(COLS).eq('conversation_id', convId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(PAGE);
      if (first) qy = qy.or(`created_at.lt.${first.created_at},and(created_at.eq.${first.created_at},id.lt.${first.id})`);
      const rows = await api.q(qy); if (destroyed) return;
      hasMore = rows.length === PAGE; await hydrate(rows); rows.forEach(upsert);
      const prevH = scroller.scrollHeight, prevT = scroller.scrollTop; render(); if (first) scroller.scrollTop = prevT + (scroller.scrollHeight - prevH);
    } catch (e) { toast(errText(e), { error: true }); } finally { loading = false; }
  }
  async function syncLatest() { // après reconnexion : récupère ce qui a pu être manqué
    try {
      const rows = await api.q(sb.from('my_messages').select(COLS).eq('conversation_id', convId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(PAGE));
      if (destroyed) return; await hydrate(rows); rows.forEach(upsert); render();
    } catch { /* la prochaine reconnexion réessaiera */ }
  }
  async function loadQuota() { try { const r = await api.q(sb.from('conversations').select('media_bytes').eq('id', convId).single()); mediaBytes = Number(r.media_bytes); } catch { /* */ } }

  // ------------------------------------------------ rendu incrémental
  const nearBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 90;
  function onScroll() {
    atBottom = nearBottom(); if (atBottom) { newCount = 0; pill.hidden = true; scheduleRead(); }
    else if (newCount) { pill.hidden = false; }
    if (scroller.scrollTop < 140) loadOlder();
  }
  function scrollBottom(smooth) { scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }); atBottom = true; newCount = 0; pill.hidden = true; }
  function scheduleRead() {
    clearTimeout(markTimer); markTimer = setTimeout(async () => {
      if (destroyed || document.hidden || !atBottom || !S.online) return;
      try { await api.rpc('mark_read', { p_conv: convId }); Piaf.refreshConvs(); } catch { /* */ }
    }, 400);
  }
  const sameGroup = (a, b) => a && b && a.sender_id === b.sender_id && fmt.dayKey(a.created_at) === fmt.dayKey(b.created_at) && Math.abs(new Date(b.created_at) - new Date(a.created_at)) < 300000;
  function render() {
    const all = visible(), frag = [];
    all.forEach((m, i) => {
      const prev = all[i - 1], next = all[i + 1];
      if (!prev || fmt.dayKey(prev.created_at) !== fmt.dayKey(m.created_at)) frag.push(h('div', { class: 'day', role: 'separator' }, h('span', null, fmt.dayLabel(m.created_at))));
      const first = !sameGroup(prev, m), last = !sameGroup(m, next);
      const sig = JSON.stringify([m.body, m.edited_at, m.deleted_at, m.pinned_at, m.delivered_at, m.read_at, m._out && [m._out.status, m._out.err], first, last, reactions.get(m.id), mediaOf.get(m.id)?.id, replySig(m), S.settings.read_receipts, name()]);
      let n = nodes.get(m.id); if (!n || n._sig !== sig) { n = buildMsg(m, first, last); n._sig = sig; nodes.set(m.id, n); }
      frag.push(n);
    });
    if (!all.length && !hasMore) frag.push(h('div', { class: 'empty small' }, icon('bubble', 36), h('p', { class: 'muted' }, 'Aucun message. Dites bonjour !')));
    list.replaceChildren(...frag); drawBanner();
  }
  const replySig = (m) => { if (!m.reply_to) return 0; const t = msgs.get(m.reply_to) || replies.get(m.reply_to); return t ? [t.body, t.deleted_at] : 'x'; };

  function statusIcon(m) {
    if (m._out) return m._out.status === 'failed' ? h('span', { class: 'st fail', title: 'Échec de l’envoi' }, icon('alert', 15)) : h('span', { class: 'st', title: 'Envoi en cours' }, icon('clock', 14));
    if (m.read_at && S.settings.read_receipts) return h('span', { class: 'st read', title: 'Lu à ' + fmt.time(m.read_at) }, icon('check2', 16));
    if (m.delivered_at) return h('span', { class: 'st', title: 'Distribué' }, icon('check2', 16));
    return h('span', { class: 'st', title: 'Envoyé' }, icon('check', 15));
  }
  function buildMsg(m, first, last) {
    const mine = m.sender_id === me(), del = !!m.deleted_at, parts = [];
    if (m.forwarded && !del) parts.push(h('div', { class: 'fwd' }, icon('fwd', 13), ' Transféré'));
    if (m.reply_to && !del) {
      const t = msgs.get(m.reply_to) || replies.get(m.reply_to);
      parts.push(h('button', { class: 'quote', type: 'button', onclick: (e) => { e.stopPropagation(); if (t) jumpTo(m.reply_to); } }, h('strong', null, t ? (t.sender_id === me() ? 'Vous' : name()) : ''), h('span', null, t ? snippet(t) : 'Message indisponible')));
    }
    if (del) parts.push(h('div', { class: 'text tomb' }, m.kind === 'media' ? 'Ce média a été supprimé' : 'Ce message a été supprimé'));
    else if (m.kind === 'media') parts.push(mediaBlock(m));
    else parts.push(h('div', { class: 'text' }, linkify(m.body || '')));
    if (m.kind === 'media' && !del && mediaOf.get(m.id)) { const d = mediaOf.get(m.id); parts.push(h('div', { class: 'cap' }, `${d.name} · ${fmt.size(d.size_bytes)}`)); }
    parts.push(h('div', { class: 'meta' }, m.pinned_at && !del ? icon('pin', 12) : null, m.edited_at && !del ? h('span', null, 'modifié') : null, h('time', { datetime: m.created_at }, fmt.time(m.created_at)), mine ? statusIcon(m) : null));
    const bubble = h('div', { class: 'bubble' + (mine ? ' mine' : '') + (first ? ' first' : '') + (last ? ' last' : ''), tabindex: '0', role: 'button', 'aria-haspopup': 'dialog', 'aria-label': 'Actions du message', onclick: () => openActions(m),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openActions(m); } } }, parts);
    const rs = reactions.get(m.id) || [], groups = {}; rs.forEach((r) => { (groups[r.emoji] ||= []).push(r.user_id); });
    const chips = Object.keys(groups).length ? h('div', { class: 'reacts' }, Object.entries(groups).map(([e, u]) => h('button', { type: 'button', class: 'chip' + (u.includes(me()) ? ' mine' : ''), 'aria-label': `Réaction ${e}, ${u.length}`, onclick: () => react(m, e) }, e, u.length > 1 ? ' ' + u.length : ''))) : null;
    return h('div', { class: 'msg' + (mine ? ' mine' : '') + (first ? ' gap' : ''), role: 'listitem', 'data-id': m.id }, bubble, chips);
  }
  function mediaBlock(m) {
    const d = mediaOf.get(m.id); if (!d) return h('div', { class: 'media-box ph' }, 'Chargement du média…');
    const box = h('button', { class: 'media-box', type: 'button', 'aria-label': `Ouvrir ${d.name}`, onclick: (e) => { e.stopPropagation(); openMedia(m.id); } });
    Piaf.signedUrl(d.path).then((url) => {
      box.replaceChildren(d.kind === 'photo' ? h('img', { src: url, alt: d.name, loading: 'lazy' }) : [h('video', { src: url + '#t=0.1', preload: 'metadata', muted: true, playsinline: true }), h('span', { class: 'play' }, icon('play', 26))]);
    }).catch(() => box.replaceChildren(h('span', { class: 'ph' }, 'Média indisponible')));
    return box;
  }
  function openMedia(msgId) {
    const items = [...mediaOf.values()].filter((d) => msgs.get(d.message_id) && !msgs.get(d.message_id).deleted_at).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    const idx = items.findIndex((d) => d.message_id === msgId); if (idx < 0) return;
    Piaf.openViewer(items, idx, { onChange: () => { syncLatest(); loadQuota(); } });
  }

  // ------------------------------------------------ actions sur un message
  const canEdit = (m) => m.sender_id === me() && m.kind === 'text' && !m.deleted_at && Date.now() - new Date(m.created_at) < cfg().edit_window_minutes * 60000;
  const canDelAll = (m) => m.sender_id === me() && !m.deleted_at && (m.kind === 'media' || Date.now() - new Date(m.created_at) < cfg().delete_all_window_minutes * 60000);
  function openActions(m) {
    if (m._out) {
      return sheet('Message non envoyé', [
        m._out.status === 'failed' ? { icon: 'send', label: 'Réessayer l’envoi', onClick: () => dispatch(m._out).catch((e) => toast(errText(e), { error: true })) } : { icon: 'clock', label: 'Envoi en cours…', disabled: true },
        { icon: 'copy', label: 'Copier le texte', onClick: () => copyText(m.body) },
        { icon: 'trash', danger: true, label: 'Supprimer ce message', onClick: () => { delOut(m._out.client_id); render(); } },
      ], m._out.err && m._out.status === 'failed' ? h('p', { class: 'form-error small pad' }, errText(m._out.err)) : null);
    }
    const mine = m.sender_id === me(), del = !!m.deleted_at, text = m.kind === 'text' && !del;
    const head = del || conv?.blocked_by_me ? null : h('div', { class: 'react-row' }, EMOJIS.map((e) => h('button', { type: 'button', 'aria-label': 'Réagir ' + e, onclick: () => { layer.close(); react(m, e, true); } }, e)));
    const layer = sheet(null, [
      !del && !conv?.blocked_by_me ? { icon: 'reply', label: 'Répondre', onClick: () => startReply(m) } : null,
      text ? { icon: 'copy', label: 'Copier', onClick: () => copyText(m.body) } : null,
      text ? { icon: 'fwd', label: 'Transférer', onClick: () => forward(m) } : null,
      m.kind === 'media' && !del ? { icon: 'download', label: 'Télécharger', onClick: () => { const d = mediaOf.get(m.id); if (d) Piaf.signedUrl(d.path, d.name).then((u) => { const a = h('a', { href: u, download: d.name }); document.body.append(a); a.click(); a.remove(); toast('Téléchargement lancé. Cela ne libère pas d’espace sur le serveur.'); }).catch((e) => toast(errText(e), { error: true })); } } : null,
      !del ? { icon: 'pin', label: m.pinned_at ? 'Désépingler' : 'Épingler', onClick: () => pin(m) } : null,
      canEdit(m) ? { icon: 'edit', label: 'Modifier', onClick: () => startEdit(m) } : null,
      { sep: true },
      { icon: 'eye', label: 'Supprimer pour moi', danger: true, onClick: () => delForMe(m) },
      canDelAll(m) ? { icon: 'trash', label: 'Supprimer pour tout le monde', danger: true, onClick: () => delForAll(m) } : null,
      !mine && !del ? { icon: 'flag', label: 'Signaler ce message', danger: true, onClick: () => reportDialog(m) } : null,
    ], head);
  }
  async function react(m, emoji, fromSheet) {
    try { await api.rpc('react', { p_msg: m.id, p_emoji: emoji }); await refreshReacts(m.id); } catch (e) { toast(errText(e), { error: true }); }
  }
  async function refreshReacts(id) { try { reactions.set(id, await api.q(sb.from('reactions').select('message_id,user_id,emoji').eq('message_id', id))); render(); } catch { /* */ } }
  async function pin(m) { try { await api.rpc('pin_message', { p_id: m.id, p_pin: !m.pinned_at }); upsert({ ...m, pinned_at: m.pinned_at ? null : new Date().toISOString() }); render(); } catch (e) { toast(errText(e), { error: true }); } }
  async function delForMe(m) {
    if (!(await confirmDialog('Supprimer pour vous ?', 'Le message disparaît de votre côté seulement. L’autre personne le garde. Cette action est définitive pour vous.', 'Supprimer pour moi', true))) return;
    try { await api.rpc('delete_message_for_me', { p_id: m.id }); msgs.delete(m.id); nodes.delete(m.id); pins.delete(m.id); render(); Piaf.refreshConvs(); } catch (e) { toast(errText(e), { error: true }); }
  }
  async function delForAll(m) {
    const media = m.kind === 'media';
    if (!(await confirmDialog('Supprimer pour tout le monde ?', media ? 'Le fichier sera effacé du serveur pour vous deux (ce qui libère de l’espace). Les copies déjà téléchargées ou capturées ne peuvent pas être effacées.' : 'Le message sera remplacé par « Ce message a été supprimé » chez vous deux. Les copies ou captures déjà faites ne peuvent pas être effacées.', 'Supprimer pour tous', true))) return;
    try {
      if (media) await api.media({ action: 'delete', id: mediaOf.get(m.id)?.id }); else await api.rpc('delete_message_for_all', { p_id: m.id });
      upsert({ ...m, body: null, deleted_at: new Date().toISOString(), pinned_at: null }); render(); Piaf.refreshConvs(); if (media) loadQuota();
    } catch (e) { toast(errText(e), { error: true, ms: 7000 }); syncLatest(); }
  }
  function forward(m) {
    const targets = S.convs.filter((c) => !c.blocked_by_me);
    sheet('Transférer à…', targets.map((c) => ({ icon: 'fwd', label: Piaf.convName(c), onClick: async () => { await Piaf.queueMessage(c.conversation_id, m.body, { forwarded: true }); toast('Message transféré à ' + Piaf.convName(c)); } })));
  }
  function reportDialog(m) {
    const reasons = [['spam', 'Spam ou publicité'], ['harcelement', 'Harcèlement ou menaces'], ['contenu_inapproprie', 'Contenu inapproprié'], ['usurpation', 'Usurpation d’identité'], ['autre', 'Autre motif']];
    sheet(m ? 'Signaler ce message' : 'Signaler cette personne', reasons.map(([k, l]) => ({ label: l, onClick: async () => {
      if (!(await confirmDialog('Envoyer le signalement ?', m ? 'Le texte de ce message et votre motif seront transmis à l’éditeur du service pour examen. Les autres messages ne sont pas transmis.' : 'Votre motif sera transmis à l’éditeur du service pour examen. Aucun message n’est transmis.', 'Signaler'))) return;
      try { await api.rpc('report_content', { p_target: conv.other_id, p_message: m && m.kind === 'text' ? m.id : null, p_reason: k, p_details: null }); toast('Signalement envoyé. Merci.'); } catch (e) { toast(errText(e), { error: true }); } } })));
  }

  // ------------------------------------------------ composition : réponse, modification, brouillon, envoi
  function startReply(m) { editing = null; replyTo = m; drawReplyBar(); ta.focus(); }
  function startEdit(m) { replyTo = null; editing = m; ta.value = m.body; autosize(); drawReplyBar(); ta.focus(); }
  function drawReplyBar() {
    const x = editing || replyTo; replyBar.hidden = !x; if (!x) return;
    replyBar.replaceChildren(icon(editing ? 'edit' : 'reply', 18), h('div', { class: 'rb-text' }, h('strong', null, editing ? 'Modification du message' : 'Réponse à ' + (x.sender_id === me() ? 'vous-même' : name())), h('span', null, snippet(x))),
      iconBtn('x', 'Annuler', () => { if (editing) { ta.value = ''; autosize(); } editing = null; replyTo = null; drawReplyBar(); }));
  }
  function autosize() { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; }
  let draftTimer = null;
  function onInput() { autosize(); clearTimeout(draftTimer); draftTimer = setTimeout(() => { if (!editing) { if (ta.value) store.set(draftKey, ta.value); else store.del(draftKey); } }, 300); }
  async function sendText() {
    const body = ta.value.trim(); if (!body || conv?.blocked_by_me) return;
    if (editing) {
      const m = editing; if (body === m.body) { editing = null; ta.value = ''; autosize(); drawReplyBar(); return; }
      try { await api.rpc('edit_message', { p_id: m.id, p_body: body }); upsert({ ...m, body, edited_at: new Date().toISOString() }); editing = null; ta.value = ''; autosize(); drawReplyBar(); render(); Piaf.refreshConvs(); }
      catch (e) { toast(errText(e), { error: true }); } return;
    }
    const rid = replyTo && !String(replyTo.id).startsWith('local:') ? replyTo.id : null;
    ta.value = ''; autosize(); store.del(draftKey); replyTo = null; drawReplyBar();
    const p = Piaf.queueMessage(convId, body, { reply_to: rid }); render(); scrollBottom(); await p; Piaf.refreshConvs();
  }

  // ------------------------------------------------ médias : sélection, aperçu, envoi avec progression
  const remaining = () => Math.max(0, cfg().conversation_quota_bytes - mediaBytes);
  function addFiles(files) {
    const max = cfg().max_files_per_batch, errs = [];
    for (const f of files) {
      const mime = mimeOf(f), kind = OK_MIME.has(mime) ? kindOf(mime) : null;
      if (!kind) { errs.push(`${f.name} : format non accepté`); continue; }
      const lim = kind === 'photo' ? cfg().photo_max_bytes : cfg().video_max_bytes;
      if (f.size > lim) { errs.push(`${f.name} : trop volumineux (${fmt.size(f.size)}, limite ${fmt.size(lim)})`); continue; }
      if (f.size === 0) { errs.push(`${f.name} : fichier vide`); continue; }
      if (tray.length >= max) { errs.push(`Maximum ${max} fichiers par envoi`); break; }
      if (tray.reduce((n, t) => n + t.file.size, 0) + f.size > remaining()) { errs.push(`${f.name} : dépasserait l’espace restant (${fmt.size(remaining())})`); continue; }
      tray.push({ file: f, mime, kind, url: kind === 'photo' ? URL.createObjectURL(f) : null });
    }
    if (errs.length) modal({ title: 'Certains fichiers ne peuvent pas être envoyés', body: h('ul', { class: 'err-list' }, [...new Set(errs)].map((x) => h('li', null, x))), actions: [{ label: 'Compris', primary: true }] });
    drawTray();
  }
  function drawTray() {
    trayEl.hidden = !tray.length; if (!tray.length) return;
    const total = tray.reduce((n, t) => n + t.file.size, 0);
    trayEl.replaceChildren(h('div', { class: 'tray-items' }, tray.map((t, i) => h('div', { class: 'tray-item' }, t.url ? h('img', { src: t.url, alt: t.file.name }) : h('span', { class: 'vid' }, icon('film', 24)),
      h('span', { class: 'tray-sz' }, fmt.size(t.file.size)), h('button', { type: 'button', class: 'tray-x', 'aria-label': 'Retirer ' + t.file.name, onclick: () => { if (t.url) URL.revokeObjectURL(t.url); tray.splice(i, 1); drawTray(); } }, icon('x', 14))))),
      h('div', { class: 'tray-foot' }, h('span', { class: 'muted small' }, `${tray.length} fichier${tray.length > 1 ? 's' : ''} · ${fmt.size(total)} · espace restant ${fmt.size(remaining())}`),
        h('button', { class: 'btn primary', type: 'button', onclick: () => { const f = tray.map((t) => ({ file: t.file, mime: t.mime })); tray.forEach((t) => t.url && URL.revokeObjectURL(t.url)); tray = []; drawTray(); startUpload(f); } }, 'Envoyer')));
  }
  function quotaModal(used) {
    const u = used ?? mediaBytes;
    modal({ title: 'Espace de la conversation plein', body: [h('p', null, `Cette conversation contient déjà ${fmt.size(u)} de médias sur ${fmt.size(cfg().conversation_quota_bytes)} autorisés. L’espace est partagé entre vous deux et rien n’est supprimé automatiquement.`), h('p', null, 'Supprimez des médias « pour tout le monde » pour libérer de l’espace. Télécharger ou supprimer « pour moi » ne libère rien.')],
      actions: [{ label: 'Plus tard' }, { label: 'Gérer les médias', primary: true, onClick: () => Piaf.go('#/m/' + convId) }] });
  }
  async function startUpload(files) {
    let res;
    try { res = await api.rpc('reserve_media', { p_conv: convId, p_files: files.map((f) => ({ name: f.file.name, mime: f.mime, size: f.file.size })) }); }
    catch (e) {
      if (toCode(e) === 'quota_exceeded') { await loadQuota(); return quotaModal(Number(e.detail) || undefined); }
      return toast(errText(e), { error: true });
    }
    await loadQuota();
    const jobs = res.map((r, i) => ({ id: r.o_id, path: r.o_path, file: files[i].file, mime: files[i].mime, progress: 0, status: 'uploading', xhr: null }));
    uploads.push(...jobs); drawUploads();
    const token = await api.accessToken(); const queue = [...jobs];
    const worker = async () => { for (let j = queue.shift(); j; j = queue.shift()) await uploadOne(j, token); };
    await Promise.all([worker(), worker()]);
    const ok = jobs.filter((j) => j.status === 'uploaded');
    if (ok.length) {
      try {
        const { results } = await api.media({ action: 'finalize', ids: ok.map((j) => j.id) });
        for (const r of results) { const j = jobs.find((x) => x.id === r.id); if (r.ok) uploads = uploads.filter((x) => x !== j); else { j.status = 'failed'; j.err = r.error; } }
      } catch (e) { ok.forEach((j) => { j.status = 'failed'; j.err = toCode(e); }); }
    }
    drawUploads(); await syncLatest(); await loadQuota(); scrollBottom(); Piaf.refreshConvs();
  }
  function uploadOne(job, token) {
    if (job.status !== 'uploading') return Promise.resolve();
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest(); job.xhr = xhr;
      const body = new FormData(); body.append('cacheControl', '3600');
      body.append('', job.file.type === job.mime ? job.file : new File([job.file], job.file.name, { type: job.mime }));
      xhr.open('POST', `${CFG.supabaseUrl}/storage/v1/object/chat-media/${job.path}`);
      xhr.setRequestHeader('Authorization', 'Bearer ' + token); xhr.setRequestHeader('apikey', CFG.supabaseKey); xhr.setRequestHeader('x-upsert', 'false');
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) { job.progress = e.loaded / e.total; paintJob(job); } };
      const fail = (err) => { job.status = 'failed'; job.err = err; api.media({ action: 'abort', ids: [job.id] }).catch(() => {}); drawUploads(); resolve(); };
      xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) { job.status = 'uploaded'; job.progress = 1; drawUploads(); resolve(); } else fail(xhr.status === 413 ? 'file_too_large' : 'unknown'); };
      xhr.onerror = () => fail('network'); xhr.onabort = () => { job.status = 'canceled'; resolve(); };
      xhr.send(body);
    });
  }
  function paintJob(job) { const b = uploadsEl.querySelector(`[data-job="${job.id}"] .bar > i`); if (b) b.style.width = Math.round(job.progress * 100) + '%'; }
  function drawUploads() {
    uploads = uploads.filter((j) => j.status !== 'canceled'); uploadsEl.hidden = !uploads.length;
    uploadsEl.replaceChildren(...uploads.map((j) => h('div', { class: 'upload' + (j.status === 'failed' ? ' failed' : ''), 'data-job': j.id },
      icon(j.mime.startsWith('image/') ? 'image' : 'film', 20),
      h('div', { class: 'up-main' }, h('span', { class: 'up-name' }, j.file.name), j.status === 'failed' ? h('span', { class: 'form-error small' }, errText(j.err)) :
        h('span', { class: 'bar', role: 'progressbar', 'aria-valuenow': String(Math.round(j.progress * 100)), 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('i', { style: { width: Math.round(j.progress * 100) + '%' } }))),
      j.status === 'failed' ? h('button', { class: 'btn small', type: 'button', onclick: () => { uploads = uploads.filter((x) => x !== j); drawUploads(); startUpload([{ file: j.file, mime: j.mime }]); } }, 'Réessayer') : null,
      iconBtn('x', j.status === 'failed' ? 'Retirer' : 'Annuler l’envoi', () => { if (j.xhr && j.status === 'uploading') j.xhr.abort(); api.media({ action: 'abort', ids: [j.id] }).then(loadQuota).catch(() => {}); j.status = 'canceled'; drawUploads(); }))));
  }

  // ------------------------------------------------ menus : profil, options, recherche
  function profileSheet() {
    if (!conv) return;
    sheet(null, [
      { icon: 'image', label: 'Médias partagés', onClick: () => Piaf.go('#/m/' + convId) },
      { icon: 'search', label: 'Rechercher dans la conversation', onClick: openSearch },
      { sep: true },
      conv.blocked_by_me ? { icon: 'ban', label: 'Débloquer ce contact', onClick: toggleBlock } : { icon: 'ban', danger: true, label: 'Bloquer ce contact', onClick: toggleBlock },
      { icon: 'flag', danger: true, label: 'Signaler cette personne', onClick: () => reportDialog(null) },
    ], h('div', { class: 'profile-card' }, avatar(conv.other_name, 72), h('strong', { class: 'big' }, conv.other_name), conv.nickname ? h('span', { class: 'muted small' }, 'Renommé « ' + conv.nickname + ' » (visible par vous seul)') : null,
      h('div', { class: 'muted' }, 'Identifiant ' + fmt.id8(conv.other_public_id)), h('button', { class: 'link-btn', type: 'button', onclick: () => copyText(conv.other_public_id) }, 'Copier l’identifiant')));
  }
  async function toggleBlock() {
    if (!conv.blocked_by_me && !(await confirmDialog('Bloquer ce contact ?', 'Vous ne recevrez plus ses messages ni ses médias, et vous ne pourrez plus lui écrire tant que le blocage dure. Les messages déjà échangés restent visibles. Il n’est pas prévenu.', 'Bloquer', true))) return;
    try { await api.rpc(conv.blocked_by_me ? 'unblock_user' : 'block_user', { p_target: conv.other_id }); await Piaf.refreshConvs(); toast(conv.blocked_by_me ? 'Contact débloqué' : 'Contact bloqué'); } catch (e) { toast(errText(e), { error: true }); }
  }
  function chatMenu() {
    if (!conv) return;
    sheet(name(), [
      { icon: 'user', label: 'Profil du contact', onClick: profileSheet }, { icon: 'image', label: 'Médias partagés', onClick: () => Piaf.go('#/m/' + convId) },
      { icon: 'search', label: 'Rechercher dans la conversation', onClick: openSearch },
      { icon: 'sliders', label: 'Favori, archive, silence, renommer…', onClick: () => Piaf.convMenu(conv, { afterArchive: () => Piaf.go('#/'), afterClear: () => { msgs.clear(); nodes.clear(); pins.clear(); hasMore = false; render(); } }) },
    ]);
  }
  function openSearch() {
    searchOpen = true; searchPanel.hidden = false; let t = null, seq = 0;
    const out = h('div', { class: 'results' }, h('p', { class: 'muted center' }, 'Saisissez un mot ou une expression.'));
    const inp = h('input', { type: 'search', placeholder: 'Rechercher dans cette conversation', 'aria-label': 'Rechercher dans cette conversation', oninput: () => { clearTimeout(t); t = setTimeout(run, 300); } });
    const close = () => { searchOpen = false; searchPanel.hidden = true; searchPanel.replaceChildren(); };
    async function run() {
      const q = inp.value.trim(), my = ++seq; if (q.length < 2) { out.replaceChildren(h('p', { class: 'muted center' }, 'Saisissez au moins 2 caractères.')); return; }
      try {
        const rows = await api.q(sb.from('my_messages').select('id,sender_id,body,created_at').eq('conversation_id', convId).is('deleted_at', null).ilike('body', `%${esc(q)}%`).order('created_at', { ascending: false }).limit(40)); if (my !== seq) return;
        out.replaceChildren(...(rows.length ? rows.map((r) => h('button', { class: 'hit', type: 'button', onclick: () => { close(); jumpTo(r.id); } }, h('span', { class: 'muted small' }, `${r.sender_id === me() ? 'Vous' : name()} · ${fmt.dateTime(r.created_at)}`), h('span', null, r.body.length > 140 ? r.body.slice(0, 140) + '…' : r.body))) : [h('p', { class: 'muted center' }, 'Aucun message trouvé.')]));
      } catch (e) { out.replaceChildren(h('p', { class: 'form-error center' }, errText(e))); }
    }
    searchPanel.replaceChildren(h('div', { class: 'searchbar' }, iconBtn('back', 'Fermer la recherche', close), inp), out); inp.focus();
  }
  async function jumpTo(id) {
    for (let n = 0; n < 25 && !nodes.has(id) && hasMore; n++) await loadOlder();
    const node = nodes.get(id); if (!node) { toast('Ce message est trop ancien pour être affiché ici.', { error: true }); return; }
    node.scrollIntoView({ block: 'center' }); node.classList.add('flash'); setTimeout(() => node.classList.remove('flash'), 1600);
  }

  // ------------------------------------------------ temps réel
  const unsubs = [
    bus.on('msg', async (p) => {
      const row = p.new; if (!row || row.conversation_id !== convId) return;
      const wasBottom = atBottom, known = msgs.has(row.id);
      await hydrate([row]).catch(() => {}); upsert(row); render();
      if (p.eventType === 'INSERT' && !known) {
        if (row.sender_id === me() || wasBottom) { scrollBottom(); scheduleRead(); }
        else { newCount++; pill.hidden = false; pill.replaceChildren(icon('down', 16), ` ${newCount} nouveau${newCount > 1 ? 'x' : ''} message${newCount > 1 ? 's' : ''}`); }
        if (row.kind === 'media') setTimeout(() => hydrate([row]).then(render).catch(() => {}), 600);
      }
    }),
    bus.on('react', (p) => { const id = p.new?.message_id || p.old?.message_id; if (id && msgs.has(id)) refreshReacts(id); }),
    bus.on('media', (p) => { const r = p.new; if (r && r.conversation_id === convId && r.message_id && msgs.has(r.message_id)) hydrate([msgs.get(r.message_id)]).then(render).catch(() => {}); }),
    bus.on('conv', (p) => { if (p.new?.id === convId && p.new.media_bytes != null) mediaBytes = Number(p.new.media_bytes); }),
    bus.on('sent', (row) => { if (row.conversation_id === convId) { hydrate([row]).catch(() => {}).then(() => { upsert(row); render(); scrollBottom(); }); } }),
    bus.on('outbox', (c) => { if (c === convId) { render(); if (atBottom) scrollBottom(); } }),
    bus.on('convs', () => { conv = Piaf.conv(convId) || conv; drawHeader(); }),
    bus.on('resync', () => { syncLatest(); loadQuota(); }),
    bus.on('visible', () => { syncLatest(); scheduleRead(); }),
    bus.on('viewport', () => { if (atBottom) scrollBottom(); }),
  ];

  // ------------------------------------------------ montage
  drawHeader(); const saved = store.get(draftKey, ''); if (saved) { ta.value = saved; autosize(); }
  async function init() {
    if (!conv) { try { await Piaf.refreshConvs(); conv = Piaf.conv(convId); } catch { /* */ } }
    if (!conv) { list.replaceChildren(h('div', { class: 'empty' }, h('h2', null, 'Discussion introuvable'), h('p', { class: 'muted' }, 'Elle n’existe plus ou vous n’y avez pas accès.'), h('button', { class: 'btn primary', onclick: () => Piaf.go('#/') }, 'Retour'))); composer.hidden = true; return; }
    drawHeader(); list.replaceChildren(h('div', { class: 'spinner', role: 'status', 'aria-label': 'Chargement des messages' }));
    try {
      const rows = await api.q(sb.from('my_messages').select(COLS).eq('conversation_id', convId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(PAGE));
      if (destroyed) return; hasMore = rows.length === PAGE; await hydrate(rows); rows.forEach(upsert);
      const pinned = await api.q(sb.from('my_messages').select(COLS).eq('conversation_id', convId).not('pinned_at', 'is', null).is('deleted_at', null).limit(5)); pinned.forEach((r) => pins.set(r.id, r));
    } catch (e) { list.replaceChildren(h('div', { class: 'empty' }, h('p', null, errText(e)), h('button', { class: 'btn', onclick: init }, 'Réessayer'))); return; }
    render(); scrollBottom(); loadQuota(); scheduleRead(); Piaf.flushOutbox();
  }
  return { el, mounted() { init(); }, destroy() { destroyed = true; unsubs.forEach((u) => u()); clearTimeout(markTimer); uploads.forEach((j) => { if (j.xhr && j.status === 'uploading') { j.xhr.abort(); api.media({ action: 'abort', ids: [j.id] }).catch(() => {}); } }); tray.forEach((t) => t.url && URL.revokeObjectURL(t.url)); } };
};

// ================================================================== galerie des médias partagés
Piaf.views.gallery = (route) => {
  const convId = route.id, PAGE_G = 60;
  let kind = '', query = '', items = [], more = false, used = 0, destroyed = false;
  const conv = () => Piaf.conv(convId);
  const usage = h('div', { class: 'card usage' }), grid = h('div', { class: 'grid' }), moreBtn = h('button', { class: 'btn', type: 'button', hidden: true, onclick: () => load(true) }, 'Charger plus');
  const search = h('input', { type: 'search', placeholder: 'Rechercher par nom de fichier', 'aria-label': 'Rechercher par nom de fichier', oninput: () => { clearTimeout(search._t); search._t = setTimeout(() => { query = search.value.trim(); load(); }, 300); } });
  const seg = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Type de média' });
  function drawSeg() { seg.replaceChildren(...[['', 'Tout'], ['photo', 'Photos'], ['video', 'Vidéos']].map(([k, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(kind === k), class: kind === k ? 'on' : '', onclick: () => { kind = k; drawSeg(); load(); } }, l))); }
  function drawUsage() {
    const quota = S.cfg.conversation_quota_bytes, pct = Math.min(100, Math.round((used / quota) * 100)), left = Math.max(0, quota - used);
    usage.replaceChildren(h('div', { class: 'usage-top' }, h('strong', null, `${fmt.size(used)} utilisés sur ${fmt.size(quota)}`), h('span', { class: 'muted' }, `${fmt.size(left)} restants`)),
      h('div', { class: 'bar big' + (pct >= 90 ? ' warn' : ''), role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': 'Espace utilisé' }, h('i', { style: { width: pct + '%' } })),
      pct >= 100 || left < 1048576 ? h('p', { class: 'form-error small' }, 'Quota atteint : les nouveaux envois de médias sont bloqués. Supprimez des médias « pour tout le monde » pour libérer de l’espace.') : null,
      h('p', { class: 'muted small' }, 'Espace partagé entre vous deux. Télécharger ou « supprimer pour moi » ne libère rien ; « supprimer pour tout le monde » efface le fichier du serveur.'));
  }
  async function load(append) {
    try {
      const from = append ? items.length : 0;
      let qy = sb.from('my_media').select('id,message_id,name,mime,kind,size_bytes,path,created_at,uploader_id').eq('conversation_id', convId).order('created_at', { ascending: false }).range(from, from + PAGE_G - 1);
      if (kind) qy = qy.eq('kind', kind); if (query) qy = qy.ilike('name', `%${esc(query)}%`);
      const rows = await api.q(qy); if (destroyed) return;
      items = append ? items.concat(rows) : rows; more = rows.length === PAGE_G;
      const q2 = await api.q(sb.from('conversations').select('media_bytes').eq('id', convId).single()); used = Number(q2.media_bytes); drawUsage();
      await Piaf.signedUrls(items.filter((m) => m.kind === 'photo').map((m) => m.path)).catch(() => {});
      drawGrid();
    } catch (e) { grid.replaceChildren(h('div', { class: 'empty' }, h('p', null, errText(e)), h('button', { class: 'btn', onclick: () => load() }, 'Réessayer'))); }
  }
  function drawGrid() {
    moreBtn.hidden = !more;
    if (!items.length) { grid.replaceChildren(h('div', { class: 'empty' }, icon('image', 40), h('h2', null, query || kind ? 'Aucun résultat' : 'Aucun média partagé'), h('p', { class: 'muted' }, query || kind ? 'Essayez un autre filtre.' : 'Les photos et vidéos envoyées dans cette discussion apparaissent ici.'))); return; }
    grid.replaceChildren(...items.map((m, i) => {
      const t = h('button', { class: 'tile', type: 'button', 'aria-label': `${m.name}, ${fmt.size(m.size_bytes)}`, onclick: () => Piaf.openViewer(items.slice(), i, { onChange: () => load() }) });
      Piaf.signedUrl(m.path).then((u) => t.prepend(m.kind === 'photo' ? h('img', { src: u, alt: '', loading: 'lazy' }) : h('video', { src: u + '#t=0.1', preload: 'metadata', muted: true, playsinline: true }))).catch(() => {});
      t.append(h('span', { class: 'tile-sz' }, m.kind === 'video' ? icon('play', 12) : null, fmt.size(m.size_bytes))); return t;
    }));
  }
  const unsubs = [bus.on('media', () => load()), bus.on('conv', (p) => { if (p.new?.id === convId) load(); }), bus.on('resync', () => load())];
  drawSeg(); drawUsage();
  const el = h('div', { class: 'screen gallery' }, h('header', { class: 'topbar' }, iconBtn('back', 'Retour à la discussion', () => Piaf.go('#/c/' + convId)), h('h1', null, 'Médias partagés')),
    h('div', { class: 'scroll' }, usage, h('div', { class: 'filters' }, seg, h('div', { class: 'searchbar' }, icon('search', 18), search)), grid, h('div', { class: 'center pad' }, moreBtn)));
  return { el, mounted() { load(); }, destroy() { destroyed = true; unsubs.forEach((u) => u()); } };
};
})();
