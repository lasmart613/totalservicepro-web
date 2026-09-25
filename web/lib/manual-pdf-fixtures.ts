/**
 * Small synthetic PDFs for the manual text indexer.
 * Built as bytes so tests do not need a PDF writer package.
 * ocrmypdf-style: page dictionary lives in an object stream, and the only
 * visible text is a Flate-compressed Form XObject (the page content is `/Fm1 Do`).
 * ToUnicode: character codes are Caesar-shifted by 3; the CMap maps them back.
 */

import { deflateSync } from 'node:zlib';

export const OCR_XOBJECT_TEXT = 'reservoir collimator OCR layer';
export const TOUNICODE_PLAIN = 'Error 43 CW Laser Power Too High';

function push(parts: Buffer[], buf: Buffer, length: { n: number }): void {
  parts.push(buf);
  length.n += buf.length;
}

/** Classic xref PDF. `bodies[0]` is object 1. Root is object 1. */
export function buildPdf(bodies: string[]): Buffer {
  const parts: Buffer[] = [];
  const length = { n: 0 };
  push(parts, Buffer.from('%PDF-1.4\n', 'latin1'), length);
  const offsets = [0];
  bodies.forEach((body, index) => {
    offsets.push(length.n);
    push(parts, Buffer.from(`${index + 1} 0 obj\n${body}\nendobj\n`, 'latin1'), length);
  });
  const xrefAt = length.n;
  let xref = `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  push(parts, Buffer.from(xref, 'latin1'), length);
  return Buffer.concat(parts);
}

function pdfLiteral(text: string): string {
  return `(${text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`;
}

/** One or more pages of Helvetica text. Physical page order matches the array. */
export function buildTextPdf(pageTexts: string[]): Buffer {
  const count = Math.max(1, pageTexts.length);
  const texts = pageTexts.length ? pageTexts : [''];
  const kids = texts.map((_, i) => 4 + i * 2);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${count} /Kids [${kids.map((id) => `${id} 0 R`).join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  texts.forEach((text, i) => {
    const contentObj = 5 + i * 2;
    const stream = `BT /F1 12 Tf 72 720 Td ${pdfLiteral(text)} Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObj} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`
    );
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
  });
  return buildPdf(objects);
}

/**
 * Content stream from the kerning tests. Injects a font and a position inside
 * the page box so pdf.js will emit the glyphs (a bare BT at 0,0 is clipped).
 */
export function buildOperatorPdf(stream: string): Buffer {
  const content = /^BT\b/.test(stream)
    ? stream.replace(/^BT\b/, 'BT /F1 12 Tf 72 720 Td')
    : `BT /F1 12 Tf 72 720 Td ${stream} ET`;
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);
}

export function caesarShift(text: string, shift = 3): string {
  return text.replace(/[A-Za-z]/g, (ch) => {
    const base = ch <= 'Z' ? 65 : 97;
    return String.fromCharCode(base + ((ch.charCodeAt(0) - base + shift) % 26));
  });
}

/** Indexed codes are `plain` shifted +3. ToUnicode maps each code back to the real letter. */
export function buildToUnicodePdf(plain = TOUNICODE_PLAIN): Buffer {
  const shifted = caesarShift(plain, 3);
  const map = new Map<number, number>();
  for (const ch of plain) {
    if (!/[A-Za-z]/.test(ch)) continue;
    map.set(caesarShift(ch, 3).charCodeAt(0), ch.charCodeAt(0));
  }
  let pairs = '';
  for (const [code, uni] of map) {
    pairs += `<${code.toString(16).padStart(2, '0')}> <${uni.toString(16).padStart(4, '0')}>\n`;
  }
  const cmap = `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<00> <FF>
endcodespacerange
${map.size} beginbfchar
${pairs}endbfchar
endcmap
CMapName currentdict /CMap defineresource pop
end
end
`;
  const content = `BT /F1 12 Tf 72 720 Td ${pdfLiteral(shifted)} Tj ET`;
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode 6 0 R >>',
    `<< /Length ${Buffer.byteLength(cmap, 'latin1')} >>\nstream\n${cmap}\nendstream`,
  ]);
}

/**
 * ocrmypdf-shaped file: the page object is inside an object stream, and the
 * text layer is a FlateDecode Form XObject. The page content stream is only `Do`.
 */
export function buildOcrXObjectPdf(): Buffer {
  const formText = `BT /F1 18 Tf 72 720 Td ${pdfLiteral(OCR_XOBJECT_TEXT)} Tj ET`;
  const formDeflated = deflateSync(Buffer.from(formText, 'latin1'));
  const pageContent = 'q /Fm1 Do Q';
  const pageDict =
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> /XObject << /Fm1 6 0 R >> >> >>';
  const objstmHeader = '3 0\n';
  const objstmPayload = Buffer.from(objstmHeader + pageDict, 'latin1');
  const first = Buffer.byteLength(objstmHeader, 'latin1');

  const parts: Buffer[] = [];
  const length = { n: 0 };
  const offsets = new Map<number, number>();
  const add = (n: number, body: Buffer | string) => {
    offsets.set(n, length.n);
    const payload = Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1');
    push(parts, Buffer.from(`${n} 0 obj\n`, 'latin1'), length);
    push(parts, payload, length);
    push(parts, Buffer.from('\nendobj\n', 'latin1'), length);
  };

  push(parts, Buffer.from('%PDF-1.5\n', 'latin1'), length);
  add(1, '<< /Type /Catalog /Pages 2 0 R >>');
  add(2, '<< /Type /Pages /Count 1 /Kids [3 0 R] >>');
  add(4, `<< /Length ${Buffer.byteLength(pageContent, 'latin1')} >>\nstream\n${pageContent}\nendstream`);
  add(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  add(
    6,
    Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Form /FormType 1 /BBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Filter /FlateDecode /Length ${formDeflated.length} >>\nstream\n`,
        'latin1'
      ),
      formDeflated,
      Buffer.from('\nendstream', 'latin1'),
    ])
  );
  add(
    7,
    Buffer.concat([
      Buffer.from(
        `<< /Type /ObjStm /N 1 /First ${first} /Length ${objstmPayload.length} >>\nstream\n`,
        'latin1'
      ),
      objstmPayload,
      Buffer.from('\nendstream', 'latin1'),
    ])
  );

  const size = 9;
  const xrefOffset = length.n;
  const entries: Buffer[] = [];
  const entry = (type: number, field2: number, field3: number) => {
    const row = Buffer.alloc(7);
    row.writeUInt8(type, 0);
    row.writeUInt32BE(field2, 1);
    row.writeUInt16BE(field3, 5);
    entries.push(row);
  };
  entry(0, 0, 65535);
  entry(1, offsets.get(1) || 0, 0);
  entry(1, offsets.get(2) || 0, 0);
  entry(2, 7, 0);
  entry(1, offsets.get(4) || 0, 0);
  entry(1, offsets.get(5) || 0, 0);
  entry(1, offsets.get(6) || 0, 0);
  entry(1, offsets.get(7) || 0, 0);
  entry(1, xrefOffset, 0);
  const xrefData = Buffer.concat(entries);
  push(
    parts,
    Buffer.from(
      `8 0 obj\n<< /Type /XRef /Size ${size} /Root 1 0 R /W [1 4 2] /Index [0 ${size}] /Length ${xrefData.length} >>\nstream\n`,
      'latin1'
    ),
    length
  );
  push(parts, xrefData, length);
  push(parts, Buffer.from('\nendstream\nendobj\n', 'latin1'), length);
  push(parts, Buffer.from(`startxref\n${xrefOffset}\n%%EOF\n`, 'latin1'), length);
  return Buffer.concat(parts);
}
