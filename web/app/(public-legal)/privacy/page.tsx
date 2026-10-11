import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ACCOUNT_DELETION_DAYS,
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
  title: 'Privacy Policy',
  description:
    'Privacy Policy for Total Service Pro and RepairPlanet: accounts, organization data, photos, purchases, voice, and the AI assistant.',
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPolicyPage() {
  return (
    <article className="content-prose">
      <h1>Privacy Policy</h1>
      <p>Effective date: {LEGAL_EFFECTIVE_DATE}</p>
      <p>
        This is the privacy policy for {LEGAL_PRODUCT}, including the {LEGAL_SITE_NAME} website at{' '}
        <a href={LEGAL_ORIGIN}>{LEGAL_ORIGIN.replace('https://', '')}</a> and the {LEGAL_PRODUCT}{' '}
        Android app (package <code>com.photometrytools</code>). {LEGAL_PRODUCT} is published as{' '}
        {LEGAL_PRODUCT} and {LEGAL_NETWORK}.
      </p>

      <h2>Who to contact</h2>
      <p>
        Email <a href={legalMailto('Privacy')}>{LEGAL_CONTACT_EMAIL}</a>.
      </p>
      <p>Mailing address: {LEGAL_POSTAL_ADDRESS}.</p>
      <p>
        That address and email are the ones already used on {LEGAL_PRODUCT} email. This page does
        not add a separate legal-entity name.
      </p>

      <h2>Information we collect</h2>
      <p>
        &quot;Collected&quot; means the information leaves the device and comes to us or to a
        processor working for us. Sending it to our own Supabase project or to this website is
        collection by us. We do not sell personal information.
      </p>

      <h3>Account</h3>
      <p>
        Sign-in uses Supabase Auth. We collect the email address and the sign-in secret Supabase
        stores (a password, or the identity Google shares when you use Google sign-in, such as
        email, name, and profile photo URL). The website and the Android app keep a session
        (access token and refresh token) so you stay signed in. The app stores that session on
        the device and sends it back to Supabase and to {LEGAL_ORIGIN.replace('https://', '')}. An
        account is required for the signed-in product.
      </p>
      <p>
        The Android app can use the system biometric prompt to unlock a session that is already
        on the device. Fingerprint or face data stays with the phone. We do not collect it.
      </p>

      <h3>Profile and organization</h3>
      <p>
        Profile fields stored in Supabase include name, phone, job title, and role. The website
        profile also stores a technician signature you draw. The Android profile can also store
        an emergency contact name and phone, certifications, and notification preferences, when
        you enter them.
      </p>
      <p>
        Organization and workflow data you or your team create is stored in Supabase. That
        includes the organization name, address, phone, email, and website; customers and their
        contacts; service tickets and schedules; estimates, invoices, purchase orders, and
        service reports; team invitations; and directory or marketplace listings. You choose
        what to enter. Teammates in the same organization can see that organization&apos;s
        records.
      </p>

      <h3>Photos</h3>
      <p>
        When you choose an image to keep with a record, we store that file. On the website and
        in the Android app this includes an organization logo, a profile photo, an equipment
        photo, a parts image, and marketplace listing photos. Logos and similar uploads go to
        Supabase Storage. A signature you draw is stored on the profile. These files are separate
        from a business-card scan: the image you pick is the image we keep.
      </p>

      <h3>Camera and business cards</h3>
      <p>
        The mobile apps can scan a business card to fill a customer record. The camera is used
        only when you choose to scan. Card text is recognized on the device. It is not sent to a
        cloud optical character recognition service. You review the fields, such as name, company,
        phone, email, and address, and you can edit them. Only the fields you confirm are saved
        to your customer records. Those confirmed fields are stored with the customer. The card
        image is not uploaded and is not kept. If you cancel before you confirm, nothing from
        that card is saved.
      </p>
      <p>
        If a confirmed save cannot finish immediately, the confirmed fields can stay on the phone
        until they sync. The card image is not part of that waiting copy.
      </p>

      <h3>Purchases</h3>
      <p>
        On the website, paid plans, invoice checkout, and marketplace payments use Stripe. We
        receive payment status, Stripe customer and subscription identifiers, checkout session
        identifiers, and receipt links. Card numbers stay with Stripe. We do not store the full
        card number.
      </p>
      <p>
        In the Android app, subscriptions use Google Play Billing. The app sends the product id
        and purchase token to our Supabase function <code>verify-subscription</code> so we can
        confirm the purchase. Google Play processes the payment. You only send a purchase token
        if you buy.
      </p>

      <h3>Voice and microphone</h3>
      <p>
        The Android app uses the microphone only after you start voice mode. It requests the
        microphone permission at that time. Speech recognition runs on the device. The transcript
        is sent to the assistant as text.
      </p>
      <p>
        If you use Grok voice, the answer text (not the raw microphone audio) is sent to the
        Supabase function <code>grok-tts</code>. That function calls xAI, which generates the
        spoken audio. The app then plays that audio. You can use the device&apos;s own voice
        instead. The website assistant is text only. Voice readout is an Android feature.
      </p>

      <h3>AI assistant</h3>
      <p>
        Questions you ask the manuals assistant, on the website or in the app, are sent to xAI
        through the Supabase function <code>grok-assistant</code>. The request can include the
        question and the manual context needed to answer it. xAI processes that content to
        produce the answer. The xAI key stays on the server.
      </p>
      <p>
        We store a usage row in Supabase (<code>api_usage</code>): your account id, the request
        type (assistant text or voice), and a token count. That row is how daily limits are
        counted. We do not keep a separate server archive of the question text in that table.
        xAI receives the question in order to answer it.
      </p>

      <h3>Location</h3>
      <p>
        The Android app does not request location permission and does not read GPS. A typed
        address can open a map link. That is a tap you make.
      </p>

      <h3>Website analytics, ads, and diagnostics</h3>
      <p>
        The website loads Google Analytics 4 (measurement id <code>G-GNBJQ2DMQB</code>) on
        production hosts. That records page views and similar usage of the site. The Android
        app does not include an analytics or crash SDK.
      </p>
      <p>
        The Android app does not include an advertising SDK and does not collect an advertising
        id. On the website, a signed-in free account may see a Google AdSense banner. Paid
        organizations and logged-out marketing pages do not. The public landing page describes
        the product as a soft beta.
      </p>

      <h2>How we use information</h2>
      <ul>
        <li>To run the account, the organization, and the service workflow.</li>
        <li>To keep you signed in and to apply the plan you bought.</li>
        <li>To send email you trigger, such as team invites, estimates, invoices, reports, and purchase orders, through Resend.</li>
        <li>To send shop or clinic invitation email, which includes an unsubscribe link.</li>
        <li>To answer assistant questions and, on Android, to speak an answer.</li>
        <li>To measure website traffic and, for signed-in free accounts, to show an ad.</li>
        <li>To protect the service and to keep tax and accounting records.</li>
      </ul>

      <h2>Processors and hosting</h2>
      <p>These companies process data for us, for the reasons above:</p>
      <ul>
        <li>Supabase — authentication, database, file storage, and the assistant, voice, and purchase-verification functions.</li>
        <li>Netlify — hosting for this website.</li>
        <li>Resend — email delivery.</li>
        <li>Stripe — website payments.</li>
        <li>Google — Google sign-in, Google Play Billing, Google Analytics 4, Google AdSense on eligible website sessions, and map links you open.</li>
        <li>xAI — assistant answers and Grok voice audio.</li>
      </ul>

      <h2>Sharing</h2>
      <p>We do not sell personal information.</p>
      <p>
        We share information with the processors above so they can perform the service. We share
        organization records with people in that organization. A directory listing or marketplace
        listing is visible to other people when it is published. Invitation and document email
        goes to the address you or your team provide.
      </p>

      <h2>Retention</h2>
      <p>
        We keep account, profile, and organization data while the account is in use. After a
        verified deletion request, we delete the login and the profile, and personal files that
        belong only to that person, within {ACCOUNT_DELETION_DAYS} days. Details and the
        exceptions are on the <Link href="/delete-account">delete account</Link> page.
      </p>
      <p>
        We keep invoices, payment records, and other billing records needed for tax and
        accounting. Stripe and Google Play keep their own transaction records. Organization
        records that other members still use stay with the organization. Usage counts and
        short-lived security logs may remain after the login is removed. Analytics and ad
        cookies follow Google&apos;s retention for those products.
      </p>

      <h2>Security</h2>
      <p>
        The site is served over HTTPS. Private records are available to a signed-in account, and
        organization records are limited to that organization. The xAI key and other provider
        secrets stay on the server. They are not shipped in the app or the website bundle.
      </p>

      <h2>Children</h2>
      <p>
        {LEGAL_PRODUCT} is a tool for working technicians and the businesses they serve. It is
        not directed to children. We do not knowingly collect personal information from anyone
        under 13. If you believe we have, email {LEGAL_CONTACT_EMAIL} and we will delete it.
      </p>

      <h2>Your choices and rights</h2>
      <ul>
        <li>You can review and correct profile fields while signed in, on the website Profile page.</li>
        <li>
          You can ask us to delete the account from the <Link href="/delete-account">delete account</Link> page.
        </li>
        <li>
          Shop and clinic invitation email has an unsubscribe link (
          <a href={`${LEGAL_ORIGIN}/unsubscribe`}>{LEGAL_ORIGIN}/unsubscribe</a>
          ). You can also email {LEGAL_CONTACT_EMAIL} with the subject &quot;unsubscribe&quot;.
        </li>
        <li>
          You can email {LEGAL_CONTACT_EMAIL} to ask for a copy of the personal information we
          hold about you, or to correct it. California residents can use the same address. We do
          not sell personal information.
        </li>
      </ul>

      <h2>Changes</h2>
      <p>
        When this policy changes, we will post the new version at{' '}
        <a href={`${LEGAL_ORIGIN}/privacy`}>{LEGAL_ORIGIN}/privacy</a> and change the effective
        date at the top. The earlier aliases <code>/privacy-policy</code> and{' '}
        <code>/legal/privacy</code> redirect here.
      </p>

      <h2>Contact</h2>
      <p>
        {LEGAL_PRODUCT} / {LEGAL_NETWORK}
        <br />
        {LEGAL_POSTAL_ADDRESS}
        <br />
        <a href={legalMailto('Privacy')}>{LEGAL_CONTACT_EMAIL}</a>
      </p>
      <p>
        <Link href="/terms">Terms</Link>
        {' · '}
        <Link href="/delete-account">Delete account</Link>
      </p>
    </article>
  );
}
