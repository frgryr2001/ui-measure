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
    // no default_popup, otherwise action.onClicked never fires
    action: { default_title: 'UI Measure: OFF (Alt+Shift+M)' },
    commands: {
      'toggle-measure': {
        suggested_key: { default: 'Alt+Shift+M' },
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
