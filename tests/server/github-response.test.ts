import { describe, expect, it } from 'vitest';
import { isUnavailableComparisonResponse } from '../../scripts/github-response';

function headers(values: Record<string, string> = {}): Pick<Headers, 'get'> {
  const normalized = new Map(Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]));
  return { get: (key: string) => normalized.get(key.toLowerCase()) ?? null };
}

describe('comparison availability classification', () => {
  it('allows a single inaccessible parent to become unverified without masking missing-source statuses', () => {
    for (const status of [404, 409, 422]) {
      expect(isUnavailableComparisonResponse(status, headers(), '')).toBe(true);
    }
    expect(isUnavailableComparisonResponse(401, headers(), 'Requires authentication')).toBe(true);
    expect(isUnavailableComparisonResponse(403, headers(), 'Resource not accessible by integration')).toBe(true);
  });

  it('keeps account-wide throttling fatal so the refresh is never partially reclassified', () => {
    expect(isUnavailableComparisonResponse(403, headers({ 'x-ratelimit-remaining': '0' }), '')).toBe(false);
    expect(isUnavailableComparisonResponse(403, headers({ 'retry-after': '60' }), '')).toBe(false);
    expect(isUnavailableComparisonResponse(403, headers(), 'You have exceeded a secondary rate limit.')).toBe(false);
    expect(isUnavailableComparisonResponse(401, headers(), 'Bad credentials')).toBe(false);
    expect(isUnavailableComparisonResponse(500, headers(), '')).toBe(false);
  });
});
