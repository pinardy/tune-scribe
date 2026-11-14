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
- Storage: the take is in IndexedDB `tune-scribe` and returns on reload.
  "Clear this tune and start over" empties it — the write is async, so wait
  ~300 ms before reloading to check.
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
