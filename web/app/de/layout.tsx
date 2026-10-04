import type { Metadata } from 'next';
import { PublicLocaleFrame } from '@/components/i18n/PublicLocaleFrame';

export const metadata: Metadata = {
  title: { absolute: 'RepairPlanet auf Deutsch' },
  robots: { index: false, follow: false },
};

export default function DeLayout({ children }: { children: React.ReactNode }) {
  return <PublicLocaleFrame locale="de">{children}</PublicLocaleFrame>;
}
