import type { Browser } from 'wxt/browser';
import { isMessage, isStatusReply, type Message } from '../messages';
import { theme } from '../overlay/theme';

const TITLE_OFF = 'UI Measure: OFF (Alt+Shift+M)';
const TITLE_ON = 'UI Measure: ON (Alt+Shift+M or Esc to turn off)';
const FRAMES_MENU = 'measure-cross-origin-frames';
const CONTENT_SCRIPT = '/content-scripts/measure.js';

function showState(tabId: number, state: 'on' | 'off' | 'blocked') {
  const [text, title] =
    state === 'on' ? ['ON', TITLE_ON] : state === 'off' ? ['', TITLE_OFF] : ['!', 'UI Measure cannot run on this page'];
  void browser.action.setBadgeText({ tabId, text });
  void browser.action.setTitle({ tabId, title });
}

/** Asks the top frame's content script; throws when none is injected. */
async function send(tabId: number, message: Message): Promise<boolean> {
  const reply: unknown = await browser.tabs.sendMessage(tabId, message, { frameId: 0 });
  return isStatusReply(reply) && reply.on;
}

/** Every frame with the content script gets it; fine when none has it. */
const broadcast = (tabId: number, message: Message) => browser.tabs.sendMessage(tabId, message).catch(() => undefined);

// serialized by executeScript, so self-contained: the frame's origin and its child frames' (src, not where they navigated since)
function probeFrame() {
  const origin = (url: string) => {
    try {
      const u = new URL(url);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
    } catch {
      return null;
    }
  };
  return {
    self: origin(location.href),
    children: [...document.querySelectorAll<HTMLIFrameElement | HTMLFrameElement>('iframe, frame')].map((f) => origin(f.src)),
  };
}

/** `http://localhost/*` for `http://localhost:3000`: Chrome match patterns without a port match every port. */
const hostPattern = (origin: string) => {
  const { protocol, hostname } = new URL(origin);
  return `${protocol}//${hostname}/*`;
};

// cross-origin frames the last turn-on could not reach, per tab: what the icon's menu item asks for.
// shortcut: lost when MV3 stops the worker; keep it in storage.session if users hit that often.
const unreached = new Map<number, string[]>();

// A second click during the first injection would inject twice and leave a stray overlay.
const pending = new Set<number>();

function guarded(tabId: number, run: () => Promise<unknown>) {
  if (pending.has(tabId)) return;
  pending.add(tabId);
  void run().finally(() => pending.delete(tabId));
}

function toggle(tab: Browser.tabs.Tab | undefined) {
  const tabId = tab?.id;
  if (tabId !== undefined) guarded(tabId, () => toggleTab(tabId));
}

async function toggleTab(tabId: number) {
  const on = await send(tabId, { type: 'STATUS' }).catch(() => false);
  if (!on) return turnOn(tabId);
  await turnOff(tabId);
}

async function turnOff(tabId: number) {
  unreached.delete(tabId);
  await broadcast(tabId, { type: 'OFF' });
  showState(tabId, 'off');
}

// A newer injection into a frame replaces the older one (WXT invalidates its context), also one orphaned by an extension reload.
// shortcut: frames added or navigated later stay off until the next turn-on; watch webNavigation if pages need it (install warning).
async function turnOn(tabId: number) {
  try {
    await browser.scripting.executeScript({ target: { tabId, allFrames: true }, files: [CONTENT_SCRIPT] });
    showState(tabId, 'on');
  } catch {
    showState(tabId, 'blocked'); // chrome://, Web Store, PDF viewer...
    return;
  }
  await findUnreached(tabId).catch(() => undefined);
}

async function findUnreached(tabId: number) {
  const frames = await browser.scripting.executeScript({ target: { tabId, allFrames: true }, func: probeFrame });
  const reached = new Set(frames.map((f) => f.result?.self));
  const missing = [...new Set(frames.flatMap((f) => f.result?.children ?? []))].filter((o): o is string => o !== null && !reached.has(o));
  // granted but still unreached (the frame navigated to another host): asking again would not help
  const granted = await Promise.all(missing.map((o) => browser.permissions.contains({ origins: [hostPattern(o)] })));
  const ask = missing.filter((_, i) => !granted[i]);
  if (ask.length === 0) {
    unreached.delete(tabId);
    return;
  }
  unreached.set(tabId, ask);
  const hosts = [...new Set(ask.map((o) => new URL(o).host))];
  // a label wider than the viewport is hidden, and this toast is the only pointer to the menu
  const named = hosts.length > 2 ? `${hosts.slice(0, 2).join(', ')} +${hosts.length - 2}` : hosts.join(', ');
  void send(tabId, { type: 'NOTICE', text: `Right-click the icon → Measure cross-origin frames (${named})` }).catch(() => false);
}

/** After the menu's grant: injects only the frames it opened, so the frames already on keep their selection. */
async function injectGranted(tabId: number, origins: string[]) {
  const frames = await browser.scripting.executeScript({ target: { tabId, allFrames: true }, func: probeFrame });
  const frameIds = frames.filter((f) => f.result?.self && origins.includes(f.result.self)).map((f) => f.frameId);
  if (frameIds.length > 0) await browser.scripting.executeScript({ target: { tabId, frameIds }, files: [CONTENT_SCRIPT] });
  await findUnreached(tabId);
}

export default defineBackground(() => {
  void browser.action.setBadgeBackgroundColor({ color: theme.badge });

  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({ id: FRAMES_MENU, title: 'Measure cross-origin frames', contexts: ['action'] });
  });
  browser.contextMenus.onClicked.addListener((info, tab) => {
    const tabId = tab?.id;
    const origins = tabId === undefined ? undefined : unreached.get(tabId);
    if (info.menuItemId !== FRAMES_MENU || tabId === undefined) return;
    if (!origins) {
      void send(tabId, { type: 'NOTICE', text: 'Nothing to allow: no unreached cross-origin frames known (turn the tool off and on to look again)' }).catch(() => false);
      return;
    }
    // before any await: permissions.request needs the menu click's user gesture
    const asked = browser.permissions.request({ origins: origins.map(hostPattern) }).catch(() => false);
    guarded(tabId, async () => {
      if (await asked) await injectGranted(tabId, origins).catch(() => undefined);
    });
  });

  browser.action.onClicked.addListener(toggle);
  browser.commands.onCommand.addListener((command, tab) => {
    if (command === 'toggle-measure') toggle(tab);
  });

  // Esc in any frame turned that frame off: the rest of the tab follows
  browser.runtime.onMessage.addListener((msg: unknown, sender) => {
    const tabId = sender.tab?.id;
    if (isMessage(msg) && msg.type === 'OFF' && tabId !== undefined) void turnOff(tabId);
  });

  // Badge state lives in the tab, not in this worker (MV3 may stop it at any time): after a
  // page load ask the tab again. A real navigation drops the content script, SPA routing keeps it.
  browser.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status !== 'complete') return;
    send(tabId, { type: 'STATUS' }).then(
      (on) => showState(tabId, on ? 'on' : 'off'),
      () => {
        unreached.delete(tabId);
        showState(tabId, 'off');
      },
    );
  });
});
