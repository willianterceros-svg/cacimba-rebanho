const CACHE_PREFIX = "cacimba-ajustada-";
const CACHE_NAME = `${CACHE_PREFIX}3.0.1`;
const XLSX_URL = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
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
    // Mantém importação/exportação Excel disponível offline após a primeira instalação.
    try { await cache.add(XLSX_URL); } catch (error) { console.warn("Biblioteca Excel não pôde ser pré-armazenada", error); }
  })());
});
self.addEventListener("activate", event => { event.waitUntil((async () => { const keys = await caches.keys(); await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key))); await self.clients.claim(); })()); });
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  const isLocal = url.origin === self.location.origin;
  const isExcelLibrary = request.url === XLSX_URL;
  if (request.method !== "GET" || (!isLocal && !isExcelLibrary)) return;
  if (request.mode === "navigate") {
    event.respondWith((async () => { const cache = await caches.open(CACHE_NAME); try { const fresh = await fetch(request, { cache: "no-store" }); cache.put("./index.html", fresh.clone()); return fresh; } catch { return (await cache.match("./index.html")) || Response.error(); } })()); return;
  }
  event.respondWith((async () => { const cache = await caches.open(CACHE_NAME), cached = await cache.match(request); const network = fetch(request).then(async response => { if (response.ok) cache.put(request, response.clone()); return response; }).catch(() => null); return cached || await network || Response.error(); })());
});
