import type { Metadata } from 'next';
import { PublicLocaleFrame } from '@/components/i18n/PublicLocaleFrame';
import './he-preview.css';

export const metadata: Metadata = {
  title: { absolute: 'RepairPlanet בעברית' },
  robots: { index: false, follow: false },
};

export default function HeLayout({ children }: { children: React.ReactNode }) {
  return <PublicLocaleFrame locale="he">{children}</PublicLocaleFrame>;
}
