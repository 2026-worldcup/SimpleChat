/* Piaf — groupes : création, ajout de membres, infos du groupe. */
(() => {
'use strict';
const { h, icon, iconBtn, S, bus, api, fmt, avatar, toast, sheet, confirmDialog, promptDialog, copyText, errText, toCode } = Piaf;
const maxMembers = () => S.cfg.group_max_members || 32;

// ------------------------------------------------------------ sélection de personnes (création et ajout)
// On ne peut ajouter que des personnes avec qui on partage déjà une discussion ou un groupe (règle appliquée aussi par le serveur).
function picker(route, adding) {
  const convId = route.id;
  let contacts = [], taken = new Set(), filter = '', busy = false, failed = false, loaded = false;
  const sel = new Set();
  const room = () => (adding ? maxMembers() - (Piaf.conv(convId)?.members || taken.size) : maxMembers() - 1);
  const list = h('div', { class: 'pick-list', role: 'group', 'aria-label': 'Personnes' });
  const count = h('span', { class: 'muted small' });
  const titleIn = adding ? null : h('input', { type: 'text', maxlength: '40', placeholder: 'Nom du groupe', 'aria-label': 'Nom du groupe', autocomplete: 'off', oninput: update });
  const search = h('input', { type: 'search', placeholder: 'Rechercher parmi mes contacts', 'aria-label': 'Rechercher parmi mes contacts', autocomplete: 'off', oninput: () => { filter = search.value.trim().toLowerCase(); draw(); } });
  const go = h('button', { class: 'btn primary', type: 'button', disabled: true, onclick: submit }, adding ? 'Ajouter' : 'Créer le groupe');
  function update() {
    count.textContent = sel.size ? `${sel.size} sélectionné${sel.size > 1 ? 's' : ''} · ${room()} place${room() > 1 ? 's' : ''} au maximum` : `${Math.max(0, room())} place${room() > 1 ? 's' : ''} au maximum`;
    go.disabled = busy || !sel.size || (!adding && !titleIn.value.trim());
  }
  const row = (u) => {
    const on = sel.has(u.user_id);
    return h('button', { class: 'pick' + (on ? ' on' : ''), type: 'button', role: 'checkbox', 'aria-checked': String(on), onclick: () => {
      if (sel.has(u.user_id)) sel.delete(u.user_id);
      else if (sel.size >= room()) { toast(`Un groupe est limité à ${maxMembers()} personnes.`, { error: true }); return; }
      else sel.add(u.user_id);
      draw(); } },
    avatar(u.display_name, 42, u.user_id),
    h('span', { class: 'conv-main' }, h('span', { class: 'conv-name' }, u.display_name),
      h('span', { class: 'muted small' }, u.groups.length ? 'Dans : ' + u.groups.slice(0, 3).join(', ') + (u.groups.length > 3 ? '…' : '') : 'Identifiant ' + fmt.id8(u.public_id))),
    h('span', { class: 'check' }, on ? icon('check2', 18) : null));
  };
  function draw() {
    update();
    if (!loaded) { list.replaceChildren(h('div', { class: 'spinner', role: 'status', 'aria-label': 'Chargement' })); return; }
    if (failed) { list.replaceChildren(h('div', { class: 'empty' }, h('p', null, 'Impossible de charger vos contacts.'), h('button', { class: 'btn', type: 'button', onclick: load }, 'Réessayer'))); return; }
    const avail = contacts.filter((u) => !taken.has(u.user_id));
    const ok = avail.filter((u) => !filter || (u.display_name + ' ' + u.public_id).toLowerCase().includes(filter));
    if (!avail.length) {
      list.replaceChildren(h('div', { class: 'empty' }, icon('users', 44), h('h2', null, 'Aucun contact disponible'),
        h('p', { class: 'muted' }, adding ? 'Toutes les personnes avec qui vous échangez sont déjà dans ce groupe.' : 'Démarrez d’abord une discussion avec les personnes à inviter, grâce à leur identifiant à 8 chiffres.'),
        adding ? null : h('button', { class: 'btn primary', type: 'button', onclick: () => Piaf.go('#/new') }, 'Démarrer une discussion'))); return;
    }
    if (!ok.length) { list.replaceChildren(h('p', { class: 'muted center pad' }, 'Aucun résultat.')); return; }
    const direct = ok.filter((u) => u.direct), other = ok.filter((u) => !u.direct);
    list.replaceChildren(...(direct.length ? [h('h3', { class: 'pick-h' }, 'Mes discussions'), ...direct.map(row)] : []),
      ...(other.length ? [h('h3', { class: 'pick-h' }, 'Membres de mes groupes'), ...other.map(row)] : []));
  }
  async function load() {
    loaded = false; failed = false; draw();
    try {
      const [rows, mem] = await Promise.all([api.rpc('my_contacts'), adding ? api.rpc('group_members', { p_conv: convId }) : []]);
      contacts = rows; taken = new Set(mem.map((m) => m.user_id)); rows.forEach((r) => { if (r.avatar_path) S.avatars[r.user_id] = r.avatar_path; });
    } catch { failed = true; }
    loaded = true; draw();
  }
  async function submit() {
    busy = true; update();
    try {
      if (adding) { await api.rpc('group_add_members', { p_conv: convId, p_members: [...sel] }); await Piaf.refreshConvs(); toast('Membres ajoutés'); Piaf.back('#/g/' + convId); }
      else { const id = await api.rpc('create_group', { p_title: titleIn.value.trim(), p_members: [...sel] }); await Piaf.refreshConvs(); Piaf.go('#/c/' + id); }
    } catch (e) { toast(errText(e), { error: true }); busy = false; update(); }
  }
  const el = h('div', { class: 'screen' },
    h('header', { class: 'topbar' }, iconBtn('back', 'Retour', () => Piaf.back(adding ? '#/g/' + convId : '#/')), h('h1', null, adding ? 'Ajouter des membres' : 'Nouveau groupe')),
    titleIn ? h('label', { class: 'field pad' }, h('span', null, 'Nom du groupe'), titleIn) : null,
    h('div', { class: 'searchbar' }, icon('search', 18), search),
    h('div', { class: 'pad pick-count' }, count),
    h('div', { class: 'scroll' }, list),
    h('div', { class: 'pick-foot' }, go));
  return { el, mounted() { load(); titleIn?.focus(); } };
}
Piaf.views.groupnew = (r) => picker(r, false);
Piaf.views.groupadd = (r) => picker(r, true);

// ------------------------------------------------------------ infos du groupe
Piaf.views.group = (route) => {
  const convId = route.id;
  let rows = [], blocked = new Set(), err = false, destroyed = false;
  const conv = () => Piaf.conv(convId);
  const admin = () => conv()?.my_role === 'admin';
  const creator = () => conv()?.created_by === S.me.id;
  const body = h('div', { class: 'settings-body' });
  const act = (fn, ok) => async () => { try { await fn(); if (ok) toast(ok); await Piaf.refreshConvs(); await load(); } catch (e) { toast(errText(e), { error: true }); } };

  async function load() {
    try {
      const [m, b] = await Promise.all([api.rpc('group_members', { p_conv: convId }), api.rpc('list_blocked').catch(() => [])]);
      if (destroyed) return; rows = m; blocked = new Set(b.map((x) => x.user_id)); err = false; rows.forEach((r) => { if (r.avatar_path) S.avatars[r.user_id] = r.avatar_path; });
    } catch { err = true; }
    draw();
  }
  function photoMenu() {
    const pick = () => { const f = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' }, onchange: async () => {
      const file = f.files[0]; f.remove(); if (!file) return;
      try { toast('Envoi de la photo…'); await Piaf.setGroupAvatar(convId, file); toast('Photo du groupe mise à jour'); } catch (e) { toast(errText(e), { error: true }); } } });
      document.body.append(f); f.click(); };
    sheet('Photo du groupe', [{ icon: 'camera', label: 'Choisir une photo', onClick: pick },
      conv()?.avatar_path ? { icon: 'trash', label: 'Supprimer la photo', danger: true, onClick: async () => { try { await Piaf.setGroupAvatar(convId, null); toast('Photo supprimée'); } catch (e) { toast(errText(e), { error: true }); } } } : null]);
  }
  async function rename() {
    const v = await promptDialog('Renommer le groupe', 'Nom du groupe', conv().other_name); if (v === null || !v.trim() || v.trim() === conv().other_name) return;
    act(() => api.rpc('group_rename', { p_conv: convId, p_title: v.trim() }), 'Groupe renommé')();
  }
  function reportUser(r) {
    const reasons = [['spam', 'Spam ou publicité'], ['harcelement', 'Harcèlement ou menaces'], ['contenu_inapproprie', 'Contenu inapproprié'], ['usurpation', 'Usurpation d’identité'], ['autre', 'Autre motif']];
    sheet('Signaler cette personne', reasons.map(([k, l]) => ({ label: l, onClick: async () => {
      if (!(await confirmDialog('Envoyer le signalement ?', 'Votre motif sera transmis à l’éditeur du service pour examen. Aucun message n’est transmis.', 'Signaler'))) return;
      try { await api.rpc('report_content', { p_target: r.user_id, p_message: null, p_reason: k, p_details: null }); toast('Signalement envoyé. Merci.'); } catch (e) { toast(errText(e), { error: true }); } } })));
  }
  function memberSheet(r) {
    const isBlocked = blocked.has(r.user_id), cr = creator();
    sheet(r.display_name, [
      { icon: 'bubble', label: 'Écrire en privé', onClick: async () => { try { const id = await api.rpc('start_conversation', { p_public_id: r.public_id }); await Piaf.refreshConvs(); Piaf.go('#/c/' + id); } catch (e) { toast(errText(e), { error: true }); } } },
      { icon: 'copy', label: 'Copier l’identifiant ' + fmt.id8(r.public_id), onClick: () => copyText(r.public_id) },
      admin() && r.role !== 'admin' ? { icon: 'user', label: 'Nommer administrateur', onClick: act(() => api.rpc('group_set_admin', { p_conv: convId, p_user: r.user_id, p_admin: true }), 'Nouvel administrateur') } : null,
      admin() && r.role === 'admin' && cr ? { icon: 'user', label: 'Retirer le rôle d’administrateur', onClick: act(() => api.rpc('group_set_admin', { p_conv: convId, p_user: r.user_id, p_admin: false }), 'Rôle retiré') } : null,
      { sep: true },
      isBlocked ? { icon: 'ban', label: 'Débloquer', onClick: act(() => api.rpc('unblock_user', { p_target: r.user_id }), 'Personne débloquée') }
        : { icon: 'ban', danger: true, label: 'Bloquer', onClick: async () => {
            if (!(await confirmDialog('Bloquer cette personne ?', 'Ses messages seront masqués pour vous dans les groupes et vous ne pourrez plus échanger en privé avec elle. Ses fichiers restent visibles dans la galerie. Elle n’est pas prévenue.', 'Bloquer', true))) return;
            act(() => api.rpc('block_user', { p_target: r.user_id }), 'Personne bloquée')(); } },
      { icon: 'flag', danger: true, label: 'Signaler cette personne', onClick: () => reportUser(r) },
      admin() && (r.role !== 'admin' || cr) ? { icon: 'trash', danger: true, label: 'Retirer du groupe', onClick: async () => {
        if (!(await confirmDialog('Retirer ' + r.display_name + ' ?', 'Cette personne perd l’accès aux messages et aux fichiers du groupe.', 'Retirer', true))) return;
        act(() => api.rpc('group_remove_member', { p_conv: convId, p_user: r.user_id }), 'Membre retiré')(); } } : null,
    ]);
  }
  async function leave() {
    if (!(await confirmDialog('Quitter le groupe ?', 'Vous ne recevrez plus les messages et perdrez l’accès aux fichiers du groupe. Vos messages restent visibles pour les autres membres.', 'Quitter', true))) return;
    try { await api.rpc('leave_group', { p_conv: convId }); await Piaf.refreshConvs(); toast('Vous avez quitté le groupe'); Piaf.go('#/'); } catch (e) { toast(errText(e), { error: true }); }
  }
  async function destroyGroup() {
    if (!(await confirmDialog('Supprimer le groupe ?', 'Vous êtes la seule personne restante : tous les messages et fichiers seront effacés définitivement.', 'Supprimer', true))) return;
    try { await api.media({ action: 'delete_group', id: convId }); await Piaf.refreshConvs(); toast('Groupe supprimé'); Piaf.go('#/'); } catch (e) { toast(errText(e), { error: true }); }
  }
  function draw() {
    const c = conv();
    if (err && !rows.length) { body.replaceChildren(h('div', { class: 'empty' }, h('p', null, 'Impossible de charger le groupe.'), h('button', { class: 'btn', type: 'button', onclick: load }, 'Réessayer'))); return; }
    if (!c) { body.replaceChildren(h('div', { class: 'empty' }, h('h2', null, 'Groupe introuvable'), h('button', { class: 'btn primary', type: 'button', onclick: () => Piaf.go('#/') }, 'Retour'))); return; }
    const full = rows.length >= maxMembers();
    body.replaceChildren(
      h('section', { class: 'card group-head' },
        admin() ? h('button', { class: 'avatar-edit', type: 'button', 'aria-label': 'Modifier la photo du groupe', onclick: photoMenu }, avatar(c.other_name, 88, null, c.avatar_path), h('span', { class: 'avatar-badge' }, icon('camera', 14)))
          : avatar(c.other_name, 88, null, c.avatar_path),
        h('strong', { class: 'big' }, c.other_name), h('span', { class: 'muted' }, `Groupe · ${rows.length} membre${rows.length > 1 ? 's' : ''}`),
        admin() ? h('button', { class: 'btn', type: 'button', onclick: rename }, icon('edit', 18), ' Renommer le groupe') : null),
      h('section', { class: 'card' },
        admin() ? h('button', { class: 'sheet-item', type: 'button', disabled: full, onclick: () => Piaf.go('#/g/' + convId + '/add') }, icon('users', 20), h('span', null, full ? `Groupe complet (${maxMembers()} personnes)` : 'Ajouter des membres')) : null,
        h('button', { class: 'sheet-item', type: 'button', onclick: () => Piaf.go('#/m/' + convId) }, icon('image', 20), h('span', null, 'Médias partagés')),
        h('button', { class: 'sheet-item', type: 'button', onclick: () => Piaf.convMenu(c, { afterArchive: () => Piaf.go('#/') }) }, icon('sliders', 20), h('span', null, 'Favori, archive, silence, renommer pour moi…'))),
      h('section', { class: 'card' }, h('h2', null, `Membres (${rows.length})`),
        h('div', { class: 'members' }, rows.map((r) => h('button', { class: 'member', type: 'button', disabled: r.is_me, onclick: () => memberSheet(r) },
          avatar(r.display_name, 40, r.user_id),
          h('span', { class: 'conv-main' }, h('span', { class: 'conv-name' }, r.display_name + (r.is_me ? ' (vous)' : '')), h('span', { class: 'muted small' }, 'Identifiant ' + fmt.id8(r.public_id))),
          r.role === 'admin' ? h('span', { class: 'badge soft' }, c.created_by === r.user_id ? 'Créateur' : 'Admin') : null,
          blocked.has(r.user_id) ? h('span', { class: 'muted small' }, 'Bloqué') : null)))),
      h('section', { class: 'card' },
        rows.length <= 1 ? h('button', { class: 'sheet-item danger', type: 'button', onclick: destroyGroup }, icon('trash', 20), h('span', null, 'Supprimer le groupe'))
          : h('button', { class: 'sheet-item danger', type: 'button', onclick: leave }, icon('x', 20), h('span', null, 'Quitter le groupe'))));
  }
  const unsubs = [bus.on('convs', draw), bus.on('member', load)];
  const el = h('div', { class: 'screen' }, h('header', { class: 'topbar' }, iconBtn('back', 'Retour à la discussion', () => Piaf.back('#/c/' + convId)), h('h1', null, 'Infos du groupe')), body);
  return { el, mounted() { draw(); load(); }, destroy() { destroyed = true; unsubs.forEach((u) => u()); } };
};
})();
