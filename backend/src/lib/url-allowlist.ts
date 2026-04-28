// Hostname allowlist for outbound HTTP requests to prevent SSRF.
// Allowed: letterboxd.com (and subdomains), ltrbxd.com (and subdomains), boxd.it.

const EXACT_HOSTS = new Set<string>([
  'letterboxd.com',
  'boxd.it',
  'a.ltrbxd.com',
  's.ltrbxd.com',
]);

const SUFFIX_HOSTS = ['.letterboxd.com', '.ltrbxd.com'];

const CINEMETA_HOSTS = new Set<string>([
  'v3-cinemeta.strem.io',
]);

export interface AssertOptions {
  allowHttp?: boolean;
  extraHosts?: ReadonlySet<string>;
}

export function isAllowedHostname(hostname: string, extraHosts?: ReadonlySet<string>): boolean {
  if (EXACT_HOSTS.has(hostname)) return true;
  if (extraHosts?.has(hostname)) return true;
  return SUFFIX_HOSTS.some((s) => hostname.endsWith(s));
}

export function assertAllowedUrl(url: string, options: AssertOptions = {}): URL {
  const parsed = new URL(url);
  const allowHttp = options.allowHttp ?? false;
  if (parsed.protocol !== 'https:' && !(allowHttp && parsed.protocol === 'http:')) {
    throw new Error('URL not allowed: ' + parsed.protocol);
  }
  if (!isAllowedHostname(parsed.hostname, options.extraHosts)) {
    throw new Error('URL not allowed: ' + parsed.hostname);
  }
  return parsed;
}

export const CINEMETA_ALLOWED_HOSTS: ReadonlySet<string> = CINEMETA_HOSTS;
