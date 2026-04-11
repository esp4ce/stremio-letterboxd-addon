import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted so these are available inside the hoisted vi.mock factory
const { mockPoster, mockCinemeta, mockPublicList } = vi.hoisted(() => {
  const makeMockCache = (initialSize: number, max: number) => {
    const entries = new Map<string, string>();
    const reset = () => {
      entries.clear();
      for (let i = 0; i < initialSize; i++) entries.set(`key-${i}`, `val-${i}`);
    };
    reset();
    return {
      get size() { return entries.size; },
      max,
      keys: () => entries.keys(),
      delete: (k: string) => entries.delete(k),
      clear: () => entries.clear(),
      reset,
    };
  };

  return {
    mockPoster: makeMockCache(20, 20),
    mockCinemeta: makeMockCache(50, 50),
    mockPublicList: makeMockCache(80, 100),
  };
});

vi.mock('../../src/lib/cache.js', () => ({
  heavyCaches: [
    { name: 'poster', cache: mockPoster },
    { name: 'cinemetaRaw', cache: mockCinemeta },
    { name: 'publicList', cache: mockPublicList },
  ],
}));

// Mock logger
vi.mock('../../src/lib/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { checkMemoryPressure } from '../../src/lib/memory-guard.js';

describe('checkMemoryPressure', () => {
  let memoryMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockPoster.reset();
    mockCinemeta.reset();
    mockPublicList.reset();
    memoryMock = vi.spyOn(process, 'memoryUsage');
  });

  afterEach(() => {
    memoryMock.mockRestore();
  });

  const heapAt = (mb: number) => {
    memoryMock.mockReturnValue({
      heapUsed: mb * 1024 * 1024,
      heapTotal: 512 * 1024 * 1024,
      rss: 600 * 1024 * 1024,
      external: 0,
      arrayBuffers: 0,
    } as ReturnType<typeof process.memoryUsage>);
  };

  it('returns null when heap is under 60%', () => {
    heapAt(200);
    expect(checkMemoryPressure()).toBeNull();
  });

  it('returns ELEVATED and purges 25% of top 3 when heap is 60-75%', () => {
    heapAt(350);
    const result = checkMemoryPressure();
    expect(result).not.toBeNull();
    expect(result!.tier).toBe('ELEVATED');
    expect(result!.purged).toBeGreaterThan(0);
  });

  it('returns HIGH and purges 50% of heavy caches when heap is 75-85%', () => {
    heapAt(410);
    const result = checkMemoryPressure();
    expect(result).not.toBeNull();
    expect(result!.tier).toBe('HIGH');
    expect(result!.purged).toBeGreaterThan(0);
  });

  it('returns CRITICAL and clears all heavy caches when heap > 85%', () => {
    heapAt(450);
    const result = checkMemoryPressure();
    expect(result).not.toBeNull();
    expect(result!.tier).toBe('CRITICAL');
    expect(result!.purged).toBe(150); // 20 + 50 + 80
  });
});
