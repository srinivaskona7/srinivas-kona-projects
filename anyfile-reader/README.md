# 📖 AnyReader

> A premium, **100% client-side** e-book reader for the browser — EPUB · PDF · MOBI · TXT/MD.
> No backend. No uploads. Every file, note, and highlight stays in your browser via **IndexedDB**.

<p align="center">
  <em>Drag a book in → read it with O'Reilly-grade typography, highlights, bookmarks, full-text search, and 5 themes.</em>
</p>

---

## ✨ Features

| | Feature | Notes |
|---|---|---|
| 🌙 | **"Nocturne" opening page** | A crafted landing — fine-press Fraunces type, a procedurally-generated leaning book-spine stack, candle-glow atmosphere; "Enter the library" reveals the dashboard |
| 📚 | **Multi-format** | EPUB (epub.js), PDF (pdf.js), MOBI (custom binary parser), TXT/MD (mini-markdown) |
| 🎨 | **5 reading themes** | O'Reilly · Light · Sepia · Dark · AMOLED Black |
| 🔤 | **Typography control** | Font family (incl. Fraunces editorial serif), size, line spacing, page margins — applied **live** to EPUB via epub.js Themes API, **persisted** across reloads |
| 📖 | **Kindle-style EPUB** | Paginated page-turns, per-theme colors injected into chapters, web fonts loaded into the sandboxed iframes |
| 🔍 | **PDF zoom** | The size control re-lays-out PDF pages (fit-to-zoom) with HiDPI-crisp re-render |
| 🖍️ | **Highlights & notes** | 4 colors, inline notes, keyboard-accessible selection toolbar |
| 🔖 | **Bookmarks** | Per-book, jump-to-location |
| 🔍 | **Full-text search** | In-book search for every format, XSS-safe snippet highlighting |
| 📊 | **Reading analytics** | Daily streak + “read today” timer (resets per calendar day) |
| 🗂️ | **Split / two-column view** | Mimics an open book on wide screens |
| 🔒 | **Private by design** | Files never leave the browser; MOBI/EPUB HTML sanitized with DOMPurify |
| ♿ | **Accessible** | Focus-visible rings, ARIA dialogs/labels, Esc-to-close, live toasts, keyboard highlighting |

---

## 🚀 Quick Start

```bash
# Serve locally (any static server works)
npm start                # → http://localhost:8080

# Verify the build
npm run check            # node --check app.js  (syntax)
npm test                 # headless smoke-test (12 flows, needs Chrome + playwright-core)
```

> No build step. No bundler. Open `index.html` through a local server (not `file://`, so IndexedDB + workers behave).

---

## 🏛️ Architecture

```
                          ┌──────────────────────────────────────────────┐
                          │                  index.html                   │
                          │  landing view · dashboard view · reader view  │
                          └───────────────┬───────────────────────────────┘
                                          │ instantiates
                                          ▼
                          ┌──────────────────────────────────────────────┐
                          │            EBookReader  (app.js)              │
                          │   UI orchestration · events · settings        │
                          └───┬───────────┬───────────┬───────────┬───────┘
                              │           │           │           │
              ┌───────────────┘     ┌─────┘      ┌────┘       ┌────┘
              ▼                     ▼            ▼            ▼
      ┌──────────────┐   ┌──────────────┐  ┌──────────┐  ┌──────────────┐
      │  Parsers     │   │  Renderers   │  │  Cover   │  │  DbManager   │
      │  Mobi / Txt  │   │ epub/pdf/    │  │  canvas  │  │  IndexedDB   │
      │              │   │ custom(html) │  │  gen     │  │  (cached)    │
      └──────┬───────┘   └──────┬───────┘  └──────────┘  └──────┬───────┘
             │                  │                                │
       raw bytes /        DOM + iframe                    books · progress
       HTML string        (sanitized)                       · notes stores
```

### Module map (`app.js`, single file, sectioned)

| § | Component | Responsibility |
|---|-----------|----------------|
| 0 | **Helpers** | `escapeHtml`, `escapeRegExp`, `sanitizeHtml` (DOMPurify), format/theme constants |
| 1 | **`DbManager`** | IndexedDB wrapper — **single cached connection**, stores: `books`, `progress`, `notes` |
| 2 | **`MobiParser`** | PalmDB/MOBI binary parse + PalmDoc LZ77 decompression |
| 3 | **`TxtParser`** | Escapes then converts TXT/MD → safe HTML |
| 4 | **`generateProceduralCover`** | Deterministic canvas cover from title hash |
| 5–14 | **`EBookReader`** | Files, shelf, reader engines, navigation, typography, annotations, bookmarks, search, analytics |

### Data flow: opening a book

```
 upload ─► FileReader ─► parser ─► {id,title,author,content,format,cover} ─► DbManager.saveBook
                                                                                   │
 click card ─► openBook(id) ─► DbManager.getBook ─► render by format:              ▼
        ┌─────────────┬──────────────┬─────────────────────────┐         IndexedDB "books"
        ▼             ▼              ▼                           ▼
     renderEpub   renderPdf   renderCustomContent(sanitized)  (mobi re-parsed + sanitized)
        │             │              │
        └──── relocate / scroll / IntersectionObserver ──► saveCurrentProgress (debounced)
```

### Storage model

```
IndexedDB: "AnyReaderDB" (v1)
├── books     { id, title, author, content, format, cover, added }
├── progress  { bookId, position, percentage, bookmarks[], updated }
└── notes     { id↑, bookId, quote, body, color, cfiRange?, nodeIndex?, … }

localStorage
├── anyreader_settings        { theme, fontSize, lineHeight, margin, fontFamily }
├── anyreader_streak          consecutive-day counter
├── anyreader_last_read_date  toDateString()
└── anyreader_time_today      seconds (reset per calendar day)
```

---

## 🎛️ Reader Options

| Control | Location | Effect |
|---------|----------|--------|
| 🌓 Theme toggle | dashboard header | cycles 5 themes; syncs the panel swatch |
| 📑 Sidebar | reader toolbar | TOC · Bookmarks · Notes · Search |
| ⬌ Split view | reader toolbar | two-column / spread layout |
| 🅰️ Style panel | reader toolbar | theme · font · size · spacing · margins (all persisted) |
| 🔖 Bookmark | reader toolbar | toggle bookmark at current location |
| ⛶ Fullscreen | reader toolbar | native fullscreen |
| ⌨️ Keyboard | anywhere in reader | `←/→` page turn (ignored while typing) · `Esc` closes top overlay |
| 🖍️ Select text | reader canvas | floating toolbar → highlight / note / copy (mouse **or** keyboard) |

---

## 🔐 Security Model

This app renders **untrusted file content** (a malicious MOBI/EPUB/PDF could carry hostile HTML or metadata). Defenses:

```
 file metadata / MOBI HTML / note text / search query
        │
        ├─► escapeHtml()      every interpolation into innerHTML (titles, authors, notes, snippets)
        ├─► sanitizeHtml()    MOBI bodies via DOMPurify (strips <script>, onerror, javascript:)
        ├─► escapeRegExp()    user search query before RegExp construction
        └─► no inline onclick — all handlers via addEventListener (no string-built markup)
```

> TXT/MD content is escaped at parse time; EPUB renders in a sandboxed iframe via epub.js.

---

## 🧰 Tech Stack

- **Vanilla JS** (ES classes), no framework, no build
- **epub.js** + **JSZip** — EPUB
- **pdf.js** — PDF (HiDPI-aware canvas, lazy page render + recycle)
- **DOMPurify** — HTML sanitization
- **IndexedDB** — storage · **Canvas** — covers · **FontAwesome / Google Fonts** — UI

---

## 🧪 Testing

`smoke-test.mjs` drives headless Chrome through 12 end-to-end flows (boot, parse, render, theme, settings persistence, search, XSS-inertness) and fails on **any** console/page error.

```bash
npm test     # CHROME_PATH=… overrides the browser path
```

---

## 📁 Project Layout

```
anyfile-reader/
├── index.html        markup: dashboard + reader + modals (CDN deps at bottom)
├── styles.css        themes (CSS vars) + layout + a11y focus styles
├── app.js            all logic (DbManager, parsers, EBookReader)
├── smoke-test.mjs    headless end-to-end test
└── package.json      start / test / check scripts
```

---

## ⚠️ Known Limitations

- **MOBI**: only PalmDoc (LZ77) compression; HUFF/CDIC and DRM are unsupported by design.
- **EPUB highlights** restore by CFI; **TXT/MOBI** highlights restore by first-match text within a paragraph (fragile across re-renders).
- Whole files are kept in IndexedDB; very large PDFs (tens of MB) cost memory.
- Requires a modern browser (IndexedDB, IntersectionObserver, `color-mix`).

---

<p align="center"><sub>Everything processed locally. Your books never leave your browser. ❤️</sub></p>
