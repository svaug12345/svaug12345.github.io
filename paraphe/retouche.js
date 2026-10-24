/* =============================================================================
   Paraphe — retouche vectorielle d'une lettre (comme dans Illustrator ou Inkscape).
   -----------------------------------------------------------------------------
   1. Le contour automatique d'une lettre contient des centaines de petits points :
      impossible à retoucher à la main. On le SIMPLIFIE en quelques « points
      d'ancrage », chacun avec deux « poignées » qui règlent la courbure
      (courbes de Bézier cubiques, comme tous les logiciels de dessin vectoriel).
   2. L'utilisateur déplace les points et les poignées au doigt.
   3. Un bandeau montre la lettre en direct entre deux lettres de son choix.
   La retouche est enregistrée dans police.retouches[caractère] et remplace le
   tracé automatique (voir glypheRetouche() dans moteur.js).
   ========================================================================== */
"use strict";

const Retouche = (() => {
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const norm = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };

  // ---------------------------------------------------------------------------
  // Simplification : contour TrueType → ancres + poignées
  // ---------------------------------------------------------------------------

  /** Nos contours sont faits de points « hors courbe » : la vraie courbe passe par
      le MILIEU de chaque paire de points voisins. On récupère ces milieux. */
  function surLaCourbe(contour) {
    const n = contour.length;
    return contour.map((p, i) => { const q = contour[(i + 1) % n]; return p[2] ? [p[0], p[1]] : [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; });
  }

  /** Douglas-Peucker : garde un point seulement si la courbe s'éloigne de plus de
      « tol » de la ligne droite entre les points déjà gardés. */
  function douglasPeucker(pts, a, b, tol, garde) {
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    let max = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L;
      if (d > max) { max = d; idx = i; }
    }
    if (max > tol) { douglasPeucker(pts, a, idx, tol, garde); garde.push(idx); douglasPeucker(pts, idx, b, tol, garde); }
  }

  /** Une boucle fermée → liste d'ancres {x, y, ix, iy, ox, oy, angle}. */
  function boucleVersAncres(poly, tol) {
    const n = poly.length;
    // On coupe la boucle en deux au point le plus éloigné du point 0, et on simplifie chaque moitié.
    let loin = 0; for (let i = 1; i < n; i++) if (dist(poly[0], poly[i]) > dist(poly[0], poly[loin])) loin = i;
    const double = poly.concat(poly), garde = [0];
    douglasPeucker(double, 0, loin, tol, garde); garde.push(loin); douglasPeucker(double, loin, n, tol, garde);
    let idx = [...new Set(garde.filter(k => k < n))].sort((a, b) => a - b);
    if (idx.length < 4) idx = [0, 1, 2, 3].map(k => Math.floor(k * n / 4));   // petit point : au moins 4 ancres
    // Direction locale de la courbe autour d'un point (on regarde 3 points avant et après)
    const autour = (k, d) => poly[((k + d) % n + n) % n];
    return idx.map((k, j) => {
      const p = poly[k], prec = poly[idx[(j - 1 + idx.length) % idx.length]], suiv = poly[idx[(j + 1) % idx.length]];
      const avant = autour(k, -3), apres = autour(k, 3);
      const din = norm(p[0] - avant[0], p[1] - avant[1]), dout = norm(apres[0] - p[0], apres[1] - p[1]);
      // angle entre la direction d'arrivée et celle de départ : grand = coin
      const coin = Math.acos(Math.max(-1, Math.min(1, din[0] * dout[0] + din[1] * dout[1]))) > 1.0;
      const t = coin ? null : norm(din[0] + dout[0], din[1] + dout[1]);      // tangente lisse = moyenne
      const lin = dist(p, prec) / 3, lout = dist(p, suiv) / 3;               // poignées = 1/3 de la corde
      const ti = t || din, to = t || dout;
      return { x: p[0], y: p[1], ix: p[0] - ti[0] * lin, iy: p[1] - ti[1] * lin, ox: p[0] + to[0] * lout, oy: p[1] + to[1] * lout, angle: coin };
    });
  }

  /** Glyphe automatique (contours en unités de police, avec la marge « approche » à gauche)
      → retouche éditable, x ramené au bord gauche de l'encre. */
  function depuisGlyphe(g, approche, tol = 15) {
    const contours = g.contours.filter(c => c.length >= 3).map(c => {
      const a = boucleVersAncres(surLaCourbe(c), tol);
      for (const n of a) { n.x -= approche; n.ix -= approche; n.ox -= approche; }
      return a;
    });
    return { contours: arrondir(contours) };
  }
  const arrondir = cs => cs.map(c => c.map(n => ({ x: Math.round(n.x), y: Math.round(n.y), ix: Math.round(n.ix), iy: Math.round(n.iy),
    ox: Math.round(n.ox), oy: Math.round(n.oy), angle: !!n.angle })));

  // ---------------------------------------------------------------------------
  // Dessin sur canvas (coordonnées police → écran : X = ox + x·s, Y = oy − y·s)
  // ---------------------------------------------------------------------------

  /** Contour retouché (Bézier) → Path2D. */
  function cheminBezier(contours, ox, oy, s) {
    const P = new Path2D(), X = x => ox + x * s, Y = y => oy - y * s;
    for (const c of contours) {
      if (c.length < 2) continue;
      P.moveTo(X(c[0].x), Y(c[0].y));
      for (let i = 0; i < c.length; i++) { const a = c[i], b = c[(i + 1) % c.length]; P.bezierCurveTo(X(a.ox), Y(a.oy), X(b.ix), Y(b.iy), X(b.x), Y(b.y)); }
      P.closePath();
    }
    return P;
  }

  /** Glyphe TrueType (points hors courbe, ou sur la courbe si 3e valeur = 1) → Path2D. */
  function cheminTrueType(contours, ox, oy, s) {
    const P = new Path2D(), X = x => ox + x * s, Y = y => oy - y * s;
    for (const c of contours || []) {
      if (c.length < 2) continue;
      if (c[0][2]) { P.moveTo(X(c[0][0]), Y(c[0][1])); for (const q of c) P.lineTo(X(q[0]), Y(q[1])); P.closePath(); continue; }
      const mil = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], n = c.length;
      const d = mil(c[n - 1], c[0]); P.moveTo(X(d[0]), Y(d[1]));
      for (let i = 0; i < n; i++) { const m = mil(c[i], c[(i + 1) % n]); P.quadraticCurveTo(X(c[i][0]), Y(c[i][1]), X(m[0]), Y(m[1])); }
      P.closePath();
    }
    return P;
  }

  /** Coupe la courbe a→b au paramètre t (algorithme de De Casteljau) et renvoie le nouveau point. */
  function couper(a, b, t) {
    const L = (p, q) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    const P0 = [a.x, a.y], P1 = [a.ox, a.oy], P2 = [b.ix, b.iy], P3 = [b.x, b.y];
    const P01 = L(P0, P1), P12 = L(P1, P2), P23 = L(P2, P3), P012 = L(P01, P12), P123 = L(P12, P23), P = L(P012, P123);
    [a.ox, a.oy] = P01; [b.ix, b.iy] = P23;
    return { x: P[0], y: P[1], ix: P012[0], iy: P012[1], ox: P123[0], oy: P123[1], angle: false };
  }

  // Voisins proposés par défaut pour juger une lettre dans un mot
  const voisinsParDefaut = ch => /[a-zà-ÿœæ]/.test(ch) ? ["n", "o"] : /[A-ZÀ-ÞŒÆ]/.test(ch) ? ["H", "O"] : /[0-9]/.test(ch) ? ["0", "1"] : ["n", "n"];

  // ---------------------------------------------------------------------------
  // Écran de retouche
  // ---------------------------------------------------------------------------
  async function vue(c, i) {
    const f = c.police, ch = M.CARS[i], p = f.reglages;
    const res = await calculer(c);
    // Point de départ : la retouche existante, sinon le tracé automatique simplifié
    const auto = () => { const s = source(c, p)(ch), g = s && M.glyphe(s, p); return g ? depuisGlyphe(g, p.approche) : null; };
    let forme = f.retouches[ch] ? JSON.parse(JSON.stringify(f.retouches[ch])) : auto();
    if (!forme) { toast("Ce caractère n'est pas encore fait : dessine-le d'abord."); return aller(`#/p/${f.id}/dessin/${i}`, true); }
    let [gauche, droite] = voisinsParDefaut(ch);

    rendre({
      titre: `Retoucher « ${esc(ch)} »`, retour: `#/p/${f.id}/apercu`,
      contenu: `<div class="atelier">
          <section class="essai-direct bandeau-retouche">
            <div class="titre-groupe"><p class="etiquette">Entre deux lettres</p>
              <span class="voisins"><input class="champ-lettre" id="v-gauche" maxlength="1" value="${esc(gauche)}" aria-label="Lettre à gauche">
              <span class="mono">${esc(ch)}</span><input class="champ-lettre" id="v-droite" maxlength="1" value="${esc(droite)}" aria-label="Lettre à droite"></span></div>
            <canvas class="bandeau" id="bandeau"></canvas>
          </section>
          <div class="editeur" id="editeur"><canvas id="toile"></canvas></div>
          <div class="outils-retouche">
            <button class="btn discret" id="r-annuler" aria-label="Annuler">${icone("annuler", 20)}</button>
            <button class="btn discret" id="r-ajouter" aria-pressed="false">+ Point</button>
            <button class="btn discret" id="r-supprimer" disabled>${icone("effacer", 18)}</button>
            <button class="btn discret" id="r-angle" disabled>Angle</button>
            <button class="btn discret" id="r-moins" aria-label="Dézoomer">−</button>
            <button class="btn discret" id="r-plus" aria-label="Zoomer">+</button>
          </div>
          <p class="aide consigne-retouche">Fais glisser un point pour le déplacer, ses poignées pour la courbure. Après un zoom, glisse dans le vide pour te déplacer.</p>
        </div>`,
      pied: `<button class="btn discret" id="r-origine">Origine</button><button class="btn principal" id="r-enregistrer">Enregistrer</button>`,
    });
    const toile = $("#toile"), boite = $("#editeur"), bandeau = $("#bandeau");
    const couleur = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

    // ---- Vue : échelle et décalage. On cadre de -320 à 980 en hauteur (jambages et accents compris).
    let zoom = 1, panX = 0, panY = 0, s = 1, ox = 0, oy = 0, dpr = 1;
    function cadrer() {
      dpr = window.devicePixelRatio || 1;
      const w = boite.clientWidth, h = boite.clientHeight;
      toile.width = w * dpr; toile.height = h * dpr;
      // cadrage sur la lettre (avec une marge), en gardant au moins la hauteur base → minuscules
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const cc of forme.contours) for (const n of cc) { x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); y0 = Math.min(y0, n.y, 0); y1 = Math.max(y1, n.y, 350); }
      s = Math.min(h / (y1 - y0 + 260), w / (x1 - x0 + 220)) * zoom;
      ox = w / 2 - ((x0 + x1) / 2) * s + panX; oy = h / 2 + ((y0 + y1) / 2) * s + panY;
      peindre();
    }

    // ---- Sélection et historique
    let choix = null;          // { c: n° contour, n: n° ancre }
    let modeAjout = false;
    const pile = [];           // états précédents pour « Annuler »
    const memoriser = () => { pile.push(JSON.stringify(forme.contours)); if (pile.length > 60) pile.shift(); };
    const ancre = () => choix && forme.contours[choix.c][choix.n];

    function peindre() {
      const cx = toile.getContext("2d"); cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = toile.width / dpr, h = toile.height / dpr; cx.clearRect(0, 0, w, h);
      // lignes guides : base, minuscules, majuscules, jambages
      const lignes = [[0, 2], [350, 1], [700, 1], [-250, 1]];
      cx.strokeStyle = couleur("--trait");
      for (const [y, e] of lignes) { cx.lineWidth = e; cx.setLineDash(y === 0 ? [] : [5, 5]); cx.beginPath(); cx.moveTo(0, oy - y * s); cx.lineTo(w, oy - y * s); cx.stroke(); }
      cx.setLineDash([]);
      // la lettre : remplissage léger + contour
      const P = cheminBezier(forme.contours, ox, oy, s);
      cx.fillStyle = couleur("--accent-doux"); cx.fill(P, "nonzero");
      cx.strokeStyle = couleur("--accent"); cx.lineWidth = 1.5; cx.stroke(P);
      // poignées de l'ancre choisie
      const A = ancre(), X = x => ox + x * s, Y = y => oy - y * s;
      if (A) {
        cx.strokeStyle = couleur("--doux"); cx.lineWidth = 1;
        for (const [hx, hy] of [[A.ix, A.iy], [A.ox, A.oy]]) {
          cx.beginPath(); cx.moveTo(X(A.x), Y(A.y)); cx.lineTo(X(hx), Y(hy)); cx.stroke();
          cx.beginPath(); cx.arc(X(hx), Y(hy), 6, 0, 7); cx.fillStyle = couleur("--carte"); cx.fill(); cx.stroke();
        }
      }
      // ancres : rond = lisse, carré = angle
      forme.contours.forEach((cc, ci) => cc.forEach((n, ni) => {
        const sel = choix && choix.c === ci && choix.n === ni, r = sel ? 7 : 5;
        cx.fillStyle = sel ? couleur("--accent") : couleur("--carte"); cx.strokeStyle = couleur("--accent"); cx.lineWidth = 1.5;
        cx.beginPath(); if (n.angle) cx.rect(X(n.x) - r, Y(n.y) - r, 2 * r, 2 * r); else cx.arc(X(n.x), Y(n.y), r, 0, 7);
        cx.fill(); cx.stroke();
      }));
      peindreBandeau();
      $("#r-supprimer").disabled = !A; $("#r-angle").disabled = !A;
      $("#r-angle").textContent = A && A.angle ? "Lisse" : "Angle";
    }

    // ---- Bandeau : gauche + lettre retouchée + droite, à la taille d'un texte
    function peindreBandeau() {
      const w = bandeau.clientWidth, h = bandeau.clientHeight; bandeau.width = w * dpr; bandeau.height = h * dpr;
      const cx = bandeau.getContext("2d"); cx.setTransform(dpr, 0, 0, dpr, 0, 0); cx.clearRect(0, 0, w, h);
      const k = h / 1250, base = h * 0.72;
      const gG = res.glyphes[gauche], gD = res.glyphes[droite];
      // largeur de la lettre retouchée : encre + marges, comme dans la police
      let x0 = Infinity, x1 = -Infinity;
      for (const cc of forme.contours) for (const n of cc) { x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); }
      const avance = x1 - x0 + 2 * p.approche;
      const total = (gG ? gG.avance : 0) + avance + (gD ? gD.avance : 0);
      let x = (w - total * k) / 2;
      cx.fillStyle = couleur("--encre");
      if (gG) { cx.fill(cheminTrueType(gG.contours, x, base, k)); x += gG.avance * k; }
      cx.fillStyle = couleur("--accent"); cx.fill(cheminBezier(forme.contours, x + (p.approche - x0) * k, base, k), "nonzero"); x += avance * k;
      cx.fillStyle = couleur("--encre");
      if (gD) cx.fill(cheminTrueType(gD.contours, x, base, k));
    }

    // ---- Interaction au doigt / stylet / souris
    const versPolice = e => { const r = toile.getBoundingClientRect(); return [(e.clientX - r.left - ox) / s, (oy - (e.clientY - r.top)) / s]; };
    const proche = (x, y, px) => Math.hypot(x, y) * s < px;
    let prise = null;   // ce qu'on fait glisser : {type: "ancre"|"in"|"out"|"vue", ...}

    function toucher(e) {
      const [x, y] = versPolice(e), A = ancre(), rayon = e.pointerType === "mouse" ? 12 : 24;
      if (modeAjout) { ajouterPoint(x, y, rayon); return null; }
      if (A) {                                  // d'abord les poignées de l'ancre choisie
        if (proche(A.ix - x, A.iy - y, rayon)) return { type: "in" };
        if (proche(A.ox - x, A.oy - y, rayon)) return { type: "out" };
      }
      let best = null, bd = Infinity;          // puis l'ancre la plus proche
      forme.contours.forEach((cc, ci) => cc.forEach((n, ni) => { const d = Math.hypot(n.x - x, n.y - y) * s; if (d < bd) { bd = d; best = { c: ci, n: ni }; } }));
      if (best && bd < rayon) { choix = best; return { type: "ancre" }; }
      choix = null; return { type: "vue" };
    }

    toile.addEventListener("pointerdown", e => {
      toile.setPointerCapture(e.pointerId); e.preventDefault();
      const t = toucher(e); if (!t) { peindre(); return; }
      if (t.type !== "vue") memoriser();
      prise = { ...t, x0: e.clientX, y0: e.clientY, px: panX, py: panY, depart: versPolice(e) };
      peindre();
    });
    toile.addEventListener("pointermove", e => {
      if (!prise) return;
      const A = ancre(), [x, y] = versPolice(e);
      if (prise.type === "vue") { panX = prise.px + e.clientX - prise.x0; panY = prise.py + e.clientY - prise.y0; cadrer(); return; }
      if (prise.type === "ancre") {               // l'ancre emmène ses deux poignées
        const dx = x - A.x, dy = y - A.y;
        A.x += dx; A.y += dy; A.ix += dx; A.iy += dy; A.ox += dx; A.oy += dy;
      } else {
        const [h, o] = prise.type === "in" ? ["i", "o"] : ["o", "i"];
        A[h + "x"] = x; A[h + "y"] = y;
        if (!A.angle) {                            // point lisse : la poignée opposée reste alignée
          const l = Math.hypot(A[o + "x"] - A.x, A[o + "y"] - A.y), [ux, uy] = norm(A.x - x, A.y - y);
          A[o + "x"] = A.x + ux * l; A[o + "y"] = A.y + uy * l;
        }
      }
      demanderPeinture();
    });
    const lacher = () => { prise = null; };
    toile.addEventListener("pointerup", lacher); toile.addEventListener("pointercancel", lacher);
    let image = 0; const demanderPeinture = () => { if (!image) image = requestAnimationFrame(() => { image = 0; peindre(); }); };

    // Ajouter un point : on cherche l'endroit le plus proche sur les courbes et on coupe la courbe là.
    function ajouterPoint(x, y, rayon) {
      let best = null, bd = Infinity;
      forme.contours.forEach((cc, ci) => cc.forEach((a, ni) => {
        const b = cc[(ni + 1) % cc.length];
        for (let k = 1; k < 40; k++) { const t = k / 40, [bx, by] = M.bezier(a, b, t), d = Math.hypot(bx - x, by - y) * s; if (d < bd) { bd = d; best = { ci, ni, t }; } }
      }));
      if (!best || bd > rayon * 1.5) { toast("Touche directement le contour pour y ajouter un point."); return; }
      memoriser();
      const cc = forme.contours[best.ci], nouveau = couper(cc[best.ni], cc[(best.ni + 1) % cc.length], best.t);
      cc.splice(best.ni + 1, 0, nouveau); choix = { c: best.ci, n: best.ni + 1 };
      modeAjout = false; $("#r-ajouter").setAttribute("aria-pressed", "false"); peindre();
    }

    // ---- Boutons
    $("#r-annuler").onclick = () => { if (!pile.length) return; forme.contours = JSON.parse(pile.pop()); choix = null; peindre(); };
    $("#r-ajouter").onclick = () => { modeAjout = !modeAjout; $("#r-ajouter").setAttribute("aria-pressed", String(modeAjout)); if (modeAjout) toast("Touche le contour là où tu veux un point."); };
    $("#r-supprimer").onclick = () => {
      if (!choix) return; memoriser();
      const cc = forme.contours[choix.c]; cc.splice(choix.n, 1);
      if (cc.length < 2) forme.contours.splice(choix.c, 1);
      choix = null; peindre();
    };
    $("#r-angle").onclick = () => {
      const A = ancre(); if (!A) return; memoriser();
      A.angle = !A.angle;
      if (!A.angle) {                                 // redevient lisse : on aligne les deux poignées
        const [ux, uy] = norm(A.ox - A.ix, A.oy - A.iy), li = Math.hypot(A.ix - A.x, A.iy - A.y), lo = Math.hypot(A.ox - A.x, A.oy - A.y);
        A.ix = A.x - ux * li; A.iy = A.y - uy * li; A.ox = A.x + ux * lo; A.oy = A.y + uy * lo;
      }
      peindre();
    };
    $("#r-plus").onclick = () => { zoom = Math.min(6, zoom * 1.5); cadrer(); };
    $("#r-moins").onclick = () => { zoom = Math.max(0.6, zoom / 1.5); if (zoom <= 1) { panX = panY = 0; } cadrer(); };
    $("#r-origine").onclick = async () => {
      const ok = await demander({ titre: "Revenir au tracé d'origine ?", texte: "Les retouches de cette lettre seront perdues.", ok: "Revenir" });
      if (!ok) return; memoriser(); forme = auto(); choix = null; cadrer();
    };
    $("#r-enregistrer").onclick = () => {
      f.retouches[ch] = { contours: arrondir(forme.contours) }; modifie(c);
      toast("Retouche enregistrée"); revenir(`#/p/${f.id}/apercu`);
    };
    for (const [id, cote] of [["#v-gauche", 0], ["#v-droite", 1]]) $(id).oninput = e => {
      const v = e.target.value || " "; if (cote) droite = v; else gauche = v; peindreBandeau();
    };

    const obs = new ResizeObserver(cadrer); obs.observe(boite);
    nettoyage = () => obs.disconnect();
  }

  return { vue, depuisGlyphe };
})();
