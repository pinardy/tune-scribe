// Small things said the same way all over the app.

export const UNTITLED = 'Untitled tune';

/** Seconds as m:ss. */
export function clock(seconds: number): string {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** A date as "14 Nov", in the reader's own language. */
export function day(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
