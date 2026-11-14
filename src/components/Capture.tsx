// Audio in: the record button with what it is doing beside it, the file
// button, the click to record against, and whatever has to be said about
// how that went.

import { useRef, type ReactNode } from 'react';
import { clock } from '../app/format';
import type { RecorderState } from '../app/useRecorder';
import { recordingSupported } from '../audio/capture';
import { ADVICE_TEXT } from '../audio/levelWatch';
import { midiToName } from '../notation/theory';
import ClickControl, { type ClickSettings } from './ClickControl';
import Icon from './Icon';

/** What is being done to audio that has come in. */
export interface Working {
  label: string;
  /** 0…1, or null when there is no telling how far along it is */
  progress: number | null;
}

export interface CaptureTarget {
  /** new audio is added to the end of the tune on the desk, rather than starting a new one */
  adding: boolean;
  onAdding: (adding: boolean) => void;
  /** set when new audio is to replace the tune from this bar on */
  fromBar: number | null;
  onCancelFrom: () => void;
}

interface Props {
  recorder: RecorderState;
  working: Working | null;
  onFile: (file: File) => void;
  click: ClickSettings;
  onClick: (click: ClickSettings) => void;
  error: string | null;
  notice: string | null;
  /** where the next recording or file goes, while there is a tune on the desk it could go into */
  target: CaptureTarget | null;
  /** what follows in the same section: the way back to a blank sheet, the saved tunes */
  children?: ReactNode;
}

export default function Capture({ recorder, working, onFile, click, onClick, error, notice, target, children }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const { recording, countIn, elapsed, hearing, advice } = recorder;
  const busy = recording || working !== null;

  return (
    <section className="capture" aria-label="Audio in">
      <div className="capture-actions">
        <button
          type="button"
          className={`record${recording ? ' is-recording' : ''}`}
          onClick={() => void (recording ? recorder.finish() : recorder.begin())}
          disabled={working !== null || !recordingSupported()}
          aria-label={recording ? 'Stop recording' : 'Record'}
        >
          <span className="record-glyph" aria-hidden="true" />
        </button>
        <div className="capture-status" aria-live="polite">
          {recording ? (
            <>
              <span className="capture-main">
                {countIn !== null ? (
                  <span className="count-in" data-testid="count-in">
                    Count-in <strong>{countIn}</strong>
                  </span>
                ) : (
                  <span className="clock">{clock(elapsed)}</span>
                )}
                <span className="hearing">
                  {hearing ? (
                    <>
                      {midiToName(hearing.midi)}{' '}
                      <small>
                        {hearing.cents > 0 ? '+' : hearing.cents < 0 ? '−' : ''}
                        {Math.abs(hearing.cents)}¢
                      </small>
                    </>
                  ) : (
                    <small>no pitch</small>
                  )}
                </span>
              </span>
              <span className={`capture-sub${advice ? ' is-advice' : ''}`} data-testid="capture-sub">
                {countIn !== null
                  ? 'Come in after the count.'
                  : advice
                    ? ADVICE_TEXT[advice]
                    : 'Recording. Press stop when the tune is done.'}
              </span>
            </>
          ) : working ? (
            <>
              <span className="capture-main">{working.label}</span>
              <progress
                max={1}
                {...(working.progress === null ? {} : { value: working.progress })}
                aria-label={working.label}
              />
            </>
          ) : (
            <>
              <span className="capture-main">
                {target?.fromBar ? `Record bar ${target.fromBar} onward` : target?.adding ? 'Record the next part' : 'Record a melody'}
              </span>
              <span className="capture-sub">
                {recordingSupported()
                  ? 'Hum, whistle, sing or play one note at a time.'
                  : 'This browser can’t record here. Open an audio file instead.'}
              </span>
            </>
          )}
        </div>
      </div>

      {target &&
        (target.fromBar ? (
          <p className="message" data-testid="record-from">
            The next recording or file replaces this tune from bar {target.fromBar} to the end.{' '}
            <button type="button" className="link" onClick={target.onCancelFrom} disabled={busy}>
              Cancel
            </button>
          </p>
        ) : (
          <div className="segmented capture-target" role="group" aria-label="What a new recording does">
            <button type="button" aria-pressed={!target.adding} onClick={() => target.onAdding(false)} disabled={busy}>
              Start a new tune
            </button>
            <button type="button" aria-pressed={target.adding} onClick={() => target.onAdding(true)} disabled={busy}>
              Add to this tune
            </button>
          </div>
        ))}

      <button type="button" className="button" onClick={() => fileInput.current?.click()} disabled={busy}>
        <Icon name="open" />
        Open audio file
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="audio/*,.mp3,.m4a,.wav,.ogg,.flac,.aac"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ''; // let the same file be chosen again
          if (file) onFile(file);
        }}
      />

      <ClickControl click={click} onChange={onClick} disabled={busy || !recordingSupported()} />

      {error && (
        <p className="message is-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="message">{notice}</p>}
      {children}
    </section>
  );
}
