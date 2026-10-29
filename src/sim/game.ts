import { aromaAt } from './aroma.ts';
import {
  BUILDINGS,
  CAT_BREED_NAMES,
  CAT_PERSONALITY_INFO,
  CLOSE_TIME,
  CLOSING_GRACE_MIN,
  DAYS_PER_SEASON,
  DEMOLISH_REFUND,
  EVENING_TIME,
  GROUND_Y,
  LEGENDARY_CHANCE,
  MAX_PEDESTRIANS,
  MID_DAY_CAT_TIME,
  OPEN_TIME,
  PREP_TIME,
  RESIDENTS,
  RESIDENT_INFO,
  SEASONS,
  SEASON_INFO,
  START_HAPPINESS,
  START_MONEY,
  START_POPULARITY,
  STREET_PX,
  STREET_TILES,
  TILE_PX,
  WEATHER_INFO,
  shopDef,
  type BuildingType,
  type GoalId,
  type ResidentType,
  type SeasonId,
  type ShopId,
} from './data.ts';
import {
  AROMA_TURN_CHANCE,
  RATING_LEARN,
  evaluatePurchase,
  visitProbability,
  wouldRefuse,
  type FeedbackReason,
  type MarketContext,
  type Mood,
  type Shopper,
} from './economy.ts';
import { catHomeX, catsToLeave, legendaryEligible, makeLegendary, rollCatArrival, type Cat, type CatRuntime } from './cats.ts';
import { eunNeun, iGa } from './josa.ts';
import { Rng, clamp } from './rng.ts';
import {
  buildingAtTile,
  checkPlacement,
  checkUnlock,
  doorX,
  extraUnlockedCount,
  initialUnlocked,
  isShop,
  positiveSynergyKinds,
  spanOf,
  synergyEffects,
  unlockCost,
  type Building,
} from './street.ts';
import { demandMod, isFestivalDay, lanternBoost, residentMod, rollWeather, seasonOf, trafficMod, type DayWeather } from './weather.ts';

export type Phase = 'prep' | 'business' | 'accounting';
export type PedState = 'walk' | 'inside' | 'counter' | 'petting' | 'resting' | 'sniff';

export interface Bubble {
  text: string;
  mood: Mood;
  /** 실시간 초 */
  age: number;
  ttl: number;
}

export interface Pedestrian extends Shopper {
  id: number;
  x: number;
  /** 보도 위 세로 줄(0~9). 그리기 순서와 높이에만 쓴다. */
  lane: number;
  dir: 1 | -1;
  speed: number;
  state: PedState;
  timer: number;
  /** 들르는 중이거나 되돌아가 들를 건물 */
  target: number | null;
  /** 문 앞을 지나며 들를지 따져 본 건물 */
  considered: number[];
  /** 따져 보고 그냥 지나친 가게(향기에 이끌려 되돌아올 후보) */
  passed: number[];
  /** 가게별로 맡은 가장 진한 향기 */
  aroma: Record<number, number>;
  catsMet: number[];
  turned: boolean;
  happiness: number;
  petted: boolean;
  rested: boolean;
  litBonus: boolean;
  lastTile: number;
  lookSeed: number;
  walkPhase: number;
  bubble: Bubble | null;
}

/** 저장 파일에 들어가는 상태. 하루가 시작되는 아침(준비 단계) 기준이다. */
export interface SaveState {
  day: number;
  money: number;
  popularity: number;
  lastHappiness: number;
  unlocked: boolean[];
  buildings: Building[];
  nextUid: number;
  cats: Cat[];
  nextCatId: number;
  today: DayWeather;
  tomorrow: DayWeather;
  goals: GoalId[];
  totalRevenue: number;
  bestDayRevenue: number;
}

export interface ShopDayStats {
  visits: number;
  customers: number;
  revenue: number;
  refusals: number;
  satisfactionSum: number;
  aromaPulls: number;
  reasons: Partial<Record<FeedbackReason, number>>;
}

export interface DayStats {
  visitors: number;
  departed: number;
  happinessSum: number;
  customers: number;
  refusals: number;
  revenue: number;
  catPets: number;
  playerPets: number;
  aromaPulls: number;
  byType: Record<ResidentType, number>;
  shops: Record<number, ShopDayStats>;
}

export interface FeedbackEntry {
  text: string;
  mood: Mood;
  resident: ResidentType;
  reason: FeedbackReason;
  day: number;
  time: number;
}

export interface Effect {
  kind: 'coin' | 'heart';
  x: number;
  y: number;
  text?: string;
  age: number;
  ttl: number;
}

export interface ShopReport {
  uid: number;
  type: ShopId;
  customers: number;
  revenue: number;
  refusals: number;
  aromaPulls: number;
  avgSatisfaction: number | null;
  topReason: FeedbackReason | null;
  topReasonCount: number;
}

export interface DayReport {
  day: number;
  season: SeasonId;
  weather: DayWeather;
  festival: boolean;
  revenue: number;
  visitors: number;
  customers: number;
  refusals: number;
  aromaPulls: number;
  catPets: number;
  playerPets: number;
  avgHappiness: number;
  prevHappiness: number;
  popularity: number;
  prevPopularity: number;
  shops: ShopReport[];
  goals: GoalId[];
  tomorrow: DayWeather;
  tomorrowSeason: SeasonId;
}

export type GameEvent =
  | { kind: 'toast'; icon: string; text: string }
  | { kind: 'phase'; phase: Phase }
  | { kind: 'dayEnd' }
  | { kind: 'newDay'; seasonChanged: boolean }
  | { kind: 'goal'; id: GoalId }
  | { kind: 'mascot'; name: string };

export type ActionResult = { ok: true } | { ok: false; reason: string };

const OK: ActionResult = { ok: true };
const fail = (reason: string): ActionResult => ({ ok: false, reason });
const FEEDBACK_KEEP = 8;

function emptyStats(): DayStats {
  return {
    visitors: 0,
    departed: 0,
    happinessSum: 0,
    customers: 0,
    refusals: 0,
    revenue: 0,
    catPets: 0,
    playerPets: 0,
    aromaPulls: 0,
    byType: { student: 0, salaryman: 0, elder: 0, tourist: 0 },
    shops: {},
  };
}

export function emptyShopStats(): ShopDayStats {
  return { visits: 0, customers: 0, revenue: 0, refusals: 0, satisfactionSum: 0, aromaPulls: 0, reasons: {} };
}

/**
 * 게임 상태와 하루 진행 FSM(준비 → 영업 → 결산 → 다음 날 준비).
 * 렌더러·UI와 무관한 순수 시뮬레이션이라 Node에서도 그대로 돈다.
 */
export class Game {
  s: SaveState;
  phase: Phase = 'prep';
  /** 하루 중 시각(분). 준비 단계는 9:00에 멈춰 있다. */
  time = PREP_TIME;
  peds: Pedestrian[] = [];
  cats: CatRuntime[] = [];
  stats: DayStats = emptyStats();
  feedback = new Map<number, FeedbackEntry[]>();
  effects: Effect[] = [];
  report: DayReport | null = null;
  /** 영업 중 골목을 떠난 손님 기분의 이동 평균 */
  liveHappiness: number;

  private rng: Rng;
  private events: GameEvent[] = [];
  private pendingGoals: GoalId[] = [];
  private nextPedId = 1;
  private closing = false;
  private midDayCatRolled = false;

  constructor(seed: number, save?: SaveState) {
    this.rng = new Rng(seed);
    this.s = save ? structuredClone(save) : Game.freshState(this.rng);
    this.liveHappiness = this.s.lastHappiness;
    this.syncCats(false);
  }

  static freshState(rng: Rng): SaveState {
    return {
      day: 1,
      money: START_MONEY,
      popularity: START_POPULARITY,
      lastHappiness: START_HAPPINESS,
      unlocked: initialUnlocked(),
      buildings: [],
      nextUid: 1,
      cats: [],
      nextCatId: 1,
      // 첫날은 규칙을 익히기 쉽게 맑은 날로 시작한다
      today: { weather: 'clear', temp: SEASON_INFO.spring.baseTemp + WEATHER_INFO.clear.tempOffset },
      tomorrow: rollWeather(rng, seasonOf(2)),
      goals: [],
      totalRevenue: 0,
      bestDayRevenue: 0,
    };
  }

  // ------------------------------------------------------------ 조회

  get season(): SeasonId {
    return seasonOf(this.s.day);
  }

  get festival(): boolean {
    return isFestivalDay(this.s.day);
  }

  get hasMascot(): boolean {
    return this.s.cats.some((c) => c.legendary);
  }

  get closingTime(): boolean {
    return this.closing;
  }

  market(): MarketContext {
    return {
      season: this.season,
      weather: this.s.today.weather,
      temp: this.s.today.temp,
      festival: this.festival,
      buildings: this.s.buildings,
    };
  }

  building(uid: number | null): Building | undefined {
    return uid === null ? undefined : this.s.buildings.find((b) => b.uid === uid);
  }

  /** 가게 안·카운터·벤치를 차지한 사람 수 */
  occupancy(uid: number): number {
    return this.peds.filter((p) => p.target === uid && (p.state === 'inside' || p.state === 'counter' || p.state === 'resting')).length;
  }

  shopStats(uid: number): ShopDayStats {
    return (this.stats.shops[uid] ??= emptyShopStats());
  }

  unlockCost(): number {
    return unlockCost(extraUnlockedCount(this.s.unlocked));
  }

  refundOf(uid: number): number {
    const b = this.building(uid);
    return b ? Math.floor(BUILDINGS[b.type].cost * DEMOLISH_REFUND) : 0;
  }

  drainEvents(): GameEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  // ------------------------------------------------------------ 플레이어 명령

  place(type: BuildingType, x: number): ActionResult {
    if (this.phase === 'accounting') return fail('결산 중에는 지을 수 없어요');
    const check = checkPlacement(this.s.buildings, this.s.unlocked, type, x);
    if (!check.ok) return check;
    const def = BUILDINGS[type];
    if (this.s.money < def.cost) return fail('돈이 부족해요');
    this.s.money -= def.cost;
    this.s.buildings.push({
      uid: this.s.nextUid++,
      type,
      x,
      tuning: def.kind === 'shop' ? 5 : 0,
      price: def.kind === 'shop' ? def.price.base : 0,
      rating: 0.5,
    });
    this.s.buildings.sort((a, b) => a.x - b.x);
    if (positiveSynergyKinds(this.s.buildings) >= 3) this.achieve('synergy3');
    if (type === 'feeder' && this.s.cats.length === 0) this.toast('🥫', '급식소를 놓았어요. 곧 길고양이가 찾아올지도 몰라요.');
    return OK;
  }

  demolish(uid: number): ActionResult {
    if (this.phase === 'accounting') return fail('결산 중에는 철거할 수 없어요');
    const b = this.building(uid);
    if (!b) return fail('건물을 찾을 수 없어요');
    const refund = this.refundOf(uid);
    for (const p of this.peds) {
      if (p.target !== uid) continue;
      p.target = null;
      if (p.state !== 'walk' && p.state !== 'petting') p.state = 'walk';
    }
    this.s.buildings = this.s.buildings.filter((q) => q.uid !== uid);
    this.s.money += refund;
    this.feedback.delete(uid);
    return OK;
  }

  unlock(x: number): ActionResult {
    if (this.phase === 'accounting') return fail('결산 중에는 확장할 수 없어요');
    const check = checkUnlock(this.s.unlocked, x);
    if (!check.ok) return check;
    const cost = this.unlockCost();
    if (this.s.money < cost) return fail('돈이 부족해요');
    this.s.money -= cost;
    this.s.unlocked[x] = true;
    if (this.s.unlocked.every(Boolean)) this.achieve('fullStreet');
    return OK;
  }

  setTuning(uid: number, value: number): void {
    const b = this.building(uid);
    if (!b || !isShop(b)) return;
    b.tuning = clamp(Math.round(value), 0, 10);
  }

  setPrice(uid: number, value: number): void {
    const b = this.building(uid);
    if (!b || !isShop(b)) return;
    const p = shopDef(b.type).price;
    b.price = clamp(Math.round(value / p.step) * p.step, p.min, p.max);
  }

  petCat(id: number): boolean {
    const rt = this.cats.find((c) => c.id === id);
    const cat = this.s.cats.find((c) => c.id === id);
    if (!rt || !cat || this.phase === 'accounting') return false;
    rt.state = 'petted';
    rt.timer = 4;
    cat.affection += 1;
    this.stats.playerPets += 1;
    this.effects.push({ kind: 'heart', x: rt.x, y: GROUND_Y + 2, age: 0, ttl: 1.2 });
    for (const p of this.peds) {
      if (p.state === 'walk' && Math.abs(p.x - rt.x) < 30) p.happiness = clamp(p.happiness + 3, 0, 100);
    }
    if (cat.affection === 5) this.toast('💕', `${cat.name}${iGa(cat.name)} 당신을 알아보는 것 같아요.`);
    if (cat.affection === 20) this.toast('💞', `${cat.name}${eunNeun(cat.name)} 이제 당신의 단짝이에요.`);
    return true;
  }

  startBusiness(): ActionResult {
    if (this.phase !== 'prep') return fail('지금은 영업을 시작할 수 없어요');
    this.phase = 'business';
    this.time = OPEN_TIME;
    this.closing = false;
    this.midDayCatRolled = false;
    this.liveHappiness = this.s.lastHappiness;
    this.events.push({ kind: 'phase', phase: 'business' });
    return OK;
  }

  advanceDay(): ActionResult {
    if (this.phase !== 'accounting') return fail('결산이 끝나야 다음 날로 넘어가요');
    const prevSeason = this.season;
    this.s.day += 1;
    this.s.today = this.s.tomorrow;
    this.s.tomorrow = rollWeather(this.rng, seasonOf(this.s.day + 1));
    this.morningCats();
    if (this.s.day > DAYS_PER_SEASON * SEASONS.length) this.achieve('fourSeasons');
    this.stats = emptyStats();
    this.report = null;
    this.peds = [];
    this.effects = [];
    this.phase = 'prep';
    this.time = PREP_TIME;
    this.events.push({ kind: 'newDay', seasonChanged: this.season !== prevSeason });
    return OK;
  }

  // ------------------------------------------------------------ 진행

  /** 게임 시간(분)만큼 진행. 큰 dt는 0.5분 단위로 잘라 문 지나침을 놓치지 않는다. */
  tick(dtMin: number): void {
    let remaining = Math.min(dtMin, 30);
    while (remaining > 1e-9) {
      const dt = Math.min(0.5, remaining);
      remaining -= dt;
      this.step(dt);
    }
  }

  /** 말풍선·이펙트처럼 실시간으로 사라지는 연출 */
  updateRealtime(dtSec: number): void {
    for (const p of this.peds) {
      if (!p.bubble) continue;
      p.bubble.age += dtSec;
      if (p.bubble.age >= p.bubble.ttl) p.bubble = null;
    }
    for (const e of this.effects) e.age += dtSec;
    this.effects = this.effects.filter((e) => e.age < e.ttl);
  }

  private step(dt: number): void {
    if (this.phase === 'accounting') return;
    this.updateCats(dt);
    if (this.phase !== 'business') return;
    this.time += dt;
    if (!this.closing && this.time >= CLOSE_TIME) this.closing = true;
    if (!this.closing) {
      this.spawnStep(dt);
      if (!this.midDayCatRolled && this.time >= MID_DAY_CAT_TIME) {
        this.midDayCatRolled = true;
        this.tryCatArrival();
      }
    }
    this.peds = this.peds.filter((p) => this.updatePed(p, dt));
    if (this.closing && (this.peds.length === 0 || this.time >= CLOSE_TIME + CLOSING_GRACE_MIN)) this.finishDay();
  }

  private spawnStep(dt: number): void {
    if (this.peds.length >= MAX_PEDESTRIANS) return;
    const weather = this.s.today.weather;
    const shops = this.s.buildings.filter(isShop).length;
    const lanterns = this.s.buildings.filter((b) => b.type === 'lantern').length;
    const hour = clamp(Math.floor((this.time - OPEN_TIME) / 60), 0, 9);
    const attract =
      (0.04 + 0.03 * Math.min(shops, 10)) *
      (0.6 + (0.8 * this.s.popularity) / 100) *
      trafficMod(this.season, weather, this.festival, this.time) *
      lanternBoost(lanterns, this.season, this.festival, this.time) *
      (this.hasMascot ? 1.2 : 1);
    for (const type of RESIDENTS) {
      const info = RESIDENT_INFO[type];
      let rate = attract * info.base * info.hours[hour] * residentMod(this.season, weather, this.festival, type);
      if (type === 'tourist' && this.hasMascot) rate *= 1.5;
      if (this.rng.chance(rate * dt)) this.spawn(type);
    }
  }

  private spawn(type: ResidentType): void {
    const info = RESIDENT_INFO[type];
    const weather = WEATHER_INFO[this.s.today.weather];
    const dir: 1 | -1 = this.rng.chance(0.5) ? 1 : -1;
    const x = dir === 1 ? -12 : STREET_PX + 12;
    this.peds.push({
      id: this.nextPedId++,
      type,
      x,
      lane: this.rng.int(0, 9),
      dir,
      speed: this.rng.range(info.speed[0], info.speed[1]) * (weather.umbrella ? 1.1 : 1),
      state: 'walk',
      timer: 0,
      target: null,
      considered: [],
      passed: [],
      aroma: {},
      catsMet: [],
      turned: false,
      purchases: 0,
      happiness: clamp(weather.happiness + (this.festival ? 5 : 0) + this.rng.range(-5, 5), 0, 100),
      petted: false,
      rested: false,
      litBonus: false,
      lastTile: Math.floor(x / TILE_PX),
      umbrella: weather.umbrella,
      fan: type === 'tourist' && this.hasMascot && this.rng.chance(0.5),
      budgetVar: this.rng.range(0.85, 1.15),
      idealVar: this.rng.range(-1, 1),
      lookSeed: this.rng.int(0, 0x7fffffff),
      walkPhase: this.rng.range(0, 10),
      bubble: null,
    });
    this.stats.visitors += 1;
    this.stats.byType[type] += 1;
  }

  /** @returns 골목에 계속 남아 있으면 true */
  private updatePed(p: Pedestrian, dt: number): boolean {
    if (p.state === 'walk') {
      const prevX = p.x;
      p.x += p.dir * p.speed * dt;
      p.walkPhase += p.speed * dt;
      this.crossDoors(p, prevX);
      if (p.state !== 'walk') return true;
      const tile = Math.floor(p.x / TILE_PX);
      if (tile !== p.lastTile) {
        p.lastTile = tile;
        if (tile >= 0 && tile < STREET_TILES) this.onEnterTile(p, tile);
        if (p.state !== 'walk') return true;
      }
      this.meetCats(p);
      if (p.x < -16 || p.x > STREET_PX + 16) {
        this.depart(p);
        return false;
      }
      return true;
    }
    p.timer -= dt;
    if (p.timer > 0) return true;
    if (p.state === 'inside' || p.state === 'counter') {
      const b = this.building(p.target);
      if (b) this.finishVisit(p, b);
      else {
        p.state = 'walk';
        p.target = null;
      }
    } else if (p.state === 'sniff') {
      // target은 그대로 둔다: 되돌아가서 들른다
      p.state = 'walk';
    } else {
      p.state = 'walk';
      p.target = null;
    }
    return true;
  }

  private crossDoors(p: Pedestrian, prevX: number): void {
    for (const b of this.s.buildings) {
      const dx = doorX(b);
      const crossed = (prevX < dx && p.x >= dx) || (prevX > dx && p.x <= dx);
      if (!crossed) continue;
      if (isShop(b)) {
        if (p.target === b.uid) this.tryVisit(p, b, true);
        else if (!p.considered.includes(b.uid)) {
          p.considered.push(b.uid);
          this.tryVisit(p, b, false);
        }
      } else if (b.type === 'bench' && !p.considered.includes(b.uid)) {
        p.considered.push(b.uid);
        this.tryRest(p, b);
      }
      if (p.state !== 'walk') return;
    }
  }

  private tryVisit(p: Pedestrian, b: Building, forced: boolean): void {
    if (forced) p.target = null;
    if (this.closing) return;
    const def = shopDef(b.type);
    const ctx = this.market();
    if (!forced && !this.rng.chance(visitProbability(ctx, p, b, p.aroma[b.uid] ?? 0))) {
      p.passed.push(b.uid);
      return;
    }
    const st = this.shopStats(b.uid);
    const occupied = this.occupancy(b.uid);
    if (occupied >= def.capacity) {
      st.reasons.full = (st.reasons.full ?? 0) + 1;
      p.happiness = clamp(p.happiness - 2, 0, 100);
      this.say(p, '자리가 없네…', 'sad');
      return;
    }
    if (wouldRefuse(ctx, p, b)) {
      st.refusals += 1;
      st.reasons.refused = (st.reasons.refused ?? 0) + 1;
      this.stats.refusals += 1;
      b.rating = clamp(b.rating - 0.01, 0, 1);
      p.happiness = clamp(p.happiness - 8, 0, 100);
      const text = this.rng.chance(0.5) ? '너무 비싸요…' : '지갑이 울어요…';
      this.say(p, text, 'sad');
      this.logFeedback(b, p, text, 'sad', 'refused');
      return;
    }
    p.state = def.indoor ? 'inside' : 'counter';
    p.target = b.uid;
    p.timer = def.serviceMin * synergyEffects(ctx.buildings, b).dwell * this.rng.range(0.8, 1.2);
    p.x = doorX(b) + (def.indoor ? 0 : (occupied - (def.capacity - 1) / 2) * 5);
    st.visits += 1;
  }

  private finishVisit(p: Pedestrian, b: Building): void {
    const out = evaluatePurchase(this.market(), p, b, this.rng.next());
    const st = this.shopStats(b.uid);
    p.state = 'walk';
    p.target = null;
    p.purchases += 1;
    p.happiness = clamp(p.happiness + out.happinessDelta, 0, 100);
    this.s.money += out.revenue;
    st.revenue += out.revenue;
    st.customers += 1;
    st.satisfactionSum += out.satisfaction;
    st.reasons[out.reason] = (st.reasons[out.reason] ?? 0) + 1;
    this.stats.revenue += out.revenue;
    this.stats.customers += 1;
    b.rating = clamp(b.rating + RATING_LEARN * (out.satisfaction - b.rating), 0, 1);
    this.say(p, out.text, out.mood);
    this.effects.push({ kind: 'coin', x: doorX(b), y: GROUND_Y - 26, text: `+¥${out.revenue.toLocaleString('ko-KR')}`, age: 0, ttl: 1.4 });
    this.logFeedback(b, p, out.text, out.mood, out.reason);
    this.achieve('firstCustomer');
  }

  private tryRest(p: Pedestrian, b: Building): void {
    if (this.closing || WEATHER_INFO[this.s.today.weather].umbrella) return;
    const occupied = this.occupancy(b.uid);
    if (occupied >= BUILDINGS.bench.capacity || !this.rng.chance(RESIDENT_INFO[p.type].benchRest)) return;
    p.state = 'resting';
    p.target = b.uid;
    p.timer = this.rng.range(15, 25);
    p.x = doorX(b) + (occupied === 0 ? -5 : 5);
    p.rested = true;
    p.happiness = clamp(p.happiness + 6, 0, 100);
    if (this.rng.chance(0.4)) this.say(p, '잠깐 쉬어 갈까', 'neutral');
  }

  private onEnterTile(p: Pedestrian, tile: number): void {
    if (this.closing) return;
    for (const { b, f } of aromaAt(this.s.buildings, tile)) {
      if (!p.considered.includes(b.uid)) {
        // 아직 문 앞에 닿기 전: 향기가 진할수록 들를 확률이 오른다
        const prev = p.aroma[b.uid];
        if (prev === undefined && f >= 0.5 && this.rng.chance(0.2)) this.say(p, '킁킁…', 'think');
        if (prev === undefined || prev < f) p.aroma[b.uid] = f;
        continue;
      }
      // 이미 지나친 가게: 가게를 벗어나 몇 걸음 간 뒤 향기에 이끌려 되돌아올 수 있다
      const [l, r] = spanOf(b);
      const behind = (doorX(b) - p.x) * p.dir < 0;
      if (!p.passed.includes(b.uid) || p.turned || p.target !== null || !behind || (tile >= l && tile <= r)) continue;
      const def = shopDef(b.type);
      const pull = AROMA_TURN_CHANCE * f * RESIDENT_INFO[p.type].affinity[def.id] * demandMod(this.season, this.s.today.weather, def.id);
      if (!this.rng.chance(pull)) continue;
      p.turned = true;
      p.dir = p.dir === 1 ? -1 : 1;
      p.target = b.uid;
      p.state = 'sniff';
      p.timer = 2;
      this.say(p, `음~ ${def.aroma?.label ?? '좋은 냄새'}!`, 'think');
      this.stats.aromaPulls += 1;
      this.shopStats(b.uid).aromaPulls += 1;
      return;
    }
    if (this.time >= EVENING_TIME && !p.litBonus && buildingAtTile(this.s.buildings, tile)?.type === 'lantern') {
      p.litBonus = true;
      p.happiness = clamp(p.happiness + 3, 0, 100);
    }
  }

  private meetCats(p: Pedestrian): void {
    if (p.petted) return;
    for (const rt of this.cats) {
      if (rt.state === 'walk' || rt.state === 'petted' || p.catsMet.includes(rt.id) || Math.abs(rt.x - p.x) > 5) continue;
      p.catsMet.push(rt.id);
      const cat = this.s.cats.find((c) => c.id === rt.id);
      if (!cat) continue;
      const base = cat.legendary ? 0.9 : 0.35 * CAT_PERSONALITY_INFO[cat.personality].pet;
      const chance = base * RESIDENT_INFO[p.type].petCat * (p.fan && cat.legendary ? 1.5 : 1);
      if (!this.rng.chance(chance)) continue;
      p.petted = true;
      p.state = 'petting';
      p.timer = 5;
      rt.state = 'petted';
      rt.timer = 5;
      p.happiness = clamp(p.happiness + (cat.legendary ? 14 : 8), 0, 100);
      this.stats.catPets += 1;
      this.effects.push({ kind: 'heart', x: rt.x, y: GROUND_Y + 2, age: 0, ttl: 1.2 });
      this.say(p, cat.legendary ? `${cat.name}다! 방울 소리 좋아` : this.rng.pick(['고양이다!', '귀여워…', '냐옹~']), 'happy');
      return;
    }
  }

  private depart(p: Pedestrian): void {
    let h = p.happiness;
    if (p.purchases === 0 && !p.petted && !p.rested) h -= 4;
    h = clamp(h, 0, 100);
    this.stats.departed += 1;
    this.stats.happinessSum += h;
    this.liveHappiness += (h - this.liveHappiness) * 0.06;
  }

  private finishDay(): void {
    for (const p of this.peds) {
      if (p.state === 'inside' || p.state === 'counter') {
        const b = this.building(p.target);
        if (b) this.finishVisit(p, b);
      }
      this.depart(p);
    }
    this.peds = [];
    const st = this.stats;
    const avg = st.departed > 0 ? st.happinessSum / st.departed : this.s.lastHappiness;
    const prevHappiness = this.s.lastHappiness;
    const prevPopularity = this.s.popularity;
    this.s.lastHappiness = Math.round(avg * 10) / 10;
    this.s.popularity = Math.round(clamp(this.s.popularity + (avg - this.s.popularity) * 0.35, 0, 100) * 10) / 10;
    this.s.totalRevenue += st.revenue;
    this.s.bestDayRevenue = Math.max(this.s.bestDayRevenue, st.revenue);
    if (st.revenue >= 50_000) this.achieve('revenue50k');
    if (st.departed > 0 && avg >= 75) this.achieve('happy75');
    this.report = this.buildReport(prevHappiness, prevPopularity);
    this.phase = 'accounting';
    this.closing = false;
    this.events.push({ kind: 'dayEnd' });
  }

  private buildReport(prevHappiness: number, prevPopularity: number): DayReport {
    const shops: ShopReport[] = this.s.buildings.filter(isShop).map((b) => {
      const st = this.stats.shops[b.uid] ?? emptyShopStats();
      let topReason: FeedbackReason | null = null;
      let topReasonCount = 0;
      for (const [reason, n] of Object.entries(st.reasons) as [FeedbackReason, number][]) {
        if (n > topReasonCount) {
          topReason = reason;
          topReasonCount = n;
        }
      }
      return {
        uid: b.uid,
        type: shopDef(b.type).id,
        customers: st.customers,
        revenue: st.revenue,
        refusals: st.refusals,
        aromaPulls: st.aromaPulls,
        avgSatisfaction: st.customers > 0 ? st.satisfactionSum / st.customers : null,
        topReason,
        topReasonCount,
      };
    });
    const goals = this.pendingGoals;
    this.pendingGoals = [];
    return {
      day: this.s.day,
      season: this.season,
      weather: { ...this.s.today },
      festival: this.festival,
      revenue: this.stats.revenue,
      visitors: this.stats.visitors,
      customers: this.stats.customers,
      refusals: this.stats.refusals,
      aromaPulls: this.stats.aromaPulls,
      catPets: this.stats.catPets,
      playerPets: this.stats.playerPets,
      avgHappiness: this.s.lastHappiness,
      prevHappiness,
      popularity: this.s.popularity,
      prevPopularity,
      shops,
      goals,
      tomorrow: { ...this.s.tomorrow },
      tomorrowSeason: seasonOf(this.s.day + 1),
    };
  }

  // ------------------------------------------------------------ 고양이

  private morningCats(): void {
    for (const cat of catsToLeave(this.s.buildings, this.s.cats)) {
      this.s.cats = this.s.cats.filter((c) => c.id !== cat.id);
      this.toast('🐈', `${cat.name}${eunNeun(cat.name)} 머물 곳이 없어 다른 골목으로 떠났어요.`);
    }
    this.tryCatArrival();
    if (legendaryEligible(this.s.buildings, this.s.cats, this.s.lastHappiness) && this.rng.chance(LEGENDARY_CHANCE)) {
      const cat = makeLegendary(this.s.nextCatId++, this.s.day);
      this.s.cats.push(cat);
      this.events.push({ kind: 'mascot', name: cat.name });
      this.achieve('mascot');
    }
    this.syncCats(true);
  }

  private tryCatArrival(): void {
    const cat = rollCatArrival(this.rng, this.s.buildings, this.s.cats, this.s.nextCatId, this.s.day);
    if (!cat) return;
    this.s.nextCatId += 1;
    this.s.cats.push(cat);
    this.toast('🐈', `${CAT_BREED_NAMES[cat.breed]} ${cat.name}${iGa(cat.name)} 골목에 자리 잡았어요! (${CAT_PERSONALITY_INFO[cat.personality].name})`);
    if (this.s.cats.filter((c) => !c.legendary).length >= 3) this.achieve('cats3');
    this.syncCats(true);
  }

  private syncCats(fromEdge: boolean): void {
    const ids = new Set(this.s.cats.map((c) => c.id));
    this.cats = this.cats.filter((rt) => ids.has(rt.id));
    for (const cat of this.s.cats) {
      if (this.cats.some((rt) => rt.id === cat.id)) continue;
      const home = catHomeX(this.s.buildings, cat);
      if (fromEdge) {
        const fromLeft = this.rng.chance(0.5);
        this.cats.push({ id: cat.id, x: fromLeft ? -10 : STREET_PX + 10, targetX: home, state: 'walk', timer: 0, dir: fromLeft ? 1 : -1 });
      } else {
        this.cats.push({ id: cat.id, x: home + this.rng.range(-10, 10), targetX: home, state: 'sit', timer: this.rng.range(5, 30), dir: 1 });
      }
    }
  }

  private updateCats(dt: number): void {
    for (const rt of this.cats) {
      const cat = this.s.cats.find((c) => c.id === rt.id);
      if (!cat) continue;
      rt.timer -= dt;
      if (rt.state === 'walk') {
        const dx = rt.targetX - rt.x;
        const step = CAT_PERSONALITY_INFO[cat.personality].speed * dt;
        if (Math.abs(dx) <= step) {
          rt.x = rt.targetX;
          rt.state = 'sit';
          rt.timer = this.rng.range(15, 45);
        } else {
          rt.dir = dx > 0 ? 1 : -1;
          rt.x += rt.dir * step;
        }
      } else if (rt.timer <= 0) {
        this.nextCatAction(rt, cat);
      }
    }
  }

  private nextCatAction(rt: CatRuntime, cat: Cat): void {
    const r = this.rng.next();
    if (r < 0.4) {
      const home = catHomeX(this.s.buildings, cat);
      const roam = CAT_PERSONALITY_INFO[cat.personality].roam;
      rt.targetX = clamp(home + this.rng.range(-roam, roam), 8, STREET_PX - 8);
      rt.state = 'walk';
    } else if (r < 0.65) {
      rt.state = 'sit';
      rt.timer = this.rng.range(20, 50);
    } else if (r < 0.85) {
      rt.state = 'groom';
      rt.timer = this.rng.range(8, 15);
    } else {
      rt.state = 'sleep';
      rt.timer = this.rng.range(40, 90);
    }
  }

  // ------------------------------------------------------------ 보조

  private say(p: Pedestrian, text: string, mood: Mood): void {
    p.bubble = { text, mood, age: 0, ttl: 2.6 };
  }

  private toast(icon: string, text: string): void {
    this.events.push({ kind: 'toast', icon, text });
  }

  private logFeedback(b: Building, p: Pedestrian, text: string, mood: Mood, reason: FeedbackReason): void {
    const list = this.feedback.get(b.uid) ?? [];
    list.unshift({ text, mood, resident: p.type, reason, day: this.s.day, time: this.time });
    if (list.length > FEEDBACK_KEEP) list.length = FEEDBACK_KEEP;
    this.feedback.set(b.uid, list);
  }

  private achieve(id: GoalId): void {
    if (this.s.goals.includes(id)) return;
    this.s.goals.push(id);
    this.pendingGoals.push(id);
    this.events.push({ kind: 'goal', id });
  }
}
