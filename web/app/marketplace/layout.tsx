import { publicPageMetadata } from '@/lib/seo';

export const metadata = publicPageMetadata('marketplace');

export default function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
