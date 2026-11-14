import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'UI Measure',
    description: 'Measure size and spacing of elements on any web page',
    // none warns at install: activeTab + scripting inject on turn-on; cross-origin frames ask for their host from the icon's menu
    permissions: ['activeTab', 'scripting', 'contextMenus'],
    optional_host_permissions: ['<all_urls>'],
    // no default_popup, otherwise action.onClicked never fires; the worker adds the bound shortcut to the title
    action: { default_title: 'UI Measure: OFF' },
    commands: {
      'toggle-measure': {
        // not Alt+Shift (Windows switches the input language on it); E is free with Ctrl/Cmd+Shift in Chrome and the OSes
        suggested_key: { default: 'Ctrl+Shift+E', mac: 'Command+Shift+E' },
        description: 'Toggle measure mode',
      },
    },
  },
  // 3000 is taken by another local project; the dev extension would talk to the wrong server
  dev: { server: { port: 4320, strictPort: true } },
  webExt: {
    // `pnpm playground` serves the fixture page here
    startUrls: ['http://localhost:4319'],
  },
});
