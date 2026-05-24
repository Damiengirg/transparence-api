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
    const arr = Array.isArray(d) ? d : [];
    if (arr.length > 0) {
      return res.json({ senateurs: arr.map(s => ({
        slug: `${s.PRENOM||""}-${s.NOM||""}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z-]/g,"-").replace(/-+/g,"-"),
        prenom: s.PRENOM || "", nom_de_famille: s.NOM || "",
        nom: `${s.PRENOM||""} ${s.NOM||""}`.trim(),
        groupe_sigle: s.GROUPE_POLITIQUE_SIGLE || "",
        nom_circo: s.DEPARTEMENT || "",
        date_debut_mandat: s.DATE_DEBUT_MANDAT || "",
      }))});
    }
  } catch(e1) {}
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
  try { res.json(await rne(RNE.maires, q, dept, page, Math.min(+page_size,100))); }
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
  const cid = process.env.LEGIFRANCE_CLIENT_ID;
  const csec = process.env.LEGIFRANCE_CLIENT_SECRET;
  if (cid && csec) {
    try {
      let token = CACHE._legiToken;
      if (!token || Date.now() > CACHE._legiExpiry) {
        const tr = await fetch("https://oauth.piste.gouv.fr/api/oauth/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type:"client_credentials", client_id:cid, client_secret:csec, scope:"openid" }),
          signal: AbortSignal.timeout(8000),
        });
        const td = await tr.json();
        token = td.access_token;
        CACHE._legiToken = token;
        CACHE._legiExpiry = Date.now() + (td.expires_in - 60) * 1000;
      }
      const body = {
        recherche: {
          champs: [{ typeChamp:"TITLE", criteres:[{ typeRecherche:"CONTIENT", valeur: q||"loi" }] }],
          filtres: [{ facette:"NATURE", valeur:"LOI" }],
          pageNumber: +page, pageSize: +page_size, sort:"PERTINENCE", typePagination:"DEFAUT",
        }
      };
      const lr = await fetch("https://api.piste.gouv.fr/dila/legifrance/lf-engine-app/search", {
        method:"POST",
        headers:{ Authorization:`Bearer ${token}`, "Content-Type":"application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      const ld = await lr.json();
      if (ld.results?.length > 0) {
        return res.json({
          lois: ld.results.map(l => ({
            titre: l.title||l.titre, numero: l.numero,
            date: l.dateTexte||l.date, categorie: "Loi",
            url: `https://www.legifrance.gouv.fr/loda/id/${l.id}`,
          })),
          total: ld.totalResultNumber || 0,
          source: "legifrance"
        });
      }
    } catch(le) { console.log("Légifrance:", le.message); }
  }

  // Fallback statique
  const filtered = q ? LOIS.filter(l => l.titre.toLowerCase().includes(q.toLowerCase())) : LOIS;
  const p = +page - 1; const ps = +page_size;
  res.json({ lois: filtered.slice(p*ps, (p+1)*ps), total: filtered.length, source: "statique" });
});

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

// ── ANCIENS ÉLUS ──────────────────────────────────────────────
const ANCIENS = [
  {id:"nicolas-sarkozy",nom:"Nicolas Sarkozy",prenom:"Nicolas",nom_famille:"SARKOZY",fonction:"Ancien Président",periode:"2007-2012",parti:"LR",retraite:6220,conflits:["Condamné Bismuth 3 ans dont 1 ferme","Condamné Bygmalion 1 an ferme","En procès Kadhafi"],liens_cac40:["Total (conseil)"]},
  {id:"francois-hollande",nom:"François Hollande",prenom:"François",nom_famille:"HOLLANDE",fonction:"Ancien Président",periode:"2012-2017",parti:"PS",retraite:6220,conflits:[],liens_cac40:[]},
  {id:"francois-fillon",nom:"François Fillon",prenom:"François",nom_famille:"FILLON",fonction:"Ancien Premier Ministre",periode:"2007-2012",parti:"LR",retraite:0,conflits:["Condamné Penelope Gate 5 ans dont 3 ferme (2022)"],liens_cac40:["Vinogradoff","Zarubezhneft (Russie)"]},
  {id:"marine-le-pen",nom:"Marine Le Pen",prenom:"Marine",nom_famille:"LE PEN",fonction:"Ancienne présidente RN",periode:"2004-2024",parti:"RN",retraite:0,conflits:["Condamnée emplois fictifs PE · 5 ans inéligibilité (appel 2025)"],liens_cac40:[]},
  {id:"jean-luc-melenchon",nom:"Jean-Luc Mélenchon",prenom:"Jean-Luc",nom_famille:"MÉLENCHON",fonction:"Fondateur LFI",periode:"1986-2024",parti:"LFI",retraite:8200,conflits:["Condamné obstruction perquisitions 3 mois sursis"],liens_cac40:[]},
  {id:"edouard-philippe",nom:"Édouard Philippe",prenom:"Édouard",nom_famille:"PHILIPPE",fonction:"Ancien PM, Maire Le Havre",periode:"2017-2020",parti:"Horizons",retraite:0,conflits:[],liens_cac40:[]},
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

app.listen(PORT, () => console.log(`✅ TransparenceFrance v6 — port ${PORT}`));
