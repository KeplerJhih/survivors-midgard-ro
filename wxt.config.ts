import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  // 輸出到非隱藏資料夾、且不再多一層 chrome-mv3：
  // chrome://extensions「載入未封裝項目」直接選 output/ 即可
  outDir: 'output',
  outDirTemplate: '',
  manifest: {
    name: 'Midgard Survivors Helper',
    description: '手機模擬 + 掛機輔助（Midgard Survivors 網頁版）',
    permissions: ['storage', 'scripting'],
    host_permissions: ['https://midgardsurvivors.com/*'],
  },
});
