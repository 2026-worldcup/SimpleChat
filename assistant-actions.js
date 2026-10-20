/* Talk2Piaf Actions — exécute les actions préparées par Talk2Piaf (assistant.js / assistant-kb.js), depuis n'importe quel écran.
   Deux modes de validation, au choix de la personne (Paramètres → Assistant) :
   • « Aperçu » (défaut) : l'appui sur un bouton ouvre un aperçu MODIFIABLE (texte, destinataire, discussion ou groupe, noms et paramètres des sondages et listes…) ; rien n'est fait avant « Valider ».
   • « Direct » : une demande claire est exécutée tout de suite, puis « Modifier » et « Annuler » restent disponibles.
   Les actions réversibles (thème, favori, archive, silence…) sont toujours exécutées tout de suite, avec « Annuler ».
   Les échanges avec Talk2Piaf dans les discussions sont gardés UNIQUEMENT sur l'appareil (requête et réponse) : jamais envoyés, effaçables un par un ou d'un coup.
   Fonctions serveur utilisées : celles des écrans existants (send_message, create_poll, create_todo, todo_*, poll_close, edit_message, delete_message_for_all, block_user, unblock_user). */
(() => {
  'use strict';
  const P = window.Piaf, KB = window.T2P;
  if (!P || !KB) return;
  const { h, S, api, bus, uuid, store, toast, errText, toCode, confirmDialog, modal, sheet } = P;

  // ---------------------------------------------------------------- réglages
  const MKEY = 'piaf-t2p-mode';
  const mode = () => (store.get(MKEY, 'preview') === 'direct' ? 'direct' : 'preview');
  // Actions qui ne doivent partir qu'une fois : une fois faites, le bouton se grise
  const ONCE = new Set(['send', 'block', 'unblock', 'revoke', 'forget', 'watch_stop', 'poll_create', 'list_create', 'poll_delete', 'list_delete', 'msg_undo', 'obj_undo']);
  // Actions qu'une demande claire peut exécuter sans aperçu en mode direct
  const DIRECT_OK = (a) => /^(send|block|poll_close|list_add|list_check|list_assign|list_clear_done)$/.test(a.a) || (/^(poll_create|list_create)$/.test(a.a) && a.p && a.p.conv);

  // ---------------------------------------------------------------- petits outils
  const clean = (t) => String(t == null ? '' : t).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s{2,}/g, ' ').trim(); // la base refuse les caractères de contrôle
  const need = (v, msg) => { if (!v) throw new Error(msg || 'Cette action n’est plus disponible. Rouvrez la discussion.'); return v; };
  const fail = (e) => { throw new Error(errText(e)); };
  const call = async (fn, args) => { if (!S.online) throw new Error('Pas de connexion : réessayez quand le réseau revient.'); try { return await api.rpc(fn, args); } catch (e) { return fail(e); } };
  const convById = (id) => (S.convs || []).find((c) => c.conversation_id === id);
  const convLabel = (c) => (c.kind === 'group' ? '👥 ' : '') + (P.convName(c) || 'Discussion');
  const reload = async (env, convId) => { if (env && env.reload && env.convId === convId) { try { await env.reload(); } catch { /* le temps réel prendra le relais */ } } };
  const openAct = (id) => ({ l: 'Ouvrir la discussion', a: 'conv', p: { id } });
  const clip = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

  // ---------------------------------------------------------------- éléments de formulaire
  const field = (label, control, hint) => h('label', { class: 'field' }, h('span', null, label), control, hint ? h('small', { class: 'muted' }, hint) : null);
  const check = (label, on, hint) => { const i = h('input', { type: 'checkbox', checked: !!on }); return { el: h('label', { class: 'chk' }, i, h('span', null, label, hint ? h('small', { class: 'muted' }, hint) : null)), get: () => i.checked }; };
  // Choix de la discussion ou du groupe (aperçus) ; `only` filtre (personnes seulement pour un blocage)
  function destPicker(value, o = {}) {
    const list = (S.convs || []).filter((c) => !c.blocked_by_me && (!o.only || o.only(c)));
    const sel = h('select', { 'aria-label': o.label || 'Discussion ou groupe' },
      !value || !list.some((c) => c.conversation_id === value) ? h('option', { value: '' }, 'Choisir…') : null,
      ...list.map((c) => h('option', { value: c.conversation_id, selected: c.conversation_id === value }, convLabel(c))));
    return { el: field(o.label || 'Discussion ou groupe', sel), get: () => sel.value, set: (v) => { sel.value = v; } };
  }
  // Liste de champs texte ajoutables / retirables (options d'un sondage, éléments d'une liste)
  function rowsEditor({ values, min = 0, max = 20, maxLen = 100, placeholder = '', noun = 'élément' }) {
    const box = h('div', { class: 't2pa-rows' }), rows = [];
    const add = h('button', { type: 'button', class: 'btn small', onclick: () => { addRow('').inp.focus(); } }, '+ Ajouter');
    const sync = () => { add.disabled = rows.length >= max; add.textContent = rows.length >= max ? `Maximum : ${max}` : '+ Ajouter'; };
    function addRow(v) {
      const inp = h('input', { type: 'text', maxlength: String(maxLen), value: v, placeholder, 'aria-label': noun[0].toUpperCase() + noun.slice(1) + ' ' + (rows.length + 1) });
      const row = { inp }; row.el = h('div', { class: 't2pa-row' }, inp,
        h('button', { type: 'button', class: 't2pa-x', 'aria-label': 'Retirer cet ' + noun, onclick: () => { if (rows.length <= Math.max(min, 1)) { inp.value = ''; inp.focus(); return; } rows.splice(rows.indexOf(row), 1); row.el.remove(); sync(); } }, '✕'));
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (rows.length < max) addRow('').inp.focus(); } });
      rows.push(row); box.append(row.el); sync(); return row;
    }
    (values && values.length ? values : Array(Math.max(min, 1)).fill('')).slice(0, max).forEach(addRow);
    return { el: h('div', { class: 'field' }, box, add), get: () => rows.map((r) => clean(r.inp.value)).filter(Boolean) };
  }

  // Aperçu modifiable : `submit()` valide, exécute et renvoie le résultat ; une erreur levée s'affiche dans l'aperçu (qui reste ouvert).
  function editor({ title, intro, fields, label = 'Valider', extra = [], submit }) {
    return new Promise((res) => {
      let settled = false, busy = false; const fin = (v) => { if (!settled) { settled = true; res(v); } };
      const err = h('p', { class: 'form-error small', role: 'alert', hidden: true });
      const run = (fn) => async () => {
        if (busy) return false; busy = true; err.hidden = true;
        try { const r = await fn(); fin(r || { nodone: true, quiet: true }); return true; }
        catch (e) { err.textContent = e && e.message ? e.message : 'L’action n’a pas pu aboutir.'; err.hidden = false; return false; }
        finally { busy = false; }
      };
      const l = modal({ title, body: h('div', { class: 't2pa-edit' }, intro ? h('p', { class: 'muted small' }, intro) : null, ...fields, err),
        actions: [{ label: 'Annuler', onClick: () => { fin(null); } }, ...extra.map((x) => ({ label: x.label, onClick: run(x.submit) })), { label, primary: true, onClick: run(submit) }] });
      const orig = l.close; l.close = () => { fin(null); orig(); };
    });
  }

  // ---------------------------------------------------------------- messages
  async function sendNow(convId, body) {
    const c = need(convById(convId), 'Cette discussion n’existe plus.');
    if (c.blocked_by_me) throw new Error('Vous avez bloqué cette personne : débloquez-la d’abord.');
    body = String(body || '').trim(); if (!body) throw new Error('Le message est vide.'); if (body.length > 4000) throw new Error('Le message est trop long (4 000 caractères au maximum).');
    const label = P.convName(c), n = label, quote = '« ' + clip(body, 160).replace(/\s+/g, ' ') + ' »';
    if (S.online) {
      try {
        const row = await api.rpc('send_message', { p_conv: convId, p_client_id: uuid(), p_body: body, p_reply_to: null, p_forwarded: false });
        bus.emit('sent', row); P.refreshConvs().catch(() => {});
        return { say: `✅ Message envoyé à **${label}** :\n${quote}`, acts: [{ l: 'Modifier', a: 'msg_edit', p: { mid: row.id, id: convId, t: body, n } }, { l: 'Annuler l’envoi', a: 'msg_undo', p: { mid: row.id, id: convId, n } }, openAct(convId)] };
      } catch (e) { if (toCode(e) !== 'network') throw new Error(errText(e)); }
    }
    await P.queueMessage(convId, body);
    return { say: `🕓 Pas de connexion pour l’instant : le message pour **${label}** est en file d’attente et partira dès que le réseau reviendra :\n${quote}`, acts: [openAct(convId)] };
  }
  function sendEditor(p) {
    const dest = destPicker(p.id, { label: 'À (discussion ou groupe)' }), ta = h('textarea', { rows: '4', maxlength: '4000', 'aria-label': 'Message' }, p.t || '');
    return editor({ title: 'Message à envoyer', intro: 'Modifiez le texte ou le destinataire, puis validez. Rien n’est envoyé avant.', fields: [dest.el, field('Message', ta)], label: 'Envoyer',
      submit: async () => { if (!dest.get()) throw new Error('Choisissez une discussion ou un groupe.'); return sendNow(dest.get(), ta.value); } });
  }
  const sendAct = (p, env, o) => (o.direct && !p._e ? sendNow(p.id, p.t) : sendEditor(p));
  function msgEdit(p) {
    const ta = h('textarea', { rows: '4', maxlength: '4000', 'aria-label': 'Message' }, p.t || '');
    return editor({ title: 'Modifier le message', intro: `Message envoyé à ${p.n || 'la discussion'}. Les destinataires verront « modifié ». Pour changer de destinataire, annulez l’envoi puis renvoyez.`, fields: [field('Message', ta)],
      submit: async () => {
        const body = ta.value.trim(); if (!body) throw new Error('Le message est vide.');
        if (body === p.t) return { nodone: true, quiet: true };
        await call('edit_message', { p_id: need(p.mid), p_body: body }); P.refreshConvs().catch(() => {});
        bus.emit('edited', { id: p.mid, body });
        return { say: `✏️ Message modifié :\n« ${clip(body, 160)} »`, acts: [{ l: 'Modifier', a: 'msg_edit', p: { ...p, t: body } }, { l: 'Annuler l’envoi', a: 'msg_undo', p: { mid: p.mid, id: p.id, n: p.n } }] };
      } });
  }
  async function undoDelete(p, what) {
    await call('delete_message_for_all', { p_id: need(p.mid, 'Ce message n’est plus disponible.') }); P.refreshConvs().catch(() => {});
    return { say: `↩️ ${what} supprimé pour tout le monde.` };
  }

  // ---------------------------------------------------------------- sondages
  const HOURS = [['', 'Sans limite'], ['1', '1 heure'], ['24', '24 heures'], ['48', '48 heures'], ['72', '3 jours'], ['168', '7 jours']];
  async function pollNow(d, env, replace) {
    const q = clean(d.q), opts = [...new Set((d.opts || []).map(clean).filter(Boolean))];
    if (!q) throw new Error('Écrivez la question du sondage.'); if (q.length > 300) throw new Error('La question est trop longue (300 caractères au maximum).');
    if (opts.length < 2) throw new Error('Un sondage demande au moins 2 options différentes.'); if (opts.length > 12) throw new Error('Un sondage accepte 12 options au maximum.');
    const c = need(convById(d.conv), 'Choisissez la discussion où publier le sondage.');
    const hours = Number(d.hours) > 0 ? Math.min(8760, Number(d.hours)) : null;
    const row = await call('create_poll', { p_conv: d.conv, p_client_id: uuid(), p_question: q, p_options: opts, p_multiple: !!d.multi, p_anonymous: !!d.anon, p_allow_add: !!d.allow,
      p_closes_at: hours ? new Date(Date.now() + hours * 3600000).toISOString() : null });
    bus.emit('sent', row);
    if (replace) { try { await api.rpc('delete_message_for_all', { p_id: replace }); } catch { /* l'ancien reste : à supprimer à la main */ } }
    await reload(env, d.conv); P.refreshConvs().catch(() => {});
    const draft = { conv: d.conv, q, opts, multi: !!d.multi, anon: !!d.anon, allow: !!d.allow, hours };
    return { say: `📊 Sondage publié dans **${P.convName(c)}** :\n**${q}**\n${opts.map((o) => '• ' + o).join('\n')}`, acts: [{ l: 'Modifier', a: 'obj_redo', p: { kind: 'poll', mid: row.id, draft } }, { l: 'Annuler', a: 'obj_undo', p: { kind: 'poll', mid: row.id } }, openAct(d.conv)] };
  }
  function pollEditor(d, env, replace) {
    const dest = destPicker(d.conv, { label: 'Publier dans' }), q = h('input', { type: 'text', maxlength: '300', value: d.q || '', 'aria-label': 'Question' });
    const opts = rowsEditor({ values: d.opts || ['', ''], min: 2, max: 12, maxLen: 100, placeholder: 'Option', noun: 'option' });
    const multi = check('Choix multiples', d.multi), anon = check('Vote anonyme', d.anon), allow = check('Les membres peuvent ajouter des options', d.allow);
    const hrs = String(d.hours || ''), list = HOURS.some(([v]) => v === hrs) ? HOURS : [...HOURS, [hrs, hrs + ' heures']];
    const dur = h('select', { 'aria-label': 'Durée' }, ...list.map(([v, l]) => h('option', { value: v, selected: v === hrs }, l)));
    return editor({ title: replace ? 'Modifier le sondage' : 'Sondage à publier', intro: replace ? 'Le sondage actuel sera remplacé par la version modifiée (ses votes éventuels sont perdus).' : 'Modifiez la question, les options ou les paramètres, puis publiez. Rien n’est publié avant.',
      fields: [dest.el, field('Question', q), h('div', { class: 'field' }, h('span', { class: 't2pa-lbl' }, 'Options (2 à 12)'), opts.el), multi.el, anon.el, allow.el, field('Durée', dur)], label: 'Publier',
      submit: () => pollNow({ conv: dest.get(), q: q.value, opts: opts.get(), multi: multi.get(), anon: anon.get(), allow: allow.get(), hours: dur.value }, env, replace) });
  }
  const pollCreate = (p, env, o) => (o.direct && !p._e && p.conv ? pollNow(p, env) : pollEditor(p, env));

  // ---------------------------------------------------------------- listes
  async function listNow(d, env, replace) {
    const title = clean(d.title), items = (d.items || []).map(clean).filter(Boolean);
    if (!title) throw new Error('Donnez un titre à la liste.'); if (title.length > 100) throw new Error('Le titre est trop long (100 caractères au maximum).');
    if (items.length > 50) throw new Error('Une liste accepte 50 éléments au départ (vous pourrez en ajouter ensuite).');
    const c = need(convById(d.conv), 'Choisissez la discussion où publier la liste.');
    const row = await call('create_todo', { p_conv: d.conv, p_client_id: uuid(), p_title: title, p_items: items, p_members_can_add: d.canAdd !== false, p_members_can_check: d.canCheck !== false });
    bus.emit('sent', row);
    if (replace) { try { await api.rpc('delete_message_for_all', { p_id: replace }); } catch { /* */ } }
    await reload(env, d.conv); P.refreshConvs().catch(() => {});
    const draft = { conv: d.conv, title, items, canAdd: d.canAdd !== false, canCheck: d.canCheck !== false };
    return { say: `📝 Liste publiée dans **${P.convName(c)}** :\n**${title}**${items.length ? '\n' + items.map((i) => '▫️ ' + i).join('\n') : ''}`, acts: [{ l: 'Modifier', a: 'obj_redo', p: { kind: 'list', mid: row.id, draft } }, { l: 'Annuler', a: 'obj_undo', p: { kind: 'list', mid: row.id } }, openAct(d.conv)] };
  }
  function listEditor(d, env, replace) {
    const dest = destPicker(d.conv, { label: 'Publier dans' }), title = h('input', { type: 'text', maxlength: '100', value: d.title || '', 'aria-label': 'Titre' });
    const items = rowsEditor({ values: d.items || [], min: 1, max: 50, maxLen: 200, placeholder: 'Élément', noun: 'élément' });
    const add = check('Les membres peuvent ajouter des éléments', d.canAdd !== false), done = check('Les membres peuvent cocher les éléments', d.canCheck !== false);
    return editor({ title: replace ? 'Modifier la liste' : 'Liste à publier', intro: replace ? 'La liste actuelle sera remplacée par la version modifiée (les éléments déjà cochés sont perdus).' : 'Modifiez le titre, les éléments ou les droits des membres, puis publiez. Rien n’est publié avant.',
      fields: [dest.el, field('Titre', title), h('div', { class: 'field' }, h('span', { class: 't2pa-lbl' }, 'Éléments'), items.el), add.el, done.el], label: 'Publier',
      submit: () => listNow({ conv: dest.get(), title: title.value, items: items.get(), canAdd: add.get(), canCheck: done.get() }, env, replace) });
  }
  const listCreate = (p, env, o) => (o.direct && !p._e && p.conv ? listNow(p, env) : listEditor(p, env));
  function listAdd(p, env, o) {
    const who = new Map((p.items || []).map((i) => [i.t, i.who])), go = async (texts) => {
      let n = 0; const lines = texts.map(clean).filter(Boolean); if (!lines.length) throw new Error('Rien à ajouter.');
      try { for (const t of lines) { await api.rpc('todo_add_item', { p_list: need(p.list), p_text: t, p_assigned: who.get(t) || null }); n++; } }
      catch (e) { await reload(env, p.conv || env.convId); if (n) throw new Error(`${n} élément${n > 1 ? 's ajoutés' : ' ajouté'}, puis : ${errText(e)}`); fail(e); }
      await reload(env, p.conv || env.convId);
      return { say: `✅ ${n > 1 ? n + ' éléments ajoutés' : 'Élément ajouté'} à la liste **${p.n || 'Liste'}**.` };
    };
    if (o.direct && !p._e) return go((p.items || []).map((i) => i.t));
    const rows = rowsEditor({ values: (p.items || []).map((i) => i.t), min: 1, max: 20, maxLen: 200, placeholder: 'Élément', noun: 'élément' });
    return editor({ title: 'Ajouter à « ' + clip(p.n || 'la liste', 40) + ' »', intro: 'Modifiez les éléments à ajouter, puis validez.', fields: [h('div', { class: 'field' }, rows.el)], label: 'Ajouter', submit: () => go(rows.get()) });
  }

  // ---------------------------------------------------------------- calendrier
  const dtLocal = (s) => { const d = new Date(s); return isNaN(d) ? '' : new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  const dLocal = (s) => dtLocal(s).slice(0, 10);
  function calAct(kind) {
    return (p, env, o) => {
      if (o.direct && !p._e) return P.calOpen(kind, p);
      const t = h('input', { type: 'text', maxlength: '120', value: p.t || '', 'aria-label': 'Titre' }), loc = h('input', { type: 'text', maxlength: '200', value: p.loc || '', 'aria-label': 'Lieu' });
      const ad = check('Toute la journée', p.ad);
      const s = h('input', { type: 'datetime-local', value: dtLocal(p.s), 'aria-label': 'Début' }), e = h('input', { type: 'datetime-local', value: dtLocal(p.e), 'aria-label': 'Fin' });
      const build = () => {
        const ev = { t: clean(t.value), loc: clean(loc.value), ad: ad.get() };
        const sv = ad.get() ? (s.value || '').slice(0, 10) + 'T00:00' : s.value, ev2 = ad.get() ? (e.value || s.value || '').slice(0, 10) + 'T00:00' : e.value;
        if (!ev.t) throw new Error('Donnez un titre à l’évènement.'); if (!sv || isNaN(new Date(sv))) throw new Error('Indiquez le début.');
        let end = ev2 && !isNaN(new Date(ev2)) ? ev2 : sv;
        if (ad.get()) { const d = new Date(end); if (d <= new Date(sv)) { d.setDate(new Date(sv).getDate() + 1); end = new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19); } }
        else if (new Date(end) <= new Date(sv)) throw new Error('La fin doit être après le début.');
        ev.s = sv.length === 16 ? sv + ':00' : sv; ev.e = end.length === 16 ? end + ':00' : end; return ev;
      };
      const open = (k) => async () => { const r = P.calOpen(k, build()); return r; };
      return editor({ title: 'Évènement à ajouter', intro: 'Modifiez l’évènement : il n’est ajouté à votre calendrier qu’après votre validation dans l’application de calendrier.', fields: [field('Titre', t), field('Début', s), field('Fin', e), ad.el, field('Lieu', loc)],
        label: { ics: 'Fichier .ics', google: 'Google Agenda', outlook: 'Outlook' }[kind], extra: ['ics', 'google', 'outlook'].filter((k) => k !== kind).map((k) => ({ label: { ics: 'Fichier .ics', google: 'Google Agenda', outlook: 'Outlook' }[k], submit: open(k) })), submit: open(kind) });
    };
  }

  // ---------------------------------------------------------------- blocage
  async function blockNow(id, name) {
    const c = need(convById(id), 'Cette discussion n’existe plus.');
    if (c.kind === 'group' || !c.other_id) throw new Error('On ne peut pas bloquer un groupe.');
    const n = name || P.convName(c);
    if (c.blocked_by_me) return { say: `${n} est déjà bloqué·e.`, acts: [{ l: 'Débloquer ' + n, a: 'unblock', p: { id, n } }] };
    await call('block_user', { p_target: c.other_id }); await P.refreshConvs();
    return { say: `🚫 **${n}** est bloqué·e : elle ne peut plus vous écrire, et vous ne pouvez plus lui écrire.`, acts: [{ l: 'Annuler', a: 'unblock', p: { id, n } }] };
  }
  function blockAct(p, env, o) {
    if (o.direct && !p._e) return blockNow(p.id, p.n);
    const dest = destPicker(p.id, { label: 'Personne à bloquer', only: (c) => c.kind !== 'group' && c.other_id });
    return editor({ title: 'Bloquer une personne', intro: 'Cette personne ne pourra plus vous écrire, et vous ne pourrez plus lui écrire tant que le blocage dure. Vous pourrez la débloquer ensuite.', fields: [dest.el], label: 'Bloquer',
      submit: async () => { if (!dest.get()) throw new Error('Choisissez une personne.'); return blockNow(dest.get()); } });
  }

  // ---------------------------------------------------------------- thème
  const THEMES = { dark: 'Thème sombre activé. 🌙', light: 'Thème clair activé. ☀️', auto: 'Thème automatique activé (il suit votre appareil).' };
  function setTheme(m, back) {
    const prev = store.get('piaf-theme', 'auto'); store.set('piaf-theme', m); P.applyTheme();
    return { say: THEMES[m] || 'Thème modifié.', acts: [{ l: back ? 'Rétablir' : 'Annuler', a: 'theme', p: { m: prev, _u: !back } }, { l: 'Modifier…', a: 'theme_pick', p: {} }] };
  }
  const themePick = () => new Promise((res) => {
    const cur = store.get('piaf-theme', 'auto'); let done = false; const fin = (v) => { if (!done) { done = true; res(v); } };
    const l = sheet('Thème', [['auto', 'Automatique (suit l’appareil)'], ['light', 'Clair'], ['dark', 'Sombre']].map(([m, lab]) => ({ icon: m === 'dark' ? 'moon' : 'sliders', label: (m === cur ? '✓ ' : '') + lab, onClick: () => fin(setTheme(m)) })));
    const orig = l.close; l.close = () => { fin({ nodone: true, quiet: true }); orig(); };
  });

  // ---------------------------------------------------------------- actions du groupe : sondages et listes existants, recherche, épinglés
  const REG = {
    send: sendAct, msg_edit: (p) => msgEdit(p), msg_undo: (p) => undoDelete(p, 'Le message est'),
    obj_undo: (p) => undoDelete(p, p.kind === 'list' ? 'La liste est' : 'Le sondage est'),
    obj_redo: (p, env) => (p.kind === 'list' ? listEditor(p.draft || {}, env, p.mid) : pollEditor(p.draft || {}, env, p.mid)),
    poll_create: pollCreate, list_create: listCreate, list_add: listAdd,
    async poll_close(p, env) {
      const cid = p.conv || env.convId; await call('poll_close', { p_poll: need(p.id), p_closed: p.closed !== false }); await reload(env, cid);
      return { say: p.closed === false ? '🔓 Le sondage est rouvert : les votes reprennent.' : '🔒 Le sondage est clos : les résultats restent visibles.', acts: [{ l: p.closed === false ? 'Annuler' : 'Rouvrir le sondage', a: 'poll_close', p: { ...p, closed: p.closed === false } }] };
    },
    async poll_delete(p, env) {
      const mid = need(p.mid, 'Ce sondage ne peut pas être supprimé d’ici : ouvrez son message et utilisez le menu.');
      if (!(await confirmDialog('Supprimer le sondage ?', `« ${p.n || 'Sondage'} » sera effacé pour tout le monde, avec ses votes. Cette action est définitive.`, 'Supprimer', true))) return { nodone: true, quiet: true };
      await call('delete_message_for_all', { p_id: mid }); await reload(env, p.conv || env.convId); return { say: 'Le sondage a été supprimé.' };
    },
    async list_check(p, env) {
      await call('todo_set_done', { p_item: need(p.item), p_done: !!p.v }); await reload(env, p.conv || env.convId);
      return { say: p.v ? `☑️ « ${p.n} » est coché.` : `▫️ « ${p.n} » repasse à faire.`, acts: [{ l: 'Annuler', a: 'list_check', p: { ...p, v: !p.v } }] };
    },
    async list_assign(p, env) {
      await call('todo_update_item', { p_item: need(p.item), p_text: clean(need(p.t)), p_assigned: p.who || null, p_set_assigned: true }); await reload(env, p.conv || env.convId);
      return { say: `🙋 « ${p.n || p.t} » est attribué.` };
    },
    async list_clear_done(p, env) { await call('todo_clear_done', { p_list: need(p.list) }); await reload(env, p.conv || env.convId); return { say: `Les éléments terminés de « ${p.n || 'la liste'} » ont été effacés.`, nodone: true }; },
    async list_delete(p, env) {
      const mid = need(p.mid, 'Cette liste ne peut pas être supprimée d’ici : ouvrez son message et utilisez le menu.');
      if (!(await confirmDialog('Supprimer la liste ?', `« ${p.n || 'Liste'} » sera effacée pour tout le monde. Cette action est définitive.`, 'Supprimer', true))) return { nodone: true, quiet: true };
      await call('delete_message_for_all', { p_id: mid }); await reload(env, p.conv || env.convId); return { say: 'La liste a été supprimée.' };
    },
    async jump(p, env) { if (p.mid && env.jump) env.jump(p.mid); else if (p.conv) P.go('#/c/' + p.conv); else toast('Ce message n’est pas disponible.', { error: true }); return { nodone: true, quiet: true }; },
    search(p, env) { need(env.search, 'La recherche s’ouvre depuis une discussion.')({ q: p.q || '', kind: p.kind || 'text', from: p.from || null, since: p.since || null, until: p.until || null }); return { nodone: true, quiet: true }; },
    pins(p, env) { need(env.pins, 'Les messages épinglés s’ouvrent depuis une discussion.')(); return { nodone: true, quiet: true }; },
    block: blockAct,
    theme: (p) => setTheme(p.m, p._u), theme_pick: () => themePick(),
    cal_ics: calAct('ics'), cal_google: calAct('google'), cal_outlook: calAct('outlook'),
  };
  // actions réversibles de l'appareil : « Annuler » (puis « Rétablir ») inverse la valeur
  const TOGGLES = new Set(['fav', 'arch', 'mute', 'receipts', 'notif']);

  async function run(act, env, o) {
    env = env || {}; o = o || {};
    const direct = o.direct != null ? o.direct : mode() === 'direct', p = act.p || {};
    if (REG[act.a]) return REG[act.a](p, env, { direct });
    const dev = P.assistantActions && P.assistantActions[act.a]; if (!dev) return null;
    const r = await dev(p);
    if (r && TOGGLES.has(act.a) && p.v != null && !r.acts) r.acts = [{ l: p._u ? 'Rétablir' : 'Annuler', a: act.a, p: { ...p, v: !p.v, _u: !p._u } }];
    return r;
  }

  // ---------------------------------------------------------------- contexte fourni au moteur : l'appareil + la discussion ouverte
  function context(env) {
    const base = P.assistantContext ? P.assistantContext() : { name: '', first: '', now: new Date(), convs: [] };
    if (!env || !env.convId) return base;
    const me = S.me || {}, snap = P.ext && P.ext.snapshot ? P.ext.snapshot(env.convId, { isAdmin: env.isAdmin, nameOf: env.nameOf, dead: env.dead }) : { polls: [], lists: [] };
    return Object.assign({}, base, { conv: { id: env.convId, name: env.name || 'cette discussion', group: !!env.isGroup, pins: env.pins == null ? undefined : env.pins,
      me: { id: me.id, name: me.display_name || 'Vous', role: env.isAdmin ? 'admin' : 'member' }, members: env.members || [], polls: snap.polls, lists: snap.lists } });
  }
  const mems = new Map();
  const memOf = (k) => { if (!mems.has(k)) mems.set(k, {}); return mems.get(k); };
  const fallback = () => ({ text: 'Je n’ai pas réussi à traiter ce message. Pouvez-vous le reformuler ?', chips: KB.starters().slice(0, 4), links: [], acts: [], unknown: true });
  const mk = (role, o) => Object.assign({ id: uuid(), role, at: new Date().toISOString(), text: '', links: [], acts: [], chips: [] }, o);
  // Les réponses qui préparent ou exécutent une action sont signées « Talk2Piaf Actions » (autre avatar) ; les explications restent « Talk2Piaf »
  const ACTION_IDS = new Set(['send', 'poll_create', 'list_create', 'list_add', 'poll_close', 'poll_delete', 'list_check', 'list_assign', 'list_clear_done', 'list_delete', 'cal_ics', 'cal_google', 'cal_outlook', 'block', 'unblock', 'theme', 'fav', 'arch', 'mute', 'receipts', 'notif', 'watch_add', 'msg_edit', 'msg_undo', 'obj_undo', 'obj_redo']);
  const sign = (m, force) => { if (m.role === 'say' && (force || (m.acts || []).some((a) => ACTION_IDS.has(a.a)))) m.by = 'actions'; return m; };
  const cleanAct = (a) => ({ l: a.l, a: a.a, p: a.p || {} });

  // Question → échange à afficher et à garder localement : [demande, réponse (, résultat d'une action exécutée tout de suite)]
  async function ask(q, env) {
    env = env || {}; const mem = memOf(env.convId || '_');
    let r; try { r = KB.reply(q, context(env), mem); } catch (e) { console.error(e); r = null; } if (!r) r = fallback();
    const out = [mk('ask', { text: String(q).slice(0, 600) })];
    const a = r.acts && r.acts.length === 1 ? r.acts[0] : null;
    if (a && (a.auto || (mode() === 'direct' && DIRECT_OK(a)))) {
      try { const res = await run(a, env, { direct: true }); if (res && res.say) { out.push(sign(mk('say', { text: res.say, acts: (res.acts || []).map(cleanAct), eph: !!res.eph }), true)); return out; } }
      catch (e) { out.push(sign(mk('say', { text: (r.text || '') + '\n⚠️ ' + (e && e.message ? e.message : 'L’action n’a pas pu aboutir.'), links: r.links || [], acts: r.acts.map(cleanAct), chips: r.chips || [] }), true)); return out; }
    }
    out.push(sign(mk('say', { text: r.text + (r.hint ? '\n' + r.hint : ''), links: r.links || [], acts: (r.acts || []).map(cleanAct), chips: r.chips || [] })));
    return out;
  }
  // Résultat d'un bouton → réponse à afficher (ou rien)
  async function press(act, env) {
    const r = await run(act, env, {});
    if (!r) return { items: [], done: false };
    return { items: r.say ? [sign(mk('say', { text: r.say, acts: (r.acts || []).map(cleanAct), eph: !!r.eph }), true)] : [], done: !r.nodone, clear: !!r.clear };
  }
  const failItem = (e) => mk('say', { text: '⚠️ ' + (e && e.message ? e.message : 'L’action n’a pas pu aboutir. Réessayez.') });

  // ---------------------------------------------------------------- échanges gardés sur l'appareil seulement (par compte et par discussion)
  const LKEY = () => 'piaf-t2pa-log-v1-' + (S.me ? S.me.id : '?'), MAX = 40, TTL = 30 * 864e5;
  let cache = null, cacheKey = '';
  function all() {
    if (cache && cacheKey === LKEY()) return cache;
    cacheKey = LKEY(); cache = {};
    try { const raw = JSON.parse(localStorage.getItem(cacheKey) || '{}'); const lim = Date.now() - TTL;
      for (const [k, v] of Object.entries(raw || {})) if (Array.isArray(v)) { const l = v.filter((m) => m && typeof m.text === 'string' && m.at && Date.parse(m.at) > lim && (m.role === 'ask' || m.role === 'say')); if (l.length) cache[k] = l; } } catch { /* */ }
    return cache;
  }
  function persist() { try { const out = {}; for (const [k, v] of Object.entries(all())) { const l = v.filter((m) => !m.eph).slice(-MAX); if (l.length) out[k] = l; } localStorage.setItem(LKEY(), JSON.stringify(out)); } catch { /* quota / mode privé */ } }
  const log = {
    list: (cid) => (all()[cid] || []).slice(),
    add(cid, items) { const l = all()[cid] || (all()[cid] = []); l.push(...items); if (l.length > MAX) l.splice(0, l.length - MAX); persist(); bus.emit('t2pa-log', cid); },
    remove(cid, id) { const l = all()[cid]; if (!l) return; const i = l.findIndex((m) => m.id === id); if (i < 0) return; l.splice(i, 1); if (!l.length) delete all()[cid]; persist(); bus.emit('t2pa-log', cid); },
    // efface la demande et sa réponse (la réponse qui suit une demande, ou la demande qui précède une réponse)
    removeExchange(cid, id) {
      const l = all()[cid]; if (!l) return; const i = l.findIndex((m) => m.id === id); if (i < 0) return;
      let a = i, b = i; while (a > 0 && l[a].role !== 'ask') a--; if (l[a].role !== 'ask') a = i; b = a + 1; while (b < l.length && l[b].role !== 'ask') b++;
      l.splice(a, b - a); if (!l.length) delete all()[cid]; persist(); bus.emit('t2pa-log', cid);
    },
    clear(cid) { delete all()[cid]; mems.delete(cid || '_'); persist(); bus.emit('t2pa-log', cid); },
    clearAll() { cache = {}; mems.clear(); persist(); bus.emit('t2pa-log', null); },
    touch(cid) { persist(); bus.emit('t2pa-log', cid); },
    count: (cid) => (all()[cid] || []).length,
  };
  // à la déconnexion le cache mémoire est abandonné (la clé change avec le compte)
  bus.on && bus.on('logout', () => { cache = null; mems.clear(); });

  P.t2pa = { mode, setMode: (m) => store.set(MKEY, m === 'direct' ? 'direct' : 'preview'), ONCE, run, ask, press, failItem, context, log, DIRECT_OK, mk };
})();
