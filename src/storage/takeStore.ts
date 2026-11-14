// Keeps the current tune across reloads. The take (audio and analysis) is too
// big for localStorage, so it goes in IndexedDB; the small things that change
// often (title, note edits) are stored beside it and written on their own.

import type { Analysis } from '../audio/analyse';
import type { Marks } from '../transcribe/marks';
import { sanitizeMarks } from '../transcribe/marks';
import type { Segmentation } from '../transcribe/segment';

export interface StoredTake {
  source: string;
  /** tempo of the click it was recorded to, if any */
  clickBpm?: number;
  analysis: Analysis;
  heard: Segmentation;
}

export interface StoredSheet {
  title: string;
  marks: Marks;
}

const DB_NAME = 'tune-scribe';
const STORE = 'current';
const VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

// Storage can be missing or full (private windows, a long take on a small
// phone). The tune then just won't survive a reload; nothing else depends on it.

export async function saveTake(take: StoredTake, sheet: StoredSheet): Promise<void> {
  try {
    await run('readwrite', (store) => {
      store.put({ version: VERSION, ...take }, 'take');
      store.put(sheet, 'sheet');
    });
  } catch {
    // not saved
  }
}

export async function saveSheet(sheet: StoredSheet): Promise<void> {
  try {
    await run('readwrite', (store) => void store.put(sheet, 'sheet'));
  } catch {
    // not saved
  }
}

export async function clearTake(): Promise<void> {
  try {
    await run('readwrite', (store) => void store.clear());
  } catch {
    // nothing to clear
  }
}

function isTake(value: unknown): value is StoredTake & { version: number } {
  const t = value as Partial<StoredTake & { version: number }> | undefined;
  return (
    !!t &&
    t.version === VERSION &&
    typeof t.source === 'string' &&
    t.analysis?.track?.midi instanceof Float32Array &&
    t.analysis.audio?.pcm instanceof Float32Array &&
    Array.isArray(t.heard?.notes) &&
    t.heard.contour instanceof Float32Array
  );
}

export async function loadTake(): Promise<(StoredTake & StoredSheet) | null> {
  try {
    const take = await run<unknown>('readonly', (store) => store.get('take'));
    if (!isTake(take)) return null;
    const sheet = (await run<unknown>('readonly', (store) => store.get('sheet'))) as Partial<StoredSheet> | undefined;
    return {
      source: take.source,
      clickBpm: typeof take.clickBpm === 'number' ? take.clickBpm : undefined,
      analysis: take.analysis,
      heard: take.heard,
      title: typeof sheet?.title === 'string' ? sheet.title : '',
      marks: sanitizeMarks(sheet?.marks),
    };
  } catch {
    return null;
  }
}
