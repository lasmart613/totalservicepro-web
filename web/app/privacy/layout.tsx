import { publicPageMetadata } from '@/lib/seo';

export const metadata = publicPageMetadata('privacy');

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
