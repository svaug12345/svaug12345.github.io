/* Ancien service worker de « Plume » (devenue « Paraphe », à l'adresse /paraphe/).
   Quand un téléphone vérifie s'il y a une mise à jour, il reçoit cette version-ci, qui :
   1. supprime les anciennes copies « plume-… » gardées pour le hors ligne ;
   2. se désinstalle ;
   3. recharge les pages ouvertes, qui seront alors redirigées vers /paraphe/. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("plume-")) await caches.delete(k);
    await self.registration.unregister();
    for (const c of await self.clients.matchAll({ type: "window" })) c.navigate("/paraphe/");
  })());
});
