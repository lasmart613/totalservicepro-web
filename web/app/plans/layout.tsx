import { publicPageMetadata } from '@/lib/seo';

export const metadata = publicPageMetadata('plans');

export default function PlansLayout({ children }: { children: React.ReactNode }) {
  return children;
}
