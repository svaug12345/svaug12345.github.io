/* ============================================================
   7 villa Marcès — visites.js : note chaque page vue dans l'onglet
   « Visites » du Google Sheet « 7 villa Marcès – intéressés »
   Version 1.0.0 (22/11/2026) — même script Google que le formulaire
   (outils/villa-marces-interet.gs, version 1.2.0 ou plus).
   ------------------------------------------------------------
   À inclure dans le <head> de chaque page du dossier :
       <script src="visites.js" defer></script>

   Ce qui part : la page, le site d'où l'on vient (nom du site seulement),
   le type d'appareil et le navigateur, la taille de l'écran, la langue,
   l'identifiant ANONYME tiré au hasard que /journal.js garde déjà dans le
   navigateur (« baiji-visiteur »), et s'il s'agit d'une première visite
   sur ce site. Pas de nom, pas d'adresse IP (Google ne la transmet pas),
   pas de cookie publicitaire, aucun outil d'une autre société.

   Les appareils marqués « c'est moi » sur baiji.fr/journal/ (stockage
   « baiji-moi ») sont notés avec « oui » dans la colonne « Moi », pour
   pouvoir les filtrer.

   Rien n'est envoyé pendant les essais en local (seulement sur baiji.fr),
   ni par les navigateurs pilotés par un robot.
   ============================================================ */

(function () {
  "use strict";

  // Même adresse que INTERET_URL dans index.html
  const URL_SCRIPT = "https://script.google.com/macros/s/AKfycbycaT0gT9FsfcpCPWVMN3zg8ejVwbRte_-mZTxtZ5lLM4Hl-lvjI3YK6oUczNskTufA/exec";

  if (!URL_SCRIPT || !/(^|\.)baiji\.fr$/.test(location.hostname) || navigator.webdriver) return;

  function lire(cle) { try { return localStorage.getItem(cle); } catch (e) { return null; } }
  function ecrire(cle, v) { try { localStorage.setItem(cle, v); } catch (e) {} }

  try {
    // Identifiant anonyme partagé avec /journal.js (créé ici s'il n'existe pas encore)
    let visiteur = lire("baiji-visiteur");
    if (!visiteur) { visiteur = Math.random().toString(36).slice(2, 10); ecrire("baiji-visiteur", visiteur); }

    // Première fois sur le site du 7 villa Marcès depuis ce navigateur ?
    const premiere = !lire("villa-marces.vu");
    if (premiere) ecrire("villa-marces.vu", new Date().toISOString());

    // D'où vient-on ? Seulement le nom du site, et seulement s'il est extérieur
    let source = "";
    if (document.referrer) {
      const hote = new URL(document.referrer).hostname;
      if (hote !== location.hostname) source = hote;
    }

    const ua = navigator.userAgent;
    const appareil = /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobi/i.test(ua)) ? "Tablette"
                   : /Mobi|iPhone|Android/i.test(ua) ? "Téléphone" : "Ordinateur";
    const navigateur = /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung"
                     : /Firefox|FxiOS/.test(ua) ? "Firefox" : /Chrome|CriOS/.test(ua) ? "Chrome"
                     : /Safari/.test(ua) ? "Safari" : "Autre";

    const donnees = JSON.stringify({
      type: "visite",
      page: location.pathname.replace(/^.*\/villa-marces\//, "") || "index.html",
      ancre: location.hash.slice(0, 40),
      source: source,
      appareil: appareil,
      navigateur: navigateur,
      ecran: screen.width + " × " + screen.height,
      langue: (navigator.language || "").slice(0, 10),
      visiteur: visiteur,
      premiere: premiere,
      moi: lire("baiji-moi") === "1"
    });

    // « Tire et oublie » : texte simple (pas de vérification CORS), réponse jamais lue
    fetch(URL_SCRIPT, { method: "POST", mode: "no-cors", keepalive: true,
                        headers: { "Content-Type": "text/plain;charset=utf-8" }, body: donnees })
      .catch(function () {});
  } catch (e) {
    /* un échec de comptage ne doit jamais gêner la page */
  }
})();
