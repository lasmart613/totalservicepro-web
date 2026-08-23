'use client';

import React from 'react';
import Link from 'next/link';
import type { UpgradeTarget } from '@/lib/org-plan';

export const UPGRADE_HREF = '/plans';
export const UPGRADE_LABEL = 'Upgrade plan';

type UpgradePlanLinkProps = {
  className?: string;
  onClick?: () => void;
  children?: React.ReactNode;
  /**
   * Ignored for navigation. Free and Premium chrome always go to /plans.
   * Kept so dashboard / company / admin call sites do not need a second pass.
   */
  target?: UpgradeTarget;
};

/**
 * Dashboard, company profile menu, /company, and admin sidebar.
 * Always /plans — never Stripe Checkout. Checkout starts only from a
 * labeled button on /plans (Upgrade to Premium / Upgrade to Team).
 */
export function UpgradePlanLink({ className, onClick, children }: UpgradePlanLinkProps) {
  return (
    <Link href={UPGRADE_HREF} className={className} onClick={onClick}>
      {children ?? UPGRADE_LABEL}
    </Link>
  );
}
