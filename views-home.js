/* Piaf — écrans : connexion/inscription, accueil, nouvelle discussion, paramètres, notifications globales. */
(() => {
'use strict';
const { h, icon, iconBtn, S, bus, api, fmt, avatar, toast, sheet, modal, confirmDialog, promptDialog, copyText, errText, toCode, store, sb } = Piaf;
const myId = () => S.me.id;

// Met à jour mes réglages sur une conversation (favori, archive, silence, surnom).
Piaf.setMember = async (convId, patch) => {
  await api.q(sb.from('conversation_members').update(patch).eq('conversation_id', convId).eq('user_id', myId()));
  await Piaf.refreshConvs();
};
Piaf.convMenu = (c, opts = {}) => sheet(Piaf.convName(c), [
  { icon: 'star', label: c.favorite ? 'Retirer des favoris' : 'Mettre en favori', onClick: () => Piaf.setMember(c.conversation_id, { favorite: !c.favorite }).catch((e) => toast(errText(e), { error: true })) },
  { icon: 'archive', label: c.archived ? 'Désarchiver' : 'Archiver', onClick: () => Piaf.setMember(c.conversation_id, { archived: !c.archived }).then(() => { toast(c.archived ? 'Désarchivée' : 'Archivée'); opts.afterArchive?.(); }).catch((e) => toast(errText(e), { error: true })) },
  { icon: 'mute', label: c.muted ? 'Réactiver les notifications' : 'Mettre en silence', onClick: () => Piaf.setMember(c.conversation_id, { muted: !c.muted }).catch((e) => toast(errText(e), { error: true })) },
  { icon: 'edit', label: 'Renommer (visible par moi seul)', onClick: async () => {
      const v = await promptDialog('Renommer la discussion', 'Nom affiché', c.nickname || c.other_name, { hint: 'Ce nom n’est visible que par vous. Laissez vide pour revenir au nom d’origine.' });
      if (v !== null) Piaf.setMember(c.conversation_id, { nickname: v.trim() || null }).catch((e) => toast(errText(e), { error: true })); } },
  { sep: true },
  { icon: 'trash', danger: true, label: 'Supprimer l’historique pour moi', onClick: async () => {
      if (await confirmDialog('Supprimer l’historique ?', 'Les messages actuels disparaissent de votre côté uniquement. L’autre personne les garde. Les nouveaux messages apparaîtront normalement. Cette action est définitive pour vous.', 'Supprimer', true)) {
        try { await api.rpc('clear_history', { p_conv: c.conversation_id }); await Piaf.refreshConvs(); toast('Historique supprimé'); opts.afterClear?.(); } catch (e) { toast(errText(e), { error: true }); } } } },
]);

// ============================================================ connexion / création de compte
Piaf.views.auth = () => {
  let mode = 'login', created = null, busy = false;
  const el = h('div', { class: 'screen auth' });
  const brand = h('div', { class: 'brand' }, h('img', { class: 'brand-img', src: 'icons/icon.svg', alt: '', width: '84', height: '84' }), h('h1', null, 'Piaf'), h('p', { class: 'muted' }, 'Messagerie privée, simple et légère'), h('p', { class: 'muted small' }, 'Sans adresse e-mail, sans numéro de téléphone.'));

  function field(label, input, extra) { return h('label', { class: 'field' }, h('span', null, label), input, extra || null); }
  function secretInput(auto) {
    const i = h('input', { type: 'password', autocomplete: auto, maxlength: '64', enterkeyhint: 'go', autocapitalize: 'none', spellcheck: 'false' });
    const t = h('button', { type: 'button', class: 'link-btn', onclick: () => { i.type = i.type === 'password' ? 'text' : 'password'; t.textContent = i.type === 'password' ? 'Afficher' : 'Masquer'; } }, 'Afficher');
    return { i, row: h('div', { class: 'secret-row' }, i, t) };
  }
  const submitBtn = (label) => h('button', { class: 'btn primary block', type: 'submit' }, label);
  function setBusy(form, b, label) { busy = b; const btn = $$(form); btn.disabled = b; btn.textContent = b ? 'Patientez…' : label; }
  const $$ = (form) => form.querySelector('button[type=submit]');

  function loginForm() {
    const id = h('input', { type: 'text', inputmode: 'numeric', pattern: '[0-9 ]*', maxlength: '10', autocomplete: 'username', placeholder: '1234 5678', enterkeyhint: 'next' });
    const sec = secretInput('current-password'); const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const form = h('form', { class: 'card', novalidate: true, onsubmit: async (e) => {
      e.preventDefault(); if (busy) return; err.hidden = true;
      const digits = id.value.replace(/\s/g, '');
      if (!/^[1-9][0-9]{7}$/.test(digits)) { err.textContent = 'L’identifiant compte 8 chiffres.'; err.hidden = false; id.focus(); return; }
      if (!sec.i.value) { err.textContent = 'Saisissez votre code secret.'; err.hidden = false; sec.i.focus(); return; }
      setBusy(form, true, 'Se connecter');
      try { await Piaf.auth.login(digits, sec.i.value); await Piaf.enter(); }
      catch (ex) { setBusy(form, false, 'Se connecter'); const c = toCode(ex); err.textContent = c === 'locked' && ex.retryAfter ? `Trop de tentatives. Réessayez dans ${Math.ceil(ex.retryAfter / 60)} min.` : errText(ex); err.hidden = false; }
    } }, field('Identifiant (8 chiffres)', id), field('Code secret', sec.row), err, submitBtn('Se connecter'));
    return form;
  }
  function signupForm() {
    const name = h('input', { type: 'text', maxlength: '40', autocomplete: 'nickname', placeholder: 'Comment voulez-vous apparaître ?', enterkeyhint: 'next' });
    const s1 = secretInput('new-password'), s2 = secretInput('new-password'); const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const form = h('form', { class: 'card', novalidate: true, onsubmit: async (e) => {
      e.preventDefault(); if (busy) return; err.hidden = true;
      const fail = (m, f) => { err.textContent = m; err.hidden = false; f.focus(); };
      if (!name.value.trim()) return fail('Choisissez un nom d’affichage.', name);
      if (s1.i.value.length < 8) return fail('Le code secret doit faire au moins 8 caractères. Une courte phrase fonctionne très bien.', s1.i);
      if (s1.i.value !== s2.i.value) return fail('Les deux codes secrets sont différents.', s2.i);
      setBusy(form, true, 'Créer mon compte');
      try { const r = await Piaf.auth.signup(name.value.trim(), s1.i.value); created = r; draw(); }
      catch (ex) { setBusy(form, false, 'Créer mon compte'); err.textContent = errText(ex); err.hidden = false; }
    } }, field('Nom d’affichage', name), field('Code secret (8 caractères minimum)', s1.row), field('Confirmer le code secret', s2.row),
      h('p', { class: 'notice' }, h('strong', null, 'Important : '), 'il n’y a ni e-mail ni téléphone de récupération. Si vous perdez à la fois cet appareil (ou sa session) et votre code secret, le compte sera définitivement inaccessible.'),
      err, submitBtn('Créer mon compte'));
    return form;
  }
  function createdView() {
    return h('div', { class: 'card created' }, h('h2', null, `Bienvenue, ${created.display_name} !`),
      h('p', null, 'Voici votre identifiant. Donnez-le aux personnes qui veulent vous écrire.'),
      h('div', { class: 'big-id', 'aria-label': 'Votre identifiant' }, fmt.id8(created.public_id)),
      h('button', { class: 'btn block', type: 'button', onclick: () => copyText(created.public_id) }, icon('copy', 18), ' Copier l’identifiant'),
      h('p', { class: 'notice' }, 'Notez-le avec votre code secret : ils servent à vous reconnecter si cette session est perdue.'),
      h('button', { class: 'btn primary block', type: 'button', onclick: async (e) => { e.target.disabled = true; try { await Piaf.enter(); } catch (ex) { e.target.disabled = false; toast(errText(ex), { error: true }); } } }, 'Commencer'));
  }
  function draw() {
    const tabs = h('div', { class: 'tabs', role: 'tablist' }, [['login', 'Connexion'], ['signup', 'Créer un compte']].map(([k, l]) =>
      h('button', { role: 'tab', type: 'button', class: 'tab' + (mode === k ? ' on' : ''), 'aria-selected': String(mode === k), onclick: () => { mode = k; draw(); } }, l)));
    el.replaceChildren(h('div', { class: 'auth-inner' }, brand, created ? createdView() : [tabs, mode === 'login' ? loginForm() : signupForm()],
      h('p', { class: 'muted small center' }, h('a', { href: 'privacy.html' }, 'Confidentialité et données'))));
  }
  draw();
  return { el };
};

// ============================================================ accueil
Piaf.views.home = () => {
  let tab = 'chats', filter = '', loadErr = false;
  const search = h('input', { type: 'search', placeholder: 'Rechercher une discussion', 'aria-label': 'Rechercher une discussion', oninput: (e) => { filter = e.target.value.trim().toLowerCase(); drawList(); } });
  const list = h('div', { class: 'conv-list', role: 'list' });
  const tabsEl = h('div', { class: 'tabs small', role: 'tablist' });
  const fab = h('button', { class: 'fab', type: 'button', 'aria-label': 'Nouvelle discussion', onclick: () => Piaf.go('#/new') }, icon('plus', 26));

  const clip = (t) => { const x = String(t == null ? '' : t).replace(/\s+/g, ' ').trim(); return x.length > 120 ? x.slice(0, 120) + '…' : x; };
  function preview(c) { return clip(rawPreview(c)); }
  function rawPreview(c) {
    if (!c.last_message_id) return 'Nouvelle discussion';
    if (c.last_deleted) return 'Message supprimé';
    if (c.last_kind === 'system') return c.last_body;
    const who = c.last_kind === 'assistant' ? 'Talk2Piaf Cowork : ' : c.last_sender === myId() ? 'Vous : ' : c.kind === 'group' && c.last_sender_name ? c.last_sender_name + ' : ' : '';
    const what = c.last_kind === 'media' ? '📎 Média' : c.last_kind === 'poll' ? '📊 Sondage : ' + c.last_body : c.last_kind === 'todo' ? '✅ Liste : ' + c.last_body : c.last_body;
    return who + what;
  }
  function drawList() {
    const all = Piaf.withAssistant ? Piaf.withAssistant(S.convs) : S.convs;   // Talk2Piaf figure dans la liste comme une discussion
    const unreadOf = (arr) => arr.reduce((n, c) => n + (c.unread || 0), 0);
    const inbox = all.filter((c) => !c.archived), fav = all.filter((c) => c.favorite && !c.archived), arch = all.filter((c) => c.archived);
    tabsEl.replaceChildren(...[['chats', 'Discussions', unreadOf(inbox)], ['fav', 'Favoris', 0], ['arch', 'Archivées', 0]].map(([k, l, n]) =>
      h('button', { role: 'tab', type: 'button', class: 'tab' + (tab === k ? ' on' : ''), 'aria-selected': String(tab === k), onclick: () => { tab = k; drawList(); } }, l, n ? h('span', { class: 'badge' }, n > 99 ? '99+' : n) : null)));
    let rows = tab === 'chats' ? inbox : tab === 'fav' ? fav : arch;
    if (filter) rows = rows.filter((c) => (Piaf.convName(c) + ' ' + (c.other_public_id || '')).toLowerCase().includes(filter) || preview(c).toLowerCase().includes(filter));
    if (!S.convsLoaded && !loadErr) { list.replaceChildren(...Array.from({ length: 5 }, () => h('div', { class: 'conv skeleton' }, h('span', { class: 'avatar sk' }), h('div', { class: 'conv-main' }, h('span', { class: 'sk-line w60' }), h('span', { class: 'sk-line w90' }))))); return; }
    if (loadErr && !all.length) { list.replaceChildren(h('div', { class: 'empty' }, h('p', null, 'Impossible de charger vos discussions.'), h('button', { class: 'btn', onclick: () => refresh() }, 'Réessayer'))); return; }
    if (!rows.length) {
      const msg = filter ? ['Aucun résultat', 'Essayez un autre nom ou identifiant.'] : tab === 'fav' ? ['Aucun favori', 'Ouvrez une discussion puis choisissez « Mettre en favori ».'] :
        tab === 'arch' ? ['Aucune discussion archivée', 'Les discussions archivées réapparaissent à la réception d’un nouveau message.'] :
        ['Aucune discussion pour l’instant', 'Retrouvez quelqu’un grâce à son identifiant à 8 chiffres, ou partagez le vôtre.'];
      list.replaceChildren(h('div', { class: 'empty' }, icon('bubble', 44), h('h2', null, msg[0]), h('p', { class: 'muted' }, msg[1]),
        tab === 'chats' && !filter ? h('button', { class: 'btn primary', onclick: () => Piaf.go('#/new') }, 'Démarrer une discussion') : null)); return;
    }
    list.replaceChildren(...rows.map((c) => h('div', { class: 'conv' + (c.unread ? ' unread' : ''), role: 'listitem' },
      h('button', { class: 'conv-open', type: 'button', onclick: () => Piaf.go(c.assistant ? '#/talk2piaf' : '#/c/' + c.conversation_id), 'aria-label': `${Piaf.convName(c)}${c.unread ? `, ${c.unread} non lus` : ''}` },
        c.assistant ? Piaf.assistantAvatar(44) : avatar(Piaf.convName(c), 44, c.other_id, c.avatar_path, c.kind === 'group'),
        h('span', { class: 'conv-main' },
          h('span', { class: 'conv-top' }, h('span', { class: 'conv-name' }, Piaf.convName(c), c.assistant ? h('span', { class: 'tag' }, 'Assistant') : null), h('span', { class: 'conv-time' }, fmt.listTime(c.last_at))),
          h('span', { class: 'conv-bot' }, h('span', { class: 'conv-prev' }, preview(c)),
            c.muted ? icon('mute', 16) : null, c.favorite ? icon('star', 16) : null,
            c.unread && S.mentions && S.mentions[c.conversation_id] ? h('span', { class: 'badge at', title: 'Vous avez été mentionné(e)', 'aria-label': 'Mention non lue' }, '@') : null,
            c.unread ? h('span', { class: 'badge' }, c.unread > 99 ? '99+' : c.unread) : null))),
      iconBtn('dots', 'Options de la discussion', () => Piaf.convMenu(c)))));
  }
  async function refresh() { try { loadErr = false; await Piaf.refreshConvs(); } catch { loadErr = true; drawList(); } }
  const unsubs = [bus.on('convs', drawList), bus.on('resync', refresh), bus.on('visible', refresh)];
  const el = h('div', { class: 'screen home' },
    h('header', { class: 'topbar' }, h('h1', { class: 'logo' }, 'Piaf'), iconBtn('sliders', 'Profil et paramètres', () => Piaf.go('#/settings'))),
    h('div', { class: 'searchbar' }, icon('search', 18), search), tabsEl, list, fab);
  drawList();
  return { el, mounted() { refresh(); }, destroy() { unsubs.forEach((u) => u()); } };
};

// ============================================================ nouvelle discussion
Piaf.views.new = () => {
  let timer = null, seq = 0;
  const results = h('div', { class: 'results', role: 'list' });
  const hint = h('p', { class: 'muted center' }, 'Saisissez l’identifiant exact à 8 chiffres de la personne.');
  async function start(publicId) {
    try { const id = await api.rpc('start_conversation', { p_public_id: publicId }); await Piaf.refreshConvs(); Piaf.go('#/c/' + id); }
    catch (e) { toast(toCode(e) === 'not_found' ? 'Aucune personne avec cet identifiant.' : errText(e), { error: true }); }
  }
  const input = h('input', { type: 'search', inputmode: 'numeric', placeholder: 'Identifiant à 8 chiffres', 'aria-label': 'Identifiant à 8 chiffres', autocomplete: 'off',
    onkeydown: (e) => { const d = input.value.replace(/\s/g, ''); if (e.key === 'Enter' && /^[1-9][0-9]{7}$/.test(d)) start(d); },
    oninput: () => { clearTimeout(timer); timer = setTimeout(run, 300); } });
  async function run() {
    const mine = ++seq; let v = input.value.trim(); if (/^[0-9 ]+$/.test(v)) v = v.replace(/\s/g, '');
    if (!/^[1-9][0-9]{7}$/.test(v)) { results.replaceChildren(hint); return; }
    results.replaceChildren(h('p', { class: 'muted center' }, 'Recherche…'));
    try {
      const rows = await api.rpc('find_user', { p_query: v }); if (mine !== seq) return;
      results.replaceChildren(...(rows.length ? rows.map((u) => h('button', { class: 'conv-open result', type: 'button', onclick: () => start(u.public_id) },
        avatar(u.display_name, 44, u.id), h('span', { class: 'conv-main' }, h('span', { class: 'conv-name' }, u.display_name), h('span', { class: 'muted small' }, 'Identifiant ' + fmt.id8(u.public_id))))) :
        [h('p', { class: 'muted center' }, 'Aucune personne avec cet identifiant.')]));
    } catch (e) { if (mine === seq) results.replaceChildren(h('p', { class: 'form-error center' }, errText(e))); }
  }
  results.append(hint);
  const el = h('div', { class: 'screen' },
    h('header', { class: 'topbar' }, iconBtn('back', 'Retour', () => Piaf.back('#/')), h('h1', null, 'Nouvelle discussion')),
    h('div', { class: 'searchbar' }, icon('search', 18), input),
    h('button', { class: 'btn group-new', type: 'button', onclick: () => Piaf.go('#/g/new') }, icon('users', 18), ' Nouveau groupe'), results,
    h('div', { class: 'me-id' }, h('span', { class: 'muted small' }, 'Votre identifiant'), h('strong', null, fmt.id8(S.me.public_id)), h('button', { class: 'link-btn', type: 'button', onclick: () => copyText(S.me.public_id) }, 'Copier')));
  return { el, mounted() { input.focus(); } };
};

// ============================================================ paramètres
Piaf.views.settings = () => {
  const body = h('div', { class: 'settings-body' });
  const section = (title, ...kids) => h('section', { class: 'card' }, h('h2', null, title), ...kids);
  const row = (label, sub, control) => h('div', { class: 'row' }, h('div', { class: 'row-text' }, h('strong', null, label), sub ? h('span', { class: 'muted small' }, sub) : null), control);
  const toggle = (on, onChange, label) => { const b = h('button', { type: 'button', class: 'switch' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(on), 'aria-label': label, onclick: async () => {
    const next = b.getAttribute('aria-checked') !== 'true'; b.disabled = true; const ok = await onChange(next); b.disabled = false;
    const v = ok === undefined ? next : ok; b.setAttribute('aria-checked', String(v)); b.classList.toggle('on', v); } }, h('span')); return b; };
  async function saveSetting(patch) { await api.q(sb.from('user_settings').update(patch).eq('user_id', myId())); Object.assign(S.settings, patch); }

  function photoMenu() {
    const pick = () => { const f = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' }, onchange: async () => {
      const file = f.files[0]; f.remove(); if (!file) return;
      try { const blob = await Piaf.cropPhoto(file, true); if (!blob) return; toast('Envoi de la photo…'); await Piaf.setAvatar(blob); toast('Photo mise à jour'); draw(); } catch (e) { toast(errText(e), { error: true }); } } });
      document.body.append(f); f.click(); };
    sheet('Photo de profil', [{ icon: 'camera', label: 'Choisir une photo', onClick: pick },
      S.me.avatar_path ? { icon: 'trash', label: 'Supprimer la photo', danger: true, onClick: async () => { try { await Piaf.setAvatar(null); toast('Photo supprimée'); draw(); } catch (e) { toast(errText(e), { error: true }); } } } : null]);
  }
  async function draw() {
    const theme = store.get('piaf-theme', 'auto');
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    let blocked = []; try { blocked = await api.rpc('list_blocked'); } catch { /* hors ligne */ }
    body.replaceChildren(
      section('Profil', h('div', { class: 'profile-head' }, h('button', { class: 'avatar-edit', type: 'button', 'aria-label': 'Modifier la photo de profil', onclick: () => photoMenu() }, avatar(S.me.display_name, 64, S.me.id), h('span', { class: 'avatar-badge' }, icon('camera', 14))), h('div', null, h('strong', { class: 'big' }, S.me.display_name), h('div', { class: 'muted' }, 'Identifiant ' + fmt.id8(S.me.public_id)))),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', type: 'button', onclick: () => copyText(S.me.public_id) }, icon('copy', 18), ' Copier l’identifiant'),
          h('button', { class: 'btn', type: 'button', onclick: async () => { const v = await promptDialog('Nom d’affichage', 'Nom visible par vos contacts', S.me.display_name); if (v === null) return;
            try { await api.rpc('update_display_name', { p_name: v }); S.me.display_name = v.trim(); toast('Nom mis à jour'); draw(); } catch (e) { toast(errText(e), { error: true }); } } }, icon('edit', 18), ' Modifier le nom'))),
      section('Confidentialité',
        row('Confirmations de lecture', 'Si vous les désactivez, les autres ne voient plus quand vous lisez leurs messages, et vous ne voyez plus les leurs. « Distribué » reste affiché.',
          toggle(S.settings.read_receipts, async (v) => { try { await saveSetting({ read_receipts: v }); } catch (e) { toast(errText(e), { error: true }); return !v; } }, 'Confirmations de lecture'))),
      section('Notifications',
        row('Prévenir des nouveaux messages', perm === 'denied' ? 'Bloquées dans les réglages du navigateur : autorisez-les pour ce site.' : perm === 'unsupported' ? 'Non disponibles sur ce navigateur.' : 'Alertes tant que l’application est ouverte ou en arrière-plan. Pas encore d’alerte lorsque l’application est totalement fermée.',
          toggle(S.settings.notifications && perm === 'granted', async (v) => {
            if (!v) { try { await saveSetting({ notifications: false }); } catch (e) { toast(errText(e), { error: true }); return true; } return false; }
            if (perm === 'unsupported') { toast('Notifications non disponibles sur ce navigateur.', { error: true }); return false; }
            if (!(await confirmDialog('Activer les notifications ?', 'Piaf vous prévient d’un nouveau message avec le nom de la personne et un aperçu. Votre navigateur va demander l’autorisation.', 'Continuer'))) return false;
            const r = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
            if (r !== 'granted') { toast('Autorisation refusée. Vous pouvez la modifier dans les réglages du navigateur.', { error: true }); draw(); return false; }
            try { await saveSetting({ notifications: true }); } catch (e) { toast(errText(e), { error: true }); return false; } return true;
          }, 'Notifications')),
        h('p', { class: 'muted small' }, 'Sur iPhone, les notifications exigent d’installer l’application sur l’écran d’accueil (iOS 16.4 ou plus). Silence par conversation : menu de chaque discussion.')),
      section('Apparence', h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Thème' }, [['auto', 'Automatique'], ['light', 'Clair'], ['dark', 'Sombre']].map(([k, l]) =>
        h('button', { type: 'button', role: 'radio', 'aria-checked': String(theme === k), class: theme === k ? 'on' : '', onclick: () => { store.set('piaf-theme', k); Piaf.applyTheme(); draw(); } }, l)))),
      section('Contacts bloqués', blocked.length ? blocked.map((b) => h('div', { class: 'row' }, h('div', { class: 'row-text' }, h('strong', null, b.display_name), h('span', { class: 'muted small' }, 'Identifiant ' + fmt.id8(b.public_id))),
        h('button', { class: 'btn', type: 'button', onclick: async () => { try { await api.rpc('unblock_user', { p_target: b.user_id }); await Piaf.refreshConvs(); toast('Contact débloqué'); draw(); } catch (e) { toast(errText(e), { error: true }); } } }, 'Débloquer'))) :
        h('p', { class: 'muted' }, 'Aucun contact bloqué. Une personne bloquée ne peut plus vous écrire, et vous ne pouvez plus lui écrire tant que le blocage dure.')),
      section('Sécurité',
        h('p', { class: 'muted small' }, 'Cette application garde votre session ouverte sur cet appareil. En cas de perte de la session ET du code secret, le compte est irrécupérable : aucune récupération par e-mail ou téléphone.'),
        h('button', { class: 'btn', type: 'button', onclick: async () => { if (await confirmDialog('Révoquer les autres sessions ?', 'Tous les autres appareils connectés à votre compte seront déconnectés. Cet appareil reste connecté.', 'Révoquer', true)) {
          const { error } = await Piaf.auth.revokeOthers(); toast(error ? 'Échec de la révocation. Réessayez.' : 'Les autres sessions ont été révoquées.', { error: !!error }); } } }, 'Révoquer les autres sessions')),
      section('Application',
        Piaf.installEvt ? h('button', { class: 'btn', type: 'button', onclick: async () => { Piaf.installEvt.prompt(); await Piaf.installEvt.userChoice; Piaf.installEvt = null; draw(); } }, 'Installer sur l’écran d’accueil') :
          h('p', { class: 'muted small' }, 'Pour installer : sur iPhone, Partager puis « Sur l’écran d’accueil » ; sur Android, menu ⋮ puis « Installer l’application ».'),
        h('p', { class: 'small' }, h('a', { href: 'privacy.html' }, 'Confidentialité et données conservées'))),
      section('Zone sensible', h('p', { class: 'muted small' }, 'Supprimer votre compte efface votre profil, vos conversations (pour les deux personnes) et tous les fichiers envoyés. C’est définitif.'),
        h('button', { class: 'btn danger', type: 'button', onclick: deleteAccount }, 'Supprimer mon compte')));
  }
  async function deleteAccount() {
    if (!(await confirmDialog('Supprimer définitivement le compte ?', 'Vos messages, vos médias et les conversations avec vos contacts seront effacés pour tout le monde. Impossible à annuler.', 'Continuer', true))) return;
    const pw = await promptDialog('Confirmer avec votre code secret', 'Code secret', '', { type: 'password', max: 64 }); if (!pw) return;
    try { await Piaf.auth.deleteAccount(pw); S.me = null; toast('Compte supprimé.'); Piaf.render(); } catch (e) { toast(errText(e), { error: true }); }
  }
  const el = h('div', { class: 'screen' }, h('header', { class: 'topbar' }, iconBtn('back', 'Retour', () => Piaf.back('#/')), h('h1', null, 'Paramètres')), body);
  draw();
  const un = bus.on('install', draw);
  return { el, destroy: un };
};

// ============================================================ messages entrants : liste, accusé « distribué », notification
let deliverTimer = null;
bus.on('msg', async (p) => {
  const row = p.new; if (!S.me || p.eventType !== 'INSERT' || !row || row.sender_id === S.me.id) { Piaf.refreshConvs?.(); return; }
  clearTimeout(deliverTimer); deliverTimer = setTimeout(() => api.rpc('mark_delivered_all').catch(() => {}), 400);
  try { await Piaf.refreshConvs(); } catch { return; }
  const c = Piaf.conv(row.conversation_id); const mentioned = !!c && c.kind === 'group' && Piaf.mentionsMe?.(row.body); if (!c || (c.muted && !mentioned) || row.deleted_at) return;
  const viewing = !document.hidden && S.route.name === 'chat' && S.route.id === row.conversation_id;
  if (viewing) return;
  Piaf.notify(Piaf.convName(c), row.kind === 'media' ? '📎 Média' : ((mentioned ? '@ Vous êtes mentionné·e : ' : '') + (row.body || 'Nouveau message')), '#/c/' + row.conversation_id, row.conversation_id);
});
bus.on('conv', () => Piaf.refreshConvs?.());
bus.on('member', () => Piaf.refreshConvs?.());
})();
