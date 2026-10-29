import { BUILDINGS, STREET_TILES, type BuildingType } from './data.ts';
import { spanOf, type Building } from './street.ts';

/**
 * 타일 하나에 닿는 향기 세기(0~strength).
 * 가게 자신의 타일은 최대 세기이고, 바깥으로 한 칸 멀어질 때마다 선형으로 줄어 radius+1칸에서 0이 된다.
 */
export function aromaFalloff(b: Pick<Building, 'type' | 'x'>, tile: number): number {
  const def = BUILDINGS[b.type];
  if (def.kind !== 'shop' || !def.aroma) return 0;
  const [l, r] = spanOf(b);
  const d = tile < l ? l - tile : tile > r ? tile - r : 0;
  if (d > def.aroma.radius) return 0;
  return def.aroma.strength * (1 - d / (def.aroma.radius + 1));
}

export function aromaAt(buildings: readonly Building[], tile: number): { b: Building; f: number }[] {
  const out: { b: Building; f: number }[] = [];
  for (const b of buildings) {
    const f = aromaFalloff(b, tile);
    if (f > 0) out.push({ b, f });
  }
  return out;
}

/** 배치 미리보기용 향기 범위 */
export function aromaTiles(type: BuildingType, x: number): { tile: number; f: number }[] {
  const out: { tile: number; f: number }[] = [];
  for (let tile = 0; tile < STREET_TILES; tile++) {
    const f = aromaFalloff({ type, x }, tile);
    if (f > 0) out.push({ tile, f });
  }
  return out;
}
