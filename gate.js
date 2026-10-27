/* ============================================================
   gate.js — petite « serrure de curiosité » + log des visites
   Version 1.0.1
   ------------------------------------------------------------
   À inclure TOUT EN HAUT du <head> de chaque page à protéger :
       <script src="/gate.js"></script>

   ⚠️ IMPORTANT — niveau de sécurité FAIBLE par nature :
   le site est statique (GitHub Pages), donc ce code tourne
   dans le navigateur du visiteur. Le code d'accès est donc
   VISIBLE dans le source de la page. Ça décourage un regard
   indiscret (quelqu'un qui a vu l'URL), mais ça n'arrête PAS
   quelqu'un de motivé. → Ne jamais mettre de données sensibles
   derrière cette porte.

   Historique :
    • 1.0.0 : serrure + log (mirobol)
    • 1.0.1 : ajout de l'étiquette SITE dans le log
   ============================================================ */

(function () {
  "use strict";

  /* ---- RÉGLAGES (les seules lignes à modifier au besoin) ---- */
  const CODE        = "aaaa";          // le code d'accès à saisir
  const SITE        = "baiji";         // nom du site, ajouté au journal pour distinguer baiji / mirobol
  const CLE_SESSION = "baiji_ok";      // mémorise le déverrouillage le temps de l'onglet
  const LOG_URL     = "";              // ← URL de ton Apps Script (laisse vide = pas de log)

  /* ------------------------------------------------------------
     1) JOURNAL (log) : on « ping » le script Google à chaque
        visite. Technique « fire and forget » : on envoie et on
        n'attend pas de réponse. Passer par une Image évite tout
        problème de CORS avec Apps Script.
     ------------------------------------------------------------ */
  function logVisite(evenement) {
    if (!LOG_URL) return;              // pas d'URL configurée → on ne logge rien
    try {
      const params = new URLSearchParams({
        site: SITE,                    // quel site (baiji / mirobol)
        page: location.pathname,       // quelle page a été ouverte
        ev:   evenement,               // "visite" (arrivée) ou "ok" (code validé)
        ua:   navigator.userAgent      // navigateur / appareil
      });
      // L'heure exacte est enregistrée côté serveur (Apps Script), pas ici.
      new Image().src = LOG_URL + "?" + params.toString();
    } catch (e) {
      /* un échec de log ne doit jamais gêner l'utilisateur : on ignore */
    }
  }

  // On note l'arrivée sur la page, que la personne entre le code ou non.
  logVisite("visite");

  /* ------------------------------------------------------------
     2) Déjà déverrouillé pour cet onglet ? Alors on ne fait rien.
     ------------------------------------------------------------ */
  if (sessionStorage.getItem(CLE_SESSION) === "1") return;

  /* ------------------------------------------------------------
     3) On cache la page TOUT DE SUITE (avant qu'elle s'affiche)
        pour éviter qu'elle « clignote » avant la serrure.
     ------------------------------------------------------------ */
  const racine = document.documentElement;   // la balise <html>
  racine.style.visibility = "hidden";

  /* Petite sécurité : si quoi que ce soit plante, on réaffiche la
     page au bout de 3 s plutôt que de laisser un écran blanc. */
  const filet = setTimeout(function () { racine.style.visibility = "visible"; }, 3000);

  /* ------------------------------------------------------------
     4) Construction de l'écran de saisie (overlay plein écran).
        Styles « en dur » (inline) pour fonctionner même sans la
        feuille de style de la page.
     ------------------------------------------------------------ */
  function afficherServrure() {
    clearTimeout(filet);               // on annule le filet de sécurité

    const overlay = document.createElement("div");
    overlay.setAttribute("style", [
      "position:fixed", "inset:0", "z-index:99999",
      "display:flex", "align-items:center", "justify-content:center",
      "background:#0e1a1c",            // fond sombre de la charte SV
      "color:#e6f1f1",
      "font-family:Manrope,system-ui,-apple-system,sans-serif"
    ].join(";"));

    // Formulaire : une étiquette, un champ, un message d'erreur, un bouton
    overlay.innerHTML =
      '<form id="g-form" style="text-align:center;max-width:280px;padding:24px">' +
        '<div style="font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;' +
             'color:#3cc2b8;font-weight:700;margin-bottom:14px">Accès réservé</div>' +
        '<input id="g-input" type="password" inputmode="text" autocomplete="off" ' +
               'placeholder="Code d\'accès" ' +
               'style="width:100%;padding:12px 14px;border-radius:10px;border:1px solid #26393c;' +
               'background:#152427;color:#e6f1f1;font-size:1rem;text-align:center;outline:none">' +
        '<div id="g-err" style="color:#f0857f;font-size:.8rem;height:1.1em;margin-top:8px"></div>' +
        '<button type="submit" style="margin-top:4px;width:100%;padding:12px;border:0;' +
                'border-radius:10px;background:#0f7c7b;color:#fff;font-weight:700;' +
                'letter-spacing:.06em;text-transform:uppercase;cursor:pointer">Entrer</button>' +
      '</form>';

    document.body.appendChild(overlay);
    racine.style.visibility = "visible";   // on réaffiche : l'overlay opaque masque la page

    const champ   = overlay.querySelector("#g-input");
    const erreur  = overlay.querySelector("#g-err");
    champ.focus();

    // Validation du code
    overlay.querySelector("#g-form").addEventListener("submit", function (e) {
      e.preventDefault();
      if (champ.value === CODE) {
        sessionStorage.setItem(CLE_SESSION, "1");  // on retient pour cet onglet
        logVisite("ok");                            // on note le déverrouillage
        overlay.remove();                           // on enlève la serrure → la page apparaît
      } else {
        erreur.textContent = "Code incorrect";
        champ.value = "";
        champ.focus();
      }
    });
  }

  /* On attend que le <body> existe avant d'y ajouter l'overlay. */
  if (document.body) {
    afficherServrure();
  } else {
    document.addEventListener("DOMContentLoaded", afficherServrure);
  }
})();
