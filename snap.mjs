import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const URL = process.argv[2] || 'http://localhost:5179/dashboard.html?demo';
const OUT = process.argv[3] || '/tmp/chinmeister-codebase-verify.png';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1200 },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();

// Seed token + layout before any script runs. Layout includes the catalog
// widgets that aren't in DEFAULT_LAYOUT so the snapshot covers all six
// codebase widgets in one shot.
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('chinmeister_token', 'demo_token');
    localStorage.setItem(
      'chinmeister:overview-dashboard',
      JSON.stringify({
        version: 3,
        widgets: [
          { id: 'live-agents', colSpan: 6, rowSpan: 4 },
          { id: 'live-conflicts', colSpan: 6, rowSpan: 3 },
          { id: 'directories', colSpan: 6, rowSpan: 4 },
          { id: 'files', colSpan: 6, rowSpan: 4 },
          { id: 'commit-stats', colSpan: 12, rowSpan: 2 },
          { id: 'file-rework', colSpan: 12, rowSpan: 4 },
          { id: 'audit-staleness', colSpan: 6, rowSpan: 3 },
          { id: 'concurrent-edits', colSpan: 6, rowSpan: 3 },
        ],
      }),
    );
  } catch {}
});

// Routes in Playwright run last-registered-first. Register the catch-all
// first so it sits at the bottom of the stack; specific paths added below
// take precedence.
await page.route(/api\.chinmeister\.com/, (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
);
await page.route(/.*\/users\/.*\/teams(\?.*)?$/, (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ teams: [] }),
  }),
);
await page.route(/.*\/teams(\?.*)?$/, (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ teams: [] }),
  }),
);
await page.route(/.*\/me(\?.*)?$/, (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      handle: 'demo',
      color: '#a896d4',
      created_at: '2026-01-01T00:00:00.000Z',
    }),
  }),
);

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (msg) => {
  const t = msg.type();
  if (t === 'error' || t === 'warning')
    errors.push(`console.${t}: ${msg.text()}`);
});
page.on('request', (req) => {
  const u = req.url();
  if (/api\.chinmeister\.com|\/me|\/teams|\/users\//.test(u)) {
    errors.push(`req: ${req.method()} ${u}`);
  }
});

await page.goto(URL, { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(800);

await page.screenshot({ path: OUT, fullPage: true });

// Also produce focused crops of the codebase widgets so the reviewer
// can see them at full resolution.
const widgets = ['commit-stats', 'directories', 'files', 'file-rework', 'audit-staleness', 'concurrent-edits'];
for (const id of widgets) {
  const sel = `[data-widget-id="${id}"]`;
  const handle = await page.$(sel);
  if (handle) {
    await handle.screenshot({ path: OUT.replace(/\.png$/, `-${id}.png`) });
  }
}
writeFileSync(OUT + '.errors.txt', errors.join('\n'));
console.log(`screenshot: ${OUT}`);
console.log(`errors: ${errors.length}`);
if (errors.length) console.log(errors.slice(0, 20).join('\n'));

await browser.close();
