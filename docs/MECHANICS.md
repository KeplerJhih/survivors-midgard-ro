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
| 升級選卡 | 單人會暫停 | 勾遊戲內「隨機選擇」（`endless_auto_pick`，**永久設定**，依稀有度挑最高、不跳窗）；外掛另週期送 `1` 當備援 |
| 寶箱 | 會暫停 | 勾遊戲內「累積寶箱」（`hold_chests`，**永久設定**）→ 不跳窗、物品直接入帳、Tab 查看 |
| `menus.auto_pick`（debug 專用，玩家無法開啟） | — | 會跳過寶箱視窗；與「隨機選擇」不同 |
| MVP 入口傳送門開啟 | 一般怪被清空、計時停止 | 生成在角色 4~6.5 單位外的隨機方向，**沒有時限，不踩進去就一直卡著**（`core/mvp_raid.gd` `open_portal`、`_portal_point`）。顏色隨 MVP 不同（`GameData.RAIDS[*].color`，綠/橙/紫/金都有）→ 不適合用顏色找，改用花瓣走位掃過 |
| MVP 戰 | 不暫停，計時停止（外掛以右上時鐘字形不變判斷「時間停住」） | 打完後出現傳送門，**不走進去就永遠停在 MVP 房**（`core/mvp_raid.gd` state `won`） |
| 轉職 / 結算 | 會停 | 預設焦點按鈕，Enter 觸發 |
| 腐化寶箱（選路線） | 會停 | 每張地圖第一次會跳窗；選過後同地圖自動沿用（`world.corrupt_auto`，換地圖重設）。⚠️ **預設焦點是 Hel**，按 Enter 會選 Hel |

### 腐化寶箱路線

- Hel → Niflheim：+8% 傷害、+1 等；代價 −25% HP、怪物 +6% 傷害。路線 MVP 墮落 Randgris，怪物 +35% 傷害並死亡爆炸
- Valhalla：+6% HP 與回復、+1 等；代價怪物 +6% HP。路線 MVP Valkyrie Reginleif，怪物 +35% HP
- 掛機建議 **Valhalla**（生存優先）。Valhalla 傳送門色 `Color(1.0,0.92,0.6)` 淡金，不會被當成青色出口
- 視窗上方「這張地圖接下來的寶箱」：我選的道路（沿用）/ 隨機（`ui/menus.gd` `corrupt_auto_opts`）

### MVP 傳送門

- 擊敗 MVP 後 `offer_exits()` 生成：
  - **返回地圖**：青色 `Color(0.45,0.78,1.0)`，實機取樣 (203,255,255)、(180,245,255)
  - **業力路線**（`karma.can_route()` 時）：紅色 Niflheim `Color(0.85,0.12,0.2)`，實機 (255,141,137)；另有 Valhalla
- 踩進去（距離 < 1.2）即觸發；紅色會進入更難的路線 MVP。
- 一般野外以嚴格青色條件掃描：多數 0~6 點，特效偶發 ~30 點 → 需連續確認。

## 結算 / 新局

- 結算頁（`ui/menus.gd` `show_end`）按鈕列：[選擇目的地（主要，藍框）][再玩一次][前往 Prontera][更換職業]；**沒有鍵盤快捷鍵**，方向鍵/Tab 也不會移動焦點（實測）→ 只能點擊。
- 合成 TouchEvent 點擊有效（實測）。
- 沒存進 Kafra 就離開會跳「不存放就離開？」確認框：[要再想想][仍要離開]，背景加 55% 遮罩（`_end_leave`）。
- 新局開始跳「選擇你的初始技能」，上次選的卡片頂端有 LEGENDARY_COLOR 色帶與「上次選擇」（`show_start_skill`）；不吃數字鍵。

## 城鎮出發

- Prontera 城鎮有「出發冒險！」傳送門（淡藍 Color(0.55,0.75,1.0)，`core/town.gd` `_build_portal`）；踩上去（PORTAL_RANGE 內）→ 選地圖（`show_server_select`）。
- 選地圖：左世界地圖、右面板預選上一張地圖，右下「選擇 ▶」→ 「準備」畫面，右下「出發冒險！」→ 載入 → 新局。
- 城鎮按 Enter 會開世界聊天（`core/town_crowd.gd`）；離開遊戲確認框 [離開][留下] 的右下是「留下」。

## 地圖 NPC

| NPC | 生成 | 互動 | 建議 |
|---|---|---|---|
| 催眠師（紫圈「!」，數字是**距離**不是倒數） | 開場 150/330/510 秒；無盡模式每 180 秒；離角色 25~30 單位；存活 120 秒 | 站在半徑 1.8 內 2 秒 → 暫停、跳「忘掉一個技能」選單（Esc 可取消） | **避開** |
| 任務 NPC Chef Klaws | 開場 60 秒，prt_fild08 固定格 (243,190) | 走到 2.6 內跳窗 [先不要][我來幫忙！]，接下後守車 60 秒 | 每存檔一次，低優先 |
| 金波利 Runner | 開場 70 秒後每 30 秒 6% 機率，角色 5~7 單位外 | 40 秒內打死掉 tier3 寶箱 | 追上去打 |
| 祭壇（神像） | 每 60~90 秒，最多 5 個，25~30 單位外，存活 120 秒 | 站上 2 秒生效（有正有負） | 無指示器 |

## 寶箱與指示器

- 寶箱（`_drop_chest`）：精英/首領/MVP/Runner/一般怪 0.15%；**永不過期**；3 單位內被吸過來、1.1 內自動開。
- 寵物撿箱（pet_fetch，G 鍵，預設開）：只叼 **20 單位外**的箱子 → 外掛要處理的是 3~20 單位。
- 棕色木箱/鐵箱是可破壞道具（碰到就破，掉 zeny/藥水），角色周圍 12~30 單位維持 8 個，無指示器。
- **畫面外指示器**（`ui/chest_pointer.gd`）：目標在畫面外時，在「中心 + 方向 × min(到邊距離, 0.4×視窗高)」畫深色底圓、目標色外框（閃爍）、圖示、外側三角箭頭、下方白字距離。標寶箱（最近 8 個）、MVP 入口、Runner、任務（橙黃 !）、催眠師（紫 !）。
- 小地圖：寶箱 6×6 黃色閃爍方塊 (1,0.85,0.2)；玩家紅箭頭；下方「地圖 (cx, cy)」為格子座標。

## 撿取

- 掉落物在角色磁吸半徑內自動吸過來：`BASE_MAGNET = 4.0` × 加成（`core/player.gd`、`core/main.gd`）。
- 沒有「自動撿取」設定（`loot_auto` 是組隊傳說裝備分配規則）→ 要靠走位經過掉落物附近。

## 存檔 / 反作弊 / 網路

- 存檔 `user://profile.json`（IndexedDB），AES-256-CFB 加密；外掛**不碰存檔**。
- 反作弊：HP 封印值、屬性合理性、改存檔標記 `gear_edit`；帶 `--` 參數停用排行榜。
- 每局 `log_run_metrics` 上傳完整數據，伺服器端可能有統計式檢查（client 看不到）。
- 後端 Supabase RPC；`heartbeat_v2` 每 120 秒回報線上人數。
