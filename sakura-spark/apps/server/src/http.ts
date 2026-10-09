import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { validateInitData } from './auth.ts';
import type { TelegramUser } from './auth.ts';
import { handleUpdate } from './bot.ts';
import type { BotApi } from './bot.ts';
import { ServiceError } from './service.ts';
import type { GameService } from './service.ts';

export interface HttpDeps {
  readonly service: GameService;
  readonly botToken: string;
  readonly devAuth: boolean;
  readonly clientDir?: string;
  readonly bot?: { readonly api: BotApi; readonly webAppUrl: string; readonly secret: string };
  readonly now?: () => number;
  readonly log?: (msg: string) => void;
}

const MAX_BODY = 64 * 1024;
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp',
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
  function authenticate(req: IncomingMessage): TelegramUser {
    const header = req.headers.authorization ?? '';
    const [scheme, ...rest] = header.split(' ');
    const value = rest.join(' ');
    if (scheme === 'tma') {
      const data = validateInitData(value, deps.botToken, now());
      if (data) return data.user;
    } else if (scheme === 'dev' && deps.devAuth && /^\d{1,12}$/.test(value)) {
      return { id: Number(value), firstName: `Dev ${value}` };
    }
    throw new HttpError(401, 'unauthorized');
  }

  async function api(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const method = req.method ?? 'GET';
    if (method === 'GET' && path === '/api/health') return send(res, 200, { ok: true, time: now() });

    if (method === 'POST' && path === '/telegram/webhook') {
      const secret = String(req.headers['x-telegram-bot-api-secret-token'] ?? '');
      if (!deps.bot || !deps.bot.secret || !safeEqual(secret, deps.bot.secret)) throw new HttpError(401, 'unauthorized');
      const update = await readJson(req);
      // Telegram ждёт быстрый 200; ошибку бота логируем, но апдейт не переотправляем
      handleUpdate(update, deps.bot.api, deps.bot.webAppUrl).catch((e) => log(`bot: ${String(e)}`));
      return send(res, 200, { ok: true });
    }

    const user = await deps.service.login(authenticate(req));
    if (method === 'GET' && path === '/api/me') return send(res, 200, await deps.service.me(user));
    if (method === 'GET' && path === '/api/levels') return send(res, 200, { levels: deps.service.levelSummaries() });
    if (method === 'POST' && path === '/api/attempts') {
      const { levelId } = await readJson(req);
      if (!Number.isInteger(levelId)) throw new HttpError(400, 'bad_request');
      return send(res, 200, await deps.service.startAttempt(user.id, levelId as number));
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

  return createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    // всё через промис: синхронная ошибка не должна ронять процесс
    const handled = new Promise<void>((ok) => {
      ok(path.startsWith('/api/') || path.startsWith('/telegram/') ? api(req, res, path) : serveStatic(req, res, path));
    });
    handled.catch((e: unknown) => {
      if (e instanceof HttpError) return send(res, e.status, { error: e.code, ...e.details });
      if (e instanceof ServiceError) return send(res, e.status, { error: e.code, ...e.details });
      log(`error ${req.method} ${path}: ${e instanceof Error ? e.stack : String(e)}`);
      send(res, 500, { error: 'internal' });
    });
  });
}
