'use client';

import type { ReactElement } from 'react';

import { TIERS, type Tier } from '@/lib/chat';

/**
 * The free/paid switch. It is sent with every message and becomes `user.tier` on the evaluate
 * request; the gateway suppresses `paid` unless the app's policy sets allow_paid_tiers, so this
 * is the fastest way to see a policy decision change in the UI (and in the audit record).
 */

export type TierToggleProps = {
  tier: Tier;
  onChange: (tier: Tier) => void;
  disabled: boolean;
};

const LABELS: Record<Tier, string> = { free: 'Free tier', paid: 'Paid tier' };

export const TierToggle = ({ tier, onChange, disabled }: TierToggleProps): ReactElement => (
  <div
    className="inline-flex rounded-full bg-stone-200 p-0.5"
    role="radiogroup"
    aria-label="User tier"
  >
    {TIERS.map((value) => (
      <button
        key={value}
        type="button"
        role="radio"
        aria-checked={tier === value}
        disabled={disabled}
        onClick={() => {
          onChange(value);
        }}
        className={`rounded-full px-3 py-1 text-xs font-medium transition disabled:opacity-50 ${
          tier === value ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600'
        }`}
      >
        {LABELS[value]}
      </button>
    ))}
  </div>
);
