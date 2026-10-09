import type { Pos } from '@sakura/core';

export interface Viewport {
  readonly width: number;
  readonly height: number;
  /** Отступы от системного UI Telegram (полноэкранный режим, вырез). */
  readonly insetTop: number;
  readonly insetBottom: number;
}

export interface Layout {
  readonly cell: number;
  /** Левый верхний угол поля. */
  readonly boardX: number;
  readonly boardY: number;
  readonly hud: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

const PADDING = 12;
const MAX_CELL = 80;

/**
 * HUD сверху, поле под ним: по горизонтали по центру, по вертикали — 30% свободного места сверху
 * и 70% снизу (ближе к HUD, но не прилипая). Клетки квадратные и целые.
 */
export function computeLayout(vp: Viewport, cols: number, rows: number): Layout {
  const hudHeight = Math.round(Math.min(150, Math.max(104, vp.height * 0.17)));
  const hudY = vp.insetTop + PADDING / 2;
  const top = hudY + hudHeight + PADDING;
  const availW = vp.width - PADDING * 2;
  const availH = vp.height - top - vp.insetBottom - PADDING;
  const cell = Math.max(16, Math.floor(Math.min(availW / cols, availH / rows, MAX_CELL)));
  const boardW = cell * cols;
  const boardH = cell * rows;
  return {
    cell,
    boardX: Math.round((vp.width - boardW) / 2),
    boardY: Math.round(top + Math.max(0, (availH - boardH) * 0.3)),
    hud: { x: PADDING, y: hudY, width: vp.width - PADDING * 2, height: hudHeight },
  };
}

/** Центр клетки в пикселях. */
export function cellCenter(l: Layout, p: Pos): { x: number; y: number } {
  return { x: l.boardX + (p.col + 0.5) * l.cell, y: l.boardY + (p.row + 0.5) * l.cell };
}

/** Клетка под точкой или null вне поля. */
export function cellAt(l: Layout, x: number, y: number, cols: number, rows: number): Pos | null {
  const col = Math.floor((x - l.boardX) / l.cell);
  const row = Math.floor((y - l.boardY) / l.cell);
  if (col < 0 || row < 0 || col >= cols || row >= rows) return null;
  return { row, col };
}
