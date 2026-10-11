import type { Metadata } from 'next';
import Link from 'next/link';
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_EFFECTIVE_DATE,
  LEGAL_NETWORK,
  LEGAL_ORIGIN,
  LEGAL_POSTAL_ADDRESS,
  LEGAL_PRODUCT,
  LEGAL_SITE_NAME,
  legalMailto,
} from '@/lib/legal-routes';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Terms',
  description: `Basic terms for using ${LEGAL_PRODUCT} on ${LEGAL_SITE_NAME} and in the Android app.`,
  alternates: { canonical: '/terms' },
};

export default function TermsPage() {
  return (
    <article className="content-prose">
      <h1>Terms</h1>
      <p>Effective date: {LEGAL_EFFECTIVE_DATE}</p>
      <p>
        These terms cover use of {LEGAL_PRODUCT} on the {LEGAL_SITE_NAME} website at{' '}
        <a href={LEGAL_ORIGIN}>{LEGAL_ORIGIN.replace('https://', '')}</a> and in the {LEGAL_PRODUCT}{' '}
        Android app. The product is published as {LEGAL_PRODUCT} and {LEGAL_NETWORK}.
      </p>

      <h2>Accounts</h2>
      <p>
        You need an account for the signed-in product. Use information that is yours, and keep
        the sign-in to yourself. A company admin invites technicians. You are responsible for
        activity under your login.
      </p>

      <h2>Your content</h2>
      <p>
        You keep the business records you enter, such as tickets, customers, estimates, and
        invoices. You give us permission to host that content so we can provide the service,
        including showing it to people in your organization and publishing a directory or
        marketplace listing when you turn that on.
      </p>

      <h2>Plans and payments</h2>
      <p>
        Paid plans on the website are processed by Stripe. Subscriptions in the Android app are
        processed by Google Play Billing. Those companies&apos; terms also apply to the payment.
        Fees, renewals, and refunds for a Play purchase follow Google Play&apos;s rules. Fees for
        a Stripe payment follow the checkout you completed.
      </p>

      <h2>Acceptable use</h2>
      <p>
        Use the product for lawful equipment-service work. Do not break into another
        organization&apos;s data, send malware, or upload content you do not have the right to
        use. We may suspend an account that abuses the service.
      </p>

      <h2>The product</h2>
      <p>
        {LEGAL_PRODUCT} is offered as a beta. Features can change. Manuals and assistant answers
        are aids for trained technicians. They are not a substitute for the current service
        procedure, the equipment manufacturer&apos;s instructions, or your own judgment.
      </p>

      <h2>Ending use</h2>
      <p>
        You can stop using the product at any time. To delete the account, follow{' '}
        <Link href="/delete-account">Delete your account</Link>.
      </p>

      <h2>Privacy</h2>
      <p>
        The <Link href="/privacy">Privacy Policy</Link> describes the information we collect and
        the companies that process it.
      </p>

      <h2>Contact</h2>
      <p>
        {LEGAL_PRODUCT} / {LEGAL_NETWORK}
        <br />
        {LEGAL_POSTAL_ADDRESS}
        <br />
        <a href={legalMailto('Terms')}>{LEGAL_CONTACT_EMAIL}</a>
      </p>
    </article>
  );
}
