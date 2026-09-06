// Génère, pour chaque compétition, docs/<slug>.ics + docs/<slug>.json depuis le flux public ESPN.
// Aucune dépendance : Node 18+ (fetch natif).
import { writeFileSync, mkdirSync } from "node:fs";

const OUT = new URL("../docs/", import.meta.url);

const COMPETITIONS = [
  { slug: "top14", nom: "Top 14 2026-2027", court: "Top 14", espn: "270559", saison: 2027, dates: "20260801-20270731", groupement: "weekend", poules: false },
  { slug: "champions-cup", nom: "Champions Cup 2026-2027", court: "Coupe d'Europe", espn: "271937", saison: 2027, dates: "20260801-20270731", groupement: "weekend", poules: true },
  { slug: "challenge-cup", nom: "Challenge Cup 2026-2027", court: "Challenge Cup", espn: "272073", saison: 2027, dates: "20260801-20270731", groupement: "weekend", poules: true },
  { slug: "coupe-du-monde", nom: "Coupe du monde 2027", court: "Coupe du monde", espn: "164205", saison: 2027, dates: "20270801-20271231", groupement: "jour", poules: true },
];

const NOMS = {
  "Bordeaux Begles": "Bordeaux-Bègles", "Stade Francais Paris": "Stade Français", "Montpellier Herault": "Montpellier",
  "Clermont Auvergne": "Clermont", "Castres Olympique": "Castres",
  "Gloucester Rugby": "Gloucester", "Bath Rugby": "Bath", "Bristol Rugby": "Bristol", "Cardiff Blues": "Cardiff",
  "Australia": "Australie", "New Zealand": "Nouvelle-Zélande", "South Africa": "Afrique du Sud", "England": "Angleterre",
  "Ireland": "Irlande", "Scotland": "Écosse", "Wales": "Pays de Galles", "Italy": "Italie", "Argentina": "Argentine",
  "Japan": "Japon", "Fiji": "Fidji", "Georgia": "Géorgie", "Romania": "Roumanie", "Spain": "Espagne", "Chile": "Chili",
  "Hong Kong": "Hong Kong", "United States of America": "États-Unis", "Zimbabwe": "Zimbabwe", "Tonga": "Tonga",
  "Samoa": "Samoa", "Uruguay": "Uruguay", "Portugal": "Portugal", "Canada": "Canada", "France": "France",
};
const nom = (t) => NOMS[t] ?? t;
// Poules de la Coupe du monde 2027 absentes du flux ESPN : lettre déduite d'une équipe repère.
const POULE_REPERE = { France: "Poule E", Angleterre: "Poule F" };

async function getJson(url) {
  const r = await fetch(url, { headers: { "user-agent": "top14-agenda/1.0" } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

// --- utilitaires ICS ------------------------------------------------------
const pad = (n) => String(n).padStart(2, "0");
const icsUtc = (iso) => {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
};
const icsDate = (iso) => iso.slice(0, 10).replaceAll("-", "");
const plusJours = (iso, n) => new Date(new Date(iso).getTime() + n * 86400 * 1000).toISOString();
const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
const fold = (line) => {
  // Pliage RFC 5545 par points de code (jamais au milieu d'un emoji).
  const chars = Array.from(line);
  const out = [];
  let i = 0;
  while (i < chars.length) {
    const take = i === 0 ? 70 : 69;
    out.push((i === 0 ? "" : " ") + chars.slice(i, i + take).join(""));
    i += take;
  }
  return out.join("\r\n");
};
const isoWeekKey = (iso) => {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7; // lundi = 0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
};

// --- une compétition ------------------------------------------------------
async function construire(comp) {
  const score = await getJson(`https://site.api.espn.com/apis/site/v2/sports/rugby/${comp.espn}/scoreboard?dates=${comp.dates}&limit=500`);
  let table = { children: [] };
  try {
    table = await getJson(`https://site.api.espn.com/apis/v2/sports/rugby/${comp.espn}/standings?season=${comp.saison}`);
  } catch (e) {
    console.warn(`${comp.slug}: classement ESPN indisponible (${e.message})`);
  }

  // Classement ESPN (par poule si la compétition en a).
  const stat = (e, n) => e.stats.find((s) => s.name === n)?.value ?? 0;
  const groupesEspn = (table.children ?? [])
    .filter((ch) => ch.standings?.entries?.length)
    .map((ch) => ({
      poule: comp.poules ? ch.name.replace(/^Pool /, "Poule ") : "",
      equipes: ch.standings.entries.map((e) => ({
        id: e.team.id,
        equipe: nom(e.team.displayName),
        rang: stat(e, "rank"), pts: stat(e, "points"), j: stat(e, "gamesPlayed"),
        g: stat(e, "gamesWon"), n: stat(e, "gamesDrawn"), p: stat(e, "gamesLost"),
        pour: stat(e, "pointsFor"), contre: stat(e, "pointsAgainst"),
        diff: stat(e, "pointsFor") - stat(e, "pointsAgainst"),
        bo: stat(e, "bonusPointsTry"), bd: stat(e, "bonusPointsLosing"),
      })).sort((a, b) => a.rang - b.rang),
    }));
  const idsEspn = new Set(groupesEspn.flatMap((g) => g.equipes.map((e) => e.id)));

  // Matchs.
  const seen = new Set();
  const matchs = [];
  const idsMatchs = new Set();
  for (const ev of score.events ?? []) {
    const c = ev.competitions[0];
    const home = c.competitors.find((t) => t.homeAway === "home");
    const away = c.competitors.find((t) => t.homeAway === "away");
    if (!home || !away) continue;
    // ESPN glisse parfois des doublons ou des équipes fantômes : en championnat, on ne garde que les clubs du classement.
    if (!comp.poules && idsEspn.size && (!idsEspn.has(home.team.id) || !idsEspn.has(away.team.id))) continue;
    const key = `${ev.date.slice(0, 10)}|${home.team.id}|${away.team.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    idsMatchs.add(home.team.id); idsMatchs.add(away.team.id);
    const fini = ev.status.type.completed === true;
    const enCours = ev.status.type.state === "in";
    matchs.push({
      id: ev.id, date: ev.date, horaireConnu: !ev.date.endsWith("T00:00Z"),
      domId: home.team.id, extId: away.team.id,
      dom: nom(home.team.displayName), ext: nom(away.team.displayName),
      sd: fini || enCours ? Number(home.score) : null, se: fini || enCours ? Number(away.score) : null,
      fini, enCours,
      stade: c.venue?.fullName ?? "", ville: c.venue?.address?.city ?? "",
      note: (c.notes ?? []).map((n) => n.headline).filter(Boolean).join(" · "),
    });
  }
  matchs.sort((a, b) => a.date.localeCompare(b.date));

  // Classement : ESPN s'il couvre toutes les équipes, sinon calcul depuis les matchs
  // (poules déduites des confrontations : chaque équipe joue les autres de sa poule).
  let groupes = groupesEspn;
  const manquants = [...idsMatchs].filter((id) => !idsEspn.has(id));
  if (manquants.length) {
    const voisins = new Map();
    for (const m of matchs) {
      if (!voisins.has(m.domId)) voisins.set(m.domId, new Set());
      if (!voisins.has(m.extId)) voisins.set(m.extId, new Set());
      voisins.get(m.domId).add(m.extId); voisins.get(m.extId).add(m.domId);
    }
    const nomDe = new Map(matchs.flatMap((m) => [[m.domId, m.dom], [m.extId, m.ext]]));
    const vus = new Set(idsEspn);
    const nouveaux = [];
    for (const id of manquants) {
      if (vus.has(id)) continue;
      const comp2 = []; const pile = [id];
      while (pile.length) {
        const x = pile.pop();
        if (vus.has(x)) continue;
        vus.add(x); comp2.push(x);
        for (const v of voisins.get(x) ?? []) if (!vus.has(v)) pile.push(v);
      }
      const equipes = comp2.map((tid) => {
        const e = { id: tid, equipe: nomDe.get(tid), pts: 0, j: 0, g: 0, n: 0, p: 0, pour: 0, contre: 0, diff: 0, bo: 0, bd: 0 };
        for (const m of matchs.filter((m) => m.fini && (m.domId === tid || m.extId === tid))) {
          const pour = m.domId === tid ? m.sd : m.se, contre = m.domId === tid ? m.se : m.sd;
          e.j++; e.pour += pour; e.contre += contre;
          if (pour > contre) { e.g++; e.pts += 4; } else if (pour === contre) { e.n++; e.pts += 2; } else { e.p++; if (contre - pour <= 7) { e.p; e.bd++; e.pts += 1; } }
        }
        e.diff = e.pour - e.contre;
        return e;
      }).sort((a, b) => b.pts - a.pts || b.diff - a.diff || b.pour - a.pour || a.equipe.localeCompare(b.equipe));
      equipes.forEach((e, i) => (e.rang = i + 1));
      const repere = equipes.map((e) => POULE_REPERE[e.equipe]).find(Boolean);
      nouveaux.push({ poule: comp.poules ? repere ?? "" : "", equipes, approximatif: true });
    }
    // Lettres restantes attribuées dans l'ordre pour les poules sans repère.
    const lettres = "ABCDEFGH".split("").map((l) => `Poule ${l}`).filter((l) => ![...groupesEspn, ...nouveaux].some((g) => g.poule === l));
    for (const g of nouveaux) if (comp.poules && !g.poule) g.poule = lettres.shift() ?? "Poule ?";
    groupes = [...groupesEspn, ...nouveaux].sort((a, b) => a.poule.localeCompare(b.poule));
  }

  // Poule de chaque match + forme sur la saison uniquement (ESPN mélange avec la saison passée).
  const pouleDe = new Map(groupes.flatMap((g) => g.equipes.map((e) => [e.id, g.poule])));
  for (const m of matchs) m.poule = pouleDe.get(m.domId) && pouleDe.get(m.domId) === pouleDe.get(m.extId) ? pouleDe.get(m.domId) : "";
  for (const g of groupes) for (const c of g.equipes) {
    c.forme = matchs.filter((m) => m.fini && (m.domId === c.id || m.extId === c.id))
      .map((m) => { const pour = m.domId === c.id ? m.sd : m.se, contre = m.domId === c.id ? m.se : m.sd; return pour > contre ? "W" : pour < contre ? "L" : "D"; })
      .join("");
  }

  // Journées : en championnat, un week-end (vendredi → dimanche) = une journée ; en Coupe du monde, un bloc par jour.
  const cle = comp.groupement === "jour" ? (m) => m.date.slice(0, 10) : (m) => isoWeekKey(m.date);
  const cles = [...new Set(matchs.map(cle))].sort();
  const numDe = new Map(cles.map((k, i) => [k, i + 1]));
  for (const m of matchs) m.journee = numDe.get(cle(m));
  const libelleJournee = (m) => (comp.groupement === "jour" ? "" : `Journée ${m.journee}`);

  // ICS.
  const now = icsUtc(new Date().toISOString());
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//top14-agenda//FR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${comp.nom}`, "X-WR-TIMEZONE:Europe/Paris", "X-PUBLISHED-TTL:PT3H", "REFRESH-INTERVAL;VALUE=DURATION:PT3H",
  ];
  for (const m of matchs) {
    const titre = m.fini ? `🏉 ${m.dom} ${m.sd} - ${m.se} ${m.ext}`
      : m.enCours ? `🏉 ${m.dom} ${m.sd} - ${m.se} ${m.ext} (en cours)`
      : `🏉 ${m.dom} - ${m.ext}`;
    const desc = [
      [comp.court, libelleJournee(m), m.poule, m.note].filter(Boolean).join(" — "),
      m.fini ? `Score final : ${m.dom} ${m.sd} - ${m.se} ${m.ext}` : m.horaireConnu ? "Coup d'envoi (heure de Paris dans votre agenda)" : "Horaire pas encore fixé",
      m.stade ? `Stade : ${m.stade}${m.ville ? ` (${m.ville})` : ""}` : "",
      "Mis à jour automatiquement.",
    ].filter(Boolean).join("\n");
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${comp.slug}-${m.id}@top14-agenda`);
    lines.push(`DTSTAMP:${now}`, `LAST-MODIFIED:${now}`, `SEQUENCE:${m.fini ? 2 : m.enCours ? 1 : 0}`);
    if (m.horaireConnu) {
      lines.push(`DTSTART:${icsUtc(m.date)}`, `DTEND:${icsUtc(new Date(new Date(m.date).getTime() + 2 * 3600 * 1000).toISOString())}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${icsDate(m.date)}`, `DTEND;VALUE=DATE:${icsDate(plusJours(m.date, 1))}`);
    }
    lines.push(fold(`SUMMARY:${esc(titre)}`));
    if (m.stade) lines.push(fold(`LOCATION:${esc(`${m.stade}${m.ville ? `, ${m.ville}` : ""}`)}`));
    lines.push(fold(`DESCRIPTION:${esc(desc)}`));
    lines.push(`CATEGORIES:${esc(comp.court)},Rugby`);
    lines.push("END:VEVENT");
  }
  // Un événement « Classement » (journée entière) après la dernière journée jouée.
  const joues = matchs.filter((m) => m.fini);
  if (joues.length) {
    const dernier = joues.at(-1);
    const lendemain = plusJours(dernier.date, 1);
    const tableau = groupes.map((g) => [g.poule, ...g.equipes.map((c) =>
      `${String(c.rang).padStart(2)}. ${c.equipe} — ${c.pts} pts (${c.g}G ${c.n}N ${c.p}P, diff ${c.diff >= 0 ? "+" : ""}${c.diff})`)].filter(Boolean).join("\n")).join("\n\n");
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${comp.slug}-classement@top14-agenda`);
    lines.push(`DTSTAMP:${now}`, `LAST-MODIFIED:${now}`, `SEQUENCE:${joues.length}`);
    lines.push(`DTSTART;VALUE=DATE:${icsDate(lendemain)}`, `DTEND;VALUE=DATE:${icsDate(plusJours(lendemain, 1))}`);
    lines.push(fold(`SUMMARY:${esc(`🏆 Classement ${comp.court}${comp.groupement === "jour" ? "" : ` après J${dernier.journee}`}`)}`));
    lines.push(fold(`DESCRIPTION:${esc(tableau)}`));
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");

  writeFileSync(new URL(`${comp.slug}.ics`, OUT), lines.join("\r\n") + "\r\n");
  writeFileSync(new URL(`${comp.slug}.json`, OUT), JSON.stringify({
    misAJour: new Date().toISOString(), slug: comp.slug, nom: comp.nom, court: comp.court, groupement: comp.groupement,
    groupes, matchs: matchs.map(({ domId, extId, ...m }) => m),
  }, null, 1));
  console.log(`${comp.slug}: ${matchs.length} matchs (${joues.length} joués), ${groupes.reduce((n, g) => n + g.equipes.length, 0)} équipes, ${cles.length} ${comp.groupement === "jour" ? "jours" : "journées"}.`);
  return { slug: comp.slug, nom: comp.nom, court: comp.court, matchs: matchs.length, joues: joues.length, debut: matchs[0]?.date ?? null, fin: matchs.at(-1)?.date ?? null };
}

mkdirSync(OUT, { recursive: true });
const index = [];
for (const comp of COMPETITIONS) {
  try { index.push(await construire(comp)); }
  catch (e) { console.error(`${comp.slug}: ÉCHEC ${e.message}`); process.exitCode = 1; }
}
writeFileSync(new URL("index.json", OUT), JSON.stringify({ misAJour: new Date().toISOString(), competitions: index }, null, 1));
