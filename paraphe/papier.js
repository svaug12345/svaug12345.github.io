/* =============================================================================
   Paraphe — pages papier : import d'un PDF scanné, cases bonus, choix de version.
   -----------------------------------------------------------------------------
   Une lettre peut maintenant exister en PLUSIEURS versions :
     - « grille » : sa case sur la page 1 ou 2 ;
     - « bonus:k » : la case bonus n° k de la page 4, si on l'y a refaite ;
     - « dessin »  : dessinée à l'écran.
   police.bonus  = { n° de case bonus: caractère }   (ce que l'enfant a refait dans chaque case)
   police.choix  = { caractère: id de la version préférée }
   Par défaut : le dessin s'il existe, sinon la dernière case bonus, sinon la grille.
   ========================================================================== */
"use strict";

const NOMS_PAGES = ["Page 1 · lettres et chiffres", "Page 2 · accents et signes", "Page 3 · phrases", "Page 4 · cases bonus"];

/** Toutes les versions possibles d'un caractère (sans encore savoir si la case est remplie). */
function versionsDe(c, p, ch) {
  const f = c.police, v = [], i = M.CARS.indexOf(ch), page = c.pages[Math.floor(i / M.PAR_PAGE)];
  if (page) v.push({ id: "grille", nom: "Grille", masque: () => M.masqueScan(page, i % M.PAR_PAGE, p) });
  if (c.pages[3]) for (const [k, x] of Object.entries(f.bonus)) if (x === ch)
    v.push({ id: "bonus:" + k, nom: `Case bonus n° ${+k + 1}`, masque: () => M.masqueScan(c.pages[3], +k, p, true) });
  if ((f.dessins[ch] || []).length) v.push({ id: "dessin", nom: "Dessin à l'écran", masque: () => M.masqueDessin(f.dessins[ch], p, ch) });
  return v;
}

/** La version utilisée dans la police : celle choisie, sinon dessin > dernière case bonus > grille. */
function versionChoisie(c, p, ch) {
  const v = versionsDe(c, p, ch); if (!v.length) return null;
  return v.find(x => x.id === c.police.choix[ch]) || v.find(x => x.id === "dessin") || v.filter(x => x.id.startsWith("bonus")).pop() || v[0];
}

/** Nombre de versions (rapide, sans calculer les masques) : pour le petit badge de la galerie. */
function nbVersions(c, ch) {
  const f = c.police, i = M.CARS.indexOf(ch);
  return (c.pages[Math.floor(i / M.PAR_PAGE)] ? 1 : 0) + (c.pages[3] ? Object.values(f.bonus).filter(x => x === ch).length : 0) + ((f.dessins[ch] || []).length ? 1 : 0);
}

/** Dessine un masque d'encre dans un canvas carré de la taille d'une case, posé sur la ligne de base. */
function dessinerMasque(cv, s) {
  const S = M.CASE_PX; cv.width = cv.height = S;
  const cx = cv.getContext("2d"), im = cx.createImageData(S, S);
  const encre = getComputedStyle(document.documentElement).getPropertyValue("--encre").trim();
  const [r, g, b] = (encre.match(/\w\w/g) || ["10", "2a", "2e"]).map(h => parseInt(h, 16));
  const dx = Math.round((S - s.w) / 2), dy = Math.round(S * (1 - M.LB) - s.base);      // même ligne de base pour toutes
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    if (!s.m[y * s.w + x]) continue;
    const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= S || Y >= S) continue;
    const k = 4 * (Y * S + X); im.data[k] = r; im.data[k + 1] = g; im.data[k + 2] = b; im.data[k + 3] = 255;
  }
  cx.putImageData(im, 0, 0);
  // ligne de base, discrète
  cx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--trait").trim();
  cx.beginPath(); cx.moveTo(0, S * (1 - M.LB)); cx.lineTo(S, S * (1 - M.LB)); cx.stroke();
}

/** Enregistre une page redressée à l'emplacement n (0 à 3). */
async function enregistrerPage(c, n, page) {
  c.pages[n] = page; c.police.pages[n] = await Stockage.pageVersBlob(page);
  await modifie(c, true);
}

// ---------------------------------------------------------------------------
// Importer un PDF scanné
// ---------------------------------------------------------------------------
async function vueImportPDF(c) {
  const f = c.police;
  rendre({
    titre: "Importer un PDF", retour: `#/p/${f.id}`,
    contenu: `<div><h2 class="titre-page">Importer un PDF scanné</h2>
        <p class="sous-titre">Un scanner donne une image plus nette qu'une photo. Les pages peuvent être dans n'importe quel ordre : l'appli les reconnaît.</p></div>
      <p class="message" id="message" role="status"></p>
      <div id="pages-pdf" class="pages-pdf"></div>
      <input type="file" id="fichier-pdf" accept="application/pdf,.pdf" hidden>`,
    pied: `<button class="btn principal" id="choisir-pdf">${icone("page", 20)} Choisir un PDF</button>`,
  });
  const msg = $("#message");
  $("#choisir-pdf").onclick = () => $("#fichier-pdf").click();
  $("#fichier-pdf").onchange = async e => {
    const fichier = e.target.files[0]; e.target.value = ""; if (!fichier) return;
    msg.className = "message"; msg.textContent = "Lecture du PDF…"; $("#pages-pdf").replaceChildren();
    await new Promise(r => setTimeout(r, 30));
    let lues;
    try { lues = await LecteurPDF.lire(fichier); }
    catch (err) { msg.className = "message erreur"; msg.textContent = "Ce PDF n'a pas pu être lu : " + err.message + "."; return; }
    // Chaque page : redresser puis reconnaître (barres de numéro, ou indices pour les anciennes grilles)
    const pages = [];
    for (const [k, l] of lues.entries()) {
      msg.textContent = `Analyse de la page ${k + 1} sur ${lues.length}…`; await new Promise(r => setTimeout(r, 10));
      if (l.erreur) { pages.push({ erreur: l.erreur }); continue; }
      const page = M.redresser(M.enGris(l.source, l.w, l.h));
      pages.push(page.erreur ? { erreur: page.erreur } : { page, id: M.identifierPage(page) });
    }
    // Attribution proposée : le numéro reconnu ; les pages non reconnues prennent les places restantes (1, 2, 4)
    const prises = new Set(pages.filter(x => x.id && x.id.num).map(x => x.id.num - 1));
    const libres = [0, 1, 3].filter(n => !prises.has(n));
    for (const x of pages) if (x.page) x.cible = x.id.num ? x.id.num - 1 : (libres.shift() ?? -1);
    afficher(pages);
  };

  function afficher(pages) {
    const zone = $("#pages-pdf"), bonnes = pages.filter(x => x.page).length;
    msg.className = "message " + (bonnes ? "ok" : "erreur");
    msg.textContent = bonnes ? `${bonnes} page${bonnes > 1 ? "s" : ""} trouvée${bonnes > 1 ? "s" : ""}. Vérifie l'attribution de chaque page, puis enregistre.`
      : "Aucune page de grille trouvée dans ce PDF.";
    pages.forEach((x, k) => {
      const carte = document.createElement("div"); carte.className = "carte-page";
      if (!x.page) { carte.innerHTML = `<p class="aide">Page ${k + 1} du PDF : ${esc(x.erreur)}</p>`; zone.append(carte); return; }
      carte.innerHTML = `<canvas class="page-scannee"></canvas>
        <label class="champ-select">Page ${k + 1} du PDF, c'est :
          <select>${NOMS_PAGES.map((nomP, n) => `<option value="${n}" ${n === x.cible ? "selected" : ""}>${nomP}</option>`).join("")}
            <option value="-1" ${x.cible === -1 ? "selected" : ""}>Ignorer</option></select></label>`;
      zone.append(carte);
      dessinerPage(carte.querySelector("canvas"), x.page, x.cible);
      carte.querySelector("select").onchange = ev => { x.cible = +ev.target.value; dessinerPage(carte.querySelector("canvas"), x.page, x.cible); };
    });
    if (!bonnes) return;
    $("#pied").innerHTML = `<div><button class="btn discret" id="autre-pdf">Autre PDF</button><button class="btn principal" id="garder">Enregistrer</button></div>`;
    $("#autre-pdf").onclick = () => $("#fichier-pdf").click();
    $("#garder").onclick = async () => {
      const choisies = pages.filter(x => x.page && x.cible >= 0);
      const doublon = choisies.find((x, k) => choisies.findIndex(y => y.cible === x.cible) !== k);
      if (doublon) { toast(`Deux pages sont attribuées à « ${NOMS_PAGES[doublon.cible]} ».`); return; }
      for (const x of choisies) await enregistrerPage(c, x.cible, x.page);
      toast(`${choisies.length} page${choisies.length > 1 ? "s" : ""} enregistrée${choisies.length > 1 ? "s" : ""}`);
      revenir(`#/p/${f.id}`);
    };
  }
}

// ---------------------------------------------------------------------------
// Cases bonus : dire quelle lettre a été refaite dans chaque case
// ---------------------------------------------------------------------------
function vueBonus(c) {
  const f = c.police, p = f.reglages, page = c.pages[3];
  if (!page) return aller(`#/p/${f.id}/photo/3`, true);
  // seules les cases où il y a de l'écriture
  const remplies = [...Array(M.PAR_PAGE).keys()].filter(k => M.masqueScan(page, k, p, true));
  rendre({
    titre: "Cases bonus", retour: `#/p/${f.id}`,
    contenu: `<div><h2 class="titre-page">Quelle lettre dans chaque case ?</h2>
        <p class="sous-titre">Regarde la petite lettre écrite dans le carré du coin et tape-la. La case bonus devient alors la version utilisée ; tu pourras toujours revenir à celle de la grille.</p></div>
      ${remplies.length ? `<div class="cases-bonus">${remplies.map(k => `<label class="case-bonus">
          <canvas data-k="${k}"></canvas>
          <input class="champ-lettre" maxlength="2" data-k="${k}" value="${esc(f.bonus[k] || "")}" placeholder="?" aria-label="Lettre de la case bonus ${k + 1}">
        </label>`).join("")}</div>` : `<p class="aide">Aucune case bonus remplie sur cette page.</p>`}`,
    pied: `<button class="btn principal" id="fini">Terminé</button>`,
  });
  // aperçu de chaque case entière (avec le petit carré), pris directement sur la page scannée
  document.querySelectorAll(".case-bonus canvas").forEach(cv => {
    const { x0, y0 } = M.rectCase(+cv.dataset.k), T = Math.round(M.CASE * M.PX);
    cv.width = cv.height = T;
    const im = cv.getContext("2d").createImageData(T, T);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const v = page.gris[(Math.round(y0 * M.PX) + y) * page.w + Math.round(x0 * M.PX) + x], k = 4 * (y * T + x);
      im.data[k] = im.data[k + 1] = im.data[k + 2] = v; im.data[k + 3] = 255;
    }
    cv.getContext("2d").putImageData(im, 0, 0);
  });
  document.querySelectorAll(".case-bonus input").forEach(inp => inp.oninput = () => {
    const k = inp.dataset.k, v = [...inp.value.trim()].pop() || "";      // on garde le dernier caractère tapé
    inp.value = v;
    if (v && !M.CARS.includes(v)) { toast(`« ${v} » ne fait pas partie de la grille.`); inp.value = ""; delete f.bonus[k]; modifie(c); return; }
    const avant = f.bonus[k];
    if (v) { f.bonus[k] = v; f.choix[v] = "bonus:" + k; delete f.retouches[v]; } else delete f.bonus[k];
    if (avant && avant !== v && f.choix[avant] === "bonus:" + k) delete f.choix[avant];
    modifie(c);
  });
  $("#fini").onclick = () => revenir(`#/p/${f.id}`);
}

// ---------------------------------------------------------------------------
// Choisir la version préférée d'une lettre
// ---------------------------------------------------------------------------
async function vueVersions(c, i) {
  const f = c.police, p = f.reglages, ch = M.CARS[i];
  const v = versionsDe(c, p, ch).map(x => ({ ...x, s: x.masque() })).filter(x => x.s);
  const actuelle = versionChoisie(c, p, ch);
  rendre({
    titre: `Versions de « ${esc(ch)} »`, retour: `#/p/${f.id}`,
    contenu: `<p class="aide">Touche la version que tu préfères : c'est elle qui sera dans la police.</p>
      <div class="versions">${v.map(x => `<button class="version ${actuelle && x.id === actuelle.id ? "choisie" : ""}" data-id="${x.id}">
          <canvas></canvas><span>${esc(x.nom)}</span>${actuelle && x.id === actuelle.id ? `<span class="badge">Choisie</span>` : ""}</button>`).join("")}</div>
      ${f.retouches[ch] ? `<p class="aide">La lettre est retouchée : changer de version efface la retouche.</p>` : ""}`,
    pied: `<button class="btn discret" id="nouvelle-version">${icone("stylo", 18)} Dessiner une version</button>`,
  });
  document.querySelectorAll(".version").forEach((btn, k) => {
    dessinerMasque(btn.querySelector("canvas"), v[k].s);
    btn.onclick = () => {
      if (actuelle && btn.dataset.id === actuelle.id) return;
      f.choix[ch] = btn.dataset.id; delete f.retouches[ch]; modifie(c);
      toast("Version choisie"); vueVersions(c, i);
    };
  });
  $("#nouvelle-version").onclick = () => aller(`#/p/${f.id}/dessin/${i}`);
}
