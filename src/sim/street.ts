import {
  BUILDINGS,
  INITIAL_UNLOCKED,
  STREET_TILES,
  SYNERGIES,
  TILE_PX,
  UNLOCK_BASE_COST,
  UNLOCK_COST_GROWTH,
  isShopType,
  type BuildingType,
  type SynergyDef,
} from './data.ts';

/** 골목에 놓인 건물. 가게가 아닌 소품은 tuning·price·rating을 쓰지 않는다. */
export interface Building {
  uid: number;
  type: BuildingType;
  /** 왼쪽 끝 타일 */
  x: number;
  tuning: number;
  price: number;
  /** 평판 0~1 */
  rating: number;
}

export type Check = { ok: true } | { ok: false; reason: string };

export function widthOf(type: BuildingType): number {
  return BUILDINGS[type].width;
}

/** 점유 타일 [왼쪽, 오른쪽] (양끝 포함) */
export function spanOf(b: Pick<Building, 'type' | 'x'>): [number, number] {
  return [b.x, b.x + widthOf(b.type) - 1];
}

/** 입구 중앙의 월드 x 좌표(px) */
export function doorX(b: Pick<Building, 'type' | 'x'>): number {
  return (b.x + widthOf(b.type) / 2) * TILE_PX;
}

export function isShop(b: Building): boolean {
  return isShopType(b.type);
}

export function buildingAtTile(buildings: readonly Building[], tile: number): Building | undefined {
  return buildings.find((b) => {
    const [l, r] = spanOf(b);
    return tile >= l && tile <= r;
  });
}

export function initialUnlocked(): boolean[] {
  return Array.from({ length: STREET_TILES }, (_, i) => i >= INITIAL_UNLOCKED.from && i <= INITIAL_UNLOCKED.to);
}

export function checkPlacement(buildings: readonly Building[], unlocked: readonly boolean[], type: BuildingType, x: number): Check {
  const w = widthOf(type);
  if (!Number.isInteger(x) || x < 0 || x + w > STREET_TILES) return { ok: false, reason: '골목 밖이에요' };
  for (let t = x; t < x + w; t++) {
    if (!unlocked[t]) return { ok: false, reason: '아직 확장하지 않은 공터예요' };
    if (buildingAtTile(buildings, t)) return { ok: false, reason: '이미 다른 건물이 있어요' };
  }
  return { ok: true };
}

export function unlockCost(extraUnlocked: number): number {
  return Math.round((UNLOCK_BASE_COST * UNLOCK_COST_GROWTH ** extraUnlocked) / 100) * 100;
}

export function extraUnlockedCount(unlocked: readonly boolean[]): number {
  const initial = INITIAL_UNLOCKED.to - INITIAL_UNLOCKED.from + 1;
  return unlocked.filter(Boolean).length - initial;
}

export function checkUnlock(unlocked: readonly boolean[], x: number): Check {
  if (!Number.isInteger(x) || x < 0 || x >= STREET_TILES) return { ok: false, reason: '골목 밖이에요' };
  if (unlocked[x]) return { ok: false, reason: '이미 열린 땅이에요' };
  if (!unlocked[x - 1] && !unlocked[x + 1]) return { ok: false, reason: '열린 땅과 맞닿은 공터부터 확장할 수 있어요' };
  return { ok: true };
}

export function areAdjacent(a: Pick<Building, 'type' | 'x'>, b: Pick<Building, 'type' | 'x'>): boolean {
  const [al, ar] = spanOf(a);
  const [bl, br] = spanOf(b);
  return ar + 1 === bl || br + 1 === al;
}

export interface ActiveSynergy {
  def: SynergyDef;
  /** def.a 역할을 하는 건물 */
  a: Building;
  /** def.b 역할을 하는 건물 */
  b: Building;
}

export function activeSynergies(buildings: readonly Building[]): ActiveSynergy[] {
  const result: ActiveSynergy[] = [];
  for (let i = 0; i < buildings.length; i++) {
    for (let j = i + 1; j < buildings.length; j++) {
      const p = buildings[i];
      const q = buildings[j];
      if (!areAdjacent(p, q)) continue;
      for (const def of SYNERGIES) {
        if (p.type === def.a && q.type === def.b) result.push({ def, a: p, b: q });
        else if (q.type === def.a && p.type === def.b) result.push({ def, a: q, b: p });
      }
    }
  }
  return result;
}

export function synergyAffects(s: ActiveSynergy, b: Building): boolean {
  if (s.def.targets === 'both') return s.a.uid === b.uid || s.b.uid === b.uid;
  return (s.def.targets === 'a' ? s.a : s.b).uid === b.uid;
}

export interface SynergyEffect {
  visit: number;
  spend: number;
  dwell: number;
  satisfaction: number;
  active: SynergyDef[];
}

export function synergyEffects(buildings: readonly Building[], target: Building): SynergyEffect {
  const fx: SynergyEffect = { visit: 1, spend: 1, dwell: 1, satisfaction: 0, active: [] };
  for (const s of activeSynergies(buildings)) {
    if (!synergyAffects(s, target)) continue;
    fx.visit *= s.def.visit ?? 1;
    fx.spend *= s.def.spend ?? 1;
    fx.dwell *= s.def.dwell ?? 1;
    fx.satisfaction += s.def.satisfaction ?? 0;
    fx.active.push(s.def);
  }
  return fx;
}

/** 그 자리에 지으면 새로 생길 시너지(배치 미리보기용) */
export function previewSynergies(buildings: readonly Building[], type: BuildingType, x: number): ActiveSynergy[] {
  const ghost: Building = { uid: -1, type, x, tuning: 5, price: 0, rating: 0.5 };
  return activeSynergies([...buildings, ghost]).filter((s) => s.a.uid === -1 || s.b.uid === -1);
}

/** 서로 다른 '좋은' 시너지 종류 수 */
export function positiveSynergyKinds(buildings: readonly Building[]): number {
  return new Set(activeSynergies(buildings).filter((s) => !s.def.negative).map((s) => s.def.id)).size;
}
