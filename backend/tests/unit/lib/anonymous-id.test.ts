import { describe, it, expect } from 'vitest';
import { generateAnonId } from '../../../src/lib/anonymous-id.js';
import type { FastifyRequest } from 'fastify';

function mockRequest(ip: string, userAgent?: string): FastifyRequest {
  return {
    ip,
    headers: { 'user-agent': userAgent },
  } as unknown as FastifyRequest;
}

describe('anonymous-id', () => {
  it('is deterministic for same input on same day', () => {
    const req = mockRequest('192.168.1.1', 'TestAgent/1.0');

    const a = generateAnonId(req);
    const b = generateAnonId(req);

    expect(a).toBe(b);
  });

  it('produces different IDs for different IPs', () => {
    const a = generateAnonId(mockRequest('10.0.0.1', 'TestAgent'));
    const b = generateAnonId(mockRequest('10.0.0.2', 'TestAgent'));

    expect(a).not.toBe(b);
  });

  it('produces different IDs for different user agents', () => {
    const a = generateAnonId(mockRequest('10.0.0.1', 'AgentA'));
    const b = generateAnonId(mockRequest('10.0.0.1', 'AgentB'));

    expect(a).not.toBe(b);
  });

  it('returns a 16-character hex string', () => {
    const id = generateAnonId(mockRequest('1.2.3.4', 'UA'));

    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('does not expose the original IP or user agent', () => {
    const ip = '192.168.1.100';
    const ua = 'MySpecialAgent/5.0';
    const id = generateAnonId(mockRequest(ip, ua));

    expect(id).not.toContain('192');
    expect(id).not.toContain('MySpecial');
  });

  it('handles missing user agent gracefully', () => {
    const id = generateAnonId(mockRequest('10.0.0.1'));

    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });
});
