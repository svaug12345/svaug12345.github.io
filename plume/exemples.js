/* =============================================================================
   Plume — ordre de dessin et exemples de mots.
   -----------------------------------------------------------------------------
   À l'écran, on ne dessine pas dans l'ordre de la grille papier : on commence
   par les MINUSCULES (ce sont elles qui remplissent 95 % d'un texte), puis les
   majuscules, les chiffres, les accents et les signes.
   Pendant le dessin, on montre des mots et des phrases écrits uniquement avec
   les caractères déjà faits, et la lettre qu'on vient de dessiner ressort en
   couleur.
   ========================================================================== */
"use strict";

const Exemples = (() => {
  // Groupes, dans l'ordre où on les dessine. Ensemble = exactement les 126 caractères de la grille.
  const GROUPES = [
    { nom: "Minuscules", cars: "abcdefghijklmnopqrstuvwxyz" },
    { nom: "Majuscules", cars: "ABCDEFGHIJKLMNOPQRSTUVWXYZ" },
    { nom: "Chiffres", cars: "0123456789" },
    { nom: "Accents", cars: "éèêàâùûôîïëçœüäöæÉÈÊÀÂÙÛÔÎÏËÇŒÜÄÖÆ" },
    { nom: "Signes", cars: ".,'!?-;:\"()«»&@€$%/+=*#<>[]_°~" },
  ].map(g => ({ ...g, cars: [...g.cars] }));
  const ORDRE = GROUPES.flatMap(g => g.cars);
  const groupeDe = ch => GROUPES.find(g => g.cars.includes(ch));

  // Mots courants, variés pour couvrir toutes les lettres et les accents.
  const MOTS = `a à au le la les un une de du et en il elle on nous vous ils mon ma mes ton ta son sa
    bac bec face fade cab dada abbé ami amie bal ballon banc bateau bébé bien blanc bleu bois bon bonbon bus
    café camion canard car cartable chat chaton chaud chien ciel citron classe cochon coq corde cube
    dame danse dent dessin dino dodo doux dragon eau école élève été étoile été éléphant
    fée fête feu fille fleur foot forêt fraise frère fromage fruit fusée
    garçon gâteau glace gomme gros guitare hibou hiver hôtel houx huit
    idée île image jardin jaune jeu joie jouer judo jupe jus kayak kiwi koala
    lac lait lapin leçon lion lit livre loup lune lundi maison maman mardi mer mère merci miel
    moto mouton mur mûr nez nid noir noix nuage nuit œuf œil oiseau ombre ours où papa
    page pain papillon parc pâte père petit pied pirate pizza plage pluie plume poire pomme pont poule
    puzzle quai quatre queue quiz radis renard robe roi rose rouge rue sable sac salut sapin
    savon sel singe sœur soleil soupe sucre sûr tapis tarte tasse tigre tôt train tram très tulipe
    usine vache vélo vent vert vide ville violon voilà vole wagon xylophone yaourt yoyo zèbre zéro zoo
    ça déjà là après bientôt château cœur dîner flûte goût maïs naïf noël nœud boîte âne pâques
    wapiti ski taxi jeux kiwis fax box zut juste gentil grand jolie rigolo super`.split(/\s+/).filter(Boolean);

  // Phrases complètes : elles n'apparaissent que si TOUS leurs caractères sont faits.
  const PHRASES = [
    // tout en minuscules, sans ponctuation : disponibles dès que les minuscules sont faites
    "le chat dort", "un petit lapin blanc", "la lune et le soleil", "mon ami joue au ballon",
    "il fait beau", "une fleur rose", "le roi mange une pomme", "quatre kiwis verts", "le vent souffle fort",
    "je bois un jus de fruit", "le hibou vole la nuit", "un gros camion jaune", "la plage et le sable",
    "une fusée dans le ciel", "le zèbre est au zoo", "un yaourt au miel", "le wagon du train",
    "six kayaks sur le lac", "un puzzle rigolo", "douze pizzas", "papa fait une tarte", "mon frère a un vélo", "elle lit un livre",
    "Le chat dort.", "Bonjour, ça va ?", "Quelle belle journée !", "Il fait beau ce matin.",
    "On joue au ballon ?", "J'aime les crêpes au sucre.", "Le petit chien court vite.",
    "Où est mon livre ?", "Voilà, c'est fini !", "Nous partons en vacances.",
    "La fourmi travaille dur.", "Un éléphant mange une pomme.", "Mon frère a huit ans.",
    "Il y a 12 œufs.", "Rendez-vous à 14 h.", "Le 14 juillet 2026.", "Écris (vite) ton nom !",
    "« Bravo », dit-elle.", "Prix : 5 € ; total : 20 €.", "Il est 8 h 30.", "Pommes + poires = fruits",
    "100 % fait main", "Écris-moi : tom@plume.fr", "Question n° 3 : #2", "Il fait 25° au soleil.",
    "Si a < b, alors b > a.", "Une [note] et (une remarque).", "mon_fichier_final", "Noël approche.",
    "Le maïs est jaune.", "Ma sœur a un cœur en chocolat.", "Le garçon apprend sa leçon.", "Ça y est !",
    "Un dîner sur l'île.", "La flûte est sûre.", "Un gâteau au château.", "L'hôtel est tout près.",
    "Ève et Zoé jouent.", "À demain !", "Être ou ne pas être.", "Arrivés ex æquo !", "Il coûte ~10 $.",
    "Une * étoile *", "Tom & Gaby", "1/2 = 0,5", "Ôte ton chapeau.", "Ûn drôle de mot.",
    "Ïle aux Ëlfes ?", "Ünë Äventure à Öslo", "ÆTHER", "ÇA ROULE !", "ŒUF À LA COQUE",
  ];
  // Comment montrer un signe avec deux mots x et y
  const SIGNES = {
    ".": (x, y) => `${x}. ${y}.`, ",": (x, y) => `${x}, ${y}`, "'": (x, y) => `l'${x}`, "!": x => `${x} !`,
    "?": x => `${x} ?`, ";": (x, y) => `${x} ; ${y}`, ":": (x, y) => `${x} : ${y}`, '"': x => `"${x}"`,
    "(": x => `(${x})`, ")": x => `(${x})`, "[": x => `[${x}]`, "]": x => `[${x}]`, "«": x => `« ${x} »`, "»": x => `« ${x} »`,
    "-": (x, y) => `${x}-${y}`, "_": (x, y) => `${x}_${y}`, "&": (x, y) => `${x} & ${y}`, "@": (x, y) => `${x}@${y}`,
    "/": (x, y) => `${x}/${y}`, "*": x => `*${x}*`, "#": x => `#${x}`, "~": x => `~${x}`,
  };
  const NOMBRES = ["2026", "14", "100", "365", "1789", "42", "12", "7", "2000", "31", "25", "8", "0", "999", "64", "53"];

  /** Petit générateur pseudo-aléatoire « graine » : mêmes exemples pour une même lettre. */
  function melange(liste, graine) {
    let s = graine >>> 0; const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    return liste.map(v => [r(), v]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  }

  /** Exemples écrits uniquement avec les caractères disponibles, en mettant en avant `ch`.
      Renvoie { phrase, mots } (chaînes). */
  function pour(dispo, ch) {
    const ok = s => [...s].every(x => x === " " || dispo.has(x));
    const graine = ch.codePointAt(0) * 7919 + dispo.size;
    // candidats : le mot tel quel, avec une majuscule, et en capitales
    const cands = new Set();
    for (const m of MOTS) { cands.add(m); cands.add(m[0].toUpperCase() + m.slice(1)); cands.add(m.toUpperCase()); }
    for (const n of NOMBRES) cands.add(n);
    let mots = [...cands].filter(w => w.includes(ch) && ok(w));
    // une seule forme par mot (« quiz », « Quiz » ou « QUIZ ») : celle qui montre le mieux la lettre
    const parMot = new Map();
    for (const w of melange(mots, graine)) { const k = w.toLowerCase(); if (!parMot.has(k)) parMot.set(k, w); }
    mots = [...parMot.values()];
    // les mots les plus longs montrent mieux les liaisons entre lettres
    mots = melange(mots, graine).sort((a, b) => new Set(b).size - new Set(a).size).slice(0, 18);
    mots = melange(mots, graine + 1).slice(0, 7);

    // Pas assez de mots (début, ou caractère rare) : petites combinaisons avec les lettres déjà faites
    if (mots.length < 4) {
      const autres = melange([...dispo].filter(x => x !== ch && /\p{L}|\p{N}/u.test(x)), graine).slice(0, 6);
      const lettre = /\p{L}|\p{N}/u.test(ch);
      let combis;
      if (lettre) combis = [ch + ch, ...autres.flatMap(o => [ch + o, o + ch + o])];
      else {
        // un signe : on le place comme on l'écrit, autour de vrais mots déjà faisables
        const vrais = melange(MOTS.filter(m => m.length >= 3 && ok(m)), graine).slice(0, 6);
        const [a = "a", b = "b", c2 = "c"] = vrais;
        const modele = SIGNES[ch] || ((x, y) => `${x}${ch}${y}`);
        combis = [modele(a, b), modele(b, c2), modele(c2, a)];
      }
      mots = [...new Set([...mots, ...combis])].slice(0, 7);
      if (!mots.length) mots = [ch];
    }
    const phrases = melange(PHRASES.filter(p => p.includes(ch) && ok(p)), graine);
    return { phrase: phrases[0] || "", mots: mots.join("  ") };
  }

  return { GROUPES, ORDRE, groupeDe, pour };
})();
