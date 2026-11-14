// A minimal PDF writer. A page is either drawn (a content stream of paths
// and of text in embedded TrueType fonts; see pdfCanvas.ts) or, where that
// cannot be done, one full-page greyscale image.

export interface PdfPage {
  /** pixel size of the image */
  width: number;
  height: number;
  /** 8-bit grey, row by row, 0 = black */
  pixels: Uint8Array;
}

/** A page as drawing instructions, in a space of `width` by `height` units with y running down. */
export interface DrawnPage {
  width: number;
  height: number;
  /** PDF operators; text is set in the fonts by their `id` */
  content: string;
}

/** A TrueType font to embed, and the glyphs of it the pages use. */
export interface PdfFont {
  /** the name the content streams call it by: "F0", "F1", … */
  id: string;
  /** its PostScript name */
  name: string;
  /** the font file as it is */
  file: Uint8Array;
  /** glyph index → the character it stands for, for every glyph used; lets the text be searched and copied */
  used: Map<number, number>;
}

/** Page size in points (1/72 inch). */
export interface PageSize {
  width: number;
  height: number;
}

export const A4: PageSize = { width: 595, height: 842 };
export const LETTER: PageSize = { width: 612, height: 792 };

/** zlib-compresses `data`, or returns null where the browser has no CompressionStream. */
async function deflate(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A PDF text string: UTF-16 with a byte-order mark, written as hex. */
function textString(text: string): string {
  let hex = 'FEFF';
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}

const hex4 = (n: number) => n.toString(16).padStart(4, '0').toUpperCase();

/** The table a viewer reads to turn glyph numbers back into characters. */
function toUnicode(used: Map<number, number>): string {
  const pairs = [...used].sort((a, b) => a[0] - b[0]).map(([glyph, char]) => {
    const utf16 = Array.from(String.fromCodePoint(char), (c) => hex4(c.charCodeAt(0))).join('');
    return `<${hex4(glyph)}> <${utf16}>`;
  });
  const blocks: string[] = [];
  for (let i = 0; i < pairs.length; i += 100) {
    const block = pairs.slice(i, i + 100);
    blocks.push(`${block.length} beginbfchar\n${block.join('\n')}\nendbfchar`);
  }
  return (
    '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n' +
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n' +
    '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n' +
    '1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n' +
    `${blocks.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`
  );
}

/** how many objects a font takes: the font, its descendant, its descriptor, its file, its character table */
const FONT_OBJECTS = 5;

export async function buildPdf(
  pages: (PdfPage | DrawnPage)[],
  title: string,
  size: PageSize = A4,
  fonts: PdfFont[] = [],
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const write = (data: string | Uint8Array) => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  /** objects are numbered from 1 in the order they are written */
  const object = (dictionary: string, stream?: Uint8Array) => {
    offsets.push(length);
    write(`${offsets.length} 0 obj\n${dictionary}\n`);
    if (stream) {
      write('stream\n');
      write(stream);
      write('\nendstream\n');
    }
    write('endobj\n');
  };
  /** a stream object, compressed where the browser can */
  const stream = async (entries: string, data: Uint8Array) => {
    const packed = await deflate(data);
    const body = packed ?? data;
    object(`<< ${entries}${packed ? ' /Filter /FlateDecode' : ''} /Length ${body.length} >>`, body);
  };

  // the second line marks the file as binary for anything that sniffs it
  write('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  // 1 catalog, 2 page tree, 3 info, then the fonts, then each page: the page,
  // its contents and, for a page that is a picture, the image
  let next = 4;
  const fontObject = fonts.map(() => (next += FONT_OBJECTS) - FONT_OBJECTS);
  const pageObject = pages.map((page) => {
    const first = next;
    next += 'pixels' in page ? 3 : 2;
    return first;
  });
  object('<< /Type /Catalog /Pages 2 0 R >>');
  object(`<< /Type /Pages /Count ${pages.length} /Kids [${pageObject.map((id) => `${id} 0 R`).join(' ')}] >>`);
  object(`<< /Title ${textString(title)} /Creator ${textString('Tune Scribe')} >>`);

  for (const [i, font] of fonts.entries()) {
    const first = fontObject[i];
    object(
      `<< /Type /Font /Subtype /Type0 /BaseFont /${font.name} /Encoding /Identity-H ` +
        `/DescendantFonts [${first + 1} 0 R] /ToUnicode ${first + 4} 0 R >>`,
    );
    // glyphs are called for by their index in the file; each is placed on its own, so no widths are given
    object(
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${font.name} ` +
        '/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ' +
        `/FontDescriptor ${first + 2} 0 R /DW 1000 /CIDToGIDMap /Identity >>`,
    );
    object(
      `<< /Type /FontDescriptor /FontName /${font.name} /Flags 4 /FontBBox [-1000 -1000 3000 3000] ` +
        `/ItalicAngle 0 /Ascent 1000 /Descent -300 /CapHeight 700 /StemV 80 /FontFile2 ${first + 3} 0 R >>`,
    );
    await stream(`/Length1 ${font.file.length}`, font.file);
    await stream('', encoder.encode(toUnicode(font.used)));
  }
  const fontResources = fonts.map((font, i) => `/${font.id} ${fontObject[i]} 0 R`).join(' ');

  for (const [i, page] of pages.entries()) {
    const first = pageObject[i];
    const box = `/Type /Page /Parent 2 0 R /MediaBox [0 0 ${size.width} ${size.height}]`;
    if ('pixels' in page) {
      object(`<< ${box} /Resources << /XObject << /Im ${first + 2} 0 R >> >> /Contents ${first + 1} 0 R >>`);
      const contents = encoder.encode(`q ${size.width} 0 0 ${size.height} 0 0 cm /Im Do Q`);
      object(`<< /Length ${contents.length} >>`, contents);
      await stream(
        `/Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceGray /BitsPerComponent 8`,
        page.pixels,
      );
    } else {
      object(`<< ${box} /Resources << /Font << ${fontResources} >> >> /Contents ${first + 1} 0 R >>`);
      // the page's own units, y running down, fitted to the paper's width
      const k = size.width / page.width;
      await stream('', encoder.encode(`${k.toFixed(5)} 0 0 ${(-k).toFixed(5)} 0 ${size.height} cm\n${page.content}`));
    }
  }

  const xref = length;
  write(`xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`);
  for (const offset of offsets) write(`${String(offset).padStart(10, '0')} 00000 n \n`);
  write(`trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
