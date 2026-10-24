/* =============================================================================
   Paraphe — numéro de version, à UN SEUL endroit.
   -----------------------------------------------------------------------------
   À augmenter à chaque mise en ligne :
     - 3e chiffre (1.3.0 → 1.3.1) : petite correction ;
     - 2e chiffre (1.3 → 1.4)     : nouvelle fonctionnalité ;
     - 1er chiffre (1.x → 2.0)    : grand changement.
   Il est lu par l'écran d'accueil (crédits) ET par le service worker (sw.js) :
   changer ce numéro suffit pour que les téléphones téléchargent la nouvelle version.

   Historique :
     1.0.0  première version (photo de la grille, dessin, aperçu, export)
     1.1.0  identité visuelle SV
     1.2.0  minuscules d'abord, aperçu en direct pendant le dessin, reprise
     1.3.0  harmonisation des dessins, caractères de secours, aperçu fixe
     1.3.1  numéro de version centralisé et affiché
     1.4.0  aperçu touchable, retouche vectorielle des lettres (points et poignées), bandeau entre deux lettres
     1.5.0  l'appli s'appelle désormais Paraphe (adresse /paraphe/, l'ancienne /plume/ redirige)
     1.5.1  outils de retouche sur une seule ligne sur les petits écrans (360 px)
     1.5.2  un peu plus d'espace après l'apostrophe (crénage limité à -45)
     1.5.3  apostrophe : plus aucun rapprochement après elle, et +30 de marge droite
     1.6.0  import de PDF scannés, grille v3 (numéros de page lisibles, page 4 de cases bonus), plusieurs versions par lettre et choix de la préférée
     1.7.0  queues des g, y, j plus coupées (découpe à 0,3 mm du cadre) ; grille v4 : 7 cases bonus en bas
            des pages 1 et 2 ; cases barrées reconnues ; lettre d'une case bonus choisie dans une liste
     1.8.0  grille v5 sur 2 pages (sans phrases, rangée par sections, consignes claires, modèles gris
            pour les signes) ; scanner caméra en continu ; import unique photos/PDF ; feuille de
            reprise pour refaire des lettres ; partage de la police (PDF spécimen avec le .ttf joint)
     1.9.0  grille v6 : modèle gris lisible au début de chaque case (plus de filigrane) ; « cases seconde
            chance » ; refaire une lettre sans réimprimer (case réservée) ; partie papier en 3 étapes
     1.9.1  modèles en « écriture bâton » calés sur les lignes (Helvetica dépassait du 1er pointillé) ;
            cases seconde chance sans petit carré ; gros numéro de page pour distinguer les pages 1 et 2
   ========================================================================== */
self.PLUME_VERSION = "1.9.1";   // (nom de variable gardé : l'appli s'appelait Plume)
