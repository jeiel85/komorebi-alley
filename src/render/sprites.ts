/**
 * 절차적 픽셀 아트. 외부 이미지 없이 사각형만으로 골목의 건물·사람·고양이를 그린다.
 * 모든 좌표는 월드 픽셀(384×216) 기준이고, 건물은 지면(GROUND_Y)에 발을 딛는다.
 */
import { GROUND_Y, TILE_PX, type BuildingType, type CatBreed, type ResidentType, type SeasonId } from '../sim/data.ts';
import type { CatState } from '../sim/cats.ts';
import type { PedState } from '../sim/game.ts';
import { hash01, mix } from './color.ts';

export type Ctx = CanvasRenderingContext2D;

/** 해가 지면 밝혀질 불빛. r이 있으면 둥근 등불, 없으면 창문 사각형. */
export interface Light {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  r?: number;
}

export interface BuildEnv {
  season: SeasonId;
  snow: boolean;
  open: boolean;
}

const G = GROUND_Y;

export const BUILDING_HEIGHT: Record<BuildingType, number> = {
  ramen: 74,
  bakery: 78,
  teahouse: 72,
  bookstore: 80,
  taiyaki: 44,
  kakigori: 44,
  vending: 40,
  bench: 30,
  lantern: 46,
  feeder: 30,
  catTower: 38,
};

export function px(c: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  c.fillStyle = color;
  c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

export function disc(c: Ctx, cx: number, cy: number, r: number, color: string): void {
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.floor(Math.sqrt(r * r - dy * dy) + 0.3);
    px(c, cx - half, cy + dy, half * 2 + 1, 1, color);
  }
}

export function heart(c: Ctx, x: number, y: number, color = '#ff6b8a'): void {
  px(c, x + 1, y, 1, 1, color);
  px(c, x + 3, y, 1, 1, color);
  px(c, x, y + 1, 5, 1, color);
  px(c, x + 1, y + 2, 3, 1, color);
  px(c, x + 2, y + 3, 1, 1, color);
}

const SEASON_GREEN: Record<SeasonId, [string, string]> = {
  spring: ['#7fb069', '#f4a7bb'],
  summer: ['#4f9a4f', '#6fbf63'],
  autumn: ['#c9873e', '#e0a64a'],
  winter: ['#6f8272', '#8a9a8b'],
};

// ---------------------------------------------------------------- 공통 부품

/** 기와지붕. 윗줄이 좁은 사다리꼴에 기와 줄눈을 넣는다. */
function kawara(c: Ctx, x: number, y: number, w: number, h: number, base: string, dark: string, snow: boolean): void {
  for (let r = 0; r < h; r++) {
    const inset = Math.floor((h - 1 - r) * 0.7);
    px(c, x + inset, y + r, w - inset * 2, 1, r % 3 === 2 ? dark : base);
  }
  const seamTop = Math.ceil(h * 0.35);
  for (let sx = x + 3; sx < x + w - 3; sx += 3) px(c, sx, y + seamTop, 1, h - seamTop - 1, dark);
  const ridge = Math.floor((h - 1) * 0.7);
  px(c, x + ridge, y, w - ridge * 2, 1, mix(base, '#ffffff', 0.25));
  px(c, x, y + h - 1, w, 1, '#2c3240');
  if (snow) {
    px(c, x + ridge - 1, y - 2, w - ridge * 2 + 2, 3, '#f4f8fb');
    for (let r = 0; r < h - 2; r += 2) {
      const inset = Math.floor((h - 1 - r) * 0.7);
      px(c, x + inset, y + r, 2, 1, '#eef3f8');
      px(c, x + w - inset - 2, y + r, 2, 1, '#eef3f8');
    }
    px(c, x + 1, y + h - 2, w - 2, 1, '#e8eef4');
  }
}

function shoji(c: Ctx, x: number, y: number, w: number, h: number, L: Light[]): void {
  px(c, x - 1, y - 1, w + 2, h + 2, '#6b4a35');
  px(c, x, y, w, h, '#f3ead2');
  for (let gx = x + 3; gx < x + w; gx += 4) px(c, gx, y, 1, h, '#c9b48e');
  for (let gy = y + 4; gy < y + h; gy += 4) px(c, x, gy, w, 1, '#c9b48e');
  L.push({ x, y, w, h, color: '#ffd28a' });
}

/** 종이 등(초칭). (x, y)는 매다는 고리 위치. */
function chochin(c: Ctx, x: number, y: number, color: string, L: Light[]): void {
  px(c, x, y - 2, 1, 2, '#3a2a22');
  px(c, x - 2, y, 5, 1, '#2b1f1a');
  px(c, x - 3, y + 1, 7, 6, color);
  px(c, x - 2, y + 7, 5, 1, color);
  px(c, x - 3, y + 3, 7, 1, mix(color, '#000000', 0.2));
  px(c, x - 2, y + 8, 5, 1, '#2b1f1a');
  L.push({ x: x + 0.5, y: y + 4, w: 0, h: 0, color, r: 11 });
}

function shutter(c: Ctx, x: number, y: number, w: number, h: number): void {
  px(c, x, y, w, h, '#a59c8f');
  for (let sy = y + 1; sy < y + h; sy += 2) px(c, x, sy, w, 1, '#8f877b');
}

/** 1칸짜리 가게·소품 뒤를 채우는 블록 담장과 화단 */
export function drawBlockWall(c: Ctx, x0: number, w: number, env: BuildEnv): void {
  const top = G - 26;
  const [leaf, accent] = SEASON_GREEN[env.season];
  for (let i = 0; i < w; i += 5) {
    const r = 3 + Math.floor(hash01(x0 * 13 + i) * 3);
    disc(c, x0 + i + 2, top - 1, r, leaf);
    if (env.season === 'spring' && hash01(x0 + i * 7) > 0.5) px(c, x0 + i + 1, top - 3, 2, 2, accent);
  }
  px(c, x0, top, w, 26, '#cfc8bb');
  for (let row = 0, y = top + 2; y < G; y += 6, row++) {
    px(c, x0, y, w, 1, '#b9b1a3');
    for (let x = x0 + (row % 2 ? 6 : 0); x < x0 + w; x += 12) px(c, x, y, 1, 6, '#b9b1a3');
  }
  px(c, x0, top, w, 2, '#e1dbd0');
  if (env.snow) {
    px(c, x0, top - 2, w, 3, '#f4f8fb');
    for (let i = 0; i < w; i += 5) disc(c, x0 + i + 2, top - 4, 2, '#f4f8fb');
  }
}

/** 아직 확장하지 않은 공터: 나무 울타리와 팻말 */
export function drawLockedLot(c: Ctx, x0: number, w: number, env: BuildEnv): void {
  px(c, x0, G - 3, w, 3, '#a89a7c');
  for (let x = x0 + 1; x < x0 + w - 1; x += 4) {
    const h = 20 + (Math.floor(x / 4) % 2) * 2;
    px(c, x, G - h, 3, h, '#a5865f');
    px(c, x, G - h, 3, 1, '#c09d70');
  }
  px(c, x0, G - 17, w, 2, '#8a6c48');
  px(c, x0, G - 8, w, 2, '#8a6c48');
  for (let i = 0; i < 4; i++) {
    const gx = x0 + Math.floor(hash01(x0 * 31 + i) * (w - 3));
    const col = env.season === 'autumn' ? '#b98a3e' : env.season === 'winter' ? '#9aa79a' : '#6fa35a';
    px(c, gx, G - 3, 1, 3, col);
    px(c, gx + 2, G - 4, 1, 4, col);
  }
  const sx = x0 + Math.floor(w / 2);
  px(c, sx - 1, G - 30, 2, 12, '#7a5a3a');
  px(c, sx - 7, G - 37, 14, 9, '#efe3c2');
  px(c, sx - 7, G - 37, 14, 1, '#d7c69f');
  px(c, sx - 1, G - 35, 2, 5, '#c06a4a');
  px(c, sx - 3, G - 33, 6, 1, '#c06a4a');
  if (env.snow) px(c, x0, G - 23, w, 2, '#f4f8fb');
}

export function drawEmptyLot(c: Ctx, x0: number, w: number, env: BuildEnv): void {
  drawBlockWall(c, x0, w, env);
  px(c, x0 + 2, G - 2, w - 4, 2, '#bdb3a2');
}

// ---------------------------------------------------------------- 가게

function drawRamen(c: Ctx, x0: number, env: BuildEnv, L: Light[]): void {
  const w = 48;
  const top = G - 74;
  px(c, x0 + 2, top + 9, w - 4, 37, '#eadcc2');
  px(c, x0 + 2, top + 9, 2, 37, '#d8c8aa');
  px(c, x0 + w - 4, top + 9, 2, 37, '#d8c8aa');
  shoji(c, x0 + 8, top + 15, 13, 13, L);
  shoji(c, x0 + 27, top + 15, 13, 13, L);
  // 그릇 간판
  px(c, x0 + 12, top + 33, 24, 10, '#4a3226');
  px(c, x0 + 13, top + 34, 22, 8, '#5b3e2e');
  px(c, x0 + 19, top + 37, 10, 3, '#f4ead8');
  px(c, x0 + 20, top + 40, 8, 1, '#f4ead8');
  px(c, x0 + 27, top + 34, 1, 4, '#e7c27d');
  px(c, x0 + 29, top + 34, 1, 4, '#e7c27d');
  kawara(c, x0 - 3, top, w + 6, 10, '#4b5568', '#3c4455', env.snow);
  px(c, x0, top + 46, w, 3, '#5a3b2a');
  px(c, x0 + 2, top + 49, w - 4, 25, '#7a5236');
  if (env.open) {
    px(c, x0 + 5, top + 52, w - 10, 13, '#3a2a22');
    // 요리사 실루엣과 냄비
    px(c, x0 + 30, top + 56, 5, 9, '#efe6d6');
    px(c, x0 + 31, top + 53, 3, 3, '#e0b48a');
    px(c, x0 + 30, top + 52, 5, 1, '#ffffff');
    px(c, x0 + 10, top + 59, 8, 5, '#6b6f78');
    L.push({ x: x0 + 5, y: top + 52, w: w - 10, h: 13, color: '#ffcf86' });
    for (let i = 0; i < 4; i++) {
      const nx = x0 + 6 + i * 9;
      px(c, nx, top + 50, 8, 8, '#c8423b');
      px(c, nx, top + 50, 8, 1, '#a8342e');
    }
    px(c, x0 + 17, top + 53, 3, 2, '#f6efe3');
    px(c, x0 + 26, top + 53, 3, 2, '#f6efe3');
  } else {
    shutter(c, x0 + 5, top + 52, w - 10, 13);
  }
  px(c, x0 + 4, top + 64, w - 8, 3, '#d2ab7e');
  px(c, x0 + 4, top + 67, w - 8, 7, '#8a5d3d');
  px(c, x0 + 4, top + 70, w - 8, 1, '#76503a');
  chochin(c, x0 + w - 3, top + 47, '#e2584b', L);
}

function drawBakery(c: Ctx, x0: number, env: BuildEnv, L: Light[]): void {
  const w = 48;
  const top = G - 70;
  px(c, x0 + 33, top - 8, 7, 9, '#b5715a');
  px(c, x0 + 32, top - 9, 9, 2, '#9c5e4a');
  px(c, x0 + 1, top + 4, w - 2, 66, '#f6d8c9');
  px(c, x0, top, w, 5, '#e9b8a6');
  px(c, x0, top + 4, w, 1, '#d79c88');
  for (const wx of [x0 + 7, x0 + 29]) {
    px(c, wx, top + 9, 12, 14, '#8f5d4f');
    px(c, wx + 1, top + 10, 10, 12, '#fff3dc');
    px(c, wx + 5, top + 10, 1, 12, '#8f5d4f');
    px(c, wx + 1, top + 15, 10, 1, '#8f5d4f');
    L.push({ x: wx + 1, y: top + 10, w: 10, h: 12, color: '#ffd9a0' });
    px(c, wx - 1, top + 23, 14, 2, '#8f5d4f');
    for (let i = 0; i < 6; i++) px(c, wx + i * 2, top + 21, 1, 2, i % 2 ? '#f29bb4' : '#ffd166');
  }
  // 크루아상 간판
  px(c, x0 + 16, top + 27, 16, 9, '#c98a6a');
  px(c, x0 + 17, top + 28, 14, 7, '#fff7ea');
  px(c, x0 + 20, top + 31, 8, 2, '#d99a4e');
  px(c, x0 + 21, top + 30, 6, 1, '#e9b46b');
  px(c, x0 + 19, top + 32, 1, 1, '#d99a4e');
  px(c, x0 + 28, top + 32, 1, 1, '#d99a4e');
  // 줄무늬 차양
  px(c, x0, top + 37, w, 1, '#d67a95');
  for (let i = 0; i < w; i += 4) {
    const col = (i / 4) % 2 ? '#fff4f0' : '#f29bb4';
    px(c, x0 + i, top + 38, 4, 6, col);
    px(c, x0 + i + 1, top + 44, 2, 1, col);
  }
  // 진열창과 문
  px(c, x0 + 4, top + 47, 26, 19, '#8f5d4f');
  px(c, x0 + 5, top + 48, 24, 17, env.open ? '#fff7e6' : '#e9dccb');
  px(c, x0 + 5, top + 56, 24, 1, '#c9a27a');
  px(c, x0 + 5, top + 64, 24, 1, '#c9a27a');
  if (env.open) {
    for (let i = 0; i < 5; i++) {
      px(c, x0 + 6 + i * 5, top + 52, 4, 4, i % 2 ? '#e0a96b' : '#c98a4a');
      px(c, x0 + 7 + i * 5, top + 52, 2, 1, '#f2c98a');
      px(c, x0 + 6 + i * 5, top + 60, 4, 4, i % 2 ? '#c98a4a' : '#d99a4e');
    }
    L.push({ x: x0 + 5, y: top + 48, w: 24, h: 17, color: '#ffe2a8' });
  }
  px(c, x0 + 33, top + 47, 11, 23, '#8f5d4f');
  px(c, x0 + 34, top + 48, 9, 11, env.open ? '#fff3dc' : '#d8c8b8');
  px(c, x0 + 34, top + 59, 9, 11, '#a8705f');
  px(c, x0 + 41, top + 60, 1, 1, '#ffd24a');
  if (env.open) L.push({ x: x0 + 34, y: top + 48, w: 9, h: 11, color: '#ffe2a8' });
  px(c, x0 + 1, G - 3, w - 2, 3, '#d9b3a3');
  if (env.snow) {
    px(c, x0 - 1, top - 2, w + 2, 3, '#f4f8fb');
    px(c, x0, top + 36, w, 2, '#f4f8fb');
    px(c, x0 + 32, top - 11, 9, 2, '#f4f8fb');
  }
}

function drawTeahouse(c: Ctx, x0: number, env: BuildEnv, L: Light[]): void {
  const w = 48;
  const top = G - 72;
  px(c, x0 + 2, top + 9, w - 4, 30, '#efe4cf');
  px(c, x0 + 2, top + 9, 2, 30, '#4a3426');
  px(c, x0 + w - 4, top + 9, 2, 30, '#4a3426');
  px(c, x0 + 2, top + 30, w - 4, 2, '#4a3426');
  // 둥근 창
  disc(c, x0 + 18, top + 19, 7, '#4a3426');
  disc(c, x0 + 18, top + 19, 6, '#f6edd6');
  for (let i = -5; i <= 5; i += 3) px(c, x0 + 18 + i, top + 13, 1, 13, '#c9b48e');
  px(c, x0 + 12, top + 19, 13, 1, '#c9b48e');
  L.push({ x: x0 + 13, y: top + 14, w: 11, h: 11, color: '#ffd28a' });
  // 찻잔 세로 간판
  px(c, x0 + 33, top + 12, 8, 16, '#3b2a20');
  px(c, x0 + 34, top + 13, 6, 14, '#5a4030');
  px(c, x0 + 35, top + 17, 4, 3, '#a7c48a');
  px(c, x0 + 36, top + 20, 2, 1, '#a7c48a');
  px(c, x0 + 36, top + 15, 1, 1, '#f6efe3');
  kawara(c, x0 - 3, top, w + 6, 10, '#3f5a4a', '#334a3c', env.snow);
  kawara(c, x0 - 1, top + 34, w + 2, 6, '#3f5a4a', '#334a3c', env.snow);
  px(c, x0 + 2, top + 40, w - 4, 32, '#5a3d2b');
  // 격자창
  px(c, x0 + 5, top + 45, 16, 18, '#2e211a');
  if (env.open) L.push({ x: x0 + 5, y: top + 45, w: 16, h: 18, color: '#ffcf86' });
  for (let x = x0 + 5; x < x0 + 21; x += 2) px(c, x, top + 45, 1, 18, '#8a6a4c');
  px(c, x0 + 5, top + 53, 16, 1, '#8a6a4c');
  // 입구
  px(c, x0 + 26, top + 44, 17, 28, '#2e211a');
  if (env.open) {
    L.push({ x: x0 + 26, y: top + 52, w: 17, h: 20, color: '#ffcf86' });
    for (let i = 0; i < 3; i++) px(c, x0 + 26 + i * 6, top + 44, 5, 11, '#4f7f5a');
    px(c, x0 + 33, top + 48, 3, 3, '#f6efe3');
  } else {
    shutter(c, x0 + 26, top + 44, 17, 28);
  }
  chochin(c, x0 + 23, top + 43, '#f3ead2', L);
  const [leaf] = SEASON_GREEN[env.season];
  px(c, x0 + 44, G - 6, 3, 6, '#7a5236');
  for (let i = 0; i < 4; i++) px(c, x0 + 43 + (i % 2), G - 18 + i * 3, 3, 3, leaf);
}

const SPINES = ['#c8423b', '#3d6b8f', '#e0b84a', '#5f8a5a', '#8a5a9a', '#d9822b', '#efe3c2', '#2f4a3f'];

function drawBookstore(c: Ctx, x0: number, env: BuildEnv, L: Light[]): void {
  const w = 48;
  const top = G - 80;
  px(c, x0 + 2, top + 9, w - 4, 71, '#9a7a56');
  for (let y = top + 12; y < top + 44; y += 4) px(c, x0 + 2, y, w - 4, 1, '#8a6a48');
  px(c, x0 + 9, top + 14, 30, 15, '#5b4330');
  px(c, x0 + 10, top + 15, 28, 13, '#f1e3c4');
  px(c, x0 + 24, top + 15, 1, 13, '#5b4330');
  px(c, x0 + 10, top + 21, 28, 1, '#5b4330');
  L.push({ x: x0 + 10, y: top + 15, w: 28, h: 13, color: '#ffd59a' });
  // 펼친 책 간판
  px(c, x0 + 6, top + 32, w - 12, 10, '#c9a64a');
  px(c, x0 + 7, top + 33, w - 14, 8, '#2f4a3f');
  px(c, x0 + 18, top + 35, 5, 4, '#f4ead8');
  px(c, x0 + 24, top + 35, 5, 4, '#f4ead8');
  px(c, x0 + 23, top + 35, 1, 4, '#c7b89a');
  kawara(c, x0 - 3, top, w + 6, 10, '#6b4b3a', '#57392b', env.snow);
  px(c, x0 + 2, top + 44, w - 4, 2, '#5b4330');
  px(c, x0 + 4, top + 46, w - 8, 26, '#3a2a20');
  if (env.open) {
    L.push({ x: x0 + 4, y: top + 46, w: w - 8, h: 26, color: '#ffd59a' });
    for (const row of [top + 48, top + 55, top + 62]) {
      for (let x = x0 + 5; x < x0 + w - 5; x++) {
        const h = 4 + Math.floor(hash01(x * 7 + row) * 2);
        px(c, x, row + 5 - h, 1, h, SPINES[Math.floor(hash01(x * 13 + row * 3) * SPINES.length)]);
      }
      px(c, x0 + 4, row + 5, w - 8, 1, '#6b4b3a');
    }
  } else {
    shutter(c, x0 + 4, top + 46, w - 8, 26);
  }
  px(c, x0 + 2, top + 72, w - 4, 8, '#7a5a3e');
  // 가게 앞 책 수레
  for (const cx of [x0 + 3, x0 + 28]) {
    px(c, cx, G - 10, 17, 6, '#8a6a48');
    px(c, cx, G - 10, 17, 1, '#a5865f');
    for (let x = cx + 1; x < cx + 16; x++) px(c, x, G - 14, 1, 4, SPINES[Math.floor(hash01(x * 5) * SPINES.length)]);
    px(c, cx + 1, G - 4, 2, 4, '#5b4330');
    px(c, cx + 14, G - 4, 2, 4, '#5b4330');
  }
}

function drawTaiyaki(c: Ctx, x0: number, env: BuildEnv, L: Light[]): void {
  drawBlockWall(c, x0, TILE_PX, env);
  const top = G - 44;
  px(c, x0 + 1, top, 22, 2, '#a8342e');
  for (let i = 0; i < 21; i += 3) px(c, x0 + 1 + i, top + 2, 3, 5, (i / 3) % 2 ? '#f6efe3' : '#d9534f');
  px(c, x0 + 2, top + 7, 1, 20, '#6b4a35');
  px(c, x0 + 21, top + 7, 1, 20, '#6b4a35');
  // 붕어 간판
  px(c, x0 + 6, top + 9, 12, 8, '#f3e3c0');
  px(c, x0 + 8, top + 11, 6, 4, '#d99a4e');
  px(c, x0 + 14, top + 10, 2, 2, '#d99a4e');
  px(c, x0 + 14, top + 14, 2, 2, '#d99a4e');
  px(c, x0 + 9, top + 12, 1, 1, '#3a2a22');
  // 굽는 판
  px(c, x0 + 4, top + 24, 16, 3, '#3a3a3a');
  if (env.open) {
    for (let i = 0; i < 3; i++) px(c, x0 + 5 + i * 5, top + 24, 4, 2, '#e0a050');
    L.push({ x: x0 + 4, y: top + 21, w: 16, h: 6, color: '#ffbf6b' });
  }
  px(c, x0 + 1, top + 27, 22, 3, '#d2ab7e');
  px(c, x0 + 2, top + 30, 20, 11, '#b98a5a');
  px(c, x0 + 2, top + 35, 20, 1, '#9c7048');
  px(c, x0 + 4, G - 3, 4, 3, '#4a3a2e');
  px(c, x0 + 16, G - 3, 4, 3, '#4a3a2e');
  if (env.snow) px(c, x0 + 1, top - 2, 22, 2, '#f4f8fb');
}

function drawKakigori(c: Ctx, x0: number, env: BuildEnv, L: Light[]): void {
  drawBlockWall(c, x0, TILE_PX, env);
  const top = G - 44;
  for (let row = 0; row <= 10; row++) {
    const half = Math.floor(Math.sqrt(121 - (10 - row) ** 2));
    px(c, x0 + 12 - half, top + row, half * 2 + 1, 1, row % 3 === 0 ? '#ffffff' : '#9fd6e8');
  }
  px(c, x0 + 12, top + 11, 1, 18, '#8a8f99');
  // 얼음 깃발
  px(c, x0 + 2, top + 12, 1, 17, '#6b6f78');
  px(c, x0 + 3, top + 13, 7, 10, '#fbfbf7');
  px(c, x0 + 5, top + 14, 3, 4, '#d9534f');
  px(c, x0 + 3, top + 19, 7, 1, '#3d7bd9');
  px(c, x0 + 3, top + 21, 7, 1, '#3d7bd9');
  px(c, x0 + 2, top + 28, 20, 2, '#e8f4f8');
  px(c, x0 + 3, top + 30, 18, 14, '#7ec4d8');
  px(c, x0 + 3, top + 34, 18, 2, '#ffffff');
  if (env.open) {
    px(c, x0 + 15, top + 24, 4, 4, '#ffffff');
    px(c, x0 + 15, top + 24, 4, 1, '#ff6b8a');
    px(c, x0 + 16, top + 28, 2, 1, '#c9e8f0');
    L.push({ x: x0 + 3, y: top + 30, w: 18, h: 4, color: '#dff6ff' });
  }
}

const BOTTLES_COLD = ['#4fb3bf', '#7ad1a8', '#f2c14e', '#e76f51'];
const BOTTLES_HOT = ['#8a5a3a', '#c8423b', '#d9a066', '#6b4a35'];

function drawVending(c: Ctx, x0: number, env: BuildEnv, L: Light[], tuning: number): void {
  drawBlockWall(c, x0, TILE_PX, env);
  const top = G - 40;
  px(c, x0 + 4, top, 16, 40, '#2f6fb0');
  px(c, x0 + 5, top + 1, 14, 38, '#e9eef2');
  px(c, x0 + 6, top + 3, 12, 19, '#cfe4f5');
  // 온도 슬라이더만큼 따뜻한 음료(빨간 버튼)가 늘어난다
  const hotPerRow = Math.round((tuning / 10) * 4);
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 4; i++) {
      const hot = i < hotPerRow;
      const palette = hot ? BOTTLES_HOT : BOTTLES_COLD;
      const bx = x0 + 7 + i * 3;
      const by = top + 4 + row * 6;
      px(c, bx, by, 2, 4, palette[(row + i) % palette.length]);
      px(c, bx, by, 2, 1, '#ffffff');
      px(c, bx, by + 4, 2, 1, hot ? '#e2584b' : '#3d7bd9');
    }
  }
  px(c, x0 + 14, top + 24, 4, 6, '#bfc8d0');
  px(c, x0 + 15, top + 25, 1, 3, '#3a3a3a');
  px(c, x0 + 6, top + 32, 10, 5, '#3a3f47');
  px(c, x0 + 7, top + 33, 8, 1, '#5a616b');
  L.push({ x: x0 + 6, y: top + 3, w: 12, h: 19, color: '#e8f6ff' });
  px(c, x0 + 20, G - 9, 3, 9, '#4f8a5a');
  px(c, x0 + 20, G - 9, 3, 1, '#6aa36f');
  if (env.snow) px(c, x0 + 4, top - 2, 16, 2, '#f4f8fb');
}

// ---------------------------------------------------------------- 소품

function drawBench(c: Ctx, x0: number, env: BuildEnv): void {
  drawBlockWall(c, x0, TILE_PX, env);
  px(c, x0 + 4, G - 13, 1, 8, '#4a3a2e');
  px(c, x0 + 19, G - 13, 1, 8, '#4a3a2e');
  px(c, x0 + 3, G - 13, 18, 2, '#a0703f');
  px(c, x0 + 3, G - 10, 18, 1, '#8a5d33');
  px(c, x0 + 2, G - 7, 20, 2, '#b98a5a');
  px(c, x0 + 2, G - 5, 20, 1, '#8a5d33');
  px(c, x0 + 4, G - 5, 1, 5, '#4a3a2e');
  px(c, x0 + 19, G - 5, 1, 5, '#4a3a2e');
  if (env.snow) px(c, x0 + 2, G - 8, 20, 1, '#f4f8fb');
}

function drawLanternPost(c: Ctx, x0: number, env: BuildEnv, L: Light[]): void {
  drawBlockWall(c, x0, TILE_PX, env);
  px(c, x0 + 11, G - 46, 2, 46, '#5a3b2a');
  px(c, x0 + 3, G - 46, 18, 2, '#5a3b2a');
  chochin(c, x0 + 5, G - 43, '#e2584b', L);
  chochin(c, x0 + 18, G - 43, '#f3ead2', L);
  px(c, x0 + 8, G - 4, 8, 4, '#9b9488');
  if (env.season === 'winter') {
    const colors = ['#ffd166', '#ff8fab', '#8ecae6', '#b8f2a6'];
    for (let i = 0; i < 8; i++) {
      const lx = x0 + 1 + i * 3;
      const ly = G - 28 + (i % 2);
      px(c, lx, ly, 1, 1, colors[i % colors.length]);
      L.push({ x: lx + 0.5, y: ly + 0.5, w: 0, h: 0, color: colors[i % colors.length], r: 4 });
    }
  }
}

function drawFeeder(c: Ctx, x0: number, env: BuildEnv): void {
  drawBlockWall(c, x0, TILE_PX, env);
  px(c, x0 + 6, G - 21, 12, 2, '#c8623f');
  px(c, x0 + 5, G - 19, 14, 2, '#b5523b');
  px(c, x0 + 7, G - 17, 10, 11, '#d9b48a');
  px(c, x0 + 9, G - 14, 6, 5, '#5a3b2a');
  px(c, x0 + 8, G - 6, 1, 6, '#7a5236');
  px(c, x0 + 15, G - 6, 1, 6, '#7a5236');
  px(c, x0 + 2, G - 2, 6, 2, '#5f8fc9');
  px(c, x0 + 3, G - 3, 4, 1, '#c98a4a');
  px(c, x0 + 18, G - 3, 3, 3, '#c0c6cc');
  px(c, x0 + 18, G - 3, 3, 1, '#e2584b');
  if (env.snow) px(c, x0 + 5, G - 22, 14, 2, '#f4f8fb');
}

function drawCatTower(c: Ctx, x0: number, env: BuildEnv): void {
  drawBlockWall(c, x0, TILE_PX, env);
  px(c, x0 + 7, G - 36, 3, 36, '#e8d3b5');
  px(c, x0 + 15, G - 24, 3, 24, '#e8d3b5');
  for (let y = G - 34; y < G; y += 2) {
    px(c, x0 + 7, y, 3, 1, '#cdb38f');
    if (y > G - 23) px(c, x0 + 15, y, 3, 1, '#cdb38f');
  }
  px(c, x0 + 3, G - 38, 11, 3, '#c9a27e');
  px(c, x0 + 12, G - 26, 10, 3, '#c9a27e');
  px(c, x0 + 3, G - 16, 10, 9, '#c9a27e');
  px(c, x0 + 6, G - 13, 4, 4, '#5a3b2a');
  px(c, x0 + 2, G - 3, 20, 3, '#b8906a');
  px(c, x0 + 20, G - 23, 1, 4, '#888888');
  px(c, x0 + 19, G - 19, 3, 2, '#ff8fb1');
  if (env.snow) px(c, x0 + 3, G - 39, 11, 1, '#f4f8fb');
}

/** 건물 하나를 그린다. x0는 왼쪽 끝 월드 px, tuning은 자판기 버튼색에만 쓴다. */
export function drawBuilding(c: Ctx, type: BuildingType, x0: number, env: BuildEnv, L: Light[], tuning = 5): void {
  switch (type) {
    case 'ramen':
      return drawRamen(c, x0, env, L);
    case 'bakery':
      return drawBakery(c, x0, env, L);
    case 'teahouse':
      return drawTeahouse(c, x0, env, L);
    case 'bookstore':
      return drawBookstore(c, x0, env, L);
    case 'taiyaki':
      return drawTaiyaki(c, x0, env, L);
    case 'kakigori':
      return drawKakigori(c, x0, env, L);
    case 'vending':
      return drawVending(c, x0, env, L, tuning);
    case 'bench':
      return drawBench(c, x0, env);
    case 'lantern':
      return drawLanternPost(c, x0, env, L);
    case 'feeder':
      return drawFeeder(c, x0, env);
    case 'catTower':
      return drawCatTower(c, x0, env);
  }
}

// ---------------------------------------------------------------- 사람

const SKIN = ['#f6d5b8', '#eec09a', '#d9a77c', '#c48d62', '#f3cfb3'];
const HAIR = ['#2b2220', '#3d2b22', '#5a3b2a', '#7a4a2a', '#c9a36a', '#1f1f2e'];
const ELDER_HAIR = ['#d9d9d9', '#bdbdbd', '#e8e3da', '#a8a8a8'];
const OUTFIT: Record<ResidentType, string[]> = {
  student: ['#2f3a5c', '#2d4a6b', '#3a3a48'],
  salaryman: ['#4a4f5a', '#3d4250', '#5b5348'],
  elder: ['#b59a7a', '#8c7a6a', '#9e8fb2', '#7f9a86'],
  tourist: ['#f2c14e', '#4fb3bf', '#e76f51', '#9b5de5', '#f28fad'],
};
const UMBRELLA = ['#e76f51', '#2a9d8f', '#f4a261', '#8ecae6', '#e9c46a', '#cdb4db', '#dfe7ec'];
const SCARF = ['#c8423b', '#2a9d8f', '#e9c46a', '#8e6fb5'];

export interface PersonDraw {
  type: ResidentType;
  x: number;
  y: number;
  /** 바라보는 방향 */
  face: 1 | -1;
  state: PedState;
  walkPhase: number;
  seed: number;
  umbrella: boolean;
  winter: boolean;
  fan: boolean;
}

/** 사람 키(우산 제외). 말풍선 위치 계산용. */
export const PERSON_HEIGHT = 16;

export function drawPerson(c: Ctx, p: PersonDraw): void {
  if (p.state === 'inside') return;
  const pick = <T>(arr: readonly T[], k: number): T => arr[Math.floor(hash01(p.seed * 7 + k) * arr.length)];
  const skin = pick(SKIN, 1);
  const hair = p.type === 'elder' ? pick(ELDER_HAIR, 2) : pick(HAIR, 2);
  let outfit = pick(OUTFIT[p.type], 3);
  if (p.winter) outfit = mix(outfit, '#2f2f3a', p.type === 'tourist' ? 0.35 : 0.15);
  const pants =
    p.type === 'tourist' ? pick(['#3d5a80', '#d6c29a', '#5a5a6a'], 4) : p.type === 'elder' ? '#6b5e52' : p.type === 'student' ? '#3b3f4a' : mix(outfit, '#000000', 0.25);
  const shoe = '#2b2622';
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  const f = p.face;
  const R = (dx: number, dy: number, w: number, h: number, color: string): void => px(c, f === 1 ? x + dx : x - dx - w + 1, y + dy, w, h, color);

  const walking = p.state === 'walk' || p.state === 'sniff';
  const frame = p.state === 'walk' ? Math.floor(p.walkPhase / 2.2) % 4 : 0;
  const back = p.state === 'counter';
  const lower = p.state === 'petting' ? 3 : p.state === 'resting' ? 2 : 0;
  const bob = walking && (frame === 1 || frame === 3) ? -1 : 0;
  const hunch = p.type === 'elder' ? 1 : 0;
  const top = lower + bob;

  // 그림자
  c.fillStyle = 'rgba(40,30,30,0.18)';
  c.fillRect(x - 3, y - 1, 7, 2);

  // 다리
  if (p.state === 'resting') {
    R(-1, -5, 4, 2, pants);
    R(2, -4, 2, 3, pants);
    R(2, -1, 2, 1, shoe);
  } else if (p.state === 'petting') {
    R(-2, -3, 2, 2, pants);
    R(1, -2, 2, 1, pants);
    R(-2, -1, 5, 1, shoe);
  } else {
    const legs: Record<number, [number, number]> = { 0: [-2, 1], 1: [-1, 0], 2: [-3, 2], 3: [-1, 0] };
    const [bl, fl] = legs[frame];
    R(bl, -4, 2, 3, pants);
    R(fl, -4, 2, 3, pants);
    R(bl, -1, 2, 1, shoe);
    R(fl, -1, 2, 1, shoe);
  }

  // 몸통
  R(-2, -10 + top, 5, 6, outfit);
  R(-2, -10 + top, 1, 6, mix(outfit, '#000000', 0.15));
  if (p.type === 'student') {
    R(0, -10 + top, 2, 1, '#f4f4f4');
    R(-3, -9 + top, 1, 4, '#6b4a35');
  } else if (p.type === 'salaryman') {
    R(1, -10 + top, 1, 2, '#f4f4f4');
    R(1, -8 + top, 1, 2, '#c8423b');
    if (!back && p.state === 'walk') R(2, -6 + top, 3, 2, '#3a2b20');
  } else if (p.type === 'tourist') {
    R(-3, -10 + top, 1, 5, '#c96b4b');
    if (!back) R(1, -8 + top, 2, 2, '#333333');
  } else if (p.type === 'elder' && p.state === 'walk') {
    R(3, -7, 1, 7, '#7a5a3a');
  }
  if (p.winter) R(-2, -10 + top, 5, 1, pick(SCARF, 5));
  // 팔과 손
  const armSwing = walking ? (frame === 0 ? 0 : frame === 2 ? 1 : 0) : 0;
  R(0 + armSwing, -9 + top, 1, 4, mix(outfit, '#000000', 0.2));
  R(0 + armSwing, -5 + top, 1, 1, skin);

  // 머리
  const hx = -2 + hunch;
  const hy = -14 + top + hunch;
  R(hx, hy, 4, 4, skin);
  if (back) {
    R(hx, hy - 1, 4, 4, hair);
  } else {
    R(hx, hy - 1, 4, 1, hair);
    R(hx, hy, 1, 3, hair);
    R(hx + 3, hy, 1, 1, hair);
    R(hx + 3, hy + 1, 1, 1, '#2b2b2b');
  }
  const hat = p.type === 'tourist' && hash01(p.seed * 7 + 6) > 0.5;
  if (hat) {
    R(hx - 1, hy - 1, 6, 1, '#e8d08a');
    R(hx, hy - 2, 4, 1, '#e8d08a');
    R(hx, hy - 1, 4, 1, '#c96b4b');
  } else if (p.fan) {
    R(hx, hy - 2, 1, 1, '#ff8fb1');
    R(hx + 3, hy - 2, 1, 1, '#ff8fb1');
  }

  if (p.umbrella) {
    const col = pick(UMBRELLA, 8);
    const uy = hy - 6;
    R(1, uy + 3, 1, 7, '#4a4a4a');
    R(-2, uy - 1, 7, 1, col);
    R(-4, uy, 11, 1, col);
    R(-5, uy + 1, 13, 1, col);
    for (let i = -5; i < 8; i += 2) R(i, uy + 2, 1, 1, mix(col, '#000000', 0.15));
    R(1, uy - 2, 1, 1, '#4a4a4a');
  }
}

// ---------------------------------------------------------------- 고양이

interface CatPalette {
  base: string;
  a: string;
  b: string;
  eye: string;
}

const CAT_PAL: Record<CatBreed, CatPalette> = {
  calico: { base: '#f7f1e8', a: '#e39a4b', b: '#3b3b3b', eye: '#3a2a22' },
  tuxedo: { base: '#2b2b2e', a: '#f2f2f2', b: '#f2f2f2', eye: '#9ad06a' },
  orange: { base: '#e9a04b', a: '#c97a2b', b: '#c97a2b', eye: '#3a2a22' },
  grey: { base: '#9aa0a8', a: '#6b7078', b: '#6b7078', eye: '#3a2a22' },
  black: { base: '#2a2a2e', a: '#2a2a2e', b: '#3a3a40', eye: '#f2d14b' },
};

export interface CatDraw {
  x: number;
  y: number;
  dir: 1 | -1;
  state: CatState;
  breed: CatBreed;
  legendary: boolean;
  /** 실시간(초), 꼬리·걸음 애니메이션 */
  t: number;
  seed: number;
}

export function drawCat(c: Ctx, k: CatDraw): void {
  const pal = CAT_PAL[k.breed];
  const x = Math.round(k.x);
  const y = Math.round(k.y);
  const f = k.dir;
  const R = (dx: number, dy: number, w: number, h: number, color: string): void => px(c, f === 1 ? x + dx : x - dx - w + 1, y + dy, w, h, color);
  const sway = Math.sin(k.t * 3 + k.seed) > 0 ? 1 : 0;
  c.fillStyle = 'rgba(40,30,30,0.18)';
  c.fillRect(x - 3, y - 1, 7, 1);

  if (k.state === 'walk') {
    const fr = Math.floor(k.t * 6 + k.seed) % 2;
    R(-3, -4, 6, 3, pal.base);
    R(2, -6, 3, 3, pal.base);
    R(2, -7, 1, 1, pal.base);
    R(4, -7, 1, 1, pal.base);
    R(4, -5, 1, 1, pal.eye);
    R(fr ? -3 : -2, -1, 1, 1, pal.base);
    R(fr ? 1 : 2, -1, 1, 1, pal.base);
    R(-4, -5, 1, 2, pal.base);
    R(-5, -6 - sway, 1, 1, pal.base);
    if (k.breed === 'calico') {
      R(-2, -4, 2, 2, pal.a);
      R(1, -4, 1, 1, pal.b);
      R(3, -6, 1, 1, pal.b);
    } else if (k.breed === 'tuxedo') {
      R(1, -3, 2, 2, pal.a);
      R(3, -4, 2, 1, pal.a);
    } else if (k.breed === 'orange' || k.breed === 'grey') {
      R(-2, -4, 1, 2, pal.a);
      R(0, -4, 1, 2, pal.a);
    }
    if (k.legendary) {
      R(2, -4, 1, 1, '#d6453d');
      R(3, -3, 1, 1, '#ffd24a');
    }
    return;
  }

  if (k.state === 'sleep') {
    R(-3, -3, 6, 3, pal.base);
    R(2, -3, 3, 3, pal.base);
    R(2, -4, 1, 1, pal.base);
    R(4, -4, 1, 1, pal.base);
    R(3, -2, 2, 1, mix(pal.base, '#000000', 0.45));
    R(-4, -1, 2, 1, pal.base);
    if (k.breed === 'calico') R(-2, -3, 2, 2, pal.a);
    if (k.breed === 'tuxedo') R(2, -1, 2, 1, pal.a);
    if (k.legendary) R(2, -1, 1, 1, '#ffd24a');
    return;
  }

  // 앉기·그루밍·쓰다듬받기
  const groom = k.state === 'groom';
  const petted = k.state === 'petted';
  const headDy = groom ? 1 : 0;
  R(-2, -5, 4, 5, pal.base);
  R(-1, -8 + headDy, 4, 3, pal.base);
  R(-1, -9 + headDy, 1, 1, pal.base);
  R(2, -9 + headDy, 1, 1, pal.base);
  if (petted) {
    R(0, -7, 1, 1, mix(pal.base, '#000000', 0.45));
    R(2, -7, 1, 1, mix(pal.base, '#000000', 0.45));
  } else {
    R(2, -7 + headDy, 1, 1, pal.eye);
  }
  R(-4, -1, 3, 1, pal.base);
  R(-5, -2 - (petted ? sway : 0), 1, 1, pal.base);
  if (groom) R(2, -6, 1, 2, pal.base);
  if (k.breed === 'calico') {
    R(-2, -5, 2, 2, pal.a);
    R(0, -3, 1, 1, pal.b);
    R(-1, -8 + headDy, 1, 1, pal.a);
  } else if (k.breed === 'tuxedo') {
    R(0, -4, 2, 3, pal.a);
    R(1, -6 + headDy, 2, 1, pal.a);
  } else if (k.breed === 'orange' || k.breed === 'grey') {
    R(-2, -4, 1, 1, pal.a);
    R(-2, -2, 1, 1, pal.a);
    R(0, -8 + headDy, 1, 1, pal.a);
  }
  if (k.legendary) {
    R(-1, -5, 4, 1, '#d6453d');
    R(1, -4, 1, 1, '#ffd24a');
  }
}
