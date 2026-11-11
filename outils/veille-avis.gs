/* ============================================================
   Veille — avis des lecteurs (👍 / 👎) et sujets perso — script Google Apps Script
   Version 1.1.0
   ------------------------------------------------------------
   Met en commun les votes de tous les lecteurs de baiji.fr/veille/ :
   quand quelqu'un dit qu'un article n'est « pas pertinent », il est
   masqué pour tout le monde, et l'appli apprend de l'ensemble des
   votes quels mots et quels journaux sont intéressants ou non.

   Les votes sont rangés dans l'onglet « Avis » du Google Sheet, une
   ligne par vote : quand, sujet, id de l'article, titre, journal,
   vote (1 = 👍, -1 = 👎), qui (identifiant anonyme du téléphone).
   On peut les relire, les trier ou en effacer à la main.

   INSTALLATION (une seule fois, ~5 min) :
    1. Créer un Google Sheet vide, par ex. « Veille - avis ».
    2. Menu Extensions → Apps Script ; remplacer le code par ce fichier.
    3. Roue dentée « Paramètres du projet » → « Propriétés du script » →
       ajouter CLE = un mot de passe à donner aux lecteurs (ex. « veille-ntp-2026 »).
    4. Bouton « Déployer » → « Nouveau déploiement » → type « Application web » :
         Exécuter en tant que : Moi
         Qui a accès : Tout le monde
       → autoriser, puis copier l'adresse qui finit par /exec.
    5. Coller cette adresse dans AVIS_URL de veille/index.html (ou la donner à Claude).
    6. Envoyer aux lecteurs le lien baiji.fr/veille/?cle=LA-CLE (à ouvrir une fois :
       la clé est ensuite gardée dans le téléphone).

   Pour modifier le script plus tard : « Déployer » → « Gérer les déploiements »
   → crayon → Version : « Nouvelle version » (l'adresse /exec ne change pas).

   Historique :
    • 1.0.0 : lecture des votes d'un sujet (GET), vote / changement / retrait (POST)
    • 1.1.0 : GET ?action=flux&q=… = recherche Google Actualités pour les sujets que
              chaque lecteur ajoute lui-même dans l'appli (le navigateur ne peut pas
              interroger Google Actualités directement : règle « CORS ») ; réponse
              gardée 20 min en cache pour ne pas solliciter Google à chaque ouverture
   ============================================================ */

const ONGLET = "Avis";
const COLONNES = ["quand", "sujet", "id", "titre", "media", "vote", "qui"];
const MAX_LIGNES = 20000;      // garde-fou : au-delà, on refuse les nouveaux votes

/* ---- Lecture : GET ?cle=…&sujet=carrefour → { ok, avis: [{id, titre, media, vote, qui}] }
        ou GET ?cle=…&action=flux&q=… → { ok, articles: [...] } (voir flux() plus bas) ---- */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!cleValide(p.cle)) return repondre({ ok: false, erreur: "clé incorrecte" });
  if (p.action === "flux") return repondre(flux(p.q));
  const lignes = toutesLesLignes();
  const avis = lignes
    .filter((l) => !p.sujet || l[1] === p.sujet)
    .map((l) => ({ id: l[2], titre: l[3], media: l[4], vote: Number(l[5]), qui: l[6] }));
  return repondre({ ok: true, avis: avis });
}

/* ---- Vote : POST {cle, sujet, id, titre, media, vote, qui} → { ok } ----
   vote = 1 (👍), -1 (👎) ou 0 (retirer son vote).
   Une seule ligne par (sujet, article, lecteur) : un nouveau vote remplace l'ancien.
   L'appli envoie en « text/plain » (pas de pré-requête CORS) : on lit le texte à la main. */
function doPost(e) {
  let c;
  try { c = JSON.parse(e.postData.contents); }
  catch (err) { return repondre({ ok: false, erreur: "requête illisible" }); }
  if (!cleValide(c.cle)) return repondre({ ok: false, erreur: "clé incorrecte" });

  const vote = Number(c.vote);
  if (![1, -1, 0].includes(vote) || !c.sujet || !c.id || !c.qui) {
    return repondre({ ok: false, erreur: "vote incomplet" });
  }

  // Verrou : deux votes en même temps passent l'un après l'autre
  const verrou = LockService.getScriptLock();
  verrou.waitLock(10000);
  try {
    const feuille = onglet();
    const lignes = toutesLesLignes();
    // Ligne déjà là pour ce lecteur et cet article ? (+2 : en-tête + index qui part de 0)
    const i = lignes.findIndex((l) => l[1] === c.sujet && l[2] === c.id && l[6] === c.qui);

    if (vote === 0) {                               // retrait du vote
      if (i >= 0) feuille.deleteRow(i + 2);
    } else {
      const ligne = [new Date(), c.sujet, c.id, String(c.titre || "").slice(0, 300),
                     String(c.media || "").slice(0, 80), vote, c.qui];
      if (i >= 0) feuille.getRange(i + 2, 1, 1, ligne.length).setValues([ligne]);
      else if (lignes.length >= MAX_LIGNES) return repondre({ ok: false, erreur: "trop de votes" });
      else feuille.appendRow(ligne);
    }
  } finally {
    verrou.releaseLock();
  }
  return repondre({ ok: true });
}

/* ---- Sujets perso : recherche Google Actualités ----
   q = la recherche, comme sur news.google.com (ex. "Elis" (blanchisserie OR linge)).
   Renvoie { ok, articles: [{titre, lien, date, media, media_url}] } (100 au plus). */
function flux(q) {
  q = String(q || "").trim().slice(0, 300);
  if (!q) return { ok: false, erreur: "recherche vide" };
  const cache = CacheService.getScriptCache();
  const cleCache = "flux:" + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, q));
  const deja = cache.get(cleCache);
  if (deja) return JSON.parse(deja);

  const url = "https://news.google.com/rss/search?hl=fr&gl=FR&ceid=FR:fr&q=" + encodeURIComponent(q);
  const rep = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (rep.getResponseCode() !== 200) return { ok: false, erreur: "Google Actualités : erreur " + rep.getResponseCode() };

  const canal = XmlService.parse(rep.getContentText()).getRootElement().getChild("channel");
  const articles = canal.getChildren("item").slice(0, 100).map((it) => {
    const source = it.getChild("source");
    const media = source ? source.getText() : "";
    let titre = it.getChildText("title") || "";
    // Google ajoute « - Nom du journal » à la fin du titre : on l'enlève
    if (media && titre.endsWith(" - " + media)) titre = titre.slice(0, -(" - " + media).length);
    return {
      titre: titre,
      lien: it.getChildText("link") || "",
      date: new Date(it.getChildText("pubDate")).toISOString(),
      media: media,
      media_url: source ? (source.getAttribute("url") || { getValue: () => "" }).getValue() : ""
    };
  });
  const resultat = { ok: true, articles: articles };
  const texte = JSON.stringify(resultat);
  if (texte.length < 95000) cache.put(cleCache, texte, 20 * 60);   // 20 min (limite du cache : 100 Ko)
  return resultat;
}

/* ---- Petits outils ---- */

// Compare la clé reçue à la propriété CLE du script
function cleValide(cle) {
  const attendue = PropertiesService.getScriptProperties().getProperty("CLE");
  return !!attendue && cle === attendue;
}

// L'onglet « Avis » (créé avec sa ligne d'en-tête s'il n'existe pas)
function onglet() {
  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  let f = classeur.getSheetByName(ONGLET);
  if (!f) {
    f = classeur.insertSheet(ONGLET);
    f.appendRow(COLONNES);
    f.setFrozenRows(1);
  }
  return f;
}

// Toutes les lignes de votes (sans l'en-tête), sous forme de tableau de tableaux
function toutesLesLignes() {
  const f = onglet();
  const n = f.getLastRow() - 1;
  return n > 0 ? f.getRange(2, 1, n, COLONNES.length).getValues() : [];
}

// Réponse JSON
function repondre(objet) {
  return ContentService.createTextOutput(JSON.stringify(objet))
    .setMimeType(ContentService.MimeType.JSON);
}
