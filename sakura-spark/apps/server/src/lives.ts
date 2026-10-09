/** PRD: максимум 5 жизней, восстановление 1 жизнь за 30 минут, тратится только при проигрыше. */
export const MAX_LIVES = 5;
export const LIFE_REGEN_MS = 30 * 60 * 1000;

export interface LivesState {
  readonly lives: number;
  /** От этого момента отсчитывается восстановление следующей жизни. */
  readonly updatedAt: number;
  /** «Бесконечные жизни» из паков и событий — до этого момента жизни не тратятся. */
  readonly infiniteUntil: number;
}

export interface LivesView {
  readonly lives: number;
  readonly max: number;
  /** Когда придёт следующая жизнь; null — запас полный или жизни бесконечные. */
  readonly nextLifeAt: number | null;
  readonly infiniteUntil: number | null;
}

export const fullLives = (now: number): LivesState => ({ lives: MAX_LIVES, updatedAt: now, infiniteUntil: 0 });

/** Начислить восстановившиеся жизни. Остаток неполного интервала сохраняется. */
export function regen(s: LivesState, now: number): LivesState {
  if (s.lives >= MAX_LIVES) return { ...s, updatedAt: now };
  const gained = Math.floor(Math.max(0, now - s.updatedAt) / LIFE_REGEN_MS);
  const lives = Math.min(MAX_LIVES, s.lives + gained);
  return { ...s, lives, updatedAt: lives >= MAX_LIVES ? now : s.updatedAt + gained * LIFE_REGEN_MS };
}

export function view(s: LivesState, now: number): LivesView {
  const r = regen(s, now);
  const infinite = r.infiniteUntil > now;
  return {
    lives: r.lives,
    max: MAX_LIVES,
    nextLifeAt: infinite || r.lives >= MAX_LIVES ? null : r.updatedAt + LIFE_REGEN_MS,
    infiniteUntil: infinite ? r.infiniteUntil : null,
  };
}

export function canPlay(s: LivesState, now: number): boolean {
  const r = regen(s, now);
  return r.infiniteUntil > now || r.lives > 0;
}

/** Взять жизнь на попытку. При бесконечных жизнях не тратится. */
export function spend(s: LivesState, now: number): LivesState {
  const r = regen(s, now);
  if (r.infiniteUntil > now) return r;
  if (r.lives <= 0) throw new Error('no lives');
  return { ...r, lives: r.lives - 1 };
}

/** Вернуть жизнь (попытка выиграна). */
export function refund(s: LivesState, now: number): LivesState {
  const r = regen(s, now);
  return { ...r, lives: Math.min(MAX_LIVES, r.lives + 1), updatedAt: r.lives + 1 >= MAX_LIVES ? now : r.updatedAt };
}
