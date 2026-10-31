# svaug12345.github.io

Site GitHub Pages de svaug12345 : héberge des applis web (PWA), publiées aussi sur le Play Store via PWABuilder.

- `QR/` — Lecteur QR code (dépôt séparé svaug12345/QR, servi sous /QR/)
- `paraphe/` — Paraphe, appli pour créer sa police manuscrite (s'appelait Plume ; `plume/` ne fait plus que rediriger)
- `atelier-polices/` — Atelier de polices (page autonome)
- `agent-double/` — page de politique de confidentialité du jeu Android Agent Double (code : dépôt svaug12345/undercover)
- `assistant-fournisseurs/` — page d'aide fournisseurs Carrefour (SAP Business Network) avec agent vocal ElevenLabs ; version dans le commentaire d'en-tête de `index.html` ; liée depuis la page d’accueil (section « Agents vocaux »), mais toujours en « noindex »
- `pochpoch/` — « PochPoch assistant », cost killer vocal (agent ElevenLabs via SDK @elevenlabs/client) ; page sombre façon Matrix, un seul bouton ; version dans le commentaire d'en-tête de `index.html` ; liée depuis la page d’accueil (section « Agents vocaux »), mais toujours en « noindex »
- `salle-negociation/` — « Salle de négociation » Club Acheteur (charte Carrefour / Marcel, pas SV) : conversation vocale intégrée avec l'agent ElevenLabs fournisseur (SDK @elevenlabs/client, comme PochPoch) pour entraîner les acheteurs DANM ; construite avec la skill supports-pedagogiques-carrefour (page autonome) ; version dans le commentaire d'en-tête ; liée depuis l'accueil (« Agents vocaux »), en « noindex »
- `.well-known/assetlinks.json` — empreintes de signature Android (une entrée par appli)

## Règles

- **À chaque modification d'une appli, incrémenter son numéro de version** :
  pour Paraphe, `paraphe/version.js` (3e chiffre = correction, 2e = nouvelle fonctionnalité),
  et ajouter une ligne à l'historique en commentaire dans ce même fichier.
  Ce numéro sert aussi de nom de cache au service worker : sans changement, les téléphones gardent l'ancienne version.
- Code bien commenté, en français, avec explications : l'auteur apprend en lisant.
- Identité visuelle : charte « SV » (teal #0f7c7b, neutres vert-bleu, Manrope + JetBrains Mono, boutons en capitales espacées, le « geste » comme signature).
