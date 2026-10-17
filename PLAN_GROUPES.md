# Plan — gestion des groupes (à réaliser, rien n'est encore implémenté)

Principe directeur : **pas d'e-mail ni de téléphone**. On rejoint un groupe par identifiant à 8 chiffres ou par lien d'invitation, jamais par carnet d'adresses.

## Décisions proposées (à valider)
- Taille maximale : 32 membres (limite modifiable dans `app_config`).
- Rôles : **administrateur** (créateur, peut nommer d'autres admins) et **membre**. Seuls les admins ajoutent/retirent des membres, renomment, changent la photo, créent/révoquent le lien d'invitation.
- Ajout par identifiant exact (comme aujourd'hui) ; la personne ajoutée est prévenue et peut quitter. Lien d'invitation : jeton aléatoire révocable, option « validation par un admin ».
- Un nouvel arrivant ne voit **pas** l'historique antérieur (confidentialité par défaut).
- Messages : mêmes fonctions qu'en conversation à deux (réponse, réaction, épinglage, modification, suppression pour moi / pour tous — l'auteur ou un admin).
- Médias : quota **par groupe** (100 Mo par défaut), mêmes limites par fichier. Suppression pour tous = suppression réelle, comme aujourd'hui.
- Statuts : « envoyé » ; « distribué »/« lu » deviennent des compteurs (« lu par 3/8 »), respectant les confirmations de lecture désactivées. Détail par personne pour l'auteur.
- Blocage : bloquer un membre masque ses messages pour soi sans casser le groupe. Signalement d'un membre ou d'un message vers la modération.

## Étapes
1. **Schéma (migration 007)** : `conversations.kind` (`direct` | `group`), `title`, `avatar_path`, `created_by` ; `conversation_members` avec `role`, `joined_at`, `left_at` ; table `group_invites` ; `messages.system_kind` pour les messages d'événement (« X a quitté »). Les conversations à deux existantes restent intactes (`kind = direct`).
2. **Sécurité (RLS)** : `is_member` devient basé sur `conversation_members` actifs ; revue de toutes les politiques (messages, médias, réactions, stockage) et des fonctions `SECURITY DEFINER` qui supposent deux membres (`other_member`, `user_a/user_b`, blocage, accusés).
3. **Fonctions serveur** : créer groupe, ajouter/retirer, quitter, promouvoir/rétrograder, renommer, photo du groupe, invitation (créer/révoquer/rejoindre), supprimer le groupe (dernier admin).
4. **Quotas et médias** : quota sur `conversations.media_bytes` déjà par conversation → peu de changement ; revoir la suppression « pour tous » (auteur ou admin) et la purge à la sortie d'un membre.
5. **Interface** : liste (icône de groupe, dernier expéditeur), création en 3 écrans (nom/photo → membres → confirmation), écran « Infos du groupe » (membres, rôles, invitation, quitter), noms d'expéditeur dans les bulles, compteurs de lecture, galerie du groupe.
6. **Temps réel** : s'abonner aux changements des membres ; retrait immédiat de l'accès d'un membre exclu (URL signées de 10 min : accès résiduel borné à 10 min, à documenter).
7. **Tests** (à exécuter, pas supposer) : accès d'un non-membre et d'un ancien membre, historique invisible pour un nouvel arrivant, droits admin/membre, concurrence sur le quota, suppression réelle des fichiers, limite de taille du groupe, lien d'invitation révoqué, anti-abus (création de groupes, invitations) , régression des conversations à deux.
8. **Confidentialité** : mettre à jour `privacy.html` (qui voit la liste des membres, les accusés de lecture de groupe).

## Estimation et ordre
Schéma + sécurité + fonctions (étapes 1–4) = la partie risquée, à tester avant toute interface. Puis interface (5–6), tests (7), documents (8). Environ 3 à 4 sessions de travail.

## Questions ouvertes (valeurs par défaut proposées entre parenthèses)
Taille maximale (32) · historique pour les nouveaux (masqué) · qui peut inviter (admins seulement) · suppression pour tous par un admin (oui).
