// Garde l'application dans le téléphone pour qu'elle s'ouvre sans réseau.
// Changer VERSION à chaque mise à jour des fichiers.
const VERSION = "inventaire-qr-v1";
const FICHIERS = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "db.js",
  "lib/qrcode.js",
  "lib/jsQR.js",
  "manifest.webmanifest",
  "icone-192.png",
  "icone-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((cles) => Promise.all(cles.filter((c) => c !== VERSION).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

// Réponse immédiate depuis le téléphone, mise à jour en arrière-plan quand il y a du réseau.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const enCache = await cache.match(e.request, { ignoreSearch: true });
      const reseau = fetch(e.request)
        .then((r) => {
          if (r.ok) cache.put(e.request, r.clone());
          return r;
        })
        .catch(() => enCache);
      return enCache || reseau;
    }),
  );
});
