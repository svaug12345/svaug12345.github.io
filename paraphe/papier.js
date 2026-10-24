/* =============================================================================
   Paraphe — pages papier : import (photos, PDF, caméra), cases bonus, reprises,
   choix de version.
   -----------------------------------------------------------------------------
   Une lettre peut exister en PLUSIEURS versions :
     - « grille »       : sa case sur la page 1 ou 2 ;
     - « bonus:clé »    : une case bonus où on l'a refaite (l'enfant dit laquelle) ;
     - « reprise:k:j »  : la case j de la feuille de reprise n° k (déjà étiquetée) ;
     - « dessin »       : dessinée à l'écran.
   police.bonus    = { clé de case bonus: caractère }
   police.choix    = { caractère: id de la version préférée }
   police.feuilles = { k: [lettres] }   feuilles de reprise imprimées (k = 1 à 5)
   police.aRefaire = [lettres]          liste en cours, pas encore imprimée
   Par défaut : dessin > reprise > dernière case bonus > grille.

   Où sont les cases bonus :
     - grilles 4 et 5 : une rangée en bas des pages 1 et 2. Clé « 0:k » ou « 1:k » ;
     - grille 3 (1.6) : une page 4 entière de 63 cases. Clé « k » (simple numéro).
   Une case BARRÉE (grande croix) ne compte plus, quelle qu'elle soit.
   ========================================================================== */
"use strict";

const NOMS_PAGES = ["Page 1 de la grille", "Page 2 de la grille", "Page de phrases (ancienne grille)", "Page de cases bonus (ancienne grille)"];

/** La case d'un caractère sur les pages de grille enregistrées → { page, idx } ou null.
    Chaque page sait quel gabarit elle a (3, 4 ou 5) et donc où est chaque caractère. */
function caseGrille(c, ch) {
  for (const n of [0, 1]) {
    const page = c.pages[n]; if (!page) continue;
    const idx = M.disposition(M.geo(page), n).cars.indexOf(ch);
    if (idx >= 0) return { page, idx };
  }
  return null;
}

/** Toutes les cases bonus disponibles sur les pages enregistrées : [{ cle, page, idx, nom }]. */
function casesBonus(c) {
  const res = [];
  for (const n of [0, 1]) {
    const page = c.pages[n], g = page && M.geo(page); if (!g || !g.bonus) continue;
    for (let k = 0; k < g.bonus; k++) res.push({ cle: `${n}:${k}`, page, idx: g.n + k, nom: `Case bonus ${k + 1} · page ${n + 1}` });
  }
  if (c.pages[3]) for (let k = 0; k < M.PAR_PAGE; k++) res.push({ cle: String(k), page: c.pages[3], idx: k, nom: `Case bonus n° ${k + 1}` });
  return res;
}
/** Une clé de case bonus → { page, idx, nom } (ou null si la page n'est plus là). */
function caseBonus(c, cle) {
  const [a, b] = String(cle).split(":");
  if (b !== undefined) {
    const page = c.pages[+a], g = page && M.geo(page);
    return g && g.bonus ? { page, idx: g.n + +b, nom: `Case bonus ${+b + 1} · page ${+a + 1}` } : null;
  }
  return c.pages[3] ? { page: c.pages[3], idx: +a, nom: `Case bonus n° ${+a + 1}` } : null;
}

/** Cases des feuilles de reprise scannées où se trouve ce caractère : [{ id, page, idx, nom }]. */
function casesReprise(c, ch) {
  const res = [];
  for (const [k, lettres] of Object.entries(c.police.feuilles)) {
    const page = c.reprises[k]; if (!page) continue;
    lettres.forEach((x, j) => { if (x === ch) res.push({ id: `reprise:${k}:${j}`, page, idx: j, nom: `Feuille de reprise n° ${k}` }); });
  }
  return res;
}

/** Toutes les versions possibles d'un caractère (sans encore savoir si la case est remplie). */
function versionsDe(c, p, ch) {
  const f = c.police, v = [], cg = caseGrille(c, ch);
  if (cg) v.push({ id: "grille", nom: "Grille", masque: () => M.masqueScan(cg.page, cg.idx, p) });
  for (const [k, x] of Object.entries(f.bonus)) {
    const cb = x === ch && caseBonus(c, k);
    if (cb) v.push({ id: "bonus:" + k, nom: cb.nom, masque: () => M.masqueScan(cb.page, cb.idx, p, true) });
  }
  for (const r of casesReprise(c, ch)) v.push({ ...r, masque: () => M.masqueScan(r.page, r.idx, p) });
  if ((f.dessins[ch] || []).length) v.push({ id: "dessin", nom: "Dessin à l'écran", masque: () => M.masqueDessin(f.dessins[ch], p, ch) });
  return v;
}

/** Caractères dont la case de la grille a été barrée, dans l'ordre de la grille. */
function lettresBarrees(c, p) {
  const res = [];
  for (const n of [0, 1]) {
    const page = c.pages[n]; if (!page) continue;
    M.disposition(M.geo(page), n).cars.forEach((ch, k) => { if (ch && M.analyserCase(page, k, p).barree) res.push(ch); });
  }
  return res;
}

/** La version utilisée : celle choisie, sinon dessin > reprise > dernière case bonus > grille. */
function versionChoisie(c, p, ch) {
  const v = versionsDe(c, p, ch); if (!v.length) return null;
  return v.find(x => x.id === c.police.choix[ch]) || v.find(x => x.id === "dessin")
    || v.filter(x => x.id.startsWith("reprise")).pop() || v.filter(x => x.id.startsWith("bonus")).pop() || v[0];
}

/** Nombre de versions (rapide, sans calculer les masques) : pour le petit badge de la galerie. */
function nbVersions(c, ch) {
  const f = c.police;
  return (caseGrille(c, ch) ? 1 : 0) + Object.entries(f.bonus).filter(([k, x]) => x === ch && caseBonus(c, k)).length
    + casesReprise(c, ch).length + ((f.dessins[ch] || []).length ? 1 : 0);
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
/** Enregistre le scan de la feuille de reprise n° k. Chaque lettre refaite (case remplie,
    non barrée) devient la version utilisée : c'est pour ça qu'on l'a refaite. */
async function enregistrerReprise(c, k, page) {
  const f = c.police;
  c.reprises[k] = page; f.reprises[k] = await Stockage.pageVersBlob(page);
  (f.feuilles[k] || []).forEach((ch, j) => {
    if (M.masqueScan(page, j, f.reglages)) { f.choix[ch] = `reprise:${k}:${j}`; delete f.retouches[ch]; }
  });
  await modifie(c, true);
}

// ---------------------------------------------------------------------------
// Importer : des photos et/ou des PDF, une ou plusieurs pages, dans n'importe quel ordre.
// Chaque page est redressée puis reconnue grâce à ses barres (page 1, page 2, reprise…).
// Le scanner de la caméra (scanner.js) arrive ici aussi, avec ses pages déjà prises.
// ---------------------------------------------------------------------------
let pagesEnAttente = null;     // pages capturées par la caméra, à traiter par vueImport

/** Une page reconnue → où l'enregistrer : 0 ou 1 (grille), 3 (ancienne page bonus), « R » (reprise), -1 (ignorer). */
function cibleDe(id) {
  if (id.reprise) return "R";
  if (id.phrases) return -1;                   // les phrases ne servent plus
  if (id.num === 1 || id.num === 2) return id.num - 1;
  if (id.num === 4) return 3;
  return null;                                  // pas reconnue : à choisir
}

/** Fichiers choisis (images ou PDF) → pages redressées et reconnues. */
async function analyserFichiers(fichiers, progres) {
  const pages = [];
  for (const fichier of fichiers) {
    const pdf = fichier.type === "application/pdf" || /\.pdf$/i.test(fichier.name);
    let sources;
    try {
      if (pdf) sources = await LecteurPDF.lire(fichier);
      else { const bmp = await createImageBitmap(fichier); sources = [{ source: bmp, w: bmp.width, h: bmp.height }]; }
    } catch (err) { pages.push({ erreur: `« ${fichier.name} » n'a pas pu être lu.` }); continue; }
    for (const [k, l] of sources.entries()) {
      progres(`Analyse de ${fichier.name}${sources.length > 1 ? `, page ${k + 1} sur ${sources.length}` : ""}…`);
      await new Promise(r => setTimeout(r, 10));
      if (l.erreur) { pages.push({ erreur: l.erreur }); continue; }
      const page = M.redresser(M.enGris(l.source, l.w, l.h));
      pages.push(page.erreur ? { erreur: `${fichier.name}${sources.length > 1 ? ` (page ${k + 1})` : ""} : ${page.erreur}` } : { page, id: M.identifierPage(page) });
    }
  }
  return pages;
}

/** Enregistre les pages (cible déjà décidée) ; la dernière prise gagne en cas de doublon. */
async function enregistrerTout(c, pages) {
  let n = 0;
  for (const x of pages) {
    if (!x.page || x.cible === -1 || x.cible === null) continue;
    if (x.cible === "R") await enregistrerReprise(c, x.id.reprise, x.page); else await enregistrerPage(c, x.cible, x.page);
    n++;
  }
  return n;
}

/** Après l'enregistrement : vers l'écran des cases bonus s'il y en a à attribuer, sinon le projet. */
function apresImport(c, n) {
  const f = c.police;
  toast(`${n} page${n > 1 ? "s" : ""} enregistrée${n > 1 ? "s" : ""}`);
  const aFaire = casesBonus(c).some(b => !f.bonus[b.cle] && M.masqueScan(b.page, b.idx, f.reglages, true));
  if (aFaire) aller(`#/p/${f.id}/bonus`, true);     // remplace l'écran d'import : « retour » ramène au projet
  else revenir(`#/p/${f.id}`);
}

async function vueImport(c) {
  const f = c.police;
  rendre({
    titre: "Importer", retour: `#/p/${f.id}`,
    contenu: `<div><h2 class="titre-page">Photos ou PDF</h2>
        <p class="sous-titre">Une ou plusieurs photos, un PDF d'une ou plusieurs pages, dans n'importe quel ordre : chaque feuille est reconnue toute seule.</p></div>
      <p class="message" id="message" role="status"></p>
      <div id="pages-pdf" class="pages-pdf"></div>
      <input type="file" id="fichiers" accept="image/*,application/pdf,.pdf" multiple hidden>`,
    pied: `<button class="btn principal" id="choisir">${icone("page", 20)} Choisir des fichiers</button>`,
  });
  const msg = $("#message");
  $("#choisir").onclick = () => $("#fichiers").click();

  const traiter = async pages => {
    for (const x of pages) if (x.page) x.cible = cibleDe(x.id);
    // Tout est reconnu ? On enregistre directement. Sinon on demande pour les pages inconnues.
    const bonnes = pages.filter(x => x.page);
    if (bonnes.length && bonnes.every(x => x.cible !== null) && pages.every(x => x.page)) {
      return apresImport(c, await enregistrerTout(c, bonnes));
    }
    // pages non reconnues : on propose les places de grille encore libres
    const prises = new Set(bonnes.map(x => x.cible)), libres = [0, 1].filter(n => !prises.has(n));
    for (const x of bonnes) if (x.cible === null) x.cible = libres.shift() ?? -1;
    afficher(pages);
  };
  $("#fichiers").onchange = async e => {
    const fichiers = [...e.target.files]; e.target.value = ""; if (!fichiers.length) return;
    msg.className = "message"; msg.textContent = "Lecture…"; $("#pages-pdf").replaceChildren();
    await new Promise(r => setTimeout(r, 30));
    traiter(await analyserFichiers(fichiers, t => { msg.textContent = t; }));
  };

  function afficher(pages) {
    const zone = $("#pages-pdf"), bonnes = pages.filter(x => x.page).length;
    msg.className = "message " + (bonnes ? "ok" : "erreur");
    msg.textContent = bonnes ? `${bonnes} feuille${bonnes > 1 ? "s" : ""} trouvée${bonnes > 1 ? "s" : ""}. Vérifie celles qui n'ont pas été reconnues, puis enregistre.`
      : "Aucune feuille de la grille trouvée : les 4 carrés noirs des coins doivent être visibles.";
    pages.forEach((x, k) => {
      const carte = document.createElement("div"); carte.className = "carte-page";
      if (!x.page) { carte.innerHTML = `<p class="aide">${esc(x.erreur)}</p>`; zone.append(carte); return; }
      const options = [[0, NOMS_PAGES[0]], [1, NOMS_PAGES[1]]];
      if (x.id.reprise) options.push(["R", `Feuille de reprise n° ${x.id.reprise}`]);
      if (c.pages[3] || x.id.num === 4) options.push([3, NOMS_PAGES[3]]);
      options.push([-1, "Ignorer"]);
      carte.innerHTML = `<canvas class="page-scannee"></canvas>
        <label class="champ-select">Feuille ${k + 1}, c'est :
          <select>${options.map(([v, t]) => `<option value="${v}" ${v === x.cible ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`;
      zone.append(carte);
      dessinerPage(carte.querySelector("canvas"), x.page, x.cible);
      carte.querySelector("select").onchange = ev => { const v = ev.target.value; x.cible = v === "R" ? "R" : +v; dessinerPage(carte.querySelector("canvas"), x.page, x.cible); };
    });
    if (!bonnes) return;
    $("#pied").innerHTML = `<div><button class="btn discret" id="autres">Autres fichiers</button><button class="btn principal" id="garder">Enregistrer</button></div>`;
    $("#autres").onclick = () => $("#fichiers").click();
    $("#garder").onclick = async () => {
      const choisies = pages.filter(x => x.page && x.cible !== -1);
      const doublon = choisies.find((x, k) => x.cible !== "R" && choisies.findIndex(y => y.cible === x.cible) !== k);
      if (doublon) { toast(`Deux feuilles sont attribuées à « ${NOMS_PAGES[doublon.cible]} ».`); return; }
      apresImport(c, await enregistrerTout(c, choisies));
    };
  }

  // Pages venant du scanner de la caméra
  if (pagesEnAttente) { const p = pagesEnAttente; pagesEnAttente = null; traiter(p); }
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

// ---------------------------------------------------------------------------
// Lettres à refaire sur papier : on compose une liste, on imprime une « feuille de reprise »
// où chaque case porte déjà sa lettre. Au scan, l'appli reconnaît la feuille (9 barres à droite,
// son numéro en barres à gauche) et range chaque lettre toute seule : rien à indiquer.
// ---------------------------------------------------------------------------
function vueReprise(c) {
  const f = c.police, p = f.reglages, liste = f.aRefaire;
  const groupes = caracteresParType();
  rendre({
    titre: "Lettres à refaire", retour: `#/p/${f.id}`,
    contenu: `<div><h2 class="titre-page">Refaire des lettres sur papier</h2>
        <p class="sous-titre">Choisis les lettres à refaire, imprime la feuille, écris, puis scanne-la : chaque lettre se range toute seule.</p></div>
      <section><p class="etiquette">Sur la prochaine feuille (${liste.length})</p>
        <div class="puces" id="puces">${liste.length ? liste.map((ch, k) => `<button class="puce" data-k="${k}" aria-label="Retirer ${esc(ch)}">${esc(ch)} <span aria-hidden="true">×</span></button>`).join("")
          : `<p class="aide">Aucune lettre pour l'instant.</p>`}</div>
        <label class="champ-select">Ajouter une lettre
          <select id="ajout"><option value="">Choisir…</option>
            ${groupes.map(g => `<optgroup label="${g.titre}">${g.cars.map(ch => `<option value="${esc(ch)}">${esc(libelle(ch))}</option>`).join("")}</optgroup>`).join("")}
          </select></label>
      </section>
      ${Object.keys(f.feuilles).length ? `<section><p class="etiquette">Feuilles déjà imprimées</p><div class="liste">${Object.entries(f.feuilles).map(([k, l]) => `
        <div class="ligne"><span class="pastille ${c.reprises[k] ? "ok" : ""}">${icone(c.reprises[k] ? "coche" : "page")}</span>
          <span class="corps"><span class="titre">Feuille n° ${k}</span><span class="detail">${esc(l.join(" "))} · ${c.reprises[k] ? "scannée" : "à scanner"}</span></span></div>`).join("")}</div></section>` : ""}`,
    pied: `<button class="btn principal" id="imprimer" ${liste.length ? "" : "disabled"}>${icone("imprimer", 20)} Imprimer la feuille</button>`,
  });
  document.querySelectorAll(".puce").forEach(b => b.onclick = () => { liste.splice(+b.dataset.k, 1); modifie(c); vueReprise(c); });
  $("#ajout").onchange = e => {
    const ch = e.target.value; if (!ch) return;
    if (!liste.includes(ch) && liste.length < M.GABARITS.R.n) liste.push(ch);
    modifie(c); vueReprise(c);
  };
  $("#imprimer").onclick = async () => {
    // Numéro de feuille : de 1 à 5, en tournant. Réutiliser un numéro efface l'ancienne feuille
    // (et ses versions) : il ne reste en jeu que les 5 dernières.
    const k = (f.derniereFeuille || 0) % 5 + 1;
    if (c.reprises[k]) {
      for (const [ch, id] of Object.entries(f.choix)) if (id.startsWith(`reprise:${k}:`)) delete f.choix[ch];
      delete c.reprises[k]; delete f.reprises[k];
    }
    f.feuilles[k] = liste.slice(); f.derniereFeuille = k; f.aRefaire = [];
    await modifie(c, true);
    await partagerOuTelecharger(Grille.reprise(f.nom, f.feuilles[k], k), `Lettres à refaire ${f.nom} n° ${k}.pdf`, "application/pdf",
      "La feuille de reprise", "Imprime-la à 100 %, fais écrire les lettres, puis scanne-la avec les autres pages.");
    vueReprise(c);
  };
}
