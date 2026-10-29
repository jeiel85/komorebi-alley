import {
  CAT_ARRIVAL_BASE,
  CAT_ARRIVAL_PER_TOWER,
  CAT_BREEDS,
  CAT_NAMES,
  CAT_PERSONALITIES,
  LEGENDARY_CAT,
  LEGENDARY_MIN_CATS,
  LEGENDARY_MIN_HAPPINESS,
  STREET_PX,
  type CatBreed,
  type CatPersonality,
} from './data.ts';
import type { Rng } from './rng.ts';
import { doorX, type Building } from './street.ts';

/** 저장되는 고양이 정보 */
export interface Cat {
  id: number;
  name: string;
  breed: CatBreed;
  personality: CatPersonality;
  legendary: boolean;
  affection: number;
  arrivedDay: number;
}

export type CatState = 'walk' | 'sit' | 'groom' | 'sleep' | 'petted';

/** 화면 위 고양이의 순간 상태(저장하지 않음) */
export interface CatRuntime {
  id: number;
  x: number;
  targetX: number;
  state: CatState;
  timer: number;
  dir: 1 | -1;
}

function countType(buildings: readonly Building[], type: Building['type']): number {
  return buildings.filter((b) => b.type === type).length;
}

/** 일반 고양이 정원. 전설의 고양이는 따로 센다. */
export function catCapacity(buildings: readonly Building[]): number {
  return countType(buildings, 'feeder') * 2 + countType(buildings, 'catTower');
}

export function catHomeX(buildings: readonly Building[], cat: Cat): number {
  const homes = buildings.filter((b) => b.type === 'feeder' || b.type === 'catTower');
  if (homes.length === 0) return STREET_PX / 2;
  return doorX(homes[cat.id % homes.length]);
}

export function rollCatArrival(rng: Rng, buildings: readonly Building[], cats: readonly Cat[], id: number, day: number): Cat | null {
  const normal = cats.filter((c) => !c.legendary).length;
  if (normal >= catCapacity(buildings)) return null;
  const p = Math.min(0.8, CAT_ARRIVAL_BASE + CAT_ARRIVAL_PER_TOWER * countType(buildings, 'catTower'));
  if (!rng.chance(p)) return null;
  const used = new Set(cats.map((c) => c.name));
  const free = CAT_NAMES.filter((n) => !used.has(n));
  return {
    id,
    name: free.length > 0 ? rng.pick(free) : `나비 ${id}`,
    breed: rng.pick(CAT_BREEDS),
    personality: rng.pick(CAT_PERSONALITIES),
    legendary: false,
    affection: 0,
    arrivedDay: day,
  };
}

export function legendaryEligible(buildings: readonly Building[], cats: readonly Cat[], lastHappiness: number): boolean {
  return (
    !cats.some((c) => c.legendary) &&
    countType(buildings, 'catTower') >= 1 &&
    cats.filter((c) => !c.legendary).length >= LEGENDARY_MIN_CATS &&
    lastHappiness >= LEGENDARY_MIN_HAPPINESS
  );
}

export function makeLegendary(id: number, day: number): Cat {
  return { id, name: LEGENDARY_CAT.name, breed: LEGENDARY_CAT.breed, personality: 'friendly', legendary: true, affection: 0, arrivedDay: day };
}

/** 급식소·캣타워가 줄어 정원을 넘은 고양이(늦게 온 순)와, 캣타워가 없어진 전설의 고양이를 돌려준다 */
export function catsToLeave(buildings: readonly Building[], cats: readonly Cat[]): Cat[] {
  const leaving: Cat[] = [];
  const normal = cats.filter((c) => !c.legendary).sort((a, b) => a.arrivedDay - b.arrivedDay || a.id - b.id);
  const cap = catCapacity(buildings);
  leaving.push(...normal.slice(cap));
  if (countType(buildings, 'catTower') === 0) leaving.push(...cats.filter((c) => c.legendary));
  return leaving;
}
