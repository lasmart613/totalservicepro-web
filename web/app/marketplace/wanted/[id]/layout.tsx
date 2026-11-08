import type { Metadata } from 'next';

export const metadata: Metadata = {
  robots: { index: false, follow: true },
  alternates: { canonical: null },
};

export default function WantedPostLayout({ children }: { children: React.ReactNode }) {
  return children;
}
