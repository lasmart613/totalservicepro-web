import type { NextRequest } from 'next/server';
import { runDirectoryReviewList, runDirectoryReview } from '@/lib/directory-review-api';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return runDirectoryReviewList(req);
}

export async function POST(req: NextRequest) {
  return runDirectoryReview(req);
}
