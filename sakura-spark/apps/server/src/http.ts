import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { validateInitData } from './auth.ts';
import type { TelegramUser } from './auth.ts';
import { webhookToken } from './bot.ts';
import type { ChatBot } from './chat.ts';
import { ServiceError } from './service.ts';
import { textsFor } from './texts.ts';
import type { GameService } from './service.ts';

export interface HttpDeps {
  readonly service: GameService;
  readonly botToken: string;
  readonly devAuth: boolean;
  readonly clientDir?: string;
  readonly bot?: { readonly chat: ChatBot; readonly secret: string };
  readonly now?: () => number;
  readonly log?: (msg: string) => void;
  /** GET /api/admin/report — только для adminIds (вход тем же initData). */
  readonly adminIds?: readonly number[];
  readonly report?: () => Promise<unknown>;
  /** Публичный адрес игры без «/» в конце — для ссылок-диплинков /t/<комната>. */
  readonly publicUrl?: string;
}

const MAX_BODY = 64 * 1024;
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.ico': 'image/x-icon',
};

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, readonly details: Record<string, unknown> = {}) {
    super(code);
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(json);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'body_too_large');
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'bad_json');
  }
}

const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function createApp(deps: HttpDeps): Server {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => {});

  /** «Authorization: tma <initData>» — подпись Telegram; «dev <id>» — только при DEV_AUTH. */
  function authenticate(req: IncomingMessage): { user: TelegramUser; startParam?: string } {
    const header = req.headers.authorization ?? '';
    const [scheme, ...rest] = header.split(' ');
    const value = rest.join(' ');
    if (scheme === 'tma') {
      const data = validateInitData(value, deps.botToken, now());
      if (data) return { user: data.user, ...(data.startParam ? { startParam: data.startParam } : {}) };
    } else if (scheme === 'dev' && deps.devAuth && /^\d{1,12}$/.test(value)) {
      return { user: { id: Number(value), firstName: `Dev ${value}` } };
    }
    throw new HttpError(401, 'unauthorized');
  }

  async function api(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const method = req.method ?? 'GET';
    if (method === 'GET' && path === '/api/health') return send(res, 200, { ok: true, time: now() });

    if (method === 'POST' && path === '/telegram/webhook') {
      const secret = String(req.headers['x-telegram-bot-api-secret-token'] ?? '');
      if (!deps.bot || !deps.bot.secret || !safeEqual(secret, webhookToken(deps.bot.secret))) throw new HttpError(401, 'unauthorized');
      const update = await readJson(req);
      // Telegram ждёт быстрый 200; ошибку бота логируем, но апдейт не переотправляем
      deps.bot.chat.handleUpdate(update).catch((e) => log(`bot: ${String(e)}`));
      return send(res, 200, { ok: true });
    }

    const auth = authenticate(req);
    const user = await deps.service.login(auth.user, auth.startParam ? { startParam: auth.startParam } : {});
    if (method === 'GET' && path === '/api/me') return send(res, 200, await deps.service.me(user));
    if (method === 'GET' && path === '/api/levels') return send(res, 200, { levels: deps.service.levelSummaries() });
    if (method === 'POST' && path === '/api/attempts') {
      const { levelId, boosters } = await readJson(req);
      if (!Number.isInteger(levelId)) throw new HttpError(400, 'bad_request');
      return send(res, 200, await deps.service.startAttempt(user.id, levelId as number, Array.isArray(boosters) ? boosters : []));
    }
    // соц: друзья, почта, ворота района, рейтинг уровня среди друзей
    if (method === 'GET' && path === '/api/friends') {
      return send(res, 200, { ...(await deps.service.friendsView(user.id)), inviteLink: deps.bot ? deps.bot.chat.link(`fr${user.id}`) : null });
    }
    if (method === 'POST' && path === '/api/friends/ask') return send(res, 200, await deps.service.askLives(user.id));
    const lifeTo = /^\/api\/friends\/(\d{1,15})\/life$/.exec(path);
    if (method === 'POST' && lifeTo) return send(res, 200, await deps.service.sendLife(user.id, Number(lifeTo[1])));
    const mail = /^\/api\/mail\/(\d{1,15})$/.exec(path);
    if (method === 'POST' && mail) return send(res, 200, await deps.service.mailAction(user.id, Number(mail[1])));
    const levelFriends = /^\/api\/levels\/(\d{1,5})\/friends$/.exec(path);
    if (method === 'GET' && levelFriends) return send(res, 200, { top: await deps.service.levelFriends(user.id, Number(levelFriends[1])) });
    if (method === 'GET' && path === '/api/gate') return send(res, 200, { gate: await deps.service.gate(user.id) });
    if (method === 'POST' && path === '/api/gate/ask') return send(res, 200, await deps.service.askKeys(user.id));
    if (method === 'POST' && path === '/api/gate/buy') return send(res, 200, await deps.service.buyGate(user.id));
    if (method === 'GET' && path === '/api/race') return send(res, 200, await deps.service.raceView(user.id));
    if (method === 'GET' && path === '/api/season') return send(res, 200, await deps.service.seasonView(user.id));
    if (method === 'POST' && path === '/api/pass/claim') {
      const { tier, track } = await readJson(req);
      return send(res, 200, await deps.service.claimPass(user.id, tier, track));
    }
    if (method === 'POST' && path === '/api/frame') return send(res, 200, await deps.service.setFrame(user.id, (await readJson(req)).frame ?? null));
    if (method === 'POST' && path === '/api/race/join') return send(res, 200, await deps.service.joinRace(user.id));
    if (method === 'POST' && path === '/api/race/seen') {
      await deps.service.raceSeen(user.id);
      return send(res, 200, { ok: true });
    }
    if (path.startsWith('/api/meta')) {
      if (method === 'GET' && path === '/api/meta') return send(res, 200, await deps.service.metaView(user.id));
      if (method === 'POST' && path === '/api/meta/login') return send(res, 200, await deps.service.claimLogin(user.id));
      if (method === 'POST' && path === '/api/meta/wheel') return send(res, 200, await deps.service.spinWheel(user.id));
      if (method === 'POST' && path === '/api/meta/stuck') return send(res, 200, await deps.service.claimStuck(user.id));
      if (method === 'POST' && path === '/api/meta/tasks') return send(res, 200, await deps.service.claimTask(user.id, (await readJson(req)).slot));
      if (method === 'POST' && path === '/api/meta/chests') {
        const { episode, tier } = await readJson(req);
        return send(res, 200, await deps.service.claimChest(user.id, episode, tier));
      }
    }
    if (method === 'GET' && path === '/api/admin/report') {
      if (!deps.report || !deps.adminIds?.includes(user.id)) throw new HttpError(403, 'forbidden');
      return send(res, 200, await deps.report());
    }
    if (method === 'GET' && path === '/api/shop') return send(res, 200, await deps.service.shop(user.id));
    if (method === 'POST' && path === '/api/shop/buy') {
      const { item, count } = await readJson(req);
      return send(res, 200, { wallet: await deps.service.buyItem(user.id, item, count ?? 1) });
    }
    if (method === 'POST' && path === '/api/lives/refill') return send(res, 200, await deps.service.refillLives(user.id));
    if (method === 'POST' && path === '/api/purchases') {
      const { product } = await readJson(req);
      if (!deps.bot) throw new HttpError(503, 'payments_unavailable');
      const inv = await deps.service.createInvoice(user.id, product);
      return send(res, 200, { invoiceId: inv.invoiceId, stars: inv.stars, link: await deps.bot.chat.invoiceLink(inv) });
    }
    const extend = /^\/api\/attempts\/([\w-]{1,64})\/extend$/.exec(path);
    if (method === 'POST' && extend) {
      const { moves } = await readJson(req);
      return send(res, 200, await deps.service.extendAttempt(user.id, extend[1]!, moves));
    }
    if (method === 'POST' && path === '/api/events') {
      const body = await readJson(req);
      return send(res, 200, { accepted: await deps.service.clientEvents(user.id, body.events) });
    }
    if (method === 'POST' && path === '/api/rooms') {
      const { mode } = await readJson(req);
      // новые комнаты — только турнир на час и просьба о жизни; командный фонарь и дуэль доигрывают старые комнаты
      if (mode !== 'challenge' && mode !== 'help') throw new HttpError(400, 'bad_request');
      const room = await deps.service.createRoom(user.id, mode);
      // карточку для shareMessage готовит бот; без бота (разработка) или при сбое Bot API — только ссылка
      const preparedMessageId = deps.bot
        ? await deps.bot.chat.prepare(room, user.id).catch((e: unknown) => {
          log(`savePreparedInlineMessage: ${String(e)}`);
          return null;
        })
        : null;
      return send(res, 200, {
        roomId: room.id, mode, levelId: room.levelId, preparedMessageId, link: deps.bot?.chat.link(room.id) ?? null,
        // страница-диплинк с превью для соцсетей и сторис: /t/<комната> ведёт в Telegram
        shareUrl: deps.publicUrl ? `${deps.publicUrl}/t/${room.id}` : null,
      });
    }
    const roomPath = /^\/api\/rooms\/(r[A-Za-z0-9]{1,32})(\/attempts)?$/.exec(path);
    if (roomPath && method === 'GET' && !roomPath[2]) return send(res, 200, await deps.service.roomView(roomPath[1]!, user.id));
    if (roomPath && method === 'POST' && roomPath[2]) {
      const { boosters } = await readJson(req);
      return send(res, 200, await deps.service.startRoomAttempt(user.id, roomPath[1]!, Array.isArray(boosters) ? boosters : []));
    }
    const finish = /^\/api\/attempts\/([\w-]{1,64})\/finish$/.exec(path);
    if (method === 'POST' && finish) {
      const body = await readJson(req);
      return send(res, 200, await deps.service.finishAttempt(user.id, finish[1]!, body.swaps, body.timedOut === true));
    }
    throw new HttpError(404, 'not_found');
  }

  function serveStatic(req: IncomingMessage, res: ServerResponse, path: string): void {
    const dir = deps.clientDir;
    if (!dir || !existsSync(dir) || (req.method !== 'GET' && req.method !== 'HEAD')) {
      return send(res, 404, { error: 'not_found' });
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      return send(res, 400, { error: 'bad_path' });
    }
    const base = resolve(dir);
    let file = resolve(join(base, decoded));
    // только внутри каталога клиента (и не в соседнем dist-evil)
    if (file !== base && !file.startsWith(base + sep)) return send(res, 403, { error: 'forbidden' });
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(base, 'index.html');
    // файлы сборки с хешем в имени кешируются навсегда, index.html — никогда
    const immutable = /\/assets\//.test(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    if (req.method === 'HEAD') return void res.end();
    createReadStream(file).pipe(res);
  }

  /**
   * Диплинк турнира для соцсетей и сторис: превью (og:*) с артом и сразу переход в Telegram —
   * в ту же комнату, что и кнопка «Играть» на карточке в чате.
   */
  async function landing(req: IncomingMessage, res: ServerResponse, roomId: string): Promise<void> {
    const tx = textsFor(String(req.headers['accept-language'] ?? '').split(',')[0]);
    const room = await deps.service.getRoom(roomId);
    const target = deps.bot ? deps.bot.chat.link(room ? room.id : undefined) : `${deps.publicUrl ?? ''}/`;
    const description = room ? tx.landing.description(room.creatorName || tx.card.player, room.levelId) : tx.landing.game;
    const base = deps.publicUrl ?? '';
    const attr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${attr(tx.landing.title)}</title>
<meta property="og:type" content="website">
<meta property="og:title" content="${attr(tx.landing.title)}">
<meta property="og:description" content="${attr(description)}">
<meta property="og:image" content="${attr(`${base}/art/share_cover.jpg`)}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="1;url=${attr(target)}">
<style>body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;
background:#3a2a5a url(${attr(`${base}/art/district_14.webp`)}) center/cover;font:16px system-ui,sans-serif;color:#fff;text-align:center}
.c{margin:0 16px 48px;padding:20px;border-radius:24px;background:rgba(40,24,64,.82);max-width:420px}
a{display:block;margin-top:16px;padding:14px;border-radius:24px;background:#ff7eb6;color:#fff;font-weight:700;text-decoration:none}</style>
</head><body><div class="c"><h1 style="margin:0 0 8px;font-size:22px">${attr(tx.landing.title)}</h1>
<div>${attr(description)}</div><a href="${attr(target)}">${attr(tx.landing.open)}</a></div>
<script>location.replace(${JSON.stringify(target).replace(/</g, '\\u003c')})</script></body></html>`;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
    res.end(html);
  }

  return createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    const share = /^\/t\/(r[A-Za-z0-9]{1,32})\/?$/.exec(path);
    // всё через промис: синхронная ошибка не должна ронять процесс
    const handled = new Promise<void>((ok) => {
      ok(share && req.method === 'GET' ? landing(req, res, share[1]!)
        : path.startsWith('/api/') || path.startsWith('/telegram/') ? api(req, res, path) : serveStatic(req, res, path));
    });
    handled.catch((e: unknown) => {
      if (e instanceof HttpError) return send(res, e.status, { error: e.code, ...e.details });
      if (e instanceof ServiceError) return send(res, e.status, { error: e.code, ...e.details });
      log(`error ${req.method} ${path}: ${e instanceof Error ? e.stack : String(e)}`);
      send(res, 500, { error: 'internal' });
    });
  });
}
