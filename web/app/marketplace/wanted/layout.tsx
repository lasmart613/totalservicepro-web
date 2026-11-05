import { publicPageMetadata } from '@/lib/seo';

export const metadata = publicPageMetadata('marketplaceWanted');

export default function WantedLayout({ children }: { children: React.ReactNode }) {
  return children;
}
