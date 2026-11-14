// The score as a PDF: laid out at print width, drawn page by page on a
// canvas with VexFlow's canvas backend, and handed to the PDF writer as
// greyscale images. Lives in the notation chunk; load it with import().

import { Renderer } from 'vexflow/core';
import { SYSTEM_GAP, drawSystems, layoutScore, systemHeight } from '../notation/renderScore';
import type { Score } from '../transcribe/score';
import { A4, LETTER, buildPdf, type PageSize, type PdfPage } from './pdf';

/** Width the score is set at: the same as the print stylesheet's (PRINT_WIDTH in ScoreView). */
const SCORE_WIDTH = 660;
const MARGIN = 60;
/** room for the title and the key above the first system */
const HEADING = 78;
/** canvas pixels per layout px: about 230 dpi on the page */
const SCALE = 2.5;
const BLACK = { line: '#000', ink: '#000' };

/** US Letter where it is the paper in the printer, A4 everywhere else. */
function localPageSize(): PageSize {
  return /^en-(US|CA)\b/.test(navigator.language) ? LETTER : A4;
}

/**
 * @param subtitle  the line under the title (the key)
 * @param composer  set at the right, above the first line of music; may be empty
 */
export async function scorePdf(score: Score, title: string, subtitle: string, composer = ''): Promise<Uint8Array> {
  // the music and text fonts VexFlow registers; canvas text needs them loaded
  await Promise.all([document.fonts.load('30px Bravura'), document.fonts.load('12px Academico')]).catch(() => {});

  const size = localPageSize();
  const pageWidth = SCORE_WIDTH + 2 * MARGIN;
  const pageHeight = Math.floor((pageWidth * size.height) / size.width);
  const layout = layoutScore(score, SCORE_WIDTH);
  if (!layout) throw new Error('There is no score to export.');

  // fill each page with as many whole systems as fit
  const pageRanges: [number, number][] = [];
  let from = 0;
  let used = HEADING;
  layout.systems.forEach((system, s) => {
    const height = systemHeight(system);
    if (s > from && used + height > pageHeight - 2 * MARGIN) {
      pageRanges.push([from, s]);
      from = s;
      used = 0;
    }
    used += height + SYSTEM_GAP;
  });
  pageRanges.push([from, layout.systems.length]);

  const pages: PdfPage[] = [];
  for (const [index, [first, end]] of pageRanges.entries()) {
    const canvas = document.createElement('canvas');
    const ctx = new Renderer(canvas, Renderer.Backends.CANVAS).getContext();
    // sets the backing size and the scale; the device's own pixel ratio is not wanted here
    (ctx as unknown as { resize(w: number, h: number, dpr: number): void }).resize(pageWidth, pageHeight, SCALE);
    const c = canvas.getContext('2d');
    if (!c) throw new Error('The page could not be drawn.');
    c.fillStyle = '#fff';
    c.fillRect(0, 0, pageWidth, pageHeight);

    c.fillStyle = '#000';
    c.textAlign = 'center';
    if (index === 0) {
      c.font = '30px Academico, Georgia, serif';
      c.fillText(title, pageWidth / 2, MARGIN + 30, SCORE_WIDTH);
      c.font = '15px Academico, Georgia, serif';
      c.fillText(subtitle, pageWidth / 2, MARGIN + 54);
      if (composer) {
        c.textAlign = 'right';
        c.fillText(composer, pageWidth - MARGIN, MARGIN + 74, SCORE_WIDTH);
        c.textAlign = 'center';
      }
    }
    if (pageRanges.length > 1) {
      c.font = '12px Academico, Georgia, serif';
      c.fillText(String(index + 1), pageWidth / 2, pageHeight - MARGIN / 2);
    }
    c.textAlign = 'start';

    c.save();
    c.translate(MARGIN, MARGIN + (index === 0 ? HEADING : 0));
    drawSystems(ctx, score, layout, BLACK, first, end);
    c.restore();

    const rgba = c.getImageData(0, 0, canvas.width, canvas.height).data;
    const pixels = new Uint8Array(canvas.width * canvas.height);
    for (let i = 0; i < pixels.length; i++) {
      pixels[i] = (rgba[i * 4] * 299 + rgba[i * 4 + 1] * 587 + rgba[i * 4 + 2] * 114) / 1000;
    }
    pages.push({ width: canvas.width, height: canvas.height, pixels });
    // let go of the backing store now rather than at the next garbage collection
    canvas.width = 0;
    canvas.height = 0;
  }

  return buildPdf(pages, title, size);
}
