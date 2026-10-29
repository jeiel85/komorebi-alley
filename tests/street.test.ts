import { describe, expect, it } from 'vitest';
import { aromaFalloff, aromaTiles } from '../src/sim/aroma.ts';
import {
  activeSynergies,
  checkPlacement,
  checkUnlock,
  doorX,
  initialUnlocked,
  positiveSynergyKinds,
  previewSynergies,
  synergyEffects,
  unlockCost,
  type Building,
} from '../src/sim/street.ts';

const b = (uid: number, type: Building['type'], x: number): Building => ({ uid, type, x, tuning: 5, price: 0, rating: 0.5 });

describe('배치', () => {
  const unlocked = initialUnlocked();

  it('처음엔 3~12번 타일만 열려 있다', () => {
    expect(unlocked.filter(Boolean)).toHaveLength(10);
    expect(unlocked[2]).toBe(false);
    expect(unlocked[3]).toBe(true);
    expect(unlocked[12]).toBe(true);
    expect(unlocked[13]).toBe(false);
  });

  it('열린 빈 땅에만 지을 수 있다', () => {
    expect(checkPlacement([], unlocked, 'ramen', 3).ok).toBe(true);
    expect(checkPlacement([], unlocked, 'ramen', 2).ok).toBe(false);
    expect(checkPlacement([], unlocked, 'ramen', 12).ok).toBe(false); // 2칸짜리가 13번(잠김)에 걸친다
    expect(checkPlacement([], unlocked, 'vending', 12).ok).toBe(true);
  });

  it('겹쳐 지을 수 없다', () => {
    const existing = [b(1, 'ramen', 5)];
    expect(checkPlacement(existing, unlocked, 'vending', 6).ok).toBe(false);
    expect(checkPlacement(existing, unlocked, 'bakery', 4).ok).toBe(false);
    expect(checkPlacement(existing, unlocked, 'bakery', 7).ok).toBe(true);
  });

  it('확장은 열린 땅과 맞닿은 공터만, 비용은 점점 오른다', () => {
    expect(checkUnlock(unlocked, 2).ok).toBe(true);
    expect(checkUnlock(unlocked, 1).ok).toBe(false);
    expect(checkUnlock(unlocked, 5).ok).toBe(false);
    expect(unlockCost(0)).toBe(6000);
    expect(unlockCost(1)).toBeGreaterThan(unlockCost(0));
  });

  it('2칸 건물의 입구는 두 타일 경계에 있다', () => {
    expect(doorX(b(1, 'ramen', 3))).toBe(4 * 24);
    expect(doorX(b(1, 'vending', 3))).toBe(3.5 * 24);
  });
});

describe('향기', () => {
  it('베이커리 향기는 3칸까지 퍼지고 멀수록 옅어진다', () => {
    const bakery = b(1, 'bakery', 6); // 6~7번 타일
    expect(aromaFalloff(bakery, 6)).toBe(1);
    expect(aromaFalloff(bakery, 8)).toBeCloseTo(0.75);
    expect(aromaFalloff(bakery, 10)).toBeCloseTo(0.25);
    expect(aromaFalloff(bakery, 11)).toBe(0);
    expect(aromaFalloff(bakery, 3)).toBeCloseTo(0.25);
    expect(aromaTiles('bakery', 6).map((t) => t.tile)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('향기 없는 가게와 소품은 0', () => {
    expect(aromaFalloff(b(1, 'teahouse', 6), 6)).toBe(0);
    expect(aromaFalloff(b(1, 'bench', 6), 6)).toBe(0);
  });
});

describe('시너지', () => {
  it('헌책방과 찻집이 붙어 있으면 둘 다 체류 2배·객단가 +25%', () => {
    const book = b(1, 'bookstore', 3);
    const tea = b(2, 'teahouse', 5);
    const list = [book, tea];
    expect(activeSynergies(list).map((s) => s.def.id)).toEqual(['bookTea']);
    for (const target of list) {
      const fx = synergyEffects(list, target);
      expect(fx.dwell).toBe(2);
      expect(fx.spend).toBeCloseTo(1.25);
    }
  });

  it('한 칸이라도 떨어지면 시너지가 없다', () => {
    expect(activeSynergies([b(1, 'bookstore', 3), b(2, 'teahouse', 6)])).toHaveLength(0);
  });

  it('라멘 옆 찻집은 찻집만 손해를 본다', () => {
    const ramen = b(1, 'ramen', 3);
    const tea = b(2, 'teahouse', 5);
    expect(synergyEffects([ramen, tea], tea).satisfaction).toBeCloseTo(-0.12);
    expect(synergyEffects([ramen, tea], ramen).satisfaction).toBe(0);
  });

  it('미리보기는 새로 생길 시너지만 보여 준다', () => {
    const existing = [b(1, 'bookstore', 3), b(2, 'teahouse', 5)];
    expect(previewSynergies(existing, 'bakery', 7).map((s) => s.def.id)).toEqual(['breadTea']);
  });

  it('좋은 시너지 종류만 센다', () => {
    const list = [b(1, 'bookstore', 3), b(2, 'teahouse', 5), b(3, 'bakery', 7), b(4, 'bench', 9), b(5, 'taiyaki', 10)];
    expect(positiveSynergyKinds(list)).toBe(3);
    expect(positiveSynergyKinds([b(1, 'ramen', 3), b(2, 'teahouse', 5)])).toBe(0);
  });
});
