// KeyboardEvent.code → 繁體中文顯示名稱。UI 專屬（資料層 core/settings.ts 只存 code 字串），
// 供 ui/menu.ts（按鍵設定面板）與 ui/overlay.ts（主選單操控提示，M3 第四階段新增動態生成）
// 共用，避免兩處各自維護一份對照表而漂移。

const NAMED_CODES: Readonly<Record<string, string>> = {
  Space: "空白鍵",
  ShiftLeft: "左 Shift",
  ShiftRight: "右 Shift",
  ControlLeft: "左 Ctrl",
  ControlRight: "右 Ctrl",
  AltLeft: "左 Alt",
  AltRight: "右 Alt",
  Tab: "Tab",
  Enter: "Enter",
  CapsLock: "Caps Lock",
  Backquote: "｀",
  Minus: "－",
  Equal: "＝",
  BracketLeft: "［",
  BracketRight: "］",
  Backslash: "＼",
  Semicolon: "；",
  Quote: "＇",
  Comma: "，",
  Period: "．",
  Slash: "／",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
};

/** 將 KeyboardEvent.code（如 "KeyW"／"Digit1"／"Space"）轉為適合 UI 顯示的簡短名稱。
 *  查無對照者（罕見鍵）直接回傳原始 code，保底可讀不至於顯示空白。 */
export function keyCodeDisplayName(code: string): string {
  if (code in NAMED_CODES) return NAMED_CODES[code] as string;
  if (code.startsWith("Key") && code.length === 4) return code.slice(3);
  if (code.startsWith("Digit") && code.length === 6) return code.slice(5);
  return code;
}
