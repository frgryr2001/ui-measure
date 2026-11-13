import ReactDOM from 'react-dom/client';
import { isMessage, type Message, type StatusReply } from '../messages';
import { startController } from '../overlay/controller';
import { Overlay } from '../overlay/Overlay';

// Fills the viewport above everything, including modal <dialog>s and popovers (top layer), and
// lets the pointer through to the page.
const HOST_STYLE =
  'position:fixed;inset:0;width:100vw;height:100vh;max-width:none;max-height:none;' +
  'margin:0;border:0;padding:0;background:transparent;overflow:visible;pointer-events:none;' +
  'z-index:2147483647;color-scheme:normal';

export default defineContentScript({
  // injected by the background worker via scripting.executeScript; no `matches`, so no host permissions
  registration: 'runtime',
  async main(ctx) {
    let stop: (() => void) | null = null;
    let notify: ((text: string) => void) | null = null;

    const ui = await createShadowRootUi(ctx, {
      name: 'ui-measure-root',
      position: 'inline',
      // shortcut: a `zoom` on <html> itself also zooms the host, so the overlay draws off; set the host's zoom to its inverse if such pages matter.
      anchor: 'html',
      // WXT's default `:host{all:initial !important}` would wipe HOST_STYLE
      inheritStyles: true,
      onMount(container, _shadow, host) {
        host.setAttribute('style', HOST_STYLE);
        host.setAttribute('popover', 'manual');
        if (!host.matches(':popover-open')) host.showPopover();
        // a dialog or popover the page opens later stacks above the host: hide + show moves it back on top
        // shortcut: toggle doesn't leave a shadow root, so dialogs and popovers inside one still cover the overlay, and dialogs fire toggle only since Chrome 132; check per frame if pages need it.
        const topLayer = new AbortController();
        document.addEventListener('toggle', (e) => {
          if (e.target !== host && e.target instanceof Element && e.target.matches(':modal, :popover-open')) {
            host.hidePopover();
            host.showPopover();
          }
        }, { capture: true, signal: topLayer.signal });
        const root = ReactDOM.createRoot(container);
        const controller = startController({
          host,
          // reaches closed shadow roots of the page; only HTML elements can host one
          shadowOf: (el) => (el instanceof HTMLElement ? browser.dom.openOrClosedShadowRoot(el) : null),
          onFrame: (frame) => root.render(<Overlay frame={frame} />),
          onExit: () => {
            turnOff();
            void browser.runtime.sendMessage({ type: 'OFF' } satisfies Message);
          },
        });
        notify = controller.notify;
        stop = () => {
          topLayer.abort();
          controller.stop();
        };
        return root;
      },
      onRemove(root) {
        stop?.();
        stop = null;
        notify = null;
        root?.unmount();
      },
    });

    const isOn = () => stop !== null;
    const turnOff = () => ui.remove();

    // the worker turns the tool on by injecting this script, so each frame only hears OFF, STATUS and NOTICE
    const onMessage = (msg: unknown, _sender: unknown, sendResponse: (reply: StatusReply) => void) => {
      if (!isMessage(msg)) return;
      if (msg.type === 'OFF') turnOff();
      if (msg.type === 'NOTICE') notify?.(msg.text);
      sendResponse({ on: isOn() });
    };
    browser.runtime.onMessage.addListener(onMessage);
    // a newer injection into this frame invalidates this context, and WXT removes its UI
    ctx.onInvalidated(() => browser.runtime.onMessage.removeListener(onMessage));

    ui.mount();
  },
});
