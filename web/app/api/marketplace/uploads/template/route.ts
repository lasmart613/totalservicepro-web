import { NextRequest, NextResponse } from 'next/server';
import { buildCatalogTemplateCsv, catalogTemplateXlsx, defaultCatalogKind } from '@/lib/marketplace/catalog-upload';
import { getMarketplaceCaller } from '@/lib/marketplace/caller';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const caller = await getMarketplaceCaller(req);
  if (!caller) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }
  const format = String(req.nextUrl.searchParams.get('format') || 'csv').toLowerCase();
  const kind = defaultCatalogKind(caller.orgType);
  if (format === 'xlsx') {
    const buf = catalogTemplateXlsx(kind);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="repairplanet-parts-catalog-template.xlsx"',
      },
    });
  }
  const csv = buildCatalogTemplateCsv(kind);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="repairplanet-parts-catalog-template.csv"',
    },
  });
}
