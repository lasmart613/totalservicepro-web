import { displayListingPrice } from '@/lib/marketplace/guest';

export function GuestAwarePrice({
  signedIn,
  priceLabel,
  className = 'font-semibold text-[var(--gold)]',
}: {
  signedIn: boolean;
  priceLabel: string;
  className?: string;
}) {
  const shown = displayListingPrice(signedIn, priceLabel);
  if (signedIn) {
    return <div className={className}>{shown}</div>;
  }
  return (
    <div className={className} title="Sign up to see pricing">
      <span className="inline-block blur-[7px] select-none pointer-events-none" aria-hidden>
        {shown}
      </span>
      <span className="sr-only">Sign up to see price</span>
    </div>
  );
}
