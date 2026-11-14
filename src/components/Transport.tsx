// Under the sheet: the play buttons (or, while a note is picked, the note
// editor in their place), how the score is played, and the ways to take the
// tune away.

import type { Exports } from '../app/useExports';
import { MAX_SPEED, MIN_SPEED, type PlaybackState } from '../app/usePlayback';
import Icon from './Icon';
import NoteEditor, { type NoteEditorProps } from './NoteEditor';

interface Props {
  playback: PlaybackState;
  /** whether there is a recording to play as well as the score */
  hasRecording: boolean;
  /** the picked note's tools; null when no note is picked */
  editor: NoteEditorProps | null;
  exports: Exports;
}

export default function Transport({ playback, hasRecording, editor, exports }: Props) {
  const { playing, prefs, setPrefs, toggle } = playback;
  return (
    <div className="transport">
      {editor ? (
        <NoteEditor {...editor} />
      ) : (
        <>
          <div className="transport-group transport-play">
            <button
              type="button"
              className="button is-primary"
              onClick={() => void toggle('score')}
              aria-pressed={playing === 'score'}
            >
              <Icon name={playing === 'score' ? 'stop' : 'play'} />
              {playing === 'score' ? 'Stop' : 'Play score'}
            </button>
            {hasRecording && (
              <button
                type="button"
                className="button"
                onClick={() => void toggle('recording')}
                aria-pressed={playing === 'recording'}
              >
                <Icon name={playing === 'recording' ? 'stop' : 'play'} />
                {playing === 'recording' ? 'Stop' : 'Play recording'}
              </button>
            )}
          </div>
          <div className="playback-options">
            <label className="speed" title="How fast the score is played; the recording plays as it was">
              <span>Speed</span>
              <input
                aria-label="Score speed"
                type="range"
                min={MIN_SPEED * 100}
                max={MAX_SPEED * 100}
                step={5}
                value={Math.round(prefs.speed * 100)}
                onChange={(e) => setPrefs({ ...prefs, speed: Number(e.target.value) / 100 })}
              />
              <output>{Math.round(prefs.speed * 100)}%</output>
            </label>
            <button
              type="button"
              className="chip"
              aria-pressed={prefs.loop}
              onClick={() => setPrefs({ ...prefs, loop: !prefs.loop })}
            >
              Loop
            </button>
            <button
              type="button"
              className="chip"
              aria-pressed={prefs.click}
              onClick={() => setPrefs({ ...prefs, click: !prefs.click })}
            >
              Click
            </button>
          </div>
        </>
      )}
      <div className="transport-group transport-save">
        {exports.shareable && (
          <button type="button" className="button" onClick={() => void exports.share()} disabled={exports.busy}>
            <Icon name="share" />
            Share
          </button>
        )}
        <button
          type="button"
          className="button"
          onClick={() => void exports.savePdf()}
          disabled={exports.busy}
          aria-label="Save PDF"
        >
          <Icon name="save" />
          PDF
        </button>
        <button type="button" className="button" onClick={exports.saveMusicXml} aria-label="Save MusicXML">
          <Icon name="save" />
          MusicXML
        </button>
        <button type="button" className="button" onClick={exports.saveMidi} aria-label="Save MIDI">
          <Icon name="save" />
          MIDI
        </button>
        <button type="button" className="button" onClick={() => window.print()}>
          <Icon name="print" />
          Print
        </button>
        <button
          type="button"
          className="button"
          onClick={() => void exports.copyLink()}
          aria-label="Copy a link to this tune"
        >
          <Icon name="link" />
          Link
        </button>
      </div>
    </div>
  );
}
