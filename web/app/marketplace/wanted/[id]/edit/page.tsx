'use client';

import { useParams } from 'next/navigation';
import { WantedForm } from '@/components/marketplace/WantedForm';

export default function EditWantedPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === 'string' ? params.id : '';
  return <WantedForm postId={id} />;
}