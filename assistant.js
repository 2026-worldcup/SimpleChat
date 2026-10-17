/* Talk2Piaf — chatbot simulé, entièrement local. */
(() => {
  'use strict';
  const KEY = 'piaf-talk2piaf-history-v2';
  const history = (() => { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v.slice(-40) : []; } catch { return []; } })();

  const css = `
    #talk2piaf-fab{display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;border:0;border-radius:50%;background:linear-gradient(135deg,#222 0%,#4b4b4b 100%);color:#fff;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.14);transition:transform .18s,box-shadow .18s}
    #talk2piaf-fab:hover{transform:translateY(-1px);box-shadow:0 8px 22px rgba(0,0,0,.2)}
    #talk2piaf-fab svg{width:23px;height:23px}
    #talk2piaf{position:fixed;inset:0;z-index:10000;background:rgba(20,18,16,.28);backdrop-filter:blur(5px);display:flex;align-items:flex-end;justify-content:center}
    .t2p-panel{width:min(720px,100%);height:min(780px,100dvh);background:#fffdf9;border-radius:24px 24px 0 0;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 -10px 45px rgba(0,0,0,.18);animation:t2pIn .22s ease-out}
    @keyframes t2pIn{from{transform:translateY(25px);opacity:.4}to{transform:none;opacity:1}}
    .t2p-head{display:flex;align-items:center;gap:12px;padding:15px 17px;border-bottom:1px solid #e9e2da;background:#fffdf9}
    .t2p-logo{width:42px;height:42px;border-radius:14px;display:block}
    .t2p-title{min-width:0;flex:1}.t2p-title strong{display:block;font-size:16px}.t2p-title span{display:block;margin-top:2px;font-size:12px;color:#7b746d}
    .t2p-close{border:0;background:transparent;width:40px;height:40px;border-radius:50%;font-size:25px;color:#625c56;cursor:pointer}.t2p-close:hover{background:#f1ece6}
    .t2p-body{flex:1;overflow:auto;padding:20px 16px;display:flex;flex-direction:column;gap:13px;scroll-behavior:smooth}
    .t2p-empty{margin:auto;text-align:center;max-width:410px;color:#625c56}.t2p-empty h2{margin:10px 0 7px;color:#282522;font-size:24px}.t2p-empty p{margin:0;line-height:1.55}
    .t2p-bubble{max-width:min(82%,580px);padding:11px 14px;border-radius:18px;line-height:1.48;font-size:15px;white-space:pre-wrap;overflow-wrap:anywhere}
    .t2p-user{align-self:flex-end;background:#282522;color:white;border-bottom-right-radius:6px}.t2p-ai{align-self:flex-start;background:#eee9e3;color:#282522;border-bottom-left-radius:6px}
    .t2p-bubble.busy{color:#7b746d}.t2p-dots{display:inline-flex;gap:4px;vertical-align:middle}.t2p-dots i{width:5px;height:5px;border-radius:50%;background:currentColor;animation:t2pDot 1s infinite}.t2p-dots i:nth-child(2){animation-delay:.14s}.t2p-dots i:nth-child(3){animation-delay:.28s}@keyframes t2pDot{0%,70%,100%{opacity:.25;transform:translateY(0)}35%{opacity:1;transform:translateY(-2px)}}
    .t2p-compose{display:flex;gap:9px;align-items:flex-end;padding:12px 14px max(12px,env(safe-area-inset-bottom));border-top:1px solid #e9e2da;background:#fffdf9}.t2p-compose textarea{flex:1;resize:none;min-height:44px;max-height:130px;border:1px solid #d9d0c7;border-radius:17px;background:white;padding:11px 13px;font:inherit;line-height:1.35;outline:none}.t2p-compose textarea:focus{border-color:#77706a;box-shadow:0 0 0 3px rgba(60,55,50,.08)}.t2p-send{width:44px;height:44px;border:0;border-radius:50%;background:#282522;color:white;display:grid;place-items:center;cursor:pointer}.t2p-send:disabled{opacity:.45;cursor:default}.t2p-send svg{width:19px}.t2p-foot{text-align:center;font-size:10px;color:#958d85;padding:0 12px 7px;background:#fffdf9}
    @media(min-width:760px){#talk2piaf{align-items:center;padding:20px}.t2p-panel{height:min(780px,calc(100dvh - 40px));border-radius:24px}}
  `;
  const style = document.createElement('style'); style.textContent = css; document.head.append(style);

  const esc = s => String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(history.slice(-40))); } catch {} };
  const icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 4.5c-5.8-1.7-11.7.1-15.1 4.6-2.1 2.8-1.8 6.3.7 8.4l-2.2 3.1 4.3-1.5c3.9 1.6 8.6.1 10.8-3.4 1.8-2.8 2.2-7.1 1.5-11.2Z"/><path d="M8.2 12.2c1.5-1.1 3.5-2 6.1-2.4"/><circle cx="9" cy="12.7" r=".7" fill="currentColor" stroke="none"/><circle cx="12" cy="11.7" r=".7" fill="currentColor" stroke="none"/><circle cx="15" cy="11.1" r=".7" fill="currentColor" stroke="none"/></svg>`;

  function replyTo(text) {
    const q = text.trim();
    const l = q.toLocaleLowerCase('fr-FR');
    const previous = history.filter(m => m.role === 'user').slice(-2).map(m => m.content).join(' ');

    if (/^(bonjour|salut|hello|bonsoir|coucou|hey)\b/.test(l)) {
      return ['Salut ! Content de te voir. Tu veux parler de quoi ?', 'Bonjour ! Je suis là. Qu’est-ce que tu as en tête ?', 'Salut ! Vas-y, je t’écoute.'][Math.floor(Math.random()*3)];
    }
    if (/comment (vas|ça va)|tu vas bien|ca va/.test(l)) {
      return ['Ça va bien, merci. Et toi ?', 'Très bien. Je suis prêt à discuter. Et toi, comment ça va ?', 'Tout va bien de mon côté. Quoi de neuf ?'][Math.floor(Math.random()*3)];
    }
    if (/qui es[- ]tu|tu es qui|présente[- ]toi|ton nom/.test(l)) {
      return 'Je suis Talk2Piaf, le petit chatbot intégré à Piaf. Je peux discuter avec toi, répondre à des questions simples et réagir à ce que tu me racontes.';
    }
    if (/qui t.?a (cré|fait|développ)|développeur|développé par/.test(l)) {
      return 'J’ai été développé pour Piaf par Ehorg.';
    }
    if (/^merci|merci beaucoup|thanks/.test(l)) {
      return ['Avec plaisir !', 'Pas de souci.', 'Je t’en prie !'][Math.floor(Math.random()*3)];
    }
    if (/^(au revoir|bye|à bientôt|a bientot)/.test(l)) return 'À bientôt !';
    if (/que (peux|sais) tu faire|tu peux faire quoi|tes capacités|fonction/.test(l)) {
      return 'Je peux surtout discuter, répondre à des questions simples, reformuler une idée, t’aider à réfléchir et réagir à ce que tu écris. Je suis une simulation locale : je ne vais pas chercher d’informations sur Internet et je n’accède pas à tes conversations Piaf.';
    }
    if (/piaf/.test(l) && /quoi|c.?est|application|messagerie/.test(l)) {
      return 'Piaf est la messagerie privée dans laquelle je suis intégré. Je peux discuter avec toi ici, mais je n’ai pas accès aux autres conversations.';
    }
    if (/tu es (une )?ia|intelligence artificielle|vrai assistant|vraie ia|réel|réelle/.test(l)) {
      return 'Je suis surtout là pour donner l’impression d’une vraie conversation. Je suis un chatbot simulé qui fonctionne directement dans Piaf, sans modèle d’IA distant derrière chaque message.';
    }
    if (/^pourquoi\b/.test(l)) return 'Bonne question. Qu’est-ce qui te fait te la poser ?';
    if (/^(quoi|qu.?est[- ]ce que)\b/.test(l)) return 'Je vois. Tu veux savoir quelque chose en particulier à ce sujet ?';
    if (/^(comment|peux[- ]tu|est[- ]ce que tu peux)\b/.test(l)) return 'Oui, je peux essayer de t’aider. Donne-moi un peu plus de contexte.';
    if (/triste|déprim|ça va pas|ca va pas|mal aujourd|stress|angoiss/.test(l)) return 'Je suis désolé que tu te sentes comme ça. Tu veux m’expliquer ce qui se passe ?';
    if (/content|heureux|génial|genial|super|cool/.test(l)) return 'Ça fait plaisir à entendre. Qu’est-ce qui s’est passé ?';
    if (q.endsWith('?')) return ['Hmm, bonne question. Je réfléchis… Tu peux me donner un peu plus de contexte ?', 'Je vois ce que tu veux dire. Je n’ai pas assez d’informations pour être catégorique, mais on peut regarder ça ensemble.', 'Intéressant. Qu’est-ce que tu aimerais savoir exactement ?'][Math.floor(Math.random()*3)];
    if (previous && l.length < 35) return ['Oui, je vois.', 'D’accord, je comprends.', 'Je vois où tu veux en venir. Et ensuite ?'][Math.floor(Math.random()*3)];
    return ['Je vois. Raconte-moi un peu plus.', 'D’accord. Et toi, tu en penses quoi ?', 'Intéressant. Continue, je t’écoute.', 'Oui, je comprends. Qu’est-ce qui t’amène à ça ?'][Math.floor(Math.random()*4)];
  }

  function open() {
    if (document.getElementById('talk2piaf')) return;
    const root = document.createElement('div'); root.id = 'talk2piaf';
    root.innerHTML = `<section class="t2p-panel" role="dialog" aria-modal="true" aria-label="Talk2Piaf">
      <header class="t2p-head"><img class="t2p-logo" src="icons/talk2piaf.svg" alt=""><div class="t2p-title"><strong>Talk2Piaf</strong><span>Assistant développé par Ehorg</span></div><button class="t2p-close" type="button" aria-label="Fermer">×</button></header>
      <div class="t2p-body"></div><div class="t2p-foot">Chatbot simulé — les conversations restent sur cet appareil.</div>
      <form class="t2p-compose"><textarea maxlength="4000" rows="1" placeholder="Écrivez à Talk2Piaf…" aria-label="Message"></textarea><button class="t2p-send" type="submit" aria-label="Envoyer">${icon}</button></form>
    </section>`;
    document.body.append(root);
    const body = root.querySelector('.t2p-body'), input = root.querySelector('textarea'), form = root.querySelector('form');
    const render = () => {
      if (!history.length) body.innerHTML = `<div class="t2p-empty"><div style="font-size:44px">${icon}</div><h2>Bonjour, je suis Talk2Piaf.</h2><p>Je suis le chatbot intégré à Piaf. Commence simplement à discuter avec moi.</p></div>`;
      else body.innerHTML = history.map(m => `<div class="t2p-bubble ${m.role === 'user' ? 't2p-user' : 't2p-ai'}">${esc(m.content)}</div>`).join('');
      body.scrollTop = body.scrollHeight;
    };
    const close = () => root.remove();
    root.querySelector('.t2p-close').onclick = close;
    root.addEventListener('click', e => { if (e.target === root) close(); });
    document.addEventListener('keydown', function onKey(e){ if (!document.getElementById('talk2piaf')) { document.removeEventListener('keydown', onKey); return; } if (e.key === 'Escape') close(); });
    input.addEventListener('input', () => { input.style.height='auto'; input.style.height=Math.min(input.scrollHeight,130)+'px'; });
    form.onsubmit = e => {
      e.preventDefault(); const text = input.value.trim(); if (!text || form.dataset.busy) return;
      history.push({role:'user', content:text}); save(); input.value=''; input.style.height='auto'; render();
      form.dataset.busy='1'; input.disabled=true; form.querySelector('.t2p-send').disabled=true;
      const waiting = document.createElement('div'); waiting.className='t2p-bubble t2p-ai busy'; waiting.innerHTML='<span class="t2p-dots"><i></i><i></i><i></i></span>'; body.append(waiting); body.scrollTop=body.scrollHeight;
      const answer = replyTo(text);
      const delay = Math.min(1500, Math.max(450, 250 + answer.length * 12));
      setTimeout(() => { waiting.remove(); history.push({role:'assistant', content:answer}); save(); render(); delete form.dataset.busy; input.disabled=false; form.querySelector('.t2p-send').disabled=false; input.focus(); }, delay);
    };
    render(); setTimeout(() => input.focus(), 50);
  }

  function mountButton() {
    const topbar = document.querySelector('.home .topbar');
    if (!topbar || document.getElementById('talk2piaf-fab')) return;
    const settings = topbar.querySelector('button');
    const b = document.createElement('button'); b.id='talk2piaf-fab'; b.type='button'; b.title='Talk2Piaf'; b.setAttribute('aria-label','Ouvrir Talk2Piaf'); b.innerHTML=icon; b.onclick=open;
    if (settings) topbar.insertBefore(b, settings); else topbar.append(b);
  }
  const observer = new MutationObserver(mountButton); observer.observe(document.body,{childList:true,subtree:true});
  mountButton();
})();
