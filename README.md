# Rugby → Google Agenda

Calendriers du rugby avec les scores qui se mettent à jour tout seuls, plus une page
classement / résultats par compétition.

| Compétition | Calendrier à abonner |
|---|---|
| Top 14 2026-2027 | `https://ochambras.github.io/top14-agenda/top14.ics` |
| Champions Cup 2026-2027 (Coupe d'Europe) | `https://ochambras.github.io/top14-agenda/champions-cup.ics` |
| Challenge Cup 2026-2027 | `https://ochambras.github.io/top14-agenda/challenge-cup.ics` |
| Coupe du monde 2027 | `https://ochambras.github.io/top14-agenda/coupe-du-monde.ics` |

Page classement, résultats et calendrier : `https://ochambras.github.io/top14-agenda/`

## Installer dans Google Agenda

1. Ouvrir [Google Agenda](https://calendar.google.com) sur ordinateur.
2. À gauche, à côté de « Autres agendas », cliquer sur **+** puis **À partir de l'URL**.
3. Coller l'adresse du calendrier voulu et valider. Recommencer pour chaque compétition.

Le calendrier apparaît, y compris sur le téléphone. Google le relit régulièrement : les scores
s'affichent dans le titre du match une fois la rencontre terminée. Les phases finales sont
ajoutées automatiquement dès que le flux les publie.

## Comment ça marche

`scripts/build.mjs` lit le flux public ESPN de chaque compétition et écrit `docs/<slug>.ics`,
`docs/<slug>.json` et `docs/index.json`. Une action GitHub relance ce script toutes les 2 heures
et publie le résultat via GitHub Pages. Aucune dépendance, aucun secret.
