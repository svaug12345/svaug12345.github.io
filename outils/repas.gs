/* ============================================================
   Repas famille — script Google Apps Script
   Version 1.0.0
   ------------------------------------------------------------
   Garde les données de l'appli « On mange quoi ? » (baiji.fr/repas/)
   pour que toute la famille voie le même menu et la même liste de courses.

   Tout tient dans UNE cellule (A1 de l'onglet « Repas ») : un texte JSON
   avec les plats, les menus de la semaine et les courses. Une cellule
   accepte 50 000 caractères : largement assez (l'appli ne garde que
   8 semaines d'historique).

   INSTALLATION (une seule fois, ~5 min) :
    1. Créer un Google Sheet vide, par ex. « Repas famille ».
    2. Menu Extensions → Apps Script ; remplacer le code par ce fichier.
    3. Roue dentée « Paramètres du projet » → « Propriétés du script » →
       ajouter CLE = un mot de passe de la famille (ex. « pates-du-jeudi »).
    4. Bouton « Déployer » → « Nouveau déploiement » → type « Application web » :
         Exécuter en tant que : Moi
         Qui a accès : Tout le monde
       → autoriser, puis copier l'adresse qui finit par /exec.
    5. Coller cette adresse dans REPAS_URL de repas/index.html (ou la donner à Claude).
    6. Sur chaque téléphone : ouvrir baiji.fr/repas/?cle=LA-CLE une fois.

   Pour modifier le script plus tard : « Déployer » → « Gérer les déploiements »
   → crayon → Version : « Nouvelle version » (l'adresse /exec ne change pas).

   Historique :
    • 1.0.0 : lecture (GET) et enregistrement (POST) protégés par la clé
   ============================================================ */

const ONGLET = "Repas";
const TAILLE_MAX = 45000;   // marge sous la limite de 50 000 caractères d'une cellule

/* ---- Lecture : GET ?cle=… → { ok: true, etat: {...} | null } ---- */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!cleValide(p.cle)) return repondre({ ok: false, erreur: "clé incorrecte" });
  const texte = cellule().getValue();
  let etat = null;
  try { etat = texte ? JSON.parse(texte) : null; } catch (err) { etat = null; }
  return repondre({ ok: true, etat: etat });
}

/* ---- Enregistrement : POST {cle, etat} → { ok: true } ----
   L'appli envoie en « text/plain » : on lit donc e.postData.contents à la main. */
function doPost(e) {
  let corps;
  try { corps = JSON.parse(e.postData.contents); }
  catch (err) { return repondre({ ok: false, erreur: "requête illisible" }); }

  if (!cleValide(corps.cle)) return repondre({ ok: false, erreur: "clé incorrecte" });
  if (!corps.etat || typeof corps.etat !== "object") return repondre({ ok: false, erreur: "données manquantes" });

  const texte = JSON.stringify(corps.etat);
  if (texte.length > TAILLE_MAX) return repondre({ ok: false, erreur: "données trop grosses" });

  // Verrou : si deux téléphones enregistrent en même temps, ils passent l'un après l'autre
  const verrou = LockService.getScriptLock();
  verrou.waitLock(10000);
  try {
    cellule().setValue(texte);
    cellule().offset(0, 1).setValue(new Date());   // B1 = date du dernier enregistrement
  } finally {
    verrou.releaseLock();
  }
  return repondre({ ok: true });
}

/* ---- Petits outils ---- */

// Compare la clé reçue à la propriété CLE du script
function cleValide(cle) {
  const attendue = PropertiesService.getScriptProperties().getProperty("CLE");
  return !!attendue && cle === attendue;
}

// La cellule A1 de l'onglet « Repas » (créé s'il n'existe pas)
function cellule() {
  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  const feuille = classeur.getSheetByName(ONGLET) || classeur.insertSheet(ONGLET);
  return feuille.getRange("A1");
}

// Réponse JSON (Apps Script ajoute lui-même l'autorisation CORS)
function repondre(objet) {
  return ContentService.createTextOutput(JSON.stringify(objet))
    .setMimeType(ContentService.MimeType.JSON);
}
