// A minimal PDF writer: one full-page greyscale image per page. The score is
// rasterised (see scorePdf.ts) rather than drawn as vectors, which keeps the
// music font out of the file and the writer to a page of code.

export interface PdfPage {
  /** pixel size of the image */
  width: number;
  height: number;
  /** 8-bit grey, row by row, 0 = black */
  pixels: Uint8Array;
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

export async function buildPdf(pages: PdfPage[], title: string, size: PageSize = A4): Promise<Uint8Array> {
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

  // the second line marks the file as binary for anything that sniffs it
  write('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  // 1 catalog, 2 page tree, 3 info, then three objects per page: page, contents, image
  const pageObject = (i: number) => 4 + i * 3;
  object('<< /Type /Catalog /Pages 2 0 R >>');
  object(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageObject(i)} 0 R`).join(' ')}] >>`);
  object(`<< /Title ${textString(title)} /Creator ${textString('Tune Scribe')} >>`);

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const first = pageObject(i);
    object(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${size.width} ${size.height}] ` +
        `/Resources << /XObject << /Im ${first + 2} 0 R >> >> /Contents ${first + 1} 0 R >>`,
    );
    const contents = encoder.encode(`q ${size.width} 0 0 ${size.height} 0 0 cm /Im Do Q`);
    object(`<< /Length ${contents.length} >>`, contents);
    const packed = await deflate(page.pixels);
    const data = packed ?? page.pixels;
    object(
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace /DeviceGray /BitsPerComponent 8${packed ? ' /Filter /FlateDecode' : ''} /Length ${data.length} >>`,
      data,
    );
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
