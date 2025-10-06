AutoFix – Vercel Deploy Package
===============================

This folder is ready to deploy on Vercel.

Contents
--------
- index.html          → Home page (static CSS links included)
- assets/app.css      → Placeholder. Replace with your built Tailwind CSS for full styling.
- assets/fallback.css → Minimal fallback CSS (already included)
- favicon.ico         → Tab icon
- vercel.json         → Routes all paths to index.html (SPA-friendly)

How to Deploy
-------------
1) Replace assets/app.css with your compiled Tailwind file (created by `npm run build`).
   - Path should be: assets/app.css
2) Push this folder to your Vercel project (drag-and-drop or git push).
3) Open your site. Done.

Optional
--------
- If you want to keep building CSS in this repo, also copy:
  - tailwind.config.js, postcss.config.js, package.json, src/input.css
  - Then run `npm i` and `npm run build` before deploying.
