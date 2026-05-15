const express = require("express");
const cors = require("cors");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const cache = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function proxyFetch(url, res, label) {
  const now = Date.now();
  if (cache[url] && now - cache[url].ts < CACHE_TTL) {
    return res.json(cache[url].data);
  }
  try {
    const r = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "TransparenceFrance/1.0 (contact@transparencefrance.fr)",
      },
      timeout: 10000,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    cache[url] = { data, ts: now };
    res.json(data);
  } catch (e) {
    console.error(`[${label}] Erreur:`, e.message);
    res.status(500).json({ error: e.message, source: label });
  }
}

// ── DEPUTÉS ────────────────────────────────────────────────────────
app.get("/api/deputes", (req, res) =>
  proxyFetch("https://www.nosdeputes.fr/deputes/json", res, "nosdeputes")
);

app.get("/api/depute/:slug", (req, res) =>
  proxyFetch(`https://www.nosdeputes.fr/${req.params.slug}/json`, res, "nosdeputes")
);

app.get("/api/depute/:slug/votes", (req, res) =>
  proxyFetch(`https://www.nosdeputes.fr/${req.params.slug}/votes/json`, res, "nosdeputes")
);

app.get("/api/depute/:slug/amendements", (req, res) =>
  proxyFetch(`https://www.nosdeputes.fr/${req.params.slug}/amendements/json`, res, "nosdeputes")
);

app.get("/api/depute/:slug/questions", (req, res) =>
  proxyFetch(`https://www.nosdeputes.fr/${req.params.slug}/questions/json`, res, "nosdeputes")
);

app.get("/api/depute/:slug/interventions", (req, res) =>
  proxyFetch(`https://www.nosdeputes.fr/${req.params.slug}/interventions/json`, res, "nosdeputes")
);

// ── SÉNATEURS ──────────────────────────────────────────────────────
app.get("/api/senateurs", (req, res) =>
  proxyFetch("https://www.nossenateurs.fr/senateurs/json", res, "nossenateurs")
);

app.get("/api/senateur/:slug", (req, res) =>
  proxyFetch(`https://www.nossenateurs.fr/${req.params.slug}/json`, res, "nossenateurs")
);

app.get("/api/senateur/:slug/votes", (req, res) =>
  proxyFetch(`https://www.nossenateurs.fr/${req.params.slug}/votes/json`, res, "nossenateurs")
);

// ── SCRUTINS ───────────────────────────────────────────────────────
app.get("/api/scrutins", (req, res) => {
  const limit = req.query.limit || 30;
  proxyFetch(`https://www.nosdeputes.fr/scrutins/json?limit=${limit}`, res, "nosdeputes");
});

app.get("/api/scrutins/senat", (req, res) =>
  proxyFetch("https://www.nossenateurs.fr/scrutins/json?limit=30", res, "nossenateurs")
);

// ── GROUPES PARLEMENTAIRES ─────────────────────────────────────────
app.get("/api/groupes", (req, res) =>
  proxyFetch("https://www.nosdeputes.fr/organismes/groupe/json", res, "nosdeputes")
);

app.get("/api/organismes", (req, res) =>
  proxyFetch("https://www.nosdeputes.fr/organismes/json", res, "nosdeputes")
);

// ── HATVP ──────────────────────────────────────────────────────────
app.get("/api/hatvp/declarations", async (req, res) => {
  const { nom, prenom, q } = req.query;
  let url = "https://www.hatvp.fr/rest/api/declarations?limit=10";
  if (nom) url += `&nom=${encodeURIComponent(nom)}`;
  if (prenom) url += `&prenom=${encodeURIComponent(prenom)}`;
  if (q) url += `&q=${encodeURIComponent(q)}`;
  proxyFetch(url, res, "HATVP");
});

app.get("/api/hatvp/search", (req, res) => {
  const q = req.query.q || "";
  proxyFetch(`https://www.hatvp.fr/rest/api/declarations?q=${encodeURIComponent(q)}&limit=20`, res, "HATVP");
});

// ── DATA.GOUV.FR ───────────────────────────────────────────────────
app.get("/api/datagouv/datasets", (req, res) =>
  proxyFetch("https://www.data.gouv.fr/api/1/datasets/?tag=assemblee-nationale&page_size=10&sort=-created", res, "data.gouv.fr")
);

app.get("/api/datagouv/search", (req, res) => {
  const q = req.query.q || "";
  proxyFetch(`https://www.data.gouv.fr/api/1/datasets/?q=${encodeURIComponent(q)}&page_size=8`, res, "data.gouv.fr");
});

app.get("/api/datagouv/hatvp", (req, res) =>
  proxyFetch("https://www.data.gouv.fr/api/1/organizations/haute-autorite-pour-la-transparence-de-la-vie-publique/datasets/?page_size=10", res, "data.gouv.fr")
);

app.get("/api/datagouv/cnccfp", (req, res) =>
  proxyFetch("https://www.data.gouv.fr/api/1/datasets/?tag=financement-partis&page_size=8", res, "data.gouv.fr")
);

// ── ASSEMBLÉE NATIONALE opendata ───────────────────────────────────
app.get("/api/an/acteurs", (req, res) =>
  proxyFetch("https://data.assemblee-nationale.fr/api/v2/Acteur/list/json?limit=20", res, "AN opendata")
);

app.get("/api/an/organes", (req, res) =>
  proxyFetch("https://data.assemblee-nationale.fr/api/v2/Organe/list/json?limit=20", res, "AN opendata")
);

app.get("/api/an/scrutins", (req, res) =>
  proxyFetch("https://data.assemblee-nationale.fr/api/v2/Scrutin/list/json?limit=20", res, "AN opendata")
);

app.get("/api/an/documents", (req, res) =>
  proxyFetch("https://data.assemblee-nationale.fr/api/v2/Document/list/json?limit=15", res, "AN opendata")
);

// ── SÉNAT opendata ─────────────────────────────────────────────────
app.get("/api/senat/scrutins", (req, res) =>
  proxyFetch("https://data.senat.fr/api/explore/v2.1/catalog/datasets/scrutins/records?limit=20&order_by=date_seance%20DESC", res, "senat.fr")
);

app.get("/api/senat/senateurs", (req, res) =>
  proxyFetch("https://data.senat.fr/api/explore/v2.1/catalog/datasets/senateurs/records?limit=50", res, "senat.fr")
);

app.get("/api/senat/amendements", (req, res) =>
  proxyFetch("https://data.senat.fr/api/explore/v2.1/catalog/datasets/amendements/records?limit=20&order_by=date_depot%20DESC", res, "senat.fr")
);

// ── VIE-PUBLIQUE ───────────────────────────────────────────────────
app.get("/api/viepublique/search", (req, res) => {
  const q = req.query.q || "";
  proxyFetch(`https://www.vie-publique.fr/recherche?search_api_views_fulltext=${encodeURIComponent(q)}&f[0]=type:personnalite&_format=json`, res, "vie-publique.fr");
});

// ── RECHERCHE UNIFIÉE ──────────────────────────────────────────────
app.get("/api/search/:query", async (req, res) => {
  const q = req.params.query.toLowerCase();
  try {
    const [depRes, senRes] = await Promise.all([
      fetch("https://www.nosdeputes.fr/deputes/json").then(r => r.json()).catch(() => null),
      fetch("https://www.nossenateurs.fr/senateurs/json").then(r => r.json()).catch(() => null),
    ]);

    const deputes = (depRes?.deputes || [])
      .map(d => d.depute || d)
      .filter(d => `${d.nom || ""} ${d.prenom || ""}`.toLowerCase().includes(q))
      .slice(0, 6)
      .map(d => ({ ...d, _type: "depute", _chambre: "Assemblée Nationale" }));

    const senateurs = (senRes?.senateurs || [])
      .map(s => s.senateur || s)
      .filter(s => `${s.nom || ""} ${s.prenom || ""}`.toLowerCase().includes(q))
      .slice(0, 4)
      .map(s => ({ ...s, _type: "senateur", _chambre: "Sénat" }));

    res.json({ results: [...deputes, ...senateurs], total: deputes.length + senateurs.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── STATS GLOBALES ─────────────────────────────────────────────────
app.get("/api/stats", async (req, res) => {
  try {
    const [depRes, senRes, scrRes] = await Promise.all([
      fetch("https://www.nosdeputes.fr/deputes/json").then(r => r.json()).catch(() => null),
      fetch("https://www.nossenateurs.fr/senateurs/json").then(r => r.json()).catch(() => null),
      fetch("https://www.nosdeputes.fr/scrutins/json?limit=5").then(r => r.json()).catch(() => null),
    ]);

    res.json({
      nb_deputes: (depRes?.deputes || []).length,
      nb_senateurs: (senRes?.senateurs || []).length,
      derniers_scrutins: (scrRes?.scrutins || []).slice(0, 3),
      last_update: new Date().toISOString(),
      sources: ["nosdeputes.fr", "nossenateurs.fr", "hatvp.fr", "data.gouv.fr", "senat.fr"],
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── HEALTH CHECK ───────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    status: "✅ TransparenceFrance API en ligne",
    version: "1.0.0",
    endpoints: [
      "/api/deputes", "/api/depute/:slug", "/api/depute/:slug/votes",
      "/api/depute/:slug/amendements", "/api/senateurs", "/api/senateur/:slug",
      "/api/scrutins", "/api/groupes", "/api/hatvp/declarations",
      "/api/datagouv/datasets", "/api/an/scrutins", "/api/senat/scrutins",
      "/api/search/:query", "/api/stats",
    ],
    sources: "nosdeputes.fr · nossenateurs.fr · hatvp.fr · data.gouv.fr · senat.fr · assemblee-nationale.fr",
  });
});

app.listen(PORT, () => console.log(`✅ TransparenceFrance API démarrée sur le port ${PORT}`));
