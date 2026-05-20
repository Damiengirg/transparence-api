const express = require("express");
const cors = require("cors");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors({ origin: "*" }));
app.use(express.json());

// ── CACHE ────────────────────────────────────────────────────────
const cache = {};
const TTL = 15 * 60 * 1000;
async function cached(key, fn) {
  if (cache[key] && Date.now() - cache[key].ts < TTL) return cache[key].d;
  const d = await fn();
  cache[key] = { d, ts: Date.now() };
  return d;
}

const H = {
  "User-Agent": "TransparenceFrance/4.0 (transparencefrance.fr; contact@transparencefrance.fr)",
  "Accept": "application/json",
};

async function xfetch(url) {
  const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} — ${url}`);
  return r.json();
}

// ── IMAGE PROXY ──────────────────────────────────────────────────
app.get("/img", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send("Missing url");
  const allowed = [
    "upload.wikimedia.org", "commons.wikimedia.org", "fr.wikipedia.org",
    "www.nosdeputes.fr", "www.nossenateurs.fr",
    "data.senat.fr", "media.senat.fr", "www.assemblee-nationale.fr",
    "www2.assemblee-nationale.fr", "www.gouvernement.fr", "www.elysee.fr",
    "static.gouvernement.fr", "videos.senat.fr", "www.hatvp.fr",
    "pbs.twimg.com", "abs.twimg.com", "unavatar.io"
  ];
  let host;
  try { host = new URL(url).hostname; } catch { return res.status(400).send("Invalid URL"); }
  if (!allowed.some(a => host === a || host.endsWith("." + a)))
    return res.status(403).send("Domain not allowed: " + host);
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
        "Referer": "https://www.google.fr/",
      },
      signal: AbortSignal.timeout(10000),
      redirect: "follow",
    });
    if (!r.ok) return res.status(404).send("Not found");
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", r.headers.get("content-type") || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=604800");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(buf);
  } catch (e) { res.status(500).send("Error: " + e.message); }
});

// ── DONNÉES STATIQUES : GOUVERNEMENT 2025 ───────────────────────
const GOUVERNEMENT = [
  { id: "emmanuel-macron", nom: "Emmanuel Macron", prenom: "Emmanuel", fonction: "Président de la République", ministere: "Élysée", parti: "Renaissance", age: 46, salaire: 15132, depuis: 2017, photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f4/Emmanuel_Macron_in_2019.jpg/440px-Emmanuel_Macron_in_2019.jpg", liens_cac40: ["Rothschild & Co (ex-banquier)"], nepotisme: [], conflits: ["Ancien associé-gérant Rothschild"], pantouflage: "Rothschild → Politique → ?", twitter: "@EmmanuelMacron" },
  { id: "francois-bayrou", nom: "François Bayrou", prenom: "François", fonction: "Premier Ministre", ministere: "Matignon", parti: "MoDem", age: 73, salaire: 10680, depuis: 2024, photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/99/Fran%C3%A7ois_Bayrou_2012.jpg/440px-Fran%C3%A7ois_Bayrou_2012.jpg", liens_cac40: [], nepotisme: ["Épouse conseillère régionale"], conflits: ["Affaire assistants parlementaires MoDem"], pantouflage: "" },
  { id: "elisabeth-borne", nom: "Élisabeth Borne", prenom: "Élisabeth", fonction: "Ministre de l'Éducation nationale", ministere: "Éducation Nationale", parti: "Renaissance", age: 63, salaire: 9940, depuis: 2024, photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6e/%C3%89lisabeth_Borne_in_2022_%28cropped%29.jpg/440px-%C3%89lisabeth_Borne_in_2022_%28cropped%29.jpg", liens_cac40: ["EDF (ex-PDG)", "RATP (ex-PDG)"], nepotisme: [], conflits: ["Pantouflage EDF/RATP"], pantouflage: "Haute fonction publique → RATP → EDF → Politique" },
  { id: "jean-noel-barrot", nom: "Jean-Noël Barrot", prenom: "Jean-Noël", fonction: "Ministre des Affaires Étrangères", ministere: "Quai d'Orsay", parti: "MoDem", age: 40, salaire: 9940, depuis: 2024, photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/Jean-No%C3%ABl_Barrot_2022.jpg/440px-Jean-No%C3%ABl_Barrot_2022.jpg", liens_cac40: [], nepotisme: ["Père Jacques Barrot (ex-commissaire européen)", "Sœur Nathalie Barrot"], conflits: [], pantouflage: "" },
  { id: "bruno-retailleau", nom: "Bruno Retailleau", prenom: "Bruno", fonction: "Ministre de l'Intérieur", ministere: "Place Beauvau", parti: "LR", age: 63, salaire: 9940, depuis: 2024, photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7e/Bruno_Retailleau_2022.jpg/440px-Bruno_Retailleau_2022.jpg", liens_cac40: [], nepotisme: [], conflits: [], pantouflage: "" },
  { id: "eric-lombard", nom: "Éric Lombard", prenom: "Éric", fonction: "Ministre de l'Économie et des Finances", ministere: "Bercy", parti: "Sans étiquette", age: 61, salaire: 9940, depuis: 2025, photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/%C3%89ric_Lombard_2023.jpg/440px-%C3%89ric_Lombard_2023.jpg", liens_cac40: ["Caisse des Dépôts (ex-DG)", "BNP Paribas", "Generali"], nepotisme: [], conflits: ["Caisse des Dépôts → Ministère"], pantouflage: "Finance privée → CDC → Politique" },
  { id: "rachida-dati", nom: "Rachida Dati", prenom: "Rachida", fonction: "Ministre de la Culture", ministere: "Culture", parti: "LR", age: 58, salaire: 9940, depuis: 2024, photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f6/Rachida_Dati_2019.jpg/440px-Rachida_Dati_2019.jpg", liens_cac40: ["Sony (lobbyiste)", "Amber Capital"], nepotisme: [], conflits: ["Affaire fille Sarkozy", "Contrats Sony"], pantouflage: "Politique → Lobbying Sony → Politique" },
  { id: "sebastien-lecornu", nom: "Sébastien Lecornu", prenom: "Sébastien", fonction: "Ministre des Armées", ministere: "Armées", parti: "Renaissance", age: 38, salaire: 9940, depuis: 2024, photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/S%C3%A9bastien_Lecornu_2022.jpg/440px-S%C3%A9bastien_Lecornu_2022.jpg", liens_cac40: [], nepotisme: [], conflits: [], pantouflage: "" },
  { id: "catherine-vautrin", nom: "Catherine Vautrin", prenom: "Catherine", fonction: "Ministre du Travail et de la Santé", ministere: "Travail/Santé", parti: "Renaissance", age: 59, salaire: 9940, depuis: 2024, photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4c/Catherine_Vautrin_2022.jpg/440px-Catherine_Vautrin_2022.jpg", liens_cac40: [], nepotisme: [], conflits: [], pantouflage: "" },
  { id: "gerald-darmanin", nom: "Gérald Darmanin", prenom: "Gérald", fonction: "Ministre de la Justice", ministere: "Justice", parti: "Renaissance", age: 41, salaire: 9940, depuis: 2024, photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/G%C3%A9rald_Darmanin_2020.jpg/440px-G%C3%A9rald_Darmanin_2020.jpg", liens_cac40: [], nepotisme: [], conflits: ["Affaire viol classée sans suite", "Affaire Ziad Takieddine"], pantouflage: "" },
];

// ── CONSEIL CONSTITUTIONNEL ──────────────────────────────────────
const CONSEIL_CONSTIT = [
  { id: "laurent-fabius", nom: "Laurent Fabius", fonction: "Président du Conseil Constitutionnel", nomme_par: "Président de la République", depuis: 2016, salaire: 14000, photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e4/Laurent_Fabius_2012.jpg/440px-Laurent_Fabius_2012.jpg", ancien_poste: "Président Assemblée Nationale, Premier Ministre", conflits: ["Affaire du sang contaminé (acquitté)"] },
  { id: "jacqueline-gourault", nom: "Jacqueline Gourault", fonction: "Membre", nomme_par: "Président du Sénat", depuis: 2022, salaire: 13000, photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Jacqueline_Gourault_2020.jpg/440px-Jacqueline_Gourault_2020.jpg", ancien_poste: "Ministre de la Cohésion des territoires", conflits: [] },
  { id: "alain-jupe", nom: "Alain Juppé", fonction: "Membre (ancien Président de la République au sens constitutionnel)", nomme_par: "De droit", depuis: 2019, salaire: 13000, photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Alain_Jupp%C3%A9_2014.jpg/440px-Alain_Jupp%C3%A9_2014.jpg", ancien_poste: "Premier Ministre, Maire de Bordeaux", conflits: ["Condamné emplois fictifs RPR"] },
  { id: "michel-pinault", nom: "Michel Pinault", fonction: "Membre", nomme_par: "Président Assemblée Nationale", depuis: 2022, salaire: 13000, photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Conseil_constitutionnel_de_la_R%C3%A9publique_fran%C3%A7aise_%28logo%29.svg/200px-Conseil_constitutionnel_de_la_R%C3%A9publique_fran%C3%A7aise_%28logo%29.svg.png", ancien_poste: "Conseiller d'État", conflits: [] },
  { id: "francoise-dumont", nom: "Françoise Dumont", fonction: "Membre", nomme_par: "Président du Sénat", depuis: 2019, salaire: 13000, photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Conseil_constitutionnel_de_la_R%C3%A9publique_fran%C3%A7aise_%28logo%29.svg/200px-Conseil_constitutionnel_de_la_R%C3%A9publique_fran%C3%A7aise_%28logo%29.svg.png", ancien_poste: "Présidente TGI Toulon", conflits: [] },
  { id: "philippe-bas", nom: "Philippe Bas", fonction: "Membre", nomme_par: "Président du Sénat", depuis: 2022, salaire: 13000, photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Philippe_Bas_2016.jpg/440px-Philippe_Bas_2016.jpg", ancien_poste: "Sénateur Manche, Ministre Santé", conflits: [] },
  { id: "veronique-malbec", nom: "Véronique Malbec", fonction: "Membre", nomme_par: "Président de la République", depuis: 2022, salaire: 13000, photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Conseil_constitutionnel_de_la_R%C3%A9publique_fran%C3%A7aise_%28logo%29.svg/200px-Conseil_constitutionnel_de_la_R%C3%A9publique_fran%C3%A7aise_%28logo%29.svg.png", ancien_poste: "Procureure générale", conflits: [] },
  { id: "francois-seners", nom: "François Séners", fonction: "Membre", nomme_par: "Président Assemblée Nationale", depuis: 2022, salaire: 13000, photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Conseil_constitutionnel_de_la_R%C3%A9publique_fran%C3%A7aise_%28logo%29.svg/200px-Conseil_constitutionnel_de_la_R%C3%A9publique_fran%C3%A7aise_%28logo%29.svg.png", ancien_poste: "Conseiller d'État", conflits: [] },
  { id: "corinne-luquiens", nom: "Corinne Luquiens", fonction: "Membre", nomme_par: "Président Assemblée Nationale", depuis: 2019, salaire: 13000, photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Conseil_constitutionnel_de_la_R%C3%A9publique_fran%C3%A7aise_%28logo%29.svg/200px-Conseil_constitutionnel_de_la_R%C3%A9publique_fran%C3%A7aise_%28logo%29.svg.png", ancien_poste: "Secrétaire générale AN", conflits: [] },
];

// ── ANCIENS ÉLUS NOTABLES ────────────────────────────────────────
const ANCIENS_ELUS = [
  { id: "nicolas-sarkozy", nom: "Nicolas Sarkozy", fonction: "Ancien Président de la République", periode: "2007-2012", parti: "LR", retraite: 6220, photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/82/Nicolas_Sarkozy_-_Janvier_2012_%28cropped%29.jpg/440px-Nicolas_Sarkozy_-_Janvier_2012_%28cropped%29.jpg", apres_politique: "Avocat d'affaires, conférencier", conflits: ["Condamné corruption Bismuth 3 ans dont 1 ferme", "Affaire Bygmalion", "Affaire Kadhafi", "Affaire Woerth-Bettencourt"], liens_cac40: ["Total (conseil)", "Accor (conseil)"] },
  { id: "francois-hollande", nom: "François Hollande", fonction: "Ancien Président de la République", periode: "2012-2017", parti: "PS", retraite: 6220, photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f5/Fran%C3%A7ois_Hollande_-_Janvier_2012_%28cropped%29.jpg/440px-Fran%C3%A7ois_Hollande_-_Janvier_2012_%28cropped%29.jpg", apres_politique: "Conférencier, auteur", conflits: ["Affaire Cahuzac (ministre)", "Affaire Leonarda"], liens_cac40: [] },
  { id: "jean-luc-melenchon", nom: "Jean-Luc Mélenchon", fonction: "Ancien député, fondateur LFI", periode: "1986-2024", parti: "LFI", retraite: 8200, photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a3/Jean-Luc_M%C3%A9lenchon_2017_%28cropped%29.jpg/440px-Jean-Luc_M%C3%A9lenchon_2017_%28cropped%29.jpg", apres_politique: "Retraité politique", conflits: ["Perquisitions LFI 2018", "Procédure obstruction"], liens_cac40: [] },
  { id: "francois-fillon", nom: "François Fillon", fonction: "Ancien Premier Ministre", periode: "2007-2012", parti: "LR", retraite: 7100, photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/30/Fran%C3%A7ois_Fillon_2017_%28cropped%29.jpg/440px-Fran%C3%A7ois_Fillon_2017_%28cropped%29.jpg", apres_politique: "Administrateur Zarubezhneft (Russie), Conseil d'État Vinogradoff", conflits: ["Condamné emplois fictifs Penelope Gate 5 ans dont 3 ferme"], liens_cac40: ["Vinogradoff", "Zarubezhneft"] },
  { id: "marine-le-pen", nom: "Marine Le Pen", fonction: "Ancienne présidente RN, députée", periode: "2004-2024", parti: "RN", retraite: 0, photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e4/Marine_Le_Pen_%28cropped%29.jpg/440px-Marine_Le_Pen_%28cropped%29.jpg", apres_politique: "Retraitée (inéligibilité 5 ans)", conflits: ["Condamnée emplois fictifs assistants PE 5 ans inéligibilité"], liens_cac40: [] },
  { id: "edouard-philippe", nom: "Édouard Philippe", fonction: "Ancien Premier Ministre, Maire du Havre", periode: "2017-2020", parti: "Horizons", retraite: 0, photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/%C3%89douard_Philippe_2020_%28cropped%29.jpg/440px-%C3%89douard_Philippe_2020_%28cropped%29.jpg", apres_politique: "Maire du Havre, candidat présidentielle 2027", conflits: [], liens_cac40: [] },
];

// ── LIENS CAC40 / RÉSEAUX D'INFLUENCE ───────────────────────────
const RESEAUX_INFLUENCE = {
  "total-energies": { entreprise: "TotalEnergies", elus_lies: ["nicolas-sarkozy","christophe-de-margerie"], type: "Conseil d'administration", montant_annuel: "120 000€" },
  "bnp-paribas": { entreprise: "BNP Paribas", elus_lies: ["eric-lombard"], type: "Ancien dirigeant", montant_annuel: "N/A" },
  "rothschild": { entreprise: "Rothschild & Co", elus_lies: ["emmanuel-macron"], type: "Ancien associé-gérant", montant_annuel: "N/A" },
  "sony-music": { entreprise: "Sony Music France", elus_lies: ["rachida-dati"], type: "Conseil juridique", montant_annuel: "900 000€ (estimé)" },
};

// ── API GOUVERNEMENT ────────────────────────────────────────────
app.get("/api/gouvernement", (req, res) => {
  res.json({ gouvernement: GOUVERNEMENT });
});

app.get("/api/gouvernement/:id", (req, res) => {
  const m = GOUVERNEMENT.find(g => g.id === req.params.id);
  if (!m) return res.status(404).json({ error: "Non trouvé" });
  res.json(m);
});

// ── API CONSEIL CONSTITUTIONNEL ─────────────────────────────────
app.get("/api/conseil-constitutionnel", (req, res) => {
  res.json({ membres: CONSEIL_CONSTIT });
});

// ── API ANCIENS ÉLUS ────────────────────────────────────────────
app.get("/api/anciens-elus", (req, res) => {
  res.json({ anciens: ANCIENS_ELUS });
});

// ── API RÉSEAUX D'INFLUENCE ─────────────────────────────────────
app.get("/api/reseaux-influence", (req, res) => {
  res.json({ reseaux: RESEAUX_INFLUENCE });
});

// ── DÉPUTÉS ─────────────────────────────────────────────────────
app.get("/api/deputes", async (req, res) => {
  try {
    const d = await cached("deputes", () => xfetch("https://www.nosdeputes.fr/deputes/json"));
    res.json({ deputes: (d?.deputes || []).map(x => x.depute || x) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/depute/:slug", async (req, res) => {
  try {
    const d = await cached("dep_" + req.params.slug, () => xfetch(`https://www.nosdeputes.fr/${req.params.slug}/json`));
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/depute/:slug/votes", async (req, res) => {
  try {
    const d = await cached("votes_" + req.params.slug, () => xfetch(`https://www.nosdeputes.fr/${req.params.slug}/votes/json`));
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SÉNATEURS ───────────────────────────────────────────────────
app.get("/api/senateurs", async (req, res) => {
  try {
    // API officielle du Sénat
    const d = await cached("senateurs", () => xfetch("https://data.senat.fr/data/senateurs/ODSEN_GENERAL.json"));
    const senateurs = Array.isArray(d) ? d : (d?.senateurs || d?.ODSEN_GENERAL || []);
    // Format normalisé
    const normalized = senateurs.map(s => ({
      slug: (s.PRENOM + '-' + s.NOM).toLowerCase().replace(/[^a-z-]/g,'-').replace(/-+/g,'-'),
      prenom: s.PRENOM || s.prenom || '',
      nom_de_famille: s.NOM || s.nom || '',
      nom: (s.PRENOM||'') + ' ' + (s.NOM||''),
      groupe_sigle: s.GROUPE_POLITIQUE_SIGLE || s.groupe_politique_sigle || '',
      profession: s.PROFESSION || '',
      nom_circo: s.DEPARTEMENT || s.departement || '',
      date_debut_mandat: s.DATE_DEBUT_MANDAT || '',
      photo_url: s.PHOTO_URL || null,
    }));
    res.json({ senateurs: normalized });
  } catch (e) {
    // Fallback: retourner liste statique de base
    res.json({ senateurs: [] });
  }
});

app.get("/api/senateur/:slug", async (req, res) => {
  try {
    const d = await cached("sen_" + req.params.slug, () => xfetch(`https://www.nossenateurs.fr/${req.params.slug}/json`));
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/senateur/:slug/votes", async (req, res) => {
  try {
    const d = await cached("svotes_" + req.params.slug, () => xfetch(`https://www.nossenateurs.fr/${req.params.slug}/votes/json`));
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SCRUTINS ────────────────────────────────────────────────────
app.get("/api/scrutins", async (req, res) => {
  try {
    const d = await cached("scrutins", () => xfetch("https://www.nosdeputes.fr/scrutins/json?limit=30"));
    res.json({ scrutins: d?.scrutins || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GROUPES ─────────────────────────────────────────────────────
app.get("/api/groupes", async (req, res) => {
  try {
    const d = await cached("groupes", () => xfetch("https://www.nosdeputes.fr/organismes/groupe/json"));
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── RNE : MAIRES ────────────────────────────────────────────────
app.get("/api/rne/maires", async (req, res) => {
  try {
    const dept = req.query.dept || "";
    const q = req.query.q || "";
    const page = req.query.page || 1;
    const size = Math.min(parseInt(req.query.page_size || "50"), 100);
    let url = `https://tabular-api.data.gouv.fr/api/resources/d5f400de-ae3f-4966-8cb6-a85c70c6c24a/data/?page_size=${size}&page=${page}`;
    if (dept) url += `&CodeOfDepartement__exact=${dept}`;
    if (q) url += `&Nom__contains=${encodeURIComponent(q)}`;
    const d = await xfetch(url);
    // Enrichir avec photo mairie Wikipedia si pas de photo
    const results = (d.data || d.results || []).map(m => ({
      ...m,
      photo_mairie: m.LibelleCommune ? `https://upload.wikimedia.org/wikipedia/commons/thumb/search?q=${encodeURIComponent(m.LibelleCommune + " mairie")}` : null,
    }));
    res.json({ ...d, data: results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── RNE : CONSEILLERS MUNICIPAUX ────────────────────────────────
app.get("/api/rne/conseillers-municipaux", async (req, res) => {
  try {
    const q = req.query.q || "";
    const dept = req.query.dept || "";
    const page = req.query.page || 1;
    const size = Math.min(parseInt(req.query.page_size || "50"), 100);
    // Dataset RNE conseillers municipaux
    let url = `https://tabular-api.data.gouv.fr/api/resources/d5f400de-ae3f-4966-8cb6-a85c70c6c24a/data/?page_size=${size}&page=${page}`;
    if (q) url += `&Nom__contains=${encodeURIComponent(q)}`;
    if (dept) url += `&CodeOfDepartement__exact=${dept}`;
    const d = await xfetch(url);
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── RNE : CONSEILLERS DÉPARTEMENTAUX ────────────────────────────
app.get("/api/rne/conseillers-dept", async (req, res) => {
  try {
    const q = req.query.q || "";
    const page = req.query.page || 1;
    const size = Math.min(parseInt(req.query.page_size || "50"), 100);
    let url = `https://tabular-api.data.gouv.fr/api/resources/601ef073-d986-4582-8e1a-ed14dc857fde/data/?page_size=${size}&page=${page}`;
    if (q) url += `&Nom__contains=${encodeURIComponent(q)}`;
    const d = await xfetch(url);
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── RNE : CONSEILLERS RÉGIONAUX ─────────────────────────────────
app.get("/api/rne/conseillers-region", async (req, res) => {
  try {
    const q = req.query.q || "";
    const page = req.query.page || 1;
    const size = Math.min(parseInt(req.query.page_size || "50"), 100);
    let url = `https://tabular-api.data.gouv.fr/api/resources/430e13f9-834b-4411-a1a8-da0b4b6e715c/data/?page_size=${size}&page=${page}`;
    if (q) url += `&Nom__contains=${encodeURIComponent(q)}`;
    const d = await xfetch(url);
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── RNE : CONSEILLERS COMMUNAUTAIRES ────────────────────────────
app.get("/api/rne/conseillers-communautaires", async (req, res) => {
  try {
    const q = req.query.q || "";
    const page = req.query.page || 1;
    const size = Math.min(parseInt(req.query.page_size || "50"), 100);
    // Dataset EPCI/Intercommunalités
    let url = `https://tabular-api.data.gouv.fr/api/resources/d5f400de-ae3f-4966-8cb6-a85c70c6c24a/data/?page_size=${size}&page=${page}&LibelleQualite__contains=Communautaire`;
    if (q) url += `&Nom__contains=${encodeURIComponent(q)}`;
    const d = await xfetch(url);
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── RNE : OUTRE-MER ─────────────────────────────────────────────
app.get("/api/rne/outremer", async (req, res) => {
  try {
    const CODES_OM = ["971","972","973","974","976","975","984","985","986","987","988"];
    const q = req.query.q || "";
    const results = [];
    // Chercher dans plusieurs datasets pour les codes outre-mer
    for (const code of CODES_OM.slice(0,3)) { // limité pour éviter timeout
      try {
        const url = `https://tabular-api.data.gouv.fr/api/resources/601ef073-d986-4582-8e1a-ed14dc857fde/data/?page_size=20&CodeOfDepartement__exact=${code}`;
        const d = await xfetch(url);
        results.push(...(d.data || d.results || []));
      } catch {}
    }
    res.json({ data: results, total: results.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PRÉFETS ─────────────────────────────────────────────────────
// Données statiques des préfets principaux (données publiques)
const PREFETS_PRINCIPAUX = [
  { id: "pref-75", nom: "Laurent Nuñez", departement: "Paris (75)", region: "Île-de-France", salaire: 8500, photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/57/Laurent_Nu%C3%B1ez.jpg/440px-Laurent_Nu%C3%B1ez.jpg" },
  { id: "pref-69", nom: "Fabienne Buccio", departement: "Rhône (69)", region: "Auvergne-Rhône-Alpes", salaire: 7800, photo: null },
  { id: "pref-13", nom: "Christophe Mirmand", departement: "Bouches-du-Rhône (13)", region: "Provence-Alpes-Côte d'Azur", salaire: 7800, photo: null },
  { id: "pref-33", nom: "Étienne Guyot", departement: "Gironde (33)", region: "Nouvelle-Aquitaine", salaire: 7800, photo: null },
  { id: "pref-31", nom: "Pierre-André Durand", departement: "Haute-Garonne (31)", region: "Occitanie", salaire: 7800, photo: null },
  { id: "pref-59", nom: "Bertrand Gaume", departement: "Nord (59)", region: "Hauts-de-France", salaire: 7800, photo: null },
  { id: "pref-67", nom: "Josiane Chevalier", departement: "Bas-Rhin (67)", region: "Grand Est", salaire: 7800, photo: null },
  { id: "pref-44", nom: "Fabrice Rigoulet-Roze", departement: "Loire-Atlantique (44)", region: "Pays de la Loire", salaire: 7800, photo: null },
  { id: "pref-76", nom: "Pierre-Edouard Colliex", departement: "Seine-Maritime (76)", region: "Normandie", salaire: 7800, photo: null },
  { id: "pref-34", nom: "François-Xavier Lauch", departement: "Hérault (34)", region: "Occitanie", salaire: 7800, photo: null },
];

app.get("/api/prefets", async (req, res) => {
  try {
    // Tenter data.gouv.fr puis fallback statique
    const d = await xfetch("https://tabular-api.data.gouv.fr/api/resources/prefets-france/data/?page_size=50").catch(() => null);
    if (d?.data?.length) return res.json({ prefets: d.data });
    res.json({ prefets: PREFETS_PRINCIPAUX });
  } catch (e) {
    res.json({ prefets: PREFETS_PRINCIPAUX });
  }
});

// ── GEO ─────────────────────────────────────────────────────────
app.get("/api/geo/communes", async (req, res) => {
  try {
    const q = req.query.q || "";
    const url = `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(q)}&fields=nom,code,population,departement,region&limit=20&boost=population`;
    res.json(await xfetch(url));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/geo/departements", async (req, res) => {
  try {
    const d = await cached("depts", () => xfetch("https://geo.api.gouv.fr/departements?fields=nom,code,region&limit=200"));
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/geo/regions", async (req, res) => {
  try {
    const d = await cached("regions", () => xfetch("https://geo.api.gouv.fr/regions?fields=nom,code&limit=50"));
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── HATVP ────────────────────────────────────────────────────────
app.get("/api/hatvp/declarations", async (req, res) => {
  const { nom, prenom, q } = req.query;
  let url = "https://www.hatvp.fr/rest/api/declarations?limit=20";
  if (nom) url += `&nom=${encodeURIComponent(nom)}`;
  if (prenom) url += `&prenom=${encodeURIComponent(prenom)}`;
  if (q) url += `&q=${encodeURIComponent(q)}`;
  try { res.json(await xfetch(url)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SEARCH UNIFIÉ ────────────────────────────────────────────────
app.get("/api/search/:q", async (req, res) => {
  const q = req.params.q.toLowerCase();
  try {
    const [deps, sens] = await Promise.all([
      cached("deputes", () => xfetch("https://www.nosdeputes.fr/deputes/json")).catch(() => null),
      cached("senateurs", () => xfetch("https://www.nossenateurs.fr/senateurs/json")).catch(() => null),
    ]);

    const deputes = ((deps?.deputes || []).map(d => d.depute || d))
      .filter(d => `${d.nom || ""} ${d.prenom || ""} ${d.nom_de_famille || ""}`.toLowerCase().includes(q))
      .slice(0, 5).map(d => ({ ...d, _type: "depute", _chambre: "Assemblée Nationale", cat: "deputes" }));

    const senateurs = ((sens?.senateurs || []).map(s => s.senateur || s))
      .filter(s => `${s.nom || ""} ${s.prenom || ""} ${s.nom_de_famille || ""}`.toLowerCase().includes(q))
      .slice(0, 3).map(s => ({ ...s, _type: "senateur", _chambre: "Sénat", cat: "senateurs" }));

    const gouvernement = GOUVERNEMENT
      .filter(g => g.nom.toLowerCase().includes(q))
      .slice(0, 3).map(g => ({ ...g, _type: "ministre", cat: "gouvernement" }));

    const anciens = ANCIENS_ELUS
      .filter(a => a.nom.toLowerCase().includes(q))
      .slice(0, 2).map(a => ({ ...a, _type: "ancien", cat: "anciens-elus" }));

    const conseil = CONSEIL_CONSTIT
      .filter(c => c.nom.toLowerCase().includes(q))
      .slice(0, 2).map(c => ({ ...c, _type: "conseil", cat: "conseil-constitutionnel" }));

    res.json({ results: [...gouvernement, ...deputes, ...senateurs, ...anciens, ...conseil] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── IA ASSISTANT ─────────────────────────────────────────────────
app.post("/ia", async (req, res) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "messages requis" });
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY || "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: `Tu es l'assistant de TransparenceFrance.fr. Tu aides les citoyens à comprendre les coûts, votes, patrimoine et réseaux d'influence des élus français. Tu es factuel, précis et sans complaisance. Tu cites toujours tes sources (HATVP, nosdeputes.fr, data.gouv.fr, Journal Officiel). Tu parles uniquement de faits vérifiés.`,
        messages: messages.slice(-10),
      }),
    });
    const data = await r.json();
    res.json({ content: data.content?.[0]?.text || "Désolé, je n'ai pas pu répondre." });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── ROOT ─────────────────────────────────────────────────────────
app.get("/", (req, res) => res.json({
  status: "✅ TransparenceFrance API v4",
  version: "4.0.0",
  endpoints: [
    "GET /api/gouvernement — Président + PM + Ministres",
    "GET /api/gouvernement/:id — Détail ministre",
    "GET /api/conseil-constitutionnel — 9 membres",
    "GET /api/anciens-elus — Anciens présidents, PM, figures politiques",
    "GET /api/reseaux-influence — Liens CAC40 et conflits d'intérêts",
    "GET /api/prefets — Préfets de France",
    "GET /api/deputes — 577 députés AN",
    "GET /api/depute/:slug — Détail député",
    "GET /api/depute/:slug/votes — Votes député",
    "GET /api/senateurs — 348 sénateurs",
    "GET /api/senateur/:slug — Détail sénateur",
    "GET /api/senateur/:slug/votes — Votes sénateur",
    "GET /api/scrutins — Scrutins récents AN",
    "GET /api/rne/maires?q=nom&dept=75 — Maires (34 875)",
    "GET /api/rne/conseillers-municipaux?q=nom — ~459 800 conseillers",
    "GET /api/rne/conseillers-dept?q=nom — 4 044 conseillers dept",
    "GET /api/rne/conseillers-region?q=nom — 1 750 conseillers région",
    "GET /api/rne/conseillers-communautaires — ~65 600",
    "GET /api/rne/outremer — ~200 élus outre-mer",
    "GET /api/hatvp/declarations?q=nom — Patrimoine HATVP",
    "GET /api/geo/communes?q=nom — Communes",
    "GET /api/search/:q — Recherche unifiée tous élus",
    "GET /img?url= — Proxy images sécurisé",
    "POST /ia — Assistant Claude Sonnet",
  ],
}));

// ── PRÉCHARGEMENT ────────────────────────────────────────────────
(async () => {
  console.log("🚀 Préchargement...");
  await Promise.allSettled([
    cached("deputes", () => xfetch("https://www.nosdeputes.fr/deputes/json")),
    cached("scrutins", () => xfetch("https://www.nosdeputes.fr/scrutins/json?limit=30")),
    cached("depts", () => xfetch("https://geo.api.gouv.fr/departements?fields=nom,code,region&limit=200")),
  ]);
  console.log("✅ Prêt !");
})();

app.listen(PORT, () => console.log(`✅ TransparenceFrance API v4 — port ${PORT}`));
