import { useEffect, useRef, useState } from 'react';
import type { PlazaNet } from '@/entities/session/index';
import type { PlazaWorld } from '@/entities/world/index';

/**
 * Invisible chat: start typing anywhere and an input appears pinned above
 * your avatar; Enter speaks (a bubble), Escape cancels. Mobile gets a 💬.
 */
export function TalkInput({ world, net }: { world: PlazaWorld; net: PlazaNet }): JSX.Element {
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [hintGone, setHintGone] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Enter' || e.key.length === 1) {
        setOpen(true);
        setHintGone(true);
        if (e.key.length === 1) setDraft((d) => d + e.key);
        e.preventDefault();
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // pin the box above the hero, every frame while open
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const place = (): void => {
      raf = requestAnimationFrame(place);
      const el = boxRef.current;
      const hero = world.getHeroGroup();
      if (!el || !hero) return;
      const p = world.projectToScreen(hero.position.x, hero.position.y + 2.0, hero.position.z);
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
      el.style.visibility = p.behind ? 'hidden' : 'visible';
    };
    place();
    inputRef.current?.focus();
    return () => cancelAnimationFrame(raf);
  }, [open, world]);

  const send = (): void => {
    const phrase = draft.trim();
    setDraft('');
    setOpen(false);
    if (phrase) net.say(phrase);
  };

  return (
    <>
      {open && (
        <div className="plaza-talk" ref={boxRef}>
          <input
            ref={inputRef}
            className="plaza-talk-input"
            value={draft}
            maxLength={280}
            placeholder="say it…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send();
              if (e.key === 'Escape') {
                setDraft('');
                setOpen(false);
              }
            }}
            onBlur={() => {
              if (!draft.trim()) setOpen(false);
            }}
          />
        </div>
      )}
      {!hintGone && <div className="plaza-hint">start typing to talk</div>}
      <button
        className="plaza-talk-btn"
        title="Talk"
        onClick={() => {
          setOpen(true);
          setHintGone(true);
        }}
      >
        💬
      </button>
    </>
  );
}
