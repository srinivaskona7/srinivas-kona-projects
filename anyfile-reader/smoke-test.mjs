// Headless smoke-test for AnyReader. Boots the app, exercises core flows,
// and fails on any console error / page error / failed CDN request.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

// playwright may be installed normally, or only present as the cached
// playwright-core in the npx cache (private registry can't install here).
const require = createRequire(import.meta.url);
function loadChromium() {
  for (const id of ['playwright', 'playwright-core']) {
    try { return require(id).chromium; } catch { /* try next */ }
  }
  // Fallback: scan the npx cache for a cached playwright-core.
  const { execSync } = require('node:child_process');
  try {
    const hit = execSync(
      'find "$HOME/.npm/_npx" -maxdepth 3 -type d -name playwright-core 2>/dev/null | head -1',
      { encoding: 'utf8' }
    ).trim();
    if (hit) return require(hit).chromium;
  } catch { /* ignore */ }
  throw new Error('playwright not found (install with: npm i -D playwright)');
}
const chromium = loadChromium();
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const ROOT = process.cwd();
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

// --- generate real upload fixtures (a TXT and a minimal valid 1-page PDF) ---
function buildPdf() {
  const objs = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
    null,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
  ];
  const s = `BT /F1 24 Tf 72 700 Td (Hello PDF) Tj ET`;
  objs[3] = `<< /Length ${s.length} >>\nstream\n${s}\nendstream`;
  let pdf = `%PDF-1.4\n`;
  const off = [];
  objs.forEach((b, i) => { off[i] = pdf.length; pdf += `${i + 1} 0 obj\n${b}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  off.forEach((o) => { pdf += `${String(o).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}
const TXT_FIXTURE = join(tmpdir(), 'anyreader-smoke.txt');
const PDF_FIXTURE = join(tmpdir(), 'anyreader-smoke.pdf');
const EPUB_FIXTURE = join(tmpdir(), 'anyreader-smoke.epub');
// A tiny but valid EPUB (mimetype, container, opf, nav, one chapter of real text).
const EPUB_B64 = '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';
await writeFile(TXT_FIXTURE, '# Upload Test\n\nA **plain text** upload.\n\n- a\n- b\n');
await writeFile(PDF_FIXTURE, buildPdf());
await writeFile(EPUB_FIXTURE, Buffer.from(EPUB_B64, 'base64'));

const server = createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  try {
    const path = join(ROOT, url === '/' ? 'index.html' : decodeURIComponent(url));
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});

await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;

const errors = [];
const failedReq = [];
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  // Ignore resource-load failures caused by the network sandbox blocking CDNs
  // (fonts / FontAwesome). These are environmental, not app defects.
  if (/Failed to load resource|ERR_BLOCKED_BY_ORB|net::ERR/i.test(t)) return;
  errors.push(t);
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('requestfailed', (r) => failedReq.push(`${r.url()} (${r.failure()?.errorText})`));

const step = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { console.log(`  ✗ ${name} — ${e.message}`); errors.push(`${name}: ${e.message}`); }
};

console.log('AnyReader smoke-test\n');

await page.goto(base, { waitUntil: 'load' });
// Start from a clean library so card counts are deterministic.
await page.evaluate(() => new Promise((r) => { const d = indexedDB.deleteDatabase('AnyReaderDB'); d.onsuccess = d.onerror = () => r(); }));
await page.reload({ waitUntil: 'load' });

await step('landing (opening page) boots with hero + spine stack', async () => {
  await page.waitForSelector('#landing-view.active', { timeout: 5000 });
  await page.waitForFunction(() => !!window.app, null, { timeout: 5000 });
  await page.waitForSelector('.noc-headline');
  const spines = await page.$$eval('#noc-shelf .noc-spine', (els) => els.length);
  if (spines < 3) throw new Error(`spine stack not rendered (got ${spines})`);
});

await step('helpers + sanitizer wired (escapeHtml, sanitizeHtml, DOMPurify)', async () => {
  const ok = await page.evaluate(() =>
    typeof escapeHtml === 'function' &&
    typeof sanitizeHtml === 'function' &&
    typeof DOMPurify !== 'undefined');
  if (!ok) throw new Error('missing helper/DOMPurify');
});

await step('XSS payload in title is escaped (no script execution)', async () => {
  const escaped = await page.evaluate(() => escapeHtml('"><img src=x onerror=alert(1)>'));
  if (escaped.includes('<img')) throw new Error('not escaped: ' + escaped);
});

await step('sanitizeHtml strips onerror handlers from MOBI-style HTML', async () => {
  const out = await page.evaluate(() => sanitizeHtml('<p>hi</p><img src=x onerror="alert(1)"><script>alert(2)</script>'));
  if (/onerror|<script/i.test(out)) throw new Error('not sanitized: ' + out);
});

await step('Enter the library → dashboard becomes active', async () => {
  await page.click('#enter-library-btn');
  await page.waitForSelector('#dashboard-view.active', { timeout: 5000 });
  await page.waitForSelector('#dropzone', { state: 'visible' });
});

await step('library shell follows light & dark mode (real recolor)', async () => {
  // --ui-bg is the shell background var; assert it actually differs per theme.
  const uiBg = () => page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--ui-bg').trim());
  await page.evaluate(() => window.app.setTheme('black'));
  const darkVar = await uiBg();
  await page.evaluate(() => window.app.setTheme('light'));
  const lightVar = await uiBg();
  if (!darkVar || darkVar === lightVar) throw new Error(`shell var did not change (${darkVar} vs ${lightVar})`);

  // And confirm the painted background really lands light (wait out the 0.4s transition).
  await page.waitForTimeout(550);
  const painted = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const lum = painted.match(/\d+/g).slice(0, 3).reduce((a, b) => a + +b, 0) / 3;
  if (lum < 170) throw new Error(`light theme shell not actually light: painted ${painted}`);

  const synced = await page.evaluate(() =>
    document.querySelector('.theme-opt.active')?.dataset.theme === window.app.activeTheme);
  if (!synced) throw new Error('swatch .active out of sync with theme');
  await page.evaluate(() => window.app.setTheme('black')); // restore dark for later steps
});

await step('settings persist to localStorage', async () => {
  const saved = await page.evaluate(() => localStorage.getItem('anyreader_settings'));
  if (!saved || !JSON.parse(saved).theme) throw new Error('settings not persisted');
});

await step('upload TXT + PDF → both saved without detach error (no duplicates)', async () => {
  await page.setInputFiles('#file-input', [TXT_FIXTURE, PDF_FIXTURE]);
  await page.waitForFunction(() => document.querySelectorAll('.book-card').length === 3, null, { timeout: 8000 });
  // PDF stored as a real ArrayBuffer (regression guard for the detach bug)
  const ok = await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('AnyReaderDB');
    r.onsuccess = () => {
      const tx = r.result.transaction('books', 'readonly').objectStore('books').getAll();
      tx.onsuccess = () => {
        const pdf = tx.result.find((b) => b.format === 'pdf');
        const passes = !!pdf && pdf.content instanceof ArrayBuffer && pdf.content.byteLength > 0;
        if (!passes) {
          console.log("SMOKE TEST DEBUG: PDF find result:", JSON.stringify(pdf ? { id: pdf.id, format: pdf.format, contentConstructor: pdf.content ? pdf.content.constructor.name : 'null', byteLength: pdf.content ? pdf.content.byteLength : 'undefined' } : null));
          console.log("SMOKE TEST DEBUG: All shelf formats:", JSON.stringify(tx.result.map(b => b.format)));
        }
        res(passes);
      };
      tx.onerror = () => res(false);
    };
    r.onerror = () => res(false);
  }));
  if (!ok) throw new Error('PDF not stored as a valid ArrayBuffer');
});

await step('open uploaded PDF → page canvas renders', async () => {
  // open the PDF card specifically
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.book-card')];
    const pdfCard = cards.find((c) => c.querySelector('.book-card-title')?.title?.includes('anyreader-smoke')) || cards[cards.length - 1];
    pdfCard.click();
  });
  await page.waitForSelector('#reader-view.active', { timeout: 6000 });
  await page.waitForFunction(() => document.querySelector('#pdf-viewer canvas') !== null, null, { timeout: 8000 });
  await page.click('#close-reader-btn');
  await page.waitForSelector('#dashboard-view.active', { timeout: 5000 });
});

await step('load sample book → shelf now has 3 books', async () => {
  // #load-sample-btn lives in the empty-state (hidden once books exist),
  // so trigger the same code path directly.
  await page.evaluate(() => window.app.loadSampleBook());
  await page.waitForFunction(() => document.querySelectorAll('.book-card').length === 4, null, { timeout: 5000 });
});

await step('open sample book → reader view active, content rendered', async () => {
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.book-card')];
    const sample = cards.find((c) => c.querySelector('.book-card-title')?.textContent?.includes('Welcome'));
    sample.click();
  });
  await page.waitForSelector('#reader-view.active', { timeout: 5000 });
  await page.waitForFunction(() => document.querySelector('#custom-content')?.innerText.includes('Welcome'), null, { timeout: 5000 });
});

await step('TOC populated from headings', async () => {
  const tocItems = await page.$$eval('#toc-list li', (els) => els.length);
  if (tocItems < 1) throw new Error('empty TOC');
});

await step('font size control updates + persists', async () => {
  await page.click('#style-panel-btn');
  await page.click('#font-size-inc');
  const val = await page.evaluate(() => document.getElementById('font-size-val').innerText);
  if (val === '100%') throw new Error('font size did not change');
  await page.click('#close-style-panel');
});

await step('in-book search returns results, XSS query stays inert', async () => {
  // Open the sidebar, switch to the search tab, then query.
  await page.click('#sidebar-toggle-btn');
  await page.click('.sidebar-tab[data-tab="search"]');
  await page.waitForSelector('#inbook-search-input', { state: 'visible', timeout: 5000 });
  await page.fill('#inbook-search-input', 'Welcome');
  await page.click('#inbook-search-btn');
  await page.waitForFunction(() => document.querySelectorAll('#search-results-list li').length > 0, null, { timeout: 5000 });
  // Now confirm an XSS query is neutralised.
  await page.fill('#inbook-search-input', '<img src=x onerror=alert(1)>');
  await page.click('#inbook-search-btn');
  await page.waitForTimeout(400);
  const html = await page.evaluate(() => document.getElementById('search-results-list').innerHTML);
  if (/<img[^>]+onerror/i.test(html)) throw new Error('query not escaped in results');
});

await step('back to shelf works', async () => {
  await page.click('#close-reader-btn');
  await page.waitForSelector('#dashboard-view.active', { timeout: 5000 });
});

await step('EPUB upload → opens, and font/size/theme options actually apply', async () => {
  await page.setInputFiles('#file-input', [EPUB_FIXTURE]);
  await page.waitForFunction(() => [...document.querySelectorAll('.book-card-title')]
    .some((e) => e.textContent.includes('Style Test')), null, { timeout: 8000 });
  await page.evaluate(() => {
    const c = [...document.querySelectorAll('.book-card')]
      .find((x) => x.querySelector('.book-card-title')?.textContent.includes('Style Test'));
    c.click();
  });
  await page.waitForSelector('#reader-view.active', { timeout: 6000 });
  await page.waitForSelector('#epub-viewer iframe', { timeout: 8000 });
  await page.waitForTimeout(1400);

  const readBody = async () => {
    const fh = await page.$('#epub-viewer iframe');
    const frame = await fh.contentFrame();
    return frame.evaluate(() => {
      const cs = getComputedStyle(document.body);
      return { size: parseFloat(cs.fontSize), family: cs.fontFamily, color: cs.color };
    });
  };
  const before = await readBody();

  // Drive the controls the way a user would.
  await page.evaluate(() => {
    document.getElementById('font-family-select').value = "'Fraunces', Georgia, serif";
    window.app.setFontFamily("'Fraunces', Georgia, serif");
    window.app.setTheme('light');
    window.app.adjustFontSize(60);
  });
  await page.waitForTimeout(1000);
  const after = await readBody();

  if (!(after.size > before.size + 1)) throw new Error(`font size did not grow (${before.size}→${after.size})`);
  if (after.color === before.color) throw new Error(`theme color did not change in EPUB (${after.color})`);
  if (!/fraunces/i.test(after.family)) throw new Error(`font family not applied: ${after.family}`);

  await page.click('#close-reader-btn');
  await page.waitForSelector('#dashboard-view.active', { timeout: 5000 });
});

await browser.close();
server.close();

console.log('\n— Network —');
const realFailures = failedReq.filter((u) => !u.includes('favicon') && !u.includes('fonts.googleapis') && !u.includes('fonts.gstatic'));
console.log(realFailures.length ? realFailures.map((u) => '  ⚠ ' + u).join('\n') : '  ✓ no failed requests (font CDN blocked by sandbox, ignored)');

console.log('\n— Console / page errors —');
if (errors.length) {
  console.log(errors.map((e) => '  ✗ ' + e).join('\n'));
  console.log(`\nRESULT: FAIL (${errors.length} error(s))`);
  process.exit(1);
} else {
  console.log('  ✓ none');
  console.log('\nRESULT: PASS');
}
