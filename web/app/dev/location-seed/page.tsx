import { notFound } from 'next/navigation';
import { SeededLocationsPreview } from './preview';

/** Local seeded screen for the location UI. Not a live customer. Hidden in production. */
export default function SeededLocationsPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <SeededLocationsPreview />;
}
