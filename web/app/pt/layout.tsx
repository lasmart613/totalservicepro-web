import type { Metadata } from 'next';
import { PublicLocaleFrame } from '@/components/i18n/PublicLocaleFrame';

export const metadata: Metadata = {
  title: { absolute: 'RepairPlanet em português' },
  robots: { index: false, follow: false },
};

export default function PtLayout({ children }: { children: React.ReactNode }) {
  return <PublicLocaleFrame locale="pt">{children}</PublicLocaleFrame>;
}
