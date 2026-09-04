/**
 * Bulk marketplace catalog upload (CSV / XLSX).
 * Parses a supplier/reseller spreadsheet into staging rows. Does not create
 * live marketplace_listings — a Grok agent (or God) marks rows listed later.
 */

import { inflateRawSync } from 'node:zlib';
import { canBulkUploadCatalog, hasMarketplaceSellerRole } from '../roles.ts';
import {
  buildCatalogTemplateCsv,
  CATALOG_TEMPLATE_COLUMNS,
  defaultCatalogKind,
  type CatalogKind,
} from './catalog-upload-core.ts';

export { buildCatalogTemplateCsv, CATALOG_TEMPLATE_COLUMNS, defaultCatalogKind };
export type { CatalogKind };

export const CATALOG_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const CATALOG_UPLOAD_MAX_ROWS = 2000;
export const CATALOG_UPLOAD_BUCKET = 'marketplace-uploads';

export const CATALOG_UPLOAD_STATUSES = ['pending', 'processing', 'listed', 'error', 'partial'] as const;
export type CatalogUploadStatus = (typeof CATALOG_UPLOAD_STATUSES)[number];
export type CatalogRowStatus = Exclude<CatalogUploadStatus, 'partial'>;
export const MARKETPLACE_UPLOAD_AGENT_EMAIL_DEFAULT =
  'FieldserviceTotalService+marketplace@gmail.com';

const HEADER_ALIASES: Record<string, (typeof CATALOG_TEMPLATE_COLUMNS)[number]> = {
  sku: 'sku',
  part_number: 'sku',
  partnumber: 'sku',
  'part number': 'sku',
  item: 'sku',
  item_number: 'sku',
  itemnumber: 'sku',
  catalog_number: 'sku',
  pn: 'sku',
  title: 'title',
  name: 'title',
  product: 'title',
  product_name: 'title',
  listing_title: 'title',
  listing: 'title',
  brand: 'brand',
  manufacturer: 'brand',
  mfr: 'brand',
  make: 'brand',
  oem: 'brand',
  model: 'model',
  model_number: 'model',
  modelnumber: 'model',
  'model number': 'model',
  condition: 'condition',
  cond: 'condition',
  price: 'price',
  unit_price: 'price',
  listprice: 'price',
  list_price: 'price',
  asking_price: 'price',
  asking: 'price',
  sale_price: 'price',
  qty: 'qty',
  quantity: 'qty',
  qty_available: 'qty',
  quantity_available: 'qty',
  stock: 'qty',
  on_hand: 'qty',
  description: 'description',
  details: 'description',
  notes: 'description',
  desc: 'description',
  category: 'category',
  type: 'category',
  listing_type: 'category',
  kind: 'category',
  catalog_type: 'category',
  photos: 'photos',
  photo: 'photos',
  photo_urls: 'photos',
  photos_urls: 'photos',
  images: 'photos',
  image: 'photos',
  image_urls: 'photos',
  picture: 'photos',
  pictures: 'photos',
};

const KIND_VALUES: Record<string, CatalogKind> = {
  part: 'part',
  parts: 'part',
  spare: 'part',
  spares: 'part',
  consumable: 'consumable',
  consumables: 'consumable',
  used: 'used',
  laser: 'used',
  lasers: 'used',
  equipment: 'used',
  system: 'used',
  systems: 'used',
  used_system: 'used',
  used_systems: 'used',
};

export { canBulkUploadCatalog, hasMarketplaceSellerRole };

export function normalizeCatalogKind(value?: unknown, fallback: CatalogKind = 'part'): CatalogKind {
  const key = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return KIND_VALUES[key] || fallback;
}

export function normalizeCatalogStatus(value?: unknown): CatalogUploadStatus | null {
  const raw = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!raw) return null;
  if (['pending', 'queued', 'new', 'uploaded'].includes(raw)) return 'pending';
  if (['processing', 'in_progress', 'working', 'importing'].includes(raw)) return 'processing';
  if (['listed', 'imported', 'done', 'complete', 'completed', 'success'].includes(raw)) return 'listed';
  if (['error', 'failed', 'fail', 'failure'].includes(raw)) return 'error';
  if (['partial', 'mixed', 'partial_success'].includes(raw)) return 'partial';
  return null;
}

export function normalizeRowStatus(value?: unknown): CatalogRowStatus | null {
  const status = normalizeCatalogStatus(value);
  if (!status || status === 'partial') return status === 'partial' ? 'error' : null;
  return status;
}

export function rollupBatchStatus(rowStatuses: Array<string | null | undefined>): CatalogUploadStatus {
  if (!rowStatuses.length) return 'error';
  const set = new Set(rowStatuses.map((s) => normalizeRowStatus(s) || 'pending'));
  if (set.size === 1) return [...set][0];
  if (set.has('pending') || set.has('processing')) {
    if (set.has('listed') || set.has('error') || set.has('processing')) return 'processing';
    return 'pending';
  }
  if (set.has('listed') && set.has('error')) return 'partial';
  return 'processing';
}

export function countRowOutcomes(rowStatuses: Array<string | null | undefined>): {
  listed: number;
  error: number;
  pending: number;
  processing: number;
} {
  const out = { listed: 0, error: 0, pending: 0, processing: 0 };
  for (const raw of rowStatuses) {
    const status = normalizeRowStatus(raw) || 'pending';
    out[status] += 1;
  }
  return out;
}

export type CatalogFileMeta = {
  filename?: string | null;
  byteSize?: number | null;
  contentType?: string | null;
};

export function validateCatalogFile(meta: CatalogFileMeta): { ok: true; ext: 'csv' | 'xlsx' } | { ok: false; error: string } {
  const name = String(meta.filename || '').trim();
  const size = Number(meta.byteSize || 0);
  if (!name) return { ok: false, error: 'Choose a .csv or .xlsx file.' };
  const lower = name.toLowerCase();
  if (lower.endsWith('.xls') && !lower.endsWith('.xlsx')) {
    return { ok: false, error: 'Save the spreadsheet as .xlsx or .csv. Older .xls files are not supported.' };
  }
  const ext = lower.endsWith('.xlsx') ? 'xlsx' : lower.endsWith('.csv') ? 'csv' : null;
  if (!ext) return { ok: false, error: 'Upload a .csv or .xlsx spreadsheet.' };
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: 'That file looks empty.' };
  if (size > CATALOG_UPLOAD_MAX_BYTES) {
    return {
      ok: false,
      error: `File is too large (max ${Math.round(CATALOG_UPLOAD_MAX_BYTES / (1024 * 1024))} MB).`,
    };
  }
  const type = String(meta.contentType || '').toLowerCase();
  if (
    type &&
    type !== 'application/octet-stream' &&
    !type.includes('csv') &&
    !type.includes('excel') &&
    !type.includes('spreadsheet') &&
    type !== 'text/plain'
  ) {
    return { ok: false, error: 'That file type is not a CSV or Excel spreadsheet.' };
  }
  return { ok: true, ext };
}

export function normalizeHeaderKey(value: unknown): string {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

export function mapCatalogHeaders(headers: string[]): {
  map: Array<(typeof CATALOG_TEMPLATE_COLUMNS)[number] | null>;
  matched: Array<(typeof CATALOG_TEMPLATE_COLUMNS)[number]>;
  unknown: string[];
} {
  const used = new Set<string>();
  const map: Array<(typeof CATALOG_TEMPLATE_COLUMNS)[number] | null> = [];
  const unknown: string[] = [];
  for (const header of headers) {
    const key = normalizeHeaderKey(header);
    const spaced = key.replace(/_/g, ' ');
    const field = HEADER_ALIASES[key] || HEADER_ALIASES[spaced] || null;
    if (field && !used.has(field)) {
      used.add(field);
      map.push(field);
    } else {
      if (header.trim()) unknown.push(header.trim());
      map.push(null);
    }
  }
  return { map, matched: [...used] as Array<(typeof CATALOG_TEMPLATE_COLUMNS)[number]>, unknown };
}

export type CatalogParsedRow = {
  rowNumber: number;
  catalogKind: CatalogKind;
  sku: string | null;
  title: string | null;
  brand: string | null;
  model: string | null;
  condition: string | null;
  price: number | null;
  qty: number | null;
  description: string | null;
  category: string | null;
  photoUrls: string[];
  raw: Record<string, string>;
  status: CatalogRowStatus;
  errorMessage: string | null;
};

function clip(value: unknown, max = 4000): string {
  return String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
}

function parsePrice(value: unknown): number | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const cleaned = raw.replace(/[$,\s]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function parseQty(value: unknown): number | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const n = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

export function parsePhotoUrls(value: unknown): string[] {
  const raw = String(value ?? '').trim();
  if (!raw) return [];
  const parts = raw.split(/[;|\n]+|(?:\s*,\s*)/).map((p) => p.trim()).filter(Boolean);
  const urls: string[] = [];
  for (const part of parts) {
    if (/^https?:\/\//i.test(part) && part.length <= 2000) urls.push(part);
  }
  return [...new Set(urls)].slice(0, 8);
}

function rowFromCells(
  cells: string[],
  headers: string[],
  fieldMap: Array<(typeof CATALOG_TEMPLATE_COLUMNS)[number] | null>,
  rowNumber: number,
  fallbackKind: CatalogKind
): CatalogParsedRow {
  const mapped: Partial<Record<(typeof CATALOG_TEMPLATE_COLUMNS)[number], string>> = {};
  const raw: Record<string, string> = {};
  headers.forEach((header, i) => {
    const value = clip(cells[i] ?? '', 4000);
    if (header) raw[header] = value;
    const field = fieldMap[i];
    if (field) mapped[field] = value;
  });

  const category = clip(mapped.category, 80) || null;
  const catalogKind = normalizeCatalogKind(category, fallbackKind);
  const title = clip(mapped.title, 200) || null;
  const sku = clip(mapped.sku, 80) || null;
  const brand = clip(mapped.brand, 120) || null;
  const model = clip(mapped.model, 120) || null;
  const condition = clip(mapped.condition, 80) || null;
  const description = clip(mapped.description, 4000) || null;
  const price = parsePrice(mapped.price);
  const qty = parseQty(mapped.qty);
  const photoUrls = parsePhotoUrls(mapped.photos);

  let status: CatalogRowStatus = 'pending';
  let errorMessage: string | null = null;
  if (!title && !sku) {
    status = 'error';
    errorMessage = 'Each row needs a title or SKU.';
  }

  return {
    rowNumber,
    catalogKind,
    sku,
    title,
    brand,
    model,
    condition,
    price,
    qty,
    description,
    category,
    photoUrls,
    raw,
    status,
    errorMessage,
  };
}

export function parseCsv(text: string): string[][] {
  const src = String(text || '').replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let i = 0;
  let inQuotes = false;
  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      i += 1;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = '';
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

export function colLetter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function decodeXml(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

export function parseSharedStringsXml(xml: string): string[] {
  const out: string[] = [];
  const sis = xml.split(/<si[\s>]/i).slice(1);
  for (const chunk of sis) {
    const parts = [...chunk.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi)].map((m) => decodeXml(m[1]));
    out.push(parts.join(''));
  }
  return out;
}

function cellRefCol(ref: string): number {
  const letters = (ref.match(/^[A-Z]+/i) || ['A'])[0].toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function parseSheetXml(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  const rowChunks = xml.split(/<row[\s>]/i).slice(1);
  for (const chunk of rowChunks) {
    const cells: string[] = [];
    const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/gi;
    let match: RegExpExecArray | null;
    while ((match = cellRe.exec(chunk))) {
      const attrs = match[1];
      const body = match[2];
      const ref = (attrs.match(/\br="([A-Z]+\d+)"/i) || [])[1] || '';
      const type = ((attrs.match(/\bt="([^"]+)"/i) || [])[1] || '').toLowerCase();
      const col = ref ? cellRefCol(ref) : cells.length;
      let value = '';
      if (type === 's') {
        const idx = Number((body.match(/<v>([\s\S]*?)<\/v>/i) || [])[1]);
        value = Number.isFinite(idx) ? shared[idx] || '' : '';
      } else if (type === 'inlineStr' || type === 'str') {
        const texts = [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi)].map((m) => decodeXml(m[1]));
        value = texts.join('') || decodeXml((body.match(/<v>([\s\S]*?)<\/v>/i) || [])[1] || '');
      } else {
        value = decodeXml((body.match(/<v>([\s\S]*?)<\/v>/i) || [])[1] || '');
      }
      cells[col] = value;
    }
    const width = cells.length;
    const normalized = Array.from({ length: width }, (_, i) => cells[i] || '');
    if (normalized.some((c) => c.trim())) rows.push(normalized);
  }
  return rows;
}

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n >>> 0, 0);
  return b;
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

export function writeZipStore(files: Array<{ name: string; data: Buffer | string }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8');
    const crc = crc32(data);
    const local = Buffer.concat([
      Buffer.from('PK\u0003\u0004', 'binary'),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
      data,
    ]);
    const central = Buffer.concat([
      Buffer.from('PK\u0001\u0002', 'binary'),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    Buffer.from('PK\u0005\u0006', 'binary'),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralBuf.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

export function readZipEntries(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let i = 0;
  while (i + 30 <= buf.length) {
    if (buf.readUInt32LE(i) !== 0x04034b50) break;
    const method = buf.readUInt16LE(i + 8);
    const gp = buf.readUInt16LE(i + 6);
    let compSize = buf.readUInt32LE(i + 18);
    let uncompSize = buf.readUInt32LE(i + 22);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nameLen).toString('utf8');
    let dataStart = i + 30 + nameLen + extraLen;
    if (gp & 0x8) {
      const desc = buf.indexOf(Buffer.from('PK\u0007\u0008', 'binary'), dataStart);
      if (desc < 0) break;
      compSize = buf.readUInt32LE(desc + 8);
      uncompSize = buf.readUInt32LE(desc + 12);
      const data = buf.subarray(dataStart, desc);
      out.set(name, inflateZipData(data, method, uncompSize));
      i = desc + 16;
      continue;
    }
    const data = buf.subarray(dataStart, dataStart + compSize);
    out.set(name, inflateZipData(data, method, uncompSize));
    i = dataStart + compSize;
  }
  return out;
}

function inflateZipData(data: Buffer, method: number, uncompSize: number): Buffer {
  if (method === 0) return Buffer.from(data);
  if (method === 8) {
    try {
      return Buffer.from(inflateRawSync(data));
    } catch {
      return Buffer.alloc(0);
    }
  }
  return uncompSize ? Buffer.alloc(0) : Buffer.from(data);
}

function xmlEscape(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildMinimalXlsx(rows: string[][]): Buffer {
  const shared: string[] = [];
  const indexOf = (text: string) => {
    const i = shared.indexOf(text);
    if (i >= 0) return i;
    shared.push(text);
    return shared.length - 1;
  };
  const sheetRows = rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          const idx = indexOf(String(value ?? ''));
          return `<c r="${colLetter(c)}${r + 1}" t="s"><v>${idx}</v></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  const sharedXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">` +
    shared.map((s) => `<si><t>${xmlEscape(s)}</t></si>`).join('') +
    `</sst>`;
  const sheetXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;
  const workbookXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="Catalog" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;
  const wbRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>` +
    `</Relationships>`;
  const ctypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
    `</Types>`;
  return writeZipStore([
    { name: '[Content_Types].xml', data: ctypes },
    { name: '_rels/.rels', data: rels },
    { name: 'xl/workbook.xml', data: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', data: wbRels },
    { name: 'xl/sharedStrings.xml', data: sharedXml },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml },
  ]);
}

export function parseXlsxFirstSheet(buf: Buffer): string[][] {
  const entries = readZipEntries(buf);
  const sharedXml = entries.get('xl/sharedStrings.xml')?.toString('utf8') || '';
  const shared = sharedXml ? parseSharedStringsXml(sharedXml) : [];
  const sheetName =
    [...entries.keys()].find((k) => /^xl\/worksheets\/sheet1\.xml$/i.test(k)) ||
    [...entries.keys()].find((k) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k));
  if (!sheetName) return [];
  const sheetXml = entries.get(sheetName)?.toString('utf8') || '';
  return parseSheetXml(sheetXml, shared);
}

export type ParseCatalogResult =
  | { ok: true; rows: CatalogParsedRow[]; headers: string[]; unknownHeaders: string[]; catalogKind: CatalogKind }
  | { ok: false; error: string };

export function parseCatalogSpreadsheet(
  input: Buffer | Uint8Array | string,
  meta: CatalogFileMeta & { defaultKind?: CatalogKind }
): ParseCatalogResult {
  const file = validateCatalogFile(meta);
  if (!file.ok) return file;
  const buf = typeof input === 'string' ? Buffer.from(input) : Buffer.from(input);
  if (buf.length > CATALOG_UPLOAD_MAX_BYTES) {
    return { ok: false, error: `File is too large (max ${Math.round(CATALOG_UPLOAD_MAX_BYTES / (1024 * 1024))} MB).` };
  }
  let grid: string[][];
  try {
    grid = file.ext === 'xlsx' ? parseXlsxFirstSheet(buf) : parseCsv(buf.toString('utf8'));
  } catch {
    return { ok: false, error: 'Could not read that spreadsheet. Export as CSV or a simple .xlsx and try again.' };
  }
  if (!grid.length) return { ok: false, error: 'The spreadsheet has no rows.' };
  const headers = (grid[0] || []).map((h) => String(h || '').replace(/^\uFEFF/, '').trim());
  if (!headers.some(Boolean)) return { ok: false, error: 'The first row must be column headers (SKU, title, brand, …).' };
  const mapped = mapCatalogHeaders(headers);
  if (!mapped.matched.length) {
    return {
      ok: false,
      error:
        'None of the column headers matched the template (SKU, title, brand, model, condition, price, qty, description, category, photos).',
    };
  }
  const fallbackKind = meta.defaultKind || 'part';
  const rows: CatalogParsedRow[] = [];
  for (let i = 1; i < grid.length; i++) {
    const cells = grid[i] || [];
    if (!cells.some((c) => String(c || '').trim())) continue;
    rows.push(rowFromCells(cells, headers, mapped.map, rows.length + 1, fallbackKind));
    if (rows.length > CATALOG_UPLOAD_MAX_ROWS) {
      return {
        ok: false,
        error: `Too many rows (max ${CATALOG_UPLOAD_MAX_ROWS} per upload). Split the file and upload again.`,
      };
    }
  }
  if (!rows.length) return { ok: false, error: 'The spreadsheet has headers but no data rows.' };
  const kinds = new Set(rows.filter((r) => r.status === 'pending').map((r) => r.catalogKind));
  const catalogKind = kinds.size === 1 ? [...kinds][0] : fallbackKind;
  return {
    ok: true,
    rows,
    headers,
    unknownHeaders: mapped.unknown,
    catalogKind,
  };
}

export function safeUploadFilename(name: string): string {
  const base = String(name || 'catalog.csv').split(/[/\\]/).pop() || 'catalog.csv';
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned.slice(0, 120) || 'catalog.csv';
}

export function catalogStoragePath(opts: {
  organizationId: number | string;
  userId: string;
  batchId: string;
  filename: string;
}): string {
  return `${opts.organizationId}/${opts.userId}/${opts.batchId}/${safeUploadFilename(opts.filename)}`;
}
