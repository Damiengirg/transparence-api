const express = require("express");
const cors = require("cors");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: "*" }));
app.use(express.json());

// ── CACHE ──────────────────────────────────────────────────────
const cache = {};
const CACHE_TTL = 10 * 60 * 1000;

async function cached(key, fn) {
  const now = Date.now();
  if (cache[key] && now - cache[key].ts < CACHE_TTL) return cache[key].data;
  const data = await fn();
  cache[key] = { data, ts: now };
  return data;
}

async function xfetch(url) {
  const r = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "TransparenceFrance/2.0" },
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ── PROXY IMAGES ───────────────────────────────────────────────
app.get("/img", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send("Missing url");
  
  // Sécurité : seulement les domaines autorisés
  const allowed = [
    "upload.wikimedia.org",
    "www.nosdeputes.fr",
    "www.nossenateurs.fr",
    "www.assemblee-nationale.fr",
    "data.assemblee-nationale.fr",
    "media.senat.fr",
  ];
  
  let hostname;
  try { hostname = new URL(url).hostname; } catch { return res.status(400).send("Invalid URL"); }
  if (!allowed.includes(hostname)) return res.status(403).send("Domain not allowed");
  
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TransparenceFrance/2.0)",
        "Accept": "image/*,*/*",
      },
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });
    if (!r.ok) return res.status(404).send("Not found");
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", r.headers.get("content-type") || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(buf);
  } catch (e) {
    console.error("Image proxy error:", e.message);
    res.status(500).send("Error");
  }
});

// ── DATA ROUTES ────────────────────────────────────────────────
const ND = "https://www.nosdeputes.fr";
const NS = "https://www.nossenateurs.fr";

app.get("/api/deputes", async (req, res) => {
  try {
    const data = await cached("deputes", () => xfetch(`${ND}/deputes/json`));
    res.json({ deputes: (data?.deputes || []).map(d => d.depute || d) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/depute/:slug", async (req, res) => {
  try {
    const data = await cached(`dep_${req.params.slug}`, () => xfetch(`${ND}/${req.params.slug}/json`));
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/depute/:slug/votes", async (req, res) => {
  try {
    const data = await cached(`votes_${req.params.slug}`, () => xfetch(`${ND}/${req.params.slug}/votes/json`));
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/senateurs", async (req, res) => {
  try {
    const data = await cached("senateurs", () => xfetch(`${NS}/senateurs/json`));
    res.json({ senateurs: (data?.senateurs || []).map(s => s.senateur || s) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/scrutins", async (req, res) => {
  try {
    const data = await cached("scrutins", () => xfetch(`${ND}/scrutins/json?limit=30`));
    res.json({ scrutins: data?.scrutins || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/groupes", async (req, res) => {
  try {
    const data = await cached("groupes", () => xfetch(`${ND}/organismes/groupe/json`));
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
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
    const [deps, sens] = await Promise.all([
      cached("deputes", () => xfetch(`${ND}/deputes/json`)),
      cached("senateurs", () => xfetch(`${NS}/senateurs/json`)),
    ]);
    const deputes = (deps?.deputes || []).map(d => d.depute || d)
      .filter(d => `${d.nom || ""} ${d.prenom || ""}`.toLowerCase().includes(q))
      .slice(0, 6).map(d => ({ ...d, _type: "depute", _chambre: "Assemblée Nationale" }));
    const senateurs = (sens?.senateurs || []).map(s => s.senateur || s)
      .filter(s => `${s.nom || ""} ${s.prenom || ""}`.toLowerCase().includes(q))
      .slice(0, 4).map(s => ({ ...s, _type: "senateur", _chambre: "Sénat" }));
    res.json({ results: [...deputes, ...senateurs] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/stats", async (req, res) => {
  res.json({ status: "ok", version: "2.0", sources: ["nosdeputes.fr", "nossenateurs.fr", "hatvp.fr", "data.gouv.fr"] });
});

app.get("/", (req, res) => res.json({
  status: "✅ TransparenceFrance API v2 en ligne",
  endpoints: ["/img?url=", "/api/deputes", "/api/scrutins", "/api/groupes", "/api/hatvp/declarations", "/api/search/:q"],
}));

app.listen(PORT, () => console.log(`✅ API démarrée port ${PORT}`));
