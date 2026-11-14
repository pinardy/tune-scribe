---
name: verify
description: Build, launch, and drive tune-scribe (melody-to-sheet-music PWA) headlessly to verify changes end-to-end.
---

# Verifying tune-scribe

## Fast loop: pipeline tests

```sh
npm test    # vitest, node environment, ~2 s
```

`src/transcribe/pipeline.test.ts` covers YIN, segmentation, tempo,
quantisation, spelling, bar splitting and the exports, and runs the whole
chain on synthesised audio (`synthesiseDemo` in `src/audio/demo.ts`: Ode to
Joy, D major, 120 BPM, 30 notes, 8 bars). Anything from audio to `Score` is
verifiable here without a browser. Only VexFlow rendering, the microphone
path, playback and the UI need the steps below.

## Build & serve

```sh
npm run build                                   # tsc -b && vite build
npm run preview -- --port 4199 --strictPort     # http://localhost:4199/
```

`base` is `./` — no sub-path. Block or account for the service worker when
testing fresh builds (Playwright: `service_workers="block"`), or a cached
build is served.

## Drive headlessly

Chrome args: `--use-fake-ui-for-media-stream
--autoplay-policy=no-user-gesture-required --mute-audio`.

Three ways in, easiest first:

1. **Demo** — click "Try it with a demo tune" (only on the blank sheet).
   Expect `[data-testid=heard-meta]` = "30 notes in 0:16",
   `[data-testid=sheet-key]` = "D major", tempo button "Auto, 120".
2. **File** — set a WAV on the hidden `input[type=file]`. The title becomes
   the file name without its extension.
3. **Microphone** — replace `getUserMedia` before the page loads with an
   oscillator feeding a `MediaStreamAudioDestinationNode`, and gate its gain
   per note so each has an attack (repeated notes are split on attacks):

```js
navigator.mediaDevices.getUserMedia = async () => {
  const ac = new AudioContext();
  const osc = ac.createOscillator(); osc.type = 'sawtooth';
  const gain = ac.createGain(); gain.gain.value = 0;
  const dest = ac.createMediaStreamDestination();
  osc.connect(gain); gain.connect(dest); osc.start();
  window.__play = (midis, each) => {            // null = rest
    let t = ac.currentTime + 0.3;
    for (const m of midis) {
      if (m !== null) {
        osc.frequency.setValueAtTime(440 * 2 ** ((m - 69) / 12), t);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.3, t + 0.01);
        gain.gain.setValueAtTime(0.3, t + each * 0.8);
        gain.gain.linearRampToValueAtTime(0, t + each * 0.85);
      }
      t += each;
    }
    return (t - ac.currentTime) * 1000;         // ms until the tune ends
  };
  return dest.stream;
};
```

Click the button named "Record" (`.record`, gains `.is-recording`), call
`__play`, wait, click "Stop recording". `[60,62,64,60,60,62,64,60,64,65,67,
null,64,65,67,null]` at 0.6 s each ⇒ 14 notes, C major, "Auto, 100", 4 bars
with a quarter rest ending bars 3 and 4.

## Observing state

- Score: VexFlow SVG inside `[data-testid=score]` (`.score-canvas`). Its
  `width` attribute is the layout width; under 600 px bars are packed two to
  a line. Noteheads are `g.vf-stavenote`.
- Playback: "Play score" / "Play recording" toggle to "Stop". The sounding
  notehead group gets `.is-sounding`; `rect.score-cursor` has
  `visibility="visible"` and sits behind it. Both clear on stop.
- Live recording: `.capture-status` reads "0:02 / C4 0¢ / Recording…".
- Pitch roll: `<canvas>` inside `[data-testid=roll]` (screenshot to inspect).
- Settings: segmented controls are `[role=group][aria-label=…]` with
  `button[aria-pressed]` — labels "Tempo", "Time signature", "Beat the tune
  starts on", "Shortest note written", "Clef"; key is `#key-select`.
  Persisted in localStorage `scribe.settings`; theme in `scribe.theme`.
- Exports: the buttons named "Save MusicXML" / "Save MIDI" (aria-labels;
  the visible text is "MusicXML" / "MIDI") trigger downloads named after the
  title (`Playwright: page.expect_download()`).
- Errors: `.message.is-error` (`role=alert`).

## Note editing, storage, click, exports

- Notes: each notehead group has `data-event="<index>"` and a `.score-hit`
  rect to click/tap. Picking one swaps the play buttons for `.note-editor`
  (buttons by aria-label: "Higher by a semitone", "Lower by a semitone",
  "Longer", "Shorter", "Remove this note", "Previous note", "Next note",
  "Done"); `.note-editor-what` reads e.g. "G4 note 3 of 30"; `.sheet-hint`
  counts corrections and holds "Undo all". Keys with a note picked: arrows,
  `+`/`-`, Delete, Escape.
- Storage: tunes are in IndexedDB `tune-scribe` (stores `takes` and
  `sheets`, keyed by tune id; the open one's id is localStorage
  `scribe.current`). Sheet writes are debounced 400 ms — wait ~700 ms
  before reloading to check. "Saved tunes" is a `<details class="library">`
  (tap its summary); rows are `.library-open` (current one has
  `aria-current`), delete buttons are labelled "Delete <title>" and raise a
  `confirm()`. "Put this tune away and start a new one" clears the desk and
  resets the settings; the tune stays saved.
- Link: the button labelled "Copy a link to this tune" writes
  `…/#tune=z.<payload>` to the clipboard (grant `clipboard-read` /
  `clipboard-write`). Opening it shows the score with no "Play recording"
  button, clears the hash and adds the tune to the library.
- More note tools, behind `.note-editor-more summary` (tap it first):
  chips "Split in two", "Join to next", "Length moves later notes" (off:
  Longer/Shorter move only that note's end), "Repeat from this bar" and
  "Repeat to this bar". A repeat belongs to the bar: the chip reads pressed
  from any note in it, and playback takes the passage twice.
- Sheet: the field labelled "Composer" sits under the key; lines after the
  first start with a bar number (a plain digit `<text>` in the SVG).
- Piano: eleven `.mp3` samples are fetched once a score exists (watch
  responses ending `.mp3`). Fonts are `.woff2` files beside the notation
  chunk; to check a font change, collect the private-use codepoints in the
  score's `<text>` elements and compare them with the subset's cmap. A split
  note's second half is `data-event="<1000000 + index>"`. Fields labelled
  "Chord" and "Lyric"; typing a space in Lyric steps to the next note.
  "Undo" / "Redo" buttons sit in `.sheet-foot`; Ctrl+Z / Ctrl+Shift+Z work.
- Feel: group "Feel" (Straight / Swing / Triplets). Triplets draw
  `.vf-tuplet`; swing puts "Swing" in the tempo mark. To hear either from
  the fake microphone, give `__play` per-note lengths (thirds of a beat).
- Time suggestion: `[data-testid=meter-suggestion]` with a "Use it" button;
  a waltz with a pickup played in 4/4 gives "3/4, starting on beat 3".
- Playback options: `.playback-options` — range input labelled "Score
  speed", chips "Loop" and "Click"; stored in `scribe.playback`.
- Click: `getByRole('switch')` ("Record to a click"), tempo input labelled
  "Click tempo, beats per minute". Recording then shows
  `[data-testid=count-in]` for one bar; start `__play` when it disappears.
  The result's tempo button reads "Auto, <click bpm>".
- Level advice: `[data-testid=capture-sub]` while recording; ~3 s of silence
  gives "Very quiet…".
- "Save PDF" downloads `<title>.pdf` (render it with `sips -s format png`).
  "Share" only renders where `navigator.canShare({files})` is true.
- Transpose: group "Transpose for an instrument" (Concert / B♭ / E♭ / F);
  the demo in B♭ reads "E major".

## Print

`beforeprint` makes `ScoreView` re-render at 660 px synchronously; dispatch
`window.dispatchEvent(new Event('beforeprint'))` and emulate print media to
check it. The print stylesheet forces black ink whatever the theme.

## Phone layout

Under 940 px it is one column. The pitch roll (`.heard.is-idle`) is hidden
until there is a take; a new take scrolls the sheet into view; the play
buttons (`.transport-play`) are `position: sticky` at the bottom while the
sheet is on screen. Emulate with `isMobile`/`hasTouch` so the
`(pointer: coarse)` target sizes apply.

## Theme

Same mechanism as purrfect-pitch: `html[data-theme]` (absent for system),
staff colours from `--staff-line` / `--staff-ink` read at render time, so a
theme change re-renders the score. Beams and ties must be drawn with
`drawWithStyle()` or they stay black on the dark sheet.

## Rests, runs of notes, sections, trimming

- Rests are pickable too: `[data-event]` with a negative value (the id is
  `-1 - round(startUnits * 3)`). Picking one shows "Rest in bar N" with
  "Add a note here"; the new note's `data-event` is `2000000 + id`.
- Shift-click a second note (or the chip "Pick up to another note", then a
  tap) picks a run: `.note-editor-what` reads "4 notes notes 1 to 4 of 14".
  "Up an octave" / "Down an octave" / "Other name (♯ or ♭)" are chips under
  the editor's "More".
- "Suggest chords" is a link in `.sheet-hint`; chord symbols are `<text>`
  elements in the score SVG.
- With a tune on the desk the capture panel has the group "What a new
  recording does" (Start a new tune / Add to this tune). "Record again from
  bar N" (a chip under "More") shows `[data-testid=record-from]`; the next
  take then replaces the tune from that bar. An added take starts on a bar
  line.
- "Trim the start or the end" under the pitch roll opens two sliders
  ("Keep from", "Keep to") and "Cut off the grey parts".
- Loop: the chip "Loop" shows inputs "Loop from bar" / "Loop to bar". The
  speed slider is "Playback speed" and slows the recording as well (through
  an `<audio>` element, so pitch is kept).
- "Save PDF" is vector: the file has `/FontFile2` and no `/Subtype /Image`.
  A title in a script the fonts lack (CJK, say) falls back to image pages.
