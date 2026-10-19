/* Piaf — évènements de calendrier pour Talk2Piaf et Talk2Piaf Cowork.
   Aucune dépendance, aucun réseau, aucun compte : le texte « dentiste demain à 14h » devient un brouillon d'évènement
   (titre, début, fin), puis un fichier .ics (Apple, Samsung, Outlook, Google… l'ouvrent d'un appui) ou un lien prérempli
   (Google Agenda, Outlook). L'évènement n'est enregistré que lorsque la personne valide dans son application de calendrier.
   Les dates sont comprises dans l'heure de l'appareil ; le fichier .ics est écrit en heure universelle (Z) pour rester juste partout.

   API : parse(texte, maintenant) → { ok, title, start, end, allDay, loc, when } ou { ok: false, reason: 'date' | 'intent', title, time }
         pack(ev) → charge utile sérialisable pour un bouton ; toICS(p), googleUrl(p), outlookUrl(p), filename(p) */
(function (root) {
'use strict';

const DAY_IDS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTH_IDS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
const MONTH_LBL = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MON_RE = 'janvier|janv|fevrier|fevr|fev|mars|avril|avr|mai|juin|juillet|juil|aout|septembre|sept|octobre|oct|novembre|nov|decembre|dec';
const DAY_RE = DAY_IDS.join('|');
const monthOf = (s) => MONTH_IDS.findIndex((m) => m.startsWith(s));

// minuscules sans accents, caractère par caractère : la longueur ne change pas, donc les positions valent aussi pour le texte d'origine
const fold = (s) => Array.from(String(s), (ch) => ch.normalize('NFD')[0].toLowerCase()).join('').replace(/[’`´]/g, "'");
const sod = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const addMonths = (d, n) => { const x = new Date(d); const day = x.getDate(); x.setDate(1); x.setMonth(x.getMonth() + n); x.setDate(Math.min(day, new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate())); return x; };
const p2 = (n) => String(n).padStart(2, '0');
const validDate = (y, mo, d) => { const x = new Date(y, mo, d); return x.getFullYear() === y && x.getMonth() === mo && x.getDate() === d ? x : null; };
const hm = (h, m) => `${h}h${p2(m)}`;

// ------------------------------------------------------------------ intention
const VERB = /\b(?:ajoute|ajouter|ajoutes|ajoutez|mets|met|mettre|mettez|note|noter|notes|cree|creer|crees|creez|enregistre|enregistrer|planifie|planifier|programme|programmer|inscris|inscrire|bloque|bloquer|reserve|reserver)\b/;
const CALWORD = /\b(?:calendrier|agenda|planning|evenement|event|rdv|rendez[- ]vous|reunion)\b/;
const REMIND = /\brappelle(?:s|z)?[- ]moi\b/;
const STARTS_EVENT = /^(?:rdv|rendez[- ]vous|reunion|evenement)\b/;
// Une demande d'évènement : un verbe d'ajout + un mot de calendrier, ou « rappelle-moi », ou un texte qui commence par rdv / réunion.
function intent(L) {
  return (VERB.test(L) && /\b(?:calendrier|agenda|planning|evenement|event|rdv|rendez[- ]vous|reunion)\b/.test(L)) || REMIND.test(L) || STARTS_EVENT.test(L);
}

const explicit = (L) => (VERB.test(L) && /\b(?:calendrier|agenda|planning|evenement|event|rdv|rendez[- ]vous|reunion)\b/.test(L)) || STARTS_EVENT.test(L);

// ------------------------------------------------------------------ analyse
function parse(text, now) {
  now = now instanceof Date && !isNaN(now) ? now : new Date();
  const q = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (!q) return { ok: false, reason: 'intent' };
  const L = fold(q);
  if (L.length !== q.length) return { ok: false, reason: 'intent' };
  const wantIntent = intent(L);
  const mask = new Array(q.length).fill(false);
  let W = L;                                          // copie de travail : ce qui est déjà compris est remplacé par des espaces
  const eat = (m) => { for (let i = m.index; i < m.index + m[0].length; i++) { mask[i] = true; } W = W.slice(0, m.index) + ' '.repeat(m[0].length) + W.slice(m.index + m[0].length); };
  const find = (re) => { const m = re.exec(W); if (m) eat(m); return m; };
  const today = sod(now);

  // ---- durée : « pendant 2 heures », « durée 1h30 », « 45 minutes »
  let dur = null, m;
  if ((m = find(/\b(?:pendant|durant|duree(?: de)?|pour une duree de|pour)\s+(\d{1,2})\s?(?:h|heures?)\s?(\d{2})?\b/))) dur = parseInt(m[1], 10) * 60 + (m[2] ? parseInt(m[2], 10) : 0);
  else if ((m = find(/\b(?:pendant|durant|duree(?: de)?|pour une duree de|pour)\s+(\d{1,3})\s?(?:min|minutes?)\b/))) dur = parseInt(m[1], 10);
  else if ((m = find(/\b(?:pendant|durant|pour)\s+(?:une|1) demi[- ]heure\b/))) dur = 30;
  else if ((m = find(/\b(?:pendant|durant|pour)\s+(?:une|1) heure\b/))) dur = 60;
  if (dur !== null && (dur < 5 || dur > 24 * 60)) dur = null;

  // ---- date
  let date = null, relStart = null;
  if ((m = find(/\bdans (\d{1,3}) (minutes?|min|heures?|h)\b/))) {
    const n = parseInt(m[1], 10), unit = /^m/.test(m[2]) ? 60000 : 3600000;
    relStart = new Date(Math.ceil((now.getTime() + n * unit) / 300000) * 300000);          // arrondi aux 5 minutes
  } else if ((m = find(/\bdans (\d{1,3}) (jours?|semaines?|mois)\b/))) {
    const n = parseInt(m[1], 10); date = /^j/.test(m[2]) ? addDays(today, n) : /^s/.test(m[2]) ? addDays(today, 7 * n) : addMonths(today, n);
  } else if ((m = find(/\b(?:le |du )?(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?!\d)/))) {
    let y = m[3] ? parseInt(m[3], 10) : today.getFullYear(); if (m[3] && m[3].length === 2) y += 2000;
    date = validDate(y, parseInt(m[2], 10) - 1, parseInt(m[1], 10)); if (date && !m[3] && date < today) date = validDate(y + 1, date.getMonth(), date.getDate());
  } else if ((m = find(new RegExp('\\b(?:(?:le|du|ce) )?(?:(?:' + DAY_RE + ') )?(\\d{1,2})(?:er)? (' + MON_RE + ')\\.?(?: (\\d{4}))?(?![a-z])')))) {
    let y = m[3] ? parseInt(m[3], 10) : today.getFullYear();
    date = validDate(y, monthOf(m[2]), parseInt(m[1], 10)); if (date && !m[3] && date < today) date = validDate(y + 1, date.getMonth(), date.getDate());
  } else if (find(/\bapres[- ]demain\b/)) date = addDays(today, 2);
  else if (find(/\bdemain\b/)) date = addDays(today, 1);
  else if (find(/\b(?:aujourd'hui|aujourdhui)\b/)) date = today;
  else if ((m = find(new RegExp('\\b(?:(?:ce|le|du) )?(' + DAY_RE + ')(?: (prochain|suivant))?\\b')))) {
    let diff = (DAY_IDS.indexOf(m[1]) - today.getDay() + 7) % 7; if (diff === 0 && m[2]) diff = 7;
    date = addDays(today, diff);
  } else if ((m = find(/\ble (\d{1,2})(?:er)?(?![\d:\/]| ?(?:h\b|heures?))/))) {
    const d = parseInt(m[1], 10); date = validDate(today.getFullYear(), today.getMonth(), d);
    if (!date || date < today) { const n = addMonths(new Date(today.getFullYear(), today.getMonth(), 1), 1); date = validDate(n.getFullYear(), n.getMonth(), d); }
  }

  // ---- heure : « de 14h à 16h », « 14h30 », « 9:15 », « midi », « 8h du soir »
  let h1 = null, m1 = 0, h2 = null, m2 = 0, rangeEnd = false;
  if ((m = find(/\b(?:de |entre )?(\d{1,2})\s?(?:h|heures?|:)\s?(\d{2})?\s?(?:a|-|–|—|jusqu'a|et)\s?(\d{1,2})\s?(?:h|heures?|:)\s?(\d{2})?(?![\d:])/))) {
    h1 = parseInt(m[1], 10); m1 = m[2] ? parseInt(m[2], 10) : 0; h2 = parseInt(m[3], 10); m2 = m[4] ? parseInt(m[4], 10) : 0; rangeEnd = true;
  } else if ((m = find(/\b(?:a |vers |des )?(\d{1,2})\s?(?:h|heures?)\s?(\d{2})?(?![\d:])/)) || (m = find(/\b(?:a |vers |des )?(\d{1,2}):(\d{2})(?![\d:])/))) {
    h1 = parseInt(m[1], 10); m1 = m[2] ? parseInt(m[2], 10) : 0;
  } else if (find(/\b(?:a |vers )?midi\b/)) { h1 = 12; m1 = 0; }
  // moment de la journée : « du soir » fait passer 8h à 20h ; sans heure, il fixe une heure par défaut
  let part = null;
  if ((m = find(/\b(?:ce |de l'|de la |du |le |cet )?(matin|apres[- ]midi|soir|soiree)\b/))) part = /^m/.test(m[1]) ? 'matin' : /^a/.test(m[1]) ? 'pm' : 'soir';
  if (h1 !== null && part && part !== 'matin') { if (h1 < 12) h1 += 12; if (h2 !== null && h2 < 12 && h2 < h1 - 12 + 12) h2 += 12; }
  if (h1 !== null && (h1 > 23 || m1 > 59)) return { ok: false, reason: 'intent' };
  if (h2 !== null && (h2 > 23 || m2 > 59)) { h2 = null; rangeEnd = false; }
  if (h1 === null && part) { h1 = part === 'matin' ? 9 : part === 'pm' ? 14 : 20; m1 = 0; }

  // ---- ce qui reste : le titre
  let lead = wantIntent;
  const LEADS = [
    /\b(?:s'il (?:te|vous) plait|stp|svp|merci)\b/,
    /\b(?:peux|pouvez|pourrais|pourriez)[- ](?:tu|vous)\b/,
    /\b(?:ajoute|ajouter|ajoutes|ajoutez|mets|met|mettre|mettez|note|noter|notes|cree|creer|crees|creez|enregistre|enregistrer|planifie|planifier|programme|programmer|inscris|inscrire|bloque|bloquer|reserve|reserver)\b(?: moi)?(?: (?:ca|cela|ceci|ce|cet|l'|un|une|le|la))?/,
    /\b(?:(?:dans|sur|a|au|en|pour) (?:mon |ma |le |la |l'|notre )?)?(?:calendrier|agenda|planning)(?: (?:google|outlook|apple|iphone|samsung))?\b/,
    /\b(?:un |le |l')?(?:nouvel |nouveau )?(?:evenement|event)\b(?: suivant)?/,
    /\brappelle(?:s|z)?[- ]moi\b(?: (?:de |d'|que |qu'))?/,
  ];
  if (lead) for (const re of LEADS) { let mm; const g = new RegExp(re.source, 'g'); while ((mm = g.exec(W))) { eat(mm); g.lastIndex = 0; } }
  let title = Array.from(q).map((c, i) => (mask[i] ? ' ' : c)).join('').replace(/\s+/g, ' ').trim();
  const EDGE = /^(?:(?:le|la|l'|les|de|du|des|d'|a|au|aux|pour|vers|ce|cet|cette|et|dans|en|un|une|que|qu')\s+|[\s,;:.!?\-–—'«»"]+)/i;
  const EDGE_END = /(?:\s+(?:le|la|l'|les|de|du|des|d'|a|au|aux|pour|vers|ce|cet|cette|et|dans|en|un|une|que|qu')|[\s,;:.!?\-–—'«»"]+)$/i;
  for (let i = 0; i < 6; i++) { const t = title.replace(EDGE, '').replace(EDGE_END, ''); if (t === title) break; title = t; }
  let loc = '';
  if ((m = /(?:^|\s)(?:lieu|adresse)\s*:\s*(.+)$/i.exec(title))) { loc = m[1].trim(); title = title.slice(0, m.index).replace(EDGE_END, '').trim(); }
  else if ((m = /(?:^|\s)(?:au|aux|à la|à l['’]|à|salle)\s+([A-ZÀ-ÖØ-Ý][\wÀ-ÿ'’\-]*(?:\s+(?:(?:de|du|des|la|le|les|d['’]|l['’])\s*)?[A-ZÀ-ÖØ-Ý0-9][\wÀ-ÿ'’\-]*)*)\s*$/.exec(title))) loc = m[1].trim();
  title = title.replace(/^[a-zà-ÿ]/, (c) => c.toUpperCase()).slice(0, 120);

  if (!wantIntent) return { ok: false, reason: 'intent' };
  if (!date && !relStart) {
    if (!explicit(L)) return { ok: false, reason: 'intent' };                 // « rappelle-moi mon identifiant » n'est pas une demande d'évènement
    return { ok: false, reason: 'date', title: title || '', time: h1 !== null ? { h: h1, m: m1 } : null, dur, loc };
  }
  if (!title) title = REMIND.test(L) ? 'Rappel' : 'Évènement';

  // ---- début et fin
  let start, end, allDay = false;
  if (relStart) { start = relStart; end = new Date(start.getTime() + (dur || 60) * 60000); }
  else if (h1 === null) { allDay = true; start = date; end = addDays(date, 1); }
  else {
    start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), h1, m1);
    end = rangeEnd && h2 !== null ? new Date(date.getFullYear(), date.getMonth(), date.getDate(), h2, m2) : new Date(start.getTime() + (dur || 60) * 60000);
    if (end <= start) end = new Date(start.getTime() + (dur || 60) * 60000);
  }
  const ev = { ok: true, title, start, end, allDay, loc, past: !allDay ? end < now : addDays(start, 1) <= sod(now) };
  ev.when = when(ev, now);
  return ev;
}

// « mardi 20 octobre, de 14h00 à 15h00 »
function when(ev, now) {
  const d = ev.start, nowY = (now || new Date()).getFullYear();
  const day = `${DAY_IDS[d.getDay()]} ${d.getDate() === 1 ? '1er' : d.getDate()} ${MONTH_LBL[d.getMonth()]}${d.getFullYear() !== nowY ? ' ' + d.getFullYear() : ''}`;
  if (ev.allDay) return `${day} (toute la journée)`;
  const sameDay = sod(ev.start).getTime() === sod(ev.end).getTime();
  return `${day}, de ${hm(d.getHours(), d.getMinutes())} à ${hm(ev.end.getHours(), ev.end.getMinutes())}${sameDay ? '' : ' (le lendemain)'}`;
}

// ------------------------------------------------------------------ charge utile des boutons (sérialisable, conservée dans l'historique)
const local = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:00`;
const pack = (ev) => ({ t: ev.title, s: local(ev.start), e: local(ev.end), ad: !!ev.allDay, loc: ev.loc || '' });
const unpack = (p) => ({ title: String(p.t || 'Évènement').slice(0, 120), start: new Date(p.s), end: new Date(p.e), allDay: !!p.ad, loc: String(p.loc || '').slice(0, 200) });

const utc = (d) => `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`;
const ymd = (d) => `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function fold75(line) {                                // lignes de 75 octets au plus (RFC 5545), coupées entre deux caractères
  const enc = typeof TextEncoder === 'function' ? new TextEncoder() : null, size = (c) => (enc ? enc.encode(c).length : c.length);
  const out = []; let cur = '', n = 0;
  for (const ch of line) { const s = size(ch); if (n + s > (out.length ? 74 : 75)) { out.push(cur); cur = ''; n = 0; } cur += ch; n += s; }
  out.push(cur); return out.join('\r\n ');
}
function toICS(p, o) {
  o = o || {}; const ev = unpack(p), stamp = utc(o.now || new Date());
  const uid = o.uid || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}@piaf`;
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Piaf//Talk2Piaf//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT', 'UID:' + uid, 'DTSTAMP:' + stamp];
  if (ev.allDay) L.push('DTSTART;VALUE=DATE:' + ymd(ev.start), 'DTEND;VALUE=DATE:' + ymd(ev.end)); else L.push('DTSTART:' + utc(ev.start), 'DTEND:' + utc(ev.end));
  L.push('SUMMARY:' + esc(ev.title)); if (ev.loc) L.push('LOCATION:' + esc(ev.loc)); L.push('DESCRIPTION:' + esc(o.notes || 'Ajouté depuis Piaf'));
  if (o.alarmMin > 0 && !ev.allDay) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(ev.title), 'TRIGGER:-PT' + Math.min(o.alarmMin, 10080) + 'M', 'END:VALARM');
  L.push('END:VEVENT', 'END:VCALENDAR');
  return L.map(fold75).join('\r\n') + '\r\n';
}
function googleUrl(p) {
  const ev = unpack(p), dates = ev.allDay ? ymd(ev.start) + '/' + ymd(ev.end) : utc(ev.start) + '/' + utc(ev.end);
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(ev.title) + '&dates=' + dates + (ev.loc ? '&location=' + encodeURIComponent(ev.loc) : '') + '&details=' + encodeURIComponent('Ajouté depuis Piaf');
}
function outlookUrl(p) {
  const ev = unpack(p), iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, '+00:00'), day = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const end = ev.allDay ? addDays(ev.end, -1) : ev.end;
  return 'https://outlook.live.com/calendar/0/deeplink/compose?path=' + encodeURIComponent('/calendar/action/compose') + '&rru=addevent&subject=' + encodeURIComponent(ev.title)
    + '&startdt=' + encodeURIComponent(ev.allDay ? day(ev.start) : iso(ev.start)) + '&enddt=' + encodeURIComponent(ev.allDay ? day(end) : iso(ev.end)) + '&allday=' + (ev.allDay ? 'true' : 'false')
    + (ev.loc ? '&location=' + encodeURIComponent(ev.loc) : '') + '&body=' + encodeURIComponent('Ajouté depuis Piaf');
}
const filename = (p) => (String(p.t || 'evenement').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'evenement') + '.ics';

// ------------------------------------------------------------------ réponse du moteur (partagée par Talk2Piaf et Talk2Piaf Cowork)
// Renvoie { text, hint, acts, topic, chips } ou null ; `hint` est la phrase qui accompagne les boutons (Cowork la montre à la seule personne qui appelle).
// Renvoie null si le message n'est pas une demande d'évènement.
// mem.cal garde 10 minutes le titre d'un évènement dont la date manque : « dentiste » puis « demain 14h » donnent un évènement complet.
const A = (l, a, p) => ({ l, a, p: p || {} });
const WAIT = 10 * 60 * 1000;
const HINT = 'Choisissez où l’enregistrer : l’évènement n’est ajouté qu’après votre validation dans votre calendrier.';
function reply(text, now, mem, o) {
  o = o || {}; mem = mem || {}; now = now instanceof Date && !isNaN(now) ? now : new Date();
  let r = parse(text, now);
  if (!r.ok && r.reason === 'intent' && mem.cal && Date.now() - mem.cal.at < WAIT && String(text).trim().split(/\s+/).length <= 8) {
    const r2 = parse('ajoute au calendrier ' + (mem.cal.title || '') + ' ' + text, now);
    if (r2.ok) r = r2;
  }
  if (r.ok) {
    mem.cal = null;
    const lines = ['📅 **' + r.title + '**', r.when + (r.loc ? ' · ' + r.loc : '')];
    if (r.past) lines.push('⚠️ Cette date est déjà passée : vérifiez-la avant d’enregistrer.');
    const p = pack(r);
    return { text: lines.join('\n'), hint: o.hint || HINT, topic: o.topic || 'cal_howto', acts: [A('Ajouter à mon calendrier (.ics)', 'cal_ics', p), A('Google Agenda', 'cal_google', p), A('Outlook', 'cal_outlook', p)] };
  }
  if (r.reason === 'date') {
    mem.cal = { title: r.title, at: Date.now() };
    return { text: (r.title ? 'Pour « ' + r.title + ' », ' : '') + 'quel jour' + (r.time ? '' : ' et à quelle heure') + ' ? Par exemple : « demain à 14h », « samedi 20h », « le 3 novembre ».', topic: o.topic || 'cal_howto', acts: [], chips: [] };
  }
  return null;
}

const api = { reply, parse, intent: (t) => intent(fold(t)), when, pack, unpack, toICS, googleUrl, outlookUrl, filename, fold };
if (typeof module === 'object' && module.exports) module.exports = api; else root.T2PCAL = api;
})(typeof window !== 'undefined' ? window : globalThis);
