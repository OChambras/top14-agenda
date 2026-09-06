# Top 14 → Google Agenda

Calendrier du Top 14 (saison 2026-2027) avec les scores qui se mettent à jour tout seuls,
plus une page classement / résultats.

- **Calendrier à abonner** : `https://ochambras.github.io/top14-agenda/top14.ics`
- **Page classement et résultats** : `https://ochambras.github.io/top14-agenda/`

## Installer dans Google Agenda

1. Ouvrir [Google Agenda](https://calendar.google.com) sur ordinateur.
2. À gauche, à côté de « Autres agendas », cliquer sur **+** puis **À partir de l'URL**.
3. Coller `https://ochambras.github.io/top14-agenda/top14.ics` et valider.

Le calendrier « Top 14 2026-2027 » apparaît, y compris sur le téléphone. Google le relit
régulièrement : les scores s'affichent dans le titre du match une fois la rencontre terminée.

## Comment ça marche

`scripts/build.mjs` lit le flux public ESPN du Top 14, écrit `docs/top14.ics` et
`docs/data.json`. Une action GitHub relance ce script toutes les 2 heures et publie le
résultat via GitHub Pages. Aucune dépendance, aucun secret.
