"""
Fabrique les PLANS RECONSTITUÉS du 7 villa Marcès (plan-3e.svg et plan-4e.svg).

Principe (le même pour les deux niveaux) :
  1. on dessine d'abord l'EMPRISE des murs en foncé (de gros rectangles) ;
  2. par-dessus, chaque PIÈCE est un polygone clair : ce qui reste foncé entre deux
     pièces, ce sont les murs et les cloisons ;
  3. puis les ouvertures (portes, fenêtres), quelques équipements, et les noms.

Les coordonnées sont celles des scans d'origine (plans/plan-3e.jpg : 1824 × 1845,
plan-4e.jpg : 1674 × 1845), relevées à la main avec une grille, puis « redressées »
(le scan est légèrement de travers). Le dessin reconstitué a donc la même taille et le
même repère que le scan (pratique pour comparer), mais il est recadré sur la partie utile.

Usage :  python3 dessiner.py <dossier de sortie>
"""
import sys

# ---------- Couleurs (accordées au site : pierre, vert du bois, terre cuite) ----------
MUR = "#2f3d38"        # murs et cloisons
VIE = "#fbf1de"        # pièces de vie
NUIT = "#e6efe6"       # chambres, bureau
EAU = "#dcebf1"        # cuisine, salles de bains, WC, buanderie
PASSAGE = "#f3ece0"    # entrée, dégagements, palier, escalier
RANGE = "#e4d8c3"      # placards, cellier, rangements
DEHORS = "#f1d7c6"     # terrasses, balcon
VERT = "#c5dcc0"       # jardinières
VITRE = "#7fb3c8"      # fenêtres et baies vitrées
ENCRE = "#1e2a26"
GRIS = "#8a938f"


class Plan:
    """Petit « crayon » qui accumule des morceaux de SVG."""

    def __init__(self, largeur, hauteur, cadre):
        # cadre = (x, y, largeur, hauteur) de la partie utile : c'est le « viewBox » du SVG,
        # qui recadre le dessin sans changer aucune coordonnée.
        self.l, self.h, self.cadre, self.t = largeur, hauteur, cadre, []

    def rect(self, x1, y1, x2, y2, fond, trait=None, ep=0, extra=""):
        s = f' stroke="{trait}" stroke-width="{ep}"' if trait else ""
        self.t.append(f'<rect x="{x1}" y="{y1}" width="{x2 - x1}" height="{y2 - y1}" fill="{fond}"{s} {extra}/>')

    def poly(self, points, fond, trait=None, ep=0, extra=""):
        s = f' stroke="{trait}" stroke-width="{ep}"' if trait else ""
        pts = " ".join(f"{x},{y}" for x, y in points)
        self.t.append(f'<polygon points="{pts}" fill="{fond}"{s} {extra}/>')

    def ligne(self, x1, y1, x2, y2, trait=ENCRE, ep=3, extra=""):
        self.t.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{trait}" stroke-width="{ep}" {extra}/>')

    def hachures(self, x1, y1, x2, y2):
        """Zone qui ne fait pas partie de l'appartement (autre logement, parties communes)."""
        self.rect(x1, y1, x2, y2, "url(#hachures)")

    def fenetre(self, x1, y1, x2, y2):
        """Fenêtre ou baie : une bande bleutée dans l'épaisseur du mur."""
        self.rect(x1, y1, x2, y2, "#ffffff")
        self.rect(x1, y1, x2, y2, VITRE, extra='opacity=".75"')

    def porte(self, x1, y1, x2, y2, charniere, sens, fond=PASSAGE):
        """Porte : un trou dans le mur (rectangle x1,y1–x2,y2) + le quart de cercle du battant.
        charniere : coin où tourne la porte ('g' gauche / 'd' droite pour un mur horizontal,
        'h' haut / 'b' bas pour un mur vertical) ; sens : de quel côté elle s'ouvre
        ('h' haut, 'b' bas, 'g' gauche, 'd' droite)."""
        self.rect(x1, y1, x2, y2, fond)
        if sens in "hb":                        # mur horizontal
            r = x2 - x1
            cx = x1 if charniere == "g" else x2            # la charnière
            ox = x2 if charniere == "g" else x1            # l'autre bord du trou
            y0 = y1 if sens == "h" else y2
            ye = y0 - r if sens == "h" else y0 + r
            # balayage : sens des aiguilles d'une montre ou non, selon le coin
            sw = 0 if (charniere == "g") == (sens == "b") else 1
            self.t.append(f'<path d="M{cx},{y0} L{cx},{ye} A{r},{r} 0 0 {sw} {ox},{y0}" fill="none" stroke="{ENCRE}" stroke-width="2.5"/>')
        else:                                   # mur vertical
            r = y2 - y1
            cy = y1 if charniere == "h" else y2
            oy = y2 if charniere == "h" else y1
            x0 = x1 if sens == "g" else x2
            xe = x0 - r if sens == "g" else x0 + r
            sw = 0 if (charniere == "h") == (sens == "g") else 1
            self.t.append(f'<path d="M{x0},{cy} L{xe},{cy} A{r},{r} 0 0 {sw} {x0},{oy}" fill="none" stroke="{ENCRE}" stroke-width="2.5"/>')

    def nom(self, x, y, texte, taille=40, couleur=ENCRE, gras=700, extra=""):
        """Nom d'une pièce, centré en (x, y). « | » = retour à la ligne."""
        lignes = texte.split("|")
        y0 = y - (len(lignes) - 1) * taille * 0.58
        for i, li in enumerate(lignes):
            self.t.append(
                f'<text x="{x}" y="{y0 + i * taille * 1.16:.0f}" font-size="{taille}" font-weight="{gras}" fill="{couleur}" '
                f'text-anchor="middle" dominant-baseline="middle" {extra}>{li}</text>')

    def marches(self, x1, y1, x2, y2, n, sens="h"):
        """Escalier : n traits parallèles (sens 'h' = marches horizontales)."""
        for i in range(1, n):
            if sens == "h":
                y = y1 + (y2 - y1) * i / n
                self.ligne(x1, y, x2, y, GRIS, 2)
            else:
                x = x1 + (x2 - x1) * i / n
                self.ligne(x, y1, x, y2, GRIS, 2)

    def svg(self, titre):
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{" ".join(map(str, self.cadre))}" width="{self.cadre[2]}" height="{self.cadre[3]}" '
            f'font-family="Manrope, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif">\n'
            f'<title>{titre}</title>\n'
            # Motif des hachures : des traits gris en biais, répétés
            '<defs><pattern id="hachures" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
            '<rect width="18" height="18" fill="#eceae4"/><line x1="0" y1="0" x2="0" y2="18" stroke="#c9c6bd" stroke-width="7"/></pattern>'
            '<pattern id="toit" width="16" height="16" patternUnits="userSpaceOnUse">'
            '<rect width="16" height="16" fill="#efe9df"/><line x1="0" y1="8" x2="16" y2="8" stroke="#d6cdbd" stroke-width="3"/></pattern></defs>\n'
            f'<rect width="{self.l}" height="{self.h}" fill="#ffffff"/>\n'
            + "\n".join(self.t) + "\n</svg>\n")


# =====================================================================
# 3ᵉ ÉTAGE
# =====================================================================
def plan_3e():
    p = Plan(1824, 1845, (180, 140, 1400, 1530))

    # --- Extérieurs : jardinières (bande à l'est + retours), terrasse, balcon
    p.rect(1400, 170, 1548, 1645, VERT, MUR, 4)            # jardinières : la bande plantée le long de la terrasse
    p.rect(1150, 500, 1400, 925, DEHORS)                   # terrasse
    p.rect(1000, 1530, 1338, 1640, DEHORS, MUR, 4)         # balcon de la chambre 1
    p.rect(262, 1530, 1000, 1640, "url(#hachures)", GRIS, 3)   # balcon du logement voisin

    # --- Emprise des murs (foncé)
    p.rect(215, 185, 1400, 500, MUR)       # rangée du haut : buanderie, cuisine, salle à manger, véranda
    p.rect(215, 500, 1150, 1010, MUR)      # escaliers, WC, cellier, ascenseur, palier, séjour
    p.rect(215, 1010, 965, 1530, MUR)      # logement voisin (hachuré plus bas)
    p.rect(965, 925, 1418, 1530, MUR)      # entrée, chambre 1, salle de bains

    # --- Hors appartement
    p.hachures(250, 1018, 965, 1492)       # logement voisin
    p.hachures(250, 765, 480, 1005)        # cage d'escalier de l'immeuble
    p.hachures(495, 905, 833, 1000)        # palier de l'immeuble (il s'arrête à la porte d'entrée, x ≈ 835)
    p.hachures(495, 668, 645, 880)         # ascenseur
    p.nom(570, 774, "Ascenseur", 24, GRIS, 600)
    p.nom(365, 885, "Escalier|immeuble", 24, GRIS, 600)
    p.nom(664, 952, "Palier", 26, GRIS, 600)

    # --- Pièces
    p.rect(250, 215, 382, 493, EAU)                                        # buanderie
    p.rect(398, 215, 645, 480, EAU)                                        # cuisine
    p.rect(655, 250, 695, 478, RANGE)                                      # placard entre cuisine et salle à manger
    # Séjour + salle à manger + entrée : une seule grande pièce ouverte
    p.poly([(700, 215), (1000, 215), (1000, 480), (1095, 480), (1095, 995),
            (965, 995), (965, 850), (700, 850)], VIE)
    # Entrée : elle commence dès la porte palière (x ≈ 845) et longe le palier de l'immeuble,
    # sous le mur du séjour ; elle s'ouvre sur le séjour par son côté droit (x 965 → 1095).
    p.poly([(845, 905), (965, 905), (965, 880), (1095, 880), (1095, 995), (845, 995)], PASSAGE)
    p.rect(850, 864, 958, 900, RANGE)                                      # placard de l'entrée
    p.rect(1000, 215, 1385, 480, VIE)                                      # véranda
    p.rect(1000, 215, 1385, 480, "#ffffff", extra='opacity=".35"')         # … un peu plus claire que le séjour
    p.poly([(345, 497), (660, 497), (660, 555), (430, 555), (430, 645), (345, 645)], PASSAGE)   # dégagement
    p.rect(250, 500, 340, 645, PASSAGE)                                    # escalier vers le 4ᵉ
    p.marches(250, 500, 340, 645, 9)
    p.rect(437, 565, 655, 640, EAU)                                        # WC
    p.rect(250, 652, 437, 755, RANGE)                                      # cellier
    p.rect(1035, 1000, 1390, 1250, NUIT)                                   # chambre 1
    p.rect(1035, 1258, 1390, 1490, EAU)                                    # salle de bains
    p.rect(978, 1005, 1028, 1250, RANGE)                                   # penderie de la chambre
    p.rect(978, 1258, 1028, 1490, EAU)                                     # meuble-vasque de la salle de bains

    # --- Poteaux / pans de mur entre salle à manger, véranda et terrasse
    p.rect(985, 185, 1008, 250, MUR)
    p.rect(980, 400, 1100, 480, MUR)
    p.rect(1085, 470, 1150, 500, MUR)

    # --- Vitrages (véranda, baies du séjour, fenêtres)
    p.fenetre(1012, 190, 1385, 210)        # véranda, côté nord
    p.fenetre(1385, 190, 1398, 480)        # véranda, côté est
    p.fenetre(1150, 478, 1385, 490)        # véranda / terrasse
    p.fenetre(1108, 505, 1136, 920)        # baies coulissantes du séjour sur la terrasse
    p.fenetre(1160, 940, 1380, 962)        # fenêtre de la chambre 1 sur la terrasse
    p.fenetre(1396, 1040, 1412, 1210)      # chambre 1, côté est
    p.fenetre(1396, 1300, 1412, 1440)      # salle de bains, côté est
    p.fenetre(1060, 1498, 1360, 1522)      # baie de la salle de bains / balcon
    p.fenetre(270, 192, 370, 208)          # buanderie
    p.fenetre(430, 192, 610, 208)          # cuisine
    p.fenetre(740, 192, 960, 208)          # salle à manger

    # --- Portes
    p.porte(833, 915, 845, 990, "b", "d")                  # porte d'entrée (palier → entrée)
    p.porte(660, 500, 700, 553, "h", "d", VIE)             # dégagement → séjour
    p.porte(470, 480, 530, 497, "g", "b")                  # cuisine
    p.porte(340, 493, 382, 500, "d", "b")                  # buanderie
    p.porte(430, 575, 437, 630, "h", "g")                  # WC
    p.porte(350, 645, 420, 652, "g", "b", RANGE)           # cellier
    p.porte(1035, 995, 1095, 1000, "d", "b", NUIT)         # chambre 1
    p.porte(1040, 1250, 1100, 1258, "g", "b", EAU)         # salle de bains

    # --- Équipements (simplifiés)
    p.rect(1205, 1268, 1280, 1420, "#ffffff", MUR, 3, 'rx="14"')           # baignoire
    p.rect(985, 1395, 1021, 1460, "#ffffff", MUR, 3, 'rx="8"')             # vasque
    p.rect(445, 580, 500, 625, "#ffffff", MUR, 3, 'rx="16"')          # cuvette des WC
    p.rect(580, 225, 635, 460, "#ffffff", MUR, 3)                          # plan de travail de la cuisine
    p.rect(588, 270, 627, 320, EAU, MUR, 2)                                # plaques
    p.rect(588, 345, 627, 430, EAU, MUR, 2, 'rx="6"')                      # évier
    p.rect(257, 425, 300, 485, "#ffffff", MUR, 3, 'rx="10"')               # évier de la buanderie

    # --- Noms
    p.nom(897, 640, "Séjour", 50)
    p.nom(850, 330, "Salle|à manger", 40)
    p.nom(1195, 345, "Véranda", 44)
    p.nom(1275, 705, "Terrasse", 46)
    p.nom(1474, 800, "Jardinières", 34, "#3f6b45", 700, 'transform="rotate(-90 1474 800)"')
    p.nom(490, 345, "Cuisine", 36)
    p.nom(316, 320, "Buanderie", 28, extra='transform="rotate(-90 316 320)"')
    p.nom(560, 602, "WC", 30)
    p.nom(343, 703, "Cellier", 30)
    p.nom(295, 572, "↑ 4ᵉ", 26)
    p.nom(985, 950, "Entrée", 30)
    p.nom(1212, 1125, "Chambre 1", 42)
    p.nom(1118, 1375, "Salle|de bains", 30)
    p.nom(1169, 1585, "Balcon", 34)
    p.nom(607, 1255, "Autre logement", 40, GRIS, 600)
    return p.svg("Plan reconstitué du 3ᵉ étage — 7 villa Marcès (non contractuel)")


# =====================================================================
# 4ᵉ ÉTAGE
# =====================================================================
def plan_4e():
    p = Plan(1674, 1845, (420, 135, 1250, 1395))

    # --- Rappel du niveau du dessous (pointillés) et toitures
    p.rect(1297, 165, 1640, 430, "#faf7f1", GRIS, 3, 'stroke-dasharray="14 10"')     # véranda du 3ᵉ, en contrebas
    p.rect(1377, 430, 1640, 960, "#faf7f1", GRIS, 3, 'stroke-dasharray="14 10"')     # terrasse du 3ᵉ, en contrebas
    p.rect(1170, 170, 1297, 425, "url(#toit)", GRIS, 3)                              # toiture
    p.rect(450, 1310, 1560, 1500, "url(#toit)", GRIS, 3)                             # toiture côté sud
    p.rect(1045, 985, 1118, 1345, "url(#toit)", GRIS, 3)

    # --- Terrasse du 4ᵉ et sa jardinière
    p.rect(1118, 985, 1562, 1365, DEHORS, MUR, 5)
    p.rect(1235, 1325, 1558, 1361, VERT, MUR, 3)

    # --- Emprise des murs
    p.rect(450, 180, 1170, 575, MUR)       # chambres 2 et 3, rangements
    p.rect(450, 420, 1375, 985, MUR)       # palier, escalier, bureau, chambre 4
    p.rect(450, 985, 1050, 1312, MUR)      # salle de bains + hors appartement

    # --- Hors appartement
    p.hachures(490, 765, 742, 1305)
    p.hachures(742, 1052, 1045, 1305)
    p.hachures(655, 648, 745, 765)
    p.hachures(755, 655, 905, 850)         # ascenseur
    p.nom(830, 752, "Ascenseur", 24, GRIS, 600)

    # --- Pièces
    p.rect(490, 200, 735, 560, NUIT)                                       # chambre 2
    p.rect(495, 487, 650, 558, RANGE)                                      # … son placard
    p.poly([(745, 200), (1060, 200), (1060, 410), (990, 410), (990, 560), (745, 560)], NUIT)   # chambre 3
    p.rect(997, 204, 1058, 408, RANGE)                                     # … ses placards
    p.rect(850, 507, 988, 558, RANGE)
    p.rect(1090, 195, 1165, 430, RANGE)                                    # rangement sous pente (hauteur 1,78 m)
    p.poly([(655, 568), (1030, 568), (1030, 780), (1000, 780), (1000, 865), (925, 865), (925, 640), (655, 640)], PASSAGE)   # palier
    p.rect(495, 568, 650, 755, PASSAGE)                                    # escalier venant du 3ᵉ
    p.marches(495, 568, 650, 755, 10)
    p.poly([(1040, 438), (1285, 438), (1285, 495), (1350, 495), (1350, 658), (1040, 658)], NUIT)   # bureau
    p.poly([(1040, 675), (1298, 675), (1298, 958), (1105, 958), (1105, 785), (1040, 785)], NUIT)   # chambre 4
    p.rect(1303, 675, 1348, 958, RANGE)                                    # … son placard
    p.poly([(742, 875), (1005, 875), (1005, 995), (820, 995), (820, 1045), (742, 1045)], EAU)      # salle de bains

    # --- Fenêtres
    p.fenetre(520, 184, 700, 198)          # chambre 2
    p.fenetre(775, 184, 960, 198)          # chambre 3
    p.fenetre(1125, 964, 1290, 982)        # chambre 4 → terrasse
    p.fenetre(1354, 520, 1371, 640)        # bureau
    p.rect(1235, 555, 1335, 640, "none", GRIS, 3, 'stroke-dasharray="10 8"')          # fenêtre de toit du bureau

    # --- Portes
    p.porte(660, 560, 735, 568, "d", "h", NUIT)            # chambre 2
    p.porte(745, 560, 820, 568, "g", "h", NUIT)            # chambre 3
    p.porte(1030, 575, 1040, 640, "h", "d", NUIT)          # bureau
    p.porte(1030, 690, 1040, 760, "h", "d", NUIT)          # chambre 4
    p.porte(1100, 430, 1150, 438, "g", "b", RANGE)         # rangement sous pente
    p.porte(930, 865, 995, 875, "d", "b", EAU)             # salle de bains
    p.rect(650, 575, 655, 635, PASSAGE)                    # arrivée de l'escalier sur le palier

    # --- Équipements
    p.rect(748, 885, 812, 1038, "#ffffff", MUR, 3, 'rx="14"')              # baignoire
    p.rect(835, 883, 875, 921, "#ffffff", MUR, 3, 'rx="10"')               # double vasque
    p.rect(885, 883, 925, 921, "#ffffff", MUR, 3, 'rx="10"')

    # --- Noms
    p.nom(612, 345, "Chambre 2", 38)
    p.nom(868, 345, "Chambre 3", 38)
    p.nom(1135, 530, "Bureau", 38)
    p.nom(1169, 730, "Chambre 4", 38)
    p.nom(790, 604, "Palier", 32)
    p.nom(572, 660, "↓ 3ᵉ", 26)
    p.nom(912, 962, "Salle de bains", 24)
    p.nom(1340, 1150, "Terrasse", 46)
    p.nom(1396, 1343, "Jardinières", 24, "#3f6b45")
    p.nom(1128, 300, "Rangement", 24, extra='transform="rotate(-90 1128 300)"')
    p.nom(1468, 298, "Véranda du 3ᵉ|(en contrebas)", 26, GRIS, 600)
    p.nom(1508, 700, "Terrasse|du 3ᵉ|(en contrebas)", 26, GRIS, 600)
    p.nom(1000, 1405, "Toiture", 30, GRIS, 600)
    return p.svg("Plan reconstitué du 4ᵉ étage — 7 villa Marcès (non contractuel)")


if __name__ == "__main__":
    dossier = sys.argv[1]
    open(f"{dossier}/plan-3e.svg", "w").write(plan_3e())
    open(f"{dossier}/plan-4e.svg", "w").write(plan_4e())
    print("plans écrits dans", dossier)
