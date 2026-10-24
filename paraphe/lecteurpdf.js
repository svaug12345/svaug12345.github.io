/* =============================================================================
   Paraphe — lecture d'un PDF scanné, sans bibliothèque (marche hors connexion).
   -----------------------------------------------------------------------------
   Un scanner (ou une appli de numérisation) range chaque page dans le PDF sous
   forme d'UNE grande image. On n'a donc pas besoin d'« afficher » le PDF : il
   suffit de retrouver ces images, page par page, et de les décoder.

   Structure d'un PDF (simplifiée) :
     12 0 obj  << /Type /Page /Resources << /XObject << /Im0 15 0 R >> >> >>  endobj
     15 0 obj  << /Type /XObject /Subtype /Image /Width 2544 /Height 3504
                  /Filter /DCTDecode /Length 777000 >>
               stream …octets de l'image… endstream  endobj
   « 15 0 R » est une référence vers l'objet n° 15.
   Encodages gérés : /DCTDecode (c'est un JPEG : le navigateur sait le lire) et
   /FlateDecode (pixels compressés comme dans un .zip, avec ou sans « prédicteur » PNG).
   Les PDF modernes peuvent aussi ranger des objets dans des « flux d'objets »
   compressés (/ObjStm) : on les ouvre aussi.
   ========================================================================== */
"use strict";

const LecteurPDF = (() => {
  /** Octets → texte « latin1 » : 1 caractère par octet, pour chercher avec des expressions régulières. */
  function enTexte(o) {
    let s = ""; for (let i = 0; i < o.length; i += 0x8000) s += String.fromCharCode.apply(null, o.subarray(i, i + 0x8000));
    return s;
  }

  /** Décompresse des données « Flate » (zlib) avec l'outil intégré au navigateur. */
  async function inflate(octets) {
    const flux = new Blob([octets]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(flux).arrayBuffer());
  }

  /** ASCII85 : 5 caractères imprimables codent 4 octets (base 85) ; « z » = 4 zéros ; « ~> » = fin. */
  function ascii85(o) {
    const t = enTexte(o).replace(/\s/g, ""), fin = t.indexOf("~>"), s = (t.startsWith("<~") ? t.slice(2) : t).slice(0, fin < 0 ? undefined : fin - (t.startsWith("<~") ? 2 : 0));
    const sortie = []; let groupe = [];
    for (const ch of s) {
      if (ch === "z" && !groupe.length) { sortie.push(0, 0, 0, 0); continue; }
      groupe.push(ch.charCodeAt(0) - 33);
      if (groupe.length === 5) { let v = 0; for (const g of groupe) v = v * 85 + g; sortie.push(v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); groupe = []; }
    }
    if (groupe.length) {                         // dernier groupe incomplet : on complète avec « u » (84)
      const n = groupe.length; while (groupe.length < 5) groupe.push(84);
      let v = 0; for (const g of groupe) v = v * 85 + g;
      sortie.push(...[v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].slice(0, n - 1));
    }
    return Uint8Array.from(sortie);
  }
  /** ASCIIHex : chaque octet écrit en 2 chiffres hexadécimaux ; « > » = fin. */
  function asciiHex(o) {
    const t = enTexte(o).replace(/[^0-9a-fA-F>]/g, ""), h = t.split(">")[0], s = h.length % 2 ? h + "0" : h;
    return Uint8Array.from(s.match(/../g) || [], x => parseInt(x, 16));
  }

  // Petits outils pour lire un dictionnaire « << /Cle valeur … >> » écrit en texte
  // « /Cle 12 » → 12 ; mais « /Cle 12 0 R » est une RÉFÉRENCE vers l'objet 12 → null
  const nombre = (dict, cle) => { const m = dict.match(new RegExp("/" + cle + "\\s+(-?\\d+)(\\s+\\d+\\s+R\\b)?")); return m && !m[2] ? +m[1] : null; };
  const ref = (dict, cle) => { const m = dict.match(new RegExp("/" + cle + "\\s+(\\d+)\\s+\\d+\\s+R")); return m ? +m[1] : null; };
  const nom = (dict, cle) => { const m = dict.match(new RegExp("/" + cle + "\\s*/([A-Za-z0-9]+)")); return m ? m[1] : null; };
  /** Valeur « /Cle << … >> » (dictionnaire en ligne, en tenant compte des imbrications). */
  function sousDict(dict, cle) {
    const i = dict.search(new RegExp("/" + cle + "\\s*<<")); if (i < 0) return null;
    let k = dict.indexOf("<<", i), prof = 0;
    for (let j = k; j < dict.length - 1; j++) {
      if (dict[j] === "<" && dict[j + 1] === "<") { prof++; j++; }
      else if (dict[j] === ">" && dict[j + 1] === ">") { prof--; j++; if (!prof) return dict.slice(k, j + 1); }
    }
    return null;
  }
  /** Liste des filtres : « /Filter /DCTDecode » ou « /Filter [/FlateDecode /DCTDecode] ». */
  function filtres(dict) {
    const m = dict.match(/\/Filter\s*(\[[^\]]*\]|\/[A-Za-z0-9]+)/); if (!m) return [];
    return (m[1].match(/\/[A-Za-z0-9]+/g) || []).map(x => x.slice(1));
  }

  /** Lit tous les objets « n 0 obj … endobj » : leur dictionnaire et, s'il y en a, leur flux d'octets. */
  async function objets(octets) {
    const txt = enTexte(octets), table = new Map(), re = /(\d+)\s+\d+\s+obj\b/g;
    let m;
    while ((m = re.exec(txt))) {
      const n = +m[1], debut = m.index + m[0].length;
      const fin = txt.indexOf("endobj", debut), st = txt.indexOf("stream", debut);
      if (st >= 0 && (fin < 0 || st < fin)) {
        // flux : les octets commencent après « stream » + fin de ligne
        let d = st + 6; if (txt[d] === "\r") d++; if (txt[d] === "\n") d++;
        const dict = txt.slice(debut, st);
        let lg = nombre(dict, "Length");
        if (lg === null || d + lg > octets.length || !/^\s*endstream/.test(txt.slice(d + lg, d + lg + 20))) {
          lg = txt.indexOf("endstream", d) - d;                     // longueur indirecte ou fausse : on cherche la fin
          while (lg > 0 && (txt[d + lg - 1] === "\n" || txt[d + lg - 1] === "\r")) lg--;
        }
        table.set(n, { dict, flux: octets.subarray(d, d + lg) });
        re.lastIndex = d + lg;
      } else table.set(n, { dict: txt.slice(debut, fin < 0 ? undefined : fin) });
    }
    // Flux d'objets compressés : « N premiers nombres = paires (n° d'objet, position) »
    for (const o of [...table.values()]) {
      if (!/\/Type\s*\/ObjStm/.test(o.dict) || !o.flux) continue;
      try {
        const t = enTexte(filtres(o.dict).includes("FlateDecode") ? await inflate(o.flux) : o.flux);
        const N = nombre(o.dict, "N"), premier = nombre(o.dict, "First");
        const nums = t.slice(0, premier).trim().split(/\s+/).map(Number);
        for (let k = 0; k < N; k++) {
          const num = nums[2 * k], pos = premier + nums[2 * k + 1], fin = k + 1 < N ? premier + nums[2 * k + 3] : t.length;
          if (!table.has(num)) table.set(num, { dict: t.slice(pos, fin) });
        }
      } catch (e) { /* flux illisible : on continue sans */ }
    }
    return table;
  }

  /** Les pages dans l'ordre : on suit l'arbre /Pages → /Kids depuis le catalogue. */
  function pagesDansLOrdre(table) {
    const pages = [], vus = new Set();
    const visiter = n => {
      if (vus.has(n) || !table.has(n)) return; vus.add(n);
      const d = table.get(n).dict;
      if (/\/Type\s*\/Pages\b/.test(d)) {
        const kids = d.match(/\/Kids\s*\[([^\]]*)\]/);
        if (kids) for (const r of kids[1].matchAll(/(\d+)\s+\d+\s+R/g)) visiter(+r[1]);
      } else if (/\/Type\s*\/Page\b/.test(d)) pages.push(n);
    };
    const catalogue = [...table].find(([, o]) => /\/Type\s*\/Catalog\b/.test(o.dict));
    if (catalogue) visiter(ref(catalogue[1].dict, "Pages"));
    if (!pages.length)                                            // pas d'arbre lisible : ordre des numéros
      for (const [n, o] of [...table].sort((a, b) => a[0] - b[0])) if (/\/Type\s*\/Page\b/.test(o.dict)) pages.push(n);
    return pages;
  }

  /** L'image principale d'une page (la plus grande s'il y en a plusieurs). */
  function imageDeLaPage(table, n) {
    let d = table.get(n).dict, res = sousDict(d, "Resources");
    // Ressources ailleurs : référence, ou héritées du parent
    for (let k = 0; !res && k < 5; k++) {
      const r = ref(d, "Resources"); if (r && table.has(r)) { res = table.get(r).dict; break; }
      const parent = ref(d, "Parent"); if (!parent || !table.has(parent)) break; d = table.get(parent).dict; res = sousDict(d, "Resources");
    }
    if (!res) return null;
    let xo = sousDict(res, "XObject");
    if (!xo) { const r = ref(res, "XObject"); if (r && table.has(r)) xo = table.get(r).dict; }
    if (!xo) return null;
    let meilleure = null;
    for (const r of xo.matchAll(/\/[^\s/]+\s+(\d+)\s+\d+\s+R/g)) {
      const o = table.get(+r[1]);
      if (!o || !o.flux || !/\/Subtype\s*\/Image/.test(o.dict)) continue;
      const surface = (nombre(o.dict, "Width") || 0) * (nombre(o.dict, "Height") || 0);
      if (!meilleure || surface > meilleure.surface) meilleure = { ...o, surface };
    }
    return meilleure;
  }

  /** Nombre de composantes de couleur (1 = gris, 3 = couleur, 4 = CMJN). */
  function composantes(table, dict) {
    const cs = nom(dict, "ColorSpace");
    if (cs) return { DeviceGray: 1, CalGray: 1, DeviceRGB: 3, CalRGB: 3, DeviceCMYK: 4 }[cs] || null;
    const icc = dict.match(/\/ColorSpace\s*\[\s*\/ICCBased\s+(\d+)\s+\d+\s+R/);
    if (icc && table.has(+icc[1])) return nombre(table.get(+icc[1]).dict, "N");
    const r = ref(dict, "ColorSpace"); if (r && table.has(r)) return composantes(table, "/ColorSpace " + table.get(r).dict.trim());
    return null;
  }

  /** Retire le « prédicteur » PNG : chaque ligne commence par un octet qui dit comment
      elle a été encodée par rapport au pixel de gauche (a), du dessus (b) ou en diagonale (c). */
  function sansPredicteur(o, largeurLigne, bpp) {
    const lignes = Math.floor(o.length / (largeurLigne + 1)), sortie = new Uint8Array(lignes * largeurLigne);
    for (let y = 0; y < lignes; y++) {
      const type = o[y * (largeurLigne + 1)], src = y * (largeurLigne + 1) + 1, dst = y * largeurLigne;
      for (let x = 0; x < largeurLigne; x++) {
        const a = x >= bpp ? sortie[dst + x - bpp] : 0, b = y ? sortie[dst - largeurLigne + x] : 0, c = y && x >= bpp ? sortie[dst - largeurLigne + x - bpp] : 0;
        let p = o[src + x];
        if (type === 1) p += a; else if (type === 2) p += b; else if (type === 3) p += (a + b) >> 1;
        else if (type === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); p += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
        sortie[dst + x] = p & 255;
      }
    }
    return sortie;
  }

  /** Décode l'image d'une page → { source (dessinable sur un canvas), w, h } ou { erreur }. */
  async function decoder(table, img) {
    const d = img.dict, w = nombre(d, "Width"), h = nombre(d, "Height"), f = filtres(d);
    let octets = img.flux;
    for (let i = 0; i < f.length; i++) {
      if (f[i] === "DCTDecode") {                                 // un JPEG : le navigateur le décode
        const reduire = Math.max(w, h) > 3200 ? 3200 / Math.max(w, h) : 1;   // très grandes images : on réduit
        const bmp = await createImageBitmap(new Blob([octets], { type: "image/jpeg" }),
          reduire < 1 ? { resizeWidth: Math.round(w * reduire), resizeHeight: Math.round(h * reduire), resizeQuality: "high" } : {});
        return { source: bmp, w: bmp.width, h: bmp.height };
      }
      if (f[i] === "FlateDecode") { octets = await inflate(octets); continue; }
      if (f[i] === "ASCII85Decode") { octets = ascii85(octets); continue; }
      if (f[i] === "ASCIIHexDecode") { octets = asciiHex(octets); continue; }
      return { erreur: `compression « ${f[i]} » non prise en charge` };
    }
    // Pixels bruts (après Flate éventuel)
    const n = composantes(table, d), bits = nombre(d, "BitsPerComponent") || 8;
    if (!n || (bits !== 8 && bits !== 1) || (bits === 1 && n !== 1)) return { erreur: "format de couleur non pris en charge" };
    const params = sousDict(d, "DecodeParms") || "";
    const largeurLigne = Math.ceil(w * n * bits / 8);
    if ((nombre(params, "Predictor") || 1) >= 10) octets = sansPredicteur(octets, largeurLigne, Math.max(1, n * bits / 8));
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const cx = cv.getContext("2d"), im = cx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v;
      if (bits === 1) v = (octets[y * largeurLigne + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0;
      else {
        const k = y * largeurLigne + x * n;
        v = n === 1 ? octets[k] : n === 3 ? (octets[k] * 299 + octets[k + 1] * 587 + octets[k + 2] * 114) / 1000
          : 255 - Math.min(255, (octets[k] * 299 + octets[k + 1] * 587 + octets[k + 2] * 114) / 1000 + octets[k + 3]);   // CMJN approché
      }
      const p = 4 * (y * w + x); im.data[p] = im.data[p + 1] = im.data[p + 2] = v; im.data[p + 3] = 255;
    }
    cx.putImageData(im, 0, 0);
    return { source: cv, w, h };
  }

  /** Fichier PDF → liste des pages : { source, w, h } ou { erreur }. */
  async function lire(fichier) {
    const octets = new Uint8Array(await fichier.arrayBuffer());
    if (enTexte(octets.subarray(0, 8)).indexOf("%PDF") < 0) throw new Error("ce fichier n'est pas un PDF");
    const table = await objets(octets), pages = pagesDansLOrdre(table);
    if (!pages.length) throw new Error("aucune page trouvée dans ce PDF");
    const res = [];
    for (const n of pages) {
      const img = imageDeLaPage(table, n);
      if (!img) { res.push({ erreur: "pas d'image sur cette page (PDF non scanné ?)" }); continue; }
      try { res.push(await decoder(table, img)); } catch (e) { res.push({ erreur: "image illisible" }); }
    }
    return res;
  }

  return { lire };
})();
