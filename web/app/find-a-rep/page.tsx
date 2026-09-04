import { redirect } from 'next/navigation';

/** Shareable clinic onramp. Opens the landing find-a-rep form. */
export default function FindARepPage() {
  redirect('/?find=1');
}
