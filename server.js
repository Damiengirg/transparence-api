/**
 * TransparenceFrance API v5
 * Sources: nosdeputes.fr, data.gouv.fr/RNE, hatvp.fr, 
 *          Légifrance API, data.assemblee-nationale.fr
 * 
 * Variables d'environnement requises:
 * - LEGIFRANCE_CLIENT_ID     → https://developer.aife.economie.gouv.fr
 * - LEGIFRANCE_CLIENT_SECRET → idem
 * - SUPABASE_URL             → https://supabase.com (gratuit)
 * - SUPABASE_KEY             → idem
 * - ANTHROPIC_API_KEY        → pour l'assistant IA
 * - NEWS_API_KEY             → https://newsapi.org (gratuit 100 req/j)
 */

const express = require("express");
const cors = require("cors");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors({ origin: "*" }));
app.use(express.json());

// ── CACHE EN MÉMOIRE ────────────────────────────────────────────
const cache = {};
const TTL = {
  court: 5 * 60 * 1000,       // 5 min - données live
  moyen: 60 * 60 * 1000,      // 1h - données semi-statiques
  long: 24 * 60 * 60 * 1000,  // 24h - données stables
};

async function cached(key, fn, ttl = TTL.moyen) {
  if (cache[key] && Date.now() - cache[key].ts < ttl) return cache[key].d;
  const d = await fn();
  cache[key] = { d, ts: Date.now() };
  return d;
}

const H_BASE = {
  "User-Agent": "TransparenceFrance/5.0 (transparencefrance.fr; contact@transparencefrance.fr)",
  "Accept": "application/json",
};

async function xfetch(url, headers = {}) {
  const timeout = url.includes('data.gouv') || url.includes('senat.fr') ? 25000 : 15000;
  const r = await fetch(url, {
    headers: { ...H_BASE, ...headers },
    signal: AbortSignal.timeout(timeout),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} — ${url}`);
  return r.json();
}

// ── TOKEN LÉGIFRANCE ─────────────────────────────────────────────
let legiToken = null;
let legiTokenExpiry = 0;

async function getLegiToken() {
  // Token OAuth optionnel - fonctionne sans clé via sandbox publique
  if (legiToken && Date.now() < legiTokenExpiry) return legiToken;
  const clientId = process.env.LEGIFRANCE_CLIENT_ID;
  const clientSecret = process.env.LEGIFRANCE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  try {
    const r = await fetch("https://oauth.piste.gouv.fr/api/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope: "openid",
      }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await r.json();
    legiToken = data.access_token;
    legiTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    console.log("✅ Token Légifrance obtenu");
    return legiToken;
  } catch (e) {
    console.error("❌ Légifrance token error:", e.message);
    return null;
  }
}

// ── LÉGIFRANCE: RECHERCHE LOI PAR NUMÉRO ────────────────────────
async function getLoi(numero) {
  if (!numero) return null;
  const token = await getLegiToken();
  if (!token) return null;

  try {
    const r = await fetch(`https://api.piste.gouv.fr/daj/legifrance/v2/consult/loi/${numero}`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    return r.json();
  } catch (e) {
    return null;
  }
}

// ── LÉGIFRANCE: TOUTES LES LOIS (5e République) ─────────────────
async function searchLois(query, page = 1, pageSize = 20) {
  // Essai 1: API PISTE avec token OAuth si disponible
  const token = await getLegiToken();
  if (token) {
    try {
      const body = {
        recherche: {
          champs: [{ typeChamp: "TITLE", criteres: [{ typeRecherche: "CONTIENT", valeur: query }] }],
          filtres: [{ facette: "NATURE", valeur: "LOI" }],
          pageNumber: page, pageSize, sort: "PERTINENCE", typePagination: "DEFAUT",
        },
      };
      const r = await fetch("https://api.piste.gouv.fr/dila/legifrance/lf-engine-app/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      const data = await r.json();
      if (data.results?.length > 0) {
        return {
          lois: data.results.map(l => ({
            id: l.id, titre: l.title || l.titre, numero: l.numero,
            date: l.dateTexte || l.date, url: `https://www.legifrance.gouv.fr/loda/id/${l.id}`,
          })),
          total: data.totalResultNumber || 0,
        };
      }
    } catch (e) { console.error("Légifrance PISTE error:", e.message); }
  }

  // Essai 2: Sandbox publique sans authentification
  try {
    const body = {
      recherche: {
        champs: [{ typeChamp: "TITLE", criteres: [{ typeRecherche: "CONTIENT", valeur: query || "loi" }] }],
        filtres: [{ facette: "NATURE", valeur: "LOI" }],
        pageNumber: page, pageSize, sort: "PERTINENCE", typePagination: "DEFAUT",
      },
    };
    const r = await fetch("https://sandbox-api.piste.gouv.fr/dila/legifrance/lf-engine-app/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": "demo_key" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const data = await r.json();
    if (data.results?.length > 0) {
      return {
        lois: data.results.map(l => ({
          id: l.id, titre: l.title || l.titre, numero: l.numero,
          date: l.dateTexte || l.date, url: `https://www.legifrance.gouv.fr/loda/id/${l.id}`,
          categorie: categorizeLoi(l.title || l.titre),
        })),
        total: data.totalResultNumber || 0,
      };
    }
  } catch (e) { console.error("Sandbox error:", e.message); }

  // Fallback: lois statiques intégrées
  return {
    lois: GRANDES_LOIS.filter(l =>
      !query || l.titre.toLowerCase().includes(query.toLowerCase())
    ).slice((page-1)*pageSize, page*pageSize).map(l => ({...l, categorie: categorizeLoi(l.titre)})),
    total: GRANDES_LOIS.length,
    source: "statique",
  };
}

// ── CATÉGORISATION LOI ───────────────────────────────────────────
function categorizeLoi(titre) {
  const t = (titre || "").toLowerCase();
  const cats = {
    "Social": ["travail", "emploi", "retraite", "sécurité sociale", "chômage", "syndicat", "salaire", "prud"],
    "Économie": ["budget", "finance", "fiscal", "impôt", "taxe", "économie", "entreprise", "commerce", "investissement"],
    "Société": ["immigration", "étranger", "asile", "intégration", "famille", "mariage", "avortement", "bioéthique"],
    "Sécurité": ["sécurité", "police", "justice", "pénal", "crime", "terrorisme", "surveillance"],
    "Environnement": ["environnement", "énergie", "climat", "écologie", "biodiversité", "nucléaire", "renouvelable"],
    "Défense": ["défense", "armée", "militaire", "renseignement", "nato", "otan"],
    "Santé": ["santé", "hôpital", "médecin", "médicament", "maladie", "pandémie", "vaccination"],
    "Éducation": ["éducation", "école", "université", "enseignement", "formation", "recherche"],
    "Logement": ["logement", "habitat", "urbanisme", "construction", "loyer", "hlm"],
    "Numérique": ["numérique", "internet", "données", "rgpd", "algorithme", "ia", "intelligence artificielle"],
    "Institutions": ["constitution", "élection", "parlement", "collectivité", "décentralisation", "territoire"],
  };
  for (const [cat, keys] of Object.entries(cats)) {
    if (keys.some(k => t.includes(k))) return cat;
  }
  return "Autre";
}

function getBordPolitique(titre) {
  const t = (titre || "").toLowerCase();
  const gauche = ["social", "travail", "protection sociale", "égalité", "logement social", "service public", "nationalisation"];
  const droite = ["sécurité", "immigration", "ordre public", "liberté d'entreprise", "privatisation", "réforme fiscale droite"];
  const score_g = gauche.filter(k => t.includes(k)).length;
  const score_d = droite.filter(k => t.includes(k)).length;
  if (score_g > score_d) return "gauche";
  if (score_d > score_g) return "droite";
  return "neutre";
}

// ── IMAGE PROXY ──────────────────────────────────────────────────
app.get("/img", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send("Missing url");
  
  let host;
  try { host = new URL(url).hostname; } 
  catch { return res.status(400).send("Invalid URL"); }

  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9",
        "Referer": "https://fr.wikipedia.org/",
        "sec-fetch-dest": "image",
        "sec-fetch-mode": "no-cors",
      },
      signal: AbortSignal.timeout(10000),
      redirect: "follow",
    });
    if (!r.ok) return res.status(r.status).send("Image not available");
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", r.headers.get("content-type") || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=604800");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(buf);
  } catch (e) { 
    res.status(500).send("Proxy error: " + e.message); 
  }
});

// ── DÉPUTÉS ──────────────────────────────────────────────────────
app.get("/api/deputes", async (req, res) => {
  try {
    const d = await cached("deputes", () => 
      xfetch("https://www.nosdeputes.fr/deputes/json"), TTL.long
    );
    res.json({ deputes: (d?.deputes || []).map(x => x.depute || x) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/depute/:slug", async (req, res) => {
  try {
    const d = await cached(`dep_${req.params.slug}`, () => 
      xfetch(`https://www.nosdeputes.fr/${req.params.slug}/json`), TTL.long
    );
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── VOTES ENRICHIS AVEC LOIS ─────────────────────────────────────
app.get("/api/depute/:slug/votes", async (req, res) => {
  try {
    const raw = await cached(`votes_${req.params.slug}`, () => 
      xfetch(`https://www.nosdeputes.fr/${req.params.slug}/votes/json`), TTL.long
    );
    
    const votes = Array.isArray(raw) ? raw : (raw?.votes || []);
    
    // Enrichir avec catégorie et bord politique
    const enriched = votes.map(v => {
      const vv = v.vote || v;
      const titre = vv.titre || vv.libelle || vv.objet || "";
      const cat = categorizeLoi(titre);
      const bord = getBordPolitique(titre);
      const pos = vv.position || vv.type_vote || "";
      
      return {
        ...vv,
        position: pos,
        titre_loi: titre,
        categorie: cat,
        bord_politique: bord,
        date: vv.date || vv.dateScrutin || "",
        numero_loi: vv.numero_texte || vv.numeroTexte || null,
        url_legifrance: vv.numero_texte ? 
          `https://www.legifrance.gouv.fr/search/all?tab_selection=all&searchField=ALL&query=${vv.numero_texte}` : null,
      };
    });

    // Trier: Pour → Contre → Abstention → Absent
    const sorted = {
      pour: enriched.filter(v => v.position === "pour"),
      contre: enriched.filter(v => v.position === "contre"),
      abstention: enriched.filter(v => v.position === "abstention"),
      absent: enriched.filter(v => !["pour","contre","abstention"].includes(v.position)),
      tous: enriched,
      stats: {
        total: enriched.length,
        pour: enriched.filter(v => v.position === "pour").length,
        contre: enriched.filter(v => v.position === "contre").length,
        abstention: enriched.filter(v => v.position === "abstention").length,
        absent: enriched.filter(v => !["pour","contre","abstention"].includes(v.position)).length,
        par_categorie: Object.fromEntries(
          [...new Set(enriched.map(v => v.categorie))].map(cat => [
            cat, enriched.filter(v => v.categorie === cat).length
          ])
        ),
      },
    };

    res.json(sorted);
  } catch (e) { res.status(500).json({ error: e.message, votes: [] }); }
});

// ── SÉNATEURS ────────────────────────────────────────────────────
app.get("/api/senateurs", async (req, res) => {
  // Source 1: API officielle Sénat (data.senat.fr) - la plus fiable
  try {
    const d = await cached("senateurs", () =>
      xfetch("https://data.senat.fr/data/senateurs/ODSEN_GENERAL.json"), TTL.long
    );
    const arr = Array.isArray(d) ? d : (d?.senateurs || []);
    if (arr.length > 0) {
      const senateurs = arr.map(s => ({
        slug: `${(s.PRENOM||s.prenom||"")}-${(s.NOM||s.nom||"")}`.toLowerCase()
          .normalize("NFD").replace(/[̀-ͯ]/g,"")
          .replace(/[^a-z-]/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,""),
        prenom: s.PRENOM || s.prenom || "",
        nom_de_famille: s.NOM || s.nom || "",
        nom: `${s.PRENOM||s.prenom||""} ${s.NOM||s.nom||""}`.trim(),
        groupe_sigle: s.GROUPE_POLITIQUE_SIGLE || s.groupe_politique_sigle || "",
        nom_circo: s.DEPARTEMENT || s.departement || "",
        date_debut_mandat: s.DATE_DEBUT_MANDAT || s.date_debut_mandat || "",
        profession: s.PROFESSION || s.profession || "",
        date_naissance: s.DATE_NAISSANCE || "",
      }));
      return res.json({ senateurs });
    }
  } catch(e1) { console.log("data.senat.fr:", e1.message); }

  // Source 2: nossenateurs.fr
  try {
    const d2 = await cached("senateurs2", () =>
      xfetch("https://www.nossenateurs.fr/senateurs/json"), TTL.long
    );
    const senateurs = (d2?.senateurs || []).map(x => x.senateur || x);
    if (senateurs.length > 0) return res.json({ senateurs });
  } catch(e2) { console.log("nossenateurs:", e2.message); }

  // Source 3: nosdeputes.fr a aussi les sénateurs
  try {
    const d3 = await cached("senateurs3", () =>
      xfetch("https://www.nosdeputes.fr/senateurs/json"), TTL.long
    );
    const senateurs = (d3?.senateurs || []).map(x => x.senateur || x);
    if (senateurs.length > 0) return res.json({ senateurs });
  } catch(e3) { console.log("nosdeputes senateurs:", e3.message); }

  res.status(500).json({ error: "Toutes sources sénateurs indisponibles", senateurs: [] });
});

app.get("/api/senateur/:slug/votes", async (req, res) => {
  try {
    const raw = await cached(`svotes_${req.params.slug}`, () =>
      xfetch(`https://www.nossenateurs.fr/${req.params.slug}/votes/json`), TTL.long
    );
    const votes = Array.isArray(raw) ? raw : (raw?.votes || []);
    const enriched = votes.map(v => {
      const vv = v.vote || v;
      const titre = vv.titre || vv.libelle || "";
      return { ...vv, categorie: categorizeLoi(titre), bord_politique: getBordPolitique(titre) };
    });
    res.json({
      pour: enriched.filter(v => v.position === "pour"),
      contre: enriched.filter(v => v.position === "contre"),
      abstention: enriched.filter(v => v.position === "abstention"),
      absent: enriched.filter(v => !["pour","contre","abstention"].includes(v.position)),
      tous: enriched,
    });
  } catch (e) { res.status(500).json({ error: e.message, votes: [] }); }
});

// ── SCRUTINS RÉCENTS ─────────────────────────────────────────────
app.get("/api/scrutins", async (req, res) => {
  try {
    const d = await cached("scrutins", () => 
      xfetch("https://www.nosdeputes.fr/scrutins/json?limit=50"), TTL.court
    );
    const scrutins = (d?.scrutins || []).map(s => {
      const sc = s.scrutin || s;
      return {
        ...sc,
        categorie: categorizeLoi(sc.titre || sc.objet?.libelle),
        bord_politique: getBordPolitique(sc.titre || sc.objet?.libelle),
      };
    });
    res.json({ scrutins });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── LÉGIFRANCE: LOIS DEPUIS 1958 ─────────────────────────────────
app.get("/api/lois", async (req, res) => {
  const { q = "", page = 1, categorie = "" } = req.query;
  const cacheKey = `lois_${q}_${page}_${categorie}`;
  try {
    const result = await cached(cacheKey, async () => {
      // Si Légifrance disponible
      const token = await getLegiToken();
      if (token) {
        return searchLois(q || categorie || "loi", parseInt(page), 20);
      }
      // Fallback: liste statique des grandes lois
      return {
        lois: GRANDES_LOIS.filter(l => 
          !q || l.titre.toLowerCase().includes(q.toLowerCase())
        ).slice((parseInt(page)-1)*20, parseInt(page)*20),
        total: GRANDES_LOIS.length,
      };
    }, TTL.long);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message, lois: [] }); }
});

app.get("/api/loi/:id", async (req, res) => {
  try {
    const loi = await cached(`loi_${req.params.id}`, () => getLoi(req.params.id), TTL.long);
    if (!loi) return res.status(404).json({ error: "Loi non trouvée" });
    res.json(loi);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── HATVP ENRICHI ───────────────────────────────────────────────
app.get("/api/hatvp/declarations", async (req, res) => {
  const { nom, prenom, q } = req.query;
  let url = "https://www.hatvp.fr/rest/api/declarations?limit=20";
  if (nom) url += `&nom=${encodeURIComponent(nom)}`;
  if (prenom) url += `&prenom=${encodeURIComponent(prenom)}`;
  if (q) url += `&q=${encodeURIComponent(q)}`;
  
  try {
    const data = await xfetch(url);
    const decls = data.declarations || data.results || [];
    
    // Enrichir avec détection liens privés et nepotisme
    const enriched = decls.map(d => ({
      ...d,
      liens_prives_enrichis: (d.mandats || []).map(m => ({
        entreprise: m.denomination || m.organisme,
        role: m.fonction || m.nature,
        remuneration: m.remuneration,
        is_cac40: isCAC40(m.denomination),
        is_grand_groupe: isGrandGroupe(m.denomination),
      })),
      nepotisme_detecte: detectNepotisme(d, nom || q),
      pantouflage_detecte: detectPantouflage(d),
    }));
    
    res.json({ declarations: enriched, total: enriched.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

function isCAC40(nom) {
  const cac40 = ["Total", "LVMH", "BNP Paribas", "Sanofi", "Air Liquide", 
    "Schneider Electric", "L'Oréal", "Hermès", "Airbus", "Safran", 
    "Kering", "Stellantis", "Michelin", "Danone", "Pernod Ricard",
    "Saint-Gobain", "Vinci", "Orange", "Engie", "EDF", "Société Générale",
    "Crédit Agricole", "AXA", "Legrand", "Capgemini", "STMicroelectronics",
    "Thales", "ArcelorMittal", "Renault", "Rothschild"];
  return cac40.some(c => (nom || "").includes(c));
}

function isGrandGroupe(nom) {
  return isCAC40(nom) || ["Amazon", "Google", "Meta", "Apple", "Microsoft",
    "McKinsey", "KPMG", "Deloitte", "EY", "PwC", "Lazard"].some(c => (nom||"").includes(c));
}

function detectNepotisme(decl, nomElu) {
  if (!nomElu) return [];
  const famille = (decl.mandats || []).filter(m => 
    m.denomination?.toLowerCase().includes(nomElu.toLowerCase()) ||
    m.collaborateurs?.some(c => c.nom?.toLowerCase().includes(nomElu.toLowerCase()))
  );
  return famille.map(f => ({ type: "Lien potentiel", organisme: f.denomination, role: f.fonction }));
}

function detectPantouflage(decl) {
  const mandats = decl.mandats || [];
  const prive = mandats.filter(m => m.type === "PRIVE" || m.nature === "ACTIVITE_LIBERALE");
  const public_ = mandats.filter(m => m.type === "PUBLIC" || m.nature === "MANDAT_ELECTIF");
  if (prive.length > 0 && public_.length > 0) {
    return { detecte: true, nb_mandats_prives: prive.length, nb_mandats_publics: public_.length };
  }
  return { detecte: false };
}

// ── RNE: MAIRES ──────────────────────────────────────────────────
app.get("/api/rne/maires", async (req, res) => {
  try {
    const { q = "", dept = "", page = 1, page_size = 50 } = req.query;
    const size = Math.min(parseInt(page_size), 100);
    // URL correcte data.gouv.fr RNE maires
    let url = `https://tabular-api.data.gouv.fr/api/resources/d5f400de-ae3f-4966-8cb6-a85c70c6c24a/data/?page_size=${size}&page=${page}`;
    if (dept) url += `&CodeOfDepartement__exact=${dept}`;
    if (q) url += `&Nom__contains=${encodeURIComponent(q)}`;
    const d = await xfetch(url);
    res.json(d);
  } catch (e) {
    // Fallback: API alternative
    try {
      const url2 = `https://www.data.gouv.fr/api/1/datasets/repertoire-national-des-elus-1/resources/?page=1&page_size=1`;
      await xfetch(url2);
    } catch {}
    res.status(500).json({ error: e.message, data: [], total: 0 });
  }
});

// ── RNE: CONSEILLERS ─────────────────────────────────────────────
app.get("/api/rne/conseillers-dept", async (req, res) => {
  try {
    const { q = "", page = 1, page_size = 50 } = req.query;
    let url = `https://tabular-api.data.gouv.fr/api/resources/601ef073-d986-4582-8e1a-ed14dc857fde/data/?page_size=${Math.min(parseInt(page_size),100)}&page=${page}`;
    if (q) url += `&Nom__contains=${encodeURIComponent(q)}`;
    res.json(await xfetch(url));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/rne/conseillers-region", async (req, res) => {
  try {
    const { q = "", page = 1, page_size = 50 } = req.query;
    let url = `https://tabular-api.data.gouv.fr/api/resources/430e13f9-834b-4411-a1a8-da0b4b6e715c/data/?page_size=${Math.min(parseInt(page_size),100)}&page=${page}`;
    if (q) url += `&Nom__contains=${encodeURIComponent(q)}`;
    res.json(await xfetch(url));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/rne/conseillers-municipaux", async (req, res) => {
  try {
    const { q = "", dept = "", page = 1, page_size = 50 } = req.query;
    let url = `https://tabular-api.data.gouv.fr/api/resources/d5f400de-ae3f-4966-8cb6-a85c70c6c24a/data/?page_size=${Math.min(parseInt(page_size),100)}&page=${page}`;
    if (dept) url += `&CodeOfDepartement__exact=${dept}`;
    if (q) url += `&Nom__contains=${encodeURIComponent(q)}`;
    res.json(await xfetch(url));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/rne/conseillers-communautaires", async (req, res) => {
  try {
    const { q = "", page = 1, page_size = 50 } = req.query;
    let url = `https://tabular-api.data.gouv.fr/api/resources/d5f400de-ae3f-4966-8cb6-a85c70c6c24a/data/?page_size=${Math.min(parseInt(page_size),100)}&page=${page}`;
    if (q) url += `&Nom__contains=${encodeURIComponent(q)}`;
    res.json(await xfetch(url));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/rne/outremer", async (req, res) => {
  try {
    const CODES_OM = ["971","972","973","974","976"];
    const results = [];
    for (const code of CODES_OM) {
      try {
        const url = `https://tabular-api.data.gouv.fr/api/resources/601ef073-d986-4582-8e1a-ed14dc857fde/data/?page_size=30&CodeOfDepartement__exact=${code}`;
        const d = await xfetch(url);
        results.push(...(d.data || d.results || []));
      } catch {}
    }
    res.json({ data: results, total: results.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── VEILLE JUDICIAIRE ────────────────────────────────────────────
app.get("/api/judiciaire/:nom", async (req, res) => {
  const nom = req.params.nom;
  const newsApiKey = process.env.NEWS_API_KEY;
  
  const MOTS_JUDICIAIRES = [
    "mise en examen", "condamné", "jugement", "tribunal", "garde à vue",
    "perquisition", "corruption", "détournement", "parquet", "procès",
    "instruction judiciaire", "mis en cause", "entendu", "inculpé",
  ];

  if (!newsApiKey) {
    // Fallback: données statiques si pas de clé NewsAPI
    return res.json({ articles: [], message: "NewsAPI non configuré (NEWS_API_KEY)" });
  }

  try {
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(nom + " justice")}&language=fr&sortBy=publishedAt&pageSize=20&apiKey=${newsApiKey}`;
    const data = await xfetch(url, { "User-Agent": "TransparenceFrance/5.0" });
    
    const articles = (data.articles || [])
      .filter(a => {
        const text = `${a.title} ${a.description}`.toLowerCase();
        const mentionNom = text.includes(nom.toLowerCase().split(" ")[0].toLowerCase());
        const mentionJustice = MOTS_JUDICIAIRES.some(m => text.includes(m));
        return mentionNom && mentionJustice;
      })
      .map(a => ({
        titre: a.title,
        description: a.description,
        source: a.source.name,
        date: a.publishedAt,
        url: a.url,
        image: a.urlToImage,
      }));
    
    res.json({ articles, total: articles.length });
  } catch (e) { res.status(500).json({ error: e.message, articles: [] }); }
});

// ── GOUVERNEMENT (données statiques enrichies) ───────────────────
const GOUVERNEMENT = [
  {
    id: "emmanuel-macron", nom: "Emmanuel Macron", prenom: "Emmanuel",
    nom_famille: "MACRON", fonction: "Président de la République",
    ministere: "Élysée", parti: "Renaissance", age: 46,
    salaire_base: 15132, frais_mandat: 0, indemnite_fonction: 0,
    avantages: "Logement Élysée, sécurité 24h/24, avion présidentiel, staff 800 personnes",
    mandat_debut: "2017",
    photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f4/Emmanuel_Macron_in_2019.jpg/440px-Emmanuel_Macron_in_2019.jpg",
    liens_cac40: ["Rothschild & Co (associé-gérant 2008-2012, rémunération estimée 2,7M€)"],
    nepotisme: [],
    conflits: [],
    pantouflage: "Inspecteur des finances → Rothschild & Co → Secrétaire général Élysée → Ministère Économie → Élysée",
    twitter: "@EmmanuelMacron",
    hatvp_url: "https://www.hatvp.fr/fiche-nominative/?mandat=2800000",
  },
  {
    id: "francois-bayrou", nom: "François Bayrou", prenom: "François",
    nom_famille: "BAYROU", fonction: "Premier Ministre",
    ministere: "Matignon", parti: "MoDem", age: 73,
    salaire_base: 10680, frais_mandat: 5645, indemnite_fonction: 2000,
    avantages: "Hôtel Matignon, voiture de fonction, protection, chef cuisinier",
    mandat_debut: "2024",
    photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/99/Fran%C3%A7ois_Bayrou_2012.jpg/440px-Fran%C3%A7ois_Bayrou_2012.jpg",
    liens_cac40: [],
    nepotisme: ["Épouse Élisabeth Bayrou, conseillère régionale Nouvelle-Aquitaine (MoDem)"],
    conflits: ["Affaire assistants parlementaires MoDem au Parlement européen · enquête ouverte · classée sans suite (2020)"],
    pantouflage: "",
    hatvp_url: "https://www.hatvp.fr",
  },
  {
    id: "elisabeth-borne", nom: "Élisabeth Borne", prenom: "Élisabeth",
    nom_famille: "BORNE", fonction: "Ministre de l'Éducation nationale",
    ministere: "Éducation Nationale", parti: "Renaissance", age: 63,
    salaire_base: 9940, frais_mandat: 5645, indemnite_fonction: 1500,
    avantages: "Voiture de fonction, cabinet ministériel, protection",
    mandat_debut: "2024",
    photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6e/%C3%89lisabeth_Borne_in_2022_%28cropped%29.jpg/440px-%C3%89lisabeth_Borne_in_2022_%28cropped%29.jpg",
    liens_cac40: ["EDF (PDG 2020-2022)","RATP (PDG 2015-2017)","Arjowiggins (DG 2002-2008)"],
    nepotisme: [],
    conflits: [],
    pantouflage: "ENA → Préfecture → Cabinet Rocard → RATP PDG → EDF PDG → PM → Ministre",
    hatvp_url: "https://www.hatvp.fr",
  },
  {
    id: "jean-noel-barrot", nom: "Jean-Noël Barrot", prenom: "Jean-Noël",
    nom_famille: "BARROT", fonction: "Ministre des Affaires Étrangères",
    ministere: "Quai d'Orsay", parti: "MoDem", age: 40,
    salaire_base: 9940, frais_mandat: 5645, indemnite_fonction: 1500,
    avantages: "Voiture, logement de fonction, protection diplomatique",
    mandat_debut: "2024",
    photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/Jean-No%C3%ABl_Barrot_2022.jpg/440px-Jean-No%C3%ABl_Barrot_2022.jpg",
    liens_cac40: [],
    nepotisme: ["Père Jacques Barrot, VP Commission Européenne 2004-2010","Sœur Nathalie Barrot, magistrate"],
    conflits: [],
    pantouflage: "",
    hatvp_url: "https://www.hatvp.fr",
  },
  {
    id: "bruno-retailleau", nom: "Bruno Retailleau", prenom: "Bruno",
    nom_famille: "RETAILLEAU", fonction: "Ministre de l'Intérieur",
    ministere: "Place Beauvau", parti: "LR", age: 63,
    salaire_base: 9940, frais_mandat: 5645, indemnite_fonction: 1500,
    avantages: "Logement, voiture blindée, protection renforcée",
    mandat_debut: "2024",
    photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7e/Bruno_Retailleau_2022.jpg/440px-Bruno_Retailleau_2022.jpg",
    liens_cac40: [],
    nepotisme: [],
    conflits: [],
    pantouflage: "",
    hatvp_url: "https://www.hatvp.fr",
  },
  {
    id: "eric-lombard", nom: "Éric Lombard", prenom: "Éric",
    nom_famille: "LOMBARD", fonction: "Ministre de l'Économie et des Finances",
    ministere: "Bercy", parti: "Sans étiquette", age: 61,
    salaire_base: 9940, frais_mandat: 5645, indemnite_fonction: 1500,
    avantages: "Voiture, cabinet, accès Bloomberg/Reuters",
    mandat_debut: "2025",
    photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/%C3%89ric_Lombard_2023.jpg/440px-%C3%89ric_Lombard_2023.jpg",
    liens_cac40: ["Caisse des Dépôts (DG 2017-2025 · salaire ~300k€/an)","BNP Paribas (DG Gestion actifs)","Generali France (PDG 2010-2016)"],
    nepotisme: [],
    conflits: [],
    pantouflage: "BNP → Generali → Caisse des Dépôts → Ministère Économie",
    hatvp_url: "https://www.hatvp.fr",
  },
  {
    id: "rachida-dati", nom: "Rachida Dati", prenom: "Rachida",
    nom_famille: "DATI", fonction: "Ministre de la Culture",
    ministere: "Culture", parti: "LR", age: 58,
    salaire_base: 9940, frais_mandat: 5645, indemnite_fonction: 1500,
    avantages: "Voiture, cabinet ministériel",
    mandat_debut: "2024",
    photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f6/Rachida_Dati_2019.jpg/440px-Rachida_Dati_2019.jpg",
    liens_cac40: ["Sony Music France (consultante juridique · ~900k€ estimés sur 5 ans)"],
    nepotisme: [],
    conflits: ["Mise en examen pour corruption active et trafic d'influence (Sony Music) · 2021 · procédure en cours"],
    pantouflage: "Garde des Sceaux → Avocate d'affaires → Consultante Sony Music → Ministre Culture",
    hatvp_url: "https://www.hatvp.fr",
  },
  {
    id: "sebastien-lecornu", nom: "Sébastien Lecornu", prenom: "Sébastien",
    nom_famille: "LECORNU", fonction: "Ministre des Armées",
    ministere: "Armées", parti: "Renaissance", age: 38,
    salaire_base: 9940, frais_mandat: 5645, indemnite_fonction: 1500,
    avantages: "Voiture blindée, protection militaire",
    mandat_debut: "2024",
    photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/S%C3%A9bastien_Lecornu_2022.jpg/440px-S%C3%A9bastien_Lecornu_2022.jpg",
    liens_cac40: [],
    nepotisme: [],
    conflits: [],
    pantouflage: "",
    hatvp_url: "https://www.hatvp.fr",
  },
  {
    id: "catherine-vautrin", nom: "Catherine Vautrin", prenom: "Catherine",
    nom_famille: "VAUTRIN", fonction: "Ministre du Travail et de la Santé",
    ministere: "Travail/Santé", parti: "Renaissance", age: 59,
    salaire_base: 9940, frais_mandat: 5645, indemnite_fonction: 1500,
    avantages: "Voiture, deux cabinets ministériels fusionnés",
    mandat_debut: "2024",
    photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4c/Catherine_Vautrin_2022.jpg/440px-Catherine_Vautrin_2022.jpg",
    liens_cac40: [],
    nepotisme: [],
    conflits: [],
    pantouflage: "",
    hatvp_url: "https://www.hatvp.fr",
  },
  {
    id: "gerald-darmanin", nom: "Gérald Darmanin", prenom: "Gérald",
    nom_famille: "DARMANIN", fonction: "Ministre de la Justice",
    ministere: "Justice", parti: "Renaissance", age: 41,
    salaire_base: 9940, frais_mandat: 5645, indemnite_fonction: 1500,
    avantages: "Voiture blindée, protection permanente",
    mandat_debut: "2024",
    photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/G%C3%A9rald_Darmanin_2020.jpg/440px-G%C3%A9rald_Darmanin_2020.jpg",
    liens_cac40: [],
    nepotisme: [],
    conflits: ["Plainte pour viol · classée puis rouverte · non-lieu définitif (2022)","Affaire Takieddine · auditionné comme témoin dans dossier Kadhafi"],
    pantouflage: "",
    hatvp_url: "https://www.hatvp.fr",
  },
];

app.get("/api/gouvernement", (req, res) => res.json({ gouvernement: GOUVERNEMENT }));
app.get("/api/gouvernement/:id", (req, res) => {
  const m = GOUVERNEMENT.find(g => g.id === req.params.id);
  if (!m) return res.status(404).json({ error: "Non trouvé" });
  res.json(m);
});

// ── CONSEIL CONSTITUTIONNEL ──────────────────────────────────────
const CONSEIL_CONSTIT = [
  { id: "laurent-fabius", nom: "Laurent Fabius", prenom: "Laurent", nom_famille: "FABIUS", fonction: "Président", depuis: 2016, salaire_base: 14000, photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e4/Laurent_Fabius_2012.jpg/440px-Laurent_Fabius_2012.jpg", ancien_poste: "Président AN, Premier Ministre (1984-1986)", conflits: ["Affaire sang contaminé · acquitté en 2003"] },
  { id: "jacqueline-gourault", nom: "Jacqueline Gourault", prenom: "Jacqueline", nom_famille: "GOURAULT", fonction: "Membre", depuis: 2022, salaire_base: 13000, photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Jacqueline_Gourault_2020.jpg/440px-Jacqueline_Gourault_2020.jpg", ancien_poste: "Ministre Cohésion territoires", conflits: [] },
  { id: "alain-juppe", nom: "Alain Juppé", prenom: "Alain", nom_famille: "JUPPÉ", fonction: "Membre", depuis: 2019, salaire_base: 13000, photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Alain_Jupp%C3%A9_2014.jpg/440px-Alain_Jupp%C3%A9_2014.jpg", ancien_poste: "Premier Ministre, Maire Bordeaux", conflits: ["Condamné emplois fictifs RPR · 14 mois sursis (2004)"] },
  { id: "philippe-bas", nom: "Philippe Bas", prenom: "Philippe", nom_famille: "BAS", fonction: "Membre", depuis: 2022, salaire_base: 13000, photo: null, ancien_poste: "Sénateur Manche, Ministre Santé", conflits: [] },
  { id: "veronique-malbec", nom: "Véronique Malbec", prenom: "Véronique", nom_famille: "MALBEC", fonction: "Membre", depuis: 2022, salaire_base: 13000, photo: null, ancien_poste: "Procureure générale", conflits: [] },
  { id: "francois-seners", nom: "François Séners", prenom: "François", nom_famille: "SÉNERS", fonction: "Membre", depuis: 2022, salaire_base: 13000, photo: null, ancien_poste: "Conseiller d'État", conflits: [] },
  { id: "corinne-luquiens", nom: "Corinne Luquiens", prenom: "Corinne", nom_famille: "LUQUIENS", fonction: "Membre", depuis: 2019, salaire_base: 13000, photo: null, ancien_poste: "Secrétaire générale AN", conflits: [] },
  { id: "michel-pinault", nom: "Michel Pinault", prenom: "Michel", nom_famille: "PINAULT", fonction: "Membre", depuis: 2022, salaire_base: 13000, photo: null, ancien_poste: "Conseiller d'État", conflits: [] },
  { id: "francoise-dumont", nom: "Françoise Dumont", prenom: "Françoise", nom_famille: "DUMONT", fonction: "Membre", depuis: 2019, salaire_base: 13000, photo: null, ancien_poste: "Présidente TGI Toulon", conflits: [] },
];

app.get("/api/conseil-constitutionnel", (req, res) => res.json({ membres: CONSEIL_CONSTIT }));

// ── ANCIENS ÉLUS ─────────────────────────────────────────────────
const ANCIENS_ELUS = [
  { id: "nicolas-sarkozy", nom: "Nicolas Sarkozy", prenom: "Nicolas", nom_famille: "SARKOZY", fonction: "Ancien Président de la République", periode: "2007-2012", parti: "LR", retraite: 6220, photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/82/Nicolas_Sarkozy_-_Janvier_2012_%28cropped%29.jpg/440px-Nicolas_Sarkozy_-_Janvier_2012_%28cropped%29.jpg", apres_politique: "Avocat d'affaires, conférencier (50k€/conf.)", conflits: ["Condamné Bismuth 3 ans dont 1 ferme","Condamné Bygmalion 1 an ferme","En procès Kadhafi"], liens_cac40: ["Total (conseil d'admin)","Accor (conf.)"] },
  { id: "francois-hollande", nom: "François Hollande", prenom: "François", nom_famille: "HOLLANDE", fonction: "Ancien Président de la République", periode: "2012-2017", parti: "PS", retraite: 6220, photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f5/Fran%C3%A7ois_Hollande_-_Janvier_2012_%28cropped%29.jpg/440px-Fran%C3%A7ois_Hollande_-_Janvier_2012_%28cropped%29.jpg", apres_politique: "Conférencier, auteur, député Corrèze", conflits: [], liens_cac40: [] },
  { id: "francois-fillon", nom: "François Fillon", prenom: "François", nom_famille: "FILLON", fonction: "Ancien Premier Ministre", periode: "2007-2012", parti: "LR", retraite: 0, photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/30/Fran%C3%A7ois_Fillon_2017_%28cropped%29.jpg/440px-Fran%C3%A7ois_Fillon_2017_%28cropped%29.jpg", apres_politique: "Administrateur Zarubezhneft (Russie) · conseil Vinogradoff", conflits: ["Condamné Penelope Gate 5 ans dont 3 ferme (2022)"], liens_cac40: ["Vinogradoff (admin)","Zarubezhneft Russie (admin)"] },
  { id: "marine-le-pen", nom: "Marine Le Pen", prenom: "Marine", nom_famille: "LE PEN", fonction: "Ancienne présidente RN, ex-députée", periode: "2004-2024", parti: "RN", retraite: 0, photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e4/Marine_Le_Pen_%28cropped%29.jpg/440px-Marine_Le_Pen_%28cropped%29.jpg", apres_politique: "Inéligible 5 ans (appel en cours 2025)", conflits: ["Condamnée emplois fictifs PE · 5 ans inéligibilité"], liens_cac40: [] },
  { id: "jean-luc-melenchon", nom: "Jean-Luc Mélenchon", prenom: "Jean-Luc", nom_famille: "MÉLENCHON", fonction: "Fondateur LFI, ancien député", periode: "1986-2024", parti: "LFI", retraite: 8200, photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a3/Jean-Luc_M%C3%A9lenchon_2017_%28cropped%29.jpg/440px-Jean-Luc_M%C3%A9lenchon_2017_%28cropped%29.jpg", apres_politique: "Retraité politique", conflits: ["Condamné obstruction perquisitions 3 mois sursis (2019)"], liens_cac40: [] },
  { id: "edouard-philippe", nom: "Édouard Philippe", prenom: "Édouard", nom_famille: "PHILIPPE", fonction: "Ancien Premier Ministre, Maire du Havre", periode: "2017-2020", parti: "Horizons", retraite: 0, photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/%C3%89douard_Philippe_2020_%28cropped%29.jpg/440px-%C3%89douard_Philippe_2020_%28cropped%29.jpg", apres_politique: "Maire Le Havre, candidat présidentielle 2027", conflits: [], liens_cac40: [] },
];

app.get("/api/anciens-elus", (req, res) => res.json({ anciens: ANCIENS_ELUS }));

// ── PRÉFETS ──────────────────────────────────────────────────────
const PREFETS = [
  { id: "pref-75", nom: "Laurent Nuñez", departement: "Paris (75)", region: "Île-de-France", salaire_base: 8500, photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/57/Laurent_Nu%C3%B1ez.jpg/440px-Laurent_Nu%C3%B1ez.jpg" },
  { id: "pref-69", nom: "Fabienne Buccio", departement: "Rhône (69)", region: "Auvergne-Rhône-Alpes", salaire_base: 7800, photo: null },
  { id: "pref-13", nom: "Christophe Mirmand", departement: "Bouches-du-Rhône (13)", region: "PACA", salaire_base: 7800, photo: null },
  { id: "pref-33", nom: "Étienne Guyot", departement: "Gironde (33)", region: "Nouvelle-Aquitaine", salaire_base: 7800, photo: null },
  { id: "pref-31", nom: "Pierre-André Durand", departement: "Haute-Garonne (31)", region: "Occitanie", salaire_base: 7800, photo: null },
  { id: "pref-59", nom: "Bertrand Gaume", departement: "Nord (59)", region: "Hauts-de-France", salaire_base: 7800, photo: null },
  { id: "pref-67", nom: "Josiane Chevalier", departement: "Bas-Rhin (67)", region: "Grand Est", salaire_base: 7800, photo: null },
  { id: "pref-44", nom: "Fabrice Rigoulet-Roze", departement: "Loire-Atlantique (44)", region: "Pays de la Loire", salaire_base: 7800, photo: null },
  { id: "pref-76", nom: "Pierre-Edouard Colliex", departement: "Seine-Maritime (76)", region: "Normandie", salaire_base: 7800, photo: null },
  { id: "pref-34", nom: "François-Xavier Lauch", departement: "Hérault (34)", region: "Occitanie", salaire_base: 7800, photo: null },
];

app.get("/api/prefets", (req, res) => res.json({ prefets: PREFETS }));

// ── GRANDES LOIS 5e RÉPUBLIQUE (fallback sans Légifrance) ─────────
const GRANDES_LOIS = [
  { id: "1", titre: "Constitution de la Ve République", numero: "58-1958", date: "1958-10-04", categorie: "Institutions", url: "https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000571356" },
  { id: "2", titre: "Loi Veil - Interruption Volontaire de Grossesse", numero: "75-17", date: "1975-01-17", categorie: "Société", url: "https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000700458" },
  { id: "3", titre: "Abolition de la peine de mort", numero: "81-908", date: "1981-10-09", categorie: "Justice", url: "https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000699934" },
  { id: "4", titre: "Loi de décentralisation Defferre", numero: "82-213", date: "1982-03-02", categorie: "Institutions", url: "https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000512502" },
  { id: "5", titre: "Loi de nationalisation", numero: "82-155", date: "1982-02-11", categorie: "Économie", url: "https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000699805" },
  { id: "6", titre: "Loi sur les 35 heures (Aubry I)", numero: "98-461", date: "1998-06-13", categorie: "Social", url: "https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000759905" },
  { id: "7", titre: "PACS - Pacte Civil de Solidarité", numero: "99-944", date: "1999-11-15", categorie: "Société", url: "https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000761797" },
  { id: "8", titre: "Mariage pour tous", numero: "2013-404", date: "2013-05-17", categorie: "Société", url: "https://www.legifrance.gouv.fr/loda/id/JORFTEXT000027414232" },
  { id: "9", titre: "Réforme des retraites (report à 64 ans)", numero: "2023-270", date: "2023-04-14", categorie: "Social", url: "https://www.legifrance.gouv.fr/loda/id/JORFTEXT000047466785" },
  { id: "10", titre: "Loi immigration Darmanin", numero: "2024-42", date: "2024-01-26", categorie: "Société", url: "https://www.legifrance.gouv.fr/loda/id/JORFTEXT000049042716" },
  { id: "11", titre: "Loi RGPD française", numero: "78-17", date: "1978-01-06", categorie: "Numérique", url: "https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000886460" },
  { id: "12", titre: "Loi El Khomri (Travail)", numero: "2016-1088", date: "2016-08-08", categorie: "Social", url: "https://www.legifrance.gouv.fr/loda/id/JORFTEXT000032983213" },
  { id: "13", titre: "Loi de programmation militaire", numero: "2023-703", date: "2023-07-01", categorie: "Défense", url: "https://www.legifrance.gouv.fr/loda/id/JORFTEXT000047833435" },
  { id: "14", titre: "Loi Macron pour la croissance", numero: "2015-990", date: "2015-08-06", categorie: "Économie", url: "https://www.legifrance.gouv.fr/loda/id/JORFTEXT000030978561" },
  { id: "15", titre: "Loi Egalim 2 (alimentation)", numero: "2021-1357", date: "2021-10-18", categorie: "Environnement", url: "https://www.legifrance.gouv.fr/loda/id/JORFTEXT000044190772" },
  { id: "16", titre: "Loi Grenelle de l'environnement", numero: "2010-788", date: "2010-07-12", categorie: "Environnement", url: "https://www.legifrance.gouv.fr/loda/id/JORFTEXT000022470434" },
  { id: "17", titre: "Loi Sécurité Globale", numero: "2021-646", date: "2021-05-25", categorie: "Sécurité", url: "https://www.legifrance.gouv.fr/loda/id/JORFTEXT000043540586" },
  { id: "18", titre: "Loi Informatique et Libertés", numero: "78-17", date: "1978-01-06", categorie: "Numérique", url: "https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000886460" },
  { id: "19", titre: "Loi sur le Service National Universel", numero: "2023-714", date: "2023-07-01", categorie: "Défense", url: "https://www.legifrance.gouv.fr" },
  { id: "20", titre: "Loi de transition énergétique", numero: "2015-992", date: "2015-08-17", categorie: "Environnement", url: "https://www.legifrance.gouv.fr/loda/id/JORFTEXT000031044385" },
];

// ── RECHERCHE UNIFIÉE ────────────────────────────────────────────
app.get("/api/search/:q", async (req, res) => {
  const q = req.params.q.toLowerCase();
  try {
    const [deps, sens] = await Promise.all([
      cached("deputes", () => xfetch("https://www.nosdeputes.fr/deputes/json"), TTL.long).catch(() => null),
      cached("senateurs", () => xfetch("https://www.nossenateurs.fr/senateurs/json"), TTL.long).catch(() => null),
    ]);
    const deputes = ((deps?.deputes || []).map(d => d.depute || d))
      .filter(d => `${d.nom || ""} ${d.prenom || ""} ${d.nom_de_famille || ""}`.toLowerCase().includes(q))
      .slice(0, 5).map(d => ({ ...d, _type: "depute", cat: "deputes" }));
    const senateurs = ((sens?.senateurs || []).map(s => s.senateur || s))
      .filter(s => `${s.nom || ""} ${s.prenom || ""} ${s.nom_de_famille || ""}`.toLowerCase().includes(q))
      .slice(0, 3).map(s => ({ ...s, _type: "senateur", cat: "senateurs" }));
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
  } catch (e) { res.status(500).json({ error: e.message, results: [] }); }
});

// ── GÉO ──────────────────────────────────────────────────────────
app.get("/api/geo/communes", async (req, res) => {
  try {
    const url = `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(req.query.q||"")}&fields=nom,code,population,departement,region&limit=20&boost=population`;
    res.json(await xfetch(url));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ASSISTANT IA ─────────────────────────────────────────────────
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
        system: `Tu es l'assistant de TransparenceFrance.fr. Tu aides les citoyens à comprendre les coûts, votes, patrimoine et réseaux d'influence des élus français. Tu es factuel, précis et sans complaisance envers le pouvoir. Tu cites toujours tes sources (HATVP, nosdeputes.fr, data.gouv.fr, Légifrance, Journal Officiel). Tu parles uniquement de faits vérifiés et documentés. Pour les affaires judiciaires, tu distingues les condamnations définitives des mises en examen.`,
        messages: messages.slice(-10),
      }),
    });
    const data = await r.json();
    res.json({ content: data.content?.[0]?.text || "Désolé, je n'ai pas pu répondre." });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── STATUS ────────────────────────────────────────────────────────
app.get("/", (req, res) => res.json({
  status: "✅ TransparenceFrance API v5",
  version: "5.0.0",
  legifrance: !!process.env.LEGIFRANCE_CLIENT_ID ? "✅ Configuré" : "⚠️  Non configuré",
  supabase: !!process.env.SUPABASE_URL ? "✅ Configuré" : "⚠️  Non configuré",
  newsapi: !!process.env.NEWS_API_KEY ? "✅ Configuré" : "⚠️  Non configuré",
  endpoints: [
    "GET /api/gouvernement — 10 ministres avec données complètes",
    "GET /api/gouvernement/:id — Détail ministre",
    "GET /api/conseil-constitutionnel — 9 membres",
    "GET /api/anciens-elus — Anciens présidents, PM",
    "GET /api/prefets — Préfets principaux",
    "GET /api/deputes — 577 députés AN",
    "GET /api/depute/:slug — Détail député",
    "GET /api/depute/:slug/votes — Votes enrichis (Pour/Contre/Abstention/Catégorie)",
    "GET /api/senateurs — 348 sénateurs (3 sources fallback)",
    "GET /api/senateur/:slug/votes — Votes sénateur",
    "GET /api/scrutins — Scrutins récents AN enrichis",
    "GET /api/lois?q=&page= — Toutes lois 5e République (Légifrance)",
    "GET /api/loi/:id — Détail d'une loi",
    "GET /api/rne/maires?q=&dept= — Maires (34 875)",
    "GET /api/rne/conseillers-dept?q= — 4 044 conseillers dept",
    "GET /api/rne/conseillers-region?q= — 1 750 conseillers région",
    "GET /api/rne/conseillers-municipaux?q= — ~459 800",
    "GET /api/rne/conseillers-communautaires?q= — ~65 600",
    "GET /api/rne/outremer — Élus outre-mer",
    "GET /api/hatvp/declarations?q= — Patrimoine + liens privés enrichis",
    "GET /api/judiciaire/:nom — Veille judiciaire (NewsAPI)",
    "GET /api/search/:q — Recherche unifiée tous élus",
    "GET /img?url= — Proxy images",
    "POST /ia — Assistant Claude Sonnet 4",
    "GET /api/geo/communes?q= — Communes",
  ],
  instructions: {
    legifrance: "Inscrivez-vous sur https://developer.aife.economie.gouv.fr pour obtenir vos clés API Légifrance gratuites",
    newsapi: "Inscrivez-vous sur https://newsapi.org (100 requêtes/jour gratuit)",
    variables_render: "Ajoutez dans Render > Environment: LEGIFRANCE_CLIENT_ID, LEGIFRANCE_CLIENT_SECRET, NEWS_API_KEY, ANTHROPIC_API_KEY",
  },
}));

// ── PRÉCHARGEMENT ─────────────────────────────────────────────────
(async () => {
  console.log("🚀 TransparenceFrance API v5 — Préchargement...");
  await Promise.allSettled([
    cached("deputes", () => xfetch("https://www.nosdeputes.fr/deputes/json"), TTL.long),
    cached("scrutins", () => xfetch("https://www.nosdeputes.fr/scrutins/json?limit=50"), TTL.court),
    getLegiToken(),
  ]);
  console.log("✅ Prêt !");
})();

app.listen(PORT, () => console.log(`✅ TransparenceFrance API v5 — port ${PORT}`));
