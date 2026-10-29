import { describe, expect, it } from 'vitest';
import { shopDef } from '../src/sim/data.ts';
import {
  REFUSE_RATIO,
  evaluatePurchase,
  idealTuning,
  maxPay,
  priceScore,
  tasteScore,
  visitProbability,
  wouldRefuse,
  type MarketContext,
  type Shopper,
} from '../src/sim/economy.ts';
import type { Building } from '../src/sim/street.ts';
import { demandMod, forecastNotes, rollWeather, seasonOf, isFestivalDay } from '../src/sim/weather.ts';
import { Rng } from '../src/sim/rng.ts';

const shopper = (over: Partial<Shopper> = {}): Shopper => ({
  type: 'salaryman',
  purchases: 0,
  umbrella: false,
  fan: false,
  budgetVar: 1,
  idealVar: 0,
  ...over,
});
const ramen = (over: Partial<Building> = {}): Building => ({ uid: 1, type: 'ramen', x: 3, tuning: 7, price: 800, rating: 0.5, ...over });
const ctx = (over: Partial<MarketContext> = {}): MarketContext => ({
  season: 'spring',
  weather: 'clear',
  temp: 15,
  festival: false,
  buildings: [],
  ...over,
});

describe('날씨와 계절', () => {
  it('비 오는 날 라멘 수요 배율은 유동인구 감소를 메우고도 남는다', () => {
    // 설계서의 "매출 200%"는 매출 기준이라, 줄어든 유동인구만큼 수요 배율은 2보다 커야 한다
    expect(demandMod('spring', 'rain', 'ramen') / demandMod('spring', 'clear', 'ramen')).toBeGreaterThan(2);
  });

  it('여름 폭염엔 빙수가 겨울보다 훨씬 잘 팔린다', () => {
    expect(demandMod('summer', 'heatwave', 'kakigori')).toBeGreaterThan(demandMod('winter', 'snow', 'kakigori') * 10);
  });

  it('계절은 4일마다 바뀌고 3일째가 축제다', () => {
    expect([1, 4, 5, 8, 9, 13, 17].map(seasonOf)).toEqual(['spring', 'spring', 'summer', 'summer', 'autumn', 'winter', 'spring']);
    expect(isFestivalDay(3)).toBe(true);
    expect(isFestivalDay(7)).toBe(true);
    expect(isFestivalDay(4)).toBe(false);
  });

  it('눈은 겨울에만, 폭염은 여름에만 온다', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 300; i++) {
      expect(rollWeather(rng, 'spring').weather).not.toMatch(/snow|heatwave/);
      expect(rollWeather(rng, 'winter').weather).not.toBe('heatwave');
    }
  });

  it('예보 요약은 큰 변화부터 보여 준다', () => {
    const notes = forecastNotes('summer', 'heatwave', false);
    expect(notes[0]).toContain('빙수');
    expect(notes.length).toBeLessThanOrEqual(5);
  });
});

describe('방문 확률', () => {
  it('비 오는 날 라멘집 방문 확률이 맑은 날보다 높다', () => {
    const clear = visitProbability(ctx(), shopper(), ramen(), 0);
    const rain = visitProbability(ctx({ weather: 'rain' }), shopper({ umbrella: true }), ramen(), 0);
    expect(rain).toBeGreaterThan(clear * 1.8);
  });

  it('향기 세기 1이면 방문 확률이 40% 오른다', () => {
    const base = visitProbability(ctx(), shopper(), ramen(), 0);
    expect(visitProbability(ctx(), shopper(), ramen(), 1)).toBeCloseTo(base * 1.4);
  });

  it('이미 산 게 많을수록 덜 들른다', () => {
    const first = visitProbability(ctx(), shopper(), ramen(), 0);
    expect(visitProbability(ctx(), shopper({ purchases: 1 }), ramen(), 0)).toBeLessThan(first);
    expect(visitProbability(ctx(), shopper({ purchases: 2 }), ramen(), 0)).toBeLessThan(first * 0.3);
  });

  it('확률은 0.85를 넘지 않는다', () => {
    const p = visitProbability(ctx({ season: 'winter', weather: 'snow' }), shopper({ fan: true }), ramen({ rating: 1 }), 1);
    expect(p).toBeLessThanOrEqual(0.85);
  });
});

describe('가격과 맛', () => {
  it('가격 점수: 지불 의향 75% 이하 1, 100%에서 0.6, 거절선에서 0', () => {
    expect(priceScore(75, 100)).toBe(1);
    expect(priceScore(100, 100)).toBeCloseTo(0.6);
    expect(priceScore(100 * REFUSE_RATIO, 100)).toBeCloseTo(0);
  });

  it('학생은 직장인보다 같은 가격을 비싸게 느낀다', () => {
    const def = shopDef('ramen');
    expect(maxPay(ctx(), shopper({ type: 'student' }), def)).toBeLessThan(maxPay(ctx(), shopper(), def));
  });

  it('지불 의향의 1.35배를 넘으면 사지 않고 돌아선다', () => {
    const pay = maxPay(ctx(), shopper({ type: 'student' }), shopDef('ramen'));
    expect(wouldRefuse(ctx(), shopper({ type: 'student' }), ramen({ price: Math.ceil(pay * REFUSE_RATIO) + 50 }))).toBe(true);
    expect(wouldRefuse(ctx(), shopper({ type: 'student' }), ramen({ price: Math.floor(pay) }))).toBe(false);
  });

  it('추울수록 자판기 선호 온도가 따뜻한 쪽으로 간다', () => {
    const def = shopDef('vending');
    expect(idealTuning(def, 'student', 33, 0)).toBeLessThan(1);
    expect(idealTuning(def, 'student', 0, 0)).toBeGreaterThan(9);
  });

  it('맛 점수는 선호와 4 차이에서 0이 된다', () => {
    expect(tasteScore(5, 5)).toBe(1);
    expect(tasteScore(7, 5)).toBeCloseTo(0.5);
    expect(tasteScore(10, 5)).toBe(0);
  });
});

describe('구매 평가와 말풍선', () => {
  it('딱 맞는 맛과 싼 가격이면 완벽 반응', () => {
    const out = evaluatePurchase(ctx(), shopper(), ramen({ tuning: 7, price: 500 }), 0);
    expect(out.reason).toBe('perfect');
    expect(out.mood).toBe('happy');
    expect(out.revenue).toBe(500);
  });

  it('국물이 너무 진하면 짜다고 말한다', () => {
    const out = evaluatePurchase(ctx(), shopper({ type: 'elder' }), ramen({ tuning: 10, price: 500 }), 0);
    expect(out.reason).toBe('tooHigh');
    expect(out.text).toBe(shopDef('ramen').tuning.tooHigh);
  });

  it('국물이 싱거우면 싱겁다고 말한다', () => {
    const out = evaluatePurchase(ctx(), shopper(), ramen({ tuning: 2, price: 500 }), 0);
    expect(out.reason).toBe('tooLow');
  });

  it('맛은 맞는데 비싸면 비싸다고 말한다', () => {
    const out = evaluatePurchase(ctx(), shopper(), ramen({ tuning: 7, price: 1150 }), 0);
    expect(out.reason).toBe('pricey');
  });

  it('책과 차 시너지는 객단가를 25% 올린다', () => {
    const book: Building = { uid: 1, type: 'bookstore', x: 3, tuning: 5, price: 600, rating: 0.5 };
    const tea: Building = { uid: 2, type: 'teahouse', x: 5, tuning: 3, price: 500, rating: 0.5 };
    const out = evaluatePurchase(ctx({ buildings: [book, tea] }), shopper(), tea, 0);
    expect(out.revenue).toBe(630); // 500 × 1.25를 10엔 단위로 반올림
  });
});
