/**
 * Поделиться турниром за пределами чата Telegram: системное меню «Поделиться» (Web Share API),
 * буфер обмена и картинка для сторис. Без Phaser; всё, что недоступно в WebView, — с запасным путём.
 */

/** Системное меню «Поделиться» (HTML5). false — в этом WebView его нет или игрок закрыл меню. */
export async function webShare(data: { title: string; text: string; url: string; files?: File[] }): Promise<boolean> {
  const nav = globalThis.navigator as Navigator | undefined;
  if (!nav?.share) return false;
  if (data.files && !(nav.canShare?.({ files: data.files }) ?? false)) return false;
  try {
    await nav.share(data);
    return true;
  } catch {
    return false;
  }
}

/** Скопировать текст: Clipboard API, а в старых WebView — через выделение в скрытом поле. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.append(area);
    area.select();
    area.setSelectionRange(0, text.length);
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

/** Картинка сторис файлом — для «Поделиться» в Instagram и др. Грузим заранее: Safari требует share прямо в жесте. */
export async function storyFile(url: string): Promise<File | null> {
  try {
    const blob = await (await fetch(url)).blob();
    return new File([blob], 'sakura-spark-story.jpg', { type: blob.type || 'image/jpeg' });
  } catch {
    return null;
  }
}

/** Абсолютный адрес файла клиента (Telegram берёт картинку сторис по https-ссылке). */
export const absoluteUrl = (path: string, base: string = globalThis.location?.href ?? ''): string => new URL(path, base).toString();
