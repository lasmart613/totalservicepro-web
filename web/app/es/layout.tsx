import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: { absolute: 'RepairPlanet en español' },
  robots: { index: false, follow: false },
};

export default function EsLayout({ children }: { children: React.ReactNode }) {
  return <div lang="es">{children}</div>;
}
