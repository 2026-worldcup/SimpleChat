const T2P = require('../assistant-kb.js');
const ctx = () => ({ name: 'Camille Durand', first: 'Camille', pid: '12345678', id8: '1234 5678', now: new Date('2026-10-17T18:05:00'),
  settings: { read_receipts: true, notifications: false }, perm: 'default', online: true, rt: 'SUBSCRIBED', theme: 'auto', installable: false, standalone: false,
  convs: [
    { id: 'c1', name: 'Marie Dupont', unread: 2, favorite: false, archived: false, muted: false, group: false, blocked: false, pid: '87654321' },
    { id: 'c2', name: 'Maman', unread: 0, favorite: true, archived: false, muted: false, group: false, blocked: false, pid: '11112222' },
    { id: 'c3', name: 'Les Copains', unread: 5, favorite: false, archived: false, muted: false, group: true, blocked: false, pid: null },
    { id: 'c4', name: 'Marc Leroy', unread: 0, favorite: false, archived: true, muted: false, group: false, blocked: true, pid: '33334444' },
  ] });
let fail = 0;
const exp = (q, topic, extra) => {
  const r = T2P.reply(q, ctx(), {});
  const ok = r && (topic === null ? r.unknown : r.topic === topic) && (!extra || extra(r));
  if (!ok) { fail++; console.log('✗', JSON.stringify(q), '→', r && r.topic, r && r.unknown ? '(inconnu)' : '', '| attendu', topic, '|', r && r.text.slice(0, 70)); }
  return r;
};
// sujets Piaf
const cases = [
 ['Qu’est-ce que Piaf ?','about'],['piaf','about'],['Comment créer un compte ?','create_account'],['je veux m’inscrire','create_account'],['c’est quoi l’identifiant à 8 chiffres','my_id_what'],
 ['comment me connecter','login'],['j’ai oublié mon code secret','lost_code'],['mot de passe oublié','lost_code'],['ma connexion est bloquée trop de tentatives','locked'],['comment me déconnecter','logout'],
 ['supprimer mon compte','delete_account'],['changer ma photo de profil','profile_photo'],['changer mon nom','profile_name'],['comment démarrer une discussion','start_chat'],['comment retrouver quelqu’un','find_person'],
 ['inviter un ami','invite'],['mettre en favori','favorites'],['comment archiver une discussion','archive'],['mettre en silence','mute'],['effacer l’historique','clear_history'],['rechercher un message','search_howto'],
 ['répondre à un message','reply'],['modifier un message','edit_msg'],['supprimer un message','delete_msg'],['réagir avec un emoji','react'],['transférer un message','forward'],['épingler un message','pins_howto'],
 ['que veulent dire les coches','msg_status'],['désactiver les confirmations de lecture','read_receipts'],['je n’ai pas de réseau','offline'],['envoyer une photo','send_photo'],['taille maximale des vidéos','media_limits'],
 ['mon quota est plein','quota'],['où voir les photos reçues','gallery'],['supprimer une photo','delete_media'],['comment fonctionnent les groupes','groups_intro'],['créer un groupe','group_create'],['ajouter un membre au groupe','group_members'],
 ['différence administrateur membre','group_roles'],['quitter un groupe','group_leave'],['supprimer le groupe','group_delete'],['le nouveau membre voit l’historique ?','group_history'],['changer la photo du groupe','group_identity'],
 ['combien de membres dans un groupe','group_limits'],['bloquer quelqu’un','block'],['signaler un harcèlement','report'],['confidentialité de mes données','privacy'],['les messages sont chiffrés ?','encryption'],
 ['qui voit mon profil','who_sees'],['exporter mes données','data_export'],['sécuriser mon compte','security_tips'],['c’est une arnaque ?','phishing'],['activer les notifications','notifications'],['je ne reçois pas de notifications','notif_problem'],
 ['installer sur mon iPhone','install'],['mode sombre','theme'],['mise à jour de l’application','update'],['suis-je connecté ?','connection'],['ça ne marche pas','bug'],['quelles sont les limites','limits'],
 ['comment contacter l’éditeur','contact_dev'],['que peux-tu faire ?','what_can_you_do'],['qui es-tu ?','who_are_you'],['qui t’a créé ?','who_made'],['es-tu une IA ?','are_you_ai'],['tu lis mes messages ?','assistant_privacy'],
 ['bonjour','greeting'],['salut','greeting'],['comment vas-tu ?','how_are_you'],['merci beaucoup','thanks'],['au revoir','bye'],['raconte-moi une blague','joke'],['une devinette','riddle'],['un proverbe','proverb'],
 ['le saviez-vous ?','fun_fact'],['je m’ennuie','games'],['quel temps fait-il','weather'],['aide pour écrire un message d’anniversaire','msg_ideas'],['je suis triste','sad'],['je suis content','happy'],
 ['idées de nom de groupe pour la famille','group_ideas'],['propose-moi une phrase secrète','pass_gen'],['pourquoi Piaf comme nom','why_piaf'],['Piaf sur ordinateur','desktop'],['c’est gratuit ?','price'],
 ['appel vidéo','missing'],['changer mon code secret','change_code'],['révoquer les autres sessions','revoke'],['j’ai changé de téléphone','multi_device'],['pourquoi ma session a expiré','session_expired'],
 ['sans e-mail ni téléphone pourquoi','no_email'],['brouillon','drafts'],['non lus badge','unread'],['les liens sont sûrs ?','links'],['comment copier un message','copy_msg'],['qui a lu mon message dans le groupe','group_read'],
 ['renommer une discussion','nickname'],['écran d’accueil des discussions','conv_list'],['les messages ne partent pas','offline'],
];
for (const [q, t] of cases) exp(q, t);
// commandes dynamiques
const d = (q, topic, chk) => exp(q, topic, chk);
d('Quel est mon identifiant ?', 'my_id', r => /1234 5678/.test(r.text));
d('mes messages non lus', 'unread', r => r.acts.length === 2 && /Les Copains/.test(r.acts[0].l));
d('combien de discussions ai-je', 'stats', r => /4 discussions/.test(r.text));
d('mes favoris', 'favorites', r => r.acts.length === 1 && r.acts[0].p.id === 'c2');
d('mes discussions archivées', 'archive', r => r.acts.length === 1);
d('ouvre la discussion avec Marie', 'conv_list', r => r.acts[0].a === 'conv' && r.acts[0].p.id === 'c1');
d('écris à Maman', 'conv_list', r => r.acts[0].p.id === 'c2');
d('mets Marie en favori', 'favorites', r => r.acts[0].a === 'fav' && r.acts[0].p.v === true && r.acts[0].p.id === 'c1');
d('retire Maman des favoris', 'favorites', r => r.acts[0].a === 'fav' && r.acts[0].p.v === false);
d('archive la discussion Les Copains', 'archive', r => r.acts[0].a === 'arch' && r.acts[0].p.v === true);
d('mets les copains en silence', 'mute', r => r.acts[0].a === 'mute' && r.acts[0].p.v === true);
d('montre les photos de Marie', 'conv_list', r => r.acts[0].a === 'gallery');
d('écris à Marie : j’arrive dans 10 minutes', 'send_cmd', r => r.acts[0].a === 'send' && r.acts[0].p.t === 'J’arrive dans 10 minutes' && r.acts[0].p.id === 'c1');
d('envoie à Maman que je rentre tard', 'send_cmd', r => r.acts[0].p.t === 'Je rentre tard');
d('écris à Marc : salut', 'send_cmd', r => /bloqué/.test(r.text) && !r.acts.some(a => a.a === 'send'));
d('écris à Inconnu : coucou', 'send_cmd', r => /ne trouve aucune/.test(r.text));
d('écrire à 8765 4321', 'start_by_id', r => r.acts[0].a === 'conv');
d('démarrer avec 55556666', 'start_by_id', r => r.acts[0].a === 'start' && r.acts[0].p.pid === '55556666');
d('12345678', 'my_id');
d('quelle heure est-il', 'time', r => /18:05/.test(r.text));
d('quel jour sommes-nous', 'time', r => /samedi 17 octobre 2026/.test(r.text));
d('calcule 12 x 7', 'calc', r => /84/.test(r.text));
d('combien font 15 + 27 * 2', 'calc', r => /69/.test(r.text));
d('(3+4)*2', 'calc', r => /14/.test(r.text));
d('100 / 8', 'calc', r => /12,5/.test(r.text));
d('18 % de 240', 'calc', r => /43,2/.test(r.text));
d('racine carrée de 144', 'calc', r => /12/.test(r.text));
d('5 / 0', 'calc', r => /zéro/.test(r.text));
d('pile ou face', 'random', r => /Pile|Face/.test(r.text));
d('lance un dé', 'random', r => /🎲/.test(r.text));
d('lance 2 dés', 'random', r => /=/.test(r.text));
d('nombre entre 1 et 100', 'random', r => /🎯/.test(r.text));
d('tire au sort entre pizza, sushi ou burger', 'random', r => /pizza|sushi|burger/.test(r.text));
d('que veut dire ubiquité', 'define', r => r.links.length === 1);
d('traduis bonjour en espagnol', 'translate', r => /tl=es/.test(r.links[0].u));
d('je veux mourir', 'support', r => /3114/.test(r.text) && r.chips.length === 0);
// faux positifs attendus : doivent tomber en « inconnu » ou rester raisonnables
for (const q of ['le jaguar est-il un félin ?', 'qui a gagné la coupe du monde en 1998', 'xyzzy plugh', 'blabla']) { const r = T2P.reply(q, ctx(), {}); if (!r.unknown && r.topic) console.log('~ (info)', JSON.stringify(q), '→', r.topic); }
// puces : chaque puce doit renvoyer vers un sujet (jamais « inconnu »)
let chipsTested = 0;
for (const t of T2P.TOPICS) for (const n of t.next) {
  const target = T2P.BY_ID[n]; if (!target) { fail++; console.log('✗ next inconnu', t.id, n); continue; }
  const r = T2P.reply(target.q, ctx(), { topic: t.id }); chipsTested++;
  if (!r || r.unknown || r.topic !== target.id) { fail++; console.log('✗ puce', JSON.stringify(target.q), '→', r && r.topic, '(attendu ' + target.id + ')'); }
}
for (const c of T2P.starters()) { const r = T2P.reply(c.t, ctx(), {}); if (!r || r.unknown) { fail++; console.log('✗ starter', c.t); } }
// puces dynamiques
for (const q of ['idées de nom de groupe', 'raconte-moi une blague', 'Pose-moi une devinette']) { const r = T2P.reply(q, ctx(), {}); for (const c of r.chips) { const r2 = T2P.reply(c.t, ctx(), {}); if (r2.unknown) { fail++; console.log('✗ puce dyn', c.t); } } }
const unique = new Set(T2P.TOPICS.map(t => t.id)); if (unique.size !== T2P.TOPICS.length) { fail++; console.log('✗ ids dupliqués'); }
console.log(`${T2P.TOPICS.length} sujets, ${chipsTested} puces vérifiées, ${fail} échec(s)`);
const p = T2P.passphrase(); console.log('phrase:', p, '| mots:', T2P.WORDS.length, new Set(T2P.WORDS).size);
process.exit(fail ? 1 : 0);
