import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: { absolute: 'RepairPlanet en français' },
  robots: { index: false, follow: false },
};

export default function FrLayout({ children }: { children: React.ReactNode }) {
  return <div lang="fr">{children}</div>;
}
