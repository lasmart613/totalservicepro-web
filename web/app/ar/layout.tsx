import type { Metadata } from 'next';
import { PublicLocaleFrame } from '@/components/i18n/PublicLocaleFrame';
import './ar-preview.css';

export const metadata: Metadata = {
  title: { absolute: 'RepairPlanet بالعربية' },
  robots: { index: false, follow: false },
};

export default function ArLayout({ children }: { children: React.ReactNode }) {
  return <PublicLocaleFrame locale="ar">{children}</PublicLocaleFrame>;
}
