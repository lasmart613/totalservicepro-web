import { RequireAuth } from '@/components/RequireAuth';

export { privateAppMetadata as metadata } from '@/lib/seo';

export default function NewJobLayout({ children }: { children: React.ReactNode }) {
  return <RequireAuth>{children}</RequireAuth>;
}
