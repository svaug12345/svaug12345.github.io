/* =============================================================================
   Plume — stockage local (IndexedDB), rien ne quitte le téléphone.
   -----------------------------------------------------------------------------
   Une « police » est un objet :
     { id, nom, cree, modifie, reglages, dessins: { "A": [traits…] }, pages: [Blob|null ×3] }
   - les dessins sont des listes de traits (points 0..1 + pression), très légers ;
   - les pages photographiées sont gardées DÉJÀ redressées, en JPEG gris (~300 Ko).
   IndexedDB sait stocker des objets et des Blob directement, contrairement à
   localStorage (texte seulement, ~5 Mo).
   ========================================================================== */
"use strict";

const Stockage = (() => {
  let base = null;

  /** Ouvre (ou crée) la base « plume » avec une table « polices ». */
  function ouvrir() {
    if (base) return base;
    base = new Promise((ok, ko) => {
      const r = indexedDB.open("plume", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("polices", { keyPath: "id" });
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
    });
    return base;
  }

  /** Petite aide : exécute une requête dans une transaction et renvoie une promesse. */
  async function requete(mode, action) {
    const db = await ouvrir();
    return new Promise((ok, ko) => {
      const t = db.transaction("polices", mode), r = action(t.objectStore("polices"));
      t.oncomplete = () => ok(r && r.result);
      t.onerror = () => ko(t.error);
      t.onabort = () => ko(t.error || new Error("Enregistrement annulé (espace plein ?)"));
    });
  }

  const lister = async () => (await requete("readonly", s => s.getAll())).sort((a, b) => b.modifie - a.modifie);
  const lire = id => requete("readonly", s => s.get(id));
  const ecrire = police => { police.modifie = Date.now(); return requete("readwrite", s => s.put(police)); };
  const supprimer = id => requete("readwrite", s => s.delete(id));

  function nouvelle(nom) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    return { id, nom, cree: Date.now(), modifie: Date.now(), reglages: { ...Moteur.DEFAUT }, dessins: {}, pages: [null, null, null] };
  }

  /** Page redressée (niveaux de gris) → JPEG compact pour le stockage. */
  function pageVersBlob(page) {
    const cv = document.createElement("canvas"); cv.width = page.w; cv.height = page.h;
    const img = new ImageData(page.w, page.h);
    for (let i = 0; i < page.gris.length; i++) { const v = page.gris[i]; img.data[4 * i] = img.data[4 * i + 1] = img.data[4 * i + 2] = v; img.data[4 * i + 3] = 255; }
    cv.getContext("2d").putImageData(img, 0, 0);
    return new Promise(ok => cv.toBlob(ok, "image/jpeg", 0.9));
  }

  /** JPEG stocké → page en niveaux de gris, à sa taille exacte. */
  async function blobVersPage(blob) {
    const bmp = await createImageBitmap(blob);
    return Moteur.enGris(bmp, bmp.width, bmp.height, 4000);
  }

  return { lister, lire, ecrire, supprimer, nouvelle, pageVersBlob, blobVersPage };
})();
