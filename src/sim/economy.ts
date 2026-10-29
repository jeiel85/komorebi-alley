import { RESIDENT_INFO, WEATHER_INFO, shopDef, type ResidentType, type SeasonId, type ShopDef, type WeatherId } from './data.ts';
import { clamp } from './rng.ts';
import { synergyEffects, type Building } from './street.ts';
import { demandMod } from './weather.ts';

/** 문 앞을 지날 때 들어갈 기본 확률 */
export const BASE_VISIT = 0.16;
/** 향기 세기 1일 때 방문 확률 증가분(+40%) */
export const AROMA_VISIT_BONUS = 0.4;
/** 지나친 가게 향기에 이끌려 되돌아올 기본 확률(향기 세기 1, 타일당). 드물어야 눈에 띈다. */
export const AROMA_TURN_CHANCE = 0.07;
/** 지불 의향 대비 가격이 이 배율을 넘으면 사지 않고 돌아선다 */
export const REFUSE_RATIO = 1.35;
export const PERFECT_THRESHOLD = 0.82;
/** 선호값과 이만큼 차이 나면 맛 점수 0 */
export const TASTE_TOLERANCE = 4;
/** 한 번 사 본 손님의 만족도가 평판에 반영되는 비율 */
export const RATING_LEARN = 0.04;

export interface MarketContext {
  season: SeasonId;
  weather: WeatherId;
  temp: number;
  festival: boolean;
  buildings: readonly Building[];
}

export interface Shopper {
  type: ResidentType;
  purchases: number;
  umbrella: boolean;
  fan: boolean;
  /** 개인별 지갑 사정(0.85~1.15) */
  budgetVar: number;
  /** 개인별 입맛 편차(-1~1) */
  idealVar: number;
}

export type Mood = 'happy' | 'neutral' | 'sad' | 'think';
export type FeedbackReason = 'perfect' | 'tooHigh' | 'tooLow' | 'pricey' | 'cheap' | 'ok' | 'refused' | 'full';

export const REASON_LABELS: Record<FeedbackReason, string> = {
  perfect: '완벽해요',
  tooHigh: '맛 조절(높음)',
  tooLow: '맛 조절(낮음)',
  pricey: '조금 비싸요',
  cheap: '가격이 착해요',
  ok: '괜찮아요',
  refused: '너무 비싸 돌아섬',
  full: '자리 없음',
};

export function visitProbability(ctx: MarketContext, shopper: Shopper, b: Building, aroma: number): number {
  const def = shopDef(b.type);
  const syn = synergyEffects(ctx.buildings, b);
  const repeat = shopper.purchases === 0 ? 1 : shopper.purchases === 1 ? 0.55 : 0.25;
  const umbrella = shopper.umbrella && !def.shelter ? 0.85 : 1;
  const p =
    BASE_VISIT *
    RESIDENT_INFO[shopper.type].affinity[def.id] *
    demandMod(ctx.season, ctx.weather, def.id) *
    (1 + AROMA_VISIT_BONUS * aroma) *
    syn.visit *
    (0.55 + 0.9 * b.rating) *
    repeat *
    umbrella *
    (shopper.fan ? 1.15 : 1);
  return clamp(p, 0, 0.85);
}

/** 이 손님이 기꺼이 낼 수 있는 가격 */
export function maxPay(ctx: MarketContext, shopper: Shopper, def: ShopDef): number {
  let m = def.price.ref * RESIDENT_INFO[shopper.type].budget * shopper.budgetVar;
  if (WEATHER_INFO[ctx.weather].umbrella && def.shelter) m *= 1.1;
  if (shopper.fan) m *= 1.15;
  if (ctx.festival) m *= 1.1;
  return m;
}

export function wouldRefuse(ctx: MarketContext, shopper: Shopper, b: Building): boolean {
  return b.price > maxPay(ctx, shopper, shopDef(b.type)) * REFUSE_RATIO;
}

/** 가격 점수: 지불 의향의 75% 이하면 1, 100%면 0.6, REFUSE_RATIO에서 0 */
export function priceScore(price: number, pay: number): number {
  const r = price / pay;
  if (r <= 0.75) return 1;
  if (r <= 1) return 1 - (r - 0.75) * 1.6;
  return Math.max(0, 0.6 - ((r - 1) * 0.6) / (REFUSE_RATIO - 1));
}

export function idealTuning(def: ShopDef, type: ResidentType, temp: number, idealVar: number): number {
  return clamp(def.tuning.ideal[type] + (def.tuning.tempSensitivity * (15 - temp)) / 10 + idealVar, 0, 10);
}

export function tasteScore(tuning: number, ideal: number): number {
  return clamp(1 - Math.abs(tuning - ideal) / TASTE_TOLERANCE, 0, 1);
}

export interface PurchaseOutcome {
  satisfaction: number;
  revenue: number;
  reason: FeedbackReason;
  text: string;
  mood: Mood;
  happinessDelta: number;
}

/**
 * 가게 이용을 마친 손님의 평가. 들어올 때 가격 거절은 wouldRefuse로 이미 걸렀다는 전제다.
 * @param roll 0~1 난수(말풍선 문구 고르기)
 */
export function evaluatePurchase(ctx: MarketContext, shopper: Shopper, b: Building, roll: number): PurchaseOutcome {
  const def = shopDef(b.type);
  const syn = synergyEffects(ctx.buildings, b);
  const ideal = idealTuning(def, shopper.type, ctx.temp, shopper.idealVar);
  const diff = b.tuning - ideal;
  const taste = tasteScore(b.tuning, ideal);
  const price = priceScore(b.price, maxPay(ctx, shopper, def));
  const satisfaction = clamp(0.55 * taste + 0.45 * price + syn.satisfaction, 0, 1);
  const revenue = Math.round((b.price * syn.spend) / 10) * 10;

  let reason: FeedbackReason;
  let text: string;
  let mood: Mood;
  const tasteIssue = Math.abs(diff) >= 1.5;
  if (satisfaction >= PERFECT_THRESHOLD) {
    reason = 'perfect';
    text = def.tuning.perfect[Math.floor(roll * def.tuning.perfect.length) % def.tuning.perfect.length];
    mood = 'happy';
  } else if (price < 0.45 && (!tasteIssue || price < taste)) {
    reason = 'pricey';
    text = '맛있는데 조금 비싸네요';
    mood = 'neutral';
  } else if (tasteIssue) {
    reason = diff > 0 ? 'tooHigh' : 'tooLow';
    text = diff > 0 ? def.tuning.tooHigh : def.tuning.tooLow;
    mood = taste < 0.3 ? 'sad' : 'neutral';
  } else if (price >= 0.95) {
    reason = 'cheap';
    text = '가격이 착해요!';
    mood = 'happy';
  } else {
    reason = 'ok';
    text = roll < 0.5 ? '괜찮네요' : '또 올게요';
    mood = 'neutral';
  }
  return { satisfaction, revenue, reason, text, mood, happinessDelta: (satisfaction - 0.45) * 30 };
}
