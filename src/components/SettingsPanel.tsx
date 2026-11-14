// Controls for how the heard notes are written. Each automatic choice shows
// what was detected, so an override is a correction rather than a guess.

import type { Key } from '../notation/theory';
import { MAJOR_TONICS, MINOR_TONICS, keyLabel } from '../notation/theory';
import type { Arrangement } from '../transcribe';
import type { Feel } from '../transcribe/feel';
import type { Clef, TimeSignature } from '../transcribe/score';
import { METERS } from '../transcribe/score';
import type { ScribeSettings } from '../transcribe/settings';
import { DEFAULT_SETTINGS, MAX_BPM, MAX_TRANSPOSE, MIN_BPM, feltBeats } from '../transcribe/settings';

interface Props {
  settings: ScribeSettings;
  onChange: (next: ScribeSettings) => void;
  /** what was worked out from the current take, if there is one */
  detected: Arrangement['detected'] | null;
}

const TIME_SIGNATURES = Object.keys(METERS) as TimeSignature[];

/** Written pitch above concert pitch for the common transposing instruments. */
const INSTRUMENTS = [
  { value: 0, label: 'Concert' },
  { value: 2, label: 'B♭' },
  { value: 9, label: 'E♭' },
  { value: 7, label: 'F' },
];
const INSTRUMENT_NOTE: Record<number, string> = {
  2: 'Reads right on a B♭ instrument: clarinet, trumpet, soprano sax (tenor sax an octave higher).',
  9: 'Reads right on an E♭ instrument: alto sax (baritone sax an octave higher).',
  7: 'Reads right on an F instrument: French horn, cor anglais.',
};

function semitones(n: number): string {
  if (n === 0) return 'As heard';
  return `${n > 0 ? '+' : '−'}${Math.abs(n)} semitone${Math.abs(n) === 1 ? '' : 's'}`;
}

function clampBpm(bpm: number): number {
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));
}

function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function SettingsPanel({ settings, onChange, detected }: Props) {
  const set = (patch: Partial<ScribeSettings>) => onChange({ ...settings, ...patch });
  const auto = settings.tempo === 'auto';
  const heardBpm = detected?.bpm ?? 100;
  const bpm = auto ? heardBpm : (settings.tempo as number);
  const beats = feltBeats(settings.timeSignature);
  const keyValue = settings.key === 'auto' ? 'auto' : `${settings.key.tonic}|${settings.key.mode}`;
  const isDefault = JSON.stringify(settings) === JSON.stringify(DEFAULT_SETTINGS);
  const shakyTempo = auto && detected !== null && detected.tempoConfidence < 0.5;
  const transposeBy = (n: number) =>
    set({ transpose: Math.min(MAX_TRANSPOSE, Math.max(-MAX_TRANSPOSE, settings.transpose + n)) });

  return (
    <section className="settings" aria-labelledby="settings-heading">
      <div className="settings-head">
        <h2 id="settings-heading">How it’s written</h2>
        {!isDefault && (
          <button type="button" className="link" onClick={() => onChange(DEFAULT_SETTINGS)}>
            Back to automatic
          </button>
        )}
      </div>

      <div className="field">
        <span className="field-label" id="tempo-label">
          Tempo
        </span>
        <div className="field-body">
          <Segmented
            label="Tempo"
            value={auto ? 'auto' : 'set'}
            options={[
              { value: 'auto', label: detected ? `Auto, ${heardBpm}` : 'Auto' },
              { value: 'set', label: 'Set' },
            ]}
            onChange={(v) => set({ tempo: v === 'auto' ? 'auto' : clampBpm(bpm) })}
          />
          <div className="stepper">
            <button type="button" aria-label="Halve the tempo" onClick={() => set({ tempo: clampBpm(bpm / 2) })}>
              ÷2
            </button>
            <button type="button" aria-label="Slower by one" onClick={() => set({ tempo: clampBpm(bpm - 1) })}>
              −
            </button>
            <input
              type="number"
              inputMode="numeric"
              min={MIN_BPM}
              max={MAX_BPM}
              aria-labelledby="tempo-label"
              value={bpm}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (Number.isFinite(value) && value > 0) set({ tempo: clampBpm(value) });
              }}
            />
            <button type="button" aria-label="Faster by one" onClick={() => set({ tempo: clampBpm(bpm + 1) })}>
              +
            </button>
            <button type="button" aria-label="Double the tempo" onClick={() => set({ tempo: clampBpm(bpm * 2) })}>
              ×2
            </button>
          </div>
          {shakyTempo && (
            <p className="field-note">
              The beat wasn’t steady enough to be sure of this. If the rhythm looks wrong, set the tempo yourself.
            </p>
          )}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Time</span>
        <div className="field-body">
          <Segmented
            label="Time signature"
            value={settings.timeSignature}
            options={TIME_SIGNATURES.map((t) => ({ value: t, label: t }))}
            onChange={(timeSignature) =>
              set({ timeSignature, startBeat: Math.min(settings.startBeat, feltBeats(timeSignature)) })
            }
          />
        </div>
      </div>

      <div className="field">
        <span className="field-label">Starts on beat</span>
        <div className="field-body">
          <Segmented
            label="Beat the tune starts on"
            value={settings.startBeat}
            options={Array.from({ length: beats }, (_, i) => ({ value: i + 1, label: String(i + 1) }))}
            onChange={(startBeat) => set({ startBeat })}
          />
        </div>
      </div>

      <div className="field">
        <span className="field-label">Shortest note</span>
        <div className="field-body">
          <Segmented<1 | 2>
            label="Shortest note written"
            value={settings.finest}
            options={[
              { value: 2, label: 'Eighth' },
              { value: 1, label: 'Sixteenth' },
            ]}
            onChange={(finest) => set({ finest })}
          />
        </div>
      </div>

      {METERS[settings.timeSignature].beatUnits === 4 && (
        <div className="field">
          <span className="field-label">Feel</span>
          <div className="field-body">
            <Segmented<Feel>
              label="Feel"
              value={settings.feel}
              options={[
                { value: 'straight', label: 'Straight' },
                { value: 'swing', label: 'Swing' },
                { value: 'triplets', label: 'Triplets' },
              ]}
              onChange={(feel) => set({ feel })}
            />
            {settings.feel !== 'straight' && auto && (
              <p className="field-note">
                {settings.feel === 'swing'
                  ? 'Long-short eighths are written as even ones.'
                  : 'A beat can be cut in three.'}{' '}
                The tempo is harder to hear this way: if the rhythm looks wrong, set it, or record to a click.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="field">
        <label className="field-label" htmlFor="key-select">
          Key
        </label>
        <div className="field-body">
          <select
            id="key-select"
            value={keyValue}
            onChange={(e) => {
              if (e.target.value === 'auto') return set({ key: 'auto' });
              const [tonic, mode] = e.target.value.split('|');
              set({ key: { tonic, mode: mode as Key['mode'] } });
            }}
          >
            <option value="auto">{detected ? `Auto, ${keyLabel(detected.key)}` : 'Auto'}</option>
            <optgroup label="Major">
              {MAJOR_TONICS.map((tonic) => (
                <option key={tonic} value={`${tonic}|major`}>
                  {keyLabel({ tonic, mode: 'major' })}
                </option>
              ))}
            </optgroup>
            <optgroup label="Minor">
              {MINOR_TONICS.map((tonic) => (
                <option key={tonic} value={`${tonic}|minor`}>
                  {keyLabel({ tonic, mode: 'minor' })}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
      </div>

      <div className="field">
        <span className="field-label">Transpose</span>
        <div className="field-body">
          <Segmented label="Transpose for an instrument" value={settings.transpose} options={INSTRUMENTS} onChange={(transpose) => set({ transpose })} />
          <div className="stepper is-short">
            <button type="button" aria-label="Down a semitone" onClick={() => transposeBy(-1)} disabled={settings.transpose <= -MAX_TRANSPOSE}>
              −
            </button>
            <output aria-live="polite">{semitones(settings.transpose)}</output>
            <button type="button" aria-label="Up a semitone" onClick={() => transposeBy(1)} disabled={settings.transpose >= MAX_TRANSPOSE}>
              +
            </button>
          </div>
          {INSTRUMENT_NOTE[settings.transpose] && <p className="field-note">{INSTRUMENT_NOTE[settings.transpose]}</p>}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Clef</span>
        <div className="field-body">
          <Segmented<'auto' | Clef>
            label="Clef"
            value={settings.clef}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'treble', label: 'Treble' },
              { value: 'bass', label: 'Bass' },
            ]}
            onChange={(clef) => set({ clef })}
          />
        </div>
      </div>
    </section>
  );
}
