/* Piaf — sondages, listes de tâches collaboratives, messages vocaux (enregistrement et lecture).
   Les données des sondages et des listes viennent de Supabase (lecture seule, écritures par fonctions serveur) ;
   les votes d'un sondage anonyme ne sont jamais envoyés aux autres membres. */
(() => {
'use strict';
const { h, icon, iconBtn, S, bus, api, fmt, toast, sheet, modal, confirmDialog, promptDialog, errText, sb, uuid } = Piaf;
const ext = Piaf.ext = {};

// ------------------------------------------------------------------ données par conversation
const stores = new Map();
const mk = () => ({ polls: new Map(), opts: new Map(), res: new Map(), pv: new Map(), lists: new Map(), items: new Map(), ready: false });
const st = (cid) => { if (!stores.has(cid)) stores.set(cid, mk()); return stores.get(cid); };
const settle = (p) => p.then((v) => ({ v }), (e) => ({ e }));
ext.load = async (cid) => {
  const [pl, op, rs, tl, ti] = await Promise.all([
    settle(api.q(sb.from('polls').select('id,conversation_id,message_id,creator_id,question,multiple,anonymous,allow_add,closes_at,closed_at').eq('conversation_id', cid))),
    settle(api.q(sb.from('poll_options').select('id,poll_id,label,position').eq('conversation_id', cid).order('position'))),
    settle(api.rpc('poll_results', { p_conv: cid })),
    settle(api.q(sb.from('todo_lists').select('id,conversation_id,message_id,creator_id,title,members_can_add,members_can_check').eq('conversation_id', cid))),
    settle(api.q(sb.from('todo_items').select('id,list_id,position,text,done,done_by,assigned_to').eq('conversation_id', cid).order('position'))),
  ]);
  const s = st(cid);
  if (pl.v) s.polls = new Map(pl.v.map((p) => [p.message_id, p]));
  if (op.v) { s.opts = new Map(); op.v.forEach((o) => { if (!s.opts.has(o.poll_id)) s.opts.set(o.poll_id, []); s.opts.get(o.poll_id).push(o); }); }
  if (rs.v) { s.res = new Map(rs.v.map((r) => [r.option_id, r])); s.pv = new Map(rs.v.map((r) => [r.poll_id, r.poll_voters])); }
  if (tl.v) s.lists = new Map(tl.v.map((l) => [l.message_id, l]));
  if (ti.v) { s.items = new Map(); ti.v.forEach((i) => { if (!s.items.has(i.list_id)) s.items.set(i.list_id, []); s.items.get(i.list_id).push(i); }); }
  s.ready = true;
};
ext.sig = (m, ctx) => {
  const s = stores.get(ctx.convId); if (!s) return 0;
  if (m.kind === 'poll') { const p = s.polls.get(m.id); if (!p) return 'x'; const o = s.opts.get(p.id) || []; return [p, o, o.map((x) => s.res.get(x.id)), s.pv.get(p.id)]; }
  if (m.kind === 'todo') { const l = s.lists.get(m.id); return l ? [l, s.items.get(l.id)] : 'x'; }
  return 0;
};
const rerender = (ctx) => ctx.rerender();
const ownerOf = (x, ctx) => x.creator_id === S.me.id || ctx.isAdmin();
const fail = (e) => toast(errText(e), { error: true });

// État des sondages et des listes d'une discussion, au format attendu par Talk2Piaf Cowork (assistant-cowork-kb.js) : lecture seule.
// o = { isAdmin: bool, nameOf(id), dead(messageId) } ; les sondages et listes dont le message est supprimé sont ignorés.
ext.snapshot = (cid, o = {}) => {
  const s = stores.get(cid), out = { polls: [], lists: [] }; if (!s) return out;
  const dead = o.dead || (() => false), admin = !!o.isAdmin, nm = o.nameOf || (() => '');
  for (const p of s.polls.values()) {
    if (dead(p.message_id)) continue;
    const closed = !!p.closed_at || (p.closes_at && new Date(p.closes_at) <= Date.now());
    out.polls.push({ id: p.id, mid: p.message_id, question: p.question, open: !closed, mine: p.creator_id === S.me.id, total: s.pv.get(p.id) || 0,
      votes: (s.opts.get(p.id) || []).map((x) => ({ t: x.label, n: (s.res.get(x.id) || {}).votes || 0 })) });
  }
  for (const l of s.lists.values()) {
    if (dead(l.message_id)) continue;
    const owner = l.creator_id === S.me.id || admin;
    out.lists.push({ id: l.id, mid: l.message_id, title: l.title, open: true, mine: l.creator_id === S.me.id, canAdd: owner || !!l.members_can_add, canCheck: owner || !!l.members_can_check,
      items: (s.items.get(l.id) || []).map((i) => ({ id: i.id, t: i.text, done: !!i.done, who: i.assigned_to ? nm(i.assigned_to) : undefined, whoId: i.assigned_to || undefined })) });
  }
  return out;
};

// ------------------------------------------------------------------ petits composants de formulaire
const chk = (label, checked, disabled, hint) => {
  const input = h('input', { type: 'checkbox', checked: !!checked, disabled: !!disabled });
  return { el: h('label', { class: 'chk' }, input, h('span', null, label, hint ? h('small', { class: 'muted' }, hint) : null)), get: () => input.checked };
};
const localDt = (iso) => { if (!iso) return ''; const d = new Date(iso); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

// ------------------------------------------------------------------ sondages
const isClosed = (p) => !!p.closed_at || (p.closes_at && new Date(p.closes_at) <= Date.now());
ext.pollBlock = (m, ctx) => {
  const s = st(ctx.convId), p = s.polls.get(m.id);
  if (!p) return h('div', { class: 'poll muted small' }, s.ready ? 'Sondage indisponible' : 'Chargement du sondage…');
  const options = s.opts.get(p.id) || [], closed = isClosed(p), total = s.pv.get(p.id) || 0, owner = ownerOf(p, ctx);
  async function vote(o, on) {
    const r = s.res.get(o.id) || { option_id: o.id, poll_id: p.id, votes: 0, mine: false, voters: p.anonymous ? null : [] };
    if (on && !p.multiple) options.forEach((x) => { const y = s.res.get(x.id); if (y && y.mine && x.id !== o.id) { y.mine = false; y.votes = Math.max(0, y.votes - 1); if (y.voters) y.voters = y.voters.filter((u) => u !== S.me.id); } });
    r.mine = on; r.votes = Math.max(0, r.votes + (on ? 1 : -1)); if (r.voters) r.voters = on ? [...r.voters, S.me.id] : r.voters.filter((u) => u !== S.me.id); s.res.set(o.id, r);
    rerender(ctx);
    try { await api.rpc('poll_vote', { p_poll: p.id, p_option: o.id, p_on: on }); } catch (e) { fail(e); }
    await ext.load(ctx.convId); rerender(ctx);
  }
  const rows = options.map((o) => {
    const r = s.res.get(o.id) || { votes: 0, mine: false, voters: [] }, pct = total ? Math.round((r.votes * 100) / total) : 0;
    const names = !p.anonymous && r.voters && r.voters.length ? r.voters.map((u) => ctx.nameOf(u)).join(', ') : '';
    return h('div', { class: 'poll-row' },
      h('button', { type: 'button', class: 'poll-opt' + (r.mine ? ' on' : ''), disabled: closed, role: p.multiple ? 'checkbox' : 'radio', 'aria-checked': String(!!r.mine), onclick: (e) => { e.stopPropagation(); vote(o, !r.mine); } },
        h('span', { class: 'poll-mark' + (p.multiple ? ' sq' : '') }, r.mine ? icon('check', 13) : null), h('span', { class: 'poll-label' }, o.label), h('span', { class: 'poll-count' }, String(r.votes)),
        h('span', { class: 'poll-bar', 'aria-hidden': 'true' }, h('i', { style: { width: pct + '%' } }))),
      names ? h('div', { class: 'poll-voters muted small' }, names) : null);
  });
  const tags = [p.multiple ? 'Choix multiples' : 'Un seul choix', p.anonymous ? 'Anonyme' : null, closed ? 'Clos' : p.closes_at ? 'Clôture le ' + fmt.dateTime(p.closes_at) : null].filter(Boolean);
  return h('div', { class: 'poll' }, h('div', { class: 'poll-q' }, icon('poll', 16), h('strong', null, p.question)), h('div', { class: 'poll-tags muted small' }, tags.join(' · ')), ...rows,
    h('div', { class: 'poll-foot' }, h('span', { class: 'muted small' }, `${total} votant${total > 1 ? 's' : ''}`),
      !closed && (p.allow_add || owner) ? h('button', { type: 'button', class: 'link-btn', onclick: async (e) => { e.stopPropagation(); const v = await promptDialog('Ajouter une option', 'Nouvelle option', '', { max: 100 }); if (v && v.trim()) { try { await api.rpc('poll_option_add', { p_poll: p.id, p_label: v }); await ext.load(ctx.convId); rerender(ctx); } catch (er) { fail(er); } } } }, '+ Option') : null));
};
ext.pollActions = (m, ctx) => {
  const p = st(ctx.convId).polls.get(m.id); if (!p || m.deleted_at || !ownerOf(p, ctx)) return [];
  const closed = isClosed(p);
  return [{ icon: 'edit', label: 'Modifier le sondage', onClick: () => ext.openPollDialog(ctx, p) },
    { icon: closed ? 'play' : 'x', label: closed ? 'Rouvrir le sondage' : 'Clore le sondage', onClick: async () => { try { await api.rpc('poll_close', { p_poll: p.id, p_closed: !closed }); await ext.load(ctx.convId); rerender(ctx); } catch (e) { fail(e); } } }];
};
function pollForm(init) {
  const q = h('input', { type: 'text', maxlength: '300', value: init.question || '', placeholder: 'Posez votre question', 'aria-label': 'Question' });
  const rows = (init.options || [{ label: '' }, { label: '' }]).map((o) => ({ id: o.id || null, label: o.label || '', orig: o.label || '' }));
  const list = h('div', { class: 'opt-list' }), add = h('button', { type: 'button', class: 'btn small', onclick: () => { if (rows.length < 12) { rows.push({ id: null, label: '', orig: '' }); draw(); const ins = list.querySelectorAll('input'); ins[ins.length - 1]?.focus(); } } }, '+ Ajouter une option');
  function draw() {
    list.replaceChildren(...rows.map((r, i) => h('div', { class: 'opt-row' },
      h('input', { type: 'text', maxlength: '100', value: r.label, placeholder: 'Option ' + (i + 1), 'aria-label': 'Option ' + (i + 1), oninput: (e) => { r.label = e.target.value; } }),
      rows.length > 2 ? iconBtn('x', 'Retirer l’option ' + (i + 1), () => { rows.splice(i, 1); draw(); }) : null)));
    add.hidden = rows.length >= 12;
  }
  draw();
  const multi = chk('Choix multiples', init.multiple), anon = chk('Vote anonyme', init.anonymous, init.hasVotes, init.hasVotes ? ' Non modifiable : des votes existent déjà.' : ''),
    allow = chk('Les membres peuvent ajouter des options', init.allow_add);
  const close = h('input', { type: 'datetime-local', value: localDt(init.closes_at), min: localDt(new Date().toISOString()), 'aria-label': 'Clôture automatique' });
  const el = h('div', { class: 'form-stack' }, h('label', { class: 'field' }, h('span', null, 'Question'), q), h('div', { class: 'field' }, h('span', null, 'Options (2 à 12)'), list, add),
    h('div', { class: 'chk-group' }, multi.el, anon.el, allow.el), h('label', { class: 'field' }, h('span', null, 'Clôture automatique (facultatif)'), close));
  return { el, values: () => ({ question: q.value.trim(), options: rows.map((r) => ({ id: r.id, label: r.label.trim(), orig: r.orig })).filter((r) => r.label), multiple: multi.get(), anonymous: anon.get(), allow_add: allow.get(), closes_at: close.value ? new Date(close.value).toISOString() : null }) };
}
const checkPoll = (v) => {
  if (!v.question) return 'Saisissez une question.';
  if (v.options.length < 2) return 'Il faut au moins 2 options.';
  if (new Set(v.options.map((o) => o.label.toLowerCase())).size !== v.options.length) return 'Deux options sont identiques.';
  if (v.closes_at && new Date(v.closes_at) <= Date.now()) return 'La date de clôture doit être dans le futur.';
  return null;
};
ext.openPollDialog = (ctx, poll) => {
  const s = st(ctx.convId), editing = !!poll, hasVotes = editing && (s.pv.get(poll.id) || 0) > 0;
  const form = pollForm(editing ? { ...poll, options: (s.opts.get(poll.id) || []).map((o) => ({ id: o.id, label: o.label })), hasVotes } : {});
  const err = h('p', { class: 'form-error small', role: 'alert', hidden: true });
  modal({ title: editing ? 'Modifier le sondage' : 'Nouveau sondage', body: [form.el, err], actions: [{ label: 'Annuler' }, { label: editing ? 'Enregistrer' : 'Envoyer', primary: true, onClick: async () => {
    const v = form.values(), bad = checkPoll(v); if (bad) { err.textContent = bad; err.hidden = false; return false; }
    try {
      if (!editing) {
        const row = await api.rpc('create_poll', { p_conv: ctx.convId, p_client_id: uuid(), p_question: v.question, p_options: v.options.map((o) => o.label), p_multiple: v.multiple, p_anonymous: v.anonymous, p_allow_add: v.allow_add, p_closes_at: v.closes_at });
        bus.emit('sent', row);
      } else {
        await api.rpc('poll_update', { p_poll: poll.id, p_question: v.question, p_multiple: v.multiple, p_anonymous: v.anonymous, p_allow_add: v.allow_add, p_closes_at: v.closes_at });
        const old = s.opts.get(poll.id) || [], keep = new Set(v.options.filter((o) => o.id).map((o) => o.id)), gone = old.filter((o) => !keep.has(o.id)), added = v.options.filter((o) => !o.id);
        const doAdd = async () => { for (const o of added) await api.rpc('poll_option_add', { p_poll: poll.id, p_label: o.label }); };
        const doDel = async () => { for (const o of gone) await api.rpc('poll_option_delete', { p_option: o.id }); };
        if (old.length + added.length <= 12) { await doAdd(); await doDel(); } else { await doDel(); await doAdd(); }
        for (const o of v.options) if (o.id && o.label !== o.orig) await api.rpc('poll_option_rename', { p_option: o.id, p_label: o.label });
      }
      await ext.load(ctx.convId); rerender(ctx);
    } catch (e) { err.textContent = errText(e); err.hidden = false; return false; }
  } }] });
};

// ------------------------------------------------------------------ listes de tâches
ext.todoBlock = (m, ctx) => {
  const s = st(ctx.convId), l = s.lists.get(m.id);
  if (!l) return h('div', { class: 'todo muted small' }, s.ready ? 'Liste indisponible' : 'Chargement de la liste…');
  const items = s.items.get(l.id) || [], done = items.filter((i) => i.done).length, owner = ownerOf(l, ctx), canAdd = owner || l.members_can_add, canCheck = owner || l.members_can_check;
  async function toggle(it) {
    if (!canCheck) return; it.done = !it.done; it.done_by = it.done ? S.me.id : null; rerender(ctx);
    try { await api.rpc('todo_set_done', { p_item: it.id, p_done: it.done }); } catch (e) { fail(e); }
    await ext.load(ctx.convId); rerender(ctx);
  }
  const rows = items.map((it) => h('div', { class: 'todo-item' + (it.done ? ' done' : '') },
    h('button', { type: 'button', class: 'todo-check', role: 'checkbox', 'aria-checked': String(!!it.done), 'aria-label': it.text, disabled: !canCheck, onclick: (e) => { e.stopPropagation(); toggle(it); } }, it.done ? icon('check', 14) : null),
    h('button', { type: 'button', class: 'todo-text', disabled: !canAdd, onclick: (e) => { e.stopPropagation(); itemMenu(l, it, ctx); } }, h('span', null, it.text),
      it.assigned_to ? h('span', { class: 'todo-who' }, ctx.nameOf(it.assigned_to)) : null, it.done && it.done_by ? h('span', { class: 'todo-by muted' }, 'fait par ' + ctx.nameOf(it.done_by)) : null)));
  return h('div', { class: 'todo' }, h('div', { class: 'todo-head' }, icon('list', 16), h('strong', null, l.title), h('span', { class: 'muted small' }, `${done}/${items.length}`)),
    h('div', { class: 'bar todo-prog', 'aria-hidden': 'true' }, h('i', { style: { width: items.length ? Math.round((done * 100) / items.length) + '%' : '0%' } })),
    ...rows, items.length ? null : h('div', { class: 'muted small' }, 'Aucun élément pour l’instant.'),
    h('div', { class: 'poll-foot' },
      canAdd ? h('button', { type: 'button', class: 'link-btn', onclick: async (e) => { e.stopPropagation(); const v = await promptDialog('Ajouter un élément', 'Nouvel élément', '', { max: 200 }); if (v && v.trim()) { try { await api.rpc('todo_add_item', { p_list: l.id, p_text: v, p_assigned: null }); await ext.load(ctx.convId); rerender(ctx); } catch (er) { fail(er); } } } }, '+ Élément') : h('span', { class: 'muted small' }, 'Ajout réservé à l’auteur et aux administrateurs'),
      done && canAdd ? h('button', { type: 'button', class: 'link-btn', onclick: async (e) => { e.stopPropagation(); try { await api.rpc('todo_clear_done', { p_list: l.id }); await ext.load(ctx.convId); rerender(ctx); } catch (er) { fail(er); } } }, 'Effacer les terminés') : null));
};
function itemMenu(l, it, ctx) {
  const reload = async () => { await ext.load(ctx.convId); rerender(ctx); };
  const members = [...ctx.members().values()];
  sheet(it.text.length > 40 ? it.text.slice(0, 40) + '…' : it.text, [
    { icon: 'edit', label: 'Modifier le texte', onClick: async () => { const v = await promptDialog('Modifier l’élément', 'Texte', it.text, { max: 200 }); if (v && v.trim()) { try { await api.rpc('todo_update_item', { p_item: it.id, p_text: v, p_assigned: null, p_set_assigned: false }); await reload(); } catch (e) { fail(e); } } } },
    ctx.isGroup() ? { icon: 'user', label: 'Assigner à…', onClick: () => sheet('Assigner à', [...members.map((x) => ({ icon: 'user', label: x.is_me ? 'Moi' : x.display_name, onClick: async () => { try { await api.rpc('todo_update_item', { p_item: it.id, p_text: it.text, p_assigned: x.user_id, p_set_assigned: true }); await reload(); } catch (e) { fail(e); } } })),
      it.assigned_to ? { icon: 'x', label: 'Personne', onClick: async () => { try { await api.rpc('todo_update_item', { p_item: it.id, p_text: it.text, p_assigned: null, p_set_assigned: true }); await reload(); } catch (e) { fail(e); } } } : null]) } : null,
    { sep: true },
    { icon: 'trash', label: 'Supprimer l’élément', danger: true, onClick: async () => { try { await api.rpc('todo_delete_item', { p_item: it.id }); await reload(); } catch (e) { fail(e); } } }]);
}
ext.todoActions = (m, ctx) => {
  const l = st(ctx.convId).lists.get(m.id); if (!l || m.deleted_at || !ownerOf(l, ctx)) return [];
  return [{ icon: 'sliders', label: 'Paramètres de la liste', onClick: () => ext.openTodoDialog(ctx, l) }];
};
ext.openTodoDialog = (ctx, list) => {
  const editing = !!list;
  const title = h('input', { type: 'text', maxlength: '100', value: editing ? list.title : '', placeholder: 'Ex. Courses du week-end', 'aria-label': 'Titre' });
  const itemsTa = editing ? null : h('textarea', { rows: '5', placeholder: 'Un élément par ligne (facultatif, 50 maximum)', 'aria-label': 'Éléments' });
  const canAdd = chk('Les membres peuvent ajouter et modifier des éléments', editing ? list.members_can_add : true), canCheck = chk('Les membres peuvent cocher les éléments', editing ? list.members_can_check : true);
  const err = h('p', { class: 'form-error small', role: 'alert', hidden: true });
  modal({ title: editing ? 'Paramètres de la liste' : 'Nouvelle liste de tâches', body: [h('div', { class: 'form-stack' }, h('label', { class: 'field' }, h('span', null, 'Titre'), title), editing ? null : h('label', { class: 'field' }, h('span', null, 'Éléments'), itemsTa),
    h('div', { class: 'chk-group' }, canAdd.el, canCheck.el)), err], actions: [{ label: 'Annuler' }, { label: editing ? 'Enregistrer' : 'Créer', primary: true, onClick: async () => {
    const t = title.value.trim(); if (!t) { err.textContent = 'Donnez un titre à la liste.'; err.hidden = false; return false; }
    try {
      if (editing) await api.rpc('todo_update_list', { p_list: list.id, p_title: t, p_members_can_add: canAdd.get(), p_members_can_check: canCheck.get() });
      else {
        const its = itemsTa.value.split('\n').map((x) => x.trim()).filter(Boolean);
        if (its.length > 50) { err.textContent = '50 éléments au maximum au départ.'; err.hidden = false; return false; }
        const row = await api.rpc('create_todo', { p_conv: ctx.convId, p_client_id: uuid(), p_title: t, p_items: its, p_members_can_add: canAdd.get(), p_members_can_check: canCheck.get() });
        bus.emit('sent', row);
      }
      await ext.load(ctx.convId); rerender(ctx);
    } catch (e) { err.textContent = errText(e); err.hidden = false; return false; }
  } }] });
};

// ------------------------------------------------------------------ audio : lecture
const fmtT = (sec) => { const t = Math.max(0, Math.round(sec || 0)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
const players = new Map(); let current = null;
ext.audioBlock = (d) => {
  let pl = players.get(d.id); if (!pl) { pl = { a: new Audio(), url: null, rate: 1 }; pl.a.preload = 'none'; players.set(d.id, pl); }
  const a = pl.a, total = () => (d.duration_ms ? d.duration_ms / 1000 : isFinite(a.duration) ? a.duration : 0);
  const btn = h('button', { type: 'button', class: 'au-play', 'aria-label': 'Lire' });
  // forme d'onde : barres déterministes (graine = id du média), cliquables / glissables pour se déplacer dans l'audio
  let seed = 0; for (const ch of String(d.id || d.path || 'x')) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const NB = 34, bars = Array.from({ length: NB }, (_, i) => { const env = 0.55 + 0.45 * Math.sin((i / NB) * Math.PI), v = 0.22 + 0.78 * rnd() * env; return h('i', { style: { height: Math.round(v * 100) + '%' } }); });
  const bar = h('div', { class: 'au-wave', role: 'slider', tabindex: '0', 'aria-label': 'Position de lecture', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, bars);
  const time = h('span', { class: 'au-time' }), speed = h('button', { type: 'button', class: 'au-speed', 'aria-label': 'Vitesse de lecture' });
  const isVoice = /^vocal-/.test(d.name || '');
  function paint() {
    btn.replaceChildren(icon(a.paused ? 'play' : 'pause', 22)); btn.setAttribute('aria-label', a.paused ? 'Lire' : 'Pause'); btn.classList.toggle('on', !a.paused);
    const t = a.currentTime || 0, T = total(), p = T ? Math.min(1, t / T) : 0, k = Math.round(p * NB);
    bars.forEach((b, i) => b.classList.toggle('done', i < k)); bar.setAttribute('aria-valuenow', String(Math.round(p * 100)));
    time.textContent = t > 0 || !a.paused ? fmtT(t) : T ? fmtT(T) : '0:00'; speed.textContent = pl.rate + '×'; speed.hidden = a.paused && t === 0;
  }
  a.onplay = a.onpause = a.ontimeupdate = a.onloadedmetadata = paint; a.onended = () => { a.currentTime = 0; paint(); }; a.onerror = () => { pl.url = null; };
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!a.paused) { a.pause(); return; }
    try {
      if (current && current !== a) current.pause();
      if (!pl.url) { pl.url = await Piaf.signedUrl(d.path); a.src = pl.url; }
      a.playbackRate = pl.rate; await a.play(); current = a;
    } catch { pl.url = null; toast('Lecture impossible. Réessayez.', { error: true }); }
  });
  const seek = (e) => { const T = total(), r = bar.getBoundingClientRect(); if (pl.url && T && r.width) { a.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * T; paint(); } };
  let drag = false;
  bar.addEventListener('click', (e) => e.stopPropagation()); bar.addEventListener('pointerdown', (e) => { e.stopPropagation(); drag = true; try { bar.setPointerCapture(e.pointerId); } catch { /* */ } seek(e); });
  bar.addEventListener('pointermove', (e) => { if (drag) seek(e); }); bar.addEventListener('pointerup', () => { drag = false; }); bar.addEventListener('pointercancel', () => { drag = false; });
  bar.addEventListener('keydown', (e) => { const T = total(); if (!pl.url || !T || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return; e.preventDefault(); e.stopPropagation(); a.currentTime = Math.max(0, Math.min(T, a.currentTime + (e.key === 'ArrowRight' ? 5 : -5))); });
  speed.addEventListener('click', (e) => { e.stopPropagation(); pl.rate = pl.rate === 1 ? 1.5 : pl.rate === 1.5 ? 2 : 1; a.playbackRate = pl.rate; paint(); });
  paint();
  return h('div', { class: 'audio' + (isVoice ? ' voice' : ''), onclick: (e) => e.stopPropagation() }, btn, h('div', { class: 'au-main' }, bar, h('div', { class: 'au-meta' }, h('span', { class: 'au-name' }, isVoice ? icon('mic', 12) : icon('music', 12), isVoice ? 'Message vocal' : d.name), time, speed)));
};

// ------------------------------------------------------------------ audio : enregistrement
ext.canRecord = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
ext.recorderBar = ({ onDone, maxMs = 600000 }) => {
  let stream = null, mr = null, chunks = [], t0 = 0, timer = null, done = false, wantSend = false;
  const time = h('span', { class: 'rec-time' }, '0:00');
  const live = h('div', { class: 'rec-live', 'aria-hidden': 'true' }, Array.from({ length: 28 }, () => h('i')));
  const el = h('div', { class: 'recbar', role: 'group', 'aria-label': 'Enregistrement vocal' }, iconBtn('trash', 'Annuler l’enregistrement', () => finish(false)), h('div', { class: 'rec-pill' }, h('span', { class: 'rec-dot', 'aria-hidden': 'true' }), time, live),
    h('button', { class: 'send', type: 'button', 'aria-label': 'Envoyer le message vocal', onclick: () => finish(true) }, icon('send', 22)));
  let ac = null, raf = 0;
  function meter() { // niveau sonore en direct : les barres défilent vers la gauche
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      ac = new AC(); const an = ac.createAnalyser(); an.fftSize = 256; ac.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize), bs = [...live.children], lv = bs.map(() => 0.08); let last = 0;
      const tick = (ts) => { raf = requestAnimationFrame(tick); if (ts - last < 70) return; last = ts; an.getByteTimeDomainData(buf);
        let s = 0; for (let i = 0; i < buf.length; i++) { const x = (buf[i] - 128) / 128; s += x * x; } lv.push(Math.min(1, Math.max(0.08, Math.sqrt(s / buf.length) * 3.2))); lv.shift();
        bs.forEach((b, i) => { b.style.height = Math.round(lv[i] * 100) + '%'; }); };
      raf = requestAnimationFrame(tick);
    } catch { /* l'enregistrement fonctionne sans visualisation */ }
  }
  async function start() {
    if (!ext.canRecord()) throw new Error('unsupported');
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); meter();
    const mt = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) => window.MediaRecorder.isTypeSupported(t));
    mr = new MediaRecorder(stream, Object.assign({ audioBitsPerSecond: 32000 }, mt ? { mimeType: mt } : {}));
    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    mr.onstop = finalize; mr.start(1000); t0 = Date.now();
    timer = setInterval(() => { const ms = Date.now() - t0; time.textContent = fmtT(ms / 1000); if (ms >= maxMs) finish(true); }, 250);
  }
  function finish(send) { if (done) return; wantSend = send; if (mr && mr.state !== 'inactive') mr.stop(); else finalize(); }
  function finalize() {
    if (done) return; done = true; clearInterval(timer); cancelAnimationFrame(raf); if (ac) { try { ac.close(); } catch { /* */ } } if (stream) stream.getTracks().forEach((t) => t.stop());
    const ms = Date.now() - t0;
    if (!wantSend || !chunks.length) return onDone(null);
    if (ms < 600) { toast('Message vocal trop court', { error: true }); return onDone(null); }
    const type = ((mr && mr.mimeType) || chunks[0].type || 'audio/webm').split(';')[0], extn = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg' }[type];
    if (!extn) { toast('Format d’enregistrement non pris en charge par ce navigateur.', { error: true }); return onDone(null); }
    const n = new Date(), p2 = (x) => String(x).padStart(2, '0');
    const name = `vocal-${n.getFullYear()}${p2(n.getMonth() + 1)}${p2(n.getDate())}-${p2(n.getHours())}${p2(n.getMinutes())}${p2(n.getSeconds())}.${extn}`;
    onDone({ file: new File(chunks, name, { type }), mime: type, duration: ms });
  }
  return { el, start, cancel: () => finish(false) };
};
})();
