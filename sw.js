const CACHE_PREFIX = "cacimba-ajustada-";
const CACHE_NAME = `${CACHE_PREFIX}3.2.10`;
const XLSX_URL = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
const LUCIDE_URL = "https://cdn.jsdelivr.net/npm/lucide@1.40.0/dist/umd/lucide.min.js";
const CDN_URLS = [XLSX_URL, LUCIDE_URL];
const APP_SHELL = [
  "./", "./index.html", "./manifest.webmanifest", "./assets/css/app.css",
  "./src/config.js", "./src/api.js", "./src/database.js", "./src/state.js",
  "./src/sync.js", "./src/auth.js", "./src/genealogy.js", "./src/ui.js",
  "./src/backup.js", "./src/bootstrap.js"
];
self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    // Mantém Excel e ícones disponíveis offline após a primeira instalação.
    await Promise.all(CDN_URLS.map(url => cache.add(url).catch(error => console.warn("Biblioteca externa não pôde ser pré-armazenada", url, error))));
  })());
});
self.addEventListener("activate", event => { event.waitUntil((async () => { const keys = await caches.keys(); await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key))); await self.clients.claim(); })()); });
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  const isLocal = url.origin === self.location.origin;
  const isCdnLibrary = CDN_URLS.includes(request.url);
  if (request.method !== "GET" || (!isLocal && !isCdnLibrary)) return;
  if (request.mode === "navigate") {
    event.respondWith((async () => { const cache = await caches.open(CACHE_NAME); try { const fresh = await fetch(request, { cache: "no-store" }); cache.put("./index.html", fresh.clone()); return fresh; } catch { return (await cache.match("./index.html")) || Response.error(); } })()); return;
  }
  event.respondWith((async () => { const cache = await caches.open(CACHE_NAME), cached = await cache.match(request); const network = fetch(request).then(async response => { if (response.ok) cache.put(request, response.clone()); return response; }).catch(() => null); return cached || await network || Response.error(); })());
});
