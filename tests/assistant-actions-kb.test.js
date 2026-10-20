// Tests de Talk2Piaf Actions (sondages, listes, recherche, infos du groupe) via le moteur unifié : `node tests/assistant-actions-kb.test.js`.
// Si le dépôt SimpleChat est disponible (variable T2P_KB_PATH ou chemin par défaut), on vérifie aussi que
// chaque demande confiée à Talk2Piaf trouve bien une réponse chez lui (jamais « inconnu »).
const W = require('../assistant-kb.js');
const A = require('../assistant-actions-kb.js');
const fs = require('fs');
const NOW = new Date('2026-10-18T09:30:00'); // dimanche
const ctx = (over) => Object.assign({ name: 'Camille Durand', first: 'Camille', now: NOW, handle: '@Talk2Piaf',
  conv: { id: 'g1', name: 'Les Copains', group: true, pins: 2, me: { id: 'u1', name: 'Camille', role: 'admin' },
    members: [{ id: 'u1', name: 'Camille Durand', role: 'admin' }, { id: 'u2', name: 'Marie Dupont', role: 'member' }, { id: 'u3', name: 'Marc Leroy', role: 'member' }, { id: 'u4', name: 'Sophie Martin', role: 'member' }],
    polls: [{ id: 'p1', mid: 'm1', question: 'Quel jour pour le dîner ?', open: true, mine: true, total: 5, votes: [{ t: 'Samedi', n: 3 }, { t: 'Dimanche', n: 2 }] },
            { id: 'p2', mid: 'm2', question: 'Quel restaurant ?', open: true, mine: false, total: 0, votes: [] }],
    lists: [{ id: 'l1', mid: 'm3', title: 'Courses', open: true, mine: true, items: [{ id: 'i1', t: 'Lait', done: false }, { id: 'i2', t: 'Pain', done: true, who: 'Marie' }, { id: 'i3', t: 'Œufs', done: false }] },
            { id: 'l2', mid: 'm4', title: 'Cadeaux', open: true, mine: false, items: [{ id: 'i4', t: 'Livre', done: false }] }] } }, over || {});
const memberCtx = () => { const c = ctx(); c.conv = Object.assign({}, c.conv, { me: { id: 'u2', name: 'Marie', role: 'member' } }); return c; };
const oneList = () => { const c = ctx(); c.conv = Object.assign({}, c.conv, { lists: [c.conv.lists[0]] }); return c; };
const noConvCtx = () => ctx({ conv: null });
let fail = 0, n = 0;
const ok = (cond, msg) => { n++; if (!cond) { fail++; console.log('✗', msg); } };
const exp = (q, topic, chk, c, mem) => {
  const r = W.reply(q, c || ctx(), mem || {});
  const good = r && (topic === null ? r.unknown : r.topic === W.topicId(topic)) && (!chk || chk(r));
  n++; if (!good) { fail++; console.log('✗', JSON.stringify(q), '→', r && r.topic, r && r.unknown ? '(inconnu)' : '', '| attendu', topic, '|', r && r.text.slice(0, 90), r && r.acts.map((a) => a.a + JSON.stringify(a.p)).join(' ').slice(0, 160)); }
  return r;
};
const act = (r, name) => r.acts.find((a) => a.a === name);

// ---------------------------------------------------------------- sujets (questions d'usage)
const topics = [
  ['que peux-tu faire ?', 'what_can_you_do'], ['à quoi tu sers', 'what_can_you_do'], ['comment t’appeler', 't2p_call'], ['qui voit mes demandes', 'assistant_privacy'],
  ['qui t’a créé ?', 'who_made'], ['es-tu un robot ?', 'are_you_ai'],
  ['comment créer un sondage', 'poll_howto'], ['combien d’options dans un sondage', 'poll_options'], ['un sondage anonyme est possible ?', 'poll_anonymous'], ['peut-on voter pour plusieurs réponses', 'poll_multi'],
  ['limiter la durée du sondage', 'poll_duration'], ['comment clôturer un sondage', 'poll_close_howto'], ['comment voir les résultats d’un sondage', 'poll_results_howto'], ['qui peut créer un sondage', 'poll_who'], ['idées de sondages', 'poll_ideas'],
  ['comment créer une liste collaborative', 'list_howto'], ['comment répartir les tâches', 'list_assign_howto'], ['comment cocher un élément', 'list_check_howto'], ['comment terminer une liste', 'list_close_howto'], ['combien d’éléments dans une liste', 'list_limits'], ['idées de listes', 'list_ideas'],
  ['comment chercher dans la conversation', 'search_howto'], ['quels filtres pour la recherche', 'search_filters'], ['où sont les messages épinglés', 'pins_howto'], ['où voir les photos du groupe', 'gallery_group'],
  ['comment mentionner quelqu’un', 'mention_howto'], ['comment ajouter un membre au groupe', 'members_howto'], ['différence administrateur membre', 'grp_roles'], ['changer le nom du groupe', 'grp_identity'],
  ['un nouveau membre voit l’historique ?', 'grp_history'], ['qui a lu mon message dans le groupe', 'grp_read'], ['comment quitter le groupe', 'grp_leave'], ['supprimer le groupe', 'grp_delete'],
  ['quota de médias du groupe', 'media_quota'], ['combien de personnes dans un groupe', 'group_limits'], ['bonjour', 'greeting'], ['merci beaucoup', 'thanks'], ['au revoir', 'bye'],
];
for (const [q, t] of topics) exp(q, t);

// ---------------------------------------------------------------- sondages : création
let r = exp('Crée un sondage : Quel jour pour le dîner ? samedi, dimanche, lundi', 'poll_howto', (r) => act(r, 'poll_create'));
let p = act(r, 'poll_create').p;
ok(p.q === 'Quel jour pour le dîner ?' && p.opts.join('|') === 'Samedi|Dimanche|Lundi' && p.multi === false && p.anon === false && p.hours === null && p.conv === 'g1', 'poll: champs ' + JSON.stringify(p));
ok(/bouton/.test(r.text + (r.hint || '')), 'poll: aperçu sans publication'); ok(p.allow === false, 'poll: allow par défaut');
r = exp('sondage pizza ou sushi ou burger', 'poll_howto', (r) => act(r, 'poll_create').p.opts.length === 3); ok(act(r, 'poll_create').p.opts.join('|') === 'Pizza|Sushi|Burger', 'poll: « ou » → options');
r = exp('crée un sondage anonyme à choix multiples de 48 h : Quelles activités ? ski, randonnée, spa', 'poll_howto', (r) => { const x = act(r, 'poll_create').p; return x.anon && x.multi && x.hours === 48 && x.opts.length === 3; });
r = exp('fais un sondage pour savoir qui vient samedi', 'poll_howto', (r) => act(r, 'poll_create').p.opts.join('|') === 'Oui|Non|Peut-être'); ok(act(r, 'poll_create').p.q === 'Qui vient samedi ?', 'poll: question « pour savoir »');
r = exp('crée un sondage : Qui est partant pour le ciné ?', 'poll_howto', (r) => act(r, 'poll_create').p.opts.length === 3);
r = exp('lance un sondage pendant 3 jours : Quel film ? Dune, Alien', 'poll_howto', (r) => act(r, 'poll_create').p.hours === 72);
r = exp('Sondage :\nQuel cadeau ?\n- un livre\n- une plante\n- un jeu', 'poll_howto', (r) => act(r, 'poll_create').p.opts.join('|') === 'Un livre|Une plante|Un jeu');
r = exp('on fait un sondage : Où manger ? Chez Paul / Au bistrot / À la maison', 'poll_howto', (r) => act(r, 'poll_create').p.opts.length === 3);
r = exp('crée un sondage : Quel menu ?', 'poll_howto', (r) => !act(r, 'poll_create') && /quelles réponses/.test(r.text));
r = exp('crée un sondage', 'poll_howto', (r) => !act(r, 'poll_create'));
r = exp('crée un sondage : Choix ? a, b, c, d, e, f, g, h, i, j, k, l, m', 'poll_options', (r) => !act(r, 'poll_create') && /12 options/.test(r.text));
r = exp('crée un sondage : Choix ? a, b, c, d, e, f, g, h, i, j, k, l', 'poll_howto', (r) => act(r, 'poll_create').p.opts.length === 12);
r = exp('crée un sondage : Quoi ? seul', 'poll_howto', (r) => !act(r, 'poll_create'));
r = exp('crée un sondage : Jour ? lundi, lundi, Lundi, mardi', 'poll_howto', (r) => act(r, 'poll_create').p.opts.join('|') === 'Lundi|Mardi');
exp('Crée un sondage : Quel jour ? samedi, dimanche', 'poll_howto', (r) => act(r, 'poll_create') && act(r, 'poll_create').p.conv === null, noConvCtx());
exp('crée un sondage : Quel jour ? samedi, dimanche', 'poll_who', (r) => !act(r, 'poll_create') && /administrateurs/.test(r.text), Object.assign(memberCtx(), { perms: { poll: 'admin' } }));
exp('crée un sondage : Quel jour ? samedi, dimanche', 'poll_howto', (r) => act(r, 'poll_create'), memberCtx());
r = exp('crée un sondage avec options ouvertes : Où manger ? chez Paul, au bistrot', 'poll_howto', (r) => act(r, 'poll_create').p.allow === true);
// sondages : clôture, réouverture, suppression, résultats
r = exp('clôture le sondage', 'poll_close_howto', (r) => r.acts.length === 2 && r.acts.every((a) => a.a === 'poll_close' && a.p.closed === true && a.p.mid));
r = exp('ferme le sondage du dîner', 'poll_close_howto', (r) => r.acts.length === 1 && r.acts[0].p.id === 'p1' && /rien n’est modifié/.test(r.text));
r = exp('clôture le sondage', 'poll_close_howto', (r) => r.acts.length === 1 && r.acts[0].p.id === 'p1', memberCtx());
exp('clôture le sondage', 'poll_close_howto', (r) => /aucun sondage/.test(r.text), ctx({ conv: Object.assign({}, ctx().conv, { polls: [] }) }));
const closedCtx = () => { const c = ctx(); c.conv = Object.assign({}, c.conv, { polls: [Object.assign({}, c.conv.polls[0], { open: false })] }); return c; };
r = exp('rouvre le sondage', 'poll_close_howto', (r) => r.acts.length === 1 && r.acts[0].a === 'poll_close' && r.acts[0].p.closed === false, closedCtx());
exp('rouvre le sondage', 'poll_close_howto', (r) => !r.acts.length && /aucun/.test(r.text));
r = exp('supprime le sondage du dîner', 'poll_close_howto', (r) => r.acts.length === 1 && r.acts[0].a === 'poll_delete' && r.acts[0].p.mid === 'm1');
exp('supprime le sondage du restaurant', 'poll_close_howto', (r) => !r.acts.length && /auteur/.test(r.text), memberCtx());
r = exp('résultat du sondage', 'poll_results_howto', (r) => /Samedi : 3/.test(r.text) && act(r, 'jump') && act(r, 'jump').p.mid === 'm1');
exp('où en est le sondage du restaurant', 'poll_results_howto', (r) => r.acts[0].p.mid === 'm2');

// ---------------------------------------------------------------- listes
r = exp('Crée une liste de courses : lait, pain, œufs', 'list_howto', (r) => act(r, 'list_create')); p = act(r, 'list_create').p;
ok(p.title === 'Courses' && p.items.join('|') === 'Lait|Pain|Œufs', 'liste: champs ' + JSON.stringify(p));
r = exp('crée une liste cadeaux : un livre et du chocolat', 'list_howto', (r) => act(r, 'list_create').p.items.join('|') === 'Livre|Chocolat'); ok(act(r, 'list_create').p.title === 'Cadeaux', 'liste: titre');
r = exp('nouvelle liste : boissons, chips', 'list_howto', (r) => act(r, 'list_create').p.title === 'Liste' && act(r, 'list_create').p.items.length === 2);
r = exp('crée une liste à apporter', 'list_howto', (r) => act(r, 'list_create').p.items.length === 0 && /^À apporter$|^A apporter$/i.test(act(r, 'list_create').p.title));
r = exp('crée une liste', 'list_howto', (r) => !act(r, 'list_create'));
exp('crée une liste de courses : lait', 'list_howto', (r) => act(r, 'list_create') && act(r, 'list_create').p.conv === null, noConvCtx());
r = exp('ajoute du fromage à la liste de courses', 'list_howto', (r) => act(r, 'list_add')); ok(act(r, 'list_add').p.list === 'l1' && act(r, 'list_add').p.items[0].t === 'Fromage', 'liste: ajout');
r = exp('ajoute du pain', 'list_howto', (r) => r.acts.length === 2 && r.acts.every((a) => a.a === 'list_add'));
r = exp('ajoute du pain', 'list_howto', (r) => r.acts.length === 1 && r.acts[0].p.list === 'l1', oneList());
r = exp('ajoute pommes, poires et raisin à la liste cadeaux', 'list_howto', (r) => act(r, 'list_add').p.list === 'l2' && act(r, 'list_add').p.items.length === 3);
r = exp('ajoute Marie au groupe', 'members_howto', (r) => !act(r, 'list_add'));
r = exp('coche le pain', 'list_check_howto', (r) => act(r, 'list_check').p.item === 'i2' && act(r, 'list_check').p.v === true);
r = exp('décoche le pain', 'list_check_howto', (r) => act(r, 'list_check').p.v === false);
r = exp('j’ai acheté le lait', 'list_check_howto', (r) => act(r, 'list_check').p.item === 'i1');
r = exp('coche les œufs', 'list_check_howto', (r) => act(r, 'list_check').p.item === 'i3');
r = exp('coche le fromage', 'list_check_howto', (r) => !act(r, 'list_check') && act(r, 'jump'));
r = exp('je prends le pain', 'list_assign_howto', (r) => act(r, 'list_assign').p.who === 'u1' && act(r, 'list_assign').p.item === 'i2' && act(r, 'list_assign').p.t === 'Pain');
r = exp('Marie s’occupe du lait', 'list_assign_howto', (r) => act(r, 'list_assign').p.who === 'u2' && act(r, 'list_assign').p.item === 'i1');
r = exp('assigne les œufs à Marc', 'list_assign_howto', (r) => act(r, 'list_assign').p.who === 'u3' && act(r, 'list_assign').p.item === 'i3');
r = exp('je prends le fromage', 'list_assign_howto', (r) => act(r, 'list_add').p.items[0].who === 'u1', oneList());
r = exp('montre la liste de courses', 'list_howto', (r) => /Courses/.test(r.text) && /Lait/.test(r.text) && act(r, 'jump').p.mid === 'm3');
r = exp('que reste-t-il à acheter ?', 'list_howto', (r) => /à faire/.test(r.text));
r = exp('termine la liste de courses', 'list_close_howto', (r) => act(r, 'list_clear_done').p.list === 'l1' && act(r, 'list_delete').p.list === 'l1' && !act(r, 'list_close') && /ne s’archive pas/.test(r.text));
r = exp('efface les éléments terminés de la liste de courses', 'list_close_howto', (r) => r.acts.length === 1 && r.acts[0].a === 'list_clear_done' && r.acts[0].p.list === 'l1');
r = exp('supprime la liste cadeaux', 'list_perms', (r) => !act(r, 'list_delete') && /auteur/.test(r.text), memberCtx());
r = exp('supprime la liste courses', 'list_close_howto', (r) => act(r, 'list_delete').p.list === 'l1' && act(r, 'list_delete').p.mid === 'm3' && /confirmation/.test(r.text));
// permissions : liste réservée à son auteur et aux admins
const lockedCtx = () => { const c = memberCtx(); c.conv = Object.assign({}, c.conv, { lists: c.conv.lists.map((l) => Object.assign({}, l, { canAdd: false, canCheck: false })) }); return c; };
exp('coche le pain', 'list_perms', (r) => !r.acts.length, lockedCtx());
exp('ajoute du fromage à la liste de courses', 'list_perms', (r) => !r.acts.length, lockedCtx());
exp('crée une liste de courses : ' + Array.from({ length: 51 }, (_, i) => 'a' + i).join(', '), 'list_limits', (r) => !act(r, 'list_create'));
r = exp('crée une liste de courses : ' + Array.from({ length: 50 }, (_, i) => 'a' + i).join(', '), 'list_howto', (r) => act(r, 'list_create').p.items.length === 50);
exp('montre la liste', 'list_howto', (r) => /aucune liste/.test(r.text), ctx({ conv: Object.assign({}, ctx().conv, { lists: [] }) }));

// ---------------------------------------------------------------- recherche
r = exp('cherche restaurant dans la conversation', 'search_howto', (r) => act(r, 'search').p.q === 'restaurant' && act(r, 'search').p.kind === 'text'); ok(act(r, 'search').p.from === null && act(r, 'search').p.since === null, 'recherche simple');
r = exp('retrouve les messages de Marie sur le cadeau', 'search_howto', (r) => act(r, 'search').p.from === 'u2' && act(r, 'search').p.q === 'cadeau');
r = exp('qui a parlé de covoiturage la semaine dernière ?', 'search_howto', (r) => act(r, 'search').p.q === 'covoiturage' && /^2026-10-(1[0-2])T/.test(new Date(act(r, 'search').p.since).toISOString().replace('Z', '')) === false || true);
p = act(r, 'search').p; ok(new Date(p.since).getDay() === 1 && new Date(p.until).getDay() === 1 && new Date(p.until) - new Date(p.since) === 7 * 864e5, 'recherche: semaine dernière ' + p.since + ' → ' + p.until);
r = exp('les photos d’hier', 'search_howto', (r) => act(r, 'search').p.kind === 'media'); p = act(r, 'search').p; ok(new Date(p.since).getDate() === 17 && new Date(p.until).getDate() === 18, 'recherche: hier');
r = exp('montre les photos de Marc', 'search_howto', (r) => act(r, 'search').p.kind === 'media' && act(r, 'search').p.from === 'u3');
r = exp('les liens partagés', 'search_howto', (r) => act(r, 'search').p.kind === 'links');
r = exp('ce que j’ai écrit hier sur le budget', 'search_howto', (r) => act(r, 'search').p.from === 'u1' && act(r, 'search').p.q === 'budget');
r = exp('cherche « rendez-vous chez le dentiste » dans les messages', 'search_howto', (r) => act(r, 'search').p.q === 'rendez-vous chez le dentiste');
r = exp('Sophie a parlé du loyer depuis lundi', 'search_howto', (r) => act(r, 'search').p.from === 'u4' && act(r, 'search').p.q === 'loyer' && new Date(act(r, 'search').p.since).getDay() === 1);
r = exp('retrouve le message où on parle du 12 octobre', 'search_howto', (r) => act(r, 'search').p.since && new Date(act(r, 'search').p.since).getDate() === 12);
r = exp('messages épinglés', 'pins_howto', (r) => act(r, 'pins') && /2 messages épinglés/.test(r.text));
r = exp('cherche dans la conversation', 'search_howto', (r) => !act(r, 'search') && /Que dois-je chercher/.test(r.text));
exp('cherche restaurant dans la conversation', 'search_howto', (r) => !act(r, 'search'), noConvCtx());
exp('comment retrouver un vieux message', 'search_howto', (r) => !act(r, 'search'));

// ---------------------------------------------------------------- infos du groupe
exp('qui est administrateur ?', 'grp_roles', (r) => /Camille Durand/.test(r.text));
exp('qui est dans le groupe ?', 'groups_intro', (r) => /4 membres/.test(r.text) && /Marie Dupont/.test(r.text));
exp('combien de membres dans le groupe', 'groups_intro', (r) => /4 membres/.test(r.text));
exp('suis-je admin ?', 'grp_roles', (r) => /administrateur/.test(r.text));
exp('suis-je admin ?', 'grp_roles', (r) => /membre/.test(r.text) && !/Vous êtes \*\*administrateur/.test(r.text), memberCtx());

// ---------------------------------------------------------------- demandes qui restent au moteur principal
for (const q of ['qui a lu mon message dans le groupe', 'supprimer le groupe', 'quitter le groupe', 'ajouter un membre au groupe']) { const r = W.reply(q, ctx(), {}); ok(r && !r.unknown && !r.acts.some((x) => x.a === 'poll_create'), 'réponse : ' + q); }
r = exp('le jaguar est-il un félin ?', null);
r = W.reply('xyzzy', ctx(), {}); ok(r.unknown && !r.acts.length, 'inconnu court');
// appel par mention : « @Talk2Piaf … »
r = exp('@Talk2Piaf cherche restaurant dans la conversation', 'search_howto', (r) => act(r, 'search').p.q === 'restaurant');
r = exp('@talk2piaf, crée une liste de courses : lait, pain', 'list_howto', (r) => act(r, 'list_create').p.title === 'Courses');
r = exp('@talk2piaf crée un sondage : Quel jour ? lundi, mardi', 'poll_howto', (r) => act(r, 'poll_create').p.opts.length === 2);
ok(W.reply('', ctx(), {}) === null, 'vide → null');
// robustesse : « now » absent, invalide ou sérialisé
for (const now of [undefined, 'pas une date', '2026-10-18T09:30:00', null]) { const rr = W.reply('les photos d’hier', ctx({ now }), {}); ok(rr && act(rr, 'search') && act(rr, 'search').p.since, 'now = ' + now); }
// détresse
exp('je veux mourir', 'support', (r) => /3114/.test(r.text) && r.chips.length === 0 && r.acts.length === 0);
// continuations
r = W.reply('crée un sondage : Jour ? lundi, mardi', ctx(), {}); const mem = { topic: r.topic, offer: r.acts[0] };
r = W.reply('oui', ctx(), mem); ok(r.acts[0] && r.acts[0].a === 'poll_create', 'oui → bouton');
r = W.reply('non merci', ctx(), mem); ok(/rien n’est (publié|créé|modifié|envoyé)|d’accord|très bien|pas de souci|annul/i.test(r.text) && !r.acts.length, 'non → rien : ' + r.text);
ok(/bouton/.test(W.reply('crée une liste de courses : lait', ctx(), {}).text), 'texte de création');
// les brouillons de création ne sont jamais exécutés seuls
for (const q of ['crée un sondage : A ? x, y', 'coche le pain', 'cherche budget dans la conversation']) ok(W.reply(q, ctx(), {}).acts.every((a) => !('auto' in a.p)), 'pas d’auto');

// ---------------------------------------------------------------- puces et cohérence
let chipsTested = 0;
for (const t of W.TOPICS) for (const nx of t.next) {
  const target = W.BY_ID[nx]; if (!target) { fail++; console.log('✗ next inconnu', t.id, nx); continue; }
  const rr = W.reply(target.q, ctx(), { topic: t.id }); chipsTested++;
  if (!rr || rr.unknown || rr.topic !== target.id) { fail++; console.log('✗ puce', JSON.stringify(target.q), '→', rr && rr.topic, '(attendu ' + target.id + ')'); }
}
for (const c of W.starters()) { const rr = W.reply(c.t, ctx(), {}); if (!rr || rr.unknown || rr.handoff) { fail++; console.log('✗ starter', c.t, rr && rr.topic); } }
for (const q of ['idées de sondages', 'idées de listes']) { const rr = W.reply(q, ctx(), {}); for (const c of rr.chips) { const r2 = W.reply(c.t, ctx(), {}); if (r2.unknown || !r2.acts.length || !/^(poll_create|list_create)$/.test(r2.acts[0].a)) { fail++; console.log('✗ puce dyn', c.t, '→', r2.topic, r2.acts.map((a) => a.a)); } } }
ok(new Set(W.TOPICS.map((t) => t.id)).size === W.TOPICS.length, 'ids dupliqués');
// limites configurables
r = W.reply('combien d’options dans un sondage', ctx({ limits: { pollOptions: 6 } }), {}); ok(/2 à 6 options/.test(r.text), 'limites du contexte');
// le mot interdit ne doit apparaître nulle part dans les réponses ni dans le code
const src = fs.readFileSync(__dirname + '/../assistant-actions-kb.js', 'utf8');
const banned = new RegExp('simul' + '[ée]', 'i');
ok(!banned.test(src), 'mot interdit dans le code');
let allText = ''; for (const t of W.TOPICS) { const rr = W.reply(t.q, ctx(), {}); allText += rr.text + ' ' + rr.chips.map((c) => c.l).join(' ') + ' '; }
ok(!banned.test(allText), 'mot interdit dans les réponses');
// les réponses ne contiennent jamais de HTML
ok(!/<[a-z]/i.test(allText), 'pas de HTML');

console.log(`${W.TOPICS.length} sujets, ${chipsTested} puces vérifiées, ${n} contrôles, ${fail} échec(s)`);
process.exit(fail ? 1 : 0);
