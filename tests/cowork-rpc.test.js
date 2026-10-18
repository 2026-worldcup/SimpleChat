// Compatibilité de Talk2Piaf Cowork avec les sondages et les listes (migration 009) : `node tests/cowork-rpc.test.js` (sans dépendance).
// 1. chaque appel serveur écrit dans le code (nom de fonction + noms d'arguments) est comparé aux signatures de 009_collab.sql ;
// 2. le vrai views-extras.js (ext.load / ext.snapshot) est chargé avec des données de base factices, puis chaque bouton de Cowork est exécuté :
//    les appels serveur effectués doivent exister, avec des arguments valides, et les limites du moteur doivent être celles de la base.
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
let fail = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fail++; console.log('✗', m); } };

// ---------------------------------------------------------------- signatures de la migration
const sql = read('supabase/migrations/009_collab.sql');
const SIG = {};
for (const m of sql.matchAll(/create or replace function public\.(\w+)\(([^)]*)\)/gi)) {
  SIG[m[1]] = m[2].split(',').map((x) => x.trim()).filter(Boolean).map((x) => ({ name: x.split(/\s+/)[0], req: !/\bdefault\b/i.test(x) }));
}
const checkCall = (fn, args, where) => {
  const s = SIG[fn];
  if (!s) { ok(false, `${where} : la fonction ${fn} n'existe pas dans 009_collab.sql`); return; }
  const names = s.map((x) => x.name);
  for (const k of Object.keys(args)) ok(names.includes(k), `${where} : ${fn} n'a pas d'argument ${k}`);
  for (const x of s) if (x.req) ok(k_in(args, x.name), `${where} : ${fn} : argument obligatoire ${x.name} absent`);
};
const k_in = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// 1. recensement statique : tout api.rpc('x', { … }) / call('x', { … }) des fichiers de l'assistant
for (const f of ['assistant-cowork.js']) {
  for (const m of read(f).matchAll(/(?:api\.rpc|call)\('(\w+)',\s*\{([^}]*)\}/g)) {
    const keys = [...m[2].matchAll(/(\bp_\w+)\s*:/g)].map((x) => x[1]); const a = {}; keys.forEach((k) => { a[k] = 1; });
    checkCall(m[1], a, f + ' (statique)');
  }
}
for (const m of read('views-chat.js').matchAll(/api\.rpc\('(post_assistant_reply)',\s*\{([^}]*)\}/g)) { const a = {}; [...m[2].matchAll(/(\bp_\w+)\s*:/g)].forEach((x) => { a[x[1]] = 1; }); checkCall(m[1], a, 'views-chat.js'); }
ok(Object.keys(SIG).length > 20, 'signatures lues : ' + Object.keys(SIG).length);

// ---------------------------------------------------------------- environnement factice : vrai views-extras.js + vrai Cowork
const calls = [];
const rpcImpl = {};
const data = {};
const chain = (t) => { const c = { __t: t }; for (const k of ['select', 'eq', 'order', 'in', 'is', 'gte', 'lt', 'ilike', 'limit']) c[k] = () => c; return c; };
const ME = 'u-me', ADM = 'u-adm', U2 = 'u-2';
const Piaf = {
  h: (...a) => ({ h: a }), icon: () => null, iconBtn: () => null, S: { me: { id: ME, display_name: 'Camille Durand' }, online: true }, bus: { emit() {}, on() {} },
  api: {
    async rpc(fn, args) { calls.push({ fn, args }); if (fn === 'poll_results') return data.results; if (rpcImpl[fn]) return rpcImpl[fn](args); return fn.startsWith('create_') ? { id: 'm-new', kind: 'x' } : null; },
    async q(c) { return data[c.__t] || []; },
  },
  fmt: { dateTime: String }, toast() {}, sheet() {}, modal() {}, confirmDialog: async () => true, promptDialog: async () => null, errText: (e) => 'err:' + (e && e.message), uuid: () => 'uuid-' + calls.length,
  sb: { from: chain },
};
const ctxVm = { window: null, console, Date, Math, JSON, Map, Set, Promise, setTimeout, clearTimeout, Intl, Array, Object, String, Number, RegExp, Error, location: { origin: 'https://x' } };
ctxVm.window = ctxVm; ctxVm.Piaf = Piaf; ctxVm.PIAF_CONFIG = {}; ctxVm.document = {}; ctxVm.navigator = {};
vm.createContext(ctxVm);
const load = (f) => vm.runInContext(read(f), ctxVm, { filename: f });
load('views-extras.js'); load('assistant-cowork-kb.js'); load('assistant-cowork.js');
ok(typeof Piaf.ext.snapshot === 'function' && typeof Piaf.coworkAsk === 'function' && typeof Piaf.coworkRun === 'function', 'API exposée');

const CID = 'c1', future = new Date(Date.now() + 864e5 * 3).toISOString();
data.polls = [
  { id: 'p1', conversation_id: CID, message_id: 'm-p1', creator_id: ME, question: 'Quel jour pour le dîner ?', multiple: false, anonymous: false, allow_add: false, closes_at: null, closed_at: null },
  { id: 'p2', conversation_id: CID, message_id: 'm-p2', creator_id: U2, question: 'Quel restaurant ?', multiple: false, anonymous: true, allow_add: true, closes_at: null, closed_at: null },
  { id: 'p3', conversation_id: CID, message_id: 'm-p3', creator_id: ME, question: 'Ancien sondage clos', multiple: false, anonymous: false, allow_add: false, closes_at: null, closed_at: '2026-01-01T00:00:00Z' },
  { id: 'p4', conversation_id: CID, message_id: 'm-dead', creator_id: ME, question: 'Sondage supprimé', multiple: false, anonymous: false, allow_add: false, closes_at: future, closed_at: null }];
data.poll_options = [{ id: 'o1', poll_id: 'p1', label: 'Samedi', position: 0 }, { id: 'o2', poll_id: 'p1', label: 'Dimanche', position: 1 }, { id: 'o3', poll_id: 'p2', label: 'Chez Paul', position: 0 }, { id: 'o4', poll_id: 'p2', label: 'Bistrot', position: 1 }];
data.results = [{ poll_id: 'p1', option_id: 'o1', votes: 3, mine: true, voters: [ME, U2, ADM], poll_voters: 5 }, { poll_id: 'p1', option_id: 'o2', votes: 2, mine: false, voters: [U2, ADM], poll_voters: 5 },
  { poll_id: 'p2', option_id: 'o3', votes: 1, mine: false, voters: null, poll_voters: 1 }, { poll_id: 'p2', option_id: 'o4', votes: 0, mine: false, voters: null, poll_voters: 1 }];
data.todo_lists = [
  { id: 'l1', conversation_id: CID, message_id: 'm-l1', creator_id: ME, title: 'Courses', members_can_add: true, members_can_check: true },
  { id: 'l2', conversation_id: CID, message_id: 'm-l2', creator_id: U2, title: 'Cadeaux', members_can_add: false, members_can_check: false }];
data.todo_items = [{ id: 'i1', list_id: 'l1', position: 0, text: 'Lait', done: false, done_by: null, assigned_to: null }, { id: 'i2', list_id: 'l1', position: 1, text: 'Pain', done: true, done_by: U2, assigned_to: U2 },
  { id: 'i3', list_id: 'l1', position: 2, text: 'Œufs', done: false, done_by: null, assigned_to: null }, { id: 'i4', list_id: 'l2', position: 0, text: 'Livre', done: false, done_by: null, assigned_to: null }];

const names = { [ME]: 'Camille Durand', [ADM]: 'Alex Admin', [U2]: 'Marie Dupont' };
const members = [{ id: ME, name: 'Camille Durand', role: 'member' }, { id: ADM, name: 'Alex Admin', role: 'admin' }, { id: U2, name: 'Marie Dupont', role: 'member' }];
const jumps = [], searches = [], pinsOpened = [];
const mkEnv = (isAdmin) => ({ convId: CID, name: 'Les Copains', isGroup: true, isAdmin, members, pins: 1, nameOf: (id) => names[id] || '?', dead: (mid) => mid === 'm-dead',
  reload: async () => { await Piaf.ext.load(CID); }, jump: (m) => jumps.push(m), search: (p) => searches.push(p), pins: () => pinsOpened.push(1) });

(async () => {
  await Piaf.ext.load(CID);
  // lecture
  const snap = Piaf.ext.snapshot(CID, { isAdmin: false, nameOf: (id) => names[id], dead: (m) => m === 'm-dead' });
  ok(snap.polls.length === 3 && !snap.polls.some((p) => p.id === 'p4'), 'snapshot : sondage supprimé ignoré');
  const p1 = snap.polls.find((p) => p.id === 'p1'), p3 = snap.polls.find((p) => p.id === 'p3');
  ok(p1.open && p1.mine && p1.total === 5 && p1.mid === 'm-p1' && p1.votes[0].t === 'Samedi' && p1.votes[0].n === 3, 'snapshot : sondage ouvert ' + JSON.stringify(p1));
  ok(!p3.open, 'snapshot : sondage clos');
  const l1 = snap.lists.find((l) => l.id === 'l1'), l2 = snap.lists.find((l) => l.id === 'l2');
  ok(l1.mine && l1.canAdd && l1.canCheck && l1.items.length === 3 && l1.items[1].who === 'Marie Dupont' && l1.items[1].whoId === U2, 'snapshot : liste ' + JSON.stringify(l1).slice(0, 120));
  ok(!l2.mine && !l2.canAdd && !l2.canCheck, 'snapshot : droits d’une liste verrouillée (membre)');
  ok(Piaf.ext.snapshot(CID, { isAdmin: true }).lists.find((l) => l.id === 'l2').canAdd, 'snapshot : un administrateur peut tout');

  // chaque demande → bouton → appel serveur valide
  const scenarios = [
    ['@Talk2Piaf Cowork crée un sondage : Quel jour ? samedi, dimanche', 'poll_create', 'create_poll', (a) => a.p_question === 'Quel jour ?' && a.p_options.join() === 'Samedi,Dimanche' && a.p_closes_at === null && a.p_allow_add === false],
    ['crée un sondage anonyme à choix multiples de 48 h avec options ouvertes : Activités ? ski, spa', 'poll_create', 'create_poll', (a) => a.p_anonymous && a.p_multiple && a.p_allow_add && Math.abs(new Date(a.p_closes_at) - Date.now() - 48 * 3600e3) < 5000],
    ['clôture le sondage du dîner', 'poll_close', 'poll_close', (a) => a.p_poll === 'p1' && a.p_closed === true],
    ['rouvre le sondage', 'poll_close', 'poll_close', (a) => a.p_poll === 'p3' && a.p_closed === false],
    ['supprime le sondage du dîner', 'poll_delete', 'delete_message_for_all', (a) => a.p_id === 'm-p1'],
    ['crée une liste de courses : lait, pain', 'list_create', 'create_todo', (a) => a.p_title === 'Courses' && a.p_items.join() === 'Lait,Pain' && a.p_members_can_add === true],
    ['ajoute du fromage à la liste de courses', 'list_add', 'todo_add_item', (a) => a.p_list === 'l1' && a.p_text === 'Fromage' && a.p_assigned === null],
    ['coche le lait', 'list_check', 'todo_set_done', (a) => a.p_item === 'i1' && a.p_done === true],
    ['décoche le pain', 'list_check', 'todo_set_done', (a) => a.p_item === 'i2' && a.p_done === false],
    ['Marie s’occupe des œufs', 'list_assign', 'todo_update_item', (a) => a.p_item === 'i3' && a.p_assigned === U2 && a.p_set_assigned === true && a.p_text === 'Œufs'],
    ['je prends le lait', 'list_assign', 'todo_update_item', (a) => a.p_item === 'i1' && a.p_assigned === ME],
    ['efface les éléments terminés de la liste de courses', 'list_clear_done', 'todo_clear_done', (a) => a.p_list === 'l1'],
    ['supprime la liste courses', 'list_delete', 'delete_message_for_all', (a) => a.p_id === 'm-l1'],
  ];
  for (const [q, act, fn, chk] of scenarios) {
    calls.length = 0;
    const r = Piaf.coworkAsk(q, mkEnv(false)); const a = r.acts.find((x) => x.a === act);
    ok(!!a, `« ${q} » → bouton ${act} (obtenu : ${r.acts.map((x) => x.a)})`); if (!a) continue;
    ok(calls.length === 0, `« ${q} » : rien n'est appelé avant l'appui`);
    ok(/rien n’est (créé|modifié|supprimé) avant/.test(r.hint) || /confirmation/.test(r.text + r.hint) || act === 'list_delete', `« ${q} » : phrase d'accompagnement (hint)`);
    let res; try { res = await Piaf.coworkRun(a, mkEnv(false)); } catch (e) { ok(false, `« ${q} » : ${e.message}`); continue; }
    const c = calls.find((x) => x.fn === fn); ok(!!c, `« ${q} » → appel ${fn} (obtenus : ${calls.map((x) => x.fn)})`); if (!c) continue;
    checkCall(c.fn, c.args, `« ${q} »`); ok(chk(c.args), `« ${q} » : arguments ${JSON.stringify(c.args)}`);
    ok(res && (res.say || res.nodone), `« ${q} » : retour`);
    ok(calls.some((x) => x.fn === 'poll_results'), `« ${q} » : la discussion est rechargée après l'action`);
  }

  // droits : un membre ne peut ni supprimer la liste d'un autre, ni cocher dans une liste verrouillée ; un administrateur le peut
  let r = Piaf.coworkAsk('supprime la liste cadeaux', mkEnv(false)); ok(!r.acts.length && /auteur|administrateurs/.test(r.text), 'membre : suppression refusée');
  r = Piaf.coworkAsk('supprime la liste cadeaux', mkEnv(true)); ok(r.acts.some((a) => a.a === 'list_delete'), 'administrateur : suppression proposée');
  r = Piaf.coworkAsk('coche le livre', mkEnv(false)); ok(!r.acts.length, 'membre : liste verrouillée, rien à cocher');
  r = Piaf.coworkAsk('coche le livre', mkEnv(true)); ok(r.acts.some((a) => a.a === 'list_check'), 'administrateur : peut cocher');
  r = Piaf.coworkAsk('clôture le sondage du restaurant', mkEnv(false)); ok(!r.acts.length, 'membre : sondage d’un autre non clôturable');
  r = Piaf.coworkAsk('clôture le sondage du restaurant', mkEnv(true)); ok(r.acts.length === 1 && r.acts[0].p.id === 'p2', 'administrateur : sondage clôturable');

  // limites du moteur = limites de la base
  r = Piaf.coworkAsk('crée un sondage : Q ? ' + Array.from({ length: 13 }, (_, i) => 'o' + i).join(', '), mkEnv(false)); ok(!r.acts.length && /12 options/.test(r.text), 'limite : 12 options');
  ok(/cardinality\(v_opts\) not between 2 and 12/.test(sql) && />= 12 then raise exception 'too_many_options'/.test(sql), 'la migration confirme : 2 à 12 options');
  ok(/cardinality\(v_items\) > 50/.test(sql) && />= 100 then raise exception 'too_many_items'/.test(sql), 'la migration confirme : 50 éléments à la création, 100 au total');
  ok(/char_length\(v_q\) not between 1 and 300/.test(sql) && /char_length\(x\) > 100/.test(sql) && /char_length\(x\) > 200/.test(sql) && /366 days/.test(sql), 'la migration confirme : 300 / 100 / 200 caractères, clôture sous 366 jours');
  const L = Piaf.coworkAsk('combien d’options dans un sondage', mkEnv(false)); ok(/12 options/.test(L.text), 'le moteur annonce 12 options');
  // caractères de contrôle : refusés par la base, nettoyés avant l'envoi
  calls.length = 0; await Piaf.coworkRun({ a: 'poll_create', p: { conv: CID, q: 'Quoi\t?', opts: ['a\u0007', 'b'], multi: false, anon: false, allow: false, hours: null } }, mkEnv(false));
  const cc = calls.find((c) => c.fn === 'create_poll'); ok(cc && !/[\u0000-\u001f]/.test(cc.args.p_question + cc.args.p_options.join('')), 'caractères de contrôle nettoyés');
  // sondage clos : pas de nouveau vote ni de réouverture sans droit ; erreurs de la base lisibles
  rpcImpl.poll_close = () => { throw new Error('poll_closed'); };
  const act = Piaf.coworkAsk('clôture le sondage du dîner', mkEnv(false)).acts[0];
  try { await Piaf.coworkRun(act, mkEnv(false)); ok(false, 'erreur serveur non remontée'); } catch (e) { ok(/err:poll_closed/.test(e.message), 'erreur serveur remontée lisiblement : ' + e.message); }
  delete rpcImpl.poll_close;
  // navigation
  calls.length = 0; await Piaf.coworkRun({ a: 'jump', p: { conv: CID, mid: 'm-p1' } }, mkEnv(false)); ok(jumps[0] === 'm-p1' && !calls.length, 'jump : aucun appel serveur');
  await Piaf.coworkRun({ a: 'search', p: { q: 'x', kind: 'media', from: U2, since: '2026-10-01', until: null } }, mkEnv(false)); ok(searches[0].from === U2 && searches[0].kind === 'media', 'search : filtres transmis');
  await Piaf.coworkRun({ a: 'pins', p: {} }, mkEnv(false)); ok(pinsOpened.length === 1, 'pins');
  console.log(`${Object.keys(SIG).length} fonctions lues dans 009_collab.sql, ${n} contrôles, ${fail} échec(s)`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
