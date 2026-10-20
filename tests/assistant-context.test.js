// Compréhension et contexte de Talk2Piaf (moteur unifié) : `node tests/assistant-context.test.js` (sans dépendance).
// Phrases courantes, politesses, abréviations, fautes de frappe, retouches du message précédent, mémoire = message précédent seulement.
const T = require('../assistant-kb.js');
const NOW = new Date('2026-10-19T14:00:00');
const ctx = (conv) => Object.assign({ name: 'Camille Durand', first: 'Camille', now: NOW, settings: {}, theme: 'auto',
  convs: [{ id: 'c1', name: 'Marie Dupont', group: false }, { id: 'c2', name: 'Marc Leroy', group: false }, { id: 'c3', name: 'Les Copains', group: true }] }, conv ? { conv } : {});
const grp = () => ({ id: 'c3', name: 'Les Copains', group: true, me: { id: 'u1', name: 'Camille', role: 'member' }, members: [{ id: 'u1', name: 'Camille Durand', role: 'member' }, { id: 'u2', name: 'Marie Dupont', role: 'member' }], polls: [], lists: [] });
let fail = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fail++; console.log('✗', m); } };
const seq = (lines, c) => { const mem = {}; return lines.map((q) => { const r = T.reply(q, c || ctx(), mem); return r; }); };
const act = (r, a) => r && (r.acts || []).find((x) => x.a === a);

// ---- phrases courantes → bonne action
const direct = [
  ['Bonjour, pourrais-tu s’il te plaît écrire à Marie que je suis en retard ?', 'send', (a) => a.p.id === 'c1' && a.p.t === 'Je suis en retard'],
  ['jaimerais envoyer un message a marie : on se voit demain ?', 'send', (a) => a.p.t === 'On se voit demain ?'],
  ['dis à Marie et Marc que la réunion est reportée', 'send', (a) => a.p.t === 'La réunion est reportée'],
  ['préviens Marc que j’arrive', 'send', (a) => a.p.id === 'c2'],
  ['peux-tu demander à Marie de m’appeler', 'send', (a) => /appeler/.test(a.p.t) && a.p.id === 'c1'],
  ['slt jpeu avoir un sondage pizza ou sushi stp', 'poll_create', (a) => a.p.opts.join() === 'Pizza,Sushi' && a.p.conv === null],
  ['peux tu me rappeler demain a 9h30 : dentiste', 'cal_ics', (a) => a.p.t === 'Dentiste' && a.p.s === '2026-10-20T09:30:00'],
  ['crée un rendez-vous demain 14h chez le dentiste dans le calendrier google', 'cal_google', (a) => /dentiste/i.test(a.p.t)],
  ['liste de courses : lait, pain', 'list_create', (a) => a.p.title === 'Courses' && a.p.items.join() === 'Lait,Pain'],
  ['mets en sombre', 'theme', (a) => a.p.m === 'dark' && a.auto === true],
  ['bloque marc svp', 'block', (a) => a.p.id === 'c2'],
  ['mets Marie en favori', 'fav', (a) => a.p.v === true && a.auto === true],
];
for (const [q, a, chk] of direct) { const r = T.reply(q, ctx(), {}); const x = act(r, a); ok(x && chk(x), `« ${q} » → ${a} (obtenu : ${r && r.topic} ${r && (r.acts || []).map((y) => y.a)})`); }
// questions d'usage malgré les fautes et les abréviations
for (const [q, t] of [['coment je creer un goupe ?', 'group_create'], ['jpeux savoir comment bloker qqun', 'block'], ['cmt ca marche les sondages', 'poll_create'], ['stp comment changer mon nom']]) { const r = T.reply(q, ctx(), {}); ok(r && !r.unknown && (!t || r.topic === T.topicId(t)), `« ${q} » compris (${r && r.topic})`); }
// ce que Talk2Piaf ne sait pas : il le dit, et propose de reformuler
let r = T.reply('hmm', ctx(), {}); ok(r.unknown && /reformuler/.test(r.text), 'incompris → demande de reformuler');
r = T.reply('mdr', ctx(), {}); ok(r, 'réponse à tout message');

// ---- contexte : le message précédent
let rs = seq(['écris à Marie : j’arrive', 'non, plutôt à Marc']); ok(act(rs[1], 'send') && act(rs[1], 'send').p.id === 'c2' && act(rs[1], 'send').p.t === 'J’arrive' && /modifié/.test(rs[1].text), 'message : changer de destinataire');
rs = seq(['écris à Marie : j’arrive', 'et à Marc']); ok(rs[1].acts.length === 2, 'message : « et à Marc » ajoute un destinataire');
rs = seq(['écris à Marie : j’arrive', 'plutôt : j’arrive à 18h']); ok(act(rs[1], 'send') && /18h/.test(act(rs[1], 'send').p.t) && act(rs[1], 'send').p.id === 'c1', 'message : changer le texte');
rs = seq(['crée un sondage : Jour ? lundi, mardi', 'plutôt anonyme', 'et choix multiples', 'ajoute mercredi', 'dans les copains'], ctx());
const pp = act(rs[4], 'poll_create').p; ok(pp.anon && pp.multi && pp.opts.join() === 'Lundi,Mardi,Mercredi' && pp.conv === 'c3', 'sondage : retouches successives ' + JSON.stringify(pp));
rs = seq(['crée un sondage : Jour ? lundi, mardi', 'enlève mardi']); ok(/deux options/.test(rs[1].text), 'sondage : retirer une option (il en faut au moins deux)');
rs = seq(['crée une liste de courses : lait, pain', 'ajoute oeufs', 'enlève pain', 'appelle-la Week-end']); const lp = act(rs[3], 'list_create').p; ok(/^Lait,(?:Œ|Oe)ufs$/.test(lp.items.join()) && /week/i.test(lp.title), 'liste : retouches ' + JSON.stringify(lp));
rs = seq(['rappelle-moi demain à 14h : dentiste', 'plutôt à 15h']); ok(act(rs[1], 'cal_ics').p.s === '2026-10-20T15:00:00' && act(rs[1], 'cal_ics').p.t === 'Dentiste', 'agenda : changer l’heure');
rs = seq(['mets en sombre', 'plutôt clair']); ok(act(rs[1], 'theme').p.m === 'light', 'thème : changer d’avis');
rs = seq(['ajoute au calendrier dentiste', 'demain 14h']); ok(act(rs[1], 'cal_ics') && act(rs[1], 'cal_ics').p.s === '2026-10-20T14:00:00', 'agenda : date demandée puis donnée');
// la mémoire ne garde que le message précédent
rs = seq(['crée un sondage : Jour ? lundi, mardi', 'bonjour', 'plutôt anonyme']); ok(!act(rs[2], 'poll_create'), 'mémoire : après un autre message, plus de brouillon');
rs = seq(['crée un sondage : Jour ? lundi, mardi', 'plutôt anonyme', 'bonjour', 'et choix multiples']); ok(!act(rs[3], 'poll_create'), 'mémoire : un message sans lien efface le contexte');
// une vraie nouvelle demande n'est pas une retouche
rs = seq(['crée un sondage : Jour ? lundi, mardi', 'crée un sondage anonyme : Où ? Paris, Lyon']); ok(act(rs[1], 'poll_create').p.q === 'Où ?' && !/modifié/.test(rs[1].text), 'nouvelle demande : pas confondue avec une retouche');
const mem = {}; T.reply('écris à Marie : salut', ctx(), mem); ok(mem.draft && mem.draft.a === 'send', 'mem.draft : message précédent'); T.reply('bonjour', ctx(), mem); ok(!mem.draft, 'mem.draft : vidé au message suivant');

// ---- sondages / listes dans une discussion : la discussion ouverte est la destination
r = T.reply('crée un sondage : Pizza ou sushi ?', ctx(grp()), {}); ok(act(r, 'poll_create').p.conv === 'c3', 'discussion ouverte = destination');
r = T.reply('fais un sondage dans la discussion avec Marie : Quel film ? Dune, Alien', ctx(grp()), {}); ok(act(r, 'poll_create').p.conv === 'c1' && act(r, 'poll_create').p.q === 'Quel film ?', 'destination nommée');
// une demande d'action n'est jamais exécutée par le moteur : seules les actions réversibles sont marquées « auto »
for (const q of ['écris à Marie : salut', 'bloque Marc', 'crée un sondage : A ? x, y', 'crée une liste : a, b']) { const x = (T.reply(q, ctx(), {}).acts || [])[0]; ok(x && !x.auto, `« ${q} » : pas d’exécution automatique`); }
for (const q of ['mets en sombre', 'mets Marie en favori', 'archive Marc', 'mets Marie en silence']) { const x = (T.reply(q, ctx(), {}).acts || [])[0]; ok(x && x.auto === true, `« ${q} » : réversible → direct`); }
// jamais de HTML dans les réponses ; mot interdit absent
const banned = new RegExp('simul' + '[ée]', 'i');
for (const [q] of direct) { const t = T.reply(q, ctx(), {}).text; ok(!/<[a-z]/i.test(t) && !banned.test(t), 'texte propre : ' + q); }

console.log(`${n} contrôles, ${fail} échec(s)`);
process.exit(fail ? 1 : 0);
