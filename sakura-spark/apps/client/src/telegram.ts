import type { TelegramThemeParams } from './theme.ts';

/** Только то, что нужно игре, из Telegram.WebApp. Вне Telegram всё — безопасные заглушки. */
interface WebApp {
  initData: string;
  initDataUnsafe?: { start_param?: string; user?: { language_code?: string } };
  shareMessage?(id: string, cb?: (sent: boolean) => void): void;
  shareToStory?(mediaUrl: string, params?: { text?: string; widget_link?: { url: string; name?: string } }): void;
  openInvoice?(url: string, cb?: (status: 'paid' | 'cancelled' | 'failed' | 'pending') => void): void;
  openTelegramLink?(url: string): void;
  openLink?(url: string): void;
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

  /** Подписанные данные запуска — сервер проверяет их подпись на каждом запросе. */
  get initData(): string {
    return webApp()?.initData ?? '';
  },

  /** Параметр startapp из ссылки t.me/<bot>?startapp=… (комната чат-режима). */
  /** Язык интерфейса Telegram у игрока (language_code). */
  get languageCode(): string | null {
    return webApp()?.initDataUnsafe?.user?.language_code ?? null;
  },

  get startParam(): string | null {
    return webApp()?.initDataUnsafe?.start_param ?? null;
  },

  /** Сторис из Mini App (Bot API 7.8). Ссылка-виджет в сторис доступна только Premium — остальным хватит текста. */
  get canShareToStory(): boolean {
    const tg = webApp();
    return !!tg?.shareToStory && (tg.isVersionAtLeast?.('7.8') ?? false);
  },

  shareToStory(mediaUrl: string, text: string, link: { url: string; name: string }): void {
    webApp()?.shareToStory?.(mediaUrl, { text, widget_link: link });
  },

  get canShareMessage(): boolean {
    const tg = webApp();
    return !!tg?.shareMessage && (tg.isVersionAtLeast?.('8.0') ?? false);
  },

  /** Отправить подготовленную ботом карточку в чат (Bot API 8.0). true — пользователь отправил. */
  shareMessage(id: string): Promise<boolean> {
    const tg = webApp();
    if (!tg?.shareMessage) return Promise.resolve(false);
    return new Promise((resolve) => tg.shareMessage!(id, (sent) => resolve(sent)));
  },

  /** Окно оплаты Stars поверх игры. 'unsupported' — не в Telegram. */
  openInvoice(url: string): Promise<'paid' | 'cancelled' | 'failed' | 'pending' | 'unsupported'> {
    const tg = webApp();
    if (!tg?.openInvoice) return Promise.resolve('unsupported');
    return new Promise((resolve) => tg.openInvoice!(url, (status) => resolve(status)));
  },

  /** Открыть обычную https-ссылку во внешнем браузере (картинка сторис — сохранить). */
  openExternal(url: string): boolean {
    const tg = webApp();
    if (!tg?.openLink) return false;
    tg.openLink(url);
    return true;
  },

  /** Открыть t.me-ссылку внутри Telegram (запасной путь, если shareMessage недоступен). */
  openLink(url: string): boolean {
    const tg = webApp();
    if (!tg?.openTelegramLink) return false;
    tg.openTelegramLink(url);
    return true;
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
