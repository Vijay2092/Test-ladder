// Opens the QA page in each browser on this machine, one after another, and waits until
// the page reports it has finished. Results are collected by qa_server.py (qa_state.json).
//   node run-browsers.mjs one <target>                  run one browser, e.g. win-chrome
//   node run-browsers.mjs url <tag> [model]           print the autorun URL (for simulators)
//   node run-browsers.mjs wait <tag>                  wait for a device opened elsewhere
import { chromium, firefox } from 'playwright';

const BASE = process.env.QA_BASE || 'http://localhost:8000/';
const cfg = JSON.parse(process.env.QA_CONFIG || '{}');
const enc = Buffer.from(JSON.stringify(cfg)).toString('base64url');
const perBrowserMs = ((cfg.profiles?.length || 4) * ((cfg.secs || 30) + 15) + (cfg.profiles?.includes(8) ? 2 * (cfg.secs || 30) : 0) + 180) * 1000;
const urlFor = (tag, model = '') => `${BASE}?autorun=1&device=${encodeURIComponent(tag)}&model=${encodeURIComponent(model)}&cfg=${enc}`;

async function state() { try { return await (await fetch(BASE + 'api/state')).json(); } catch { return null; } }
async function markTimeout(tag, why) {
  try { await fetch(BASE + 'api/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playback: [{ label: tag, tag, complete: true, at: new Date().toISOString(), setup: { ok: false, message: why }, results: [], env: { browser: tag } }] }) }); } catch {}
}
async function waitDone(tag, ms = perBrowserMs) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const s = await state();
    if (s?.plays?.some(p => p.tag === tag && p.complete)) { console.log(`  ✓ ${tag} finished`); return true; }
    await new Promise(r => setTimeout(r, 5000));
  }
  console.log(`  ✗ ${tag} did not finish within ${Math.round(ms / 1000)} s`);
  const st = await state();
  if (!st?.plays?.some(p => p.tag === tag)) await markTimeout(tag, `The test page did not finish in this browser within ${Math.round(ms / 60000)} minutes (test machine problem, not a FastPix issue). See the job log and screenshot on GitHub.`);
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
  page.on('console', m => { if (m.type() === 'error') console.log(`  [${tag}] console: ${m.text().slice(0, 200)}`); });
  await page.goto(urlFor(tag, engine === 'firefox' ? channelOrModel : ''));
  const ok = await waitDone(tag);
  if (!ok) await page.screenshot({ path: `shot-${tag}.png` }).catch(() => {});
  await browser.close();
}

async function runSafari(tag) {
  const { Builder } = await import('selenium-webdriver');
  const driver = await new Builder().forBrowser('safari').build();
  try { await driver.get(urlFor(tag)); await waitDone(tag); } finally { await driver.quit(); }
}

const [mode, a, b] = process.argv.slice(2);
if (mode === 'one') {
  const t = Object.values(TARGETS).flat().find(x => x[0] === a);
  if (!t) { console.log('unknown target ' + a); process.exit(1); }
  console.log(`\n▶ ${a}`);
  try { t[2] === 'safari' ? await runSafari(a) : await runPlaywright(a, t[1], t[2]); }
  catch (e) { console.log(`  ✗ ${a} could not start: ${e.message}`); await markTimeout(a, `The browser could not start on the test machine: ${e.message}`); }
  process.exit(0);
}
if (mode === 'url') { console.log(urlFor(a, b || '')); process.exit(0); }
if (mode === 'wait') { process.exit((await waitDone(a)) ? 0 : 1); }
for (const [tag, x, engine] of TARGETS[mode] || []) {
  console.log(`\n▶ ${tag}`);
  try { engine === 'safari' ? await runSafari(tag) : await runPlaywright(tag, x, engine); }
  catch (e) { console.log(`  ✗ ${tag} could not start: ${e.message}`); }
}
