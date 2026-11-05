/* ============================================================
   journal.js — compteur de visites de baiji.fr
   Version 1.0.0 (04/11/2026)
   ------------------------------------------------------------
   À inclure dans le <head> de chaque page suivie :
       <script src="/journal.js" defer></script>
   (« defer » : le script attend que la page soit lue, il ne la
    ralentit jamais.)

   À chaque ouverture de page, il envoie un tout petit signal au
   script Google « Journal baiji » (code : outils/journal-baiji.gs),
   qui l'ajoute au Google Sheet. Les chiffres se lisent sur
   https://baiji.fr/journal/.

   Ce qui part : la page, le site d'où l'on vient, le navigateur
   (user agent), si la page est ouverte comme appli installée, et
   un identifiant ANONYME tiré au hasard et gardé dans ce navigateur
   (pour compter les visiteurs différents). Rien d'autre : pas de
   nom, pas de cookie publicitaire, pas d'outil d'une autre société.

   ⚠️ Ne PAS l'ajouter à Paraphe : sa politique de confidentialité
   (Play Store) promet « aucun outil de statistiques ou de suivi ».

   Historique :
    • 1.0.0 : première version
   ============================================================ */

(function () {
  "use strict";

  /* ---- RÉGLAGE : l'URL /exec du script Google « Journal baiji » ----
     Vide = rien n'est envoyé (le site marche normalement). */
  const URL_JOURNAL = "";

  // La page /journal/ s'en sert pour lire les statistiques
  window.BAIJI_JOURNAL_URL = URL_JOURNAL;

  /* Petit accès sûr au stockage du navigateur : en navigation privée
     il peut être refusé ; on fait alors comme s'il était vide. */
  function lire(cle) { try { return localStorage.getItem(cle); } catch (e) { return null; } }
  function ecrire(cle, v) { try { localStorage.setItem(cle, v); } catch (e) {} }

  /* Identifiant anonyme du navigateur : 8 caractères au hasard,
     créé à la première visite puis réutilisé. Il ne dit rien de la
     personne, il permet seulement de compter « 1 visiteur » même s'il
     ouvre 10 pages. */
  function identifiant() {
    let id = lire("baiji-visiteur");
    if (!id) {
      id = Math.random().toString(36).slice(2, 10);
      ecrire("baiji-visiteur", id);
    }
    return id;
  }

  /* Envoi « tire et oublie » : on charge une image invisible dont
     l'adresse contient les informations. Le navigateur fait la requête,
     on n'attend aucune réponse, et ça ne pose aucun souci de CORS. */
  function envoyer(evenement) {
    if (!URL_JOURNAL) return;
    // Seulement sur le vrai site (pas pendant les essais en local)
    if (!/(^|\.)baiji\.fr$/.test(location.hostname)) return;
    try {
      // D'où vient-on ? Seulement le nom du site, et seulement s'il est extérieur
      let source = "";
      if (document.referrer) {
        const hote = new URL(document.referrer).hostname;
        if (hote !== location.hostname) source = hote;
      }
      const installee = window.matchMedia("(display-mode: standalone)").matches
                     || window.navigator.standalone === true;   // iPhone
      const params = new URLSearchParams({
        t: "v",                              // « visite » pour le script
        site: "baiji",
        page: location.pathname,
        ev: evenement,                       // "visite" ou "ok" (serrure ouverte)
        ua: navigator.userAgent,
        src: source,
        app: installee ? "1" : "0",
        vid: identifiant(),
        moi: lire("baiji-moi") === "1" ? "1" : "0"   // réglé depuis la page /journal/
      });
      new Image().src = URL_JOURNAL + "?" + params.toString();
    } catch (e) {
      /* un échec de comptage ne doit jamais gêner la page : on ignore */
    }
  }

  // gate.js (la serrure de l'accueil) s'en sert pour noter « code validé »
  window.baijiJournal = envoyer;

  // La page Journal elle-même n'est pas comptée
  if (!/^\/journal\//.test(location.pathname)) envoyer("visite");
})();
