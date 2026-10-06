import type { Metadata } from 'next';
import { PublicLocaleFrame } from '@/components/i18n/PublicLocaleFrame';
import './fa-preview.css';

export const metadata: Metadata = {
  title: { absolute: 'RepairPlanet به فارسی' },
  robots: { index: false, follow: false },
};

export default function FaLayout({ children }: { children: React.ReactNode }) {
  return <PublicLocaleFrame locale="fa">{children}</PublicLocaleFrame>;
}
