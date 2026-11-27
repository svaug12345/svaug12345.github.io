/* ============================================================
   Mes projets — script Google Apps Script
   Version 1.1.1
   ------------------------------------------------------------
   Relie la page « Mes projets » (baiji.fr/projets/) au Google Sheet
   « Mes projets » du Drive de Seb : les mêmes projets et idées sur le
   téléphone, sur le PC… et lisibles par Claude (connecteur Google Sheets).

   Pourquoi un Google Sheet et pas un fichier du dépôt ? Le dépôt GitHub
   est PUBLIC : tout ce qui y est écrit se lit par n'importe qui. Le Sheet,
   lui, reste privé dans le Drive, et le script exige une clé.

   LE TABLEAU (onglet « Projets ») : UNE LIGNE PAR PROJET, lisible à l'œil
   et modifiable à la main :
     id | Nom | Catégorie | Statut | Priorité | Notes | Lien | Créé | Modifié
   • id        : identifiant fixe (ne pas le changer, la page s'en sert) ;
                 une ligne ajoutée à la main sans id en reçoit un tout seul ;
   • Catégorie : Pro / Perso / Louise ;
   • Statut    : En cours, À finaliser, À commencer, En pause, À vérifier,
                 Idée, Terminé (écrits en clair : le script les traduit en
                 codes pour la page, voir STATUTS) ;
   • Priorité  : P1, P2, P3 ou vide ; dates au format AAAA-MM-JJ.

   La page, elle, échange toujours le même « état » JSON qu'avec la v1.0.0
   ({projets: {id: {nom, cat, statut, prio, note, lien, cree, maj}}}) :
   c'est ce script qui fait la traduction tableau ↔ JSON.

   INSTALLATION (une seule fois) — le script doit être LIÉ au Sheet :
    • avec Clasp, depuis un dossier vide :
        clasp create --title "Mes projets" --parentId <ID du Sheet>
        (copier ce fichier en Code.js + appsscript.json) puis clasp push ;
    • ou à la main : ouvrir le Sheet → Extensions → Apps Script → coller.
    Puis : Paramètres du projet → Propriétés du script → CLE = un mot de passe
    (et, si le script n'est pas lié au Sheet, SHEET_ID = l'identifiant du Sheet,
    la longue suite de caractères de son adresse entre /d/ et /edit) ;
    Déployer → Nouveau déploiement → Application web (Exécuter en tant que :
    Moi ; Accès : Tout le monde) → copier l'adresse /exec dans PROJETS_URL
    de projets/index.html. Sur chaque appareil : baiji.fr/projets/?cle=LA-CLE.

   Historique :
    • 1.0.0 : tout l'état en JSON dans la cellule A1 (copie de repas.gs)
    • 1.1.0 : un vrai tableau, une ligne par projet (lisible et modifiable
              à la main, lisible par Claude)
    • 1.1.1 : le Sheet peut aussi être ouvert par son identifiant (propriété
              SHEET_ID) quand le script n'est pas lié au Sheet
   ============================================================ */

const ONGLET = "Projets";
const COLONNES = ["id", "Nom", "Catégorie", "Statut", "Priorité", "Notes", "Lien", "Créé", "Modifié"];

/* Traductions texte du tableau ↔ code de la page */
const STATUTS = {
  "À finaliser": "a-finaliser", "En cours": "en-cours", "À commencer": "a-commencer",
  "En pause": "en-pause", "À vérifier": "a-verifier", "Idée": "idee", "Terminé": "termine",
};
const CATEGORIES = { "Pro": "pro", "Perso": "perso", "Louise": "louise" };

/* ---- Lecture : GET ?cle=… → { ok: true, etat: {...} } ---- */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!cleValide(p.cle)) return repondre({ ok: false, erreur: "clé incorrecte" });
  return repondre({ ok: true, etat: lireTableau() });
}

/* ---- Enregistrement : POST {cle, etat} → { ok: true } ----
   La page envoie en « text/plain » (sinon Apps Script refuse la requête
   de vérification CORS) : on lit donc e.postData.contents à la main. */
function doPost(e) {
  let corps;
  try { corps = JSON.parse(e.postData.contents); }
  catch (err) { return repondre({ ok: false, erreur: "requête illisible" }); }

  if (!cleValide(corps.cle)) return repondre({ ok: false, erreur: "clé incorrecte" });
  if (!corps.etat || typeof corps.etat !== "object" || !corps.etat.projets) {
    return repondre({ ok: false, erreur: "données manquantes" });
  }

  // Verrou : si deux appareils enregistrent en même temps, ils passent l'un après l'autre
  const verrou = LockService.getScriptLock();
  verrou.waitLock(10000);
  try { ecrireTableau(corps.etat.projets); }
  finally { verrou.releaseLock(); }
  return repondre({ ok: true });
}

/* ---- Tableau → état de la page ---- */
function lireTableau() {
  const f = feuille();
  const lignes = f.getDataRange().getValues().slice(1);   // on saute la ligne d'en-tête
  const projets = {};
  let idsAjoutes = false;

  lignes.forEach(function (l, i) {
    const nom = texte(l[1]);
    if (!nom) return;                       // ligne vide : ignorée
    let id = texte(l[0]);
    if (!id) {                              // ligne ajoutée à la main : on lui donne un id
      id = slug(nom) + "-" + Math.random().toString(36).slice(2, 6);
      f.getRange(i + 2, 1).setValue(id);
      idsAjoutes = true;
    }
    projets[id] = {
      nom: nom,
      cat: CATEGORIES[texte(l[2])] || "perso",
      statut: STATUTS[texte(l[3])] || "en-cours",
      prio: texte(l[4]).toUpperCase(),
      note: texte(l[5]),
      lien: texte(l[6]),
      cree: date(l[7]),
      maj: date(l[8]),
    };
  });
  if (idsAjoutes) SpreadsheetApp.flush();
  // depart: 1 = la page ne remet jamais sa liste de départ par-dessus
  return { projets: projets, depart: 1 };
}

/* ---- État de la page → tableau (réécrit en entier, trié) ---- */
function ecrireTableau(projets) {
  const versTexte = inverser(STATUTS), versCat = inverser(CATEGORIES);
  const ordreStatut = Object.keys(STATUTS);              // ordre d'affichage des statuts
  const ordreCat = Object.keys(CATEGORIES);
  const rang = function (prio) { return prio ? ["P1", "P2", "P3"].indexOf(prio) : 9; };

  const lignes = Object.keys(projets).map(function (id) {
    const p = projets[id];
    return [id, p.nom || "", versCat[p.cat] || "Perso", versTexte[p.statut] || "En cours",
            p.prio || "", p.note || "", p.lien || "", p.cree || "", p.maj || ""];
  });
  // Tri : catégorie, puis statut, puis priorité, puis nom
  lignes.sort(function (a, b) {
    return ordreCat.indexOf(a[2]) - ordreCat.indexOf(b[2])
        || ordreStatut.indexOf(a[3]) - ordreStatut.indexOf(b[3])
        || rang(a[4]) - rang(b[4])
        || a[1].localeCompare(b[1], "fr");
  });

  const f = feuille();
  const dernier = f.getLastRow();
  if (dernier > 1) f.getRange(2, 1, dernier - 1, COLONNES.length).clearContent();
  if (lignes.length) {
    const zone = f.getRange(2, 1, lignes.length, COLONNES.length);
    zone.offset(0, 7, lignes.length, 2).setNumberFormat("@");   // dates gardées en texte
    zone.setValues(lignes);
  }
}

/* ---- Petits outils ---- */

// Compare la clé reçue à la propriété CLE du script
function cleValide(cle) {
  const attendue = PropertiesService.getScriptProperties().getProperty("CLE");
  return !!attendue && cle === attendue;
}

// L'onglet « Projets » (créé avec son en-tête s'il n'existe pas)
function feuille() {
  // Script lié au Sheet : getActiveSpreadsheet() le donne. Sinon (script autonome),
  // on l'ouvre par son identifiant, rangé dans la propriété SHEET_ID — pas dans ce
  // fichier, qui est public.
  const id = PropertiesService.getScriptProperties().getProperty("SHEET_ID");
  const classeur = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  let f = classeur.getSheetByName(ONGLET);
  if (!f) {
    f = classeur.insertSheet(ONGLET);
    f.appendRow(COLONNES);
    f.setFrozenRows(1);
  }
  return f;
}

// Valeur de cellule → texte propre
function texte(v) { return v === null || v === undefined ? "" : String(v).trim(); }

// Une date tapée à la main devient un objet Date dans Sheets : on la remet en AAAA-MM-JJ
function date(v) {
  if (v instanceof Date) return Utilities.formatDate(v, "Europe/Paris", "yyyy-MM-dd");
  return texte(v);
}

// « Électronique ESP32 » → « electronique-esp32 »
function slug(t) {
  return t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
          .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "projet";
}

// {"En cours": "en-cours"} → {"en-cours": "En cours"}
function inverser(o) {
  const r = {};
  Object.keys(o).forEach(function (k) { r[o[k]] = k; });
  return r;
}

// Réponse JSON (Apps Script ajoute lui-même l'autorisation CORS)
function repondre(objet) {
  return ContentService.createTextOutput(JSON.stringify(objet))
    .setMimeType(ContentService.MimeType.JSON);
}
