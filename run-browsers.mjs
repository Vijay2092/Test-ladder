// Opens the QA page in each browser on this machine, one after another, and waits until
// the page reports it has finished. Results are collected by qa_server.py (qa_state.json).
//   node run-browsers.mjs one <target>                  run one browser, e.g. win-chrome
//   node run-browsers.mjs url <tag> [model]           print the autorun URL (for simulators)
//   node run-browsers.mjs wait <tag>                  wait for a device opened elsewhere
// Playwright is loaded only when a browser is driven, so 'url' and 'wait' need no installs.

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
  windows: [['win-chrome', 'chrome', 'chromium'], ['win-edge', 'msedge', 'chromium'], ['win-firefox', 'Windows', 'selenium-firefox']],
  macos:   [['mac-safari', 'safari', 'safari'], ['mac-chrome', 'chrome', 'chromium'], ['mac-firefox', 'Mac', 'firefox']],
  linux:   [['linux-chrome', 'chrome', 'chromium'], ['linux-firefox', 'Linux', 'firefox']],
};

async function runPlaywright(tag, channelOrModel, engine) {
  const opts = { headless: true, args: engine === 'chromium' ? ['--autoplay-policy=no-user-gesture-required'] : [] };
  if (engine === 'chromium') opts.channel = channelOrModel;
  const { chromium, firefox } = await import('playwright');
  const browser = await (engine === 'firefox' ? firefox : chromium).launch(opts);
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.on('pageerror', e => console.log(`  [${tag}] page error: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') console.log(`  [${tag}] console: ${m.text().slice(0, 200)}`); });
  await page.goto(urlFor(tag, engine === 'firefox' ? channelOrModel : ''));
  const ok = await waitDone(tag);
  if (!ok) await page.screenshot({ path: `shot-${tag}.png` }).catch(() => {});
  await browser.close();
}

async function runSafari(tag, browserName = 'safari') {
  const { Builder } = await import('selenium-webdriver');
  let builder = new Builder().forBrowser(browserName);
  if (browserName === 'firefox') {
    const firefox = await import('selenium-webdriver/firefox.js');
    const o = new firefox.Options().addArguments('-headless');
    o.setPreference('media.autoplay.default', 0); o.setPreference('media.autoplay.blocking_policy', 0);
    builder = builder.setFirefoxOptions(o);
  }
  const driver = await builder.build();
  try { await driver.get(urlFor(tag, browserName === 'firefox' ? 'Windows' : '')); await waitDone(tag); } finally { await driver.quit(); }
}

const [mode, a, b] = process.argv.slice(2);
// Hand the settings to the page through the server too, so they don't depend on a long URL surviving.
if (mode !== 'wait') { try { await fetch(BASE + 'api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cfg }) }); } catch {} }
if (mode === 'one') {
  const t = Object.values(TARGETS).flat().find(x => x[0] === a);
  if (!t) { console.log('unknown target ' + a); process.exit(1); }
  console.log(`\n▶ ${a}`);
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try { t[2] === 'safari' ? await runSafari(a) : t[2] === 'selenium-firefox' ? await runSafari(a, 'firefox') : await runPlaywright(a, t[1], t[2]); lastErr = null; break; }
    catch (e) { lastErr = e; console.log(`  ✗ ${a} attempt ${attempt} failed: ${e.message}`); await new Promise(r => setTimeout(r, 5000)); }
  }
  if (lastErr) await markTimeout(a, `The browser could not start on the test machine after 2 attempts: ${lastErr.message}`);
  process.exit(0);
}
if (mode === 'url') { console.log(urlFor(a, b || '')); process.exit(0); }
if (mode === 'wait') { process.exit((await waitDone(a)) ? 0 : 1); }
for (const [tag, x, engine] of TARGETS[mode] || []) {
  console.log(`\n▶ ${tag}`);
  try { engine === 'safari' ? await runSafari(tag) : await runPlaywright(tag, x, engine); }
  catch (e) { console.log(`  ✗ ${tag} could not start: ${e.message}`); }
}
