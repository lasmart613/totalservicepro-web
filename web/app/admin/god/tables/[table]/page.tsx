'use client';

import { useParams } from 'next/navigation';
import { GodTableBrowser } from '@/components/god/GodTableBrowser';

export default function GodTablePage() {
  const params = useParams();
  const table = String(params?.table || '');
  if (!table) return <div className="text-[var(--text3)]">Missing table.</div>;
  return <GodTableBrowser tableKey={table} />;
}
