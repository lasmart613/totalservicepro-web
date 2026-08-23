import Link from 'next/link';
import { GuestRedactedText } from '@/components/directory/GuestRedactedText';
import {
  GUEST_ADDRESS_PLACEHOLDER,
  GUEST_EMAIL_PLACEHOLDER,
  GUEST_INITIALS_PLACEHOLDER,
  GUEST_NAME_PLACEHOLDER,
  GUEST_PHONE_PLACEHOLDER,
  directoryHref,
  type GuestDirectoryCard as GuestDirectoryCardData,
} from '@/lib/directory/guest';

/**
 * Logged-out listing card. Every clickable surface — logo, name, pin,
 * address, phone, email, website chrome — is the same /signup link.
 * No tel:/mailto:/maps/website hrefs. No org detail path.
 */
export function GuestDirectoryCard({
  signedIn,
  card,
}: {
  signedIn: boolean;
  card: GuestDirectoryCardData;
}) {
  const href = directoryHref(signedIn, `/directory/${card.id}`);
  return (
    <Link href={href} className="card p-4 block hover:border-[var(--gold)] transition-colors">
      <div className="flex gap-3 items-center">
        <div className="w-12 h-12 rounded-xl bg-[var(--gold)] text-[#111] font-extrabold flex items-center justify-center overflow-hidden shrink-0">
          <GuestRedactedText
            signedIn={false}
            placeholder={GUEST_INITIALS_PLACEHOLDER}
            label="organization"
          />
        </div>
        <div className="min-w-0">
          <div className="font-bold text-[15px] truncate">
            <GuestRedactedText
              signedIn={false}
              placeholder={GUEST_NAME_PLACEHOLDER}
              label="organization name"
            />
          </div>
          <div className="text-[11px] font-bold text-[var(--gold)] mt-0.5">{card.typeLabel}</div>
          <div className="text-xs text-[var(--text3)] mt-0.5">
            📍{' '}
            {card.region ? (
              card.region
            ) : (
              <GuestRedactedText
                signedIn={false}
                placeholder={GUEST_ADDRESS_PLACEHOLDER}
                label="location"
              />
            )}
          </div>
        </div>
      </div>
      {(card.hasPhone || card.hasEmail || card.hasWebsite) && (
        <div className="text-xs text-[var(--text2)] mt-2.5 leading-relaxed">
          {card.hasPhone && (
            <GuestRedactedText
              signedIn={false}
              placeholder={GUEST_PHONE_PLACEHOLDER}
              label="phone"
            />
          )}
          {card.hasPhone && card.hasEmail && <span> · </span>}
          {card.hasEmail && (
            <GuestRedactedText
              signedIn={false}
              placeholder={GUEST_EMAIL_PLACEHOLDER}
              label="email"
            />
          )}
          {(card.hasPhone || card.hasEmail) && card.hasWebsite && <span> · </span>}
          {card.hasWebsite && <span className="text-[var(--gold)]">Website</span>}
        </div>
      )}
    </Link>
  );
}
