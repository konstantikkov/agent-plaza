import type { PlazaNet } from '@/entities/session/index';

/** Everyone walks in under a friendly random name; agents rename via tools. */

const FIRST = ['Amber', 'Coral', 'Indigo', 'Maple', 'Pearl', 'Sage', 'Slate', 'Willow', 'Juniper', 'Rowan'];
const LAST = ['Fox', 'Crane', 'Otter', 'Lynx', 'Finch', 'Moth', 'Ibis', 'Marten', 'Swift', 'Vole'];

export function randomName(): string {
  const pick = (list: string[]): string => list[Math.floor(Math.random() * list.length)]!;
  return `${pick(FIRST)} ${pick(LAST)} ${Math.floor(Math.random() * 90) + 10}`;
}

export function autoJoin(net: PlazaNet, attempt = 0): void {
  void net.join(randomName(), 'human').then((r) => {
    if (!r.ok && r.code === 'name-taken' && attempt < 3) autoJoin(net, attempt + 1);
  });
}
