import type { TelegramThemeParams } from './theme.ts';

/** Только то, что нужно игре, из Telegram.WebApp. Вне Telegram всё — безопасные заглушки. */
interface WebApp {
  initData: string;
  version: string;
  platform: string;
  themeParams: TelegramThemeParams;
  colorScheme?: 'light' | 'dark';
  isVersionAtLeast?(v: string): boolean;
  ready(): void;
  expand(): void;
  requestFullscreen?(): void;
  disableVerticalSwipes?(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  safeAreaInset?: { top: number; bottom: number };
  contentSafeAreaInset?: { top: number; bottom: number };
  onEvent?(event: string, cb: () => void): void;
  HapticFeedback?: {
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
    selectionChanged(): void;
  };
}

function webApp(): WebApp | null {
  const tg = (globalThis as { Telegram?: { WebApp?: WebApp } }).Telegram?.WebApp;
  // скрипт Telegram загружается и в обычном браузере, но initData пуст — значит, мы не в клиенте
  return tg && tg.initData !== undefined && tg.platform !== 'unknown' ? tg : null;
}

export const telegram = {
  get inTelegram(): boolean {
    return webApp() !== null;
  },

  get themeParams(): TelegramThemeParams | undefined {
    return webApp()?.themeParams;
  },

  /** Старт: сообщить Telegram о готовности, развернуть, по возможности — полный экран. */
  init(bg: string): void {
    const tg = webApp();
    if (!tg) return;
    tg.ready();
    tg.expand();
    // вертикальный свайп в Telegram закрывает Mini App — в match-3 свайпы постоянные
    tg.disableVerticalSwipes?.();
    if (tg.isVersionAtLeast?.('8.0')) tg.requestFullscreen?.();
    tg.setHeaderColor?.(bg);
    tg.setBackgroundColor?.(bg);
  },

  insets(): { top: number; bottom: number } {
    const tg = webApp();
    const s = tg?.safeAreaInset;
    const c = tg?.contentSafeAreaInset;
    return { top: (s?.top ?? 0) + (c?.top ?? 0), bottom: (s?.bottom ?? 0) + (c?.bottom ?? 0) };
  },

  onChange(cb: () => void): void {
    const tg = webApp();
    for (const e of ['themeChanged', 'viewportChanged', 'safeAreaChanged', 'contentSafeAreaChanged', 'fullscreenChanged']) {
      tg?.onEvent?.(e, cb);
    }
  },

  haptic(kind: 'tap' | 'match' | 'big' | 'error' | 'success'): void {
    const h = webApp()?.HapticFeedback;
    if (!h) return;
    if (kind === 'tap') h.selectionChanged();
    else if (kind === 'match') h.impactOccurred('light');
    else if (kind === 'big') h.impactOccurred('heavy');
    else h.notificationOccurred(kind);
  },
};
