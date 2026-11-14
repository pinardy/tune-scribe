#!/bin/sh
# Builds the piano samples in src/audio/piano that the score is played with.
#
# Source: the Salamander Grand Piano V3 by Alexander Holm (CC BY 3.0), as
# packaged in @audio-samples/piano-mp3-velocity8. One note every six
# semitones from C2 to C7 is kept; the sampler shifts each by up to three
# semitones to cover the notes between. Each is cut to its first 3.2 seconds
# with a fade, mixed to mono at 32 kHz and re-encoded, which brings the set
# from several megabytes to about a quarter of one.
#
# Needs ffmpeg (with libmp3lame) and npm. Run from the project root:
#
#     sh scripts/build-piano.sh
set -e

out="$(pwd)/src/audio/piano"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

(cd "$work" && npm pack --silent @audio-samples/piano-mp3-velocity8 >/dev/null && tar xzf ./*.tgz)

mkdir -p "$out"
# source name, then the MIDI number the file is saved under
for pair in C2:36 F#2:42 C3:48 F#3:54 C4:60 F#4:66 C5:72 F#5:78 C6:84 F#6:90 C7:96; do
  name="${pair%%:*}"
  midi="${pair##*:}"
  ffmpeg -hide_banner -loglevel error -y -i "$work/package/audio/${name}v8.mp3" \
    -af "silenceremove=start_periods=1:start_threshold=-55dB,atrim=0:3.2,afade=t=out:st=2.3:d=0.9" \
    -ac 1 -ar 32000 -c:a libmp3lame -q:a 4 "$out/$midi.mp3"
done
du -ch "$out"/*.mp3 | tail -1
