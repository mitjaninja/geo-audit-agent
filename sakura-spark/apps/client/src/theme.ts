/** Цвета интерфейса. Берутся из темы Telegram, если она есть, иначе — пастельная палитра игры. */
export interface Theme {
  readonly bg: string;
  readonly text: string;
  readonly hint: string;
  readonly button: string;
  readonly buttonText: string;
  readonly panel: string;
  readonly isDark: boolean;
}

export interface TelegramThemeParams {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
}

const LIGHT: Theme = {
  bg: '#fff4f8', text: '#3b2a4a', hint: '#9a86ad', button: '#ff7eb6', buttonText: '#ffffff', panel: '#ffffff', isDark: false,
};
const DARK: Theme = {
  bg: '#1d1830', text: '#f3eaff', hint: '#a99cc4', button: '#ff7eb6', buttonText: '#ffffff', panel: '#2a2342', isDark: true,
};

const HEX = /^#[0-9a-f]{6}$/i;

/** Яркость по WCAG-приближению — чтобы понять, тёмная ли тема. */
export function isDarkColor(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}

export function themeFrom(params: TelegramThemeParams | undefined, prefersDark: boolean): Theme {
  const pick = (v: string | undefined, fallback: string) => (v && HEX.test(v) ? v : fallback);
  const bg = params?.bg_color && HEX.test(params.bg_color) ? params.bg_color : null;
  const base = bg ? (isDarkColor(bg) ? DARK : LIGHT) : prefersDark ? DARK : LIGHT;
  return {
    bg: bg ?? base.bg,
    text: pick(params?.text_color, base.text),
    hint: pick(params?.hint_color, base.hint),
    button: pick(params?.button_color, base.button),
    buttonText: pick(params?.button_text_color, base.buttonText),
    panel: pick(params?.secondary_bg_color, base.panel),
    isDark: base.isDark,
  };
}

export const hexToInt = (hex: string): number => parseInt(hex.slice(1), 16);
