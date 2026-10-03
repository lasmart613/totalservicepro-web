import type { Metadata } from 'next';
import { privateAppMetadata } from '@/lib/seo';

export const metadata: Metadata = {
  ...privateAppMetadata,
  title: 'Job Costing',
};

export default function JobCostingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
