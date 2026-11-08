/**
 * Real chapter files from manuals.id 9 (Mini GentleYAG / VP YAG, 8501-01-1769).
 * These are the parts-list and head/rail drawing PDFs the sweep must finish
 * before any other manual. They are a queue, not invented part rows.
 */
export type ManualNineSource = {
  storage_path: string;
  title: string;
  role: 'parts_list' | 'assembly_drawing';
};

export const MANUAL_NINE_ID = 9;

export const MANUAL_NINE_SOURCES: ManualNineSource[] = [
  { role: 'parts_list', title: 'Fluid Section Assembly', storage_path: 'shared/candela/VPYag/Sect 4/7122-00-3287_F.pdf' },
  { role: 'parts_list', title: 'DCD Assembly', storage_path: 'shared/candela/VPYag/Sect 4/7122-00-3306_F.pdf' },
  { role: 'parts_list', title: 'DI Pump Assembly', storage_path: 'shared/candela/VPYag/Sect 4/7122-00-3348_C.pdf' },
  { role: 'parts_list', title: 'Calport Assembly', storage_path: 'shared/candela/VPYag/Sect 4/7122-00-3441_C.pdf' },
  { role: 'parts_list', title: '6/8/10mm Delivery System with DCD', storage_path: 'shared/candela/VPYag/Sect 4/7122-00-3449_C.pdf' },
  { role: 'parts_list', title: '6/8/10mm Delivery System without DCD', storage_path: 'shared/candela/VPYag/Sect 4/7122-00-3450_B.pdf' },
  { role: 'parts_list', title: '12/15/18mm Delivery System with DCD', storage_path: 'shared/candela/VPYag/Sect 4/7122-00-3451_B.pdf' },
  { role: 'parts_list', title: '12/15/18mm Delivery System without DCD', storage_path: 'shared/candela/VPYag/Sect 4/7122-00-3452_A.pdf' },
  { role: 'parts_list', title: 'Dump Resistor Assembly', storage_path: 'shared/candela/VPYag/Sect 4/7122-00-3470_B.pdf' },
  { role: 'parts_list', title: 'AC Input Assembly', storage_path: 'shared/candela/VPYag/Sect 4/7122-00-3471_C.pdf' },
  { role: 'parts_list', title: '6/8/10mm Delivery Cable with DCD', storage_path: 'shared/candela/VPYag/Sect 4/7122-00-3484_03.pdf' },
  { role: 'parts_list', title: '12/15/18mm Delivery Cable with DCD', storage_path: 'shared/candela/VPYag/Sect 4/7122-00-3487_02.pdf' },
  { role: 'parts_list', title: 'Display Bezel Assembly', storage_path: 'shared/candela/VPYag/Sect 4/7122-00-3520_01.pdf' },
  { role: 'parts_list', title: '10/12/15mm Fiber Assembly', storage_path: 'shared/candela/VPYag/Sect 4/7122-00-3542_B.pdf' },
  { role: 'parts_list', title: '1.5/3mm Delivery System without DCD', storage_path: 'shared/candela/VPYag/Sect 4/7122-00-3558_B.pdf' },
  { role: 'parts_list', title: 'Delivery Cable with DCD', storage_path: 'shared/candela/VPYag/Sect 4/7122-00-3599_A.pdf' },
  { role: 'parts_list', title: '8mm Delivery System with DCD', storage_path: 'shared/candela/VPYag/Sect 4/7122-00-3615_02.pdf' },
  { role: 'parts_list', title: '8mm Delivery System without DCD', storage_path: 'shared/candela/VPYag/Sect 4/7122-00-3616_02.pdf' },
  { role: 'parts_list', title: '8mm Fiber Assembly', storage_path: 'shared/candela/VPYag/Sect 4/7122-00-3617_02.pdf' },
  { role: 'parts_list', title: '12mm Delivery System with DCD', storage_path: 'shared/candela/VPYag/Sect 4/7122-00-3618_02.pdf' },
  { role: 'parts_list', title: '12mm Delivery System without DCD', storage_path: 'shared/candela/VPYag/Sect 4/7122-00-3619_02.pdf' },
  { role: 'parts_list', title: '12mm Fiber Assembly', storage_path: 'shared/candela/VPYag/Sect 4/7122-00-3620_02.pdf' },
  { role: 'parts_list', title: '3mm Delivery System with DCD', storage_path: 'shared/candela/VPYag/Sect 4/7122-00-3621_03.pdf' },
  { role: 'parts_list', title: '3mm Fiber Assembly', storage_path: 'shared/candela/VPYag/Sect 4/7122-00-3623_02.pdf' },
  { role: 'parts_list', title: '3mm Delivery Cable with DCD', storage_path: 'shared/candela/VPYag/Sect 4/7122-00-3629_02.pdf' },
  { role: 'parts_list', title: '3mm Delivery System without DCD', storage_path: 'shared/candela/VPYag/Sect 4/7122-00-3630_03.pdf' },
  { role: 'parts_list', title: 'Aperture Assembly', storage_path: 'shared/candela/VPYag/Sect 4/7122-00-7475_A.pdf' },
  { role: 'parts_list', title: 'Beam Blocker Assembly', storage_path: 'shared/candela/VPYag/Sect 4/7122-00-7478_03.pdf' },
  { role: 'parts_list', title: '10/12/15mm Delivery System with DCD', storage_path: 'shared/candela/VPYag/Sect 4/7122-00-7482_B.pdf' },
  { role: 'parts_list', title: '10/12/15mm Delivery System without DCD', storage_path: 'shared/candela/VPYag/Sect 4/7122-00-7484_A.pdf' },
  { role: 'parts_list', title: 'Laser System, Shipping Assembly', storage_path: 'shared/candela/VPYag/Sect 4/9914-00-0950_C.pdf' },
  { role: 'assembly_drawing', title: 'Laser Rail', storage_path: 'shared/candela/VPYag/Sect 4/7122-99-3446_04.pdf' },
  { role: 'assembly_drawing', title: 'Laser Head', storage_path: 'shared/candela/VPYag/Sect 4/7122-99-3497_01.pdf' },
  { role: 'assembly_drawing', title: 'Aiming Beam', storage_path: 'shared/candela/VPYag/Sect 4/7122-99-3476_04.pdf' },
  { role: 'assembly_drawing', title: 'Focus Lens Housing', storage_path: 'shared/candela/VPYag/Sect 4/7122-99-7476_01.pdf' },
  { role: 'assembly_drawing', title: 'Fiber Receptacle', storage_path: 'shared/candela/VPYag/Sect 4/7122-99-7477_B.pdf' },
  { role: 'assembly_drawing', title: 'Head Detector', storage_path: 'shared/candela/VPYag/Sect 4/7122-99-7479_02.pdf' },
];

export type SourceFileStatus = 'pending' | 'extracted' | 'no_line_items' | 'error';

export type ManualNineFile = ManualNineSource & { status: SourceFileStatus };

export function manualNineQueue(): ManualNineFile[] {
  return MANUAL_NINE_SOURCES.map((source) => ({ ...source, status: 'pending' }));
}

/** Other manuals stay queued until every manual-9 parts list and head/rail drawing is finished. */
export function manualNineBlocksLibrary(files: { status: SourceFileStatus }[]): boolean {
  return files.some((file) => file.status === 'pending' || file.status === 'error');
}

export type EvidenceLine = {
  mpn: string;
  description: string;
  source_path: string;
  qty?: number | null;
};

/** Accept only lines that cite a queued manual-9 file. Does not invent parts. */
export function acceptEvidenceLines(lines: EvidenceLine[]): { accepted: EvidenceLine[]; rejected: EvidenceLine[] } {
  const allowed = new Set(MANUAL_NINE_SOURCES.map((source) => source.storage_path));
  const accepted: EvidenceLine[] = [];
  const rejected: EvidenceLine[] = [];
  for (const line of lines) {
    const mpn = String(line.mpn || '').trim();
    const description = String(line.description || '').trim();
    if (!mpn || !description || !allowed.has(line.source_path)) rejected.push(line);
    else accepted.push({ ...line, mpn, description });
  }
  return { accepted, rejected };
}
