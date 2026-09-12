import { publicPageMetadata } from '@/lib/seo';

export const metadata = publicPageMetadata('signup');

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
