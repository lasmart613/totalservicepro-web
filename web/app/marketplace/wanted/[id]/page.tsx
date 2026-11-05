'use client';

import { useParams } from 'next/navigation';
import { WantedDetail } from '@/components/marketplace/WantedDetail';

export default function WantedDetailPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === 'string' ? params.id : '';
  return <WantedDetail postId={id} />;
}
