# Rank emblems

This UI expects ranked tier emblems to exist in this folder so the summoner header can show an emblem next to LP.

## Expected filenames

Place PNG files with **exactly** these names:

- `iron.png`
- `bronze.png`
- `silver.png`
- `gold.png`
- `platinum.png`
- `emerald.png`
- `diamond.png`
- `master.png`
- `grandmaster.png`
- `challenger.png`

The app will load them via:

- `/rank-emblems/<tier>.png`

If an image is missing, the UI falls back to the crown icon.

## Where to get them

Riot provides official ranked emblems as a downloadable asset pack (often published as `ranked-emblems-latest.zip`) on their static developer asset host.

Download the pack, extract the relevant tier PNGs, rename them to match the filenames above, and put them in this folder.
