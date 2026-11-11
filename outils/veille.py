#!/usr/bin/env python3
"""
============================================================
outils/veille.py — collecte de la « Veille » (plusieurs sujets)
Version 2.0.0
------------------------------------------------------------
Ce script tourne tout seul sur les serveurs de GitHub
(workflow .github/workflows/veille.yml, toutes les 2 heures).
Il :
  1. lit les réglages dans veille/sources.json : la liste des sujets
     (Carrefour, Elis…), et pour chacun ses mots-clés et ses flux ;
  2. pour chaque sujet, télécharge chaque flux RSS (ou recherche
     Google Actualités) ;
  3. garde les articles qui parlent du sujet, retire les doublons ;
  4. les fusionne avec ceux déjà connus (veille/donnees/<sujet>.json)
     et oublie ceux de plus de `jours_gardes` jours ;
  5. réécrit veille/donnees/<sujet>.json et la liste des sujets
     veille/donnees/index.json, que l'appli (veille/index.html) affiche.

Pourquoi passer par GitHub et pas directement par la page ?
Un navigateur n'a pas le droit de lire un autre site (règle
« CORS ») : la page baiji.fr/veille/ ne peut donc pas télécharger
le flux de LSA elle-même. Le script, lui, tourne sur un serveur,
où cette règle n'existe pas. Il dépose le résultat dans le site,
que la page peut lire.

Aucune bibliothèque à installer : uniquement Python standard.

Lancer à la main (depuis la racine du dépôt) :
    python3 outils/veille.py
Option pour tester sans internet : --dossier-test <dossier>
(les flux sont lus dans des fichiers de ce dossier).

Historique :
 • v1.0.0 : première version (Dauvers, LSA, Linéaires ; Google Actualités)
 • v1.1.0 : sources « autres » (toute la presse via Google Actualités) : chaque article
            garde le nom du journal (« media ») ; un article d'un site déjà suivi
            (ex. LSA trouvé par la recherche générale) est rangé sous ce site
 • v2.0.0 : plusieurs sujets (« sujets » dans sources.json) ; un fichier par sujet dans
            veille/donnees/, plus veille/donnees/index.json (liste des onglets)
============================================================
"""
import hashlib
import html
import json
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

VERSION = "2.0.0"

RACINE = Path(__file__).resolve().parent.parent      # racine du dépôt
REGLAGES = RACINE / "veille" / "sources.json"
DONNEES = RACINE / "veille" / "donnees"           # un fichier JSON par sujet + index.json

# Certains sites refusent les robots « anonymes » : on se présente
# comme un lecteur de flux ordinaire, avec un nom clair.
ENTETES = {
    "User-Agent": "Mozilla/5.0 (compatible; VeilleBaiji/1.0; +https://baiji.fr/veille/)",
    "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
}

# Adresse d'une recherche Google Actualités en flux RSS, en français / France.
GOOGLE_NEWS = "https://news.google.com/rss/search?q={q}&hl=fr&gl=FR&ceid=FR:fr"


# ------------------------------------------------------------
# Petits outils sur le texte
# ------------------------------------------------------------
def simple(texte: str) -> str:
    """Texte « aplati » pour comparer : minuscules, sans accents.
    « Linéaires » → « lineaires ». NFD sépare la lettre de son
    accent, puis on jette les accents (catégorie « Mn »)."""
    t = unicodedata.normalize("NFD", texte or "").lower()
    return "".join(c for c in t if unicodedata.category(c) != "Mn")


def cle_titre(titre: str) -> str:
    """Clé anti-doublon : le titre aplati, sans ponctuation ni espaces.
    Le même article vu par le flux du site ET par Google Actualités
    aura la même clé, même si les guillemets diffèrent."""
    return re.sub(r"[^a-z0-9]", "", simple(titre))


def sans_html(texte: str) -> str:
    """Retire les balises HTML et les entités (&amp; → &), et
    resserre les espaces. Les résumés RSS contiennent souvent du HTML."""
    t = re.sub(r"<[^>]+>", " ", texte or "")
    t = html.unescape(t)
    return re.sub(r"\s+", " ", t).strip()


def couper(texte: str, n: int = 280) -> str:
    """Raccourcit à n caractères, sans couper un mot, avec « … »."""
    if len(texte) <= n:
        return texte
    return texte[:n].rsplit(" ", 1)[0].rstrip(",;:.") + "…"


def lire_date(texte: str):
    """Lit une date de flux : RSS (« Tue, 10 Nov 2026 14:45:59 +0000 »)
    ou Atom (« 2026-11-10T14:45:59Z »). Renvoie une date UTC ou None."""
    if not texte:
        return None
    texte = texte.strip()
    try:
        d = parsedate_to_datetime(texte)           # format RSS
    except (TypeError, ValueError):
        try:
            d = datetime.fromisoformat(texte.replace("Z", "+00:00"))  # format Atom
        except ValueError:
            return None
    if d.tzinfo is None:                           # date sans fuseau : on suppose UTC
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc)


# ------------------------------------------------------------
# Téléchargement et lecture d'un flux
# ------------------------------------------------------------
def adresse_du_flux(flux: dict) -> str:
    """Un flux est soit {"url": …}, soit {"google": "recherche"}."""
    if "google" in flux:
        return GOOGLE_NEWS.format(q=urllib.parse.quote(flux["google"]))
    return flux["url"]


def telecharger(adresse: str, dossier_test=None) -> bytes:
    """Télécharge le flux (20 s maximum). En mode test, lit un fichier
    dont le nom est fabriqué à partir de l'adresse."""
    if dossier_test:
        nom = re.sub(r"[^a-zA-Z0-9]+", "_", adresse)[:120] + ".xml"
        return (Path(dossier_test) / nom).read_bytes()
    req = urllib.request.Request(adresse, headers=ENTETES)
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


def sans_espace_de_noms(balise: str) -> str:
    """« {http://www.w3.org/2005/Atom}entry » → « entry ».
    Les flux Atom préfixent leurs balises : on enlève le préfixe
    pour traiter RSS et Atom de la même façon."""
    return balise.rsplit("}", 1)[-1]


def lire_flux(contenu: bytes) -> list:
    """Transforme le XML d'un flux en liste de dict
    {titre, lien, date, resume, source_affichee, source_url}."""
    racine = ET.fromstring(contenu)
    articles = []
    for el in racine.iter():
        nom = sans_espace_de_noms(el.tag)
        if nom not in ("item", "entry"):           # item = RSS, entry = Atom
            continue
        champs = {}
        for enfant in el:
            n = sans_espace_de_noms(enfant.tag)
            if n == "link":
                # Atom : <link href="…"/> ; RSS : <link>…</link>
                champs.setdefault("link", enfant.get("href") or (enfant.text or "").strip())
            elif n == "source":
                # Google Actualités : <source url="…">LSA Conso</source>
                champs["source"] = (enfant.text or "").strip()
                champs["source_url"] = enfant.get("url", "")
            else:
                champs.setdefault(n, enfant.text or "")
        titre = sans_html(champs.get("title", ""))
        if not titre:
            continue
        articles.append({
            "titre": titre,
            "lien": champs.get("link", "").strip(),
            "date": lire_date(champs.get("pubDate") or champs.get("published") or champs.get("updated")),
            "resume": sans_html(champs.get("description") or champs.get("summary") or ""),
            "source_affichee": champs.get("source", ""),
            "source_url": champs.get("source_url", ""),
        })
    return articles


def nettoyer_google(art: dict) -> dict:
    """Google Actualités ajoute « - Nom du site » à la fin du titre et
    met en résumé… le titre lui-même. On enlève les deux."""
    src = art.get("source_affichee")
    if src and art["titre"].endswith(" - " + src):
        art["titre"] = art["titre"][: -len(" - " + src)].strip()
    if cle_titre(art["resume"]).startswith(cle_titre(art["titre"])[:40]):
        art["resume"] = ""
    return art


def domaine(url: str) -> str:
    """« https://www.lsa-conso.fr/truc » → « lsa-conso.fr » (sans « www. »)."""
    d = urllib.parse.urlparse(url or "").netloc.lower()
    return d[4:] if d.startswith("www.") else d


def parle_du_sujet(art: dict, mots: list) -> bool:
    """Vrai si le titre ou le résumé contient l'un des mots-clés
    (comparaison sans accents ni majuscules, mot entier)."""
    texte = simple(art["titre"] + " " + art["resume"])
    return any(re.search(r"\b" + re.escape(simple(m)) + r"\b", texte) for m in mots)


# ------------------------------------------------------------
# Un sujet
# ------------------------------------------------------------
def collecter_sujet(sujet: dict, reglages: dict, dossier_test) -> bool:
    """Collecte UN sujet et réécrit son fichier veille/donnees/<id>.json.
    Renvoie True si le fichier a changé."""
    sortie = DONNEES / f"{sujet['id']}.json"
    maintenant = datetime.now(timezone.utc)
    limite = maintenant - timedelta(days=reglages.get("jours_gardes", 60))
    mots = sujet.get("mots_cles", [])
    print(f"=== {sujet['nom']} ===")

    # 1) Les articles déjà connus, rangés par clé de titre.
    #    On garde leur « vu_le » (date de première découverte) :
    #    c'est grâce à lui que l'appli sait ce qui est nouveau.
    connus, ancien = {}, None
    if sortie.exists():
        try:
            ancien = json.loads(sortie.read_text(encoding="utf-8"))
            for a in ancien.get("articles", []):
                connus[cle_titre(a["titre"])] = a
        except (ValueError, KeyError):
            print(f"⚠ {sortie.name} illisible : on repart de zéro")
            ancien = None

    etat_sources = []      # pour afficher dans l'appli si un flux est en panne
    nouveaux = 0

    # Domaine de chaque site suivi → son id. Sert à ranger sous « LSA » un article
    # de lsa-conso.fr trouvé par la recherche générale (source « autres »).
    par_domaine = {domaine(s["site"]): s["id"] for s in sujet["sources"] if s.get("site")}
    # Les sources « précises » d'abord, la recherche générale en dernier : ainsi un
    # article déjà trouvé par le flux de LSA garde LSA comme source.
    sources = sorted(sujet["sources"], key=lambda s: bool(s.get("autres")))

    # 2) Chaque source, chaque flux
    for src in sources:
        etat = {"id": src["id"], "nom": src["nom"], "court": src.get("court", src["nom"]),
                "site": src.get("site", ""), "couleur": src.get("couleur", "#0f7c7b"),
                "autres": bool(src.get("autres")), "ok": True, "erreurs": []}
        for flux in src["flux"]:
            adresse = adresse_du_flux(flux)
            nom_flux = flux.get("google") or flux.get("url")
            try:
                articles = lire_flux(telecharger(adresse, dossier_test))
            except Exception as e:                  # réseau, XML cassé… on continue avec les autres
                etat["ok"] = False
                etat["erreurs"].append(f"{nom_flux} : {str(e)[:150]}")
                print(f"✗ {src['id']} — {nom_flux} : {e}")
                continue
            print(f"✓ {src['id']} — {len(articles)} articles dans {nom_flux}")

            for art in articles:
                if "google" in flux:
                    art = nettoyer_google(art)
                if flux.get("filtrer") and not parle_du_sujet(art, mots):
                    continue
                date = art["date"] or maintenant
                if date < limite:
                    continue                        # trop vieux
                # À quel site rattacher l'article ? Par défaut la source du flux ;
                # mais si le journal est un site suivi, c'est lui (ex. LSA).
                id_source = par_domaine.get(domaine(art.get("source_url")), src["id"])
                cle = cle_titre(art["titre"])
                deja = connus.get(cle)
                if deja:
                    # Déjà connu : on remplace un lien Google par le lien direct
                    # du site s'il arrive, et on complète un résumé vide.
                    if "news.google." in deja["lien"] and "news.google." not in art["lien"] and art["lien"]:
                        deja["lien"] = art["lien"]
                    if not deja.get("resume") and art["resume"]:
                        deja["resume"] = couper(art["resume"])
                    continue
                connus[cle] = {
                    # identifiant court et stable (sert aux favoris, au « lu » et aux votes)
                    "id": hashlib.sha1(cle.encode()).hexdigest()[:12],
                    "titre": art["titre"],
                    "lien": art["lien"],
                    "source": id_source,
                    # nom du journal tel que Google Actualités le donne (« Les Echos »…),
                    # affiché sur la carte pour les sources « autres »
                    "media": art.get("source_affichee", ""),
                    "date": date.isoformat(timespec="minutes"),
                    "vu_le": maintenant.isoformat(timespec="minutes"),
                    "resume": couper(art["resume"]),
                }
                nouveaux += 1
        etat_sources.append(etat)

    # 3) On oublie les trop vieux, on trie du plus récent au plus ancien, on plafonne
    garder = [a for a in connus.values() if (lire_date(a["date"]) or maintenant) >= limite]
    garder.sort(key=lambda a: a["date"], reverse=True)
    garder = garder[: reglages.get("max_articles", 600)]

    # 4) Écriture. Si rien n'a changé, on ne touche pas au fichier : le workflow
    #    ne fera alors pas de commit (pas de bruit inutile).
    if (ancien and ancien.get("articles") == garder and ancien.get("sources") == etat_sources
            and ancien.get("nom") == sujet["nom"] and ancien.get("mots_cles") == mots):
        print("= rien de nouveau, fichier inchangé")
        return False
    sortie.write_text(json.dumps({
        "version": VERSION,
        "maj": maintenant.isoformat(timespec="minutes"),
        "id": sujet["id"],
        "nom": sujet["nom"],
        "mots_cles": mots,                          # l'appli s'en sert pour « 🎯 Dans le titre »
        "sources": etat_sources,
        "articles": garder,
    }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"→ {len(garder)} articles enregistrés, dont {nouveaux} nouveaux")
    return True


# ------------------------------------------------------------
# Programme principal
# ------------------------------------------------------------
def main():
    dossier_test = None
    if "--dossier-test" in sys.argv:
        dossier_test = sys.argv[sys.argv.index("--dossier-test") + 1]

    reglages = json.loads(REGLAGES.read_text(encoding="utf-8"))
    DONNEES.mkdir(parents=True, exist_ok=True)

    for sujet in reglages["sujets"]:
        collecter_sujet(sujet, reglages, dossier_test)

    # La liste des sujets (= les onglets de l'appli), avec le nombre d'articles
    # et la date du dernier ajout de chacun, lue dans son fichier.
    liste = []
    for sujet in reglages["sujets"]:
        f = DONNEES / f"{sujet['id']}.json"
        d = json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}
        liste.append({"id": sujet["id"], "nom": sujet["nom"],
                      "nb": len(d.get("articles", [])), "maj": d.get("maj")})
    index = DONNEES / "index.json"
    texte = json.dumps({"version": VERSION, "sujets": liste}, ensure_ascii=False, indent=1) + "\n"
    if not index.exists() or index.read_text(encoding="utf-8") != texte:
        index.write_text(texte, encoding="utf-8")


if __name__ == "__main__":
    main()
