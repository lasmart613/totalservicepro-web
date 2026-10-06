import { RequireAuth } from '@/components/RequireAuth';
export { privateAppMetadata as metadata } from '@/lib/seo';

export default function PrivateLayout({ children }: { children: React.ReactNode }) {
  return <RequireAuth>{children}</RequireAuth>;
}
