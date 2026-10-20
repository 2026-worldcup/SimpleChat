/* Piaf — suivi de fichiers pour Talk2Piaf (côté appareil : comprendre la demande, préparer le bouton).
   Aucune dépendance, aucun réseau. Le suivi lui-même (vérification toutes les 15 minutes, alertes) est fait par le serveur
   (migration 010_watchers.sql et Edge Function `watch`) ; il ne démarre qu'à l'appui du bouton « Suivre ».
   Fournisseurs : GitHub (dépôts publics) disponible ; Google Drive / Microsoft OneDrive-SharePoint reconnus mais pas encore branchés.

   API : parseUrl(texte) → { ref, label } | null ; provider(texte) → 'github' | 'google' | 'microsoft' | null ;
         reply(texte, { scope: 'self' | 'group', name }, mem) → { text, acts, topic } | null */
(function (root) {
'use strict';

const fold = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`´]/g, "'").replace(/œ/g, 'oe').replace(/\s+/g, ' ').trim();
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const RESERVED = new Set(['orgs', 'settings', 'marketplace', 'features', 'topics', 'collections', 'sponsors', 'notifications', 'login', 'about', 'pricing', 'search', 'explore', 'new', 'apps', 'enterprise', 'security', 'pulls', 'issues', 'codespaces', 'users', 'sessions', 'join', 'contact', 'readme']);
const DEFAULT_BRANCH = new Set(['main', 'master', 'head']);

// github.com/propriétaire/dépôt[/blob|tree|commits/branche/chemin]  (avec ou sans https://, avec ou sans www.)
function parseUrl(text) {
  const m = /(?<![\w.-])(?:https?:\/\/)?(?:www\.)?github\.com\/([^\s/?#<>"'«»]+)\/([^\s/?#<>"'«»]+)((?:\/[^\s?#<>"'«»]*)?)/i.exec(String(text || ''));
  if (!m) return null;
  const owner = m[1], repo = m[2].replace(/\.git$/i, '');
  if (!OWNER_RE.test(owner) || RESERVED.has(owner.toLowerCase()) || !REPO_RE.test(repo) || repo === '.' || repo === '..') return null;
  const ref = { owner, repo };
  const rest = (m[3] || '').split('/').filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch { return x; } });
  if (rest.length >= 2 && ['blob', 'tree', 'commits'].includes(rest[0])) {
    const branch = rest[1], path = rest.slice(2).join('/').replace(/[.,;:!?)»"]+$/, '');
    if (!DEFAULT_BRANCH.has(branch.toLowerCase()) && /^[A-Za-z0-9._-]{1,100}$/.test(branch) && !branch.includes('..')) ref.branch = branch;   // la branche principale n'est pas fixée : elle suit un éventuel renommage
    if (path && path.length <= 300 && !/[\u0000-\u001f]/.test(path) && !/(^|\/)\.\.(\/|$)/.test(path)) ref.path = path;
  }
  return { ref, label: ref.owner + '/' + ref.repo + (ref.path ? '/' + ref.path : '') + (ref.branch ? ' (' + ref.branch + ')' : '') };
}

function provider(text) {
  const t = String(text || '');
  if (/github\.com\//i.test(t)) return 'github';
  if (/(?:docs|drive|sheets|slides)\.google\.com|goo\.gl\/|docs\.google/i.test(t)) return 'google';
  if (/1drv\.ms|onedrive\.live\.com|sharepoint\.com|office\.com|officeapps\.live\.com|onedrive\.com/i.test(t)) return 'microsoft';
  return null;
}

const WATCH = /^(?:(?:s'il (?:te|vous) plait|stp|svp|peux[- ]tu|pouvez[- ]vous|tu peux|vous pouvez|veux[- ]tu|voulez[- ]vous)[ ,]+)*suis\b|\b(?:suivre|suivi|suivez|surveille|surveiller|surveillance|previens|prevenir|prevenez|alerte|alerter|notifie|notifier|avertis|avertir|tiens moi au courant|garde un oeil|dis moi quand|dites moi quand|monitor)\b/;
const LIST = /\b(?:(?:liste|montre|affiche|voir|quels?|quelles?|combien)\b.*\b(?:suivis?|surveillances?|fichiers? suivis?|depots? suivis?)|(?:mes|les) (?:suivis?|surveillances?|fichiers? suivis?)|que (?:suis|surveilles?) (?:tu|je)|qu est ce que (?:tu suis|je suis))\b/;
const STOP = /\b(?:arrete|arreter|arretez|stop|stoppe|stopper|supprime|supprimer|annule|annuler|retire|retirer|desactive|desactiver|enleve|enlever)\b.*\b(?:suivis?|surveillances?|suivre|surveiller)\b|\b(?:ne plus|plus de) (?:suivre|surveiller)\b/;
const A = (l, a, p) => ({ l, a, p: p || {} });

function reply(text, o, mem) {
  o = o || {}; mem = mem || {};
  const q = String(text || '').trim(), qn = fold(q), group = o.scope === 'group';
  if (!q) return null;
  const where = group ? 'dans cette discussion' : 'ici';
  const url = parseUrl(q), prov = provider(q);

  if (STOP.test(qn) && !url) return { text: group ? 'Voici les fichiers suivis dans cette discussion. Vous pouvez arrêter ceux que vous avez créés (les administrateurs peuvent arrêter tous les suivis du groupe).' : 'Voici vos fichiers suivis : chaque suivi a son bouton « Arrêter ».', acts: [A('Voir les fichiers suivis', 'watch_list', {})], topic: group ? 'watch_howto_cw' : 'watch_howto' };
  if (LIST.test(qn) && !url) return { text: group ? 'Je regarde les fichiers suivis dans cette discussion.' : 'Je regarde vos fichiers suivis.', acts: [A('Voir les fichiers suivis', 'watch_list', {})], topic: group ? 'watch_howto_cw' : 'watch_howto' };

  if (!WATCH.test(qn) && !(url && /\b(?:modifi|chang|mis a jour|nouveau|evolu|commit)/.test(qn))) return null;
  // une phrase de suivi sans lien de fichier : on demande le lien
  if (!url && !prov) {
    const office = /\b(?:google|sheets|slides|drive)\b/.test(qn) ? 'google' : /\b(?:word|excel|powerpoint|onedrive|sharepoint|office|microsoft)\b/.test(qn) ? 'microsoft' : null;
    if (office) return { text: unsupported(office, group), acts: [], topic: group ? 'watch_office_cw' : 'watch_office' };
    if (!/\b(?:fichier|document|depot|repo|repository|github|lien|doc|tableur|word|excel|powerpoint|drive|onedrive|sharepoint|modification|modifie|modifies|change)/.test(qn)) return null;
    return { text: 'Quel fichier voulez-vous suivre ? Collez son lien, par exemple : « suis https://github.com/propriétaire/dépôt/blob/main/README.md ». Je sais suivre les **dépôts, dossiers et fichiers GitHub publics** ; pour Word, Excel, Google Docs, je vous explique ce qui est possible.', acts: [], topic: group ? 'watch_howto_cw' : 'watch_howto' };
  }
  if (!url && prov && prov !== 'github') return { text: unsupported(prov, group), acts: [], topic: group ? 'watch_office_cw' : 'watch_office' };
  if (!url) return { text: 'Ce lien GitHub ne désigne pas un dépôt, un dossier ou un fichier : collez l’adresse d’un dépôt (github.com/propriétaire/dépôt) ou d’un fichier de ce dépôt.', acts: [], topic: group ? 'watch_howto_cw' : 'watch_howto' };

  const what = url.ref.path ? 'le fichier ou dossier' : 'le dépôt';
  return {
    text: `👀 Je peux suivre ${what} **${url.label}** sur GitHub. Je vérifie toutes les 15 minutes environ ; à chaque modification, ${group ? 'un message est publié dans cette discussion' : 'je vous préviens ici'}.\nSeuls les dépôts **publics** sont accessibles. Rien ne démarre avant l’appui sur le bouton.`,
    acts: [A('Suivre ' + (url.ref.path ? url.ref.path.split('/').pop() : url.ref.repo), 'watch_add', { prov: 'github', ref: url.ref, label: url.label })], topic: group ? 'watch_howto_cw' : 'watch_howto',
  };
}

function unsupported(prov, group) {
  const who = prov === 'google' ? 'Google Docs, Sheets, Slides ou Drive' : 'Word, Excel, PowerPoint, OneDrive ou SharePoint';
  const own = prov === 'google' ? 'Google propose ses propres notifications dans le menu « Outils » des Docs et Sheets' : 'OneDrive et SharePoint proposent leurs propres alertes de modification';
  return `Le suivi de fichiers ${who} n’est **pas encore disponible** dans Piaf : il demande de relier votre compte ${prov === 'google' ? 'Google' : 'Microsoft'} avec une autorisation de lecture, ce qui n’est pas branché pour l’instant. En attendant, ${own}. Les fichiers stockés dans un dépôt **GitHub public** (y compris des fichiers Word ou Excel) peuvent déjà être suivis : collez simplement le lien GitHub.`;
}

const api = { parseUrl, provider, reply, unsupported, fold };
if (typeof module === 'object' && module.exports) module.exports = api; else root.T2PWATCH = api;
})(typeof window !== 'undefined' ? window : globalThis);
