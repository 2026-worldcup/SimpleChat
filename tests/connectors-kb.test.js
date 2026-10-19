// Tests des connecteurs dans les deux assistants (calendrier, suivi de fichiers) : `node tests/connectors-kb.test.js` (sans dépendance).
const T = require('../assistant-kb.js'), W = require('../assistant-cowork-kb.js'), WT = require('../assistant-watch.js');
const NOW = new Date(2026, 9, 18, 18, 58);
let fail = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fail++; console.log('✗', m); } };
const tctx = () => ({ name: 'Camille Durand', first: 'Camille', pid: '12345678', id8: '1234 5678', now: NOW, settings: {}, perm: 'default', online: true, rt: 'SUBSCRIBED', theme: 'auto', installable: false,
  convs: [{ id: 'c1', name: 'Marie Dupont', unread: 0, favorite: false, archived: false, muted: false, group: false, blocked: false, pid: '87654321' }] });
const wctx = () => ({ name: 'Camille Durand', first: 'Camille', now: NOW, handle: '@Talk2Piaf Cowork',
  conv: { id: 'g1', name: 'Les Copains', group: true, pins: 0, me: { id: 'u1', name: 'Camille', role: 'admin' }, members: [{ id: 'u1', name: 'Camille Durand', role: 'admin' }, { id: 'u2', name: 'Marie Dupont', role: 'member' }], polls: [], lists: [] } });
const acts = (r) => (r && r.acts ? r.acts.map((a) => a.a) : []);

// ---------------------------------------------------------------- adresses GitHub
const P = (u) => WT.parseUrl(u);
ok(JSON.stringify(P('https://github.com/octocat/Hello-World').ref) === '{"owner":"octocat","repo":"Hello-World"}', 'dépôt');
ok(JSON.stringify(P('github.com/octocat/Hello-World.git').ref) === '{"owner":"octocat","repo":"Hello-World"}', 'sans https, avec .git');
ok(JSON.stringify(P('https://github.com/o/r/blob/main/docs/guide.md').ref) === '{"owner":"o","repo":"r","path":"docs/guide.md"}', 'fichier sur la branche principale : branche non fixée');
ok(JSON.stringify(P('https://github.com/o/r/tree/dev/src').ref) === '{"owner":"o","repo":"r","branch":"dev","path":"src"}', 'dossier sur une autre branche');
ok(JSON.stringify(P('https://github.com/o/r/commits/master/README.md').ref) === '{"owner":"o","repo":"r","path":"README.md"}', 'historique d’un fichier');
ok(JSON.stringify(P('https://github.com/o/r/pull/12').ref) === '{"owner":"o","repo":"r"}', 'une pull request désigne le dépôt');
ok(JSON.stringify(P('regarde (https://github.com/o/r/blob/main/a%20b.md).').ref) === '{"owner":"o","repo":"r","path":"a b.md"}', 'ponctuation autour, espace encodé : ' + JSON.stringify(P('regarde (https://github.com/o/r/blob/main/a%20b.md).').ref));
ok(P('https://github.com/settings/profile') === null && P('https://github.com/orgs/x/people') === null && P('https://github.com/features/actions') === null, 'pages GitHub qui ne sont pas des dépôts');
ok(P('https://github.com/a b/c') === null && P('https://github.com/-a/c') === null && P('https://github.com/o/r/blob/main/../x') .ref.path === undefined, 'références invalides refusées');
ok(P('pas de lien ici') === null && P('https://exemple.org/o/r') === null && P('https://notgithub.com/o/r') === null, 'autres adresses refusées');
ok(WT.provider('https://docs.google.com/document/d/abc') === 'google' && WT.provider('https://1drv.ms/w/s!abc') === 'microsoft' && WT.provider('https://contoso.sharepoint.com/x') === 'microsoft' && WT.provider('https://github.com/o/r') === 'github' && WT.provider('bonjour') === null, 'fournisseurs reconnus');

// ---------------------------------------------------------------- Talk2Piaf (local)
let r = T.reply('ajoute au calendrier dentiste demain à 14h', tctx(), {});
ok(r && acts(r).join() === 'cal_ics,cal_google,cal_outlook' && r.acts[0].p.t === 'Dentiste' && /lundi 19 octobre, de 14h00 à 15h00/.test(r.text) && r.topic === 'cal_howto', 'T2P : évènement préparé : ' + (r && r.text));
ok(/n’est ajouté qu’après votre validation/.test(r.text) && !/Les autres membres/.test(r.text) && r.hint === undefined, 'T2P : la phrase d’accompagnement est dans le texte, sans mention de groupe');
const mem = {}; r = T.reply('mets un rdv coiffeur', tctx(), mem); ok(r && /quel jour/.test(r.text) && acts(r).length === 0, 'T2P : demande le jour');
r = T.reply('jeudi 17h', tctx(), mem); ok(r && acts(r)[0] === 'cal_ics' && r.acts[0].p.t === 'Rdv coiffeur' && r.acts[0].p.s === '2026-10-22T17:00:00', 'T2P : la suite complète l’évènement');
r = T.reply('suis https://github.com/octocat/Hello-World/blob/main/README', tctx(), {});
ok(r && acts(r).join() === 'watch_add' && r.acts[0].p.prov === 'github' && r.acts[0].p.ref.path === 'README' && /vous préviens ici/.test(r.text) && r.topic === 'watch_howto', 'T2P : suivi préparé : ' + (r && r.text.slice(0, 80)));
r = T.reply('peux-tu suivre https://github.com/octocat/Hello-World ?', tctx(), {}); ok(r && acts(r)[0] === 'watch_add' && !r.acts[0].p.ref.path, 'T2P : « peux-tu suivre » + dépôt entier');
r = T.reply('préviens-moi quand https://github.com/o/r change', tctx(), {}); ok(r && acts(r)[0] === 'watch_add', 'T2P : « préviens-moi quand … change »');
r = T.reply('mes suivis', tctx(), {}); ok(r && acts(r)[0] === 'watch_list', 'T2P : liste des suivis');
r = T.reply('arrête le suivi', tctx(), {}); ok(r && acts(r)[0] === 'watch_list', 'T2P : arrêter un suivi passe par la liste');
r = T.reply('suis ce document https://docs.google.com/document/d/abc/edit', tctx(), {}); ok(r && acts(r).length === 0 && /pas encore disponible/.test(r.text) && r.topic === 'watch_office', 'T2P : Google Docs : réponse honnête');
r = T.reply('surveille ce fichier https://contoso.sharepoint.com/:w:/s/x/doc.docx', tctx(), {}); ok(r && acts(r).length === 0 && /pas encore disponible/.test(r.text) && /Microsoft/.test(r.text), 'T2P : SharePoint : réponse honnête');
r = T.reply('suis le fichier', tctx(), {}); ok(r && /Collez son lien/.test(r.text) && acts(r).length === 0, 'T2P : suivi sans lien → demande le lien');
// topics
for (const [q, id] of [['Comment ajouter un évènement à mon agenda ?', 'cal_howto'], ['Piaf peut-il se connecter à mes agendas et à mes documents ?', 'connect_status'], ['Comment suivre les modifications d’un fichier ?', 'watch_howto'], ['Puis-je suivre un document Word, Excel ou Google Docs ?', 'watch_office']]) {
  const rr = T.reply(q, tctx(), {}); ok(rr && rr.topic === id && rr.chips.length > 0, 'T2P : sujet ' + id);
}
for (const [q, id] of [['peut-on synchroniser mon agenda ?', 'connect_status'], ['comment suivre un fichier github', 'watch_howto'], ['peux-tu suivre un fichier excel ?', 'watch_office'], ['je peux avoir un lien google agenda ?', 'cal_howto']]) {
  const rr = T.reply(q, tctx(), {}); ok(rr && rr.topic === id, `T2P : « ${q} » → ${id} (obtenu ${rr && rr.topic})`);
}
// pas de détournement des demandes existantes
for (const [q, topic] of [['rappelle-moi mon identifiant', 'profile_id'], ['je suis triste', null], ['je suis dans le document', undefined], ['comment créer un groupe ?', 'groups_create'], ['quelle heure est-il ?', undefined], ['bonjour', undefined], ['quel temps fait-il demain', undefined]]) {
  const rr = T.reply(q, tctx(), {}); ok(rr && !acts(rr).some((a) => /^(cal_|watch_)/.test(a)), `T2P : « ${q} » n’est pas détourné (${rr && rr.topic}, ${acts(rr)})`);
}
r = T.reply('écris à Marie : j’arrive demain à 14h', tctx(), {}); ok(r && acts(r)[0] === 'send', 'T2P : un message à Marie qui contient une date reste un message : ' + acts(r));

// ---------------------------------------------------------------- Talk2Piaf Cowork (discussion)
r = W.reply('@Talk2Piaf Cowork ajoute au calendrier dîner chez Marie samedi 20h', wctx(), {});
ok(r && acts(r).join() === 'cal_ics,cal_google,cal_outlook' && r.topic === 'cal_howto_cw' && /samedi 24 octobre, de 20h00 à 21h00/.test(r.text) && !/validation/.test(r.text) && /visibles de vous seul/.test(r.hint), 'Cowork : évènement préparé : ' + (r && r.text));
ok(r.acts[0].p.t === 'Dîner chez Marie' && r.acts[0].p.s === '2026-10-24T20:00:00', 'Cowork : charge utile du bouton');
r = W.reply('@cowork suis https://github.com/octocat/Hello-World/blob/main/README', wctx(), {});
ok(r && acts(r).join() === 'watch_add' && /publié dans cette discussion/.test(r.text) && r.topic === 'watch_howto_cw', 'Cowork : suivi de la discussion préparé : ' + (r && r.text.slice(0, 90)));
r = W.reply('@cowork mes suivis', wctx(), {}); ok(r && acts(r)[0] === 'watch_list', 'Cowork : liste des suivis du groupe');
r = W.reply('@cowork suis https://github.com/o/r', Object.assign(wctx(), { conv: null }), {}); ok(r && acts(r).indexOf('watch_add') === -1, 'Cowork : sans discussion ouverte, pas de suivi');
r = W.reply('@cowork suis ce fichier https://onedrive.live.com/edit?id=1', wctx(), {}); ok(r && acts(r).length === 0 && /pas encore disponible/.test(r.text) && r.topic === 'watch_office_cw', 'Cowork : OneDrive : réponse honnête');
for (const [q, id] of [['Comment ajouter un évènement du groupe à mon agenda ?', 'cal_howto_cw'], ['Talk2Piaf Cowork peut-il se connecter à nos agendas et à nos documents ?', 'connect_status_cw'], ['Comment suivre les modifications d’un fichier dans ce groupe ?', 'watch_howto_cw'], ['Peut-on suivre un document Word, Excel ou Google Docs dans ce groupe ?', 'watch_office_cw']]) {
  const rr = W.reply(q, wctx(), {}); ok(rr && rr.topic === id && rr.chips.length > 0, 'Cowork : sujet ' + id);
}
for (const [q, id] of [['on peut synchroniser nos agendas ?', 'connect_status_cw'], ['suivre un fichier github', 'watch_howto_cw'], ['suivre un fichier excel', 'watch_office_cw']]) {
  const rr = W.reply(q, wctx(), {}); ok(rr && rr.topic === id, `Cowork : « ${q} » → ${id} (obtenu ${rr && rr.topic})`);
}
for (const q of ['crée un sondage : samedi ou dimanche ?', 'crée une liste de courses : lait, pain', 'qui est administrateur ?', 'mets le thème sombre']) {
  const rr = W.reply('@cowork ' + q, wctx(), {}); ok(rr && !acts(rr).some((a) => /^(cal_|watch_)/.test(a)), `Cowork : « ${q} » n’est pas détourné`);
}
// pas de collision d'identifiants entre les deux moteurs ; les réponses ne contiennent ni HTML ni mot interdit
for (const t of W.TOPICS) ok(!T.BY_ID[t.id], 'identifiant commun : ' + t.id);
const banned = new RegExp('simul' + '[ée]', 'i'); let all = '';
for (const t of [...T.TOPICS.filter((x) => /^(cal_|connect_|watch_)/.test(x.id)).map((x) => T.reply(x.q, tctx(), {})), ...W.TOPICS.filter((x) => /(cal_|connect_|watch_)/.test(x.id)).map((x) => W.reply(x.q, wctx(), {}))]) all += t.text + ' ';
ok(!banned.test(all) && !/<[a-z]/i.test(all), 'pas de HTML ni de mot interdit');

console.log(`${n} contrôles, ${fail} échec(s)`);
process.exit(fail ? 1 : 0);
