import { publicPageMetadata } from '@/lib/seo';

export const metadata = publicPageMetadata('login');

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
