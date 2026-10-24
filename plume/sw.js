/* =============================================================================
   Plume — service worker : garde une copie de l'appli pour qu'elle marche
   sans connexion. Stratégie « cache d'abord » : on sert la copie locale tout de
   suite, et on la met à jour en arrière-plan quand le réseau est là.
   Pour publier une nouvelle version : changer VERSION ci-dessous.
   ========================================================================== */
const VERSION = "plume-v1";
const FICHIERS = ["./", "index.html", "style.css", "moteur.js", "grille.js", "stockage.js", "app.js",
  "manifest.webmanifest", "icones/icone-192.png", "icones/icone-512.png", "icones/icone-masquable-512.png"];

// Installation : on télécharge tous les fichiers de l'appli
self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});

// Activation : on supprime les anciennes versions
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(cles => Promise.all(cles.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Chaque requête : copie locale si elle existe, mise à jour silencieuse en parallèle
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async cache => {
    const local = await cache.match(e.request, { ignoreSearch: true });
    const reseau = fetch(e.request).then(r => { if (r.ok) cache.put(e.request, r.clone()); return r; }).catch(() => local);
    return local || reseau;
  }));
});
