'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useUpgradeEntry } from '@/lib/use-show-upgrade';
import { startClientUpgradeCheckout } from '@/lib/billing/start-client-checkout';
import type { UpgradeTarget } from '@/lib/org-plan';

export const UPGRADE_HREF = '/plans';
export const UPGRADE_LABEL = 'Upgrade plan';

type UpgradePlanLinkProps = {
  className?: string;
  onClick?: () => void;
  children?: React.ReactNode;
  /** From the same gate that decided to show Upgrade — avoids a second fetch race. */
  target?: UpgradeTarget;
};

/**
 * Free: /plans (Premium + Team). Mid-tier (Premium): stay signed in and start
 * Stripe Checkout for Team ($39.99/mo) on the existing org.
 */
export function UpgradePlanLink({ className, onClick, children, target }: UpgradePlanLinkProps) {
  const entry = useUpgradeEntry();
  const resolvedTarget = target ?? entry.target;
  const [starting, setStarting] = useState(false);

  async function startTeamCheckout(event: React.MouseEvent<HTMLAnchorElement>) {
    onClick?.();
    if (resolvedTarget !== 'team') return;
    event.preventDefault();
    if (starting) return;
    setStarting(true);
    try {
      const session = await startClientUpgradeCheckout('team_monthly');
      window.location.assign(session.url);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not start Stripe Checkout');
      setStarting(false);
    }
  }

  return (
    <Link href={UPGRADE_HREF} className={className} onClick={startTeamCheckout}>
      {starting ? 'Starting checkout…' : children ?? UPGRADE_LABEL}
    </Link>
  );
}
