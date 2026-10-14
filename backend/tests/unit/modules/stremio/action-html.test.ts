import { describe, it, expect } from 'vitest';
import { buildActionSuccessPage } from '../../../../src/modules/stremio/action/action-html.js';

const base = { message: 'Marked as watched', statusLine: 'Watched', stremioDeepLink: 'stremio:///detail/movie/tt1' };

describe('buildActionSuccessPage', () => {
  it('redirects after 1 second with no upsell by default', () => {
    const html = buildActionSuccessPage(base);
    expect(html).toContain('content="1;url=stremio:///detail/movie/tt1"');
    expect(html).not.toContain('Learn more');
  });

  it('renders the upsell line with a safe external link and a custom delay', () => {
    const html = buildActionSuccessPage({
      ...base,
      upsell: { text: 'Auto-log to Diary adds every film.', href: 'https://stremboxd.com/pricing' },
      redirectDelaySeconds: 3,
    });
    expect(html).toContain('content="3;url=');
    expect(html).toContain('Auto-log to Diary adds every film.');
    expect(html).toContain('href="https://stremboxd.com/pricing"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('Learn more');
  });

  it('escapes the upsell text and href', () => {
    const html = buildActionSuccessPage({
      ...base,
      upsell: { text: '<script>x</script>', href: 'https://a.test/?q="><img src=x>' },
    });
    expect(html).not.toContain('<script>x</script>');
    expect(html).not.toContain('"><img');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).toContain('&quot;&gt;&lt;img');
  });
});
