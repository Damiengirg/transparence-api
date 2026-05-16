const express = require("express");
const cors = require("cors");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ── CACHE ──────────────────────────────────────────────────────────
const cache = {};
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function cached(key, fn) {
  const now = Date.now();
  if (cache[key] && now - cache[key].ts < CACHE_TTL) return cache[key].data;
  const data = await fn();
  cache[key] = { data, ts: now };
  return data;
}

async function xfetch(url, opts = {}) {
  const r = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "TransparenceFrance/1.0", ...opts.headers },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} — ${url}`);
  return r.json();
}

async function xfetchText(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": "TransparenceFrance/1.0" },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

// ── PARSE CSV ──────────────────────────────────────────────────────
function parseCSV(text, delimiter = ",") {
  const lines = text.split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(delimiter).map(h => h.trim().replace(/"/g, "").toLowerCase());
  return lines.slice(1).map(line => {
    const vals = line.split(delimiter).map(v => v.trim().replace(/"/g, ""));
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] || ""; });
    return obj;
  });
}

// ── SOURCES CSV OFFICIELLES AN ─────────────────────────────────────
// data.assemblee-nationale.fr — fichiers opendata officiels mis à jour quotidiennement
const AN_DATA = {
  deputes:      "https://data.assemblee-nationale.fr/static/openData/repository/17/amo/deputes_actifs_mandats_actifs_organes/AMO10_deputes_actifs_mandats_actifs_organes.json",
  scrutins:     "https://data.assemblee-nationale.fr/static/openData/repository/17/loi/scrutins/scrutins.json",
  acteurs:      "https://data.assemblee-nationale.fr/static/openData/repository/17/amo/tous_acteurs_mandats_organes_xi_legislature/AMO30_tous_acteurs_tous_mandats_tous_organes_historique.json",
};

// nosdeputes.fr — API JSON directe
const ND = "https://www.nosdeputes.fr";
const NS = "https://www.nossenateurs.fr";

// ── CHARGEMENT DONNÉES DÉPUTÉS ─────────────────────────────────────
async function loadDeputesList() {
  return cached("deputes_list", async () => {
    try {
      // Source 1: nosdeputes.fr
      const data = await xfetch(`${ND}/deputes/json`);
      if (data?.deputes?.length > 0) {
        console.log(`✅ Députés chargés: ${data.deputes.length} depuis nosdeputes.fr`);
        return data.deputes.map(d => d.depute || d);
      }
    } catch (e) { console.log("nosdeputes.fr indisponible, fallback AN..."); }

    try {
      // Source 2: AN opendata JSON
      const data = await xfetch(AN_DATA.deputes);
      const acteurs = data?.export?.acteurs?.acteur || [];
      console.log(`✅ Députés chargés: ${acteurs.length} depuis AN opendata`);
      return acteurs.map(a => ({
        slug: a.uid?.["#text"] || a.uid || "",
        nom: a.etatCivil?.ident?.nom || "",
        prenom: a.etatCivil?.ident?.prenom || "",
        date_naissance: a.etatCivil?.infoNaissance?.dateNais || "",
        profession: a.profession?.libelleCourant || "",
        groupe_sigle: a.mandats?.mandat?.find?.(m => m.typeOrgane === "GP")?.organes?.organeRef || "",
        _type: "depute",
        _chambre: "Assemblée Nationale",
      }));
    } catch (e) { console.log("AN opendata indisponible"); }

    return [];
  });
}

async function loadDeputeDetail(slug) {
  return cached(`depute_${slug}`, async () => {
    try {
      const data = await xfetch(`${ND}/${slug}/json`);
      return data?.depute || null;
    } catch (e) {
      console.log(`Détail ${slug} indisponible:`, e.message);
      return null;
    }
  });
}

async function loadDeputeVotes(slug) {
  return cached(`votes_${slug}`, async () => {
    try {
      const data = await xfetch(`${ND}/${slug}/votes/json`);
      return data?.votes || [];
    } catch (e) { return []; }
  });
}

async function loadScrutins() {
  return cached("scrutins", async () => {
    try {
      const data = await xfetch(`${ND}/scrutins/json?limit=30`);
      if (data?.scrutins?.length > 0) return data.scrutins;
    } catch {}
    try {
      // Fallback AN
      const data = await xfetch("https://data.assemblee-nationale.fr/static/openData/repository/17/loi/scrutins/scrutins.json");
      const scrutins = data?.export?.scrutins?.scrutin || [];
      return scrutins.slice(0, 30).map(s => ({
        scrutin: {
          titre: s.titre || s.objet || "Scrutin",
          date_seance: s.dateScrutin || s.date || "",
          sort_final: s.syntheseVote?.libelle || "",
          nb_votants_pour: s.syntheseVote?.suffragesExprimes?.pour || 0,
          nb_votants_contre: s.syntheseVote?.suffragesExprimes?.contre || 0,
          nb_abstentions: s.syntheseVote?.nbrAbstentions || 0,
        }
      }));
    } catch (e) { return []; }
  });
}

async function loadGroupes() {
  return cached("groupes", async () => {
    try {
      const data = await xfetch(`${ND}/organismes/groupe/json`);
      return data?.organismes || [];
    } catch { return []; }
  });
}

async function loadSenateurs() {
  return cached("senateurs", async () => {
    try {
      const data = await xfetch(`${NS}/senateurs/json`);
      return (data?.senateurs || []).map(s => s.senateur || s);
    } catch { return []; }
  });
}

// ── ROUTES ─────────────────────────────────────────────────────────

app.get("/", (req, res) => res.json({
  status: "✅ TransparenceFrance API en ligne",
  version: "2.0.0",
  endpoints: ["/api/deputes", "/api/depute/:slug", "/api/depute/:slug/votes",
    "/api/senateurs", "/api/scrutins", "/api/groupes", "/api/hatvp/declarations",
    "/api/datagouv/datasets", "/api/search/:query", "/api/stats"],
  sources: "nosdeputes.fr · AN opendata · nossenateurs.fr · hatvp.fr · data.gouv.fr",
}));

app.get("/api/deputes", async (req, res) => {
  try { res.json({ deputes: await loadDeputesList() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/depute/:slug", async (req, res) => {
  try {
    const d = await loadDeputeDetail(req.params.slug);
    if (!d) return res.status(404).json({ error: "Député non trouvé" });
    res.json({ depute: d });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/depute/:slug/votes", async (req, res) => {
  try { res.json({ votes: await loadDeputeVotes(req.params.slug) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/depute/:slug/amendements", async (req, res) => {
  try {
    const data = await xfetch(`${ND}/${req.params.slug}/amendements/json`);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/senateurs", async (req, res) => {
  try { res.json({ senateurs: await loadSenateurs() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/senateur/:slug", async (req, res) => {
  try {
    const data = await xfetch(`${NS}/${req.params.slug}/json`);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/senateur/:slug/votes", async (req, res) => {
  try {
    const data = await xfetch(`${NS}/${req.params.slug}/votes/json`);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/scrutins", async (req, res) => {
  try { res.json({ scrutins: await loadScrutins() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/groupes", async (req, res) => {
  try { res.json({ organismes: await loadGroupes() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/hatvp/declarations", async (req, res) => {
  const { nom, prenom, q } = req.query;
  let url = "https://www.hatvp.fr/rest/api/declarations?limit=10";
  if (nom) url += `&nom=${encodeURIComponent(nom)}`;
  if (prenom) url += `&prenom=${encodeURIComponent(prenom)}`;
  if (q) url += `&q=${encodeURIComponent(q)}`;
  try {
    const data = await xfetch(url);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/datagouv/datasets", async (req, res) => {
  try {
    const data = await xfetch("https://www.data.gouv.fr/api/1/datasets/?tag=assemblee-nationale&page_size=10&sort=-created");
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/search/:query", async (req, res) => {
  const q = req.params.query.toLowerCase();
  try {
    const [deps, sens] = await Promise.all([loadDeputesList(), loadSenateurs()]);
    const deputes = deps.filter(d => `${d.nom || ""} ${d.prenom || ""}`.toLowerCase().includes(q))
      .slice(0, 6).map(d => ({ ...d, _type: "depute", _chambre: "Assemblée Nationale" }));
    const senateurs = sens.filter(s => `${s.nom || ""} ${s.prenom || ""}`.toLowerCase().includes(q))
      .slice(0, 4).map(s => ({ ...s, _type: "senateur", _chambre: "Sénat" }));
    res.json({ results: [...deputes, ...senateurs], total: deputes.length + senateurs.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/stats", async (req, res) => {
  try {
    const [deps, sens, scr] = await Promise.all([loadDeputesList(), loadSenateurs(), loadScrutins()]);
    res.json({
      nb_deputes: deps.length,
      nb_senateurs: sens.length,
      derniers_scrutins: scr.slice(0, 3),
      last_update: new Date().toISOString(),
      sources: ["nosdeputes.fr", "nossenateurs.fr", "AN opendata", "hatvp.fr", "data.gouv.fr"],
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Préchargement au démarrage
(async () => {
  console.log("🚀 Préchargement des données...");
  await Promise.allSettled([loadDeputesList(), loadScrutins(), loadGroupes()]);
  console.log("✅ Données prêtes !");
})();

app.listen(PORT, () => console.log(`✅ TransparenceFrance API v2 démarrée sur le port ${PORT}`));
