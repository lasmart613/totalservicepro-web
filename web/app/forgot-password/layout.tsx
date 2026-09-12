import { publicPageMetadata } from '@/lib/seo';

export const metadata = publicPageMetadata('forgotPassword');

export default function ForgotPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
