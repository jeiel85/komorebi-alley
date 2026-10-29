/**
 * 밸런스 점검용 헤드리스 시뮬레이션. 같은 배치를 여러 시드로 돌려 하루 지표 평균을 출력한다.
 * 실행: npm run balance
 */
import { Game } from '../src/sim/game.ts';
import type { BuildingType, WeatherId } from '../src/sim/data.ts';

interface Scenario {
  name: string;
  layout: [BuildingType, number][];
  weather?: WeatherId;
  temp?: number;
  day?: number;
  /** 가게별 슬라이더·가격 배율(기본가 대비) */
  tune?: Partial<Record<BuildingType, { tuning: number; priceMul: number }>>;
}

const SEEDS = 20;

function runScenario(sc: Scenario): void {
  const sum = { visitors: 0, customers: 0, refusals: 0, revenue: 0, happiness: 0, pulls: 0, catPets: 0 };
  const byShop = new Map<string, { customers: number; revenue: number }>();
  for (let seed = 1; seed <= SEEDS; seed++) {
    const g = new Game(seed);
    g.s.money = 1_000_000;
    if (sc.day) g.s.day = sc.day;
    if (sc.weather) g.s.today = { weather: sc.weather, temp: sc.temp ?? g.s.today.temp };
    g.s.unlocked = g.s.unlocked.map(() => true);
    for (const [type, x] of sc.layout) {
      const res = g.place(type, x);
      if (!res.ok) throw new Error(`${sc.name}: ${type}@${x} ${res.reason}`);
    }
    for (const b of g.s.buildings) {
      const t = sc.tune?.[b.type];
      if (!t) continue;
      g.setTuning(b.uid, t.tuning);
      g.setPrice(b.uid, b.price * t.priceMul);
    }
    g.startBusiness();
    for (let i = 0; i < 2000 && g.phase === 'business'; i++) g.tick(1);
    const r = g.report!;
    sum.visitors += r.visitors;
    sum.customers += r.customers;
    sum.refusals += r.refusals;
    sum.revenue += r.revenue;
    sum.happiness += r.avgHappiness;
    sum.pulls += r.aromaPulls;
    sum.catPets += r.catPets;
    for (const s of r.shops) {
      const acc = byShop.get(s.type) ?? { customers: 0, revenue: 0 };
      acc.customers += s.customers;
      acc.revenue += s.revenue;
      byShop.set(s.type, acc);
    }
  }
  const avg = (n: number) => (n / SEEDS).toFixed(1);
  console.log(`\n■ ${sc.name}`);
  console.log(
    `  방문 ${avg(sum.visitors)} · 구매 ${avg(sum.customers)} · 거절 ${avg(sum.refusals)} · 매출 ¥${Math.round(sum.revenue / SEEDS)} · 행복 ${avg(sum.happiness)} · 향기 유턴 ${avg(sum.pulls)}`,
  );
  for (const [type, acc] of byShop) console.log(`    ${type.padEnd(10)} 구매 ${avg(acc.customers)} · 매출 ¥${Math.round(acc.revenue / SEEDS)}`);
}

const starter: [BuildingType, number][] = [
  ['ramen', 5],
  ['vending', 7],
];

const scenarios: Scenario[] = [
  { name: '빈 골목(봄 맑음)', layout: [] },
  { name: '시작 배치: 라멘+자판기(봄 맑음)', layout: starter },
  { name: '라멘 단독(봄 맑음 12°C)', layout: [['ramen', 7]], weather: 'clear', temp: 12 },
  { name: '라멘 단독(봄 비 12°C)', layout: [['ramen', 7]], weather: 'rain', temp: 12 },
  {
    name: '중반 배치 8곳(봄 맑음)',
    layout: [
      ['ramen', 1],
      ['vending', 3],
      ['bench', 4],
      ['taiyaki', 5],
      ['bookstore', 6],
      ['teahouse', 8],
      ['bakery', 10],
      ['feeder', 12],
      ['kakigori', 13],
    ],
  },
  {
    name: '중반 배치 8곳 + 슬라이더 조율(봄 맑음)',
    layout: [
      ['ramen', 1],
      ['vending', 3],
      ['bench', 4],
      ['taiyaki', 5],
      ['bookstore', 6],
      ['teahouse', 8],
      ['bakery', 10],
      ['lantern', 12],
      ['kakigori', 13],
    ],
    tune: {
      ramen: { tuning: 6, priceMul: 0.9 },
      vending: { tuning: 5, priceMul: 0.9 },
      taiyaki: { tuning: 7, priceMul: 0.9 },
      bookstore: { tuning: 6, priceMul: 0.9 },
      teahouse: { tuning: 5, priceMul: 0.9 },
      bakery: { tuning: 5, priceMul: 0.9 },
      kakigori: { tuning: 6, priceMul: 0.9 },
    },
  },
  {
    name: '중반 배치 8곳(여름 폭염)',
    day: 6,
    weather: 'heatwave',
    temp: 35,
    layout: [
      ['ramen', 1],
      ['vending', 3],
      ['bench', 4],
      ['taiyaki', 5],
      ['bookstore', 6],
      ['teahouse', 8],
      ['bakery', 10],
      ['feeder', 12],
      ['kakigori', 13],
    ],
  },
];

for (const sc of scenarios) runScenario(sc);
