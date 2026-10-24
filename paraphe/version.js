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
   ========================================================================== */
self.PLUME_VERSION = "1.5.0";   // (nom de variable gardé : l'appli s'appelait Plume)
