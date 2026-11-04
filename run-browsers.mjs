// Opens the QA page in each browser on this machine, one after another, and waits until
// the page reports it has finished. Results are collected by qa_server.py (qa_state.json).
//   node ci/run-browsers.mjs <windows|macos|linux>      run the browsers for this OS
//   node ci/run-browsers.mjs url <tag> [model]           print the autorun URL (for simulators)
//   node ci/run-browsers.mjs wait <tag>                  wait for a device opened elsewhere
import { chromium, firefox } from 'playwright';

const BASE = process.env.QA_BASE || 'http://localhost:8000/';
const cfg = JSON.parse(process.env.QA_CONFIG || '{}');
const enc = Buffer.from(JSON.stringify(cfg)).toString('base64url');
const perBrowserMs = ((cfg.profiles?.length || 4) * ((cfg.secs || 30) + 15) + (cfg.profiles?.includes(8) ? 2 * (cfg.secs || 30) : 0) + 180) * 1000;
const urlFor = (tag, model = '') => `${BASE}?autorun=1&device=${encodeURIComponent(tag)}&model=${encodeURIComponent(model)}&cfg=${enc}`;

async function state() { try { return await (await fetch(BASE + 'api/state')).json(); } catch { return null; } }
async function waitDone(tag, ms = perBrowserMs) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const s = await state();
    if (s?.plays?.some(p => p.tag === tag && p.complete)) { console.log(`  ✓ ${tag} finished`); return true; }
    await new Promise(r => setTimeout(r, 5000));
  }
  console.log(`  ✗ ${tag} did not finish within ${Math.round(ms / 1000)} s`);
  return false;
}

const TARGETS = {
  windows: [['win-chrome', 'chrome', 'chromium'], ['win-edge', 'msedge', 'chromium'], ['win-firefox', 'Windows', 'firefox']],
  macos:   [['mac-safari', 'safari', 'safari'], ['mac-chrome', 'chrome', 'chromium'], ['mac-firefox', 'Mac', 'firefox']],
  linux:   [['linux-chrome', 'chrome', 'chromium'], ['linux-firefox', 'Linux', 'firefox']],
};

async function runPlaywright(tag, channelOrModel, engine) {
  const opts = { headless: true, args: engine === 'chromium' ? ['--autoplay-policy=no-user-gesture-required'] : [] };
  if (engine === 'chromium') opts.channel = channelOrModel;
  const browser = await (engine === 'firefox' ? firefox : chromium).launch(opts);
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.on('pageerror', e => console.log(`  [${tag}] page error: ${e.message}`));
  await page.goto(urlFor(tag, engine === 'firefox' ? channelOrModel : ''));
  await waitDone(tag);
  await browser.close();
}

async function runSafari(tag) {
  const { Builder } = await import('selenium-webdriver');
  const driver = await new Builder().forBrowser('safari').build();
  try { await driver.get(urlFor(tag)); await waitDone(tag); } finally { await driver.quit(); }
}

const [mode, a, b] = process.argv.slice(2);
if (mode === 'url') { console.log(urlFor(a, b || '')); process.exit(0); }
if (mode === 'wait') { process.exit((await waitDone(a)) ? 0 : 1); }
for (const [tag, x, engine] of TARGETS[mode] || []) {
  console.log(`\n▶ ${tag}`);
  try { engine === 'safari' ? await runSafari(tag) : await runPlaywright(tag, x, engine); }
  catch (e) { console.log(`  ✗ ${tag} could not start: ${e.message}`); }
}
