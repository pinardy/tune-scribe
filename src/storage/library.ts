// The saved tunes. A take (audio and analysis) is too big for localStorage,
// so tunes live in IndexedDB, in two stores keyed by the tune's id: the take,
// written once, and beside it the small things that change often and that the
// list of tunes is drawn from (title, marks, settings).

import type { Analysis } from '../audio/analyse';
import type { Marks } from '../transcribe/marks';
import { sanitizeMarks } from '../transcribe/marks';
import type { Segmentation } from '../transcribe/segment';
import type { ScribeSettings } from '../transcribe/settings';
import { sanitizeSettings } from '../transcribe/settings';

export interface StoredTake {
  source: string;
  /** tempo of the click it was recorded to, if any */
  clickBpm?: number;
  /** null for a tune that arrived as a link: the notes without the sound */
  analysis: Analysis | null;
  heard: Segmentation;
}

export interface StoredSheet {
  title: string;
  marks: Marks;
  /** how this tune is written; reopening it puts these back */
  settings: ScribeSettings;
}

/** One line of the list of saved tunes. */
export interface TuneSummary {
  id: string;
  title: string;
  /** ms since the epoch */
  updatedAt: number;
  notes: number;
  seconds: number;
}

const DB_NAME = 'tune-scribe';
const TAKES = 'takes';
const SHEETS = 'sheets';
const VERSION = 2;
const CURRENT_KEY = 'scribe.current';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      // version 1 held a single unnamed tune; it never shipped, so it is not carried over
      if (db.objectStoreNames.contains('current')) db.deleteObjectStore('current');
      if (!db.objectStoreNames.contains(TAKES)) db.createObjectStore(TAKES);
      if (!db.objectStoreNames.contains(SHEETS)) db.createObjectStore(SHEETS);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  work: (takes: IDBObjectStore, sheets: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction([TAKES, SHEETS], mode);
      const request = work(tx.objectStore(TAKES), tx.objectStore(SHEETS));
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export function newTuneId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The tune that was open last, to come back to after a reload. */
export function currentTuneId(): string | null {
  try {
    return localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}

export function setCurrentTuneId(id: string | null): void {
  try {
    if (id) localStorage.setItem(CURRENT_KEY, id);
    else localStorage.removeItem(CURRENT_KEY);
  } catch {
    // storage unavailable: the tune just won't reopen by itself
  }
}

interface SheetRecord extends StoredSheet {
  updatedAt: number;
  notes: number;
  seconds: number;
}

function sheetRecord(take: StoredTake, sheet: StoredSheet): SheetRecord {
  const notes = take.heard.notes;
  return {
    ...sheet,
    updatedAt: Date.now(),
    notes: notes.length,
    seconds: take.analysis?.track.duration ?? (notes.length ? notes[notes.length - 1].end : 0),
  };
}

// Storage can be missing or full (private windows, a long take on a small
// phone). Saving then reports false, and the tune lasts only until the page
// is closed; nothing else depends on it.

export async function saveTune(id: string, take: StoredTake, sheet: StoredSheet): Promise<boolean> {
  try {
    await run('readwrite', (takes, sheets) => {
      takes.put(take, id);
      sheets.put(sheetRecord(take, sheet), id);
    });
    return true;
  } catch {
    return false;
  }
}

/** Rewrites the small part of a tune that is already saved. */
export async function saveSheet(id: string, take: StoredTake, sheet: StoredSheet): Promise<boolean> {
  try {
    await run('readwrite', (_, sheets) => void sheets.put(sheetRecord(take, sheet), id));
    return true;
  } catch {
    return false;
  }
}

export async function deleteTune(id: string): Promise<void> {
  try {
    await run('readwrite', (takes, sheets) => {
      takes.delete(id);
      sheets.delete(id);
    });
  } catch {
    // nothing to delete
  }
}

function isTake(value: unknown): value is StoredTake {
  const t = value as Partial<StoredTake> | undefined;
  return (
    !!t &&
    typeof t.source === 'string' &&
    (t.analysis === null ||
      (t.analysis?.track?.midi instanceof Float32Array && t.analysis.audio?.pcm instanceof Float32Array)) &&
    Array.isArray(t.heard?.notes) &&
    t.heard.contour instanceof Float32Array
  );
}

export async function loadTune(id: string): Promise<(StoredTake & StoredSheet) | null> {
  try {
    const take = await run<unknown>('readonly', (takes) => takes.get(id));
    if (!isTake(take)) return null;
    const sheet = (await run<unknown>('readonly', (_, sheets) => sheets.get(id))) as Partial<SheetRecord> | undefined;
    return {
      source: take.source,
      clickBpm: typeof take.clickBpm === 'number' ? take.clickBpm : undefined,
      analysis: take.analysis,
      heard: take.heard,
      title: typeof sheet?.title === 'string' ? sheet.title : '',
      marks: sanitizeMarks(sheet?.marks),
      settings: sanitizeSettings(sheet?.settings),
    };
  } catch {
    return null;
  }
}

/** The saved tunes, most recently touched first. */
export async function listTunes(): Promise<TuneSummary[]> {
  try {
    const db = await open();
    try {
      return await new Promise<TuneSummary[]>((resolve, reject) => {
        const out: TuneSummary[] = [];
        const tx = db.transaction(SHEETS, 'readonly');
        const cursor = tx.objectStore(SHEETS).openCursor();
        cursor.onsuccess = () => {
          const at = cursor.result;
          if (!at) return;
          const sheet = at.value as Partial<SheetRecord>;
          out.push({
            id: String(at.key),
            title: typeof sheet.title === 'string' ? sheet.title : '',
            updatedAt: typeof sheet.updatedAt === 'number' ? sheet.updatedAt : 0,
            notes: typeof sheet.notes === 'number' ? sheet.notes : 0,
            seconds: typeof sheet.seconds === 'number' ? sheet.seconds : 0,
          });
          at.continue();
        };
        tx.oncomplete = () => resolve(out.sort((a, b) => b.updatedAt - a.updatedAt));
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}
