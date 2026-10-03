/** Hashed user id of authenticated routes: pseudonymous, and needed for support. */
const HASHED_ID = /^[0-9a-f]{32}$/;

/** Long opaque segment: the encoded preferences blob of a stateless install URL. */
const ENCODED_SEGMENT = /^[A-Za-z0-9_-]{32,}$/;

/**
 * Replace the encoded preferences segment of a request path with a placeholder.
 *
 * That segment decodes to the member handle and the chosen list ids, so it is personal
 * data and must not be logged. The rest of the path is kept: catalog id, pagination and
 * hashed user id are what make a request line diagnosable.
 */
export function sanitizeUrlForLog(url: string): string {
  const queryStart = url.indexOf('?');
  const path = queryStart === -1 ? url : url.slice(0, queryStart);
  const query = queryStart === -1 ? '' : url.slice(queryStart);

  const sanitized = path
    .split('/')
    .map((segment) =>
      !HASHED_ID.test(segment) && ENCODED_SEGMENT.test(segment) ? '[encoded]' : segment,
    )
    .join('/');

  return `${sanitized}${query}`;
}
