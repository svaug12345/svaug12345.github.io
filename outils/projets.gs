/* ============================================================
   Mes projets — script Google Apps Script
   Version 1.0.0
   ------------------------------------------------------------
   Garde la liste de l'appli « Mes projets » (baiji.fr/projets/) pour
   retrouver les mêmes projets et idées sur le téléphone ET sur le PC.
   (Copie du script « Repas famille », outils/repas.gs.)

   Pourquoi un Google Sheet et pas un fichier du dépôt ? Le dépôt GitHub
   est PUBLIC : tout ce qui y est écrit se lit par n'importe qui. Le Sheet,
   lui, reste dans le Drive de Seb, et le script exige une clé.

   Tout tient dans UNE cellule (A1 de l'onglet « Projets ») : un texte JSON
   avec tous les projets. Une cellule accepte 50 000 caractères : de quoi
   noter plusieurs centaines de projets et d'idées.

   INSTALLATION (une seule fois, ~5 min) :
    1. Créer un Google Sheet vide, par ex. « Mes projets ».
    2. Menu Extensions → Apps Script ; remplacer le code par ce fichier.
    3. Roue dentée « Paramètres du projet » → « Propriétés du script » →
       ajouter CLE = un mot de passe à toi (long, ex. « trois-mots-au-hasard-42 »).
    4. Bouton « Déployer » → « Nouveau déploiement » → type « Application web » :
         Exécuter en tant que : Moi
         Qui a accès : Tout le monde
       → autoriser, puis copier l'adresse qui finit par /exec.
    5. Coller cette adresse dans PROJETS_URL de projets/index.html (ou la donner à Claude).
    6. Sur chaque appareil : ouvrir baiji.fr/projets/?cle=LA-CLE une fois
       (ou toucher « Synchro » en bas de la page et taper la clé).

   Pour modifier le script plus tard : « Déployer » → « Gérer les déploiements »
   → crayon → Version : « Nouvelle version » (l'adresse /exec ne change pas).

   Historique :
    • 1.0.0 : lecture (GET) et enregistrement (POST) protégés par la clé
   ============================================================ */

const ONGLET = "Projets";
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

// La cellule A1 de l'onglet « Projets » (créé s'il n'existe pas)
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
