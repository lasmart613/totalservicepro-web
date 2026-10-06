import { publicPageMetadata } from '@/lib/seo';

export const metadata = publicPageMetadata('terms');

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
