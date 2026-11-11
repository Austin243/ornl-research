# ORNL research overview

A static site summarizing my research internship at the Center for Nanophase Materials Sciences, Oak Ridge National Laboratory (2026): the benchmark of pretrained machine-learned interatomic potentials, high-pressure polymerization of acetonitrile, acetonitrile–alcohol reactions, reaction routes on Li, Na and K surfaces with their H/D isotope effects, and the methods behind them.

The site is plain HTML, CSS and JavaScript with no build step.

- Charts are drawn in the browser from the small data files in `assets/data/`.
- Interactive structures use [3Dmol.js](https://3dmol.csb.pitt.edu/), loaded from cdnjs; without it the pages show the rendered images instead.
- Fonts are Source Serif 4 and Source Sans 3 from Google Fonts.

To preview locally:

```bash
python3 -m http.server 8000
```

then open <http://localhost:8000>.

Results shown here come from ongoing work and manuscripts in preparation.
