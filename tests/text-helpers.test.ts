import { wrapText } from '@/entities/agent/labelSprite';
import { randomName } from '@/features/auto-join/index';

describe('wrapText (speech bubbles)', () => {
  it('keeps short lines intact', () => {
    expect(wrapText('hello there')).toEqual(['hello there']);
  });

  it('wraps at the width limit without splitting words', () => {
    const lines = wrapText('one two three four five six seven eight nine ten', 12);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(12);
  });

  it('caps at five lines', () => {
    const lines = wrapText(Array(60).fill('word').join(' '), 10);
    expect(lines.length).toBeLessThanOrEqual(5);
  });
});

describe('randomName (auto-join)', () => {
  it('produces "First Animal NN" names accepted by the server rules', () => {
    // mirror of NAME_RE in api/plaza.js
    const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} _\-]{0,23}$/u;
    for (let i = 0; i < 50; i++) {
      const name = randomName();
      expect(name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ \d{2}$/);
      expect(NAME_RE.test(name)).toBe(true);
      expect(name.length).toBeLessThanOrEqual(24);
    }
  });
});
