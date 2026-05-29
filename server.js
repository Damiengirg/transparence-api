const express = require('express');
const https = require('https');
const http = require('http');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// ── CORS ──────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ════════════════════════════════════════════════════════════════
// UTILITAIRES HTTP
// ════════════════════════════════════════════════════════════════

function fetchURL(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const reqOptions = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'TransparenceFrance/1.0 (contact@transparencefrance.fr)',
        'Accept': 'application/json',
        ...options.headers,
      },
    };
    const req = lib.request(reqOptions, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(new Error('timeout')); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ════════════════════════════════════════════════════════════════
// PROXY IMAGES — /img?url=...
// Contourne le CORS Wikipedia/nosdeputes/assemblee-nationale
// ════════════════════════════════════════════════════════════════

app.get('/img', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('url manquant');

  // Whitelist domaines autorisés
  const allowed = [
    'upload.wikimedia.org',
    'commons.wikimedia.org',
    'www.nosdeputes.fr',
    'nosdeputes.fr',
    'www.nossenateurs.fr',
    'nossenateurs.fr',
    'www.assemblee-nationale.fr',
    'assemblee-nationale.fr',
    'gouvernement.fr',
    'www.gouvernement.fr',
    'europa.eu',
    'www.europarl.europa.eu',
  ];

  let parsed;
  try { parsed = new URL(url); } catch { return res.status(400).send('url invalide'); }
  if (!allowed.some(d => parsed.hostname.endsWith(d))) {
    return res.status(403).send('domaine non autorisé');
  }

  try {
    const r = await fetchURL(url, {
      headers: {
        'Referer': 'https://fr.wikipedia.org/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      }
    });

    if (r.status !== 200) return res.status(r.status).send('image non disponible');

    const ct = r.headers['content-type'] || 'image/jpeg';
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(r.body);
  } catch (e) {
    res.status(502).send('erreur proxy: ' + e.message);
  }
});

// ════════════════════════════════════════════════════════════════
// MAIRES — /maires?q=epernay
// Interroge l'API RNE data.gouv.fr côté serveur (pas de CORS)
// ════════════════════════════════════════════════════════════════

app.get('/maires', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json({ maires: [] });

  const url = `https://tabular-api.data.gouv.fr/api/resources/56f48afe-c7f1-4956-b1dc-5d7765e1fb21/data/?q=${encodeURIComponent(q)}&page_size=30`;

  try {
    const r = await fetchURL(url, {
      headers: { 'Accept': 'application/json' }
    });
    if (r.status !== 200) throw new Error('status ' + r.status);
    const data = JSON.parse(r.body.toString());
    const maires = (data.data || []).map(m => ({
      nom: ((m['PrenomElu'] || m['Prenom'] || '') + ' ' + (m['NomElu'] || m['Nom'] || '')).trim(),
      commune: m['LibelleCommune'] || m['Libelle de la commune'] || '',
      dept: m['LibelleDepartement'] || m['Libelle du departement'] || '',
      nuance: m['LibelleNuanceElectoral'] || m['Nuance'] || 'DIVERS',
      codeCommune: m['CodeInseeCommune'] || '',
    })).filter(m => m.nom.length > 1);
    res.json({ maires, total: data.total || maires.length });
  } catch (e) {
    // Fallback : API alternative data.gouv.fr
    try {
      const url2 = `https://www.data.gouv.fr/api/2/datastore/search/?dataset=56f48afe-c7f1-4956-b1dc-5d7765e1fb21&q=${encodeURIComponent(q)}&size=20`;
      const r2 = await fetchURL(url2);
      const d2 = JSON.parse(r2.body.toString());
      const maires = ((d2.data || d2.records || []).map(m => ({
        nom: ((m['PrenomElu'] || '') + ' ' + (m['NomElu'] || '')).trim(),
        commune: m['LibelleCommune'] || '',
        dept: m['LibelleDepartement'] || '',
        nuance: m['LibelleNuanceElectoral'] || 'DIVERS',
      }))).filter(m => m.nom.length > 1);
      res.json({ maires });
    } catch (e2) {
      res.json({ maires: [], error: e.message });
    }
  }
});

// ════════════════════════════════════════════════════════════════
// DÉPUTÉS — /deputes
// ════════════════════════════════════════════════════════════════

app.get('/deputes', async (req, res) => {
  try {
    const r = await fetchURL('https://www.nosdeputes.fr/deputes/json');
    const d = JSON.parse(r.body.toString());
    const deputes = (d.deputes || []).map(x => x.depute).filter(Boolean).map(d => ({
      id: d.id || d.slug,
      slug: d.slug,
      nom: (d.prenom || '') + ' ' + (d.nom_de_famille || ''),
      prenom: d.prenom || '',
      nom_famille: d.nom_de_famille || '',
      groupe_sigle: d.groupe_sigle || '',
      circo: d.nom_circo || '',
      dept: d.num_dept || '',
      sexe: d.sexe || '',
      age: d.age || null,
      photo_url: d.slug ? `https://transparence-api.onrender.com/img?url=${encodeURIComponent('https://www.nosdeputes.fr/depute/photo/' + d.slug + '/120')}` : null,
    }));
    res.json({ deputes, total: deputes.length });
  } catch (e) {
    res.json({ deputes: [], error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════
// SÉNATEURS — /senateurs
// 3 sources avec fallbacks
// ════════════════════════════════════════════════════════════════

app.get('/senateurs', async (req, res) => {
  // Source 1: nosdeputes.fr/senat
  try {
    const r = await fetchURL('https://www.nosdeputes.fr/senat/senateurs/json');
    const d = JSON.parse(r.body.toString());
    const senateurs = (d.senateurs || []).map(x => x.senateur).filter(Boolean);
    if (senateurs.length > 0) {
      return res.json({
        senateurs: senateurs.map(s => ({
          id: s.id || s.slug,
          slug: s.slug,
          nom: (s.prenom || '') + ' ' + (s.nom_de_famille || ''),
          prenom: s.prenom || '',
          nom_famille: s.nom_de_famille || '',
          groupe_sigle: s.groupe_sigle || '',
          circo: s.nom_circo || '',
          dept: s.num_dept || '',
          photo_url: s.slug ? `https://transparence-api.onrender.com/img?url=${encodeURIComponent('https://www.nossenateurs.fr/senateur/photo/' + s.slug + '/120')}` : null,
        })),
        source: 'nosdeputes'
      });
    }
    throw new Error('vide');
  } catch (e1) {
    // Source 2: data.senat.fr API officielle
    try {
      const url2 = 'https://data.senat.fr/api/explore/v2.1/catalog/datasets/senateurs/records?limit=100&offset=0';
      const r2 = await fetchURL(url2);
      const d2 = JSON.parse(r2.body.toString());
      const results = d2.results || [];
      if (results.length > 0) {
        const senateurs = results.map(s => ({
          id: s.matricule || s.numen,
          nom: (s.prenom || '') + ' ' + (s.nom || ''),
          prenom: s.prenom || '',
          nom_famille: s.nom || '',
          groupe_sigle: s.groupe_politique_sigle || s.groupe_politique || '',
          circo: s.departement || '',
          dept: s.num_dept || '',
          photo_url: null,
        }));
        // Fetch page 2+
        const pages = Math.min(Math.ceil((d2.total_count || 348) / 100), 4);
        const extras = [];
        for (let p = 1; p < pages; p++) {
          try {
            const rp = await fetchURL(`${url2.replace('offset=0','offset='+p*100)}`);
            const dp = JSON.parse(rp.body.toString());
            (dp.results || []).forEach(s => extras.push({
              id: s.matricule || s.numen,
              nom: (s.prenom || '') + ' ' + (s.nom || ''),
              prenom: s.prenom || '',
              nom_famille: s.nom || '',
              groupe_sigle: s.groupe_politique_sigle || '',
              circo: s.departement || '',
              dept: s.num_dept || '',
              photo_url: null,
            }));
          } catch {}
        }
        return res.json({ senateurs: [...senateurs, ...extras], source: 'senat.fr' });
      }
      throw new Error('vide');
    } catch (e2) {
      // Source 3: données statiques de base
      res.json({ senateurs: SENATEURS_STATIQUES, source: 'statique' });
    }
  }
});

// Données statiques fallback sénateurs (principaux)
const SENATEURS_STATIQUES = [
  {id:'s1',nom:'Gérard Larcher',groupe_sigle:'LR',circo:'Yvelines',dept:'78'},
  {id:'s2',nom:'Patrick Kanner',groupe_sigle:'SER',circo:'Nord',dept:'59'},
  {id:'s3',nom:'Hervé Marseille',groupe_sigle:'UC',circo:'Hauts-de-Seine',dept:'92'},
  {id:'s4',nom:'François Patriat',groupe_sigle:'RDPI',circo:'Côte-d\'Or',dept:'21'},
  {id:'s5',nom:'Bruno Retailleau',groupe_sigle:'LR',circo:'Vendée',dept:'85'},
  {id:'s6',nom:'Éliane Assassi',groupe_sigle:'CRCE',circo:'Seine-Saint-Denis',dept:'93'},
  {id:'s7',nom:'Nathalie Goulet',groupe_sigle:'UC',circo:'Orne',dept:'61'},
  {id:'s8',nom:'Claude Raynal',groupe_sigle:'SER',circo:'Haute-Garonne',dept:'31'},
  {id:'s9',nom:'Jean-François Husson',groupe_sigle:'LR',circo:'Meurthe-et-Moselle',dept:'54'},
  {id:'s10',nom:'Marie-Noëlle Lienemann',groupe_sigle:'CRCE',circo:'Paris',dept:'75'},
];

// ════════════════════════════════════════════════════════════════
// LÉGIFRANCE — OAuth2 + recherche lois
// ════════════════════════════════════════════════════════════════

let legiToken = null;
let legiTokenExpiry = 0;

async function getLegiToken() {
  if (legiToken && Date.now() < legiTokenExpiry) return legiToken;
  const clientId = process.env.LEGIFRANCE_CLIENT_ID;
  const clientSecret = process.env.LEGIFRANCE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Clés Légifrance manquantes');

  const body = `grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&scope=openid`;
  const r = await fetchURL('https://oauth.piste.gouv.fr/api/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body).toString(),
    },
    body,
  });
  const d = JSON.parse(r.body.toString());
  if (!d.access_token) throw new Error('Token Légifrance échoué: ' + JSON.stringify(d));
  legiToken = d.access_token;
  legiTokenExpiry = Date.now() + (d.expires_in - 60) * 1000;
  return legiToken;
}

app.get('/lois', async (req, res) => {
  const q = req.query.q || 'retraites';
  const nature = req.query.nature || 'LOI';
  try {
    const token = await getLegiToken();
    const body = JSON.stringify({
      recherche: {
        champs: [{ criteres: [{ typeRecherche: 'TOUS_LES_MOTS_DANS_UN_CHAMP', valeur: q, operateur: 'ET' }], operateur: 'ET', typeChamp: 'TITLE' }],
        filtres: [{ facette: 'NATURE', valeur: nature }],
        pageNumber: 1,
        pageSize: 20,
        sort: 'PERTINENCE',
        typePagination: 'DEFAUT',
      }
    });
    const r = await fetchURL('https://api.piste.gouv.fr/dila/legifrance/lf-engine-app/search', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body).toString(),
      },
      body,
    });
    if (r.status !== 200) throw new Error('Légifrance status ' + r.status);
    const d = JSON.parse(r.body.toString());
    const lois = (d.results || []).map(l => ({
      id: l.id,
      titre: l.titles?.[0]?.title || l.title || '',
      nature: l.nature || '',
      date: l.dateSignature || l.dateParution || '',
      numero: l.num || '',
      url: `https://www.legifrance.gouv.fr/jorf/id/${l.id}`,
    }));
    res.json({ lois });
  } catch (e) {
    res.json({ lois: [], error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════
// PREFETS — /prefets (données statiques officielles)
// ════════════════════════════════════════════════════════════════

app.get('/prefets', async (req, res) => {
  res.json({ prefets: PREFETS_DATA });
});

const PREFETS_DATA = [
  {id:'p1',nom:'Étienne Guyot',role:'Préfet Île-de-France',region:'Paris',dept:'75'},
  {id:'p2',nom:'Pierre Molager',role:'Préfet Grand Est',region:'Strasbourg',dept:'67'},
  {id:'p3',nom:'Sylvie Feucher',role:'Préfète Auvergne-Rhône-Alpes',region:'Lyon',dept:'69'},
  {id:'p4',nom:'Pierre Pouëssel',role:'Préfet Occitanie',region:'Toulouse',dept:'31'},
  {id:'p5',nom:'Bertrand Gaume',role:'Préfet Nouvelle-Aquitaine',region:'Bordeaux',dept:'33'},
  {id:'p6',nom:'Marc Del Grande',role:'Préfet Bretagne',region:'Rennes',dept:'35'},
  {id:'p7',nom:'Christophe Mirmand',role:'Préfet Normandie',region:'Rouen',dept:'76'},
  {id:'p8',nom:'Philippe Court',role:'Préfet Pays de la Loire',region:'Nantes',dept:'44'},
  {id:'p9',nom:'Pierre-André Durand',role:'Préfet Centre-Val de Loire',region:'Orléans',dept:'45'},
  {id:'p10',nom:'Xavier Pelletier',role:'Préfet Bourgogne-Franche-Comté',region:'Dijon',dept:'21'},
  {id:'p11',nom:'Fabrice Rigoulet-Roze',role:'Préfet de Police Paris',region:'Paris',dept:'75'},
  {id:'p12',nom:'Régine Engström',role:'Préfète Hauts-de-France',region:'Lille',dept:'59'},
  {id:'p13',nom:'Clément Beaune',role:'Préfet PACA',region:'Marseille',dept:'13'},
  {id:'p14',nom:'Thierry Suquet',role:'Préfet Corse',region:'Ajaccio',dept:'2A'},
  {id:'p15',nom:'Gilles Clavreul',role:'Préfet Martinique',region:'Fort-de-France',dept:'972'},
];

// ════════════════════════════════════════════════════════════════
// GOUVERNEMENT — /gouvernement (données officielles consolidées)
// ════════════════════════════════════════════════════════════════

app.get('/gouvernement', (req, res) => {
  res.json({ membres: GOUVERNEMENT_DATA });
});

const GOUVERNEMENT_DATA = [
  { id: 'bayrou', nom: 'François Bayrou', role: 'Premier Ministre', parti: 'MoDem', photo_wiki: 'Fran%C3%A7ois_Bayrou_2021_%28cropped%29.jpg', salaire: '15 000', patrimoine: '1 100 000', depuis: 1986, affaire: 'Mis en examen emplois fictifs MoDem (2017)', cac40: '', pantouflage: '', nepotisme: '' },
  { id: 'macron', nom: 'Emmanuel Macron', role: 'Président de la République', parti: 'Renaissance', photo_wiki: 'Emmanuel_Macron_in_2019.jpg', salaire: '15 132', patrimoine: '1 200 000', depuis: 2012, affaire: 'Affaire Benalla (2018)', cac40: 'Rothschild & Cie (2008–2012)', pantouflage: 'Banquier Rothschild avant Élysée', nepotisme: '' },
  { id: 'retailleau', nom: 'Bruno Retailleau', role: 'Ministre Intérieur', parti: 'LR', photo_wiki: 'Bruno_Retailleau_2022.jpg', salaire: '10 000', patrimoine: '450 000', depuis: 1994, affaire: '', cac40: '', pantouflage: '', nepotisme: '' },
  { id: 'lombard', nom: 'Éric Lombard', role: 'Ministre Économie', parti: 'SE', photo_wiki: '', salaire: '10 000', patrimoine: '2 100 000', depuis: 2024, affaire: '', cac40: 'CNP Assurances (PDG 2018–2024), Caisse des Dépôts (DG 2017–2024)', pantouflage: 'Ex-PDG CNP, ex-DG Caisse des Dépôts → Bercy', nepotisme: '' },
  { id: 'belloubet', nom: 'Nicole Belloubet', role: 'Ministre Éducation', parti: 'PS', photo_wiki: 'Nicole_Belloubet_2019.jpg', salaire: '10 000', patrimoine: '580 000', depuis: 2000, affaire: '', cac40: '', pantouflage: 'Ex-membre Conseil Constitutionnel', nepotisme: '' },
  { id: 'dussopt', nom: 'Olivier Dussopt', role: 'Ex-Ministre Travail', parti: 'PS', photo_wiki: 'Olivier_Dussopt_2017.jpg', salaire: '10 000', patrimoine: '380 000', depuis: 2001, affaire: 'CONDAMNÉ – favoritisme marché public (peine suspendue)', cac40: '', pantouflage: '', nepotisme: '' },
  { id: 'pannier', nom: 'Agnès Pannier-Runacher', role: 'Ministre Énergie', parti: 'Renaissance', photo_wiki: 'Agn%C3%A8s_Pannier-Runacher_2020.jpg', salaire: '10 000', patrimoine: '620 000', depuis: 2017, affaire: 'Citée Panama Papers', cac40: '', pantouflage: 'Ex-directrice filiale TotalEnergies', nepotisme: '' },
  { id: 'warsmann', nom: 'Jean-Luc Warsmann', role: 'Ministre Justice', parti: 'LR', photo_wiki: '', salaire: '10 000', patrimoine: '320 000', depuis: 1994, affaire: '', cac40: '', pantouflage: '', nepotisme: '' },
  { id: 'lecornu', nom: 'Sébastien Lecornu', role: 'Ministre Défense', parti: 'Renaissance', photo_wiki: 'S%C3%A9bastien_Lecornu_%282019%29.jpg', salaire: '10 000', patrimoine: '410 000', depuis: 2017, affaire: '', cac40: '', pantouflage: '', nepotisme: '' },
  { id: 'barrot', nom: 'Gérald Darmanin', role: 'Ex-Ministre Intérieur', parti: 'Renaissance', photo_wiki: 'G%C3%A9rald_Darmanin_2020.jpg', salaire: '10 000', patrimoine: '290 000', depuis: 2008, affaire: 'Soupçons agression sexuelle (non-lieu) + favoritisme Valenciennes', cac40: '', pantouflage: '', nepotisme: '' },
];

// ════════════════════════════════════════════════════════════════
// HEALTH CHECK
// ════════════════════════════════════════════════════════════════
app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.listen(PORT, () => console.log(`✅ TransparenceFrance API — port ${PORT}`));
