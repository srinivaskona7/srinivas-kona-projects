<div align="center">

# Srinivas Kona — Projects Portfolio

**A static showcase hub linking to live GitHub Pages projects and curated developer tools.**

[![Live Site](https://img.shields.io/badge/Live-srinivaskona7.github.io-6366f1?style=for-the-badge)](https://srinivaskona7.github.io/srinivas-kona-projects/)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Srinivas%20Kona-0a66c2?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/srinivas-kona/)
[![GitHub](https://img.shields.io/badge/GitHub-srinivaskona7-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/srinivaskona7)

[![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)](#)
[![CSS3](https://img.shields.io/badge/CSS3-1572B6?logo=css3&logoColor=white)](#)
[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black)](#)
[![No Build](https://img.shields.io/badge/Build-None-success)](#)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](#license)

</div>

---

## Overview

This repository is the **landing page** for Srinivas Kona's project portfolio. It renders a responsive grid of project cards; each card links out to a standalone GitHub Pages app. There is **no build step, no framework, no backend** — just `index.html`, `styles.css`, `script.js`, and an `assets/` folder.

```
visitor → srinivas-kona-projects (this repo) → individual project repos
```

---

## Featured Projects

Each card on the homepage opens one of the live apps below in a new tab.

| # | Project | Description | Tech | Live | Source |
|---|---------|-------------|------|------|--------|
| 1 | [**Local Store**](https://github.com/srinivaskona7/localstore-project) | E-commerce demo with inventory management | HTML · CSS · JS | [Open](https://srinivaskona7.github.io/localstore-project/) | [Repo](https://github.com/srinivaskona7/localstore-project) |
| 2 | [**Weather App**](https://github.com/srinivaskona7/weather-app) | Real-time weather forecasting via public API | API · Responsive | [Open](https://srinivaskona7.github.io/weather-app/) | [Repo](https://github.com/srinivaskona7/weather-app) |
| 3 | [**Personal Loan Calculator**](https://github.com/srinivaskona7/Personal-loan-calculator) | EMI calculator with chart visualisation | Financial Calc | [Open](https://srinivaskona7.github.io/Personal-loan-calculator/) | [Repo](https://github.com/srinivaskona7/Personal-loan-calculator) |
| 4 | [**QR Generator**](https://github.com/srinivaskona7/qrproject) | Dynamic QR code generator and scanner | QR Library · UI | [Open](https://srinivaskona7.github.io/qrproject/) | [Repo](https://github.com/srinivaskona7/qrproject) |
| 5 | [**Glucose Tracker**](https://github.com/srinivaskona7/gulcose-cal) | Multi-profile blood-sugar monitor | localStorage · Calendar · Charts | [Open](https://srinivaskona7.github.io/gulcose-cal/) | [Repo](https://github.com/srinivaskona7/gulcose-cal) |
| 6 | [**InstaLink**](https://github.com/srinivaskona7/instalink) | Instagram Reel link trimmer for clean sharing | URL parsing · Clipboard API | [Open](https://srinivaskona7.github.io/instalink/) | [Repo](https://github.com/srinivaskona7/instalink) |
| 7 | [**Images to PDF Pro**](https://github.com/srinivaskona7/images-to-pdf) | Premium image → PDF converter with watermarks & filters | jsPDF · Canvas API | [Open](https://srinivaskona7.github.io/images-to-pdf/) | [Repo](https://github.com/srinivaskona7/images-to-pdf) |
| 8 | [**DevKit – Developer Tools**](https://devkit.escalixstudio.com/) | _Curated_ — 106 client-side dev tools (format, encode, convert, AI, Web3) | Client-side · 8 Categories · Free | [Open](https://devkit.escalixstudio.com/) | _External_ |

> All seven projects are independent repositories under [`@srinivaskona7`](https://github.com/srinivaskona7) and deploy automatically via GitHub Pages from their `main` branch.

---

## Repository Layout

```
srinivas-kona-projects/
├── index.html        # Portfolio landing page (project grid)
├── styles.css        # Theme, layout, animations
├── script.js         # Card click delegation + IntersectionObserver fade-in
├── crop-tool.html    # Standalone helper: pick CSS object-position for profile.png
├── assets/
│   ├── profile.png   # Avatar shown in header
│   └── profile1.png  # Alternate / source image
└── README.md
```

### File responsibilities

| File | Purpose |
|------|---------|
| `index.html` | Single-page markup. Each project is a `.project-card` with a `data-url` attribute. |
| `styles.css` | CSS custom properties (`--primary`, `--gradient`, …), grid layout, hover transitions. |
| `script.js` | Event delegation on `.projects-grid`, lazy-fade via `IntersectionObserver`, debounced resize. |
| `crop-tool.html` | Self-contained utility: upload an image, drag a circle, copy the resulting `object-position` CSS into `styles.css`. |

---

## Run Locally

No dependencies, no install. Pick any static server:

```bash
# Option 1 — Python
python3 -m http.server 8000

# Option 2 — Node (npx)
npx serve .

# Option 3 — VS Code "Live Server" extension → right-click index.html → Open with Live Server
```

Then visit <http://localhost:8000>.

---

## Adding a New Project

1. Open `index.html` and copy an existing `.project-card` block inside `#projectsGrid`.
2. Update four things:
   - `data-url="https://srinivaskona7.github.io/<repo-name>/"`
   - `<i class="fas fa-…">` — pick an icon from [Font Awesome 6](https://fontawesome.com/icons)
   - `<h3>` — display title
   - `<p>` and `.project-tech` — short description and tech tags
3. Commit:
   ```bash
   git add index.html
   git commit -m "Add <Project Name> project to portfolio"
   git push
   ```

GitHub Pages will redeploy within ~1 minute. `script.js` requires no changes — clicks are handled via event delegation.

---

## Profile Image Crop Tool

`crop-tool.html` is a one-off helper for tuning how `profile.png` is framed inside the circular avatar.

```
upload image → drag red circle → copy generated CSS → paste into .profile-image { object-position: …; }
```

Open it directly in a browser — no server required.

---

## Tech Stack

- **Markup** — HTML5, semantic landmarks
- **Styling** — Modern CSS (custom properties, grid, gradients), Inter font via Google Fonts
- **Interactivity** — Vanilla ES6+, `IntersectionObserver`, event delegation, passive listeners
- **Icons** — [Font Awesome 6.4.0](https://fontawesome.com/) via CDN
- **Hosting** — GitHub Pages (zero-config static deployment)

---

## Contact

| Channel | Link |
|---------|------|
| Email | [konasrinivas787@gmail.com](mailto:konasrinivas787@gmail.com) |
| LinkedIn | [linkedin.com/in/srinivas-kona](https://www.linkedin.com/in/srinivas-kona/) |
| GitHub | [github.com/srinivaskona7](https://github.com/srinivaskona7) |

---

## License

MIT © 2025 Srinivas Kona

> Working with an AI assistant on this repo? See [`AGENTS.md`](./AGENTS.md) for project conventions, repo map, and contribution rules.
