/* ============================================================
   Cadeaux — script Google Apps Script
   Version 1.0.0
   ------------------------------------------------------------
   Garde les données de l'appli « Cadeaux » (baiji.fr/cadeaux/) : idées de
   cadeaux, Noëls, anniversaires. Les mêmes sur le téléphone ET sur le PC.
   (Parti du script « Mes projets », outils/projets.gs.)

   Pourquoi un Google Sheet et pas un fichier du dépôt ? Le dépôt GitHub
   est PUBLIC : tout ce qui y est écrit se lit par n'importe qui. Le Sheet,
   lui, reste dans le Drive de Seb, et le script exige une clé.

   DIFFÉRENCE avec « Mes projets » : l'historique des Noëls est gros (une
   centaine de milliers de caractères) alors qu'une cellule n'en accepte que
   50 000. Le texte JSON est donc DÉCOUPÉ en morceaux de 45 000 caractères,
   rangés l'un sous l'autre dans la colonne A de l'onglet « Cadeaux »
   (A1, A2, A3…). À la lecture, on recolle les morceaux dans l'ordre.

   INSTALLATION (une seule fois, ~5 min) :
    1. Ouvrir le Google Sheet « Cadeaux » (il contient déjà l'historique).
    2. Menu Extensions → Apps Script ; remplacer le code par ce fichier.
    3. Roue dentée « Paramètres du projet » → « Propriétés du script » →
       ajouter CLE = un mot de passe à toi (long, ex. « trois-mots-au-hasard-42 »).
    4. Bouton « Déployer » → « Nouveau déploiement » → type « Application web » :
         Exécuter en tant que : Moi
         Qui a accès : Tout le monde
       → autoriser, puis copier l'adresse qui finit par /exec.
    5. Dans l'appli : « Synchro » en bas de la page → coller l'adresse et la clé
       (ou donner l'adresse à Claude pour qu'il l'écrive dans CADEAUX_URL).
       Sur les autres appareils : baiji.fr/cadeaux/?cle=LA-CLE une fois.

   Pour modifier le script plus tard : « Déployer » → « Gérer les déploiements »
   → crayon → Version : « Nouvelle version » (l'adresse /exec ne change pas).

   Historique :
    • 1.0.0 : lecture (GET) et enregistrement (POST) protégés par la clé,
              données découpées en morceaux dans la colonne A
   ============================================================ */

const ONGLET = "Cadeaux";
const TAILLE_MORCEAU = 45000;   // marge sous la limite de 50 000 caractères d'une cellule
const MORCEAUX_MAX = 12;        // 12 × 45 000 = 540 000 caractères : très large

/* ---- Lecture : GET ?cle=… → { ok: true, etat: {...} | null } ---- */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!cleValide(p.cle)) return repondre({ ok: false, erreur: "clé incorrecte" });
  const texte = lireTexte();
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
  if (texte.length > TAILLE_MORCEAU * MORCEAUX_MAX) return repondre({ ok: false, erreur: "données trop grosses" });

  // Verrou : si deux téléphones enregistrent en même temps, ils passent l'un après l'autre
  const verrou = LockService.getScriptLock();
  verrou.waitLock(10000);
  try {
    ecrireTexte(texte);
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

// L'onglet « Cadeaux » (créé s'il n'existe pas)
function feuille() {
  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  return classeur.getSheetByName(ONGLET) || classeur.insertSheet(ONGLET);
}

// Recolle les morceaux de la colonne A, de haut en bas, jusqu'à la première cellule vide
function lireTexte() {
  const valeurs = feuille().getRange(1, 1, MORCEAUX_MAX, 1).getValues();
  let texte = "";
  for (const ligne of valeurs) {
    if (ligne[0] === "") break;
    texte += String(ligne[0]);
  }
  return texte;
}

// Découpe le texte en morceaux et les écrit en A1, A2… ; vide les anciennes cellules en trop
function ecrireTexte(texte) {
  const lignes = [];
  for (let debut = 0; debut < texte.length; debut += TAILLE_MORCEAU) {
    lignes.push([texte.slice(debut, debut + TAILLE_MORCEAU)]);
  }
  while (lignes.length < MORCEAUX_MAX) lignes.push([""]);
  const f = feuille();
  // Format « texte brut » : sans lui, Sheets pourrait lire un morceau comme une formule ou un nombre
  f.getRange(1, 1, MORCEAUX_MAX, 1).setNumberFormat("@").setValues(lignes);
  f.getRange("B1").setValue(new Date());   // B1 = date du dernier enregistrement
}

// Réponse JSON (Apps Script ajoute lui-même l'autorisation CORS)
function repondre(objet) {
  return ContentService.createTextOutput(JSON.stringify(objet))
    .setMimeType(ContentService.MimeType.JSON);
}
