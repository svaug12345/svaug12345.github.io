/* =============================================================================
   Paraphe — moteur de fabrication de police (aucune IA, aucun serveur)
   -----------------------------------------------------------------------------
   Deux façons d'obtenir le dessin d'une lettre :
     - une PHOTO de la grille imprimée : on retrouve les 4 carrés noirs des coins,
       on redresse la page, on découpe la case ;
     - un DESSIN au doigt ou au stylet : les traits sont rendus dans une case
       virtuelle de la même taille que celle du papier.
   Dans les deux cas on obtient un « masque d'encre » (pixel encré ou non), puis :
     contour → lissage → courbes TrueType → crénage → fichier .ttf.
   ========================================================================== */
"use strict";

const Moteur = (() => {
  // ---------- Géométrie de la grille (identique à grille_police.py) ----------
  const MM = 72 / 25.4, PW = 595.2756, PH = 841.8898;          // A4 en points
  const MARGE = 15 * MM, HAUT_ENTETE = 22 * MM, COLS = 7, ROWS = 9, REP = 6 * MM;
  const CASE = Math.min((PW - 2 * MARGE) / COLS, (PH - 2 * MARGE - HAUT_ENTETE - 6 * MM) / ROWS);
  const LB = 0.28, LX = 0.52, LM = 0.76;                        // lignes guides (fraction de case)
  const PX = 3;                                                 // pixels par point (≈ 216 dpi)
  const E = 700 / ((LM - LB) * CASE * PX);                      // unités de police par pixel
  const PAR_PAGE = COLS * ROWS;
  const CARS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", ..."abcdefghijklmnopqrstuvwxyz", ..."0123456789",
    ..."éèêëàâäùûüôöîïçœæ", ..."ÉÈÊÀÂÙÔÎÇŒ", ...".,;:!?'\"-_()[]&@€$%/+=*#<>«»", ..."ÛËÏÜÄÖÆ°~"];
  const PHRASES = ["Je m'appelle {prenom}.", "Le chat joue au ballon.", "Où sont mes crêpes ?",
    "Voilà, c'est Noël !", "Tu as vu le zèbre ?", "Quatre kiwis verts", "La fourmi travaille.",
    "Hugo, Yves et Wanda"];
  const PONCTU = new Set([..."., ;:!?'\"-()«»’…".replace(" ", "")]);
  const KERN_CARS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789éèêëàâäùûüôöîïçœæÉÈÊÀÂÙÔÎÇŒÛËÏÜÄÖÆ.,;:!?'\"-()«»"];

  // Marge ajoutée à droite de l'apostrophe (unités de police) : « l'été » ne doit pas paraître collé.
  const ESPACE_APRES_APOSTROPHE = 30;

  const DEFAUT = { seuil: 110, graisse: 0, poussieres: 25, lissage: 2.6, pas: 3, approche: 12, espace: 300,
    stylo: 7, normaliser: 80, secours: true, crenage: true, force: 0.75, cible: 30, maxi: 200 };

  // =================== 1. Photo → page redressée ===================

  /** Image (ou canvas) → niveaux de gris, en limitant la taille pour la vitesse. */
  function enGris(source, largeur, hauteur, maxDim = 2600) {
    const s = Math.min(1, maxDim / Math.max(largeur, hauteur));
    const w = Math.round(largeur * s), h = Math.round(hauteur * s);
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    cx.fillStyle = "#fff"; cx.fillRect(0, 0, w, h);
    cx.drawImage(source, 0, 0, w, h);
    const d = cx.getImageData(0, 0, w, h).data, g = new Uint8Array(w * h);
    for (let i = 0; i < g.length; i++) g[i] = (d[4 * i] * 299 + d[4 * i + 1] * 587 + d[4 * i + 2] * 114) / 1000;
    return { gris: g, w, h };
  }

  /** Corrige l'éclairage d'une photo : on estime la couleur du papier partout
      (le pixel le plus clair de chaque bloc de ~1 cm, puis lissé), et on divise.
      Une ombre ou un coin plus sombre redevient blanc, l'encre reste noire. */
  function normaliser({ gris, w, h }) {
    const B = Math.max(16, Math.round(Math.max(w, h) / 27));      // bloc plus grand qu'un carré repère
    const gw = Math.ceil(w / B), gh = Math.ceil(h / B), fond = new Float32Array(gw * gh);
    for (let by = 0; by < gh; by++) for (let bx = 0; bx < gw; bx++) {
      let m = 0;
      for (let y = by * B; y < Math.min(h, (by + 1) * B); y += 2) for (let x = bx * B; x < Math.min(w, (bx + 1) * B); x += 2) {
        const v = gris[y * w + x]; if (v > m) m = v;
      }
      fond[by * gw + bx] = m;
    }
    const lisse = new Float32Array(gw * gh);                       // moyenne 3×3 des blocs
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue; s += fond[yy * gw + xx]; n++;
      }
      lisse[y * gw + x] = Math.max(40, s / n);
    }
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const fy = Math.min(gh - 1.001, Math.max(0, y / B - 0.5)), y0 = Math.floor(fy), ty = fy - y0;
      for (let x = 0; x < w; x++) {
        const fx = Math.min(gw - 1.001, Math.max(0, x / B - 0.5)), x0 = Math.floor(fx), tx = fx - x0;
        const k = y0 * gw + x0, x1 = Math.min(x0 + 1, gw - 1) - x0, y1 = Math.min(y0 + 1, gh - 1) - y0;
        const f = (lisse[k] * (1 - tx) + lisse[k + x1] * tx) * (1 - ty) + (lisse[k + y1 * gw] * (1 - tx) + lisse[k + y1 * gw + x1] * tx) * ty;
        out[y * w + x] = Math.min(255, gris[y * w + x] * 255 / f);
      }
    }
    return { gris: out, w, h };
  }

  /** Seuil d'Otsu : sépare automatiquement le « foncé » du « clair » via l'histogramme. */
  function otsu(g) {
    const hist = new Float64Array(256); for (const v of g) hist[v]++;
    let somme = 0; for (let i = 0; i < 256; i++) somme += i * hist[i];
    let sB = 0, wB = 0, meilleur = 0, seuil = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue; const wF = g.length - wB; if (!wF) break;
      sB += t * hist[t]; const v = wB * wF * (sB / wB - (somme - sB) / wF) ** 2;
      if (v > meilleur) { meilleur = v; seuil = t; }
    }
    return seuil;
  }

  /** Taches connexes (4-voisinage) avec boîte, surface, centre et éventuellement leurs pixels. */
  function taches(bin, w, h, garderPixels = false) {
    const lab = new Int32Array(w * h), res = [], pile = new Int32Array(w * h);
    let n = 0;
    for (let i = 0; i < w * h; i++) {
      if (!bin[i] || lab[i]) continue;
      n++; let haut = 0; pile[haut++] = i; lab[i] = n;
      let x0 = w, y0 = h, x1 = 0, y1 = 0, aire = 0, sx = 0, sy = 0; const pix = garderPixels ? [] : null;
      while (haut) {
        const p = pile[--haut], x = p % w, y = (p / w) | 0;
        aire++; sx += x; sy += y; if (pix) pix.push(p);
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && bin[p - 1] && !lab[p - 1]) { lab[p - 1] = n; pile[haut++] = p - 1; }
        if (x < w - 1 && bin[p + 1] && !lab[p + 1]) { lab[p + 1] = n; pile[haut++] = p + 1; }
        if (y > 0 && bin[p - w] && !lab[p - w]) { lab[p - w] = n; pile[haut++] = p - w; }
        if (y < h - 1 && bin[p + w] && !lab[p + w]) { lab[p + w] = n; pile[haut++] = p + w; }
      }
      res.push({ x0, y0, x1, y1, aire, cx: sx / aire, cy: sy / aire, pix });
    }
    return res;
  }

  /** Les 4 carrés noirs : pour chaque coin de l'image, la tache carrée et pleine la plus proche. */
  function trouverReperes({ gris, w, h }) {
    const t = Math.min(otsu(gris), 140), bin = new Uint8Array(w * h);
    for (let i = 0; i < bin.length; i++) bin[i] = gris[i] < t ? 1 : 0;
    const cand = taches(bin, w, h).filter(c => {
      const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1, cote = Math.max(bw, bh);
      // sur une photo la feuille n'occupe pas toute l'image : on accepte une large plage de tailles
      return cote > w / 160 && cote < w / 12 && c.aire > 0.65 * bw * bh && Math.min(bw, bh) > 0.6 * cote;
    });
    const coins = [[0, 0], [w, 0], [w, h], [0, h]];
    const choisis = coins.map(([X, Y]) => {
      let best = null, d = Infinity;
      for (const c of cand) { const dd = Math.hypot(c.cx - X, c.cy - Y); if (dd < d) { d = dd; best = c; } }
      return best && d < 0.45 * Math.hypot(w, h) ? best : null;
    });
    if (choisis.some(p => !p) || new Set(choisis).size < 4) return null;
    // contrôle : les 4 repères doivent avoir à peu près la même taille
    const tailles = choisis.map(c => Math.sqrt(c.aire)), tm = tailles.reduce((a, b) => a + b) / 4;
    if (tailles.some(s => Math.abs(s - tm) > 0.5 * tm)) return null;
    return choisis.map(c => [c.cx, c.cy]);
  }

  /** Pour le viseur de la caméra : image (petite, ~480 px) → les repères trouvés.
      { coins: 4 points [x, y] (ou null), nb: combien de coins ont un carré candidat }.
      Rapide : on travaille sur une image réduite, plusieurs fois par seconde. */
  function viser(source, largeur, hauteur) {
    const scan = normaliser(enGris(source, largeur, hauteur, 480));
    const coins = trouverReperes(scan), k = largeur / scan.w;
    if (coins) return { coins: coins.map(([x, y]) => [x * k, y * k]), nb: 4 };
    // combien de coins de l'image ont un carré plausible : pour guider (« 3 carrés sur 4 »)
    const t = Math.min(otsu(scan.gris), 140), bin = new Uint8Array(scan.w * scan.h);
    for (let i = 0; i < bin.length; i++) bin[i] = scan.gris[i] < t ? 1 : 0;
    const cand = taches(bin, scan.w, scan.h).filter(c => {
      const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1, cote = Math.max(bw, bh);
      return cote > scan.w / 160 && cote < scan.w / 12 && c.aire > 0.65 * bw * bh && Math.min(bw, bh) > 0.6 * cote;
    });
    const quarts = new Set(cand.map(c => (c.cx > scan.w / 2 ? 1 : 0) + (c.cy > scan.h / 2 ? 2 : 0)));
    return { coins: null, nb: quarts.size };
  }

  /** Homographie : les 8 coefficients qui envoient 4 points « dst » sur 4 points « src ». */
  function homographie(dst, src) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [u, v] = dst[i], [x, y] = src[i];
      A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
      A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
    }
    for (let c = 0; c < 8; c++) {                                  // élimination de Gauss avec pivot
      let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
      for (let r = 0; r < 8; r++) {
        if (r === c) continue; const f = A[r][c] / A[c][c];
        for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c];
      }
    }
    return b.map((v, i) => v / A[i][i]);
  }

  /** Photo → page A4 redressée et éclairage corrigé, ou { erreur }. */
  function redresser(photo) {
    const scan = normaliser(photo), rep = trouverReperes(scan);
    if (!rep) return { erreur: "Les 4 carrés noirs des coins sont introuvables." };
    const d = (MARGE / 2 + REP / 2) * PX, W = Math.round(PW * PX), H = Math.round(PH * PX);
    const [a, b, c, e, f, g, i, j] = homographie([[d, d], [W - d, d], [W - d, H - d], [d, H - d]], rep);
    const out = new Uint8Array(W * H), { gris, w, h } = scan;
    for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) {
      const z = i * u + j * v + 1, x = (a * u + b * v + c) / z, y = (e * u + f * v + g) / z;
      const x0 = Math.floor(x), y0 = Math.floor(y);
      if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) { out[v * W + u] = 255; continue; }
      const fx = x - x0, fy = y - y0, k = y0 * w + x0;             // interpolation bilinéaire
      out[v * W + u] = (gris[k] * (1 - fx) + gris[k + 1] * fx) * (1 - fy) + (gris[k + w] * (1 - fx) + gris[k + w + 1] * fx) * fy;
    }
    return { gris: out, w: W, h: H };
  }

  // =================== 2. Cases et masques d'encre ===================

  // ---------- Deux « gabarits » de grille ----------
  // Grille 3 (jusqu'à la 1.6) : 9 rangées de cases de 25,7 mm ; les cases bonus étaient sur une page 4.
  // Grille 4 (depuis la 1.7) : les mêmes 63 cases, un peu plus petites (23,5 mm), PLUS une rangée
  // de 7 cases bonus en bas de chaque page, sous un bandeau d'explication.
  // La page dit elle-même quel gabarit elle utilise grâce aux barres de numéro (voir identifierPage).
  // Grille 5 (depuis la 1.8) : 2 pages seulement (plus de page de phrases), 8 colonnes de cases
  // de 22,5 mm, les caractères rangés par SECTION (majuscules, minuscules…), une rangée de
  // 8 cases bonus en bas. La « feuille de reprise » (lettres à refaire) a les mêmes cases.
  const CASE4 = 23.5 * MM, BANDE4 = 8 * MM, NB_BONUS = COLS;
  const CASE5 = 22.5 * MM, ENTETE5 = 26 * MM;
  const gabarit = (num, C, cols, rows, y0, bande, bonus) =>
    ({ num, C, cols, rows, n: cols * rows, x0: (PW - cols * C) / 2, y0, bande, bonus });
  const GABARITS = {
    3: gabarit(3, CASE, COLS, ROWS, MARGE + HAUT_ENTETE, 0, 0),
    4: gabarit(4, CASE4, COLS, ROWS, MARGE + HAUT_ENTETE, BANDE4, COLS),
    5: gabarit(5, CASE5, 8, 9, MARGE + ENTETE5, BANDE4, 8),
    R: gabarit("R", CASE5, 8, 9, MARGE + ENTETE5, 0, 0),
    // Grille 6 (1.9) : comme la 5, mais chaque case commence par un MODÈLE gris du caractère,
    // à sa vraie hauteur sur les lignes, dans une bande de 7 mm à gauche (on écrit à sa droite).
    // Le bandeau « seconde chance » a une ligne de plus (11 mm).
    6: { ...gabarit(6, CASE5, 8, 9, MARGE + ENTETE5, 11 * MM, 8), modele: 7 * MM },
    R6: { ...gabarit("R6", CASE5, 8, 9, MARGE + ENTETE5, 0, 0), modele: 7 * MM },
  };
  /** Gabarit d'une page scannée : reconnu une seule fois puis mémorisé sur la page. */
  function geo(page) {
    if (!page) return GABARITS[3];
    if (!page.gabarit) page.gabarit = identifierPage(page).gabarit;
    return GABARITS[page.gabarit];
  }

  /** Coin haut-gauche (en points) de la case n° idx. Les cases après les n cases de lettres
      sont la rangée bonus : elles sont décalées vers le bas de la hauteur du bandeau. */
  function rectCase(idx, g = GABARITS[3]) {
    if (g && g.gris) g = geo(g);                    // on accepte aussi une page en paramètre
    const col = idx % g.cols, lig = Math.floor(idx / g.cols);
    return { x0: g.x0 + col * g.C, y0: g.y0 + lig * g.C + (lig >= g.rows ? g.bande : 0), C: g.C };
  }

  // ---------- Quel caractère dans quelle case ? (la « disposition ») ----------
  // Grilles 3 et 4 : les 126 caractères à la suite, 63 par page, dans l'ordre de CARS.
  // Grille 5 : par sections. Chaque section commence sur une nouvelle ligne si la page a
  // encore la place ; sinon elle suit la précédente et un trait épais les sépare.
  const SECTIONS5 = [
    [["Majuscules", "ABCDEFGHIJKLMNOPQRSTUVWXYZ"], ["Minuscules", "abcdefghijklmnopqrstuvwxyz"], ["Chiffres", "0123456789"]],
    [["Minuscules accentuées", "éèêëàâäùûüôöîïçœæ"], ["Majuscules accentuées", "ÉÈÊËÀÂÄÙÛÜÔÖÎÏÇŒÆ"],
     ["Signes", ".,;:!?'\"-_()[]«»&@€$%/+=*#<>°~"]],
  ];
  /** Place les sections d'une page dans cols × rows cases → { cars: [car|null], section: [n°|-1] }. */
  function placer(sections, cols, total) {
    const cars = Array(total).fill(null), section = Array(total).fill(-1);
    let pos = 0;
    sections.forEach(([, txt], k) => {
      const t = [...txt], reste = sections.slice(k).reduce((s, [, x]) => s + [...x].length, 0);
      const ligne = Math.ceil(pos / cols) * cols;           // début de la ligne suivante
      if (k > 0 && ligne + reste <= total) pos = ligne;     // assez de place : on passe à la ligne
      t.forEach(ch => { cars[pos] = ch; section[pos] = k; pos++; });
    });
    return { cars, section };
  }
  const DISPO5 = SECTIONS5.map(secs => placer(secs, 8, 72));
  /** Disposition de la page n (0 ou 1) d'un gabarit ; pour la feuille de reprise, la liste de ses lettres. */
  function disposition(g, n, lettres) {
    if (g.num === 5 || g.num === 6) return DISPO5[n];
    if (g.num === "R" || g.num === "R6") return { cars: Array.from({ length: g.n }, (_, i) => (lettres || [])[i] ?? null), section: Array(g.n).fill(0) };
    const cars = Array.from({ length: PAR_PAGE }, (_, i) => CARS[n * PAR_PAGE + i] ?? null);
    return { cars, section: cars.map(() => 0) };
  }

  /** Toutes les cases d'une page (lettres puis bonus), pour dessiner le quadrillage de contrôle. */
  function casesPage(page) {
    const g = geo(page); return Array.from({ length: g.n + g.bonus }, (_, i) => rectCase(i, g));
  }

  // On découpe la case 0,3 mm à l'intérieur de son cadre. (Avant : 1,2 mm, et les queues
  // des g, y, j qui descendaient près du bord étaient coupées.) Le cadre imprimé qui pourrait
  // encore apparaître est effacé ensuite par effacerCadre().
  const RETRAIT = 0.3 * MM;
  const cacheCases = new WeakMap();
  /** Case d'une page, floutée (gaussien 5×5) ; mise en cache car indépendante des réglages.
      Le résultat est toujours à l'échelle d'une case de grille 3 : une case plus petite
      (grille 4) est agrandie à la lecture, si bien que tout le reste du calcul est identique. */
  function caseFloue(page, idx) {
    let c = cacheCases.get(page); if (!c) { c = new Map(); cacheCases.set(page, c); }
    if (c.has(idx)) return c.get(idx);
    const geom = geo(page), { x0, y0 } = rectCase(idx, geom), f = geom.C / CASE, r = RETRAIT;
    const sx = Math.floor((x0 + r * f) * PX), sy = Math.floor((y0 + r * f) * PX);   // 1er pixel lu sur la page
    const w = Math.floor((CASE - 2 * r) * PX), h = w;
    const g = new Float32Array(w * h), tmp = new Float32Array(w * h), k = [1, 4, 6, 4, 1];
    // Lecture avec interpolation bilinéaire : le pixel (x, y) de la case vient du point
    // (sx + x·f, sy + y·f) de la page. Avec f = 1 (grille 3) ce sont des pixels entiers, copiés tels quels.
    const lire = (u, v) => {
      const u0 = Math.floor(u), v0 = Math.floor(v), fu = u - u0, fv = v - v0, q = v0 * page.w + u0, G = page.gris;
      if (u0 < 0 || v0 < 0 || u0 >= page.w - 1 || v0 >= page.h - 1) return 255;
      return (G[q] * (1 - fu) + G[q + 1] * fu) * (1 - fv) + (G[q + page.w] * (1 - fu) + G[q + page.w + 1] * fu) * fv;
    };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = lire(sx + x * f, sy + y * f);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, n = 0; for (let t = -2; t <= 2; t++) { const xx = x + t; if (xx >= 0 && xx < w) { s += k[t + 2] * g[y * w + xx]; n += k[t + 2]; } }
      tmp[y * w + x] = s / n;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, n = 0; for (let t = -2; t <= 2; t++) { const yy = y + t; if (yy >= 0 && yy < h) { s += k[t + 2] * tmp[yy * w + x]; n += k[t + 2]; } }
      g[y * w + x] = s / n;
    }
    // ligne de base : sa position sur la page, ramenée à l'échelle de la case lue
    const res = { flou: g, w, h, base: ((y0 + geom.C * (1 - LB)) * PX - sy) / f };
    c.set(idx, res); return res;
  }

  /** Une passe de dilatation ou d'érosion 3×3. */
  function morpho(m, w, h, dilater) {
    const o = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = dilater ? 0 : 1;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy, p = xx >= 0 && yy >= 0 && xx < w && yy < h ? m[yy * w + xx] : 0;
        if (dilater && p) v = 1; if (!dilater && !p) v = 0;
      }
      o[y * w + x] = v;
    }
    return o;
  }

  /** Efface le cadre imprimé de la case s'il est entré dans la découpe (feuille un peu décalée).
      1. Une rangée (ou colonne) près du bord encrée sur plus de 40 % de sa longueur, c'est le
         cadre : on efface ses pixels, SAUF là où il y a aussi de l'encre un peu au-dessus ou
         au-dessous (une queue de « g » qui traverse le cadre doit rester entière).
      2. Toute tache entièrement collée contre un bord (dans les 1,5 mm) est un reste de cadre. */
  function effacerCadre(m, w, h) {
    const bande = Math.round(2.5 * MM * PX), d = Math.round(0.9 * MM * PX), o = m.slice();   // o : copie intacte
    const encre = (x, y) => x >= 0 && y >= 0 && x < w && y < h && o[y * w + x];
    for (let y = 0; y < h; y++) {                                   // rangées du haut et du bas
      if (y >= bande && y < h - bande) continue;
      let n = 0; for (let x = 0; x < w; x++) n += o[y * w + x];
      if (n > 0.4 * w) for (let x = 0; x < w; x++) if (!encre(x, y - d) && !encre(x, y + d)) m[y * w + x] = 0;
    }
    for (let x = 0; x < w; x++) {                                   // colonnes de gauche et de droite
      if (x >= bande && x < w - bande) continue;
      let n = 0; for (let y = 0; y < h; y++) n += o[y * w + x];
      if (n > 0.4 * h) for (let y = 0; y < h; y++) if (!encre(x - d, y) && !encre(x + d, y)) m[y * w + x] = 0;
    }
    const b = Math.round(1.5 * MM * PX);
    for (const t of taches(m, w, h, true))
      if (t.x1 < b || t.y1 < b || t.x0 > w - 1 - b || t.y0 > h - 1 - b) for (const q of t.pix) m[q] = 0;
  }

  /** Une case barrée d'une grande croix (ou d'un grand trait en diagonale) ?
      On essaie des droites qui traversent la case d'un coin à l'autre (avec un peu de jeu sur
      les extrémités, car à main levée on ne vise pas pile le coin) et on regarde quelle part de
      chaque droite passe sur de l'encre. Une lettre, même un X, ne couvre jamais plus de 65 %
      d'une diagonale de la case (elle tient entre les lignes guides) ; un trait de rature, si.
      zone = rectangle du coin haut-gauche à ignorer (l'étiquette, effacée ensuite). */
  function estBarree(m, w, h, zone) {
    // Image intégrale : permet de savoir en une opération s'il y a de l'encre dans un carré.
    const W = w + 1, I = new Int32Array(W * (h + 1));
    for (let y = 0; y < h; y++) { let s = 0; for (let x = 0; x < w; x++) { s += m[y * w + x]; I[(y + 1) * W + x + 1] = I[y * W + x + 1] + s; } }
    const tol = Math.round(1.2 * MM * PX);
    const proche = (x, y) => {                       // de l'encre à moins de 1,2 mm de (x, y) ?
      const a = Math.max(0, Math.round(x) - tol), b = Math.max(0, Math.round(y) - tol);
      const c = Math.min(w, Math.round(x) + tol + 1), d = Math.min(h, Math.round(y) + tol + 1);
      return c > a && d > b && I[d * W + c] - I[b * W + c] - I[d * W + a] + I[b * W + a] > 0;
    };
    // Décalage des extrémités, en fraction de case : positif = glissé le long du bord du haut
    // (ou du bas), négatif = le long du bord vertical. On reste proche de la vraie diagonale
    // (± 3 mm environ) : une droite trop penchée suivrait le jambage d'une lettre.
    const decalages = [-0.12, -0.06, 0, 0.06, 0.12], N = 40;
    const bout = (d, haut, gauche) => {                // extrémité près d'un coin, décalée de d
      const x = gauche ? 0 : w, y = haut ? 0 : h, sx = gauche ? 1 : -1, sy = haut ? 1 : -1;
      return d >= 0 ? [x + sx * d * w, y] : [x, y - sy * d * h];
    };
    for (const diag of [0, 1]) for (const da of decalages) for (const db of decalages) {
      // diagonale 0 : du coin haut-gauche au coin bas-droit ; 1 : du haut-droit au bas-gauche.
      const [xa, ya] = bout(da, true, diag === 0), [xb, yb] = bout(db, false, diag === 1);
      const vus = [];
      for (let k = 0; k < N; k++) {
        const t = 0.04 + 0.92 * k / (N - 1), x = xa + (xb - xa) * t, y = ya + (yb - ya) * t;
        if (x < zone.w && y < zone.h) continue;        // dans l'étiquette : on ne compte pas
        vus.push(proche(x, y));
      }
      // Le trait doit couvrir presque toute la droite, ET ses deux bouts (le premier et le
      // dernier quart des points vus) : pas seulement le milieu, là où sont les lettres.
      const n = vus.length, q = Math.floor(n / 4), somme = a => a.reduce((s, v) => s + v, 0);
      if (n > 20 && somme(vus) >= 0.8 * n && somme(vus.slice(0, q)) >= 0.6 * q && somme(vus.slice(n - q)) >= 0.6 * q) return true;
    }
    return false;
  }

  /** Analyse d'une case scannée → { masque (ou null si vide ou barrée), barree }.
      Seuil, cadre, rature, étiquette effacée, poussières, épaisseur. */
  function analyserCase(page, idx, p, bonus = false) {
    const c = caseFloue(page, idx), { w, h } = c; let m = new Uint8Array(w * h);
    for (let i = 0; i < m.length; i++) m[i] = c.flou[i] < p.seuil ? 1 : 0;
    effacerCadre(m, w, h);
    // Coin haut-gauche effacé : l'étiquette imprimée (grille) ou, sur une case bonus,
    // le petit carré où l'enfant a écrit quelle lettre il refait (zone un peu plus grande).
    // Mesures depuis le coin de la case, puis converties en pixels de la découpe.
    let lh = Math.round(((bonus ? 7.4 : 6.2) * MM - RETRAIT) * PX), lw = Math.round(((bonus ? 7.4 : 7.2) * MM - RETRAIT) * PX);
    // Grille 6 : toute la bande du modèle, à gauche, sur toute la hauteur (+ 0,6 mm de marge).
    // La case lue est à l'échelle d'une case de grille 3 : on divise par le rapport des tailles.
    const g = geo(page);
    if (g.modele && !bonus) { lh = h; lw = Math.round(((g.modele + 0.6 * MM) * CASE / g.C - RETRAIT) * PX); }
    const barree = estBarree(m, w, h, { w: lw, h: lh });
    if (barree) return { masque: null, barree: true };
    for (let y = 0; y < lh && y < h; y++) for (let x = 0; x < lw && x < w; x++) m[y * w + x] = 0;
    for (const t of taches(m, w, h, true)) if (t.aire <= p.poussieres) for (const q of t.pix) m[q] = 0;
    for (let k = 0; k < Math.abs(p.graisse); k++) m = morpho(m, w, h, p.graisse > 0);
    return { masque: m.some(v => v) ? { m, w, h, base: c.base } : null, barree: false };
  }
  /** Masque d'encre d'une case (null si elle est vide ou barrée). */
  function masqueScan(page, idx, p, bonus = false) { return analyserCase(page, idx, p, bonus).masque; }

  // ---------- Reconnaître quelle page de la grille on a scannée ----------
  // Depuis la version 3 de la grille, chaque page porte en haut à droite, à gauche du carré
  // repère, de 1 à 4 petites barres noires : leur nombre = numéro de la page.
  // (Des barres et pas des carrés : elles ne peuvent pas être confondues avec les repères.)
  const MARQUE = { l: 1.6 * MM, h: 4 * MM, pas: 3.6 * MM };
  /** Rectangles des marques de la page k, en points, origine en HAUT à gauche. */
  function marques(k) {
    const droite = PW - MARGE / 2 - REP - 3 * MM, haut = MARGE / 2 + (REP - MARQUE.h) / 2;
    return Array.from({ length: k }, (_, i) => ({ x: droite - i * MARQUE.pas - MARQUE.l, y: haut, w: MARQUE.l, h: MARQUE.h }));
  }
  /** Marques en haut à GAUCHE (à droite du repère) : numéro d'une feuille de reprise (1 à 5). */
  function marquesGauche(k) {
    const gauche = MARGE / 2 + REP + 3 * MM, haut = MARGE / 2 + (REP - MARQUE.h) / 2;
    return Array.from({ length: k }, (_, i) => ({ x: gauche + i * MARQUE.pas, y: haut, w: MARQUE.l, h: MARQUE.h }));
  }
  /** Compte les barres noires dans le rectangle qui contient les rectangles r. */
  function compterBarres(page, r) {
    const xs = r.flatMap(q => [q.x, q.x + q.w]), x0 = Math.min(...xs) - 1 * MM, x1 = Math.max(...xs) + 1 * MM;
    const y0 = r[0].y - 1 * MM, y1 = r[0].y + r[0].h + 1 * MM;
    const W = Math.round((x1 - x0) * PX), H = Math.round((y1 - y0) * PX), bin = new Uint8Array(W * H);
    for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) bin[v * W + u] = page.gris[(Math.round(y0 * PX) + v) * page.w + Math.round(x0 * PX) + u] < 110 ? 1 : 0;
    return taches(bin, W, H).filter(t => t.aire > 0.35 * MARQUE.l * MARQUE.h * PX * PX).length;
  }

  /** Assombrissement moyen d'un rectangle de la page redressée (0 = blanc, 255 = noir). */
  function noirceur(page, x, y, w, h) {
    let s = 0, n = 0;
    for (let v = Math.floor(y * PX); v < (y + h) * PX; v++) for (let u = Math.floor(x * PX); u < (x + w) * PX; u++) { s += 255 - page.gris[v * page.w + u]; n++; }
    return n ? s / n : 0;
  }

  /** Page redressée → { num: 1 à 4 ou null, phrases: vrai si c'est la page de phrases }.
      1. on compte les barres de numéro (grilles récentes) ;
      2. sinon (anciennes grilles) : pas de traits verticaux de cases = page de phrases ;
         une dernière ligne de cases sans bordure = ancienne page 2 (elle était incomplète). */
  function identifierPage(page) {
    const res = identifierBrut(page);
    return { ...res, gabarit: res.gabarit || 3 };
  }
  // Nombre de barres → page : 1 et 2 = pages de lettres (grille 3), 3 = phrases,
  // 4 = ancienne page de cases bonus, 5 et 6 = pages 1 et 2 de la grille 4,
  // 7 et 8 = pages 1 et 2 de la grille 5, 9 = feuille de reprise (son numéro : barres à gauche),
  // 10 et 11 = pages 1 et 2 de la grille 6, 12 = feuille de reprise avec modèles.
  function identifierBrut(page) {
    const barres = compterBarres(page, marques(12));
    if (barres === 9 || barres === 12) return { num: null, reprise: compterBarres(page, marquesGauche(5)) || 1, phrases: false, gabarit: barres === 9 ? "R" : "R6" };
    if (barres === 10 || barres === 11) return { num: barres - 9, phrases: false, gabarit: 6 };
    if (barres === 7 || barres === 8) return { num: barres - 6, phrases: false, gabarit: 5 };
    // trait vertical entre la 1re et la 2e colonne de cases, sur toute la hauteur de la grille
    const gx = (PW - COLS * CASE) / 2 + CASE, gy = MARGE + HAUT_ENTETE;
    const trait = noirceur(page, gx - 0.5, gy + 4, 1, ROWS * CASE - 8) - noirceur(page, gx + 3, gy + 4, 1, ROWS * CASE - 8);
    const phrases = trait < 25;
    if (barres === 5 || barres === 6) return { num: barres - 4, phrases: false, gabarit: 4 };
    if (barres >= 1 && barres <= 4) return { num: barres, phrases: barres === 3 };
    if (phrases) return { num: 3, phrases: true };
    // ancienne grille : la dernière case (n° 62) a-t-elle une bordure en bas ?
    const { x0: cx, y0: cy } = rectCase(PAR_PAGE - 1, GABARITS[3]);
    const bord = noirceur(page, cx + 4, cy + CASE - 0.6, CASE - 8, 1.2) - noirceur(page, cx + 4, cy + CASE - 4, CASE - 8, 1.2);
    return { num: bord < 20 ? 2 : null, phrases: false };
  }

  /** Taille de la case virtuelle de dessin = une case du papier, à la même résolution. */
  const CASE_PX = Math.round(CASE * PX);

  // ---------- Harmonisation des lettres dessinées ----------
  // Au doigt, on écrit rarement deux lettres à la même taille. Pour chaque caractère on connaît
  // la zone qu'il DOIT occuper entre les lignes guides (fractions de la case, mesurées depuis le bas) :
  //   « a » : de la ligne de base à la ligne des minuscules ; « b » : jusqu'à la ligne des majuscules ;
  //   « g » : de sous la ligne de base jusqu'aux minuscules, etc.
  // On agrandit ou réduit le dessin (sans le déformer) pour qu'il remplisse cette zone.
  const JAMBE = LB - 0.17, ACCENT = 0.13;
  function zoneCible(ch) {
    if ("acemnorsuvwxzœæ".includes(ch)) return [LB, LX];
    if ("bdhkl".includes(ch)) return [LB, LM];
    if (ch === "t") return [LB, LX + 0.6 * (LM - LX)];
    if (ch === "i") return [LB, LX + ACCENT];
    if ("gpqy".includes(ch)) return [JAMBE, LX];
    if (ch === "j") return [JAMBE, LX + ACCENT];
    if ("éèêëàâäùûüôöîï".includes(ch)) return [LB, LX + ACCENT];
    if (ch === "ç") return [LB - 0.07, LX];
    if (/[A-PR-Z0-9]/.test(ch) || "ŒÆ".includes(ch)) return [LB, LM];
    if ("ÉÈÊÀÂÙÛÔÎÏËÜÄÖ".includes(ch)) return [LB, LM + ACCENT];
    if (ch === "Ç") return [LB - 0.07, LM];
    return null;   // f, Q et les signes : trop variables d'une écriture à l'autre, on n'y touche pas
  }

  /** force 0..1 : 0 = dessin tel quel, 1 = taille et position exactes de la zone cible. */
  function harmoniser(traits, ch, force) {
    const cible = force > 0 && zoneCible(ch); if (!cible) return traits;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const t of traits) for (const q of t.points) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
    const bas = 1 - y1, haut = 1 - y0;                       // y de l'écran → hauteur depuis le bas
    if (haut - bas < 0.02) return traits;                     // un point seul : rien à mesurer
    const s = Math.min(2.5, Math.max(0.4, (cible[1] - cible[0]) / (haut - bas)));   // échelle, bornée
    const cx = (x0 + x1) / 2;
    const deplacer = q => {
      const ny = 1 - (cible[0] + (1 - q.y - bas) * s);       // le bas de l'encre va sur le bas de la zone
      const nx = cx + (q.x - cx) * s;
      return { ...q, x: q.x + force * (nx - q.x), y: q.y + force * (ny - q.y) };   // mélange avec l'original
    };
    return traits.map(t => ({ ...t, points: t.points.map(deplacer) }));
  }

  /** Traits dessinés (coordonnées 0..1 dans la case, avec pression) → masque d'encre.
      On trace dans un canvas caché puis on garde les pixels assez opaques. */
  function masqueDessin(traits, p, ch) {
    if (!traits || !traits.length) return null;
    traits = harmoniser(traits, ch, (p.normaliser ?? 0) / 100);
    const n = CASE_PX, cv = document.createElement("canvas"); cv.width = cv.height = n;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    dessinerTraits(cx, traits, n, p.stylo, "#000");
    const d = cx.getImageData(0, 0, n, n).data, m = new Uint8Array(n * n);
    for (let i = 0; i < m.length; i++) m[i] = d[4 * i + 3] > 110 ? 1 : 0;
    return m.some(v => v) ? { m, w: n, h: n, base: n * (1 - LB) } : null;
  }

  /** Dessine des traits lissés : courbes quadratiques passant par le milieu des points
      (rendu fluide même quand le doigt va vite). Largeur variable avec la pression du stylet. */
  function dessinerTraits(cx, traits, taille, epaisseur, couleur) {
    const k = taille / CASE_PX;                     // épaisseur exprimée en pixels de la case réelle
    cx.lineCap = "round"; cx.lineJoin = "round"; cx.strokeStyle = couleur; cx.fillStyle = couleur;
    for (const t of traits) {
      const pts = t.points, lw = q => epaisseur * k * (t.stylet ? 0.55 + 0.9 * (q.p ?? 0.5) : 1);
      if (pts.length === 1) { cx.beginPath(); cx.arc(pts[0].x * taille, pts[0].y * taille, lw(pts[0]) / 2, 0, 7); cx.fill(); continue; }
      // Le tracé passe par le MILIEU de chaque paire de points, en se servant du point
      // lui-même comme point de contrôle : la courbe est lisse, sans angles.
      // On trace segment par segment pour que l'épaisseur suive la pression.
      const mil = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }), n = pts.length;
      const segment = (debut, ctrl, fin, largeur) => {
        cx.beginPath(); cx.lineWidth = largeur; cx.moveTo(debut.x * taille, debut.y * taille);
        if (ctrl) cx.quadraticCurveTo(ctrl.x * taille, ctrl.y * taille, fin.x * taille, fin.y * taille);
        else cx.lineTo(fin.x * taille, fin.y * taille);
        cx.stroke();
      };
      segment(pts[0], null, mil(pts[0], pts[1]), lw(pts[0]));                      // début : droit
      for (let i = 1; i < n - 1; i++) segment(mil(pts[i - 1], pts[i]), pts[i], mil(pts[i], pts[i + 1]), lw(pts[i]));
      segment(mil(pts[n - 2], pts[n - 1]), null, pts[n - 1], lw(pts[n - 1]));     // fin : droit
    }
  }

  // =================== 3. Contours → glyphes ===================

  /** Bord de l'encre : chaque bord de pixel encré devient une arête orientée, enchaînées
      en boucles fermées. Contours extérieurs et trous sortent dans des sens opposés. */
  function tracer(m, w, h) {
    const W1 = w + 1, ex = [], ey = [], dx = [], dy = [];
    const en = (x, y) => x >= 0 && y >= 0 && x < w && y < h && m[y * w + x];
    const aj = (x, y, a, b) => { ex.push(x); ey.push(y); dx.push(a); dy.push(b); };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      if (!en(x, y - 1)) aj(x, y, 1, 0);
      if (!en(x + 1, y)) aj(x + 1, y, 0, 1);
      if (!en(x, y + 1)) aj(x + 1, y + 1, -1, 0);
      if (!en(x - 1, y)) aj(x, y + 1, 0, -1);
    }
    const n = ex.length, tete = new Int32Array(W1 * (h + 1)).fill(-1), suiv = new Int32Array(n), pris = new Uint8Array(n);
    for (let i = 0; i < n; i++) { const k = ey[i] * W1 + ex[i]; suiv[i] = tete[k]; tete[k] = i; }
    const boucles = [];
    for (let s = 0; s < n; s++) {
      if (pris[s]) continue;
      const b = []; let e = s;
      for (;;) {
        pris[e] = 1; b.push([ex[e], ey[e]]);
        const k = (ey[e] + dy[e]) * W1 + ex[e] + dx[e];
        let best = -1, score = -1;
        for (let j = tete[k]; j !== -1; j = suiv[j]) {              // croisement : on tourne à droite
          if (pris[j]) continue;
          const cr = dx[e] * dy[j] - dy[e] * dx[j], sc = cr > 0 ? 2 : cr === 0 ? 1 : 0;
          if (sc > score) { score = sc; best = j; }
        }
        if (best < 0) break;
        e = best;
      }
      boucles.push(b);
    }
    return boucles;
  }

  /** Lissage gaussien le long d'une boucle fermée (efface l'effet « escalier »). */
  function lisser(pts, sigma) {
    const n = pts.length; if (n < 8 || sigma <= 0) return pts;
    const r = Math.ceil(3 * sigma), k = []; let tot = 0;
    for (let t = -r; t <= r; t++) { const v = Math.exp(-t * t / (2 * sigma * sigma)); k.push(v); tot += v; }
    return pts.map((_, i) => {
      let x = 0, y = 0;
      for (let t = -r; t <= r; t++) { const q = pts[((i + t) % n + n) % n], v = k[t + r] / tot; x += q[0] * v; y += q[1] * v; }
      return [x, y];
    });
  }

  /** Masque → contours TrueType (unités de police) + largeur d'avance. */
  function glyphe({ m, w, h, base }, p) {
    let gx = w, dxm = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) { if (x < gx) gx = x; if (x > dxm) dxm = x; }
    if (dxm < 0) return null;
    const contours = [];
    for (const boucle of tracer(m, w, h)) {
      if (boucle.length < 6) continue;
      const lisse = lisser(boucle, p.lissage);
      const pts = lisse.length >= 24 ? lisse.filter((_, i) => i % p.pas === 0) : lisse;
      if (pts.length < 3) continue;
      let c = pts.map(([x, y]) => [Math.round((x - gx) * E + p.approche), Math.round((base - y) * E)]);
      c = c.filter((q, i) => i === 0 || q[0] !== c[i - 1][0] || q[1] !== c[i - 1][1]);
      if (c.length >= 3) contours.push(c.reverse());   // y retourné → on inverse pour le sens TrueType
    }
    return contours.length ? { contours, avance: Math.round((dxm + 1 - gx) * E + 2 * p.approche) } : null;
  }

  /** Étire un masque horizontalement (tirets – et —). */
  function etirer(s, f) {
    const w2 = Math.round(s.w * f), o = new Uint8Array(w2 * s.h);
    for (let y = 0; y < s.h; y++) for (let x = 0; x < w2; x++) o[y * w2 + x] = s.m[y * s.w + Math.floor(x / f)];
    return { m: o, w: w2, h: s.h, base: s.base };
  }

  /** Points de suspension : le point rogné, répété trois fois. */
  function troisPoints(s) {
    let gx = s.w, dx = -1;
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (s.m[y * s.w + x]) { gx = Math.min(gx, x); dx = Math.max(dx, x); }
    if (dx < 0) return null;
    const pw = dx - gx + 1, w2 = pw * 5, o = new Uint8Array(w2 * s.h);
    for (let y = 0; y < s.h; y++) for (let x = 0; x < pw; x++) {
      const v = s.m[y * s.w + gx + x]; o[y * w2 + x] = o[y * w2 + 2 * pw + x] = o[y * w2 + 4 * pw + x] = v;
    }
    return { m: o, w: w2, h: s.h, base: s.base };
  }

  // =================== 4. Crénage ===================

  const TR = 20, BAS = -400, NB = 75, VOIS = 2;
  function profils(g) {
    const ga = new Float64Array(NB).fill(NaN), dr = new Float64Array(NB).fill(NaN);
    for (const c of g.contours) for (let i = 0; i < c.length; i++) {
      const a = c[i], b = c[(i + 1) % c.length];
      for (let t = 0; t < 1; t += 0.25) {
        const x = a[0] + (b[0] - a[0]) * t, k = Math.floor((a[1] + (b[1] - a[1]) * t - BAS) / TR);
        if (k < 0 || k >= NB) continue;
        if (!(ga[k] <= x)) ga[k] = x; if (!(dr[k] >= x)) dr[k] = x;
      }
    }
    const elargir = (p, f) => p.map((v, k) => {
      let r = v; for (let d = -VOIS; d <= VOIS; d++) { const q = p[k + d]; if (q === undefined || isNaN(q)) continue; r = isNaN(r) ? q : f(r, q); } return r;
    });
    return { gauche: elargir(ga, Math.min), libreDroite: elargir(dr, Math.max).map(x => g.avance - x) };
  }

  /** Pour chaque paire, l'écart réel au point le plus proche ; si trop grand, on rapproche. */
  function crenage(parCar, p) {
    const uniques = [...new Set(KERN_CARS.map(ch => parCar.get(ch)).filter(Boolean))];
    const prof = new Map(uniques.map(g => [g, profils(g)])), paires = [];
    const apostrophe = parCar.get("'");          // même dessin pour ' et ’
    for (const a of uniques) for (const b of uniques) {
      // Après une apostrophe (l'été, m'appelle) : JAMAIS de rapprochement. Comme elle est en
      // hauteur, la lettre suivante glissait dessous et l'apostrophe touchait l'accent du « é ».
      if (a === apostrophe) continue;
      const pa = prof.get(a), pb = prof.get(b); let mini = Infinity;
      for (let k = 0; k < NB; k++) { const e = pa.libreDroite[k] + pb.gauche[k]; if (!isNaN(e) && e < mini) mini = e; }
      if (mini === Infinity) continue;
      const lim = (a.ponctu || b.ponctu) ? p.maxi / 2 : p.maxi;
      const v = Math.max(-Math.round(p.force * (mini - p.cible)), -lim);
      if (v <= -10) paires.push([a.id, b.id, v]);
    }
    paires.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    return paires.slice(0, 10900);
  }

  // =================== 5. Fichier TrueType ===================

  class Octets {
    constructor() { this.o = []; }
    u8(v) { this.o.push(v & 255); }
    u16(v) { this.o.push((v >> 8) & 255, v & 255); }
    i16(v) { this.u16(v < 0 ? v + 65536 : v); }
    u32(v) { this.o.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); }
    tag(s) { for (const c of s) this.o.push(c.charCodeAt(0)); }
    fin() { return Uint8Array.from(this.o); }
  }
  const log2 = n => Math.floor(Math.log2(n));

  function ecrireTTF(glyphes, cmap, kern, famille) {
    const n = glyphes.length, glyf = new Octets(), loca = [];
    let bb = [Infinity, Infinity, -Infinity, -Infinity], maxPts = 0, maxCont = 0;
    for (const g of glyphes) {                    // glyf : tous les points « hors courbe » → courbes lisses
      loca.push(glyf.o.length);
      if (!g.contours || !g.contours.length) { g.bbox = null; continue; }
      const pts = g.contours.flat();
      g.bbox = [Infinity, Infinity, -Infinity, -Infinity];
      for (const [x, y] of pts) { g.bbox[0] = Math.min(g.bbox[0], x); g.bbox[1] = Math.min(g.bbox[1], y); g.bbox[2] = Math.max(g.bbox[2], x); g.bbox[3] = Math.max(g.bbox[3], y); }
      bb = [Math.min(bb[0], g.bbox[0]), Math.min(bb[1], g.bbox[1]), Math.max(bb[2], g.bbox[2]), Math.max(bb[3], g.bbox[3])];
      maxPts = Math.max(maxPts, pts.length); maxCont = Math.max(maxCont, g.contours.length);
      glyf.i16(g.contours.length); g.bbox.forEach(v => glyf.i16(v));
      let fin = -1; for (const c of g.contours) { fin += c.length; glyf.u16(fin); }
      glyf.u16(0);
      const fl = [], bx = [], by = []; let px = 0, py = 0;
      for (const q of pts) {                      // deltas sur 1 octet quand c'est possible
        const [x, y] = q;
        const ddx = x - px, ddy = y - py; let f = 0;
        if (ddx === 0) f |= 0x10; else if (Math.abs(ddx) < 256) { f |= 0x02 | (ddx > 0 ? 0x10 : 0); bx.push([1, Math.abs(ddx)]); } else bx.push([2, ddx]);
        if (ddy === 0) f |= 0x20; else if (Math.abs(ddy) < 256) { f |= 0x04 | (ddy > 0 ? 0x20 : 0); by.push([1, Math.abs(ddy)]); } else by.push([2, ddy]);
        if (q[2]) f |= 0x01;                       // 3e valeur à 1 = point SUR la courbe (angles du rectangle .notdef)
        fl.push(f); px = x; py = y;
      }
      fl.forEach(f => glyf.u8(f));
      for (const [t, v] of [...bx, ...by]) t === 1 ? glyf.u8(v) : glyf.i16(v);
      while (glyf.o.length % 4) glyf.u8(0);
    }
    loca.push(glyf.o.length);
    const tLoca = new Octets(); loca.forEach(v => tLoca.u32(v));
    const hmtx = new Octets(); let advMax = 0, minLsb = Infinity, minRsb = Infinity, xMaxExt = 0, somme = 0, nbAv = 0;
    for (const g of glyphes) {
      const lsb = g.bbox ? g.bbox[0] : 0; hmtx.u16(g.avance); hmtx.i16(lsb); advMax = Math.max(advMax, g.avance);
      if (g.bbox) { minLsb = Math.min(minLsb, lsb); minRsb = Math.min(minRsb, g.avance - g.bbox[2]); xMaxExt = Math.max(xMaxExt, g.bbox[2]); }
      if (g.avance) { somme += g.avance; nbAv++; }
    }
    if (bb[0] === Infinity) bb = [0, 0, 0, 0];
    if (minLsb === Infinity) { minLsb = 0; minRsb = 0; }
    const head = new Octets(), date = Math.floor(Date.now() / 1000) + 2082844800;
    head.u32(0x00010000); head.u32(0x00010000); head.u32(0); head.u32(0x5F0F3CF5);
    head.u16(3); head.u16(1000); head.u32(0); head.u32(date); head.u32(0); head.u32(date);
    bb.forEach(v => head.i16(v)); head.u16(0); head.u16(8); head.i16(2); head.i16(1); head.i16(0);
    const hhea = new Octets();
    hhea.u32(0x00010000); hhea.i16(900); hhea.i16(-300); hhea.i16(0); hhea.u16(advMax);
    hhea.i16(minLsb); hhea.i16(minRsb); hhea.i16(xMaxExt); hhea.i16(1); hhea.i16(0); hhea.i16(0);
    for (let i = 0; i < 5; i++) hhea.i16(0); hhea.u16(n);
    const maxp = new Octets(); maxp.u32(0x00010000); maxp.u16(n); maxp.u16(maxPts); maxp.u16(maxCont);
    maxp.u16(0); maxp.u16(0); maxp.u16(2); for (let i = 0; i < 8; i++) maxp.u16(0);   // 32 octets
    // cmap format 4
    const codes = [...cmap.keys()].sort((a, b) => a - b), seg = [];
    for (const c of codes) {
      const d = (cmap.get(c) - c) & 0xFFFF, s = seg[seg.length - 1];
      if (s && s.fin === c - 1 && s.delta === d) s.fin = c; else seg.push({ debut: c, fin: c, delta: d });
    }
    seg.push({ debut: 0xFFFF, fin: 0xFFFF, delta: 1 });
    const sc = seg.length, st = new Octets(), sr = 2 * 2 ** log2(sc);
    st.u16(4); st.u16(16 + 8 * sc); st.u16(0); st.u16(2 * sc); st.u16(sr); st.u16(log2(sc)); st.u16(2 * sc - sr);
    seg.forEach(s => st.u16(s.fin)); st.u16(0); seg.forEach(s => st.u16(s.debut)); seg.forEach(s => st.u16(s.delta)); seg.forEach(() => st.u16(0));
    const cm = new Octets(); cm.u16(0); cm.u16(2); cm.u16(0); cm.u16(3); cm.u32(20); cm.u16(3); cm.u16(1); cm.u32(20);
    st.o.forEach(v => cm.u8(v));
    // name : Windows exige 1 à 6
    const ps = (famille.normalize("NFD").replace(/[^A-Za-z0-9]/g, "") || "MaPolice") + "-Regular";
    const ch = [[1, famille], [2, "Regular"], [3, famille + "-Regular-1.000"], [4, famille + " Regular"], [5, "Version 1.000"], [6, ps]];
    const nm = new Octets(), dn = new Octets(); nm.u16(0); nm.u16(ch.length); nm.u16(6 + 12 * ch.length);
    for (const [id, s] of ch) {
      const d0 = dn.o.length; for (const c of s) dn.u16(c.charCodeAt(0));
      nm.u16(3); nm.u16(1); nm.u16(0x409); nm.u16(id); nm.u16(dn.o.length - d0); nm.u16(d0);
    }
    dn.o.forEach(v => nm.u8(v));
    // OS/2 v4 : blocs Unicode et page de codes 1252 (sinon Word remplace la police)
    let ur1 = 0, ur2 = 0;
    for (const c of codes) {
      if (c < 0x80) ur1 |= 1; else if (c < 0x100) ur1 |= 2; else if (c < 0x180) ur1 |= 4;
      else if (c >= 0x2000 && c < 0x2070) ur1 |= 1 << 31; else if (c >= 0x20A0 && c < 0x20D0) ur2 |= 2; else if (c >= 0x2200 && c < 0x2300) ur2 |= 1 << 6;
    }
    const os2 = new Octets();
    os2.u16(4); os2.i16(Math.round(somme / Math.max(1, nbAv))); os2.u16(400); os2.u16(5); os2.u16(0);
    [650, 600, 0, 75, 650, 600, 0, 350, 50, 300].forEach(v => os2.i16(v)); os2.i16(0);
    for (let i = 0; i < 10; i++) os2.u8(0);
    os2.u32(ur1 >>> 0); os2.u32(ur2); os2.u32(0); os2.u32(0); os2.tag("PARA");
    os2.u16(0x40); os2.u16(codes[0]); os2.u16(codes[codes.length - 1]);
    os2.i16(900); os2.i16(-300); os2.i16(100); os2.u16(Math.max(1000, bb[3])); os2.u16(Math.max(350, -bb[1]));
    os2.u32(1); os2.u32(0); os2.i16(350); os2.i16(700); os2.u16(0); os2.u16(32); os2.u16(2);
    const post = new Octets(); post.u32(0x00030000); post.u32(0); post.i16(-100); post.i16(50); for (let i = 0; i < 5; i++) post.u32(0);
    const tables = { "OS/2": os2, cmap: cm, glyf, head, hhea, hmtx, loca: tLoca, maxp, name: nm, post };
    if (kern.length) {
      const k = new Octets(), np = kern.length, srk = 6 * 2 ** log2(np);
      k.u16(0); k.u16(1); k.u16(0); k.u16(14 + 6 * np); k.u16(1); k.u16(np); k.u16(srk); k.u16(log2(np)); k.u16(6 * np - srk);
      kern.forEach(([a, b, v]) => { k.u16(a); k.u16(b); k.i16(v); });
      tables.kern = k;
    }
    // assemblage : répertoire trié, sommes de contrôle, alignement 4 octets
    const tags = Object.keys(tables).sort(), nt = tags.length, corps = tags.map(t => tables[t].fin());
    let pos = 12 + 16 * nt; const offs = corps.map(c => { const o = pos; pos += (c.length + 3) & ~3; return o; });
    const fic = new Uint8Array(pos), dv = new DataView(fic.buffer);
    const s32 = (o, l) => { let s = 0; for (let i = 0; i < ((l + 3) & ~3); i += 4) s = (s + dv.getUint32(o + i)) >>> 0; return s; };
    dv.setUint32(0, 0x00010000); dv.setUint16(4, nt);
    const srt = 16 * 2 ** log2(nt); dv.setUint16(6, srt); dv.setUint16(8, log2(nt)); dv.setUint16(10, 16 * nt - srt);
    tags.forEach((t, i) => {
      fic.set(corps[i], offs[i]); const r = 12 + 16 * i;
      for (let j = 0; j < 4; j++) fic[r + j] = t.charCodeAt(j);
      dv.setUint32(r + 4, s32(offs[i], corps[i].length)); dv.setUint32(r + 8, offs[i]); dv.setUint32(r + 12, corps[i].length);
    });
    dv.setUint32(offs[tags.indexOf("head")] + 8, (0xB1B0AFBA - s32(0, fic.length)) >>> 0);
    return fic;
  }

  // =================== Lettres retouchées à la main ===================
  // Une retouche est un contour vectoriel : des points d'ancrage {x, y} avec deux poignées
  // {ix, iy} (côté entrant) et {ox, oy} (côté sortant), reliés par des courbes de Bézier cubiques.
  // Coordonnées en unités de police : y depuis la ligne de base, x depuis le bord gauche de l'encre.

  /** Point d'une courbe de Bézier cubique entre deux ancres a et b, pour t entre 0 et 1. */
  function bezier(a, b, t) {
    const u = 1 - t, A = u * u * u, B = 3 * u * u * t, C = 3 * u * t * t, D = t * t * t;
    return [A * a.x + B * a.ox + C * b.ix + D * b.x, A * a.y + B * a.oy + C * b.iy + D * b.y];
  }

  /** Retouche → glyphe TrueType : chaque courbe est découpée en petits segments droits (points
      « sur la courbe »), assez serrés pour paraître parfaitement lisses. */
  function glypheRetouche(r, p) {
    const cs = r.contours.filter(c => c.length >= 2).map(c => {
      const pts = [];
      for (let i = 0; i < c.length; i++) for (let k = 0; k < 12; k++) pts.push(bezier(c[i], c[(i + 1) % c.length], k / 12));
      return pts;
    });
    let minX = Infinity, maxX = -Infinity;
    for (const c of cs) for (const [x] of c) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    if (minX === Infinity) return null;
    const dx = p.approche - minX;                 // la marge « espace entre les lettres » reste réglable
    const contours = cs.map(c => {
      const q = c.map(([x, y]) => [Math.round(x + dx), Math.round(y), 1]);
      return q.filter((v, i) => i === 0 || v[0] !== q[i - 1][0] || v[1] !== q[i - 1][1]);
    }).filter(c => c.length >= 3);
    return contours.length ? { contours, avance: Math.round(maxX - minX + 2 * p.approche) } : null;
  }

  // =================== Construction de la police ===================

  /** source(ch) renvoie le masque d'un caractère (dessin prioritaire sur le scan) ou null.
      retouches : { caractère: retouche vectorielle } qui remplacent le tracé automatique. */
  function construire(source, p, famille, retouches = {}) {
    // .notdef (caractère inconnu) : un rectangle creux, comme dans toutes les polices.
    // Il garantit aussi que la table des contours n'est jamais vide (sinon police refusée).
    const notdef = { contours: [[[50, 0, 1], [50, 700, 1], [450, 700, 1], [450, 0, 1]],
                                [[100, 50, 1], [400, 50, 1], [400, 650, 1], [100, 650, 1]]], avance: 500 };
    const liste = [notdef, { contours: null, avance: p.espace }];
    const cmap = new Map([[32, 1]]), parCar = new Map(), manquants = [], masques = new Map();
    const ajouter = (g, codes, ponctu = false) => {
      g.id = liste.length; g.ponctu = ponctu; liste.push(g);
      for (const c of codes) { cmap.set(c.codePointAt(0), g.id); parCar.set(c, g); }
    };
    for (const ch of CARS) {
      const s = source(ch), r = s && retouches[ch], g = r ? glypheRetouche(r, p) : s && glyphe(s, p);
      if (!g) { manquants.push(ch); continue; }
      masques.set(ch, s);
      if (ch === "'") g.avance += ESPACE_APRES_APOSTROPHE;   // un peu d'air après l'apostrophe
      const alias = { "'": ["’", "‘", "′"], '"': ["“", "”", "„"], "-": ["‐", "‑", "−"] }[ch] || [];
      ajouter(g, [ch, ...alias], PONCTU.has(ch));
    }
    ajouter({ contours: null, avance: p.espace }, [" "]);
    ajouter({ contours: null, avance: Math.round(p.espace / 2) }, [" ", " "]);
    if (masques.has("-")) for (const [code, f] of [["–", 1.8], ["—", 3.4]]) {
      const g = glyphe(etirer(masques.get("-"), f), p); if (g) ajouter(g, [code], true);
    }
    if (masques.has(".")) { const t = troisPoints(masques.get(".")), g = t && glyphe(t, p); if (g) ajouter(g, ["…"], true); }
    // ---------- Caractères de secours ----------
    // Une majuscule pas encore faite prend le dessin de sa minuscule ; une lettre accentuée prend
    // celui de la lettre sans accent ; œ æ Œ Æ sont assemblés à partir des deux lettres.
    // Ces caractères pointent vers le MÊME dessin (même numéro de glyphe dans la table cmap).
    const remplaces = [];
    if (p.secours !== false) {
      const sansAccent = x => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const LIGATURES = { "œ": "oe", "æ": "ae", "Œ": "OE", "Æ": "AE" };
      for (const ch of CARS) {                 // ordre de CARS : A–Z passent avant les majuscules accentuées
        if (parCar.has(ch)) continue;
        if (LIGATURES[ch]) {
          const [a, b] = [...LIGATURES[ch]].map(x => parCar.get(x) || parCar.get(x.toLowerCase()));
          if (!a || !b) continue;
          const dx = a.avance - 2 * p.approche;            // la 2e lettre colle à la 1re
          ajouter({ contours: [...a.contours, ...b.contours.map(c => c.map(q => [q[0] + dx, q[1]]))], avance: dx + b.avance }, [ch]);
          remplaces.push(ch); continue;
        }
        const candidats = [ch.toLowerCase(), sansAccent(ch), sansAccent(ch.toLowerCase())].filter(x => x !== ch && x.length === 1);
        const g = candidats.map(x => parCar.get(x)).find(Boolean);
        if (g) { cmap.set(ch.codePointAt(0), g.id); parCar.set(ch, g); remplaces.push(ch); }
      }
    }
    const kern = p.crenage ? crenage(parCar, p) : [];
    // dessins de chaque caractère (unités de police), pour l'éditeur de retouche et son aperçu
    const glyphes = {};
    for (const [ch, g] of parCar) glyphes[ch] = { contours: g.contours, avance: g.avance, retouche: !!(retouches[ch] && !remplaces.includes(ch)) };
    return { ttf: ecrireTTF(liste, cmap, kern, famille || "MaPolice"), manquants, remplaces, glyphes, nbGlyphes: liste.length - 2, nbPaires: kern.length };
  }

  /** Page 3 : écarts naturels entre lettres et entre mots (projection de l'encre sur l'axe x). */
  function mesurerEspacement(page, p) {
    const vides = [], x0 = (PW - COLS * CASE) / 2;
    for (let i = 0; i < PHRASES.length; i++) {
      const X = Math.floor(x0 * PX), Y = Math.floor((MARGE + HAUT_ENTETE + i * CASE) * PX);
      const w = Math.floor(COLS * CASE * PX), h = Math.floor(CASE * PX), col = new Uint8Array(w), haut = Math.round(5 * MM * PX);
      for (let y = haut; y < h; y++) for (let x = 0; x < w; x++) if (page.gris[(Y + y) * page.w + X + x] < p.seuil) col[x] = 1;
      const a = col.indexOf(1), b = col.lastIndexOf(1); if (a < 0) continue;
      let run = 0; for (let x = a; x <= b; x++) { if (!col[x]) run++; else { if (run >= 2) vides.push(run); run = 0; } }
    }
    if (vides.length < 6) return null;
    vides.sort((a, b) => a - b);
    let c1 = vides[0], c2 = vides[vides.length - 1], g1 = [], g2 = [];
    for (let it = 0; it < 20; it++) {
      g1 = vides.filter(v => Math.abs(v - c1) <= Math.abs(v - c2)); g2 = vides.filter(v => Math.abs(v - c1) > Math.abs(v - c2));
      if (!g1.length || !g2.length) break; c1 = g1[g1.length >> 1]; c2 = g2[g2.length >> 1];
    }
    if (!g2.length) return null;
    const approche = Math.max(0, Math.min(80, Math.round(c1 * E / 2)));
    return { approche, espace: Math.max(100, Math.min(600, Math.round((c2 * E - 2 * approche) / 10) * 10)) };
  }

  return { MM, PW, PH, MARGE, HAUT_ENTETE, COLS, ROWS, REP, CASE, LB, LX, LM, PX, PAR_PAGE, CARS, PHRASES, DEFAUT, CASE_PX,
    enGris, redresser, viser, masqueScan, masqueDessin, dessinerTraits, construire, mesurerEspacement, rectCase, glyphe, bezier,
    marques, marquesGauche, identifierPage, analyserCase, geo, casesPage, GABARITS, RETRAIT, NB_BONUS, SECTIONS5, disposition };
})();
