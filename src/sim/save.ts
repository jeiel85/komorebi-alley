import {
  BUILDINGS,
  BUILDING_TYPES,
  CAT_BREEDS,
  CAT_PERSONALITIES,
  GOAL_IDS,
  STREET_TILES,
  WEATHERS,
  type BuildingType,
  type GoalId,
} from './data.ts';
import type { Cat } from './cats.ts';
import type { SaveState } from './game.ts';
import { checkPlacement, type Building } from './street.ts';
import type { DayWeather } from './weather.ts';

export const SAVE_FORMAT = 'komorebi-alley-save';
export const SAVE_VERSION = 1;

export class SaveError extends Error {}

export function serializeSave(s: SaveState): string {
  return JSON.stringify({ format: SAVE_FORMAT, version: SAVE_VERSION, savedAt: new Date().toISOString(), state: s }, null, 2);
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown, name: string, min: number, max: number, integer = false): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) {
    throw new SaveError(`${name} 값이 올바르지 않아요`);
  }
  return v;
}

function oneOf<T extends string>(v: unknown, name: string, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) throw new SaveError(`${name} 값이 올바르지 않아요`);
  return v as T;
}

function obj(v: unknown, name: string): Obj {
  if (!isObj(v)) throw new SaveError(`${name} 항목이 없어요`);
  return v;
}

function arr(v: unknown, name: string): unknown[] {
  if (!Array.isArray(v)) throw new SaveError(`${name} 목록이 없어요`);
  return v;
}

function weather(v: unknown, name: string): DayWeather {
  const o = obj(v, name);
  return { weather: oneOf(o.weather, `${name}.weather`, WEATHERS), temp: num(o.temp, `${name}.temp`, -40, 60, true) };
}

/** 저장 파일(JSON 문자열)을 검증해 상태로 되돌린다. 하나라도 어긋나면 SaveError. */
export function parseSave(text: string): SaveState {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SaveError('JSON 형식이 아니에요');
  }
  if (!isObj(raw) || raw.format !== SAVE_FORMAT) throw new SaveError('코모레비 앨리 저장 파일이 아니에요');
  if (raw.version !== SAVE_VERSION) throw new SaveError(`지원하지 않는 저장 버전이에요 (${String(raw.version)})`);
  const st = obj(raw.state, 'state');

  const unlockedRaw = arr(st.unlocked, 'unlocked');
  if (unlockedRaw.length !== STREET_TILES || !unlockedRaw.every((u) => typeof u === 'boolean')) throw new SaveError('unlocked 값이 올바르지 않아요');
  const unlocked = unlockedRaw as boolean[];

  const buildings: Building[] = [];
  const uids = new Set<number>();
  for (const [i, entry] of arr(st.buildings, 'buildings').entries()) {
    const o = obj(entry, `buildings[${i}]`);
    const type: BuildingType = oneOf(o.type, `buildings[${i}].type`, BUILDING_TYPES);
    const def = BUILDINGS[type];
    const b: Building = {
      uid: num(o.uid, `buildings[${i}].uid`, 1, Number.MAX_SAFE_INTEGER, true),
      type,
      x: num(o.x, `buildings[${i}].x`, 0, STREET_TILES - 1, true),
      tuning: num(o.tuning, `buildings[${i}].tuning`, 0, 10, true),
      price: def.kind === 'shop' ? num(o.price, `buildings[${i}].price`, def.price.min, def.price.max, true) : num(o.price, `buildings[${i}].price`, 0, 0),
      rating: num(o.rating, `buildings[${i}].rating`, 0, 1),
    };
    if (uids.has(b.uid)) throw new SaveError(`건물 번호 ${b.uid}가 중복돼요`);
    const place = checkPlacement(buildings, unlocked, b.type, b.x);
    if (!place.ok) throw new SaveError(`buildings[${i}] 배치가 올바르지 않아요: ${place.reason}`);
    uids.add(b.uid);
    buildings.push(b);
  }
  buildings.sort((a, b) => a.x - b.x);

  const cats: Cat[] = [];
  const catIds = new Set<number>();
  for (const [i, entry] of arr(st.cats, 'cats').entries()) {
    const o = obj(entry, `cats[${i}]`);
    if (typeof o.name !== 'string' || o.name.length === 0 || o.name.length > 20) throw new SaveError(`cats[${i}].name 값이 올바르지 않아요`);
    if (typeof o.legendary !== 'boolean') throw new SaveError(`cats[${i}].legendary 값이 올바르지 않아요`);
    const cat: Cat = {
      id: num(o.id, `cats[${i}].id`, 1, Number.MAX_SAFE_INTEGER, true),
      name: o.name,
      breed: oneOf(o.breed, `cats[${i}].breed`, CAT_BREEDS),
      personality: oneOf(o.personality, `cats[${i}].personality`, CAT_PERSONALITIES),
      legendary: o.legendary,
      affection: num(o.affection, `cats[${i}].affection`, 0, Number.MAX_SAFE_INTEGER, true),
      arrivedDay: num(o.arrivedDay, `cats[${i}].arrivedDay`, 1, Number.MAX_SAFE_INTEGER, true),
    };
    if (catIds.has(cat.id)) throw new SaveError(`고양이 번호 ${cat.id}가 중복돼요`);
    catIds.add(cat.id);
    cats.push(cat);
  }

  const goals: GoalId[] = [];
  for (const g of arr(st.goals, 'goals')) {
    const id = oneOf(g, 'goals', GOAL_IDS);
    if (!goals.includes(id)) goals.push(id);
  }

  const maxUid = Math.max(0, ...buildings.map((b) => b.uid));
  const maxCatId = Math.max(0, ...cats.map((c) => c.id));
  const state: SaveState = {
    day: num(st.day, 'day', 1, 1_000_000, true),
    money: num(st.money, 'money', 0, Number.MAX_SAFE_INTEGER, true),
    popularity: num(st.popularity, 'popularity', 0, 100),
    lastHappiness: num(st.lastHappiness, 'lastHappiness', 0, 100),
    unlocked,
    buildings,
    nextUid: num(st.nextUid, 'nextUid', maxUid + 1, Number.MAX_SAFE_INTEGER, true),
    cats,
    nextCatId: num(st.nextCatId, 'nextCatId', maxCatId + 1, Number.MAX_SAFE_INTEGER, true),
    today: weather(st.today, 'today'),
    tomorrow: weather(st.tomorrow, 'tomorrow'),
    goals,
    totalRevenue: num(st.totalRevenue, 'totalRevenue', 0, Number.MAX_SAFE_INTEGER, true),
    bestDayRevenue: num(st.bestDayRevenue, 'bestDayRevenue', 0, Number.MAX_SAFE_INTEGER, true),
  };
  return state;
}
