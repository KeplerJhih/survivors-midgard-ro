# 遊戲機制（掛機相關）

> 來源：Midgard Survivors v0.2.10 主資料包反編譯（`scripts/` 下的 GDScript）＋ 實機觀察。
> 遊戲改版後行號可能變動，以函式名搜尋為準。

## 輸入

| 動作 | 按鍵 | 讀取方式 | 來源 |
|---|---|---|---|
| 移動 | WASD / 方向鍵 | InputMap `physical_keycode` → 合成事件要帶 `code`（`KeyW`） | `autoload/game_data.gd` `_setup_input()` |
| 升級選卡 | 1~4 | 邏輯 `keycode`；只在 `level_up` 視窗、開窗約 1 秒後有效 | `ui/menus.gd` `show_level_up` |
| 寶箱繼續 / 全部販賣 | Enter / F | 視窗預設焦點 / `_chest_sell` | `ui/menus.gd` |
| 重抽 / 放逐 | R / B | 選卡視窗內 | `ui/menus.gd` |
| 開啟累積的升級或寶箱 | Tab（Shift+Tab 只開寶箱） | 對局中 | `core/main.gd` `_unhandled_input` |
| 暫停 | Esc / P | | |
| ⚠️ 城鎮聊天 | Enter | 城鎮內按 Enter 開世界聊天，之後的按鍵會變成打字 | `core/town_crowd.gd` |

- 遊戲**不檢查** `isTrusted`、輸入頻率、AFK、webdriver（實測合成 KeyboardEvent 可移動角色）。
- 技能全部**自動施放**；F 切換 hold/toggle 技能、R 發射 Overload。

## 手機 / 觸控

- 頁面殼判斷 iOS：`/iPhone|iPad|iPod/.test(navigator.userAgent)`，否則只顯示下載按鈕（`?any` 可繞過，會寫入 localStorage `midgard_any`）。
- 遊戲觸控模式：`OS.has_feature('web_ios')`（看 UA）或 `matchMedia('(pointer: coarse)')`（`core/mouse_walk.gd`）。
- 觸控模式有左下移動搖桿、右下鏡頭搖桿、F/R 按鈕；`stick_free` 時左半螢幕任一處可當搖桿。

## 背景執行

- 分頁隱藏 → 瀏覽器停掉 `requestAnimationFrame`，Godot 主迴圈停止。
- **視窗被遮住/縮小時 rAF 也會停，但 `visibilityState` 仍為 `visible`**（實測）。
- 主執行緒 `setInterval` 在背景會被壓到 ≥1 秒；Web Worker 的計時器不受影響。
- 遊戲失焦時 FPS 降到 `unfocused_fps`（預設 30），不會暫停；分頁隱藏時只會存檔（`__midgard_hide`）。
- canvas 是 WebGL2 且 `preserveDrawingBuffer: true` → 任何時候都可讀像素（畫面辨識可行）。

## 對局流程與會卡住的地方

| 狀況 | 是否暫停 | 處理 |
|---|---|---|
| 升級選卡 | 單人會暫停 | 週期送 `1`；或勾遊戲內「隨機選卡」（`endless_auto_pick`，**每局重設**） |
| 寶箱 | 會暫停 | 勾遊戲內「累積寶箱」（`hold_chests`，**永久設定**）→ 不跳窗、物品直接入帳、Tab 查看 |
| 官方「隨機選卡」開啟時 | — | 寶箱視窗也會整個跳過（`core/main.gd` `if menus.auto_pick: return`） |
| MVP 戰 | 不暫停，計時停止 | 打完後出現傳送門，**不走進去就永遠停在 MVP 房**（`core/mvp_raid.gd` state `won`） |
| 轉職 / 結算 | 會停 | 預設焦點按鈕，Enter 觸發 |

### MVP 傳送門

- 擊敗 MVP 後 `offer_exits()` 生成：
  - **返回地圖**：青色 `Color(0.45,0.78,1.0)`，實機取樣 (203,255,255)、(180,245,255)
  - **業力路線**（`karma.can_route()` 時）：紅色 Niflheim `Color(0.85,0.12,0.2)`，實機 (255,141,137)；另有 Valhalla
- 踩進去（距離 < 1.2）即觸發；紅色會進入更難的路線 MVP。
- 一般野外以嚴格青色條件掃描：多數 0~6 點，特效偶發 ~30 點 → 需連續確認。

## 撿取

- 掉落物在角色磁吸半徑內自動吸過來：`BASE_MAGNET = 4.0` × 加成（`core/player.gd`、`core/main.gd`）。
- 沒有「自動撿取」設定（`loot_auto` 是組隊傳說裝備分配規則）→ 要靠走位經過掉落物附近。

## 存檔 / 反作弊 / 網路

- 存檔 `user://profile.json`（IndexedDB），AES-256-CFB 加密；外掛**不碰存檔**。
- 反作弊：HP 封印值、屬性合理性、改存檔標記 `gear_edit`；帶 `--` 參數停用排行榜。
- 每局 `log_run_metrics` 上傳完整數據，伺服器端可能有統計式檢查（client 看不到）。
- 後端 Supabase RPC；`heartbeat_v2` 每 120 秒回報線上人數。
