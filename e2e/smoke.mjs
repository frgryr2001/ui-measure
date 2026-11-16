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
// keys are named as this platform's keyboard prints them (the Hint, the measuring chip)
const MAC = process.platform === 'darwin';
const CHIP = MAC ? '⌥ measuring' : 'Alt measuring';

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

// the hover outline in the overlay's svg, as a quoted selector for evaluated page code
const HOVER_OUTLINE = `'[data-outline="hover"]'`;
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
// not Alt+Shift: Windows switches the input language on it
assert.deepEqual(manifest.commands['toggle-measure'].suggested_key, { default: 'Ctrl+Shift+E', mac: 'Command+Shift+E' });

const pages = { '/frame.html': readFileSync(join(root, 'playground/frame.html')) };
const html = readFileSync(join(root, 'playground/index.html'));
const server = createServer((req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(pages[req.url] ?? html));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const profile = mkdtempSync(join(tmpdir(), 'uim-e2e-'));
// headless treats an idle window as occluded: the page goes hidden and rAF stops, so a hover glide never arrives
const chrome = spawn(
  findChrome(),
  [`--user-data-dir=${profile}`, '--remote-debugging-pipe', '--enable-unsafe-extension-debugging', '--headless=new', '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--host-resolver-rules=MAP uim.test 127.0.0.1', '--no-first-run', '--no-default-browser-check', 'about:blank'],
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
}, 150_000);

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
  const title = () => evaluate(sw, `chrome.action.getTitle({ tabId: ${tabId} })`);
  // the icon title names the shortcut as bound (empty when another extension holds it, or the user cleared it)
  const shortcut = await evaluate(sw, `chrome.commands.getAll().then((cs) => cs.find((c) => c.name === 'toggle-measure')?.shortcut)`);
  assert.ok(shortcut, 'the toggle shortcut is bound on a fresh profile');

  for (const on of [true, false, true]) {
    await send('Extensions.triggerAction', { id: extId, targetId: tab.targetId });
    const state = await poll(
      `overlay ${on ? 'on' : 'off'}`,
      hosts,
      (h) => (on ? h.length === 1 && h[0].open && h[0].svg : h.length === 0),
    ).catch(async (e) => {
      // the known first-click flake (ticket 01), not reproduced since: print what the worker saw for next time
      const seen = await evaluate(sw, `(async () => ({ action: typeof chrome.action, listening: chrome.action?.onClicked.hasListeners(), tabs: (await chrome.tabs.query({})).map((t) => t.url ?? '(no url: no activeTab)') }))()`).catch(String);
      throw new Error(`${e.message}\nworker: ${JSON.stringify(seen)}`);
    });
    // without the `tabs` permission the URL is only visible once activeTab is granted
    tabId ??= await evaluate(sw, `chrome.tabs.query({}).then((ts) => ts.find((t) => t.url === ${JSON.stringify(url)})?.id)`);
    assert.ok(tabId, 'tab not visible to the worker after the click');
    await poll(`badge ${on ? 'ON' : 'empty'}`, badge, (b) => b === (on ? 'ON' : ''));
    await poll('icon title names the shortcut', title, (t) => t === (on ? `UI Measure: ON (${shortcut} or Esc to turn off)` : `UI Measure: OFF (${shortcut})`));
    console.log(`ok  click → ${on ? 'on ' : 'off'}  hosts=${JSON.stringify(state)}  title shortcut ${shortcut}`);
  }

  // the measuring chip and red measurement lines
  const overlay = () =>
    evaluate(page, `(() => {
      const svg = document.querySelector('ui-measure-root')?.shadowRoot?.querySelector('svg');
      return {
        svg: !!svg,
        chip: [...(svg?.querySelectorAll('text') ?? [])].map((t) => t.textContent).find((t) => t === ${JSON.stringify(CHIP)}) ?? null,
        lines: svg?.querySelectorAll('[data-line="measurement"]').length ?? 0,
      };
    })()`);
  const center = (selector, session = page) =>
    evaluate(session, `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const mouse = (type, { x, y }, modifiers = 0, session = page) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, modifiers }, session);
  const press = async (key, code, keyCode, text, modifiers = 0, session = page) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, text, modifiers }, session);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, modifiers }, session);
  };
  const click = async (p, modifiers = 0, session = page) => {
    await mouse('mousePressed', p, modifiers, session);
    await mouse('mouseReleased', p, modifiers, session);
  };
  // the Hint: its words (keycaps and text) and its box, null while hidden
  const hintOf = (session = page) =>
    evaluate(session, `(() => {
      const h = document.querySelector('ui-measure-root')?.shadowRoot?.querySelector('[data-hint]');
      if (!h) return null;
      const r = h.getBoundingClientRect();
      const kids = [...h.children].map((c) => c.getBoundingClientRect());
      return { text: [...h.children].map((c) => c.textContent).join(' '), box: [r.x, r.y, r.width, r.height], vw: innerWidth, vh: innerHeight, used: kids.at(-1).right - kids[0].left };
    })()`);
  // the Styles panel: its box and the text of each row (`name  value`), null while closed
  const stylesOf = () =>
    evaluate(page, `(() => {
      const p = document.querySelector('ui-measure-root')?.shadowRoot?.querySelector('[data-styles]');
      if (!p) return null;
      const r = p.getBoundingClientRect();
      return { box: [r.x, r.y, r.width, r.height], rows: [...p.querySelectorAll('[data-style-row]')].map((row) => row.textContent), swatches: p.querySelectorAll('[data-swatch]').length, vw: innerWidth, vh: innerHeight };
    })()`);
  // label collision: every pair of visible label boxes, the hint and the Styles panel must be 4px apart (labels.ts APART);
  // the Hint and the panel may overlap each other, as nothing moves either out of the other's way
  const assertLabelsApart = async (what) => {
    const boxes = await evaluate(page, `[...document.querySelector('ui-measure-root').shadowRoot.querySelectorAll('[data-label]')]
      .map((r) => ['x', 'y', 'width', 'height'].map((a) => +r.getAttribute(a)))`);
    const labelCount = boxes.length;
    const hint = await hintOf();
    if (hint) boxes.push(hint.box);
    const panel = await stylesOf();
    if (panel) boxes.push(panel.box);
    const g = 3.9; // 4px, less float error
    const pairs = boxes.flatMap((a, i) => boxes.slice(i + 1).filter((b, j) => (i < labelCount || i + 1 + j < labelCount) && a[0] < b[0] + b[2] + g && b[0] < a[0] + a[2] + g && a[1] < b[1] + b[3] + g && b[1] < a[1] + a[3] + g).map((b) => [a, b]));
    assert.deepEqual(pairs, [], `labels overlap: ${what}`);
    return boxes.length;
  };
  const a = await center('.row .tile:nth-child(1)');
  const b = await center('.row .tile:nth-child(2)');
  // Copy is paused (src/core/hint.ts COPY). Put `C copy · ` back here when that flag is true.
  const SELECTION_HINT = `${MAC ? '⌥ Option' : 'Alt'} measure · B children · I styles · S stacking`;
  await mouse('mouseMoved', a);
  await poll('hint with nothing selected', hintOf, (h) => h?.text === 'Click to select');
  const labelChrome = await evaluate(page, `(() => {
    const r = document.querySelector('ui-measure-root').shadowRoot.querySelector('[data-label]');
    return { rx: r?.getAttribute('rx'), filter: r?.closest('[data-labels]')?.style.filter ?? '' };
  })()`);
  assert.equal(labelChrome.rx, '8', 'a label is rounded like the hint');
  assert.match(labelChrome.filter, /drop-shadow\(rgba\(0, 0, 0, 0\.3\) 0px 4px 12px\)/, `a label has the hint's shadow: ${labelChrome.filter}`);
  await assertLabelsApart('hover with the hint');
  await click(a);
  // a click sends no pointermove: move to refresh the pointer
  await mouse('mouseMoved', a);
  const long = await poll('hint on the selected element offers its parent', hintOf, (h) => h?.text === `${SELECTION_HINT} · Click again → parent`);
  // the pill's width is estimated from 6.6px per char: the drawn text must fill it, within a few px
  assert.ok(Math.abs(long.used - (long.box[2] - 16)) < 6, `hint text ${long.used}px in a ${long.box[2]}px pill`);
  await mouse('mouseMoved', b);
  await poll('hint off the selection: no parent', hintOf, (h) => h?.text === SELECTION_HINT);
  const hb = (await hintOf()).box;
  assert.deepEqual([hb[0] - b.x, hb[1] - b.y].map(Math.round), [16, 16], `hint 16px below-right of the pointer: ${JSON.stringify(hb)}`);
  const vp = await hintOf();
  await mouse('mouseMoved', { x: vp.vw - 4, y: vp.vh - 4 });
  const flipped = await poll('hint flips at the bottom-right corner', hintOf, (h) => h && h.box[0] + h.box[2] <= h.vw && h.box[1] + h.box[3] <= h.vh && h.box[0] < h.vw - 4);
  assert.ok(flipped.box[0] >= 0 && flipped.box[1] >= 0, `hint on screen: ${JSON.stringify(flipped)}`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, modifiers: 1 }, page);
  await mouse('mouseMoved', b, 1); // 1 = Alt
  await poll('Alt-hold chip', overlay, (o) => o.chip === CHIP && o.lines > 0);
  assert.equal(await hintOf(), null, 'hint hidden while measuring');
  // the line glides onto tile 2; labels are checked once it has arrived
  const linePaths = () =>
    evaluate(page, `[...document.querySelector('ui-measure-root').shadowRoot.querySelectorAll('[data-line="measurement"]')].map((p) => p.getAttribute('d')).join('|')`);
  const linesSettled = (() => {
    let before = '';
    return (d) => d.length > 0 && before === (before = d);
  })();
  await poll('measurement lines settled', linePaths, linesSettled);
  await assertLabelsApart('Alt-measuring tile 1 → tile 2');
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18 }, page);
  await poll('Alt released', overlay, (o) => o.chip === null && o.lines === 0);
  await poll('hint back after Alt', hintOf, (h) => h?.text === SELECTION_HINT);
  console.log('ok  hint: click to select → measure / children (+ parent on the selection), 16px off the pointer, flips at the corner, hidden while measuring');
  console.log(`ok  Alt hold still shows ${CHIP}`);

  // selection: outlines are compared to the page's own rects, rounded to 1px
  const SHIFT = 8;
  const rectsOf = (selectors) =>
    evaluate(page, `${JSON.stringify(selectors)}.map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round).join(','); })`);
  const outlines = () =>
    evaluate(page, `(() => {
      const svg = document.querySelector('ui-measure-root').shadowRoot.querySelector('svg');
      const box = (r) => ['x', 'y', 'width', 'height'].map((a) => Math.round(+r.getAttribute(a))).join(',');
      return {
        selected: [...svg.querySelectorAll('[data-outline="selected"]')].map(box),
        union: [...svg.querySelectorAll('[data-outline="selection"]')].map(box),
      };
    })()`);
  const expectSelected = async (what, selectors) => {
    const want = await rectsOf(selectors);
    await poll(what, outlines, (o) => JSON.stringify(o.selected) === JSON.stringify(want));
    await assertLabelsApart(what);
    console.log(`ok  ${what}`);
  };
  const tile = (n) => `.row .tile:nth-child(${n})`;

  await press('Escape', 'Escape', 27);
  await expectSelected('Esc clears the selection', []);
  await click(a);
  await expectSelected('click selects tile 1', [tile(1)]);
  await click(a);
  await expectSelected('click it again → parent', ['.row']);
  // the same spot keeps climbing, up to <html>, where it stays
  const depth = await evaluate(page, `(() => { let n = 0; for (let e = document.querySelector('.row'); e.parentElement; e = e.parentElement) n++; return n; })()`);
  for (let i = 0; i < depth + 1; i++) await click(a);
  await expectSelected(`${depth} more clicks climb to <html>, one more stays`, ['html']);
  await click(b);
  await expectSelected('a click elsewhere goes back down', [tile(2)]);

  // L / J / P / Tab / Enter are no shortcuts: with a selection they reach the page, the selection stays
  await evaluate(page, `window.uimKeys = []; document.addEventListener('keydown', (e) => uimKeys.push(e.key))`);
  for (const [key, code, keyCode, text] of [['l', 'KeyL', 76, 'l'], ['j', 'KeyJ', 74, 'j'], ['p', 'KeyP', 80, 'p'], ['Tab', 'Tab', 9], ['Enter', 'Enter', 13, '\r']]) {
    await press(key, code, keyCode, text);
  }
  assert.deepEqual(await evaluate(page, 'uimKeys'), ['l', 'j', 'p', 'Tab', 'Enter'], 'L / J / P / Tab / Enter must reach the page');
  await evaluate(page, 'document.activeElement.blur(); window.scrollTo(0, 0)');
  await expectSelected('L / J / P / Tab / Enter reach the page', [tile(2)]);

  await click(a);
  await click(b, SHIFT);
  await expectSelected('Shift+click adds tile 2', [tile(1), tile(2)]);
  const [r1, r2] = (await rectsOf([tile(1), tile(2)])).map((s) => s.split(',').map(Number));
  const u = [r1[0], Math.min(r1[1], r2[1]), r2[0] + r2[2] - r1[0], Math.max(r1[1] + r1[3], r2[1] + r2[3]) - Math.min(r1[1], r2[1])].join(',');
  assert.deepEqual((await outlines()).union, [u], 'dashed union outline around both tiles');
  await click(b, SHIFT);
  await expectSelected('Shift+click again removes it', [tile(1)]);
  assert.deepEqual((await outlines()).union, [], 'no union outline for one element');


  // gaps of a flex / grid container: click a child twice to select the container, read the purple labels
  const gapLabels = () =>
    evaluate(page, `[...document.querySelector('ui-measure-root').shadowRoot.querySelectorAll('[data-label="gap"] + text')].map((t) => t.textContent)`);
  for (const [id, want] of [['gap-wrap', ['16', '16', '12', '24']], ['gap-column', ['10', '20']], ['gap-grid', ['16', '16', '24', '16']]]) {
    await evaluate(page, `document.querySelector('#${id}').scrollIntoView({ block: 'center' })`);
    const child = await center(`#${id} > :first-child`);
    await mouse('mouseMoved', child);
    await click(child);
    await click(child);
    if (id === 'gap-column') {
      // the hint takes the spot below the hovered child 2, so its size label goes above, onto the 10 gap: a child size outranks a gap
      await mouse('mouseMoved', await center(`#${id} > :nth-child(2)`));
      await poll('gap label hidden under the hover size', gapLabels, (g) => !g.includes('10'));
      await assertLabelsApart('hovering a child of #gap-column');
      console.log('ok  colliding gap label hidden while its child is hovered');
    }
    // hovering the container itself (its empty bottom-right corner) shows every gap label again. #gap-column: higher up its empty
    // column, since in the 756px viewport the Hint flips left onto the spot below the box, and the W × H would stay above, on the 20
    const up = id === 'gap-column' ? 'r.top + 32' : 'r.bottom - 2';
    await mouse('mouseMoved', await evaluate(page, `(() => { const r = document.querySelector('#${id}').getBoundingClientRect(); return { x: r.right - 2, y: ${up} }; })()`));
    await poll(`gaps of #${id}`, gapLabels, (g) => JSON.stringify(g) === JSON.stringify(want));
    const n = await assertLabelsApart(`gaps of #${id}`);
    console.log(`ok  gaps of #${id}: ${want.join(' ')}, ${n} labels apart`);
    if (id === 'gap-column') {
      // its 10 (vertical line) and 20 (horizontal line) gaps are shorter than their labels: each value sits beside its line, not on it
      const covered = await evaluate(page, `(() => {
        const root = document.querySelector('ui-measure-root').shadowRoot;
        const boxes = [...root.querySelectorAll('[data-label="gap"]')].map((r) => ['x', 'y', 'width', 'height'].map((a) => +r.getAttribute(a)));
        return [...root.querySelectorAll('[data-line="gap"]')].map((p) => {
          const [x1, y1, x2, y2] = p.getAttribute('d').match(/-?[\\d.]+/g).map(Number);
          const [mx, my] = [(x1 + x2) / 2, (y1 + y2) / 2];
          return boxes.some(([x, y, w, h]) => mx >= x && mx <= x + w && my >= y && my <= y + h) ? [x1, y1, x2, y2] : null;
        }).filter(Boolean);
      })()`);
      assert.deepEqual(covered, [], 'gap labels of #gap-column must sit beside their lines');
      console.log('ok  short gap labels of #gap-column sit beside their lines, both axes');
    }
  }

  // blueprint: select a card, B annotates its subtree; dashed outlines are one path, one `M` per box
  const pressB = () => press('b', 'KeyB', 66, 'b');
  const blueprint = () =>
    evaluate(page, `(() => {
      const svg = document.querySelector('ui-measure-root').shadowRoot.querySelector('svg');
      const d = svg.querySelector('[data-outline="blueprint"]')?.getAttribute('d');
      return {
        boxes: d ? d.split('M').length - 1 : null,
        hatch: !!svg.querySelector('[data-band="hatch"]'),
        labels: [...svg.querySelectorAll('[data-label] + text')].map((t) => t.textContent),
      };
    })()`);
  const corner = (selector, dx, dy) =>
    evaluate(page, `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.left + ${dx}, y: r.top + ${dy} }; })()`);
  const select = async (p, session = page) => {
    await mouse('mouseMoved', p, 0, session);
    await click(p, 0, session);
  };

  // same-size wrappers: a click picks the box Blueprint keeps; same-size boxes share an outline, so the details tell them apart
  const labelTexts = () => evaluate(page, `[...document.querySelector('ui-measure-root').shadowRoot.querySelectorAll('[data-label] + text')].map((t) => t.textContent)`);
  await press('Escape', 'Escape', 27);
  await evaluate(page, `document.querySelector('#wrap-chain').scrollIntoView({ block: 'center' })`);
  const rowSpot = await corner('#wrap-row-inner', 400, 30); // right of the text: the plain inner row is the deepest element
  await select(rowSpot);
  await expectSelected('click on the plain row selects its rounded same-size parent', ['#wrap-row']);
  await poll('the parent\'s radius shows', labelTexts, (l) => l.includes('r 12'));
  await click(rowSpot);
  await expectSelected('click again → the next box that is larger', ['#wrap-chain']);
  const chainSpot = await corner('#chain-9', 4, 4); // in the padding of the innermost box
  // the Hint at the pointer would cover the small box's values: click, then wait to the right of it
  const clickChain = async () => {
    await mouse('mouseMoved', chainSpot);
    await click(chainSpot);
    await mouse('mouseMoved', { x: chainSpot.x + 300, y: chainSpot.y });
  };
  await clickChain();
  // one box: the inner box's padding and the outer box's radius, on the first click
  await poll('10-deep chain: padding 8 12 of the inner box and r 8 of the outer one', labelTexts, (l) => l.includes('8') && l.includes('12') && l.includes('r 8'));
  await expectSelected('10-deep chain: one outline', ['#chain-9']);
  await clickChain();
  await expectSelected('click again → past the chain', ['#wrap-chain']);
  await press('Escape', 'Escape', 27);
  await click(rowSpot, SHIFT);
  await poll('Shift+click follows the same rule', labelTexts, (l) => l.includes('440 × 60'));
  await click(chainSpot, SHIFT);
  await expectSelected('Shift+click adds the padded chain box', ['#wrap-row', '#chain-9']);
  await press('Escape', 'Escape', 27);
  await select(rowSpot);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, modifiers: 1 }, page);
  await mouse('mouseMoved', chainSpot, 1);
  await poll('Alt-measure from the row to the chain: the grid gap 12', overlay, (o) => o.chip === CHIP && o.lines === 1);
  assert.ok((await labelTexts()).includes('12'), `measurement 12: ${JSON.stringify(await labelTexts())}`);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18 }, page);
  await press('Escape', 'Escape', 27);
  console.log('ok  Shift+click picks the same boxes; Alt-measure from the row to the chain box: 12');

  // block gaps: a block container's stacked children get gaps like a flex column; a paragraph's inline elements none
  await evaluate(page, `document.querySelector('#bp-text').scrollIntoView({ block: 'center' })`);
  const clickThenAway = async (p, dy = 0) => {
    await select(p);
    await mouse('mouseMoved', { x: p.x + 520, y: p.y + dy }); // out of the Hint's way
  };
  // in a 756px viewport the Hint flips left onto the article: keep it above
  await clickThenAway(await corner('#bp-text', 4, 4), -100);
  await poll('block gaps of the article: h3 → p 8, p → ul 12', gapLabels, (g) => JSON.stringify(g) === '["8","12"]');
  await assertLabelsApart('block gaps of #bp-text');
  await clickThenAway(await corner('#bp-text-p', 6, 8));
  await poll('the paragraph is selected', labelTexts, (l) => l.some((t) => t.startsWith('456 × ')));
  assert.deepEqual(await gapLabels(), [], 'a paragraph with direct text has no gaps');
  await press('Escape', 'Escape', 27);
  console.log('ok  block gaps: #bp-text 8 12 between its blocks, none inside a paragraph with inline elements');

  // leaders: each with the label it ends on (the edge point nearest its target), its length, and the labels it crosses
  const leaders = () =>
    evaluate(page, `(() => {
      const root = document.querySelector('ui-measure-root').shadowRoot;
      const labels = [...root.querySelectorAll('[data-label]')].map((r) => ({ kind: r.dataset.label, text: r.nextElementSibling.textContent, b: ['x', 'y', 'width', 'height'].map((a) => +r.getAttribute(a)) }));
      const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
      return [...root.querySelectorAll('[data-line="leader"]')].map((l) => {
        const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map((a) => +l.getAttribute(a));
        const own = labels.find(({ b: [x, y, w, h] }) => Math.abs(clamp(x1, x, x + w) - x2) < 0.01 && Math.abs(clamp(y1, y, y + h) - y2) < 0.01);
        const inside = (px, py, [x, y, w, h]) => px > x + 0.5 && px < x + w - 0.5 && py > y + 0.5 && py < y + h - 0.5;
        const crossed = labels.filter((o) => o !== own && Array.from({ length: 19 }, (_, i) => (i + 1) / 20).some((t) => inside(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, o.b)));
        return { kind: own?.kind ?? null, text: own?.text ?? null, at: [x1, y1].map(Math.round).join(), box: own?.b.map(Math.round).join() ?? null, length: Math.hypot(x2 - x1, y2 - y1), crossed: crossed.map((o) => o.text) };
      });
    })()`);
  const assertLeaders = async (what) => {
    const ls = await leaders();
    for (const l of ls) {
      assert.ok(['padding', 'gap', 'radius', 'size'].includes(l.kind), `${what}: a leader ends on a details value or a size: ${JSON.stringify(l)}`);
      assert.ok(l.length <= 40.01, `${what}: leader at most 40px: ${JSON.stringify(l)}`);
      assert.deepEqual(l.crossed, [], `${what}: a leader crosses no label: ${JSON.stringify(l)}`);
    }
    return ls;
  };
  // the screenshot case: a row with side padding and radius keeps r 12 and both paddings
  await evaluate(page, `document.querySelector('#leader-row').scrollIntoView({ block: 'center' })`);
  await clickThenAway(await corner('#leader-row', 2, 30));
  await poll('#leader-row: r 12 and both side paddings', labelTexts, (l) => l.includes('r 12') && l.filter((t) => t === '24').length === 2);
  await assertLabelsApart('#leader-row');
  await assertLeaders('#leader-row');
  await press('Escape', 'Escape', 27);
  // dense rounded, padded tags in Blueprint: values without room sit away on leaders
  await evaluate(page, `document.querySelector('#leader-dense').scrollIntoView({ block: 'center' })`);
  await clickThenAway(await corner('#leader-dense', 3, 20));
  await pressB();
  await poll('Blueprint of #leader-dense', blueprint, (o) => o.boxes === 48);
  await assertLabelsApart('Blueprint of #leader-dense');
  const dense = await assertLeaders('Blueprint of #leader-dense');
  assert.ok(dense.some((l) => l.kind === 'radius') && dense.some((l) => l.kind === 'padding'), `radius and padding leaders in #leader-dense: ${JSON.stringify(dense)}`);
  // R4: the Hint sweeping down the box's left edge must not make a led-away value hop between spots
  const box = await evaluate(page, `(() => { const r = document.querySelector('#leader-dense').getBoundingClientRect(); return { left: r.left, top: r.top, bottom: r.bottom }; })()`);
  await mouse('mouseMoved', { x: box.left - 60, y: box.top });
  await sleep(200);
  await evaluate(page, `(() => {
    const root = document.querySelector('ui-measure-root').shadowRoot;
    const seen = (window.__leaders = {});
    const end = performance.now() + 400;
    const sample = () => {
      // per target: the spot it is on now and how often that changed (A → B → A counts 2)
      for (const l of root.querySelectorAll('[data-line="leader"]')) {
        const at = l.getAttribute('x1') + ',' + l.getAttribute('y1');
        const spot = l.getAttribute('x2') + ',' + l.getAttribute('y2');
        const s = (seen[at] ??= { spot, moves: 0 });
        if (s.spot !== spot) Object.assign(s, { spot, moves: s.moves + 1 });
      }
      if (performance.now() < end) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  })()`);
  for (let i = 1; i <= 8; i++) {
    await mouse('mouseMoved', { x: box.left - 60, y: box.top + ((box.bottom - box.top) * i) / 8 });
    await sleep(45);
  }
  await sleep(100);
  assert.ok(await evaluate(page, 'Object.keys(window.__leaders).length > 0'), 'leaders sampled while the Hint moves');
  const hops = await evaluate(page, `Object.entries(window.__leaders).filter(([, s]) => s.moves > 1)`);
  assert.deepEqual(hops, [], 'a leader\'s label changes spot at most once while the Hint moves');
  await assertLabelsApart('Blueprint of #leader-dense, Hint moved');
  await assertLeaders('Blueprint of #leader-dense, Hint moved');
  await press('Escape', 'Escape', 27);
  await press('Escape', 'Escape', 27);
  console.log(`ok  leaders: #leader-row keeps r 12 and both paddings; #leader-dense ${dense.length} leaders (radius + padding), each ≤ 40px, crossing no label; none hops while the Hint moves`);

  await evaluate(page, `document.querySelector('#bp-card').scrollIntoView({ block: 'center' })`);
  // inside the card's top padding: the card itself is the deepest element there
  const cardPadding = await corner('#bp-card', 160, 8);
  await mouse('mouseMoved', cardPadding);
  await mouse('mousePressed', cardPadding);
  await mouse('mouseReleased', cardPadding);
  // details on select, no key: the card's own radius, padding and column gap, no descendant outlines
  let bp = await poll('details of #bp-card', blueprint, (o) => o.boxes === null && o.hatch && ['r 20', '20', '24'].every((t) => o.labels.includes(t)));
  assert.deepEqual(await gapLabels(), ['12', '12'], 'column gaps of #bp-card on select');
  await assertLabelsApart('details of #bp-card');
  const radiusOf = (labels) => labels.filter((t) => t.startsWith('r '));
  await select(await center('#bp-pill'));
  // a 32px pill: its corner spot sits on a side padding value, which must not lose it
  await poll('details of the pill: r 16 and both side paddings', blueprint, (o) => o.labels.includes('r 16') && o.labels.filter((t) => t === '16').length === 2);
  await assertLabelsApart('details of the pill');
  await evaluate(page, `document.querySelector('.card .inner').scrollIntoView({ block: 'center' })`);
  await select(await corner('.card .inner', 2, 2));
  bp = await poll('details of a square box: padding 8, no radius', blueprint, (o) => o.hatch && o.labels.includes('8'));
  assert.deepEqual(radiusOf(bp.labels), [], 'no radius label on a square box');
  await press('Escape', 'Escape', 27);
  await evaluate(page, `document.querySelector('#bp-card').scrollIntoView({ block: 'center' })`);
  await mouse('mouseMoved', cardPadding);
  await poll('hover only: no padding numbers, no radius', async () => ({ ...(await blueprint()), green: await evaluate(page, `document.querySelector('ui-measure-root').shadowRoot.querySelectorAll('[data-label="padding"]').length`), hover: await evaluate(page, `document.querySelector('ui-measure-root').shadowRoot.querySelectorAll(${HOVER_OUTLINE}).length`) }),
    (o) => o.hover === 1 && !o.hatch && o.green === 0 && radiusOf(o.labels).length === 0);
  await select(cardPadding);
  await poll('details back on select', blueprint, (o) => o.labels.includes('r 20'));
  const pill = await center('#bp-pill');
  await mouse('mouseMoved', pill);
  await mouse('mousePressed', pill, SHIFT);
  await mouse('mouseReleased', pill, SHIFT);
  bp = await poll('Shift+click: details gone, union size stays', async () => ({ ...(await blueprint()), ...(await outlines()) }), (o) => o.union.length === 1 && !o.hatch && radiusOf(o.labels).length === 0);
  assert.ok(bp.labels.some((t) => t.startsWith('320 × ')), `union W × H (the pill is inside the card): ${JSON.stringify(bp.labels)}`);
  console.log('ok  details on select: #bp-card r 20, padding 20 24, gaps 12 12; pill r 16; square box no radius; none on hover or multi-select');
  await select(cardPadding);
  await pressB();
  // out of the Hint's way: under it the card's top-right r 20 hides until the pointer moves (its top-left spot holds the avatar's size)
  await mouse('mouseMoved', { x: cardPadding.x + 400, y: cardPadding.y - 60 });
  // row, avatar, merged tile (3 same-size boxes → 1), text, pill; the display:none child is skipped
  bp = await poll('blueprint of #bp-card', blueprint, (o) => o.boxes === 5 && o.hatch);
  await poll('hint in Blueprint', hintOf, (h) => h?.text === 'B / Esc to exit · I styles');
  assert.ok(bp.labels.includes('r 20') && bp.labels.includes('20') && bp.labels.includes('24'), `card radius and padding labels: ${JSON.stringify(bp.labels)}`);
  assert.equal(bp.labels.filter((t) => t === 'r 20').length, 1, `B adds descendants, the root's labels once: ${JSON.stringify(bp.labels)}`);
  await assertLabelsApart('blueprint of #bp-card');
  console.log(`ok  B → blueprint of #bp-card: 5 boxes, ${bp.labels.length} labels apart`);
  await mouse('mouseMoved', await center('#bp-pill'));
  bp = await poll('r 16 on hover of #bp-pill', blueprint, (o) => o.labels.includes('r 16'));
  await assertLabelsApart('blueprint, hovering #bp-pill');
  console.log('ok  pill 9999px → r 16');

  await evaluate(page, `document.querySelector('input').focus({ preventScroll: true })`);
  await pressB();
  await evaluate(page, 'document.activeElement.blur()');
  // typing scrolled the input into view
  await evaluate(page, `document.querySelector('#bp-card').scrollIntoView({ block: 'center' })`);
  await sleep(100);
  assert.equal((await blueprint()).boxes, 5, 'B while typing must not leave blueprint');
  // IME composition (Telex/VNI) outside an input
  await evaluate(page, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', isComposing: true }))`);
  await sleep(100);
  assert.equal((await blueprint()).boxes, 5, 'B while composing must not leave blueprint');
  await press('Escape', 'Escape', 27);
  await poll('Esc leaves blueprint, keeps the selection', async () => ({ ...(await blueprint()), ...(await outlines()) }), (o) => o.boxes === null && o.selected.length === 1);
  await pressB();
  await poll('B again', blueprint, (o) => o.boxes === 5);
  await pressB();
  await poll('B toggles off', blueprint, (o) => o.boxes === null);
  console.log('ok  B ignored while typing / composing; Esc and B return to the selection');
  // the avatar on its own: in the card's Blueprint its 40px height leaves no corner spot, and every leader spot is taken
  // (its size above it, the paragraph's words below, the card's padding values beside)
  await select(await center('#bp-avatar'));
  await poll('avatar 50% → r 24/20', blueprint, (o) => o.labels.includes('r 24/20'));
  await assertLabelsApart('the avatar selected');
  console.log('ok  avatar 50% → r 24/20');

  // Styles: I opens the last-selected element's computed CSS beside it; Esc closes it before Blueprint
  const pressI = () => press('i', 'KeyI', 73, 'i');
  await press('Escape', 'Escape', 27);
  await evaluate(page, `document.querySelector('#styles-card').scrollIntoView({ block: 'start' })`);
  await select(await center('#styles-card'));
  // the pointer away from the card and the panel, so the Hint covers neither
  await mouse('mouseMoved', { x: 8, y: 8 });
  await poll('the Hint offers I styles', hintOf, (h) => h?.text === SELECTION_HINT);
  await pressI();
  let panel = await poll('I opens Styles', stylesOf, Boolean);
  for (const want of ['font-family  Georgia', 'font-size  14px', 'line-height  20px', 'font-weight  600', 'color  #1E293B', 'background-color  #6366F1 50%', 'box-shadow  0 4 12 0 #000000 25%', 'margin  0 0 16px']) {
    assert.ok(panel.rows.includes(want), `Styles row ${want}: ${JSON.stringify(panel.rows)}`);
  }
  assert.equal(panel.swatches, 3, `a swatch before each color (color, background, shadow): ${JSON.stringify(panel.rows)}`);
  await poll('the Hint names I / Esc to close', hintOf, (h) => h?.text === 'I / Esc to close');
  // 8px off the card: below at the top of the viewport, above at the bottom, beside in the middle of the short e2e viewport
  const inside = (p) => p.box[0] >= 0 && p.box[1] >= 0 && p.box[0] + p.box[2] <= p.vw && p.box[1] + p.box[3] <= p.vh;
  const placements = [
    ['start', 'below', (p, c) => Math.round(p.box[1] - c.bottom) === 8 && Math.round(p.box[0]) === Math.round(c.left)],
    ['end', 'above', (p, c) => Math.round(c.top - (p.box[1] + p.box[3])) === 8 && Math.round(p.box[0]) === Math.round(c.left)],
    ['center', 'beside', (p, c) => Math.round(p.box[0] - c.right) === 8 && Math.round(p.box[1]) === Math.round(c.top)],
  ];
  for (const [block, side, ok] of placements) {
    await evaluate(page, `document.querySelector('#styles-card').scrollIntoView({ block: '${block}' })`);
    const o = await poll(`Styles ${side} the card`, async () => ({ p: await stylesOf(), c: await evaluate(page, `document.querySelector('#styles-card').getBoundingClientRect().toJSON()`) }), (o) => o.p && ok(o.p, o.c));
    assert.ok(inside(o.p), `panel ${side} the card, in the viewport: ${JSON.stringify(o.p)}`);
    await assertLabelsApart(`Styles ${side} #styles-card`);
  }
  // typing and IME composition keep it
  await evaluate(page, `document.querySelector('input').focus({ preventScroll: true })`);
  await pressI();
  await evaluate(page, 'document.activeElement.blur()');
  await evaluate(page, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', code: 'KeyI', isComposing: true }))`);
  // typing scrolled the input into view
  await evaluate(page, `document.querySelector('#styles-card').scrollIntoView({ block: 'center' })`);
  await sleep(100);
  assert.ok(await stylesOf(), 'I while typing / composing must not close Styles');
  // hidden while measuring, back on Alt release
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, modifiers: 1 }, page);
  await mouse('mouseMoved', { x: 8, y: 8 }, 1);
  await poll('Styles hidden while measuring', stylesOf, (p) => p === null);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18 }, page);
  await poll('Styles back on Alt release', stylesOf, Boolean);
  // with Blueprint (the card has no child boxes: the Hint tells Blueprint is on): Esc closes Styles first, then Blueprint
  await pressB();
  await sleep(100);
  assert.ok(await stylesOf(), 'Styles shown with Blueprint');
  await assertLabelsApart('Styles with Blueprint');
  await press('Escape', 'Escape', 27);
  await poll('Esc closes Styles, Blueprint stays', async () => ({ p: await stylesOf(), hint: (await hintOf())?.text }), (o) => o.p === null && o.hint === 'B / Esc to exit · I styles');
  await pressI();
  await poll('I opens Styles again', stylesOf, Boolean);
  await pressI();
  await poll('I closes Styles', stylesOf, (p) => p === null);
  await pressB();
  // clearing the selection closes it: it stays closed on the next selection
  await pressI();
  await poll('Styles open before clearing', stylesOf, Boolean);
  const cardCenter = await center('#styles-card');
  await mouse('mouseMoved', cardCenter);
  await mouse('mousePressed', cardCenter, SHIFT);
  await mouse('mouseReleased', cardCenter, SHIFT);
  await poll('Shift+click out of the selection closes Styles', async () => ({ p: await stylesOf(), sel: (await outlines()).selected.length }), (o) => o.p === null && o.sel === 0);
  await select(cardCenter);
  await sleep(100);
  assert.equal(await stylesOf(), null, 'a new selection starts with Styles closed');
  console.log('ok  I → Styles of #styles-card (hex + %, shadow, margin, font) below / above / beside it; Hint; ignored while typing / composing; hidden while measuring; with Blueprint; Esc closes it first; gone with the selection');

  // load: 481 nodes in view, capped at 400; frame time while scrolling 1px per frame
  await evaluate(page, `document.querySelector('#bp-many').scrollIntoView({ block: 'center' })`);
  const many = await corner('#bp-many', 1, 1);
  await mouse('mouseMoved', many);
  await click(many);
  await click(many);
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
  // the rAF interval stays at 16.7 until a frame goes over budget; CPU per frame (script + layout + style, every world of the page) shows a slowdown that still fits
  await send('Performance.enable', {}, page);
  const busy = async () => {
    const m = Object.fromEntries((await send('Performance.getMetrics', {}, page)).metrics.map((x) => [x.name, x.value]));
    return m.ScriptDuration + m.LayoutDuration + m.RecalcStyleDuration;
  };
  const perf = async () => {
    const before = await busy();
    const ms = await frameTimes();
    return { ...stats(ms), cpu: (((await busy()) - before) * 1000 / ms.length).toFixed(2) };
  };
  const perfOf = {};
  const withBlueprint = (perfOf['bp-many'] = await perf());
  await pressB();
  await poll('blueprint off', blueprint, (o) => o.boxes === null);
  const without = stats(await frameTimes());
  console.log(`ok  #bp-many: 399 boxes + root, +81 hidden, ${n} labels apart; frame ms while scrolling, blueprint median ${withBlueprint.median} p95 ${withBlueprint.p95} vs off ${without.median} / ${without.p95}`);
  assert.ok(+withBlueprint.p95 < 34, 'blueprint of ~400 nodes must keep scrolling at least 30 fps');

  // perf scenarios (ticket 20): Blueprint of blocks, details + Blueprint of dense tags, pointer still on a same-size chain, nothing selected
  await press('Escape', 'Escape', 27);
  for (const [id, at] of [['bp-blocks', [1, 20]], ['leader-dense', [3, 20]]]) {
    // top 60px down, under the sticky header: #bp-blocks is taller than the viewport
    await evaluate(page, `window.scrollBy(0, document.querySelector('#${id}').getBoundingClientRect().top - 60)`);
    // a spot inside the box itself: left of the first card's margin, its left padding
    const p = await evaluate(page, `(() => { const r = document.querySelector('#${id}').getBoundingClientRect(); return { x: r.left + ${at[0]}, y: r.top + ${at[1]} }; })()`);
    await select(p);
    await pressB();
    await poll(`blueprint of #${id}`, blueprint, (o) => o.boxes > 40);
    // stacked blocks and inline-block cards: vertical and horizontal block gaps
    if (id === 'bp-blocks') await poll('block gap lines in the Blueprint of #bp-blocks', () => evaluate(page, `document.querySelector('ui-measure-root').shadowRoot.querySelectorAll('[data-line="gap"]').length`), (n) => n > 40);
    perfOf[id] = await perf();
    await press('Escape', 'Escape', 27);
    await press('Escape', 'Escape', 27);
  }
  // Stacking re-reads the selection's flat-tree chain every frame: the slotted box, through a closed root
  const pressS = () => press('s', 'KeyS', 83, 's');
  await evaluate(page, `document.querySelector('#stack-shadow').scrollIntoView({ block: 'center' })`);
  await select(await corner('#stack-shadow-kid', 10, 10));
  await pressS();
  await poll('Stacking of #stack-shadow-kid', () => evaluate(page, `document.querySelectorAll('ui-measure-root')[0].shadowRoot.querySelectorAll('[data-stacking]').length`), (n) => n >= 2);
  perfOf['stacking'] = await perf();
  await press('Escape', 'Escape', 27);
  await press('Escape', 'Escape', 27);
  await evaluate(page, `document.querySelector('#chain-9').scrollIntoView({ block: 'center' })`);
  await mouse('mouseMoved', await corner('#chain-9', 4, 4));
  perfOf['wrap-chain hover'] = await perf();
  await mouse('mouseMoved', await center('#bp-text-p'));
  perfOf['nothing selected'] = await perf();
  console.log(`ok  CPU ms per frame while scrolling: ${Object.entries(perfOf).map(([k, v]) => `${k} ${v.cpu} (rAF p95 ${v.p95})`).join(', ')}`);
  for (const [k, v] of Object.entries(perfOf)) assert.ok(+v.cpu < 8 && +v.p95 < 34, `${k}: ${v.cpu} ms CPU per frame, p95 ${v.p95} ms (gate: < 8, < 34)`);

  // crowded details (ticket 25), after the perf runs: in headless Chrome the extra clicks here left the page hidden
  // (rAF stopped) during the last perf run, at HEAD too; cause unknown: the selection's gaps lead away before Blueprint's child sizes take their spots,
  // a gap beside the hovered box comes back with it, the Hint steps aside once the pointer rests,
  // and a box holding two or more drawn boxes shows its W × H only on hover
  const labelSpots = () => evaluate(page, `[...document.querySelector('ui-measure-root').shadowRoot.querySelectorAll('[data-label]')]
    .map((r) => ({ kind: r.dataset.label, text: r.nextElementSibling.textContent, cx: +r.getAttribute('x') + +r.getAttribute('width') / 2 }))`);
  await evaluate(page, `document.querySelector('#icon-row').scrollIntoView({ block: 'center' })`);
  const icons = await corner('#icon-row', 0, 20);
  const leftGap = { x: icons.x + 45, y: icons.y };
  await select(leftGap); // the first gap: the row itself
  await pressB();
  await mouse('mouseMoved', { x: icons.x + 500, y: icons.y - 200 });
  await poll('#icon-row in Blueprint: both gaps show next to the icons\' sizes', labelSpots, (ls) => ls.filter((l) => l.kind === 'gap' && l.text === '10').length === 2);
  const leftGapShown = (ls) => ls.some((l) => l.kind === 'gap' && Math.abs(l.cx - leftGap.x) < 2);
  await mouse('mouseMoved', leftGap);
  await poll('the pointer in the left gap: its value shows', labelSpots, leftGapShown);
  await mouse('mouseMoved', { x: icons.x + 20, y: icons.y });
  await poll('the Hint shows while the pointer moves', hintOf, Boolean);
  await poll('the pointer resting on the left icon: the Hint steps aside', hintOf, (h) => h === null, 2000);
  await poll('…and the gap beside the icon shows', labelSpots, leftGapShown);
  await mouse('mouseMoved', { x: icons.x + 21, y: icons.y });
  await poll('the Hint is back on the next move', hintOf, Boolean);
  await press('Escape', 'Escape', 27);
  await press('Escape', 'Escape', 27);
  await evaluate(page, `document.querySelector('#tab-bar').scrollIntoView({ block: 'center' })`);
  const bar = await evaluate(page, `(() => { const r = document.querySelector('#tab-bar').getBoundingClientRect(), m = document.querySelector('#tab-mid').getBoundingClientRect(); return { x: r.left + 300, y: r.bottom - 6, top: r.top, mid: m.left + m.width / 2 }; })()`);
  await select(bar); // the bar's bottom padding: the bar itself
  await pressB();
  await mouse('mouseMoved', { x: bar.x, y: bar.top - 150 });
  const tabs = await poll('#tab-bar in Blueprint: five tab sizes, none for the list holding them', labelSpots, (ls) => ls.filter((l) => l.text === '128 × 40').length === 5);
  assert.ok(!tabs.some((l) => l.text.startsWith('640 ×')), `no W × H of the list: ${JSON.stringify(tabs)}`);
  assert.ok(tabs.filter((l) => l.kind === 'size' && Math.abs(l.cx - bar.mid) < 2).every((l) => l.text === '128 × 40'), `a size centered on the middle tab is the tab's: ${JSON.stringify(tabs)}`);
  await press('Escape', 'Escape', 27);
  await press('Escape', 'Escape', 27);
  console.log('ok  crowded details: #icon-row gaps 10 10 in Blueprint, the left one with the pointer in it and resting on the icon beside it (the Hint steps aside); #tab-bar five 128 × 40, no 640 × 40');

  // Stacking (ticket 26): S with a selection shows whether its z-index applies, the stacking context it competes in and why, and what clips it
  const stackingOf = () =>
    evaluate(page, `(() => {
      const svg = document.querySelector('ui-measure-root').shadowRoot.querySelector('svg');
      const box = (r) => ['x', 'y', 'width', 'height'].map((a) => Math.round(+r.getAttribute(a))).join(',');
      const label = (part) => svg.querySelector('[data-label][data-stacking="' + part + '"]')?.nextElementSibling.textContent ?? null;
      const outline = (part) => {
        const r = svg.querySelector('[data-stacking="' + part + '"]:not([data-label])');
        return r ? { box: box(r), dash: r.getAttribute('stroke-dasharray') } : null;
      };
      const labels = (part) => [...svg.querySelectorAll('[data-label][data-stacking="' + part + '"]')].map((r) => r.nextElementSibling.textContent);
      const boxes = (part) => [...svg.querySelectorAll('[data-stacking="' + part + '"]:not([data-label])')].map(box);
      return { label: label('label'), context: label('context'), clip: label('clip'), contextBox: outline('context'), clipBox: outline('clip'), participants: labels('participant'), verdict: labels('verdict')[0] ?? null, participantBoxes: boxes('participant') };
    })()`);
  const selectedIs = async (what, selector) => {
    const want = await rectsOf([selector]);
    await poll(what, outlines, (o) => JSON.stringify(o.selected) === JSON.stringify(want));
  };
  const STACKING_HINT = 'S / Esc to exit · I styles';
  await evaluate(page, `document.querySelector('#stack-trap').scrollIntoView({ block: 'center' })`);
  await select(await corner('#stack-trap-kid', 10, 10));
  await selectedIs('select the trapped z 9999 box', '#stack-trap-kid');
  await mouse('mouseMoved', { x: 8, y: 8 });
  await poll('the Hint offers S stacking', hintOf, (h) => h?.text === SELECTION_HINT);
  await pressS();
  let st = await poll('S: z 9999, trapped by the transform parent', stackingOf, (o) => o.label === 'z 9999' && o.context === 'div.trap · transform, will-change · z 0');
  assert.deepEqual(st.contextBox, { box: (await rectsOf(['#stack-trap .trap']))[0], dash: null }, 'the context: a solid outline on div.trap');
  assert.equal(st.clip, null, 'nothing clips it');
  assert.ok((await labelTexts()).includes('140 × 60'), 'the selection keeps its W × H');
  await poll('the Hint in Stacking', hintOf, (h) => h?.text === STACKING_HINT);
  await assertLabelsApart('Stacking of #stack-trap-kid');
  // hidden while measuring, back on Alt release
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, modifiers: 1 }, page);
  await mouse('mouseMoved', { x: 8, y: 8 }, 1);
  await poll('Stacking hidden while measuring', stackingOf, (o) => o.label === null && o.contextBox === null);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18 }, page);
  await poll('Stacking back on Alt release', stackingOf, (o) => o.label === 'z 9999');
  // typing and IME composition keep it
  await evaluate(page, `document.querySelector('input').focus({ preventScroll: true })`);
  await pressS();
  await evaluate(page, 'document.activeElement.blur()');
  await evaluate(page, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', isComposing: true }))`);
  await evaluate(page, `document.querySelector('#stack-trap').scrollIntoView({ block: 'center' })`);
  await sleep(100);
  assert.equal((await stackingOf()).label, 'z 9999', 'S while typing / composing must not leave Stacking');
  // B and S switch between the two views
  await pressB();
  await poll('B in Stacking switches to Blueprint', async () => ({ s: await stackingOf(), h: (await hintOf())?.text }), (o) => o.s.label === null && o.h === 'B / Esc to exit · I styles');
  await pressS();
  await poll('S in Blueprint switches to Stacking', async () => ({ s: await stackingOf(), h: (await hintOf())?.text }), (o) => o.s.label === 'z 9999' && o.h === STACKING_HINT);
  // Esc: Styles, then Stacking, then the selection
  await pressI();
  await poll('Styles with Stacking', async () => ({ p: await stylesOf(), s: await stackingOf() }), (o) => o.p && o.s.label === 'z 9999');
  await press('Escape', 'Escape', 27);
  await poll('Esc closes Styles, Stacking stays', async () => ({ p: await stylesOf(), s: await stackingOf() }), (o) => o.p === null && o.s.label === 'z 9999');
  await press('Escape', 'Escape', 27);
  await poll('Esc leaves Stacking, the selection stays', async () => ({ s: await stackingOf(), o: await outlines() }), (o) => o.s.label === null && o.o.selected.length === 1);
  await press('Escape', 'Escape', 27);
  await poll('Esc clears the selection', outlines, (o) => o.selected.length === 0);
  console.log('ok  S: #stack-trap-kid z 9999, context div.trap · transform, will-change · z 0 (solid outline); Hint; hidden while measuring; ignored while typing / composing; S / B switch; Esc: Styles → Stacking → selection');

  // a 0 / auto tie, nothing drawn for an <html> context; a click off the selection picks the topmost box
  await evaluate(page, `document.querySelector('#stack-tie').scrollIntoView({ block: 'center' })`);
  await select(await corner('#stack-tie-b', 100, 50));
  await pressS();
  st = await poll('the later z auto box', stackingOf, (o) => o.label === 'z auto');
  assert.equal(st.contextBox, null, 'its context is <html>: nothing drawn');
  await select(await corner('#stack-tie-a', 10, 10));
  await selectedIs('a click off the selection selects the topmost box', '#stack-tie-a');
  await poll('the earlier z 0 box', stackingOf, (o) => o.label === 'z 0');

  // a negative z-index under its plain parent: click the parent again → the box below it at that point
  await evaluate(page, `document.querySelector('#stack-neg').scrollIntoView({ block: 'center' })`);
  const underParent = await corner('#stack-neg-kid', 20, 20);
  await select(underParent);
  await selectedIs('the click lands on the parent, over its z -1 child', '#stack-neg');
  await mouse('mouseMoved', underParent);
  await poll('the Hint offers the box under it', hintOf, (h) => h?.text === `${STACKING_HINT} · Click again → the box under it`);
  assert.ok(!(await labelTexts()).includes('16'), 'Stacking hides the padding values');
  // the part that sticks out is the pink box itself: hovering it says the blue box is on top because the pink one sits behind it
  const stickingOut = await evaluate(page, `(() => { const parent = document.querySelector('#stack-neg').getBoundingClientRect(); const kid = document.querySelector('#stack-neg-kid').getBoundingClientRect(); return { x: kid.right - 8, y: kid.top + kid.height / 2, outside: kid.right - 8 > parent.right }; })()`);
  assert.equal(stickingOut.outside, true, 'the pink box must stick out of its parent');
  await mouse('mouseMoved', stickingOut);
  await poll('the label says the blue box is on top because the pink one sits behind it', stackingOf, (o) => o.verdict === 'on top · z -1 is behind this box');
  await mouse('mouseMoved', underParent);
  // clear boxes between the parent and the z -1 child are not stops: one click reaches the pink box
  await click(underParent);
  await selectedIs('one click again → the pink box under the parent', '#stack-neg-kid');
  await poll('z -1, in <html>', stackingOf, (o) => o.label === 'z -1' && o.contextBox === null);
  // outside Stacking, a click on that same pink selects it directly
  await pressS();
  await select(stickingOut);
  await selectedIs('a click on the pink that sticks out selects it', '#stack-neg-kid');
  await pressS();

  // a static box: z-index does nothing, in Stacking and in Styles
  await evaluate(page, `document.querySelector('#stack-static').scrollIntoView({ block: 'center' })`);
  await select(await corner('#stack-static', 10, 10));
  await poll('static z 5', stackingOf, (o) => o.label === 'z 5 · no effect (static)');
  await pressI();
  await poll('Styles: z-index 5 does nothing', stylesOf, (p) => p?.rows.includes('z-index  5 · no effect (static)'));
  await pressI();

  // clipped by overflow: hidden, a dashed outline on its padding box
  await evaluate(page, `document.querySelector('#stack-clip').scrollIntoView({ block: 'center' })`);
  await select(await corner('#stack-clip-kid', 10, 10));
  st = await poll('clipped by its parent', stackingOf, (o) => o.clip === 'clipped by div#stack-clip · overflow hidden');
  assert.deepEqual(st.clipBox, { box: (await rectsOf(['#stack-clip']))[0], dash: '4 3' }, 'the clip: a dashed outline on #stack-clip');
  assert.equal(st.label, null, 'a plain box has no label');

  // a slotted z 9999 trapped by a transform inside a closed root
  await evaluate(page, `document.querySelector('#stack-shadow').scrollIntoView({ block: 'center' })`);
  await select(await corner('#stack-shadow-kid', 10, 10));
  st = await poll('the slotted box is trapped by the div around its slot', stackingOf, (o) => o.label === 'z 9999' && o.context === 'div · transform · z 0');
  const host = await evaluate(page, `(() => { const r = document.querySelector('#stack-shadow-host').getBoundingClientRect(); return [r.x, r.y].map(Math.round).join(','); })()`);
  assert.equal(st.contextBox.box, `${host},220,70`, 'the context outline is the shadow <div>');

  // z-index on a slotted flex item: the host is its layout parent through a bare <slot>, a <div> around the slot is not
  for (const [id, want] of [['#stack-slot-bare-kid', 'z 5'], ['#stack-slot-div-kid', 'z 5 · no effect (static)']]) {
    await evaluate(page, `document.querySelector('${id}').scrollIntoView({ block: 'center' })`);
    await select(await corner(id, 10, 10));
    await selectedIs(`select ${id}`, id);
    await poll(`${id}: ${want}`, stackingOf, (o) => o.label === want);
  }
  await pressI();
  await poll('Styles: z-index 5 does nothing under the <div> around the slot', stylesOf, (p) => p?.rows.includes('z-index  5 · no effect (static)'));
  await pressI();

  // position: fixed doesn't escape its z 1 parent
  await evaluate(page, `document.querySelector('#stack-fixed').hidden = false`);
  await select(await corner('#stack-fixed-kid', 150, 70));
  await poll('fixed z 9999 in the z 1 parent', stackingOf, (o) => o.label === 'z 9999 · fixed' && o.context === 'div.holder · z 1');
  await evaluate(page, `document.querySelector('#stack-fixed').hidden = true`);

  // the motivating case: a modal visible under a translucent backdrop
  await evaluate(page, `document.querySelector('#stack-modal').scrollIntoView({ block: 'center' })`);
  const modal = await center('#stack-modal-box');
  await select(modal);
  await selectedIs('a click on the modal lands on the backdrop', '#stack-modal-backdrop');
  await poll('the backdrop z 2', stackingOf, (o) => o.label === 'z 2');
  await click(modal);
  await selectedIs('click again → the modal below', '#stack-modal-box');
  await poll('the modal z 1', stackingOf, (o) => o.label === 'z 1');
  await click(modal);
  await selectedIs('click again → the stage below it', '#stack-modal');
  for (let i = 0; i < 8; i++) await click(modal);
  await selectedIs('the bottom: <html>', 'html');
  await click(modal);
  await selectedIs('…where it stays', 'html');
  // outside Stacking a click again still climbs; the first click after leaving selects what it hits
  await pressS();
  await select(modal);
  await selectedIs('outside Stacking: the backdrop', '#stack-modal-backdrop');
  await click(modal);
  await selectedIs('outside Stacking: click again climbs to its parent', '#stack-modal');
  await press('Escape', 'Escape', 27);
  console.log('ok  Stacking: 0 / auto tie, <html> context not drawn, a click elsewhere picks the topmost; z -1: one click from its parent, and a click on the part that sticks out; static z 5 no effect (Styles too); clipped by overflow hidden (dashed); slotted box trapped in a closed root; slotted z 5 applies through a bare <slot>, not under a <div> around it (Styles too); fixed in a z 1 parent; modal under a backdrop: click again → below, down to <html>; climbs outside Stacking');

  // Stacking pair (ticket 27): one selected element, an overlapping hover target — the two boxes that compete, and which paints on top
  const sameBoxes = (got, want) => got.length === want.length && want.every((b) => got.includes(b));
  // a participant that is the stacking context keeps that label; it already says `selector · reasons · z`
  const pairNames = (o) => [...o.participants, ...(o.context && o.contextBox && o.participantBoxes.includes(o.contextBox.box) ? [o.context] : [])];
  await evaluate(page, `document.querySelector('#stack-trap').scrollIntoView({ block: 'center' })`);
  await select(await corner('#stack-trap-kid', 8, 8));
  await pressS();
  await mouse('mouseMoved', await center('#stack-trap-over'));
  st = await poll('the z 1 box paints over the trapped z 9999', stackingOf, (o) => o.verdict === 'on top · z 1 > 0 in html' && pairNames(o).includes('div.trap · transform, will-change · z 0') && pairNames(o).includes('div#stack-trap-over · z 1'));
  assert.ok(sameBoxes(st.participantBoxes, await rectsOf(['#stack-trap .trap', '#stack-trap-over'])), `participants: ${JSON.stringify(st.participantBoxes)}`);
  await assertLabelsApart('stacking pair of #stack-trap');
  // the other way: the selection is the one on top
  await select(await center('#stack-trap-over'));
  await mouse('mouseMoved', await corner('#stack-trap-kid', 8, 8));
  await poll('the selection is on top of the trapped box', stackingOf, (o) => o.verdict === 'on top · z 1 > 0 in html' && o.label === 'z 1');

  await evaluate(page, `document.querySelector('#stack-fixed').hidden = false`);
  await evaluate(page, `document.querySelector('#stack-fixed').scrollIntoView({ block: 'center' })`);
  await select(await corner('#stack-fixed-kid', 150, 70));
  await mouse('mouseMoved', await center('#stack-fixed-over'));
  await poll('fixed z 2 paints over the z 1 parent of the fixed z 9999', stackingOf, (o) => o.verdict === 'on top · z 2 > 1 in html' && pairNames(o).includes('div.holder · z 1') && pairNames(o).includes('div#stack-fixed-over · fixed · z 2'));
  await evaluate(page, `document.querySelector('#stack-fixed').hidden = true`);

  await evaluate(page, `document.querySelector('#stack-tie').scrollIntoView({ block: 'center' })`);
  await select(await corner('#stack-tie-a', 10, 10));
  await mouse('mouseMoved', await corner('#stack-tie-b', 10, 10));
  await poll('z 0 and z auto tie, the later box on top', stackingOf, (o) => o.verdict === 'on top · tie z 0, later in tree' && pairNames(o).includes('div#stack-tie-a · z 0') && pairNames(o).includes('div#stack-tie-b · z 0'));

  await evaluate(page, `document.querySelector('#stack-modal').scrollIntoView({ block: 'center' })`);
  const modalAgain = await center('#stack-modal-box');
  await select(modalAgain);
  await click(modalAgain);
  await poll('the backdrop paints over the modal', stackingOf, (o) => o.verdict === 'on top · z 2 > 1 in html' && pairNames(o).includes('div#stack-modal-backdrop · z 2') && pairNames(o).includes('div#stack-modal-box · z 1') && o.label === 'z 1');

  await evaluate(page, `document.querySelector('#stack-static').scrollIntoView({ block: 'center' })`);
  await mouse('mouseMoved', await corner('#stack-static', 10, 10));
  await poll('no pair when the boxes do not overlap', stackingOf, (o) => o.verdict === null && o.participants.length === 0);

  await evaluate(page, `document.querySelector('#stack-trap').scrollIntoView({ block: 'center' })`);
  await select(await corner('#stack-trap .trap', 4, 4));
  await mouse('mouseMoved', await corner('#stack-trap-kid', 8, 8));
  await poll('no pair when a child simply paints over its parent', stackingOf, (o) => o.verdict === null);

  await evaluate(page, `document.querySelector('#stack-tie').scrollIntoView({ block: 'center' })`);
  await select(await corner('#stack-tie-a', 10, 10));
  await mouse('mouseMoved', await corner('#stack-tie-b', 10, 10));
  await poll('the tie pair is back, for the per-frame cost', stackingOf, (o) => o.verdict === 'on top · tie z 0, later in tree');
  const pairPerf = await perf();
  assert.ok(+pairPerf.cpu < 8 && +pairPerf.p95 < 34, `stacking pair: ${pairPerf.cpu} ms CPU per frame, p95 ${pairPerf.p95} ms (gate: < 8, < 34)`);
  console.log(`ok  Stacking pair: trap z 1 > 0 (either way), fixed z 2 > 1, tie z 0 later in tree, backdrop z 2 > 1; none when the boxes miss or a child paints over its parent; CPU ${pairPerf.cpu} ms/frame`);
  await press('Escape', 'Escape', 27);
  await press('Escape', 'Escape', 27);

  // Copy is paused. Keep this in step with `COPY` in src/core/hint.ts: the checks stay for when it is turned back on.
  const COPY = false;
  const clipboard = () => evaluate(page, 'navigator.clipboard.readText()');
  const labelsOf = (session) =>
    evaluate(session, `[...document.querySelector('ui-measure-root').shadowRoot.querySelectorAll('[data-label] + text')].map((t) => t.textContent)`);
  const pressC = (session = page) => press('c', 'KeyC', 67, 'c', 0, session);
  if (COPY) {
  // copy: C writes the last selection's spec; read back through this page, a secure origin
  await send('Browser.grantPermissions', { origin: new URL(url).origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  // readText rejects in a page without focus
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }, page);
  await evaluate(page, `document.querySelector('#bp-card').scrollIntoView({ block: 'center' })`);
  await select(await corner('#bp-card', 160, 8));
  await pressC();
  let text = await poll('CSS of #bp-card on the clipboard', clipboard, (t) => t.startsWith('/* div */\n#bp-card {'));
  // height follows the font
  assert.match(text, /^  width: 320px;\n  height: [\d.]+px;\n  box-sizing: border-box;\n  padding: 20px 24px;\n  border: 1px solid rgb\(203, 213, 225\);\n  border-radius: 20px;\n}$/m, `CSS of #bp-card:\n${text}`);
  await poll('"Copied CSS" toast', () => labelsOf(page), (l) => l.includes('Copied CSS'));
  console.log('ok  C copies the CSS of #bp-card, toast shown');
  // the toast fades out after 1.5s (reduced motion too: no movement), then is gone
  const toastOpacitiesAfterC = async (motion) => {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: motion }] }, page);
    await pressC();
    await poll('"Copied CSS" toast again', () => labelsOf(page), (l) => l.includes('Copied CSS'));
    return evaluate(page, `new Promise((done) => {
      const root = document.querySelector('ui-measure-root').shadowRoot;
      const seen = [];
      const end = performance.now() + 2200;
      const sample = () => {
        const g = [...root.querySelectorAll('[data-label] + text')].find((t) => t.textContent === 'Copied CSS')?.parentElement;
        seen.push(g ? Number(g.getAttribute('opacity') ?? 1) : 0);
        if (performance.now() < end) requestAnimationFrame(sample);
        else done(seen);
      };
      requestAnimationFrame(sample);
    })`);
  };
  for (const motion of ['no-preference', 'reduce']) {
    const seen = await toastOpacitiesAfterC(motion);
    const fading = seen.filter((o) => o > 0 && o < 1).length;
    assert.ok(seen[0] === 1 && fading >= 2 && seen.at(-1) === 0, `${motion}: toast at full, then fading (${fading} frames), then gone: ${seen.join(' ')}`);
  }
  await send('Emulation.setEmulatedMedia', { features: [] }, page);
  console.log('ok  the toast fades out, then is gone; under reduced motion too');

  await evaluate(page, 'window.scrollTo(0, 0)');
  await select(await center('.row .tile:nth-child(2)'));
  await pressC();
  text = await poll('CSS of a tile without id', clipboard, (t) => t.startsWith('/* div.tile */'));
  const selector = text.split('\n')[1].slice(0, -2);
  assert.ok(await evaluate(page, `document.querySelector(${JSON.stringify(selector)}) === document.querySelector('.row .tile:nth-child(2)')`), `copied selector ${selector} must find the element again`);
  // a page that swallows copy events: the secure page falls back to navigator.clipboard (another tile, so the text changes)
  await evaluate(page, `window.addEventListener('copy', (e) => e.stopImmediatePropagation(), true)`);
  await select(await center('.row .tile:nth-child(3)'));
  await pressC();
  await poll('CSS through navigator.clipboard', clipboard, (t) => t.startsWith('/* div.tile */') && t !== text);
  console.log(`ok  C: selector ${selector} finds the tile again; navigator.clipboard fallback`);
  }

  // scaled box model: inside a scale(0.5) parent, the hover bands must line up with the rendered boxes
  await evaluate(page, `document.querySelector('#scaled').scrollIntoView({ block: 'center' })`);
  await mouse('mouseMoved', await corner('#scaled', 6, 6)); // in its padding
  const bands = (selector) =>
    evaluate(page, `(() => {
      const svg = document.querySelector('ui-measure-root').shadowRoot.querySelector('svg');
      const rects = (part) => [...svg.querySelectorAll('[data-band="' + part + '"]')].map((r) => ['x', 'y', 'width', 'height'].map((a) => +r.getAttribute(a)));
      const edges = (rs) => rs.length === 4 && { outer: [rs[0][0], rs[0][1], rs[0][0] + rs[0][2], rs[1][1] + rs[1][3]], inner: [rs[2][0] + rs[2][2], rs[0][1] + rs[0][3], rs[3][0], rs[1][1]] };
      const box = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; };
      const el = document.querySelector(${JSON.stringify(selector)});
      return { padding: edges(rects('padding')), margin: edges(rects('margin')), box: box(el), child: box(el.firstElementChild) };
    })()`);
  const near = (a, b) => a && a.every((v, i) => Math.abs(v - b[i]) < 0.5);
  // the hover box glides in from the last element (ticket 13): settled once two reads agree
  const settled = () => {
    let before = '';
    return (o) => before === (before = JSON.stringify(o));
  };
  const scaledSettled = settled();
  const scaled = await poll('bands of #scaled', () => bands('#scaled'), (o) => o.padding && o.margin && scaledSettled(o));
  const [x1, y1, x2, y2] = scaled.box;
  assert.ok(near(scaled.padding.inner, scaled.child), `padding band inner edge must be the child's box: ${JSON.stringify(scaled)}`);
  assert.ok(near(scaled.padding.outer, [x1 + 2, y1 + 2, x2 - 2, y2 - 2]), `padding band outer edge: border 4 × 0.5: ${JSON.stringify(scaled)}`);
  assert.ok(near(scaled.margin.outer, [x1 - 8, y1 - 8, x2 + 8, y2 + 8]), `margin band: 16 × 0.5: ${JSON.stringify(scaled)}`);
  console.log('ok  bands of an element in a scale(0.5) parent match its rendered box');

  // smooth motion: the hover outline glides from tile to tile, and jumps under reduced motion
  const outlinePositionsWhileMoving = async (motion) => {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: motion }] }, page);
    await evaluate(page, `document.querySelector('.row').scrollIntoView({ block: 'center' })`);
    await mouse('mouseMoved', await center('.row .tile:nth-child(1)'));
    await sleep(300);
    await evaluate(page, `(() => {
      const root = document.querySelector('ui-measure-root').shadowRoot;
      const seen = (window.__outlines = new Set());
      const end = performance.now() + 400;
      const sample = () => {
        seen.add([...root.querySelectorAll(${HOVER_OUTLINE})].map((r) => r.getAttribute('x')).join());
        if (performance.now() < end) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    })()`);
    await mouse('mouseMoved', await center('.row .tile:nth-child(3)'));
    await sleep(500);
    return evaluate(page, 'window.__outlines.size');
  };
  const glided = await outlinePositionsWhileMoving('no-preference');
  assert.ok(glided > 3, `hover outline must pass through in-between boxes, saw ${glided} positions`);
  const jumped = await outlinePositionsWhileMoving('reduce');
  assert.ok(jumped <= 2, `reduced motion: the hover outline jumps, saw ${jumped} positions`);
  // the measurement line rides the hover outline, and snaps with it under reduced motion
  const linePositionsWhileMoving = async (motion) => {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: motion }] }, page);
    await evaluate(page, `document.querySelector('.row').scrollIntoView({ block: 'center' })`);
    await select(await center('.row .tile:nth-child(1)'));
    await sleep(300);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, modifiers: 1 }, page);
    await mouse('mouseMoved', await center('.row .tile:nth-child(2)'), 1);
    await sleep(300);
    await evaluate(page, `(() => {
      const root = document.querySelector('ui-measure-root').shadowRoot;
      const seen = (window.__lines = new Set());
      const end = performance.now() + 400;
      const sample = () => {
        seen.add([...root.querySelectorAll('[data-line="measurement"]')].map((p) => p.getAttribute('d')).join('|'));
        if (performance.now() < end) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    })()`);
    await mouse('mouseMoved', await center('.row .tile:nth-child(3)'), 1);
    await sleep(500);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18 }, page);
    return evaluate(page, 'window.__lines.size');
  };
  const lineGlided = await linePositionsWhileMoving('no-preference');
  assert.ok(lineGlided > 3, `measurement line must pass through in-between positions, saw ${lineGlided}`);
  const lineJumped = await linePositionsWhileMoving('reduce');
  assert.ok(lineJumped <= 2, `reduced motion: the measurement line jumps, saw ${lineJumped}`);
  await send('Emulation.setEmulatedMedia', { features: [] }, page);
  await press('Escape', 'Escape', 27);
  console.log(`ok  hover outline glides through ${glided} positions; ${jumped} under reduced motion`);
  console.log(`ok  measurement line glides through ${lineGlided} positions; ${lineJumped} under reduced motion`);

  // CSS zoom 1.5: labels show CSS px, outlines and bands stay on the rendered (zoomed) boxes
  const redLabels = () =>
    evaluate(page, `[...document.querySelector('ui-measure-root').shadowRoot.querySelectorAll('[data-label="measurement"] + text')].map((t) => t.textContent)`);
  const hoverOutlines = () =>
    evaluate(page, `[...document.querySelector('ui-measure-root').shadowRoot.querySelectorAll(${HOVER_OUTLINE})].map((r) => ['x', 'y', 'width', 'height'].map((a) => Math.round(+r.getAttribute(a))).join(','))`);

  // an input with no background or border still draws its value: it is the hover target, not the card behind it
  await evaluate(page, `document.querySelector('#clear-input').scrollIntoView({ block: 'center' })`);
  await mouse('mouseMoved', await center('#clear-input'));
  const [clearInputRect] = await rectsOf(['#clear-input']);
  await poll('hover outline is the clear input', hoverOutlines, (o) => o.includes(clearInputRect));
  await mouse('mouseMoved', await center('#ph-input'));
  const [phRect] = await rectsOf(['#ph-input']);
  await poll('hover outline is the placeholder input', hoverOutlines, (o) => o.includes(phRect));
  console.log('ok  a clear input (no background, no border) is the hover target, not the card behind it');

  // the navy pill is not the element's own background: a ::before, or a layer that ignores the pointer
  await evaluate(page, `document.querySelector('#today-tab').scrollIntoView({ block: 'center' })`);
  const [todayRect] = await rectsOf(['#today-tab']);
  await mouse('mouseMoved', await corner('#today-tab', 8, 20));
  await poll('Today padding: the tab, not the bar', hoverOutlines, (o) => o.includes(todayRect));
  await mouse('mouseMoved', await center('#today-tab span'));
  await poll('Today word: the tab, not the word', hoverOutlines, (o) => o.includes(todayRect));
  await evaluate(page, `document.querySelector('#seg').scrollIntoView({ block: 'center' })`);
  const [thumbRect] = await rectsOf(['#seg-thumb']);
  await mouse('mouseMoved', await corner('#seg-today', 8, 20));
  await poll('sliding pill padding: the pill, not the switch', hoverOutlines, (o) => o.includes(thumbRect));
  await mouse('mouseMoved', await center('#seg-today span'));
  await poll('sliding pill word: the pill, not the word', hoverOutlines, (o) => o.includes(thumbRect));
  console.log('ok  Today: a ::before fill and a pointer-events:none pill are the hover target');

  await evaluate(page, `document.querySelector('#zoomed').scrollIntoView({ block: 'center' })`);
  const zoomTile = '#zoomed > .tile';
  await mouse('mouseMoved', await center(zoomTile));
  const [zoomTileRect] = await rectsOf([zoomTile]);
  await poll('zoomed tile: rendered outline, CSS size', async () => ({ o: await hoverOutlines(), l: await labelsOf(page) }), ({ o, l }) => o.includes(zoomTileRect) && l.includes('120 × 60'));
  await mouse('mouseMoved', await corner('#zoom-card', 6, 6)); // in its padding
  await poll('zoomed card size in CSS px', () => labelsOf(page), (l) => l.includes('144 × 44'));
  const zoomedSettled = settled();
  const zoomed = await poll('bands of #zoom-card', () => bands('#zoom-card'), (o) => o.padding && zoomedSettled(o));
  const [zx1, zy1, zx2, zy2] = zoomed.box;
  assert.ok(near(zoomed.padding.inner, zoomed.child), `zoomed padding band inner edge must be the child's box: ${JSON.stringify(zoomed)}`);
  assert.ok(near(zoomed.padding.outer, [zx1 + 3, zy1 + 3, zx2 - 3, zy2 - 3]), `zoomed padding band outer edge: border 2 × 1.5: ${JSON.stringify(zoomed)}`);
  await select(await center(zoomTile));
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, modifiers: 1 }, page);
  await mouse('mouseMoved', await corner('#zoom-card', 6, 6), 1);
  await poll('Alt-measure across the zoomed gap: 24, not 36', redLabels, (l) => l.includes('24') && !l.includes('36'));
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18 }, page);
  await click(await center(zoomTile)); // the selected tile again: its parent #zoomed
  await mouse('mouseMoved', await corner('#zoomed', 250, 80)); // below the shorter card: the container itself
  await poll('zoomed flex gap 24', gapLabels, (g) => JSON.stringify(g) === '["24"]');
  await select(await corner('#zoom-card', 6, 6));
  await pressB();
  // the hint at the pointer covers the top-left radius label: move below the card
  await mouse('mouseMoved', await corner('#zoomed', 250, 80));
  await poll('blueprint of #zoom-card in CSS px', blueprint, (o) => ['10', '20', 'r 12'].every((t) => o.labels.includes(t)));
  await pressB();
  // with the other Copy checks: `text` there is block-scoped, and readText needs the grant above
  if (COPY) {
    await pressC();
    const zoomCss = await poll('CSS of #zoom-card', clipboard, (t) => t.startsWith('/* div */\n#zoom-card {'));
    assert.match(zoomCss, /^  width: 144px;\n  height: 44px;\n  box-sizing: border-box;\n  padding: 10px 20px;\n  border: 2px solid [^;]+;\n  border-radius: 12px;\n}$/m, `CSS of #zoom-card:\n${zoomCss}`);
  }
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

  // small distances at DPR 1: half a device pixel or less is touching, so 0.25 is not drawn; a 1px spacing's label sits beside its line
  await poll('DPR 1 after browser zoom', () => evaluate(page, 'devicePixelRatio'), (r) => r === 1);
  await evaluate(page, `document.querySelector('#tiny').scrollIntoView({ block: 'center' })`);
  const redNumbers = async () => (await redLabels()).filter((t) => t !== CHIP);
  const measureTiny = async (id) => {
    const [ta, tb] = [`#${id} > .tile:nth-child(1)`, `#${id} > .tile:nth-child(2)`];
    await select(await center(ta));
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, modifiers: 1 }, page);
    await mouse('mouseMoved', await center(tb), 1);
    // positive proof first: measuring, with the hover target on the second tile
    const [tbRect] = await rectsOf([tb]);
    await poll(`${id}: measuring onto the second tile`, async () => ({ o: await overlay(), h: await hoverOutlines() }), ({ o, h }) => o.chip === CHIP && h.includes(tbRect));
  };
  const altUp = () => send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18 }, page);
  await measureTiny('tiny-1');
  await poll('1px spacing labelled', redNumbers, (l) => JSON.stringify(l) === '["1"]');
  await poll('1px spacing line settled', linePaths, linesSettled);
  const onLine = await evaluate(page, `(() => {
    const root = document.querySelector('ui-measure-root').shadowRoot;
    const [x1, y1, x2, y2] = root.querySelector('[data-line="measurement"]').getAttribute('d').match(/-?[\\d.]+/g).map(Number);
    const r = [...root.querySelectorAll('[data-label="measurement"]')].find((r) => r.nextElementSibling?.textContent === '1');
    const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((a) => +r.getAttribute(a));
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    return { line: [x1, y1, x2, y2], label: [x, y, w, h], covers: mx >= x && mx <= x + w && my >= y && my <= y + h };
  })()`);
  assert.equal(onLine.covers, false, `the 1px spacing's label must sit beside its line: ${JSON.stringify(onLine)}`);
  await altUp();
  await measureTiny('tiny-025');
  assert.deepEqual([(await overlay()).lines, await redNumbers()], [0, []], '0.25px spacing at DPR 1: touching, no line or label');
  await altUp();
  console.log('ok  small distances at DPR 1: 0.25 spacing not drawn, 1px spacing labelled beside its line');

  // shadow roots, open and closed (chrome.dom.openOrClosedShadowRoot): select, climb and type inside them
  await press('Escape', 'Escape', 27);
  for (const mode of ['open', 'closed']) {
    await evaluate(page, `document.querySelector('#shadow-${mode}').scrollIntoView({ block: 'center' })`);
    const inRoot = (sel) =>
      evaluate(page, `(() => { const r = (${JSON.stringify(sel)} ? window.shadowRoots.${mode}.querySelector(${JSON.stringify(sel)}) : document.querySelector('#shadow-${mode}')).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, rect: [r.x, r.y, r.width, r.height].map(Math.round).join(',') }; })()`);
    const [t1, input, host] = await Promise.all(['div:nth-of-type(1)', 'input', ''].map(inRoot));
    await select(t1);
    await poll(`${mode} root: click selects the inner tile`, outlines, (o) => JSON.stringify(o.selected) === JSON.stringify([t1.rect]));
    assert.ok((await labelsOf(page)).includes('60 × 40'), `${mode} root: inner tile size label`);
    await click(t1);
    await poll(`${mode} root: click again → host`, outlines, (o) => JSON.stringify(o.selected) === JSON.stringify([host.rect]));
    await mouse('mouseMoved', { x: host.x, y: host.y + 26 }); // the host's bottom padding, under the tiles
    await poll(`${mode} root: gaps of the host`, gapLabels, (g) => JSON.stringify(g) === '["12","12"]');
    // the input's own (user-agent) shadow root is not entered
    await mouse('mouseMoved', input);
    await poll(`${mode} root: hover outline is the input`, hoverOutlines, (o) => o.includes(input.rect));
    await evaluate(page, `window.shadowRoots.${mode}.querySelector('input').focus({ preventScroll: true })`);
    await pressB();
    assert.equal(await evaluate(page, `window.shadowRoots.${mode}.querySelector('input').value`), 'b', `${mode} root: typed B must reach the input`);
    assert.equal((await blueprint()).boxes, null, `${mode} root: B while typing must not start blueprint`);
    await evaluate(page, `window.shadowRoots.${mode}.querySelector('input').blur()`);
    await press('Escape', 'Escape', 27);
    console.log(`ok  ${mode} shadow root: click selects the inner tile, click again → host, host gaps 12 12, typing in its input kept`);
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
    await poll(`hover outline inside the ${what}`, () => evaluate(page, `[...document.querySelector('ui-measure-root').shadowRoot.querySelectorAll(${HOVER_OUTLINE})].map((r) => ['x', 'y', 'width', 'height'].map((a) => Math.round(+r.getAttribute(a))).join(','))`), (o) => o.includes(want));
    // Stacking: inside, the top-layer box is the context; click again → it, in the top layer
    await select(await center(inner));
    await pressS();
    const box = what === 'dialog' ? 'dialog' : 'div#pop';
    await poll(`Stacking inside the ${what}`, stackingOf, (o) => o.context === `${box} · top layer`);
    await click(await center(inner));
    await poll(`click again → the ${what}: top layer`, stackingOf, (o) => o.label === `top layer (${what})` && o.contextBox === null);
    await press('Escape', 'Escape', 27);
    await press('Escape', 'Escape', 27);
    // an open modal makes the rest of the page inert
    await evaluate(page, close);
    console.log(`ok  ${what} opened while ON: overlay re-promoted above it, hover measures inside; Stacking inside names it as the top-layer context, click again → top layer (${what})`);
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
        hover: [...svg.querySelectorAll(${HOVER_OUTLINE})].map(box),
        selected: [...svg.querySelectorAll('[data-outline="selected"]')].map(box),
        measure: [...svg.querySelectorAll('[data-label] + text')].map((t) => t.textContent),
      };
    })()`);
  const topHover = () => evaluate(page, `document.querySelector('ui-measure-root').shadowRoot.querySelectorAll(${HOVER_OUTLINE}).length`);
  const t1 = await inFramePoint('#frame-same', '.tile:nth-child(1)');
  const t2 = await inFramePoint('#frame-same', '.tile:nth-child(2)');
  await mouse('mouseMoved', t1);
  await poll('hover outline inside the same-origin frame', () => frameOutlines('#frame-same'), (o) => o.hover.includes(t1.rect));
  await poll('no stale hover box in the top frame', topHover, (n) => n === 0);
  assert.equal(await hintOf(), null, 'no hint in the top frame while the pointer is inside a frame');
  assert.equal((await inFrame('#frame-same', `document.querySelector('ui-measure-root').shadowRoot.querySelector('[data-hint]')?.children[0].textContent`)), 'Click', 'the frame draws its own hint');
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
  if (COPY) {
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
  const httpCss = await poll('CSS copied on http', clipboard, (t) => t.startsWith('/* div.tile */'));
  await poll('"Copied CSS" toast on http', () => labelsOf(httpPage), (l) => l.includes('Copied CSS'));
  // a page that swallows copy events leaves no path on http: the toast says so
  await evaluate(httpPage, `window.addEventListener('copy', (e) => e.stopImmediatePropagation(), true)`);
  await select(await center('.row .tile:nth-child(3)', httpPage), httpPage);
  await pressC(httpPage);
  await poll('clipboard error toast', () => labelsOf(httpPage), (l) => l.some((t) => t.startsWith('Copy failed')));
  assert.equal(await clipboard(), httpCss, 'a failed copy must leave the clipboard alone');
  await send('Target.closeTarget', { targetId: httpTarget });
  console.log('ok  copy works on http; clear message when the clipboard is unavailable');
  }

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
    return evaluate(cross2, `[...document.querySelector('ui-measure-root').shadowRoot.querySelectorAll(${HOVER_OUTLINE})].map((r) => ['x', 'y', 'width', 'height'].map((a) => Math.round(+r.getAttribute(a))).join(','))`);
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
