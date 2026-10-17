/* Talk2Piaf — base de connaissances et moteur de réponse.
   Aucune dépendance au DOM : le moteur reçoit un « contexte » (état de l'application) et renvoie
   { text, links, acts, chips, topic }. L'interface (assistant.js) affiche et exécute les actions. */
(function (root) {
'use strict';

// ------------------------------------------------------------------ outils de texte
const norm = (s) => String(s).toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[’'`´]/g, ' ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
function stem(w) { // racinisation légère, appliquée aux mots-clés ET aux questions
  if (w.length <= 3 || /^\d+$/.test(w)) return w;
  const s = w.replace(/(issements|issement|ements|ement|ations|ation|ions|ion|euses|euse|eurs|eur|ables|able|ents|ent|ees|ee|es|er|ez|e|s|x)$/, '');
  return s.length >= 3 ? s : w;
}
const stems = (n) => n.split(' ').filter(Boolean).map(stem);
const kwNorm = (k) => stems(norm(k)).join(' ');
let rand = Math.random;
const pick = (a) => a[Math.floor(rand() * a.length)];
const shuffle = (a) => { const r = a.slice(); for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };
const enc = encodeURIComponent;
const A = (l, a, p) => ({ l, a, p: p || {} });   // bouton d'action
const LK = (l, u) => ({ l, u });                  // lien externe
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ------------------------------------------------------------------ sujets
const TOPICS = [];
const BY_ID = {};
function T(id, q, kw, text, o) {
  const t = Object.assign({ id, q, kw: kw.filter((k) => k[0] !== '=').map(kwNorm), ex: kw.filter((k) => k[0] === '=').map((k) => kwNorm(k.slice(1))), qn: norm(q), text, next: [], prio: 1 }, o || {});
  TOPICS.push(t); BY_ID[id] = t; return t;
}
const SET = 'Paramètres';

// ---- Présentation de Piaf
T('about', 'Qu’est-ce que Piaf ?', ['=piaf', 'qu est ce que piaf', 'c est quoi piaf', 'a quoi sert piaf', 'parle moi de piaf', 'presentation de piaf', 'presente piaf'],
  'Piaf est une **messagerie privée** en français, pensée pour le smartphone : discussions à deux, groupes, photos et vidéos, réactions, réponses… Son principe central : **on l’utilise sans adresse e-mail et sans numéro de téléphone**. Vous avez un identifiant à 8 chiffres et un code secret, c’est tout.',
  { next: ['features', 'no_email', 'create_account', 'install'] });
T('features', 'Quelles sont les fonctionnalités de Piaf ?', ['fonctionnalite', 'que peut faire piaf', 'que propose piaf', 'possibilites', 'liste des fonctions', 'qu est ce qu on peut faire'],
  'Voici ce que Piaf sait faire :\n• discussions à deux et **groupes** (2 à 32 personnes)\n• messages en temps réel : réponse, modification, réaction, transfert, épinglage, recherche\n• **photos et vidéos** avec galerie\n• statuts d’envoi : envoyé, distribué, lu\n• favoris, archives, silence par discussion\n• blocage et signalement\n• thème clair ou sombre, notifications, installation sur l’écran d’accueil\n• envoi de messages hors connexion (ils partent au retour du réseau)',
  { next: ['groups_intro', 'send_photo', 'msg_status', 'limits'] });
T('why_piaf', 'Pourquoi cette application s’appelle Piaf ?', ['pourquoi piaf', 'nom piaf', 'origine nom', 'signification piaf', 'logo', 'oiseau logo', 'pourquoi un oiseau', 'nom de l application'],
  '« Piaf » est un mot familier français pour désigner un moineau, et plus largement un petit oiseau — d’où le logo. Un nom léger pour une messagerie légère : des messages qui s’envolent d’un téléphone à l’autre.',
  { next: ['about', 'fun_fact'] });
T('desktop', 'Peut-on utiliser Piaf sur ordinateur ?', ['ordinateur', 'ordi', 'pc', 'mac', 'navigateur', 'version web', 'sur ordi', 'windows', 'tablette'],
  'Oui. Piaf est une application web : elle fonctionne dans un navigateur récent sur smartphone, tablette ou ordinateur. Connectez-vous avec le même identifiant et le même code secret ; vos discussions sont synchronisées. Sur ordinateur, l’affichage reste celui d’une messagerie mobile, centré à l’écran.',
  { next: ['install', 'multi_device'] });
T('price', 'Piaf est-il gratuit ?', ['gratuit', 'prix', 'payant', 'abonnement', 'combien ca coute', 'publicite', 'pub'],
  'Je n’ai connaissance d’aucun abonnement, d’aucun achat intégré ni d’aucune publicité dans l’application. Les limites techniques (taille des fichiers, quota de médias…) sont détaillées dans la rubrique « Limites ».',
  { next: ['limits', 'privacy'] });
T('language', 'Piaf existe-t-il dans d’autres langues ?', ['langue', 'anglais', 'espagnol', 'traduction application', 'autre langue', 'english'],
  'Pour l’instant, Piaf est uniquement en français. Pour traduire un texte, je peux vous donner un lien vers un service de traduction : écrivez par exemple « traduis bonjour en anglais ».',
  { next: ['about'] });
T('missing', 'Quelles fonctions n’existent pas encore ?', ['appel', 'appel video', 'message vocal', 'vocal', 'sticker', 'story', 'pdf', 'document joint', 'fichier joint', 'partage de position', 'localisation', 'fonction manquante', 'pas encore disponible', 'push'],
  'Ce qui n’est pas disponible pour l’instant :\n• appels audio ou vidéo, messages vocaux\n• envoi de documents (PDF…) : seuls les photos et les vidéos sont acceptés\n• transfert de photos et de vidéos (seuls les textes se transfèrent)\n• alertes quand l’application est totalement fermée\n• changement du code secret depuis l’application\n• export de vos données\n• chiffrement de bout en bout',
  { next: ['notif_problem', 'encryption', 'change_code'] });

// ---- Compte, identifiant, code secret
T('no_email', 'Pourquoi Piaf n’utilise ni e-mail ni téléphone ?', ['sans email', 'sans telephone', 'numero de telephone', 'adresse mail', 'adresse email', 'pourquoi pas email', 'e mail', 'mail', 'numero'],
  'C’est le choix de départ de Piaf : **aucune adresse e-mail et aucun numéro de téléphone ne sont demandés**. Vous êtes reconnu par un identifiant à 8 chiffres (attribué à la création du compte) et par votre code secret. Conséquence : il n’existe pas de récupération par e-mail ou par SMS, donc gardez bien votre identifiant et votre code.',
  { next: ['create_account', 'lost_code', 'my_id_what'] });
T('create_account', 'Comment créer un compte ?', ['creer compte', 'inscription', 'inscrire', 'nouveau compte', 'ouvrir compte', 'comment commencer', 'premiere utilisation', 'debuter'],
  'Pour créer votre compte :\n• ouvrez Piaf, onglet **Créer un compte**\n• choisissez un nom d’affichage (1 à 40 caractères)\n• choisissez un code secret d’au moins 8 caractères, puis confirmez-le — une courte phrase fonctionne très bien\n• Piaf vous donne votre **identifiant à 8 chiffres** : copiez-le et notez-le avec votre code\nEnsuite, partagez votre identifiant aux personnes qui veulent vous écrire.',
  { acts: [A('Idée de code secret', 'pass')], next: ['my_id_what', 'secret_code', 'invite'] });
T('my_id_what', 'C’est quoi l’identifiant à 8 chiffres ?', ['identifiant', 'id piaf', 'c est quoi identifiant', '8 chiffres', 'huit chiffres', 'numero identifiant', 'mon identifiant'],
  (c) => `Votre identifiant est un numéro à **8 chiffres** attribué à la création du compte (le vôtre : **${c.id8}**). C’est lui que les autres saisissent pour vous retrouver ; il sert aussi, avec votre code secret, à vous reconnecter. Il n’est pas secret, contrairement au code.`,
  { acts: [A('Copier mon identifiant', 'copy', { k: 'id' })], next: ['invite', 'find_person', 'login'] });
T('login', 'Comment me connecter ?', ['connexion', 'me connecter', 'se connecter', 'connecter', 'login', 'ouvrir session', 'identifier'],
  'Sur l’écran de connexion, saisissez votre **identifiant à 8 chiffres** puis votre **code secret**. Ensuite la session reste ouverte sur l’appareil : vous n’avez pas à vous reconnecter à chaque fois.',
  { next: ['logout', 'lost_code', 'locked', 'multi_device'] });
T('secret_code', 'Comment choisir un bon code secret ?', ['code secret', 'mot de passe', 'mdp', 'password', 'bon code', 'choisir code', 'mot de passe solide', 'securiser mot de passe'],
  'Votre code secret fait **8 à 64 caractères**. Le plus solide et le plus facile à retenir : une **phrase** ou plusieurs mots sans rapport entre eux, plutôt qu’un mot court avec un chiffre. Ne l’utilisez nulle part ailleurs et ne le communiquez jamais — personne n’a de raison de vous le demander, pas même l’équipe de Piaf.',
  { acts: [A('Générer une phrase secrète', 'pass')], links: [LK('Conseils de la CNIL sur les mots de passe', 'https://cnil.fr/fr/mots-de-passe-recommandations-pour-maitriser-sa-securite')], next: ['lost_code', 'change_code', 'security_tips'] });
T('change_code', 'Puis-je changer mon code secret ?', ['changer code', 'changer mon code', 'changer le code', 'changer de code', 'changer code secret', 'changer mon code secret', 'modifier code secret', 'modifier mon code', 'changer mot de passe', 'changer de mot de passe', 'changer mon mot de passe', 'modifier mot de passe', 'modifier mon mot de passe', 'nouveau code'],
  'Piaf ne propose pas encore de changer le code secret depuis l’application. Choisissez-le donc avec soin dès le départ. Si vous craignez qu’il soit connu, vous pouvez déconnecter les autres appareils (Paramètres → Sécurité) et, en dernier recours, supprimer le compte puis en créer un nouveau.',
  { acts: [A('Révoquer les autres sessions', 'revoke'), A('Ouvrir les paramètres', 'go', { h: '#/settings' })], next: ['revoke', 'delete_account'] });
T('lost_code', 'J’ai oublié mon code secret, que faire ?', ['code oublie', 'oublie mon code', 'oublie code', 'perdu mon code', 'perdu code', 'recuperer compte', 'mot de passe oublie', 'retrouver mon compte', 'recuperation', 'reinitialiser', 'impossible de me connecter', 'perdu identifiant', 'oublie identifiant'],
  'Il n’y a **ni e-mail ni téléphone de récupération** : c’est le prix de la confidentialité. Si vous êtes encore connecté sur un appareil, restez-y : votre session fonctionne toujours, et votre identifiant est visible dans « Nouvelle discussion » et dans les Paramètres. Si vous avez perdu à la fois la session **et** le code secret, le compte est définitivement inaccessible ; il faudra en créer un nouveau et redonner votre nouvel identifiant à vos contacts.',
  { acts: [A('Voir mon identifiant', 'say', { t: 'Quel est mon identifiant ?' })], next: ['create_account', 'secret_code'] });
T('locked', 'Pourquoi ma connexion est-elle bloquée ?', ['connexion bloquee', 'trop de tentatives', 'compte verrouille', 'verrouille', 'verrouillage', 'bloque apres', 'reessayez plus tard', 'identifiant ou code incorrect', 'code incorrect', 'mauvais code', 'echec connexion'],
  'Pour protéger les comptes, Piaf limite les essais de connexion : après **5 codes erronés**, la connexion à cet identifiant est suspendue une quinzaine de minutes, et jusqu’à une heure après de nombreux échecs. Patientez, puis réessayez en vérifiant l’identifiant (8 chiffres) et votre code. Si vous êtes encore connecté sur un autre appareil, rien ne vous empêche de l’utiliser en attendant.',
  { next: ['lost_code', 'login'] });
T('logout', 'Comment me déconnecter ?', ['deconnexion', 'me deconnecter', 'se deconnecter', 'logout', 'quitter session', 'fermer session', 'sortir du compte'],
  'Il n’y a volontairement **pas de bouton de déconnexion** : la session reste ouverte sur l’appareil. Si vous prêtez ou perdez un téléphone, deux solutions : depuis un autre appareil, **révoquer les autres sessions** (Paramètres → Sécurité) ; ou supprimer le compte si c’est nécessaire.',
  { acts: [A('Révoquer les autres sessions', 'revoke')], next: ['revoke', 'delete_account'] });
T('revoke', 'Comment déconnecter les autres appareils ?', ['revoquer', 'autres sessions', 'deconnecter autres appareils', 'appareil perdu', 'telephone perdu', 'telephone vole', 'quelqu un utilise mon compte', 'piratage', 'compte pirate', 'pirate'],
  'Dans **Paramètres → Sécurité**, « Révoquer les autres sessions » déconnecte tous les autres appareils liés à votre compte ; l’appareil actuel reste connecté. C’est le bon réflexe si un téléphone est perdu, volé ou prêté. Si vous pensez que votre code secret est connu, changez de compte (le code n’est pas modifiable pour l’instant).',
  { acts: [A('Révoquer les autres sessions', 'revoke')], next: ['change_code', 'security_tips'] });
T('multi_device', 'Comment retrouver mes discussions sur un autre appareil ?', ['autre appareil', 'plusieurs appareils', 'nouveau telephone', 'changer de telephone', 'deux appareils', 'synchroniser', 'synchronisation', 'transferer mes discussions'],
  'Sur le nouvel appareil, ouvrez Piaf et connectez-vous avec votre **identifiant et votre code secret** : vos discussions, groupes et médias sont stockés côté serveur et réapparaissent. Gardez l’ancien appareil seulement si vous en avez besoin ; sinon, révoquez ses sessions depuis le nouveau.',
  { next: ['login', 'revoke', 'install'] });
T('delete_account', 'Comment supprimer mon compte ?', ['supprimer compte', 'supprimer mon compte', 'effacer compte', 'fermer compte', 'desinscrire', 'quitter piaf', 'supprimer mes donnees', 'effacer mes donnees'],
  'Dans **Paramètres → Zone sensible → Supprimer mon compte**. Piaf demande une confirmation puis votre code secret. **C’est définitif** : votre profil, vos messages, vos médias et vos discussions sont effacés, y compris chez vos contacts. Rien ne peut être récupéré ensuite.',
  { acts: [A('Ouvrir les paramètres', 'go', { h: '#/settings' })], next: ['privacy', 'revoke'] });
T('session_expired', 'Pourquoi ma session s’est-elle terminée ?', ['session', 'session expiree', 'session terminee', 'session fermee', 'deconnecte tout seul', 'etre deconnecte', 'plus connecte', 'jeton'],
  'Une session peut se terminer si elle a été révoquée depuis un autre appareil, si le compte a été supprimé, ou si l’appareil est resté très longtemps hors ligne. Reconnectez-vous avec votre identifiant et votre code secret ; vos discussions seront toujours là.',
  { next: ['login', 'revoke'] });
T('profile_name', 'Comment changer mon nom d’affichage ?', ['nom d affichage', 'changer nom', 'modifier nom', 'pseudo', 'changer pseudo', 'renommer mon profil', 'mon nom'],
  'Votre nom d’affichage (1 à 40 caractères) est visible par vos contacts. Pour le changer : **Paramètres → Profil → Modifier le nom**. Je peux le faire avec vous : appuyez sur le bouton ci-dessous.',
  { acts: [A('Modifier mon nom', 'name')], next: ['profile_photo', 'nickname'] });
T('profile_photo', 'Comment changer ma photo de profil ?', ['photo profil', 'photo de profil', 'avatar', 'changer photo profil', 'ma photo', 'image de profil', 'supprimer photo profil'],
  'Dans **Paramètres → Profil**, touchez votre photo. L’image est recadrée en carré (256 px) et convertie sur votre appareil : les informations cachées de la photo d’origine (lieu, appareil…) ne sont jamais envoyées. Elle n’est visible que par vous et vos contacts de discussion, et elle est supprimée avec le compte.',
  { acts: [A('Choisir une photo', 'photo'), A('Supprimer ma photo', 'rmphoto')], next: ['profile_name', 'privacy'] });

// ---- Discussions
T('start_chat', 'Comment démarrer une discussion ?', ['demarrer discussion', 'nouvelle discussion', 'nouvelle conversation', 'commencer discussion', 'ecrire a quelqu un', 'contacter quelqu un', 'ajouter contact', 'nouveau contact', 'parler a quelqu un', 'ajouter un ami', 'ajouter ami'],
  'Sur l’écran d’accueil, touchez le bouton **+**, puis saisissez l’**identifiant exact à 8 chiffres** de la personne : la discussion s’ouvre dès qu’elle est trouvée. Vous pouvez aussi lui donner votre propre identifiant pour qu’elle vous écrive.',
  { acts: [A('Nouvelle discussion', 'go', { h: '#/new' }), A('Inviter quelqu’un', 'invite')], next: ['find_person', 'invite', 'groups_intro'] });
T('find_person', 'Comment retrouver quelqu’un sur Piaf ?', ['retrouver quelqu un', 'chercher quelqu un', 'trouver quelqu un', 'rechercher personne', 'chercher contact', 'annuaire', 'rechercher par nom', 'trouver par nom', 'trouver ami'],
  'Piaf ne propose **pas d’annuaire** : on ne retrouve quelqu’un que par son **identifiant exact à 8 chiffres** (ni nom, ni numéro, ni e-mail). C’est volontaire : personne ne peut être découvert sans l’avoir décidé. Demandez simplement son identifiant à la personne, ou donnez-lui le vôtre.',
  { acts: [A('Nouvelle discussion', 'go', { h: '#/new' }), A('Inviter quelqu’un', 'invite')], next: ['invite', 'start_chat'] });
T('invite', 'Comment inviter un ami sur Piaf ?', ['inviter ami', 'inviter quelqu un', 'inviter un proche', 'inviter', 'invitation', 'partager identifiant', 'donner mon identifiant', 'faire venir', 'parrainer', 'partager piaf', 'faire connaitre piaf'],
  'Pour inviter quelqu’un, partagez-lui **votre identifiant** et le lien de l’application ; il créera son compte, puis vous retrouvera avec votre identifiant. J’ai préparé un message d’invitation : vous pouvez le partager ou le copier.',
  { acts: [A('Partager l’invitation', 'invite'), A('Copier l’invitation', 'copy', { k: 'invite' })], next: ['start_chat', 'create_account'] });
T('conv_list', 'Comment fonctionne l’écran d’accueil ?', ['ecran d accueil', 'liste des discussions', 'onglets', 'ecran principal', 'liste discussions', 'page d accueil', 'accueil'],
  'L’accueil liste vos discussions par date de dernier message, avec trois onglets : **Discussions**, **Favoris** et **Archivées**. Un badge indique les messages non lus. La barre de recherche filtre par nom, identifiant ou aperçu, et le menu ⋯ de chaque discussion propose favori, archive, silence et renommage.',
  { next: ['favorites', 'archive', 'mute', 'unread'] });
T('favorites', 'Comment mettre une discussion en favori ?', ['favori', 'favoris', 'mettre en favori', 'epingler discussion', 'discussion preferee'],
  'Touchez le menu **⋯** de la discussion (ou, dans la discussion, le menu en haut → « Favori, archive, silence, renommer… ») puis « Mettre en favori ». Elle apparaît alors dans l’onglet **Favoris**, avec une étoile. Si vous me donnez le nom de la discussion (« mets Marie en favori »), je vous prépare le bouton.',
  { next: ['archive', 'mute', 'nickname'] });
T('archive', 'Comment archiver une discussion ?', ['archiver', 'archive', 'archivee', 'desarchiver', 'ranger discussion', 'masquer discussion'],
  'Menu **⋯** de la discussion → « Archiver ». Elle quitte la liste principale et se retrouve dans l’onglet **Archivées**. Elle **réapparaît automatiquement** à la réception d’un nouveau message. Pour la sortir des archives vous-même : « Désarchiver ».',
  { next: ['favorites', 'mute', 'clear_history'] });
T('mute', 'Comment mettre une discussion en silence ?', ['silence', 'mettre en silence', 'muet', 'sourdine', 'couper notifications discussion', 'ne plus etre derange', 'reactiver notifications discussion'],
  'Menu **⋯** de la discussion → « Mettre en silence ». Vous ne recevez plus de notification pour cette discussion, mais les messages arrivent normalement (une icône de cloche barrée s’affiche). « Réactiver les notifications » annule le silence.',
  { next: ['notifications', 'favorites'] });
T('nickname', 'Comment renommer une discussion ?', ['renommer discussion', 'renommer conversation', 'surnom', 'changer nom contact', 'nom du contact', 'renommer contact', 'nom perso'],
  'Menu **⋯** → « Renommer (visible par moi seul) ». Le nouveau nom n’apparaît que chez vous ; la personne ne le voit pas, et son vrai nom reste dans son profil. Laissez le champ vide pour revenir au nom d’origine.',
  { next: ['favorites', 'profile_name'] });
T('clear_history', 'Comment effacer l’historique d’une discussion ?', ['supprimer historique', 'effacer historique', 'effacer discussion', 'vider conversation', 'supprimer conversation', 'supprimer discussion', 'effacer conversation', 'nettoyer discussion'],
  'Menu **⋯** → « Supprimer l’historique pour moi ». Les messages actuels disparaissent **de votre côté seulement** : l’autre personne les garde, et les nouveaux messages apparaîtront normalement. C’est définitif pour vous. Pour retirer un message pour tout le monde, voir « suppression de message ».',
  { next: ['delete_msg', 'archive'] });
T('search_msg', 'Comment rechercher un message ?', ['rechercher message', 'chercher message', 'retrouver message', 'recherche dans conversation', 'chercher dans discussion', 'ancien message', 'recherche'],
  'Dans une discussion, ouvrez le menu en haut puis **« Rechercher dans la conversation »**. Sur l’accueil, la barre de recherche filtre les discussions par nom, identifiant ou dernier message. Pour retrouver un message important plus tard, vous pouvez aussi l’**épingler** (5 par discussion).',
  { next: ['pin', 'conv_list'] });
T('unread', 'Que signifient les badges de messages non lus ?', ['badge', 'non lu', 'non lus', 'messages non lus', 'compteur', 'pastille', 'nouveau message'],
  'Le badge sur une discussion indique le nombre de messages reçus que vous n’avez pas encore ouverts ; celui de l’onglet « Discussions » les additionne. Ils disparaissent quand vous ouvrez la discussion. Écrivez « mes messages non lus » et je vous liste ceux qui vous attendent.',
  { next: ['msg_status', 'conv_list'] });
T('drafts', 'Mes brouillons sont-ils conservés ?', ['brouillon', 'brouillons', 'message non envoye', 'texte perdu', 'conserver texte'],
  'Oui : le texte que vous avez commencé à écrire dans une discussion est gardé en brouillon sur votre appareil, et retrouvé quand vous revenez. Un message envoyé sans réseau est lui placé dans une **file d’envoi** et part au retour de la connexion, sans doublon.',
  { next: ['offline'] });

// ---- Messages
T('send_msg', 'Comment envoyer un message ?', ['envoyer message', 'envoie message', 'ecrire message', 'ecrire un message', 'taper message', 'limite caracteres', 'message trop long', 'longueur message', 'nombre de caracteres', 'envoyer un texte'],
  'Ouvrez une discussion, écrivez dans la zone « Message » puis touchez l’avion en papier. Un message peut faire jusqu’à **4 000 caractères**. Les liens http(s) sont cliquables. Je peux aussi transmettre un message à votre place : écrivez par exemple « écris à Marie : j’arrive dans 10 minutes ».',
  { next: ['reply', 'msg_status', 'offline', 'send_photo'] });
T('msg_menu', 'Que puis-je faire avec un message ?', ['actions message', 'menu message', 'options message', 'toucher un message', 'appuyer sur un message', 'que faire avec un message'],
  'Touchez un message pour ouvrir ses actions : **réagir** avec un emoji, **répondre**, **copier**, **transférer**, **épingler**, **modifier** (vos textes récents), **supprimer** pour vous ou pour tout le monde, et **signaler** un message reçu. Pour une photo ou une vidéo : télécharger.',
  { next: ['reply', 'react', 'edit_msg', 'delete_msg', 'forward', 'pin'] });
T('reply', 'Comment répondre à un message précis ?', ['repondre', 'repondre a un message', 'citer message', 'citation message', 'reponse a un message'],
  'Touchez le message puis **« Répondre »** : le message cité s’affiche au-dessus de votre texte, ce qui évite les malentendus dans les discussions animées, surtout dans les groupes.',
  { next: ['react', 'forward', 'msg_menu'] });
T('edit_msg', 'Comment modifier un message envoyé ?', ['modifier message', 'corriger message', 'modifier un message', 'corriger faute', 'faute dans message', 'editer message', 'changer message'],
  'Touchez votre message puis **« Modifier »**. Vous pouvez corriger vos messages texte pendant **24 heures** après l’envoi ; une mention « modifié » apparaît ensuite. Les photos et vidéos ne se modifient pas (vous pouvez les supprimer).',
  { next: ['delete_msg', 'msg_menu'] });
T('delete_msg', 'Comment supprimer un message ?', ['supprimer message', 'effacer message', 'supprimer un message', 'retirer message', 'supprimer pour tout le monde', 'supprimer pour moi', 'message envoye par erreur', 'annuler envoi'],
  'Touchez le message : **« Supprimer pour moi »** le retire de votre côté seulement ; **« Supprimer pour tout le monde »** le retire pour tous. Pour un texte, le second choix est possible pendant **48 heures** après l’envoi ; pour une photo ou une vidéo, l’auteur peut le faire à tout moment (le fichier est réellement supprimé du serveur). Dans un groupe, un administrateur peut aussi supprimer pour tout le monde.',
  { next: ['edit_msg', 'quota', 'clear_history'] });
T('react', 'Comment réagir à un message avec un emoji ?', ['reaction', 'reagir', 'emoji', 'emojis', 'pouce', 'smiley', 'coeur message'],
  'Touchez un message, puis choisissez l’une des six réactions : 👍 ❤️ 😂 😮 😢 🙏. Toucher à nouveau la même réaction la retire. Tout le monde voit les réactions sous le message.',
  { next: ['reply', 'msg_menu'] });
T('forward', 'Comment transférer un message ?', ['transferer', 'transfert', 'faire suivre', 'renvoyer message', 'partager message', 'retransmettre', 'envoyer a quelqu un d autre'],
  'Touchez le message → **« Transférer »**, puis choisissez la discussion de destination. Il est envoyé avec la mention « Transféré ». Seuls les **textes** se transfèrent pour l’instant : pas les photos ni les vidéos.',
  { next: ['msg_menu', 'copy_msg'] });
T('pin', 'Comment épingler un message ?', ['epingler', 'epingle', 'message epingle', 'desepingler', 'garder message', 'message important'],
  'Touchez le message → **« Épingler »**. Vous pouvez épingler jusqu’à **5 messages** par discussion ; « Désépingler » libère une place. Pratique pour garder une adresse, un horaire ou une consigne sous la main.',
  { next: ['search_msg', 'msg_menu'] });
T('copy_msg', 'Comment copier un message ?', ['copier message', 'copier texte', 'copier le texte', 'copier un message', 'copier coller'],
  'Touchez le message → **« Copier »**. Le texte est placé dans le presse-papiers. Pour un message qui n’a pas pu partir, le menu propose « Copier le texte » et « Réessayer l’envoi ».',
  { next: ['forward', 'msg_menu'] });
T('msg_status', 'Que signifient « envoyé », « distribué » et « lu » ?', ['statut message', 'envoye distribue lu', 'coches', 'coche', 'double coche', 'accuse reception', 'accuse de reception', 'message lu', 'message distribue', 'statuts', 'horloge', 'vu'],
  'Sous vos messages :\n• **horloge** : en cours d’envoi\n• **envoyé** : enregistré sur le serveur\n• **distribué** : l’application du destinataire a bien reçu le message\n• **lu** : le destinataire a ouvert la discussion avec le message visible (avec l’heure)\n• **échec** : le message n’est pas parti, touchez-le pour réessayer\nLe statut « lu » dépend des confirmations de lecture, que chacun peut désactiver.',
  { next: ['read_receipts', 'offline'] });
T('read_receipts', 'Comment désactiver les confirmations de lecture ?', ['confirmation lecture', 'confirmations de lecture', 'accuse de lecture', 'accuses de lecture', 'desactiver lu', 'cacher que j ai lu', 'masquer lu', 'recu de lecture', 'lu par'],
  (c) => `Dans **Paramètres → Confidentialité → Confirmations de lecture**. Attention, c’est **réciproque** : si vous les désactivez, les autres ne voient plus quand vous lisez leurs messages, et vous ne voyez plus les leurs ; « distribué » reste affiché. Actuellement, elles sont **${c.settings.read_receipts ? 'activées' : 'désactivées'}**.`,
  { acts: (c) => [c.settings.read_receipts ? A('Désactiver les confirmations', 'receipts', { v: false }) : A('Activer les confirmations', 'receipts', { v: true })], next: ['msg_status', 'privacy'] });
T('offline', 'Que se passe-t-il si je n’ai pas de réseau ?', ['hors connexion', 'hors ligne', 'pas de reseau', 'sans internet', 'sans reseau', 'message pas envoye', 'echec envoi', 'echec d envoi', 'message en attente', 'reessayer envoi', 'file d envoi', 'mode avion', 'pas de wifi', 'message non parti', 'message bloque', 'ne part pas', 'ne partent pas', 'message ne part pas', 'messages ne partent pas', 'pas parti', 'pas partis', 'n est pas parti', 'ne s envoie pas', 'ne s envoient pas'],
  'Sans réseau, Piaf vous le signale par un bandeau « Hors connexion ». Vos messages sont **mis en file d’attente** et partent automatiquement au retour de la connexion, **sans doublon**. Si un message affiche un échec, touchez-le puis « Réessayer l’envoi ». Les photos et vidéos, elles, demandent une connexion pour être envoyées.',
  { acts: [A('Actualiser mes discussions', 'refresh')], next: ['connection', 'bug', 'msg_status'] });
T('links', 'Les liens dans les messages sont-ils sûrs ?', ['lien', 'liens', 'lien cliquable', 'liens cliquables', 'url', 'lien suspect', 'cliquer sur un lien'],
  'Les adresses http et https sont cliquables et s’ouvrent dans un nouvel onglet, sans transmettre d’informations de provenance. Piaf n’analyse pas les destinations : méfiez-vous d’un lien reçu d’un inconnu ou d’un message inattendu, même d’un contact (son compte peut être compromis).',
  { acts: [], next: ['phishing', 'report'] });

// ---- Photos et vidéos
T('send_photo', 'Comment envoyer une photo ou une vidéo ?', ['envoyer photo', 'envoyer video', 'envoie photo', 'envoie video', 'joindre', 'piece jointe', 'photo', 'photos', 'video', 'videos', 'envoyer image', 'partager photo', 'trombone', 'ajouter photo'],
  'Dans une discussion, touchez le **trombone** pour choisir des photos ou des vidéos. Vous pouvez en envoyer **jusqu’à 10 à la fois**, avec aperçu, barre de progression et possibilité d’annuler. Formats : photos JPEG, PNG, WebP, GIF, HEIC ; vidéos MP4, WebM, MOV. Taille maximale : **10 Mo par photo, 25 Mo par vidéo**.',
  { next: ['media_limits', 'gallery', 'quota', 'delete_msg'] });
T('media_limits', 'Quelle est la taille maximale des fichiers ?', ['taille maximale', 'taille max', 'poids maximum', 'trop volumineux', 'fichier trop gros', 'fichier trop lourd', 'limite photo', 'limite video', 'taille photo', 'taille video', 'poids photo', 'poids video', 'formats acceptes', 'format photo', 'format video', 'heic', 'mov', 'compresser'],
  'Limites par défaut : **photo 10 Mo**, **vidéo 25 Mo**, **10 fichiers par envoi**. Formats acceptés : JPEG, PNG, WebP, GIF, HEIC (photos) ; MP4, WebM, MOV (vidéos). Les PDF et autres documents ne sont pas acceptés. Si une vidéo est trop lourde, raccourcissez-la ou réduisez sa qualité avant de l’envoyer.',
  { next: ['quota', 'send_photo', 'missing'] });
T('quota', 'Pourquoi mon espace de médias est-il plein ?', ['quota', 'espace plein', 'stockage plein', 'gerer medias', 'liberer espace', 'liberer de la place', 'quota depasse', 'plus de place', 'espace media', 'depasse le quota'],
  'Chaque discussion dispose d’un quota de médias de **100 Mo**, partagé entre les participants (par groupe pour un groupe). Quand il est atteint, Piaf propose « Gérer les médias » : supprimez des photos ou vidéos **pour tout le monde** pour libérer de l’espace. Télécharger un fichier ne libère pas d’espace sur le serveur ; seule la suppression le fait.',
  { next: ['gallery', 'delete_msg', 'media_limits'] });
T('gallery', 'Où retrouver les photos et vidéos d’une discussion ?', ['galerie', 'medias partages', 'voir photos recues', 'retrouver photos', 'toutes les photos', 'telecharger photo', 'enregistrer photo', 'telecharger video', 'sauvegarder photo', 'visionneuse'],
  'Dans la discussion, menu en haut → **« Médias partagés »** : toutes les photos et vidéos en grille, avec la visionneuse plein écran. Pour enregistrer un fichier, touchez son message → « Télécharger ». Les galeries chargent les fichiers d’origine : sur réseau mobile, cela peut consommer des données.',
  { next: ['quota', 'send_photo'] });
T('delete_media', 'Comment supprimer une photo envoyée ?', ['supprimer photo', 'supprimer video', 'effacer photo', 'effacer video', 'retirer photo', 'photo envoyee par erreur', 'supprimer un media', 'supprimer media'],
  'Touchez la photo ou la vidéo → **« Supprimer pour tout le monde »** : le fichier disparaît de la discussion et il est **réellement supprimé du serveur**, ce qui libère votre quota. « Supprimer pour moi » ne la masque que chez vous. Les copies déjà téléchargées par d’autres restent, bien sûr, sur leurs appareils.',
  { next: ['quota', 'delete_msg'] });

// ---- Groupes
T('groups_intro', 'Comment fonctionnent les groupes ?', ['groupe', 'groupes', 'discussion de groupe', 'conversation de groupe', 'discussion a plusieurs', 'a plusieurs', 'groupe piaf'],
  'Un groupe réunit de **2 à 32 personnes**. Chaque groupe a un nom, une photo, des **administrateurs** et des membres ; les messages, réactions, réponses et médias fonctionnent comme dans une discussion à deux. Les nouveaux arrivants **ne voient pas l’historique** antérieur, et un quota de médias de 100 Mo est partagé dans le groupe.',
  { acts: [A('Créer un groupe', 'go', { h: '#/g/new' })], next: ['group_create', 'group_roles', 'group_history', 'group_leave'] });
T('group_create', 'Comment créer un groupe ?', ['creer groupe', 'creer un groupe', 'nouveau groupe', 'faire un groupe', 'fonder groupe', 'creation groupe', 'monter un groupe', 'ouvrir un groupe'],
  'Sur l’accueil, touchez **+** puis **« Nouveau groupe »**. Donnez-lui un nom (et une photo si vous voulez), puis choisissez les membres parmi **vos contacts** : les personnes avec qui vous avez déjà une discussion et les membres de vos groupes. Vous devenez administrateur. Pour inviter quelqu’un qui n’est pas encore dans vos contacts, commencez d’abord une discussion avec lui via son identifiant.',
  { acts: [A('Créer un groupe', 'go', { h: '#/g/new' }), A('Idées de noms', 'say', { t: 'Idées de nom de groupe' })], next: ['group_members', 'group_ideas', 'group_roles'] });
T('group_members', 'Comment ajouter ou retirer un membre ?', ['ajouter membre', 'ajouter un membre', 'retirer membre', 'retirer un membre', 'exclure', 'exclure membre', 'virer', 'ajouter quelqu un au groupe', 'inviter dans groupe', 'enlever du groupe', 'supprimer membre'],
  'Ouvrez le groupe → menu en haut → **« Infos du groupe et membres »**. Les **administrateurs** peuvent y **ajouter des membres** (jusqu’à 32 au total) et **retirer** quelqu’un ; la personne retirée perd l’accès aux messages et aux fichiers du groupe. Un membre ajouté ne voit pas l’historique d’avant son arrivée.',
  { next: ['group_roles', 'group_history', 'group_leave'] });
T('group_roles', 'Quelle différence entre administrateur et membre ?', ['administrateur', 'admin', 'admins', 'role', 'roles', 'nommer administrateur', 'devenir administrateur', 'droits groupe', 'permissions groupe', 'retirer role administrateur'],
  'Le créateur d’un groupe en est **administrateur**, et peut nommer d’autres administrateurs. Les administrateurs ajoutent ou retirent des membres, changent le nom et la photo, et peuvent supprimer un message pour tout le monde ou supprimer le groupe. Les **membres** écrivent, réagissent, partagent des médias et peuvent quitter le groupe. Il faut toujours au moins un administrateur.',
  { next: ['group_members', 'group_delete'] });
T('group_leave', 'Comment quitter un groupe ?', ['quitter groupe', 'quitter un groupe', 'sortir du groupe', 'sortir groupe', 'partir du groupe', 'quitter la conversation de groupe'],
  'Ouvrez le groupe → **« Infos du groupe et membres »** → **« Quitter le groupe »**. Vous n’y recevez plus rien. Si vous êtes la dernière personne du groupe, il faut le supprimer plutôt que le quitter ; si vous êtes le dernier administrateur, nommez d’abord un autre administrateur.',
  { next: ['group_delete', 'group_roles'] });
T('group_delete', 'Comment supprimer un groupe ?', ['supprimer groupe', 'supprimer un groupe', 'effacer groupe', 'dissoudre groupe', 'fermer groupe'],
  'Un **administrateur** peut supprimer le groupe : Infos du groupe → **« Supprimer le groupe »**, après confirmation. Le groupe, ses messages et ses fichiers disparaissent pour tous les membres. Si vous voulez simplement partir, choisissez plutôt « Quitter le groupe ».',
  { next: ['group_leave', 'group_roles'] });
T('group_history', 'Un nouveau membre voit-il les anciens messages ?', ['historique groupe', 'nouveau membre voit', 'anciens messages groupe', 'nouveau dans le groupe', 'voir historique', 'messages avant mon arrivee', 'historique masque'],
  'Non, par confidentialité : une personne ajoutée à un groupe **ne voit que les messages envoyés après son arrivée**. Les messages antérieurs ne lui sont pas accessibles, ni les fichiers partagés avant. Prévenez-la si vous voulez lui transmettre une information plus ancienne.',
  { next: ['group_members', 'privacy'] });
T('group_identity', 'Comment changer le nom ou la photo d’un groupe ?', ['nom du groupe', 'photo du groupe', 'renommer groupe', 'changer nom groupe', 'changer photo groupe', 'icone groupe', 'modifier groupe', 'avatar groupe'],
  'Les administrateurs ouvrent **« Infos du groupe et membres »** : on y change le **nom** et la **photo** du groupe. Chaque membre peut en plus renommer le groupe **pour lui seul** (menu « Favori, archive, silence, renommer pour moi… »).',
  { next: ['group_roles', 'nickname'] });
T('group_read', 'Que signifie « lu par 3/8 » dans un groupe ?', ['lu par', 'qui a lu groupe', 'qui a lu', 'accuse groupe', 'compteur lecture groupe', 'vu par'],
  'Dans un groupe, les statuts deviennent des compteurs : « **lu par 3/8** » signifie que 3 des 8 membres ont lu votre message. Seuls les membres qui ont leurs confirmations de lecture activées sont comptés, et le compteur se rafraîchit toutes les 20 secondes environ.',
  { next: ['read_receipts', 'msg_status'] });
T('group_limits', 'Combien de personnes dans un groupe ?', ['combien membres', 'nombre de membres', 'taille groupe', 'limite groupe', 'groupe plein', 'maximum groupe', 'max membres', '32 personnes'],
  'Un groupe peut compter **jusqu’à 32 personnes**. Le quota de médias (100 Mo par défaut) est **partagé par le groupe** : en cas de saturation, supprimez des photos ou vidéos pour tout le monde pour libérer de l’espace.',
  { next: ['quota', 'group_create'] });
T('group_ideas', 'Idées de nom de groupe', ['idee nom groupe', 'idees nom groupe', 'nom pour groupe', 'nom de groupe', 'trouver un nom', 'comment appeler groupe', 'nom original groupe', 'baptiser'],
  (c, qn) => {
    const sets = {
      famille: ['La Tribu', 'Les Chouettes de la famille', 'Famille en or', 'Le Clan', 'Grandes Tablées', 'Le Nid familial'],
      amis: ['Les Copains d’abord', 'La Bande à Piaf', 'Le QG', 'Les Joyeux Moineaux', 'Les Inséparables', 'La Volière'],
      travail: ['L’Équipe', 'Les Piafs du bureau', 'Café & Compagnie', 'Cap sur le projet', 'La Dream Team', 'Le Plateau'],
      sport: ['Les Gagnants du dimanche', 'Team Foulées', 'Les Maillots Jaunes', 'Allez, on s’active', 'Premier Sifflet', 'Le Banc de touche'],
      voisins: ['Les Voisins vigilants', 'Sur le palier', 'Allô, le quartier', 'Entre voisins', 'La Cour d’immeuble', 'Rue des Piafs'],
      vacances: ['Cap sur l’été', 'Valises & Sourires', 'Les Globe-trotteurs', 'Direction Soleil', 'Carnet de voyage', 'En route !'],
      classe: ['La Classe d’or', 'Promo Éternelle', 'Les Bons Élèves', 'La Récré', 'Sur les bancs', 'Les Têtes bien faites'],
      defaut: ['La Bande à Piaf', 'Le QG', 'Les Joyeux Moineaux', 'La Volière', 'Les Inséparables', 'Le Petit Nid', 'La Team', 'Les Pipelettes'],
    };
    const key = /famille|parents|cousin|frere|soeur/.test(qn) ? 'famille' : /ami|copain|pote|soiree/.test(qn) ? 'amis' : /travail|bureau|collegue|equipe|projet|boulot/.test(qn) ? 'travail'
      : /sport|foot|rugby|course|club|basket|velo/.test(qn) ? 'sport' : /voisin|immeuble|quartier|residence/.test(qn) ? 'voisins' : /vacance|voyage|weekend|week end|ete/.test(qn) ? 'vacances'
      : /classe|ecole|promo|etudiant|fac/.test(qn) ? 'classe' : 'defaut';
    const names = shuffle(sets[key]).slice(0, 3);
    return `Voici trois idées de noms de groupe :\n${names.map((n) => '• **' + n + '**').join('\n')}\nVous pouvez préciser le thème (famille, amis, travail, sport, voisins, vacances, classe) pour de nouvelles idées.`;
  },
  { acts: [A('Créer un groupe', 'go', { h: '#/g/new' })], chipsFn: () => [{ l: 'Autres idées', t: 'Idées de nom de groupe' }], next: ['group_create'] });

// ---- Sécurité et confidentialité
T('block', 'Comment bloquer quelqu’un ?', ['bloquer', 'blocage', 'debloquer', 'contact bloque', 'bloquer contact', 'bloquer quelqu un', 'ne plus recevoir de messages', 'quelqu un m embete', 'importun'],
  'Dans la discussion, menu en haut → **« Bloquer ce contact »**. Vous ne recevez plus ses messages ni ses médias et vous ne pouvez plus lui écrire tant que le blocage dure ; il **n’est pas prévenu**, et les messages déjà échangés restent visibles. Pour débloquer : même menu, ou **Paramètres → Contacts bloqués**.',
  { acts: [A('Voir les contacts bloqués', 'go', { h: '#/settings' })], next: ['report', 'security_tips'] });
T('report', 'Comment signaler un message ou une personne ?', ['signaler', 'signalement', 'abus', 'harcelement', 'spam', 'menace', 'menaces', 'usurpation', 'contenu inapproprie', 'denoncer', 'harcele', 'insulte recue', 'moderation'],
  'Touchez le message → **« Signaler ce message »**, ou ouvrez le profil du contact → **« Signaler cette personne »**. Choisissez un motif : spam ou publicité, harcèlement ou menaces, contenu inapproprié, usurpation d’identité (ou autre), puis confirmez. Vous pouvez aussi **bloquer** la personne. En cas de menace sérieuse, contactez les autorités : Piaf n’est pas un service d’urgence.',
  { next: ['block', 'security_tips'] });
T('privacy', 'Quelles données Piaf conserve-t-il ?', ['confidentialite', 'donnees personnelles', 'vie privee', 'rgpd', 'donnees conservees', 'que savez vous sur moi', 'protection des donnees', 'politique de confidentialite', 'cgu', 'mentions legales'],
  'Piaf ne demande **ni e-mail, ni téléphone**. Sont conservés sur le serveur : votre profil (nom, identifiant, photo), vos messages, vos médias (dans un espace privé, accessibles par liens signés qui expirent en 10 minutes) et vos réglages. La page **Confidentialité** détaille chaque donnée et sa durée de conservation. Vous pouvez tout effacer en supprimant votre compte.',
  { acts: [A('Ouvrir la page Confidentialité', 'privacy')], next: ['encryption', 'who_sees', 'delete_account'] });
T('encryption', 'Les messages sont-ils chiffrés de bout en bout ?', ['chiffrement', 'chiffre', 'e2e', 'bout en bout', 'securise', 'securite', 'est ce sur', 'piaf est sur', 'confidentiel', 'espionner', 'qui peut lire mes messages', 'lire mes messages'],
  'Soyons précis : les échanges sont protégés pendant leur transport (HTTPS) et l’accès aux données est strictement limité aux participants d’une discussion ; les fichiers sont dans un espace privé. En revanche, Piaf **n’offre pas de chiffrement de bout en bout** : l’hébergeur technique, qui stocke les messages, pourrait en théorie y accéder. Ne confiez pas à Piaf ce qui exige un secret absolu.',
  { next: ['privacy', 'security_tips', 'missing'] });
T('who_sees', 'Que voient les autres de mon profil ?', ['qui voit', 'visible par', 'ce que les autres voient', 'qui voit mon profil', 'mon profil visible', 'informations visibles', 'qui voit ma photo'],
  'Vos contacts voient votre **nom d’affichage**, votre **photo** et votre **identifiant**. Ils voient aussi quand vos messages sont distribués et, si vous avez activé les confirmations de lecture, quand vous les lisez. Votre code secret n’est jamais visible. Le surnom que vous donnez à un contact n’est visible que par vous.',
  { next: ['read_receipts', 'profile_photo'] });
T('data_export', 'Puis-je exporter mes données ?', ['exporter', 'export', 'exporter donnees', 'export de donnees', 'telecharger mes donnees', 'sauvegarde', 'sauvegarder discussions', 'archive complete', 'copie de mes messages', 'recuperer mes messages'],
  'Il n’existe pas encore d’export de vos données dans l’application. Vous pouvez copier des messages un par un (« Copier ») et télécharger vos photos et vidéos depuis la visionneuse. La page Confidentialité explique comment faire valoir vos droits sur vos données.',
  { acts: [A('Ouvrir la page Confidentialité', 'privacy')], next: ['privacy', 'gallery'] });
T('security_tips', 'Comment sécuriser mon compte ?', ['securiser compte', 'conseils securite', 'proteger compte', 'securite compte', 'bonnes pratiques', 'proteger mes donnees', 'conseil de securite', 'rester en securite', 'proteger ma vie privee'],
  'Mes conseils :\n• choisissez un **code secret long** (une phrase) et ne le réutilisez jamais ailleurs\n• ne communiquez jamais votre code : personne ne doit vous le demander\n• gardez votre identifiant et votre code dans un gestionnaire de mots de passe ou sur papier, en lieu sûr\n• en cas de perte ou de prêt d’un appareil, **révoquez les autres sessions**\n• méfiez-vous des liens et demandes inattendues, même d’un contact\n• bloquez et signalez les comportements abusifs',
  { links: [LK('Conseils de la CNIL sur les mots de passe', 'https://cnil.fr/fr/mots-de-passe-recommandations-pour-maitriser-sa-securite'), LK('Cybermalveillance.gouv.fr', 'https://www.cybermalveillance.gouv.fr/')], acts: [A('Idée de code secret', 'pass'), A('Révoquer les autres sessions', 'revoke')], next: ['phishing', 'secret_code', 'block'] });
T('phishing', 'Comment reconnaître une arnaque ou un hameçonnage ?', ['hameconnage', 'arnaque', 'phishing', 'escroquerie', 'faux message', 'message suspect', 'fraude', 'arnaque en ligne', 'faux site', 'on m a demande mon code', 'demande d argent'],
  'Quelques réflexes : méfiez-vous des messages **urgents**, des promesses de gain, des demandes d’argent, de code ou d’identifiants, et des liens raccourcis. **Aucun service sérieux — et surtout pas Piaf — ne vous demandera votre code secret** dans une discussion. En cas de doute, ne cliquez pas, vérifiez par un autre canal, bloquez et signalez l’expéditeur.',
  { links: [LK('Cybermalveillance.gouv.fr — assistance aux victimes', 'https://www.cybermalveillance.gouv.fr/')], next: ['report', 'block', 'security_tips'] });
T('pass_gen', 'Propose-moi une phrase secrète', ['phrase secrete', 'generer code', 'idee code secret', 'propose moi un code', 'phrase de passe', 'generer mot de passe', 'creer un mot de passe', 'code aleatoire', 'suggere un code', 'generateur'],
  'Je peux vous proposer une phrase composée de mots tirés au hasard : appuyez sur le bouton. Elle est générée sur votre appareil et **n’est enregistrée nulle part** : ce message n’est même pas conservé dans l’historique. Si vous l’adoptez, notez-la tout de suite en lieu sûr.',
  { acts: [A('Générer une phrase secrète', 'pass')], next: ['secret_code', 'create_account'] });

// ---- Réglages et application
T('notifications', 'Comment activer les notifications ?', ['notification', 'notifications', 'alerte', 'alertes', 'prevenir', 'activer notifications', 'desactiver notifications', 'sonnerie', 'etre prevenu', 'avertir'],
  (c) => `Dans **Paramètres → Notifications**, activez « Prévenir des nouveaux messages » ; votre navigateur demande alors l’autorisation. Piaf affiche le nom de l’expéditeur et un aperçu. Elles fonctionnent tant que l’application est **ouverte ou en arrière-plan** ; il n’y a pas encore d’alerte lorsqu’elle est totalement fermée. État actuel : ${c.perm === 'granted' && c.settings.notifications ? '**activées**' : c.perm === 'denied' ? '**bloquées dans le navigateur**' : c.perm === 'unsupported' ? '**non disponibles sur ce navigateur**' : '**désactivées**'}.`,
  { acts: (c) => c.perm === 'granted' && c.settings.notifications ? [A('Désactiver les notifications', 'notif', { v: false })] : c.perm === 'unsupported' || c.perm === 'denied' ? [A('Ouvrir les paramètres', 'go', { h: '#/settings' })] : [A('Activer les notifications', 'notif', { v: true })], next: ['notif_problem', 'mute', 'install'] });
T('notif_problem', 'Je ne reçois pas de notifications', ['pas de notification', 'notifications ne marchent pas', 'notifications ne fonctionnent pas', 'je ne recois pas de notification', 'notification ne marche pas', 'pas d alerte', 'aucune notification', 'notif', 'notifs', 'notification absente', 'rien ne sonne'],
  'Vérifions dans l’ordre :\n• **Paramètres → Notifications** doit être activé\n• l’autorisation du navigateur ne doit pas être refusée (réglages du site, ou de l’application sur téléphone)\n• la discussion ne doit pas être **en silence**\n• l’application doit être **ouverte ou en arrière-plan** : pas d’alerte lorsqu’elle est totalement fermée, ou quand le système l’a mise en veille (économiseur de batterie)\n• sur **iPhone**, il faut d’abord installer Piaf sur l’écran d’accueil (iOS 16.4 ou plus)',
  { acts: (c) => [A('Ouvrir les paramètres', 'go', { h: '#/settings' }), c.installable ? A('Installer Piaf', 'install') : null].filter(Boolean), next: ['install', 'mute', 'missing'] });
T('install', 'Comment installer Piaf sur mon téléphone ?', ['installer application', 'installer piaf', 'pwa', 'ajouter a l ecran', 'installer sur telephone', 'icone sur telephone', 'mettre piaf sur mon telephone', 'telecharger application', 'telecharger piaf', 'app store', 'play store', 'installation'],
  (c) => `Piaf est une application web installable, sans magasin d’applications :\n• **iPhone** : dans Safari, touchez Partager puis « Sur l’écran d’accueil »\n• **Android** : menu ⋮ du navigateur puis « Installer l’application »\n• **Ordinateur** : icône d’installation dans la barre d’adresse (Chrome, Edge…)\nInstallée, elle s’ouvre en plein écran comme une application ordinaire.${c.standalone ? '\nBonne nouvelle : vous utilisez déjà la version installée.' : ''}`,
  { acts: (c) => c.installable ? [A('Installer Piaf', 'install')] : [], next: ['notif_problem', 'desktop', 'update'] });
T('theme', 'Comment passer en mode sombre ?', ['theme', 'mode sombre', 'mode clair', 'sombre', 'apparence', 'dark mode', 'couleurs', 'fond noir', 'luminosite', 'theme sombre', 'theme clair', 'nuit'],
  (c) => `Dans **Paramètres → Apparence**, choisissez Automatique (suit le réglage de votre appareil), Clair ou Sombre. Le thème actuel est **${{ auto: 'automatique', light: 'clair', dark: 'sombre' }[c.theme] || 'automatique'}**. Les boutons ci-dessous changent le thème tout de suite.`,
  { acts: [A('Sombre', 'theme', { m: 'dark' }), A('Clair', 'theme', { m: 'light' }), A('Automatique', 'theme', { m: 'auto' })], next: ['notifications', 'install'] });
T('update', 'Comment mettre Piaf à jour ?', ['mise a jour', 'nouvelle version', 'ne se met pas a jour', 'vider cache', 'actualiser application', 'recharger application', 'version ancienne', 'cache', 'rafraichir', 'ancienne version'],
  'Piaf se met à jour **tout seul** : à chaque ouverture avec du réseau, l’application charge la dernière version. Si vous avez l’impression d’avoir une ancienne version ou un affichage cassé, fermez complètement l’application puis rouvrez-la. Sinon, utilisez le bouton ci-dessous : il recharge l’application et vide son cache local (votre session et vos discussions ne sont pas touchées).',
  { acts: [A('Recharger l’application', 'reload'), A('Vider le cache et recharger', 'clearcache')], next: ['bug', 'install'] });
T('connection', 'Suis-je bien connecté ?', ['suis je connecte', 'etat de la connexion', 'connexion internet', 'reseau', 'en ligne', 'est ce que ca marche', 'temps reel', 'reconnexion', 'etat connexion', 'je suis en ligne'],
  (c) => `${c.online ? 'Votre appareil est **en ligne**.' : 'Votre appareil est **hors connexion** : les messages partiront au retour du réseau.'} ${c.online ? (c.rt === 'SUBSCRIBED' ? 'La réception en direct est **active** : vos messages arrivent en temps réel.' : 'La réception en direct est en cours de (re)connexion ; patientez un instant ou actualisez.') : ''}`.trim(),
  { acts: [A('Actualiser mes discussions', 'refresh')], next: ['offline', 'bug'] });
T('bug', 'Piaf ne fonctionne pas correctement', ['bug', 'probleme', 'ca marche pas', 'ne marche pas', 'ne fonctionne pas', 'erreur', 'plante', 'plantage', 'bloque', 'ne repond pas', 'ecran blanc', 'lent', 'lenteur', 'dysfonctionnement', 'panne', 'souci', 'impossible'],
  'Essayons dans l’ordre :\n• vérifiez votre connexion (bandeau « Hors connexion » en haut)\n• actualisez vos discussions\n• rechargez l’application, puis videz son cache si le problème persiste\n• si la session est terminée, reconnectez-vous avec votre identifiant et votre code\n• pour un fichier refusé : vérifiez le format et la taille\nSi rien ne change, notez le message d’erreur affiché et signalez-le à l’éditeur de l’application.',
  { acts: [A('Actualiser mes discussions', 'refresh'), A('Recharger l’application', 'reload'), A('Vider le cache et recharger', 'clearcache')], next: ['connection', 'update', 'media_limits'] });
T('limits', 'Quelles sont les limites de Piaf ?', ['limite', 'limites', 'quotas', 'recapitulatif', 'maximum', 'plafond', 'restrictions', 'tableau des limites'],
  'Les principales limites (valeurs par défaut) :\n• message : **4 000 caractères**\n• photo : **10 Mo** ; vidéo : **25 Mo** ; **10 fichiers** par envoi\n• médias : **100 Mo** par discussion ou par groupe\n• groupe : **32 personnes**\n• messages épinglés : **5** par discussion\n• modification d’un message : **24 h** ; suppression pour tous (texte) : **48 h**\n• réactions : **6** emojis\n• nom d’affichage : 40 caractères ; code secret : 8 à 64 caractères',
  { next: ['media_limits', 'quota', 'group_limits'] });
T('contact_dev', 'Comment contacter l’éditeur de Piaf ?', ['suggestion', 'idee amelioration', 'contacter developpeur', 'contacter editeur', 'contact', 'remarque', 'signaler un bug', 'support', 'assistance', 'service client', 'avis', 'ameliorer piaf', 'proposition'],
  'Piaf est développé par **Ehorg**. Les coordonnées de l’éditeur sont indiquées dans la page **Confidentialité** (quand elles sont renseignées) : c’est le bon endroit pour envoyer une suggestion, un signalement de bug ou une demande concernant vos données.',
  { acts: [A('Ouvrir la page Confidentialité', 'privacy')], next: ['who_made', 'bug'] });

// ---- À propos de l'assistant
T('what_can_you_do', 'Que peux-tu faire ?', ['aide', 'aide moi', 'help', 'que peux tu faire', 'que sais tu faire', 'tes capacites', 'tes fonctions', 'comment ca marche', 'a quoi tu sers', 'que sais tu', 'quoi demander', 'menu', 'possibilites assistant', 'peux tu m aider', 'besoin d aide', 'sujets'],
  'Je suis l’assistant de Piaf. Je peux :\n• **répondre** à vos questions sur le compte, les discussions, les groupes, les médias, la sécurité et les réglages\n• **agir à votre place** par des boutons : ouvrir un écran, démarrer une discussion avec un identifiant, mettre une discussion en favori, changer le thème, activer les notifications, inviter un ami, envoyer un message…\n• vous donner **l’heure**, **calculer**, tirer au sort, raconter une **blague**, aider à écrire un message\n• vous orienter vers des **liens** utiles\nPar exemple : « écris à Marie : j’arrive », « mes messages non lus », « 18 % de 240 », « idées de nom de groupe ».',
  { next: ['features', 'invite', 'security_tips', 'joke', 'msg_ideas'] });
T('who_are_you', 'Qui es-tu ?', ['qui es tu', 'tu es qui', 'presente toi', 'ton nom', 'comment tu t appelles', 'talk2piaf', 'talk to piaf', 'tu t appelles comment', 'qui est talk2piaf'],
  'Je suis **Talk2Piaf**, l’assistant intégré à Piaf. Je réponds à vos questions sur l’application, je peux réaliser des actions à votre place d’une simple pression sur un bouton, et je m’occupe aussi de quelques petits services du quotidien.',
  { next: ['what_can_you_do', 'who_made', 'are_you_ai'] });
T('who_made', 'Qui a créé cet assistant ?', ['qui t a cree', 'qui t a fait', 'qui t a developpe', 'developpeur', 'developpe par', 'createur', 'ehorg', 'qui a cree piaf', 'qui a fait piaf', 'auteur', 'editeur'],
  'J’ai été développé pour Piaf par **Ehorg**.',
  { next: ['contact_dev', 'about'] });
T('are_you_ai', 'Es-tu une intelligence artificielle ?', ['es tu une ia', 'intelligence artificielle', 'robot', 'chatbot', 'tu es humain', 'vraie personne', 'chatgpt', 'es tu humain', 'tu es un humain', 'une ia', 'vrai assistant', 'modele de langage', 'comment tu fonctionnes', 'tu fonctionnes comment'],
  'Je ne suis pas une personne : je suis l’assistant intégré à Piaf. Je fonctionne **directement sur votre appareil**, à partir d’une base de connaissances sur Piaf et de petites fonctions utiles ; je ne suis pas un grand modèle de langage et je ne consulte pas Internet. C’est pour cela que je suis rapide et que **rien de ce que vous m’écrivez ne quitte votre téléphone**, mais aussi que mes connaissances ont des limites : sur les sujets que je ne maîtrise pas, je vous le dis et je vous oriente.',
  { next: ['assistant_privacy', 'what_can_you_do'] });
T('assistant_privacy', 'Lis-tu mes messages ?', ['tu lis mes messages', 'acces a mes conversations', 'lis tu mes messages', 'confidentialite assistant', 'tu vois mes messages', 'espionnes tu', 'tu m espionnes', 'historique assistant', 'effacer historique assistant', 'effacer notre discussion', 'ce que je te dis'],
  'Non : je n’utilise pas le contenu de vos messages. Pour vous aider à ouvrir une discussion ou à la mettre en favori, je me sers uniquement de la **liste de vos discussions** (noms, favoris, messages non lus). Notre échange reste **sur cet appareil**, dans ce navigateur ; il n’est envoyé nulle part, et vous pouvez l’effacer à tout moment depuis le menu en haut de cette fenêtre.',
  { acts: [A('Effacer notre historique', 'forget')], next: ['privacy', 'are_you_ai'] });

// ---- Conversation courante (hors Piaf)
T('greeting', 'Bonjour', ['bonjour', 'salut', 'coucou', 'hello', 'bonsoir', 'hey', 'yo', 'bonne journee', 'bonne soiree', 'salutations', 'allo'],
  (c) => `${c.now.getHours() >= 18 || c.now.getHours() < 4 ? 'Bonsoir' : 'Bonjour'}${c.first ? ' ' + c.first : ''} ! Comment puis-je vous aider ? Je peux répondre à vos questions sur Piaf, faire des choses à votre place d’un simple bouton, ou simplement discuter de petites choses.`,
  { next: ['what_can_you_do', 'unread', 'invite'] });
T('how_are_you', 'Comment vas-tu ?', ['comment vas tu', 'ca va', 'tu vas bien', 'comment ca va', 'la forme', 'quoi de neuf', 'tu vas comment', 'comment allez vous'],
  () => pick(['Très bien, merci de demander ! Et vous ?', 'Tout va bien de mon côté : je suis prêt à vous aider. Et vous, comment allez-vous ?', 'En pleine forme ! Que puis-je faire pour vous ?']),
  { prio: 1.1, next: ['what_can_you_do', 'joke'] });
T('thanks', 'Merci', ['merci', 'merci beaucoup', 'thanks', 'super merci', 'parfait merci', 'nickel', 'impeccable', 'bravo', 'genial', 'excellent', 'top'],
  () => pick(['Avec plaisir !', 'Je vous en prie. N’hésitez pas si vous avez d’autres questions.', 'De rien ! Je reste là si besoin.', 'Content d’avoir pu aider !']),
  { next: ['what_can_you_do'] });
T('bye', 'Au revoir', ['au revoir', 'a bientot', 'a plus', 'bye', 'a demain', 'bonne nuit', 'adieu', 'ciao', 'a tout a l heure', 'bonne continuation'],
  (c) => pick([`À bientôt${c.first ? ' ' + c.first : ''} !`, 'Au revoir, à très vite sur Piaf !', 'Bonne continuation ! Je suis là si besoin.']),
  { next: [] });
T('insult', 'Tu es nul', ['tu es nul', 'nul', 'stupide', 'idiot', 'inutile', 'tu sers a rien', 'tu ne sers a rien', 'pas utile', 'tu comprends rien', 'mauvais', 'decevant'],
  'Je suis désolé de ne pas avoir été à la hauteur. Dites-moi ce que vous cherchiez à faire, avec d’autres mots si possible, et j’essaie autrement.',
  { prio: 0.9, next: ['what_can_you_do'] });
T('sad', 'Je ne me sens pas bien', ['triste', 'deprime', 'deprimee', 'ca va pas', 'je vais mal', 'mal aujourd hui', 'stresse', 'stress', 'angoisse', 'angoisses', 'anxieux', 'anxieuse', 'seul', 'seule', 'solitude', 'fatigue', 'epuise', 'epuisee', 'decouragee', 'cafard', 'pas le moral', 'j ai peur', 'pleure'],
  'Je suis désolé que ce soit difficile en ce moment. Vous pouvez m’en parler si cela vous aide, mais le plus précieux reste de vous tourner vers une personne de confiance — un proche, un ami, un professionnel. Si l’envie vous prend d’écrire à quelqu’un, Piaf est fait pour ça : je peux vous ouvrir vos discussions.',
  { prio: 1.3, acts: [A('Voir mes discussions', 'go', { h: '#/' })], links: [], chipsFn: () => [{ l: 'Une blague pour changer d’air', t: 'Raconte-moi une blague' }, { l: 'Écrire un message à un proche', t: 'Aide pour écrire un message' }], next: [] });
T('happy', 'Je suis content', ['content', 'contente', 'heureux', 'heureuse', 'ravi', 'ravie', 'bonne nouvelle', 'super journee', 'je suis fier', 'je suis fiere', 'victoire', 'j ai reussi'],
  'Ça fait plaisir à lire ! 🎉 Si vous voulez partager la bonne nouvelle avec quelqu’un, je peux vous aider à rédiger le message.',
  { prio: 1.1, chipsFn: () => [{ l: 'Aide pour écrire un message', t: 'Aide pour écrire un message' }], next: [] });

// ---- Petits services et divertissement
T('joke', 'Raconte-moi une blague', ['blague', 'blagues', 'histoire drole', 'fais moi rire', 'raconte une blague', 'drole', 'humour', 'rigoler', 'une autre blague', 'encore une blague'],
  () => pick([
    'Que dit un oiseau quand il a un doute ? — « Je vais me poser la question. »',
    'Pourquoi les oiseaux volent-ils vers le sud ? — Parce que c’est trop loin pour y aller à pied !',
    'Quel est le comble pour un électricien ? — De ne pas être au courant.',
    'Quel est le comble du jardinier ? — De raconter des salades.',
    'Pourquoi le livre de maths est-il triste ? — Parce qu’il a trop de problèmes.',
    'Que fait une fraise sur un cheval ? — Tagada, tagada !',
    'Qu’est-ce qui est jaune et qui attend ? — Jonathan.',
    'Pourquoi les plongeurs plongent-ils toujours en arrière ? — Parce que sinon ils tombent dans le bateau.',
    'Qu’est-ce qu’un crocodile qui surveille la pharmacie ? — Un Lacoste garde.',
    'Quel est le comble pour un moineau ? — D’avoir une voix de pigeon.',
  ]),
  { chipsFn: () => [{ l: 'Encore une blague', t: 'Encore une blague' }, { l: 'Une devinette', t: 'Pose-moi une devinette' }], next: [] });
T('riddle', 'Pose-moi une devinette', ['devinette', 'devinettes', 'enigme', 'enigmes', 'casse tete', 'pose moi une devinette', 'jeu de reflexion'],
  () => {
    const r = pick([
      ['Plus on en prend, plus on en laisse derrière soi. Qu’est-ce que c’est ?', 'Des pas.'],
      ['Je ne suis pas vivant, mais je grandis ; je n’ai pas de poumons, mais j’ai besoin d’air. Qui suis-je ?', 'Le feu.'],
      ['Qu’est-ce qui a des touches mais n’ouvre aucune porte ?', 'Un clavier (ou un piano).'],
      ['Plus il y en a, moins on voit. Qu’est-ce que c’est ?', 'L’obscurité.'],
      ['Qu’est-ce qui monte et descend sans jamais bouger ?', 'Un escalier.'],
      ['Qu’est-ce qui vous appartient, mais que les autres utilisent plus que vous ?', 'Votre prénom.'],
    ]);
    return { text: r[0], acts: [A('Voir la réponse', 'reveal', { t: '**' + r[1] + '**' })] };
  },
  { chipsFn: () => [{ l: 'Une autre devinette', t: 'Une autre devinette' }, { l: 'Une blague', t: 'Raconte-moi une blague' }], next: [] });
T('proverb', 'Donne-moi un proverbe', ['proverbe', 'proverbes', 'citation', 'sagesse', 'dicton', 'pensee du jour', 'inspire moi', 'motivation'],
  () => pick([
    'Petit à petit, l’oiseau fait son nid.',
    'Les paroles s’envolent, les écrits restent.',
    'Qui va doucement va sûrement.',
    'Mieux vaut tard que jamais.',
    'Tout vient à point à qui sait attendre.',
    'À cœur vaillant rien d’impossible.',
    'Un tiens vaut mieux que deux tu l’auras.',
    'Il n’est point de petit ennemi.',
  ]),
  { chipsFn: () => [{ l: 'Un autre proverbe', t: 'Un autre proverbe' }], next: [] });
T('fun_fact', 'Le saviez-vous ?', ['le saviez vous', 'anecdote', 'fait amusant', 'info insolite', 'fun fact', 'raconte moi quelque chose', 'surprends moi', 'oiseau', 'oiseaux', 'curiosite'],
  () => pick([
    'Le mot « piaf » désigne familièrement un moineau, et par extension n’importe quel petit oiseau.',
    'Le martinet noir passe presque toute sa vie en vol : il mange, boit et dort en l’air, ne se posant que pour nicher.',
    'Les corbeaux calédoniens fabriquent et utilisent des outils, par exemple des brindilles taillées pour attraper des insectes.',
    'Le colibri est l’un des rares oiseaux capables de voler en arrière et de rester immobile en l’air.',
    'L’albatros hurleur peut planer pendant des heures sans presque battre des ailes, grâce aux vents au-dessus de l’océan.',
    'Beaucoup d’oiseaux chanteurs apprennent leur chant en écoutant leurs aînés, un peu comme nous apprenons à parler.',
  ]),
  { chipsFn: () => [{ l: 'Un autre fait amusant', t: 'Un autre fait amusant' }], next: [] });
T('games', 'À quoi peut-on jouer avec toi ?', ['jouer', 'jeu', 'jeux', 'on joue', 'amuse moi', 'distraction', 's ennuyer', 'je m ennuie', 'ennui', 'passe temps'],
  'Je peux vous proposer :\n• un **pile ou face**\n• un **dé** (« lance un dé », « lance 2 dés »)\n• un **nombre au hasard** (« nombre entre 1 et 100 »)\n• un **tirage au sort** (« tire au sort entre pizza, sushi ou burger »)\n• une **devinette**, une **blague**, un fait amusant',
  { next: ['joke', 'riddle', 'fun_fact', 'proverb'] });
T('weather', 'Quel temps fait-il ?', ['meteo', 'temps qu il fait', 'quel temps', 'pluie', 'il pleut', 'temperature', 'previsions', 'soleil demain', 'orage', 'vent', 'neige'],
  'Je n’ai pas accès à la météo : je ne consulte pas Internet. Pour des prévisions fiables, voici un lien vers un service officiel.',
  { links: [LK('Météo-France', 'https://meteofrance.com/')], next: ['what_can_you_do'] });
T('msg_ideas', 'Aide pour écrire un message', ['idee message', 'aide pour ecrire', 'aide ecrire message', 'texte pour souhaiter', 'souhaiter anniversaire', 'message anniversaire', 'message de remerciement', 'message d excuse', 'excuses', 'felicitations', 'message de felicitations', 'modele de message', 'rediger un message', 'rediger message', 'message pour inviter', 'message de relance', 'relance poliment', 'sms'],
  (c, qn) => {
    const sets = [
      [/anniversaire|bon anniv/, 'anniversaire', ['Joyeux anniversaire ! Je te souhaite une journée pleine de bonnes surprises et une année remplie de belles choses. 🎂', 'Bon anniversaire ! Profite bien de cette journée, tu le mérites. J’ai hâte de fêter ça avec toi !']],
      [/merci|remerci/, 'remerciement', ['Un grand merci pour ton aide, elle m’a vraiment été précieuse. Je te revaudrai ça !', 'Merci du fond du cœur pour ce que tu as fait : ça compte beaucoup pour moi.']],
      [/excuse|pardon|desole/, 'excuses', ['Je tenais à m’excuser pour ce qui s’est passé. Ce n’était pas mon intention et je suis désolé. Peut-on en parler ?', 'Pardon pour mon retard et pour la gêne occasionnée. Je ferai en sorte que cela ne se reproduise pas.']],
      [/felicit|reussi|diplome|promotion|naissance|mariage/, 'félicitations', ['Félicitations ! Tu l’as bien mérité, je suis très heureux pour toi. 🎉', 'Bravo pour cette belle réussite ! Tout ce travail a payé, profite de ce moment.']],
      [/invit|soiree|diner|repas|fete/, 'invitation', ['Salut ! On organise un petit rendez-vous samedi à partir de 19 h, ce serait super que tu sois des nôtres. Tu peux venir ?', 'Je t’invite à dîner vendredi soir à la maison. Dis-moi si tu es libre et si tu as des préférences !']],
      [/relance|rappel|reponse|retard|rendez vous|rdv/, 'relance', ['Bonjour, je me permets de revenir vers vous au sujet de mon précédent message. Auriez-vous un moment pour me répondre ? Merci d’avance.', 'Bonjour, je souhaitais savoir où en était notre point de la semaine dernière. Pouvez-vous me tenir au courant ? Merci !']],
      [/retablissement|guerison|malade|hopital/, 'prompt rétablissement', ['J’ai appris que tu n’étais pas en forme : je pense fort à toi. Prends bien soin de toi et tiens-moi au courant, je suis là si tu as besoin de quoi que ce soit.', 'Je te souhaite un prompt rétablissement. Repose-toi bien, et n’hésite pas à m’écrire.']],
    ];
    const hit = sets.find(([re]) => re.test(qn));
    if (!hit) return { text: 'Pour quelle occasion souhaitez-vous un message ? Je peux vous proposer un modèle d’**anniversaire**, de **remerciement**, d’**excuses**, de **félicitations**, d’**invitation**, de **relance** ou de **prompt rétablissement**. Vous n’aurez plus qu’à le copier, puis à l’adapter et à l’envoyer dans la discussion.', chips: [{ l: 'Message d’anniversaire', t: 'Message d’anniversaire' }, { l: 'Message de remerciement', t: 'Message de remerciement' }, { l: 'Message d’excuses', t: 'Message d’excuses' }, { l: 'Message de félicitations', t: 'Message de félicitations' }] };
    const msg = pick(hit[2]);
    return { text: `Voici une proposition (${hit[1]}) :\n« ${msg} »\nAdaptez-la à votre style, puis copiez-la et collez-la dans la discussion.`, acts: [A('Copier ce message', 'copy', { t: msg }), A('Choisir un destinataire', 'go', { h: '#/' })], chips: [{ l: 'Autre proposition', t: 'Message ' + (hit[1] === 'anniversaire' ? 'd’anniversaire' : hit[1] === 'remerciement' ? 'de remerciement' : hit[1] === 'excuses' ? 'd’excuses' : hit[1] === 'félicitations' ? 'de félicitations' : hit[1] === 'invitation' ? 'd’invitation' : hit[1] === 'relance' ? 'de relance' : 'de prompt rétablissement') }] };
  },
  { next: ['send_msg', 'what_can_you_do'] });
T('general', 'Que sais-tu en dehors de Piaf ?', ['culture generale', 'recette', 'recettes', 'histoire de', 'geographie', 'actualite', 'actualites', 'news', 'sport score', 'horoscope', 'resultat match', 'qui est', 'c est qui', 'cuisine', 'devoir', 'exercice'],
  (c, qn, q) => ({ text: 'Mon domaine, c’est Piaf et quelques petits services (heure, calculs, tirages, blagues, aide à la rédaction). Pour une question de culture générale, une actualité ou une recette, je ne peux pas vous répondre de façon fiable : je vous propose plutôt de lancer la recherche sur une source sérieuse.', links: webLinks(q) }),
  { prio: 0.9, next: ['what_can_you_do'] });

// ------------------------------------------------------------------ commandes dynamiques (état réel de l'application)
const ID8_RE = /(?:^|[^\d])([1-9]\d{3})[\s.\-]?(\d{4})(?!\d)/;
const STOP = new Set(('ouvre ouvrir affiche afficher montre montrer va aller vas allez retourne retrouve retrouver trouve trouver la le les l un une ma mon mes de du des d a au aux avec chez en dans sur et ou pour par ' +
  'discussion discussions conversation conversations chat groupe groupes contact moi toi me te se que qui quoi comment pourquoi quand est il elle ils peux peut peuvent pouvez tu vous je j s stp svp merci plait ecris ecrire parle parler ' +
  'discute discuter contacter contacte appelle appeler envoie envoyer dis dire met mets mettre ajoute ajouter retire retirer enleve enlever supprime supprimer archive archiver desarchive desarchiver favori favoris silence muet mute sourdine ' +
  'reactive reactiver desactive desactiver nouveau nouvelle message messages galerie medias photos videos infos info membres').split(' '));

function findConvs(qn, ctx) {
  const qt = qn.split(' ').filter((w) => w.length >= 2 && !STOP.has(w));
  if (!qt.length || !ctx.convs || !ctx.convs.length) return [];
  const scored = [];
  for (const c of ctx.convs) {
    const nt = norm(c.name).split(' ').filter((w) => w.length >= 2);
    if (!nt.length) continue;
    let hits = 0;
    for (const w of qt) if (nt.some((n) => n === w || (w.length >= 3 && n.startsWith(w)) || (n.length >= 4 && w.startsWith(n)))) hits++;
    if (!hits) continue;
    const exact = norm(c.name) === qt.join(' ');
    scored.push({ c, s: hits + (exact ? 2 : 0) + hits / nt.length });
  }
  scored.sort((a, b) => b.s - a.s);
  if (!scored.length) return [];
  const top = scored[0].s;
  return scored.filter((x) => x.s >= top - 0.01).slice(0, 4).map((x) => x.c);
}
const convLabel = (c) => c.name + (c.group ? ' (groupe)' : '');
const hasWord = (qt, ...ws) => ws.some((w) => qt.includes(w));

function calc(expr) {
  const tk = expr.match(/\d+(?:\.\d+)?|[()+\-*/^]/g);
  if (!tk || tk.join('') !== expr.replace(/\s+/g, '')) return null;
  let i = 0;
  const peek = () => tk[i], next = () => tk[i++];
  function prim() { const t = next(); if (t === undefined) throw new Error('x'); if (t === '(') { const v = add(); if (next() !== ')') throw new Error('x'); return v; } if (t === '-') return -pow(); if (t === '+') return pow(); if (/^\d/.test(t)) return parseFloat(t); throw new Error('x'); }
  function pow() { const b = prim(); if (peek() === '^') { next(); return Math.pow(b, pow()); } return b; }
  function mul() { let v = pow(); while (peek() === '*' || peek() === '/') { const o = next(), r = pow(); if (o === '/' && r === 0) throw new Error('div0'); v = o === '*' ? v * r : v / r; } return v; }
  function add() { let v = mul(); while (peek() === '+' || peek() === '-') { const o = next(), r = mul(); v = o === '+' ? v + r : v - r; } return v; }
  const v = add(); if (i !== tk.length) throw new Error('x'); return v;
}
const fmtNum = (v) => (Number.isInteger(v) && Math.abs(v) < 1e15) ? v.toLocaleString('fr-FR') : Number(v.toPrecision(12)).toLocaleString('fr-FR', { maximumFractionDigits: 10 });

const HANDLERS = [
  // 1. détresse : réponse calme et ressources, sans autre suggestion
  (q, qn) => {
    if (!/suicid|me tuer|envie de mourir|veux mourir|veux plus vivre|en finir avec la vie|plus envie de vivre|me faire du mal|m automutil|me suicider|mettre fin a mes jours/.test(qn)) return null;
    return { text: 'Je suis vraiment désolé que vous traversiez cela, et je suis content que vous l’ayez écrit. Vous n’avez pas à rester seul avec cette souffrance. En France, le **3114** est le numéro national de prévention du suicide : gratuit, joignable **24 h/24 et 7 j/7**, avec des professionnels formés qui vous écouteront. Si vous êtes en danger immédiat, appelez le **15** ou le **112**. Et si vous le pouvez, parlez-en dès maintenant à un proche : je peux vous ouvrir vos discussions.',
      links: [LK('3114 — numéro national de prévention du suicide', 'https://3114.fr/')], acts: [A('Voir mes discussions', 'go', { h: '#/' })], chips: [], topic: 'support' };
  },
  // 2. identifiant à 8 chiffres saisi : proposer de démarrer la discussion
  (q, qn, qt, ctx) => {
    const m = ID8_RE.exec(q); if (!m || qt.length > 12) return null;
    if (/mon (identifiant|id)\b|je suis|c est moi|vous etes|tu es/.test(qn) && !/(ecri|contact|ajout|demarr|discut|parl|nouvelle)/.test(qn)) return null;
    const id = m[1] + m[2], pretty = id.slice(0, 4) + ' ' + id.slice(4);
    if (id === ctx.pid) return { text: `**${pretty}** est votre propre identifiant : vous pouvez le donner à vos amis pour qu’ils vous écrivent.`, acts: [A('Copier mon identifiant', 'copy', { k: 'id' }), A('Partager l’invitation', 'invite')], topic: 'my_id' };
    const known = (ctx.convs || []).find((c) => c.pid === id && !c.group);
    if (known) return { text: `Vous avez déjà une discussion avec **${known.name}** (identifiant ${pretty}).`, acts: [A('Ouvrir la discussion', 'conv', { id: known.id })], topic: 'start_by_id' };
    return { text: `Souhaitez-vous démarrer une discussion avec l’identifiant **${pretty}** ? Si la personne existe, la discussion s’ouvre aussitôt ; sinon je vous le dirai.`, acts: [A(`Démarrer avec ${pretty}`, 'start', { pid: id })], topic: 'start_by_id' };
  },
  // 3. « écris à Marie : j'arrive » → message prêt à envoyer (bouton)
  (q, qn, qt, ctx) => {
    const m = q.match(/^\s*(?:peux[- ]tu\s+|pouvez[- ]vous\s+|tu peux\s+|vous pouvez\s+)?(?:envoie|envoi|envoyer|écris|ecris|écrire|ecrire|dis|dire|transmets|transmettre)(?:[- ]moi)?\s+(?:un message |le message |un mot |un texte )?(?:à|a|au|aux)\s+(.{1,60}?)\s*(?::|,\s*que\s|\sque\s|\sdisant\s|\spour dire\s|\squ’|\squ')\s*(.{1,4000})$/i);
    if (!m) return null;
    let body = m[2].trim().replace(/^[«"“]\s*|\s*[»"”]$/g, '').trim(); if (!body) return null;
    body = cap(body);
    const found = findConvs(norm(m[1]), ctx);
    if (!found.length) return { text: `Je ne trouve aucune discussion dont le nom ressemble à « ${m[1].trim()} ». Vérifiez l’orthographe, ou démarrez d’abord une discussion avec cette personne (par son identifiant à 8 chiffres).`, acts: [A('Nouvelle discussion', 'go', { h: '#/new' })], topic: 'send_cmd' };
    const ok = found.filter((c) => !c.blocked);
    if (!ok.length) return { text: `Vous avez bloqué **${found[0].name}** : vous ne pouvez plus lui écrire tant que le blocage dure. Débloquez-la depuis la discussion ou dans Paramètres → Contacts bloqués.`, acts: [A('Ouvrir les paramètres', 'go', { h: '#/settings' })], topic: 'send_cmd' };
    if (body.length > 4000) return { text: 'Ce message dépasse 4 000 caractères : raccourcissez-le un peu.', topic: 'send_cmd' };
    const who = ok.length === 1 ? `**${ok[0].name}**` : 'l’une de ces discussions';
    return { text: `Message prêt pour ${who} :\n« ${body} »\nAppuyez sur le bouton pour l’envoyer : rien ne part avant.`, acts: ok.map((c) => A('Envoyer à ' + convLabel(c), 'send', { id: c.id, t: body, n: c.name })), topic: 'send_cmd' };
  },
  // 4. mes identifiant / nom / chiffres
  (q, qn, qt, ctx) => {
    if (/(quel est|c est quoi|donne|affiche|montre|rappelle|retrouve|rappelle moi|dis moi)\b.*\b(mon|ma) (identifiant|id)\b|^(mon (identifiant|id))$|ou (voir|trouver) mon identifiant/.test(qn))
      return { text: `Votre identifiant Piaf est **${ctx.id8}**. Donnez-le aux personnes qui veulent vous écrire (il n’est pas secret, contrairement à votre code).`, acts: [A('Copier mon identifiant', 'copy', { k: 'id' }), A('Partager l’invitation', 'invite')], topic: 'my_id', chips: [{ l: 'Comment inviter un ami ?', t: 'Comment inviter un ami sur Piaf ?' }] };
    if (/(comment je m appelle|quel est mon nom|mon nom affiche|qui suis je|sous quel nom)/.test(qn))
      return { text: `Vous apparaissez sous le nom **${ctx.name}** pour vos contacts. Vous pouvez le modifier quand vous voulez.`, acts: [A('Modifier mon nom', 'name')], topic: 'profile_name' };
    return null;
  },
  // 5. états : non lus, nombre de discussions, favoris, archives
  (q, qn, qt, ctx) => {
    const cs = ctx.convs || [];
    if (/(non lu|nouveaux messages|messages en attente|ai je (recu|des) (nouveaux )?messages|quelqu un m a ecrit|qui m a ecrit|y a t il des messages)/.test(qn) && !/(comment|signifi|badge|pourquoi)/.test(qn)) {
      const un = cs.filter((c) => c.unread && !c.archived).sort((a, b) => b.unread - a.unread);
      const total = un.reduce((n, c) => n + c.unread, 0);
      if (!un.length) return { text: 'Vous êtes à jour : **aucun message non lu**. 🎉', acts: [A('Actualiser mes discussions', 'refresh')], topic: 'unread', chips: [] };
      return { text: `Vous avez **${total} message${total > 1 ? 's' : ''} non lu${total > 1 ? 's' : ''}** dans ${un.length} discussion${un.length > 1 ? 's' : ''}.${un.length > 5 ? ' Voici les cinq premières :' : ''}`,
        acts: un.slice(0, 5).map((c) => A(`${convLabel(c)} (${c.unread})`, 'conv', { id: c.id })), topic: 'unread', chips: [] };
    }
    if (/combien (de|d) (discussion|conversation|groupe|contact)/.test(qn)) {
      const g = cs.filter((c) => c.group).length, d = cs.length - g, a = cs.filter((c) => c.archived).length, f = cs.filter((c) => c.favorite).length;
      return { text: `Vous avez **${cs.length} discussion${cs.length > 1 ? 's' : ''}** : ${d} à deux et ${g} groupe${g > 1 ? 's' : ''}, dont ${f} en favori${f > 1 ? 's' : ''} et ${a} archivée${a > 1 ? 's' : ''}.`, topic: 'stats', chips: [{ l: 'Mes messages non lus', t: 'Mes messages non lus' }] };
    }
    if (/(mes|liste|quels sont mes|affiche mes|montre mes|voir mes|ouvre mes)\s+(discussions? )?favoris?/.test(qn)) {
      const f = cs.filter((c) => c.favorite && !c.archived);
      return f.length ? { text: `Vos favoris (${f.length}) :`, acts: f.slice(0, 6).map((c) => A(convLabel(c), 'conv', { id: c.id })), topic: 'favorites', chips: [] } : { text: 'Vous n’avez aucune discussion en favori pour l’instant. Dites-moi « mets Marie en favori » et je prépare le bouton.', topic: 'favorites' };
    }
    if (/(mes|liste|affiche mes|montre mes|voir mes|ouvre mes)\s+(discussions? )?archiv/.test(qn)) {
      const f = cs.filter((c) => c.archived);
      return f.length ? { text: `Vos discussions archivées (${f.length}) :`, acts: f.slice(0, 6).map((c) => A(convLabel(c), 'conv', { id: c.id })), topic: 'archive', chips: [] } : { text: 'Aucune discussion archivée pour le moment.', topic: 'archive' };
    }
    if (/(mes discussions recentes|derniers messages|dernieres discussions|discussions recentes|mes discussions)$/.test(qn) && cs.length) {
      const r = cs.filter((c) => !c.archived).slice(0, 5);
      return { text: 'Vos discussions les plus récentes :', acts: r.map((c) => A(convLabel(c) + (c.unread ? ` (${c.unread})` : ''), 'conv', { id: c.id })), topic: 'conv_list', chips: [] };
    }
    return null;
  },
  // 6. commandes sur une discussion nommée : ouvrir, favori, archive, silence, médias, infos
  (q, qn, qt, ctx) => {
    if (!ctx.convs || !ctx.convs.length) return null;
    if (/^(comment|pourquoi|qu est ce|est ce que|c est quoi|quel|quelle)\b/.test(qn)) return null;
    const verbs = {
      fav: /\b(favori|favoris)\b/, arch: /\b(archive|archiver|desarchive|desarchiver)\b/, mute: /\b(silence|muet|mute|sourdine|reactive|reactiver)\b/,
      gallery: /\b(medias|photos|videos|galerie)\b/, group: /\b(membres|infos|info)\b/, open: /\b(ouvre|ouvrir|affiche|afficher|montre|montrer|va|aller|retourne|retrouve|trouve|ecris|ecrire|parle|parler|discute|discuter|contacte|contacter)\b/,
    };
    const kind = verbs.fav.test(qn) ? 'fav' : verbs.arch.test(qn) ? 'arch' : verbs.mute.test(qn) ? 'mute' : verbs.gallery.test(qn) && verbs.open.test(qn) ? 'gallery' : verbs.group.test(qn) && verbs.open.test(qn) ? 'group' : verbs.open.test(qn) ? 'open' : null;
    if (!kind) return null;
    const found = findConvs(qn, ctx); if (!found.length) return null;
    const off = /\b(retire|retirer|enleve|enlever|supprime|supprimer|plus en favori|desarchive|desarchiver|reactive|reactiver|desactive|desactiver)\b/.test(qn);
    const mk = (c) => {
      if (kind === 'open') return A('Ouvrir ' + convLabel(c), 'conv', { id: c.id });
      if (kind === 'gallery') return A('Médias de ' + convLabel(c), 'gallery', { id: c.id });
      if (kind === 'group') return c.group ? A('Infos de ' + c.name, 'group', { id: c.id }) : A('Ouvrir ' + c.name, 'conv', { id: c.id });
      if (kind === 'fav') return A(off ? `Retirer ${c.name} des favoris` : c.favorite ? `${c.name} est déjà en favori` : `Mettre ${c.name} en favori`, 'fav', { id: c.id, v: !off, n: c.name });
      if (kind === 'arch') { const val = /desarchiv/.test(qn) ? false : off ? false : true; return A(val ? `Archiver ${c.name}` : `Désarchiver ${c.name}`, 'arch', { id: c.id, v: val, n: c.name }); }
      const val = /reactiv|desactiv/.test(qn) ? false : off ? false : true; return A(val ? `Mettre ${c.name} en silence` : `Réactiver ${c.name}`, 'mute', { id: c.id, v: val, n: c.name });
    };
    const lead = found.length > 1 ? 'Plusieurs discussions correspondent — laquelle ?' : kind === 'open' ? `Voici la discussion « ${found[0].name} » :` : 'C’est prêt : appuyez sur le bouton pour confirmer.';
    return { text: lead, acts: found.map(mk), topic: kind === 'open' ? 'conv_list' : kind === 'fav' ? 'favorites' : kind === 'arch' ? 'archive' : kind === 'mute' ? 'mute' : 'conv_list', chips: [] };
  },
  // 7. date et heure
  (q, qn, qt, ctx) => {
    if (/(quelle heure|il est quelle heure|l heure qu il est|heure actuelle|donne moi l heure|quelle est l heure)/.test(qn)) {
      const t = ctx.now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      return { text: `Il est **${t}** (heure de votre appareil).`, topic: 'time' };
    }
    if (/(quel jour|quelle date|date du jour|jour sommes nous|on est le combien|nous sommes le combien|date d aujourd hui|quel jour on est|on est quel jour)/.test(qn)) {
      return { text: `Nous sommes le **${ctx.now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}**.`, topic: 'time' };
    }
    return null;
  },
  // 8. calculs
  (q, qn, qt, ctx) => {
    let m = q.toLowerCase().match(/(\d+(?:[.,]\d+)?)\s*(?:%|pour cent|pourcent)\s*(?:de|d['’ ]\s*)\s*(\d+(?:[.,]\d+)?)/);
    if (m) { const p = parseFloat(m[1].replace(',', '.')), v = parseFloat(m[2].replace(',', '.')); return { text: `${fmtNum(p)} % de ${fmtNum(v)} = **${fmtNum(p * v / 100)}**`, topic: 'calc' }; }
    m = qn.match(/racine(?: carree)? (?:de|d) (\d+(?:[.,]\d+)?)/);
    if (m) { const v = parseFloat(m[1].replace(',', '.')); return { text: `La racine carrée de ${fmtNum(v)} est **${fmtNum(Math.sqrt(v))}**.`, topic: 'calc' }; }
    let e = q.toLowerCase().replace(/combien (?:font|fait|vaut|valent)|calcule(?:r)?|c est combien|resultat de|le résultat de|que font|=|\?/g, ' ');
    e = e.replace(/(\d)\s*[x×]\s*(?=\d|\()/g, '$1*').replace(/÷/g, '/').replace(/(\d)\s*:\s*(?=\d)/g, '$1/').replace(/(\d),(\d)/g, '$1.$2')
      .replace(/\s+plus\s+/g, '+').replace(/\s+moins\s+/g, '-').replace(/\s+fois\s+/g, '*').replace(/\s+(?:divise par|divisé par)\s+/g, '/').replace(/\s+multiplie par\s+/g, '*').replace(/\s+puissance\s+/g, '^').trim();
    if (!/^[\d\s+\-*/^().]+$/.test(e) || !/\d/.test(e) || !/[+\-*/^]/.test(e.replace(/^\s*[-+]/, ''))) return null;
    if (/\d{1,4}[-/]\d{1,2}[-/]\d{1,4}/.test(e)) return null;
    try { const v = calc(e); if (v == null) return null; if (!isFinite(v)) return { text: 'Le résultat est trop grand pour que je l’affiche.', topic: 'calc' }; return { text: `${e.replace(/\s+/g, ' ').trim()} = **${fmtNum(v)}**`, topic: 'calc' }; }
    catch (err) { return err.message === 'div0' ? { text: 'On ne peut pas diviser par zéro. 😉', topic: 'calc' } : null; }
  },
  // 9. hasard : pile ou face, dé, nombre, tirage au sort
  (q, qn, qt, ctx) => {
    const again = (t) => [{ l: 'Recommencer', t }];
    if (/pile ou face|(lance|jette|tire).*piece/.test(qn)) return { text: `🪙 **${rand() < 0.5 ? 'Pile' : 'Face'}** !`, chips: again(q), topic: 'random' };
    let m = qn.match(/(?:lance|jette|tire|roule|lancer)\s+(?:un |1 |une |(\d{1,2}) )?des?(?:\s+a\s+(\d{1,3})\s+faces)?(?:\s+(?:stp|svp|s il (?:te|vous) plait))?$/);
    if (m && !/^(comment|pourquoi)/.test(qn)) {
      const n = Math.min(10, Math.max(1, parseInt(m[1] || '1', 10))), faces = Math.min(1000, Math.max(2, parseInt(m[2] || '6', 10)));
      const r = Array.from({ length: n }, () => 1 + Math.floor(rand() * faces));
      return { text: `🎲 ${r.map((x) => '**' + x + '**').join(' + ')}${n > 1 ? ` = **${r.reduce((a, b) => a + b, 0)}**` : ''}`, chips: again(q), topic: 'random' };
    }
    m = qn.match(/(?:nombre|chiffre|numero)(?: aleatoire| au hasard| hasard)?(?: entre| de| compris entre)?\s+(\d+)\s+(?:et|a)\s+(\d+)/) || qn.match(/(?:entre)\s+(\d+)\s+et\s+(\d+)/);
    if (m && /(nombre|chiffre|numero|hasard|aleatoire|tire)/.test(qn)) {
      let a = parseInt(m[1], 10), b = parseInt(m[2], 10); if (a > b) [a, b] = [b, a];
      return { text: `🎯 Entre ${a} et ${b} : **${a + Math.floor(rand() * (b - a + 1))}**`, chips: again(q), topic: 'random' };
    }
    m = q.match(/(?:tire(?:r)? au sort|choisis|choisir|decide|décide|departage|départage|tire)\b.*?\b(?:entre|parmi)\s+(.+)$/i);
    if (m) {
      const opts = m[1].replace(/[?.!]+$/g, '').split(/\s*(?:,|;|\/|\sou\s|\set\s)\s*/i).map((s) => s.trim()).filter(Boolean);
      if (opts.length >= 2) return { text: `🎯 Le sort a choisi : **${pick(opts)}**`, chips: again(q), topic: 'random' };
    }
    return null;
  },
  // 10. définition / traduction → liens
  (q, qn, qt, ctx) => {
    let m = q.match(/^\s*(?:que veut dire|ça veut dire quoi|ca veut dire quoi|que signifie|définition de|definition de|définis|definis|signification de|c['’]est quoi le sens de|ça signifie quoi|ca signifie quoi)\s+(?:le mot |l[’']expression )?(.{1,60}?)\s*\??\s*$/i);
    if (m) { const w = m[1].trim().replace(/^[«"“]|[»"”]$/g, ''); return { text: `Je n’ai pas de dictionnaire intégré, mais voici la définition de « ${w} » dans un dictionnaire en ligne :`, links: [LK(`Définition de « ${w} » (Wiktionnaire)`, 'https://fr.wiktionary.org/w/index.php?search=' + enc(w))], topic: 'define' }; }
    m = q.match(/^\s*(?:traduis|traduire|traduction de|traduit|comment dit[- ]on)\s+(.{1,300}?)(?:\s+(?:en|vers)\s+(anglais|espagnol|allemand|italien|portugais|arabe|chinois|japonais|russe|néerlandais|neerlandais|turc|polonais|français|francais))?\s*\??\s*$/i);
    if (m) {
      const codes = { anglais: 'en', espagnol: 'es', allemand: 'de', italien: 'it', portugais: 'pt', arabe: 'ar', chinois: 'zh-CN', japonais: 'ja', russe: 'ru', 'néerlandais': 'nl', neerlandais: 'nl', turc: 'tr', polonais: 'pl', 'français': 'fr', francais: 'fr' };
      const lang = (m[2] || 'anglais').toLowerCase(), txt = m[1].trim().replace(/^[«"“]|[»"”]$/g, '');
      return { text: `Je ne traduis pas moi-même, mais ce lien ouvre un service de traduction avec votre texte (langue cible : ${lang}) :`, links: [LK('Traduire « ' + (txt.length > 30 ? txt.slice(0, 30) + '…' : txt) + ' »', `https://translate.google.com/?sl=auto&tl=${codes[lang] || 'en'}&text=${enc(txt)}&op=translate`)], topic: 'translate' };
    }
    return null;
  },
];

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
    { l: 'Que peux-tu faire ?', t: 'Que peux-tu faire ?' }, { l: 'Mon identifiant', t: 'Quel est mon identifiant ?' }, { l: 'Créer un groupe', t: 'Comment créer un groupe ?' },
    { l: 'Inviter un ami', t: 'Comment inviter un ami sur Piaf ?' }, { l: 'Installer Piaf', t: 'Comment installer Piaf sur mon téléphone ?' }, { l: 'Mes messages non lus', t: 'Mes messages non lus' },
    { l: 'Sécuriser mon compte', t: 'Comment sécuriser mon compte ?' }, { l: 'Une blague', t: 'Raconte-moi une blague' },
  ];
}
const webLinks = (q) => [LK('Chercher sur Wikipédia', 'https://fr.wikipedia.org/w/index.php?search=' + enc(q)), LK('Chercher sur le web', 'https://duckduckgo.com/?q=' + enc(q))];

function finish(r, topic, o) {
  const out = { text: r.text, links: r.links || [], acts: r.acts || [], chips: r.chips, topic: r.topic || (topic && topic.id) || null };
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
  const q = String(text || '').trim().slice(0, 600);
  if (!q) return null;
  ctx = ctx || {}; mem = mem || {};
  if (!ctx.now) ctx.now = new Date();
  if (ctx.first === undefined && ctx.name) ctx.first = String(ctx.name).split(/\s+/)[0];
  const qn = norm(q), qs = stems(qn);

  // suites de conversation
  if (/^(oui|ok|okay|d accord|vas y|allez|volontiers|je veux bien|go|yes|bien sur|avec plaisir|oui merci|oui s il te plait|oui s il vous plait)$/.test(qn)) {
    if (mem.offer) return { text: 'Voici le bouton : il suffit d’appuyer pour que je m’en occupe.', links: [], acts: [mem.offer], chips: [], topic: mem.topic || null };
    return { text: 'D’accord ! Dites-moi ce que vous voulez faire, ou choisissez un sujet ci-dessous.', links: [], acts: [], chips: starters().slice(0, 4), topic: null };
  }
  if (/^(non|non merci|pas besoin|rien|laisse tomber|laissez tomber|ca ira|c est bon|ca va aller)$/.test(qn)) return { text: 'Très bien. Je reste disponible si vous avez besoin de moi.', links: [], acts: [], chips: [], topic: null };
  if (/^(comment|pourquoi|details?|detaille|explique|developpe|precise|precisions|et alors|plus|la suite|suite|plus de details|en savoir plus|et apres)\s*\??$/.test(qn) && mem.topic && BY_ID[mem.topic]) {
    const t = BY_ID[mem.topic];
    return { text: 'Voilà l’essentiel de ce que je sais à ce sujet. Vous pouvez me poser une question plus précise, par exemple :', links: [], acts: [], chips: chipsOf(t.next), topic: t.id };
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

  // inconnu : propositions proches + liens de recherche
  const near = ranked.slice(0, 3).map((x) => x[0]);
  const chips = near.length ? near.map((t) => ({ l: t.q, t: t.q })) : starters().slice(0, 4);
  const words = qs.length;
  return {
    text: near.length ? 'Je ne suis pas certain d’avoir compris. Voulez-vous parler de l’un de ces sujets ? Vous pouvez aussi reformuler avec d’autres mots.'
      : (words >= 2 ? 'Je n’ai pas de réponse fiable à cette question : mon domaine, c’est Piaf et quelques petits services du quotidien. Je peux en revanche vous orienter vers une source de recherche, ou vous proposer ce que je sais faire.' : 'Je n’ai pas bien compris. Pouvez-vous reformuler ? Voici quelques sujets sur lesquels je peux vous aider.'),
    links: words >= 2 && !near.length ? webLinks(q) : [], acts: [], chips: chips.slice(0, 4), topic: null, unknown: true,
  };
}

// ------------------------------------------------------------------ phrase secrète (mots tirés au hasard, générés sur l'appareil)
const WORDS = ('abeille amande ananas arbre argile aurore avion bambou banane barque basilic biscuit blason bonbon bouton brique cactus cafe canard carotte cerise chaise chemin citron cloche colline comete coquille corail cuisine dauphin dessin diamant ' +
  'douane eclair elan encre erable escale etoile falaise farine fenetre fleuve foret fougere fraise galet gazelle glacier grenade guitare hamac harpe herbe hibou horizon igloo jardin jasmin kiwi lagune lampe lavande lierre lion lune magnolia maison ' +
  'marais melon menthe miroir moulin nacre noisette nuage oasis olive orage orchidee ourson paille panier papier pelote peche pigeon pivoine plage poivre pomme prairie prune puits quartz radis rameau riviere rocher ruban sable safran saule sentier ' +
  'sirop sorbet soupe tambour tilleul tomate tortue tulipe vallee velours verger violette volcan zebre').split(' ');
function passphrase(randInt) {
  const ri = randInt || ((n) => Math.floor(rand() * n));
  const used = new Set(), out = [];
  while (out.length < 6) { const w = WORDS[ri(WORDS.length)]; if (!used.has(w)) { used.add(w); out.push(w); } }
  return out.join('-') + '-' + String(10 + ri(90));
}

const api = { reply, norm, stem, stems, TOPICS, BY_ID, starters, passphrase, WORDS, calc, findConvs, setRand(fn) { rand = fn || Math.random; } };
if (typeof module === 'object' && module.exports) module.exports = api; else root.T2P = api;
})(typeof window !== 'undefined' ? window : globalThis);
