import Link from 'next/link';
import { Header } from '@/components/Header';

/** FSEs are invited via Team — there is no top-level FSE signup. */
export default function SignupFsePage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-lg mx-auto w-full px-4 py-16 text-center">
        <h1 className="text-3xl font-extrabold">FSE accounts are by invitation</h1>
        <p className="text-[var(--text3)] mt-3 mb-8">
          Field service engineers join through their service organization&apos;s Team page.
          There is no individual FSE signup.
        </p>
        <div className="flex flex-wrap gap-2 justify-center">
          <Link href="/signup" className="btn btn-primary">
            Create an organization
          </Link>
          <Link href="/login" className="btn btn-secondary">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
