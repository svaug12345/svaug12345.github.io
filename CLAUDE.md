# svaug12345.github.io

Site GitHub Pages de svaug12345 : héberge des applis web (PWA), publiées aussi sur le Play Store via PWABuilder.

- `QR/` — Lecteur QR code (dépôt séparé svaug12345/QR, servi sous /QR/)
- `paraphe/` — Paraphe, appli pour créer sa police manuscrite (s'appelait Plume ; `plume/` ne fait plus que rediriger)
- `pressoir/` — « Pressoir vidéo » : compression vidéo 100 % locale (WebCodecs + mp4-muxer), lecture du MP4 maison (boîte moov) ; version dans le commentaire d'en-tête ; liée depuis l'accueil (« Applications »)
- `atelier-polices/` — Atelier de polices (page autonome)
- `agent-double/` — page de politique de confidentialité du jeu Android Agent Double (code : dépôt svaug12345/undercover)
- `assistant-fournisseurs/` — page d'aide fournisseurs Carrefour (SAP Business Network) avec agent vocal ElevenLabs ; version dans le commentaire d'en-tête de `index.html` ; liée depuis la page d’accueil (section « Agents vocaux »), mais toujours en « noindex »
- `pochpoch/` — « PochPoch assistant », cost killer vocal (agent ElevenLabs via SDK @elevenlabs/client) ; page sombre façon Matrix, un seul bouton ; version dans le commentaire d'en-tête de `index.html` ; liée depuis la page d’accueil (section « Agents vocaux »), mais toujours en « noindex »
- `salle-negociation/` — « Salle de négociation » Club Acheteur (charte Carrefour / Marcel, pas SV) : conversation vocale intégrée avec l'agent ElevenLabs fournisseur (SDK @elevenlabs/client, comme PochPoch) pour entraîner les acheteurs DANM ; construite avec la skill supports-pedagogiques-carrefour (page autonome) ; version dans le commentaire d'en-tête ; liée depuis l'accueil (« Agents vocaux »), en « noindex »
- `entretien-tuteur/` — « Entretien tuteur » (charte SV) : simulateur vocal pour tuteurs de professeurs stagiaires en maths, 4 profils = 4 agents ElevenLabs (Camille d'accord sans comprendre, Julien opposant, Théo désengagé, Sarah en détresse), bouton « Débrief » (retour de coach) ; SDK @elevenlabs/client ; version dans le commentaire d'en-tête ; liée depuis l'accueil (« Agents vocaux »), en « noindex »
- `sos-amitie/` — « SOS Amitié » : ligne d'écoute humoristique perso pour Charles (ami de Seb), agent ElevenLabs avec la voix « SebastienV » ; SDK @elevenlabs/client ; page chaleureuse (crème/corail, Fraunces + Manrope); pas de mention « Baiji » ni de pied de page (les numéros d'aide sont donnés par l'agent) ; version dans le commentaire d'en-tête ; liée depuis l'accueil (« Agents vocaux »), en « noindex »
- `nego-papa/` — « Négo avec Papa » : entraînement vocal à la négociation pour Tom (6 ans), Gaby (12) et Nanon (14, ado) face à un papa coriace, avec mode coach (« temps mort coach », « fin de la négo » = débrief) ; agent ElevenLabs voix « SebastienV » ; photo de Seb dans le bouton (`papa.jpg`) ; boutons qui envoient ces phrases via `sendUserMessage` ; charte SV ; version dans le commentaire d'en-tête ; liée depuis l'accueil (« Agents vocaux »), en « noindex »
- `foot-chats/` — « Max · Foot & Chats » : agent vocal ElevenLabs « Max » (voix « Oris ») pour Titouan (9 ans, quiz foot / PSG avec banque de questions sûres dans le prompt) et Ava (6 ans, jeux de chats) ; 2 cartes + « On joue à deux » qui lancent l'appel et disent qui joue via `sendUserMessage` (envoyé après l'accueil de Max) ; couleurs pelouse / rose, Fredoka + Manrope ; version dans le commentaire d'en-tête ; liée depuis l'accueil (« Agents vocaux »), en « noindex »
- `juju/` — « Juju · Mécanicien vélo » : site vitrine d'une page pour Julien (mécano vélo) ; tout ce qui est à personnaliser (téléphone, zone, horaires) est dans l'objet `JUJU` en bas de page — sans numéro, boutons grisés ; listes `SERVICES` et `SYMPTOMES` (diagnostic → SMS pré-rempli) ; crème/jaune, Archivo + Figtree ; version dans le commentaire d'en-tête et `VERSION` ; liée depuis l'accueil (« Sites »), en « noindex » tant que les coordonnées manquent ; pas de PWA (site vitrine, pas une appli)
- `.well-known/assetlinks.json` — empreintes de signature Android (une entrée par appli)
- `outils/generer-pwa.py` — rend les pages installables (PWA) : fabrique pour chaque page de sa liste `PAGES` le `manifest.webmanifest`, le `sw.js` (« réseau d'abord ») et les icônes `icones/` (picto Lucide sur tuile de couleur, via rsvg-convert) ; fait aussi l'accueil (icône SV). Les pages incluent le lien vers le manifeste (après `<title>`) et enregistrent `sw.js` en bas de page. Le `sw.js` de la racine n'agit que sur les fichiers à la racine (pas sur QR/, svaug12345-revisions/… qui viennent d'autres dépôts).
- Accueil (`index.html`) : chaque projet a un champ `icone` qui pointe vers la liste `PICTOS` (pictos Lucide, ISC) affichés dans la pastille

## Ajouter une nouvelle page

1. Créer le dossier et sa page ; l'ajouter à `PROJETS` dans `index.html` (avec un `icone`) et ici.
2. La rendre installable : ajouter une ligne dans `PAGES` de `outils/generer-pwa.py`, lancer le script, et copier dans la page le bloc « PWA » du `<head>` et le `<script>` d'enregistrement de `sw.js` (voir une page existante, ex. `pochpoch/`).

## Règles

- **À chaque modification d'une appli, incrémenter son numéro de version** :
  pour Paraphe, `paraphe/version.js` (3e chiffre = correction, 2e = nouvelle fonctionnalité),
  et ajouter une ligne à l'historique en commentaire dans ce même fichier.
  Ce numéro sert aussi de nom de cache au service worker : sans changement, les téléphones gardent l'ancienne version.
- Code bien commenté, en français, avec explications : l'auteur apprend en lisant.
- Identité visuelle : charte « SV » (teal #0f7c7b, neutres vert-bleu, Manrope + JetBrains Mono, boutons en capitales espacées, le « geste » comme signature).
