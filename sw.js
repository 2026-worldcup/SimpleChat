/* Piaf — service worker : coquille de l'appli en cache (chargement rapide, installation PWA).
   Les appels à Supabase (autre origine) ne sont JAMAIS mis en cache : aucune donnée privée n'est stockée ici. */
const CACHE = 'piaf-shell-v20';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'views-home.js', 'views-chat.js', 'views-groups.js', 'views-extras.js', 'assistant-calendar.js', 'assistant-watch.js', 'assistant-actions-kb.js', 'assistant-kb.js', 'assistant.js', 'assistant-actions.js', 'config.js', 'vendor/supabase.js',
  'manifest.webmanifest', 'privacy.html', 'icons/icon.svg', 'icons/icon-192.png', 'icons/talk2piaf.svg', 'icons/talk2piaf-actions.svg'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;        // Supabase & co : réseau direct
  e.respondWith(fetch(req).then((res) => {                                      // réseau d'abord : on a toujours la dernière version en ligne
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./') : Response.error()))));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const hash = e.notification.data?.hash || '#/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    const c = cs[0]; if (c) { c.navigate(new URL(hash, c.url).href).catch(() => {}); return c.focus(); }
    return self.clients.openWindow('./' + hash);
  }));
});
