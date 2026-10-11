import type { ReactNode } from 'react';
import { PublicContentShell } from '@/components/content/PublicContentShell';

/**
 * Privacy, terms, and account deletion.
 * Public pages: this layout does not gate on a session, and middleware does
 * not send these paths to sign-in or onboarding.
 * The shell is a server component, so the pages render without JavaScript.
 */
export default function PublicLegalLayout({ children }: { children: ReactNode }) {
  return <PublicContentShell>{children}</PublicContentShell>;
}
