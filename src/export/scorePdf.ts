// The score as a PDF: laid out at print width and drawn page by page with
// VexFlow's canvas backend. The drawing goes to a stand-in canvas that writes
// PDF paths and text (pdfCanvas.ts), so the page is sharp at any size; if that
// cannot be done (a title in a script the embedded fonts lack, the fonts not
// to be had) each page is drawn on a real canvas and goes in as a picture.
// Lives in the notation chunk; load it with import().

import { CanvasContext, Renderer } from 'vexflow/core';
import { SYSTEM_GAP, drawSystems, layoutScore, systemHeight } from '../notation/renderScore';
import type { Score } from '../transcribe/score';
import academicoBoldUrl from './fonts/academico-bold.ttf?url';
import academicoUrl from './fonts/academico.ttf?url';
import musicUrl from './fonts/music.ttf?url';
import { A4, LETTER, buildPdf, type DrawnPage, type PageSize, type PdfPage } from './pdf';
import { PdfCanvas, readGlyphs, type CanvasFont } from './pdfCanvas';

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

/** The fonts the score is drawn in on screen, as files a PDF can hold. */
async function pdfFonts(): Promise<CanvasFont[]> {
  const faces = [
    { url: musicUrl, name: 'ScribeMusic', family: 'Bravura', bold: false },
    { url: academicoUrl, name: 'Academico', family: 'Academico', bold: false },
    { url: academicoBoldUrl, name: 'Academico-Bold', family: 'Academico', bold: true },
  ];
  return Promise.all(
    faces.map(async ({ url, ...face }, i) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Font not found: ${url}`);
      const file = new Uint8Array(await response.arrayBuffer());
      return { ...face, id: `F${i}`, file, glyphs: readGlyphs(file), used: new Map<number, number>() };
    }),
  );
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

  const page = { pageWidth, pageHeight, ranges: pageRanges };
  try {
    const fonts = await pdfFonts();
    const drawn = drawnPages(score, layout, page, title, subtitle, composer, fonts);
    return await buildPdf(drawn, title, size, fonts.filter((font) => font.used.size > 0));
  } catch {
    return buildPdf(picturePages(score, layout, page, title, subtitle, composer), title, size);
  }
}

interface Paging {
  /** size of a page in layout px */
  pageWidth: number;
  pageHeight: number;
  /** the systems on each page: the first, and one past the last */
  ranges: [number, number][];
}

type Layout = NonNullable<ReturnType<typeof layoutScore>>;

/** Each page as drawing instructions. Throws if a character has no glyph in `fonts`. */
function drawnPages(
  score: Score,
  layout: Layout,
  { pageWidth, pageHeight, ranges }: Paging,
  title: string,
  subtitle: string,
  composer: string,
  fonts: CanvasFont[],
): DrawnPage[] {
  return ranges.map(([first, end], index) => {
    const c = new PdfCanvas(fonts);
    c.canvas.width = pageWidth;
    c.canvas.height = pageHeight;
    /** One line of text; `anchor` 0 puts its left end at x, 0.5 its middle, 1 its right end. */
    const line = (text: string, size: number, x: number, y: number, anchor: number, maxWidth = Infinity) => {
      c.font = `${size}px Academico`;
      const width = c.measureText(text).width;
      // too long for the page: set smaller
      if (width > maxWidth) c.font = `${(size * maxWidth) / width}px Academico`;
      c.fillText(text, x - Math.min(width, maxWidth) * anchor, y);
    };
    if (index === 0) {
      line(title, 30, pageWidth / 2, MARGIN + 30, 0.5, SCORE_WIDTH);
      line(subtitle, 15, pageWidth / 2, MARGIN + 54, 0.5);
      if (composer) line(composer, 15, pageWidth - MARGIN, MARGIN + 74, 1, SCORE_WIDTH);
    }
    if (ranges.length > 1) line(String(index + 1), 12, pageWidth / 2, pageHeight - MARGIN / 2, 0.5);

    c.save();
    c.translate(MARGIN, MARGIN + (index === 0 ? HEADING : 0));
    drawSystems(new CanvasContext(c as unknown as CanvasRenderingContext2D), score, layout, BLACK, first, end);
    c.restore();
    return { width: pageWidth, height: pageHeight, content: c.content };
  });
}

/** Each page as a greyscale picture of it. */
function picturePages(
  score: Score,
  layout: Layout,
  { pageWidth, pageHeight, ranges: pageRanges }: Paging,
  title: string,
  subtitle: string,
  composer: string,
): PdfPage[] {
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

  return pages;
}
