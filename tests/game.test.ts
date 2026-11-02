import { describe, expect, it } from 'vitest';
import { CLOSE_TIME, OPEN_TIME, PREP_TIME, START_MONEY, BUILDINGS } from '../src/sim/data.ts';
import { Game, LANES, type SaveState } from '../src/sim/game.ts';
import { catsToLeave, legendaryEligible, rollCatArrival } from '../src/sim/cats.ts';
import { Rng } from '../src/sim/rng.ts';
import type { Building } from '../src/sim/street.ts';

function runDay(g: Game): void {
  expect(g.startBusiness().ok).toBe(true);
  for (let i = 0; i < 2000 && g.phase === 'business'; i++) g.tick(1);
  expect(g.phase).toBe('accounting');
}

function richGame(seed = 1): Game {
  const g = new Game(seed);
  g.s.money = 200_000;
  return g;
}

describe('하루 진행 FSM', () => {
  it('준비 → 영업 → 결산 → 다음 날 준비', () => {
    const g = new Game(1);
    expect(g.phase).toBe('prep');
    expect(g.time).toBe(PREP_TIME);
    expect(g.advanceDay().ok).toBe(false);
    g.startBusiness();
    expect(g.phase).toBe('business');
    expect(g.time).toBe(OPEN_TIME);
    expect(g.startBusiness().ok).toBe(false);
    for (let i = 0; i < 2000 && g.phase === 'business'; i++) g.tick(1);
    expect(g.phase).toBe('accounting');
    expect(g.time).toBeGreaterThanOrEqual(CLOSE_TIME);
    expect(g.report?.day).toBe(1);
    expect(g.advanceDay().ok).toBe(true);
    expect(g.phase).toBe('prep');
    expect(g.s.day).toBe(2);
  });

  it('준비 단계에서는 시간이 흐르지 않고 손님도 오지 않는다', () => {
    const g = new Game(2);
    g.place('ramen', 4);
    g.tick(120);
    expect(g.time).toBe(PREP_TIME);
    expect(g.peds).toHaveLength(0);
  });

  it('첫날은 맑음이고 내일 예보가 오늘이 된다', () => {
    const g = new Game(3);
    expect(g.s.today.weather).toBe('clear');
    const tomorrow = g.s.tomorrow;
    runDay(g);
    g.advanceDay();
    expect(g.s.today).toEqual(tomorrow);
  });

  it('5일째 아침에 여름으로 바뀌며 계절 변화 이벤트가 난다', () => {
    const g = new Game(4);
    for (let d = 1; d <= 4; d++) {
      runDay(g);
      g.drainEvents();
      g.advanceDay();
      const newDay = g.drainEvents().find((e) => e.kind === 'newDay');
      expect(newDay).toEqual({ kind: 'newDay', seasonChanged: d === 4 });
    }
    expect(g.season).toBe('summer');
  });
});

describe('경영', () => {
  it('가게를 지으면 돈이 줄고, 영업하면 매출이 생긴다', () => {
    const g = new Game(5);
    expect(g.place('ramen', 4).ok).toBe(true);
    expect(g.place('vending', 6).ok).toBe(true);
    expect(g.s.money).toBe(START_MONEY - BUILDINGS.ramen.cost - BUILDINGS.vending.cost);
    const before = g.s.money;
    runDay(g);
    expect(g.report!.customers).toBeGreaterThan(0);
    expect(g.report!.revenue).toBeGreaterThan(0);
    expect(g.s.money).toBe(before + g.report!.revenue);
    expect(g.s.goals).toContain('firstCustomer');
  });

  it('돈이 모자라면 지을 수 없다', () => {
    const g = new Game(6);
    g.s.money = 100;
    const res = g.place('bakery', 4);
    expect(res.ok).toBe(false);
    expect(g.s.buildings).toHaveLength(0);
  });

  it('철거하면 절반을 돌려받고 안에 있던 손님은 다시 걷는다', () => {
    const g = richGame(7);
    g.place('teahouse', 5);
    const uid = g.s.buildings[0].uid;
    g.startBusiness();
    for (let i = 0; i < 600 && !g.peds.some((p) => p.target === uid && p.state === 'inside'); i++) g.tick(1);
    const inside = g.peds.find((p) => p.target === uid && p.state === 'inside');
    expect(inside).toBeDefined();
    const money = g.s.money;
    expect(g.demolish(uid).ok).toBe(true);
    expect(g.s.money).toBe(money + BUILDINGS.teahouse.cost / 2);
    expect(inside!.state).toBe('walk');
    expect(inside!.target).toBeNull();
  });

  it('가게를 업그레이드하면 비용이 들고, 최고 레벨에서 멈춘다', () => {
    const g = richGame(31);
    g.place('ramen', 4);
    g.place('bench', 7);
    const shop = g.s.buildings.find((b) => b.type === 'ramen')!;
    const bench = g.s.buildings.find((b) => b.type === 'bench')!;
    const money = g.s.money;
    expect(g.upgrade(shop.uid).ok).toBe(true);
    expect(shop.level).toBe(2);
    expect(g.s.money).toBe(money - BUILDINGS.ramen.cost * 1.5);
    expect(g.upgrade(shop.uid).ok).toBe(true);
    expect(shop.level).toBe(3);
    expect(g.s.money).toBe(money - BUILDINGS.ramen.cost * 4.5);
    expect(g.upgrade(shop.uid)).toEqual({ ok: false, reason: '이미 최고 레벨이에요' });
    expect(g.upgrade(bench.uid).ok).toBe(false);
    expect(bench.level).toBe(1);
  });

  it('돈이 모자라면 업그레이드할 수 없다', () => {
    const g = new Game(32);
    g.place('ramen', 4);
    g.s.money = 100;
    expect(g.upgrade(g.s.buildings[0].uid)).toEqual({ ok: false, reason: '돈이 부족해요' });
    expect(g.s.buildings[0].level).toBe(1);
  });

  it('업그레이드한 가게를 철거하면 들인 돈 전체의 절반을 돌려받는다', () => {
    const g = richGame(33);
    g.place('bakery', 4);
    const uid = g.s.buildings[0].uid;
    g.upgrade(uid);
    const money = g.s.money;
    expect(g.demolish(uid).ok).toBe(true);
    expect(g.s.money).toBe(money + (BUILDINGS.bakery.cost * 2.5) / 2);
  });

  it('업그레이드한 가게가 같은 날 더 많이 번다', () => {
    const revenue = (level: number): number => {
      let sum = 0;
      for (let seed = 1; seed <= 8; seed++) {
        const g = richGame(seed);
        g.place('ramen', 7);
        const uid = g.s.buildings[0].uid;
        for (let lv = 1; lv < level; lv++) g.upgrade(uid);
        // 레벨이 올라 지불 의향이 커진 만큼 값을 올린다
        g.setPrice(uid, 800 * 1.1 ** (level - 1));
        runDay(g);
        sum += g.report!.revenue;
      }
      return sum;
    };
    expect(revenue(3)).toBeGreaterThan(revenue(1) * 1.2);
  });

  it('슬라이더 값은 범위와 가격 단위에 맞춰진다', () => {
    const g = new Game(8);
    g.place('ramen', 4);
    const uid = g.s.buildings[0].uid;
    g.setTuning(uid, 12.4);
    g.setPrice(uid, 1234);
    expect(g.s.buildings[0].tuning).toBe(10);
    expect(g.s.buildings[0].price).toBe(1250);
    g.setPrice(uid, 10);
    expect(g.s.buildings[0].price).toBe(400);
  });

  it('공터 확장은 열린 땅 옆부터, 다 열면 목표 달성', () => {
    const g = richGame(9);
    expect(g.unlock(0).ok).toBe(false);
    for (const x of [2, 1, 0, 13, 14, 15]) expect(g.unlock(x).ok).toBe(true);
    expect(g.s.goals).toContain('fullStreet');
  });

  it('너무 비싸면 손님이 돌아서고 평판이 떨어진다', () => {
    const g = richGame(10);
    g.place('ramen', 7);
    const uid = g.s.buildings[0].uid;
    g.setPrice(uid, 1600);
    runDay(g);
    const shop = g.report!.shops.find((s) => s.uid === uid)!;
    expect(shop.refusals).toBeGreaterThan(0);
    expect(g.s.buildings[0].rating).toBeLessThan(0.5);
  });

  it('같은 배치라도 비 오는 날 라멘 매출이 1.5배 넘게 크다', () => {
    const revenue = (weather: 'clear' | 'rain'): number => {
      let total = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const g = richGame(seed);
        g.s.today = { weather, temp: 12 };
        g.place('ramen', 7);
        runDay(g);
        total += g.report!.revenue;
      }
      return total;
    };
    expect(revenue('rain')).toBeGreaterThan(revenue('clear') * 1.5);
  });

  it('향기에 이끌려 되돌아오는 손님이 생긴다', () => {
    let pulls = 0;
    for (let seed = 1; seed <= 5; seed++) {
      const g = richGame(seed);
      g.place('bakery', 7);
      g.place('taiyaki', 4);
      runDay(g);
      pulls += g.report!.aromaPulls;
    }
    expect(pulls).toBeGreaterThan(0);
  });
});

describe('보도 위 움직임', () => {
  it('손님이 한 줄로만 걷지 않고 비켜 가고, 구경하고, 가게에서 나와 보도로 돌아간다', () => {
    const g = richGame(41);
    for (const [type, x] of [['ramen', 3], ['bakery', 6], ['teahouse', 9], ['taiyaki', 12]] as const) g.place(type, x);
    g.startBusiness();
    const firstLane = new Map<number, number>();
    let laneChanges = 0;
    let browsed = 0;
    let leftShop = 0;
    const seenBrowse = new Set<number>();
    for (let i = 0; i < 4000 && g.phase === 'business'; i++) {
      const wasInside = new Set(g.peds.filter((p) => p.state === 'inside' || p.state === 'counter').map((p) => p.id));
      g.tick(0.25);
      for (const p of g.peds) {
        expect(p.lane).toBeGreaterThanOrEqual(0);
        expect(p.lane).toBeLessThanOrEqual(LANES - 1);
        if (!firstLane.has(p.id)) firstLane.set(p.id, p.lane);
        else if (p.state === 'walk' && Math.abs(p.lane - firstLane.get(p.id)!) > 1.5) {
          laneChanges += 1;
          firstLane.set(p.id, p.lane);
        }
        if (p.state === 'browse' && !seenBrowse.has(p.id)) {
          seenBrowse.add(p.id);
          browsed += 1;
        }
        if (wasInside.has(p.id) && p.state === 'walk') {
          leftShop += 1;
          expect(p.lane).toBeLessThan(1);
          expect(p.laneTarget).toBeGreaterThanOrEqual(0);
        }
      }
    }
    expect(laneChanges).toBeGreaterThan(10);
    expect(browsed).toBeGreaterThan(0);
    expect(leftShop).toBeGreaterThan(0);
  });
});

describe('길고양이', () => {
  const bld = (uid: number, type: Building['type'], x: number): Building => ({ uid, type, x, tuning: 0, price: 0, rating: 0.5, level: 1 });

  it('급식소가 없으면 고양이가 오지 않는다', () => {
    const rng = new Rng(1);
    for (let i = 0; i < 50; i++) expect(rollCatArrival(rng, [], [], 1, 1)).toBeNull();
  });

  it('급식소 하나에 2마리까지 정착한다', () => {
    const g = richGame(11);
    g.place('feeder', 6);
    for (let d = 0; d < 12; d++) {
      runDay(g);
      g.advanceDay();
    }
    expect(g.s.cats.filter((c) => !c.legendary)).toHaveLength(2);
    expect(g.cats).toHaveLength(g.s.cats.length);
  });

  it('급식소를 없애면 다음 날 아침 떠난다', () => {
    const cats = [
      { id: 1, name: '모찌', breed: 'calico' as const, personality: 'shy' as const, legendary: false, affection: 0, arrivedDay: 1 },
      { id: 2, name: '스즈', breed: 'calico' as const, personality: 'friendly' as const, legendary: true, affection: 0, arrivedDay: 2 },
    ];
    expect(catsToLeave([], cats).map((c) => c.id)).toEqual([1, 2]);
    expect(catsToLeave([bld(1, 'feeder', 4), bld(2, 'catTower', 5)], cats)).toEqual([]);
  });

  it('전설의 고양이는 캣타워·고양이 3마리·행복도 70 조건이 모두 필요하다', () => {
    const three = [1, 2, 3].map((id) => ({ id, name: `c${id}`, breed: 'grey' as const, personality: 'shy' as const, legendary: false, affection: 0, arrivedDay: 1 }));
    const homes = [bld(1, 'feeder', 4), bld(2, 'catTower', 5)];
    expect(legendaryEligible(homes, three, 75)).toBe(true);
    expect(legendaryEligible(homes, three, 65)).toBe(false);
    expect(legendaryEligible([bld(1, 'feeder', 4)], three, 75)).toBe(false);
    expect(legendaryEligible(homes, three.slice(0, 2), 75)).toBe(false);
  });

  it('고양이를 쓰다듬으면 애정도가 오른다', () => {
    const save: SaveState = Game.freshState(new Rng(1));
    save.buildings.push(bld(1, 'feeder', 6));
    save.nextUid = 2;
    save.cats.push({ id: 1, name: '모찌', breed: 'orange', personality: 'friendly', legendary: false, affection: 0, arrivedDay: 1 });
    save.nextCatId = 2;
    const g = new Game(12, save);
    expect(g.petCat(1)).toBe(true);
    expect(g.s.cats[0].affection).toBe(1);
    expect(g.cats[0].state).toBe('petted');
    expect(save.cats[0].affection).toBe(0); // 원본 저장 상태는 건드리지 않는다
  });
});

describe('목표', () => {
  it('좋은 시너지 3종을 동시에 만들면 골목 설계자', () => {
    const g = richGame(13);
    g.place('bookstore', 3);
    g.place('teahouse', 5);
    g.place('bakery', 7);
    expect(g.s.goals).not.toContain('synergy3');
    g.place('bench', 9);
    g.place('taiyaki', 10);
    expect(g.s.goals).toContain('synergy3');
  });
});
