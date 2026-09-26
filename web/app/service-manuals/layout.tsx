import type { ReactNode } from 'react';
import { PublicContentShell } from '@/components/content/PublicContentShell';

export default function ServiceManualsLayout({ children }: { children: ReactNode }) {
  return <PublicContentShell>{children}</PublicContentShell>;
}
