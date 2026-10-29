import {
  BUILDINGS,
  DAYS_PER_SEASON,
  EVENING_TIME,
  FESTIVAL_DAY_IN_SEASON,
  RESIDENTS,
  RESIDENT_INFO,
  SEASONS,
  SEASON_INFO,
  SHOP_IDS,
  WEATHER_INFO,
  type ResidentType,
  type SeasonId,
  type ShopId,
  type WeatherId,
} from './data.ts';
import type { Rng } from './rng.ts';

export interface DayWeather {
  weather: WeatherId;
  temp: number;
}

export function seasonOf(day: number): SeasonId {
  return SEASONS[Math.floor((day - 1) / DAYS_PER_SEASON) % SEASONS.length];
}

/** 계절 안에서 몇 번째 날인지(1부터) */
export function dayInSeason(day: number): number {
  return ((day - 1) % DAYS_PER_SEASON) + 1;
}

export function isFestivalDay(day: number): boolean {
  return dayInSeason(day) === FESTIVAL_DAY_IN_SEASON;
}

export function rollWeather(rng: Rng, season: SeasonId): DayWeather {
  const weather = rng.weighted(SEASON_INFO[season].weather);
  const temp = Math.round(SEASON_INFO[season].baseTemp + WEATHER_INFO[weather].tempOffset + rng.range(-2, 2));
  return { weather, temp };
}

export function demandMod(season: SeasonId, weather: WeatherId, shop: ShopId): number {
  return (SEASON_INFO[season].demand[shop] ?? 1) * (WEATHER_INFO[weather].demand[shop] ?? 1);
}

/** 골목 전체 유동인구 배율 */
export function trafficMod(season: SeasonId, weather: WeatherId, festival: boolean, time: number): number {
  let m = WEATHER_INFO[weather].traffic;
  if (festival) {
    const f = SEASON_INFO[season].festival;
    m *= f.traffic;
    if (time >= 18 * 60) m *= f.eveningTraffic;
  }
  return m;
}

export function residentMod(season: SeasonId, weather: WeatherId, festival: boolean, type: ResidentType): number {
  let m = (SEASON_INFO[season].residentMod[type] ?? 1) * (WEATHER_INFO[weather].residentMod[type] ?? 1);
  if (festival) m *= SEASON_INFO[season].festival.residentMod[type] ?? 1;
  return m;
}

/** 저녁 등롱이 끌어오는 추가 유입 배율 */
export function lanternBoost(lanterns: number, season: SeasonId, festival: boolean, time: number): number {
  if (time < EVENING_TIME || lanterns <= 0) return 1;
  let per = 0.15 * SEASON_INFO[season].lanternMul;
  if (festival) per *= SEASON_INFO[season].festival.lanternMul;
  return 1 + per * Math.min(lanterns, 3);
}

/** 아침 예보 카드에 보여줄 요약(수요·손님 변화 중 큰 것부터) */
export function forecastNotes(season: SeasonId, weather: WeatherId, festival: boolean): string[] {
  const notes: { text: string; weight: number }[] = [];
  for (const shop of SHOP_IDS) {
    const m = demandMod(season, weather, shop);
    if (m >= 1.25 || m <= 0.75) {
      const def = BUILDINGS[shop];
      notes.push({ text: `${def.icon} ${def.name} 수요 ×${m.toFixed(1)}`, weight: Math.abs(Math.log(m)) });
    }
  }
  for (const type of RESIDENTS) {
    const m = residentMod(season, weather, festival, type);
    if (m >= 1.25 || m <= 0.75) {
      const info = RESIDENT_INFO[type];
      notes.push({ text: `${info.icon} ${info.name} ${m > 1 ? '많음' : '적음'} (×${m.toFixed(1)})`, weight: Math.abs(Math.log(m)) });
    }
  }
  return notes
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5)
    .map((n) => n.text);
}
