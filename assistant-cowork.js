/* Talk2Piaf Cowork — assistant du groupe, appelé par « @Talk2Piaf Cowork » (ou « @cowork ») dans les discussions et les groupes.
   Le moteur (assistant-cowork-kb.js) tourne sur l'appareil de la personne qui appelle ; il ne fait rien lui-même.
   Ses réponses sont publiées dans la discussion (message de type « assistant », sauvegardé dans le cloud, visible de tous).
   Les boutons d'action restent privés (visibles par la seule personne qui a appelé) et ne s'exécutent qu'à l'appui :
   ils appellent les mêmes fonctions serveur que les écrans de sondages et de listes (migration 009_collab.sql).
   Talk2Piaf (assistant.js) reste l'assistant local de l'appareil : Cowork lui confie les demandes qui ne concernent que l'appareil. */
(() => {
  'use strict';
  const P = window.Piaf, KB = window.T2PC;
  if (!P || !KB) return;
  const { h, S, api, bus, uuid, confirmDialog } = P;

  const NAME = 'Talk2Piaf Cowork';
  P.coworkName = NAME;
  P.coworkAvatar = (size = 44) => h('span', { class: 'avatar t2p t2c', style: { width: size + 'px', height: size + 'px' }, 'aria-hidden': 'true' }, h('img', { src: 'icons/talk2piaf-cowork.svg', alt: '' }));

  // ---------------------------------------------------------------- mémoire courte, par discussion (jamais sauvegardée)
  const mems = new Map();
  const memOf = (cid) => { if (!mems.has(cid)) mems.set(cid, { topic: null, offer: null }); return mems.get(cid); };

  // c = { convId, name, isGroup, isAdmin, members: [{ id, name, role }], pins, nameOf(id), dead(messageId) }, fourni par l'écran de discussion
  function context(c) {
    const me = S.me || {}, snap = P.ext && P.ext.snapshot ? P.ext.snapshot(c.convId, { isAdmin: c.isAdmin, nameOf: c.nameOf, dead: c.dead }) : { polls: [], lists: [] };
    return {
      name: me.display_name || '', first: (me.display_name || '').split(/\s+/)[0] || '', now: new Date(), handle: '@' + NAME,
      conv: { id: c.convId, name: c.name || 'cette discussion', group: !!c.isGroup, pins: c.pins == null ? undefined : c.pins,
        me: { id: me.id, name: me.display_name || 'Vous', role: c.isAdmin ? 'admin' : 'member' }, members: c.members || [], polls: snap.polls, lists: snap.lists },
    };
  }

  // La réponse : { text, links, acts, chips, hint, unknown, handoff, topic }. Les actions sont des brouillons : rien n'est fait avant l'appui.
  P.coworkAsk = (q, c) => {
    const mem = memOf(c.convId); let r;
    try { r = KB.reply(q, context(c), mem); } catch (e) { console.error(e); r = null; }
    if (!r) r = { text: 'Je n’ai pas réussi à traiter ce message. Pouvez-vous le reformuler ?', chips: KB.starters().slice(0, 4), links: [], acts: [] };
    if (r.topic !== undefined) mem.topic = r.unknown ? null : (r.topic || mem.topic);
    mem.offer = (r.acts && r.acts[0]) || null;
    return { text: r.text, links: r.links || [], acts: (r.acts || []).map((a) => ({ l: a.l, a: a.a, p: a.p || {} })), chips: r.chips || [], hint: r.hint || '', unknown: !!r.unknown, handoff: !!r.handoff, topic: r.topic || null };
  };

  // ---------------------------------------------------------------- actions : de vraies opérations, exécutées à l'appui seulement
  // env = { convId, reload(), jump(messageId), search(preset), pins() } fourni par l'écran de discussion.
  // Une action renvoie { say?, acts?, t2p? } ou null ; elle lève une erreur à message lisible.
  const clean = (t) => String(t == null ? '' : t).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim(); // la base refuse les caractères de contrôle
  const need = (v, msg) => { if (!v) throw new Error(msg || 'Cette action n’est plus disponible. Rouvrez la discussion.'); return v; };
  const fail = (e) => { throw new Error(P.errText(e)); };
  const call = async (fn, args) => { try { return await api.rpc(fn, args); } catch (e) { return fail(e); } };
  const done = async (env) => { try { await env.reload(); } catch { /* le temps réel prendra le relais */ } };
  const ACTIONS = {
    async poll_create(p, env) {
      const hours = Number(p.hours) > 0 ? Math.min(8760, Number(p.hours)) : null;
      const row = await call('create_poll', { p_conv: env.convId, p_client_id: uuid(), p_question: clean(p.q), p_options: (p.opts || []).map(clean), p_multiple: !!p.multi, p_anonymous: !!p.anon, p_allow_add: !!p.allow,
        p_closes_at: hours ? new Date(Date.now() + hours * 3600000).toISOString() : null });
      bus.emit('sent', row); await done(env); return { say: '📊 Le sondage est publié dans la discussion.' };
    },
    async poll_close(p, env) {
      await call('poll_close', { p_poll: need(p.id), p_closed: p.closed !== false }); await done(env);
      return { say: p.closed === false ? 'Le sondage est rouvert : les votes reprennent.' : 'Le sondage est clos : les résultats restent visibles.' };
    },
    async poll_delete(p, env) {
      const mid = need(p.mid, 'Ce sondage ne peut pas être supprimé d’ici : ouvrez son message et utilisez le menu.');
      if (!(await confirmDialog('Supprimer le sondage ?', `« ${p.n || 'Sondage'} » sera effacé pour tout le monde, avec ses votes. Cette action est définitive.`, 'Supprimer', true))) return { nodone: true };
      await call('delete_message_for_all', { p_id: mid }); await done(env); return { say: 'Le sondage a été supprimé.' };
    },
    async list_create(p, env) {
      const row = await call('create_todo', { p_conv: env.convId, p_client_id: uuid(), p_title: clean(p.title), p_items: (p.items || []).map(clean), p_members_can_add: true, p_members_can_check: true });
      bus.emit('sent', row); await done(env); return { say: '📝 La liste est publiée dans la discussion.' };
    },
    async list_add(p, env) {
      const items = p.items || []; let n = 0;
      try { for (const it of items) { await api.rpc('todo_add_item', { p_list: need(p.list), p_text: clean(it.t), p_assigned: it.who || null }); n++; } }
      catch (e) { await done(env); if (n) throw new Error(`${n} élément${n > 1 ? 's ajoutés' : ' ajouté'}, puis : ${P.errText(e)}`); fail(e); }
      await done(env); return { say: `${n > 1 ? n + ' éléments ajoutés' : 'Élément ajouté'} à la liste « ${p.n || 'Liste'} ».` };
    },
    async list_check(p, env) { await call('todo_set_done', { p_item: need(p.item), p_done: !!p.v }); await done(env); return { say: p.v ? `« ${p.n} » est coché.` : `« ${p.n} » repasse à faire.` }; },
    async list_assign(p, env) {
      await call('todo_update_item', { p_item: need(p.item), p_text: clean(need(p.t)), p_assigned: p.who || null, p_set_assigned: true }); await done(env);
      return { say: `« ${p.n} » est attribué.` };
    },
    async list_clear_done(p, env) { await call('todo_clear_done', { p_list: need(p.list) }); await done(env); return { say: `Les éléments terminés de « ${p.n || 'la liste'} » ont été effacés.`, nodone: true }; },
    async list_delete(p, env) {
      const mid = need(p.mid, 'Cette liste ne peut pas être supprimée d’ici : ouvrez son message et utilisez le menu.');
      if (!(await confirmDialog('Supprimer la liste ?', `« ${p.n || 'Liste'} » sera effacée pour tout le monde. Cette action est définitive.`, 'Supprimer', true))) return { nodone: true };
      await call('delete_message_for_all', { p_id: mid }); await done(env); return { say: 'La liste a été supprimée.' };
    },
    async jump(p, env) { if (p.mid) env.jump(p.mid); else P.toast('Ce message n’est pas disponible.', { error: true }); return { nodone: true, quiet: true }; },
    search(p, env) { env.search({ q: p.q || '', kind: p.kind || 'text', from: p.from || null, since: p.since || null, until: p.until || null }); return { nodone: true, quiet: true }; },
    pins(p, env) { env.pins(); return { nodone: true, quiet: true }; },
    // relais vers Talk2Piaf (local) : sa réponse arrive en privé, avec ses propres boutons
    t2p(p) { return { t2p: P.assistantAsk ? P.assistantAsk(p.q) : null, quiet: true }; },
  };
  P.coworkRun = async (act, env) => { const fn = ACTIONS[act.a]; return fn ? fn(act.p || {}, env) : null; };
})();
