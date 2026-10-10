/** Продуктовая сводка: воронка, D1, уровни, эксперименты. Для npm run report и команды бота /report. */
import { variantOf } from './remote.ts';
import type { RemoteConfig } from './remote.ts';
import type { Report, SqliteStore, UserOutcome } from './store.ts';

export interface VariantStats {
  readonly name: string;
  readonly users: number;
  readonly winRate: number | null;
  readonly avgMaxLevel: number | null;
  readonly payers: number;
  readonly stars: number;
  readonly arpu: number | null;
  readonly d1: number | null;
}

export interface FullReport extends Report {
  readonly experiments: readonly { readonly id: string; readonly active: boolean; readonly variants: readonly VariantStats[] }[];
}

const DAY = 86_400_000;

export function buildReport(store: SqliteStore, config: RemoteConfig, now: number): FullReport {
  const outcomes = store.userOutcomes(now);
  // и выключенные эксперименты: деление игроков то же, итоги можно смотреть после остановки
  const experiments = (config.experiments ?? []).map((e) => {
    const by = new Map<string, UserOutcome[]>(e.variants.map((v) => [v.name, []]));
    for (const u of outcomes) by.get(variantOf(e, u.userId).name)!.push(u);
    return {
      id: e.id, active: e.active,
      variants: [...by].map(([name, us]): VariantStats => {
        const games = us.reduce((s, u) => s + u.wins + u.fails, 0);
        const stars = us.reduce((s, u) => s + u.starsPaid, 0);
        const cohort = us.filter((u) => u.createdAt <= now - 2 * DAY);
        return {
          name, users: us.length,
          winRate: games > 0 ? us.reduce((s, u) => s + u.wins, 0) / games : null,
          avgMaxLevel: us.length > 0 ? us.reduce((s, u) => s + u.maxLevel, 0) / us.length : null,
          payers: us.filter((u) => u.starsPaid > 0).length,
          stars, arpu: us.length > 0 ? stars / us.length : null,
          d1: cohort.length > 0 ? cohort.filter((u) => u.returnedD1).length / cohort.length : null,
        };
      }),
    };
  });
  return { ...store.report(now), experiments };
}

const pct = (x: number | null) => (x === null ? '—' : `${(x * 100).toFixed(0)}%`);

/** Текст для терминала; compact — короче, под сообщение Telegram (до 4096 символов). */
export function formatReport(r: FullReport, compact = false): string {
  const out = [
    `Игроков: ${r.users}`,
    `Воронка: установка ${r.funnel.installs} → уровень 10: ${r.funnel.level10} → уровень 30: ${r.funnel.level30}`,
    `D1: ${r.d1.returned}/${r.d1.cohort} (${pct(r.d1.rate)})`,
    '',
  ];
  if (compact) {
    out.push('ур. старты win  чистых: игр/win');
    for (const l of r.levels) out.push(`${String(l.levelId).padEnd(4)}${String(l.starts).padEnd(7)}${pct(l.winRate).padEnd(5)}${l.cleanGames}/${pct(l.cleanGames > 0 ? l.cleanWinRate : null)}`);
  } else {
    out.push('уровень  старты  победы  пораж.  win    почти   ходов в запасе  чистых игр  win чистых');
    for (const l of r.levels) {
      out.push(`${String(l.levelId).padEnd(9)}${String(l.starts).padEnd(8)}${String(l.wins).padEnd(8)}${String(l.fails).padEnd(8)}`
        + `${pct(l.winRate).padEnd(7)}${pct(l.nearMissRate).padEnd(8)}${l.avgMovesLeftOnWin.toFixed(1).padEnd(16)}`
        + `${String(l.cleanGames).padEnd(12)}${pct(l.cleanGames > 0 ? l.cleanWinRate : null)}`);
    }
  }
  for (const e of r.experiments) {
    out.push('', `Эксперимент ${e.id}${e.active ? '' : ' (выключен)'}`, 'вариант   игроков  win  ср.ур.  платящих  ⭐  ARPU  D1');
    for (const v of e.variants) {
      out.push(`${v.name.padEnd(10)}${String(v.users).padEnd(9)}${pct(v.winRate).padEnd(5)}${(v.avgMaxLevel?.toFixed(1) ?? '—').padEnd(8)}`
        + `${String(v.payers).padEnd(10)}${String(v.stars).padEnd(4)}${(v.arpu?.toFixed(2) ?? '—').padEnd(6)}${pct(v.d1)}`);
    }
  }
  return out.join('\n');
}
