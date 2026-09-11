import { RequireAuth } from '@/components/RequireAuth';

export default function PrivateLayout({ children }: { children: React.ReactNode }) {
  return <RequireAuth>{children}</RequireAuth>;
}
