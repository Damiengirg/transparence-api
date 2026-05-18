 const express = require("express");
const cors = require("cors");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors({ origin: "*" }));
app.use(express.json());

// Cache
const cache = {};
const TTL = 10 * 60 * 1000;
async function cached(key, fn) {
  if (cache[key] && Date.now() - cache[key].ts < TTL) return cache[key].d;
  const d = await fn();
  cache[key] = { d, ts: Date.now() };
  return d;
}

const H = {
  "User-Agent": "TransparenceFrance/3.0 (transparencefrance.fr; contact@transparencefrance.fr)",
  "Accept": "application/json",
};

async function xfetch(url) {
  const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} — ${url}`);
  return r.json();
}

// ── IMAGE PROXY ─────────────────────────────────────────────────
app.get("/img", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send("Missing url");
  const allowed = ["upload.wikimedia.org","www.nosdeputes.fr","www.nossenateurs.fr",
    "data.senat.fr","media.senat.fr","www.assemblee-nationale.fr","www2.assemblee-nationale.fr",
    "www.gouvernement.fr","www.elysee.fr"];
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
      signal: AbortSignal.timeout(8000),
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

// ── DEPUTIES ────────────────────────────────────────────────────
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

// ── SENATORS ────────────────────────────────────────────────────
app.get("/api/senateurs", async (req, res) => {
  try {
    const d = await cached("senateurs", () => xfetch("https://www.nossenateurs.fr/senateurs/json"));
    res.json({ senateurs: (d?.senateurs || []).map(x => x.senateur || x) });
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

// ── RÉPERTOIRE NATIONAL DES ÉLUS (data.gouv.fr) ─────────────────
// RNE = base officielle de TOUS les élus français
app.get("/api/rne/maires", async (req, res) => {
  try {
    // RNE dataset - maires et adjoints
    const dept = req.query.dept || "";
    const q = req.query.q || "";
    let url = "https://www.data.gouv.fr/api/1/datasets/5c34c4d1634f41073adb03ab/resources/";
    // Fallback: use the direct CSV API
    const apiUrl = `https://tabular-api.data.gouv.fr/api/resources/d5f400de-ae3f-4966-8cb6-a85c70c6c24a/data/?page_size=50${dept ? `&CodeOfDepartement__exact=${dept}` : ""}${q ? `&Nom__contains=${encodeURIComponent(q)}` : ""}`;
    const d = await xfetch(apiUrl);
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/rne/conseillers-dept", async (req, res) => {
  try {
    const q = req.query.q || "";
    const url = `https://tabular-api.data.gouv.fr/api/resources/601ef073-d986-4582-8e1a-ed14dc857fde/data/?page_size=50${q ? `&Nom__contains=${encodeURIComponent(q)}` : ""}`;
    const d = await xfetch(url);
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/rne/conseillers-region", async (req, res) => {
  try {
    const q = req.query.q || "";
    const url = `https://tabular-api.data.gouv.fr/api/resources/430e13f9-834b-4411-a1a8-da0b4b6e715c/data/?page_size=50${q ? `&Nom__contains=${encodeURIComponent(q)}` : ""}`;
    const d = await xfetch(url);
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PREFETS ─────────────────────────────────────────────────────
app.get("/api/prefets", async (req, res) => {
  try {
    // Liste des préfets depuis data.gouv.fr
    const d = await cached("prefets", () =>
      xfetch("https://www.data.gouv.fr/api/1/datasets/?q=prefets+france&page_size=5&sort=-reuses")
    );
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GEO: COMMUNES / DEPARTEMENTS / REGIONS ──────────────────────
app.get("/api/geo/communes", async (req, res) => {
  try {
    const q = req.query.q || "";
    const url = `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(q)}&fields=nom,code,population,departement,region&limit=20&boost=population`;
    const d = await xfetch(url);
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/geo/departements", async (req, res) => {
  try {
    const d = await cached("depts", () =>
      xfetch("https://geo.api.gouv.fr/departements?fields=nom,code,region&limit=200")
    );
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/geo/regions", async (req, res) => {
  try {
    const d = await cached("regions", () =>
      xfetch("https://geo.api.gouv.fr/regions?fields=nom,code&limit=50")
    );
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── HATVP ───────────────────────────────────────────────────────
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
      .filter(d => `${d.nom || ""} ${d.prenom || ""}`.toLowerCase().includes(q))
      .slice(0, 6).map(d => ({ ...d, _type: "depute", _chambre: "Assemblée Nationale" }));
    const senateurs = ((sens?.senateurs || []).map(s => s.senateur || s))
      .filter(s => `${s.nom || ""} ${s.prenom || ""}`.toLowerCase().includes(q))
      .slice(0, 4).map(s => ({ ...s, _type: "senateur", _chambre: "Sénat" }));
    res.json({ results: [...deputes, ...senateurs] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DATA.GOUV DATASETS ───────────────────────────────────────────
app.get("/api/datagouv/datasets", async (req, res) => {
  try {
    const d = await xfetch("https://www.data.gouv.fr/api/1/datasets/?tag=assemblee-nationale&page_size=10&sort=-created");
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/", (req, res) => res.json({
  status: "✅ TransparenceFrance API v3 — Tous les élus de France",
  version: "3.0.0",
  coverage: "Président · PM · 577 Députés · 348 Sénateurs · 81 Eurodéputés · 34875 Maires · 4044 Conseillers départementaux · 1750 Conseillers régionaux · Préfets · Conseil Constitutionnel",
  endpoints: [
    "GET /api/deputes — 577 députés AN",
    "GET /api/depute/:slug — Détail député",
    "GET /api/depute/:slug/votes — Votes",
    "GET /api/senateurs — 348 sénateurs",
    "GET /api/scrutins — Scrutins récents",
    "GET /api/groupes — Groupes parlementaires",
    "GET /api/rne/maires?q=nom&dept=75 — Maires (RNE officiel)",
    "GET /api/rne/conseillers-dept?q=nom — Conseillers départementaux",
    "GET /api/rne/conseillers-region?q=nom — Conseillers régionaux",
    "GET /api/geo/communes?q=nom — Communes françaises",
    "GET /api/geo/departements — 101 départements",
    "GET /api/geo/regions — 18 régions",
    "GET /api/hatvp/declarations?q=nom — Déclarations HATVP",
    "GET /api/search/:q — Recherche unifiée tous élus",
    "GET /img?url= — Proxy images sécurisé",
  ],
  sources: "nosdeputes.fr · nossenateurs.fr · data.gouv.fr/RNE · hatvp.fr · geo.api.gouv.fr · assemblee-nationale.fr",
}));

// Préchargement
(async () => {
  console.log("🚀 Préchargement données...");
  await Promise.allSettled([
    cached("deputes", () => xfetch("https://www.nosdeputes.fr/deputes/json")),
    cached("scrutins", () => xfetch("https://www.nosdeputes.fr/scrutins/json?limit=30")),
    cached("depts", () => xfetch("https://geo.api.gouv.fr/departements?fields=nom,code,region&limit=200")),
    cached("regions", () => xfetch("https://geo.api.gouv.fr/regions?fields=nom,code&limit=50")),
  ]);
  console.log("✅ Prêt !");
})();

app.listen(PORT, () => console.log(`✅ TransparenceFrance API v3 — port ${PORT}`));
