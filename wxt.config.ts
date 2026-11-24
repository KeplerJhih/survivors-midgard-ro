import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'Midgard Survivors Helper',
    description: '手機模擬 + 掛機輔助（Midgard Survivors 網頁版）',
    permissions: ['storage', 'scripting'],
    host_permissions: ['https://midgardsurvivors.com/*'],
  },
});
