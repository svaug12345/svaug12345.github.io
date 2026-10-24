/* =============================================================================
   Paraphe — scanner les feuilles avec la caméra, à la suite.
   -----------------------------------------------------------------------------
   Le viseur montre la caméra en direct. Plusieurs fois par seconde, on cherche
   les 4 carrés noirs des coins sur une petite copie de l'image (Moteur.viser) :
     - on dessine par-dessus les carrés trouvés, et le contour de la feuille ;
     - vert = tout est bon ; orange = il manque quelque chose (on dit quoi).
   Quand la feuille est bien cadrée et que l'image ne bouge plus pendant ~1 s,
   la photo se prend toute seule (en pleine résolution), la page est redressée
   et reconnue (page 1, page 2, feuille de reprise). On attend ensuite que la
   feuille sorte du cadre avant de prendre la suivante : on peut enchaîner.
   « Terminé » envoie toutes les pages à l'écran d'import, qui les enregistre.
   ========================================================================== */
"use strict";

async function vueScanner(c) {
  const f = c.police;
  rendre({
    titre: "Scanner", retour: `#/p/${f.id}`,
    contenu: `<div class="viseur" id="viseur">
        <video id="video" playsinline muted></video><canvas id="calque"></canvas>
        <p class="etat-viseur" id="etat-viseur">Démarrage de la caméra…</p>
      </div>
      <p class="aide">Feuille à plat et bien éclairée, les 4 carrés noirs dans l'image. La photo se prend toute seule, puis passe à la feuille suivante.</p>
      <div class="prises" id="prises"></div>`,
    pied: `<button class="btn discret" id="declencher" aria-label="Prendre la photo maintenant">${icone("photo", 20)}</button>
      <button class="btn principal" id="fini" disabled>Terminé</button>`,
  });
  const video = $("#video"), calque = $("#calque"), etat = $("#etat-viseur"), prises = [];
  let flux = null, minuteur = null, fini = false;

  // En quittant l'écran (retour, Terminé…) : on éteint la caméra.
  nettoyage = () => { fini = true; clearTimeout(minuteur); if (flux) flux.getTracks().forEach(t => t.stop()); };

  try {
    // Caméra arrière, la meilleure définition possible : plus de pixels = cases plus nettes.
    flux = await navigator.mediaDevices.getUserMedia({ audio: false,
      video: { facingMode: "environment", width: { ideal: 3840 }, height: { ideal: 2160 } } });
  } catch (e) {
    etat.textContent = "Caméra indisponible";
    $("#viseur").insertAdjacentHTML("afterend", `<p class="message erreur">La caméra n'a pas pu démarrer (autorisation refusée ?). Tu peux importer des photos à la place.
      <button class="btn petit" id="vers-import">Importer des photos</button></p>`);
    $("#vers-import").onclick = () => aller(`#/p/${f.id}/import`, true);
    return;
  }
  if (fini) { flux.getTracks().forEach(t => t.stop()); return; }      // écran quitté pendant l'autorisation
  video.srcObject = flux; await video.play();

  // --- Suivi d'une image à l'autre ---
  let precedents = null, stable = 0, attendreSortie = false, absent = 0;
  const STABLE = 5;            // nombre d'analyses de suite sans bouger avant de déclencher (~1 s)

  /** Aire d'un quadrilatère (formule du lacet) et longueur d'un côté. */
  const aire = q => Math.abs(q.reduce((s, [x, y], i) => { const [x2, y2] = q[(i + 1) % 4]; return s + x * y2 - x2 * y; }, 0)) / 2;
  const cote = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  function analyser() {
    if (fini) return;
    const W = video.videoWidth, H = video.videoHeight;
    if (!W) { minuteur = setTimeout(analyser, 200); return; }
    const t0 = performance.now(), v = M.viser(video, W, H);
    let message, ok = false;
    if (!v.coins) {
      message = v.nb ? `${v.nb} carré${v.nb > 1 ? "s" : ""} sur 4` : "Cherche les 4 carrés noirs";
      stable = 0; precedents = null;
      if (++absent >= 3) attendreSortie = false;          // la feuille est sortie : prêt pour la suivante
    } else {
      absent = 0;
      // Les coins arrivent dans l'ordre haut-gauche, haut-droit, bas-droit, bas-gauche.
      const q = v.coins, part = aire(q) / (W * H);
      const ratioH = Math.min(cote(q[0], q[1]), cote(q[3], q[2])) / Math.max(cote(q[0], q[1]), cote(q[3], q[2]));
      const ratioV = Math.min(cote(q[0], q[3]), cote(q[1], q[2])) / Math.max(cote(q[0], q[3]), cote(q[1], q[2]));
      const bouge = precedents ? Math.max(...q.map((p, i) => cote(p, precedents[i]))) / Math.max(W, H) : 1;
      precedents = q;
      if (attendreSortie) message = "Photo prise ✓ Feuille suivante";
      else if (part < 0.28) message = "Approche-toi un peu";
      else if (ratioH < 0.82 || ratioV < 0.82) message = "Tiens le téléphone bien à plat au-dessus";
      else if (bouge > 0.012) { message = "Ne bouge plus…"; stable = 0; ok = true; }
      else { stable++; ok = true; message = "Ne bouge plus…"; }
      if (ok && !attendreSortie && stable >= STABLE) { stable = 0; capturer(); }
    }
    dessinerCalque(v.coins, ok && !attendreSortie, attendreSortie);
    etat.textContent = message; etat.classList.toggle("ok", ok || attendreSortie);
    // On s'adapte à la vitesse du téléphone : au moins 120 ms entre deux analyses.
    minuteur = setTimeout(analyser, Math.max(120, 2 * (performance.now() - t0)));
  }

  /** Dessine les repères trouvés par-dessus la vidéo (mêmes proportions que la vidéo affichée). */
  function dessinerCalque(coins, bon, pris) {
    // La vidéo est affichée « contain » : on calcule où tombe vraiment l'image dans son cadre,
    // et on pose le calque exactement dessus.
    const r = window.devicePixelRatio || 1, cw = video.clientWidth, ch = video.clientHeight;
    const s = Math.min(cw / video.videoWidth, ch / video.videoHeight), w = video.videoWidth * s, h = video.videoHeight * s;
    Object.assign(calque.style, { left: video.offsetLeft + (cw - w) / 2 + "px", top: video.offsetTop + (ch - h) / 2 + "px", width: w + "px", height: h + "px" });
    calque.width = Math.round(w * r); calque.height = Math.round(h * r);
    const cx = calque.getContext("2d"), k = calque.width / video.videoWidth;
    cx.clearRect(0, 0, calque.width, calque.height);
    if (!coins) return;
    const couleur = pris || bon ? "#3cc2b8" : "#f0a33a";
    cx.lineWidth = 3 * r; cx.strokeStyle = couleur; cx.fillStyle = couleur + "55";
    cx.beginPath(); coins.forEach(([x, y], i) => i ? cx.lineTo(x * k, y * k) : cx.moveTo(x * k, y * k)); cx.closePath();
    cx.fill(); cx.stroke();
    cx.fillStyle = couleur;
    for (const [x, y] of coins) { cx.beginPath(); cx.arc(x * k, y * k, 9 * r, 0, 7); cx.fill(); }
  }

  /** Photo en pleine résolution → page redressée et reconnue. */
  async function capturer() {
    attendreSortie = true;
    const cv = document.createElement("canvas"); cv.width = video.videoWidth; cv.height = video.videoHeight;
    cv.getContext("2d").drawImage(video, 0, 0);
    $("#viseur").classList.add("flash"); setTimeout(() => $("#viseur")?.classList.remove("flash"), 250);
    if (navigator.vibrate) navigator.vibrate(40);
    await new Promise(r => setTimeout(r, 20));
    const page = M.redresser(M.enGris(cv, cv.width, cv.height));
    if (page.erreur) { attendreSortie = false; toast("Photo ratée, on recommence"); return; }
    const id = M.identifierPage(page);
    // Même feuille reprise deux fois : on garde la dernière.
    const nom = id.reprise ? `Reprise n° ${id.reprise}` : id.phrases ? "Phrases (ignorée)" : id.num === 4 ? "Ancienne page bonus" : id.num ? `Page ${id.num}` : "Feuille inconnue";
    const deja = prises.findIndex(x => x.nom === nom && nom !== "Feuille inconnue");
    if (deja >= 0) prises.splice(deja, 1);
    prises.push({ page, id, nom });
    afficherPrises();
  }

  function afficherPrises() {
    $("#prises").innerHTML = prises.map(x => `<span class="prise ${x.id.num || x.id.reprise ? "ok" : ""}">${icone(x.id.num || x.id.reprise ? "coche" : "page", 16)} ${esc(x.nom)}</span>`).join("");
    $("#fini").disabled = !prises.length;
    $("#fini").textContent = prises.length ? `Terminé (${prises.length})` : "Terminé";
  }

  $("#declencher").onclick = () => capturer();
  $("#fini").onclick = () => { pagesEnAttente = prises.map(({ page, id }) => ({ page, id })); aller(`#/p/${f.id}/import`, true); };
  analyser();
}
