// The fonts VexFlow draws with. `vexflow/core` comes without any; these are
// fetched beside it: Bravura cut down to the glyphs a single melodic line
// uses (scripts/build-fonts.py), and Academico for text. Importing this
// module registers them, so anything that draws notation imports it first.

import { Font, VexFlow } from 'vexflow/core';
import academicoBoldUrl from './fonts/academico-bold.woff2?url';
import academicoUrl from './fonts/academico.woff2?url';
import musicUrl from './fonts/music.woff2?url';

// 'block': noteheads must never be drawn in a fallback face
void Font.load('Bravura', musicUrl, { display: 'block' }).catch(() => {});
void Font.load('Academico', academicoUrl, { display: 'swap' }).catch(() => {});
void Font.load('Academico', academicoBoldUrl, { display: 'swap', weight: 'bold' }).catch(() => {});
VexFlow.setFonts('Bravura', 'Academico');
