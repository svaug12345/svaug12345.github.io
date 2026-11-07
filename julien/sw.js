/*
  ============================================================
  Service worker de TAC Vélo (tac-velo.fr)
  Repris de outils/generer-pwa.py (dépôt svaug12345.github.io) —
  c'est lui qui rend la page installable sur téléphone.
  ------------------------------------------------------------
  Stratégie « réseau d'abord » :
   • en ligne  → on prend TOUJOURS la version du site (donc
                 jamais bloqué sur une vieille version), et on
                 en garde une copie dans le cache ;
   • hors ligne → on ressort la copie du cache (si elle existe).
  Seuls les fichiers du site, dans le dossier de cette page,
  sont concernés ; le reste (Google Fonts, ElevenLabs…) passe
  normalement, sans être touché.
  ============================================================
*/
const CACHE = "tac-velo-" + new URL(self.registration.scope).pathname;

// Installation : on prend la main tout de suite (pas d'attente)
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const portee = new URL(self.registration.scope).pathname;

  // On ne s'occupe que des lectures (GET) de fichiers de CE dossier
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (!url.pathname.startsWith(portee)) return;
  // Vidéos et sons : on les laisse passer sans les garder. Ils sont lourds (ils rempliraient
  // le téléphone) et le navigateur les lit par morceaux (requêtes « Range » → réponses 206),
  // que le cache ne sait pas stocker.
  if (e.request.headers.has("range") || /\.(mp4|webm|mov|m4a|mp3|wav|ogg)$/i.test(url.pathname)) return;
  

  e.respondWith(
    fetch(e.request)
      .then((reponse) => {
        // Copie de la réponse dans le cache (une réponse ne se lit qu'une fois → clone)
        if (reponse.ok) {
          const copie = reponse.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copie));
        }
        return reponse;
      })
      // Pas de réseau : la copie du cache (ou, pour une page, l'accueil du dossier)
      .catch(() => caches.match(e.request)
        .then((r) => r || (e.request.mode === "navigate" ? caches.match(portee) : undefined)))
  );
});
