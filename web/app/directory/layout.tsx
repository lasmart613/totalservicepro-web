import { publicPageMetadata } from '@/lib/seo';

export const metadata = publicPageMetadata('directory');

export default function DirectoryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
