/* Talk2Piaf — assistant intégré à Piaf, présent dans la liste des discussions.
   Le moteur de réponse (assistant-kb.js) tourne sur l'appareil : rien de ce qui est écrit ici n'est envoyé à un serveur.
   La discussion se comporte comme les autres (liste d'accueil, favori / archive / silence / renommage, non lus, même écran),
   mais elle est locale : état et historique sont gardés dans le navigateur, par compte.
   Les boutons d'action exécutent de vraies opérations de l'application et ne s'exécutent que sur appui.
   Ils restent utilisables autant de fois qu'on veut, sauf les actions d'envoi ou de blocage (ONCE) : une fois faites, le bouton se grise. */
(() => {
  'use strict';
  const P = window.Piaf, KB = window.T2P;
  if (!P || !KB) return;
  const { h, S, api, sb, toast, errText, toCode, copyText, confirmDialog, promptDialog, store, icon, iconBtn, sheet, fmt } = P;

  const AID = 'talk2piaf', NAME = 'Talk2Piaf', MAX_MSGS = 80;
  // Actions qui ne doivent partir qu'une fois (un message envoyé, un blocage…) ; tous les autres boutons restent réutilisables.
  const ONCE = new Set(['send', 'block', 'unblock', 'revoke', 'forget']);
  const usedUp = (a) => !!(a && a.done && ONCE.has(a.a));
  // Moteur de recherche choisi dans Paramètres (réglage de l'appareil, jamais envoyé au serveur)
  const SKEY = 'piaf-t2p-search';
  const searchPref = () => { const v = store.get(SKEY, null); return v && typeof v === 'object' ? v : { id: 'ddg' }; };
  const stKey = () => 'piaf-t2p-v4-' + S.me.id;
  const OLD = (uid) => ['piaf-talk2piaf-history-v2', 'piaf-talk2piaf-v3-' + uid];

  // ---------------------------------------------------------------- état local (par compte)
  let st = null;
  const nowIso = () => new Date().toISOString();
  const plain = (t) => String(t).replace(/\*\*(.+?)\*\*/gs, '$1');
  function welcome() {
    const first = (S.me.display_name || '').split(/\s+/)[0];
    return { role: 'assistant', at: nowIso(), eph: false, links: [], acts: [], chips: KB.starters().slice(0, 4),
      text: `Bonjour${first ? ' ' + first : ''} ! Je suis Talk2Piaf, l’assistant de Piaf. Posez-moi vos questions sur l’application, ou demandez-moi d’agir : je prépare l’action, et vous la lancez d’un appui sur le bouton.\nTapez @ pour mentionner un contact. Par exemple : « écris à @Marie : j’arrive », « libérer de l’espace » ou « comment créer un sondage ? ».` };
  }
  function state() {
    if (!S.me) return null;
    if (st && st.uid === S.me.id) return st;
    let raw = null; try { raw = JSON.parse(localStorage.getItem(stKey()) || 'null'); } catch { /* */ }
    if (raw && Array.isArray(raw.msgs)) st = { uid: S.me.id, fav: !!raw.fav, arch: !!raw.arch, muted: !!raw.muted, nick: raw.nick || null, lastRead: raw.lastRead || '', msgs: raw.msgs.filter((m) => m && typeof m.text === 'string' && m.at) };
    else { st = { uid: S.me.id, fav: false, arch: false, muted: false, nick: null, lastRead: '', msgs: [welcome()] }; save(); }
    try { OLD(S.me.id).forEach((k) => localStorage.removeItem(k)); } catch { /* */ }
    return st;
  }
  function save() { try { const s = st; localStorage.setItem(stKey(), JSON.stringify({ fav: s.fav, arch: s.arch, muted: s.muted, nick: s.nick, lastRead: s.lastRead, msgs: s.msgs.filter((m) => !m.eph).slice(-MAX_MSGS) })); } catch { /* quota / mode privé */ } }
  const changed = () => { save(); P.bus.emit('convs'); };
  const nameOf = () => (state().nick || NAME);
  const markRead = () => { const s = state(); const last = s.msgs[s.msgs.length - 1]; if (last && s.lastRead < last.at) { s.lastRead = last.at; changed(); } };

  // La discussion telle que la liste d'accueil la voit : mêmes champs qu'une discussion ordinaire.
  P.assistantConv = () => {
    const s = state(), last = s.msgs[s.msgs.length - 1];
    return { conversation_id: AID, assistant: true, kind: 'assistant', other_id: null, other_public_id: null, other_name: NAME, nickname: s.nick, avatar_path: null,
      archived: s.arch, favorite: s.fav, muted: s.muted, blocked_by_me: false, members: 0,
      last_message_id: last ? 't2p' : null, last_at: last ? last.at : nowIso(), last_kind: 'text', last_body: last ? plain(last.text).replace(/\s+/g, ' ') : '',
      last_sender: last && last.role === 'user' ? S.me.id : 't2p', last_deleted: false,
      unread: s.msgs.filter((m) => m.role === 'assistant' && !m.eph && m.at > s.lastRead).length };
  };
  P.withAssistant = (convs) => (S.me ? [...convs, P.assistantConv()].sort((a, b) => new Date(b.last_at) - new Date(a.last_at)) : convs);
  P.assistantAvatar = (size = 44) => h('span', { class: 'avatar t2p', style: { width: size + 'px', height: size + 'px' }, 'aria-hidden': 'true' }, h('img', { src: 'icons/talk2piaf.svg', alt: '' }));
  P.openAssistant = () => P.go('#/talk2piaf');

  // Section « Assistant Talk2Piaf » de l'écran Paramètres (moteur de recherche proposé par l'assistant)
  P.assistantSettings = () => {
    const pref = searchPref(), isCustom = pref.id === 'custom';
    const err = h('p', { class: 'form-error small', hidden: true });
    const url = h('input', { type: 'url', inputmode: 'url', autocomplete: 'off', placeholder: 'https://exemple.org/search?q=%s', maxlength: '300', value: isCustom && pref.url ? pref.url : '', 'aria-label': 'Adresse du moteur de recherche personnalisé' });
    const customBox = h('div', { class: 'form-stack', hidden: !isCustom }, h('label', { class: 'field' }, h('span', null, 'Adresse de recherche'), url),
      h('p', { class: 'muted small' }, 'Adresse en https contenant %s à l’endroit où placer la recherche. Exemple : https://exemple.org/search?q=%s'), err,
      h('button', { class: 'btn', type: 'button', onclick: () => {
        const v = url.value.trim();
        if (!KB.validEngineUrl(v)) { err.textContent = 'Adresse invalide : elle doit commencer par https:// et contenir %s.'; err.hidden = false; return; }
        err.hidden = true; store.set(SKEY, { id: 'custom', url: v }); toast('Moteur de recherche enregistré'); } }, 'Enregistrer'));
    const sel = h('select', { 'aria-label': 'Moteur de recherche', onchange: () => {
      if (sel.value === 'custom') { customBox.hidden = false; url.focus(); return; }
      customBox.hidden = true; err.hidden = true; store.set(SKEY, { id: sel.value }); toast('Moteur de recherche : ' + KB.engineOf({ id: sel.value }).name); } },
      ...KB.ENGINES.map((e) => h('option', { value: e.id, selected: pref.id === e.id }, e.name)), h('option', { value: 'custom', selected: isCustom }, 'Autre (adresse personnalisée)'));
    return h('section', { class: 'card' }, h('h2', null, 'Assistant Talk2Piaf'),
      h('div', { class: 'row-text' }, h('strong', null, 'Moteur de recherche'), h('span', { class: 'muted small' }, 'Utilisé quand je vous propose une recherche sur le web (« cherche … sur le web »). Réglage conservé sur cet appareil ; la recherche s’ouvre dans un nouvel onglet.')),
      sel, customBox);
  };

  // Menu ⋯ de la liste : mêmes entrées que pour les autres discussions, appliquées à l'état local.
  const origConvMenu = P.convMenu;
  P.convMenu = (c, opts = {}) => {
    if (!c || !c.assistant) return origConvMenu(c, opts);
    const s = state();
    return sheet(nameOf(), [
      { icon: 'star', label: s.fav ? 'Retirer des favoris' : 'Mettre en favori', onClick: () => { s.fav = !s.fav; changed(); } },
      { icon: 'archive', label: s.arch ? 'Désarchiver' : 'Archiver', onClick: () => { s.arch = !s.arch; changed(); toast(s.arch ? 'Archivée' : 'Désarchivée'); if (s.arch) opts.afterArchive?.(); } },
      { icon: 'mute', label: s.muted ? 'Réactiver les notifications' : 'Mettre en silence', onClick: () => { s.muted = !s.muted; changed(); } },
      { icon: 'edit', label: 'Renommer (visible par moi seul)', onClick: async () => {
          const v = await promptDialog('Renommer la discussion', 'Nom affiché', s.nick || NAME, { hint: 'Ce nom n’est visible que par vous. Laissez vide pour revenir au nom d’origine.' });
          if (v !== null) { s.nick = v.trim() || null; changed(); } } },
      { sep: true },
      { icon: 'trash', danger: true, label: 'Supprimer l’historique pour moi', onClick: async () => {
          if (await confirmDialog('Supprimer l’historique ?', 'Votre échange avec Talk2Piaf sera effacé de cet appareil. Cette action est définitive.', 'Supprimer', true)) { s.msgs = []; mem.topic = null; mem.offer = null; changed(); toast('Historique supprimé'); opts.afterClear?.(); } } },
    ]);
  };

  // ---------------------------------------------------------------- contexte fourni au moteur (état réel de l'application)
  const mem = { topic: null, offer: null };
  const inviteText = () => `Salut ! Je suis sur Piaf, une messagerie privée sans e-mail ni numéro de téléphone. Crée ton compte, puis écris-moi avec mon identifiant : ${S.me.public_id}. L'application : ${location.origin}${location.pathname}`;
  function context() {
    const me = S.me || {};
    return {
      name: me.display_name || '', first: (me.display_name || '').split(/\s+/)[0] || '', pid: me.public_id || '', id8: me.public_id ? fmt.id8(me.public_id) : '',
      now: new Date(), settings: S.settings || {}, search: searchPref(), perm: 'Notification' in window ? Notification.permission : 'unsupported',
      online: S.online, rt: S.rt, theme: store.get('piaf-theme', 'auto'), installable: !!P.installEvt,
      standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
      convs: (S.convs || []).map((c) => ({ id: c.conversation_id, name: P.convName(c) || '', group: c.kind === 'group', blocked: !!c.blocked_by_me, pid: c.other_public_id || null,
        unread: c.unread || 0, favorite: !!c.favorite, archived: !!c.archived, muted: !!c.muted })),
    };
  }

  // ---------------------------------------------------------------- actions : de vraies opérations de l'application
  const convById = (id) => (S.convs || []).find((c) => c.conversation_id === id);
  async function saveSetting(patch) { await api.q(sb.from('user_settings').update(patch).eq('user_id', S.me.id)); Object.assign(S.settings, patch); }
  const pickFile = (accept) => new Promise((res) => {
    const f = h('input', { type: 'file', accept, style: { display: 'none' } });
    f.addEventListener('change', () => { const file = f.files[0]; f.remove(); res(file || null); }); f.addEventListener('cancel', () => { f.remove(); res(null); });
    document.body.append(f); f.click();
  });
  const openConvAct = (id) => ({ l: 'Ouvrir la discussion', a: 'conv', p: { id } });
  const rnd = (n) => { const a = new Uint32Array(1); let x; do { crypto.getRandomValues(a); x = a[0]; } while (x >= Math.floor(4294967296 / n) * n); return x % n; };

  // Chaque action renvoie { say, eph?, acts?, nodone? } (réponse de l'assistant), { clear } ou null ; elle lève une erreur à message lisible.
  const ACTIONS = {
    go: (p) => { P.go(p.h); return null; },
    conv: (p) => { if (!convById(p.id)) throw new Error('Cette discussion n’existe plus.'); P.go('#/c/' + p.id); return null; },
    gallery: (p) => { P.go('#/m/' + p.id); return null; },
    group: (p) => { P.go('#/g/' + p.id); return null; },
    privacy: () => { location.assign('privacy.html'); return null; },
    async start(p) {
      if (!S.online) throw new Error('Pas de connexion : réessayez quand le réseau revient.');
      let id; try { id = await api.rpc('start_conversation', { p_public_id: p.pid }); } catch (e) { throw new Error(toCode(e) === 'not_found' ? 'Aucune personne ne correspond à cet identifiant.' : errText(e)); }
      await P.refreshConvs(); P.go('#/c/' + id); return null;
    },
    async send(p) {
      const c = convById(p.id); if (!c) throw new Error('Cette discussion n’existe plus.');
      if (c.blocked_by_me) throw new Error('Vous avez bloqué cette personne : débloquez-la d’abord.');
      const body = String(p.t || '').trim(); if (!body || body.length > 4000) throw new Error('Message vide ou trop long.');
      const label = P.convName(c);
      if (S.online) {
        try {
          const row = await api.rpc('send_message', { p_conv: p.id, p_client_id: P.uuid(), p_body: body, p_reply_to: null, p_forwarded: false });
          P.bus.emit('sent', row); P.refreshConvs().catch(() => {});
          return { say: `Message envoyé à ${label}. ✅`, acts: [openConvAct(p.id)] };
        } catch (e) { if (toCode(e) !== 'network') throw new Error(errText(e)); }
      }
      await P.queueMessage(p.id, body);
      return { say: `Pas de connexion pour l’instant : le message pour ${label} est en file d’attente et partira dès que le réseau reviendra. 🕓`, acts: [openConvAct(p.id)] };
    },
    async block(p) {
      const c = convById(p.id); if (!c) throw new Error('Cette discussion n’existe plus.');
      if (c.kind === 'group' || !c.other_id) throw new Error('On ne peut pas bloquer un groupe.');
      if (c.blocked_by_me) return { say: `${p.n} est déjà bloqué·e.` };
      if (!(await confirmDialog('Bloquer ' + p.n + ' ?', 'Cette personne ne pourra plus vous écrire, et vous ne pourrez plus lui écrire tant que le blocage dure. Vous pourrez la débloquer dans Paramètres.', 'Bloquer', true))) return { say: 'D’accord, rien n’a été modifié.', nodone: true };
      try { await api.rpc('block_user', { p_target: c.other_id }); await P.refreshConvs(); } catch (e) { throw new Error(errText(e)); }
      return { say: `${p.n} est bloqué·e. Pour annuler : « débloque ${p.n} ».`, acts: [{ l: 'Débloquer ' + p.n, a: 'unblock', p: { id: p.id, n: p.n } }] };
    },
    async unblock(p) {
      const c = convById(p.id); if (!c || !c.other_id) throw new Error('Cette discussion n’existe plus.');
      try { await api.rpc('unblock_user', { p_target: c.other_id }); await P.refreshConvs(); } catch (e) { throw new Error(errText(e)); }
      return { say: `${p.n} est débloqué·e : vous pouvez de nouveau vous écrire.`, acts: [openConvAct(p.id)] };
    },
    async space() {
      if (!S.online) throw new Error('Pas de connexion : réessayez quand le réseau revient.');
      let rows; try { rows = await api.q(sb.from('conversations').select('id,media_bytes')); } catch (e) { throw new Error(errText(e)); }
      const quota = (S.cfg && S.cfg.conversation_quota_bytes) || 104857600;
      const list = rows.map((r) => ({ c: convById(r.id), used: Number(r.media_bytes) || 0 })).filter((x) => x.c && x.used > 0).sort((a, b) => b.used - a.used).slice(0, 5);
      if (!list.length) return { say: 'Aucun média n’occupe d’espace pour l’instant : toutes vos discussions sont à **0 Mo** sur ' + fmt.size(quota) + '. 🎉' };
      const total = rows.reduce((n, r) => n + (Number(r.media_bytes) || 0), 0);
      return { say: `Espace de médias (photos, vidéos, audio) — **${fmt.size(total)}** au total. Les discussions qui pèsent le plus :\n` + list.map((x) => `• **${P.convName(x.c)}** : ${fmt.size(x.used)} sur ${fmt.size(quota)} (${Math.min(100, Math.round((x.used / quota) * 100))} %)`).join('\n') + '\nOuvrez les médias d’une discussion pour supprimer des fichiers **pour tout le monde** : seule cette suppression libère de la place.',
        acts: list.map((x) => ({ l: 'Médias de ' + P.convName(x.c), a: 'gallery', p: { id: x.c.conversation_id } })) };
    },
    async fav(p) { await P.setMember(p.id, { favorite: !!p.v }); return { say: p.v ? `${p.n} est maintenant dans vos favoris. ⭐` : `${p.n} n’est plus dans vos favoris.` }; },
    async arch(p) { await P.setMember(p.id, { archived: !!p.v }); return { say: p.v ? `${p.n} est archivée. Elle reviendra à la réception d’un nouveau message.` : `${p.n} est de retour dans vos discussions.` }; },
    async mute(p) { await P.setMember(p.id, { muted: !!p.v }); return { say: p.v ? `${p.n} est en silence : plus de notifications pour cette discussion.` : `Les notifications de ${p.n} sont réactivées.` }; },
    async copy(p) { await copyText(p.t != null ? p.t : p.k === 'invite' ? inviteText() : S.me.public_id); return null; },
    async invite() {
      const text = inviteText();
      if (navigator.share) { try { await navigator.share({ text }); return null; } catch (e) { if (e && e.name === 'AbortError') return null; } }
      await copyText(text); return { say: 'Invitation copiée. Collez-la dans le message ou l’application de votre choix.' };
    },
    pass: () => ({ say: `Voici une phrase secrète tirée au hasard :\n**${KB.passphrase(rnd)}**\nElle vient d’être générée sur votre appareil et ce message ne sera pas conservé dans l’historique. Notez-la en lieu sûr avant de l’utiliser comme code secret.`, eph: true, acts: [{ l: 'Une autre phrase', a: 'pass', p: {} }] }),
    async revoke() {
      if (!(await confirmDialog('Révoquer les autres sessions ?', 'Tous les autres appareils connectés à votre compte seront déconnectés. Cet appareil reste connecté.', 'Révoquer', true))) return { say: 'D’accord, rien n’a été modifié.', nodone: true };
      const { error } = await P.auth.revokeOthers(); if (error) throw new Error('Échec de la révocation. Réessayez.');
      return { say: 'Les autres sessions ont été révoquées.' };
    },
    async name() {
      const v = await promptDialog('Nom d’affichage', 'Nom visible par vos contacts', S.me.display_name); if (v === null) return { say: 'D’accord, votre nom reste inchangé.', nodone: true };
      try { await api.rpc('update_display_name', { p_name: v }); } catch (e) { throw new Error(errText(e)); }
      S.me.display_name = v.trim(); return { say: `C’est fait : vous apparaissez maintenant sous le nom **${S.me.display_name}**.` };
    },
    async photo() {
      const file = await pickFile('image/*'); if (!file) return { say: 'Aucune photo choisie.', nodone: true };
      try { const blob = await P.cropPhoto(file, true); if (!blob) return { say: 'D’accord, votre photo reste inchangée.', nodone: true }; await P.setAvatar(blob); } catch (e) { throw new Error(errText(e)); } return { say: 'Votre photo de profil est mise à jour.' };
    },
    async rmphoto() { if (!S.me.avatar_path) return { say: 'Vous n’avez pas de photo de profil.' }; try { await P.setAvatar(null); } catch (e) { throw new Error(errText(e)); } return { say: 'Votre photo de profil est supprimée.' }; },
    async receipts(p) { try { await saveSetting({ read_receipts: !!p.v }); } catch (e) { throw new Error(errText(e)); } return { say: p.v ? 'Confirmations de lecture activées.' : 'Confirmations de lecture désactivées (réciproque : vous ne voyez plus celles des autres).' }; },
    async notif(p) {
      if (!p.v) { try { await saveSetting({ notifications: false }); } catch (e) { throw new Error(errText(e)); } return { say: 'Notifications désactivées.' }; }
      if (!('Notification' in window)) throw new Error('Les notifications ne sont pas disponibles sur ce navigateur.');
      const r = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (r !== 'granted') throw new Error('Autorisation refusée. Vous pouvez la modifier dans les réglages du navigateur.');
      try { await saveSetting({ notifications: true }); } catch (e) { throw new Error(errText(e)); }
      return { say: 'Notifications activées : vous serez prévenu des nouveaux messages tant que l’application est ouverte ou en arrière-plan.' };
    },
    theme: (p) => { store.set('piaf-theme', p.m); P.applyTheme(); return { say: { dark: 'Thème sombre activé. 🌙', light: 'Thème clair activé. ☀️', auto: 'Thème automatique activé (il suit votre appareil).' }[p.m] }; },
    async refresh() { await P.refreshConvs(); return { say: 'Discussions actualisées.' }; },
    reload: () => { location.reload(); return null; },
    async clearcache() { try { for (const k of await caches.keys()) await caches.delete(k); const regs = await navigator.serviceWorker?.getRegistrations?.(); for (const r of regs || []) await r.unregister(); } catch { /* */ } location.reload(); return null; },
    async install() {
      if (!P.installEvt) throw new Error('L’installation n’est pas proposée par ce navigateur : utilisez son menu (voir mes explications).');
      P.installEvt.prompt(); const c = await P.installEvt.userChoice; P.installEvt = null;
      return { say: c.outcome === 'accepted' ? 'Piaf s’installe sur votre appareil. 🎉' : 'Installation annulée.' };
    },
    forget: () => ({ clear: true }),
    reveal: (p) => ({ say: p.t }),
  };

  // ---------------------------------------------------------------- écran de discussion (mêmes composants que les autres discussions)
  const safeUrl = (u) => { try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null; } catch { return null; } };
  function inline(text) { // **gras** uniquement ; tout le reste est du texte brut (aucun HTML)
    const out = []; String(text).split(/\*\*(.+?)\*\*/gs).forEach((t, i) => { if (t) { if (i % 2) out.push(h('strong', null, t)); else out.push(...P.linkify(t)); } });
    return out;
  }
  P.assistantInline = inline;
  const sameGroup = (a, b) => a && b && a.role === b.role && fmt.dayKey(a.at) === fmt.dayKey(b.at) && Math.abs(new Date(b.at) - new Date(a.at)) < 300000;

  // ---------------------------------------------------------------- @talk2piaf dans les autres discussions (réponse locale, visible par la personne qui l'appelle)
  // views-chat.js marque chaque bouton « done » après un appui : pour les actions réutilisables on neutralise ce drapeau.
  const mkAct = (a) => { const o = { l: a.l, a: a.a, p: a.p || {} }; if (!ONCE.has(a.a)) Object.defineProperty(o, 'done', { get: () => false, set: () => {}, enumerable: false }); return o; };
  P.assistantAsk = (q) => {
    let r; try { r = KB.reply(q, context(), mem); } catch (e) { console.error(e); r = null; }
    if (!r) r = { text: 'Je n’ai pas réussi à traiter ce message. Pouvez-vous le reformuler ?', chips: KB.starters().slice(0, 4), links: [], acts: [] };
    if (r.topic !== undefined) mem.topic = r.unknown ? null : (r.topic || mem.topic);
    mem.offer = (r.acts && r.acts[0]) || null;
    return { text: r.text, links: r.links || [], acts: (r.acts || []).map(mkAct), chips: r.chips || [] };
  };
  P.assistantRun = async (act) => { const fn = ACTIONS[act.a]; return fn ? fn(act.p || {}) : null; };
  P.assistantBubble = (r, o) => {
    const extras = [];
    const links = (r.links || []).map((l) => { const u = safeUrl(l.u); return u ? h('a', { class: 't2p-link', href: u, target: '_blank', rel: 'noopener noreferrer nofollow' }, l.l) : null; }).filter(Boolean);
    if (links.length) extras.push(h('div', { class: 't2p-links' }, links));
    if (r.acts && r.acts.length) extras.push(h('div', { class: 't2p-acts' }, r.acts.map((a, j) => h('button', { type: 'button', class: 't2p-act' + (usedUp(a) ? ' done' : ''), disabled: usedUp(a), onclick: (e) => o.onAct(j, e.currentTarget) }, a.l))));
    if (o.showChips && r.chips && r.chips.length) extras.push(h('div', { class: 't2p-chips' }, r.chips.map((c) => h('button', { type: 'button', class: 't2p-chip', onclick: () => o.onChip(c.t) }, c.l))));
    const bubble = h('div', { class: 'bubble first last whisper', tabindex: '0', role: 'button', 'aria-haspopup': 'dialog', 'aria-label': 'Réponse de Talk2Piaf',
      onclick: () => o.onMenu(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); o.onMenu(); } } },
      h('div', { class: 'sender t2p-name' }, NAME), h('div', { class: 'text' }, inline(r.text)),
      h('div', { class: 'meta' }, h('time', { datetime: o.time }, fmt.time(o.time)), h('span', null, ' · visible par vous seul')));
    return h('div', { class: 'msg gap', role: 'listitem' }, bubble, extras.length ? h('div', { class: 't2p-extras' }, extras) : null);
  };

  P.views.assistant = () => {
    const s = state();
    let destroyed = false, busy = false, typing = false, timer = null;
    const list = h('div', { class: 'msg-list', role: 'list', 'aria-live': 'polite', 'aria-relevant': 'additions' });
    const scroller = h('div', { class: 'msgs' }, list);
    const pop = h('div', { class: 'mention-pop', role: 'listbox', 'aria-label': 'Contacts à mentionner', hidden: true });
    const ta = h('textarea', { rows: '1', placeholder: 'Message — tapez @ pour mentionner un contact', 'aria-label': 'Écrire un message', maxlength: '600', enterkeyhint: 'enter',
      oninput: () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; updateMentions(); },
      onclick: () => updateMentions(),
      onkeydown: (e) => { if (mentionKey(e)) return; if (e.key === 'Enter' && !e.shiftKey && matchMedia('(pointer:fine)').matches) { e.preventDefault(); sendText(); } } });
    const sendBtn = h('button', { class: 'send', type: 'button', 'aria-label': 'Envoyer', onclick: () => sendText() }, icon('send', 22));
    const composer = h('div', { class: 'composer' }, pop, h('div', { class: 'composer-row' }, ta, sendBtn));
    const headTitle = h('button', { class: 'chat-title', type: 'button', onclick: () => profileSheet() });
    const header = h('header', { class: 'topbar chat-top' }, iconBtn('back', 'Retour aux discussions', () => P.back('#/')), headTitle, iconBtn('dots', 'Menu de la discussion', () => menu()));
    const el = h('div', { class: 'screen chat' }, header, h('div', { class: 'msgs-wrap' }, scroller), composer);


    // ---- @contact : la liste vient de vos discussions (personnes et groupes) ; le moteur comprend « écris à @Marie : … », « ouvre @Marie »…
    const nrm = KB.norm;
    const contacts = () => (S.convs || []).map((c) => ({ name: P.convName(c) || '', id: c.other_id, path: c.avatar_path, group: c.kind === 'group' })).filter((c) => c.name);
    let mp = { items: [], idx: 0, start: 0 };
    const closePop = () => { pop.hidden = true; mp.items = []; };
    function updateMentions() {
      const caret = ta.selectionStart ?? ta.value.length, m = /(^|\s)@([^\s@]{0,30})$/u.exec(ta.value.slice(0, caret));
      if (!m) { closePop(); return; }
      const q = nrm(m[2]);
      mp = { items: contacts().filter((c) => !q || nrm(c.name).split(' ').some((w) => w.startsWith(q))).slice(0, 6), idx: 0, start: caret - m[2].length - 1 };
      drawPop();
    }
    function drawPop() {
      if (!mp.items.length) { pop.hidden = true; return; }
      pop.hidden = false;
      pop.replaceChildren(...mp.items.map((c, i) => h('button', { type: 'button', role: 'option', class: 'mention-item' + (i === mp.idx ? ' on' : ''), 'aria-selected': String(i === mp.idx), onpointerdown: (e) => { e.preventDefault(); pickMention(c); } },
        P.avatar(c.name, 30, c.id, c.path, c.group), h('span', { class: 'mention-name' }, c.name), c.group ? h('span', { class: 'muted small' }, 'Groupe') : null)));
    }
    function pickMention(c) {
      const caret = ta.selectionStart ?? ta.value.length, ins = '@' + c.name + ' ';
      ta.value = ta.value.slice(0, mp.start) + ins + ta.value.slice(caret); const pos = mp.start + ins.length;
      ta.setSelectionRange(pos, pos); closePop(); ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; ta.focus({ preventScroll: true });
    }
    function mentionKey(e) {
      if (pop.hidden || !mp.items.length) return false;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); mp.idx = (mp.idx + (e.key === 'ArrowDown' ? 1 : mp.items.length - 1)) % mp.items.length; drawPop(); return true; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(mp.items[mp.idx]); return true; }
      if (e.key === 'Escape') { e.preventDefault(); closePop(); return true; }
      return false;
    }
    function richUser(text) { // « @Nom » d'un contact connu mis en valeur ; le reste : liens simples
      const names = [...new Set(contacts().map((c) => c.name))].sort((a, b) => b.length - a.length); if (!names.length || !text.includes('@')) return P.linkify(text);
      const re = new RegExp('(^|[\\s(«"\'])@(' + names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?![\\p{L}\\p{N}_])', 'giu'), out = []; let last = 0, m;
      while ((m = re.exec(text))) { const st0 = m.index + m[1].length; if (st0 > last) out.push(...P.linkify(text.slice(last, st0))); out.push(h('span', { class: 'mention' }, m[2])); last = st0 + 1 + m[2].length; }
      if (last < text.length) out.push(...P.linkify(text.slice(last)));
      return out;
    }

    function drawHeader() {
      headTitle.replaceChildren(P.assistantAvatar(38), h('span', { class: 'chat-title-text' }, h('strong', null, nameOf()), h('span', { class: 'muted small' }, 'Assistant de Piaf')));
    }
    function buildMsg(m, idx, first, last, isLastMsg) {
      const mine = m.role === 'user';
      const parts = [h('div', { class: 'text' }, mine ? richUser(m.text) : inline(m.text)),
        h('div', { class: 'meta' }, h('time', { datetime: m.at }, fmt.time(m.at)), mine ? h('span', { class: 'st read', title: 'Lu' }, icon('check2', 16)) : null)];
      const bubble = h('div', { class: 'bubble' + (mine ? ' mine' : '') + (first ? ' first' : '') + (last ? ' last' : ''), tabindex: '0', role: 'button', 'aria-haspopup': 'dialog', 'aria-label': 'Actions du message',
        onclick: () => msgSheet(idx), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); msgSheet(idx); } } }, parts);
      const kids = [bubble];
      if (!mine) {
        const extras = [];
        const links = (m.links || []).map((l) => { const u = safeUrl(l.u); return u ? h('a', { class: 't2p-link', href: u, target: '_blank', rel: 'noopener noreferrer nofollow' }, l.l) : null; }).filter(Boolean);
        if (links.length) extras.push(h('div', { class: 't2p-links' }, links));
        if (m.acts && m.acts.length) extras.push(h('div', { class: 't2p-acts' }, m.acts.map((a, j) => h('button', { type: 'button', class: 't2p-act' + (usedUp(a) ? ' done' : ''), disabled: usedUp(a), onclick: (e) => runAct(idx, j, e.currentTarget) }, a.l))));
        if (isLastMsg && !typing && m.chips && m.chips.length) extras.push(h('div', { class: 't2p-chips' }, m.chips.map((c) => h('button', { type: 'button', class: 't2p-chip', onclick: () => sendText(c.t) }, c.l))));
        if (extras.length) kids.push(h('div', { class: 't2p-extras' }, extras));
      }
      return h('div', { class: 'msg' + (mine ? ' mine' : '') + (first ? ' gap' : ''), role: 'listitem' }, kids);
    }
    function render() {
      if (destroyed) return;
      const all = s.msgs, frag = [];
      all.forEach((m, i) => {
        const prev = all[i - 1], next = all[i + 1];
        if (!prev || fmt.dayKey(prev.at) !== fmt.dayKey(m.at)) frag.push(h('div', { class: 'day', role: 'separator' }, h('span', null, fmt.dayLabel(m.at))));
        frag.push(buildMsg(m, i, !sameGroup(prev, m), !sameGroup(m, next), i === all.length - 1));
      });
      if (!all.length) frag.push(h('div', { class: 't2p-welcome' }, h('img', { src: 'icons/talk2piaf.svg', alt: '' }), h('strong', null, NAME), h('span', null, 'Posez-moi une question sur Piaf.'),
        h('div', { class: 't2p-chips', style: { justifyContent: 'center', marginTop: '10px' } }, KB.starters().slice(0, 4).map((c) => h('button', { type: 'button', class: 't2p-chip', onclick: () => sendText(c.t) }, c.l)))));
      if (typing) frag.push(h('div', { class: 'msg gap', role: 'listitem' }, h('div', { class: 'bubble first last' }, h('span', { class: 't2p-typing' }, h('i'), h('i'), h('i')))));
      list.replaceChildren(...frag);
      scroller.scrollTop = scroller.scrollHeight;
    }

    function msgSheet(idx) {
      const m = s.msgs[idx]; if (!m) return;
      sheet(null, [
        { icon: 'copy', label: 'Copier', onClick: () => copyText(plain(m.text)) },
        { sep: true },
        { icon: 'eye', label: 'Supprimer pour moi', danger: true, onClick: () => { s.msgs.splice(idx, 1); changed(); render(); } },
      ]);
    }
    function menu() { P.convMenu(P.assistantConv(), { afterArchive: () => P.go('#/'), afterClear: () => { render(); } }); }
    function profileSheet() {
      sheet(null, [
        { icon: 'search', label: 'Voir ce que je sais faire', onClick: () => sendText('Que peux-tu faire ?') },
        { icon: 'sliders', label: 'Favori, archive, silence, renommer…', onClick: () => menu() },
      ], h('div', { class: 'profile-card' }, P.assistantAvatar(84), h('strong', { class: 'big' }, nameOf()), s.nick ? h('span', { class: 'muted small' }, 'Renommé « ' + s.nick + ' » (visible par vous seul)') : null,
        h('div', { class: 'muted' }, 'Assistant intégré à Piaf'), h('div', { class: 'muted small' }, 'Développé par Ehorg · fonctionne sur votre appareil')));
    }

    function push(m) {
      s.msgs.push(Object.assign({ at: nowIso(), links: [], acts: [], chips: [], eph: false }, m));
      if (m.role === 'assistant') { s.arch = false; if (!destroyed) s.lastRead = s.msgs[s.msgs.length - 1].at; }
      changed(); render();
    }
    async function runAct(idx, j, btn) {
      const act = s.msgs[idx] && s.msgs[idx].acts[j]; if (!act || usedUp(act)) return;
      const fn = ACTIONS[act.a]; if (!fn) return;
      btn.disabled = true;
      try {
        const r = await fn(act.p || {});
        if (destroyed) return;
        if (r && r.clear) { s.msgs = []; mem.topic = null; mem.offer = null; changed(); render(); toast('Historique effacé'); return; }
        if (ONCE.has(act.a) && !(r && r.nodone)) act.done = true;
        btn.disabled = usedUp(act);
        if (r && r.say) { push({ role: 'assistant', text: r.say, acts: (r.acts || []).map((a) => ({ l: a.l, a: a.a, p: a.p || {} })), eph: !!r.eph }); } else { changed(); render(); }
      } catch (e) {
        if (destroyed) return;
        btn.disabled = false; push({ role: 'assistant', text: '⚠️ ' + (e && e.message ? e.message : 'L’action n’a pas pu aboutir. Réessayez.') });
      }
    }
    function sendText(text) {
      const v = String(text != null ? text : ta.value).trim(); if (!v || busy) return;
      if (text == null) { ta.value = ''; ta.style.height = 'auto'; }
      busy = true; typing = true; push({ role: 'user', text: v.slice(0, 600) });
      let r; try { r = KB.reply(v, context(), mem); } catch (e) { console.error(e); r = null; }
      if (!r) r = { text: 'Je n’ai pas réussi à traiter ce message. Pouvez-vous le reformuler ?', chips: KB.starters().slice(0, 4), links: [], acts: [] };
      timer = setTimeout(() => {
        typing = false; busy = false;
        if (r.topic !== undefined) mem.topic = r.unknown ? null : (r.topic || mem.topic);
        mem.offer = (r.acts && r.acts[0]) || null;
        push({ role: 'assistant', text: r.text, links: r.links || [], acts: (r.acts || []).map((a) => ({ l: a.l, a: a.a, p: a.p || {} })), chips: r.chips || [] });
        if (!destroyed && matchMedia('(pointer:fine)').matches) ta.focus({ preventScroll: true });
      }, Math.min(700, 220 + r.text.length * 2));
    }

    drawHeader(); render(); markRead();
    const un = [P.bus.on('convs', () => { if (!destroyed) drawHeader(); })];
    return { el, mounted() { scroller.scrollTop = scroller.scrollHeight; }, destroy() { destroyed = true; clearTimeout(timer); un.forEach((u) => u()); markRead(); } };
  };
})();
