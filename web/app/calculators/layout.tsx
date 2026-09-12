import { publicPageMetadata } from '@/lib/seo';

export const metadata = publicPageMetadata('calculators');

export default function CalculatorsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
