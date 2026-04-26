# AGENTS.md — AI Agent Working Guide

> A vendor-neutral instruction file for any AI assistant (Claude, Cursor, Copilot, Codex, Gemini, etc.) working on this portfolio repo **and** the seven linked project repositories.

---

## 1. Project Identity

- **Owner:** Srinivas Kona ([@srinivaskona7](https://github.com/srinivaskona7))
- **This repo:** `srinivas-kona-projects` — a static landing page that links to 7 standalone GitHub Pages apps.
- **Stack across all repos:** vanilla **HTML + CSS + JavaScript**. No frameworks, no bundlers, no package managers, no backend.
- **Hosting model:** GitHub Pages, served from each repo's `main` branch root. Zero-config deploys.

If you propose a framework (React, Vue, Svelte, Vite, Next…), a bundler (Webpack, Rollup), or a package manager (`npm install …`), **stop and ask first**. The intentional design is "no build step ever."

---

## 2. Repository Map

| Role | Repo | Live URL |
|------|------|----------|
| Hub (this repo) | [srinivas-kona-projects](https://github.com/srinivaskona7/srinivas-kona-projects) | <https://srinivaskona7.github.io/srinivas-kona-projects/> |
| Project | [localstore-project](https://github.com/srinivaskona7/localstore-project) | <https://srinivaskona7.github.io/localstore-project/> |
| Project | [weather-app](https://github.com/srinivaskona7/weather-app) | <https://srinivaskona7.github.io/weather-app/> |
| Project | [Personal-loan-calculator](https://github.com/srinivaskona7/Personal-loan-calculator) | <https://srinivaskona7.github.io/Personal-loan-calculator/> |
| Project | [qrproject](https://github.com/srinivaskona7/qrproject) | <https://srinivaskona7.github.io/qrproject/> |
| Project | [gulcose-cal](https://github.com/srinivaskona7/gulcose-cal) | <https://srinivaskona7.github.io/gulcose-cal/> |
| Project | [instalink](https://github.com/srinivaskona7/instalink) | <https://srinivaskona7.github.io/instalink/> |
| Project | [images-to-pdf](https://github.com/srinivaskona7/images-to-pdf) | <https://srinivaskona7.github.io/images-to-pdf/> |

The hub repo only references project repos by URL — there is no submodule, monorepo, or cross-import relationship.

---

## 3. File Layout (this repo)

```
srinivas-kona-projects/
├── index.html        # landing page; project grid lives in #projectsGrid
├── styles.css        # CSS custom properties + grid + animations
├── script.js         # event delegation, IntersectionObserver, hover effects
├── crop-tool.html    # standalone utility (see §7)
└── assets/
    ├── profile.png
    └── profile1.png
```

Common conventions across the **project repos** (all linked apps):

```
<project>/
├── index.html
├── style.css        # or styles.css
├── script.js        # or app.js / main.js
└── assets/          # optional
```

---

## 4. Coding Conventions

### HTML
- Semantic tags: `<header>`, `<main>`, `<section>`, `<footer>`.
- All external CDN links use HTTPS and pin a major/minor version (e.g. `font-awesome/6.4.0`).
- New project cards in `index.html` follow the existing `.project-card` pattern with a `data-url` attribute — **do not** inline `onclick` handlers; the click is handled by event delegation in `script.js`.

### CSS
- Theme tokens live in `:root { --primary, --secondary, --gradient, … }`. Always reference variables, never hardcode the same hex twice.
- Mobile-first; use `display: grid` with `auto-fit` / `minmax` for responsive layouts.
- Avoid `!important` unless overriding a third-party style.

### JavaScript
- Plain ES6+. No transpilation. No imports/exports — single global script.
- Use **event delegation** (one listener on the parent grid) over per-element listeners.
- Use `{ passive: true }` for scroll/touch/hover listeners.
- Prefer `IntersectionObserver` for scroll-triggered effects, not scroll listeners.
- Debounce resize handlers.

### Assets
- Place images in `assets/`. Reference with relative paths (`./assets/...`) so GitHub Pages subpath routing works.
- Optimize PNGs before committing (use [squoosh.app](https://squoosh.app) or `pngquant`). Target < 200 KB per image where possible.

---

## 5. Adding a New Project to the Portfolio

When the user asks to "add project X," do this and only this:

1. Edit `index.html`. Inside `<div class="projects-grid" id="projectsGrid">`, append a new card following the established structure:

   ```html
   <div class="project-card" data-url="https://srinivaskona7.github.io/<repo>/">
     <div class="project-header">
       <div class="project-icon"><i class="fas fa-<icon>"></i></div>
       <div class="project-overlay"><i class="fas fa-external-link-alt"></i></div>
     </div>
     <div class="project-info">
       <h3><Display Name></h3>
       <p><One-line description></p>
       <span class="project-tech"><tech1> • <tech2></span>
     </div>
   </div>
   ```

2. Pick a Font Awesome 6 icon name. If unsure, ask the user.
3. **Do not modify** `script.js` or `styles.css` — the new card is auto-handled.
4. Commit with the message format: `Add <Project Name> project to portfolio` (matches existing git history).

---

## 6. Commit & Branch Conventions

- **Branch:** work directly on `main` unless the user asks otherwise. This is a personal portfolio, not a team repo.
- **Commit message style** (from existing log):
  - `Add <Feature> to portfolio`
  - `Add <Project> project to portfolio`
  - `added profile pic` (lowercase past tense for tiny tweaks is acceptable but prefer imperative)
- **Never** commit:
  - `node_modules/` (there are none — keep it that way)
  - `.DS_Store` files (already tracked once by mistake; avoid repeating)
  - API keys, tokens, or any `.env` file
- **Push only** when the user asks. Do not push automatically after a commit.

---

## 7. The Crop Tool (`crop-tool.html`)

A self-contained utility — **not** part of the live portfolio. It exists so the owner can:

1. Upload a candidate avatar (e.g. `profile1.png`).
2. Drag a circular crop box.
3. Copy the generated `object-position: X% Y%;` CSS rule.
4. Paste into `styles.css` under `.profile-image`.

Do not link to it from `index.html`. Do not refactor it into the main app.

---

## 8. Local Development

No install step. Pick a static server:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
# or
npx serve .
```

For project repos, the same commands work — `cd` into the repo first.

---

## 9. Testing

There is no test suite and adding one is **out of scope** unless the user explicitly requests it. Manual verification only:

1. Run a local static server.
2. Open `http://localhost:8000` in a browser.
3. Click each project card → confirm it opens the correct GitHub Pages URL in a new tab.
4. Resize the window → confirm grid reflows and cards remain readable down to 320 px width.
5. Inspect console → no errors.

---

## 10. What Agents Should NOT Do

- Do not introduce a build tool, package manager, or framework.
- Do not create `package.json`, `tsconfig.json`, `webpack.config.js`, `vite.config.js`, etc.
- Do not split CSS or JS into multiple files "for organisation" — single-file is intentional.
- Do not add tracking scripts, analytics, ad networks, or third-party widgets without asking.
- Do not refactor working code "for cleanliness" without a user request.
- Do not generate or invent live URLs for projects that are not already listed in §2.
- Do not push to remotes, open PRs, or create issues without explicit user instruction.
- Do not delete `crop-tool.html` or the `assets/` files — they are intentionally retained.

---

## 11. What Agents SHOULD Do

- **Verify before claiming.** After editing HTML/CSS, mentally walk the DOM and confirm selectors still match.
- **Match the existing voice.** Project descriptions are short (≤ 60 chars), benefit-focused.
- **Ask once when ambiguous.** A 10-second clarifying question beats a 10-minute wrong rewrite.
- **Prefer minimal diffs.** Edit, don't rewrite.
- **Update this file** when project conventions change. `AGENTS.md` is the source of truth for AI collaborators.

---

## 12. Quick Reference Card

```
Stack:        HTML + CSS + Vanilla JS  (no build, no deps)
Hosting:      GitHub Pages, main branch, zero config
Owner:        @srinivaskona7
Hub repo:     srinivas-kona-projects (this one)
Project URL:  https://srinivaskona7.github.io/<repo>/
Add project:  copy .project-card block in index.html → set data-url
Run local:    python3 -m http.server 8000
Commit msg:   "Add <Project> project to portfolio"
Never:        npm install · build steps · push without asking
```
