import { describe, it, expect } from 'vitest';
import { extractBoxdShortlinkId, extractListIdFromListPage } from '../../../src/lib/html-scraper.js';

describe('extractBoxdShortlinkId', () => {
  it('extracts ID from https shortlink', () => {
    const html = '<html><a href="https://boxd.it/abc123">link</a></html>';
    expect(extractBoxdShortlinkId(html)).toBe('abc123');
  });

  it('extracts ID from http shortlink', () => {
    const html = '<html><a href="http://boxd.it/XyZ9"></a></html>';
    expect(extractBoxdShortlinkId(html)).toBe('XyZ9');
  });

  it('returns null when no shortlink present', () => {
    const html = '<html><body>no links here</body></html>';
    expect(extractBoxdShortlinkId(html)).toBeNull();
  });

  it('returns first match when multiple shortlinks exist', () => {
    const html = 'https://boxd.it/first and https://boxd.it/second';
    expect(extractBoxdShortlinkId(html)).toBe('first');
  });
});

describe('extractListIdFromListPage', () => {
  it('extracts from rel="shortlink" link tag (standard order)', () => {
    const html = '<link rel="shortlink" href="https://boxd.it/listABC">';
    expect(extractListIdFromListPage(html)).toBe('listABC');
  });

  it('extracts from rel="shortlink" link tag (reversed attribute order)', () => {
    const html = '<link href="https://boxd.it/rev42" rel="shortlink">';
    expect(extractListIdFromListPage(html)).toBe('rev42');
  });

  it('extracts from data-likeable-identifier JSON', () => {
    const encoded = '{"type":"list","lid":"myListId"}'
      .replace(/"/g, '&#034;');
    const html = `<span data-likeable-identifier='${encoded}'></span>`;
    expect(extractListIdFromListPage(html)).toBe('myListId');
  });

  it('extracts from data-likeable-identifier with &quot; encoding', () => {
    const encoded = '{"type":"list","lid":"quotId"}'
      .replace(/"/g, '&quot;');
    const html = `<span data-likeable-identifier='${encoded}'></span>`;
    expect(extractListIdFromListPage(html)).toBe('quotId');
  });

  it('ignores data-likeable-identifier with wrong type', () => {
    const encoded = '{"type":"film","lid":"nope"}'.replace(/"/g, '&#034;');
    const html = `<span data-likeable-identifier='${encoded}'></span>`;
    expect(extractListIdFromListPage(html)).toBeNull();
  });

  it('returns null for empty HTML', () => {
    expect(extractListIdFromListPage('')).toBeNull();
  });

  it('returns null for invalid JSON in data-likeable-identifier', () => {
    const html = `<span data-likeable-identifier='not-json'></span>`;
    expect(extractListIdFromListPage(html)).toBeNull();
  });

  it('prefers shortlink tag over data-likeable-identifier', () => {
    const encoded = '{"type":"list","lid":"fromLikeable"}'.replace(/"/g, '&#034;');
    const html = `
      <link rel="shortlink" href="https://boxd.it/fromTag">
      <span data-likeable-identifier='${encoded}'></span>
    `;
    expect(extractListIdFromListPage(html)).toBe('fromTag');
  });
});
