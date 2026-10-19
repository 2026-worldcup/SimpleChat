// Tests du module calendrier : `node tests/assistant-calendar.test.js` (sans dépendance).
const C = require('../assistant-calendar.js');
const NOW = new Date(2026, 9, 18, 18, 58); // dimanche 18 octobre 2026, 18 h 58 (heure locale)
let fail = 0, n = 0;
const ok = (cond, msg) => { n++; if (!cond) { fail++; console.log('✗', msg); } };
const D = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h || 0, mi || 0).getTime();
// exp(texte, titre, début, fin, options)
function exp(q, title, start, end, extra) {
  const r = C.parse(q, NOW);
  const good = r.ok && r.title === title && r.start.getTime() === start && r.end.getTime() === end && (!extra || Object.keys(extra).every((k) => r[k] === extra[k]));
  n++; if (!good) { fail++; console.log('✗', JSON.stringify(q), '→', r.ok ? `${r.title} | ${r.start} | ${r.end} | allDay=${r.allDay} loc=${r.loc}` : JSON.stringify(r), '| attendu', title, new Date(start), new Date(end)); }
  return r;
}
const H = 3600000;

// ---------------------------------------------------------------- dates relatives et jours
exp('Ajoute au calendrier : dentiste demain à 14h', 'Dentiste', D(2026, 10, 19, 14), D(2026, 10, 19, 15));
exp('mets un rdv dentiste demain 14h30 dans mon agenda', 'Rdv dentiste', D(2026, 10, 19, 14, 30), D(2026, 10, 19, 15, 30));
exp('ajoute à mon agenda réunion jeudi de 10h à 11h30', 'Réunion', D(2026, 10, 22, 10), D(2026, 10, 22, 11, 30));
exp('rappelle-moi d’appeler Marie après-demain à 9h', 'Appeler Marie', D(2026, 10, 20, 9), D(2026, 10, 20, 10));
exp('Peux-tu ajouter au calendrier le dîner chez Marie samedi 20h ?', 'Dîner chez Marie', D(2026, 10, 24, 20), D(2026, 10, 24, 21));
exp('ajoute au calendrier anniversaire de Léa le 3 novembre', 'Anniversaire de Léa', D(2026, 11, 3), D(2026, 11, 4), { allDay: true });
exp('ajoute au calendrier concert le 12/12/2026 à 20h30 pendant 2 heures', 'Concert', D(2026, 12, 12, 20, 30), D(2026, 12, 12, 22, 30));
exp('mets dans l’agenda la visite le 25 octobre à 9h', 'Visite', D(2026, 10, 25, 9), D(2026, 10, 25, 10));
exp('ajoute au calendrier vacances du 2 janvier', 'Vacances', D(2027, 1, 2), D(2027, 1, 3), { allDay: true });      // date passée dans l'année → l'année suivante
exp('ajoute au calendrier match demain soir', 'Match', D(2026, 10, 19, 20), D(2026, 10, 19, 21));
exp('ajoute au calendrier yoga lundi matin', 'Yoga', D(2026, 10, 19, 9), D(2026, 10, 19, 10));
exp('ajoute au calendrier courses dimanche prochain à 10h', 'Courses', D(2026, 10, 25, 10), D(2026, 10, 25, 11));  // aujourd'hui est dimanche : « prochain » = dans 7 jours
exp('ajoute au calendrier dîner vendredi à 8h du soir', 'Dîner', D(2026, 10, 23, 20), D(2026, 10, 23, 21));
exp('ajoute au calendrier déjeuner mardi à midi', 'Déjeuner', D(2026, 10, 20, 12), D(2026, 10, 20, 13));
exp('ajoute au calendrier point équipe dans 3 jours à 11h', 'Point équipe', D(2026, 10, 21, 11), D(2026, 10, 21, 12));
exp('ajoute au calendrier visite chez le médecin mardi mercredi', 'Visite chez le médecin mercredi', D(2026, 10, 20), D(2026, 10, 21), { allDay: true }); // une seule date retenue : la première
exp('rdv coiffeur jeudi 17h', 'Rdv coiffeur', D(2026, 10, 22, 17), D(2026, 10, 22, 18));          // commence par « rdv » : pas besoin de verbe
exp('ajoute au calendrier le 1er décembre : fête', 'Fête', D(2026, 12, 1), D(2026, 12, 2), { allDay: true });
exp('ajoute au calendrier appel dans 2 heures', 'Appel', D(2026, 10, 18, 21, 0), D(2026, 10, 18, 22, 0)); // 18 h 58 + 2 h = 20 h 58 → arrondi à 21 h 00
exp('ajoute au calendrier atelier lundi à 14h pendant 45 minutes', 'Atelier', D(2026, 10, 19, 14), D(2026, 10, 19, 14, 45));
exp('ajoute au calendrier séminaire demain de 9h à 17h', 'Séminaire', D(2026, 10, 19, 9), D(2026, 10, 19, 17));
exp('ajoute au calendrier théâtre samedi 21:15', 'Théâtre', D(2026, 10, 24, 21, 15), D(2026, 10, 24, 22, 15));

// ---------------------------------------------------------------- lieu
let r = exp('ajoute au calendrier réunion à Lyon jeudi 10h', 'Réunion à Lyon', D(2026, 10, 22, 10), D(2026, 10, 22, 11)); ok(r.loc === 'Lyon', 'lieu : Lyon');
r = exp('ajoute au calendrier déjeuner demain 12h30 lieu : Café de Flore', 'Déjeuner', D(2026, 10, 19, 12, 30), D(2026, 10, 19, 13, 30)); ok(r.loc === 'Café de Flore', 'lieu explicite');
r = exp('ajoute au calendrier dîner chez Marie samedi 20h', 'Dîner chez Marie', D(2026, 10, 24, 20), D(2026, 10, 24, 21)); ok(r.loc === '', 'pas de lieu inventé');

// ---------------------------------------------------------------- libellé
ok(C.parse('ajoute au calendrier dentiste demain à 14h', NOW).when === 'lundi 19 octobre, de 14h00 à 15h00', 'libellé : ' + C.parse('ajoute au calendrier dentiste demain à 14h', NOW).when);
ok(C.parse('ajoute au calendrier anniversaire le 3 novembre', NOW).when === 'mardi 3 novembre (toute la journée)', 'libellé journée entière');
ok(C.parse('ajoute au calendrier vacances le 1er décembre', NOW).when === 'mardi 1er décembre (toute la journée)', 'libellé 1er');
ok(/ 2027/.test(C.parse('ajoute au calendrier vacances du 2 janvier', NOW).when), 'année affichée si elle change');

// ---------------------------------------------------------------- pas de date / pas d'intention
r = C.parse('ajoute au calendrier dentiste à 14h', NOW); ok(!r.ok && r.reason === 'date' && r.title === 'Dentiste' && r.time && r.time.h === 14, 'heure sans jour → demander le jour : ' + JSON.stringify(r));
r = C.parse('ajoute au calendrier dentiste', NOW); ok(!r.ok && r.reason === 'date' && r.title === 'Dentiste', 'ni jour ni heure → demander');
r = C.parse('quel temps fait-il demain', NOW); ok(!r.ok && r.reason === 'intent', 'une question météo n’est pas un évènement');
r = C.parse('combien de personnes dans un groupe ?', NOW); ok(!r.ok && r.reason === 'intent', 'question sans rapport');
r = C.parse('demain', NOW); ok(!r.ok, 'une date seule n’est pas un évènement (c’est au moteur de faire le lien avec la demande en cours)');
r = C.parse('ajoute au calendrier 31/02', NOW); ok(!r.ok && r.reason === 'date', 'date impossible refusée : ' + JSON.stringify(r));
r = C.parse('ajoute au calendrier réunion demain à 25h', NOW); ok(!r.ok, 'heure impossible refusée');
r = C.parse('', NOW); ok(!r.ok, 'texte vide');

// ---------------------------------------------------------------- fichier .ics
const p = C.pack(C.parse('ajoute au calendrier réunion à Lyon, salle 4 ; équipe jeudi de 10h à 11h30', NOW));
const ics = C.toICS(p, { uid: 'test@piaf', now: new Date(Date.UTC(2026, 9, 18, 16, 58, 0)), alarmMin: 30 });
ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'), 'ICS : enveloppe');
ok(/UID:test@piaf\r\n/.test(ics) && /DTSTAMP:20261018T165800Z\r\n/.test(ics), 'ICS : UID et DTSTAMP');
ok(new RegExp('DTSTART:' + new Date(2026, 9, 22, 10).toISOString().replace(/[-:]|\.\d{3}/g, '') + '\r\n').test(ics), 'ICS : début en heure universelle');
ok(/SUMMARY:Réunion à Lyon\\, salle 4 \\; équipe\r\n/.test(ics) || /SUMMARY:.*\\,.*\\;/.test(ics), 'ICS : virgules et points-virgules échappés : ' + (ics.match(/SUMMARY:.*/) || [])[0]);
ok(/BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:.*\r\nTRIGGER:-PT30M\r\nEND:VALARM/.test(ics), 'ICS : rappel');
ok(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75), 'ICS : lignes de 75 octets au plus');
ok(!/[^\r]\n/.test(ics), 'ICS : fins de ligne CRLF uniquement');
const long = C.toICS({ t: 'é'.repeat(80), s: '2026-10-20T14:00:00', e: '2026-10-20T15:00:00', ad: false, loc: '' }, { uid: 'x@piaf' });
ok(long.split('\r\n').every((l) => Buffer.byteLength(l) <= 75) && /SUMMARY:é+\r\n é+/.test(long), 'ICS : pliage des longues lignes sans couper un caractère');
ok(long.replace(/\r\n /g, '').match(/SUMMARY:(.*)\r\n/)[1] === 'é'.repeat(80), 'ICS : le pliage est réversible');
const day = C.toICS(C.pack(C.parse('ajoute au calendrier anniversaire le 3 novembre', NOW)), { uid: 'd@piaf' });
ok(/DTSTART;VALUE=DATE:20261103\r\nDTEND;VALUE=DATE:20261104\r\n/.test(day), 'ICS : journée entière (fin exclusive)');
ok(!/VALARM/.test(day), 'ICS : pas de rappel sur une journée entière');
ok(C.filename({ t: 'Dîner chez Marie !' }) === 'Diner-chez-Marie.ics', 'nom de fichier : ' + C.filename({ t: 'Dîner chez Marie !' }));

// ---------------------------------------------------------------- liens
const g = C.googleUrl(C.pack(C.parse('ajoute au calendrier dentiste demain à 14h', NOW)));
const startZ = new Date(2026, 9, 19, 14).toISOString().replace(/[-:]|\.\d{3}/g, ''), endZ = new Date(2026, 9, 19, 15).toISOString().replace(/[-:]|\.\d{3}/g, '');
ok(g.startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE&text=Dentiste&dates=' + startZ + '/' + endZ), 'lien Google : ' + g);
const gd = C.googleUrl(C.pack(C.parse('ajoute au calendrier anniversaire le 3 novembre', NOW))); ok(/dates=20261103\/20261104/.test(gd), 'lien Google : journée entière');
const o = C.outlookUrl(C.pack(C.parse('ajoute au calendrier dentiste demain à 14h', NOW)));
ok(o.startsWith('https://outlook.live.com/calendar/0/deeplink/compose?') && /subject=Dentiste/.test(o) && /allday=false/.test(o) && /startdt=2026-10-19T/.test(decodeURIComponent(o)), 'lien Outlook : ' + o);
const od = C.outlookUrl(C.pack(C.parse('ajoute au calendrier anniversaire le 3 novembre', NOW))); ok(/startdt=2026-11-03&enddt=2026-11-03&allday=true/.test(od), 'lien Outlook : journée entière');
ok(/%C3%A9|%C3%AE/.test(C.googleUrl({ t: 'Dîner', s: '2026-10-20T14:00:00', e: '2026-10-20T15:00:00' })), 'liens : accents encodés');
// aucun lien ni fichier ne doit pouvoir sortir du titre : on n'injecte rien d'autre que des paramètres encodés
const evil = C.googleUrl({ t: 'x&dates=1/2&text=pwn', s: '2026-10-20T14:00:00', e: '2026-10-20T15:00:00' });
const eu = new URL(evil).searchParams; ok(eu.get('text') === 'x&dates=1/2&text=pwn' && /^\d{8}T\d{6}Z\/\d{8}T\d{6}Z$/.test(eu.get('dates')), 'lien : titre malveillant encodé, dates intactes');
const evilIcs = C.toICS({ t: 'x\r\nBEGIN:VEVENT\r\nSUMMARY:pwn', s: '2026-10-20T14:00:00', e: '2026-10-20T15:00:00', ad: false, loc: 'a\r\nb' }, { uid: 'e@piaf' });
ok(evilIcs.split('\r\n').filter((l) => /^(BEGIN:VEVENT|SUMMARY:|LOCATION:)/.test(l)).length === 3, 'ICS : saut de ligne dans le titre neutralisé');

// ---------------------------------------------------------------- réponse du moteur (suite de conversation)
const mem = {};
let rr = C.reply('ajoute au calendrier dentiste', NOW, mem);
ok(rr && /quel jour et à quelle heure/.test(rr.text) && rr.acts.length === 0 && mem.cal && mem.cal.title === 'Dentiste', 'réponse : demande le jour et l’heure');
rr = C.reply('demain à 14h', NOW, mem);
ok(rr && rr.acts.length === 3 && rr.acts[0].a === 'cal_ics' && rr.acts[0].p.t === 'Dentiste' && rr.acts[0].p.s === '2026-10-19T14:00:00' && !mem.cal, 'réponse : la suite complète l’évènement : ' + JSON.stringify(rr && rr.acts[0]));
ok(C.reply('demain à 14h', NOW, {}) === null, 'réponse : une date seule, sans demande en cours, n’est pas un évènement');
ok(C.reply('rappelle-moi mon identifiant', NOW, {}) === null, 'réponse : « rappelle-moi mon identifiant » n’est pas un évènement');
ok(C.reply('comment créer un groupe ?', NOW, { cal: { title: 'X', at: Date.now() } }) === null, 'réponse : une question sans date n’est pas prise pour la suite');
const stale = { cal: { title: 'Vieux', at: Date.now() - 11 * 60 * 1000 } }; ok(C.reply('demain 14h', NOW, stale) === null, 'réponse : la demande en cours expire au bout de 10 minutes');
rr = C.reply('ajoute au calendrier dentiste le 3 janvier', NOW, {}); ok(rr && rr.acts.length === 3 && !/déjà passée/.test(rr.text), 'réponse : date de l’an prochain, pas d’alerte');
rr = C.reply('ajoute au calendrier dentiste aujourd’hui à 8h', NOW, {}); ok(rr && /déjà passée/.test(rr.text), 'réponse : avertit quand l’heure est déjà passée');
ok(C.reply('', NOW, {}) === null && C.reply('bonjour', NOW, {}) === null, 'réponse : texte vide ou salutation');

console.log(`${n} contrôles, ${fail} échec(s)`);
process.exit(fail ? 1 : 0);
