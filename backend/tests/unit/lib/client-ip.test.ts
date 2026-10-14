import { describe, it, expect } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { clientIp } from '../../../src/lib/client-ip.js';

function req(headers: Record<string, unknown>, ip = '100.64.0.1'): FastifyRequest {
  return { ip, headers } as unknown as FastifyRequest;
}

describe('clientIp', () => {
  it('uses a valid IPv4 x-real-ip', () => {
    expect(clientIp(req({ 'x-real-ip': '203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('uses a valid IPv6 x-real-ip', () => {
    expect(clientIp(req({ 'x-real-ip': '2001:db8::1' }))).toBe('2001:db8::1');
  });

  it('trims surrounding whitespace', () => {
    expect(clientIp(req({ 'x-real-ip': ' 203.0.113.7 ' }))).toBe('203.0.113.7');
  });

  it('falls back to request.ip without the header', () => {
    expect(clientIp(req({}))).toBe('100.64.0.1');
  });

  it.each(['not-an-ip', '1.2.3.4, 5.6.7.8', '', '   '])('falls back to request.ip for %j', (value) => {
    expect(clientIp(req({ 'x-real-ip': value }))).toBe('100.64.0.1');
  });

  it('falls back to request.ip for an array header', () => {
    expect(clientIp(req({ 'x-real-ip': ['1.2.3.4', '5.6.7.8'] }))).toBe('100.64.0.1');
  });

  it('ignores x-forwarded-for', () => {
    expect(clientIp(req({ 'x-forwarded-for': '203.0.113.7' }))).toBe('100.64.0.1');
  });
});
