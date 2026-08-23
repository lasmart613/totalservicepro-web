'use client';

import React from 'react';
import Link from 'next/link';

export const UPGRADE_HREF = '/plans';
export const UPGRADE_LABEL = 'Upgrade plan';

type UpgradePlanLinkProps = {
  className?: string;
  onClick?: () => void;
  children?: React.ReactNode;
};

/** Links to the existing /plans page. Does not invent checkout or prices. */
export function UpgradePlanLink({ className, onClick, children }: UpgradePlanLinkProps) {
  return (
    <Link href={UPGRADE_HREF} className={className} onClick={onClick}>
      {children ?? UPGRADE_LABEL}
    </Link>
  );
}
