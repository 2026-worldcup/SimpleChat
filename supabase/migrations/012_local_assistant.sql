-- 012 — Talk2Piaf devient local : plus aucune réponse de l'assistant n'est enregistrée sur le serveur.
-- Les demandes à « @Talk2Piaf » et ses réponses restent sur l'appareil de la personne qui les fait (assistant-actions.js) ;
-- seules les VRAIES actions (message, sondage, liste…) passent par les fonctions habituelles, au nom de la personne.
-- La fonction qui publiait la réponse de l'ancien « Talk2Piaf Cowork » dans la discussion n'a donc plus d'utilité : elle est supprimée.
-- Les anciens messages de type 'assistant' déjà publiés restent affichés (« Talk2Piaf »), le type n'est pas retiré de la base.
-- À appliquer APRÈS le déploiement de l'application mise à jour (sw.js piaf-shell-v19) : les anciennes versions en cache appelaient cette fonction.
drop function if exists public.post_assistant_reply(uuid, uuid, text);
