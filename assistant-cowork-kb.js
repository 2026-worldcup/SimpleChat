/* Talk2Piaf Cowork — assistant de la vie de groupe : sondages, listes collaboratives, recherche dans la conversation.
   Même principe que Talk2Piaf (assistant-kb.js) : aucune dépendance au DOM ni au réseau. Le moteur reçoit un « contexte »
   (la discussion ouverte, ses membres, ses sondages et ses listes) et renvoie { text, links, acts, chips, topic, scope }.
   Il ne fait jamais rien lui-même : il prépare un brouillon et un bouton ; l'interface exécute l'action à l'appui.
   Ses réponses (texte) sont publiées dans la discussion et conservées dans le cloud (message de type « assistant »),
   les boutons d'action ne sont visibles que par la personne qui a appelé, et `hint` est la phrase qui les accompagne.
   Tout ce qui ne concerne que l'appareil de la personne (thème, écrire à quelqu'un, bloquer…) est confié à Talk2Piaf
   par une action « t2p » (relais) : Talk2Piaf répond alors en local, en privé.

   Contexte attendu (tous les champs sont facultatifs ; voir INTEGRATION_WORK.md) :
   ctx = { name, first, now: Date, handle: '@Talk2Piaf Cowork',
     limits: { pollOptions, pollQuestion, optionLen, pollMaxHours, listTitle, listItems, listTotal, itemLen },
     perms:  { poll: true | 'admin', list: true | 'admin' },
     conv: { id, name, group: bool, pins: n, me: { id, name, role: 'admin' | 'member' }, members: [{ id, name, role }],
             polls: [{ id, mid, question, open, mine, total, votes: [{ t, n }] }],                  // mid = id du message du sondage
             lists: [{ id, mid, title, open, mine, canAdd, canCheck, items: [{ id, t, done, who, whoId }] }] } } */
(function (root) {
'use strict';

// ------------------------------------------------------------------ outils de texte (identiques à Talk2Piaf)
const norm = (s) => String(s).toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[’'`´]/g, ' ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
function stem(w) {
  if (w.length <= 3 || /^\d+$/.test(w)) return w;
  const s = w.replace(/(issements|issement|ements|ement|ations|ation|ions|ion|euses|euse|eurs|eur|ables|able|ents|ent|ees|ee|es|er|ez|e|s|x)$/, '');
  return s.length >= 3 ? s : w;
}
const stems = (n) => n.split(' ').filter(Boolean).map(stem);
const kwNorm = (k) => stems(norm(k)).join(' ');
let rand = Math.random;
const pick = (a) => a[Math.floor(rand() * a.length)];
const A = (l, a, p) => ({ l, a, p: p || {} });   // bouton d'action
const LK = (l, u) => ({ l, u });                  // lien externe
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const plural = (n, a, b) => (n > 1 ? b : a);

// ------------------------------------------------------------------ accès au contexte
// valeurs de la migration 009 : sondage 2 à 12 options, question 300, option 100, clôture dans l'année ; liste : titre 100, 50 éléments à la création (100 au total), élément 200
const lim = (ctx) => Object.assign({ pollOptions: 12, pollQuestion: 300, optionLen: 100, pollMaxHours: 8760, listTitle: 100, listItems: 50, listTotal: 100, itemLen: 200 }, ctx.limits || {});
const handleOf = (ctx) => ctx.handle || '@Talk2Piaf Cowork';
const membersOf = (ctx) => (ctx.conv && ctx.conv.members) || [];
const pollsOf = (ctx) => (ctx.conv && ctx.conv.polls) || [];
const listsOf = (ctx) => (ctx.conv && ctx.conv.lists) || [];
const isAdmin = (ctx) => !!(ctx.conv && ctx.conv.me && ctx.conv.me.role === 'admin');
const where = (c) => '« ' + c.name + ' »';
const noConv = (ctx, topic) => ({ text: `Je travaille **à l’intérieur d’une discussion** : ouvrez le groupe concerné, puis appelez-moi avec **${handleOf(ctx)}** suivi de votre demande (par exemple « ${handleOf(ctx)} crée un sondage : samedi ou dimanche ? »).`, acts: [A('Voir mes discussions', 'go', { h: '#/' })], topic });
const denied = (what, topic) => ({ text: `Dans cette discussion, ${what} est réservé aux administrateurs. Demandez à l’un d’eux, ou proposez-leur votre idée.`, topic });

// ------------------------------------------------------------------ sujets
const TOPICS = [];
const BY_ID = {};
function T(id, q, kw, text, o) {
  const t = Object.assign({ id, q, kw: kw.filter((k) => k[0] !== '=').map(kwNorm), ex: kw.filter((k) => k[0] === '=').map((k) => kwNorm(k.slice(1))), qn: norm(q), text, next: [], prio: 1 }, o || {});
  TOPICS.push(t); BY_ID[id] = t; return t;
}

// ---- Qui je suis
T('about_cowork', 'Que peux-tu faire dans ce groupe ?', ['que peux tu faire', 'que sais tu faire', 'que fais tu', 'a quoi tu sers', 'a quoi sers tu', 'fonctionnalite', 'possibilite', 'talk2piaf cowork', 'cowork', 'ce que tu sais faire'],
  'Je suis **Talk2Piaf Cowork**, l’assistant de la vie de groupe. À votre demande, je prépare :\n• des **sondages** (choix unique ou multiple, anonymes, avec une durée) : créer, clôturer, voir les résultats\n• des **listes collaboratives** (courses, cadeaux, covoiturage…) : créer, ajouter, cocher, attribuer\n• la **recherche dans la conversation** : un mot, un auteur, une période, les photos, les liens, les messages épinglés\n• des réponses sur le groupe : membres, rôles, historique, médias\nMes réponses sont publiées dans la discussion et conservées avec elle. Les actions, elles, partent d’un bouton que **seule la personne qui m’appelle** voit : **rien n’est créé avant son appui**. Pour ce qui ne concerne que votre appareil (thème, écrire à quelqu’un, bloquer…), je vous passe à **Talk2Piaf**.',
  { next: ['poll_howto', 'list_howto', 'search_howto', 'cowork_vs_t2p'] });
T('cowork_vs_t2p', 'Quelle différence entre Talk2Piaf Cowork et Talk2Piaf ?', ['difference', 'talk2piaf', 'cowork ou talk2piaf', 'lequel choisir', 'deux assistants', 'quel assistant', 'qui fait quoi'],
  '**Talk2Piaf Cowork** agit pour **tout le groupe** : sondages, listes collaboratives, recherche dans la conversation, informations sur les membres. Ses réponses sont publiées dans la discussion et conservées dans le cloud.\n**Talk2Piaf** s’occupe de **votre appareil** : thème, écrire un message à quelqu’un, bloquer, favoris, archives, silence, notifications, réglages du compte, et toutes les questions sur l’application. Il répond en local, en privé : rien n’est envoyé ni conservé sur le serveur.\nSi vous me demandez quelque chose qui relève de Talk2Piaf, je vous propose un bouton pour le lui transmettre.',
  { next: ['about_cowork', 'how_call'] });
T('how_call', 'Comment t’appeler dans une discussion ?', ['appeler', 'invoquer', 'mention', 'mentionner talk2piaf', 'comment te parler', 'comment te contacter', 'comment te demander', 'ou es tu', 'te trouver'],
  (ctx) => `Dans la discussion, écrivez **${handleOf(ctx)}** (ou simplement @cowork) suivi de votre demande, par exemple :\n« ${handleOf(ctx)} crée une liste de courses : lait, pain, œufs »\nMa réponse apparaît dans la discussion ; les boutons d’action ne sont visibles que par vous.`,
  { next: ['about_cowork', 'cowork_privacy'] });
T('cowork_privacy', 'Qui voit mes demandes à Talk2Piaf Cowork ?', ['qui voit', 'visible', 'confidentialite', 'prive', 'discretion', 'les autres voient', 'mes demandes', 'brouillon', 'apercu', 'sauvegarde', 'sauvegardees', 'cloud', 'conservees', 'historique des reponses'],
  'Votre message (avec la mention) et ma réponse sont des **messages de la discussion** : tous les membres les voient, ils sont **conservés dans le cloud** avec le reste de la conversation et se synchronisent sur vos appareils. En revanche, **les boutons d’action n’apparaissent que chez la personne qui m’a appelé**, et **rien n’est créé avant son appui** : je ne publie jamais un sondage, une liste ou un changement de ma propre initiative. Quand je transmets une demande à Talk2Piaf, sa réponse reste locale : vous seul la voyez et elle n’est pas conservée.',
  { next: ['how_call', 'cowork_vs_t2p'] });
T('who_made_w', 'Qui t’a créé ?', ['qui t a cree', 'qui t a fait', 'createur', 'developpeur', 'editeur', 'qui a cree talk2piaf'],
  'Talk2Piaf Cowork fait partie de Piaf, développé par Ehorg, comme Talk2Piaf.', { next: ['about_cowork'] });
T('are_you_ai_w', 'Es-tu une IA ?', ['es tu une ia', 'es tu un robot', 'intelligence artificielle', 'es tu humain', 'robot', 'chatbot', 'bot'],
  'Je suis un **assistant automatique** : je ne suis pas une personne. Je reconnais des demandes sur la vie du groupe (sondages, listes, recherche, membres) et je prépare des actions que la personne qui m’appelle valide par un bouton. Je ne comprends pas tout : n’hésitez pas à reformuler.',
  { next: ['about_cowork', 'cowork_vs_t2p'] });

// ---- Sondages
T('poll_howto', 'Comment créer un sondage ?', ['creer un sondage', 'faire un sondage', 'lancer un sondage', 'sondage', 'sondages', 'organiser un vote', 'faire voter', 'poll', 'comment voter', 'proposer un vote'],
  (ctx) => `Écrivez par exemple :\n« ${handleOf(ctx)} crée un sondage : Quel jour pour le dîner ? samedi, dimanche, lundi »\nJe vous montre un **aperçu** et vous le publiez d’un appui. Vous pouvez ajouter :\n• **anonyme** : les votes individuels ne sont jamais montrés\n• **choix multiples** : chacun peut cocher plusieurs réponses\n• **options ouvertes** : les membres peuvent ajouter leurs propres options\n• une **durée** : « 24 h », « 3 jours »\nPour une question à réponse par oui ou non, vous n’avez pas besoin de donner les options.`,
  { next: ['poll_options', 'poll_anonymous', 'poll_close_howto', 'poll_ideas'], prio: 1.1 });
T('poll_options', 'Combien d’options peut-on mettre dans un sondage ?', ['options sondage', 'nombre d options', 'combien d options', 'combien de choix', 'limite sondage', 'maximum options', 'reponses possibles', 'choix possibles'],
  (ctx) => { const L = lim(ctx); return `Un sondage propose de **2 à ${L.pollOptions} options**. La question peut faire jusqu’à ${L.pollQuestion} caractères et chaque option jusqu’à ${L.optionLen}. Séparez les options par des virgules, des « ou », des barres obliques ou des retours à la ligne. Avec « **options ouvertes** », les membres peuvent en ajouter (toujours dans la limite de ${L.pollOptions}).`; },
  { next: ['poll_howto', 'poll_multi'] });
T('poll_anonymous', 'Un sondage peut-il être anonyme ?', ['sondage anonyme', 'vote anonyme', 'anonyme', 'anonymat', 'qui a vote quoi', 'voir qui a vote', 'secret'],
  'Oui : ajoutez « **anonyme** » à votre demande (« crée un sondage anonyme : … »). Les votes individuels ne sont alors **jamais envoyés** aux autres membres : seuls les totaux sont visibles. Sans cette précision, le sondage est public : chacun voit qui a voté pour quoi. L’anonymat ne peut plus être modifié une fois que des votes sont enregistrés.',
  { next: ['poll_howto', 'poll_multi'] });
T('poll_multi', 'Peut-on voter pour plusieurs réponses ?', ['plusieurs reponses', 'plusieurs choix', 'choix multiples', 'choix multiple', 'cocher plusieurs', 'voter plusieurs fois', 'plusieurs options'],
  'Oui : ajoutez « **choix multiples** » (« crée un sondage à choix multiples : … »). Par défaut, un sondage est à **choix unique**. Pour ne pas fausser les résultats, une personne vote une seule fois par sondage, mais elle peut changer sa réponse tant que le sondage est ouvert.',
  { next: ['poll_howto', 'poll_duration'] });
T('poll_duration', 'Peut-on limiter la durée d’un sondage ?', ['duree sondage', 'duree', 'date limite', 'fin du sondage', 'expiration', 'sondage 24 h', 'jusqu a demain', 'delai'],
  (ctx) => `Oui : précisez une durée dans votre demande, par exemple « crée un sondage de 24 h : … » ou « … pendant 3 jours ». Le sondage se ferme alors tout seul (durée maximale : environ ${Math.round(lim(ctx).pollMaxHours / 24)} jours). Sans durée, il reste ouvert jusqu’à ce que quelqu’un le **clôture**.`,
  { next: ['poll_close_howto', 'poll_howto'] });
T('poll_close_howto', 'Comment clôturer ou supprimer un sondage ?', ['cloturer sondage', 'fermer sondage', 'terminer sondage', 'arreter sondage', 'supprimer sondage', 'annuler sondage', 'effacer sondage', 'rouvrir sondage', 'resultat final'],
  'Dites « **clôture le sondage** » : je propose un bouton pour chaque sondage que vous pouvez fermer (le vôtre, ou n’importe lequel si vous êtes administrateur de ce groupe). Les résultats restent consultables après la clôture, et « **rouvre le sondage** » le remet en route. « **Supprime le sondage** » l’efface pour tout le monde, après confirmation. Pour voir où il en est, demandez « résultat du sondage ».',
  { next: ['poll_howto', 'poll_results_howto'] });
T('poll_results_howto', 'Comment voir les résultats d’un sondage ?', ['resultat sondage', 'resultats', 'voir les votes', 'combien de votes', 'qui a vote', 'score sondage', 'ou en est le sondage'],
  'Demandez « **résultat du sondage** » : je résume les votes quand je les connais et je vous propose d’ouvrir le sondage. Dans un sondage public, vous voyez aussi qui a voté quoi ; dans un sondage anonyme, seulement les totaux.',
  { next: ['poll_close_howto', 'poll_anonymous'] });
T('poll_edit', 'Comment modifier un sondage ?', ['modifier sondage', 'changer sondage', 'corriger sondage', 'editer sondage', 'ajouter une option', 'ajouter option', 'retirer une option', 'faute dans le sondage'],
  'Appuyez sur le sondage puis sur « Modifier le sondage » (réservé à son auteur et aux administrateurs) : question, options, choix multiples, durée. L’anonymat ne peut plus changer une fois des votes enregistrés. Si le sondage est **ouvert aux options**, chaque membre peut aussi y ajouter la sienne avec « + Option ».',
  { next: ['poll_options', 'poll_close_howto'] });
T('poll_who', 'Qui peut créer un sondage ?', ['qui peut creer un sondage', 'droit sondage', 'permission sondage', 'autorise sondage', 'membre peut creer', 'reserve aux admins'],
  (ctx) => (ctx.perms && ctx.perms.poll === 'admin' ? 'Dans cette discussion, seuls les **administrateurs** peuvent créer un sondage. Tous les membres peuvent en revanche y répondre.' : 'Tous les membres de la discussion peuvent créer un sondage et y répondre. Seul son auteur (ou un administrateur du groupe) peut le modifier, le clôturer ou le supprimer.'),
  { next: ['poll_howto', 'poll_edit', 'grp_roles'] });
T('poll_ideas', 'Idées de sondages', ['idee de sondage', 'idees de sondages', 'exemples de sondage', 'sondage exemple', 'quel sondage', 'inspiration sondage', 'que demander au groupe'],
  'Quelques idées à lancer en un message :\n• choisir une **date** (samedi ou dimanche ?)\n• choisir un **lieu** ou un **restaurant**\n• savoir **qui vient** (oui / non / peut-être)\n• décider d’un **cadeau** commun ou d’un **nom de groupe**\nChoisissez un exemple ci-dessous : je prépare l’aperçu.',
  { chipsFn: () => [{ l: 'Qui vient samedi ?', t: 'Crée un sondage : Qui vient samedi ?' }, { l: 'Samedi ou dimanche ?', t: 'Crée un sondage : Quel jour ? samedi, dimanche' },
    { l: 'Pizza, sushi ou burger ?', t: 'Sondage pizza ou sushi ou burger' }], next: ['poll_howto'] });

// ---- Listes collaboratives
T('list_howto', 'Comment créer une liste collaborative ?', ['creer une liste', 'faire une liste', 'liste collaborative', 'liste partagee', 'liste de courses', 'liste commune', 'checklist', 'to do', 'todo', 'nouvelle liste', 'liste'],
  (ctx) => `Écrivez par exemple :\n« ${handleOf(ctx)} crée une liste de courses : lait, pain, œufs »\nJe vous montre l’**aperçu** ; une fois la liste publiée, **les membres** peuvent la compléter (sauf réglage contraire). Ensuite :\n• « ajoute du fromage à la liste de courses »\n• « coche le pain » ou « j’ai acheté le lait »\n• « je prends les œufs » ou « Marie s’occupe du pain »\n• « montre la liste de courses »`,
  { next: ['list_assign_howto', 'list_check_howto', 'list_close_howto', 'list_ideas'], prio: 1.1 });
T('list_assign_howto', 'Comment répartir les tâches d’une liste ?', ['attribuer', 'assigner', 'repartir', 's occuper de', 'je prends', 'qui s occupe', 'responsable', 'repartition', 'donner a quelqu un'],
  'Chaque élément d’une liste peut avoir un **responsable**. Dites « **je prends** les œufs », « **Marie s’occupe du** pain » ou « assigne le pain à Marie ». Le nom s’affiche à côté de l’élément, pour que personne ne l’achète deux fois.',
  { next: ['list_check_howto', 'list_perms'] });
T('list_check_howto', 'Comment cocher un élément d’une liste ?', ['cocher', 'decocher', 'barrer', 'c est fait', 'achete', 'rayer', 'valider element', 'element fait', 'marquer comme fait'],
  'Dites « **coche le pain** » ou « **j’ai acheté le lait** » : je prépare le bouton qui coche l’élément pour tout le groupe. « **Décoche le pain** » le remet à faire. Je cherche l’élément par son nom, dans la liste que vous précisez (ou dans la seule liste ouverte).',
  { next: ['list_assign_howto', 'list_perms'] });
T('list_close_howto', 'Comment terminer ou supprimer une liste ?', ['terminer liste', 'cloturer liste', 'archiver liste', 'supprimer liste', 'effacer liste', 'fermer liste', 'liste terminee', 'fin de la liste', 'vider la liste', 'effacer les termines', 'nettoyer la liste'],
  'Une liste ne s’archive pas : quand tout est fait, dites « **efface les éléments terminés** » pour la nettoyer en gardant ce qui reste à faire, ou « **supprime la liste de courses** » pour l’effacer définitivement pour tout le monde (l’application vous demande confirmation). La suppression est réservée à l’auteur de la liste et aux administrateurs.',
  { next: ['list_howto', 'list_check_howto'] });
T('list_limits', 'Combien d’éléments dans une liste ?', ['limite liste', 'nombre d elements', 'combien d elements', 'taille de la liste', 'maximum liste', 'liste trop longue'],
  (ctx) => { const L = lim(ctx); return `Une liste accepte jusqu’à **${L.listItems} éléments à sa création** et **${L.listTotal} au total** (${L.itemLen} caractères chacun) ; son titre peut faire ${L.listTitle} caractères. Séparez les éléments par des virgules, des « et » ou des retours à la ligne.`; },
  { next: ['list_howto'] });
T('list_perms', 'Qui peut cocher ou ajouter dans une liste ?', ['qui peut cocher', 'qui peut ajouter a la liste', 'droits liste', 'permissions liste', 'reglages de la liste', 'membres peuvent ajouter', 'membres peuvent cocher', 'liste verrouillee', 'liste reservee'],
  'À sa création, une liste laisse les membres **ajouter, modifier et cocher** les éléments. Son auteur ou un administrateur peut changer ces deux droits dans « Paramètres de la liste » (appui sur la liste). Seuls l’auteur et les administrateurs peuvent supprimer la liste ou la renommer.',
  { next: ['list_howto', 'list_assign_howto'] });
T('list_ideas', 'Idées de listes', ['idee de liste', 'idees de listes', 'exemples de liste', 'liste exemple', 'quelle liste', 'inspiration liste', 'que mettre en liste'],
  'Les listes les plus pratiques en groupe :\n• **courses** pour un repas ou un week-end\n• **à apporter** (jeux, boissons, matériel)\n• **cadeaux** à offrir, avec qui s’en occupe\n• **covoiturage** : qui conduit, qui a des places\nChoisissez-en une : je prépare l’aperçu.',
  { chipsFn: () => [{ l: 'Liste de courses', t: 'Crée une liste de courses : lait, pain, œufs' }, { l: 'Liste à apporter', t: 'Crée une liste à apporter : boissons, chips, jeux' },
    { l: 'Liste de cadeaux', t: 'Crée une liste de cadeaux : livre, jeu, plante' }], next: ['list_howto'] });

// ---- Recherche dans la conversation
T('search_howto', 'Comment chercher dans la conversation ?', ['rechercher un message', 'chercher un message', 'retrouver un message', 'recherche dans la conversation', 'chercher dans la conversation', 'retrouver une info', 'recherche', 'retrouver', 'fouiller'],
  (ctx) => `Dites ce que vous cherchez, par exemple :\n• « cherche **restaurant** dans la conversation »\n• « retrouve les messages de **Marie** sur **le cadeau** »\n• « qui a parlé de **covoiturage** la semaine dernière ? »\n• « les **photos** d’hier » ou « les **liens** partagés »\nJe prépare la recherche avec les filtres compris ; un appui la lance. Vous ne retrouvez que les messages que vous avez le droit de voir.`,
  { next: ['search_filters', 'pins_howto'], prio: 1.1 });
T('search_filters', 'Quels filtres pour la recherche ?', ['filtre', 'filtres', 'par auteur', 'par date', 'par periode', 'affiner la recherche', 'recherche precise', 'recherche avancee', 'depuis lundi'],
  'Vous pouvez combiner :\n• un **mot ou une phrase** : « parle de cadeau » ou entre guillemets\n• un **auteur** : « les messages de Marie », « ce que j’ai écrit »\n• une **période** : aujourd’hui, hier, cette semaine, la semaine dernière, ce mois, depuis lundi, depuis 3 jours, le 12 octobre\n• un **type** : photos et vidéos, liens, messages épinglés',
  { next: ['search_howto', 'pins_howto'] });
T('pins_howto', 'Comment retrouver les messages épinglés ?', ['messages epingles', 'epingle', 'epingles', 'epingler', 'message important', 'message pingle', 'garder un message'],
  'Pour épingler un message, appuyez dessus puis choisissez « Épingler » : il reste facile à retrouver. Pour les revoir, dites « **messages épinglés** » et je vous ouvre la liste.',
  { acts: (ctx) => (ctx.conv ? [A('Voir les messages épinglés', 'pins', { conv: ctx.conv.id })] : []), next: ['search_howto', 'search_filters'] });
T('gallery_group', 'Où voir les photos et vidéos du groupe ?', ['galerie du groupe', 'photos du groupe', 'videos du groupe', 'medias du groupe', 'toutes les photos', 'album', 'galerie'],
  'Toutes les photos et vidéos partagées dans la discussion sont réunies dans sa **galerie**. Vous pouvez aussi me demander « les photos de Marie » ou « les photos d’hier » pour les filtrer.',
  { acts: (ctx) => (ctx.conv ? [A('Ouvrir la galerie', 'gallery', { id: ctx.conv.id })] : []), next: ['search_filters', 'media_quota'] });

// ---- Vie du groupe
T('mention_howto', 'Comment mentionner quelqu’un dans le groupe ?', ['mentionner', 'mention', 'arobase', 'taguer', 'interpeller', 'prevenir quelqu un', 'notifier quelqu un', 'identifier quelqu un'],
  'Tapez « **@** » dans le champ de message : la liste des membres apparaît. Les noms mentionnés sont mis en valeur, et une mention **passe outre le mode silence** du groupe pour la notification de la personne.',
  { next: ['members_howto', 'grp_roles'] });
T('members_howto', 'Comment ajouter ou retirer un membre ?', ['ajouter un membre', 'ajoute au groupe', 'ajouter au groupe', 'ajoute quelqu un', 'retire du groupe', 'retirer du groupe','retirer un membre', 'ajouter quelqu un au groupe', 'inviter dans le groupe', 'exclure', 'virer', 'enlever du groupe', 'nouveau membre'],
  'Seuls les **administrateurs** ajoutent ou retirent des membres : ouvrez les infos du groupe, puis « Ajouter ». On ajoute des personnes avec qui vous avez déjà une discussion ou un groupe en commun ; une personne bloquée ne peut pas être ajoutée. Seul le créateur du groupe peut retirer ou rétrograder un administrateur.',
  { acts: (ctx) => (ctx.conv && ctx.conv.group ? [A('Infos du groupe', 'group', { id: ctx.conv.id })] : []), next: ['grp_roles', 'grp_history'] });
T('grp_roles', 'Quelle différence entre administrateur et membre ?', ['administrateur', 'admin', 'role', 'roles', 'droits', 'permissions', 'promouvoir', 'retrograder', 'devenir admin', 'membre'],
  'Les **administrateurs** ajoutent et retirent des membres, renomment le groupe, changent sa photo, nomment d’autres administrateurs et peuvent supprimer un message pour tous. Les **membres** écrivent, réagissent, créent et complètent des listes et des sondages, et peuvent quitter le groupe. Si le dernier administrateur part, le rôle passe automatiquement à un autre membre.',
  { next: ['members_howto', 'grp_leave'] });
T('grp_identity', 'Comment changer le nom ou la photo du groupe ?', ['nom du groupe', 'photo du groupe', 'renommer le groupe', 'changer le nom du groupe', 'changer la photo du groupe', 'avatar du groupe', 'titre du groupe'],
  'Un **administrateur** peut changer le nom et la photo du groupe depuis les infos du groupe (la photo est cadrée en carré : déplacez et zoomez). Le changement est visible de tous les membres.',
  { acts: (ctx) => (ctx.conv && ctx.conv.group ? [A('Infos du groupe', 'group', { id: ctx.conv.id })] : []), next: ['grp_roles'] });
T('grp_history', 'Un nouveau membre voit-il l’historique ?', ['historique', 'nouveau membre voit', 'messages anciens', 'avant son arrivee', 'ancien message', 'arrive dans le groupe', 'voit les anciens'],
  'Non : un nouvel arrivant **ne voit pas** les messages antérieurs à son arrivée. Cela vaut aussi pour mes recherches, qui ne portent que sur ce que chaque personne a le droit de voir.',
  { next: ['members_howto', 'search_howto'] });
T('grp_read', 'Qui a lu mon message dans le groupe ?', ['qui a lu', 'lu par', 'accuse de lecture groupe', 'vu par', 'lecture groupe', 'combien l ont lu', 'confirmation lecture groupe'],
  'Sous vos messages de groupe, l’indicateur « **lu par N/M** » compte les membres qui l’ont lu (il se rafraîchit toutes les 20 secondes environ). Le détail par personne est visible pour l’auteur. Seuls comptent les membres qui ont gardé leurs confirmations de lecture activées.',
  { next: ['grp_roles'] });
T('grp_leave', 'Comment quitter le groupe ?', ['quitter le groupe', 'sortir du groupe', 'partir du groupe', 'je veux partir', 'quitter la discussion', 'laisser le groupe'],
  'Ouvrez les infos du groupe puis « Quitter le groupe ». Vous n’avez plus accès aux messages ni aux listes et sondages du groupe. Si vous êtes le dernier administrateur, le rôle est transmis à un autre membre ; si vous êtes le dernier membre, vous supprimez le groupe.',
  { acts: (ctx) => (ctx.conv && ctx.conv.group ? [A('Infos du groupe', 'group', { id: ctx.conv.id })] : []), next: ['grp_delete', 'grp_roles'] });
T('grp_delete', 'Comment supprimer le groupe ?', ['supprimer le groupe', 'effacer le groupe', 'dissoudre', 'detruire le groupe', 'fermer le groupe'],
  'La suppression d’un groupe est **définitive pour tous les membres** et passe par les infos du groupe ; elle est réservée à un administrateur. Pour seulement ne plus voir la discussion, vous pouvez l’archiver : cela relève de Talk2Piaf.',
  { acts: (ctx) => (ctx.conv && ctx.conv.group ? [A('Infos du groupe', 'group', { id: ctx.conv.id })] : [A('Demander à Talk2Piaf', 't2p', { q: 'Comment archiver une discussion ?' })]), next: ['grp_leave', 'grp_roles'] });
T('media_quota', 'Quelle est la limite de photos et de vidéos du groupe ?', ['quota', 'quota du groupe', 'limite de medias', 'place disponible', 'espace', 'plein', 'taille maximale', 'mo', 'stockage du groupe'],
  'Chaque groupe a son **quota de médias** (100 Mo par défaut), partagé entre tous les membres : photos jusqu’à 10 Mo, vidéos jusqu’à 25 Mo, audio jusqu’à 10 Mo, 10 fichiers par envoi. Quand le quota est atteint, supprimez des médias « pour tous » depuis la galerie pour libérer de la place.',
  { acts: (ctx) => (ctx.conv ? [A('Ouvrir la galerie', 'gallery', { id: ctx.conv.id })] : []), next: ['gallery_group', 'group_size'] });
T('group_size', 'Combien de personnes dans un groupe ?', ['combien de membres', 'nombre de membres', 'taille du groupe', 'limite de membres', 'maximum de personnes', 'participants', 'jusqu a combien'],
  'Un groupe réunit de **2 à 32 personnes**. Si vous voulez savoir qui est dans celui-ci, demandez « qui est dans le groupe ? ».',
  { next: ['members_howto', 'grp_roles'] });

// ---- Conversation courante
T('greeting_w', 'Bonjour', ['=bonjour', '=salut', '=coucou', '=hello', '=bonsoir', '=hey', '=yo'],
  (ctx) => `Bonjour${ctx.first ? ' ' + ctx.first : ''} ! Je m’occupe des sondages, des listes et des recherches du groupe. Que voulez-vous faire ?`,
  { chipsFn: () => starters().slice(0, 4), next: [] });
T('thanks_w', 'Merci beaucoup', ['=merci', '=merci beaucoup', '=merci bien', '=super merci', '=parfait', '=top', '=genial', '=nickel', '=cool'], 'Avec plaisir ! Je reste là pour le groupe.', { chipsFn: () => [], next: [] });
T('bye_w', 'Au revoir', ['=au revoir', '=a plus', '=a bientot', '=bye', '=ciao', '=bonne soiree', '=bonne nuit', '=a demain'], 'À bientôt !', { chipsFn: () => [], next: [] });

// ------------------------------------------------------------------ recherche de noms (membres, listes, éléments)
const STOPW = new Set(('ouvre ouvrir affiche afficher montre montrer va aller la le les l un une ma mon mes ta ton tes notre nos de du des d a au aux avec chez en dans sur et ou pour par ' +
  'discussion discussions conversation conversations chat groupe groupes contact moi toi me te se que qui quoi comment pourquoi quand est il elle ils peux peut peuvent pouvez tu vous je j s stp svp merci plait ' +
  'ajoute ajouter retire retirer enleve enlever supprime supprimer coche cocher decoche decocher liste listes nouveau nouvelle message messages membre membres cette ce ces son sa ses ' +
  'cloture clotures cloturer clore ferme fermer termine terminer arrete arreter stoppe stopper rouvre rouvrir efface effacer detruis detruire annule annuler resultat resultats sondage sondages ' +
  'nettoie nettoyer vide vider elements element termines').split(' '));
function findNamed(qn, items, nameOf) {
  const qt = qn.split(' ').filter((w) => w.length >= 2 && !STOPW.has(w));
  if (!qt.length || !items || !items.length) return [];
  const scored = [];
  for (const it of items) {
    const nt = norm(nameOf(it) || '').split(' ').filter((w) => w.length >= 2);
    if (!nt.length) continue;
    let hits = 0;
    for (const w of qt) if (nt.some((n) => n === w || (w.length >= 3 && n.startsWith(w)) || (n.length >= 4 && w.startsWith(n)))) hits++;
    if (!hits) continue;
    scored.push({ it, s: hits + (norm(nameOf(it)) === qt.join(' ') ? 2 : 0) + hits / nt.length });
  }
  scored.sort((a, b) => b.s - a.s);
  if (!scored.length) return [];
  const top = scored[0].s;
  return scored.filter((x) => x.s >= top - 0.01).slice(0, 4).map((x) => x.it);
}
const findMembers = (qn, ctx) => findNamed(qn, membersOf(ctx), (m) => m.name);
const openLists = (ctx) => listsOf(ctx).filter((l) => l.open !== false);
const howto = (qn) => /^(?:\w+ ){0,3}?(comment|pourquoi|c est quoi|qu est ce que|explique|expliquer|a quoi sert|peut on|puis je|est il possible|est ce possible|ou (?:voir|trouver|sont|est|se trouve|puis je|peut on))\b/.test(qn);
const hasWord = (qn, re) => re.test(qn);

// ------------------------------------------------------------------ dates (recherche)
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
const sod = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const monday = (d) => addDays(d, -((d.getDay() + 6) % 7));
const fmtDay = (d) => d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
function period(qn, now) {
  const today = sod(now); let m;
  const R = (since, until, label) => ({ since: since.toISOString(), until: until ? until.toISOString() : null, label });
  if ((m = /\bavant hier\b/.exec(qn))) return R(addDays(today, -2), addDays(today, -1), 'avant-hier');
  if ((m = /\bhier\b/.exec(qn))) return R(addDays(today, -1), today, 'hier');
  if ((m = /\baujourd hui\b/.exec(qn))) return R(today, null, 'aujourd’hui');
  if ((m = /\bla semaine (derniere|passee)\b/.exec(qn))) { const mo = monday(today); return R(addDays(mo, -7), mo, 'la semaine dernière'); }
  if ((m = /\bcette semaine\b/.exec(qn))) return R(monday(today), null, 'cette semaine');
  if ((m = /\ble mois (dernier|passe)\b/.exec(qn))) return R(new Date(today.getFullYear(), today.getMonth() - 1, 1), new Date(today.getFullYear(), today.getMonth(), 1), 'le mois dernier');
  if ((m = /\bce mois( ci)?\b/.exec(qn))) return R(new Date(today.getFullYear(), today.getMonth(), 1), null, 'ce mois-ci');
  if ((m = new RegExp('\\bdepuis (' + DAYS.join('|') + ')\\b').exec(qn))) { const diff = (today.getDay() - DAYS.indexOf(m[1]) + 7) % 7 || 7; return R(addDays(today, -diff), null, 'depuis ' + m[1]); }
  if ((m = /\b(?:depuis|ces|dans les|les) (\d{1,3}) (?:derniers? )?(jours?|semaines?|mois)\b/.exec(qn))) {
    const n = parseInt(m[1], 10), u = m[2][0];
    const since = u === 'j' ? addDays(today, -n) : u === 's' ? addDays(today, -7 * n) : new Date(today.getFullYear(), today.getMonth() - n, today.getDate());
    return R(since, null, `les ${n} derniers ${u === 'j' ? 'jours' : u === 's' ? 'semaines' : 'mois'}`);
  }
  if ((m = new RegExp('\\b(?:le|du|au) (\\d{1,2}) (' + MONTHS.join('|') + ')\\b').exec(qn))) {
    let d = new Date(today.getFullYear(), MONTHS.indexOf(m[2]), parseInt(m[1], 10)); if (d > today) d = new Date(d.getFullYear() - 1, d.getMonth(), d.getDate());
    return R(d, addDays(d, 1), 'le ' + fmtDay(d));
  }
  return null;
}
const PERIOD_WORDS = new Set(('avant hier aujourd hui la semaine derniere passee cette mois ce ci depuis jours jour derniers dernier ces dans les le ' + DAYS.join(' ') + ' ' + MONTHS.join(' ') + ' semaines').split(' '));

// ------------------------------------------------------------------ analyse d'un sondage
const YN = /^(?:est ce|qui|on |vous |tu |ca (?:vous|te) |etes[- ]vous|serez[- ]vous|venez|viens|vient|partant|dispo)|\b(?:partants?|disponibles?|dispos?|vient|viennent|venir|venez|viens|d accord|ok pour)\b/;
function splitOpts(text, lim_) {
  const seen = new Set(), out = [];
  for (const raw of String(text).split(/\n|;|\||\s\/\s|\/|,|\s+ou\s+/i)) {
    const o = clip(cap(raw.replace(/^\s*(?:[-•*–]|\d+[.)])\s*/, '').replace(/^[«"“\s]+|[»"”\s]+$/g, '').replace(/[.?!\s]+$/, '').trim()), lim_);
    if (o && !seen.has(o.toLowerCase())) { seen.add(o.toLowerCase()); out.push(o); }
  }
  return out;
}
function parsePoll(q, ctx) {
  const L = lim(ctx);
  const m = /\b(?:sondages?|votes?|polls?)\b/i.exec(q); if (!m) return null;
  let rest = q.slice(m.index + m[0].length);
  const fl = { anon: false, multi: false, allow: false, hours: null };
  rest = rest.replace(/\banonymes?\b/gi, () => { fl.anon = true; return ' '; });
  rest = rest.replace(/\b(?:options?|propositions?|choix)\s+(?:ouvert(?:e|es|s)?|libres?|ajoutables?)\b|\bchacun peut (?:ajouter|proposer)(?: (?:ses|des) (?:options|propositions))?\b|\bles membres peuvent (?:ajouter|proposer)(?: (?:des|leurs) (?:options|propositions))?\b/gi, () => { fl.allow = true; return ' '; });
  rest = rest.replace(/\b(?:à|a)\s+choix\s+multiples?\b|\bchoix\s+multiples?\b|\bplusieurs\s+(?:choix|réponses?|reponses?)\b/gi, () => { fl.multi = true; return ' '; });
  rest = rest.replace(/\bjusqu['’]?\s*(?:à|a)\s+demain\b/gi, () => { fl.hours = 24; return ' '; });
  rest = rest.replace(/(?:\bdur(?:e|ée|ant)\b|\bpendant\b|\bouvert(?:\s+pendant)?\b|\bvalable\b|\bde\b|\()\s*(\d{1,3})\s*(h|heures?|jours?|j)\b\)?/gi, (all, n, u) => { fl.hours = parseInt(n, 10) * (/^h/i.test(u) ? 1 : 24); return ' '; });
  rest = rest.replace(/\b(?:pour|dans|au|avec)\s+(?:le\s+|ce\s+|tout\s+le\s+|tous\s+les\s+)?(?:groupe|monde|membres|conversation|discussion)\b/gi, ' ');
  rest = rest.replace(/^[\s:,\-–—]+/, '');
  let ask = false;
  const pre = /^(?:pour|afin de)\s+(?:savoir|decider|décider|choisir|voir|demander)\s+/i; if (pre.test(rest)) { rest = rest.replace(pre, ''); ask = true; }
  rest = rest.replace(/^(?:sur|à propos de|a propos de|concernant)\s+/i, '').trim();
  let question = '', optText = '';
  const qm = rest.indexOf('?');
  if (qm >= 0) { question = rest.slice(0, qm + 1); optText = rest.slice(qm + 1); }
  else if (/\n/.test(rest)) { const parts = rest.split('\n'); question = parts.shift(); optText = parts.join('\n'); }
  else if (rest.includes(':')) { const i = rest.indexOf(':'); question = rest.slice(0, i); optText = rest.slice(i + 1); }
  else question = rest;
  question = question.replace(/^[\s«"“]+|[»"”\s]+$/g, '').replace(/\s+/g, ' ').trim();
  let opts = splitOpts(optText, L.optionLen);
  if (!opts.length && / ou /i.test(question)) {
    const parts = question.replace(/[?\s]+$/, '').split(/\s+ou\s+/i);
    if (parts.length >= 2 && parts.every((p) => p.trim().split(/\s+/).length <= 4)) { opts = splitOpts(parts.join(','), L.optionLen); question = parts.map((p) => p.trim()).join(' ou ') + ' ?'; }
  }
  if (!question) return { need: 'question', fl };
  question = cap(question);
  if (!/[?!.]$/.test(question)) question += ' ?'; else if (/[.]$/.test(question)) question = question.replace(/\.$/, ' ?');
  if (!opts.length) { if (ask || YN.test(norm(question))) opts = ['Oui', 'Non', 'Peut-être']; else return { need: 'options', question, fl }; }
  if (opts.length < 2) return { need: 'options', question, fl };
  if (opts.length > L.pollOptions) return { need: 'toomany', question, opts, fl };
  if (question.length > L.pollQuestion) return { need: 'toolong', question, fl };
  if (fl.hours != null) fl.hours = Math.max(1, Math.min(L.pollMaxHours, fl.hours));
  return { question, opts, fl };
}
const hoursLabel = (h) => (h % 24 === 0 ? `${h / 24} jour${h / 24 > 1 ? 's' : ''}` : `${h} h`);

// ------------------------------------------------------------------ analyse d'une liste
const ART = /^(?:(?:du|de la|des|le|la|les|un|une)\s+|(?:de l|d|l)['’]\s*)/i;
function splitItems(text, L) {
  return Array.from(new Set(String(text).split(/\n|;|,|\s+et\s+|\|/i)
    .map((s) => s.replace(/^\s*(?:[-•*–]|\d+[.)])\s*/, '').trim().replace(ART, '').replace(/^[«"“\s]+|[»"”\s]+$/g, '').replace(/[.?!\s]+$/, '').trim())
    .filter(Boolean).map(cap).map((s) => clip(s, L.itemLen))));
}
const tidyTitle = (s, L) => { let t = s.replace(/^[\s«"“]+|[»"”\s:.]+$/g, '').replace(/^(?:de la|de l['’]|des|du|de|d['’]|pour|sur|:)\s*/i, '').replace(/^(?:collaborative|partagée|partagee|commune)\s*/i, '').trim(); return clip(cap(t), L.listTitle); };
function pickList(nameQn, ctx) {
  const ls = openLists(ctx); if (!ls.length) return { none: true };
  if (nameQn) { const f = findNamed(nameQn, ls, (l) => l.title); if (f.length === 1) return { list: f[0] }; if (f.length > 1) return { many: f }; }
  if (ls.length === 1) return { list: ls[0] };
  return { many: ls };
}
function matchItems(qn, lists) {
  const qs = stems(qn), found = [];
  for (const l of lists) for (const it of (l.items || [])) {
    const ts = stems(norm(it.t)).filter((w) => w.length >= 2 && !STOPW.has(w));
    if (ts.length && ts.every((w) => qs.some((x) => x === w || (w.length >= 5 && x.startsWith(w)) || (x.length >= 5 && w.startsWith(x))))) found.push({ l, it, n: ts.length });
  }
  if (!found.length) return [];
  const top = Math.max(...found.map((f) => f.n));
  return found.filter((f) => f.n === top);
}
const listLabel = (l) => clip(l.title, 28);
const itemLine = (it) => (it.done ? '✅ ' : '▫️ ') + it.t + (it.who ? ' — ' + it.who : '');

// ------------------------------------------------------------------ commandes dynamiques
const HANDLERS = [
  // 1. détresse : réponse calme et ressources, sans autre suggestion
  (q, qn) => {
    if (!/suicid|me tuer|envie de mourir|veux mourir|veux plus vivre|en finir avec la vie|plus envie de vivre|me faire du mal|m automutil|me suicider|mettre fin a mes jours/.test(qn)) return null;
    return { text: 'Je suis vraiment désolé que vous traversiez cela, et je suis content que vous l’ayez écrit. Vous n’avez pas à rester seul avec cette souffrance. En France, le **3114** est le numéro national de prévention du suicide : gratuit, joignable **24 h/24 et 7 j/7**, avec des professionnels formés qui vous écouteront. Si vous êtes en danger immédiat, appelez le **15** ou le **112**. Et si vous le pouvez, parlez-en dès maintenant à un proche.',
      links: [LK('3114 — numéro national de prévention du suicide', 'https://3114.fr/')], acts: [], chips: [], topic: 'support' };
  },

  // 2. sondage : clôturer, rouvrir, supprimer, résultats
  (q, qn, qs, ctx) => {
    if (!/\bsondages?\b/.test(qn) || howto(qn)) return null;
    const reopen = /\b(rouvre|rouvrir|reouvre|reouvrir|relance|relancer|reactive|reactiver|reprends|reprendre)\b/.test(qn);
    const closing = !reopen && /\b(cloture|clotures|clore|cloturer|ferme|fermer|termine|terminer|arrete|arreter|stoppe|stopper|met fin|mets fin)\b/.test(qn);
    const deleting = !reopen && /\b(supprime|supprimer|efface|effacer|detruis|detruire|retire|retirer|annule|annuler)\b/.test(qn);
    const results = !reopen && !closing && !deleting && (/\b(resultats?|score|scores|ou en est|ou en sont|qui a vote|combien de (?:votes|reponses|personnes)|etat|bilan|gagnant|gagne)\b/.test(qn) || /\b(sondages? (?:en cours|ouverts?)|mes sondages)\b/.test(qn));
    if (!closing && !reopen && !deleting && !results) return null;
    if (!ctx.conv) return noConv(ctx, 'poll_results_howto');
    const all = pollsOf(ctx), isOpen = (p) => p.open !== false;
    const sel = findNamed(qn.replace(/\bsondages?\b/g, ' '), all, (p) => p.question);
    const owned = (p) => !!p.mine || isAdmin(ctx);
    if (closing || reopen || deleting) {
      const topic = deleting ? 'poll_close_howto' : 'poll_close_howto';
      if (!all.length) return { text: 'Il n’y a aucun sondage dans cette discussion pour l’instant.', topic };
      const can = all.filter((p) => owned(p) && (deleting || (reopen ? !isOpen(p) : isOpen(p))));
      const verb = deleting ? 'supprimer' : reopen ? 'rouvrir' : 'clôturer';
      if (!can.length) return { text: all.some(owned) ? `Aucun sondage ne peut être ${deleting ? 'supprimé' : reopen ? 'rouvert' : 'clôturé'} pour l’instant (${reopen ? 'aucun n’est clos' : 'aucun n’est ouvert'}).` : `Seuls l’auteur d’un sondage et les administrateurs peuvent le ${verb}.`, topic };
      const pool = sel.length ? can.filter((p) => sel.includes(p)) : can;
      if (sel.length && !pool.length) return { text: `Seuls l’auteur d’un sondage et les administrateurs peuvent le ${verb}${sel.some(owned) ? ' — et ce sondage n’est pas dans un état qui le permet.' : '.'}`, topic };
      const mk = (p) => A((deleting ? 'Supprimer : ' : reopen ? 'Rouvrir : ' : 'Clôturer : ') + clip(p.question, 40), deleting ? 'poll_delete' : 'poll_close', { conv: ctx.conv.id, id: p.id, mid: p.mid || null, n: p.question, closed: !reopen });
      const cons = deleting ? 'Il sera effacé pour tout le monde, après confirmation.' : reopen ? 'Les votes reprendront.' : 'Les votes seront figés et les résultats resteront visibles.';
      if (!pool.length) return { text: `Je ne trouve pas de sondage correspondant. Voici ceux que vous pouvez ${verb} :`, acts: can.slice(0, 5).map(mk), topic };
      return { text: pool.length === 1 ? `Je peux ${verb} le sondage **${clip(pool[0].question, 80)}**. ${cons}` : `Quel sondage voulez-vous ${verb} ? ${cons}`, acts: pool.slice(0, 5).map(mk), topic,
        hint: 'Appuyez sur le bouton pour confirmer : **rien n’est modifié avant votre appui**.' };
    }
    const pool = (sel.length ? sel : all.filter(isOpen)).slice(0, 3);
    if (!all.length) return { text: 'Il n’y a aucun sondage dans cette discussion pour l’instant. Voulez-vous en créer un ?', chips: [{ l: 'Comment créer un sondage ?', t: 'Comment créer un sondage ?' }], topic: 'poll_results_howto' };
    if (!pool.length) return { text: 'Aucun sondage n’est ouvert en ce moment. Voici les derniers :', acts: all.slice(-3).map((p) => A(clip(p.question, 40), 'jump', { conv: ctx.conv.id, mid: p.mid || null })), topic: 'poll_results_howto' };
    const lines = pool.map((p) => {
      const v = (p.votes || []).filter((x) => x && x.t);
      const body = v.length ? v.map((x) => `${x.t} : ${x.n}`).join(' · ') + (p.total != null ? ` (${p.total} votant${plural(p.total, '', 's')})` : '') : 'résultats à consulter dans le sondage';
      return `**${clip(p.question, 80)}**${isOpen(p) ? '' : ' (clos)'}\n${body}`;
    });
    return { text: lines.join('\n\n'), acts: pool.map((p) => A('Voir : ' + clip(p.question, 36), 'jump', { conv: ctx.conv.id, mid: p.mid || null })), topic: 'poll_results_howto' };
  },

  // 3. sondage : création
  (q, qn, qs, ctx) => {
    if (howto(qn) || !/\b(sondages?|votes?|polls?)\b/.test(qn)) return null;
    const create = /^(sondage|poll)\b/.test(qn) || /\b(cree|creer|fais|faire|fait|lance|lancer|ouvre|ouvrir|organise|organiser|prepare|preparer|propose|proposer|nouveau|nouvelle|ajoute|demarre|demarrer|mets|met|mettre|on fait|je veux|j aimerais|je voudrais)\b.*\b(sondage|vote|poll)\b/.test(qn);
    if (!create) return null;
    if (!ctx.conv) return noConv(ctx, 'poll_howto');
    if (ctx.perms && ctx.perms.poll === 'admin' && !isAdmin(ctx)) return denied('la création d’un sondage', 'poll_who');
    const p = parsePoll(q, ctx);
    if (!p) return null;
    const L = lim(ctx);
    if (p.need === 'question') return { text: 'Quelle question voulez-vous poser ? Par exemple : « crée un sondage : Quel jour pour le dîner ? samedi, dimanche ».', chips: [{ l: 'Qui vient samedi ?', t: 'Crée un sondage : Qui vient samedi ?' }], topic: 'poll_howto' };
    if (p.need === 'options') return { text: `Pour « ${p.question} », quelles réponses proposer ? Donnez au moins deux options, par exemple : « crée un sondage : ${p.question} option 1, option 2 ». Pour une question à réponse par oui ou non, formulez-la comme telle (« Qui vient samedi ? »).`, topic: 'poll_howto' };
    if (p.need === 'toomany') return { text: `Un sondage accepte au plus **${L.pollOptions} options** ; il y en a ${p.opts.length}. Réduisez la liste, ou scindez-la en deux sondages.`, topic: 'poll_options' };
    if (p.need === 'toolong') return { text: `La question est trop longue (${L.pollQuestion} caractères au maximum). Raccourcissez-la et détaillez dans un message à part.`, topic: 'poll_options' };
    const tags = [p.fl.multi ? 'choix multiples' : 'choix unique', p.fl.anon ? 'anonyme' : 'public', p.fl.allow ? 'options ouvertes aux membres' : null, p.fl.hours ? 'ouvert ' + hoursLabel(p.fl.hours) : 'ouvert jusqu’à clôture'].filter(Boolean);
    return { text: `📊 Sondage prêt pour ${where(ctx.conv)} :\n**${p.question}**\n${p.opts.map((o) => '• ' + o).join('\n')}\n(${tags.join(' · ')})`,
      hint: 'Appuyez sur le bouton pour publier le sondage : **rien n’est créé avant votre appui**.',
      acts: [A('Publier le sondage', 'poll_create', { conv: ctx.conv.id, q: p.question, opts: p.opts, multi: p.fl.multi, anon: p.fl.anon, allow: p.fl.allow, hours: p.fl.hours })], topic: 'poll_howto', chips: [{ l: 'Comment clôturer un sondage ?', t: 'Comment clôturer un sondage ?' }] };
  },

  // 4. listes collaboratives
  (q, qn, qs, ctx) => {
    if (howto(qn)) return null;
    const L = lim(ctx);
    const hasList = /\b(liste|listes|checklist|to do|todo|courses)\b/.test(qn);
    const lists = openLists(ctx);
    const CR = '(?:cree|creer|fais|faire|lance|lancer|ouvre|ouvrir|prepare|preparer|nouvelle|nouveau|demarre|demarrer|on fait|ajoute|ajouter)';
    const ownerOf = (l) => !!l.mine || isAdmin(ctx);
    // 4a. création : « crée une liste de courses : lait, pain »
    if (new RegExp('\\b' + CR + '\\b.*\\b(?:listes?|checklist|to ?do)\\b').test(qn) && !/\b(a|dans|sur|de) (la|ma|notre|cette|l) liste\b/.test(qn.replace(/\bune? (nouvelle )?liste\b/, ''))) {
      if (!ctx.conv) return noConv(ctx, 'list_howto');
      if (ctx.perms && ctx.perms.list === 'admin' && !isAdmin(ctx)) return denied('la création d’une liste', 'list_howto');
      const m = /\b(?:listes?|checklist|to[\s-]?do)\b(.*)$/is.exec(q); let rest = (m ? m[1] : '').trim();
      let title = '', itemsText = '';
      const ci = rest.indexOf(':');
      if (ci >= 0) { title = rest.slice(0, ci); itemsText = rest.slice(ci + 1); }
      else if (/\n/.test(rest)) { const parts = rest.split('\n'); title = parts.shift(); itemsText = parts.join('\n'); }
      else if (/[,;]/.test(rest)) { title = ''; itemsText = rest; }
      else title = rest;
      title = tidyTitle(title.replace(/^(?:collaborative|partagée|partagee|commune)\s*/i, ''), L);
      const items = splitItems(itemsText, L);
      if (items.length > L.listItems) return { text: `Une liste accepte au plus **${L.listItems} éléments à sa création** ; il y en a ${items.length}. Créez-la avec les premiers, puis ajoutez le reste (jusqu’à ${L.listTotal} au total).`, topic: 'list_limits' };
      if (!title && !items.length) return { text: 'Comment voulez-vous appeler la liste ? Par exemple : « crée une liste de courses : lait, pain, œufs ».', chips: [{ l: 'Liste de courses', t: 'Crée une liste de courses : lait, pain, œufs' }], topic: 'list_howto' };
      if (!title) title = 'Liste';
      return { text: `📝 Liste prête pour ${where(ctx.conv)} :\n**${title}**\n${items.length ? items.map((i) => '▫️ ' + i).join('\n') : '(vide pour l’instant : les membres pourront y ajouter des éléments)'}`,
        hint: 'Appuyez sur le bouton pour publier la liste : **rien n’est créé avant votre appui**.',
        acts: [A('Publier la liste', 'list_create', { conv: ctx.conv.id, title, items })], topic: 'list_howto', chips: [{ l: 'Comment répartir les tâches ?', t: 'Comment répartir les tâches d’une liste ?' }] };
    }
    // 4b. nettoyer (effacer les éléments terminés), supprimer ou « terminer » une liste
    const VERB_END = /\b(termine|terminer|cloture|cloturer|archive|archiver|ferme|fermer|supprime|supprimer|efface|effacer|detruis|detruire|nettoie|nettoyer|vide|vider|enleve|enlever|retire|retirer)\b/;
    if (VERB_END.test(qn) && /\b(liste|listes|checklist|elements? (?:termines?|faits?|coches?)|termines|coches)\b/.test(qn)) {
      if (!ctx.conv) return noConv(ctx, 'list_close_howto');
      const clean = /\b(elements?|taches?|items?)\b.*\b(termines?|faits?|coches?|finis?)\b|\b(termines|coches|faits)\b/.test(qn) || /\b(nettoie|nettoyer)\b/.test(qn);
      const del = !clean && /\b(supprime|supprimer|efface|effacer|detruis|detruire)\b/.test(qn);
      if (!lists.length) return { text: 'Il n’y a aucune liste dans cette discussion.', topic: 'list_close_howto' };
      const sel = pickList(qn.replace(VERB_END, ' '), ctx);
      const pool = (sel.list ? [sel.list] : sel.many).filter((l) => (del ? ownerOf(l) : l.canAdd !== false));
      if (!pool.length) return { text: del ? 'Seuls l’auteur d’une liste et les administrateurs peuvent la supprimer.' : 'Cette liste n’autorise pas les membres à la modifier.', topic: 'list_perms' };
      const mkClean = (l) => A('Effacer les terminés : ' + listLabel(l), 'list_clear_done', { conv: ctx.conv.id, list: l.id, n: l.title });
      const mkDel = (l) => A('Supprimer : ' + listLabel(l), 'list_delete', { conv: ctx.conv.id, list: l.id, mid: l.mid || null, n: l.title });
      if (del) return { text: pool.length === 1 ? `Je peux **supprimer définitivement** la liste **${pool[0].title}** pour tout le monde. Une confirmation sera demandée.` : 'Quelle liste voulez-vous supprimer ? Une confirmation sera demandée.',
        acts: pool.slice(0, 5).map(mkDel), topic: 'list_close_howto', hint: 'Appuyez sur le bouton pour continuer : **rien n’est supprimé avant votre confirmation**.' };
      if (clean) return { text: pool.length === 1 ? `Je peux **effacer les éléments terminés** de la liste **${pool[0].title}** (${(pool[0].items || []).filter((i) => i.done).length} à effacer).` : 'Dans quelle liste effacer les éléments terminés ?',
        acts: pool.slice(0, 5).map(mkClean), topic: 'list_close_howto', hint: 'Appuyez sur le bouton pour confirmer : **rien n’est modifié avant votre appui**.' };
      return { text: 'Une liste ne s’archive pas. Quand tout est fait, je peux **effacer les éléments terminés** pour la nettoyer, ou la **supprimer** pour tout le monde :',
        acts: pool.slice(0, 3).flatMap((l) => [mkClean(l), ownerOf(l) ? mkDel(l) : null]).filter(Boolean), topic: 'list_close_howto', hint: 'Appuyez sur le bouton de votre choix : **rien n’est modifié avant votre appui**.' };
    }
    if (!lists.length && !hasList) return null;
    // 4c. cocher / décocher : « coche le pain », « j'ai acheté le lait »
    let cm = /\b(coche|cocher|decoche|decocher|barre|barrer|rature|raye)\b/.exec(qn);
    let done = cm ? !/^de/.test(cm[1]) : null;
    if (done === null && /\bj ai (?:pris|achete|fait|recupere|reserve|apporte|trouve|commande)\b|\b(?:est|sont) (?:achete|achetes|pris|prise|prises|fait|faite|faits|recupere|recuperes|ok|bon|bons)\b/.test(qn)) done = true;
    if (done !== null && (lists.length || hasList)) {
      if (!ctx.conv) return noConv(ctx, 'list_check_howto');
      const f = matchItems(qn.replace(/\b(coche|cocher|decoche|decocher|barre|barrer|rature|raye)\b/g, ' '), lists);
      if (!f.length) return lists.length ? { text: 'Je ne retrouve cet élément dans aucune liste. Dites-moi son nom tel qu’il est écrit dans la liste, ou ouvrez la liste.', acts: lists.slice(0, 3).map((l) => A('Voir : ' + listLabel(l), 'jump', { conv: ctx.conv.id, mid: l.mid || null })), topic: 'list_check_howto' } : null;
      const ok = f.filter((x) => x.l.canCheck !== false);
      if (!ok.length) return { text: 'Dans cette liste, seuls l’auteur et les administrateurs peuvent cocher les éléments.', topic: 'list_perms' };
      return { text: done ? `Je peux cocher **${ok.map((x) => x.it.t).join('**, **')}** pour tout le groupe.` : `Je peux décocher **${ok.map((x) => x.it.t).join('**, **')}** : l’élément repassera à faire.`,
        hint: 'Appuyez sur le bouton pour confirmer : **rien n’est modifié avant votre appui**.',
        acts: ok.slice(0, 4).map((x) => A((done ? 'Cocher : ' : 'Décocher : ') + clip(x.it.t, 24) + (ok.length > 1 ? ' (' + listLabel(x.l) + ')' : ''), 'list_check', { conv: ctx.conv.id, list: x.l.id, item: x.it.id, v: done, n: x.it.t })), topic: 'list_check_howto' };
    }
    // 4d. attribuer : « je prends le pain », « Marie s'occupe du pain », « assigne le pain à Marie »
    const mine = /\bje (?:prends|prend|m occupe|m en occupe|me charge|vais prendre|vais m occuper)\b/.test(qn);
    const other = /\bs occupe\b|\bse charge\b|\bassigne\b|\battribue\b|\bconfie\b|\bdonne\b.*\ba\b/.test(qn);
    if ((mine || other) && (lists.length || hasList)) {
      if (!ctx.conv) return noConv(ctx, 'list_assign_howto');
      let who = null;
      if (other && !mine) { const ms = findMembers(qn.replace(/\b(assigne|attribue|confie|donne|s occupe|se charge)\b/g, ' '), ctx); if (ms.length === 1) who = ms[0]; else if (ms.length > 1) return { text: 'Plusieurs membres correspondent : précisez le nom complet.', topic: 'list_assign_howto' }; }
      if (mine) who = ctx.conv.me ? { id: ctx.conv.me.id, name: ctx.conv.me.name || 'vous' } : { id: null, name: 'vous' };
      if (!who) return { text: 'Je ne trouve aucun membre de ce nom dans la discussion. Vérifiez l’orthographe, ou demandez « qui est dans le groupe ? ».', topic: 'list_assign_howto' };
      const f = matchItems(qn, lists);
      if (!f.length) {
        const m2 = /(?:prends|prend|occupe(?: de)?|occupe d|charge(?: de)?|assigne|attribue|confie)\s+(?:le |la |les |l |du |de la |des |d )?(.+?)(?:\s+(?:a|pour)\s+.+)?$/.exec(qn.replace(/\bde l\b/g, 'de l '));
        const raw = m2 ? m2[1] : ''; const it = splitItems(raw, L)[0];
        const sel = pickList('', ctx);
        if (it && sel.list && sel.list.canAdd !== false) return { text: `**${it}** n’est pas encore dans la liste **${sel.list.title}**. Je peux l’ajouter et l’attribuer à **${who.name}**.`, hint: 'Appuyez sur le bouton pour confirmer : **rien n’est modifié avant votre appui**.',
          acts: [A('Ajouter et attribuer', 'list_add', { conv: ctx.conv.id, list: sel.list.id, items: [{ t: it, who: who.id }], n: sel.list.title })], topic: 'list_assign_howto' };
        return { text: 'Je ne retrouve cet élément dans aucune liste. Précisez son nom tel qu’il est écrit dans la liste.', topic: 'list_assign_howto' };
      }
      const ok = f.filter((x) => x.l.canAdd !== false);
      if (!ok.length) return { text: 'Dans cette liste, seuls l’auteur et les administrateurs peuvent modifier les éléments.', topic: 'list_perms' };
      return { text: `Je peux attribuer **${ok.map((x) => x.it.t).join('**, **')}** à **${who.name}**.`, hint: 'Appuyez sur le bouton pour confirmer : **rien n’est modifié avant votre appui**.',
        acts: ok.slice(0, 4).map((x) => A('Attribuer : ' + clip(x.it.t, 24) + ' → ' + clip(who.name, 14), 'list_assign', { conv: ctx.conv.id, list: x.l.id, item: x.it.id, who: who.id, t: x.it.t, n: x.it.t })), topic: 'list_assign_howto' };
    }
    // 4e. afficher une liste
    if (/\b(montre|affiche|ouvre|ouvrir|voir|donne|rappelle|lis|lire|ou en est|ou en sont|que reste t il|qu est ce qui reste|quoi acheter|reste a|restent a|il reste)\b/.test(qn) && (hasList || /\b(reste|restent|a acheter|a faire|a apporter)\b/.test(qn)) && !/\bajoute\b/.test(qn)) {
      if (!ctx.conv) return noConv(ctx, 'list_howto');
      if (!lists.length) return { text: 'Il n’y a aucune liste dans cette discussion. Voulez-vous en créer une ?', chips: [{ l: 'Comment créer une liste ?', t: 'Comment créer une liste collaborative ?' }], topic: 'list_howto' };
      const sel = pickList(qn, ctx);
      const ls = sel.list ? [sel.list] : sel.many.slice(0, 3);
      const text = ls.map((l) => {
        const todo = (l.items || []).filter((i) => !i.done), dn = (l.items || []).length - todo.length;
        return `**${l.title}** — ${todo.length} à faire, ${dn} fait${plural(dn, '', 's')}\n` + ((l.items || []).length ? (l.items || []).slice(0, 15).map(itemLine).join('\n') + ((l.items || []).length > 15 ? '\n…' : '') : '(liste vide)');
      }).join('\n\n');
      return { text, acts: ls.map((l) => A('Voir : ' + listLabel(l), 'jump', { conv: ctx.conv.id, mid: l.mid || null })), topic: 'list_howto' };
    }
    // 4f. ajouter : « ajoute du pain à la liste de courses »
    const am = /\b(ajoute|ajouter|rajoute|rajouter|mets|mettre|note|noter|inscris|inscrire)\s+(.+?)(?:\s+(?:a|sur|dans)\s+(?:la |ma |notre |cette |l |les )?(?:liste|checklist)s?(?:\s+(?:de |des |du |d )?(.+))?)?$/.exec(qn.replace(/\bde l\b/g, 'de l '));
    if (am && (hasList || lists.length)) {
      const objQn = am[2];
      if (/\b(groupe|membre|membres|admin|administrateur|sondage|favori|favoris|archive|silence|conversation|discussion|photo|video)\b/.test(objQn)) return null;
      if (!hasList && findMembers(objQn, ctx).length) return null;
      if (!ctx.conv) return noConv(ctx, 'list_howto');
      const cut = q.search(/\s+(?:à|a|sur|dans)\s+(?:la |ma |notre |cette |l['’]|les )?(?:liste|checklist)/i);
      const verb = /^\s*(?:ajoute|ajouter|rajoute|rajouter|mets|mettre|note|noter|inscris|inscrire)\s+/i;
      const items = splitItems((cut >= 0 ? q.slice(0, cut) : q).replace(/^.*?\b(?:ajoute|ajouter|rajoute|rajouter|mets|mettre|note|noter|inscris|inscrire)\s+/i, '').replace(verb, ''), L);
      if (!items.length) return { text: 'Que faut-il ajouter ? Par exemple : « ajoute du pain à la liste de courses ».', topic: 'list_howto' };
      const sel = pickList(am[3] ? am[3] : '', ctx);
      if (sel.none) return { text: `Il n’y a aucune liste : voulez-vous d’abord en créer une avec ${items.length > 1 ? 'ces éléments' : 'cet élément'} ?`, hint: 'Appuyez sur le bouton pour la créer : **rien n’est créé avant votre appui**.', acts: [A('Créer la liste « Liste »', 'list_create', { conv: ctx.conv.id, title: 'Liste', items })], topic: 'list_howto' };
      const cands = (sel.list ? [sel.list] : sel.many).filter((l) => l.canAdd !== false);
      if (!cands.length) return { text: 'Dans cette liste, seuls l’auteur et les administrateurs peuvent ajouter des éléments.', topic: 'list_perms' };
      const full = cands.filter((l) => (l.items || []).length + items.length > L.listTotal);
      if (full.length === cands.length) return { text: `Une liste accepte au plus **${L.listTotal} éléments** : elle est pleine. Je peux effacer les éléments terminés pour faire de la place.`, acts: cands.slice(0, 3).map((l) => A('Effacer les terminés : ' + listLabel(l), 'list_clear_done', { conv: ctx.conv.id, list: l.id, n: l.title })), topic: 'list_limits' };
      return { text: sel.list ? `Je peux ajouter **${items.join('**, **')}** à la liste **${sel.list.title}**.` : `À quelle liste ajouter **${items.join('**, **')}** ?`, hint: 'Appuyez sur le bouton pour confirmer : **rien n’est modifié avant votre appui**.',
        acts: cands.filter((l) => !full.includes(l)).slice(0, 4).map((l) => A('Ajouter à : ' + listLabel(l), 'list_add', { conv: ctx.conv.id, list: l.id, items: items.map((t) => ({ t })), n: l.title })), topic: 'list_howto' };
    }
    return null;
  },

  // 5. recherche dans la conversation
  (q, qn, qs, ctx) => {
    if (howto(qn)) return null;
    const verb = /\b(cherche|chercher|recherche|rechercher|retrouve|retrouver|trouve|trouver|fouille|fouiller)\b/.test(qn);
    const scope = /\b(message|messages|conversation|discussion|groupe|dit|dits|ecrit|parle|parlait|parle de|mot|mots|phrase|ici)\b/.test(qn) || /["«“]/.test(q);
    const who = /\bqui a (?:parle|dit|ecrit|envoye|poste|partage|mentionne|propose|evoque)\b/.test(qn);
    const media = /\b(photos?|videos?|images?|medias?)\b/.test(qn);
    const links = /\b(liens?|urls?|sites?)\b/.test(qn) && /\b(partage|partages|envoye|envoyes|poste|postes|messages?|dans)\b/.test(qn) && !/\bliste\b/.test(qn);
    const pins = /\b(epingle|epingles|epinglee|epinglees)\b/.test(qn) && !/\b(epingler|comment)\b/.test(qn);
    const fromMsgs = /\b(messages?|ce que|ecrit|dit)\b.*\b(de|par|du)\b|\bmes messages\b/.test(qn);
    // auteur : « mes messages », « ce que j'ai écrit », « messages de Marie », « Marie a parlé de… »
    let author = null, authorName = null; const dropNames = new Set();
    if (/\b(mes messages|ce que j ai (?:dit|ecrit|envoye|poste|partage)|j ai (?:dit|ecrit|envoye|poste|partage)|je t ai (?:dit|ecrit))\b/.test(qn) && ctx.conv && ctx.conv.me) { author = ctx.conv.me.id; authorName = 'vous'; }
    let said = false;
    if (!author) for (const mm of membersOf(ctx)) {
      const toks = norm(mm.name).split(' ').filter((w) => w.length >= 3);
      const byName = (re) => toks.find((t) => new RegExp(re.replace('NAME', t)).test(qn));
      const h1 = byName('\\b(?:de|par|du|d|des|chez)\\s+(?:la |le |l )?NAME'), h2 = byName('\\bNAME (?:a|ont) (?:dit|ecrit|envoye|poste|partage|parle|mentionne|propose|evoque)');
      if (h1 || h2) { author = mm.id; authorName = mm.name; said = !!h2; toks.forEach((t) => dropNames.add(t)); break; }
    }
    const mineMsgs = authorName === 'vous';
    if (!((verb && scope) || who || pins || said || mineMsgs || ((media || links) && /\b(montre|montrer|affiche|afficher|voir|retrouve|retrouver|cherche|chercher|liste|toutes?|les|des)\b/.test(qn)) || (fromMsgs && /\b(montre|affiche|voir|retrouve|cherche|liste|les|tous)\b/.test(qn)))) return null;
    if (/\b(sondage|liste|checklist)\b/.test(qn) && !/\bmessages?\b/.test(qn)) return null;
    if (!ctx.conv) return noConv(ctx, 'search_howto');
    if (pins) return { text: ctx.conv.pins != null ? (ctx.conv.pins ? `Il y a **${ctx.conv.pins} message${plural(ctx.conv.pins, '', 's')} épinglé${plural(ctx.conv.pins, '', 's')}** dans ${where(ctx.conv)}.` : `Aucun message n’est épinglé dans ${where(ctx.conv)} pour l’instant.`) : `Voici les messages épinglés de ${where(ctx.conv)}.`, acts: [A('Voir les messages épinglés', 'pins', { conv: ctx.conv.id })], topic: 'pins_howto' };
    const per = period(qn, ctx.now);
    const kind = media ? 'media' : links ? 'links' : 'text';
    // mots-clés : texte entre guillemets, sinon les mots restants une fois retirés les mots de commande, d'auteur et de date
    let kw = ''; const qm = /["«“]\s*([^"»”]{1,120}?)\s*["»”]/.exec(q);
    if (qm) kw = qm[1].trim();
    else {
      const DROP = new Set(('cherche chercher recherche rechercher retrouve retrouver trouve trouver fouille fouiller montre montrer affiche afficher voir liste lister donne donner message messages conversation discussion groupe ici dans la le les l un une des de du d a au aux ' +
        'qui que qu quoi quand ou on a ont dit ecrit ecrits parle parles parlait parler envoye poste partage partages mentionne propose evoque mes mon ma ce cette ces ca sur avec contenant contient mot mots phrase expression toutes tous tout nos notre j ai je t me te ' +
        'photo photos video videos image images media medias lien liens url site sites par chez peux tu pouvez vous stp svp moi').split(' '));
      const kept = q.split(/\s+/).filter((tok) => {
        const n = norm(tok); if (!n) return false;
        const ws = n.split(' ');
        if (ws.every((w) => DROP.has(w) || dropNames.has(w))) return false;
        if (per && ws.every((w) => PERIOD_WORDS.has(w) || /^\d+$/.test(w))) return false;
        return true;
      });
      kw = kept.join(' ').replace(/[?!.,;:]+$/g, '').trim();
    }
    if (!kw && !author && !per && kind === 'text') return { text: 'Que dois-je chercher ? Donnez un mot, un auteur ou une période, par exemple : « cherche restaurant dans la conversation » ou « les messages de Marie d’hier ».', topic: 'search_howto', chips: [{ l: 'Quels filtres ?', t: 'Quels filtres pour la recherche ?' }] };
    const parts = [];
    if (kw) parts.push(`« ${clip(kw, 60)} »`);
    if (kind === 'media') parts.push('photos et vidéos'); if (kind === 'links') parts.push('liens partagés');
    if (authorName) parts.push(authorName === 'vous' ? 'écrits par vous' : 'de ' + authorName);
    if (per) parts.push(per.label);
    return { text: `Recherche prête dans ${where(ctx.conv)} : ${parts.join(', ')}.\nElle porte sur les messages que vous avez le droit de voir.`,
      acts: [A('Lancer la recherche', 'search', { conv: ctx.conv.id, q: kw, from: author, since: per ? per.since : null, until: per ? per.until : null, kind })], topic: 'search_howto' };
  },

  // 6. informations sur la discussion : administrateurs, membres, mon rôle
  (q, qn, qs, ctx) => {
    if (howto(qn)) return null;
    const isAdm = /\b(qui (?:est|sont) (?:les |l )?(?:admin|admins|administrateur|administrateurs)|(?:les|liste des) (?:admin|admins|administrateurs)|qui administre|qui gere)\b/.test(qn);
    const isMem = /\b(qui (?:est|sont) (?:dans|membre|dans le groupe|ici|presents?)|qui fait partie|liste des membres|les membres du groupe|combien (?:de|d) (?:membres|personnes|participants)(?: y a t il| dans)?|montre les membres|affiche les membres)\b/.test(qn);
    const isRole = /\b(suis je (?:admin|administrateur)|quel est mon role|mon role|ai je les droits)\b/.test(qn);
    if (!isAdm && !isMem && !isRole) return null;
    if (!ctx.conv) return noConv(ctx, 'grp_roles');
    const ms = membersOf(ctx);
    if (isRole) { const r = ctx.conv.me && ctx.conv.me.role; return { text: !r ? 'Je ne connais pas votre rôle dans cette discussion.' : r === 'admin' ? `Vous êtes **administrateur** de ${where(ctx.conv)} : vous pouvez gérer les membres, le nom et la photo du groupe.` : `Vous êtes **membre** de ${where(ctx.conv)}. Seuls les administrateurs gèrent les membres et l’identité du groupe.`, topic: 'grp_roles', acts: [] }; }
    if (!ms.length) return { text: 'Je n’ai pas la liste des membres de cette discussion pour le moment : ouvrez les infos du groupe.', acts: ctx.conv.group ? [A('Infos du groupe', 'group', { id: ctx.conv.id })] : [], topic: 'grp_roles' };
    if (isAdm) { const ad = ms.filter((m) => m.role === 'admin'); return { text: ad.length ? `Administrateur${plural(ad.length, '', 's')} de ${where(ctx.conv)} : **${ad.map((m) => m.name).join('**, **')}**.` : 'Aucun administrateur n’est indiqué pour cette discussion.', acts: ctx.conv.group ? [A('Infos du groupe', 'group', { id: ctx.conv.id })] : [], topic: 'grp_roles' }; }
    const shown = ms.slice(0, 12).map((m) => m.name + (m.role === 'admin' ? ' (admin)' : ''));
    return { text: `${where(ctx.conv)} compte **${ms.length} membre${plural(ms.length, '', 's')}** : ${shown.join(', ')}${ms.length > 12 ? `, et ${ms.length - 12} autre${plural(ms.length - 12, '', 's')}` : ''}.`, acts: ctx.conv.group ? [A('Infos du groupe', 'group', { id: ctx.conv.id })] : [], topic: 'group_size' };
  },

  // 7. ce qui relève de l'appareil : confié à Talk2Piaf (réponse locale)
  (q, qn, qs, ctx) => {
    const what = deviceKind(qn);
    if (!what) return null;
    return { text: `Cela ne concerne que **votre appareil** (${what}) : c’est le travail de **Talk2Piaf**, qui fonctionne en local et vous répond en privé, sans rien montrer au groupe. Je lui transmets votre demande ?`,
      acts: [A('Demander à Talk2Piaf', 't2p', { q: q.trim() })], chips: [], topic: 'handoff', handoff: true };
  },
];

// Demandes qui relèvent de l'appareil (réglages personnels, écrire à quelqu'un, services généraux) → Talk2Piaf
const DEVICE = [
  [/\b(theme|mode sombre|mode clair|sombre|apparence|dark mode)\b/, 'le thème d’affichage'],
  [/\b(ecris|ecrire|envoie|envoyer|dis|dire|transmets|transmettre|contacte|contacter|parle|parler|appelle)\b.* (?:a|au|aux) \w+/, 'écrire un message à une personne'],
  [/\b(bloque|bloquer|debloque|debloquer|blocage|signale|signaler|signalement)\b/, 'bloquer, débloquer ou signaler quelqu’un'],
  [/\b(favori|favoris|archive|archiver|desarchive|desarchiver|silence|muet|mute|sourdine|renomme|renommer|surnom)\b/, 'vos réglages de discussion, comme favori, archive ou silence'],
  [/\b(notification|notifications|alerte|alertes|notifie)\b/, 'les notifications'],
  [/\b(mon (?:nom|photo|profil|identifiant|id|code|code secret|mot de passe|compte)|ma photo|mes donnees|deconnect\w*|session|sessions|supprimer mon compte|code secret|mot de passe)\b/, 'votre compte'],
  [/\b(installer|installation|ecran d accueil|mise a jour|mettre a jour|actualise|actualiser|vider le cache|recharge|recharger)\b/, 'l’installation et la mise à jour de l’application'],
  [/\b(brouillon|brouillons|file d attente|hors ligne|pas de reseau|connexion|wifi|reseau)\b/, 'la connexion et l’envoi hors ligne'],
  [/\b(confirmations? de lecture|accuses? de reception|que veulent dire les coches|les coches)\b/, 'vos confirmations de lecture'],
  [/\b(efface|effacer|supprime|supprimer|vide|vider)\b.*\bhistorique\b/, 'l’historique de votre discussion'],
  [/\b(calcule|calculer|combien font|pile ou face|lance un de|lance des des|tire au sort|tirage au sort|quelle heure|quel jour|quelle date|blague|devinette|proverbe|meteo|quel temps|que veut dire|definition|traduis|traduire|phrase secrete|idee de message|aide pour ecrire)\b/, 'un petit service du quotidien'],
  [/\b(chiffr\w*|confidentialite de mes|vie privee|donnees personnelles|rgpd|arnaque|phishing|piaf|application)\b/, 'une question sur l’application'],
];
function deviceKind(qn) { for (const [re, label] of DEVICE) if (re.test(qn)) return label; return null; }

// ------------------------------------------------------------------ moteur
const MIN_SCORE = 1.55;
function scoreTopic(t, qn, qs) {
  const joined = ' ' + qs.join(' ') + ' ';
  let s = 0;
  for (const k of t.kw) {
    const kt = k.split(' ');
    let ok = true;
    for (const w of kt) { if (!qs.some((x) => x === w || (w.length >= 5 && x.startsWith(w)))) { ok = false; break; } }
    if (!ok) continue;
    s += kt.length === 1 ? 1.6 : kt.length * 2.2;
    if (kt.length > 1 && joined.includes(' ' + k + ' ')) s += 1.2;
    if (k === qs.join(' ')) s += 2.5;
  }
  for (const k of t.ex) if (k === qs.join(' ')) s += 4;
  return s * t.prio;
}
const chipsOf = (ids) => ids.filter((i) => BY_ID[i]).map((i) => ({ l: BY_ID[i].q, t: BY_ID[i].q }));
function starters() {
  return [
    { l: 'Que peux-tu faire ici ?', t: 'Que peux-tu faire dans ce groupe ?' }, { l: 'Créer un sondage', t: 'Comment créer un sondage ?' }, { l: 'Créer une liste', t: 'Comment créer une liste collaborative ?' },
    { l: 'Chercher un message', t: 'Comment chercher dans la conversation ?' }, { l: 'Messages épinglés', t: 'Messages épinglés' }, { l: 'Qui est administrateur ?', t: 'Qui est administrateur ?' },
    { l: 'Cowork ou Talk2Piaf ?', t: 'Quelle différence entre Talk2Piaf Cowork et Talk2Piaf ?' },
  ];
}
function finish(r, topic) {
  const out = { text: r.text, links: r.links || [], acts: r.acts || [], chips: r.chips, topic: r.topic || (topic && topic.id) || null, scope: 'group' };
  if (r.hint) out.hint = r.hint;
  if (r.handoff) out.handoff = true;
  if (r.unknown) out.unknown = true;
  if (!out.chips) out.chips = r.chipsFn ? r.chipsFn() : topic ? chipsOf(topic.next) : [];
  out.chips = out.chips.slice(0, 4);
  out.acts = out.acts.filter(Boolean);
  return out;
}
function answer(best, ctx, qn, q) {
  const raw = typeof best.text === 'function' ? best.text(ctx, qn, q) : best.text;
  const r = typeof raw === 'string' ? { text: raw } : raw;
  const acts = r.acts || (typeof best.acts === 'function' ? best.acts(ctx) : best.acts) || [];
  return finish(Object.assign({}, r, { acts, links: r.links || best.links || [], chipsFn: r.chips ? null : best.chipsFn, chips: r.chips }), best);
}

function reply(text, ctx, mem) {
  ctx = ctx || {}; mem = mem || {};
  // l'appel « @cowork … » arrive avec la mention en tête : on ne garde que la demande
  let q = String(text || '').trim().slice(0, 600);
  const hadMention = /^@[\w.\-]+/.test(q);
  q = q.replace(/^@\s?talk2piaf[\s_.\-]*cowork\b[\s,:;–-]*/i, '').replace(/^@[\w.\-]+[\s,:;–-]*/, '').trim();
  if (!q) { if (!hadMention) return null; q = 'Que peux-tu faire dans ce groupe ?'; }
  if (!(ctx.now instanceof Date) || isNaN(ctx.now)) ctx.now = ctx.now ? new Date(ctx.now) : new Date();
  if (isNaN(ctx.now)) ctx.now = new Date();
  if (ctx.first === undefined && ctx.name) ctx.first = String(ctx.name).split(/\s+/)[0];
  const qn = norm(q), qs = stems(qn);

  // suites de conversation
  if (/^(oui|ok|okay|d accord|vas y|allez|volontiers|je veux bien|go|yes|bien sur|avec plaisir|oui merci|oui s il te plait|oui s il vous plait|transmets|transmets lui)$/.test(qn)) {
    if (mem.offer) return finish({ text: 'Voici le bouton : il suffit d’appuyer pour que je m’en occupe.', acts: [mem.offer], chips: [], topic: mem.topic || null });
    return finish({ text: 'D’accord ! Dites-moi ce que vous voulez faire dans le groupe, ou choisissez un sujet ci-dessous.', acts: [], chips: starters().slice(0, 4), topic: null });
  }
  if (/^(non|non merci|pas besoin|rien|laisse tomber|laissez tomber|ca ira|c est bon|ca va aller|annule|annuler)$/.test(qn)) return finish({ text: 'Très bien, rien n’est publié. Je reste disponible si vous avez besoin de moi.', acts: [], chips: [], topic: null });
  if (/^(comment|pourquoi|details?|detaille|explique|developpe|precise|precisions|et alors|plus|la suite|suite|plus de details|en savoir plus|et apres)\s*\??$/.test(qn) && mem.topic && BY_ID[mem.topic]) {
    return finish({ text: 'Voilà l’essentiel de ce que je sais à ce sujet. Vous pouvez me poser une question plus précise, par exemple :', acts: [], chips: chipsOf(BY_ID[mem.topic].next), topic: mem.topic });
  }

  const exact = TOPICS.find((t) => t.qn === qn);
  if (exact) return answer(exact, ctx, qn, q);

  for (const h of HANDLERS) {
    const r = h(q, qn, qs, ctx, mem);
    if (r) return finish(r, null);
  }

  // sujets
  let best = null, bestS = 0; const ranked = [];
  for (const t of TOPICS) {
    let s = scoreTopic(t, qn, qs);
    if (mem.topic && s > 0) { const last = BY_ID[mem.topic]; if (last && (last.next.includes(t.id) || t.id === mem.topic)) s += 0.45; }
    if (s > 0) ranked.push([t, s]);
    if (s > bestS) { best = t; bestS = s; }
  }
  ranked.sort((a, b) => b[1] - a[1]);
  if (best && bestS >= MIN_SCORE) return answer(best, ctx, qn, q);

  // inconnu : propositions proches, ou passage de relais à Talk2Piaf (qui connaît l'application et les petits services)
  const near = ranked.slice(0, 3).map((x) => x[0]);
  if (near.length) return finish({ text: 'Je ne suis pas certain d’avoir compris. Voulez-vous parler de l’un de ces sujets ? Vous pouvez aussi reformuler avec d’autres mots.', acts: [], chips: near.map((t) => ({ l: t.q, t: t.q })), topic: null, unknown: true });
  return finish({ text: 'Je suis spécialisé dans la **vie du groupe** : sondages, listes collaboratives, recherche dans la conversation, membres et rôles. Pour le reste, **Talk2Piaf**, qui fonctionne sur votre appareil, est plus à l’aise : je peux lui transmettre votre question.',
    acts: qs.length >= 2 ? [A('Demander à Talk2Piaf', 't2p', { q })] : [], chips: starters().slice(0, 4), topic: null, unknown: true, handoff: qs.length >= 2 });
}

const api = { reply, norm, stem, stems, TOPICS, BY_ID, starters, deviceKind, period, parsePoll, splitItems, setRand(fn) { rand = fn || Math.random; } };
if (typeof module === 'object' && module.exports) module.exports = api; else root.T2PC = api;
})(typeof window !== 'undefined' ? window : globalThis);
