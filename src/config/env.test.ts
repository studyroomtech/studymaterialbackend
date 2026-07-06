// Tests for fail-fast environment configuration loading (task 16.1).
//
// Verifies that `loadEnv` reads and REQUIRES the Razorpay credentials in
// Phase 2 (Req 12.12, 12.13, 12.17) while continuing to require DATABASE_URL
// (Req 1.11), and that a missing/empty key aborts boot with a log entry
// naming the offending key.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ENV_KEYS } from './env.constant';
import { loadEnv } from './env';

/** A minimal, fully-valid environment source. */
function validSource(): NodeJS.ProcessEnv {
  return {
    [ENV_KEYS.DATABASE_URL]: 'postgresql://u:p@localhost:5432/db',
    [ENV_KEYS.RAZORPAY_KEY_ID]: 'rzp_test_abc',
    [ENV_KEYS.RAZORPAY_KEY_SECRET]: 'secret_abc',
    [ENV_KEYS.RAZORPAY_WEBHOOK_SECRET]: 'whsec_abc',
  } as NodeJS.ProcessEnv;
}

describe('loadEnv — Razorpay required (Req 12.12, 12.13, 12.17)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads Razorpay credentials when all are present', () => {
    const config = loadEnv(validSource());
    expect(config.razorpay).toEqual({
      keyId: 'rzp_test_abc',
      keySecret: 'secret_abc',
      webhookSecret: 'whsec_abc',
    });
  });

  it.each([
    ENV_KEYS.RAZORPAY_KEY_ID,
    ENV_KEYS.RAZORPAY_KEY_SECRET,
    ENV_KEYS.RAZORPAY_WEBHOOK_SECRET,
  ])('aborts boot and logs when %s is absent', (missingKey) => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const source = validSource();
    delete source[missingKey];

    expect(() => loadEnv(source)).toThrow(missingKey);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain(missingKey);
  });

  it.each([
    ENV_KEYS.RAZORPAY_KEY_ID,
    ENV_KEYS.RAZORPAY_KEY_SECRET,
    ENV_KEYS.RAZORPAY_WEBHOOK_SECRET,
  ])('aborts boot when %s is blank/whitespace-only', (blankKey) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const source = validSource();
    source[blankKey] = '   ';

    expect(() => loadEnv(source)).toThrow(blankKey);
  });

  it('still aborts boot when DATABASE_URL is missing (Req 1.11)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const source = validSource();
    delete source[ENV_KEYS.DATABASE_URL];

    expect(() => loadEnv(source)).toThrow(ENV_KEYS.DATABASE_URL);
  });
});
