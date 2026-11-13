import ReactDOM from 'react-dom/client';
import { isMessage, type Message, type StatusReply } from '../messages';
import { startController } from '../overlay/controller';
import { Overlay } from '../overlay/Overlay';

// Fills the viewport above everything, including modal <dialog>s (top layer), and lets the
// pointer through to the page.
const HOST_STYLE =
  'position:fixed;inset:0;width:100vw;height:100vh;max-width:none;max-height:none;' +
  'margin:0;border:0;padding:0;background:transparent;overflow:visible;pointer-events:none;' +
  'z-index:2147483647;color-scheme:normal';

export default defineContentScript({
  // injected by the background worker via scripting.executeScript; no `matches`, so no host permissions
  registration: 'runtime',
  async main(ctx) {
    let stop: (() => void) | null = null;

    const ui = await createShadowRootUi(ctx, {
      name: 'ui-measure-root',
      position: 'inline',
      anchor: 'html',
      // WXT's default `:host{all:initial !important}` would wipe HOST_STYLE
      inheritStyles: true,
      onMount(container, _shadow, host) {
        host.setAttribute('style', HOST_STYLE);
        host.setAttribute('popover', 'manual');
        if (!host.matches(':popover-open')) host.showPopover();
        const root = ReactDOM.createRoot(container);
        stop = startController({
          host,
          onFrame: (frame) => root.render(<Overlay frame={frame} />),
          onExit: () => {
            turnOff();
            void browser.runtime.sendMessage({ type: 'OFF' } satisfies Message);
          },
        });
        return root;
      },
      onRemove(root) {
        stop?.();
        stop = null;
        root?.unmount();
      },
    });

    const isOn = () => stop !== null;
    const turnOff = () => ui.remove();

    browser.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
      if (!isMessage(msg)) return;
      if (msg.type === 'TOGGLE') {
        if (isOn()) turnOff();
        else ui.mount();
      }
      sendResponse({ on: isOn() } satisfies StatusReply);
    });

    ui.mount();
  },
});
