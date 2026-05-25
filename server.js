const express = require("express");
const cors = require("cors");
const fetch = (...a) => import("node-fetch").then(({ default: f }) => f(...a));
const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors({ origin: "*" }));
app.use(express.json());

// Cache mémoire simple
const CACHE = {};
async function cached(key, fn, ttl = 3600000) {
  if (CACHE[key] && Date.now() - CACHE[key].t < ttl) return CACHE[key].d;
  const d = await fn();
  CACHE[key] = { d, t: Date.now() };
  return d;
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36";

async function get(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

// ── PROXY IMAGES ────────────────────────────────────────────────
app.get("/img", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send("missing url");
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept": "image/*",
        "Referer": "https://fr.wikipedia.org/",
      },
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });
    if (!r.ok) return res.status(r.status).send("error");
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", r.headers.get("content-type") || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(buf);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// ── DÉPUTÉS ────────────────────────────────────────────────────
app.get("/api/deputes", async (req, res) => {
  try {
    const d = await cached("dep", () => get("https://www.nosdeputes.fr/deputes/json"), 86400000);
    res.json({ deputes: (d?.deputes || []).map(x => x.depute || x) });
  } catch (e) { res.status(500).json({ error: e.message, deputes: [] }); }
});

app.get("/api/depute/:slug/votes", async (req, res) => {
  try {
    const slug = req.params.slug;
    const raw = await cached(`v_${slug}`, () => get(`https://www.nosdeputes.fr/${slug}/votes/json`), 3600000);
    const votes = Array.isArray(raw) ? raw : (raw?.votes || []);
    const cats = {
      "Social": ["travail","emploi","retraite","social","salaire"],
      "Économie": ["budget","fiscal","impôt","économie","finance"],
      "Société": ["immigration","famille","mariage","avortement","sécurité"],
      "Environnement": ["environnement","énergie","climat","écologie"],
      "Défense": ["défense","armée","militaire"],
      "Santé": ["santé","hôpital","médecin"],
      "Éducation": ["éducation","école","université"],
    };
    const catLoi = t => {
      const tl = (t||"").toLowerCase();
      for (const [c, ks] of Object.entries(cats)) if (ks.some(k => tl.includes(k))) return c;
      return "Autre";
    };
    const enriched = votes.map(v => {
      const vv = v.vote || v;
      const titre = vv.titre || vv.libelle || "";
      return { ...vv, categorie: catLoi(titre), titre_loi: titre };
    });
    res.json({
      tous: enriched,
      pour: enriched.filter(v => v.position === "pour"),
      contre: enriched.filter(v => v.position === "contre"),
      abstention: enriched.filter(v => v.position === "abstention"),
      absent: enriched.filter(v => !["pour","contre","abstention"].includes(v.position)),
      stats: {
        total: enriched.length,
        pour: enriched.filter(v => v.position === "pour").length,
        contre: enriched.filter(v => v.position === "contre").length,
        abstention: enriched.filter(v => v.position === "abstention").length,
      }
    });
  } catch (e) { res.status(500).json({ error: e.message, tous: [], pour: [], contre: [], abstention: [], absent: [] }); }
});

// ── SÉNATEURS ──────────────────────────────────────────────────
app.get("/api/senateurs", async (req, res) => {
  // 1. data.senat.fr (officiel)
  try {
    const d = await cached("sen1", () => get("https://data.senat.fr/data/senateurs/ODSEN_GENERAL.json"), 86400000);
    // data.senat.fr peut retourner array direct ou objet avec propriété
    let arr = [];
    if (Array.isArray(d)) arr = d;
    else if (d && typeof d === 'object') {
      // Chercher la première propriété qui est un tableau
      for (const key of Object.keys(d)) {
        if (Array.isArray(d[key]) && d[key].length > 0) { arr = d[key]; break; }
      }
    }
    console.log("data.senat.fr - nb sénateurs:", arr.length, "sample keys:", arr[0] ? Object.keys(arr[0]).slice(0,5) : 'vide');
    if (arr.length > 0) {
      const s0 = arr[0];
      // Détecter automatiquement les bons champs (majuscules ou minuscules)
      const fPrenom = s0.PRENOM !== undefined ? 'PRENOM' : s0.prenom !== undefined ? 'prenom' : 'Prenom';
      const fNom = s0.NOM !== undefined ? 'NOM' : s0.nom !== undefined ? 'nom' : 'Nom';
      const fGroupe = s0.GROUPE_POLITIQUE_SIGLE !== undefined ? 'GROUPE_POLITIQUE_SIGLE' : s0.groupe_politique_sigle !== undefined ? 'groupe_politique_sigle' : '';
      const fDept = s0.DEPARTEMENT !== undefined ? 'DEPARTEMENT' : s0.departement !== undefined ? 'departement' : '';
      const fDebut = s0.DATE_DEBUT_MANDAT !== undefined ? 'DATE_DEBUT_MANDAT' : s0.date_debut_mandat !== undefined ? 'date_debut_mandat' : '';
      return res.json({ senateurs: arr.map(s => {
        const prenom = s[fPrenom] || "";
        const nom = s[fNom] || "";
        const slug = (prenom+"-"+nom).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z-]/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"");
        return {
          slug, prenom, nom_de_famille: nom,
          nom: (prenom+" "+nom).trim(),
          groupe_sigle: fGroupe ? (s[fGroupe]||"") : "",
          nom_circo: fDept ? (s[fDept]||"") : "",
          date_debut_mandat: fDebut ? (s[fDebut]||"") : "",
        };
      })}); 
    }
  } catch(e1) { console.log("data.senat.fr error:", e1.message); }
  // 2. nossenateurs.fr
  try {
    const d = await cached("sen2", () => get("https://www.nossenateurs.fr/senateurs/json"), 86400000);
    const s = (d?.senateurs||[]).map(x=>x.senateur||x);
    if (s.length > 0) return res.json({ senateurs: s });
  } catch(e2) {}
  // 3. nosdeputes.fr senateurs
  try {
    const d = await cached("sen3", () => get("https://www.nosdeputes.fr/senateurs/json"), 86400000);
    const s = (d?.senateurs||[]).map(x=>x.senateur||x);
    if (s.length > 0) return res.json({ senateurs: s });
  } catch(e3) {}
  res.status(500).json({ error: "Toutes sources indisponibles", senateurs: [] });
});

// ── SCRUTINS ──────────────────────────────────────────────────
app.get("/api/scrutins", async (req, res) => {
  try {
    const d = await cached("scr", () => get("https://www.nosdeputes.fr/scrutins/json?limit=50"), 300000);
    res.json({ scrutins: (d?.scrutins || []).map(x => x.scrutin || x) });
  } catch (e) { res.status(500).json({ error: e.message, scrutins: [] }); }
});

// ── RNE ────────────────────────────────────────────────────────
const RNE = {
  maires: "d5f400de-ae3f-4966-8cb6-a85c70c6c24a",
  dept: "601ef073-d986-4582-8e1a-ed14dc857fde",
  region: "430e13f9-834b-4411-a1a8-da0b4b6e715c",
};

async function rne(resource, q, dept, page, size) {
  let url = `https://tabular-api.data.gouv.fr/api/resources/${resource}/data/?page_size=${size}&page=${page}`;
  if (dept) url += `&CodeOfDepartement__exact=${encodeURIComponent(dept)}`;
  if (q) url += `&Nom__contains=${encodeURIComponent(q)}`;
  return get(url);
}

app.get("/api/rne/maires", async (req, res) => {
  const { q="",dept="",page=1,page_size=50 } = req.query;
  try {
    const d = await rne(RNE.maires, q, dept, page, Math.min(+page_size,100));
    // Log des champs disponibles pour débugger
    if (d.data && d.data[0]) console.log("RNE maires champs:", Object.keys(d.data[0]).slice(0,10));
    res.json(d);
  }
  catch(e) { res.status(500).json({ error: e.message, data: [] }); }
});
app.get("/api/rne/conseillers-dept", async (req, res) => {
  const { q="",page=1,page_size=50 } = req.query;
  try { res.json(await rne(RNE.dept, q, "", page, Math.min(+page_size,100))); }
  catch(e) { res.status(500).json({ error: e.message, data: [] }); }
});
app.get("/api/rne/conseillers-region", async (req, res) => {
  const { q="",page=1,page_size=50 } = req.query;
  try { res.json(await rne(RNE.region, q, "", page, Math.min(+page_size,100))); }
  catch(e) { res.status(500).json({ error: e.message, data: [] }); }
});
app.get("/api/rne/conseillers-municipaux", async (req, res) => {
  const { q="",dept="",page=1,page_size=50 } = req.query;
  try { res.json(await rne(RNE.maires, q, dept, page, Math.min(+page_size,100))); }
  catch(e) { res.status(500).json({ error: e.message, data: [] }); }
});
app.get("/api/rne/conseillers-communautaires", async (req, res) => {
  const { q="",page=1,page_size=50 } = req.query;
  try { res.json(await rne(RNE.maires, q, "", page, Math.min(+page_size,100))); }
  catch(e) { res.status(500).json({ error: e.message, data: [] }); }
});
app.get("/api/rne/outremer", async (req, res) => {
  const depts = ["971","972","973","974","976"];
  const all = [];
  for (const d of depts) {
    try { const r = await rne(RNE.dept, "", d, 1, 30); all.push(...(r.data||[])); } catch{}
  }
  res.json({ data: all });
});

// ── HATVP ─────────────────────────────────────────────────────
app.get("/api/hatvp/declarations", async (req, res) => {
  const { q="", nom="", prenom="" } = req.query;
  let url = "https://www.hatvp.fr/rest/api/declarations?limit=10";
  if (nom) url += `&nom=${encodeURIComponent(nom)}`;
  if (prenom) url += `&prenom=${encodeURIComponent(prenom)}`;
  if (q) url += `&q=${encodeURIComponent(q)}`;
  try {
    const d = await get(url);
    res.json({ declarations: d.declarations || d.results || [] });
  } catch(e) { res.status(500).json({ error: e.message, declarations: [] }); }
});

// ── LOIS ──────────────────────────────────────────────────────
const LOIS = [
  {titre:"Constitution de la Ve République",numero:"58-1958",date:"1958-10-04",categorie:"Institutions",url:"https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000571356"},
  {titre:"Loi Veil - IVG",numero:"75-17",date:"1975-01-17",categorie:"Société",url:"https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000700458"},
  {titre:"Abolition de la peine de mort",numero:"81-908",date:"1981-10-09",categorie:"Justice",url:"https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000699934"},
  {titre:"Loi de décentralisation Defferre",numero:"82-213",date:"1982-03-02",categorie:"Institutions",url:"https://www.legifrance.gouv.fr"},
  {titre:"35 heures (Aubry)",numero:"98-461",date:"1998-06-13",categorie:"Social",url:"https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000759905"},
  {titre:"PACS",numero:"99-944",date:"1999-11-15",categorie:"Société",url:"https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000761797"},
  {titre:"Mariage pour tous",numero:"2013-404",date:"2013-05-17",categorie:"Société",url:"https://www.legifrance.gouv.fr/loda/id/JORFTEXT000027414232"},
  {titre:"Réforme des retraites (64 ans)",numero:"2023-270",date:"2023-04-14",categorie:"Social",url:"https://www.legifrance.gouv.fr/loda/id/JORFTEXT000047466785"},
  {titre:"Loi immigration Darmanin",numero:"2024-42",date:"2024-01-26",categorie:"Société",url:"https://www.legifrance.gouv.fr/loda/id/JORFTEXT000049042716"},
  {titre:"Loi El Khomri (Travail)",numero:"2016-1088",date:"2016-08-08",categorie:"Social",url:"https://www.legifrance.gouv.fr/loda/id/JORFTEXT000032983213"},
  {titre:"Loi de transition énergétique",numero:"2015-992",date:"2015-08-17",categorie:"Environnement",url:"https://www.legifrance.gouv.fr/loda/id/JORFTEXT000031044385"},
  {titre:"Loi Macron pour la croissance",numero:"2015-990",date:"2015-08-06",categorie:"Économie",url:"https://www.legifrance.gouv.fr/loda/id/JORFTEXT000030978561"},
  {titre:"Loi Grenelle environnement",numero:"2010-788",date:"2010-07-12",categorie:"Environnement",url:"https://www.legifrance.gouv.fr/loda/id/JORFTEXT000022470434"},
  {titre:"Loi Sécurité Globale",numero:"2021-646",date:"2021-05-25",categorie:"Sécurité",url:"https://www.legifrance.gouv.fr/loda/id/JORFTEXT000043540586"},
  {titre:"Loi de programmation militaire",numero:"2023-703",date:"2023-07-01",categorie:"Défense",url:"https://www.legifrance.gouv.fr/loda/id/JORFTEXT000047833435"},
  {titre:"Loi Informatique et Libertés",numero:"78-17",date:"1978-01-06",categorie:"Numérique",url:"https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000886460"},
  {titre:"Loi EgaLim 2 (alimentation)",numero:"2021-1357",date:"2021-10-18",categorie:"Environnement",url:"https://www.legifrance.gouv.fr"},
  {titre:"Loi pour la confiance dans l'économie numérique",numero:"2004-575",date:"2004-06-21",categorie:"Numérique",url:"https://www.legifrance.gouv.fr"},
  {titre:"Loi Peillon (refondation école)",numero:"2013-595",date:"2013-07-08",categorie:"Éducation",url:"https://www.legifrance.gouv.fr"},
  {titre:"Loi NOTRe (collectivités)",numero:"2015-991",date:"2015-08-07",categorie:"Institutions",url:"https://www.legifrance.gouv.fr"},
];

app.get("/api/lois", async (req, res) => {
  const { q="", page=1, page_size=20 } = req.query;

  // Essai Légifrance si clés disponibles
  try {
    const result = await getLoisLegifrance(q||"loi", +page, +page_size);
    if (result && result.lois.length > 0) return res.json(result);
  } catch(le) { console.log("Légifrance:", le.message); }

  // Fallback statique
  const filtered = q ? LOIS.filter(l => l.titre.toLowerCase().includes(q.toLowerCase())) : LOIS;
  const p = +page - 1; const ps = +page_size;
  res.json({ lois: filtered.slice(p*ps, (p+1)*ps), total: filtered.length, source: "statique" });
});

// ── LÉGIFRANCE ────────────────────────────────────────────────
async function getLegiToken() {
  const cid = process.env.LEGIFRANCE_CLIENT_ID;
  const csec = process.env.LEGIFRANCE_CLIENT_SECRET;
  if (!cid || !csec) return null;
  if (CACHE._legiToken && Date.now() < CACHE._legiExpiry) return CACHE._legiToken;
  try {
    const tr = await fetch("https://oauth.piste.gouv.fr/api/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type:"client_credentials", client_id:cid, client_secret:csec, scope:"openid" }),
      signal: AbortSignal.timeout(8000),
    });
    const td = await tr.json();
    CACHE._legiToken = td.access_token;
    CACHE._legiExpiry = Date.now() + (td.expires_in - 60) * 1000;
    return CACHE._legiToken;
  } catch(e) { return null; }
}

async function getLoisLegifrance(q, page=1, pageSize=20) {
  const token = await getLegiToken();
  if (!token) return null;
  const body = {
    recherche: {
      champs: [{ typeChamp:"TITLE", criteres:[{ typeRecherche:"CONTIENT", valeur: q||"loi" }] }],
      filtres: [{ facette:"NATURE", valeur:"LOI" }],
      pageNumber: page, pageSize, sort:"PERTINENCE", typePagination:"DEFAUT",
    }
  };
  const lr = await fetch("https://api.piste.gouv.fr/dila/legifrance/lf-engine-app/search", {
    method:"POST",
    headers:{ Authorization:`Bearer ${token}`, "Content-Type":"application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const ld = await lr.json();
  if (!ld.results?.length) return null;
  return {
    lois: ld.results.map(l => ({
      titre: l.title||l.titre, numero: l.numero,
      date: l.dateTexte||l.date, categorie: "Loi",
      url: `https://www.legifrance.gouv.fr/loda/id/${l.id}`,
    })),
    total: ld.totalResultNumber || 0,
    source: "legifrance"
  };
}

// Route pour enrichir un vote avec le titre de la loi
app.get("/api/loi-titre/:numero", async (req, res) => {
  const { numero } = req.params;
  if (!numero) return res.json({ titre: null });
  try {
    const cacheKey = "loi_" + numero;
    if (CACHE[cacheKey]) return res.json({ titre: CACHE[cacheKey].d });
    const token = await getLegiToken();
    if (!token) return res.json({ titre: null });
    const r = await fetch(`https://api.piste.gouv.fr/dila/legifrance/lf-engine-app/consult/legi/${numero}`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return res.json({ titre: null });
    const d = await r.json();
    const titre = d.title || d.titre || null;
    if (titre) CACHE[cacheKey] = { d: titre, t: Date.now() };
    res.json({ titre });
  } catch(e) { res.json({ titre: null }); }
});

// ── LÉGIFRANCE ────────────────────────────────────────────────
async function getLegiToken() {
  const cid = process.env.LEGIFRANCE_CLIENT_ID;
  const csec = process.env.LEGIFRANCE_CLIENT_SECRET;
  if (!cid || !csec) return null;
  if (CACHE._legiToken && Date.now() < CACHE._legiExpiry) return CACHE._legiToken;
  try {
    const tr = await fetch("https://oauth.piste.gouv.fr/api/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type:"client_credentials", client_id:cid, client_secret:csec, scope:"openid" }),
      signal: AbortSignal.timeout(8000),
    });
    const td = await tr.json();
    CACHE._legiToken = td.access_token;
    CACHE._legiExpiry = Date.now() + (td.expires_in - 60) * 1000;
    return CACHE._legiToken;
  } catch(e) { return null; }
}

async function getLoisLegifrance(q, page=1, pageSize=20) {
  const token = await getLegiToken();
  if (!token) return null;
  const body = {
    recherche: {
      champs: [{ typeChamp:"TITLE", criteres:[{ typeRecherche:"CONTIENT", valeur: q||"loi" }] }],
      filtres: [{ facette:"NATURE", valeur:"LOI" }],
      pageNumber: page, pageSize, sort:"PERTINENCE", typePagination:"DEFAUT",
    }
  };
  const lr = await fetch("https://api.piste.gouv.fr/dila/legifrance/lf-engine-app/search", {
    method:"POST",
    headers:{ Authorization:`Bearer ${token}`, "Content-Type":"application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const ld = await lr.json();
  if (!ld.results?.length) return null;
  return {
    lois: ld.results.map(l => ({
      titre: l.title||l.titre, numero: l.numero,
      date: l.dateTexte||l.date, categorie: "Loi",
      url: `https://www.legifrance.gouv.fr/loda/id/${l.id}`,
    })),
    total: ld.totalResultNumber || 0,
    source: "legifrance"
  };
}


// ── GOUVERNEMENT ──────────────────────────────────────────────
const GOUV = [
  {id:"emmanuel-macron",nom:"Emmanuel Macron",prenom:"Emmanuel",nom_famille:"MACRON",fonction:"Président de la République",ministere:"Élysée",parti:"Renaissance",age:46,salaire_base:15132,frais_mandat:0,indemnite_fonction:0,avantages:"Logement Élysée, sécurité, avion présidentiel",mandat_debut:"2017",conflits:[],liens_cac40:["Rothschild & Co (associé-gérant 2008-2012)"],nepotisme:[],pantouflage:"Inspecteur des finances → Rothschild → Ministère Économie → Élysée"},
  {id:"francois-bayrou",nom:"François Bayrou",prenom:"François",nom_famille:"BAYROU",fonction:"Premier Ministre",ministere:"Matignon",parti:"MoDem",age:73,salaire_base:10680,frais_mandat:5645,indemnite_fonction:2000,avantages:"Hôtel Matignon, voiture, chef cuisinier",mandat_debut:"2024",conflits:["Affaire assistants MoDem · classée sans suite (2020)"],liens_cac40:[],nepotisme:["Épouse Élisabeth Bayrou, conseillère régionale"],pantouflage:""},
  {id:"elisabeth-borne",nom:"Élisabeth Borne",prenom:"Élisabeth",nom_famille:"BORNE",fonction:"Ministre de l'Éducation nationale",ministere:"Éducation Nationale",parti:"Renaissance",age:63,salaire_base:9940,frais_mandat:5645,indemnite_fonction:1500,avantages:"Voiture, cabinet ministériel",mandat_debut:"2024",conflits:[],liens_cac40:["EDF (PDG 2020-2022)","RATP (PDG 2015-2017)"],nepotisme:[],pantouflage:"ENA → RATP → EDF → PM → Ministre"},
  {id:"jean-noel-barrot",nom:"Jean-Noël Barrot",prenom:"Jean-Noël",nom_famille:"BARROT",fonction:"Ministre des Affaires Étrangères",ministere:"Quai d'Orsay",parti:"MoDem",age:40,salaire_base:9940,frais_mandat:5645,indemnite_fonction:1500,avantages:"Voiture, protection diplomatique",mandat_debut:"2024",conflits:[],liens_cac40:[],nepotisme:["Père Jacques Barrot, VP Commission Européenne"],pantouflage:""},
  {id:"bruno-retailleau",nom:"Bruno Retailleau",prenom:"Bruno",nom_famille:"RETAILLEAU",fonction:"Ministre de l'Intérieur",ministere:"Place Beauvau",parti:"LR",age:63,salaire_base:9940,frais_mandat:5645,indemnite_fonction:1500,avantages:"Logement, voiture blindée, protection",mandat_debut:"2024",conflits:[],liens_cac40:[],nepotisme:[],pantouflage:""},
  {id:"eric-lombard",nom:"Éric Lombard",prenom:"Éric",nom_famille:"LOMBARD",fonction:"Ministre de l'Économie et des Finances",ministere:"Bercy",parti:"Sans étiquette",age:61,salaire_base:9940,frais_mandat:5645,indemnite_fonction:1500,avantages:"Voiture, cabinet",mandat_debut:"2025",conflits:[],liens_cac40:["Caisse des Dépôts (DG 2017-2025)","BNP Paribas","Generali France (PDG)"],nepotisme:[],pantouflage:"BNP → Generali → Caisse des Dépôts → Bercy"},
  {id:"rachida-dati",nom:"Rachida Dati",prenom:"Rachida",nom_famille:"DATI",fonction:"Ministre de la Culture",ministere:"Culture",parti:"LR",age:58,salaire_base:9940,frais_mandat:5645,indemnite_fonction:1500,avantages:"Voiture, cabinet",mandat_debut:"2024",conflits:["Mise en examen corruption active / Sony Music (2021)"],liens_cac40:["Sony Music France (consultante ~900k€)"],nepotisme:[],pantouflage:"Garde des Sceaux → Avocate → Consultante Sony → Ministre"},
  {id:"sebastien-lecornu",nom:"Sébastien Lecornu",prenom:"Sébastien",nom_famille:"LECORNU",fonction:"Ministre des Armées",ministere:"Armées",parti:"Renaissance",age:38,salaire_base:9940,frais_mandat:5645,indemnite_fonction:1500,avantages:"Voiture blindée, protection militaire",mandat_debut:"2024",conflits:[],liens_cac40:[],nepotisme:[],pantouflage:""},
  {id:"catherine-vautrin",nom:"Catherine Vautrin",prenom:"Catherine",nom_famille:"VAUTRIN",fonction:"Ministre du Travail et de la Santé",ministere:"Travail/Santé",parti:"Renaissance",age:59,salaire_base:9940,frais_mandat:5645,indemnite_fonction:1500,avantages:"Voiture, deux cabinets fusionnés",mandat_debut:"2024",conflits:[],liens_cac40:[],nepotisme:[],pantouflage:""},
  {id:"gerald-darmanin",nom:"Gérald Darmanin",prenom:"Gérald",nom_famille:"DARMANIN",fonction:"Ministre de la Justice",ministere:"Justice",parti:"Renaissance",age:41,salaire_base:9940,frais_mandat:5645,indemnite_fonction:1500,avantages:"Voiture blindée, protection permanente",mandat_debut:"2024",conflits:["Plainte pour viol · Non-lieu définitif (2022)"],liens_cac40:[],nepotisme:[],pantouflage:""},
];

app.get("/api/gouvernement", (req, res) => res.json({ gouvernement: GOUV }));

// ── EURODÉPUTÉS FRANÇAIS (terme 2024-2029) ────────────────────
const EURODEPUTES = [
  // Rassemblement National (30 sièges)
  {id:'jordan-bardella',nom:'Jordan Bardella',prenom:'Jordan',nom_famille:'BARDELLA',parti:'RN',groupe_pe:'PfE',commission:'Affaires étrangères',mandat_debut:'2019',age:29,salaire_base:8757,frais_mandat:4778,avantages:'Indemnité générale 4 513€, frais séjour 350€/jour',conflits:[],liens_cac40:[],nepotisme:['Compagnon Marion Maréchal, famille Le Pen'],pantouflage:''},
  {id:'marine-le-pen',nom:'Marine Le Pen',prenom:'Marine',nom_famille:'LE PEN',parti:'RN',groupe_pe:'PfE',commission:'',mandat_debut:'2022',age:56,salaire_base:8757,frais_mandat:4778,avantages:'',conflits:['Condamnée emplois fictifs PE · 5 ans inéligibilité (appel 2025)'],liens_cac40:[],nepotisme:['Père Jean-Marie Le Pen · fondateur FN'],pantouflage:''},
  {id:'jean-paul-garraud',nom:'Jean-Paul Garraud',prenom:'Jean-Paul',nom_famille:'GARRAUD',parti:'RN',groupe_pe:'PfE',commission:'Libertés civiles',mandat_debut:'2024',age:66,salaire_base:8757,frais_mandat:4778,avantages:'',conflits:[],liens_cac40:[],nepotisme:[],pantouflage:'Juge → Député → Eurodéputé'},
  {id:'thierry-mariani',nom:'Thierry Mariani',prenom:'Thierry',nom_famille:'MARIANI',parti:'RN',groupe_pe:'PfE',commission:'Transports',mandat_debut:'2019',age:64,salaire_base:8757,frais_mandat:4778,avantages:'',conflits:[],liens_cac40:[],nepotisme:[],pantouflage:'LR → RN'},
  {id:'gilbert-collard',nom:'Gilbert Collard',prenom:'Gilbert',nom_famille:'COLLARD',parti:'RN',groupe_pe:'PfE',commission:'Affaires juridiques',mandat_debut:'2019',age:76,salaire_base:8757,frais_mandat:4778,avantages:'',conflits:[],liens_cac40:[],nepotisme:[],pantouflage:'Avocat → Député → Eurodéputé'},
  // Renaissance/Macron (13 sièges)
  {id:'valerie-hayer',nom:'Valérie Hayer',prenom:'Valérie',nom_famille:'HAYER',parti:'Renaissance',groupe_pe:'Renew',commission:'Budget',mandat_debut:'2019',age:38,salaire_base:8757,frais_mandat:4778,avantages:'Présidente groupe Renew',conflits:[],liens_cac40:[],nepotisme:[],pantouflage:''},
  {id:'pascal-canfin',nom:'Pascal Canfin',prenom:'Pascal',nom_famille:'CANFIN',parti:'Renaissance',groupe_pe:'Renew',commission:'Environnement (Président)',mandat_debut:'2019',age:49,salaire_base:8757,frais_mandat:4778,avantages:'Président commission ENVI',conflits:[],liens_cac40:['WWF France (ex-DG)'],nepotisme:[],pantouflage:'ONG → Politique → ONG → Politique'},
  {id:'nathalie-colin-oesterle',nom:'Nathalie Colin-Oesterlé',prenom:'Nathalie',nom_famille:'COLIN-OESTERLÉ',parti:'LR',groupe_pe:'PPE',commission:'Industrie',mandat_debut:'2019',age:55,salaire_base:8757,frais_mandat:4778,avantages:'',conflits:[],liens_cac40:[],nepotisme:[],pantouflage:''},
  // La France Insoumise (6 sièges)
  {id:'manon-aubry',nom:'Manon Aubry',prenom:'Manon',nom_famille:'AUBRY',parti:'LFI',groupe_pe:'La Gauche',commission:'Affaires juridiques',mandat_debut:'2019',age:34,salaire_base:8757,frais_mandat:4778,avantages:'Co-présidente groupe La Gauche',conflits:[],liens_cac40:[],nepotisme:[],pantouflage:''},
  {id:'rima-hassan',nom:'Rima Hassan',prenom:'Rima',nom_famille:'HASSAN',parti:'LFI',groupe_pe:'La Gauche',commission:'Affaires étrangères',mandat_debut:'2024',age:37,salaire_base:8757,frais_mandat:4778,avantages:'',conflits:[],liens_cac40:[],nepotisme:[],pantouflage:'Avocate → Eurodéputée'},
  // PS-Place Publique (13 sièges)
  {id:'raphael-glucksmann',nom:'Raphaël Glucksmann',prenom:'Raphaël',nom_famille:'GLUCKSMANN',parti:'PS-PP',groupe_pe:'S&D',commission:'Commerce international',mandat_debut:'2019',age:44,salaire_base:8757,frais_mandat:4778,avantages:'',conflits:[],liens_cac40:[],nepotisme:['Père André Glucksmann · philosophe'],pantouflage:'Documentariste → Politique'},
  {id:'olivier-faure',nom:'Olivier Faure',prenom:'Olivier',nom_famille:'FAURE',parti:'PS',groupe_pe:'S&D',commission:'',mandat_debut:'2024',age:54,salaire_base:8757,frais_mandat:4778,avantages:'',conflits:[],liens_cac40:[],nepotisme:[],pantouflage:''},
  // Les Républicains (6 sièges)
  {id:'francois-xavier-bellamy',nom:'François-Xavier Bellamy',prenom:'François-Xavier',nom_famille:'BELLAMY',parti:'LR',groupe_pe:'PPE',commission:'Environnement',mandat_debut:'2019',age:38,salaire_base:8757,frais_mandat:4778,avantages:'',conflits:[],liens_cac40:[],nepotisme:[],pantouflage:'Prof philosophie → Politique'},
  {id:'jerome-lavrilleux',nom:'Jérôme Lavrilleux',prenom:'Jérôme',nom_famille:'LAVRILLEUX',parti:'LR',groupe_pe:'PPE',commission:'',mandat_debut:'2014',age:57,salaire_base:8757,frais_mandat:4778,avantages:'',conflits:['Affaire Bygmalion · condamné'],liens_cac40:[],nepotisme:[],pantouflage:''},
  // EELV (6 sièges)
  {id:'yannick-jadot',nom:'Yannick Jadot',prenom:'Yannick',nom_famille:'JADOT',parti:'EELV',groupe_pe:'Verts/ALE',commission:'Environnement',mandat_debut:'2009',age:57,salaire_base:8757,frais_mandat:4778,avantages:'',conflits:[],liens_cac40:[],nepotisme:[],pantouflage:'Greenpeace (DG) → Politique'},
  {id:'marie-toussaint',nom:'Marie Toussaint',prenom:'Marie',nom_famille:'TOUSSAINT',parti:'EELV',groupe_pe:'Verts/ALE',commission:'Environnement',mandat_debut:'2019',age:38,salaire_base:8757,frais_mandat:4778,avantages:'',conflits:[],liens_cac40:[],nepotisme:[],pantouflage:''},
  // Reconquête (5 sièges)
  {id:'eric-zemmour',nom:'Éric Zemmour',prenom:'Éric',nom_famille:'ZEMMOUR',parti:'Reconquête',groupe_pe:'ECR',commission:'',mandat_debut:'2024',age:65,salaire_base:8757,frais_mandat:4778,avantages:'',conflits:['Condamné provocation haine raciale (2011)','Condamné incitation discrimination (2022)'],liens_cac40:[],nepotisme:[],pantouflage:'Journaliste → Politique'},
  {id:'marion-marechal',nom:'Marion Maréchal',prenom:'Marion',nom_famille:'MARÉCHAL',parti:'Reconquête',groupe_pe:'ECR',commission:'Culture',mandat_debut:'2024',age:34,salaire_base:8757,frais_mandat:4778,avantages:'',conflits:[],liens_cac40:[],nepotisme:['Grand-père Jean-Marie Le Pen','Tante Marine Le Pen'],pantouflage:''},
];

app.get('/api/eurodeputes', (req, res) => res.json({ eurodeputes: EURODEPUTES, total: EURODEPUTES.length }));

// ── ANCIENS ÉLUS (COMPLET depuis 1958) ────────────────────────
const ANCIENS = [
  // Présidents de la République
  {id:"charles-de-gaulle",nom:"Charles de Gaulle",prenom:"Charles",nom_famille:"DE GAULLE",fonction:"Président de la République",periode:"1959-1969",parti:"Gaulliste",retraite:0,conflits:[],liens_cac40:[],nepotisme:[],pantouflage:''},
  {id:"georges-pompidou",nom:"Georges Pompidou",prenom:"Georges",nom_famille:"POMPIDOU",fonction:"Président de la République",periode:"1969-1974",parti:"Gaulliste",retraite:0,conflits:[],liens_cac40:['Banque Rothschild (ex-DG)'],nepotisme:[],pantouflage:'Banque Rothschild → PM → Président'},
  {id:"valery-giscard-d-estaing",nom:"Valéry Giscard d'Estaing",prenom:"Valéry",nom_famille:"GISCARD D'ESTAING",fonction:"Président de la République",periode:"1974-1981",parti:"Centre",retraite:0,conflits:['Affaire diamants de Bokassa'],liens_cac40:[],nepotisme:[],pantouflage:''},
  {id:"francois-mitterrand",nom:"François Mitterrand",prenom:"François",nom_famille:"MITTERRAND",fonction:"Président de la République",periode:"1981-1995",parti:"PS",retraite:0,conflits:['Écoutes téléphoniques illégales (Élysée)','Liens Vichy pendant la guerre'],liens_cac40:[],nepotisme:['Fils Gilbert Mitterrand · président fondation'],pantouflage:''},
  {id:"jacques-chirac",nom:"Jacques Chirac",prenom:"Jacques",nom_famille:"CHIRAC",fonction:"Président de la République",periode:"1995-2007",parti:"RPR/UMP",retraite:0,conflits:['Condamné emplois fictifs ville de Paris · 2 ans sursis (2011)'],liens_cac40:[],nepotisme:[],pantouflage:''},
  {id:"nicolas-sarkozy",nom:"Nicolas Sarkozy",prenom:"Nicolas",nom_famille:"SARKOZY",fonction:"Président de la République",periode:"2007-2012",parti:"UMP/LR",retraite:6220,conflits:['Condamné Bismuth 3 ans dont 1 ferme (2021-2023)','Condamné Bygmalion 1 an ferme (2023)','En procès affaire Kadhafi'],liens_cac40:['Total (conseil administration)'],nepotisme:[],pantouflage:'Avocat → Politique → Avocat affaires (Cravath)'},
  {id:"francois-hollande",nom:"François Hollande",prenom:"François",nom_famille:"HOLLANDE",fonction:"Président de la République",periode:"2012-2017",parti:"PS",retraite:6220,conflits:[],liens_cac40:[],nepotisme:[],pantouflage:''},
  // Premiers Ministres depuis 1958
  {id:"michel-debre",nom:"Michel Debré",prenom:"Michel",nom_famille:"DEBRÉ",fonction:"Premier Ministre",periode:"1959-1962",parti:"Gaulliste",retraite:0,conflits:[],liens_cac40:[],nepotisme:[],pantouflage:''},
  {id:"georges-pompidou-pm",nom:"Georges Pompidou (PM)",prenom:"Georges",nom_famille:"POMPIDOU",fonction:"Premier Ministre",periode:"1962-1968",parti:"Gaulliste",retraite:0,conflits:[],liens_cac40:['Banque Rothschild'],nepotisme:[],pantouflage:'Rothschild → PM → Président'},
  {id:"jacques-chaban-delmas",nom:"Jacques Chaban-Delmas",prenom:"Jacques",nom_famille:"CHABAN-DELMAS",fonction:"Premier Ministre",periode:"1969-1972",parti:"Gaulliste",retraite:0,conflits:['Affaire fiscale (1972)'],liens_cac40:[],nepotisme:[],pantouflage:''},
  {id:"pierre-messmer",nom:"Pierre Messmer",prenom:"Pierre",nom_famille:"MESSMER",fonction:"Premier Ministre",periode:"1972-1974",parti:"Gaulliste",retraite:0,conflits:[],liens_cac40:[],nepotisme:[],pantouflage:''},
  {id:"jacques-chirac-pm",nom:"Jacques Chirac (PM)",prenom:"Jacques",nom_famille:"CHIRAC",fonction:"Premier Ministre",periode:"1974-1976",parti:"RPR",retraite:0,conflits:[],liens_cac40:[],nepotisme:[],pantouflage:''},
  {id:"raymond-barre",nom:"Raymond Barre",prenom:"Raymond",nom_famille:"BARRE",fonction:"Premier Ministre",periode:"1976-1981",parti:"Centre",retraite:0,conflits:[],liens_cac40:[],nepotisme:[],pantouflage:'Professeur économie → Politique → Maire Lyon'},
  {id:"pierre-mauroy",nom:"Pierre Mauroy",prenom:"Pierre",nom_famille:"MAUROY",fonction:"Premier Ministre",periode:"1981-1984",parti:"PS",retraite:0,conflits:[],liens_cac40:[],nepotisme:[],pantouflage:''},
  {id:"laurent-fabius-pm",nom:"Laurent Fabius (PM)",prenom:"Laurent",nom_famille:"FABIUS",fonction:"Premier Ministre",periode:"1984-1986",parti:"PS",retraite:0,conflits:['Affaire sang contaminé · acquitté (2003)'],liens_cac40:[],nepotisme:[],pantouflage:''},
  {id:"jacques-chirac-pm2",nom:"Jacques Chirac (PM 2ème)",prenom:"Jacques",nom_famille:"CHIRAC",fonction:"Premier Ministre",periode:"1986-1988",parti:"RPR",retraite:0,conflits:[],liens_cac40:[],nepotisme:[],pantouflage:''},
  {id:"michel-rocard",nom:"Michel Rocard",prenom:"Michel",nom_famille:"ROCARD",fonction:"Premier Ministre",periode:"1988-1991",parti:"PS",retraite:0,conflits:[],liens_cac40:[],nepotisme:[],pantouflage:''},
  {id:"edith-cresson",nom:"Édith Cresson",prenom:"Édith",nom_famille:"CRESSON",fonction:"Première Ministre",periode:"1991-1992",parti:"PS",retraite:0,conflits:['Affaire emplois fictifs PE · condamnée'],liens_cac40:[],nepotisme:['Nomination ami dentiste Pingeot comme conseiller'],pantouflage:''},
  {id:"pierre-beregovoy",nom:"Pierre Bérégovoy",prenom:"Pierre",nom_famille:"BÉRÉGOVOY",fonction:"Premier Ministre",periode:"1992-1993",parti:"PS",retraite:0,conflits:[],liens_cac40:[],nepotisme:[],pantouflage:''},
  {id:"edouard-balladur",nom:"Édouard Balladur",prenom:"Édouard",nom_famille:"BALLADUR",fonction:"Premier Ministre",periode:"1993-1995",parti:"RPR",retraite:6220,conflits:['Affaire Karachi · non-lieu (2020)'],liens_cac40:[],nepotisme:[],pantouflage:''},
  {id:"alain-juppe-pm",nom:"Alain Juppé (PM)",prenom:"Alain",nom_famille:"JUPPÉ",fonction:"Premier Ministre",periode:"1995-1997",parti:"RPR",retraite:0,conflits:['Condamné emplois fictifs RPR · 14 mois sursis (2004)'],liens_cac40:[],nepotisme:[],pantouflage:'ENA → Politique → Maire Bordeaux → CC'},
  {id:"lionel-jospin",nom:"Lionel Jospin",prenom:"Lionel",nom_famille:"JOSPIN",fonction:"Premier Ministre",periode:"1997-2002",parti:"PS",retraite:6220,conflits:[],liens_cac40:[],nepotisme:[],pantouflage:''},
  {id:"jean-pierre-raffarin",nom:"Jean-Pierre Raffarin",prenom:"Jean-Pierre",nom_famille:"RAFFARIN",fonction:"Premier Ministre",periode:"2002-2004",parti:"UMP",retraite:6220,conflits:[],liens_cac40:[],nepotisme:[],pantouflage:'Consultant → Politique → Sénateur'},
  {id:"dominique-de-villepin",nom:"Dominique de Villepin",prenom:"Dominique",nom_famille:"DE VILLEPIN",fonction:"Premier Ministre",periode:"2005-2007",parti:"UMP",retraite:0,conflits:['Affaire Clearstream · non-lieu'],liens_cac40:['Total (conseil stratégique)'],nepotisme:[],pantouflage:'Diplomate → Politique → Conseil grandes entreprises'},
  {id:"francois-fillon",nom:"François Fillon",prenom:"François",nom_famille:"FILLON",fonction:"Premier Ministre",periode:"2007-2012",parti:"UMP/LR",retraite:0,conflits:['Condamné Penelope Gate 5 ans dont 3 ferme (2022)'],liens_cac40:['Vinogradoff (admin)','Zarubezhneft Russie (admin)'],nepotisme:['Épouse Penelope employée fictive'],pantouflage:'Politique → Administrateur Russie'},
  {id:"jean-marc-ayrault",nom:"Jean-Marc Ayrault",prenom:"Jean-Marc",nom_famille:"AYRAULT",fonction:"Premier Ministre",periode:"2012-2014",parti:"PS",retraite:6220,conflits:[],liens_cac40:[],nepotisme:[],pantouflage:''},
  {id:"manuel-valls",nom:"Manuel Valls",prenom:"Manuel",nom_famille:"VALLS",fonction:"Premier Ministre",periode:"2014-2016",parti:"PS",retraite:0,conflits:[],liens_cac40:[],nepotisme:[],pantouflage:'Politique France → Politique Espagne → Barcelone'},
  {id:"bernard-cazeneuve",nom:"Bernard Cazeneuve",prenom:"Bernard",nom_famille:"CAZENEUVE",fonction:"Premier Ministre",periode:"2016-2017",parti:"PS",retraite:0,conflits:[],liens_cac40:[],nepotisme:[],pantouflage:''},
  {id:"edouard-philippe",nom:"Édouard Philippe",prenom:"Édouard",nom_famille:"PHILIPPE",fonction:"Premier Ministre",periode:"2017-2020",parti:"LR/Horizons",retraite:0,conflits:[],liens_cac40:[],nepotisme:[],pantouflage:'Avocat → Areva (DGA) → PM → Maire Le Havre'},
  {id:"jean-castex",nom:"Jean Castex",prenom:"Jean",nom_famille:"CASTEX",fonction:"Premier Ministre",periode:"2020-2022",parti:"LR",retraite:0,conflits:[],liens_cac40:['RATP (PDG 2022-2024)'],nepotisme:[],pantouflage:'Haut fonctionnaire → PM → PDG RATP'},
  {id:"elisabeth-borne-pm",nom:"Élisabeth Borne (PM)",prenom:"Élisabeth",nom_famille:"BORNE",fonction:"Première Ministre",periode:"2022-2024",parti:"Renaissance",retraite:0,conflits:[],liens_cac40:['EDF (PDG)','RATP (PDG)'],nepotisme:[],pantouflage:'ENA → RATP → EDF → PM → Ministre'},
  {id:"gabriel-attal",nom:"Gabriel Attal",prenom:"Gabriel",nom_famille:"ATTAL",fonction:"Premier Ministre",periode:"2024-2024",parti:"Renaissance",retraite:0,conflits:[],liens_cac40:[],nepotisme:[],pantouflage:''},
  {id:"michel-barnier",nom:"Michel Barnier",prenom:"Michel",nom_famille:"BARNIER",fonction:"Premier Ministre",periode:"2024-2024",parti:"LR",retraite:0,conflits:[],liens_cac40:[],nepotisme:[],pantouflage:'Politique → Commissaire EU → Négociateur Brexit → PM'},
  // Figures politiques majeures
  {id:"marine-le-pen",nom:"Marine Le Pen",prenom:"Marine",nom_famille:"LE PEN",fonction:"Ancienne présidente RN",periode:"2004-2024",parti:"RN",retraite:0,conflits:["Condamnée emplois fictifs PE · 5 ans inéligibilité (appel 2025)"],liens_cac40:[],nepotisme:['Père Jean-Marie Le Pen · fondateur FN'],pantouflage:''},
  {id:"jean-luc-melenchon",nom:"Jean-Luc Mélenchon",prenom:"Jean-Luc",nom_famille:"MÉLENCHON",fonction:"Fondateur LFI",periode:"1986-2024",parti:"LFI",retraite:8200,conflits:["Condamné obstruction perquisitions 3 mois sursis"],liens_cac40:[],nepotisme:[],pantouflage:''},
  {id:"jordan-bardella-an",nom:"Jordan Bardella (Pdt RN)",prenom:"Jordan",nom_famille:"BARDELLA",fonction:"Président RN",periode:"2022-présent",parti:"RN",retraite:0,conflits:[],liens_cac40:[],nepotisme:['Compagnon Marion Maréchal'],pantouflage:''},
  {id:"eric-zemmour",nom:"Éric Zemmour",prenom:"Éric",nom_famille:"ZEMMOUR",fonction:"Fondateur Reconquête",periode:"2021-présent",parti:"Reconquête",retraite:0,conflits:['Condamné provocation haine raciale (2011)','Condamné incitation discrimination (2022)'],liens_cac40:[],nepotisme:[],pantouflage:'Journaliste → Politique'},
];

app.get("/api/anciens-elus", (req, res) => res.json({ anciens: ANCIENS }));

// ── CONSEIL CONSTITUTIONNEL ────────────────────────────────────
const CC = [
  {id:"laurent-fabius",nom:"Laurent Fabius",prenom:"Laurent",nom_famille:"FABIUS",fonction:"Président",depuis:2016,salaire_base:14000,conflits:["Affaire sang contaminé · acquitté (2003)"]},
  {id:"jacqueline-gourault",nom:"Jacqueline Gourault",prenom:"Jacqueline",nom_famille:"GOURAULT",fonction:"Membre",depuis:2022,salaire_base:13000,conflits:[]},
  {id:"alain-juppe",nom:"Alain Juppé",prenom:"Alain",nom_famille:"JUPPÉ",fonction:"Membre",depuis:2019,salaire_base:13000,conflits:["Condamné emplois fictifs RPR (2004)"]},
  {id:"philippe-bas",nom:"Philippe Bas",prenom:"Philippe",nom_famille:"BAS",fonction:"Membre",depuis:2022,salaire_base:13000,conflits:[]},
  {id:"veronique-malbec",nom:"Véronique Malbec",prenom:"Véronique",nom_famille:"MALBEC",fonction:"Membre",depuis:2022,salaire_base:13000,conflits:[]},
  {id:"francois-seners",nom:"François Séners",prenom:"François",nom_famille:"SÉNERS",fonction:"Membre",depuis:2022,salaire_base:13000,conflits:[]},
  {id:"corinne-luquiens",nom:"Corinne Luquiens",prenom:"Corinne",nom_famille:"LUQUIENS",fonction:"Membre",depuis:2019,salaire_base:13000,conflits:[]},
  {id:"michel-pinault",nom:"Michel Pinault",prenom:"Michel",nom_famille:"PINAULT",fonction:"Membre",depuis:2022,salaire_base:13000,conflits:[]},
  {id:"francoise-dumont",nom:"Françoise Dumont",prenom:"Françoise",nom_famille:"DUMONT",fonction:"Membre",depuis:2019,salaire_base:13000,conflits:[]},
];

app.get("/api/conseil-constitutionnel", (req, res) => res.json({ membres: CC }));

// ── PRÉFETS ────────────────────────────────────────────────────
const PREFETS = [
  {id:"pref-75",nom:"Laurent Nuñez",departement:"Paris (75)",region:"Île-de-France",salaire_base:8500},
  {id:"pref-69",nom:"Fabienne Buccio",departement:"Rhône (69)",region:"Auvergne-Rhône-Alpes",salaire_base:7800},
  {id:"pref-13",nom:"Christophe Mirmand",departement:"Bouches-du-Rhône (13)",region:"PACA",salaire_base:7800},
  {id:"pref-33",nom:"Étienne Guyot",departement:"Gironde (33)",region:"Nouvelle-Aquitaine",salaire_base:7800},
  {id:"pref-31",nom:"Pierre-André Durand",departement:"Haute-Garonne (31)",region:"Occitanie",salaire_base:7800},
  {id:"pref-59",nom:"Bertrand Gaume",departement:"Nord (59)",region:"Hauts-de-France",salaire_base:7800},
  {id:"pref-67",nom:"Josiane Chevalier",departement:"Bas-Rhin (67)",region:"Grand Est",salaire_base:7800},
  {id:"pref-44",nom:"Fabrice Rigoulet-Roze",departement:"Loire-Atlantique (44)",region:"Pays de la Loire",salaire_base:7800},
  {id:"pref-76",nom:"Pierre-Edouard Colliex",departement:"Seine-Maritime (76)",region:"Normandie",salaire_base:7800},
  {id:"pref-34",nom:"François-Xavier Lauch",departement:"Hérault (34)",region:"Occitanie",salaire_base:7800},
];

app.get("/api/prefets", (req, res) => res.json({ prefets: PREFETS }));

// ── RECHERCHE ──────────────────────────────────────────────────
app.get("/api/search/:q", async (req, res) => {
  const q = (req.params.q || "").toLowerCase();
  const localResults = [
    ...GOUV.map(m => ({ ...m, role: m.fonction, dept: m.ministere, cat: "gouvernement" })),
    ...ANCIENS.map(a => ({ ...a, role: a.fonction, dept: a.periode, cat: "anciens-elus" })),
    ...CC.map(c => ({ ...c, role: c.fonction, dept: "Conseil Constitutionnel", cat: "conseil-constitutionnel" })),
  ].filter(x => x.nom.toLowerCase().includes(q)).slice(0, 5);

  try {
    const [r1, r2] = await Promise.allSettled([
      get(`https://www.nosdeputes.fr/recherche/${encodeURIComponent(req.params.q)}/json`),
      get(`https://tabular-api.data.gouv.fr/api/resources/${RNE.maires}/data/?page_size=3&Nom__contains=${encodeURIComponent(req.params.q)}`),
    ]);
    const deps = r1.status === "fulfilled" ? (r1.value?.deputes || []).map(x => ({ ...(x.depute || x), cat: "deputes" })).slice(0, 4) : [];
    const maires = r2.status === "fulfilled" ? (r2.value?.data || []).map(r => ({
      id: r.CodeElu || "", nom: `${r.Prenom||""} ${r.Nom||""}`.trim(),
      prenom: r.Prenom||"", nom_famille: (r.Nom||"").toUpperCase(),
      role: r.LibelleQualite||"Élu local", dept: r.LibelleCommune||"", cat: "maires",
    })).slice(0, 2) : [];
    res.json({ results: [...localResults, ...deps, ...maires] });
  } catch(e) {
    res.json({ results: localResults });
  }
});

// ── IA ─────────────────────────────────────────────────────────
app.post("/ia", async (req, res) => {
  const { messages } = req.body;
  if (!messages) return res.status(400).json({ error: "messages requis" });
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
        system: "Tu es l'assistant de TransparenceFrance.fr. Tu réponds aux questions sur les élus français : coûts, votes, patrimoine, affaires judiciaires, réseaux d'influence. Tu es factuel et cites tes sources officielles.",
        messages: messages.slice(-10),
      }),
    });
    const d = await r.json();
    res.json({ content: d.content?.[0]?.text || "Désolé, impossible de répondre." });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── STATUS ─────────────────────────────────────────────────────
app.get("/", (req, res) => res.json({
  status: "✅ TransparenceFrance API v6",
  legifrance: !!process.env.LEGIFRANCE_CLIENT_ID ? "✅" : "⚠️ Non configuré",
  routes: ["/api/deputes", "/api/depute/:slug/votes", "/api/senateurs", "/api/gouvernement", "/api/anciens-elus", "/api/conseil-constitutionnel", "/api/prefets", "/api/rne/maires", "/api/rne/conseillers-dept", "/api/rne/conseillers-region", "/api/lois", "/api/hatvp/declarations", "/api/scrutins", "/api/search/:q", "/img", "/ia"],
}));

// Préchargement au démarrage
async function preload() {
  console.log("🔄 Préchargement des données...");
  
  // Précharger sénateurs avec retry
  for (let i = 0; i < 3; i++) {
    try {
      const d = await get("https://data.senat.fr/data/senateurs/ODSEN_GENERAL.json");
      let arr = Array.isArray(d) ? d : [];
      if (!arr.length && d && typeof d === 'object') {
        for (const key of Object.keys(d)) {
          if (Array.isArray(d[key]) && d[key].length > 0) { arr = d[key]; break; }
        }
      }
      if (arr.length > 0) {
        CACHE["sen1"] = { d: arr, t: Date.now() };
        console.log(`✅ Sénateurs préchargés: ${arr.length}`);
        break;
      }
    } catch(e) {
      console.log(`⚠️ Sénat tentative ${i+1}: ${e.message}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // Précharger députés
  try {
    const d = await get("https://www.nosdeputes.fr/deputes/json");
    const deps = (d?.deputes || []).map(x => x.depute || x);
    if (deps.length > 0) {
      CACHE["dep"] = { d: { deputes: deps }, t: Date.now() };
      console.log(`✅ Députés préchargés: ${deps.length}`);
    }
  } catch(e) { console.log("⚠️ Députés:", e.message); }

  // Précharger lois via Légifrance si clés disponibles
  if (process.env.LEGIFRANCE_CLIENT_ID) {
    try {
      await getLoisLegifrance("");
      console.log("✅ Légifrance initialisé");
    } catch(e) { console.log("⚠️ Légifrance:", e.message); }
  }
  
  console.log("✅ Préchargement terminé");
}

app.listen(PORT, async () => {
  console.log(`✅ TransparenceFrance v6 — port ${PORT}`);
  preload().catch(console.error);
});
