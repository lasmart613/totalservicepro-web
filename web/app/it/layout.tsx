import type { Metadata } from 'next';
import { PublicLocaleFrame } from '@/components/i18n/PublicLocaleFrame';

export const metadata: Metadata = {
  title: { absolute: 'RepairPlanet in italiano' },
  robots: { index: false, follow: false },
};

export default function ItLayout({ children }: { children: React.ReactNode }) {
  return <PublicLocaleFrame locale="it">{children}</PublicLocaleFrame>;
}
