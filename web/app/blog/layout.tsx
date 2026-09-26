import type { ReactNode } from 'react';
import { PublicContentShell } from '@/components/content/PublicContentShell';

export default function BlogLayout({ children }: { children: ReactNode }) {
  return <PublicContentShell>{children}</PublicContentShell>;
}
