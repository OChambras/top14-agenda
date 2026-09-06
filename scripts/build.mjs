// Génère docs/top14.ics + docs/data.json depuis le flux public ESPN (Top 14, id 270559).
// Aucune dépendance : Node 18+ (fetch natif).
import { writeFileSync, mkdirSync } from "node:fs";

const LEAGUE = "270559";
const SEASON_START = "20260801";
const SEASON_END = "20270731";
const OUT = new URL("../docs/", import.meta.url);

const NOMS = {
  "Bordeaux Begles": "Bordeaux-Bègles",
  "Stade Francais Paris": "Stade Français",
  "Montpellier Herault": "Montpellier",
  "Clermont Auvergne": "Clermont",
  "Castres Olympique": "Castres",
  "Stade Toulousain": "Stade Toulousain",
};
const nom = (t) => NOMS[t] ?? t;

async function getJson(url) {
  const r = await fetch(url, { headers: { "user-agent": "top14-agenda/1.0" } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

const [score, table] = await Promise.all([
  getJson(`https://site.api.espn.com/apis/site/v2/sports/rugby/${LEAGUE}/scoreboard?dates=${SEASON_START}-${SEASON_END}&limit=500`),
  getJson(`https://site.api.espn.com/apis/v2/sports/rugby/${LEAGUE}/standings?season=2027`),
]);

// --- Classement -----------------------------------------------------------
const entries = table.children?.[0]?.standings?.entries ?? [];
const stat = (e, n) => e.stats.find((s) => s.name === n)?.value ?? 0;
const classement = entries
  .map((e) => ({
    id: e.team.id,
    equipe: nom(e.team.displayName),
    rang: stat(e, "rank"),
    pts: stat(e, "points"),
    j: stat(e, "gamesPlayed"),
    g: stat(e, "gamesWon"),
    n: stat(e, "gamesDrawn"),
    p: stat(e, "gamesLost"),
    pour: stat(e, "pointsFor"),
    contre: stat(e, "pointsAgainst"),
    diff: stat(e, "pointsFor") - stat(e, "pointsAgainst"),
    bo: stat(e, "bonusPointsTry"),
    bd: stat(e, "bonusPointsLosing"),
  }))
  .sort((a, b) => a.rang - b.rang);
const teamIds = new Set(classement.map((c) => c.id));

// --- Matchs ---------------------------------------------------------------
const seen = new Set();
const matchs = [];
for (const ev of score.events ?? []) {
  const c = ev.competitions[0];
  const home = c.competitors.find((t) => t.homeAway === "home");
  const away = c.competitors.find((t) => t.homeAway === "away");
  if (!home || !away) continue;
  // ESPN glisse parfois des doublons ou des équipes fantômes : on ne garde que les 14 clubs.
  if (teamIds.size && (!teamIds.has(home.team.id) || !teamIds.has(away.team.id))) continue;
  const key = `${ev.date.slice(0, 10)}|${home.team.id}|${away.team.id}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const fini = ev.status.type.completed === true;
  const enCours = ev.status.type.state === "in";
  matchs.push({
    id: ev.id,
    date: ev.date,
    horaireConnu: !ev.date.endsWith("T00:00Z"),
    dom: nom(home.team.displayName),
    ext: nom(away.team.displayName),
    sd: fini || enCours ? Number(home.score) : null,
    se: fini || enCours ? Number(away.score) : null,
    fini,
    enCours,
    stade: c.venue?.fullName ?? "",
    ville: c.venue?.address?.city ?? "",
  });
}
matchs.sort((a, b) => a.date.localeCompare(b.date));

// Journées : un week-end (vendredi → dimanche) = une journée, numérotée dans l'ordre.
function isoWeekKey(iso) {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7; // lundi = 0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}
const semaines = [...new Set(matchs.map((m) => isoWeekKey(m.date)))].sort();
const journeeDe = new Map(semaines.map((w, i) => [w, i + 1]));
for (const m of matchs) m.journee = journeeDe.get(isoWeekKey(m.date));

// Forme = résultats de la saison en cours uniquement (ESPN mélange avec la saison passée).
for (const c of classement) {
  c.forme = matchs
    .filter((m) => m.fini && (m.dom === c.equipe || m.ext === c.equipe))
    .map((m) => {
      const pour = m.dom === c.equipe ? m.sd : m.se;
      const contre = m.dom === c.equipe ? m.se : m.sd;
      return pour > contre ? "W" : pour < contre ? "L" : "D";
    })
    .join("");
}

// --- ICS ------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, "0");
const icsUtc = (iso) => {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
};
const icsDate = (iso) => iso.slice(0, 10).replaceAll("-", "");
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
const now = icsUtc(new Date().toISOString());

const lines = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//top14-agenda//FR",
  "CALSCALE:GREGORIAN",
  "METHOD:PUBLISH",
  "X-WR-CALNAME:Top 14 2026-2027",
  "X-WR-TIMEZONE:Europe/Paris",
  "X-PUBLISHED-TTL:PT3H",
  "REFRESH-INTERVAL;VALUE=DURATION:PT3H",
];

for (const m of matchs) {
  let titre;
  if (m.fini) titre = `🏉 ${m.dom} ${m.sd} - ${m.se} ${m.ext}`;
  else if (m.enCours) titre = `🏉 ${m.dom} ${m.sd} - ${m.se} ${m.ext} (en cours)`;
  else titre = `🏉 ${m.dom} - ${m.ext}`;
  const desc = [
    `Top 14 — Journée ${m.journee}`,
    m.fini ? `Score final : ${m.dom} ${m.sd} - ${m.se} ${m.ext}` : m.horaireConnu ? "Coup d'envoi (heure de Paris dans votre agenda)" : "Horaire pas encore fixé par la LNR",
    m.stade ? `Stade : ${m.stade}${m.ville ? ` (${m.ville})` : ""}` : "",
    "Mis à jour automatiquement.",
  ].filter(Boolean).join("\n");
  lines.push("BEGIN:VEVENT");
  lines.push(`UID:top14-${m.id}@top14-agenda`);
  lines.push(`DTSTAMP:${now}`);
  lines.push(`LAST-MODIFIED:${now}`);
  lines.push(`SEQUENCE:${m.fini ? 2 : m.enCours ? 1 : 0}`);
  if (m.horaireConnu) {
    lines.push(`DTSTART:${icsUtc(m.date)}`);
    lines.push(`DTEND:${icsUtc(new Date(new Date(m.date).getTime() + 2 * 3600 * 1000).toISOString())}`);
  } else {
    // Date connue, heure inconnue : événement « journée entière » sur la bonne date.
    const next = new Date(new Date(m.date).getTime() + 86400 * 1000).toISOString();
    lines.push(`DTSTART;VALUE=DATE:${icsDate(m.date)}`);
    lines.push(`DTEND;VALUE=DATE:${icsDate(next)}`);
  }
  lines.push(fold(`SUMMARY:${esc(titre)}`));
  if (m.stade) lines.push(fold(`LOCATION:${esc(`${m.stade}${m.ville ? `, ${m.ville}` : ""}`)}`));
  lines.push(fold(`DESCRIPTION:${esc(desc)}`));
  lines.push(`CATEGORIES:Top 14,Rugby`);
  lines.push("END:VEVENT");
}

// Un événement « Classement » (journée entière) après la dernière journée jouée.
const journeesJouees = matchs.filter((m) => m.fini).map((m) => m.journee);
if (journeesJouees.length) {
  const derniere = Math.max(...journeesJouees);
  const dernierMatch = matchs.filter((m) => m.fini && m.journee === derniere).at(-1);
  const lendemain = new Date(new Date(dernierMatch.date).getTime() + 86400 * 1000).toISOString();
  const tableau = classement
    .map((c) => `${String(c.rang).padStart(2)}. ${c.equipe} — ${c.pts} pts (${c.g}G ${c.n}N ${c.p}P, diff ${c.diff >= 0 ? "+" : ""}${c.diff})`)
    .join("\n");
  lines.push("BEGIN:VEVENT");
  lines.push(`UID:top14-classement@top14-agenda`);
  lines.push(`DTSTAMP:${now}`);
  lines.push(`LAST-MODIFIED:${now}`);
  lines.push(`SEQUENCE:${derniere}`);
  lines.push(`DTSTART;VALUE=DATE:${icsDate(lendemain)}`);
  lines.push(`DTEND;VALUE=DATE:${icsDate(new Date(new Date(lendemain).getTime() + 86400 * 1000).toISOString())}`);
  lines.push(fold(`SUMMARY:${esc(`🏆 Classement Top 14 après J${derniere}`)}`));
  lines.push(fold(`DESCRIPTION:${esc(tableau)}`));
  lines.push("END:VEVENT");
}
lines.push("END:VCALENDAR");

mkdirSync(OUT, { recursive: true });
writeFileSync(new URL("top14.ics", OUT), lines.join("\r\n") + "\r\n");
writeFileSync(
  new URL("data.json", OUT),
  JSON.stringify({ misAJour: new Date().toISOString(), saison: "2026-2027", classement, matchs }, null, 1),
);
console.log(`${matchs.length} matchs (${matchs.filter((m) => m.fini).length} joués), ${classement.length} équipes, ${semaines.length} journées.`);
