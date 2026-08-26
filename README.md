# LMCS Portal

Internal management portal for La Montessori Schools (LMS) — used by the owner,
coordinators, and principals to run staff, incentives, hiring, and compliance
across all six campuses. A clean rebuild, replacing the disorganized previous
repo.

## Status

Early scaffold. `index.html` is the home page / central portal, with module
cards for what's built vs. planned. No backend yet — static HTML/CSS only.

## Structure

```
index.html               Home page (central portal)
assets/style.css          Styles — brand palette, type, layout
assets/img/                Logo and brand assets
salary-dashboard/index.html  Salary slip / pay scale calculator, imported from ~/lmcs-salary-dashboard
```

## Branding

Matches the house style already used by [LMCS Bye Laws](https://kanwaruday.github.io/LMCSByeLaws/)
and the Salary Dashboard, both drawn from the LMS Brand Guidelines (Brandbook 2020):

- Primary: **Red** `#CE0000`, white page background, `#f5f5f5` card surfaces, `#ddd` borders
- Font: Segoe UI / Arial (system stack — no external font dependency)
- No dark mode, matching the sibling tools
- Tagline: "Grooming to Excellence"

## Campuses

| Code | Campus | Principal |
|---|---|---|
| LMS 1 | Dhalpur | Nidhi Kant |
| LMS 2 | Kelheli | Arti Sharma |
| LMS 3 | Dunkhra | Suresh Prasher |
| LMS 4 | Ner Chowk | Nisha |
| LMS 5 | Sayoli | — |
| LMS 6 | Jogindernagar (Guru International LMS) | — |
