// A tune as a link: the heard notes, the settings and the marks packed into
// the URL's fragment, so nothing is uploaded anywhere. The sound itself is
// far too big to travel this way; a linked tune has its score but no recording.

import { sanitizeMarks, type Marks } from '../transcribe/marks';
import type { NoteEvent } from '../transcribe/segment';
import { sanitizeSettings, type ScribeSettings } from '../transcribe/settings';

export interface SharedTune {
  title: string;
  notes: NoteEvent[];
  settings: ScribeSettings;
  marks: Marks;
  clickBpm?: number;
}

/** what the fragment starts with */
export const LINK_PREFIX = '#tune=';
/** Longer than this and some apps cut a link short when it is pasted or sent. */
export const MAX_LINK_LENGTH = 6000;
const MAX_NOTES = 5000;
const MAX_TITLE_LENGTH = 200;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function through(stream: CompressionStream | DecompressionStream, bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

/**
 * The text that goes after LINK_PREFIX. Notes are written as whole
 * milliseconds, each start as the gap from the one before, which keeps the
 * numbers short; the lot is deflated where the browser can ("z."), and left
 * as plain JSON where it cannot ("j.").
 */
export async function encodeTune(tune: SharedTune): Promise<string> {
  const flat: number[] = [];
  let previous = 0;
  for (const note of tune.notes) {
    const start = Math.round(note.start * 1000);
    flat.push(start - previous, Math.max(1, Math.round((note.end - note.start) * 1000)), note.midi);
    previous = start;
  }
  const json = JSON.stringify({ v: 1, t: tune.title, n: flat, s: tune.settings, m: tune.marks, c: tune.clickBpm });
  const bytes = new TextEncoder().encode(json);
  if (typeof CompressionStream === 'undefined') return `j.${toBase64Url(bytes)}`;
  return `z.${toBase64Url(await through(new CompressionStream('deflate-raw'), bytes))}`;
}

/** Reads what encodeTune wrote. Anything malformed, or not a tune, comes back as null. */
export async function decodeTune(payload: string): Promise<SharedTune | null> {
  try {
    const kind = payload.slice(0, 2);
    let bytes = fromBase64Url(payload.slice(2));
    if (kind === 'z.') bytes = await through(new DecompressionStream('deflate-raw'), bytes);
    else if (kind !== 'j.') return null;
    const data = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    if (data.v !== 1 || !Array.isArray(data.n) || data.n.length % 3 !== 0 || data.n.length > MAX_NOTES * 3) return null;

    const notes: NoteEvent[] = [];
    let at = 0;
    for (let i = 0; i < data.n.length; i += 3) {
      const [gap, length, midi] = data.n.slice(i, i + 3) as unknown[];
      if (
        !Number.isInteger(gap) || !Number.isInteger(length) || !Number.isInteger(midi) ||
        (gap as number) < 0 || (length as number) < 1 || (midi as number) < 0 || (midi as number) > 127
      ) {
        return null;
      }
      at += gap as number;
      notes.push({ start: at / 1000, end: (at + (length as number)) / 1000, midi: midi as number, cents: 0, level: 0 });
    }
    if (notes.length === 0) return null;
    return {
      title: typeof data.t === 'string' ? data.t.slice(0, MAX_TITLE_LENGTH) : '',
      notes,
      settings: sanitizeSettings(data.s),
      marks: sanitizeMarks(data.m),
      clickBpm: typeof data.c === 'number' && data.c >= 30 && data.c <= 240 ? data.c : undefined,
    };
  } catch {
    return null;
  }
}
