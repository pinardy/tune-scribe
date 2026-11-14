#!/usr/bin/env python3
"""Builds the font files in src/notation/fonts from the ones VexFlow ships.

VexFlow's `vexflow/bravura` entry carries its fonts inside the JavaScript as
base64. Bravura is most of that: about 250 kB for some four thousand glyphs,
of which a score here uses a few dozen. This writes

  music.woff2           Bravura cut down to the ranges listed below
  academico.woff2       the text face, as shipped
  academico-bold.woff2

so the app can load `vexflow/core` (no fonts inside) and fetch these beside it.

Run after a VexFlow upgrade, or after adding notation that needs glyphs from
a range not listed here:

    pip install fonttools brotli
    python3 scripts/build-fonts.py

Bravura is under the SIL Open Font License with "Bravura" as a reserved
name, which a modified copy may not keep; the subset is therefore renamed
inside the file. (The app still registers it under the CSS family name
"Bravura", which is where VexFlow looks for its music font.)
"""

import base64
import io
import pathlib
import re

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'node_modules/vexflow/build/esm/src/fonts'
OUT = ROOT / 'src/notation/fonts'
SUBSET_NAME = 'Scribe Music'

# SMuFL ranges, generously: everything a single melodic line can call for.
RANGES = [
    (0x0020, 0x007E),  # ASCII, for text set in the music font
    (0xE000, 0xE04F),  # staff brackets, staves, barlines, repeats
    (0xE050, 0xE07F),  # clefs
    (0xE080, 0xE09F),  # time signatures
    (0xE0A0, 0xE0FF),  # noteheads
    (0xE1D0, 0xE1FF),  # individual notes, augmentation dot
    (0xE210, 0xE25F),  # stems, flags
    (0xE260, 0xE26F),  # standard accidentals
    (0xE4A0, 0xE4FF),  # articulation, holds and pauses, rests
    (0xE500, 0xE54F),  # bar repeats, octaves
    (0xE880, 0xE88F),  # tuplets
    (0xECA0, 0xECBF),  # metronome marks
]


def woff2_bytes(module: str) -> bytes:
    text = (SOURCE / module).read_text()
    return base64.b64decode(re.search(r'base64,([A-Za-z0-9+/=]+)', text).group(1))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'academico.woff2').write_bytes(woff2_bytes('academico.js'))
    (OUT / 'academico-bold.woff2').write_bytes(woff2_bytes('academicobold.js'))

    font = TTFont(io.BytesIO(woff2_bytes('bravura.js')))
    options = subset.Options()
    options.flavor = 'woff2'
    options.layout_features = ['*']
    options.name_IDs = ['*']
    options.notdef_outline = True
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=[cp for lo, hi in RANGES for cp in range(lo, hi + 1)])
    subsetter.subset(font)

    for record in font['name'].names:
        if record.nameID in (1, 3, 4, 6, 16):  # family, unique id, full name, PostScript name
            name = SUBSET_NAME.replace(' ', '') if record.nameID == 6 else SUBSET_NAME
            record.string = name
    font.flavor = 'woff2'
    font.save(OUT / 'music.woff2')

    for path in sorted(OUT.glob('*.woff2')):
        print(f'{path.relative_to(ROOT)}  {path.stat().st_size / 1024:.1f} kB')


if __name__ == '__main__':
    main()
