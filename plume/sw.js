/* =============================================================================
   Plume — service worker : garde une copie de l'appli pour qu'elle marche
   sans connexion. Stratégie « cache d'abord » : on sert la copie locale tout de
   suite, et on la met à jour en arrière-plan quand le réseau est là.
   Pour publier une nouvelle version : augmenter le numéro dans version.js.
   ========================================================================== */
importScripts("version.js");                      // définit self.PLUME_VERSION
const VERSION = "plume-" + self.PLUME_VERSION;   // nom du cache : change à chaque version
const FICHIERS = ["./", "index.html", "version.js", "style.css", "moteur.js", "grille.js", "stockage.js", "exemples.js", "app.js",
  "manifest.webmanifest", "icones/icone.svg", "icones/geste.svg", "icones/icone-192.png", "icones/icone-512.png",
  "icones/icone-masquable-512.png"];
// Polices Google (Manrope, JetBrains Mono) : gardées en cache dès la première visite pour le hors ligne
const POLICES = ["https://fonts.googleapis.com", "https://fonts.gstatic.com"];

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
  const origine = new URL(e.request.url).origin;
  if (e.request.method !== "GET" || (origine !== location.origin && !POLICES.includes(origine))) return;
  e.respondWith(caches.open(VERSION).then(async cache => {
    const local = await cache.match(e.request, { ignoreSearch: true });
    const reseau = fetch(e.request).then(r => { if (r.ok) cache.put(e.request, r.clone()); return r; }).catch(() => local);
    return local || reseau;
  }));
});
