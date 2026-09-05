// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { AppMetrics } from '@/lib/metrics';

import { AppOverview } from './app-overview';

/**
 * The tiles claim things about where a number came from, and a hint that overstates it is a
 * lie an operator has no way to catch: an impression is an event the SDK reported, not the
 * separation attestation, and the estimated revenue uses the creative's CURRENT ecpm, so it
 * moves when someone edits a creative.
 */

const METRICS: AppMetrics = {
  turnsEvaluated: 10,
  adEligible: 6,
  eligibleRate: 0.6,
  serves: 4,
  suppressions: 6,
  fillRate: 4 / 6,
  impressions: 3,
  clicks: 1,
  ctr: 1 / 3,
  estimatedRevenue: 0.06,
  rpm: 10,
};

const overview = () =>
  render(
    <AppOverview
      metrics={METRICS}
      daily={[]}
      breakdown={{ total: 6, sensitiveTotal: 1, reasons: [] }}
      days={30}
    />,
  );

afterEach(cleanup);

describe('the overview tiles', () => {
  it('says impressions are SDK reported events, not attested renders', () => {
    const { container } = overview();
    expect(screen.getByTestId('metric-impressions').textContent).toBe('3');
    expect(container.textContent).toContain('impression events reported by the SDK');
    expect(container.textContent).not.toContain('attested renders');
  });

  it('says the estimated revenue uses the creative’s current ecpm', () => {
    const { container } = overview();
    expect(container.textContent).toContain('current ecpm');
  });
});
