import type { Metadata } from 'next';
import { PublicLocaleFrame } from '@/components/i18n/PublicLocaleFrame';

export const metadata: Metadata = {
  title: { absolute: 'RepairPlanet en español' },
  robots: { index: false, follow: false },
};

export default function EsLayout({ children }: { children: React.ReactNode }) {
  return <PublicLocaleFrame locale="es">{children}</PublicLocaleFrame>;
}
