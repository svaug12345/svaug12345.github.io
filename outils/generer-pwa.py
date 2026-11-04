#!/usr/bin/env python3
"""
============================================================
outils/generer-pwa.py — rend les pages de baiji.fr installables
------------------------------------------------------------
Une page web devient « installable » sur téléphone (« Ajouter à
l'écran d'accueil », elle s'ouvre ensuite comme une vraie appli,
sans barre d'adresse) si elle a 3 choses :

  1. un MANIFESTE (manifest.webmanifest) : la carte d'identité de
     l'appli — nom, couleurs, icônes, adresse de départ ;
  2. des ICÔNES PNG en 192 et 512 px (dont une « masquable »,
     que Android découpe en rond, en goutte… selon le téléphone) ;
  3. un SERVICE WORKER (sw.js) : petit script qui tourne en
     arrière-plan et intercepte les requêtes. Ici il fait du
     « réseau d'abord » : il prend toujours la version en ligne,
     et ne se sert de sa copie locale que hors connexion.
     → aucun risque de rester bloqué sur une vieille version.

Ce script fabrique ces 3 choses pour chaque page de la liste
PAGES ci-dessous. Les pictos viennent de la bibliothèque libre
Lucide (licence ISC) : https://lucide.dev

Utilisation (depuis la racine du dépôt) :
    npm pack lucide-static && tar xzf lucide-static-*.tgz
    python3 outils/generer-pwa.py package/icons
Il faut aussi « rsvg-convert » (paquet librsvg2-bin) pour
transformer les SVG en PNG.

POUR AJOUTER UNE PAGE : ajouter une ligne dans PAGES, relancer
le script, puis coller dans la page les quelques lignes
indiquées dans le commentaire « PWA » des autres pages
(lien vers le manifeste + enregistrement du service worker).
============================================================
"""
import json
import re
import subprocess
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent  # racine du dépôt

# ------------------------------------------------------------
# Les pages à rendre installables.
#   dossier : sous-dossier du site (= adresse baiji.fr/dossier/)
#   nom / court : nom complet et nom sous l'icône (≤ 12 lettres)
#   picto : nom de l'icône Lucide
#   tuile / trait : couleur de fond de l'icône et du picto
#   fond : couleur de fond de la page (écran de démarrage)
#   theme : couleur de la barre d'état Android
# ------------------------------------------------------------
PAGES = [
    dict(dossier="disque", nom="Place nette", court="Place nette",
         desc="Ce qui prend de la place sur le disque ou le téléphone",
         picto="hard-drive", tuile="#0f7c7b", trait="#ffffff",
         fond="#f4f7f7", theme="#0f7c7b"),
    dict(dossier="pressoir", nom="Pressoir", court="Pressoir",
         desc="Compresse et découpe vidéos et sons dans le téléphone, sans pub",
         picto="clapperboard", tuile="#d1501a", trait="#ffffff",
         fond="#eef2ef", theme="#eef2ef"),
    dict(dossier="pochpoch", nom="PochPoch assistant", court="PochPoch",
         desc="Le cost killer vocal qui refuse vos dépenses",
         picto="piggy-bank", tuile="#000000", trait="#33ff66",
         fond="#000000", theme="#000000"),
    dict(dossier="assistant-fournisseurs", nom="Assistant fournisseurs Carrefour",
         court="Fournisseurs",
         desc="Aide vocale pour rejoindre Carrefour sur SAP Business Network",
         picto="truck", tuile="#0E4C9A", trait="#ffffff",
         fond="#F4F7FB", theme="#0E4C9A"),
    dict(dossier="assistant-nexus", nom="Assistant Nexus Carrefour",
         court="Nexus",
         desc="Aide vocale pour les franchisés : rejoindre Nexus, la plateforme B2B de Carrefour",
         picto="store", tuile="#005FCD", trait="#ffffff",   # couleurs Nexus
         fond="#F3F7FC", theme="#005FCD"),
    dict(dossier="salle-negociation", nom="Salle de négociation", court="Négociation",
         desc="S'entraîner à négocier face à un fournisseur vocal",
         picto="handshake", tuile="#0b355f", trait="#ffffff",
         fond="#ffffff", theme="#0b355f"),
    dict(dossier="entretien-tuteur", nom="Entretien tuteur", court="Tuteur",
         desc="S'entraîner à mener l'entretien avec un stagiaire en maths",
         picto="graduation-cap", tuile="#0b4f55", trait="#ffffff",
         fond="#f4f7f7", theme="#0f7c7b"),
    dict(dossier="sos-amitie", nom="SOS Amitié", court="SOS Amitié",
         desc="La ligne d'écoute (taquine) de Charles",
         picto="phone-call", tuile="#e8604c", trait="#ffffff",
         fond="#f6efe3", theme="#f6efe3"),
    dict(dossier="nego-papa", nom="Négo avec Papa", court="Négo Papa",
         desc="S'entraîner à négocier avec Papa (et son coach)",
         picto="scale", tuile="#0f7c7b", trait="#ffffff",
         fond="#eef4f3", theme="#0f7c7b"),
    dict(dossier="fils-prefere", nom="Le Grand Verdict", court="Grand Verdict",
         desc="Papa, Maman : lequel est votre fils préféré ? (indice : c'est Sébastien)",
         picto="trophy", tuile="#1a1040", trait="#ffc83d",
         fond="#1a1040", theme="#1a1040"),
    dict(dossier="foot-chats", nom="Max · Foot & Chats", court="Foot & Chats",
         desc="Quiz foot pour Titouan, jeux de chats pour Ava",
         picto="cat", tuile="#1f8a4c", trait="#ffffff",
         fond="#fff6e9", theme="#fff6e9"),
    dict(dossier="julien", nom="Julien · Mécanicien vélo", court="Julien vélo",
         desc="Le vélo doit être un plaisir : conseils, dépannage, tarifs clairs",
         picto="bike", tuile="#f5c21b", trait="#1b1d1a",
         fond="#f4efe6", theme="#f4efe6"),
    dict(dossier="location", nom="Clé en main · Location", court="Location",
         desc="Réservez une voiture, un utilitaire ou un minibus en parlant à Lucie",
         picto="car-front", tuile="#14213d", trait="#fca311",
         fond="#f4f2ee", theme="#14213d"),
    dict(dossier="atelier-polices", nom="Atelier de polices", court="Polices",
         desc="Fabrique et ajuste ses polices manuscrites",
         picto="type", tuile="#3552b8", trait="#ffffff",
         fond="#eef1f7", theme="#eef1f7"),
    dict(dossier="fart", nom="FART · Séance d'observation", court="FART",
         desc="Six scénettes de classe à faire observer aux tuteurs et stagiaires",
         picto="wind", tuile="#0A0A2E", trait="#ffffff",
         fond="#0A0A2E", theme="#0A0A2E"),
    dict(dossier="famille", nom="Vaugoude's Family", court="Famille",
         desc="Météo, tâches des enfants et batteries des voitures",
         picto="house", tuile="#0f7c7b", trait="#ffffff",
         fond="#f3f6f6", theme="#0e3a44"),
    dict(dossier="cartable", nom="Cartable", court="Cartable",
         desc="Devoirs et emplois du temps Pronote de Gaby et Nanon",
         picto="backpack", tuile="#0f7c7b", trait="#ffffff",
         fond="#f3f6f6", theme="#0e3a44"),
    dict(dossier="mediatheque", nom="Médiathèque", court="Médiathèque",
         desc="Les documents empruntés aux Médiathèques de Paris-Saclay",
         picto="library", tuile="#0f7c7b", trait="#ffffff",
         fond="#f3f6f6", theme="#0e3a44"),
    dict(dossier="voitures", nom="Voitures", court="Voitures",
         desc="Batterie et charge de l'e-5008 et de la Corsa",
         picto="battery-charging", tuile="#0b4f55", trait="#ffffff",
         fond="#f6f9f9", theme="#0b4f55"),
    dict(dossier="nas-aide", nom="Accès au NAS", court="Accès NAS",
         desc="Comment accéder au NAS de Seb depuis l'extérieur avec Tailscale",
         picto="hard-drive", tuile="#0b4f55", trait="#ffffff",
         fond="#f6f9f9", theme="#0b4f55"),
]


def contenu_lucide(dossier_icones: Path, nom: str) -> str:
    """Récupère l'intérieur d'une icône Lucide (les <path>, <circle>…),
    sans la balise <svg> qui l'entoure ni le commentaire de licence."""
    svg = (dossier_icones / f"{nom}.svg").read_text()
    interieur = svg.split(">", 2)[2] if svg.startswith("<!--") else svg.split(">", 1)[1]
    interieur = interieur.rsplit("</svg>", 1)[0]
    return re.sub(r"\s+", " ", interieur).strip()


def svg_icone(picto: str, tuile: str, trait: str, arrondi: bool, taille_picto: float) -> str:
    """Dessine l'icône en SVG (grille de 512 px) :
       - une tuile de couleur (arrondie ou carrée),
       - le picto Lucide (grille 24 px) agrandi et centré.
       taille_picto = part de la largeur occupée par le picto (0 à 1)."""
    echelle = 512 * taille_picto / 24          # 24 = taille d'origine Lucide
    decalage = (512 - 24 * echelle) / 2        # pour centrer
    rx = 112 if arrondi else 0                 # même arrondi que favicon.svg (14/64)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<rect width="512" height="512" rx="{rx}" fill="{tuile}"/>
<g transform="translate({decalage:.2f} {decalage:.2f}) scale({echelle:.4f})"
   fill="none" stroke="{trait}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
{picto}
</g></svg>"""


def en_png(svg: str, sortie: Path, taille: int):
    """Convertit un SVG en PNG carré de « taille » pixels avec rsvg-convert."""
    sortie.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["rsvg-convert", "-w", str(taille), "-h", str(taille), "-o", str(sortie)],
                   input=svg.encode(), check=True)


def fabriquer_icones(dossier: Path, svg_rond, svg_masquable, svg_apple):
    """Les 5 fichiers d'icônes, mêmes noms que pour Paraphe."""
    ic = dossier / "icones"
    en_png(svg_rond, ic / "icone-192.png", 192)
    en_png(svg_rond, ic / "icone-512.png", 512)
    en_png(svg_masquable, ic / "icone-masquable-192.png", 192)
    en_png(svg_masquable, ic / "icone-masquable-512.png", 512)
    en_png(svg_apple, ic / "apple-touch-icon.png", 180)   # iPhone (fond plein, iOS arrondit)


def manifeste(p: dict, chemin: str) -> str:
    """Le manifeste : « id », « start_url » et « scope » = le dossier
    de la page, pour que chaque page soit une appli distincte."""
    return json.dumps({
        "name": p["nom"],
        "short_name": p["court"],
        "description": p["desc"],
        "id": chemin, "start_url": chemin, "scope": chemin,
        "display": "standalone",          # sans barre d'adresse, comme une appli
        "background_color": p["fond"],    # écran de démarrage
        "theme_color": p["theme"],        # barre d'état
        "lang": "fr", "dir": "ltr",
        "icons": [
            {"src": "icones/icone-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": "icones/icone-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
            {"src": "icones/icone-masquable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable"},
            {"src": "icones/icone-masquable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ],
    }, ensure_ascii=False, indent=2) + "\n"


# Modèle du service worker. {NOM} et {RACINE_SEULE} sont remplacés.
SW = """/*
  ============================================================
  Service worker de {NOM} (baiji.fr)
  Fabriqué par outils/generer-pwa.py — c'est lui qui rend la
  page installable sur téléphone.
  ------------------------------------------------------------
  Stratégie « réseau d'abord » :
   • en ligne  → on prend TOUJOURS la version du site (donc
                 jamais bloqué sur une vieille version), et on
                 en garde une copie dans le cache ;
   • hors ligne → on ressort la copie du cache (si elle existe).
  Seuls les fichiers du site, dans le dossier de cette page,
  sont concernés ; le reste (Google Fonts, ElevenLabs…) passe
  normalement, sans être touché.
  ============================================================
*/
const CACHE = "baiji-" + new URL(self.registration.scope).pathname;

// Installation : on prend la main tout de suite (pas d'attente)
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const portee = new URL(self.registration.scope).pathname;

  // On ne s'occupe que des lectures (GET) de fichiers de CE dossier
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (!url.pathname.startsWith(portee)) return;
  // Vidéos et sons : on les laisse passer sans les garder. Ils sont lourds (ils rempliraient
  // le téléphone) et le navigateur les lit par morceaux (requêtes « Range » → réponses 206),
  // que le cache ne sait pas stocker.
  if (e.request.headers.has("range") || /\\.(mp4|webm|mov|m4a|mp3|wav|ogg)$/i.test(url.pathname)) return;
  {RACINE_SEULE}

  e.respondWith(
    fetch(e.request)
      .then((reponse) => {
        // Copie de la réponse dans le cache (une réponse ne se lit qu'une fois → clone)
        if (reponse.ok) {
          const copie = reponse.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copie));
        }
        return reponse;
      })
      // Pas de réseau : la copie du cache (ou, pour une page, l'accueil du dossier)
      .catch(() => caches.match(e.request)
        .then((r) => r || (e.request.mode === "navigate" ? caches.match(portee) : undefined)))
  );
});
"""

# Pour l'accueil (portée « / ») : on ne touche qu'aux fichiers posés à la
# racine, pas aux sous-dossiers (QR/, svaug12345-revisions/… qui viennent
# d'autres dépôts et ont, ou auront, leur propre fonctionnement).
FILTRE_RACINE = """// Accueil : seulement les fichiers à la racine (pas les sous-dossiers des autres applis)
  if (url.pathname.slice(1).includes("/")) return;"""


def main():
    if len(sys.argv) < 2:
        sys.exit("Usage : python3 outils/generer-pwa.py <dossier des icônes Lucide>")
    lucide = Path(sys.argv[1])

    # ---- 1) Les pages ----
    for p in PAGES:
        d = RACINE / p["dossier"]
        picto = contenu_lucide(lucide, p["picto"])
        fabriquer_icones(
            d,
            svg_icone(picto, p["tuile"], p["trait"], arrondi=True, taille_picto=0.56),
            svg_icone(picto, p["tuile"], p["trait"], arrondi=False, taille_picto=0.44),  # zone sûre Android
            svg_icone(picto, p["tuile"], p["trait"], arrondi=False, taille_picto=0.56),
        )
        (d / "manifest.webmanifest").write_text(manifeste(p, f"/{p['dossier']}/"))
        (d / "sw.js").write_text(SW.replace("{NOM}", p["nom"]).replace("{RACINE_SEULE}", ""))
        print("✓", p["dossier"])

    # ---- 2) L'accueil : l'icône SV (le « geste » blanc sur tuile teal) ----
    geste = re.search(r'd="([^"]+)"', (RACINE / "favicon.svg").read_text()).group(1)

    def svg_sv(arrondi, part):
        # Le geste est dessiné sur une grille de 64 ; on le centre à « part » de la largeur
        e = 512 * part / 64
        o = (512 - 64 * e) / 2
        return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
                f'<rect width="512" height="512" rx="{112 if arrondi else 0}" fill="#0f7c7b"/>'
                f'<path transform="translate({o:.2f} {o:.2f}) scale({e:.4f})" fill="#ffffff" d="{geste}"/></svg>')

    fabriquer_icones(RACINE, svg_sv(True, 0.75), svg_sv(False, 0.6), svg_sv(False, 0.75))
    accueil = dict(nom="baiji.fr — projets", court="baiji",
                   desc="Les applis et les jeux faits maison, marque SV",
                   fond="#f6f9f9", theme="#f6f9f9")
    (RACINE / "manifest.webmanifest").write_text(manifeste(accueil, "/"))
    (RACINE / "sw.js").write_text(SW.replace("{NOM}", "l'accueil").replace("{RACINE_SEULE}", FILTRE_RACINE))
    print("✓ accueil")


if __name__ == "__main__":
    main()
