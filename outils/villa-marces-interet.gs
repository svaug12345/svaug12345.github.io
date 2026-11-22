/* ============================================================
   7 villa Marcès — « Être prévenu de l'ouverture de la vente »
   Script Google Apps Script — Version 1.2.0 (22/11/2026)
   ------------------------------------------------------------
   Reçoit le formulaire de la page https://baiji.fr/villa-marces/#interet :
    • range chaque demande dans l'onglet « Intéressés » du Google Sheet,
    • envoie un courriel d'alerte à Seb (« Répondre » écrit directement
      à la personne intéressée).
   Reçoit aussi les pages vues du site (villa-marces/visites.js) :
    • une ligne par page ouverte dans l'onglet « Visites » (pas de courriel),
    • visites de plus de 13 mois effacées automatiquement.

   Aucune adresse n'est écrite dans ce fichier (le dépôt est PUBLIC) :
   le courriel part vers le propriétaire du script, c'est-à-dire le compte
   Google qui le déploie. Pour prévenir d'autres personnes en plus, ajouter
   la propriété du script DESTINATAIRES = "a@exemple.fr, b@exemple.fr".

   INSTALLATION (une seule fois, ~5 min, depuis un ordinateur) :
    1. Créer un Google Sheet vide, par ex. « 7 villa Marcès – intéressés ».
    2. Menu Extensions → Apps Script ; remplacer le code par ce fichier ; enregistrer.
    3. En haut, choisir la fonction « testerAlerte » puis « Exécuter » :
       Google demande l'autorisation (envoyer des courriels, modifier le Sheet)
       → accepter. Un courriel de test arrive : tout est branché.
    4. Bouton « Déployer » → « Nouveau déploiement » → type « Application web » :
         Exécuter en tant que : Moi
         Qui a accès : Tout le monde
       → copier l'adresse qui finit par /exec.
    5. Coller cette adresse dans INTERET_URL de villa-marces/index.html
       (ou la donner à Claude). Le formulaire apparaît alors sur la page.

   Pour modifier le script plus tard : « Déployer » → « Gérer les déploiements »
   → crayon → Version : « Nouvelle version » (l'adresse /exec ne change pas).

   Historique :
    • 1.0.0 : enregistrement dans le Sheet + courriel d'alerte ; champ piège
              anti-robots, 60 demandes par jour au maximum, doublons ignorés
    • 1.1.0 : profil obligatoire « Particulier » / « Professionnel » (agence ou
              professionnel de l'immobilier) + nom de l'agence ; colonnes « Profil »
              et « Agence » dans le Sheet, profil dans l'objet du courriel.
              Un Sheet déjà créé en 1.0.0 : supprimer l'onglet « Intéressés »
              (il est recréé avec les bonnes colonnes) ou y insérer ces colonnes.
    • 1.2.0 : onglet « Visites » (page, ancre, provenance, appareil, navigateur,
              écran, langue, visiteur anonyme, première visite, moi) ; 5 000 pages
              vues par jour au maximum ; effacement des visites de plus de 13 mois.
              Mise à jour depuis la 1.1.0 : coller ce code, enregistrer, puis
              « Gérer les déploiements » → crayon → « Nouvelle version ».
   ============================================================ */

const ONGLET = "Intéressés";
const ENTETES = ["Reçu le", "Profil", "Agence", "Nom", "Courriel", "Téléphone", "Commentaire", "Accord", "Page"];
const PROFILS = { particulier: "Particulier", professionnel: "Professionnel" };
const ONGLET_VISITES = "Visites";
const ENTETES_VISITES = ["Date", "Page", "Ancre", "Provenance", "Appareil", "Navigateur", "Écran",
                         "Langue", "Visiteur", "Première visite", "Moi"];
const MAX_VISITES_PAR_JOUR = 5000;  // garde-fou contre un robot qui enverrait de fausses visites
const MOIS_GARDES = 13;             // durée de conservation des visites
const MAX_PAR_JOUR = 60;          // garde-fou : au-delà, on refuse (robot probable)
const LONGUEURS = { agence: 120, nom: 120, courriel: 160, telephone: 40, message: 1500 };

/* ---- Petit test depuis le navigateur : ouvrir l'adresse /exec doit afficher « ok » ---- */
function doGet() {
  return repondre({ ok: true, service: "villa-marces-interet", version: "1.2.0" });
}

/* ---- Le formulaire : POST (texte JSON) {profil, agence, nom, courriel, telephone, message, accord, site, page} ----
   La page envoie en « text/plain » (évite une vérification CORS que Apps Script
   ne sait pas traiter) : on lit donc e.postData.contents à la main. */
function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); }
  catch (err) { return repondre({ ok: false, erreur: "requête illisible" }); }

  // Page vue envoyée par visites.js : rangée à part, sans courriel
  if (d.type === "visite") return noterVisite(d);

  // Champ piège : invisible pour un humain, rempli par les robots → on fait semblant d'accepter
  if (d.site) return repondre({ ok: true });

  // Nettoyage : texte simple, longueur limitée
  const f = {};
  Object.keys(LONGUEURS).forEach(k => { f[k] = String(d[k] || "").trim().slice(0, LONGUEURS[k]); });
  f.courriel = f.courriel.toLowerCase();
  f.profil = PROFILS[d.profil] || "";
  if (f.profil !== "Professionnel") f.agence = "";

  if (!f.profil) return repondre({ ok: false, erreur: "Merci d'indiquer si vous êtes un particulier ou un professionnel." });
  if (!f.nom) return repondre({ ok: false, erreur: "Merci d'indiquer votre nom." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.courriel)) return repondre({ ok: false, erreur: "Adresse de courriel incorrecte." });
  if (d.accord !== true) return repondre({ ok: false, erreur: "Merci de cocher la case d'accord." });

  // Même personne qui renvoie le formulaire dans les 10 minutes : on ne double pas
  const cache = CacheService.getScriptCache();
  const cleDoublon = "deja-" + f.courriel;
  if (cache.get(cleDoublon)) return repondre({ ok: true, doublon: true });

  // Verrou : deux demandes simultanées passent l'une après l'autre
  const verrou = LockService.getScriptLock();
  verrou.waitLock(10000);
  try {
    // Garde-fou du nombre de demandes par jour (compteur dans les propriétés du script)
    const props = PropertiesService.getScriptProperties();
    const jour = Utilities.formatDate(new Date(), "Europe/Paris", "yyyy-MM-dd");
    const compte = props.getProperty("jour") === jour ? Number(props.getProperty("compte") || 0) : 0;
    if (compte >= MAX_PAR_JOUR) return repondre({ ok: false, erreur: "Trop de demandes aujourd'hui, réessayez demain." });
    props.setProperties({ jour: jour, compte: String(compte + 1) });

    const feuille = onglet();
    feuille.appendRow([new Date(), f.profil, sur(f.agence), sur(f.nom), sur(f.courriel), sur(f.telephone), sur(f.message),
                       "oui", sur(String(d.page || "").slice(0, 200))]);
    const total = feuille.getLastRow() - 1;     // moins la ligne des titres

    alerter(f, total);
    cache.put(cleDoublon, "1", 600);
    return repondre({ ok: true });
  } finally {
    verrou.releaseLock();
  }
}

/* ---- Une page vue → une ligne dans l'onglet « Visites » ---- */
function noterVisite(d) {
  const t = (v, n) => sur(String(v || "").trim().slice(0, n));
  const verrou = LockService.getScriptLock();
  verrou.waitLock(10000);
  try {
    const props = PropertiesService.getScriptProperties();
    const jour = Utilities.formatDate(new Date(), "Europe/Paris", "yyyy-MM-dd");
    const nouveauJour = props.getProperty("visitesJour") !== jour;
    const compte = nouveauJour ? 0 : Number(props.getProperty("visitesCompte") || 0);
    if (compte >= MAX_VISITES_PAR_JOUR) return repondre({ ok: false });
    props.setProperties({ visitesJour: jour, visitesCompte: String(compte + 1) });

    const feuille = ongletVisites();
    if (nouveauJour) purgerVisites(feuille);     // une fois par jour suffit
    feuille.appendRow([new Date(), t(d.page, 80), t(d.ancre, 40), t(d.source, 120), t(d.appareil, 20),
                       t(d.navigateur, 20), t(d.ecran, 20), t(d.langue, 10), t(d.visiteur, 12),
                       d.premiere === true ? "oui" : "non", d.moi === true ? "oui" : ""]);
    return repondre({ ok: true });
  } finally {
    verrou.releaseLock();
  }
}

// Efface les visites de plus de MOIS_GARDES mois (les plus anciennes sont en haut)
function purgerVisites(feuille) {
  const n = feuille.getLastRow() - 1;
  if (n < 1) return;
  const limite = new Date();
  limite.setMonth(limite.getMonth() - MOIS_GARDES);
  const dates = feuille.getRange(2, 1, n, 1).getValues();
  let vieilles = 0;
  while (vieilles < n && dates[vieilles][0] instanceof Date && dates[vieilles][0] < limite) vieilles++;
  if (vieilles) feuille.deleteRows(2, vieilles);
}

/* ---- Le courriel d'alerte ---- */
function alerter(f, total) {
  const pro = f.profil === "Professionnel";
  const lignes = [
    ["Profil", pro ? "Agence / professionnel de l'immobilier" : "Particulier"]
  ].concat(pro ? [["Agence", f.agence || "—"]] : []).concat([
    ["Nom", f.nom],
    ["Courriel", f.courriel],
    ["Téléphone", f.telephone || "—"],
    ["Commentaire", f.message || "—"]
  ]);
  const html =
    '<div style="font-family:Arial,sans-serif;font-size:15px;color:#1e2a26">' +
    '<p style="font-size:18px;margin:0 0 12px"><b>Une nouvelle personne est intéressée par le 7 villa Marcès</b></p>' +
    '<table style="border-collapse:collapse">' +
    lignes.map(([t, v]) =>
      '<tr><td style="padding:6px 14px 6px 0;color:#55635d;vertical-align:top">' + t + '</td>' +
      '<td style="padding:6px 0;white-space:pre-wrap">' + echapper(v) + '</td></tr>').join("") +
    '</table>' +
    '<p style="margin:16px 0 0;color:#55635d">Elle souhaite être recontactée à l\'ouverture de la vente. ' +
    'Répondre à ce courriel lui écrit directement.<br>' +
    'Personnes inscrites jusqu\'ici : <b>' + total + '</b> — liste complète : ' +
    '<a href="' + SpreadsheetApp.getActiveSpreadsheet().getUrl() + '">le Google Sheet</a>.</p></div>';

  MailApp.sendEmail({
    to: destinataires(),
    replyTo: f.courriel,
    name: "7 villa Marcès",
    subject: "🏠 7 villa Marcès : " + f.nom + (pro ? " (professionnel" + (f.agence ? ", " + f.agence : "") + ")" : " (particulier)") +
             " est intéressé(e)",
    body: lignes.map(([t, v]) => t + " : " + v).join("\n") + "\n\nInscrits jusqu'ici : " + total,
    htmlBody: html
  });
}

/* ---- À lancer à la main une fois (étape 3) : autorise le script et envoie un courriel de test ---- */
function testerAlerte() {
  onglet();   // crée l'onglet tout de suite
  ongletVisites();
  alerter({ profil: "Professionnel", agence: "Agence test", nom: "Test (à ignorer)", courriel: Session.getEffectiveUser().getEmail(),
            telephone: "06 00 00 00 00", message: "Ceci est un essai du formulaire." }, onglet().getLastRow() - 1);
}

/* ============ Petits outils ============ */

// Destinataires : le propriétaire du script, plus DESTINATAIRES si la propriété existe
function destinataires() {
  const plus = PropertiesService.getScriptProperties().getProperty("DESTINATAIRES") || "";
  return [Session.getEffectiveUser().getEmail()].concat(plus.split(",")).map(s => s.trim()).filter(Boolean).join(",");
}

// L'onglet « Intéressés », créé avec sa ligne de titres s'il n'existe pas encore
function onglet() {
  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  let f = classeur.getSheetByName(ONGLET);
  if (!f) {
    f = classeur.insertSheet(ONGLET);
    f.appendRow(ENTETES);
    f.getRange(1, 1, 1, ENTETES.length).setFontWeight("bold");
    f.setFrozenRows(1);
  }
  return f;
}

// L'onglet « Visites », créé avec sa ligne de titres s'il n'existe pas encore
function ongletVisites() {
  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  let f = classeur.getSheetByName(ONGLET_VISITES);
  if (!f) {
    f = classeur.insertSheet(ONGLET_VISITES);
    f.appendRow(ENTETES_VISITES);
    f.getRange(1, 1, 1, ENTETES_VISITES.length).setFontWeight("bold");
    f.setFrozenRows(1);
  }
  return f;
}

// Un texte qui commence par = + - @ serait pris pour une formule par le Sheet : on le neutralise
function sur(texte) { return /^[=+\-@]/.test(texte) ? "'" + texte : texte; }

// Caractères spéciaux du HTML, pour que le message s'affiche tel quel dans le courriel
function echapper(t) {
  return String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function repondre(objet) {
  return ContentService.createTextOutput(JSON.stringify(objet)).setMimeType(ContentService.MimeType.JSON);
}
