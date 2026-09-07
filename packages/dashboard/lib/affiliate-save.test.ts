import type { AffiliateConfig } from '@adgateio/schemas';
import { describe, expect, it, vi } from 'vitest';

import { saveAffiliateConfig, type AffiliateWriter } from './affiliate-save';

/**
 * The port, and the claim it exists to prove: AN INVALID FORM NEVER TOUCHES THE WRITER. The
 * stored column is what the request path builds every affiliate link from, so a half-written
 * configuration is worse than none.
 */

const form = (fields: Record<string, string>) => ({
  get: (name: string) => fields[name] ?? null,
});

const writer = (
  result = { ok: true, issues: [] as string[] },
): AffiliateWriter & {
  calls: [string, AffiliateConfig][];
} => {
  const calls: [string, AffiliateConfig][] = [];
  return {
    calls,
    save: (appId, config) => {
      calls.push([appId, config]);
      return Promise.resolve(result);
    },
  };
};

describe('saveAffiliateConfig', () => {
  it('writes the parsed config when every field is valid', async () => {
    const port = writer();
    const result = await saveAffiliateConfig(
      port,
      'app_1',
      form({ partnerstack_program_id: 'ps-1' }),
    );
    expect(result).toEqual({ ok: true, config: { partnerstack: { program_id: 'ps-1' } } });
    expect(port.calls).toEqual([['app_1', { partnerstack: { program_id: 'ps-1' } }]]);
  });

  it('never calls the writer for an invalid form', async () => {
    const port = writer();
    const result = await saveAffiliateConfig(port, 'app_1', form({ impact_campaign_id: 'c-1' }));
    expect(result.ok).toBe(false);
    expect(port.calls).toEqual([]);
  });

  it('clears every network for a blank form, which is a real write', async () => {
    const port = writer();
    const result = await saveAffiliateConfig(port, 'app_1', form({}));
    expect(result).toEqual({ ok: true, config: {} });
    expect(port.calls).toEqual([['app_1', {}]]);
  });

  it('turns a refusal from the gateway into a form-level issue', async () => {
    const port = writer({ ok: false, issues: ['amazon.tag: Too small'] });
    const result = await saveAffiliateConfig(port, 'app_1', form({ amazon_tag: 'mysite-20' }));
    expect(result).toEqual({
      ok: false,
      issues: [{ field: 'form', message: 'amazon.tag: Too small' }],
    });
  });

  it('says something useful when the gateway refuses without a reason', async () => {
    const port = writer({ ok: false, issues: [] });
    const result = await saveAffiliateConfig(port, 'app_1', form({ amazon_tag: 'mysite-20' }));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues[0]?.message).toContain('Nothing was changed');
  });

  it('does not swallow a writer that throws: the action decides what to say', async () => {
    const port: AffiliateWriter = { save: vi.fn().mockRejectedValue(new Error('down')) };
    await expect(
      saveAffiliateConfig(port, 'app_1', form({ amazon_tag: 'mysite-20' })),
    ).rejects.toThrow('down');
  });
});
