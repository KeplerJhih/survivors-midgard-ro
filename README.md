# Midgard Survivors Helper

Midgard Survivors 網頁版（https://midgardsurvivors.com/play/）的 Chrome 擴充套件：

- **模擬 iPhone**：通過網頁版的 iOS 判斷，進入觸控介面（虛擬搖桿）
- **滑鼠轉觸控**：手機模式下用滑鼠拖曳操作虛擬搖桿
- **背景持續執行**：切到其他分頁時遊戲不會停
- **掛機**：自動走位（8 字形 / 繞圈）、自動選升級卡、MVP 後自動走回地圖，可選自動按 Enter

## 安裝（不需要 Node）

repo 內已附上編譯好的外掛 `output/`：

1. 下載或 clone 這個 repo
2. Chrome 開 `chrome://extensions`，打開右上角「開發人員模式」
3. 「載入未封裝項目」→ 選 `output` 資料夾
4. 開啟 https://midgardsurvivors.com/play/ ，點外掛圖示調整設定

更新：`git pull` 後按 popup 的「🔄 重新載入外掛（不刷新遊戲）」。

## 開發

需要 Node 22（`nvm use`）。

```bash
npm install
npm run dev        # 開啟載入外掛的 Chrome，改 code 自動重載
npm test           # 單元測試（Vitest + jsdom）
npm run typecheck
npm run build      # 產出 output/（有進版控，改完 code 記得 build 再 commit；npm run dev 也會寫到這裡，commit 前要再 build 一次）
```

第一次載入後，之後每次 `npm run build` 完，按 popup 的「🔄 重新載入外掛（不刷新遊戲）」即可套用新版掛機邏輯；「模擬 iPhone」「背景持續執行」的程式改動仍需重新整理遊戲頁。

## 結構

```
src/core/            純邏輯，不依賴 chrome.* API，可單獨測試
  input/keyboard     送合成 KeyboardEvent（帶 key / code / keyCode）
  movement/          走位策略（純函式：經過時間 → 方向鍵）
  vision/            畫面辨識（canvas 取樣、MVP 傳送門）
  bot/               掛機主迴圈
  spoof/mobile       iPhone 偽裝（UA、platform、maxTouchPoints、matchMedia）
  touch/             滑鼠 → 觸控事件
  background/        背景執行：接管 rAF + Worker 時脈
  debug/overlay      debug 面板
src/entrypoints/     WXT 外掛殼
  background         依設定動態註冊 document_start 腳本（mobile、keepalive）
  mobile.content     MAIN world、document_start：iPhone 偽裝
  keepalive.content  MAIN world、document_start：背景執行
  bridge.content     ISOLATED world：把 chrome.storage 設定轉送給 MAIN world
  bot.content        MAIN world：掛機、滑鼠轉觸控、debug 面板
  popup/             設定介面
tests/unit/          單元測試
```

## 文件

- [docs/MECHANICS.md](docs/MECHANICS.md)：遊戲機制（輸入、觸控、背景執行、MVP、撿取、反作弊）
- [docs/FEATURES.md](docs/FEATURES.md)：功能開關、優化紀錄、待辦

## Debug

- popup 勾「Debug 面板與 log」：遊戲左下角顯示狀態，console 以 `[MSBot]` 過濾
- DevTools console：`__msbot.bot.state`、`__msbot.settings`、`__msKeepAlive.pendingCount()`
- `__msbot.reloadExtension()`：從遊戲頁載入最新 build 並重新注入（不刷新遊戲），等同 popup 的重新載入按鈕

## 注意

- 「模擬 iPhone」「背景持續執行」改完要重新整理遊戲頁
- 自動按 Enter 在城鎮會開啟世界聊天，只在對局中使用
- 背景執行靠 Worker 時脈；Chrome 的「省記憶體模式」仍可能捨棄閒置分頁，建議把網站加入例外
