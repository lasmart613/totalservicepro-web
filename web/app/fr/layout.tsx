import type { Metadata } from 'next';
import { PublicLocaleFrame } from '@/components/i18n/PublicLocaleFrame';

export const metadata: Metadata = {
  title: { absolute: 'RepairPlanet en français' },
  robots: { index: false, follow: false },
};

export default function FrLayout({ children }: { children: React.ReactNode }) {
  return <PublicLocaleFrame locale="fr">{children}</PublicLocaleFrame>;
}
