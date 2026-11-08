import { RequireAuth } from '@/components/RequireAuth';

export { privateAppMetadata as metadata } from '@/lib/seo';

export default function WantedNewLayout({ children }: { children: React.ReactNode }) {
  return <RequireAuth>{children}</RequireAuth>;
}
