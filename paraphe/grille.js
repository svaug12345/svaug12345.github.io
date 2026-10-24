/* =============================================================================
   Paraphe — génération de la grille à imprimer, en PDF, sans bibliothèque.
   -----------------------------------------------------------------------------
   Un PDF est un fichier texte structuré : des « objets » numérotés (catalogue,
   pages, polices, contenus) et une table (xref) qui donne la position en octets
   de chacun. Le dessin d'une page est une suite d'ordres très simples :
     « x y w h re f »  rectangle plein     « x1 y1 m x2 y2 l S »  ligne
     « 0.5 g / 0.5 G »  gris de remplissage / de trait
     « BT /F1 8 Tf x y Td (texte) Tj ET »  écrire du texte
   L'origine est en bas à gauche, l'unité est le point (1/72 de pouce).
   On utilise Helvetica, une police intégrée à tous les lecteurs PDF.
   ========================================================================== */
"use strict";

const Grille = (() => {
  const M = Moteur, MM = M.MM;

  // Les polices intégrées du PDF utilisent l'encodage Windows-1252 : un octet par caractère.
  const CP1252 = { "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94,
    "–": 0x96, "—": 0x97, "œ": 0x9C, "Œ": 0x8C, "Ÿ": 0x9F };
  function octet(c) {
    if (CP1252[c]) return String.fromCharCode(CP1252[c]);
    const v = c.charCodeAt(0);
    return v < 256 ? c : "?";
  }
  // Chaîne PDF entre parenthèses : on protège ( ) et \
  const chaine = s => "(" + [...s].map(octet).join("").replace(/[\\()]/g, m => "\\" + m) + ")";
  const n2 = v => (Math.round(v * 100) / 100).toString();

  /** Largeur approximative d'un texte Helvetica (pour aligner à droite). */
  const largeur = (s, taille) => s.length * taille * 0.52;

  function page(contenu) { return contenu.join("\n"); }

  function reperes(o) {
    const t = M.REP, a = M.MARGE / 2;
    o.push("0 g");
    for (const [x, y] of [[a, a], [M.PW - a - t, a], [a, M.PH - a - t], [M.PW - a - t, M.PH - a - t]])
      o.push(`${n2(x)} ${n2(y)} ${n2(t)} ${n2(t)} re f`);
  }

  /** Numéro de page lisible par l'appli : k petites barres noires près du repère en haut à droite. */
  function barresNumero(o, k) {
    o.push("0 g");
    for (const r of M.marques(k)) o.push(`${n2(r.x)} ${n2(M.PH - r.y - r.h)} ${n2(r.w)} ${n2(r.h)} re f`);   // y retourné : le PDF part du bas
  }

  /** En-tête : titre, numéro de page, puis les consignes (petites lignes grises). */
  function entete(o, titre, numero, total, consignes) {
    const haut = M.PH - M.MARGE, x = M.MARGE + 8 * MM;
    o.push("0 g", `BT /F2 14 Tf ${n2(x)} ${n2(haut - 5 * MM)} Td ${chaine(titre)} Tj ET`);
    const p = `Page ${numero}/${total}`;
    o.push(`BT /F1 9 Tf ${n2(M.PW - M.MARGE - 8 * MM - largeur(p, 9))} ${n2(haut - 5 * MM)} Td ${chaine(p)} Tj ET`);
    consignes.forEach((l, i) => {
      // « **Titre :** suite » : le début en gras, pour qu'on repère vite de quoi parle la ligne
      const [gras, reste] = l.includes("**") ? l.split("**").filter(Boolean) : ["", l];
      const y = n2(haut - 10.5 * MM - i * 3.5 * MM);
      o.push("0.15 g", `BT /F2 7.6 Tf ${n2(x)} ${y} Td ${chaine(gras)} Tj /F1 7.6 Tf ${chaine(reste)} Tj ET`);
    });
  }

  function guides(o, x1, x2, y, C = M.CASE) {
    o.push("0.82 G 0.5 w", `${n2(x1)} ${n2(y + C * M.LB)} m ${n2(x2)} ${n2(y + C * M.LB)} l S`);
    o.push("[2 2] 0 d", `${n2(x1)} ${n2(y + C * M.LX)} m ${n2(x2)} ${n2(y + C * M.LX)} l S`,
      `${n2(x1)} ${n2(y + C * M.LM)} m ${n2(x2)} ${n2(y + C * M.LM)} l S`, "[] 0 d");
  }

  // Consignes : où va quoi par rapport aux 3 lignes. Page 1 et page 2 n'ont pas les mêmes caractères.
  const LIGNES = "**Les lignes : **trait plein = ligne de base, toutes les lettres sont posées dessus ; 1er pointillé = haut des minuscules ; 2e = haut des majuscules.";
  const CONSIGNES = [
    [
      "**Feutre noir, **trait assez épais, une lettre par case, sans toucher les bords de la case.",
      LIGNES,
      "**Jusqu'au 2e pointillé : **les majuscules, les chiffres et les grandes minuscules b, d, f, h, k, l (t un peu moins haut).",
      "**Sous la ligne de base : **seulement les queues de g, j, p, q, y (et du f si tu l'écris ainsi).",
    ],
    [
      "**Feutre noir, **trait assez épais, un caractère par case, sans toucher les bords de la case.",
      LIGNES,
      "**Accents : **au-dessus de la lettre, sous le 2e pointillé pour une minuscule, au-dessus pour une majuscule. Cédille sous la ligne.",
      "**Signes : **écris-les par-dessus le modèle gris clair, à la même place et à la même taille (le point sur la ligne de base…).",
    ],
  ];

  // Largeur des signes en Helvetica (millièmes de la taille) : pour centrer le modèle gris.
  const LARG = { ".": 278, ",": 278, ";": 278, ":": 278, "!": 278, "?": 556, "'": 191, "\"": 355, "-": 333, "_": 556, "(": 333,
    ")": 333, "[": 278, "]": 278, "«": 556, "»": 556, "&": 667, "@": 1015, "€": 556, "$": 556, "%": 889, "/": 278, "+": 584,
    "=": 584, "*": 389, "#": 556, "<": 584, ">": 584, "°": 400, "~": 584 };

  /** Une case : cadre, lignes guides, et soit l'étiquette du caractère, soit (car === null,
      case bonus) le petit carré où l'on écrira quelle lettre on refait.
      r = coin haut-gauche en points (origine en haut, comme dans moteur.js) : on retourne y pour le PDF.
      L'étiquette est en 11 pt (lisible, accents compris) : elle est dans le coin que l'appli efface. */
  function caseImprimee(o, r, car, modele = false) {
    const C = r.C, x = r.x0, y = M.PH - r.y0 - C;
    o.push("0.55 G 0.6 w", `${n2(x)} ${n2(y)} ${n2(C)} ${n2(C)} re S`);
    guides(o, x + 2, x + C - 2, y, C);
    if (car === null) { o.push("0.55 G 0.6 w", `${n2(x + 1.2 * MM)} ${n2(y + C - 6.2 * MM)} ${n2(5 * MM)} ${n2(5 * MM)} re S`); return; }
    o.push("0.3 g", `BT /F1 11 Tf ${n2(x + 1.3 * MM)} ${n2(y + C - 4.8 * MM)} Td ${chaine(car)} Tj ET`);
    if (modele) {
      // Modèle à recopier : le signe en Helvetica, seulement le contour (mode 1 Tr), gris clair et fin.
      // Trop clair pour être pris pour de l'encre au scan ; il montre la place et la taille.
      // Taille : la hauteur des majuscules d'Helvetica (0,718) = de la ligne de base au 2e pointillé.
      const t = (M.LM - M.LB) * C / 0.718, l = (LARG[car] || 500) / 1000 * t;
      o.push("0.68 G 0.35 w 1 Tr", `BT /F1 ${n2(t)} Tf ${n2(x + (C - l) / 2)} ${n2(y + C * M.LB)} Td ${chaine(car)} Tj ET`, "0 Tr");
    }
  }

  /** Traits épais entre deux sections voisines (et autour des cases vides) : quand une
      section ne commence pas sur une nouvelle ligne, on voit quand même où elle commence. */
  function separateurs(o, G, dispo) {
    o.push("0.2 G 1.3 w");
    const sec = i => (i >= 0 && i < G.n ? dispo.section[i] : -2);
    for (let i = 0; i < G.n; i++) {
      if (dispo.cars[i] === null) continue;
      const r = M.rectCase(i, G), x = r.x0, y = M.PH - r.y0 - G.C, C = G.C, col = i % G.cols, lig = Math.floor(i / G.cols);
      const voisins = [
        [col < G.cols - 1 ? sec(i + 1) : -2, [x + C, y, x + C, y + C]],          // à droite
        [lig < G.rows - 1 ? sec(i + G.cols) : -2, [x, y, x + C, y]],             // en dessous
      ];
      for (const [s, [a, b, c, d]] of voisins) if (s !== -2 && s !== dispo.section[i]) o.push(`${n2(a)} ${n2(b)} m ${n2(c)} ${n2(d)} l S`);
    }
  }

  /** Les 2 pages de la grille 5, en contenus PDF : les caractères par sections, puis
      un bandeau d'explication et une rangée de cases bonus en bas de chaque page. */
  function contenus(nom) {
    const G = M.GABARITS[5], total = 2, res = [];
    for (let p = 0; p < 2; p++) {
      // 7 barres = page 1, 8 barres = page 2 (grille 5)
      const o = [], dispo = M.disposition(G, p);
      reperes(o); barresNumero(o, p + 7); entete(o, `La police de ${nom}`, p + 1, total, CONSIGNES[p]);
      dispo.cars.forEach((car, i) => { if (car !== null) caseImprimee(o, M.rectCase(i, G), car, dispo.section[i] === 2 && p === 1); });
      separateurs(o, G, dispo);
      // Bandeau entre la grille et les cases bonus : rassurer, et expliquer quoi faire
      const yB = M.PH - (G.y0 + G.rows * G.C), xB = G.x0;
      o.push("0 g", `BT /F2 9 Tf ${n2(xB)} ${n2(yB - 3.6 * MM)} Td ${chaine("Cases bonus · Une lettre ratée ? Pas de panique !")} Tj ET`);
      o.push("0.25 g", `BT /F1 7.5 Tf ${n2(xB)} ${n2(yB - 7 * MM)} Td ${chaine("Barre la case ratée d'une grande croix, puis refais la lettre ici : écris-la d'abord en petit dans le carré.")} Tj ET`);
      for (let k = 0; k < G.bonus; k++) caseImprimee(o, M.rectCase(G.n + k, G), null);
      res.push(page(o));
    }
    // (Les anciennes grilles avaient une page de phrases et une page de cases bonus :
    // l'appli sait toujours les lire si on les a déjà imprimées.)
    return res;
  }

  /** Feuille de reprise n° k : les lettres à refaire, déjà étiquetées. L'appli reconnaît la feuille
      (9 barres à droite, k barres à gauche) et sait quelle lettre est dans chaque case. */
  function contenuReprise(nom, lettres, k) {
    const G = M.GABARITS.R, o = [], dispo = M.disposition(G, 0, lettres);
    reperes(o); barresNumero(o, 9);
    o.push("0 g"); for (const r of M.marquesGauche(k)) o.push(`${n2(r.x)} ${n2(M.PH - r.y - r.h)} ${n2(r.w)} ${n2(r.h)} re f`);
    const signes = lettres.some(ch => LARG[ch]);
    entete(o, `La police de ${nom} · lettres à refaire n° ${k}`, 1, 1, [
      "**Feutre noir, **trait assez épais, un caractère par case, sans toucher les bords de la case.", LIGNES,
      "**Sous la ligne de base : **seulement les queues de g, j, p, q, y (et f), les cédilles et le bas de la virgule.",
      signes ? "**Signes : **écris-les par-dessus le modèle gris clair, à la même place et à la même taille." : "**Raté ? **Barre la case d'une grande croix : elle sera ignorée.",
    ]);
    dispo.cars.forEach((car, i) => { if (car !== null) caseImprimee(o, M.rectCase(i, G), car, !!LARG[car]); });
    return [page(o)];
  }

  /** Assemble le fichier PDF complet (Uint8Array). */
  function pdf(nom) { return assembler(contenus(nom)); }
  function reprise(nom, lettres, k) { return assembler(contenuReprise(nom, lettres, k)); }
  function assembler(pages) {
    const objets = [];
    // 1 catalogue, 2 arbre des pages, 3-4 polices, puis pour chaque page : page + contenu
    const idsPages = pages.map((_, i) => 5 + 2 * i);
    objets[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    objets[2] = `<< /Type /Pages /Kids [${idsPages.map(i => i + " 0 R").join(" ")}] /Count ${pages.length} >>`;
    objets[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
    objets[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
    pages.forEach((c, i) => {
      const id = idsPages[i];
      objets[id] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n2(M.PW)} ${n2(M.PH)}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${id + 1} 0 R >>`;
      objets[id + 1] = `<< /Length ${c.length} >>\nstream\n${c}\nendstream`;
    });
    return ecrire(objets);
  }

  /** objets[1..n] (chaînes, 1 caractère = 1 octet) → fichier PDF avec sa table xref. */
  function ecrire(objets) {
    // Chaque caractère de nos chaînes vaut un octet : longueur de chaîne = position en octets
    let s = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"; const pos = [];
    for (let i = 1; i < objets.length; i++) { pos[i] = s.length; s += `${i} 0 obj\n${objets[i]}\nendobj\n`; }
    const xref = s.length;
    s += `xref\n0 ${objets.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < objets.length; i++) s += String(pos[i]).padStart(10, "0") + " 00000 n \n";
    s += `trailer\n<< /Size ${objets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255;
    return b;
  }

  /** Octets → chaîne « 1 caractère = 1 octet » (par morceaux : un fichier de police fait ~100 Ko). */
  function binaire(o) {
    let r = ""; for (let i = 0; i < o.length; i += 8192) r += String.fromCharCode(...o.subarray(i, i + 8192));
    return r;
  }

  /** Spécimen à partager : un PDF qui montre la police (elle y est intégrée pour l'affichage)
      ET qui contient le fichier .ttf en pièce jointe. Les applis de partage d'Android refusent
      les fichiers de police, mais acceptent les PDF : c'est le moyen de l'envoyer.
      ttf : octets de la police ; largeurs : caractère → avance (en millièmes) ; lignes : textes d'exemple. */
  function specimen(nom, ttf, largeurs, lignes) {
    const famille = nom.normalize("NFD").replace(/[^A-Za-z0-9]/g, "") || "Police";
    const fichier = `${nom}.ttf`;
    // Largeur de chaque code 32..255 de l'encodage Windows (celui des chaînes du PDF)
    const dec = new TextDecoder("windows-1252"), W = [];
    for (let k = 32; k <= 255; k++) { const ch = dec.decode(new Uint8Array([k])); W.push(largeurs[ch] ?? 500); }
    const o = [], ligne = (police, taille, y, texte, gris = 0) => o.push(`${gris} g BT /${police} ${taille} Tf ${n2(M.MARGE)} ${n2(y)} Td ${chaine(texte)} Tj ET`);
    let y = M.PH - M.MARGE - 10;
    ligne("F2", 18, y, `La police de ${nom}`); y -= 18;
    ligne("F1", 9, y, `Fichier joint à ce PDF : ${fichier} (ouvre les pièces jointes du PDF pour l'installer).`, 0.35); y -= 40;
    for (const [taille, texte] of lignes) { if (y < M.MARGE + taille) break; ligne("F3", taille, y, texte); y -= taille * 1.45; }
    ligne("F1", 8, M.MARGE, "Fait avec Paraphe · svaug12345.github.io/paraphe", 0.5);
    const contenu = o.join("\n"), police = binaire(ttf);
    const objets = [];
    objets[1] = `<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles << /Names [${chaine(fichier)} 9 0 R] >> >> /PageMode /UseAttachments >>`;
    objets[2] = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
    objets[3] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n2(M.PW)} ${n2(M.PH)}] /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> >> /Contents 4 0 R >>`;
    objets[4] = `<< /Length ${contenu.length} >>\nstream\n${contenu}\nendstream`;
    objets[5] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
    objets[6] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
    // Police TrueType intégrée (FontFile2) : le lecteur PDF l'utilise pour afficher le texte
    objets[7] = `<< /Type /Font /Subtype /TrueType /BaseFont /${famille} /FirstChar 32 /LastChar 255 /Widths [${W.join(" ")}] /Encoding /WinAnsiEncoding /FontDescriptor 8 0 R >>`;
    objets[8] = `<< /Type /FontDescriptor /FontName /${famille} /Flags 32 /FontBBox [-200 -400 1500 1100] /ItalicAngle 0 /Ascent 900 /Descent -300 /CapHeight 700 /StemV 80 /FontFile2 10 0 R >>`;
    // Pièce jointe : le fichier .ttf lui-même
    objets[9] = `<< /Type /Filespec /F ${chaine(fichier)} /UF ${chaine(fichier)} /Desc (Police TrueType) /EF << /F 11 0 R >> >>`;
    objets[10] = `<< /Length ${police.length} /Length1 ${police.length} >>\nstream\n${police}\nendstream`;
    objets[11] = `<< /Type /EmbeddedFile /Subtype /font#2Fttf /Length ${police.length} /Params << /Size ${police.length} >> >>\nstream\n${police}\nendstream`;
    return ecrire(objets);
  }

  return { pdf, reprise, specimen, chaine };
})();
