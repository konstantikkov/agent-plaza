import { createRng, hashString, Emitter } from '@/shared/lib/shared';

describe('createRng', () => {
  it('is deterministic for the same seed', () => {
    const a = createRng(hashString('plaza'));
    const b = createRng(hashString('plaza'));
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = createRng(hashString('plaza'));
    const b = createRng(hashString('agora'));
    expect([a(), a(), a()]).not.toEqual([b(), b(), b()]);
  });

  it('stays within [0, 1)', () => {
    const rng = createRng(hashString('bounds'));
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('hashString', () => {
  it('is stable and seed-sensitive', () => {
    expect(hashString('orchard-vale')).toBe(hashString('orchard-vale'));
    expect(hashString('orchard-vale')).not.toBe(hashString('orchard-vale2'));
  });
});

describe('Emitter', () => {
  it('delivers events to subscribers and honours unsubscribe', () => {
    const em = new Emitter<{ ping: number }>();
    const seen: number[] = [];
    const off = em.on('ping', (n) => seen.push(n));
    em.emit('ping', 1);
    em.emit('ping', 2);
    off();
    em.emit('ping', 3);
    expect(seen).toEqual([1, 2]);
  });

  it('clear() removes all listeners', () => {
    const em = new Emitter<{ ping: number }>();
    const seen: number[] = [];
    em.on('ping', (n) => seen.push(n));
    em.clear();
    em.emit('ping', 1);
    expect(seen).toEqual([]);
  });
});
