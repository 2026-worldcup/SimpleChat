// Tests de la logique de l'Edge Function `watch` : `node --experimental-strip-types tests/watch-lib.test.mjs`
// Avec LIVE=1, des tests supplémentaires interrogent le vrai GitHub (dépôt LIVE_REPO=propriétaire/dépôt, par défaut octocat/Hello-World ; chemin LIVE_PATH, par défaut README).
import * as W from '../supabase/functions/watch/lib.ts';
let fail = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fail++; console.log('✗', m); } };
const sha = (c) => c.repeat(40);
const commit = (c, msg, name = 'Marie', extra = {}) => ({ sha: sha(c), html_url: `https://github.com/o/r/commit/${sha(c)}`, commit: { message: msg, author: { name }, committer: { date: '2026-10-18T14:05:00Z' } }, ...extra });
const resp = (status, body, headers = {}) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
const mk = (...rs) => { const calls = []; const f = async (u, init) => { calls.push({ u, init }); const r = rs.shift(); if (r instanceof Error) throw r; return r; }; f.calls = calls; return f; };
const ref = { owner: 'octocat', repo: 'Hello-World', path: 'README' };

// ---- validation et adresses
ok(W.validRef(ref) && W.validRef({ owner: 'a', repo: 'b' }) && W.validRef({ owner: 'a', repo: 'b', path: 'docs/x.md', branch: 'feature/x' }), 'références valides');
for (const bad of [{ owner: 'a b', repo: 'b' }, { owner: '-a', repo: 'b' }, { owner: 'a', repo: '..' }, { owner: 'a', repo: 'b c' }, { owner: 'a', repo: 'b', path: '../x' }, { owner: 'a', repo: 'b', branch: 'x..y' }, { owner: 'a/b', repo: 'c' }, { owner: 'a', repo: 'b', path: 'x\ny' }])
  ok(!W.validRef(bad), 'référence refusée : ' + JSON.stringify(bad));
ok(W.commitsUrl(ref) === 'https://api.github.com/repos/octocat/Hello-World/commits?path=README&per_page=10', 'adresse : ' + W.commitsUrl(ref));
ok(W.commitsUrl({ owner: 'a', repo: 'b', branch: 'feat/x', path: 'a b/c' }).includes('sha=feat%2Fx') && W.commitsUrl({ owner: 'a', repo: 'b', path: 'a b/c' }).includes('path=a+b%2Fc'), 'adresse : paramètres encodés');
ok(W.refLabel({ owner: 'a', repo: 'b', path: 'c/d', branch: 'main' }) === 'a/b/c/d (main)', 'libellé');

// ---- nettoyage du texte venu de GitHub
ok(W.clean('Voir https://evil.example/x?y=1 maintenant', 100) === 'Voir [lien] maintenant', 'liens retirés');
ok(W.clean('a‮b\u0007c\n d', 100) === 'a b c d', 'caractères de contrôle et de direction retirés : ' + JSON.stringify(W.clean('a‮b\u0007c\n d', 100)));
ok(W.clean('x'.repeat(200), 50).length === 50 && W.clean('x'.repeat(200), 50).endsWith('…'), 'longueur limitée');
const pc = W.parseCommits([commit('a', 'Corrige la faute\n\nDétails'), { sha: 'zzz' }, null, commit('b', '', 'Léa')]);
ok(pc.length === 2 && pc[0].title === 'Corrige la faute' && pc[1].title === '(sans message)' && pc[1].author === 'Léa', 'analyse des commits');
ok(W.parseCommits({ message: 'Not Found' }).length === 0, 'réponse non liste');
ok(W.parseCommits([commit('a', 'x', 'M', { html_url: 'https://evil.example/' })])[0].url === '', 'adresse de commit hors github.com refusée');

// ---- nouveautés
const cs = ['a', 'b', 'c', 'd'].map((c) => W.parseCommits([commit(c, 'msg ' + c)])[0]);
let fr = W.fresh(cs, sha('c')); ok(fr.list.length === 2 && !fr.more && fr.list[0].sha === sha('a'), 'nouveautés : 2 depuis la version vue');
fr = W.fresh(cs, sha('z')); ok(fr.more && fr.list.length === 4, 'version vue introuvable : plus de 10 / historique réécrit');
fr = W.fresh(cs, sha('a')); ok(fr.list.length === 0, 'rien de nouveau');

// ---- message
let m = W.buildMessage(ref, { list: [cs[0]], more: false });
ok(m.body.startsWith('🔔 Fichier suivi modifié : octocat/Hello-World/README\n« msg a », par Marie, le 18 octobre') && m.body.endsWith(cs[0].url) && m.url === cs[0].url, 'message : ' + JSON.stringify(m.body));
m = W.buildMessage({ owner: 'o', repo: 'r' }, { list: cs.slice(0, 3), more: false });
ok(/^🔔 Dépôt suivi modifié : o\/r\n/.test(m.body) && /Et 2 autres modifications depuis/.test(m.body), 'message : dépôt entier, plusieurs modifications');
m = W.buildMessage(ref, { list: cs, more: true }); ok(/Plus de 10 modifications/.test(m.body), 'message : plus de 10');
ok(W.buildMessage(ref, { list: [{ ...cs[0], title: 'y'.repeat(120), author: 'z'.repeat(40) }], more: true }).body.length <= 1500, 'message : 1500 caractères au plus');

// ---- vérification (GitHub simulé par un faux fetch)
let f = mk(resp(200, [commit('a', 'Première', 'Marie')], { etag: 'W/"e1"' }));
let r = await W.checkGithub(ref, { lastSha: null, etag: null }, { fetch: f });
ok(r.kind === 'changed' && r.sha === sha('a') && r.body === '' && r.etag === 'W/"e1"', 'première vérification : point de départ sans message');
ok(!('If-None-Match' in f.calls[0].init.headers) && f.calls[0].init.headers['User-Agent'] === 'piaf-watch' && !f.calls[0].init.headers.Authorization, 'requête : en-têtes sans jeton');
f = mk(resp(304)); r = await W.checkGithub(ref, { lastSha: sha('a'), etag: 'W/"e1"' }, { fetch: f, token: 'tok' });
ok(r.kind === 'unchanged' && f.calls[0].init.headers['If-None-Match'] === 'W/"e1"' && f.calls[0].init.headers.Authorization === 'Bearer tok', '304 : inchangé, requête conditionnelle et jeton transmis');
f = mk(resp(200, [commit('b', 'Nouvelle version'), commit('a', 'Première')], { etag: 'W/"e2"' })); r = await W.checkGithub(ref, { lastSha: sha('a'), etag: 'W/"e1"' }, { fetch: f });
ok(r.kind === 'changed' && r.sha === sha('b') && /« Nouvelle version »/.test(r.body) && r.etag === 'W/"e2"', 'modification détectée');
f = mk(resp(200, [commit('a', 'Première')])); r = await W.checkGithub(ref, { lastSha: sha('a'), etag: null }, { fetch: f }); ok(r.kind === 'unchanged', '200 sans changement');
f = mk(resp(404, { message: 'Not Found' })); r = await W.checkGithub(ref, { lastSha: sha('a'), etag: null }, { fetch: f }); ok(r.kind === 'error' && r.reason === 'not_found', '404 : introuvable ou privé');
f = mk(resp(200, [])); r = await W.checkGithub(ref, { lastSha: null, etag: null }, { fetch: f }); ok(r.kind === 'error' && r.reason === 'path_not_found', 'chemin sans historique');
f = mk(resp(409, { message: 'Git Repository is empty.' })); r = await W.checkGithub({ owner: 'a', repo: 'b' }, { lastSha: null, etag: null }, { fetch: f }); ok(r.kind === 'error' && r.reason === 'empty_repository', 'dépôt vide');
f = mk(resp(403, { message: 'rate limit' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1790000000' })); r = await W.checkGithub(ref, { lastSha: null, etag: null }, { fetch: f }); ok(r.kind === 'ratelimited' && r.resetAt === 1790000000, 'limite de requêtes atteinte');
f = mk(resp(403, { message: 'forbidden' })); r = await W.checkGithub(ref, { lastSha: null, etag: null }, { fetch: f }); ok(r.kind === 'error' && r.reason === 'forbidden', '403 sans limite : accès refusé');
f = mk(resp(503, {})); r = await W.checkGithub(ref, { lastSha: sha('a'), etag: null }, { fetch: f }); ok(r.kind === 'skip', 'panne GitHub : on réessaiera, sans compter d\'échec');
f = mk(new Error('network down')); r = await W.checkGithub(ref, { lastSha: sha('a'), etag: null }, { fetch: f }); ok(r.kind === 'skip' && r.reason === 'network', 'réseau coupé : on réessaiera');
f = mk(new Response('<html>', { status: 200 })); r = await W.checkGithub(ref, { lastSha: sha('a'), etag: null }, { fetch: f }); ok(r.kind === 'skip' && r.reason === 'bad_json', 'réponse illisible : on réessaiera');
f = mk(); r = await W.checkGithub({ owner: 'a/../b', repo: 'c' }, { lastSha: null, etag: null }, { fetch: f }); ok(r.kind === 'error' && f.calls.length === 0, 'référence invalide : aucune requête envoyée');
ok(W.timingSafeEqual('abc', 'abc') && !W.timingSafeEqual('abc', 'abd') && !W.timingSafeEqual('abc', 'abcd') && !W.timingSafeEqual('', 'a'), 'comparaison du secret');

// ---- vrai GitHub (facultatif)
if (process.env.LIVE === '1') {
  const [lo, lr] = (process.env.LIVE_REPO || 'octocat/Hello-World').split('/'), lp = process.env.LIVE_PATH || 'README';
  const R = { owner: lo, repo: lr, path: lp };
  const live = await W.checkGithub(R, { lastSha: null, etag: null });
  ok(live.kind === 'changed' && /^[0-9a-f]{40}$/.test(live.sha) && live.body === '', 'GitHub réel : point de départ obtenu (' + live.kind + ' ' + (live.sha || live.reason || '') + ')');
  const again = await W.checkGithub(R, { lastSha: live.sha, etag: live.etag });
  ok(again.kind === 'unchanged', 'GitHub réel : relance inchangée (' + again.kind + ')');
  const old = await W.checkGithub(R, { lastSha: '0'.repeat(40), etag: null });
  ok(old.kind === 'changed' && /^🔔 Fichier suivi modifié/.test(old.body) && /Plus de 10|Et \d+ autre|par /.test(old.body), 'GitHub réel : message de modification (' + old.kind + ')');
  if (old.kind === 'changed') console.log('   exemple de message :', JSON.stringify(old.body));
  const nf = await W.checkGithub({ owner: lo, repo: 'ce-depot-nexiste-pas-xyz' }, { lastSha: null, etag: null });
  ok(nf.kind === 'error', 'GitHub réel : dépôt inexistant (' + nf.kind + ' ' + (nf.reason || '') + ')');
  const np = await W.checkGithub({ owner: lo, repo: lr, path: 'fichier-inexistant.xyz' }, { lastSha: null, etag: null });
  ok(np.kind === 'error' && np.reason === 'path_not_found', 'GitHub réel : chemin inexistant (' + np.kind + ' ' + (np.reason || '') + ')');
}
console.log(`${n} contrôles, ${fail} échec(s)`);
process.exit(fail ? 1 : 0);
