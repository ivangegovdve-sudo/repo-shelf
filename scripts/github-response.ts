/**
 * A comparison can be unavailable because a fork outlives an inaccessible parent,
 * but GitHub's 403 response also signals account-wide throttling. Only the former
 * is safe to reduce to an unverified single-fork result.
 */
export function isUnavailableComparisonResponse(
  status: number,
  headers: Pick<Headers, 'get'>,
  body: string,
): boolean {
  if (status === 401) {
    // A good token can still receive this for an upstream that is no longer
    // publicly comparable. A bad or expired token must stop the whole refresh.
    return /requires authentication|resource not accessible/.test(body.toLowerCase());
  }
  if ([404, 409, 422].includes(status)) return true;
  if (status !== 403) return false;

  const message = body.toLowerCase();
  const throttled = headers.get('x-ratelimit-remaining') === '0'
    || headers.get('retry-after') !== null
    || /rate limit|secondary rate limit|abuse detection/.test(message);
  return !throttled;
}
