import { redirect } from 'next/navigation';

/** Admin no longer has a separate customer list — use the org-scoped directory. */
export default function AdminCustomersRedirect() {
  redirect('/customers');
}
