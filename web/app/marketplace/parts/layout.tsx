import { publicPageMetadata } from '@/lib/seo';

export const metadata = publicPageMetadata('marketplaceParts');

export default function MarketplacePartsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
