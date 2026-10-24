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

  function entete(o, titre, numero, total, consignes) {
    const haut = M.PH - M.MARGE, x = M.MARGE + 8 * MM;
    o.push("0 g", `BT /F2 14 Tf ${n2(x)} ${n2(haut - 5 * MM)} Td ${chaine(titre)} Tj ET`);
    const p = `Page ${numero}/${total}`;
    o.push(`BT /F1 9 Tf ${n2(M.PW - M.MARGE - 8 * MM - largeur(p, 9))} ${n2(haut - 5 * MM)} Td ${chaine(p)} Tj ET`);
    o.push("0.25 g");
    consignes.forEach((l, i) => o.push(`BT /F1 8 Tf ${n2(x)} ${n2(haut - 11 * MM - i * 3.8 * MM)} Td ${chaine(l)} Tj ET`));
  }

  function guides(o, x1, x2, y, C = M.CASE) {
    o.push("0.82 G 0.5 w", `${n2(x1)} ${n2(y + C * M.LB)} m ${n2(x2)} ${n2(y + C * M.LB)} l S`);
    o.push("[2 2] 0 d", `${n2(x1)} ${n2(y + C * M.LX)} m ${n2(x2)} ${n2(y + C * M.LX)} l S`,
      `${n2(x1)} ${n2(y + C * M.LM)} m ${n2(x2)} ${n2(y + C * M.LM)} l S`, "[] 0 d");
  }

  const CONSIGNES = [
    "Feutre noir, trait assez épais. Une lettre par case, posée sur la ligne de base (trait plein).",
    "Minuscules jusqu'à la ligne du milieu, majuscules et b, d, h, k, l jusqu'à la ligne du haut.",
    "Les queues (g, j, p, q, y) descendent sous la ligne de base. Ne touche pas les bords de la case.",
  ];

  /** Une case : cadre, lignes guides, et soit l'étiquette du caractère, soit (case bonus)
      le petit carré où l'on écrira quelle lettre on refait. r = coin haut-gauche en points
      (origine en haut, comme dans moteur.js) : on retourne y pour le PDF. */
  function caseImprimee(o, r, car) {
    const C = r.C, x = r.x0, y = M.PH - r.y0 - C;
    o.push("0.55 G 0.6 w", `${n2(x)} ${n2(y)} ${n2(C)} ${n2(C)} re S`);
    guides(o, x + 2, x + C - 2, y, C);
    if (car !== null) o.push("0.5 g", `BT /F1 8 Tf ${n2(x + 1.5 * MM)} ${n2(y + C - 3.8 * MM)} Td ${chaine(car)} Tj ET`);
    else o.push("0.55 G 0.6 w", `${n2(x + 1.2 * MM)} ${n2(y + C - 6.2 * MM)} ${n2(5 * MM)} ${n2(5 * MM)} re S`);
  }

  /** Les 3 pages de la grille (2 pages de cases + 1 page de phrases), en contenus PDF.
      Grille 4 : sous les 63 cases de chaque page, un bandeau d'explication et 7 cases bonus. */
  function contenus(nom) {
    const C = M.CASE, x0 = (M.PW - M.COLS * C) / 2, yHaut = M.PH - M.MARGE - M.HAUT_ENTETE;
    const G = M.GABARITS[4], pagesGrille = Math.ceil(M.CARS.length / M.PAR_PAGE), total = pagesGrille + 1, res = [];
    for (let p = 0; p < pagesGrille; p++) {
      // 5 barres = page 1, 6 barres = page 2 (grille 4) : l'appli sait ainsi lire la rangée bonus
      const o = []; reperes(o); barresNumero(o, p + 5); entete(o, `La police de ${nom}`, p + 1, total, CONSIGNES);
      M.CARS.slice(p * M.PAR_PAGE, (p + 1) * M.PAR_PAGE).forEach((car, i) => caseImprimee(o, M.rectCase(i, G), car));
      // Bandeau entre la grille et les cases bonus : rassurer, et expliquer quoi faire
      const yB = M.PH - (G.y0 + M.ROWS * G.C), xB = G.x0;
      o.push("0 g", `BT /F2 9 Tf ${n2(xB)} ${n2(yB - 3.6 * MM)} Td ${chaine("Cases bonus · Une lettre ratée ? Pas de panique !")} Tj ET`);
      o.push("0.25 g", `BT /F1 7.5 Tf ${n2(xB)} ${n2(yB - 7 * MM)} Td ${chaine("Barre la case ratée d'une grande croix, puis refais la lettre ici : écris-la d'abord en petit dans le carré.")} Tj ET`);
      for (let k = 0; k < G.bonus; k++) caseImprimee(o, M.rectCase(M.PAR_PAGE + k, G), null);
      res.push(page(o));
    }
    // Page 3 : phrases à recopier, pour mesurer l'espacement naturel
    const o = []; reperes(o); barresNumero(o, 3);
    entete(o, `La police de ${nom}`, 3, total, [
      "Recopie chaque phrase sur sa ligne, en écrivant normalement, comme dans ton cahier.",
      "Même taille que dans les cases : minuscules jusqu'au 1er pointillé, majuscules jusqu'au 2e.",
      "Ces phrases servent à régler l'espace entre tes lettres et entre tes mots.",
    ]);
    M.PHRASES.forEach((ph, i) => {
      const y = yHaut - (i + 1) * C;
      o.push("0.5 g", `BT /F1 9 Tf ${n2(x0 + 1.5 * MM)} ${n2(y + C - 3.8 * MM)} Td ${chaine(ph.replace("{prenom}", nom))} Tj ET`);
      guides(o, x0, x0 + M.COLS * C, y);
    });
    res.push(page(o));
    // (Jusqu'à la version 1.6, une page 4 entière de cases bonus suivait ; l'appli sait
    // toujours la lire si on l'a déjà imprimée.)
    return res;
  }

  /** Assemble le fichier PDF complet (Uint8Array). */
  function pdf(nom) {
    const pages = contenus(nom), objets = [];
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

  return { pdf };
})();
