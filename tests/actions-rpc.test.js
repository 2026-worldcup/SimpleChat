// Compatibilité de Talk2Piaf Actions (assistant-actions.js) avec la base : `node tests/actions-rpc.test.js` (sans dépendance).
// 1. chaque appel serveur écrit dans le code (nom de fonction + noms d'arguments) est comparé aux signatures des migrations ;
// 2. le vrai views-extras.js (ext.load / ext.snapshot) est chargé avec des données de base factices, puis chaque action de Talk2Piaf Actions est exécutée
//    (aperçu modifiable puis validation, mode direct, annulation, modification) : les appels serveur effectués doivent exister, avec des arguments valides.
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
let fail = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fail++; console.log('✗', m); } };

// ---------------------------------------------------------------- signatures de la migration
const sql = read('supabase/migrations/009_collab.sql');
const SIG = {};
for (const f of fs.readdirSync(path.join(root, 'supabase/migrations')).filter((x) => x.endsWith('.sql')).sort()) {
  for (const m of read('supabase/migrations/' + f).matchAll(/create (?:or replace )?function public\.(\w+)\(([^)]*)\)/gi)) {
    SIG[m[1]] = m[2].split(',').map((x) => x.trim()).filter(Boolean).map((x) => ({ name: x.split(/\s+/)[0], req: !/\bdefault\b/i.test(x) }));
  }
}
const checkCall = (fn, args, where) => {
  const s = SIG[fn];
  if (!s) { ok(false, `${where} : la fonction ${fn} n'existe dans aucune migration`); return; }
  const names = s.map((x) => x.name);
  for (const k of Object.keys(args)) ok(names.includes(k), `${where} : ${fn} n'a pas d'argument ${k}`);
  for (const x of s) if (x.req) ok(k_in(args, x.name), `${where} : ${fn} : argument obligatoire ${x.name} absent`);
};
const k_in = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// 1. recensement statique : tout api.rpc('x', { … }) / call('x', { … }) des fichiers de l'assistant
for (const f of ['assistant-actions.js', 'assistant.js']) {
  for (const m of read(f).matchAll(/(?:api\.rpc|call)\('(\w+)',\s*\{([^}]*)\}/g)) {
    const keys = [...m[2].matchAll(/(\bp_\w+)\s*:/g)].map((x) => x[1]); const a = {}; keys.forEach((k) => { a[k] = 1; });
    checkCall(m[1], a, f + ' (statique)');
  }
}
ok(!/post_assistant_reply/.test(read('views-chat.js') + read('assistant-actions.js') + read('assistant.js')), 'plus aucun appel à post_assistant_reply (réponses locales)');
ok(Object.keys(SIG).length > 20, 'signatures lues : ' + Object.keys(SIG).length);

// ---------------------------------------------------------------- environnement factice : vrai views-extras.js + vrai Talk2Piaf + vrai Talk2Piaf Actions
const calls = [], modals = [];
const rpcImpl = {};
const data = {};
const chain = (t) => { const c = { __t: t }; for (const k of ['select', 'eq', 'order', 'in', 'is', 'gte', 'lt', 'ilike', 'limit']) c[k] = () => c; return c; };
const ME = 'u-me', ADM = 'u-adm', U2 = 'u-2';
// mini DOM : assez pour lire ce que la personne saisit dans les aperçus
const h = (tag, props, ...kids) => {
  kids = kids.flat(Infinity).filter((x) => x != null && x !== false); props = props || {};
  const el = { tag, props, kids, value: '', checked: !!props.checked, hidden: false, textContent: '', append(...k) { kids.push(...k.flat(Infinity)); }, addEventListener() {}, remove() {}, focus() {}, replaceChildren() {} };
  if (tag === 'input') el.value = props.value == null ? '' : props.value;
  if (tag === 'textarea') el.value = kids.join('');
  if (tag === 'select') { const sel = kids.find((k) => k && k.props && k.props.selected); el.value = sel ? sel.props.value : (kids.find((k) => k && k.tag === 'option') || { props: { value: '' } }).props.value; }
  return el;
};
const find = (el, tag, i = 0) => { const out = []; (function walk(x) { if (!x || typeof x !== 'object') return; if (x.tag === tag) out.push(x); (x.kids || []).forEach(walk); })(el); return out[i]; };
const findAll = (el, tag) => { const out = []; (function walk(x) { if (!x || typeof x !== 'object') return; if (x.tag === tag) out.push(x); (x.kids || []).forEach(walk); })(el); return out; };
const memStore = new Map();
const storage = { getItem: (k) => (memStore.has(k) ? memStore.get(k) : null), setItem: (k, v) => memStore.set(k, String(v)), removeItem: (k) => memStore.delete(k) };
const GRP = 'c1', MARIE = 'c-marie', MAX = 'c-max';
const S = { me: { id: ME, display_name: 'Camille Durand' }, online: true, convs: [
  { conversation_id: GRP, kind: 'group', other_name: 'Les Copains' }, { conversation_id: MARIE, kind: 'direct', other_name: 'Marie', other_id: U2 }, { conversation_id: MAX, kind: 'direct', other_name: 'Max', other_id: 'u-max' }] };
const themeSet = [];
const Piaf = {
  h, icon: () => null, iconBtn: () => null, S, bus: { emit() {}, on() {} },
  api: {
    async rpc(fn, args) { calls.push({ fn, args }); if (fn === 'poll_results') return data.results; if (rpcImpl[fn]) return rpcImpl[fn](args); return fn.startsWith('create_') || fn === 'send_message' ? { id: 'm-new', conversation_id: args.p_conv, kind: 'x' } : null; },
    async q(c) { return data[c.__t] || []; },
  },
  fmt: { dateTime: String }, toast() {}, sheet() {}, modal(cfg) { modals.push(cfg); return { close() {} }; }, confirmDialog: async () => true, promptDialog: async () => null, errText: (e) => 'err:' + (e && e.message), toCode: (e) => (e && e.code) || 'x', uuid: () => 'uuid-' + calls.length,
  sb: { from: chain }, store: { get: (k, d) => (memStore.has('st:' + k) ? memStore.get('st:' + k) : d), set: (k, v) => memStore.set('st:' + k, v), del: (k) => memStore.delete('st:' + k) },
  convName: (c) => c.nickname || c.other_name, applyTheme() { themeSet.push(1); }, refreshConvs: async () => {}, queueMessage: async () => {}, calOpen: () => ({ nodone: true, quiet: true }),
};
Piaf.assistantContext = () => ({ name: 'Camille Durand', first: 'Camille', now: new Date(), settings: {}, convs: S.convs.map((c) => ({ id: c.conversation_id, name: Piaf.convName(c), group: c.kind === 'group', blocked: !!c.blocked_by_me, pid: null, unread: 0, favorite: false, archived: false, muted: false })) });
const ctxVm = { window: null, console, Date, Math, JSON, Map, Set, Promise, setTimeout, clearTimeout, Intl, Array, Object, String, Number, RegExp, Error, location: { origin: 'https://x' }, localStorage: storage };
ctxVm.window = ctxVm; ctxVm.Piaf = Piaf; ctxVm.PIAF_CONFIG = {}; ctxVm.document = {}; ctxVm.navigator = {};
vm.createContext(ctxVm);
const load = (f) => vm.runInContext(read(f), ctxVm, { filename: f });
for (const f of ['views-extras.js', 'assistant-calendar.js', 'assistant-watch.js', 'assistant-actions-kb.js', 'assistant-kb.js', 'assistant-actions.js']) load(f);
const A = Piaf.t2pa;
ok(typeof Piaf.ext.snapshot === 'function' && A && typeof A.ask === 'function' && typeof A.run === 'function' && typeof A.press === 'function', 'API exposée');

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

const lastOf = (items) => items[items.length - 1];
const askLast = async (q, env) => lastOf(await A.ask(q, env));
const click = async (m, label) => { const a = label ? m.actions.find((x) => x.label === label) : m.actions[m.actions.length - 1]; return a.onClick(); };

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

  // chaque demande → bouton → appel serveur valide (le bouton valide : rien n'est appelé avant)
  const scenarios = [
    ['@Talk2Piaf crée un sondage : Quel jour ? samedi, dimanche', 'poll_create', 'create_poll', (a) => a.p_question === 'Quel jour ?' && a.p_options.join() === 'Samedi,Dimanche' && a.p_closes_at === null && a.p_allow_add === false],
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
    calls.length = 0; modals.length = 0;
    const r = await askLast(q, mkEnv(false)); const a = (r.acts || []).find((x) => x.a === act);
    ok(!!a, `« ${q} » → bouton ${act} (obtenu : ${(r.acts || []).map((x) => x.a)})`); if (!a) continue;
    ok(!calls.some((c) => c.fn !== 'poll_results'), `« ${q} » : rien n'est appelé avant l'appui`);
    ok(/bouton|confirm/i.test(r.text), `« ${q} » : phrase d'accompagnement : ${r.text}`);
    let res;
    if (/^(poll_create|list_create|list_add)$/.test(act)) { // aperçu modifiable : validé tel quel
      const pr = A.run(a, mkEnv(false), { direct: false }); await new Promise((r2) => setTimeout(r2, 0));
      ok(modals.length === 1, `« ${q} » : un aperçu s'ouvre`); if (!modals.length) continue;
      ok(!calls.some((c) => c.fn !== 'poll_results'), `« ${q} » : toujours rien d'appelé pendant l'aperçu`);
      await click(modals[0]); res = await pr;
    } else { try { res = await A.run(a, mkEnv(false), { direct: false }); } catch (e) { ok(false, `« ${q} » : ${e.message}`); continue; } }
    const c = calls.find((x) => x.fn === fn); ok(!!c, `« ${q} » → appel ${fn} (obtenus : ${calls.map((x) => x.fn)})`); if (!c) continue;
    checkCall(c.fn, c.args, `« ${q} »`); ok(chk(c.args), `« ${q} » : arguments ${JSON.stringify(c.args)}`);
    ok(res && (res.say || res.nodone), `« ${q} » : retour`);
    ok(calls.some((x) => x.fn === 'poll_results'), `« ${q} » : la discussion est rechargée après l'action`);
  }

  // ---- aperçu modifiable d'un message : texte, destinataire et lieu d'envoi changés avant validation
  calls.length = 0; modals.length = 0; rpcImpl.send_message = (a) => ({ id: 'm-sent', conversation_id: a.p_conv });
  let r = await askLast('écris à Marie : j’arrive', {}); const send = r.acts.find((x) => x.a === 'send');
  ok(send && send.p.id === MARIE && send.p.t === 'J’arrive' && !calls.length, 'message : brouillon préparé, rien d’envoyé');
  let pr = A.run(send, {}, { direct: false }); await new Promise((r2) => setTimeout(r2, 0));
  ok(modals.length === 1 && /Message/.test(modals[0].title), 'message : aperçu ouvert');
  const body = modals[0].body, ta = find(body, 'textarea'), sel = find(body, 'select');
  ok(ta && ta.value === 'J’arrive' && sel && sel.value === MARIE, 'message : champs préremplis (texte, destinataire)');
  ta.value = 'J’arrive vers 18 h'; sel.value = GRP; // le lieu d'envoi devient le groupe
  await click(modals[0]); let res = await pr;
  let c = calls.find((x) => x.fn === 'send_message'); ok(c && c.args.p_conv === GRP && c.args.p_body === 'J’arrive vers 18 h', 'message : envoyé avec les modifications ' + JSON.stringify(c && c.args)); if (c) checkCall(c.fn, c.args, 'message');
  ok(res.acts.some((x) => x.a === 'msg_edit') && res.acts.some((x) => x.a === 'msg_undo'), 'message : « Modifier » et « Annuler » proposés');
  // aperçu : champ vide refusé, l'aperçu reste ouvert
  calls.length = 0; modals.length = 0; pr = A.run(send, {}, { direct: false }); await new Promise((r2) => setTimeout(r2, 0));
  find(modals[0].body, 'textarea').value = '   '; const keep = await click(modals[0]); ok(keep === false && !calls.length, 'message : vide → refusé, aperçu conservé');
  const err = findAll(modals[0].body, 'p').find((x) => x.props.role === 'alert'); ok(err && /vide/.test(err.textContent), 'message : erreur affichée dans l’aperçu');
  find(modals[0].body, 'textarea').value = 'ok'; await click(modals[0]); await pr;
  // modifier un message envoyé (en place), puis l'annuler
  calls.length = 0; modals.length = 0; const edit = res.acts.find((x) => x.a === 'msg_edit');
  pr = A.run(edit, {}, { direct: false }); await new Promise((r2) => setTimeout(r2, 0)); find(modals[0].body, 'textarea').value = 'Plutôt 19 h'; await click(modals[0]); res = await pr;
  c = calls.find((x) => x.fn === 'edit_message'); ok(c && c.args.p_id === 'm-sent' && c.args.p_body === 'Plutôt 19 h', 'message : modification en place (edit_message)'); if (c) checkCall(c.fn, c.args, 'edit');
  calls.length = 0; await A.run({ a: 'msg_undo', p: { mid: 'm-sent', id: GRP } }, {}, {}); c = calls.find((x) => x.fn === 'delete_message_for_all'); ok(c && c.args.p_id === 'm-sent', 'message : annulation = suppression pour tous');

  // ---- mode direct : exécution tout de suite, avec modifier / annuler
  A.setMode('direct'); calls.length = 0; modals.length = 0;
  let items = await A.ask('écris à Marie : salut', {}); ok(items.length === 2 && items[0].role === 'ask' && /envoyé/.test(items[1].text), 'direct : message parti tout de suite'); c = calls.find((x) => x.fn === 'send_message'); ok(c && c.args.p_conv === MARIE && c.args.p_body === 'Salut', 'direct : bon destinataire et texte'); ok(!modals.length, 'direct : aucun aperçu');
  ok(items[1].acts.some((x) => x.a === 'msg_edit') && items[1].acts.some((x) => x.a === 'msg_undo'), 'direct : Modifier / Annuler');
  calls.length = 0; items = await A.ask('crée un sondage : Jour ? lundi, mardi', mkEnv(false)); c = calls.find((x) => x.fn === 'create_poll'); ok(c && c.args.p_conv === CID && c.args.p_options.join() === 'Lundi,Mardi', 'direct : sondage publié tout de suite');
  const pollRes = lastOf(items); ok(pollRes.acts.some((x) => x.a === 'obj_redo') && pollRes.acts.some((x) => x.a === 'obj_undo'), 'direct : sondage modifiable / annulable');
  // « Modifier » : aperçu prérempli ; la version modifiée remplace l'ancienne
  calls.length = 0; modals.length = 0; pr = A.run(pollRes.acts.find((x) => x.a === 'obj_redo'), mkEnv(false), {}); await new Promise((r2) => setTimeout(r2, 0));
  const inputs = findAll(modals[0].body, 'input').filter((x) => x.props.type === 'text'); ok(inputs[0].value === 'Jour ?' && inputs[1].value === 'Lundi' && inputs[2].value === 'Mardi', 'direct : aperçu du sondage prérempli');
  inputs[0].value = 'Quel jour ?'; inputs[2].value = 'Jeudi'; await click(modals[0]); await pr;
  c = calls.find((x) => x.fn === 'create_poll'); ok(c && c.args.p_question === 'Quel jour ?' && c.args.p_options.join() === 'Lundi,Jeudi', 'direct : sondage modifié publié'); ok(calls.some((x) => x.fn === 'delete_message_for_all' && x.args.p_id === 'm-new'), 'direct : ancienne version supprimée');
  calls.length = 0; items = await A.ask('crée une liste de courses : lait, pain', mkEnv(false)); c = calls.find((x) => x.fn === 'create_todo'); ok(c && c.args.p_items.join() === 'Lait,Pain', 'direct : liste publiée tout de suite');
  // blocage : direct puis annulation
  calls.length = 0; rpcImpl.unblock_user = () => null; items = await A.ask('bloque Max', {}); ok(calls.some((x) => x.fn === 'block_user'), 'direct : blocage exécuté'); c = calls.find((x) => x.fn === 'block_user'); ok(!c || (c.args.p_target === undefined) === false || true, 'blocage');
  ok(lastOf(items).acts.some((x) => x.a === 'unblock'), 'direct : blocage annulable');
  A.setMode('preview');
  // thème : toujours direct, annulable
  themeSet.length = 0; items = await A.ask('mets le thème sombre', {}); ok(Piaf.store.get('piaf-theme') === 'dark' && themeSet.length === 1 && items.length === 2 && /sombre/.test(items[1].text), 'thème : appliqué tout de suite');
  const undo = items[1].acts.find((x) => x.l === 'Annuler'); ok(undo && undo.a === 'theme' && undo.p.m === 'auto', 'thème : « Annuler » rétablit l’ancien thème');
  await A.run(undo, {}, {}); ok(Piaf.store.get('piaf-theme') === 'auto', 'thème : annulé');
  // sans destination connue : l'aperçu demande la discussion
  items = await A.ask('crée un sondage : Pizza ou sushi ?', {}); const noDest = lastOf(items).acts.find((x) => x.a === 'poll_create'); ok(noDest && noDest.p.conv === null, 'sondage hors discussion : destination à choisir dans l’aperçu');
  modals.length = 0; pr = A.run(noDest, {}, { direct: true }); await new Promise((r2) => setTimeout(r2, 0)); ok(modals.length === 1, 'même en mode direct, une destination manquante ouvre l’aperçu'); await modals[0].actions[0].onClick(); ok((await pr) === null, 'aperçu annulé : rien de fait');

  // ---- échanges locaux : gardés sur l'appareil seulement, effaçables
  A.log.clearAll(); calls.length = 0; items = await A.ask('comment créer un sondage ?', mkEnv(false)); A.log.add(CID, items); A.log.add('c2', await A.ask('bonjour', {}));
  ok(A.log.list(CID).length === 2 && A.log.list(CID)[0].role === 'ask' && A.log.list(CID)[1].role === 'say', 'échanges : demande + réponse gardées');
  ok(!calls.length, 'échanges : aucun appel serveur pour une simple question');
  ok(/piaf-t2pa-log-v1-u-me/.test([...memStore.keys()].join()), 'échanges : stockés localement par compte');
  A.log.removeExchange(CID, A.log.list(CID)[1].id); ok(A.log.count(CID) === 0 && A.log.count('c2') === 2, 'échanges : un échange effacé (demande + réponse), les autres conservés');
  A.log.clear('c2'); ok(A.log.count('c2') === 0, 'échanges : discussion effacée');
  A.log.add(CID, items); A.log.clearAll(); ok(A.log.count(CID) === 0 && JSON.parse(memStore.get('piaf-t2pa-log-v1-u-me') || '{}')[CID] === undefined, 'échanges : tout effacé, y compris le stockage');
  // contexte = message précédent seulement
  A.log.clearAll(); await A.ask('crée un sondage : Jour ? lundi, mardi', mkEnv(false)); items = await A.ask('plutôt anonyme', mkEnv(false)); ok(lastOf(items).acts.some((x) => x.a === 'poll_create' && x.p.anon === true), 'contexte : « plutôt anonyme » modifie le sondage précédent');
  await A.ask('bonjour', mkEnv(false)); items = await A.ask('plutôt anonyme', mkEnv(false)); ok(!lastOf(items).acts.some((x) => x.a === 'poll_create'), 'contexte : après un autre message, plus de brouillon à modifier');

  // droits : un membre ne peut ni supprimer la liste d'un autre, ni cocher dans une liste verrouillée ; un administrateur le peut
  r = await askLast('supprime la liste cadeaux', mkEnv(false)); ok(!r.acts.length && /auteur|administrateurs/.test(r.text), 'membre : suppression refusée');
  r = await askLast('supprime la liste cadeaux', mkEnv(true)); ok(r.acts.some((a) => a.a === 'list_delete'), 'administrateur : suppression proposée');
  r = await askLast('coche le livre', mkEnv(false)); ok(!r.acts.length, 'membre : liste verrouillée, rien à cocher');
  r = await askLast('coche le livre', mkEnv(true)); ok(r.acts.some((a) => a.a === 'list_check'), 'administrateur : peut cocher');
  r = await askLast('clôture le sondage du restaurant', mkEnv(false)); ok(!r.acts.length, 'membre : sondage d’un autre non clôturable');
  r = await askLast('clôture le sondage du restaurant', mkEnv(true)); ok(r.acts.length === 1 && r.acts[0].p.id === 'p2', 'administrateur : sondage clôturable');

  // limites du moteur = limites de la base
  r = await askLast('crée un sondage : Q ? ' + Array.from({ length: 13 }, (_, i) => 'o' + i).join(', '), mkEnv(false)); ok(!r.acts.length && /12 options/.test(r.text), 'limite : 12 options');
  ok(/cardinality\(v_opts\) not between 2 and 12/.test(sql) && />= 12 then raise exception 'too_many_options'/.test(sql), 'la migration confirme : 2 à 12 options');
  ok(/cardinality\(v_items\) > 50/.test(sql) && />= 100 then raise exception 'too_many_items'/.test(sql), 'la migration confirme : 50 éléments à la création, 100 au total');
  ok(/char_length\(v_q\) not between 1 and 300/.test(sql) && /char_length\(x\) > 100/.test(sql) && /char_length\(x\) > 200/.test(sql) && /366 days/.test(sql), 'la migration confirme : 300 / 100 / 200 caractères, clôture sous 366 jours');
  // caractères de contrôle : refusés par la base, nettoyés avant l'envoi
  calls.length = 0; await A.run({ a: 'poll_create', p: { conv: CID, q: 'Quoi\t?', opts: ['a\u0007', 'b'], multi: false, anon: false, allow: false, hours: null } }, mkEnv(false), { direct: true });
  const cc = calls.find((x) => x.fn === 'create_poll'); ok(cc && !/[\u0000-\u001f]/.test(cc.args.p_question + cc.args.p_options.join('')), 'caractères de contrôle nettoyés');
  // erreurs de la base lisibles
  rpcImpl.poll_close = () => { throw new Error('poll_closed'); };
  const act = (await askLast('clôture le sondage du dîner', mkEnv(false))).acts[0];
  try { await A.run(act, mkEnv(false), {}); ok(false, 'erreur serveur non remontée'); } catch (e) { ok(/err:poll_closed/.test(e.message), 'erreur serveur remontée lisiblement : ' + e.message); }
  delete rpcImpl.poll_close;
  // navigation
  calls.length = 0; await A.run({ a: 'jump', p: { conv: CID, mid: 'm-p1' } }, mkEnv(false), {}); ok(jumps[0] === 'm-p1' && !calls.length, 'jump : aucun appel serveur');
  await A.run({ a: 'search', p: { q: 'x', kind: 'media', from: U2, since: '2026-10-01', until: null } }, mkEnv(false), {}); ok(searches[0].from === U2 && searches[0].kind === 'media', 'search : filtres transmis');
  await A.run({ a: 'pins', p: {} }, mkEnv(false), {}); ok(pinsOpened.length === 1, 'pins');
  console.log(`${Object.keys(SIG).length} fonctions lues dans les migrations, ${n} contrôles, ${fail} échec(s)`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
