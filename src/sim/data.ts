/**
 * 정적 정의와 밸런스 상수.
 * 수치는 전부 플레이테스트로 조정할 대상이며, 로직 코드는 여기 숫자를 직접 들고 있지 않는다.
 */

// ---------------------------------------------------------------- 골목·시간

export const STREET_TILES = 16;
export const TILE_PX = 24;
export const STREET_PX = STREET_TILES * TILE_PX;
/** 건물이 서는 지면(보도 시작) y 좌표. 렌더러와 이펙트가 공유한다. */
export const GROUND_Y = 168;
/** 새 게임에서 처음 열려 있는 타일 범위(양끝 포함) */
export const INITIAL_UNLOCKED = { from: 3, to: 12 } as const;
export const START_MONEY = 13_000;
export const START_POPULARITY = 40;
export const START_HAPPINESS = 60;
export const UNLOCK_BASE_COST = 6_000;
export const UNLOCK_COST_GROWTH = 1.45;
export const DEMOLISH_REFUND = 0.5;

export const PREP_TIME = 9 * 60;
export const OPEN_TIME = 10 * 60;
export const CLOSE_TIME = 20 * 60;
export const EVENING_TIME = 17 * 60;
/** 폐점 후 남은 손님을 기다리는 최대 시간(분) */
export const CLOSING_GRACE_MIN = 45;
export const MID_DAY_CAT_TIME = 13 * 60;
export const DAYS_PER_SEASON = 4;
/** 계절마다 이 날이 축제일(1부터) */
export const FESTIVAL_DAY_IN_SEASON = 3;
export const MAX_PEDESTRIANS = 45;
/** 1배속에서 실시간 1초당 흐르는 게임 분. 10:00~20:00 영업일이 약 2분. */
export const GAME_MIN_PER_SEC = 5;

// ---------------------------------------------------------------- 계절·날씨·주민

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type SeasonId = (typeof SEASONS)[number];

export const WEATHERS = ['clear', 'cloudy', 'rain', 'snow', 'heatwave'] as const;
export type WeatherId = (typeof WEATHERS)[number];

export const RESIDENTS = ['student', 'salaryman', 'elder', 'tourist'] as const;
export type ResidentType = (typeof RESIDENTS)[number];

export const SHOP_IDS = ['ramen', 'bakery', 'teahouse', 'bookstore', 'taiyaki', 'kakigori', 'vending'] as const;
export type ShopId = (typeof SHOP_IDS)[number];

export const PROP_IDS = ['bench', 'lantern', 'feeder', 'catTower'] as const;
export type PropId = (typeof PROP_IDS)[number];

export type BuildingType = ShopId | PropId;
export const BUILDING_TYPES: readonly BuildingType[] = [...SHOP_IDS, ...PROP_IDS];

export interface FestivalDef {
  name: string;
  emoji: string;
  desc: string;
  traffic: number;
  /** 18시 이후 추가 배율 */
  eveningTraffic: number;
  residentMod: Partial<Record<ResidentType, number>>;
  lanternMul: number;
}

export interface SeasonDef {
  name: string;
  emoji: string;
  baseTemp: number;
  weather: Partial<Record<WeatherId, number>>;
  residentMod: Partial<Record<ResidentType, number>>;
  demand: Partial<Record<ShopId, number>>;
  lanternMul: number;
  festival: FestivalDef;
  arrival: string;
}

export const SEASON_INFO: Record<SeasonId, SeasonDef> = {
  spring: {
    name: '봄',
    emoji: '🌸',
    baseTemp: 15,
    weather: { clear: 0.55, cloudy: 0.25, rain: 0.2 },
    residentMod: { tourist: 2.0 },
    demand: { teahouse: 1.3, bakery: 1.2, kakigori: 0.6, ramen: 0.9 },
    lanternMul: 1,
    festival: {
      name: '벚꽃 축제',
      emoji: '🌸',
      desc: '꽃구경 온 관광객이 몰려와요',
      traffic: 1.3,
      eveningTraffic: 1,
      residentMod: { tourist: 1.5 },
      lanternMul: 1,
    },
    arrival: '벚꽃이 피었어요. 관광객이 늘고 찻집과 베이커리가 인기예요.',
  },
  summer: {
    name: '여름',
    emoji: '🌻',
    baseTemp: 28,
    weather: { clear: 0.45, heatwave: 0.25, rain: 0.25, cloudy: 0.05 },
    residentMod: { student: 1.4, elder: 0.8 },
    demand: { kakigori: 2.2, vending: 1.4, ramen: 0.75, taiyaki: 0.6, teahouse: 0.85 },
    lanternMul: 1,
    festival: {
      name: '불꽃놀이',
      emoji: '🎆',
      desc: '저녁 손님이 크게 늘어요',
      traffic: 1.1,
      eveningTraffic: 1.7,
      residentMod: { student: 1.3 },
      lanternMul: 1.3,
    },
    arrival: '여름이에요. 빙수와 시원한 음료를 찾는 손님이 늘어요.',
  },
  autumn: {
    name: '가을',
    emoji: '🍁',
    baseTemp: 16,
    weather: { clear: 0.55, cloudy: 0.3, rain: 0.15 },
    residentMod: { elder: 1.6 },
    demand: { bookstore: 1.5, taiyaki: 1.5, teahouse: 1.1, kakigori: 0.5 },
    lanternMul: 1,
    festival: {
      name: '단풍 축제',
      emoji: '🍁',
      desc: '산책 나온 어르신이 많아요',
      traffic: 1.25,
      eveningTraffic: 1,
      residentMod: { elder: 1.3 },
      lanternMul: 1,
    },
    arrival: '낙엽 지는 가을이에요. 어르신 발길이 늘고 헌책방과 붕어빵이 잘 팔려요.',
  },
  winter: {
    name: '겨울',
    emoji: '❄️',
    baseTemp: 3,
    weather: { clear: 0.4, cloudy: 0.25, snow: 0.35 },
    residentMod: { salaryman: 1.2, tourist: 0.8 },
    demand: { ramen: 1.6, taiyaki: 1.6, teahouse: 1.3, kakigori: 0.2, vending: 1.1 },
    lanternMul: 2,
    festival: {
      name: '일루미네이션',
      emoji: '✨',
      desc: '등롱 효과가 더 커져요',
      traffic: 1.2,
      eveningTraffic: 1.2,
      residentMod: {},
      lanternMul: 1.5,
    },
    arrival: '겨울이에요. 따뜻한 라멘과 붕어빵이 인기고, 등롱 효과가 2배예요.',
  },
};

export interface WeatherDef {
  name: string;
  emoji: string;
  tempOffset: number;
  traffic: number;
  residentMod: Partial<Record<ResidentType, number>>;
  demand: Partial<Record<ShopId, number>>;
  umbrella: boolean;
  /** 이 날씨에 골목에 들어서는 주민의 기본 기분 */
  happiness: number;
}

export const WEATHER_INFO: Record<WeatherId, WeatherDef> = {
  clear: { name: '맑음', emoji: '☀️', tempOffset: 1, traffic: 1, residentMod: {}, demand: {}, umbrella: false, happiness: 62 },
  cloudy: { name: '흐림', emoji: '☁️', tempOffset: -1, traffic: 0.95, residentMod: {}, demand: {}, umbrella: false, happiness: 58 },
  rain: {
    name: '비',
    emoji: '☔',
    tempOffset: -3,
    traffic: 0.85,
    residentMod: { elder: 0.7, tourist: 0.6, student: 0.9 },
    demand: { ramen: 2.6, teahouse: 1.4, bookstore: 1.4, bakery: 1.1, taiyaki: 1.1, kakigori: 0.4 },
    umbrella: true,
    happiness: 54,
  },
  snow: {
    name: '눈',
    emoji: '🌨️',
    tempOffset: -4,
    traffic: 0.75,
    residentMod: { elder: 0.6 },
    demand: { ramen: 2.2, taiyaki: 1.8, teahouse: 1.5, kakigori: 0.2 },
    umbrella: true,
    happiness: 58,
  },
  heatwave: {
    name: '폭염',
    emoji: '🥵',
    tempOffset: 7,
    traffic: 0.85,
    residentMod: { elder: 0.4, tourist: 0.8 },
    demand: { kakigori: 2.0, vending: 1.8, ramen: 0.5, taiyaki: 0.5, teahouse: 0.7 },
    umbrella: false,
    happiness: 52,
  },
};

export interface ResidentDef {
  name: string;
  icon: string;
  /** 유입 기본 비중 */
  base: number;
  /** 10시~19시 시간대별 유입 배율(인덱스 0 = 10시) */
  hours: readonly number[];
  /** 걷는 속도(px/게임분) 범위 */
  speed: readonly [number, number];
  /** 적정가 대비 지불 의향 */
  budget: number;
  affinity: Record<ShopId, number>;
  petCat: number;
  benchRest: number;
}

export const RESIDENT_INFO: Record<ResidentType, ResidentDef> = {
  student: {
    name: '학생',
    icon: '🎒',
    base: 0.3,
    hours: [0.2, 0.2, 0.3, 0.3, 0.4, 1.6, 1.8, 1.6, 1.0, 0.5],
    speed: [6.5, 8],
    budget: 0.8,
    affinity: { ramen: 1.0, bakery: 0.9, teahouse: 0.5, bookstore: 0.7, taiyaki: 1.3, kakigori: 1.4, vending: 1.2 },
    petCat: 0.7,
    benchRest: 0.15,
  },
  salaryman: {
    name: '직장인',
    icon: '💼',
    base: 0.3,
    hours: [0.3, 0.5, 1.8, 1.4, 0.4, 0.4, 0.5, 0.9, 1.7, 1.5],
    speed: [7, 8.5],
    budget: 1.15,
    affinity: { ramen: 1.5, bakery: 0.7, teahouse: 0.6, bookstore: 0.4, taiyaki: 0.5, kakigori: 0.4, vending: 1.1 },
    petCat: 0.3,
    benchRest: 0.1,
  },
  elder: {
    name: '어르신',
    icon: '🧓',
    base: 0.25,
    hours: [1.5, 1.5, 1.2, 1.0, 0.9, 0.7, 0.5, 0.3, 0.2, 0.1],
    speed: [4, 5.5],
    budget: 0.95,
    affinity: { ramen: 0.6, bakery: 0.8, teahouse: 1.5, bookstore: 1.3, taiyaki: 1.0, kakigori: 0.3, vending: 0.5 },
    petCat: 0.8,
    benchRest: 0.55,
  },
  tourist: {
    name: '관광객',
    icon: '📷',
    base: 0.15,
    hours: [0.5, 1.0, 1.2, 1.3, 1.3, 1.2, 1.0, 0.8, 0.7, 0.6],
    speed: [5, 6.5],
    budget: 1.3,
    affinity: { ramen: 1.1, bakery: 1.2, teahouse: 1.2, bookstore: 0.7, taiyaki: 1.1, kakigori: 1.1, vending: 0.7 },
    petCat: 0.9,
    benchRest: 0.3,
  },
};

// ---------------------------------------------------------------- 건물

export interface TuningDef {
  label: string;
  low: string;
  high: string;
  /** 주민 유형별 선호값(0~10) */
  ideal: Record<ResidentType, number>;
  /** 기온 15°C에서 10°C 내려갈 때마다 선호값이 올라가는 정도 */
  tempSensitivity: number;
  /** 슬라이더가 선호보다 낮을 때 손님 말 */
  tooLow: string;
  tooHigh: string;
  perfect: readonly string[];
}

export interface AromaDef {
  radius: number;
  strength: number;
  label: string;
  color: string;
}

export interface ShopDef {
  kind: 'shop';
  id: ShopId;
  name: string;
  icon: string;
  width: number;
  cost: number;
  price: { base: number; ref: number; min: number; max: number; step: number };
  tuning: TuningDef;
  aroma?: AromaDef;
  /** 손님이 안으로 들어가면 보이지 않는다 */
  indoor: boolean;
  /** 비·눈 오는 날 우산 쓴 손님도 망설이지 않는 곳 */
  shelter: boolean;
  serviceMin: number;
  capacity: number;
  desc: string;
}

export interface PropDef {
  kind: 'prop';
  id: PropId;
  name: string;
  icon: string;
  width: 1;
  cost: number;
  capacity: number;
  desc: string;
}

export type BuildingDef = ShopDef | PropDef;

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  ramen: {
    kind: 'shop',
    id: 'ramen',
    name: '라멘 노점',
    icon: '🍜',
    width: 2,
    cost: 9_000,
    price: { base: 800, ref: 800, min: 400, max: 1_600, step: 50 },
    tuning: {
      label: '국물 진하기',
      low: '담백',
      high: '진한',
      ideal: { student: 6, salaryman: 7, elder: 3, tourist: 5 },
      tempSensitivity: 1,
      tooLow: '국물이 좀 싱거워요',
      tooHigh: '국물이 너무 짜요',
      perfect: ['국물이 딱 좋아요!', '면발 최고예요!', '속이 든든해요'],
    },
    aroma: { radius: 2, strength: 0.8, label: '진한 육수 냄새', color: '#f3c58a' },
    indoor: false,
    shelter: true,
    serviceMin: 14,
    capacity: 4,
    desc: '처마 밑 따끈한 라멘. 비·눈 오는 날 손님이 몰려요.',
  },
  bakery: {
    kind: 'shop',
    id: 'bakery',
    name: '베이커리',
    icon: '🥐',
    width: 2,
    cost: 12_000,
    price: { base: 350, ref: 350, min: 150, max: 800, step: 10 },
    tuning: {
      label: '굽기',
      low: '촉촉',
      high: '바삭',
      ideal: { student: 4, salaryman: 6, elder: 3, tourist: 7 },
      tempSensitivity: 0,
      tooLow: '좀 더 바삭했으면 해요',
      tooHigh: '빵이 너무 딱딱해요',
      perfect: ['갓 구운 크루아상 최고!', '빵 냄새에 못 참았어요', '겉바속촉이에요'],
    },
    aroma: { radius: 3, strength: 1, label: '갓 구운 빵 냄새', color: '#ffd9a0' },
    indoor: true,
    shelter: true,
    serviceMin: 8,
    capacity: 5,
    desc: '빵 냄새가 3칸까지 퍼져 지나가던 사람을 붙잡아요.',
  },
  teahouse: {
    kind: 'shop',
    id: 'teahouse',
    name: '찻집',
    icon: '🍵',
    width: 2,
    cost: 10_000,
    price: { base: 500, ref: 500, min: 200, max: 1_200, step: 10 },
    tuning: {
      label: '단맛',
      low: '쌉싸름',
      high: '달콤',
      ideal: { student: 8, salaryman: 3, elder: 2, tourist: 6 },
      tempSensitivity: 0,
      tooLow: '차가 너무 써요',
      tooHigh: '차가 너무 달아요',
      perfect: ['마음이 차분해져요', '말차 향이 은은해요', '오래 앉아 있고 싶어요'],
    },
    indoor: true,
    shelter: true,
    serviceMin: 30,
    capacity: 6,
    desc: '조용히 오래 머무는 곳. 헌책방 옆이면 체류 시간이 2배.',
  },
  bookstore: {
    kind: 'shop',
    id: 'bookstore',
    name: '헌책방',
    icon: '📚',
    width: 2,
    cost: 9_000,
    price: { base: 600, ref: 600, min: 200, max: 1_500, step: 10 },
    tuning: {
      label: '진열',
      low: '만화책',
      high: '문학 고서',
      ideal: { student: 2, salaryman: 5, elder: 9, tourist: 6 },
      tempSensitivity: 0,
      tooLow: '만화책뿐이네요',
      tooHigh: '어려운 책뿐이에요',
      perfect: ['보물 같은 책을 찾았어요!', '시간 가는 줄 몰랐어요', '찾던 책이 있어요'],
    },
    indoor: true,
    shelter: true,
    serviceMin: 22,
    capacity: 5,
    desc: '가을과 비 오는 날에 강해요. 라멘 냄새가 배는 건 싫어해요.',
  },
  taiyaki: {
    kind: 'shop',
    id: 'taiyaki',
    name: '붕어빵 가판대',
    icon: '🐟',
    width: 1,
    cost: 4_500,
    price: { base: 200, ref: 200, min: 100, max: 500, step: 10 },
    tuning: {
      label: '팥 양',
      low: '조금',
      high: '듬뿍',
      ideal: { student: 8, salaryman: 5, elder: 6, tourist: 7 },
      tempSensitivity: 0,
      tooLow: '팥이 너무 적어요',
      tooHigh: '팥이 너무 많아요',
      perfect: ['꼬리까지 팥이 가득!', '따끈따끈해요', '하나 더 살까 봐요'],
    },
    aroma: { radius: 2, strength: 0.7, label: '고소한 붕어빵 냄새', color: '#e9b46b' },
    indoor: false,
    shelter: false,
    serviceMin: 5,
    capacity: 3,
    desc: '작고 저렴한 간식. 가을·겨울에 불티나게 팔려요.',
  },
  kakigori: {
    kind: 'shop',
    id: 'kakigori',
    name: '빙수 가판대',
    icon: '🍧',
    width: 1,
    cost: 5_000,
    price: { base: 400, ref: 400, min: 200, max: 900, step: 10 },
    tuning: {
      label: '시럽',
      low: '연하게',
      high: '듬뿍',
      ideal: { student: 8, salaryman: 4, elder: 3, tourist: 6 },
      tempSensitivity: 0,
      tooLow: '시럽이 부족해요',
      tooHigh: '빙수가 너무 달아요',
      perfect: ['머리가 띵할 만큼 시원해요!', '여름엔 역시 빙수죠', '더위가 싹 가셨어요'],
    },
    indoor: false,
    shelter: false,
    serviceMin: 6,
    capacity: 3,
    desc: '여름과 폭염의 왕. 겨울엔 거의 안 팔려요.',
  },
  vending: {
    kind: 'shop',
    id: 'vending',
    name: '자판기',
    icon: '🥤',
    width: 1,
    cost: 3_000,
    price: { base: 150, ref: 150, min: 80, max: 400, step: 10 },
    tuning: {
      label: '음료 온도',
      low: '차갑게',
      high: '따뜻하게',
      ideal: { student: 5, salaryman: 5, elder: 6, tourist: 5 },
      tempSensitivity: 3.5,
      tooLow: '따뜻한 음료가 마시고 싶어요',
      tooHigh: '시원한 게 마시고 싶어요',
      perfect: ['딱 마시고 싶던 거예요!', '목이 풀려요', '자판기 최고!'],
    },
    indoor: false,
    shelter: false,
    serviceMin: 2,
    capacity: 2,
    desc: '날씨에 맞춰 차갑게/따뜻하게 바꿔 주세요.',
  },
  bench: {
    kind: 'prop',
    id: 'bench',
    name: '벤치',
    icon: '🪑',
    width: 1,
    cost: 1_200,
    capacity: 2,
    desc: '어르신과 산책객이 쉬어 가요. 간식 가게 옆이면 방문 +20%.',
  },
  lantern: {
    kind: 'prop',
    id: 'lantern',
    name: '등롱',
    icon: '🏮',
    width: 1,
    cost: 3_000,
    capacity: 0,
    desc: '17시 이후 손님이 늘고 지나가는 사람 기분이 좋아져요. 겨울엔 2배.',
  },
  feeder: {
    kind: 'prop',
    id: 'feeder',
    name: '고양이 급식소',
    icon: '🥫',
    width: 1,
    cost: 2_000,
    capacity: 0,
    desc: '길고양이가 찾아와요. 급식소 하나에 2마리까지.',
  },
  catTower: {
    kind: 'prop',
    id: 'catTower',
    name: '캣타워',
    icon: '🐾',
    width: 1,
    cost: 6_000,
    capacity: 0,
    desc: '고양이 정착 확률이 오르고, 특별한 고양이를 부를지도 몰라요.',
  },
};

export function shopDef(type: BuildingType): ShopDef {
  const def = BUILDINGS[type];
  if (def.kind !== 'shop') throw new Error(`${type}은(는) 가게가 아니에요`);
  return def;
}

export function isShopType(type: BuildingType): type is ShopId {
  return BUILDINGS[type].kind === 'shop';
}

// ---------------------------------------------------------------- 시너지

export interface SynergyDef {
  id: string;
  name: string;
  a: BuildingType;
  b: BuildingType;
  /** 효과를 받는 쪽 */
  targets: 'both' | 'a' | 'b';
  visit?: number;
  spend?: number;
  dwell?: number;
  satisfaction?: number;
  negative?: boolean;
  desc: string;
}

export const SYNERGIES: readonly SynergyDef[] = [
  { id: 'bookTea', name: '책과 차', a: 'bookstore', b: 'teahouse', targets: 'both', visit: 1.15, dwell: 2, spend: 1.25, satisfaction: 0.08, desc: '체류 2배 · 객단가 +25%' },
  { id: 'breadTea', name: '빵과 차', a: 'bakery', b: 'teahouse', targets: 'both', visit: 1.2, satisfaction: 0.05, desc: '방문 +20%' },
  { id: 'benchTaiyaki', name: '벤치 간식', a: 'bench', b: 'taiyaki', targets: 'b', visit: 1.2, desc: '붕어빵 방문 +20%' },
  { id: 'benchKakigori', name: '벤치 빙수', a: 'bench', b: 'kakigori', targets: 'b', visit: 1.2, desc: '빙수 방문 +20%' },
  { id: 'benchVending', name: '벤치 한 모금', a: 'bench', b: 'vending', targets: 'b', visit: 1.2, desc: '자판기 방문 +20%' },
  { id: 'ramenTeaClash', name: '냄새 충돌', a: 'ramen', b: 'teahouse', targets: 'b', satisfaction: -0.12, negative: true, desc: '찻집 만족도 −12%' },
  { id: 'ramenBookClash', name: '냄새 배임', a: 'ramen', b: 'bookstore', targets: 'b', satisfaction: -0.1, negative: true, desc: '헌책방 만족도 −10%' },
];

// ---------------------------------------------------------------- 고양이

export const CAT_BREEDS = ['calico', 'tuxedo', 'orange', 'grey', 'black'] as const;
export type CatBreed = (typeof CAT_BREEDS)[number];
export const CAT_BREED_NAMES: Record<CatBreed, string> = {
  calico: '삼색이',
  tuxedo: '턱시도',
  orange: '치즈태비',
  grey: '고등어',
  black: '까망이',
};

export const CAT_PERSONALITIES = ['friendly', 'shy', 'foodie', 'wanderer'] as const;
export type CatPersonality = (typeof CAT_PERSONALITIES)[number];
export const CAT_PERSONALITY_INFO: Record<CatPersonality, { name: string; pet: number; roam: number; speed: number }> = {
  friendly: { name: '개냥이', pet: 1.5, roam: 30, speed: 3.5 },
  shy: { name: '새침데기', pet: 0.5, roam: 20, speed: 3 },
  foodie: { name: '먹보', pet: 1, roam: 12, speed: 2.5 },
  wanderer: { name: '산책냥', pet: 0.9, roam: 70, speed: 4.5 },
};

export const CAT_NAMES = ['모찌', '유자', '단팥', '호두', '콩떡', '보리', '두부', '깨비', '솜이', '라떼', '감자', '쿠키', '나비', '망고', '별이', '누룽지'] as const;
export const LEGENDARY_CAT = { name: '스즈', breed: 'calico' as CatBreed, title: '방울 삼색이' };
export const CAT_ARRIVAL_BASE = 0.45;
export const CAT_ARRIVAL_PER_TOWER = 0.15;
export const LEGENDARY_CHANCE = 0.4;
export const LEGENDARY_MIN_CATS = 3;
export const LEGENDARY_MIN_HAPPINESS = 70;

// ---------------------------------------------------------------- 목표

export const GOAL_IDS = ['firstCustomer', 'revenue50k', 'happy75', 'synergy3', 'cats3', 'mascot', 'fourSeasons', 'fullStreet'] as const;
export type GoalId = (typeof GOAL_IDS)[number];
export const GOALS: Record<GoalId, { name: string; desc: string }> = {
  firstCustomer: { name: '첫 손님', desc: '첫 손님을 맞이하세요' },
  revenue50k: { name: '번창하는 골목', desc: '하루 매출 ¥50,000 달성' },
  happy75: { name: '행복한 골목', desc: '하루 평균 행복도 75 이상' },
  synergy3: { name: '골목 설계자', desc: '좋은 시너지 3종을 동시에 발동' },
  cats3: { name: '고양이 골목', desc: '길고양이 3마리 정착' },
  mascot: { name: '골목 마스코트', desc: '방울 삼색이 스즈를 맞이하세요' },
  fourSeasons: { name: '사계절', desc: '봄부터 겨울까지 1년(16일)을 보내세요' },
  fullStreet: { name: '골목 완성', desc: '모든 공터를 확장하세요' },
};
