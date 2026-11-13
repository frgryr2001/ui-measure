// Loads the production build into Chrome for Testing and clicks the toolbar icon over CDP
// (Extensions.triggerAction grants activeTab like a real click): on → off → on.
// Branded Chrome ignores --load-extension since 137, hence Chrome for Testing.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
// prod build only: the dev manifest adds `tabs` + localhost host permissions, which would hide an activeTab bug
const extDir = join(root, '.output/chrome-mv3');

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = join(homedir(), '.cache/puppeteer/chrome');
  const app = 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
  // <cache>/mac_arm-148.0.7778.97/chrome-mac-arm64/<app>, newest version first
  const found = (existsSync(cache) ? readdirSync(cache) : [])
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .flatMap((v) => readdirSync(join(cache, v)).map((d) => join(cache, v, d, app)))
    .find(existsSync);
  if (!found) {
    throw new Error('Chrome for Testing not found. Run `npx @puppeteer/browsers install chrome@stable --path ~/.cache/puppeteer` or set CHROME_PATH.');
  }
  return found;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function poll(what, fn, ok, timeout = 5000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (ok(last)) return last;
    await sleep(100);
  }
  assert.fail(`timed out waiting for ${what}, last value: ${JSON.stringify(last)}`);
}

// install-time surface: no permission warning (hosts only as optional), real icon instead of Chrome's letter
const manifest = JSON.parse(readFileSync(join(extDir, 'manifest.json'), 'utf8'));
assert.deepEqual(
  [manifest.permissions, manifest.host_permissions, manifest.optional_host_permissions],
  [['activeTab', 'scripting', 'contextMenus'], undefined, ['<all_urls>']],
);
assert.deepEqual(Object.keys(manifest.icons ?? {}), ['16', '32', '48', '128']);

const pages = { '/frame.html': readFileSync(join(root, 'playground/frame.html')) };
const html = readFileSync(join(root, 'playground/index.html'));
const server = createServer((req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(pages[req.url] ?? html));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const profile = mkdtempSync(join(tmpdir(), 'uim-e2e-'));
const chrome = spawn(
  findChrome(),
  [`--user-data-dir=${profile}`, '--remote-debugging-pipe', '--enable-unsafe-extension-debugging', '--headless=new', '--host-resolver-rules=MAP uim.test 127.0.0.1', '--no-first-run', '--no-default-browser-check', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
);

let nextId = 0;
let buffer = '';
const pending = new Map();
chrome.stdio[4].on('data', (chunk) => {
  buffer += chunk;
  for (let end; (end = buffer.indexOf('\0')) >= 0; buffer = buffer.slice(end + 1)) {
    const msg = JSON.parse(buffer.slice(0, end));
    pending.get(msg.id)?.(msg);
    pending.delete(msg.id);
  }
});
async function send(method, params = {}, sessionId) {
  const msg = await new Promise((r) => {
    pending.set(++nextId, r);
    chrome.stdio[3].write(`${JSON.stringify({ id: nextId, method, params, sessionId })}\0`);
  });
  if (msg.error) throw new Error(`${method}: ${msg.error.message}`);
  return msg.result;
}
async function evaluate(sessionId, expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

const timer = setTimeout(() => {
  console.error('e2e: overall timeout');
  process.exit(1);
}, 90_000);

try {
  const { id: extId } = await send('Extensions.loadUnpacked', { path: extDir });
  const { targetId } = await send('Target.createTarget', { url });
  const { sessionId: page } = await send('Target.attachToTarget', { targetId, flatten: true });
  await poll('page load', () => evaluate(page, 'document.readyState'), (s) => s === 'complete');

  const targets = (await send('Target.getTargets', { filter: [{}] })).targetInfos;
  const tab = targets.find((t) => t.type === 'tab' && t.url === url);
  const worker = targets.find((t) => t.type === 'service_worker' && t.url === `chrome-extension://${extId}/background.js`);
  assert.ok(tab && worker, 'tab or service worker target missing');
  const { sessionId: sw } = await send('Target.attachToTarget', { targetId: worker.targetId, flatten: true });
  // the first click was dropped (cause unknown) until something had been evaluated in the worker
  await poll('worker listening', () => evaluate(sw, 'chrome.action.onClicked.hasListeners()'), Boolean);

  const hosts = () =>
    evaluate(page, `[...document.querySelectorAll('ui-measure-root')].map((h) => ({ open: h.matches(':popover-open'), svg: !!h.shadowRoot?.querySelector('svg') }))`);
  let tabId;
  const badge = () => evaluate(sw, `chrome.action.getBadgeText({ tabId: ${tabId} })`);

  for (const on of [true, false, true]) {
    await send('Extensions.triggerAction', { id: extId, targetId: tab.targetId });
    const state = await poll(
      `overlay ${on ? 'on' : 'off'}`,
      hosts,
      (h) => (on ? h.length === 1 && h[0].open && h[0].svg : h.length === 0),
    );
    // without the `tabs` permission the URL is only visible once activeTab is granted
    tabId ??= await evaluate(sw, `chrome.tabs.query({}).then((ts) => ts.find((t) => t.url === ${JSON.stringify(url)})?.id)`);
    assert.ok(tabId, 'tab not visible to the worker after the click');
    await poll(`badge ${on ? 'ON' : 'empty'}`, badge, (b) => b === (on ? 'ON' : ''));
    console.log(`ok  click → ${on ? 'on ' : 'off'}  hosts=${JSON.stringify(state)}`);
  }

  // measure lock: hover measures to the selection without Alt
  const overlay = () =>
    evaluate(page, `(() => {
      const svg = document.querySelector('ui-measure-root')?.shadowRoot?.querySelector('svg');
      return {
        svg: !!svg,
        chip: [...(svg?.querySelectorAll('text') ?? [])].map((t) => t.textContent).find((t) => t.startsWith('⌥')) ?? null,
        lines: svg?.querySelectorAll('path[stroke="#f24822"]').length ?? 0,
      };
    })()`);
  const center = (selector, session = page) =>
    evaluate(session, `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const mouse = (type, { x, y }, modifiers = 0, session = page) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, modifiers }, session);
  const press = async (key, code, keyCode, text, modifiers = 0, session = page) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, text, modifiers }, session);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, modifiers }, session);
  };
  const pressL = () => press('l', 'KeyL', 76, 'l');
  // label collision: every pair of visible label boxes (the only rects with rx) must be disjoint
  const assertLabelsApart = async (what) => {
    const boxes = await evaluate(page, `[...document.querySelector('ui-measure-root').shadowRoot.querySelectorAll('rect[rx]')]
      .map((r) => ['x', 'y', 'width', 'height'].map((a) => +r.getAttribute(a)))`);
    const pairs = boxes.flatMap((a, i) => boxes.slice(i + 1).filter((b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]).map((b) => [a, b]));
    assert.deepEqual(pairs, [], `labels overlap: ${what}`);
    return boxes.length;
  };
  let a = await center('.row .tile:nth-child(1)');
  let b = await center('.row .tile:nth-child(2)');

  await pressL();
  await poll('lock chip without selection', overlay, (o) => o.chip?.includes('lock') && o.lines === 0);
  await mouse('mouseMoved', a);
  await mouse('mousePressed', a);
  await mouse('mouseReleased', a);
  await mouse('mouseMoved', b);
  await poll('measurement without Alt', overlay, (o) => o.chip?.includes('lock') && o.lines > 0);
  console.log('ok  lock → hover measures without Alt');

  await press('Escape', 'Escape', 27);
  await poll('lock kept after clearing the selection', overlay, (o) => o.chip?.includes('lock') && o.lines === 0);
  console.log('ok  Esc clears the selection, lock stays');

  await evaluate(page, `document.querySelector('input').focus()`);
  await pressL();
  assert.equal(await evaluate(page, `document.querySelector('input').value`), 'l', 'typed L must reach the input');
  await evaluate(page, `document.activeElement.blur()`);
  // IME composition (Telex/VNI) outside an input
  await evaluate(page, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', code: 'KeyL', isComposing: true }))`);
  await sleep(100);
  assert.ok((await overlay()).chip?.includes('lock'), 'L while typing or composing must not toggle the lock');
  console.log('ok  L ignored while typing / composing');

  // one click at a time: the worker drops a click while the previous toggle is in flight
  await send('Extensions.triggerAction', { id: extId, targetId: tab.targetId });
  await poll('overlay off', hosts, (h) => h.length === 0);
  await send('Extensions.triggerAction', { id: extId, targetId: tab.targetId });
  await poll('lock reset after off → on', overlay, (o) => o.svg && o.chip === null);
  console.log('ok  off → on resets the lock');

  // focusing the input scrolled the page
  await evaluate(page, 'window.scrollTo(0, 0)');
  a = await center('.row .tile:nth-child(1)');
  b = await center('.row .tile:nth-child(2)');
  await mouse('mouseMoved', a);
  await mouse('mousePressed', a);
  await mouse('mouseReleased', a);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, modifiers: 1 }, page);
  await mouse('mouseMoved', b, 1); // 1 = Alt
  await poll('Alt-hold chip', overlay, (o) => o.chip === '⌥ measuring' && o.lines > 0);
  await assertLabelsApart('Alt-measuring tile 1 → tile 2');
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18 }, page);
  await poll('Alt released', overlay, (o) => o.chip === null && o.lines === 0);
  console.log('ok  Alt hold still shows ⌥ measuring');

  // selection navigation: outlines are compared to the page's own rects, rounded to 1px
  const SHIFT = 8;
  const rectsOf = (selectors) =>
    evaluate(page, `${JSON.stringify(selectors)}.map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round).join(','); })`);
  const outlines = () =>
    evaluate(page, `(() => {
      const svg = document.querySelector('ui-measure-root').shadowRoot.querySelector('svg');
      const box = (r) => ['x', 'y', 'width', 'height'].map((a) => Math.round(+r.getAttribute(a))).join(',');
      return {
        selected: [...svg.querySelectorAll('rect[stroke-width="2"]')].map(box),
        union: [...svg.querySelectorAll('rect[stroke-dasharray]')].map(box),
      };
    })()`);
  const expectSelected = async (what, selectors) => {
    const want = await rectsOf(selectors);
    await poll(what, outlines, (o) => JSON.stringify(o.selected) === JSON.stringify(want));
    await assertLabelsApart(what);
    console.log(`ok  ${what}`);
  };
  const tile = (n) => `.row .tile:nth-child(${n})`;
  const enter = (modifiers) => press('Enter', 'Enter', 13, '\r', modifiers);
  const tabKey = (modifiers) => press('Tab', 'Tab', 9, undefined, modifiers);

  await press('Escape', 'Escape', 27);
  await tabKey();
  assert.notEqual(await evaluate(page, 'document.activeElement.tagName'), 'BODY', 'Tab without a selection must move page focus');
  await evaluate(page, 'document.activeElement.blur()');
  console.log('ok  Tab without a selection stays with the page');

  // focus may have scrolled the page
  await evaluate(page, 'window.scrollTo(0, 0)');
  a = await center(tile(1));
  b = await center(tile(2));
  await mouse('mousePressed', a);
  await mouse('mouseReleased', a);
  await expectSelected('click selects tile 1', [tile(1)]);
  await tabKey();
  await expectSelected('Tab → next sibling', [tile(2)]);
  await tabKey(SHIFT);
  await expectSelected('Shift+Tab → previous sibling', [tile(1)]);
  await tabKey(SHIFT);
  await expectSelected('Shift+Tab wraps to the last sibling', [tile(3)]);
  await enter(SHIFT);
  await expectSelected('Shift+Enter → parent', ['.row']);
  await enter();
  await expectSelected('Enter → first child', [tile(1)]);

  await mouse('mousePressed', b, SHIFT);
  await mouse('mouseReleased', b, SHIFT);
  await expectSelected('Shift+click adds tile 2', [tile(1), tile(2)]);
  const [r1, r2] = (await rectsOf([tile(1), tile(2)])).map((s) => s.split(',').map(Number));
  const u = [r1[0], Math.min(r1[1], r2[1]), r2[0] + r2[2] - r1[0], Math.max(r1[1] + r1[3], r2[1] + r2[3]) - Math.min(r1[1], r2[1])].join(',');
  assert.deepEqual((await outlines()).union, [u], 'dashed union outline around both tiles');
  await tabKey();
  await expectSelected('Tab moves from the last-clicked element, back to one', [tile(3)]);
  await mouse('mousePressed', b, SHIFT);
  await mouse('mouseReleased', b, SHIFT);
  await mouse('mousePressed', b, SHIFT);
  await mouse('mouseReleased', b, SHIFT);
  await expectSelected('Shift+click again removes it', [tile(3)]);
  assert.deepEqual((await outlines()).union, [], 'no union outline for one element');

  await evaluate(page, `document.querySelector('input').focus({ preventScroll: true })`);
  await enter(SHIFT);
  await tabKey(SHIFT);
  await sleep(100);
  assert.equal(await evaluate(page, 'document.activeElement.tagName'), 'BUTTON', 'Shift+Tab in the input must move page focus');
  await expectSelected('Enter / Tab ignored while typing', [tile(3)]);
  await evaluate(page, 'document.activeElement.blur()');

  // gaps of a flex / grid container: select a child, Shift+Enter to the container, read the purple labels
  const gapLabels = () =>
    evaluate(page, `[...document.querySelector('ui-measure-root').shadowRoot.querySelectorAll('rect[fill="#a855f7"] + text')].map((t) => t.textContent)`);
  for (const [id, want] of [['gap-wrap', ['16', '16', '12', '24']], ['gap-column', ['10', '20']], ['gap-grid', ['16', '16', '24', '16']]]) {
    await evaluate(page, `document.querySelector('#${id}').scrollIntoView({ block: 'center' })`);
    const child = await center(`#${id} > :first-child`);
    await mouse('mouseMoved', child);
    await mouse('mousePressed', child);
    await mouse('mouseReleased', child);
    await enter(SHIFT);
    if (id === 'gap-column') {
      // the hovered child's size label covers the 10 gap, and a child size outranks a gap
      await poll('gap label hidden under the hover size', gapLabels, (g) => JSON.stringify(g) === '["20"]');
      console.log('ok  colliding gap label hidden while its child is hovered');
    }
    // hovering the container itself (its empty bottom-right corner) shows every gap label again
    await mouse('mouseMoved', await evaluate(page, `(() => { const r = document.querySelector('#${id}').getBoundingClientRect(); return { x: r.right - 2, y: r.bottom - 2 }; })()`));
    await poll(`gaps of #${id}`, gapLabels, (g) => JSON.stringify(g) === JSON.stringify(want));
    const n = await assertLabelsApart(`gaps of #${id}`);
    console.log(`ok  gaps of #${id}: ${want.join(' ')}, ${n} labels apart`);
  }

  // blueprint: select a card, B annotates its subtree; dashed outlines are one path, one `M` per box
  const pressB = () => press('b', 'KeyB', 66, 'b');
  const blueprint = () =>
    evaluate(page, `(() => {
      const svg = document.querySelector('ui-measure-root').shadowRoot.querySelector('svg');
      const d = svg.querySelector('path[stroke-dasharray]')?.getAttribute('d');
      return {
        boxes: d ? d.split('M').length - 1 : null,
        hatch: !!svg.querySelector('path[fill="url(#uim-hatch)"]'),
        labels: [...svg.querySelectorAll('rect[rx] + text')].map((t) => t.textContent),
      };
    })()`);
  const corner = (selector, dx, dy) =>
    evaluate(page, `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.left + ${dx}, y: r.top + ${dy} }; })()`);
  await evaluate(page, `document.querySelector('#bp-card').scrollIntoView({ block: 'center' })`);
  // inside the card's top padding: the card itself is the deepest element there
  const cardPadding = await corner('#bp-card', 160, 8);
  await mouse('mouseMoved', cardPadding);
  await mouse('mousePressed', cardPadding);
  await mouse('mouseReleased', cardPadding);
  await pressB();
  // row, avatar, merged tile (3 same-size boxes → 1), text, pill; the display:none child is skipped
  let bp = await poll('blueprint of #bp-card', blueprint, (o) => o.boxes === 5 && o.hatch);
  assert.ok(bp.labels.includes('r 20') && bp.labels.includes('20') && bp.labels.includes('24'), `card radius and padding labels: ${JSON.stringify(bp.labels)}`);
  await assertLabelsApart('blueprint of #bp-card');
  console.log(`ok  B → blueprint of #bp-card: 5 boxes, ${bp.labels.length} labels apart`);
  for (const [selector, want] of [['#bp-pill', 'r 16'], ['#bp-avatar', 'r 24/20']]) {
    await mouse('mouseMoved', await center(selector));
    bp = await poll(`${want} on hover of ${selector}`, blueprint, (o) => o.labels.includes(want));
    await assertLabelsApart(`blueprint, hovering ${selector}`);
  }
  console.log('ok  pill 9999px → r 16, avatar 50% → r 24/20');

  await evaluate(page, `document.querySelector('input').focus({ preventScroll: true })`);
  await pressB();
  await evaluate(page, 'document.activeElement.blur()');
  // typing scrolled the input into view
  await evaluate(page, `document.querySelector('#bp-card').scrollIntoView({ block: 'center' })`);
  await sleep(100);
  assert.equal((await blueprint()).boxes, 5, 'B while typing must not leave blueprint');
  await press('Escape', 'Escape', 27);
  await poll('Esc leaves blueprint, keeps the selection', async () => ({ ...(await blueprint()), ...(await outlines()) }), (o) => o.boxes === null && o.selected.length === 1);
  await pressB();
  await poll('B again', blueprint, (o) => o.boxes === 5);
  await pressB();
  await poll('B toggles off', blueprint, (o) => o.boxes === null);
  console.log('ok  B ignored while typing; Esc and B return to the selection');

  // load: 481 nodes in view, capped at 400; frame time while scrolling 1px per frame
  await evaluate(page, `document.querySelector('#bp-many').scrollIntoView({ block: 'center' })`);
  const many = await corner('#bp-many', 1, 1);
  await mouse('mouseMoved', many);
  await mouse('mousePressed', many);
  await mouse('mouseReleased', many);
  await enter(SHIFT);
  await pressB();
  bp = await poll('blueprint of #bp-many', blueprint, (o) => o.boxes === 399 && o.labels.includes('+81 hidden'));
  const n = await assertLabelsApart('blueprint of #bp-many');
  const frameTimes = () =>
    evaluate(page, `new Promise((done) => {
      const ts = [];
      const step = (t) => {
        ts.push(t);
        if (ts.length > 120) return done(ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b));
        window.scrollBy(0, ts.length % 2 ? 1 : -1);
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    })`);
  const stats = (ms) => ({ median: ms[ms.length >> 1].toFixed(1), p95: ms[Math.floor(ms.length * 0.95)].toFixed(1) });
  const withBlueprint = stats(await frameTimes());
  await pressB();
  await poll('blueprint off', blueprint, (o) => o.boxes === null);
  const without = stats(await frameTimes());
  console.log(`ok  #bp-many: 399 boxes + root, +81 hidden, ${n} labels apart; frame ms while scrolling, blueprint median ${withBlueprint.median} p95 ${withBlueprint.p95} vs off ${without.median} / ${without.p95}`);
  assert.ok(+withBlueprint.p95 < 34, 'blueprint of ~400 nodes must keep scrolling at least 30 fps');

  // copy: C / J / P write the last selection's spec; read back through this page, a secure origin
  await send('Browser.grantPermissions', { origin: new URL(url).origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  // readText rejects in a page without focus
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }, page);
  const clipboard = () => evaluate(page, 'navigator.clipboard.readText()');
  const labelsOf = (session) =>
    evaluate(session, `[...document.querySelector('ui-measure-root').shadowRoot.querySelectorAll('rect[rx] + text')].map((t) => t.textContent)`);
  const select = async (p, session = page) => {
    await mouse('mouseMoved', p, 0, session);
    await mouse('mousePressed', p, 0, session);
    await mouse('mouseReleased', p, 0, session);
  };
  const pressC = (session = page) => press('c', 'KeyC', 67, 'c', 0, session);
  await evaluate(page, `document.querySelector('#bp-card').scrollIntoView({ block: 'center' })`);
  await select(await corner('#bp-card', 160, 8));
  await pressC();
  let text = await poll('CSS of #bp-card on the clipboard', clipboard, (t) => t.startsWith('/* div */\n#bp-card {'));
  // height follows the font
  assert.match(text, /^  width: 320px;\n  height: [\d.]+px;\n  box-sizing: border-box;\n  padding: 20px 24px;\n  border: 1px solid rgb\(203, 213, 225\);\n  border-radius: 20px;\n}$/m, `CSS of #bp-card:\n${text}`);
  await poll('"Copied CSS" toast', () => labelsOf(page), (l) => l.includes('Copied CSS'));
  console.log('ok  C copies the CSS of #bp-card, toast shown');

  await evaluate(page, 'window.scrollTo(0, 0)');
  await select(await center('.row .tile:nth-child(2)'));
  await pressC();
  text = await poll('CSS of a tile without id', clipboard, (t) => t.startsWith('/* div.tile */'));
  const selector = text.split('\n')[1].slice(0, -2);
  assert.ok(await evaluate(page, `document.querySelector(${JSON.stringify(selector)}) === document.querySelector('.row .tile:nth-child(2)')`), `copied selector ${selector} must find the element again`);
  await press('j', 'KeyJ', 74, 'j');
  const json = JSON.parse(await poll('JSON on the clipboard', clipboard, (t) => t.startsWith('{')));
  assert.deepEqual([json.selector, json.width, json.height], [selector, 80, 100]);
  await press('p', 'KeyP', 80, 'p');
  await poll('agent prompt on the clipboard', clipboard, (t) => t.startsWith('## div.tile (80 × 100)'));
  // a page that swallows copy events: the secure page falls back to navigator.clipboard
  await evaluate(page, `window.addEventListener('copy', (e) => e.stopImmediatePropagation(), true)`);
  await press('j', 'KeyJ', 74, 'j');
  await poll('JSON through navigator.clipboard', clipboard, (t) => t.startsWith('{'));
  await poll('"Copied JSON" toast', () => labelsOf(page), (l) => l.includes('Copied JSON'));
  console.log(`ok  C / J / P: CSS, JSON, prompt; selector ${selector} finds the tile again; navigator.clipboard fallback`);

  // scaled box model: inside a scale(0.5) parent, the hover bands must line up with the rendered boxes
  await evaluate(page, `document.querySelector('#scaled').scrollIntoView({ block: 'center' })`);
  await mouse('mouseMoved', await corner('#scaled', 6, 6)); // in its padding
  const bands = (selector) =>
    evaluate(page, `(() => {
      const svg = document.querySelector('ui-measure-root').shadowRoot.querySelector('svg');
      const rects = (fill) => [...svg.querySelectorAll('rect[fill="' + fill + '"]')].map((r) => ['x', 'y', 'width', 'height'].map((a) => +r.getAttribute(a)));
      const edges = (rs) => rs.length === 4 && { outer: [rs[0][0], rs[0][1], rs[0][0] + rs[0][2], rs[1][1] + rs[1][3]], inner: [rs[2][0] + rs[2][2], rs[0][1] + rs[0][3], rs[3][0], rs[1][1]] };
      const box = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; };
      const el = document.querySelector(${JSON.stringify(selector)});
      return { padding: edges(rects('rgb(34 197 94 / 0.35)')), margin: edges(rects('rgb(249 115 22 / 0.35)')), box: box(el), child: box(el.firstElementChild) };
    })()`);
  const near = (a, b) => a && a.every((v, i) => Math.abs(v - b[i]) < 0.5);
  const scaled = await poll('bands of #scaled', () => bands('#scaled'), (o) => o.padding && o.margin);
  const [x1, y1, x2, y2] = scaled.box;
  assert.ok(near(scaled.padding.inner, scaled.child), `padding band inner edge must be the child's box: ${JSON.stringify(scaled)}`);
  assert.ok(near(scaled.padding.outer, [x1 + 2, y1 + 2, x2 - 2, y2 - 2]), `padding band outer edge: border 4 × 0.5: ${JSON.stringify(scaled)}`);
  assert.ok(near(scaled.margin.outer, [x1 - 8, y1 - 8, x2 + 8, y2 + 8]), `margin band: 16 × 0.5: ${JSON.stringify(scaled)}`);
  console.log('ok  bands of an element in a scale(0.5) parent match its rendered box');


  // CSS zoom 1.5: labels show CSS px, outlines and bands stay on the rendered (zoomed) boxes
  const redLabels = () =>
    evaluate(page, `[...document.querySelector('ui-measure-root').shadowRoot.querySelectorAll('rect[fill="#f24822"] + text')].map((t) => t.textContent)`);
  const hoverOutlines = () =>
    evaluate(page, `[...document.querySelector('ui-measure-root').shadowRoot.querySelectorAll('rect[stroke-width="1"]:not([stroke-dasharray])')].map((r) => ['x', 'y', 'width', 'height'].map((a) => Math.round(+r.getAttribute(a))).join(','))`);
  await evaluate(page, `document.querySelector('#zoomed').scrollIntoView({ block: 'center' })`);
  const zoomTile = '#zoomed > .tile';
  await mouse('mouseMoved', await center(zoomTile));
  const [zoomTileRect] = await rectsOf([zoomTile]);
  await poll('zoomed tile: rendered outline, CSS size', async () => ({ o: await hoverOutlines(), l: await labelsOf(page) }), ({ o, l }) => o.includes(zoomTileRect) && l.includes('120 × 60'));
  await mouse('mouseMoved', await corner('#zoom-card', 6, 6)); // in its padding
  await poll('zoomed card size in CSS px', () => labelsOf(page), (l) => l.includes('144 × 44'));
  const zoomed = await poll('bands of #zoom-card', () => bands('#zoom-card'), (o) => o.padding);
  const [zx1, zy1, zx2, zy2] = zoomed.box;
  assert.ok(near(zoomed.padding.inner, zoomed.child), `zoomed padding band inner edge must be the child's box: ${JSON.stringify(zoomed)}`);
  assert.ok(near(zoomed.padding.outer, [zx1 + 3, zy1 + 3, zx2 - 3, zy2 - 3]), `zoomed padding band outer edge: border 2 × 1.5: ${JSON.stringify(zoomed)}`);
  await select(await center(zoomTile));
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, modifiers: 1 }, page);
  await mouse('mouseMoved', await corner('#zoom-card', 6, 6), 1);
  await poll('Alt-measure across the zoomed gap: 24, not 36', redLabels, (l) => l.includes('24') && !l.includes('36'));
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18 }, page);
  await enter(SHIFT);
  await mouse('mouseMoved', await corner('#zoomed', 250, 80)); // below the shorter card: the container itself
  await poll('zoomed flex gap 24', gapLabels, (g) => JSON.stringify(g) === '["24"]');
  await select(await corner('#zoom-card', 6, 6));
  await pressB();
  await poll('blueprint of #zoom-card in CSS px', blueprint, (o) => ['10', '20', 'r 12'].every((t) => o.labels.includes(t)));
  await pressB();
  await pressC();
  text = await poll('CSS of #zoom-card', clipboard, (t) => t.startsWith('/* div */\n#zoom-card {'));
  assert.match(text, /^  width: 144px;\n  height: 44px;\n  box-sizing: border-box;\n  padding: 10px 20px;\n  border: 2px solid [^;]+;\n  border-radius: 12px;\n}$/m, `CSS of #zoom-card:\n${text}`);
  console.log('ok  zoom 1.5: sizes, spacing, gap, blueprint padding / radius and Copy in CSS px; outline and bands on the rendered box');

  // browser zoom is not CSS zoom: labels keep the same CSS px (story 13)
  const dpr = await evaluate(page, 'devicePixelRatio');
  await evaluate(sw, `chrome.tabs.setZoom(${tabId}, 1.25)`);
  await poll('browser zoom applied', () => evaluate(page, 'devicePixelRatio'), (r) => Math.abs(r - dpr * 1.25) < 0.01);
  await mouse('mouseMoved', await center(zoomTile));
  await poll('browser zoom leaves CSS px labels alone', () => labelsOf(page), (l) => l.includes('120 × 60'));
  assert.equal(await evaluate(page, 'document.body.currentCSSZoom'), 1, 'browser zoom must not show in currentCSSZoom');
  await evaluate(sw, `chrome.tabs.setZoom(${tabId}, 0)`);
  console.log('ok  browser zoom 125%: labels unchanged');

  // shadow roots, open and closed (chrome.dom.openOrClosedShadowRoot): select, navigate and type inside them
  await press('Escape', 'Escape', 27);
  for (const mode of ['open', 'closed']) {
    await evaluate(page, `document.querySelector('#shadow-${mode}').scrollIntoView({ block: 'center' })`);
    const inRoot = (sel) =>
      evaluate(page, `(() => { const r = (${JSON.stringify(sel)} ? window.shadowRoots.${mode}.querySelector(${JSON.stringify(sel)}) : document.querySelector('#shadow-${mode}')).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, rect: [r.x, r.y, r.width, r.height].map(Math.round).join(',') }; })()`);
    const [t1, t2, input, host] = await Promise.all(['div:nth-of-type(1)', 'div:nth-of-type(2)', 'input', ''].map(inRoot));
    await select(t1);
    await poll(`${mode} root: click selects the inner tile`, outlines, (o) => JSON.stringify(o.selected) === JSON.stringify([t1.rect]));
    assert.ok((await labelsOf(page)).includes('60 × 40'), `${mode} root: inner tile size label`);
    await tabKey();
    await poll(`${mode} root: Tab → next tile`, outlines, (o) => JSON.stringify(o.selected) === JSON.stringify([t2.rect]));
    await enter(SHIFT);
    await poll(`${mode} root: Shift+Enter → host`, outlines, (o) => JSON.stringify(o.selected) === JSON.stringify([host.rect]));
    await mouse('mouseMoved', { x: host.x, y: host.y + 26 }); // the host's bottom padding, under the tiles
    await poll(`${mode} root: gaps of the host`, gapLabels, (g) => JSON.stringify(g) === '["12","12"]');
    // the input's own (user-agent) shadow root is not entered
    await mouse('mouseMoved', input);
    await poll(`${mode} root: hover outline is the input`, hoverOutlines, (o) => o.includes(input.rect));
    await evaluate(page, `window.shadowRoots.${mode}.querySelector('input').focus({ preventScroll: true })`);
    await pressL();
    assert.equal(await evaluate(page, `window.shadowRoots.${mode}.querySelector('input').value`), 'l', `${mode} root: typed L must reach the input`);
    assert.equal((await overlay()).chip, null, `${mode} root: L while typing must not toggle the lock`);
    await evaluate(page, `window.shadowRoots.${mode}.querySelector('input').blur()`);
    await press('Escape', 'Escape', 27);
    console.log(`ok  ${mode} shadow root: click selects the inner tile, Tab / Shift+Enter, host gaps 12 12, typing in its input kept`);
  }

  // top layer: a dialog or popover the page opens while ON goes under the overlay
  await send('DOM.enable', {}, page);
  await send('DOM.getDocument', {}, page);
  const topLayer = async () => {
    const { nodeIds } = await send('DOM.getTopLayerElements', {}, page);
    const names = await Promise.all(nodeIds.map(async (nodeId) => (await send('DOM.describeNode', { nodeId }, page)).node.localName));
    return names.filter((n) => !n.startsWith('::')); // each entry's ::backdrop is listed too
  };
  for (const [what, inner, open, close] of [
    ['dialog', 'dialog p', `document.querySelector('dialog').showModal()`, `document.querySelector('dialog').close()`],
    ['popover', '#pop p', `document.querySelector('#pop').showPopover()`, `document.querySelector('#pop').hidePopover()`],
  ]) {
    await evaluate(page, open);
    // listed per document, top first; the srcdoc and same-origin frames add their own overlays after
    await poll(`overlay above the ${what}`, topLayer, (names) => names[0] !== 'ui-measure-root' && names[1] === 'ui-measure-root');
    await mouse('mouseMoved', await center(inner));
    const [want] = await rectsOf([inner]);
    await poll(`hover outline inside the ${what}`, () => evaluate(page, `[...document.querySelector('ui-measure-root').shadowRoot.querySelectorAll('rect[stroke-width="1"]:not([stroke-dasharray])')].map((r) => ['x', 'y', 'width', 'height'].map((a) => Math.round(+r.getAttribute(a))).join(','))`), (o) => o.includes(want));
    // an open modal makes the rest of the page inert
    await evaluate(page, close);
    console.log(`ok  ${what} opened while ON: overlay re-promoted above it, hover measures inside`);
  }

  // iframes: every frame the tool can reach draws its own overlay; the cross-origin one (localhost) needs host access
  const SAME_FRAMES = ['#frame-srcdoc', '#frame-same'];
  const inFrame = (id, expr) => evaluate(page, `(() => { const document = window.document.querySelector(${JSON.stringify(id)}).contentDocument; return ${expr}; })()`);
  const crossTarget = (await send('Target.getTargets', { filter: [{}] })).targetInfos.find((t) => t.type === 'iframe' && t.url.startsWith('http://localhost:'));
  assert.ok(crossTarget, 'cross-origin iframe target missing');
  const { sessionId: cross } = await send('Target.attachToTarget', { targetId: crossTarget.targetId, flatten: true });
  const frameState = async () => ({
    top: (await hosts()).length,
    same: await Promise.all(SAME_FRAMES.map((id) => inFrame(id, `document.querySelectorAll('ui-measure-root').length`))),
    cross: await evaluate(cross, `document.querySelectorAll('ui-measure-root').length`),
  });
  await send('Extensions.triggerAction', { id: extId, targetId: tab.targetId });
  await poll('every frame off', frameState, (f) => JSON.stringify(f) === '{"top":0,"same":[0,0],"cross":0}');
  await send('Extensions.triggerAction', { id: extId, targetId: tab.targetId });
  await poll('every reachable frame on, cross-origin without access stays off', frameState, (f) => JSON.stringify(f) === '{"top":1,"same":[1,1],"cross":0}');
  await poll('badge ON', badge, (b) => b === 'ON');
  await poll('toast points to the cross-origin menu', () => labelsOf(page), (l) => l.some((t) => t.includes('Measure cross-origin frames') && t.includes('localhost')));
  console.log('ok  click → on in the top, srcdoc and same-origin frames; toast names the cross-origin host');

  await evaluate(page, `document.querySelector('#frame-same').scrollIntoView({ block: 'center' })`);
  const inFramePoint = async (id, selector) => {
    const f = await evaluate(page, `(() => { const el = document.querySelector(${JSON.stringify(id)}); const r = el.getBoundingClientRect(); return { x: r.x + el.clientLeft, y: r.y + el.clientTop }; })()`);
    const t = await inFrame(id, `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, rect: [r.x, r.y, r.width, r.height].map(Math.round).join(',') }; })()`);
    return { x: f.x + t.x, y: f.y + t.y, rect: t.rect };
  };
  const frameOutlines = (id) =>
    inFrame(id, `(() => {
      const svg = document.querySelector('ui-measure-root').shadowRoot.querySelector('svg');
      const box = (r) => ['x', 'y', 'width', 'height'].map((a) => Math.round(+r.getAttribute(a))).join(',');
      return {
        hover: [...svg.querySelectorAll('rect[stroke-width="1"]:not([stroke-dasharray])')].map(box),
        selected: [...svg.querySelectorAll('rect[stroke-width="2"]')].map(box),
        measure: [...svg.querySelectorAll('rect[rx] + text')].map((t) => t.textContent),
      };
    })()`);
  const topHover = () => evaluate(page, `document.querySelector('ui-measure-root').shadowRoot.querySelectorAll('rect[stroke-width="1"]:not([stroke-dasharray])').length`);
  const t1 = await inFramePoint('#frame-same', '.tile:nth-child(1)');
  const t2 = await inFramePoint('#frame-same', '.tile:nth-child(2)');
  await mouse('mouseMoved', t1);
  await poll('hover outline inside the same-origin frame', () => frameOutlines('#frame-same'), (o) => o.hover.includes(t1.rect));
  await poll('no stale hover box in the top frame', topHover, (n) => n === 0);
  await mouse('mousePressed', t1);
  await mouse('mouseReleased', t1);
  await poll('tile selected inside the frame', () => frameOutlines('#frame-same'), (o) => JSON.stringify(o.selected) === JSON.stringify([t1.rect]));
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, modifiers: 1 }, page);
  await mouse('mouseMoved', t2, 1);
  await poll('Alt-measure between the frame tiles: spacing 12', () => frameOutlines('#frame-same'), (o) => o.measure.includes('12'));
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18 }, page);
  console.log('ok  hover, select and Alt-measure inside the same-origin frame');

  // the click focused the frame: Esc clears its selection first, then turns every frame off
  await press('Escape', 'Escape', 27);
  await poll('Esc clears the frame selection', () => frameOutlines('#frame-same'), (o) => o.selected.length === 0);
  assert.equal(JSON.stringify(await frameState()), '{"top":1,"same":[1,1],"cross":0}', 'clearing a frame selection keeps every frame on');
  await press('Escape', 'Escape', 27);
  await poll('Esc in a frame turns every frame off', frameState, (f) => JSON.stringify(f) === '{"top":0,"same":[0,0],"cross":0}');
  await poll('badge cleared', badge, (b) => b === '');
  console.log('ok  Esc in a frame: clears its selection, then turns every frame off and clears the badge');

  // plain http is not a secure context: no navigator.clipboard, the copy command still writes
  const httpUrl = `http://uim.test:${server.address().port}/`;
  const { targetId: httpTarget } = await send('Target.createTarget', { url: httpUrl });
  const { sessionId: httpPage } = await send('Target.attachToTarget', { targetId: httpTarget, flatten: true });
  await poll('http page load', () => evaluate(httpPage, 'document.readyState'), (s) => s === 'complete');
  assert.equal(await evaluate(httpPage, 'window.isSecureContext'), false, 'uim.test must be an insecure origin');
  const httpTab = (await send('Target.getTargets', { filter: [{}] })).targetInfos.find((t) => t.type === 'tab' && t.url === httpUrl);
  await send('Extensions.triggerAction', { id: extId, targetId: httpTab.targetId });
  await poll('overlay on the http page', () => evaluate(httpPage, `!!document.querySelector('ui-measure-root')?.shadowRoot?.querySelector('svg')`), Boolean);
  await select(await center('.row .tile:nth-child(2)', httpPage), httpPage);
  await pressC(httpPage);
  await poll('CSS copied on http', clipboard, (t) => t.startsWith('/* div.tile */'));
  await poll('"Copied CSS" toast on http', () => labelsOf(httpPage), (l) => l.includes('Copied CSS'));
  // a page that swallows copy events leaves no path on http: the toast says so
  await evaluate(httpPage, `window.addEventListener('copy', (e) => e.stopImmediatePropagation(), true)`);
  await press('j', 'KeyJ', 74, 'j', 0, httpPage);
  await poll('clipboard error toast', () => labelsOf(httpPage), (l) => l.some((t) => t.startsWith('Copy failed')));
  assert.ok((await clipboard()).startsWith('/* div.tile */'), 'a failed copy must leave the clipboard alone');
  await send('Target.closeTarget', { targetId: httpTarget });
  console.log('ok  copy works on http; clear message when the clipboard is unavailable');

  // a granted cross-origin host: headless Chrome can't answer the permission prompt of the icon's menu,
  // so a copy of the build grants localhost up front, as the port-less pattern the menu asks for
  const grantedDir = join(profile, 'granted-ext');
  cpSync(extDir, grantedDir, { recursive: true });
  writeFileSync(join(grantedDir, 'manifest.json'), JSON.stringify({ ...manifest, host_permissions: ['http://localhost/*'] }));
  await send('Extensions.uninstall', { id: extId });
  const { id: grantedId } = await send('Extensions.loadUnpacked', { path: grantedDir });
  const { targetId: grantedTarget } = await send('Target.createTarget', { url });
  const { sessionId: grantedPage } = await send('Target.attachToTarget', { targetId: grantedTarget, flatten: true });
  await poll('page load', () => evaluate(grantedPage, 'document.readyState'), (s) => s === 'complete');
  const grantedTargets = (await send('Target.getTargets', { filter: [{}] })).targetInfos;
  const grantedWorker = grantedTargets.find((t) => t.type === 'service_worker' && t.url === `chrome-extension://${grantedId}/background.js`);
  const { sessionId: grantedSw } = await send('Target.attachToTarget', { targetId: grantedWorker.targetId, flatten: true });
  await poll('granted worker listening', () => evaluate(grantedSw, 'chrome.action?.onClicked.hasListeners()'), Boolean);
  const grantedTab = grantedTargets.find((t) => t.type === 'tab' && t.url === url && t.targetId !== tab.targetId);
  const grantedCross = grantedTargets.find((t) => t.type === 'iframe' && t.url.startsWith('http://localhost:') && t.targetId !== crossTarget.targetId);
  assert.ok(grantedCross, 'cross-origin iframe target of the second tab missing');
  const { sessionId: cross2 } = await send('Target.attachToTarget', { targetId: grantedCross.targetId, flatten: true });
  await send('Extensions.triggerAction', { id: grantedId, targetId: grantedTab.targetId });
  await poll('overlay in the granted cross-origin frame', () => evaluate(cross2, `document.querySelectorAll('ui-measure-root').length`), (n) => n === 1);
  await evaluate(grantedPage, `document.querySelector('#frame-cross').scrollIntoView({ block: 'center' })`);
  const frameBox = await evaluate(grantedPage, `(() => { const el = document.querySelector('#frame-cross'); const r = el.getBoundingClientRect(); return { x: r.x + el.clientLeft, y: r.y + el.clientTop }; })()`);
  const crossTile = await evaluate(cross2, `(() => { const r = document.querySelector('.tile').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, rect: [r.x, r.y, r.width, r.height].map(Math.round).join(',') }; })()`);
  // the first move into a fresh cross-process frame can get lost (seen before the tool is on too): move on every try
  await poll('hover outline inside the cross-origin frame', async () => {
    await mouse('mouseMoved', { x: frameBox.x + crossTile.x, y: frameBox.y + crossTile.y }, 0, grantedPage);
    return evaluate(cross2, `[...document.querySelector('ui-measure-root').shadowRoot.querySelectorAll('rect[stroke-width="1"]:not([stroke-dasharray])')].map((r) => ['x', 'y', 'width', 'height'].map((a) => Math.round(+r.getAttribute(a))).join(','))`);
  }, (o) => o.includes(crossTile.rect));
  assert.ok(!(await labelsOf(grantedPage)).some((t) => t.includes('cross-origin')), 'no access toast once every frame is reached');
  await send('Extensions.triggerAction', { id: grantedId, targetId: grantedTab.targetId });
  await poll('click turns the cross-origin frame off too', () => evaluate(cross2, `document.querySelectorAll('ui-measure-root').length`), (n) => n === 0);
  console.log('ok  granted host: the cross-origin frame draws its own overlay, hover measures inside, click turns it off');

  console.log('e2e passed');
} catch (err) {
  console.error('e2e failed:', err.message);
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  chrome.kill();
  server.close();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
