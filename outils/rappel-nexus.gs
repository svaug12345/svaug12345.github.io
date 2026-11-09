/*
  ============================================================
  Google Apps Script « Rappel Nexus » — version 1.2.0 (09/11/2026)
  ------------------------------------------------------------
  Rôle : relais entre la page https://baiji.fr/assistant-nexus/
  et ElevenLabs. Quand un partenaire remplit « Vous préférez être
  rappelé ? », la page envoie le formulaire ICI ; le script vérifie
  la demande puis demande à ElevenLabs d'appeler la personne avec
  l'agent « Rappel Nexus B2B » (depuis le numéro Twilio).

  Pourquoi un relais ? La clé API ElevenLabs ne doit JAMAIS être
  dans la page web (n'importe qui pourrait la lire). Ici, elle est
  rangée dans les « Propriétés du script », invisibles du public.

  INSTALLATION (une seule fois) :
   1. Créer un Google Sheet « Rappels Nexus » (il servira de journal),
      puis menu Extensions → Apps Script, et coller ce fichier.
   2. Engrenage « Paramètres du projet » → « Propriétés du script » →
      ajouter ELEVENLABS_KEY = votre clé API ElevenLabs
      (droits nécessaires : agents conversationnels).
   3. « Déployer » → « Nouveau déploiement » → type « Application web » ;
      Exécuter en tant que : Moi ; Qui a accès : Tout le monde.
   4. Copier l'URL qui finit par /exec dans RAPPEL_URL de la page.
   À chaque modification du script : « Gérer les déploiements » →
   crayon → Version : « Nouvelle version » (sinon l'URL garde l'ancien code).

  Historique :
   • 1.0.0 : première version (horaires, limites, journal, appel ElevenLabs)
   • 1.1.0 : jusqu'à 5 demandes par numéro et par heure (au lieu d'une), pour les tests
   • 1.2.0 : second mode « prospection » (page baiji.fr/prospection-nexus/) : la page
             envoie type=prospection + le seul numéro de téléphone, et le script fait
             appeler la personne par l'agent « Équipe Nexus – Prospection fournisseurs »
             (Philippe, Thomas, Zeineb). Mêmes garde-fous (horaires, limites, journal).
  ============================================================
*/

// ---------- Réglages ----------
const AGENT_ID  = 'agent_6501m6dse9w4ffr8xvfcvn8bmxk6';      // agent « Rappel Nexus B2B »
const AGENT_PROSPECTION = 'agent_4801m6zx8h3xes4bqxx6qr0566sh';   // agent « Équipe Nexus – Prospection fournisseurs »
const NUMERO_ID = 'phnum_9901m6c9jcbnfrnb4aps8c7wkj8f';      // numéro Twilio +33 2 19 12 14 49
const MAX_PAR_JOUR = 20;           // garde-fou : nombre maximum de rappels par jour (coût, abus)
const MAX_PAR_NUMERO = 5;          // un même numéro peut faire au plus 5 demandes…
const DELAI_MEME_NUMERO = 3600;    // …par période de 3600 s (1 h) ; repasser MAX_PAR_NUMERO à 1 après les tests
const JOURS_OUVRES = [1, 2, 3, 4, 5];   // 0 = dimanche, 1 = lundi… 6 = samedi
const HEURE_DEBUT = 9;             // on n'appelle pas avant 9 h…
const HEURE_FIN = 19;              // …ni après 19 h (heure de Paris)


/**
 * Point d'entrée : Apps Script appelle doPost à chaque envoi du formulaire.
 * e.parameter contient les champs du formulaire (nom, telephone, etc.).
 */
function doPost(e) {
  const p = (e && e.parameter) || {};

  try {
    // 1) Piège à robots : le champ « site » est invisible pour un humain.
    //    S'il est rempli, c'est un robot : on fait semblant que tout va bien.
    if (p.site) return repondre({ ok: true });

    // Quel formulaire nous écrit ? « prospection » = la page prospection-nexus/
    // (juste un numéro) ; sinon c'est le formulaire de rappel des franchisés.
    const prospection = p.type === 'prospection';

    // 2) Champs obligatoires et accord explicite (formulaire franchisés seulement)
    const nom = nettoyer(p.nom, 60);
    if (!prospection && (!nom || p.accord !== 'oui')) return repondre({ ok: false, erreur: 'champs' });

    // 3) Numéro de téléphone : on le met au format international (+33…)
    const tel = normaliserTelephone(p.telephone);
    if (!tel) return repondre({ ok: false, erreur: 'telephone' });

    // 4) Horaires : pas d'appel automatique le soir ou le week-end
    if (!dansLesHoraires()) return repondre({ ok: false, erreur: 'horaires' });

    // 5) Limites. Le « verrou » empêche deux demandes simultanées de lire
    //    le compteur en même temps (sinon on pourrait dépasser la limite).
    const verrou = LockService.getScriptLock();
    verrou.waitLock(10000);
    try {
      // Combien de demandes pour ce numéro dans l'heure ? Le cache garde un
      // petit compteur par numéro, qui s'efface tout seul au bout du délai.
      const cache = CacheService.getScriptCache();
      const dejaFaites = Number(cache.get('tel-' + tel) || 0);
      if (dejaFaites >= MAX_PAR_NUMERO) return repondre({ ok: false, erreur: 'deja' });

      // Compteur du jour, rangé dans les propriétés : { jour: "2026-11-02", n: 3 }
      const props = PropertiesService.getScriptProperties();
      const aujourdhui = Utilities.formatDate(new Date(), 'Europe/Paris', 'yyyy-MM-dd');
      let compteur = JSON.parse(props.getProperty('compteur') || '{}');
      if (compteur.jour !== aujourdhui) compteur = { jour: aujourdhui, n: 0 };   // nouveau jour : remise à zéro
      if (compteur.n >= MAX_PAR_JOUR) return repondre({ ok: false, erreur: 'limite' });

      // On réserve la place AVANT d'appeler (si l'appel échoue, tant pis : prudence)
      compteur.n++;
      props.setProperty('compteur', JSON.stringify(compteur));
      cache.put('tel-' + tel, String(dejaFaites + 1), DELAI_MEME_NUMERO);   // +1 au compteur du numéro
    } finally {
      verrou.releaseLock();
    }

    // 6 bis) Mode prospection : on lance directement l'équipe commerciale.
    //        Sans nom ni entreprise, l'agent garde ses valeurs par défaut
    //        ({{nom_contact}} = Philou, {{entreprise}} = Philou et associés, pour les tests).
    if (prospection) {
      const r = lancerAppel(tel, null, null, null, AGENT_PROSPECTION);
      journal('(prospection)', '', tel, '', r.ok ? 'appel prospection lancé' : 'échec : ' + r.detail);
      return repondre(r.ok ? { ok: true } : { ok: false, erreur: 'erreur' });
    }

    // 6) La difficulté, en phrase lisible par l'agent ({{difficulte}} dans son prompt)
    const choix = nettoyer(p.difficulte, 150);
    const precision = nettoyer(p.precision, 200);
    let difficulte = (choix && choix !== 'autre') ? choix : 'difficulté non précisée';
    if (precision) difficulte += ' (précision donnée : ' + precision + ')';

    const entreprise = nettoyer(p.entreprise, 80) || 'non précisée';

    // 7) On demande à ElevenLabs de passer l'appel
    const resultat = lancerAppel(tel, nom, entreprise, difficulte);
    journal(nom, entreprise, tel, difficulte, resultat.ok ? 'appel lancé' : 'échec : ' + resultat.detail);

    return repondre(resultat.ok ? { ok: true } : { ok: false, erreur: 'erreur' });

  } catch (err) {
    console.error(err);
    return repondre({ ok: false, erreur: 'erreur' });
  }
}


/**
 * Appel sortant via l'API ElevenLabs (avec Twilio).
 * Les « dynamic_variables » remplacent {{nom_contact}}, {{entreprise}}
 * et {{difficulte}} dans le prompt et le premier message de l'agent.
 * agent (facultatif) : quel agent appelle ; par défaut AGENT_ID (Rappel Nexus B2B).
 * Une variable laissée à null n'est pas envoyée : l'agent garde sa valeur par défaut.
 */
function lancerAppel(tel, nom, entreprise, difficulte, agent) {
  const cle = PropertiesService.getScriptProperties().getProperty('ELEVENLABS_KEY');
  if (!cle) return { ok: false, detail: 'clé ELEVENLABS_KEY absente' };

  // On ne garde que les variables renseignées
  const variables = {};
  if (nom) variables.nom_contact = nom;
  if (entreprise) variables.entreprise = entreprise;
  if (difficulte) variables.difficulte = difficulte;

  const corps = {
    agent_id: agent || AGENT_ID,
    agent_phone_number_id: NUMERO_ID,
    to_number: tel,
    conversation_initiation_client_data: { dynamic_variables: variables }
  };

  const rep = UrlFetchApp.fetch('https://api.elevenlabs.io/v1/convai/twilio/outbound-call', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'xi-api-key': cle },
    payload: JSON.stringify(corps),
    muteHttpExceptions: true          // en cas d'erreur, on récupère la réponse au lieu de planter
  });

  const code = rep.getResponseCode();
  if (code >= 200 && code < 300) return { ok: true };
  return { ok: false, detail: code + ' ' + rep.getContentText().slice(0, 200) };
}


/**
 * Transforme « 06 12 34 56 78 », « 06.12.34.56.78 », « 0033 6… » ou « +33 6… »
 * en « +33612345678 ». Renvoie null si ce n'est pas un numéro français valable.
 * Les numéros surtaxés (08…) sont refusés.
 */
function normaliserTelephone(brut) {
  let t = String(brut || '').replace(/[\s.\-()]/g, '');   // on enlève espaces, points, tirets, parenthèses
  if (/^0033/.test(t)) t = '+' + t.slice(2);              // 0033… → +33…
  if (/^0\d{9}$/.test(t)) t = '+33' + t.slice(1);         // 06… → +336…
  return /^\+33[1-79]\d{8}$/.test(t) ? t : null;          // +33 puis 9 chiffres, sans 08
}


/** Vrai si on est dans les jours et heures d'appel (heure de Paris). */
function dansLesHoraires() {
  const maintenant = new Date();
  const jour  = Number(Utilities.formatDate(maintenant, 'Europe/Paris', 'u')) % 7;   // u : 1 = lundi … 7 = dimanche → 0
  const heure = Number(Utilities.formatDate(maintenant, 'Europe/Paris', 'H'));
  return JOURS_OUVRES.indexOf(jour) !== -1 && heure >= HEURE_DEBUT && heure < HEURE_FIN;
}


/** Nettoie un texte reçu : sans retours à la ligne ni caractères bizarres, longueur limitée. */
function nettoyer(texte, max) {
  return String(texte || '')
    .replace(/[\u0000-\u001F\u007F{}<>]/g, ' ')   // caractères de contrôle, accolades (variables), chevrons
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}


/** Ajoute une ligne au Google Sheet qui contient le script (s'il y en a un). */
function journal(nom, entreprise, tel, difficulte, statut) {
  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  if (!classeur) return;
  const feuille = classeur.getSheets()[0];
  if (feuille.getLastRow() === 0) {
    feuille.appendRow(['Date', 'Nom', 'Entreprise', 'Téléphone', 'Difficulté', 'Statut']);
  }
  feuille.appendRow([new Date(), nom, entreprise, tel, difficulte, statut]);
}


/** Renvoie une réponse JSON à la page. */
function repondre(objet) {
  return ContentService.createTextOutput(JSON.stringify(objet))
    .setMimeType(ContentService.MimeType.JSON);
}


/**
 * Test manuel depuis l'éditeur Apps Script (choisir « testerRappel » puis Exécuter) :
 * remplacez le numéro par le vôtre. Ça appelle vraiment !
 */
function testerRappel() {
  const r = lancerAppel('+33600000000', 'Sébastien', 'Test', "n'arrive pas à accepter la relation commerciale avec Carrefour");
  console.log(r);
}
