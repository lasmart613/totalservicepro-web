import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCatalogTemplateCsv,
  buildMinimalXlsx,
  CATALOG_UPLOAD_MAX_BYTES,
  catalogStoragePath,
  countRowOutcomes,
  mapCatalogHeaders,
  normalizeCatalogKind,
  normalizeCatalogStatus,
  parseCatalogSpreadsheet,
  parseCsv,
  parsePhotoUrls,
  parseSharedStringsXml,
  parseSheetXml,
  rollupBatchStatus,
  validateCatalogFile,
} from './catalog-upload.ts';
import { MARKETPLACE_UPLOAD_AGENT_EMAIL_DEFAULT } from './catalog-upload.ts';
import {
  catalogUploadSubject,
  catalogUploadText,
  marketplaceUploadAgentEmail,
} from './catalog-upload-email.ts';

const here = dirname(fileURLToPath(import.meta.url));

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const prev = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    prev.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of prev.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('file validation accepts csv/xlsx and rejects xls, empty, and huge files', () => {
  assert.equal(validateCatalogFile({ filename: 'parts.csv', byteSize: 120 }).ok, true);
  assert.equal(validateCatalogFile({ filename: 'lasers.xlsx', byteSize: 2048 }).ok, true);
  assert.equal(validateCatalogFile({ filename: 'old.xls', byteSize: 120 }).ok, false);
  assert.equal(validateCatalogFile({ filename: 'notes.pdf', byteSize: 120 }).ok, false);
  assert.equal(validateCatalogFile({ filename: 'parts.csv', byteSize: 0 }).ok, false);
  assert.equal(
    validateCatalogFile({ filename: 'parts.csv', byteSize: CATALOG_UPLOAD_MAX_BYTES + 1 }).ok,
    false
  );
});

test('flexible headers map SKU/title/brand and ignore unknown columns', () => {
  const mapped = mapCatalogHeaders(['Part Number', 'Product Name', 'Manufacturer', 'Qty', 'Foo']);
  assert.deepEqual(mapped.matched.sort(), ['brand', 'qty', 'sku', 'title']);
  assert.deepEqual(mapped.unknown, ['Foo']);
});

test('CSV parse supports quotes, commas, and flexible columns', () => {
  const csv = [
    'SKU,Title,Brand,Model,Condition,Price,Qty,Description,Category,Photos',
    'A-1,"Power supply, HV",Candela,GentleMax,New,"1,200.50",2,OEM PSU,part,https://cdn.example/a.jpg',
    ',NoSkuRow,Lumenis,AcuPulse,Used,500,1,ok,laser,',
    ',,,',
    ',,,,,,,needs a title or sku,,',
  ].join('\n');
  const parsed = parseCatalogSpreadsheet(csv, { filename: 'parts.csv', byteSize: csv.length, defaultKind: 'part' });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.rows.length, 3);
  assert.equal(parsed.rows[0].sku, 'A-1');
  assert.equal(parsed.rows[0].title, 'Power supply, HV');
  assert.equal(parsed.rows[0].price, 1200.5);
  assert.equal(parsed.rows[0].qty, 2);
  assert.deepEqual(parsed.rows[0].photoUrls, ['https://cdn.example/a.jpg']);
  assert.equal(parsed.rows[1].catalogKind, 'used');
  assert.equal(parsed.rows[2].status, 'error');
  assert.match(parsed.rows[2].errorMessage || '', /title or SKU/i);
});

test('xlsx first sheet parses shared-string cells', () => {
  const grid = [
    ['sku', 'title', 'brand', 'price', 'qty'],
    ['PSU-1', 'Power supply', 'Candela', '890', '3'],
  ];
  const xlsx = buildMinimalXlsx(grid);
  const parsed = parseCatalogSpreadsheet(xlsx, {
    filename: 'stock.xlsx',
    byteSize: xlsx.length,
    defaultKind: 'part',
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.rows[0].sku, 'PSU-1');
  assert.equal(parsed.rows[0].title, 'Power supply');
  assert.equal(parsed.rows[0].brand, 'Candela');
  assert.equal(parsed.rows[0].price, 890);
  assert.equal(parsed.rows[0].qty, 3);
});

test('sheet xml + shared strings decode inline entities', () => {
  const shared = parseSharedStringsXml('<sst><si><t>A &amp; B</t></si></sst>');
  assert.deepEqual(shared, ['A & B']);
  const grid = parseSheetXml(
    '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>2</v></c></row></sheetData>',
    shared
  );
  assert.deepEqual(grid, [['A & B', '2']]);
});

test('status aliases and batch rollup', () => {
  assert.equal(normalizeCatalogStatus('imported'), 'listed');
  assert.equal(normalizeCatalogStatus('failed'), 'error');
  assert.equal(normalizeCatalogStatus('in-progress'), 'processing');
  assert.equal(rollupBatchStatus(['listed', 'listed']), 'listed');
  assert.equal(rollupBatchStatus(['error', 'error']), 'error');
  assert.equal(rollupBatchStatus(['listed', 'error']), 'partial');
  assert.equal(rollupBatchStatus(['pending', 'listed']), 'processing');
  assert.deepEqual(countRowOutcomes(['listed', 'failed', 'pending']), {
    listed: 1,
    error: 1,
    pending: 1,
    processing: 0,
  });
});

test('kind inference and photo URL split', () => {
  assert.equal(normalizeCatalogKind('Lasers', 'part'), 'used');
  assert.equal(normalizeCatalogKind('consumables', 'part'), 'consumable');
  assert.deepEqual(parsePhotoUrls('https://a.example/1.jpg; https://b.example/2.png, not-a-url'), [
    'https://a.example/1.jpg',
    'https://b.example/2.png',
  ]);
});

test('template CSV has documented columns', () => {
  const csv = buildCatalogTemplateCsv('part');
  assert.match(csv, /^sku,title,brand,model,condition,price,qty,description,category,photos\n/);
  const rows = parseCsv(csv);
  assert.equal(rows[0][0], 'sku');
  assert.ok(rows[1][0]);
});

test('storage path stays under org / user / batch', () => {
  const path = catalogStoragePath({
    organizationId: 44,
    userId: 'user-1',
    batchId: 'batch-9',
    filename: '../../weird name.CSV',
  });
  assert.equal(path, '44/user-1/batch-9/weird_name.CSV');
});

test('agent email uses MARKETPLACE_UPLOAD_AGENT_EMAIL and never the QA inbox', () => {
  withEnv({ MARKETPLACE_UPLOAD_AGENT_EMAIL: undefined }, () => {
    assert.equal(marketplaceUploadAgentEmail(), MARKETPLACE_UPLOAD_AGENT_EMAIL_DEFAULT);
  });
  withEnv({ MARKETPLACE_UPLOAD_AGENT_EMAIL: 'larry+catalog@example.com' }, () => {
    assert.equal(marketplaceUploadAgentEmail(), 'larry+catalog@example.com');
  });
  const text = catalogUploadText({
    batchId: '11111111-1111-1111-1111-111111111111',
    organizationId: 88,
    organizationName: 'Acme Parts',
    organizationType: 'parts_supplier',
    uploaderEmail: 'pat@acme.test',
    filename: 'stock.csv',
    catalogKind: 'part',
    rowCount: 2,
    rows: [
      {
        rowNumber: 1,
        catalogKind: 'part',
        sku: 'A',
        title: 'Board',
        brand: 'Candela',
        model: null,
        condition: null,
        price: 10,
        qty: 1,
        description: null,
        category: 'part',
        photoUrls: [],
        raw: {},
        status: 'pending',
        errorMessage: null,
      },
    ],
  });
  assert.match(text, /LIVE organization/);
  assert.doesNotMatch(text, /FieldserviceTotalService\+QA@gmail\.com/);
  assert.match(catalogUploadSubject({
    batchId: 'b',
    organizationId: 1,
    organizationName: 'Acme Parts',
    filename: 'x.csv',
    catalogKind: 'part',
    rowCount: 2,
    rows: [],
  }), /Acme Parts/);
});

test('upload API gates sellers and emails the agent inbox', () => {
  const route = readFileSync(join(here, '../../app/api/marketplace/uploads/route.ts'), 'utf8');
  const auth = readFileSync(join(here, './catalog-upload-auth.ts'), 'utf8');
  const god = readFileSync(join(here, '../../app/api/god/marketplace-uploads/[id]/route.ts'), 'utf8');
  const page = readFileSync(join(here, '../../app/marketplace/uploads/page.tsx'), 'utf8');
  assert.match(auth, /canBulkUploadCatalog/);
  assert.match(route, /CATALOG_UPLOAD_BUCKET/);
  assert.match(route, /marketplaceUploadAgentEmail/);
  assert.match(god, /requireGodCaller/);
  assert.match(god, /marketplace_listing_id/);
  assert.match(page, /Download template/);
  assert.match(page, /accept="\.csv,\.xlsx/);
});
