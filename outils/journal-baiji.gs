/*
  ============================================================
  Google Apps Script « Journal baiji » — version 1.1.0 (05/11/2026)
  ------------------------------------------------------------
  Trois rôles :
   1. VISITES : chaque page de baiji.fr (via /journal.js) envoie ici
      un petit signal « page vue ». On l'ajoute à l'onglet « Visites ».
   2. SERVICES : toutes les 10 minutes, Google vérifie que le site et
      les sous-domaines du NAS répondent (onglet « Services ») et
      t'envoie un e-mail si l'un tombe en panne, puis quand il revient.
   3. STATS : la page https://baiji.fr/journal/ demande les chiffres
      (avec la clé de lecture) et le script les calcule.

  Ce qui est enregistré pour une visite : l'heure, la page, le type
  d'appareil et le navigateur (déduits du « user agent »), le site
  d'où l'on vient, et un identifiant ANONYME tiré au hasard dans le
  navigateur (pour compter les visiteurs différents). Jamais d'adresse
  IP (Apps Script ne la voit pas), ni de nom, ni de cookie tiers.
  Les visites sont effacées au bout de 13 mois, les vérifications
  de services au bout de 30 jours.

  INSTALLATION (une seule fois, sur ordinateur) :
   1. Créer un Google Sheet « Journal baiji », puis menu
      Extensions → Apps Script, et coller ce fichier à la place du code.
   2. Remplir les clés dans CLES, juste sous ce bloc (voir les
      explications là-bas). Le code collé dans Apps Script est privé :
      toi seul le vois.
      ⚠️ Ne JAMAIS remettre les vraies clés dans le fichier du dépôt
      GitHub (outils/journal-baiji.gs) : ce dépôt est public.
      (Autre possibilité : laisser CLES vide et mettre les mêmes noms
      dans « Paramètres du projet » → « Propriétés du script ».)
   3. En haut, choisir la fonction « installer » puis ▶ Exécuter :
      Google demande d'autoriser le script (feuilles, e-mail, accès
      internet) → accepter. Ça crée les onglets et les minuteries.
   4. « Déployer » → « Nouveau déploiement » → type « Application web » ;
      Exécuter en tant que : Moi ; Qui a accès : Tout le monde.
   5. Copier l'URL qui finit par /exec et la coller dans URL_JOURNAL
      du fichier /journal.js du site (ou la donner à Claude).
   À chaque modification du script : « Gérer les déploiements » →
   crayon → Version : « Nouvelle version » (sinon l'URL garde l'ancien code).

  Historique :
   • 1.0.0 : visites, surveillance des services avec alertes e-mail, stats
   • 1.1.0 : clés réglables directement dans le code (CLES), sinon propriétés du script
  ============================================================
*/

// ---------- Les clés ----------
// Deux « mots de passe » que ce script compare à ce qu'on lui envoie.
//
// • CLE_LECTURE — protège TES statistiques. La page baiji.fr/journal/
//   te la demande une fois, puis l'envoie à chaque lecture des chiffres.
//   Sans la bonne clé, le script répond « clé refusée » : un curieux qui
//   trouverait l'adresse /exec ne verrait rien. (Il pourrait seulement
//   ajouter de fausses visites, d'où les garde-fous plus bas.)
//   C'est toi qui la choisis : longue et sans sens, comme un mot de passe.
//
// • CLE_PRONOTE — FACULTATIVE. Ce n'est pas une clé à inventer : c'est la
//   clé d'accès du service Pronote de ton NAS, la même que celle tapée
//   dans l'appli Cartable (variable CLE_ACCES du fichier .env du projet
//   Container Manager « pronote »). Le script l'envoie dans l'en-tête
//   X-Cle pour vérifier que le service répond, exactement comme Cartable.
//   Laissée vide : Pronote n'est simplement pas surveillé. (Sans clé, une
//   vérification compterait comme une « clé fausse » et finirait par
//   bloquer le service 15 minutes.)
const CLES = {
  CLE_LECTURE: '',   // ← à remplir
  CLE_PRONOTE: ''    // ← facultatif
};

// Lit une clé : d'abord dans CLES ci-dessus, sinon dans les propriétés du script
function lireCle(nom) {
  return CLES[nom] || PropertiesService.getScriptProperties().getProperty(nom) || '';
}

// ---------- Réglages ----------

// Les services surveillés. « url » doit répondre avec un code HTTP 200 à 399.
// On choisit des adresses en LECTURE SEULE, qui ne déclenchent rien
// (pas de réveil de voiture, pas de connexion Pronote…).
const SERVICES = [
  { id: 'site',     nom: 'baiji.fr',            url: 'https://baiji.fr/' },
  { id: 'photos',   nom: 'Photos (Immich)',     url: 'https://photos.baiji.fr/api/server/ping' },
  { id: 'voitures', nom: 'Voitures',            url: 'https://voitures.baiji.fr/cars.json' },
  { id: 'biblio',   nom: 'Médiathèque',         url: 'https://biblio.baiji.fr/prets.json' },
  // Pronote : protégé par la clé du Cartable (CLE_PRONOTE dans CLES, envoyée
  // dans l'en-tête X-Cle). Sans clé, ce service est simplement ignoré.
  { id: 'pronote',  nom: 'Cartable (Pronote)',  url: 'https://pronote.baiji.fr/pronote.json', cle: 'CLE_PRONOTE' }
];

const ECHECS_AVANT_ALERTE = 2;     // 2 vérifications ratées d'affilée (≈ 20 min) avant l'e-mail
const JOURS_VISITES = 395;         // on garde les visites 13 mois…
const JOURS_SERVICES = 30;         // …et les vérifications 30 jours
const MAX_VISITES_PAR_JOUR = 5000; // garde-fou contre un robot qui inonderait le Sheet
const FUSEAU = 'Europe/Paris';

const ONGLET_VISITES = 'Visites';
const ONGLET_SERVICES = 'Services';
const ENTETES_VISITES = ['Date', 'Site', 'Page', 'Événement', 'Appareil', 'Navigateur', 'Installée', 'Source', 'Visiteur', 'Moi'];
const ENTETES_SERVICES = ['Date', 'Service', 'Code', 'Durée (ms)', 'OK'];


// ============================================================
// 0) INSTALLATION — à lancer une fois à la main (▶ Exécuter)
// ============================================================
function installer() {
  // Onglets avec leur ligne de titres (créés seulement s'ils manquent)
  preparerOnglet(ONGLET_VISITES, ENTETES_VISITES);
  preparerOnglet(ONGLET_SERVICES, ENTETES_SERVICES);

  // Minuteries : on supprime d'abord les anciennes pour ne pas les doubler
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('verifierServices').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('purger').timeBased().everyDays(1).atHour(4).create();

  verifierServices();   // une première vérification tout de suite
  Logger.log('Installé. Alertes envoyées à : ' + Session.getEffectiveUser().getEmail());
}

function preparerOnglet(nom, entetes) {
  const classeur = SpreadsheetApp.getActive();
  let onglet = classeur.getSheetByName(nom);
  if (!onglet) onglet = classeur.insertSheet(nom);
  if (onglet.getLastRow() === 0) {
    onglet.appendRow(entetes);
    onglet.setFrozenRows(1);                       // titres toujours visibles
    onglet.getRange(1, 1, 1, entetes.length).setFontWeight('bold');
  }
  return onglet;
}


// ============================================================
// 1) POINT D'ENTRÉE WEB
//    Apps Script appelle doGet à chaque requête vers l'URL /exec.
//    • ?t=v&…              → une visite à enregistrer (envoyée par journal.js)
//    • ?action=stats&cle=… → les chiffres pour la page Journal
//    • ?action=verifier&cle=… → vérifier les services tout de suite
// ============================================================
function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (p.t === 'v') return enregistrerVisite(p);

    // Les deux autres actions demandent la clé de lecture
    if (p.action === 'stats' || p.action === 'verifier') {
      if (!cleValide(p.cle)) return json({ ok: false, erreur: 'cle' });
      if (p.action === 'verifier') verifierServices();
      return json(calculerStats(p.moi === '1'));
    }
    return json({ ok: true, service: 'Journal baiji' });
  } catch (err) {
    console.error(err);
    return json({ ok: false, erreur: 'serveur' });
  }
}

// Réponse JSON (lisible depuis la page grâce aux règles CORS de Google)
function json(objet) {
  return ContentService.createTextOutput(JSON.stringify(objet))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Vérifie la clé de lecture, avec un frein contre ceux qui essaieraient
 * de la deviner : après 10 clés fausses dans l'heure, plus rien n'est
 * accepté pendant une heure (même la bonne).
 */
function cleValide(cle) {
  const attendue = lireCle('CLE_LECTURE');
  const cache = CacheService.getScriptCache();
  const essais = Number(cache.get('essais_faux') || 0);
  if (!attendue || essais >= 10) return false;
  if (cle === attendue) return true;
  cache.put('essais_faux', String(essais + 1), 3600);
  return false;
}


// ============================================================
// 2) ENREGISTRER UNE VISITE
// ============================================================
function enregistrerVisite(p) {
  // Garde-fou : nombre de lignes par jour (compteur dans le cache)
  const cache = CacheService.getScriptCache();
  const cleJour = 'visites_' + Utilities.formatDate(new Date(), FUSEAU, 'yyyyMMdd');
  const nb = Number(cache.get(cleJour) || 0);
  if (nb >= MAX_VISITES_PAR_JOUR) return json({ ok: false });
  cache.put(cleJour, String(nb + 1), 6 * 3600);

  const ua = String(p.ua || '');
  if (/bot|crawl|spider|slurp|preview|headless/i.test(ua)) return json({ ok: true }); // robots ignorés

  // On ne garde que des valeurs courtes et propres (personne ne peut
  // remplir le Sheet de n'importe quoi en appelant l'URL à la main)
  const page = nettoyer(p.page, 120);
  if (!page.startsWith('/')) return json({ ok: false });

  const appareil = deviner(ua, [
    [/smart-?tv|tizen|webos|googletv|android tv|bravia|aft[a-z]/i, 'TV'],
    [/ipad|tablet|(android(?!.*mobile))/i, 'Tablette'],
    [/mobi|iphone|android/i, 'Téléphone']
  ], 'Ordinateur');
  const navigateur = deviner(ua, [
    [/edg\//i, 'Edge'], [/samsungbrowser/i, 'Samsung'], [/firefox|fxios/i, 'Firefox'],
    [/opr\//i, 'Opera'], [/chrome|crios/i, 'Chrome'], [/safari/i, 'Safari']
  ], 'Autre');

  const onglet = SpreadsheetApp.getActive().getSheetByName(ONGLET_VISITES)
              || preparerOnglet(ONGLET_VISITES, ENTETES_VISITES);
  onglet.appendRow([
    new Date(),
    nettoyer(p.site, 20) || 'baiji',
    page,
    p.ev === 'ok' ? 'ok' : 'visite',        // « ok » = code de la serrure validé
    appareil,
    navigateur,
    p.app === '1' ? 'oui' : '',             // page ouverte comme appli installée (PWA)
    nettoyer(p.src, 60),                     // site d'où l'on vient (vide = direct)
    nettoyer(p.vid, 12),                     // identifiant anonyme du navigateur
    p.moi === '1' ? 'oui' : ''               // navigateur marqué « c'est moi »
  ]);
  return json({ ok: true });
}

function nettoyer(valeur, max) {
  return String(valeur || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
}

// Renvoie l'étiquette de la première règle (expression régulière) qui correspond
function deviner(texte, regles, parDefaut) {
  for (const [motif, etiquette] of regles) if (motif.test(texte)) return etiquette;
  return parDefaut;
}


// ============================================================
// 3) SURVEILLANCE DES SERVICES (minuterie toutes les 10 min)
// ============================================================
function verifierServices() {
  const props = PropertiesService.getScriptProperties();
  const onglet = SpreadsheetApp.getActive().getSheetByName(ONGLET_SERVICES)
              || preparerOnglet(ONGLET_SERVICES, ENTETES_SERVICES);
  const maintenant = new Date();
  const lignes = [];

  SERVICES.forEach(s => {
    // Service protégé sans clé renseignée : on ne le teste pas
    const entetes = {};
    if (s.cle) {
      const cle = lireCle(s.cle);
      if (!cle) return;
      entetes['X-Cle'] = cle;
    }

    // Requête chronométrée. muteHttpExceptions : une erreur 500 ne fait
    // pas planter le script, on lit simplement son code.
    const debut = Date.now();
    let code = 0;   // 0 = pas de réponse du tout (serveur injoignable, délai dépassé…)
    try {
      code = UrlFetchApp.fetch(s.url, {
        headers: entetes, muteHttpExceptions: true, followRedirects: true,
        validateHttpsCertificates: true          // un certificat expiré = panne
      }).getResponseCode();
    } catch (err) { code = 0; }
    const duree = Date.now() - debut;
    const ok = code >= 200 && code < 400;
    lignes.push([maintenant, s.id, code, duree, ok ? 1 : 0]);

    // --- Alertes : on compte les échecs d'affilée ---
    const cleEchecs = 'echecs_' + s.id, cleEtat = 'etat_' + s.id;
    const echecs = ok ? 0 : Number(props.getProperty(cleEchecs) || 0) + 1;
    props.setProperty(cleEchecs, String(echecs));
    const etatAvant = props.getProperty(cleEtat) || 'ok';

    if (!ok && echecs >= ECHECS_AVANT_ALERTE && etatAvant !== 'panne') {
      props.setProperty(cleEtat, 'panne');
      props.setProperty('depuis_' + s.id, maintenant.toISOString());
      alerter('🔴 ' + s.nom + ' ne répond plus',
        s.nom + ' (' + s.url + ') ne répond plus depuis environ ' + (echecs * 10) + ' minutes.\n' +
        'Dernier code : ' + (code || 'aucune réponse') + '.\n\nSuivi : https://baiji.fr/journal/');
    } else if (ok && etatAvant === 'panne') {
      props.setProperty(cleEtat, 'ok');
      props.setProperty('depuis_' + s.id, maintenant.toISOString());
      alerter('🟢 ' + s.nom + ' répond à nouveau',
        s.nom + ' (' + s.url + ') répond de nouveau (code ' + code + ', ' + duree + ' ms).');
    }
  });

  // Une seule écriture pour toutes les lignes (bien plus rapide que appendRow ×5)
  if (lignes.length) {
    onglet.getRange(onglet.getLastRow() + 1, 1, lignes.length, lignes[0].length).setValues(lignes);
  }
  CacheService.getScriptCache().remove('stats_0');   // les stats en cache sont périmées
  CacheService.getScriptCache().remove('stats_1');
}

function alerter(sujet, texte) {
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), sujet, texte);
}


// ============================================================
// 4) MÉNAGE (minuterie chaque nuit à 4 h)
//    Les lignes sont ajoutées dans l'ordre chronologique : les plus
//    anciennes sont en haut, on supprime donc un bloc au début.
// ============================================================
function purger() {
  purgerOnglet(ONGLET_VISITES, JOURS_VISITES);
  purgerOnglet(ONGLET_SERVICES, JOURS_SERVICES);
}

function purgerOnglet(nom, jours) {
  const onglet = SpreadsheetApp.getActive().getSheetByName(nom);
  if (!onglet || onglet.getLastRow() < 2) return;
  const limite = Date.now() - jours * 864e5;
  const dates = onglet.getRange(2, 1, onglet.getLastRow() - 1, 1).getValues();
  let n = 0;
  while (n < dates.length && new Date(dates[n][0]).getTime() < limite) n++;
  if (n > 0) onglet.deleteRows(2, n);
}


// ============================================================
// 5) STATISTIQUES pour la page baiji.fr/journal/
//    sansMoi = true → on retire les visites des navigateurs « c'est moi ».
//    Résultat gardé 2 minutes en cache pour aller vite.
// ============================================================
function calculerStats(sansMoi) {
  const cache = CacheService.getScriptCache();
  const cleCache = 'stats_' + (sansMoi ? 1 : 0);
  const enCache = cache.get(cleCache);
  if (enCache) return JSON.parse(enCache);

  const resultat = {
    ok: true,
    maj: new Date().toISOString(),
    visites: statsVisites(sansMoi),
    services: statsServices()
  };
  try { cache.put(cleCache, JSON.stringify(resultat), 120); } catch (e) { /* trop gros pour le cache : tant pis */ }
  return resultat;
}

function lireOnglet(nom) {
  const onglet = SpreadsheetApp.getActive().getSheetByName(nom);
  if (!onglet || onglet.getLastRow() < 2) return [];
  return onglet.getRange(2, 1, onglet.getLastRow() - 1, onglet.getLastColumn()).getValues();
}

const jourDe = d => Utilities.formatDate(new Date(d), FUSEAU, 'yyyy-MM-dd');

function statsVisites(sansMoi) {
  const limite = Date.now() - 30 * 864e5;
  // Colonnes : 0 Date, 1 Site, 2 Page, 3 Événement, 4 Appareil, 5 Navigateur,
  //            6 Installée, 7 Source, 8 Visiteur, 9 Moi
  const lignes = lireOnglet(ONGLET_VISITES)
    .filter(l => l[3] === 'visite' && new Date(l[0]).getTime() >= limite)
    .filter(l => !(sansMoi && l[9] === 'oui'));

  // Compteur générique : clé → { vues, visiteurs (ensemble d'id) }
  const compter = (cleDe) => {
    const m = {};
    lignes.forEach(l => {
      const k = cleDe(l) || '—';
      (m[k] = m[k] || { vues: 0, ids: {} }).vues++;
      m[k].ids[l[8] || ('?' + l[0])] = 1;
    });
    return Object.keys(m)
      .map(k => ({ nom: k, vues: m[k].vues, visiteurs: Object.keys(m[k].ids).length }))
      .sort((a, b) => b.vues - a.vues);
  };

  // 30 jours, y compris les jours sans visite (pour un graphique continu)
  const parJour = {};
  compter(l => jourDe(l[0])).forEach(j => parJour[j.nom] = j);
  const jours = [];
  for (let i = 29; i >= 0; i--) {
    const j = jourDe(Date.now() - i * 864e5);
    jours.push({ date: j, vues: parJour[j] ? parJour[j].vues : 0, visiteurs: parJour[j] ? parJour[j].visiteurs : 0 });
  }

  const ids = {};
  lignes.forEach(l => ids[l[8] || ('?' + l[0])] = 1);
  const ajd = jourDe(new Date());

  return {
    total: { vues: lignes.length, visiteurs: Object.keys(ids).length },
    aujourdhui: parJour[ajd] ? { vues: parJour[ajd].vues, visiteurs: parJour[ajd].visiteurs } : { vues: 0, visiteurs: 0 },
    installees: lignes.filter(l => l[6] === 'oui').length,
    jours,
    pages: compter(l => l[2]).slice(0, 40),
    appareils: compter(l => l[4]),
    navigateurs: compter(l => l[5]),
    sources: compter(l => l[7] || 'Accès direct').slice(0, 10),
    dernieres: lignes.slice(-40).reverse().map(l => ({
      date: new Date(l[0]).toISOString(), page: l[2], appareil: l[4],
      navigateur: l[5], app: l[6] === 'oui', source: l[7], moi: l[9] === 'oui'
    }))
  };
}

function statsServices() {
  const props = PropertiesService.getScriptProperties();
  const lignes = lireOnglet(ONGLET_SERVICES);   // 0 Date, 1 Service, 2 Code, 3 Durée, 4 OK
  const maintenant = Date.now();

  return SERVICES.map(s => {
    const miennes = lignes.filter(l => l[1] === s.id);
    if (s.cle && !lireCle(s.cle)) {
      return { id: s.id, nom: s.nom, url: s.url, etat: 'non-verifie' };
    }
    if (!miennes.length) return { id: s.id, nom: s.nom, url: s.url, etat: 'inconnu' };

    const derniere = miennes[miennes.length - 1];
    // Disponibilité = part des vérifications réussies sur la période
    const dispo = heures => {
      const p = miennes.filter(l => maintenant - new Date(l[0]).getTime() <= heures * 3600e3);
      return p.length ? Math.round(1000 * p.filter(l => l[4] == 1).length / p.length) / 10 : null;
    };
    // 24 barres = les 24 dernières heures ; chaque barre = part de réussite dans l'heure
    const barres = [];
    for (let h = 23; h >= 0; h--) {
      const debut = maintenant - (h + 1) * 3600e3, fin = maintenant - h * 3600e3;
      const p = miennes.filter(l => { const t = new Date(l[0]).getTime(); return t > debut && t <= fin; });
      barres.push(p.length ? p.filter(l => l[4] == 1).length / p.length : null);
    }
    const recentes = miennes.slice(-6).filter(l => l[4] == 1);   // temps de réponse moyen récent

    return {
      id: s.id, nom: s.nom, url: s.url,
      etat: props.getProperty('etat_' + s.id) === 'panne' ? 'panne'
          : (derniere[4] == 1 ? 'ok' : 'alerte'),        // « alerte » = 1 échec, pas encore confirmé
      code: derniere[2],
      ms: recentes.length ? Math.round(recentes.reduce((a, l) => a + Number(l[3]), 0) / recentes.length) : null,
      verifie: new Date(derniere[0]).toISOString(),
      depuis: props.getProperty('depuis_' + s.id),
      dispo24: dispo(24), dispo7j: dispo(24 * 7),
      barres
    };
  });
}
