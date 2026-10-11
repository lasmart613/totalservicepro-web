import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ACCOUNT_DELETION_DAYS,
  LEGAL_CONTACT_EMAIL,
  LEGAL_EFFECTIVE_DATE,
  LEGAL_ORIGIN,
  LEGAL_PRODUCT,
  legalMailto,
} from '@/lib/legal-routes';

export const dynamic = 'force-static';

const DELETE_SUBJECT = 'Delete my account';

export const metadata: Metadata = {
  title: 'Delete your account',
  description: `How to delete a ${LEGAL_PRODUCT} account and what data is removed or kept.`,
  alternates: { canonical: '/delete-account' },
};

export default function DeleteAccountPage() {
  return (
    <article className="content-prose">
      <h1>Delete your account</h1>
      <p>Effective date: {LEGAL_EFFECTIVE_DATE}</p>
      <p>
        This page is the public account-deletion URL for {LEGAL_PRODUCT} on the web and in the
        Android app. You do not need to be signed in to read it or to send the request.
      </p>

      <h2>How to ask</h2>
      <p>
        Email <a href={legalMailto(DELETE_SUBJECT)}>{LEGAL_CONTACT_EMAIL}</a> from the email
        address on the account. Use the subject &quot;{DELETE_SUBJECT}&quot;. Tell us the
        organization name. If you are the only member and you want that organization removed as
        well, say so in the same email.
      </p>
      <p>
        We use the account email to confirm the request is yours. We complete a verified request
        within {ACCOUNT_DELETION_DAYS} days and email you when it is done, unless the mailbox
        itself has been removed.
      </p>

      <h2>What the apps do today</h2>
      <p>
        There is no supported self-serve deletion on the website or in the app. The request path
        is the email above.
      </p>
      <p>
        While you are signed in, the website Profile page (<code>/profile</code>) lets you edit
        your name, phone, job title, and signature. It does not delete the account.
      </p>
      <p>
        The Android app&apos;s bundled profile page has a delete control. That control asks you
        to confirm, then only tries to set <code>user_profiles.is_active</code> to false and
        sign you out. It does not delete the Supabase login or the rest of the data. That client
        write is not the deletion path this page describes. Send the email even if you already
        used that control.
      </p>

      <h2>What we delete</h2>
      <p>Within {ACCOUNT_DELETION_DAYS} days of a verified request, we delete:</p>
      <ul>
        <li>The Supabase authentication user for that email, so the login no longer works.</li>
        <li>
          The user profile: name, phone, job title, signature, emergency contact, certifications,
          and avatar, where those fields exist for that person.
        </li>
        <li>Files that belong only to that person, such as a personal avatar.</li>
      </ul>
      <p>
        If you are the only member and you asked us to delete the organization, we also delete
        organization content we are not required to keep for tax or accounting.
      </p>

      <h2>What we keep, and why</h2>
      <ul>
        <li>
          Invoices, payment status, and other billing records, because tax and accounting rules
          require them.
        </li>
        <li>
          Records Stripe (website payments) and Google Play (Android subscriptions) keep under
          their own terms. We cannot delete those copies from their systems.
        </li>
        <li>
          Organization records that other members still use, such as tickets, customers,
          estimates, and invoices of that shop. Those belong to the organization.
        </li>
        <li>
          Usage counts already written for assistant and voice limits, and short-lived security
          logs.
        </li>
      </ul>

      <h2>Related</h2>
      <p>
        <Link href="/privacy">Privacy Policy</Link>
        {' · '}
        <Link href="/terms">Terms</Link>
        {' · '}
        <a href={`${LEGAL_ORIGIN}/delete-account`}>{LEGAL_ORIGIN}/delete-account</a>
      </p>
    </article>
  );
}
