const express = require("express");
const cors = require("cors");
const fetch = (...a) => import("node-fetch").then(({ default: f }) => f(...a));
const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors({ origin: "*" }));
app.use(express.json());

// ── CACHE ─────────────────────────────────────────────────────
const C = {};
async function cached(k, fn, ttl = 3600000) {
  if (C[k] && Date.now() - C[k].t < ttl) return C[k].d;
  const d = await fn(); C[k] = { d, t: Date.now() }; return d;
}
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0";
async function xget(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

// ── DONNÉES STATIQUES COMPLÈTES ───────────────────────────────

const GOUV = [
  { id:"emmanuel-macron", prenom:"Emmanuel", nom:"Macron", parti:"Renaissance", fonction:"Président de la République", ministere:"Élysée", debut:2017,
    salaire:15132, frais:0, indem:0, avantages:["Palais de l'Élysée (logement officiel)","Avion présidentiel","Sécurité 24h/24 (GSPR)","Budget Élysée 105M€/an","Chef cuisinier","Voitures de fonction Renault/DS"],
    patrimoine_declare:1006000, retraite_estimee:6220,
    cac40:["Rothschild & Co (associé-gérant 2008-2012, revenus ~2M€)"],
    nepotisme:["Épouse Brigitte Macron, ancienne enseignante, rôle de Première Dame non officiel mais financé"], 
    pantouflage:"Inspecteur des finances → Banque Rothschild → Secrétaire général adjoint Élysée → Ministre Économie → Président",
    affaires:[{t:"Affaires McKinsey",d:"Recours massif à des cabinets de conseil privés pendant Covid · rapport Sénat 2022",s:"Rapport parlementaire",liens:["https://www.lemonde.fr"]}]
  },
  { id:"francois-bayrou", prenom:"François", nom:"Bayrou", parti:"MoDem", fonction:"Premier Ministre", ministere:"Matignon", debut:2024,
    salaire:10680, frais:5645, indem:2000, avantages:["Hôtel de Matignon (logement officiel)","Chef cuisinier","Voiture de fonction blindée","Budget cabinet"],
    patrimoine_declare:850000, retraite_estimee:0,
    cac40:[], nepotisme:["Épouse Élisabeth Bayrou, conseillère régionale Nouvelle-Aquitaine (élue)"],
    pantouflage:"Professeur → Politique → PM",
    affaires:[{t:"Assistants parlementaires MoDem",d:"Soupçons d'emplois fictifs assistants PE pour le parti · classé sans suite (2020)",s:"Classé",liens:["https://www.lemonde.fr"]}]
  },
  { id:"bruno-retailleau", prenom:"Bruno", nom:"Retailleau", parti:"LR", fonction:"Ministre de l'Intérieur", ministere:"Place Beauvau", debut:2024,
    salaire:9940, frais:5645, indem:1500, avantages:["Appartement de fonction Place Beauvau","Voiture blindée","Protection permanente"],
    patrimoine_declare:620000, retraite_estimee:0, cac40:[], nepotisme:[], pantouflage:"", affaires:[]
  },
  { id:"eric-lombard", prenom:"Éric", nom:"Lombard", parti:"Sans étiquette", fonction:"Ministre de l'Économie et des Finances", ministere:"Bercy", debut:2025,
    salaire:9940, frais:5645, indem:1500, avantages:["Appartement de fonction Bercy","Voiture","Cabinet ministériel"],
    patrimoine_declare:4200000, retraite_estimee:0,
    cac40:["Caisse des Dépôts (DG 2017-2025, salaire ~450k€/an)","BNP Paribas (admin)","Generali France (PDG 2010-2016, salaire ~2M€/an)"],
    nepotisme:[], pantouflage:"BNP Paribas → Generali → Caisse des Dépôts → Bercy",
    affaires:[]
  },
  { id:"rachida-dati", prenom:"Rachida", nom:"Dati", parti:"LR", fonction:"Ministre de la Culture", ministere:"Ministère de la Culture", debut:2024,
    salaire:9940, frais:5645, indem:1500, avantages:["Appartement de fonction","Voiture"],
    patrimoine_declare:980000, retraite_estimee:0,
    cac40:["Sony Music France (consultante 2012-2023, ~900 000€ déclarés)"],
    nepotisme:[], pantouflage:"Garde des Sceaux 2007-2009 → Avocate → Consultante Sony → Maire 7e Paris → Ministre",
    affaires:[{t:"Mise en examen corruption active",d:"Soupçons de trafic d'influence en lien avec Sony Music France · procédure en cours",s:"Mise en examen",liens:["https://www.mediapart.fr","https://www.lemonde.fr"]}]
  },
  { id:"gerald-darmanin", prenom:"Gérald", nom:"Darmanin", parti:"Renaissance", fonction:"Ministre de la Justice", ministere:"Place Vendôme", debut:2024,
    salaire:9940, frais:5645, indem:1500, avantages:["Appartement de fonction","Voiture blindée","Protection permanente"],
    patrimoine_declare:380000, retraite_estimee:0, cac40:[], nepotisme:[],
    pantouflage:"", affaires:[{t:"Plainte pour viol et abus de faiblesse",d:"Classée sans suite puis non-lieu définitif (2022) · procédure longue",s:"Non-lieu",liens:["https://www.mediapart.fr"]}]
  },
  { id:"sebastien-lecornu", prenom:"Sébastien", nom:"Lecornu", parti:"Renaissance", fonction:"Ministre des Armées", ministere:"Hôtel de Brienne", debut:2024,
    salaire:9940, frais:5645, indem:1500, avantages:["Appartement de fonction","Voiture blindée","Protection militaire"],
    patrimoine_declare:290000, retraite_estimee:0, cac40:[], nepotisme:[], pantouflage:"", affaires:[]
  },
  { id:"elisabeth-borne", prenom:"Élisabeth", nom:"Borne", parti:"Renaissance", fonction:"Ministre de l'Éducation nationale", ministere:"Éducation Nationale", debut:2024,
    salaire:9940, frais:5645, indem:1500, avantages:["Appartement de fonction","Voiture"],
    patrimoine_declare:750000, retraite_estimee:0,
    cac40:["EDF (PDG 2020-2022, salaire ~450k€/an)","RATP (PDG 2015-2017, salaire ~380k€/an)"],
    nepotisme:[], pantouflage:"ENA → RATP → EDF → Première Ministre → Ministre Éducation",
    affaires:[]
  },
  { id:"jean-noel-barrot", prenom:"Jean-Noël", nom:"Barrot", parti:"MoDem", fonction:"Ministre des Affaires Étrangères", ministere:"Quai d'Orsay", debut:2024,
    salaire:9940, frais:5645, indem:1500, avantages:["Appartement de fonction","Protection diplomatique","Voiture"],
    patrimoine_declare:420000, retraite_estimee:0, cac40:[], 
    nepotisme:["Père Jacques Barrot (1937-2014) : Vice-Président Commission Européenne, commissaire UE"],
    pantouflage:"", affaires:[]
  },
  { id:"catherine-vautrin", prenom:"Catherine", nom:"Vautrin", parti:"Renaissance", fonction:"Ministre du Travail et de la Santé", ministere:"Ministère Travail/Santé", debut:2024,
    salaire:9940, frais:5645, indem:1500, avantages:["Deux cabinets fusionnés","Voiture"],
    patrimoine_declare:510000, retraite_estimee:0, cac40:[], nepotisme:[], pantouflage:"", affaires:[]
  },
];

const CONSEIL_CONSTIT = [
  { id:"laurent-fabius", prenom:"Laurent", nom:"Fabius", parti:"PS", fonction:"Président du Conseil Constitutionnel", depuis:2016,
    salaire:14000, avantages:["Appartement de fonction","Voiture","Cabinet"],
    affaires:[{t:"Affaire du sang contaminé",d:"Mis en examen comme Premier Ministre (1985-1986) · Acquitté (2003) par la Cour de Justice de la République",s:"Acquitté",liens:["https://www.lemonde.fr"]}],
    cac40:[], nepotisme:[], pantouflage:"Normalien → PM (1984-1986) → Président AN → Ministre AE → CC"
  },
  { id:"alain-juppe-cc", prenom:"Alain", nom:"Juppé", parti:"LR", fonction:"Membre", depuis:2019,
    salaire:13000, avantages:["Voiture","Cabinet"],
    affaires:[{t:"Emplois fictifs RPR",d:"Condamné 14 mois sursis + 1 an inéligibilité pour prise illégale d'intérêts (2004)",s:"Condamné",liens:["https://www.lemonde.fr"]}],
    cac40:[], nepotisme:[], pantouflage:"ENA → PM → Maire Bordeaux → CC"
  },
  { id:"jacqueline-gourault", prenom:"Jacqueline", nom:"Gourault", parti:"MoDem", fonction:"Membre", depuis:2022,
    salaire:13000, avantages:[], affaires:[], cac40:[], nepotisme:[], pantouflage:""
  },
  { id:"philippe-bas", prenom:"Philippe", nom:"Bas", parti:"LR", fonction:"Membre", depuis:2022,
    salaire:13000, avantages:[], affaires:[], cac40:[], nepotisme:[], pantouflage:"Conseiller d'État → Directeur cabinet Chirac → CC"
  },
  { id:"veronique-malbec", prenom:"Véronique", nom:"Malbec", parti:"", fonction:"Membre", depuis:2022,
    salaire:13000, avantages:[], affaires:[], cac40:[], nepotisme:[], pantouflage:"Magistrate → CC"
  },
  { id:"francois-seners", prenom:"François", nom:"Séners", parti:"", fonction:"Membre", depuis:2022,
    salaire:13000, avantages:[], affaires:[], cac40:[], nepotisme:[], pantouflage:"Conseiller d'État → CC"
  },
  { id:"corinne-luquiens", prenom:"Corinne", nom:"Luquiens", parti:"", fonction:"Membre", depuis:2019,
    salaire:13000, avantages:[], affaires:[], cac40:[], nepotisme:[], pantouflage:"Juriste → CC"
  },
  { id:"michel-pinault", prenom:"Michel", nom:"Pinault", parti:"", fonction:"Membre", depuis:2022,
    salaire:13000, avantages:[], affaires:[], cac40:[], nepotisme:[], pantouflage:"Conseiller d'État → CC"
  },
  { id:"francoise-dumont", prenom:"Françoise", nom:"Dumont", parti:"LR", fonction:"Membre", depuis:2019,
    salaire:13000, avantages:[], affaires:[], cac40:[], nepotisme:[], pantouflage:"Avocate → CC"
  },
];

const ANCIENS_PRESIDENTS = [
  { id:"charles-de-gaulle", prenom:"Charles", nom:"de Gaulle", parti:"Gaulliste", fonction:"Président", periode:"1959-1969",
    retraite:0, salaire_periode:4500, avantages:["Château de la Boisserie (résidence privée)"],
    affaires:[], cac40:[], nepotisme:[], pantouflage:"Armée → Résistance → GPRF → Président"
  },
  { id:"georges-pompidou", prenom:"Georges", nom:"Pompidou", parti:"Gaulliste", fonction:"Président", periode:"1969-1974",
    retraite:0, salaire_periode:5000, avantages:[],
    affaires:[], cac40:["Banque Rothschild (DG 1956-1962)"], nepotisme:[],
    pantouflage:"Normalien → Banque Rothschild → PM → Président"
  },
  { id:"valery-giscard-d-estaing", prenom:"Valéry", nom:"Giscard d'Estaing", parti:"Centre", fonction:"Président", periode:"1974-1981",
    retraite:6220, salaire_periode:5500, avantages:[],
    affaires:[{t:"Affaire des diamants de Bokassa",d:"Accusé d'avoir reçu des diamants du dictateur Bokassa · nié mais politiquement dévastateur (1979)",s:"Jamais poursuivi",liens:["https://www.lemonde.fr"]}],
    cac40:["LVMH (administrateur après mandat)"], nepotisme:[], pantouflage:""
  },
  { id:"francois-mitterrand", prenom:"François", nom:"Mitterrand", parti:"PS", fonction:"Président", periode:"1981-1995",
    retraite:0, salaire_periode:6000, avantages:["Appartement au Champ-de-Mars financé par l'État"],
    affaires:[
      {t:"Écoutes téléphoniques illégales",d:"Mise en place d'une cellule d'écoutes illégales à l'Élysée · condamnations de collaborateurs",s:"Collaborateurs condamnés",liens:["https://www.lemonde.fr"]},
      {t:"Passé Vichy",d:"Travail pour le régime de Vichy 1942-1944 · Francisque reçue du Maréchal Pétain",s:"Historiquement établi",liens:["https://www.lemonde.fr"]},
      {t:"Fille cachée",d:"Mazarine Pingeot (née 1974), fille cachée, logement et protection payés par fonds publics pendant 20 ans",s:"Reconnu",liens:["https://www.lemonde.fr"]}
    ],
    cac40:[], nepotisme:["Fils Gilbert Mitterrand · Président Fondation France Libertés"],
    pantouflage:""
  },
  { id:"jacques-chirac", prenom:"Jacques", nom:"Chirac", parti:"RPR/UMP", fonction:"Président", periode:"1995-2007",
    retraite:6220, salaire_periode:7500, avantages:[],
    affaires:[
      {t:"Emplois fictifs ville de Paris",d:"Financement RPR via emplois fictifs à la Mairie de Paris · 2 ans sursis (2011)",s:"Condamné",liens:["https://www.lemonde.fr"]},
      {t:"Détournements fonds RPR",d:"Complicité de détournements de fonds publics",s:"Condamné avec sursis",liens:["https://www.lemonde.fr"]}
    ],
    cac40:[], nepotisme:["Fille Claude Chirac · directrice de communication Élysée (salaire public)"],
    pantouflage:"ENA → Pompidou → PM → Maire Paris → Président"
  },
  { id:"nicolas-sarkozy", prenom:"Nicolas", nom:"Sarkozy", parti:"UMP/LR", fonction:"Président", periode:"2007-2012",
    retraite:6220, salaire_periode:21300, avantages:["Fort de Brégançon","Appartement de fonction"],
    affaires:[
      {t:"Affaire Bismuth",d:"Corruption d'un magistrat (Patrick Sassoust) et trafic d'influence · 3 ans dont 1 ferme (confirmé Cassation 2023)",s:"Condamné définitif",liens:["https://www.lemonde.fr","https://www.mediapart.fr"]},
      {t:"Affaire Bygmalion",d:"Financement illégal campagne présidentielle 2012 · 1 an ferme (2023)",s:"Condamné",liens:["https://www.lemonde.fr"]},
      {t:"Affaire Kadhafi",d:"Soupçons de financement libyen campagne 2007 · procès en cours 2025",s:"En procès",liens:["https://www.mediapart.fr","https://www.lemonde.fr"]},
      {t:"Affaire Tapie-Lagarde",d:"Arbitrage suspect en faveur de Bernard Tapie · mis en examen",s:"Classé",liens:["https://www.lemonde.fr"]}
    ],
    cac40:["Cravath Swaine (avocat d'affaires USA après mandat)"],
    nepotisme:["Fils Jean Sarkozy · président EPAD (tentative 2009, abandonnée sous pression médiatique)"],
    pantouflage:"Avocat → Politique → Avocat affaires international"
  },
  { id:"francois-hollande", prenom:"François", nom:"Hollande", parti:"PS", fonction:"Président", periode:"2012-2017",
    retraite:6220, salaire_periode:15000, avantages:["Fort de Brégançon"],
    affaires:[{t:"Liaisons révélées pendant mandat",d:"Relation avec Julie Gayet révélée par Closer (2014) · usage contesté de moyens officiels",s:"Non poursuivi",liens:["https://www.lemonde.fr"]}],
    cac40:[], nepotisme:[], pantouflage:"Normalien → ENA → PS → Président → Fondation"
  },
];

const ANCIENS_PM = [
  { id:"michel-debre", prenom:"Michel", nom:"Debré", parti:"Gaulliste", fonction:"Premier Ministre", periode:"1959-1962", retraite:6220, affaires:[], cac40:[], nepotisme:[] },
  { id:"pierre-messmer", prenom:"Pierre", nom:"Messmer", parti:"Gaulliste", fonction:"Premier Ministre", periode:"1972-1974", retraite:6220, affaires:[], cac40:[], nepotisme:[] },
  { id:"raymond-barre", prenom:"Raymond", nom:"Barre", parti:"Centre", fonction:"Premier Ministre", periode:"1976-1981", retraite:6220, affaires:[], cac40:[], nepotisme:[], pantouflage:"Prof économie → PM → Maire Lyon" },
  { id:"pierre-mauroy", prenom:"Pierre", nom:"Mauroy", parti:"PS", fonction:"Premier Ministre", periode:"1981-1984", retraite:6220, affaires:[], cac40:[], nepotisme:[] },
  { id:"laurent-fabius-pm", prenom:"Laurent", nom:"Fabius", parti:"PS", fonction:"Premier Ministre", periode:"1984-1986", retraite:6220,
    affaires:[{t:"Sang contaminé",d:"Décision de ne pas chauffer le sang contaminé par le VIH · acquitté (2003)",s:"Acquitté",liens:["https://www.lemonde.fr"]}], cac40:[], nepotisme:[]
  },
  { id:"michel-rocard", prenom:"Michel", nom:"Rocard", parti:"PS", fonction:"Premier Ministre", periode:"1988-1991", retraite:6220, affaires:[], cac40:[], nepotisme:[] },
  { id:"edith-cresson", prenom:"Édith", nom:"Cresson", parti:"PS", fonction:"Première Ministre", periode:"1991-1992", retraite:6220,
    affaires:[{t:"Emplois fictifs Parlement Européen",d:"Nomination de son ami René Berthelot comme conseiller fictif au PE · condamnée (2006)",s:"Condamnée",liens:["https://www.lemonde.fr"]}],
    cac40:[], nepotisme:["René Berthelot (ami proche) nommé conseiller fictif au PE"]
  },
  { id:"pierre-beregovoy", prenom:"Pierre", nom:"Bérégovoy", parti:"PS", fonction:"Premier Ministre", periode:"1992-1993", retraite:0, affaires:[], cac40:[], nepotisme:[] },
  { id:"edouard-balladur", prenom:"Édouard", nom:"Balladur", parti:"RPR", fonction:"Premier Ministre", periode:"1993-1995", retraite:6220,
    affaires:[{t:"Affaire Karachi",d:"Soupçons de financement de campagne 1995 via commissions sur ventes d'armes au Pakistan · non-lieu (2020)",s:"Non-lieu",liens:["https://www.lemonde.fr"]}],
    cac40:[], nepotisme:[]
  },
  { id:"alain-juppe-pm", prenom:"Alain", nom:"Juppé", parti:"RPR", fonction:"Premier Ministre", periode:"1995-1997", retraite:6220,
    affaires:[{t:"Emplois fictifs RPR",d:"Condamné pour emplois fictifs · 14 mois sursis + inéligibilité 1 an (2004)",s:"Condamné",liens:["https://www.lemonde.fr"]}], cac40:[], nepotisme:[]
  },
  { id:"lionel-jospin", prenom:"Lionel", nom:"Jospin", parti:"PS", fonction:"Premier Ministre", periode:"1997-2002", retraite:6220, affaires:[], cac40:[], nepotisme:[] },
  { id:"jean-pierre-raffarin", prenom:"Jean-Pierre", nom:"Raffarin", parti:"UMP", fonction:"Premier Ministre", periode:"2002-2004", retraite:6220, affaires:[], cac40:[], nepotisme:[], pantouflage:"Consultant Publicis → PM → Sénateur → Fondation" },
  { id:"dominique-de-villepin", prenom:"Dominique", nom:"de Villepin", parti:"UMP", fonction:"Premier Ministre", periode:"2005-2007", retraite:6220,
    affaires:[{t:"Affaire Clearstream",d:"Accusé d'avoir commandité de fausses listes de comptes offshore visant Sarkozy · relaxé (2011)",s:"Relaxé",liens:["https://www.lemonde.fr"]}],
    cac40:["Total (conseil stratégique après mandat)"], nepotisme:[], pantouflage:"ENA Diplomate → PM → Conseil grandes entreprises"
  },
  { id:"francois-fillon", prenom:"François", nom:"Fillon", parti:"UMP/LR", fonction:"Premier Ministre", periode:"2007-2012", retraite:0,
    affaires:[{t:"Penelope Gate",d:"Emplois fictifs de son épouse Penelope et de ses enfants · 5 ans de prison dont 3 ferme + 375k€ amende (2022)",s:"Condamné définitif",liens:["https://www.lemonde.fr","https://www.mediapart.fr"]}],
    cac40:["Zarubezhneft (admin, Russie)","Vinogradoff Partners (admin)"],
    nepotisme:["Épouse Penelope Fillon employée fictive comme assistante parlementaire (~900k€ sur 10 ans)","Fils Marie et Charles Fillon employés comme assistants parlementaires"],
    pantouflage:"Politique → Administrateur sociétés russes"
  },
  { id:"jean-marc-ayrault", prenom:"Jean-Marc", nom:"Ayrault", parti:"PS", fonction:"Premier Ministre", periode:"2012-2014", retraite:6220, affaires:[], cac40:[], nepotisme:[] },
  { id:"manuel-valls", prenom:"Manuel", nom:"Valls", parti:"PS", fonction:"Premier Ministre", periode:"2014-2016", retraite:0, affaires:[], cac40:[], nepotisme:[], pantouflage:"PM France → Politique Barcelone → Macroniste" },
  { id:"bernard-cazeneuve", prenom:"Bernard", nom:"Cazeneuve", parti:"PS", fonction:"Premier Ministre", periode:"2016-2017", retraite:0, affaires:[], cac40:[], nepotisme:[] },
  { id:"edouard-philippe", prenom:"Édouard", nom:"Philippe", parti:"LR/Horizons", fonction:"Premier Ministre", periode:"2017-2020", retraite:0,
    affaires:[], cac40:[], nepotisme:[],
    pantouflage:"Avocat → Areva (DGA 2010-2010) → PM → Maire Le Havre"
  },
  { id:"jean-castex", prenom:"Jean", nom:"Castex", parti:"LR", fonction:"Premier Ministre", periode:"2020-2022", retraite:0,
    affaires:[], cac40:["RATP (PDG 2022-2024, salaire ~450k€/an)"],
    nepotisme:[], pantouflage:"Haut fonctionnaire ENA → PM → PDG RATP"
  },
  { id:"gabriel-attal", prenom:"Gabriel", nom:"Attal", parti:"Renaissance", fonction:"Premier Ministre", periode:"2024-2024", retraite:0,
    affaires:[], cac40:[], nepotisme:[], pantouflage:""
  },
  { id:"michel-barnier", prenom:"Michel", nom:"Barnier", parti:"LR", fonction:"Premier Ministre", periode:"2024-2024", retraite:6220,
    affaires:[], cac40:[], nepotisme:[],
    pantouflage:"Politique → Commissaire EU → Négociateur Brexit → PM (5 mois)"
  },
];

const EURODEPUTES = [
  // RN (30 sièges)
  { id:"jordan-bardella", prenom:"Jordan", nom:"Bardella", parti:"RN", groupe:"PfE", commission:"Affaires constitutionnelles", debut:2019, salaire:8757, frais:4778, indem:4513,
    avantages:["Indemnité générale 4 513€/mois","Frais de séjour 350€/jour session","Budget secrétariat 27 685€/mois"],
    cac40:[], nepotisme:["Compagnon de Marion Maréchal (nièce Marine Le Pen · petite-fille Jean-Marie Le Pen)"],
    pantouflage:"", affaires:[]
  },
  { id:"thierry-mariani", prenom:"Thierry", nom:"Mariani", parti:"RN", groupe:"PfE", commission:"Transports", debut:2019, salaire:8757, frais:4778, indem:4513,
    avantages:["Indemnité 4 513€/mois"], cac40:[], nepotisme:[], pantouflage:"LR → RN · Proche Poutine",
    affaires:[{t:"Liens avec la Russie",d:"Voyages en Crimée annexée, positions pro-russes documentées",s:"Politiquement controversé",liens:["https://www.lemonde.fr"]}]
  },
  { id:"gilbert-collard", prenom:"Gilbert", nom:"Collard", parti:"RN", groupe:"PfE", commission:"Affaires juridiques", debut:2019, salaire:8757, frais:4778, indem:4513,
    avantages:[], cac40:[], nepotisme:[], pantouflage:"Avocat pénaliste → Politique", affaires:[]
  },
  { id:"jean-paul-garraud", prenom:"Jean-Paul", nom:"Garraud", parti:"RN", groupe:"PfE", commission:"Libertés civiles", debut:2024, salaire:8757, frais:4778, indem:4513,
    avantages:[], cac40:[], nepotisme:[], pantouflage:"Juge → Député AN → Eurodéputé", affaires:[]
  },
  // PS-Place Publique (13 sièges)
  { id:"raphael-glucksmann", prenom:"Raphaël", nom:"Glucksmann", parti:"PS-PP", groupe:"S&D", commission:"Commerce international", debut:2019, salaire:8757, frais:4778, indem:4513,
    avantages:["Indemnité 4 513€/mois"], cac40:[], nepotisme:["Père André Glucksmann (1937-2015) · philosophe · milieux intellectuels"],
    pantouflage:"Documentariste Géorgie → Fondateur Place Publique → Eurodéputé", affaires:[]
  },
  { id:"olivier-faure", prenom:"Olivier", nom:"Faure", parti:"PS", groupe:"S&D", commission:"Affaires constitutionnelles", debut:2024, salaire:8757, frais:4778, indem:4513,
    avantages:[], cac40:[], nepotisme:[], pantouflage:"", affaires:[]
  },
  // Renaissance (13 sièges)
  { id:"valerie-hayer", prenom:"Valérie", nom:"Hayer", parti:"Renaissance", groupe:"Renew (Présidente)", commission:"Budget", debut:2019, salaire:8757, frais:4778, indem:4513,
    avantages:["Présidente groupe Renew · budget supplémentaire"], cac40:[], nepotisme:[], pantouflage:"", affaires:[]
  },
  { id:"pascal-canfin", prenom:"Pascal", nom:"Canfin", parti:"Renaissance", groupe:"Renew", commission:"Environnement (ex-Président)", debut:2019, salaire:8757, frais:4778, indem:4513,
    avantages:[], cac40:["WWF France (ex-DG 2010-2013)"],
    nepotisme:[], pantouflage:"ONG → Ministre Hollande → WWF → Eurodéputé", affaires:[]
  },
  // LR (6 sièges)
  { id:"francois-xavier-bellamy", prenom:"François-Xavier", nom:"Bellamy", parti:"LR", groupe:"PPE", commission:"Environnement", debut:2019, salaire:8757, frais:4778, indem:4513,
    avantages:[], cac40:[], nepotisme:[], pantouflage:"Professeur philosophie → Politique", affaires:[]
  },
  // EELV (6 sièges)
  { id:"yannick-jadot", prenom:"Yannick", nom:"Jadot", parti:"EELV", groupe:"Verts/ALE", commission:"Environnement", debut:2009, salaire:8757, frais:4778, indem:4513,
    avantages:[], cac40:[], nepotisme:[],
    pantouflage:"Greenpeace (DG campagnes) → Politique", affaires:[]
  },
  { id:"marie-toussaint", prenom:"Marie", nom:"Toussaint", parti:"EELV", groupe:"Verts/ALE", commission:"Environnement", debut:2019, salaire:8757, frais:4778, indem:4513,
    avantages:[], cac40:[], nepotisme:[], pantouflage:"Avocate droit environnement → Politique", affaires:[]
  },
  // LFI (6 sièges)
  { id:"manon-aubry", prenom:"Manon", nom:"Aubry", parti:"LFI", groupe:"La Gauche (Co-Présidente)", commission:"Affaires juridiques", debut:2019, salaire:8757, frais:4778, indem:4513,
    avantages:["Co-présidente groupe"], cac40:[], nepotisme:[],
    pantouflage:"Oxfam → Militante → Eurodéputée", affaires:[]
  },
  { id:"rima-hassan", prenom:"Rima", nom:"Hassan", parti:"LFI", groupe:"La Gauche", commission:"Affaires étrangères", debut:2024, salaire:8757, frais:4778, indem:4513,
    avantages:[], cac40:[], nepotisme:[],
    pantouflage:"Avocate droits réfugiés → Eurodéputée", affaires:[]
  },
  // Reconquête (5 sièges)
  { id:"eric-zemmour", prenom:"Éric", nom:"Zemmour", parti:"Reconquête", groupe:"ECR", commission:"Culture", debut:2024, salaire:8757, frais:4778, indem:4513,
    avantages:[], cac40:[],
    nepotisme:[], pantouflage:"Journaliste Le Figaro → Candidat Président → Eurodéputé",
    affaires:[
      {t:"Provocation à la haine raciale",d:"Condamné à 10 000€ d'amende (2011) pour propos sur les musulmans à Grand Journal",s:"Condamné",liens:["https://www.lemonde.fr"]},
      {t:"Incitation à la discrimination",d:"Condamné (2022) pour propos sur les mineurs étrangers",s:"Condamné",liens:["https://www.lemonde.fr"]}
    ]
  },
  { id:"marion-marechal", prenom:"Marion", nom:"Maréchal", parti:"Reconquête", groupe:"ECR", commission:"Culture et éducation", debut:2024, salaire:8757, frais:4778, indem:4513,
    avantages:[], cac40:[],
    nepotisme:["Grand-père Jean-Marie Le Pen · fondateur FN","Tante Marine Le Pen · présidente RN","Compagnon Jordan Bardella · président RN"],
    pantouflage:"Avocate → Députée AN → École ISSEP → Eurodéputée", affaires:[]
  },
  // MoDem
  { id:"nathalie-colin-oesterle", prenom:"Nathalie", nom:"Colin-Oesterlé", parti:"LR", groupe:"PPE", commission:"Industrie", debut:2019, salaire:8757, frais:4778, indem:4513,
    avantages:[], cac40:[], nepotisme:[], pantouflage:"", affaires:[]
  },
  { id:"jerome-lavrilleux", prenom:"Jérôme", nom:"Lavrilleux", parti:"PPE", groupe:"PPE", commission:"", debut:2014, salaire:8757, frais:4778, indem:4513,
    avantages:[], cac40:[],
    nepotisme:[], pantouflage:"UMP directeur campagne → Eurodéputé",
    affaires:[{t:"Affaire Bygmalion",d:"Condamné pour financement illégal campagne Sarkozy 2012 (Bygmalion)",s:"Condamné",liens:["https://www.lemonde.fr"]}]
  },
];

const PREFETS = [
  { id:"pref-75", nom:"Laurent Nuñez", dept:"Paris (75)", region:"Île-de-France", depuis:2022, salaire:8500, affaires:[], cac40:[] },
  { id:"pref-69", nom:"Fabienne Buccio", dept:"Rhône (69)", region:"Auvergne-Rhône-Alpes", depuis:2021, salaire:7800, affaires:[], cac40:[] },
  { id:"pref-13", nom:"Christophe Mirmand", dept:"Bouches-du-Rhône (13)", region:"PACA", depuis:2022, salaire:7800, affaires:[], cac40:[] },
  { id:"pref-33", nom:"Étienne Guyot", dept:"Gironde (33)", region:"Nouvelle-Aquitaine", depuis:2021, salaire:7800, affaires:[], cac40:[] },
  { id:"pref-31", nom:"Pierre-André Durand", dept:"Haute-Garonne (31)", region:"Occitanie", depuis:2021, salaire:7800, affaires:[], cac40:[] },
  { id:"pref-59", nom:"Bertrand Gaume", dept:"Nord (59)", region:"Hauts-de-France", depuis:2020, salaire:7800, affaires:[], cac40:[] },
  { id:"pref-67", nom:"Josiane Chevalier", dept:"Bas-Rhin (67)", region:"Grand Est", depuis:2022, salaire:7800, affaires:[], cac40:[] },
  { id:"pref-44", nom:"Fabrice Rigoulet-Roze", dept:"Loire-Atlantique (44)", region:"Pays de la Loire", depuis:2022, salaire:7800, affaires:[], cac40:[] },
  { id:"pref-76", nom:"Pierre-Edouard Colliex", dept:"Seine-Maritime (76)", region:"Normandie", depuis:2023, salaire:7800, affaires:[], cac40:[] },
  { id:"pref-34", nom:"François-Xavier Lauch", dept:"Hérault (34)", region:"Occitanie", depuis:2023, salaire:7800, affaires:[], cac40:[] },
  { id:"pref-06", nom:"Hugues Moutouh", dept:"Alpes-Maritimes (06)", region:"PACA", depuis:2021, salaire:7800, affaires:[], cac40:[] },
  { id:"pref-57", nom:"Xavier Pelletier", dept:"Moselle (57)", region:"Grand Est", depuis:2023, salaire:7800, affaires:[], cac40:[] },
];

// Élus condamnés (section spéciale)
const CONDAMNES = [
  { id:"nicolas-sarkozy", nom:"Nicolas Sarkozy", fonction:"Ancien Président", jugement:"3 ans dont 1 ferme (Bismuth 2023) + 1 an ferme (Bygmalion 2023)", statut:"Condamné définitif", affaires_count:3 },
  { id:"francois-fillon", nom:"François Fillon", fonction:"Ancien Premier Ministre", jugement:"5 ans dont 3 ferme + 375k€ (Penelope Gate 2022)", statut:"Condamné définitif", affaires_count:1 },
  { id:"marine-le-pen", nom:"Marine Le Pen", fonction:"Ancienne présidente RN", jugement:"2 ans ferme + 5 ans inéligibilité (emplois fictifs PE 2025)", statut:"Condamnée - appel en cours", affaires_count:1 },
  { id:"alain-juppe-cc", nom:"Alain Juppé", fonction:"Membre CC / Ancien PM", jugement:"14 mois sursis + 1 an inéligibilité (emplois fictifs RPR 2004)", statut:"Condamné", affaires_count:1 },
  { id:"jacques-chirac", nom:"Jacques Chirac", fonction:"Ancien Président", jugement:"2 ans sursis (emplois fictifs Paris 2011)", statut:"Condamné - décédé 2019", affaires_count:2 },
  { id:"edith-cresson", nom:"Édith Cresson", fonction:"Ancienne Première Ministre", jugement:"Condamnée emplois fictifs PE (2006)", statut:"Condamnée", affaires_count:1 },
  { id:"eric-zemmour", nom:"Éric Zemmour", fonction:"Eurodéputé / Fondateur Reconquête", jugement:"Condamné haine raciale (2011) + incitation discrimination (2022)", statut:"Condamné x2", affaires_count:2 },
  { id:"jerome-lavrilleux", nom:"Jérôme Lavrilleux", fonction:"Eurodéputé", jugement:"Condamné Bygmalion (financement illégal campagne Sarkozy)", statut:"Condamné", affaires_count:1 },
];

// ── ROUTES ────────────────────────────────────────────────────
app.get("/api/gouvernement", (req, res) => res.json({ gouvernement: GOUV }));
app.get("/api/conseil-constitutionnel", (req, res) => res.json({ membres: CONSEIL_CONSTIT }));
app.get("/api/anciens-presidents", (req, res) => res.json({ presidents: ANCIENS_PRESIDENTS }));
app.get("/api/anciens-pm", (req, res) => res.json({ pm: ANCIENS_PM }));
app.get("/api/eurodeputes", (req, res) => res.json({ eurodeputes: EURODEPUTES }));
app.get("/api/prefets", (req, res) => res.json({ prefets: PREFETS }));
app.get("/api/condamnes", (req, res) => res.json({ condamnes: CONDAMNES }));

// Candidats présidentielle
app.get("/api/presidentielle", (req, res) => res.json({ candidats: [
  { id:"edouard-philippe", nom:"Édouard Philippe", parti:"Horizons", sondage:27 },
  { id:"marine-le-pen", nom:"Marine Le Pen", parti:"RN", sondage:24 },
  { id:"emmanuel-macron", nom:"Emmanuel Macron", parti:"Renaissance", sondage:14 },
  { id:"jean-luc-melenchon", nom:"Jean-Luc Mélenchon", parti:"LFI", sondage:12 },
  { id:"francois-bayrou", nom:"François Bayrou", parti:"MoDem", sondage:8 },
  { id:"bruno-retailleau", nom:"Bruno Retailleau", parti:"LR", sondage:6 },
  { id:"jordan-bardella", nom:"Jordan Bardella", parti:"RN", sondage:5 },
  { id:"eric-zemmour", nom:"Éric Zemmour", parti:"Reconquête", sondage:3 },
]}));

// Députés AN
app.get("/api/deputes", async (req, res) => {
  try {
    const d = await cached("dep", () => xget("https://www.nosdeputes.fr/deputes/json"), 86400000);
    res.json({ deputes: (d?.deputes || []).map(x => x.depute || x) });
  } catch(e) { res.status(500).json({ error: e.message, deputes: [] }); }
});

// Votes d'un député
app.get("/api/depute/:slug/votes", async (req, res) => {
  try {
    const d = await cached("v_"+req.params.slug, () =>
      xget(`https://www.nosdeputes.fr/${req.params.slug}/votes/json`), 3600000);
    const votes = Array.isArray(d) ? d : (d?.votes || []);
    res.json({ votes, stats: {
      pour: votes.filter(v=>(v.vote||v).position==='pour').length,
      contre: votes.filter(v=>(v.vote||v).position==='contre').length,
      abstention: votes.filter(v=>(v.vote||v).position==='abstention').length,
      total: votes.length,
    }});
  } catch(e) { res.status(500).json({ votes: [], stats: {} }); }
});

// Sénateurs
app.get("/api/senateurs", async (req, res) => {
  for (const url of [
    "https://data.senat.fr/data/senateurs/ODSEN_GENERAL.json",
    "https://www.nossenateurs.fr/senateurs/json",
    "https://www.nosdeputes.fr/senateurs/json",
  ]) {
    try {
      const d = await cached("sen_"+url.slice(-10), () => xget(url), 86400000);
      let arr = Array.isArray(d) ? d : (d?.senateurs || []);
      if (!arr.length && d && typeof d === 'object') {
        for (const k of Object.keys(d)) { if (Array.isArray(d[k]) && d[k].length > 0) { arr = d[k]; break; } }
      }
      arr = arr.map(s => s.senateur || s);
      if (arr.length > 10) {
        const s0 = arr[0];
        const fP = s0.PRENOM!==undefined?'PRENOM':s0.prenom!==undefined?'prenom':'';
        const fN = s0.NOM!==undefined?'NOM':s0.nom!==undefined?'nom':s0.nom_de_famille!==undefined?'nom_de_famille':'';
        return res.json({ senateurs: arr.map(s => ({
          slug: ((s[fP]||'')+(s[fN]||'')).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z]/g,'-').replace(/-+/g,'-'),
          prenom: s[fP]||s.prenom||'', nom_de_famille: s[fN]||s.nom||'',
          nom: ((s[fP]||s.prenom||'')+' '+(s[fN]||s.nom||'')).trim(),
          groupe_sigle: s.GROUPE_POLITIQUE_SIGLE||s.groupe_sigle||'',
          nom_circo: s.DEPARTEMENT||s.departement||s.nom_circo||'',
          date_debut_mandat: s.DATE_DEBUT_MANDAT||s.date_debut_mandat||'',
        }))});
      }
    } catch(e) { console.log("Sen fallback:", e.message); }
  }
  res.status(500).json({ senateurs: [] });
});

// Maires RNE
app.get("/api/maires", async (req, res) => {
  const { q="", dept="", page=1, page_size=50, parti="" } = req.query;
  try {
    let url = `https://tabular-api.data.gouv.fr/api/resources/d5f400de-ae3f-4966-8cb6-a85c70c6c24a/data/?page_size=${Math.min(+page_size,100)}&page=${page}`;
    if (dept) url += `&CodeOfDepartement__exact=${encodeURIComponent(dept)}`;
    if (q) url += `&Nom__contains=${encodeURIComponent(q)}`;
    if (parti) url += `&NuancePolitiqueCode__exact=${encodeURIComponent(parti)}`;
    const d = await xget(url);
    res.json(d);
  } catch(e) { res.status(500).json({ error: e.message, data: [], total: 0 }); }
});

// Recherche unifiée
app.get("/api/search/:q", async (req, res) => {
  const q = req.params.q.toLowerCase();
  const local = [
    ...GOUV.map(m => ({ ...m, role: m.fonction, dept: m.ministere, cat: 'gouvernement' })),
    ...CONSEIL_CONSTIT.map(m => ({ ...m, role: m.fonction, dept: 'Conseil Constitutionnel', cat: 'conseil-constitutionnel', nom: m.prenom+' '+m.nom })),
    ...ANCIENS_PRESIDENTS.map(m => ({ ...m, role: m.fonction+' '+m.periode, dept: 'République', cat: 'anciens-presidents', nom: m.prenom+' '+m.nom })),
    ...EURODEPUTES.map(m => ({ ...m, role: 'Eurodéputé '+m.groupe, dept: 'Parlement Européen', cat: 'eurodeputes', nom: m.prenom+' '+m.nom })),
    ...PREFETS.map(m => ({ ...m, role: 'Préfet '+m.dept, dept: m.region, cat: 'prefets', prenom:'', nom_famille: m.nom.split(' ').pop() })),
  ].filter(x => (x.nom||'').toLowerCase().includes(q)).slice(0, 5);
  try {
    const r = await Promise.allSettled([
      xget(`https://www.nosdeputes.fr/recherche/${encodeURIComponent(req.params.q)}/json`),
      xget(`https://tabular-api.data.gouv.fr/api/resources/d5f400de-ae3f-4966-8cb6-a85c70c6c24a/data/?page_size=3&Nom__contains=${encodeURIComponent(req.params.q)}`),
    ]);
    const deps = r[0].status==='fulfilled' ? (r[0].value?.deputes||[]).map(x=>({...(x.depute||x),cat:'deputes'})).slice(0,3) : [];
    const maires = r[1].status==='fulfilled' ? (r[1].value?.data||[]).map(m=>({
      id: m.CodeElu, nom: (m.Prenom||m.PrenomElu||'')+' '+(m.Nom||m.NomElu||''),
      prenom: m.Prenom||m.PrenomElu||'', nom_famille: (m.Nom||m.NomElu||'').toUpperCase(),
      role: m.LibelleQualite||'Élu local', dept: m.LibelleCommune||'', cat:'maires',
    })).slice(0,2) : [];
    res.json({ results: [...local, ...deps, ...maires] });
  } catch(e) { res.json({ results: local }); }
});

// HATVP patrimoine
app.get("/api/hatvp", async (req, res) => {
  const { nom="", prenom="" } = req.query;
  try {
    const url = `https://www.hatvp.fr/rest/api/declarations?limit=5&nom=${encodeURIComponent(nom)}&prenom=${encodeURIComponent(prenom)}`;
    const d = await xget(url);
    res.json({ declarations: d.declarations || d.results || [] });
  } catch(e) { res.status(500).json({ declarations: [] }); }
});

// Lois Légifrance
app.get("/api/lois", async (req, res) => {
  const { q="", page=1, page_size=20 } = req.query;
  const cid = process.env.LEGIFRANCE_CLIENT_ID;
  const csec = process.env.LEGIFRANCE_CLIENT_SECRET;
  if (cid && csec) {
    try {
      if (!C._legiToken || Date.now() > (C._legiExp||0)) {
        const tr = await fetch("https://oauth.piste.gouv.fr/api/oauth/token", {
          method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"},
          body: new URLSearchParams({ grant_type:"client_credentials", client_id:cid, client_secret:csec, scope:"openid" }),
          signal: AbortSignal.timeout(8000),
        });
        const td = await tr.json();
        C._legiToken = td.access_token; C._legiExp = Date.now() + (td.expires_in-60)*1000;
      }
      const lr = await fetch("https://api.piste.gouv.fr/dila/legifrance/lf-engine-app/search", {
        method:"POST",
        headers:{ Authorization:`Bearer ${C._legiToken}`, "Content-Type":"application/json" },
        body: JSON.stringify({ recherche: { champs:[{typeChamp:"TITLE",criteres:[{typeRecherche:"CONTIENT",valeur:q||"loi"}]}], filtres:[{facette:"NATURE",valeur:"LOI"}], pageNumber:+page, pageSize:+page_size, sort:"PERTINENCE", typePagination:"DEFAUT" } }),
        signal: AbortSignal.timeout(10000),
      });
      const ld = await lr.json();
      if (ld.results?.length) return res.json({ lois: ld.results.map(l=>({ titre:l.title||l.titre, numero:l.numero, date:l.dateTexte||l.date, url:`https://www.legifrance.gouv.fr/loda/id/${l.id}` })), total: ld.totalResultNumber, source:"legifrance" });
    } catch(le) { console.log("Legi:", le.message); }
  }
  const STATIC = [
    {titre:"Réforme des retraites (64 ans)",numero:"2023-270",date:"2023-04-14",url:"https://www.legifrance.gouv.fr/loda/id/JORFTEXT000047466785"},
    {titre:"Loi immigration Darmanin",numero:"2024-42",date:"2024-01-26",url:"https://www.legifrance.gouv.fr/loda/id/JORFTEXT000049042716"},
    {titre:"Mariage pour tous",numero:"2013-404",date:"2013-05-17",url:"https://www.legifrance.gouv.fr/loda/id/JORFTEXT000027414232"},
    {titre:"Loi Veil - IVG",numero:"75-17",date:"1975-01-17",url:"https://www.legifrance.gouv.fr"},
    {titre:"Constitution Ve République",numero:"58-1958",date:"1958-10-04",url:"https://www.legifrance.gouv.fr"},
    {titre:"Loi El Khomri (Travail)",numero:"2016-1088",date:"2016-08-08",url:"https://www.legifrance.gouv.fr"},
  ];
  res.json({ lois: q ? STATIC.filter(l=>l.titre.toLowerCase().includes(q.toLowerCase())) : STATIC, total: STATIC.length, source:"statique" });
});

// IA Claude
app.post("/ia", async (req, res) => {
  const { messages } = req.body;
  if (!messages) return res.status(400).json({ error: "messages requis" });
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST",
      headers:{ "Content-Type":"application/json", "x-api-key":process.env.ANTHROPIC_API_KEY||"", "anthropic-version":"2023-06-01" },
      body: JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:1024,
        system:"Tu es l'assistant de TransparenceFrance.fr. Tu réponds sur les élus français : coûts, salaires, affaires judiciaires, patrimoine, réseaux d'influence, nepotisme, pantouflage. Sois factuel et cite tes sources.",
        messages: messages.slice(-10) }),
    });
    const d = await r.json();
    res.json({ content: d.content?.[0]?.text || "Désolé, impossible de répondre." });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Préchargement
async function preload() {
  console.log("🔄 Préchargement...");
  try { const d = await xget("https://www.nosdeputes.fr/deputes/json"); if (d?.deputes?.length) { C["dep"]={d,t:Date.now()}; console.log("✅ Députés:", d.deputes.length); } } catch(e) { console.log("⚠️ Députés:", e.message); }
  for (const url of ["https://data.senat.fr/data/senateurs/ODSEN_GENERAL.json","https://www.nosdeputes.fr/senateurs/json"]) {
    try { const d = await xget(url); const arr = Array.isArray(d)?d:(d?.senateurs||[]); if (arr.length>10) { C["sen_"+url.slice(-10)]={d:arr,t:Date.now()}; console.log("✅ Sénateurs:",arr.length); break; } } catch(e) { console.log("⚠️ Sénat:", e.message); }
  }
  console.log("✅ Prêt !");
}

app.get("/", (req, res) => res.json({ status:"✅ TransparenceFrance API v7", routes: Object.keys(app._router?.stack?.filter(r=>r.route)?.reduce((a,r)=>({...a,[r.route.path]:1}),{})||{}) }));

app.listen(PORT, () => { console.log(`✅ Port ${PORT}`); preload().catch(console.error); });
