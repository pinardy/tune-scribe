// How the beat is divided. Straight: in halves and quarters. Swing: the
// eighths are written evenly but played long-short, two thirds and one third
// of the beat. Triplets: a beat may also be cut into three.

export type Feel = 'straight' | 'swing' | 'triplets';

/** Positions and lengths are whole units or thirds of a unit (a triplet eighth is 4/3). */
export function snapUnits(units: number): number {
  return Math.round(units * 3) / 3;
}

export function isWholeUnits(units: number): boolean {
  return Math.abs(units - Math.round(units)) < 1e-6;
}

/**
 * Where a written position falls in time when the eighths are swung, in
 * units of straight time: the off-beat eighth moves from the middle of the
 * beat to two thirds of the way through it.
 */
export function swungUnits(units: number): number {
  const beat = Math.floor(units / 4);
  const within = (units - beat * 4) / 4;
  const swung = within < 0.5 ? within * (4 / 3) : 2 / 3 + (within - 0.5) * (2 / 3);
  return (beat + swung) * 4;
}
