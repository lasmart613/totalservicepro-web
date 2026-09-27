'use client';

import type { MouseEvent, ReactNode } from 'react';
import {
  formatServiceAddress,
  openNativeServiceAddress,
  serviceAddressMapsUrls,
  ticketAddressParts,
  type AddressParts,
  type AddressSource,
} from '@/lib/address-link';

type AddressLinkProps = AddressParts & {
  className?: string;
  children?: ReactNode;
  /** Plain text when street, city, state, and zip are all empty. */
  emptyText?: ReactNode;
};

export function AddressLink({
  street,
  city,
  state,
  zip,
  className,
  children,
  emptyText = null,
}: AddressLinkProps) {
  const full = formatServiceAddress({ street, city, state, zip });
  if (!full) {
    if (emptyText == null || emptyText === '') return null;
    return <span className={className}>{emptyText}</span>;
  }
  const href = serviceAddressMapsUrls(full)?.https;
  if (!href) {
    return <span className={className}>{children ?? full}</span>;
  }
  const label = children != null && children !== '' ? children : full;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      title={full}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        event.stopPropagation();
        if (openNativeServiceAddress(full)) event.preventDefault();
      }}
    >
      {label}
    </a>
  );
}

export function TicketAddressLink({
  ticket,
  className,
  children,
  emptyText,
}: {
  ticket: AddressSource | null | undefined;
  className?: string;
  children?: ReactNode;
  emptyText?: ReactNode;
}) {
  const parts = ticketAddressParts(ticket);
  return (
    <AddressLink className={className} emptyText={emptyText} {...parts}>
      {children}
    </AddressLink>
  );
}
