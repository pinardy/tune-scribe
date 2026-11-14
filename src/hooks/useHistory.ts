import { useCallback, useState } from 'react';

interface Timeline<T> {
  past: T[];
  present: T;
  future: T[];
  /** what the latest change was, for folding a run of the same kind into one step */
  lastKind: string | null;
}

/** how many steps back are kept */
const LIMIT = 200;

export interface History<T> {
  value: T;
  /**
   * Makes a change that can be undone. Changes given the same `kind` one
   * after another (typing in one field, say) undo as a single step.
   */
  change: (update: (value: T) => T, kind?: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Replaces the value and forgets the history: a different document. */
  reset: (value: T) => void;
}

/** A value with an undo and redo history. */
export function useHistory<T>(initial: T): History<T> {
  const [timeline, setTimeline] = useState<Timeline<T>>({ past: [], present: initial, future: [], lastKind: null });

  const change = useCallback((update: (value: T) => T, kind?: string) => {
    setTimeline((t) => {
      const present = update(t.present);
      if (present === t.present) return t;
      if (kind && kind === t.lastKind) return { ...t, present, future: [] };
      return { past: [...t.past, t.present].slice(-LIMIT), present, future: [], lastKind: kind ?? null };
    });
  }, []);

  const undo = useCallback(() => {
    setTimeline((t) =>
      t.past.length === 0
        ? t
        : { past: t.past.slice(0, -1), present: t.past[t.past.length - 1], future: [t.present, ...t.future], lastKind: null },
    );
  }, []);

  const redo = useCallback(() => {
    setTimeline((t) =>
      t.future.length === 0
        ? t
        : { past: [...t.past, t.present], present: t.future[0], future: t.future.slice(1), lastKind: null },
    );
  }, []);

  const reset = useCallback((value: T) => setTimeline({ past: [], present: value, future: [], lastKind: null }), []);

  return {
    value: timeline.present,
    change,
    undo,
    redo,
    canUndo: timeline.past.length > 0,
    canRedo: timeline.future.length > 0,
    reset,
  };
}
