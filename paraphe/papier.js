/* =============================================================================
   Paraphe — pages papier : import d'un PDF scanné, cases bonus, choix de version.
   -----------------------------------------------------------------------------
   Une lettre peut maintenant exister en PLUSIEURS versions :
     - « grille » : sa case sur la page 1 ou 2 ;
     - « bonus:k » : la case bonus n° k de la page 4, si on l'y a refaite ;
     - « dessin »  : dessinée à l'écran.
   police.bonus  = { clé de case bonus: caractère }   (ce que l'enfant a refait dans chaque case)
   police.choix  = { caractère: id de la version préférée }
   Par défaut : le dessin s'il existe, sinon la dernière case bonus, sinon la grille.

   Les cases bonus existent à deux endroits :
     - grille 4 (depuis la 1.7) : une rangée de 7 cases en bas des pages 1 et 2.
       Clé « 0:k » ou « 1:k » (page 1 ou 2, case k de la rangée) ;
     - grille 3 (1.6) : une page 4 entière de 63 cases. Clé « k » (simple numéro).
   Une case BARRÉE (grande croix) ne compte plus : ni la case de la grille, ni une case bonus.
   ========================================================================== */
"use strict";

const NOMS_PAGES = ["Page 1 · lettres et chiffres", "Page 2 · accents et signes", "Page 3 · phrases", "Page 4 · cases bonus (ancienne grille)"];

/** Toutes les cases bonus disponibles sur les pages enregistrées : [{ cle, page, idx, nom }]. */
function casesBonus(c) {
  const res = [];
  for (const n of [0, 1]) {
    const page = c.pages[n]; if (!page || !M.geo(page).bonus) continue;
    for (let k = 0; k < M.NB_BONUS; k++) res.push({ cle: `${n}:${k}`, page, idx: M.PAR_PAGE + k, nom: `Case bonus ${k + 1} · page ${n + 1}` });
  }
  if (c.pages[3]) for (let k = 0; k < M.PAR_PAGE; k++) res.push({ cle: String(k), page: c.pages[3], idx: k, nom: `Case bonus n° ${k + 1}` });
  return res;
}
/** Une clé de case bonus → { page, idx, nom } (ou null si la page n'est plus là). */
function caseBonus(c, cle) {
  const [a, b] = String(cle).split(":");
  if (b !== undefined) {
    const page = c.pages[+a];
    return page && M.geo(page).bonus ? { page, idx: M.PAR_PAGE + +b, nom: `Case bonus ${+b + 1} · page ${+a + 1}` } : null;
  }
  return c.pages[3] ? { page: c.pages[3], idx: +a, nom: `Case bonus n° ${+a + 1}` } : null;
}

/** Toutes les versions possibles d'un caractère (sans encore savoir si la case est remplie). */
function versionsDe(c, p, ch) {
  const f = c.police, v = [], i = M.CARS.indexOf(ch), page = c.pages[Math.floor(i / M.PAR_PAGE)];
  if (page) v.push({ id: "grille", nom: "Grille", masque: () => M.masqueScan(page, i % M.PAR_PAGE, p) });
  for (const [k, x] of Object.entries(f.bonus)) {
    const cb = x === ch && caseBonus(c, k);
    if (cb) v.push({ id: "bonus:" + k, nom: cb.nom, masque: () => M.masqueScan(cb.page, cb.idx, p, true) });
  }
  if ((f.dessins[ch] || []).length) v.push({ id: "dessin", nom: "Dessin à l'écran", masque: () => M.masqueDessin(f.dessins[ch], p, ch) });
  return v;
}

/** Caractères dont la case de la grille a été barrée, dans l'ordre de la grille. */
function lettresBarrees(c, p) {
  const res = [];
  for (const n of [0, 1]) {
    const page = c.pages[n]; if (!page) continue;
    for (let k = 0; k < M.PAR_PAGE; k++) {
      const ch = M.CARS[n * M.PAR_PAGE + k];
      if (ch && M.analyserCase(page, k, p).barree) res.push(ch);
    }
  }
  return res;
}

/** La version utilisée dans la police : celle choisie, sinon dessin > dernière case bonus > grille. */
function versionChoisie(c, p, ch) {
  const v = versionsDe(c, p, ch); if (!v.length) return null;
  return v.find(x => x.id === c.police.choix[ch]) || v.find(x => x.id === "dessin") || v.filter(x => x.id.startsWith("bonus")).pop() || v[0];
}

/** Nombre de versions (rapide, sans calculer les masques) : pour le petit badge de la galerie. */
function nbVersions(c, ch) {
  const f = c.police, i = M.CARS.indexOf(ch);
  return (c.pages[Math.floor(i / M.PAR_PAGE)] ? 1 : 0) + Object.entries(f.bonus).filter(([k, x]) => x === ch && caseBonus(c, k)).length + ((f.dessins[ch] || []).length ? 1 : 0);
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
      // Des cases bonus remplies et pas encore attribuées ? On va directement dire quelles lettres c'est.
      const aFaire = casesBonus(c).some(b => !f.bonus[b.cle] && M.masqueScan(b.page, b.idx, f.reglages, true));
      if (aFaire) aller(`#/p/${f.id}/bonus`, true);     // remplace l'écran d'import : « retour » ramène au projet
      else revenir(`#/p/${f.id}`);
    };
  }
}

// ---------------------------------------------------------------------------
// Cases bonus : dire quelle lettre a été refaite dans chaque case
// ---------------------------------------------------------------------------
// Noms lisibles des signes dans la liste (un « . » seul, dans un menu, ne se voit pas bien)
const NOMS_SIGNES = { ".": "point", ",": "virgule", ";": "point-virgule", ":": "deux-points", "!": "point d'exclamation",
  "?": "point d'interrogation", "'": "apostrophe", "\"": "guillemet droit", "-": "tiret", "_": "tiret bas", "(": "parenthèse ouvrante",
  ")": "parenthèse fermante", "[": "crochet ouvrant", "]": "crochet fermant", "&": "et commercial", "@": "arobase", "€": "euro",
  "$": "dollar", "%": "pour cent", "/": "barre oblique", "+": "plus", "=": "égal", "*": "astérisque", "#": "dièse", "<": "inférieur",
  ">": "supérieur", "«": "guillemet ouvrant", "»": "guillemet fermant", "°": "degré", "~": "tilde" };
const libelle = ch => NOMS_SIGNES[ch] ? `${ch}   ${NOMS_SIGNES[ch]}` : ch;

/** Tous les caractères de la grille, rangés par type puis par ordre alphabétique,
    pour la liste déroulante. localeCompare("fr") trie « à, â, ä » juste après « a ». */
function caracteresParType() {
  const types = ["Minuscule", "Majuscule", "Chiffre", "Minuscule accentuée", "Majuscule accentuée", "Signe"];
  const titres = ["Minuscules", "Majuscules", "Chiffres", "Minuscules accentuées", "Majuscules accentuées", "Signes"];
  return types.map((t, k) => ({
    titre: titres[k],
    cars: M.CARS.filter(ch => genre(ch) === t).sort((a, b) => t === "Signe" ? a.codePointAt(0) - b.codePointAt(0) : a.localeCompare(b, "fr")),
  }));
}

function vueBonus(c) {
  const f = c.police, p = f.reglages;
  // Seules les cases bonus où il y a de l'écriture, et pas barrées (une case bonus ratée et
  // barrée est simplement ignorée).
  const remplies = casesBonus(c).filter(b => M.masqueScan(b.page, b.idx, p, true));
  if (!casesBonus(c).length) return aller(`#/p/${f.id}`, true);
  // Les lettres barrées sur la grille sont celles que l'enfant a refaites : elles sont proposées
  // en tête de liste. (On ne les attribue pas d'office : l'ordre des cases bonus peut être différent.)
  const barrees = lettresBarrees(c, p);
  const groupes = caracteresParType();
  const menu = cle => {
    const v = f.bonus[cle] || "", opt = ch => `<option value="${esc(ch)}" ${ch === v ? "selected" : ""}>${esc(libelle(ch))}</option>`;
    return `<select class="champ-lettre" data-cle="${cle}" aria-label="Lettre de cette case bonus">
      <option value="" ${v ? "" : "selected"}>Choisir…</option>
      ${barrees.length ? `<optgroup label="Barrées sur la grille">${barrees.map(opt).join("")}</optgroup>` : ""}
      ${groupes.map(g => `<optgroup label="${g.titre}">${g.cars.map(opt).join("")}</optgroup>`).join("")}
    </select>`;
  };
  rendre({
    titre: "Cases bonus", retour: `#/p/${f.id}`,
    contenu: `<div><h2 class="titre-page">Quelle lettre dans chaque case ?</h2>
        <p class="sous-titre">Regarde la petite lettre écrite dans le carré du coin et choisis-la dans la liste. La case bonus devient la version utilisée ; tu pourras toujours revenir à celle de la grille.</p></div>
      ${barrees.length ? `<div class="encart"><span>Lettres barrées sur la grille : <strong>${barrees.map(esc).join(" ")}</strong>. Elles sont en tête de chaque liste.</span></div>` : ""}
      ${remplies.length ? `<div class="cases-bonus">${remplies.map(b => `<label class="case-bonus">
          <canvas data-cle="${b.cle}"></canvas><span class="nom-case">${esc(b.nom)}</span>
          ${menu(b.cle)}
        </label>`).join("")}</div>` : `<p class="aide">Aucune case bonus remplie pour l'instant.</p>`}`,
    pied: `<button class="btn principal" id="fini">Terminé</button>`,
  });
  // aperçu de chaque case entière (avec le petit carré), pris directement sur la page scannée
  document.querySelectorAll(".case-bonus canvas").forEach(cv => {
    const b = remplies.find(x => x.cle === cv.dataset.cle), { x0, y0, C } = M.rectCase(b.idx, b.page), T = Math.round(C * M.PX);
    cv.width = cv.height = T;
    const im = cv.getContext("2d").createImageData(T, T), page = b.page;
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const v = page.gris[(Math.round(y0 * M.PX) + y) * page.w + Math.round(x0 * M.PX) + x], k = 4 * (y * T + x);
      im.data[k] = im.data[k + 1] = im.data[k + 2] = v; im.data[k + 3] = 255;
    }
    cv.getContext("2d").putImageData(im, 0, 0);
  });
  document.querySelectorAll(".case-bonus select").forEach(sel => sel.onchange = () => {
    const cle = sel.dataset.cle, v = sel.value, avant = f.bonus[cle];
    if (v) { f.bonus[cle] = v; f.choix[v] = "bonus:" + cle; delete f.retouches[v]; } else delete f.bonus[cle];
    if (avant && avant !== v && f.choix[avant] === "bonus:" + cle) delete f.choix[avant];
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
