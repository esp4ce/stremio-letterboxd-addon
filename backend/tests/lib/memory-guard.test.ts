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

import { checkMemoryPressure, getHeapLimitMB, getTier } from '../../src/lib/memory-guard.js';

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

  // Heap usage as a share of the real V8 limit, whatever NODE_OPTIONS sets it to.
  const heapAt = (pct: number) => {
    const limitMB = getHeapLimitMB();
    memoryMock.mockReturnValue({
      heapUsed: (pct / 100) * limitMB * 1024 * 1024,
      heapTotal: limitMB * 1024 * 1024,
      rss: 600 * 1024 * 1024,
      external: 0,
      arrayBuffers: 0,
    } as ReturnType<typeof process.memoryUsage>);
  };

  it('returns null when heap is under 60%', () => {
    heapAt(40);
    expect(checkMemoryPressure()).toBeNull();
  });

  it('returns ELEVATED and purges 25% of top 3 when heap is 60-75%', () => {
    heapAt(68);
    const result = checkMemoryPressure();
    expect(result).not.toBeNull();
    expect(result!.tier).toBe('ELEVATED');
    expect(result!.purged).toBeGreaterThan(0);
  });

  it('returns HIGH and purges 50% of heavy caches when heap is 75-85%', () => {
    heapAt(80);
    const result = checkMemoryPressure();
    expect(result).not.toBeNull();
    expect(result!.tier).toBe('HIGH');
    expect(result!.purged).toBeGreaterThan(0);
  });

  it('returns CRITICAL and clears all heavy caches when heap > 85%', () => {
    heapAt(88);
    const result = checkMemoryPressure();
    expect(result).not.toBeNull();
    expect(result!.tier).toBe('CRITICAL');
    expect(result!.purged).toBe(150); // 20 + 50 + 80
  });

  it('reads the heap limit from V8 instead of assuming 512 MB', async () => {
    const v8 = await import('node:v8');
    expect(getHeapLimitMB()).toBeCloseTo(v8.getHeapStatistics().heap_size_limit / 1024 / 1024, 5);
  });

  it('grades pressure against the limit it is given', () => {
    expect(getTier(600, 2048)).toBe('NORMAL');
    expect(getTier(1300, 2048)).toBe('ELEVATED');
    expect(getTier(1600, 2048)).toBe('HIGH');
    expect(getTier(1800, 2048)).toBe('CRITICAL');
    expect(getTier(450, 512)).toBe('CRITICAL');
  });
});
