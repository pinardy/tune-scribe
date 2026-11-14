// Something that looks enough like a canvas's 2D context for VexFlow to draw
// on, and writes down what is drawn as PDF operators instead of painting
// pixels. Text (which is how VexFlow draws noteheads, clefs and rests too:
// they are glyphs of the music font) is set glyph by glyph in fonts that go
// into the PDF with it.

import type { PdfFont } from './pdf';

/** A character that none of the fonts on hand can draw: the page has to be made some other way. */
export class MissingGlyph extends Error {}

export interface CanvasFont extends PdfFont {
  /** the CSS family it is drawn as on screen */
  family: string;
  bold: boolean;
  /** character → glyph index */
  glyphs: Map<number, number>;
}

/** Reads a TrueType file's character map: which glyph draws which character. */
export function readGlyphs(file: Uint8Array): Map<number, number> {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const glyphs = new Map<number, number>();
  let cmap = -1;
  for (let i = 0; i < view.getUint16(4); i++) {
    const record = 12 + i * 16;
    if (view.getUint32(record) === 0x636d6170) cmap = view.getUint32(record + 8); // 'cmap'
  }
  if (cmap < 0) return glyphs;
  for (let i = 0; i < view.getUint16(cmap + 2); i++) {
    const record = cmap + 4 + i * 8;
    const platform = view.getUint16(record);
    const table = cmap + view.getUint32(record + 4);
    // the Unicode table for the 16-bit characters (format 4), under either of its two labels
    if (!(platform === 0 || (platform === 3 && view.getUint16(record + 2) === 1)) || view.getUint16(table) !== 4) continue;
    const segments = view.getUint16(table + 6) / 2;
    const ends = table + 14;
    const starts = ends + segments * 2 + 2;
    const deltas = starts + segments * 2;
    const ranges = deltas + segments * 2;
    for (let s = 0; s < segments; s++) {
      const start = view.getUint16(starts + s * 2);
      const end = view.getUint16(ends + s * 2);
      const delta = view.getUint16(deltas + s * 2);
      const range = view.getUint16(ranges + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        const glyph = range === 0 ? (c + delta) & 0xffff : view.getUint16(ranges + s * 2 + range + (c - start) * 2);
        if (glyph !== 0) glyphs.set(c, range === 0 ? glyph : (glyph + delta) & 0xffff);
      }
    }
    break;
  }
  return glyphs;
}

const n = (value: number) => String(+value.toFixed(2));

interface State {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  lineCap: string;
  dash: number[];
  font: string;
}

export class PdfCanvas {
  readonly canvas = { width: 0, height: 0 };
  fillStyle = '#000';
  strokeStyle = '#000';
  lineWidth = 1;
  lineCap = 'butt';
  // set by VexFlow, not drawn
  shadowColor = '';
  shadowBlur = 0;

  /** a real context: it knows how wide text comes out, and how a colour or a font is spelled out in full */
  private readonly real: CanvasRenderingContext2D;
  private readonly out: string[] = [];
  /** the path being built; a canvas can fill it and then stroke it, a PDF uses it up on the first */
  private path: string[] = [];
  private at: [number, number] = [0, 0];
  private dash: number[] = [];
  private readonly saved: State[] = [];

  constructor(private readonly fonts: CanvasFont[]) {
    const real = document.createElement('canvas').getContext('2d');
    if (!real) throw new Error('No canvas to measure text with.');
    this.real = real;
  }

  /** what was drawn, as the body of a PDF content stream */
  get content(): string {
    return this.out.join('\n');
  }

  set font(value: string) {
    this.real.font = value;
  }

  get font(): string {
    return this.real.font;
  }

  measureText(text: string): TextMetrics {
    return this.real.measureText(text);
  }

  save(): void {
    const { fillStyle, strokeStyle, lineWidth, lineCap, dash, font } = this;
    this.saved.push({ fillStyle, strokeStyle, lineWidth, lineCap, dash, font });
    this.out.push('q');
  }

  restore(): void {
    const state = this.saved.pop();
    if (!state) return;
    Object.assign(this, state);
    this.out.push('Q');
  }

  translate(x: number, y: number): void {
    this.out.push(`1 0 0 1 ${n(x)} ${n(y)} cm`);
  }

  scale(x: number, y: number): void {
    this.out.push(`${n(x)} 0 0 ${n(y)} 0 0 cm`);
  }

  rotate(angle: number): void {
    const [c, s] = [Math.cos(angle), Math.sin(angle)];
    this.out.push(`${c.toFixed(5)} ${s.toFixed(5)} ${(-s).toFixed(5)} ${c.toFixed(5)} 0 0 cm`);
  }

  // VexFlow keeps these to undo a rotation, which nothing in a melody line asks for
  getTransform(): DOMMatrix | null {
    return null;
  }

  setTransform(): void {}

  setLineDash(dash: number[]): void {
    this.dash = dash;
  }

  beginPath(): void {
    this.path = [];
  }

  moveTo(x: number, y: number): void {
    this.path.push(`${n(x)} ${n(y)} m`);
    this.at = [x, y];
  }

  lineTo(x: number, y: number): void {
    this.path.push(`${n(x)} ${n(y)} l`);
    this.at = [x, y];
  }

  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
    this.path.push(`${n(x1)} ${n(y1)} ${n(x2)} ${n(y2)} ${n(x)} ${n(y)} c`);
    this.at = [x, y];
  }

  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    const [x0, y0] = this.at;
    this.bezierCurveTo(x0 + (2 / 3) * (cx - x0), y0 + (2 / 3) * (cy - y0), x + (2 / 3) * (cx - x), y + (2 / 3) * (cy - y), x, y);
  }

  arc(x: number, y: number, radius: number, from: number, to: number, counterclockwise = false): void {
    let sweep = to - from;
    if (counterclockwise && sweep > 0) sweep -= 2 * Math.PI;
    if (!counterclockwise && sweep < 0) sweep += 2 * Math.PI;
    const pieces = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
    const step = sweep / pieces;
    const k = (4 / 3) * Math.tan(step / 4) * radius;
    const point = (a: number): [number, number] => [x + radius * Math.cos(a), y + radius * Math.sin(a)];
    const start = point(from);
    if (this.path.length === 0) this.moveTo(...start);
    else this.lineTo(...start);
    for (let i = 0; i < pieces; i++) {
      const a = from + i * step;
      const b = a + step;
      const [ax, ay] = point(a);
      const [bx, by] = point(b);
      this.bezierCurveTo(ax - k * Math.sin(a), ay + k * Math.cos(a), bx + k * Math.sin(b), by - k * Math.cos(b), bx, by);
    }
  }

  rect(x: number, y: number, width: number, height: number): void {
    this.path.push(`${n(x)} ${n(y)} ${n(width)} ${n(height)} re`);
    this.at = [x, y];
  }

  closePath(): void {
    this.path.push('h');
  }

  fill(): void {
    if (this.path.length) this.out.push(`${this.colour(this.fillStyle)} rg`, ...this.path, 'f');
  }

  stroke(): void {
    if (this.path.length === 0) return;
    const cap = this.lineCap === 'round' ? 1 : this.lineCap === 'square' ? 2 : 0;
    this.out.push(
      `${this.colour(this.strokeStyle)} RG ${n(this.lineWidth)} w ${cap} J [${this.dash.map(n).join(' ')}] 0 d`,
      ...this.path,
      'S',
    );
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    this.out.push(`${this.colour(this.fillStyle)} rg`, `${n(x)} ${n(y)} ${n(width)} ${n(height)} re`, 'f');
  }

  // the page starts out blank
  clearRect(): void {}

  /** Left-aligned on the baseline, like a canvas's default. */
  fillText(text: string, x: number, y: number): void {
    const font = /^(.*?)(\d+(?:\.\d+)?)px\s+(.+)$/.exec(this.real.font);
    if (!font) throw new MissingGlyph(this.real.font);
    const bold = /bold|[6-9]00/.test(font[1]);
    const size = Number(font[2]);
    const families = font[3].split(',').map((family) => family.trim().replace(/^["']|["']$/g, ''));

    const ops: string[] = [];
    let before = '';
    for (const char of text) {
      const code = char.codePointAt(0)!;
      if (char.trim() !== '') {
        const face = this.face(code, families, bold);
        const glyph = face.glyphs.get(code)!;
        face.used.set(glyph, code);
        const dx = before ? this.real.measureText(before).width : 0;
        ops.push(
          `BT /${face.id} ${n(size)} Tf 1 0 0 -1 ${n(x + dx)} ${n(y)} Tm <${glyph.toString(16).padStart(4, '0')}> Tj ET`,
        );
      }
      before += char;
    }
    if (ops.length) this.out.push(`${this.colour(this.fillStyle)} rg`, ...ops);
  }

  /** The font a character is drawn in: the first of the asked-for families that has it, as a browser chooses. */
  private face(code: number, families: string[], bold: boolean): CanvasFont {
    const has = this.fonts.filter((font) => font.glyphs.has(code));
    for (const family of families) {
      const of = has.filter((font) => font.family === family);
      const face = of.find((font) => font.bold === bold) ?? of[0];
      if (face) return face;
    }
    throw new MissingGlyph(String.fromCodePoint(code));
  }

  /** A CSS colour as three PDF numbers. */
  private colour(style: string): string {
    this.real.fillStyle = '#000';
    this.real.fillStyle = style;
    const spelled = this.real.fillStyle;
    const parts = spelled.startsWith('#')
      ? [1, 3, 5].map((i) => parseInt(spelled.slice(i, i + 2), 16))
      : (spelled.match(/[\d.]+/g) ?? ['0', '0', '0']).slice(0, 3).map(Number);
    return parts.map((part) => n(part / 255)).join(' ');
  }
}
