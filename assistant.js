/* Talk2Piaf — assistant intégré à Piaf.
   Le moteur de réponse (assistant-kb.js) tourne sur l'appareil : rien de ce qui est écrit ici n'est envoyé à un serveur.
   Les boutons d'action exécutent de vraies opérations de l'application (ouvrir un écran, démarrer une discussion,
   envoyer un message, favori, archive, silence, thème, notifications, photo, nom, sessions…) et ne s'exécutent que sur appui. */
(() => {
  'use strict';
  const P = window.Piaf, KB = window.T2P;
  if (!P || !KB) return;
  const { h, S, api, sb, toast, errText, toCode, copyText, confirmDialog, promptDialog, store } = P;

  // Accès depuis l'écran d'accueil : true = bouton affiché, false = bouton masqué.
  const SHOW_BUTTON = true;
  const OLD_KEYS = ['piaf-talk2piaf-history-v2'];
  const keyFor = () => 'piaf-talk2piaf-v3-' + (S.me ? S.me.id : 'anon');
  const MAX_MSGS = 60;

  OLD_KEYS.forEach((k) => { try { localStorage.removeItem(k); } catch { /* */ } });

  const css = `
    #talk2piaf-fab{display:${SHOW_BUTTON ? 'inline-flex' : 'none'};align-items:center;justify-content:center;width:42px;height:42px;border:0;border-radius:50%;background:linear-gradient(135deg,#292622 0%,#5d554e 100%);color:#fff;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.14)}
    #talk2piaf-fab svg{width:23px;height:23px}
    #layers{z-index:10001!important}#toasts{z-index:10002!important}
    #talk2piaf{position:fixed;left:0;right:0;top:var(--app-top,0px);height:var(--app-h,100dvh);z-index:10000;background:rgba(20,10,3,.45);display:flex;align-items:flex-end;justify-content:center}
    .t2p-panel{width:min(720px,100%);height:min(780px,100%);background:var(--bg,#fbf7f2);color:var(--ink,#1d1712);border-radius:22px 22px 0 0;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 -10px 45px rgba(0,0,0,.22);animation:t2pIn .2s ease-out}
    @keyframes t2pIn{from{transform:translateY(24px);opacity:.4}to{transform:none;opacity:1}}
    .t2p-head{display:flex;align-items:center;gap:12px;padding:12px 8px 12px 16px;border-bottom:1px solid var(--line,#e6dccf);background:var(--surface,#fff)}
    .t2p-logo{width:42px;height:42px;border-radius:13px;display:block;flex:none}
    .t2p-title{min-width:0;flex:1}.t2p-title strong{display:block;font-size:16px}.t2p-title span{display:block;margin-top:1px;font-size:12px;color:var(--muted,#6f6256)}
    .t2p-hbtn{border:0;background:transparent;width:42px;height:42px;border-radius:50%;color:var(--muted,#6f6256);cursor:pointer;display:grid;place-items:center}.t2p-hbtn:hover{background:var(--surface2,#f3ece4)}.t2p-hbtn svg{width:21px;height:21px}
    .t2p-body{flex:1;overflow:auto;padding:18px 14px 8px;display:flex;flex-direction:column;gap:12px;overscroll-behavior:contain}
    .t2p-empty{margin:auto;text-align:center;max-width:420px;color:var(--muted,#6f6256);padding:8px 0}.t2p-empty img{width:76px;height:76px;border-radius:22px}.t2p-empty h2{margin:12px 0 6px;color:var(--ink,#1d1712);font-size:22px}.t2p-empty p{margin:0 0 14px;line-height:1.5}
    .t2p-row{display:flex;flex-direction:column;gap:7px;max-width:min(88%,600px)}.t2p-row.u{align-self:flex-end;align-items:flex-end}.t2p-row.a{align-self:flex-start;align-items:flex-start}
    .t2p-bubble{padding:10px 14px;border-radius:18px;line-height:1.48;font-size:15px;white-space:pre-wrap;overflow-wrap:anywhere}
    .t2p-row.u .t2p-bubble{background:var(--accent,#c2410c);color:var(--accent-ink,#fff);border-bottom-right-radius:6px}
    .t2p-row.a .t2p-bubble{background:var(--surface,#fff);border:1px solid var(--line,#e6dccf);border-bottom-left-radius:6px}
    .t2p-bubble.busy{color:var(--muted,#6f6256)}.t2p-dots{display:inline-flex;gap:4px;vertical-align:middle}.t2p-dots i{width:6px;height:6px;border-radius:50%;background:currentColor;animation:t2pDot 1s infinite}.t2p-dots i:nth-child(2){animation-delay:.14s}.t2p-dots i:nth-child(3){animation-delay:.28s}@keyframes t2pDot{0%,70%,100%{opacity:.25;transform:translateY(0)}35%{opacity:1;transform:translateY(-2px)}}
    .t2p-acts,.t2p-links,.t2p-chips{display:flex;flex-wrap:wrap;gap:7px}
    .t2p-act{min-height:40px;padding:0 15px;border-radius:12px;border:0;background:var(--accent,#c2410c);color:var(--accent-ink,#fff);font:inherit;font-weight:600;font-size:14px;cursor:pointer;text-align:left}
    .t2p-act:disabled{opacity:.55;cursor:default}.t2p-act.done{background:var(--ok,#1f7a4d);color:#fff;opacity:1}.t2p-act.done::before{content:'✓ '}
    .t2p-link{display:inline-flex;align-items:center;min-height:38px;padding:0 13px;border-radius:12px;border:1px solid var(--accent,#c2410c);color:var(--accent,#c2410c);background:transparent;text-decoration:none;font-weight:600;font-size:14px}.t2p-link::after{content:' ↗';margin-left:4px}
    .t2p-chip{min-height:36px;padding:0 13px;border-radius:18px;border:1px solid var(--line,#e6dccf);background:var(--surface,#fff);color:var(--ink,#1d1712);font:inherit;font-size:13.5px;cursor:pointer;text-align:left}.t2p-chip:hover{background:var(--accent-soft,#ffe6d3)}
    .t2p-chips.start{justify-content:center}
    .t2p-compose{display:flex;gap:9px;align-items:flex-end;padding:10px 12px max(10px,env(safe-area-inset-bottom));border-top:1px solid var(--line,#e6dccf);background:var(--surface,#fff)}
    .t2p-compose textarea{flex:1;resize:none;min-height:44px;max-height:130px;border:1px solid var(--line,#e6dccf);border-radius:18px;background:var(--bg,#fbf7f2);color:var(--ink,#1d1712);padding:11px 14px;font:inherit;line-height:1.35;outline:none}
    .t2p-compose textarea:focus{border-color:var(--accent,#c2410c)}
    .t2p-send{width:44px;height:44px;border:0;border-radius:50%;background:var(--accent,#c2410c);color:var(--accent-ink,#fff);display:grid;place-items:center;cursor:pointer;flex:none}.t2p-send:disabled{opacity:.45;cursor:default}.t2p-send svg{width:19px}
    .t2p-foot{text-align:center;font-size:11px;color:var(--muted,#6f6256);padding:0 12px 6px;background:var(--surface,#fff)}
    @media(min-width:720px){#talk2piaf{align-items:center;padding:20px}.t2p-panel{height:min(780px,100%);border-radius:22px}}
  `;
  const style = document.createElement('style'); style.textContent = css; document.head.append(style);

  const SVG = (inner, sw = 1.8) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  const ico = {
    bird: SVG('<path d="M20.5 4.5c-5.8-1.7-11.7.1-15.1 4.6-2.1 2.8-1.8 6.3.7 8.4l-2.2 3.1 4.3-1.5c3.9 1.6 8.6.1 10.8-3.4 1.8-2.8 2.2-7.1 1.5-11.2Z"/><path d="M8.2 12.2c1.5-1.1 3.5-2 6.1-2.4"/><circle cx="9" cy="12.7" r=".7" fill="currentColor" stroke="none"/><circle cx="12" cy="11.7" r=".7" fill="currentColor" stroke="none"/><circle cx="15" cy="11.1" r=".7" fill="currentColor" stroke="none"/>'),
    send: SVG('<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>', 1.9),
    trash: SVG('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>'),
    close: SVG('<path d="M18 6L6 18M6 6l12 12"/>', 2),
  };
  const svgEl = (markup) => { const s = document.createElement('span'); s.style.display = 'contents'; s.innerHTML = markup; return s; };   // constantes internes uniquement

  // ---------------------------------------------------------------- historique (par compte, sur l'appareil)
  let history = [];
  const load = () => { try { const v = JSON.parse(localStorage.getItem(keyFor()) || '[]'); history = Array.isArray(v) ? v.filter((m) => m && typeof m.text === 'string').slice(-MAX_MSGS) : []; } catch { history = []; } };
  const save = () => { try { localStorage.setItem(keyFor(), JSON.stringify(history.filter((m) => !m.eph).slice(-MAX_MSGS))); } catch { /* quota / mode privé */ } };
  const mem = { topic: null, offer: null };

  // ---------------------------------------------------------------- contexte fourni au moteur (état réel de l'application)
  const inviteText = () => `Salut ! Je suis sur Piaf, une messagerie privée sans e-mail ni numéro de téléphone. Crée ton compte, puis écris-moi avec mon identifiant : ${S.me.public_id}. L'application : ${location.origin}${location.pathname}`;
  function context() {
    const me = S.me || {};
    return {
      name: me.display_name || '', first: (me.display_name || '').split(/\s+/)[0] || '', pid: me.public_id || '', id8: me.public_id ? P.fmt.id8(me.public_id) : '',
      now: new Date(), settings: S.settings || {}, perm: 'Notification' in window ? Notification.permission : 'unsupported',
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
  const leave = (fn) => { closePanel(); fn(); };
  const openConvAct = (id) => ({ l: 'Ouvrir la discussion', a: 'conv', p: { id } });
  const rnd = (n) => { const a = new Uint32Array(1); let x; do { crypto.getRandomValues(a); x = a[0]; } while (x >= Math.floor(4294967296 / n) * n); return x % n; };

  // Chaque action renvoie { say, eph?, acts?, nodone? } (message de l'assistant), { clear } ou null ; elle lève une erreur à message lisible.
  const ACTIONS = {
    go: (p) => { leave(() => P.go(p.h)); return null; },
    conv: (p) => { if (!convById(p.id)) throw new Error('Cette discussion n’existe plus.'); leave(() => P.go('#/c/' + p.id)); return null; },
    gallery: (p) => { leave(() => P.go('#/m/' + p.id)); return null; },
    group: (p) => { leave(() => P.go('#/g/' + p.id)); return null; },
    privacy: () => { leave(() => location.assign('privacy.html')); return null; },
    async start(p) {
      if (!S.online) throw new Error('Pas de connexion : réessayez quand le réseau revient.');
      let id; try { id = await api.rpc('start_conversation', { p_public_id: p.pid }); } catch (e) { throw new Error(toCode(e) === 'not_found' ? 'Aucune personne ne correspond à cet identifiant.' : errText(e)); }
      await P.refreshConvs(); leave(() => P.go('#/c/' + id)); return null;
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
      try { await P.setAvatar(file); } catch (e) { throw new Error(errText(e)); } return { say: 'Votre photo de profil est mise à jour.' };
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
    forget: () => { history = []; mem.topic = null; mem.offer = null; save(); return { clear: true }; },
    reveal: (p) => ({ say: p.t }),
  };

  // ---------------------------------------------------------------- interface
  let ui = null;
  function closePanel() { if (ui) { ui.root.remove(); document.removeEventListener('keydown', ui.onKey); ui = null; } }

  function inline(text) { // **gras** uniquement ; tout le reste est du texte brut (aucun HTML)
    const out = []; String(text).split(/\*\*(.+?)\*\*/gs).forEach((t, i) => { if (t) out.push(i % 2 ? h('strong', null, t) : document.createTextNode(t)); });
    return out;
  }
  const safeUrl = (u) => { try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null; } catch { return null; } };
  const chip = (c) => h('button', { type: 'button', class: 't2p-chip', onclick: () => ask(c.t) }, c.l);

  function draw() {
    if (!ui) return;
    const body = ui.body; body.replaceChildren();
    if (!history.length) {
      const first = (S.me && S.me.display_name || '').split(/\s+/)[0];
      body.append(h('div', { class: 't2p-empty' }, h('img', { src: 'icons/talk2piaf.svg', alt: '' }), h('h2', null, first ? `Bonjour ${first}, je suis Talk2Piaf.` : 'Bonjour, je suis Talk2Piaf.'),
        h('p', null, 'Posez-moi vos questions sur Piaf ou demandez-moi d’agir : je prépare l’action, vous la lancez d’un appui sur le bouton.'),
        h('div', { class: 't2p-chips start' }, KB.starters().map(chip))));
      return;
    }
    history.forEach((m, i) => {
      const last = i === history.length - 1;
      const row = h('div', { class: 't2p-row ' + (m.role === 'user' ? 'u' : 'a') }, h('div', { class: 't2p-bubble' }, inline(m.text)));
      if (m.role === 'assistant') {
        const links = (m.links || []).map((l) => { const u = safeUrl(l.u); return u ? h('a', { class: 't2p-link', href: u, target: '_blank', rel: 'noopener noreferrer nofollow' }, l.l) : null; }).filter(Boolean);
        if (links.length) row.append(h('div', { class: 't2p-links' }, links));
        if (m.acts && m.acts.length) row.append(h('div', { class: 't2p-acts' }, m.acts.map((a, j) => h('button', { type: 'button', class: 't2p-act' + (a.done ? ' done' : ''), disabled: !!a.done, onclick: (e) => runAct(i, j, e.currentTarget) }, a.l))));
        if (last && m.chips && m.chips.length) row.append(h('div', { class: 't2p-chips' }, m.chips.map(chip)));
      }
      body.append(row);
    });
    body.scrollTop = body.scrollHeight;
  }

  function pushAssistant(r) {
    history.push({ role: 'assistant', text: r.text, links: r.links || [], acts: (r.acts || []).map((a) => ({ l: a.l, a: a.a, p: a.p || {} })), chips: r.chips || [], eph: !!r.eph });
    if (r.topic !== undefined) mem.topic = r.unknown ? null : (r.topic || mem.topic);
    if (r.acts !== undefined) mem.offer = (r.acts && r.acts[0]) || null;
    save(); draw();
  }

  async function runAct(i, j, btn) {
    const act = history[i] && history[i].acts[j]; if (!act || act.done) return;
    const fn = ACTIONS[act.a]; if (!fn) return;
    btn.disabled = true;
    try {
      const r = await fn(act.p || {});
      if (r && r.clear) { draw(); toast('Historique effacé'); return; }
      if (!(r && r.nodone)) act.done = true; else btn.disabled = false;
      if (r && r.say) pushAssistant({ text: r.say, acts: r.acts, eph: r.eph, chips: [] }); else { save(); draw(); }
    } catch (e) {
      btn.disabled = false;
      pushAssistant({ text: '⚠️ ' + (e && e.message ? e.message : 'L’action n’a pas pu aboutir. Réessayez.'), chips: [] });
    }
  }

  let busy = false;
  function ask(text) {
    text = String(text || '').trim(); if (!text || busy || !ui) return;
    busy = true; ui.input.disabled = true; ui.send.disabled = true;
    history.push({ role: 'user', text: text.slice(0, 600) }); save(); draw();
    const waiting = h('div', { class: 't2p-row a' }, h('div', { class: 't2p-bubble busy' }, h('span', { class: 't2p-dots' }, h('i'), h('i'), h('i')))); ui.body.append(waiting); ui.body.scrollTop = ui.body.scrollHeight;
    let r; try { r = KB.reply(text, context(), mem); } catch (e) { console.error(e); r = null; }
    if (!r) r = { text: 'Je n’ai pas réussi à traiter ce message. Pouvez-vous le reformuler ?', chips: KB.starters().slice(0, 4) };
    setTimeout(() => {
      waiting.remove(); busy = false;
      if (ui) { ui.input.disabled = false; ui.send.disabled = false; pushAssistant(r); ui.input.focus({ preventScroll: true }); }
    }, Math.min(700, 220 + r.text.length * 2));
  }

  function open() {
    if (ui || !S.me) return;
    load();
    const input = h('textarea', { maxlength: '600', rows: '1', placeholder: 'Écrivez à Talk2Piaf…', 'aria-label': 'Message', enterkeyhint: 'send' });
    const send = h('button', { class: 't2p-send', type: 'submit', 'aria-label': 'Envoyer' }, svgEl(ico.send));
    const body = h('div', { class: 't2p-body', role: 'log', 'aria-live': 'polite' });
    const hbtn = (svg, label, fn) => h('button', { class: 't2p-hbtn', type: 'button', 'aria-label': label, title: label, onclick: fn }, svgEl(svg));
    const form = h('form', { class: 't2p-compose', onsubmit: (e) => { e.preventDefault(); const v = input.value; input.value = ''; input.style.height = 'auto'; ask(v); } }, input, send);
    const panel = h('section', { class: 't2p-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Talk2Piaf' },
      h('header', { class: 't2p-head' }, h('img', { class: 't2p-logo', src: 'icons/talk2piaf.svg', alt: '' }),
        h('div', { class: 't2p-title' }, h('strong', null, 'Talk2Piaf'), h('span', null, 'Assistant développé par Ehorg')),
        hbtn(ico.trash, 'Effacer la conversation', async () => { if (!history.length) return; if (await confirmDialog('Effacer la conversation ?', 'Votre échange avec l’assistant sera supprimé de cet appareil.', 'Effacer', true)) { history = []; mem.topic = null; mem.offer = null; save(); draw(); } }),
        hbtn(ico.close, 'Fermer', closePanel)),
      body, h('div', { class: 't2p-foot' }, 'Vos échanges avec l’assistant restent sur cet appareil.'), form);
    const root = h('div', { id: 'talk2piaf' }, panel);
    root.addEventListener('click', (e) => { if (e.target === root) closePanel(); });
    const onKey = (e) => { if (e.key === 'Escape' && !P.layers.length) closePanel(); };
    document.addEventListener('keydown', onKey);
    input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 130) + 'px'; });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(hover:hover)').matches) { e.preventDefault(); form.requestSubmit(); } });
    document.body.append(root);
    ui = { root, body, input, send, onKey }; draw();
    setTimeout(() => { if (ui && history.length) input.focus({ preventScroll: true }); }, 50);
  }

  P.openAssistant = open;

  // ---------------------------------------------------------------- bouton d'accès (affiché ou masqué selon SHOW_BUTTON)
  function mountButton() {
    const topbar = document.querySelector('.home .topbar');
    if (!topbar || document.getElementById('talk2piaf-fab')) return;
    const settings = topbar.querySelector('button');
    const b = h('button', { id: 'talk2piaf-fab', type: 'button', title: 'Talk2Piaf', 'aria-label': 'Ouvrir Talk2Piaf', onclick: open }, svgEl(ico.bird));
    if (settings) topbar.insertBefore(b, settings); else topbar.append(b);
  }
  new MutationObserver(mountButton).observe(document.body, { childList: true, subtree: true });
  mountButton();
})();
