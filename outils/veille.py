#!/usr/bin/env python3
"""
============================================================
outils/veille.py — collecte de la « Veille » (plusieurs sujets)
Version 2.4.0
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
 • v2.4.0 : CORRECTION : les résumés / photos trouvés lors d'un passage sans nouvel article
            n'étaient jamais enregistrés (la comparaison « rien n'a changé » regardait les
            articles déjà modifiés) → seuls les tout derniers articles avaient un résumé ;
            nouveau champ « site » (domaine du journal) pour afficher son logo dans l'appli
 • v2.3.0 : Google limite le rythme (réponse 429 « trop de demandes ») : 1,5 s entre deux
            décodages, arrêt du décodage dès le premier 429, et les articles non décodés ne
            sont plus marqués « tentés » (retentés au passage suivant ; 3 vrais échecs max) ;
            les liens Google marqués « tentés » par erreur avant la v2.3.0 ont une 2e chance
 • v2.2.0 : 120 articles enrichis par sujet et par collecte (au lieu de 40) : les résumés et
            photos arrivent plus vite
 • v2.1.0 : « enrichissement » : pour chaque nouvel article, le vrai lien est retrouvé
            derrière le lien Google Actualités, puis la page du journal est lue pour en
            garder le chapeau (og:description) et l'image (og:image) → fiche détaillée
            dans l'appli. 40 articles au plus par sujet et par collecte.
============================================================
"""
import base64
import hashlib
import html
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

VERSION = "2.4.0"

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
# Enrichissement : vrai lien, chapeau et image de chaque article
# ------------------------------------------------------------
GOOGLE_FREINE = False       # devient vrai si Google répond 429 (« trop de demandes »)
MAX_ENRICHIS = 120          # articles enrichis au plus par sujet et par collecte (politesse)
TAILLE_PAGE = 600_000       # on ne lit que le début d'une page (les balises <meta> sont en haut)


def id_google(url: str) -> str:
    """« https://news.google.com/rss/articles/CBMi…?oc=5 » → « CBMi… » (ou "" si pas Google)."""
    m = re.search(r"news\.google\.com/(?:rss/)?articles/([^?/#]+)", url or "")
    return m.group(1) if m else ""


def decoder_google(url: str) -> str:
    """Retrouve l'adresse du journal cachée derrière un lien Google Actualités.
    Deux formats existent :
      • ancien : l'identifiant est du base64 qui contient l'adresse en clair ;
      • récent (« AU_yqL… ») : il faut demander à Google, en 2 temps — lire la page
        de l'article pour y prendre une signature et une date (data-n-a-sg / data-n-a-ts),
        puis appeler le service interne « batchexecute » de Google Actualités, qui
        renvoie l'adresse. C'est ce que fait la bibliothèque « googlenewsdecoder ».
    Renvoie "" si on n'y arrive pas (l'article garde alors son lien Google)."""
    ident = id_google(url)
    if not ident:
        return ""
    # 1) ancien format : base64 « url-safe » (on rajoute les « = » de fin qui manquent)
    try:
        brut = base64.urlsafe_b64decode(ident + "=" * (-len(ident) % 4))
        m = re.search(rb"https?://[\x21-\x7e]+", brut)
        if m and not ident.startswith("AU_yqL"):
            return m.group(0).decode("ascii", "ignore")
    except (ValueError, base64.binascii.Error):
        pass
    # 2) format récent : signature + date lues dans la page Google de l'article
    try:
        page = telecharger(f"https://news.google.com/articles/{ident}?hl=fr&gl=FR&ceid=FR:fr").decode("utf-8", "ignore")
        sg = re.search(r'data-n-a-sg="([^"]+)"', page)
        ts = re.search(r'data-n-a-ts="([^"]+)"', page)
        if not (sg and ts):
            return ""
        demande = ('["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],'
                   '"X","X",1,[1,1,1],1,1,null,0,0,null,0],"%s",%s,"%s"]' % (ident, ts.group(1), sg.group(1)))
        corps = "f.req=" + urllib.parse.quote(json.dumps([[["Fbv4je", demande]]]))
        req = urllib.request.Request(
            "https://news.google.com/_/DotsSplashUi/data/batchexecute",
            data=corps.encode(), method="POST",
            headers={**ENTETES, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"})
        with urllib.request.urlopen(req, timeout=15) as rep:
            texte = rep.read().decode("utf-8", "ignore")
        # Réponse : une ligne « )]}' », puis du JSON dont la 3e case contient encore du JSON
        bloc = json.loads(texte.split("\n\n")[1])
        return json.loads(bloc[0][2])[1]
    except Exception as e:
        global GOOGLE_FREINE
        if "429" in str(e):
            # Google nous demande de ralentir : on arrête de décoder pour ce passage
            # (les articles restants seront retentés au prochain passage, 2 h plus tard)
            GOOGLE_FREINE = True
            print("   · Google demande de ralentir (429) : décodage arrêté pour ce passage")
        else:
            print(f"   · lien Google non décodé : {str(e)[:80]}")
        return ""


def lire_meta(page: str, *noms) -> str:
    """Contenu d'une balise <meta property|name="…" content="…">, dans n'importe quel ordre."""
    for nom in noms:
        for motif in (rf'<meta[^>]+(?:property|name)=["\']{nom}["\'][^>]*content=["\']([^"\']+)',
                      rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]*(?:property|name)=["\']{nom}["\']'):
            m = re.search(motif, page, re.I)
            if m:
                return html.unescape(m.group(1)).strip()
    return ""


def enrichir(art: dict) -> None:
    """Complète l'article sur place : vrai lien, chapeau (« resume »), image.
    Ne lève jamais d'erreur : au pire, l'article reste comme il était."""
    lien = art["lien"]
    if id_google(lien):
        if GOOGLE_FREINE:
            return                   # pas tenté : on réessaiera au prochain passage
        vrai = decoder_google(lien)
        time.sleep(1.5)              # Google limite le rythme : on espace les demandes
        if not vrai:
            if not GOOGLE_FREINE:    # vrai échec (pas un simple « ralentissez ») :
                art["essais"] = art.get("essais", 0) + 1   # 3 essais au plus, sur 3 passages
                if art["essais"] >= 3:
                    art["enrichi"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            return
        art.pop("essais", None)
        art["lien"] = lien = vrai
        if not art.get("site"):
            art["site"] = domaine(vrai)
    art["enrichi"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")   # tenté : on ne recommence pas
    try:
        req = urllib.request.Request(lien, headers={**ENTETES, "Accept": "text/html,*/*"})
        with urllib.request.urlopen(req, timeout=12) as rep:
            page = rep.read(TAILLE_PAGE).decode(rep.headers.get_content_charset() or "utf-8", "ignore")
    except Exception as e:
        print(f"   · page illisible ({domaine(lien)}) : {str(e)[:60]}")
        return
    chapeau = sans_html(lire_meta(page, "og:description", "twitter:description", "description"))
    # On garde le chapeau seulement s'il apporte quelque chose de plus que le titre
    if chapeau and cle_titre(chapeau)[:40] != cle_titre(art["titre"])[:40]:
        art["resume"] = couper(chapeau, 400)
    image = lire_meta(page, "og:image", "twitter:image")
    if image.startswith("//"):
        image = "https:" + image
    if image.startswith("http"):
        art["image"] = image


def enrichir_sujet(articles: list) -> int:
    """Enrichit les articles pas encore tentés, du plus récent au plus ancien,
    dans la limite de MAX_ENRICHIS. Renvoie le nombre d'articles tentés."""
    # « à faire » = jamais tenté, ou lien Google pas encore décodé à cause d'un « ralentissez »
    # de Google lors d'un passage précédent (avant la v2.3.0 ils étaient marqués « tentés »)
    a_faire = [a for a in articles if not a.get("enrichi")
               or (id_google(a["lien"]) and not a.get("image") and not a.get("resume") and not a.get("reessaye"))][:MAX_ENRICHIS]
    for a in a_faire:
        if a.get("enrichi") and id_google(a["lien"]):
            a.pop("enrichi"); a["reessaye"] = True      # une seule seconde chance
        enrichir(a)
        time.sleep(0.4)          # on ne bombarde pas les sites
    if a_faire:
        ok = sum(1 for a in a_faire if a.get("image") or (a.get("resume") and "news.google." not in a["lien"]))
        print(f"✦ {len(a_faire)} articles enrichis ({ok} avec chapeau ou image)")
    return len(a_faire)


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
    connus, ancien, avant = {}, None, None
    if sortie.exists():
        try:
            texte_ancien = sortie.read_text(encoding="utf-8")
            ancien = json.loads(texte_ancien)
            # « avant » = une COPIE séparée du fichier, pour savoir à la fin si quelque chose a
            # changé. (Avant la v2.4.0 on comparait avec « ancien », dont les articles sont les
            # mêmes objets que ceux qu'on enrichit : la comparaison disait toujours « pareil »,
            # et les résumés / photos trouvés sans nouvel article n'étaient jamais enregistrés.)
            avant = json.loads(texte_ancien)
            for a in ancien.get("articles", []):
                connus[cle_titre(a["titre"])] = a
        except (ValueError, KeyError):
            print(f"⚠ {sortie.name} illisible : on repart de zéro")
            ancien = avant = None

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
                    if not deja.get("site") and domaine(art.get("source_url")):
                        deja["site"] = domaine(art.get("source_url"))   # articles d'avant la v2.4.0
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
                    # domaine du journal (« ouest-france.fr ») : l'appli s'en sert pour afficher
                    # son logo quand l'article n'a pas de photo
                    "site": domaine(art.get("source_url")) or ("" if "news.google." in art["lien"] else domaine(art["lien"])),
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

    # 3 bis) Enrichissement (pas en mode test : il faut internet)
    if not dossier_test:
        enrichir_sujet(garder)

    # 4) Écriture. Si rien n'a changé, on ne touche pas au fichier : le workflow
    #    ne fera alors pas de commit (pas de bruit inutile).
    if (avant and avant.get("articles") == garder and avant.get("sources") == etat_sources
            and avant.get("nom") == sujet["nom"] and avant.get("mots_cles") == mots):
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
