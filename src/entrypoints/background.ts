import type { Browser } from 'wxt/browser';
import { isMessage, isStatusReply, type Message } from '../messages';

const TITLE_OFF = 'UI Measure: OFF (Alt+Shift+M)';
const TITLE_ON = 'UI Measure: ON (Alt+Shift+M or Esc to turn off)';

function showState(tabId: number, state: 'on' | 'off' | 'blocked') {
  const [text, title] =
    state === 'on' ? ['ON', TITLE_ON] : state === 'off' ? ['', TITLE_OFF] : ['!', 'UI Measure cannot run on this page'];
  void browser.action.setBadgeText({ tabId, text });
  void browser.action.setTitle({ tabId, title });
}

/** Asks the tab's content script; throws when none is injected. */
async function send(tabId: number, message: Message): Promise<boolean> {
  const reply: unknown = await browser.tabs.sendMessage(tabId, message, { frameId: 0 });
  return isStatusReply(reply) && reply.on;
}

// A second click during the first injection would inject twice and leave a stray overlay.
const pending = new Set<number>();

async function toggle(tab: Browser.tabs.Tab | undefined) {
  const tabId = tab?.id;
  if (tabId === undefined || pending.has(tabId)) return;
  pending.add(tabId);
  try {
    await toggleTab(tabId);
  } finally {
    pending.delete(tabId);
  }
}

async function toggleTab(tabId: number) {
  try {
    showState(tabId, (await send(tabId, { type: 'TOGGLE' })) ? 'on' : 'off');
    return;
  } catch {
    // not injected yet
  }
  try {
    await browser.scripting.executeScript({ target: { tabId }, files: ['/content-scripts/measure.js'] });
    showState(tabId, 'on');
  } catch {
    showState(tabId, 'blocked'); // chrome://, Web Store, PDF viewer...
  }
}

export default defineBackground(() => {
  void browser.action.setBadgeBackgroundColor({ color: '#f24822' });

  browser.action.onClicked.addListener(toggle);
  browser.commands.onCommand.addListener((command, tab) => {
    if (command === 'toggle-measure') void toggle(tab);
  });

  browser.runtime.onMessage.addListener((msg: unknown, sender) => {
    const tabId = sender.tab?.id;
    if (isMessage(msg) && msg.type === 'OFF' && tabId !== undefined) showState(tabId, 'off');
  });

  // Badge state lives in the tab, not in this worker (MV3 may stop it at any time): after a
  // page load ask the tab again. A real navigation drops the content script, SPA routing keeps it.
  browser.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status !== 'complete') return;
    send(tabId, { type: 'STATUS' }).then(
      (on) => showState(tabId, on ? 'on' : 'off'),
      () => showState(tabId, 'off'),
    );
  });
});
