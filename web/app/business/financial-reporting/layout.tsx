import type { Metadata } from 'next';
import { privateAppMetadata } from '@/lib/seo';

export const metadata: Metadata = {
  ...privateAppMetadata,
  title: 'Financial Reporting',
};

export default function FinancialReportingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
