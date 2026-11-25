/**
 * 遊戲用到的按鍵定義。
 * 遊戲的 InputMap 綁 physical_keycode（對應 KeyboardEvent.code），
 * 選卡/Enter 則讀 logical keycode（對應 key / keyCode），所以三個欄位都要帶。
 * 來源：autoload/game_data.gd `_setup_input()`、ui/menus.gd 鍵盤處理。
 */
export interface KeyDef {
  key: string;
  code: string;
  keyCode: number;
}

export const KEYS = {
  up: { key: 'w', code: 'KeyW', keyCode: 87 },
  down: { key: 's', code: 'KeyS', keyCode: 83 },
  left: { key: 'a', code: 'KeyA', keyCode: 65 },
  right: { key: 'd', code: 'KeyD', keyCode: 68 },
  /** 開/關暫停選單（遊戲設定同步用） */
  escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  /** 確認（觸發視窗的預設焦點按鈕；點擊無效或辨識不到視窗時的備援） */
  enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
  /** 升級選卡第 1 張（只在 level_up 視窗有作用，其他時候遊戲忽略） */
  pick1: { key: '1', code: 'Digit1', keyCode: 49 },
} as const satisfies Record<string, KeyDef>;

export type KeyName = keyof typeof KEYS;
