/* =============================================================================
   Paraphe — interface.
   -----------------------------------------------------------------------------
   Navigation par l'adresse (#/…), ce qui fait marcher le bouton « retour »
   d'Android tout seul :
     #/                    accueil : liste des polices
     #/p/ID                une police : progression, papier, dessin, caractères
     #/p/ID/photo/N        photographier la page N (0, 1 ou 2)
     #/p/ID/dessin/I       dessiner le caractère n° I
     #/p/ID/apercu         réglages, aperçu et export
   ========================================================================== */
"use strict";

const M = Moteur;
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- Icônes (traits simples, couleur du texte) ----------
const ICONES = {
  retour: '<path d="M15 18l-6-6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  options: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
  photo: '<path d="M3 8.5h3.2l2-3h7.6l2 3H21V19H3z"/><circle cx="12" cy="13" r="3.4"/>',
  galerie: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16.5l-5.2-5.2L6 20"/>',
  stylo: '<path d="M4 20l4.2-1L19.5 7.7a2 2 0 0 0 0-2.8l-.4-.4a2 2 0 0 0-2.8 0L5 15.8z"/><path d="M14.5 6.5l3 3"/>',
  imprimer: '<path d="M7 9V3.5h10V9"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v6.5H7z"/>',
  telecharger: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
  partager: '<circle cx="18" cy="5.5" r="2.4"/><circle cx="6" cy="12" r="2.4"/><circle cx="18" cy="18.5" r="2.4"/><path d="M8.1 10.8l7.8-4.1M8.1 13.2l7.8 4.1"/>',
  coche: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  annuler: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  effacer: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  page: '<path d="M6 3h8.5L19 7.5V21H6z"/><path d="M14 3v5h5"/>',
  suivant: '<path d="M9 6l6 6-6 6"/>',
};
const icone = (nom, t = 22) => `<svg width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[nom]}</svg>`;

// ---------- Mise en page commune ----------
let nettoyage = null;   // fonction à appeler en quittant un écran (écouteurs, sauvegarde…)
function rendre({ titre = "", retour = null, actions = "", contenu = "", pied = "" }) {
  if (nettoyage) { nettoyage(); nettoyage = null; }
  $("#barre").innerHTML = (retour ? `<button class="icone" id="retour" aria-label="Retour">${icone("retour")}</button>` : `<span style="width:8px"></span>`)
    + `<h1>${titre}</h1>${actions}`;
  $("#contenu").innerHTML = contenu;
  const p = $("#pied"); p.hidden = !pied; p.innerHTML = pied ? `<div>${pied}</div>` : "";
  if (retour) $("#retour").onclick = () => revenir(retour);
  window.scrollTo(0, 0);
}

// Navigation : on numérote l'historique pour savoir si « retour » reste dans l'appli
function aller(h, remplacer = false) {
  const n = (history.state?.n || 0) + (remplacer ? 0 : 1);
  history[remplacer ? "replaceState" : "pushState"]({ n }, "", h);
  routeur();
}
function revenir(parent) {
  if ((history.state?.n || 0) > 0) history.back();
  else aller(parent, true);
}
window.addEventListener("popstate", routeur);

function toast(texte) {
  document.querySelectorAll(".toast").forEach(t => t.remove());
  const t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); t.textContent = texte;
  document.body.append(t); setTimeout(() => t.remove(), 3200);
}

/** Petite fenêtre : question, champ texte facultatif, boutons. Renvoie la réponse ou null. */
function demander({ titre, texte = "", champ = null, ok = "Valider", danger = false }) {
  return new Promise(fin => {
    const d = document.createElement("dialog");
    d.innerHTML = `<form method="dialog"><div><h2>${esc(titre)}</h2>${texte ? `<p class="aide">${esc(texte)}</p>` : ""}</div>
      ${champ !== null ? `<input class="champ" name="v" value="${esc(champ)}" maxlength="40" autocomplete="off" required>` : ""}
      <div class="rangee"><button class="btn discret" value="annuler" formnovalidate>Annuler</button>
      <button class="btn ${danger ? "danger" : "principal"}" value="ok">${esc(ok)}</button></div></form>`;
    document.body.append(d);
    d.addEventListener("close", () => {
      const v = d.returnValue === "ok" ? (champ !== null ? d.querySelector("input").value.trim() : true) : null;
      d.remove(); fin(v || null);
    });
    d.showModal();
    const inp = d.querySelector("input"); if (inp) { inp.focus(); inp.select(); }
  });
}

function telecharger(octets, nom, type) {
  const url = URL.createObjectURL(new Blob([octets], { type }));
  const a = document.createElement("a"); a.href = url; a.download = nom; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

// ---------- Police en cours d'édition (gardée en mémoire) ----------
let courant = null;   // { police, pages: [page décodée|null ×3], version, res, face }
async function ouvrirPolice(id) {
  if (courant && courant.police.id === id) return courant;
  const police = await Stockage.lire(id); if (!police) return null;
  police.reglages = { ...M.DEFAUT, ...police.reglages };    // complète avec les réglages ajoutés depuis
  police.retouches = police.retouches || {};                  // lettres retouchées à la main (vecteurs)
  const pages = await Promise.all(police.pages.map(b => b ? Stockage.blobVersPage(b) : null));
  courant = { police, pages, version: 1, res: null, face: null };
  return courant;
}
let minuteurSauvegarde = null;
function modifie(c, immediat = false) {
  c.version++;
  clearTimeout(minuteurSauvegarde);
  const f = () => Stockage.ecrire(c.police).catch(e => toast("Enregistrement impossible : " + e.message));
  if (immediat) return f(); minuteurSauvegarde = setTimeout(f, 400);
}

/** Pour chaque caractère : le dessin s'il existe, sinon la case de la photo. */
function source(c, p) {
  return ch => {
    const t = c.police.dessins[ch]; if (t && t.length) return M.masqueDessin(t, p, ch);
    const i = M.CARS.indexOf(ch), page = c.pages[Math.floor(i / M.PAR_PAGE)];
    return page ? M.masqueScan(page, i % M.PAR_PAGE, p) : null;
  };
}

/** Calcule la police (si quelque chose a changé) et la charge dans la page pour l'affichage. */
let numeroFace = 0;
async function calculer(c) {
  if (c.res && c.resVersion === c.version) return c.res;
  const v = c.version, p = c.police.reglages;
  const res = M.construire(source(c, p), p, c.police.nom, c.police.retouches);
  const famille = "Paraphe" + (++numeroFace), face = new FontFace(famille, res.ttf.slice().buffer);
  await face.load(); document.fonts.add(face);
  if (c.face) document.fonts.delete(c.face);
  Object.assign(c, { face, res: { ...res, famille }, resVersion: v });
  return c.res;
}

const genre = ch => /[0-9]/.test(ch) ? "Chiffre" : ch.toLowerCase() === ch.toUpperCase() ? "Signe"
  : ch === ch.toUpperCase() ? (/[A-Z]/.test(ch) ? "Majuscule" : "Majuscule accentuée") : (/[a-z]/.test(ch) ? "Minuscule" : "Minuscule accentuée");
const CONSEIL = {
  "Majuscule": "Pose-la sur le trait plein et monte jusqu'au pointillé du haut.",
  "Majuscule accentuée": "Lettre jusqu'au pointillé du haut, accent au-dessus.",
  "Minuscule": "Pose-la sur le trait plein. Corps jusqu'au premier pointillé ; les queues descendent dessous.",
  "Minuscule accentuée": "Corps jusqu'au premier pointillé, accent au-dessus.",
  "Chiffre": "Même hauteur qu'une majuscule.",
  "Signe": "Place-le comme tu l'écrirais au milieu d'une phrase.",
};

// =============================== ÉCRANS ===============================

async function vueAccueil() {
  const polices = await Stockage.lister();
  const ligne = f => {
    const nbD = Object.keys(f.dessins).length, nbP = f.pages.filter(Boolean).length;
    const detail = [nbP ? `${nbP} page${nbP > 1 ? "s" : ""} photographiée${nbP > 1 ? "s" : ""}` : "", nbD ? `${nbD} caractère${nbD > 1 ? "s" : ""} dessiné${nbD > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · ") || "Pas encore commencée";
    return `<a class="ligne" href="#/p/${f.id}" data-id="${f.id}"><span class="pastille">${icone("stylo")}</span>
      <span class="corps"><span class="titre">${esc(f.nom)}</span><span class="detail">${detail}</span></span>${icone("suivant", 18)}</a>`;
  };
  rendre({
    titre: "",
    // Accueil façon charte SV : grand titre « display », une phrase, puis le contenu ;
    // la marque reste discrète, en bas, dans les crédits (le geste seul, couleur ink-muted).
    contenu: `<div><h2 class="marque-titre">Paraphe</h2>
      <p class="sous-titre">Ton écriture devient une police. Imprime la grille et photographie-la, ou dessine chaque lettre au doigt ou au stylet.</p></div>
      ${polices.length ? `<section><p class="etiquette">Mes polices</p><div class="liste">${polices.map(ligne).join("")}</div></section>`
        : `<div class="vide-accueil"><strong>Aucune police pour l'instant.</strong><span>Crée la première : il suffit de lui donner un nom.</span></div>`}
      <footer class="credits"><span class="geste" role="img" aria-label="SV"></span>
        <span class="version">v${self.PLUME_VERSION}</span><span>·</span><a href="confidentialite.html">Confidentialité</a></footer>`,
    pied: `<button class="btn principal" id="nouvelle">${icone("plus", 20)} Nouvelle police</button>`,
  });
  // les liens <a href="#/p/…"> passent par aller() pour numéroter l'historique
  document.querySelectorAll(".ligne[data-id]").forEach(a => a.onclick = e => { e.preventDefault(); aller("#/p/" + a.dataset.id); });
  $("#nouvelle").onclick = async () => {
    const nom = await demander({ titre: "Nouvelle police", texte: "Son nom apparaîtra dans Word et les autres logiciels.", champ: "", ok: "Créer" });
    if (!nom) return;
    const f = Stockage.nouvelle(nom); await Stockage.ecrire(f); aller("#/p/" + f.id);
  };
}

async function vueProjet(c) {
  const f = c.police, nbDessins = Object.keys(f.dessins).length;
  const lignePage = n => {
    const ok = !!f.pages[n], nom = ["Page 1 · lettres et chiffres", "Page 2 · accents et signes", "Page 3 · phrases"][n];
    const detail = ok ? "Photographiée" : n === 2 ? "Facultative : règle l'espacement" : "À photographier";
    return `<button class="ligne" data-page="${n}"><span class="pastille ${ok ? "ok" : ""}">${icone(ok ? "coche" : "photo")}</span>
      <span class="corps"><span class="titre">${nom}</span><span class="detail ${ok ? "ok" : ""}">${detail}</span></span>${icone("suivant", 18)}</button>`;
  };
  rendre({
    titre: esc(f.nom), retour: "#/",
    actions: `<button class="icone" id="options" aria-label="Options">${icone("options")}</button>`,
    contenu: `
      <section class="progression" aria-live="polite">
        <div class="chiffres"><span id="compte">Calcul…</span><span id="pourcent"></span></div>
        <div class="jauge"><div id="jauge" style="width:0%"></div></div>
      </section>
      <section>
        <p class="etiquette">Sur papier</p>
        <div class="liste">
          <button class="ligne" id="grille"><span class="pastille">${icone("imprimer")}</span>
            <span class="corps"><span class="titre">Imprimer la grille</span><span class="detail">3 pages A4 · PDF</span></span>${icone("suivant", 18)}</button>
          ${[0, 1, 2].map(lignePage).join("")}
        </div>
      </section>
      <section>
        <p class="etiquette">Sur l'écran</p>
        <div class="liste">
          <button class="ligne" id="dessiner"><span class="pastille ${nbDessins ? "ok" : ""}">${icone("stylo")}</span>
            <span class="corps"><span class="titre" id="dessiner-titre">${nbDessins ? "Continuer à dessiner" : "Dessiner les lettres"}</span>
            <span class="detail" id="dessiner-detail">Au doigt ou au stylet · on commence par les minuscules</span></span>${icone("suivant", 18)}</button>
        </div>
        <p class="aide">Tout est enregistré à chaque trait : fais quelques lettres, reviens plus tard. Les minuscules suffisent déjà pour essayer la police.</p>
      </section>
      ${Exemples.GROUPES.map(g => `<section class="groupe">
        <div class="titre-groupe"><p class="etiquette">${g.nom}</p><span class="compte-groupe" data-groupe="${g.nom}"></span></div>
        <div class="galerie">${g.cars.map(ch => `<button class="case vide" data-i="${M.CARS.indexOf(ch)}" aria-label="${esc(ch)}"><small>${esc(ch)}</small></button>`).join("")}</div>
      </section>`).join("")}`,
    pied: `<button class="btn principal" id="apercu">Aperçu et export</button>`,
  });
  $("#grille").onclick = () => grilleAImprimer(f.nom);
  document.querySelectorAll("[data-page]").forEach(b => b.onclick = () => aller(`#/p/${f.id}/photo/${b.dataset.page}`));
  // Reprendre : premier caractère encore manquant, dans l'ordre de dessin (minuscules d'abord)
  $("#dessiner").onclick = () => {
    const manque = c.res ? new Set(c.res.manquants) : null;
    const ch = Exemples.ORDRE.find(x => !(f.dessins[x] || []).length && (!manque || manque.has(x))) || Exemples.ORDRE[0];
    aller(`#/p/${f.id}/dessin/${M.CARS.indexOf(ch)}`);
  };
  document.querySelectorAll(".galerie .case").forEach(b => b.onclick = () => aller(`#/p/${f.id}/dessin/${b.dataset.i}`));
  $("#apercu").onclick = () => aller(`#/p/${f.id}/apercu`);
  $("#options").onclick = () => optionsPolice(c);

  // La galerie s'affiche avec la vraie police dès qu'elle est calculée
  let res;
  try { res = await calculer(c); }
  catch (e) { $("#compte").textContent = "La police n'a pas pu être calculée : " + e.message; return; }
  if (!document.body.contains($("#dessiner"))) return;      // l'utilisateur a changé d'écran entre-temps
  const manque = new Set(res.manquants), nb = M.CARS.length - manque.size;
  $("#compte").textContent = `${nb} caractère${nb > 1 ? "s" : ""} sur ${M.CARS.length}`;
  $("#pourcent").textContent = Math.round(100 * nb / M.CARS.length) + " %";
  $("#jauge").style.width = (100 * nb / M.CARS.length) + "%";
  // progression par groupe, et texte du bouton « Dessiner »
  for (const g of Exemples.GROUPES) {
    const faits = g.cars.filter(ch => !manque.has(ch)).length;
    const el = document.querySelector(`[data-groupe="${g.nom}"]`);
    el.textContent = `${faits}/${g.cars.length}`; el.classList.toggle("complet", faits === g.cars.length);
  }
  const suivant = Exemples.ORDRE.find(ch => manque.has(ch));
  $("#dessiner-detail").textContent = suivant
    ? `Prochain : « ${suivant} » · ${Exemples.groupeDe(suivant).nom.toLowerCase()}`
    : "Tous les caractères sont faits";
  const secours = new Set(res.remplaces);
  document.querySelectorAll(".galerie .case").forEach(b => {
    const ch = M.CARS[b.dataset.i];
    if (secours.has(ch)) {               // pas encore fait, mais remplacé : on le montre en pâle
      b.classList.add("secours"); b.title = "Pas encore fait : remplacé provisoirement";
      b.innerHTML = `<small>${esc(ch)}</small><span style="font-family:'${res.famille}'">${esc(ch)}</span>`;
      return;
    }
    if (manque.has(ch)) return;
    b.classList.remove("vide");
    b.innerHTML = `<small>${esc(ch)}</small><span style="font-family:'${res.famille}'">${esc(ch)}</span>${(f.dessins[ch] || []).length ? '<span class="point" title="Dessiné à l\'écran"></span>' : ""}`;
  });
}

async function optionsPolice(c) {
  const d = document.createElement("dialog");
  d.innerHTML = `<form method="dialog"><h2>${esc(c.police.nom)}</h2>
    <button class="btn plein" value="renommer">Renommer</button>
    <button class="btn plein danger" value="supprimer">Supprimer la police</button>
    <button class="btn plein discret" value="">Fermer</button></form>`;
  document.body.append(d); d.showModal();
  d.addEventListener("close", async () => {
    const choix = d.returnValue; d.remove();
    if (choix === "renommer") {
      const nom = await demander({ titre: "Renommer", champ: c.police.nom, ok: "Renommer" });
      if (nom) { c.police.nom = nom; await modifie(c, true); vueProjet(c); }
    } else if (choix === "supprimer") {
      const sur = await demander({ titre: `Supprimer « ${c.police.nom} » ?`, texte: "Les photos et les dessins de cette police seront effacés de ton téléphone.", ok: "Supprimer", danger: true });
      if (sur) { await Stockage.supprimer(c.police.id); courant = null; aller("#/", true); toast("Police supprimée"); }
    }
  });
}

async function grilleAImprimer(nom) {
  const pdf = Grille.pdf(nom), fichier = `Grille ${nom}.pdf`;
  const f = new File([pdf], fichier, { type: "application/pdf" });
  // Le partage permet d'envoyer directement vers une appli d'impression, Drive, un e-mail…
  if (navigator.canShare && navigator.canShare({ files: [f] })) {
    const choix = await demanderChoix("La grille à imprimer", "Imprime-la à 100 % (sans « ajuster à la page »), au feutre noir de préférence.",
      [["partager", "Partager ou imprimer"], ["telecharger", "Télécharger le PDF"]]);
    if (choix === "partager") { try { await navigator.share({ files: [f], title: fichier }); } catch (e) { /* partage annulé */ } return; }
    if (choix !== "telecharger") return;
  }
  telecharger(pdf, fichier, "application/pdf");
  toast("Grille enregistrée dans Téléchargements");
}
function demanderChoix(titre, texte, choix) {
  return new Promise(fin => {
    const d = document.createElement("dialog");
    d.innerHTML = `<form method="dialog"><div><h2>${esc(titre)}</h2><p class="aide">${esc(texte)}</p></div>
      ${choix.map(([v, t], i) => `<button class="btn plein ${i ? "" : "principal"}" value="${v}">${esc(t)}</button>`).join("")}
      <button class="btn plein discret" value="">Annuler</button></form>`;
    document.body.append(d); d.showModal();
    d.addEventListener("close", () => { const v = d.returnValue; d.remove(); fin(v || null); });
  });
}

// ---------- Photographier une page ----------
function dessinerPage(cv, page, n) {
  const W = 900; cv.width = W; cv.height = Math.round(W * page.h / page.w);
  const tmp = document.createElement("canvas"); tmp.width = page.w; tmp.height = page.h;
  const img = new ImageData(page.w, page.h);
  for (let i = 0; i < page.gris.length; i++) { const v = page.gris[i]; img.data[4 * i] = img.data[4 * i + 1] = img.data[4 * i + 2] = v; img.data[4 * i + 3] = 255; }
  tmp.getContext("2d").putImageData(img, 0, 0);
  const cx = cv.getContext("2d"); cx.drawImage(tmp, 0, 0, cv.width, cv.height);
  // quadrillage théorique : il doit tomber pile sur les cases imprimées
  const k = cv.width / M.PW, x0 = (M.PW - M.COLS * M.CASE) / 2, y0 = M.MARGE + M.HAUT_ENTETE;
  cx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(); cx.lineWidth = 2; cx.globalAlpha = 0.75;
  if (n < 2) for (let r = 0; r < M.ROWS; r++) for (let col = 0; col < M.COLS; col++) cx.strokeRect((x0 + col * M.CASE) * k, (y0 + r * M.CASE) * k, M.CASE * k, M.CASE * k);
  else for (let r = 0; r < M.PHRASES.length; r++) { const y = (y0 + r * M.CASE + M.CASE * (1 - M.LB)) * k; cx.beginPath(); cx.moveTo(x0 * k, y); cx.lineTo((x0 + M.COLS * M.CASE) * k, y); cx.stroke(); }
}

function vuePhoto(c, n) {
  const f = c.police, existe = c.pages[n];
  const noms = ["Page 1 · lettres et chiffres", "Page 2 · accents et signes", "Page 3 · phrases"];
  rendre({
    titre: noms[n], retour: `#/p/${f.id}`,
    contenu: `<div><h2 class="titre-page">Photographie la page ${n + 1}</h2>
        <p class="sous-titre">L'appli retrouve les 4 carrés noirs des coins et redresse la feuille toute seule.</p></div>
      <ul class="conseils"><li>Feuille bien à plat, en pleine lumière, sans ombre du téléphone.</li>
        <li>Les 4 carrés noirs doivent être visibles, la feuille peut être un peu de travers.</li>
        <li>Remplis bien l'écran avec la feuille.</li></ul>
      <p class="message" id="message" role="status">${existe ? "Page enregistrée. Le quadrillage doit tomber pile sur les cases." : ""}</p>
      <canvas class="page-scannee" id="rendu" ${existe ? "" : "hidden"}></canvas>
      <input type="file" id="camera" accept="image/*" capture="environment" hidden>
      <input type="file" id="fichier" accept="image/*" hidden>`,
    pied: `<button class="btn discret" id="choisir" aria-label="Choisir dans la galerie">${icone("galerie", 20)}</button>
      <button class="btn principal" id="prendre">${icone("photo", 20)} ${existe ? "Reprendre" : "Prendre la photo"}</button>`,
  });
  if (existe) dessinerPage($("#rendu"), existe, n);
  $("#prendre").onclick = () => $("#camera").click();
  $("#choisir").onclick = () => $("#fichier").click();
  const traiter = async e => {
    const fichier = e.target.files[0]; e.target.value = ""; if (!fichier) return;
    const msg = $("#message"); msg.className = "message"; msg.textContent = "Analyse de la photo…";
    await new Promise(r => setTimeout(r, 30));                    // laisse le message s'afficher
    let page;
    try { const bmp = await createImageBitmap(fichier); page = M.redresser(M.enGris(bmp, bmp.width, bmp.height)); }
    catch (err) { page = { erreur: "Cette image n'a pas pu être lue." }; }
    if (page.erreur) { msg.className = "message erreur"; msg.textContent = page.erreur + " Reprends la photo en suivant les conseils."; return; }
    c.pages[n] = page; f.pages[n] = await Stockage.pageVersBlob(page); modifie(c, true);
    $("#rendu").hidden = false; dessinerPage($("#rendu"), page, n);
    msg.className = "message ok"; msg.textContent = "Page enregistrée. Vérifie que le quadrillage tombe pile sur les cases.";
    $("#prendre").innerHTML = `${icone("photo", 20)} Reprendre`;
  };
  $("#camera").onchange = traiter; $("#fichier").onchange = traiter;
}

// ---------- Dessiner un caractère ----------
function vueDessin(c, i) {
  const f = c.police, ch = M.CARS[i], g = genre(ch), p = f.reglages;
  let traits = (f.dessins[ch] || []).map(t => ({ ...t, points: t.points.slice() }));
  // Position dans l'ordre de dessin (minuscules, majuscules, chiffres, accents, signes)
  const pos = Exemples.ORDRE.indexOf(ch), groupe = Exemples.groupeDe(ch);
  const dernier = pos === Exemples.ORDRE.length - 1;
  const vers = q => aller(`#/p/${f.id}/dessin/${M.CARS.indexOf(Exemples.ORDRE[q])}`, true);
  rendre({
    titre: `${groupe.nom} · <span class="mono">${groupe.cars.indexOf(ch) + 1}/${groupe.cars.length}</span>`, retour: `#/p/${f.id}`,
    contenu: `<div class="atelier">
        <div class="consigne"><span class="grand">${esc(ch)}</span><p class="aide"><strong>${g}</strong><br>${CONSEIL[g]}</p></div>
        <div class="feuille" id="feuille"><canvas id="fond"></canvas><canvas id="encre"></canvas></div>
        <div class="outils">
          <button class="btn discret" id="annuler">${icone("annuler", 20)} Annuler</button>
          <button class="btn discret" id="effacer">${icone("effacer", 20)} Effacer</button>
        </div>
        <p class="aide" id="info"></p>
        <section class="essai-direct" aria-live="polite">
          <p class="etiquette">Ce que ça donne</p>
          <div class="essai-texte" id="essai-direct"></div>
        </section>
      </div>`,
    pied: `<button class="btn discret" id="prec" ${pos === 0 ? "disabled" : ""} aria-label="Caractère précédent">${icone("retour", 20)}</button>
      <button class="btn principal" id="suiv">${dernier ? "Terminer" : "Suivant"}</button>`,
  });
  const feuille = $("#feuille"), fond = $("#fond"), encre = $("#encre");
  const couleur = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  // Si le caractère vient déjà d'une photo, on l'affiche en filigrane
  const scan = (() => { const pg = c.pages[Math.floor(i / M.PAR_PAGE)]; return pg ? M.masqueScan(pg, i % M.PAR_PAGE, p) : null; })();
  $("#info").textContent = scan && !traits.length ? "En filigrane : la version de ta photo. Dessine pour la remplacer." : "";

  function dimensionner() {
    const r = window.devicePixelRatio || 1, t = Math.round(feuille.clientWidth * r);
    for (const cv of [fond, encre]) { cv.width = cv.height = t; }
    // lignes guides, aux mêmes hauteurs que sur la grille papier
    const cx = fond.getContext("2d"), L = y => (1 - y) * t;
    cx.clearRect(0, 0, t, t);
    if (scan && !traits.length) {                    // filigrane de la photo
      const tmp = document.createElement("canvas"); tmp.width = scan.w; tmp.height = scan.h;
      const img = tmp.getContext("2d").createImageData(scan.w, scan.h);
      for (let k = 0; k < scan.m.length; k++) if (scan.m[k]) { img.data[4 * k + 3] = 60; }
      tmp.getContext("2d").putImageData(img, 0, 0);
      const decal = 1.2 * M.MM * M.PX / M.CASE_PX * t, taille = scan.w / M.CASE_PX * t;
      cx.drawImage(tmp, decal, decal, taille, taille);
    }
    cx.strokeStyle = couleur("--trait"); cx.lineWidth = Math.max(1, r);
    cx.setLineDash([]); cx.beginPath(); cx.moveTo(0, L(M.LB)); cx.lineTo(t, L(M.LB)); cx.lineWidth = 2 * r; cx.stroke();
    cx.lineWidth = r; cx.setLineDash([6 * r, 6 * r]);
    for (const y of [M.LX, M.LM]) { cx.beginPath(); cx.moveTo(0, L(y)); cx.lineTo(t, L(y)); cx.stroke(); }
    cx.setLineDash([]); cx.fillStyle = couleur("--doux"); cx.font = `${13 * r}px system-ui`; cx.fillText(ch, 10 * r, 20 * r);
    peindre();
  }
  function peindre() {
    const cx = encre.getContext("2d"); cx.clearRect(0, 0, encre.width, encre.height);
    M.dessinerTraits(cx, traits, encre.width, p.stylo, couleur("--encre"));
  }
  let image = 0; const demanderPeinture = () => { if (!image) image = requestAnimationFrame(() => { image = 0; peindre(); }); };

  // ---- Saisie au doigt / stylet (Pointer Events : un seul code pour souris, doigt et stylet)
  let enCours = null, styletVu = false;
  const point = e => {
    const r = feuille.getBoundingClientRect();
    return { x: +((e.clientX - r.left) / r.width).toFixed(4), y: +((e.clientY - r.top) / r.height).toFixed(4), p: +(e.pressure || 0.5).toFixed(2) };
  };
  feuille.addEventListener("pointerdown", e => {
    if (e.pointerType === "pen") styletVu = true;
    if (enCours || (e.pointerType === "touch" && styletVu)) return;   // la paume est ignorée quand on écrit au stylet
    feuille.setPointerCapture(e.pointerId);
    enCours = { id: e.pointerId, stylet: e.pointerType === "pen", points: [point(e)] };
    traits.push(enCours); $("#info").textContent = ""; e.preventDefault(); demanderPeinture();
  });
  feuille.addEventListener("pointermove", e => {
    if (!enCours || e.pointerId !== enCours.id) return;
    // getCoalescedEvents donne tous les points intermédiaires (tracé plus fluide)
    for (const ev of (e.getCoalescedEvents ? e.getCoalescedEvents() : [e])) {
      const q = point(ev), d = enCours.points[enCours.points.length - 1];
      if (Math.hypot(q.x - d.x, q.y - d.y) > 0.0025) enCours.points.push(q);
    }
    demanderPeinture();
  });
  const finTrait = e => {
    if (!enCours || e.pointerId !== enCours.id) return;
    delete enCours.id; enCours = null; enregistrer(); if (traits.length === 1) dimensionner();
  };
  feuille.addEventListener("pointerup", finTrait); feuille.addEventListener("pointercancel", finTrait);

  function enregistrer() {
    if (traits.length) f.dessins[ch] = traits.map(t => ({ stylet: t.stylet, points: t.points })); else delete f.dessins[ch];
    delete f.retouches[ch];        // nouveau dessin : l'ancienne retouche ne lui correspond plus
    modifie(c);
    clearTimeout(minuteurApercu); minuteurApercu = setTimeout(majApercu, 350);
  }

  // ---- Aperçu en direct : mots et phrases écrits SEULEMENT avec les caractères déjà faits,
  //      la lettre en cours ressort en couleur. La police est recalculée après chaque trait.
  let minuteurApercu = null;
  async function majApercu() {
    const zone = $("#essai-direct"); if (!zone) return;
    let res; try { res = await calculer(c); } catch (e) { return; }
    if (!document.body.contains(zone)) return;                 // on a changé d'écran entre-temps
    const manque = new Set(res.manquants);
    if (manque.has(ch)) { zone.innerHTML = `<p class="aide">Dessine « ${esc(ch)} » pour le voir apparaître dans des mots.</p>`; return; }
    const dispo = new Set(M.CARS.filter(x => !manque.has(x)));
    const ex = Exemples.pour(dispo, ch);
    // chaque occurrence de la lettre en cours est entourée d'un <span class="nouvelle">
    const marquer = t => [...t].map(x => x === ch ? `<span class="nouvelle">${esc(x)}</span>` : esc(x)).join("");
    zone.style.fontFamily = `'${res.famille}', var(--ui)`;
    zone.innerHTML = (ex.phrase ? `<p class="phrase">${marquer(ex.phrase)}</p>` : "") + `<p class="mots">${marquer(ex.mots)}</p>`;
  }

  $("#annuler").onclick = () => { traits.pop(); enregistrer(); dimensionner(); };
  $("#effacer").onclick = () => { traits = []; enregistrer(); dimensionner(); };
  $("#prec").onclick = () => vers(pos - 1);
  $("#suiv").onclick = () => dernier ? revenir(`#/p/${f.id}`) : vers(pos + 1);
  majApercu();

  const obs = new ResizeObserver(dimensionner); obs.observe(feuille);
  nettoyage = () => { obs.disconnect(); clearTimeout(minuteurApercu); if (enCours) enregistrer(); };
}

// ---------- Aperçu, réglages, export ----------
const REGLAGES = {
  approche: ["Espace entre les lettres", 0, 80, 1, v => v, "Marge de chaque côté d'une lettre (1000 = hauteur de la police)."],
  espace: ["Espace entre les mots", 100, 600, 10, v => v, ""],
  graisse: ["Épaisseur du trait (photos)", -2, 3, 1, v => (v > 0 ? "+" : "") + v, "Amincit ou épaissit le feutre."],
  stylo: ["Épaisseur du stylo (dessins)", 2, 16, 0.5, v => v, ""],
  normaliser: ["Harmoniser les lettres dessinées", 0, 100, 5, v => v + " %", "Remet chaque lettre à la bonne taille entre les lignes : utile quand on écrit au doigt."],
  lissage: ["Lissage des contours", 0.5, 6, 0.1, v => (+v).toFixed(1), "Plus fort : bords plus doux, mais les petites boucles peuvent se fermer."],
  seuil: ["Seuil d'encre", 50, 200, 1, v => v, "Plus haut : garde les traits pâles. Trop haut : les lignes grises reviennent."],
  poussieres: ["Poussières ignorées", 0, 300, 5, v => v + " px²", "Taches effacées sous cette surface. Attention aux points des i."],
  pas: ["Précision du tracé", 1, 8, 1, v => v + " px", "Petit : plus fidèle, fichier plus lourd."],
  force: ["Force du crénage", 0.1, 1, 0.05, v => Math.round(v * 100) + " %", ""],
  cible: ["Écart minimal entre deux lettres", 0, 100, 2, v => v, ""],
  maxi: ["Rapprochement maximal", 20, 300, 10, v => v, "La ponctuation est limitée à la moitié."],
};
let texteEssai = null, tailleEssai = 34;

function vueApercu(c) {
  const f = c.police, p = f.reglages;
  const aPhotos = c.pages.some(Boolean), aDessins = Object.keys(f.dessins).length > 0;
  const curseur = id => {
    const [nom, min, max, pas, fmt, aide] = REGLAGES[id];
    return `<div class="reglage"><label for="r-${id}">${nom}</label><output id="o-${id}">${fmt(p[id])}</output>
      <input id="r-${id}" type="range" min="${min}" max="${max}" step="${pas}" value="${p[id]}">${aide ? `<p class="aide">${aide}</p>` : ""}</div>`;
  };
  texteEssai = texteEssai || `Bonjour, je m’appelle ${f.nom} !\nLa Cigale, ayant chanté tout l’été,\nse trouva fort dépourvue…`;
  const mesure = c.pages[2] ? M.mesurerEspacement(c.pages[2], p) : null;
  rendre({
    titre: "Aperçu", retour: `#/p/${f.id}`,
    contenu: `<section class="apercu-fixe">
        <div class="texte-essai lecture" id="lecture" aria-label="Texte d'essai : touche une lettre pour la retoucher"></div>
        <textarea class="texte-essai" id="essai" spellcheck="false" aria-label="Texte d'essai" hidden>${esc(texteEssai)}</textarea>
        <div class="ligne-etat"><p class="aide" id="etat" role="status">Calcul de la police…</p>
          <button class="btn discret petit" id="modifier-texte">${icone("stylo", 16)} Texte</button></div>
        <p class="aide" id="astuce">Touche une lettre pour la redessiner ou la retoucher.</p>
      </section>
      ${mesure ? `<div class="encart"><span>Espacement mesuré sur tes phrases : ${mesure.approche} entre les lettres, ${mesure.espace} entre les mots.</span>
        <div><button class="btn" id="mesure">Utiliser ces valeurs</button></div></div>` : ""}
      <section>
        <p class="etiquette">Réglages</p>
        <div class="reglage"><label for="taille">Taille du texte d'essai</label><output id="o-taille">${tailleEssai}</output>
          <input id="taille" type="range" min="16" max="90" value="${tailleEssai}"></div>
        ${aDessins ? curseur("normaliser") : ""}
        ${curseur("approche")}${curseur("espace")}
        ${aPhotos ? curseur("graisse") : ""}${aDessins ? curseur("stylo") : ""}${curseur("lissage")}
        <label class="bascule" for="r-secours"><span>Remplacer les caractères manquants<br><span class="aide">Une majuscule pas encore faite prend sa minuscule, une lettre accentuée prend la lettre sans accent.</span></span>
          <input type="checkbox" id="r-secours" ${p.secours !== false ? "checked" : ""}></label>
        <label class="bascule" for="r-crenage"><span>Crénage automatique<br><span class="aide">Rapproche les paires comme To, Fa, Le.</span></span>
          <input type="checkbox" id="r-crenage" ${p.crenage ? "checked" : ""}></label>
        <details><summary>Réglages avancés</summary><div>
          ${aPhotos ? curseur("seuil") + curseur("poussieres") : ""}${curseur("pas")}${curseur("force")}${curseur("cible")}${curseur("maxi")}
          <button class="btn" id="defaut">Rétablir les réglages d'origine</button>
        </div></details>
      </section>
      <section>
        <details><summary>Utiliser la police</summary><div>
          <p class="aide"><strong>Sur ordinateur (Windows ou Mac)</strong> : envoie-toi le fichier .ttf, puis clic droit → Installer (Windows) ou double-clic → Installer (Mac). Dans Word, active le crénage : Police → Paramètres avancés → Crénage pour les polices.</p>
          <p class="aide"><strong>Sur Android</strong> : Android ne permet pas d'installer une police pour tout le téléphone, mais beaucoup d'applis l'acceptent, comme Canva ou les éditeurs de photos et de documents.</p>
        </div></details>
      </section>`,
    pied: `<button class="btn principal" id="exporter">${icone("telecharger", 20)} Exporter la police</button>`,
  });
  const essai = $("#essai"), lecture = $("#lecture");
  // Mode lecture : chaque caractère est un <span> qu'on peut toucher. Mode texte : on modifie la phrase.
  const remplirLecture = () => {
    lecture.innerHTML = texteEssai.split("\n").map(l => [...l].map(x => x === " " ? " " : `<span class="l">${esc(x)}</span>`).join("")).join("<br>");
  };
  remplirLecture();
  lecture.onclick = e => { const l = e.target.closest(".l"); if (l) choisirLettre(c, l.textContent); };
  $("#modifier-texte").onclick = () => {
    const edition = essai.hidden;                       // on bascule d'un mode à l'autre
    essai.hidden = !edition; lecture.hidden = edition; $("#astuce").hidden = edition;
    $("#modifier-texte").innerHTML = edition ? `${icone("coche", 16)} OK` : `${icone("stylo", 16)} Texte`;
    if (edition) essai.focus(); else remplirLecture();
  };
  essai.oninput = () => { texteEssai = essai.value; };
  essai.style.fontSize = lecture.style.fontSize = tailleEssai + "px";
  $("#taille").oninput = e => { tailleEssai = +e.target.value; essai.style.fontSize = lecture.style.fontSize = tailleEssai + "px"; $("#o-taille").textContent = tailleEssai; };

  let minuteur = null;
  const recalculer = () => {
    $("#etat").textContent = "Calcul de la police…";
    clearTimeout(minuteur);
    minuteur = setTimeout(async () => {
      const t0 = performance.now(), res = await calculer(c);
      if (!document.body.contains(essai)) return;
      essai.style.fontFamily = lecture.style.fontFamily = `'${res.famille}', var(--ui)`;
      const rempl = res.remplaces.length, manque = res.manquants.length - rempl;
      $("#etat").textContent = `${M.CARS.length - res.manquants.length} caractères faits`
        + (rempl ? ` · ${rempl} remplacé${rempl > 1 ? "s" : ""}` : "") + (manque ? ` · ${manque} manquant${manque > 1 ? "s" : ""}` : "")
        + ` · ${Math.round(res.ttf.length / 1024)} Ko`;
      void t0;
    }, 220);
  };
  Object.keys(REGLAGES).forEach(id => {
    const el = $("#r-" + id); if (!el) return;
    el.oninput = () => { p[id] = parseFloat(el.value); $("#o-" + id).textContent = REGLAGES[id][4](p[id]); modifie(c); recalculer(); };
  });
  $("#r-crenage").onchange = e => { p.crenage = e.target.checked; modifie(c); recalculer(); };
  $("#r-secours").onchange = e => { p.secours = e.target.checked; modifie(c); recalculer(); };
  $("#defaut").onclick = () => { Object.assign(p, M.DEFAUT); modifie(c); vueApercu(c); };
  if (mesure) $("#mesure").onclick = () => { p.approche = mesure.approche; p.espace = mesure.espace; modifie(c); vueApercu(c); toast("Espacement mis à jour"); };
  $("#exporter").onclick = async () => {
    const res = await calculer(c);
    if (res.manquants.length === M.CARS.length) { toast("Il n'y a encore aucun caractère."); return; }
    telecharger(res.ttf, `${f.nom}.ttf`, "font/ttf");
    toast("Police enregistrée dans Téléchargements");
  };
  recalculer();
}

/** Une lettre touchée dans l'aperçu : la redessiner, la retoucher, ou annuler sa retouche. */
async function choisirLettre(c, ch) {
  const i = M.CARS.indexOf(ch); if (i < 0) { toast(`« ${ch} » ne fait pas partie de la grille.`); return; }
  const f = c.police, res = await calculer(c);
  const remplace = res.remplaces.includes(ch), manque = res.manquants.includes(ch) && !remplace;
  const etat = manque ? "Pas encore fait" : remplace ? "Remplacé provisoirement (pas encore fait)"
    : f.retouches[ch] ? "Retouché à la main" : (f.dessins[ch] || []).length ? "Dessiné à l'écran" : "Vient de la photo";
  const d = document.createElement("dialog");
  d.innerHTML = `<form method="dialog" class="feuille-lettre">
      <div class="lettre-choisie"><span style="font-family:'${res.famille}', var(--ui)">${esc(ch)}</span><div><h2>« ${esc(ch)} »</h2><p class="aide">${etat}</p></div></div>
      ${!manque && !remplace ? `<button class="btn plein principal" value="retoucher">${icone("stylo", 18)} Retoucher les points</button>` : ""}
      <button class="btn plein ${manque || remplace ? "principal" : ""}" value="dessiner">${manque || remplace ? "Dessiner" : "Redessiner"}</button>
      ${f.retouches[ch] ? `<button class="btn plein danger" value="annuler">Annuler la retouche</button>` : ""}
      <button class="btn plein discret" value="">Fermer</button></form>`;
  document.body.append(d); d.showModal();
  d.addEventListener("close", () => {
    const v = d.returnValue; d.remove();
    if (v === "retoucher") aller(`#/p/${f.id}/retouche/${i}`);
    if (v === "dessiner") aller(`#/p/${f.id}/dessin/${i}`);
    if (v === "annuler") { delete f.retouches[ch]; modifie(c); toast("Retouche annulée"); vueApercu(c); }
  });
}

// ---------- Routeur ----------
async function routeur() {
  const morceaux = (location.hash.slice(1) || "/").split("/").filter(Boolean);
  if (!morceaux.length) return vueAccueil();
  if (morceaux[0] === "p") {
    const c = await ouvrirPolice(morceaux[1]);
    if (!c) return aller("#/", true);
    const [, , ecran, n] = morceaux;
    if (!ecran) return vueProjet(c);
    if (ecran === "photo" && +n >= 0 && +n <= 2) return vuePhoto(c, +n);
    if (ecran === "dessin" && +n >= 0 && +n < M.CARS.length) return vueDessin(c, +n);
    if (ecran === "apercu") return vueApercu(c);
    if (ecran === "retouche" && +n >= 0 && +n < M.CARS.length) return Retouche.vue(c, +n);
  }
  aller("#/", true);
}

// Démarrage : historique numéroté, puis premier affichage
if (!history.state) history.replaceState({ n: 0 }, "", location.href);
routeur();

// Écran de lancement : le geste se dessine (~0,9 s), puis s'efface en fondu.
// On attend aussi les polices (Manrope) pour éviter un saut de texte à l'apparition.
(() => {
  const l = document.getElementById("lancement"); if (!l) return;
  const court = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const attente = new Promise(r => setTimeout(r, court ? 300 : 1000));
  const polices = Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]);
  Promise.all([attente, polices]).then(() => { l.classList.add("fini"); setTimeout(() => l.remove(), 400); });
})();

// Hors ligne : le « service worker » garde une copie de l'appli sur le téléphone
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js");
