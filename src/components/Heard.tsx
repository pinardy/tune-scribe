// What was heard: the pitch trace with the notes it was cut into, and the
// way to cut dead air or a false start off either end of the take.

import { useEffect, useState, type MutableRefObject } from 'react';
import { clock } from '../app/format';
import PitchRoll, { type HeardTake, type LiveTrace } from './PitchRoll';

interface Props {
  /** the take on the desk, if there is one */
  take: HeardTake | null;
  /** how sharp (+) or flat (−) the take sits overall, in cents */
  tuning: number;
  recording: boolean;
  live: MutableRefObject<LiveTrace>;
  activeEvent: number | null;
  /** whether the take can be trimmed now (nothing else is going on) */
  canTrim: boolean;
  /** Keeps the part of the take between these seconds. */
  onTrim: (from: number, to: number) => void;
}

/** the shortest stretch a take can be trimmed to */
const MIN_KEPT_SECONDS = 0.5;
const STEP = 0.05;

export default function Heard({ take, tuning, recording, live, activeEvent, canTrim, onTrim }: Props) {
  /** the seconds that would be kept, while the take is being trimmed */
  const [keep, setKeep] = useState<[number, number] | null>(null);
  useEffect(() => setKeep(null), [take]);

  const duration = take?.duration ?? 0;
  const count = take?.notes.length ?? 0;
  const trimming = keep !== null && canTrim && !recording;
  const tenths = (seconds: number) => `${seconds.toFixed(1)} s`;

  return (
    <section className={`heard${take || recording ? '' : ' is-idle'}`} aria-labelledby="heard-heading">
      <div className="heard-head">
        <h2 id="heard-heading">What was heard</h2>
        {take && !recording && (
          <span className="heard-meta" data-testid="heard-meta">
            {count} {count === 1 ? 'note' : 'notes'} in {clock(duration)}
            {Math.abs(tuning) >= 8 && `, ${Math.abs(tuning)}¢ ${tuning > 0 ? 'sharp' : 'flat'} overall`}
          </span>
        )}
      </div>
      <PitchRoll
        live={recording ? live : null}
        take={recording ? null : take}
        activeEvent={activeEvent}
        keep={trimming ? keep : null}
      />
      {take && count > 0 && canTrim && !recording && duration > 2 * MIN_KEPT_SECONDS && (
        trimming ? (
          <div className="trim" role="group" aria-label="Trim the take">
            <label>
              <span>Start</span>
              <input
                type="range"
                aria-label="Keep from"
                min={0}
                max={duration}
                step={STEP}
                value={keep[0]}
                onChange={(e) => setKeep([Math.min(Number(e.target.value), keep[1] - MIN_KEPT_SECONDS), keep[1]])}
              />
              <output>{tenths(keep[0])}</output>
            </label>
            <label>
              <span>End</span>
              <input
                type="range"
                aria-label="Keep to"
                min={0}
                max={duration}
                step={STEP}
                value={keep[1]}
                onChange={(e) => setKeep([keep[0], Math.max(Number(e.target.value), keep[0] + MIN_KEPT_SECONDS)])}
              />
              <output>{tenths(keep[1])}</output>
            </label>
            <div className="trim-actions">
              <button
                type="button"
                className="button is-primary"
                disabled={keep[0] <= 0 && keep[1] >= duration}
                onClick={() => onTrim(keep[0], keep[1])}
              >
                Cut off the grey parts
              </button>
              <button type="button" className="button" onClick={() => setKeep(null)}>
                Cancel
              </button>
            </div>
            <p className="field-note">The parts cut off are gone for good, sound and notes both.</p>
          </div>
        ) : (
          <button type="button" className="link trim-open" onClick={() => setKeep([0, duration])}>
            Trim the start or the end
          </button>
        )
      )}
    </section>
  );
}
