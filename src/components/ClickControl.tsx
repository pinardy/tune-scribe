// The click to record against: on or off, and how fast. A take recorded to
// it is written at that tempo instead of a guessed one.

import { MAX_BPM, MIN_BPM } from '../transcribe/settings';

export interface ClickSettings {
  on: boolean;
  /** quarter notes per minute */
  bpm: number;
}

export const DEFAULT_CLICK: ClickSettings = { on: false, bpm: 100 };

function clampBpm(bpm: number): number {
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));
}

/** Validates click settings loaded from storage. */
export function sanitizeClick(stored: unknown): ClickSettings {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<Record<keyof ClickSettings, unknown>>;
  return {
    on: s.on === true,
    bpm: typeof s.bpm === 'number' && Number.isFinite(s.bpm) ? clampBpm(s.bpm) : DEFAULT_CLICK.bpm,
  };
}

interface Props {
  click: ClickSettings;
  onChange: (next: ClickSettings) => void;
  disabled: boolean;
}

export default function ClickControl({ click, onChange, disabled }: Props) {
  return (
    <div className="click">
      <div className="click-row">
        <label className="switch">
          <input
            type="checkbox"
            role="switch"
            checked={click.on}
            disabled={disabled}
            onChange={(e) => onChange({ ...click, on: e.target.checked })}
          />
          <span>Record to a click</span>
        </label>
        {click.on && (
          <div className="stepper is-short">
            <button
              type="button"
              aria-label="Click slower by four"
              disabled={disabled}
              onClick={() => onChange({ ...click, bpm: clampBpm(click.bpm - 4) })}
            >
              −
            </button>
            <input
              type="number"
              inputMode="numeric"
              min={MIN_BPM}
              max={MAX_BPM}
              aria-label="Click tempo, beats per minute"
              value={click.bpm}
              disabled={disabled}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (Number.isFinite(value) && value > 0) onChange({ ...click, bpm: clampBpm(value) });
              }}
            />
            <button
              type="button"
              aria-label="Click faster by four"
              disabled={disabled}
              onClick={() => onChange({ ...click, bpm: clampBpm(click.bpm + 4) })}
            >
              +
            </button>
          </div>
        )}
      </div>
      {click.on && (
        <p className="field-note">
          One bar of count-in, then play along. Wear headphones so the click isn’t recorded with you.
        </p>
      )}
    </div>
  );
}
