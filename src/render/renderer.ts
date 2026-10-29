import { aromaTiles } from '../sim/aroma.ts';
import {
  BUILDINGS,
  CAT_BREED_NAMES,
  GROUND_Y,
  STREET_PX,
  STREET_TILES,
  TILE_PX,
  type BuildingType,
  type SeasonId,
  type WeatherId,
} from '../sim/data.ts';
import type { Game } from '../sim/game.ts';
import type { Mood } from '../sim/economy.ts';
import { activeSynergies, checkPlacement, previewSynergies, spanOf, synergyAffects, widthOf, type ActiveSynergy } from '../sim/street.ts';
import { hash01, lighting, mix, rgba, type Lighting } from './color.ts';
import {
  BUILDING_HEIGHT,
  PERSON_HEIGHT,
  disc,
  drawBuilding,
  drawCat,
  drawEmptyLot,
  drawLockedLot,
  drawPerson,
  heart,
  px,
  type BuildEnv,
  type Ctx,
  type Light,
} from './sprites.ts';

export const VIEW_W = STREET_PX;
export const VIEW_H = 216;
const G = GROUND_Y;
const SIDEWALK_BOTTOM = 190;
const CAT_Y = G + 6;
const WALK_Y = G + 9;

/** UI가 렌더러에 넘겨주는 화면 상태 */
export interface ViewState {
  build: BuildingType | null;
  ghostX: number | null;
  demolish: boolean;
  selectedUid: number | null;
  hoverUid: number | null;
  hoverLocked: number | null;
  hoverCat: number | null;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  color: string;
  size: number;
  seed: number;
}

const BUBBLE_STYLE: Record<Mood, { bg: string; border: string; ink: string }> = {
  happy: { bg: '#fffaf3', border: '#f29bb4', ink: '#5b3a3a' },
  neutral: { bg: '#ffffff', border: '#b9b1a3', ink: '#4a3b32' },
  sad: { bg: '#f1f3ff', border: '#8a97c9', ink: '#3b3f5c' },
  think: { bg: '#fffbe6', border: '#e7c27d', ink: '#5b4a2a' },
};

const FONT = "Jua, 'Gowun Dodum', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif";
/** 한 화면에 동시에 띄울 말풍선 수 */
const MAX_BUBBLES = 8;

export class Renderer {
  readonly world: HTMLCanvasElement;
  readonly overlay: HTMLCanvasElement;
  scale = 1;

  private w: Ctx;
  private o: Ctx;
  private layer = document.createElement('canvas');
  private l: Ctx;
  private mask = document.createElement('canvas');
  private m: Ctx;
  private ghostCanvas = document.createElement('canvas');
  private t = 0;
  private dpr = 1;
  private cssW = VIEW_W;
  private cssH = VIEW_H;
  private particles: Particle[] = [];
  private particleKey = '';
  private wisps: Particle[] = [];
  private wispAcc = new Map<number, number>();
  private fireworks: Particle[] = [];
  private nextFirework = 0;
  private displayY = new Map<number, number>();

  constructor(world: HTMLCanvasElement, overlay: HTMLCanvasElement) {
    this.world = world;
    this.overlay = overlay;
    for (const cv of [world, this.layer, this.mask]) {
      cv.width = VIEW_W;
      cv.height = VIEW_H;
    }
    this.ghostCanvas.width = VIEW_W;
    this.ghostCanvas.height = VIEW_H;
    this.w = ctx2d(world);
    this.l = ctx2d(this.layer);
    this.m = ctx2d(this.mask);
    this.o = ctx2d(overlay);
  }

  /** 주어진 영역에 맞춰 캔버스 크기를 정한다 */
  resize(availW: number, availH: number): void {
    this.scale = Math.max(0.5, Math.min(availW / VIEW_W, availH / VIEW_H));
    this.cssW = Math.floor(VIEW_W * this.scale);
    this.cssH = Math.floor(VIEW_H * this.scale);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const cv of [this.world, this.overlay]) {
      cv.style.width = `${this.cssW}px`;
      cv.style.height = `${this.cssH}px`;
    }
    this.overlay.width = Math.round(this.cssW * this.dpr);
    this.overlay.height = Math.round(this.cssH * this.dpr);
  }

  screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.overlay.getBoundingClientRect();
    return { x: ((clientX - rect.left) / rect.width) * VIEW_W, y: ((clientY - rect.top) / rect.height) * VIEW_H };
  }

  /** 클릭 위치에 있는 고양이 */
  catAt(game: Game, wx: number, wy: number): number | null {
    for (const rt of game.cats) {
      if (Math.abs(rt.x - wx) <= 7 && wy >= CAT_Y - 12 && wy <= CAT_Y + 3) return rt.id;
    }
    return null;
  }

  /** 클릭 위치의 타일(건물 줄과 보도 위만) */
  tileAt(wx: number, wy: number): number | null {
    if (wy < 40 || wy > SIDEWALK_BOTTOM) return null;
    const tile = Math.floor(wx / TILE_PX);
    return tile >= 0 && tile < STREET_TILES ? tile : null;
  }

  render(game: Game, view: ViewState, dt: number): void {
    this.t += dt;
    const season = game.season;
    const weather = game.s.today.weather;
    const time = game.phase === 'accounting' ? Math.max(game.time, 20 * 60) : game.time;
    const light = lighting(time, weather);
    const env: BuildEnv = { season, snow: season === 'winter' && weather !== 'clear', open: game.phase === 'business' };
    const lights: Light[] = [];

    this.drawSky(light, time, weather);
    this.updateFireworks(game, dt);

    const l = this.l;
    l.clearRect(0, 0, VIEW_W, VIEW_H);
    this.drawFar(l, season, light);
    this.drawCanopy(l, season);
    this.drawStreetRow(l, game, env, lights);
    this.drawGround(l, season, weather);
    this.drawActors(l, game, dt, season);
    this.shadeLayer(light.shade);
    this.w.drawImage(this.layer, 0, 0);

    this.drawDapples(light, season);
    this.drawLights(lights, light.glow);
    this.updateWeather(season, weather, game.festival, dt);
    this.updateWisps(game, dt);
    this.drawEffects(game);
    this.drawBuildOverlay(game, view, env);
    this.drawOverlayText(game, view);
  }

  // ---------------------------------------------------------- 하늘

  private drawSky(light: Lighting, time: number, weather: WeatherId): void {
    const w = this.w;
    for (let y = 0; y < G; y += 2) {
      w.fillStyle = mix(light.skyTop, light.skyBottom, Math.min(1, y / 130));
      w.fillRect(0, y, VIEW_W, 2);
    }
    const overcast = weather === 'rain' || weather === 'snow' ? 0.2 : weather === 'cloudy' ? 0.5 : 1;
    const night = Math.max(0, Math.min(1, (time - 18.5 * 60) / 60)) * overcast;
    if (night > 0) {
      for (let i = 0; i < 40; i++) {
        const tw = 0.5 + 0.5 * Math.sin(this.t * 2 + i * 1.7);
        w.fillStyle = rgba('#ffffff', night * (0.4 + 0.5 * tw));
        w.fillRect(Math.floor(hash01(i * 3) * VIEW_W), Math.floor(hash01(i * 5 + 1) * 70), 1, 1);
      }
      w.fillStyle = rgba('#f4f1de', night);
      disc(w, 318, 26, 5, rgba('#f4f1de', night));
      w.fillStyle = rgba('#d9d4bd', night);
      w.fillRect(316, 25, 2, 2);
      w.fillRect(320, 28, 1, 1);
    }
    const sunVisible = weather !== 'rain' && weather !== 'snow' && time < 19 * 60;
    if (sunVisible) {
      const frac = Math.max(0, Math.min(1, (time - 9 * 60) / (10 * 60)));
      const sx = 50 + frac * 290;
      const sy = 74 - Math.sin(frac * Math.PI) * 50 + frac * 20;
      const alpha = weather === 'cloudy' ? 0.45 : 1;
      const sunCol = time > 17 * 60 ? '#ffc58a' : '#fff6c9';
      w.globalCompositeOperation = 'lighter';
      const grad = w.createRadialGradient(sx, sy, 2, sx, sy, weather === 'heatwave' ? 46 : 26);
      grad.addColorStop(0, rgba(sunCol, 0.55 * alpha));
      grad.addColorStop(1, rgba(sunCol, 0));
      w.fillStyle = grad;
      w.fillRect(sx - 50, sy - 50, 100, 100);
      w.globalCompositeOperation = 'source-over';
      disc(w, Math.round(sx), Math.round(sy), 6, rgba(sunCol, alpha));
    }
    const cloudCount = { clear: 3, cloudy: 8, rain: 10, snow: 9, heatwave: 1 }[weather];
    const cloudCol = weather === 'rain' ? '#8f99a5' : weather === 'snow' ? '#dfe5ec' : mix('#ffffff', light.skyBottom, 0.25);
    for (let i = 0; i < cloudCount; i++) {
      const speed = 2 + hash01(i * 11) * 3;
      const cx = ((hash01(i * 7) * 480 + this.t * speed) % 480) - 48;
      const cy = 10 + hash01(i * 13) * 46;
      const size = 5 + Math.floor(hash01(i * 17) * 5);
      disc(w, Math.round(cx), Math.round(cy), size, cloudCol);
      disc(w, Math.round(cx + size), Math.round(cy + 2), size - 1, cloudCol);
      disc(w, Math.round(cx - size), Math.round(cy + 2), size - 2, cloudCol);
      w.fillStyle = cloudCol;
      w.fillRect(Math.round(cx - size * 2 + 2), Math.round(cy + 2), size * 4 - 3, size - 1);
    }
    for (const p of this.fireworks) {
      const a = 1 - p.age / p.life;
      w.globalCompositeOperation = 'lighter';
      w.fillStyle = rgba(p.color, a);
      w.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
      w.globalCompositeOperation = 'source-over';
    }
  }

  private updateFireworks(game: Game, dt: number): void {
    const active = game.season === 'summer' && game.festival && game.phase === 'business' && game.time >= 18.5 * 60;
    if (active && this.t >= this.nextFirework) {
      this.nextFirework = this.t + 0.9 + Math.random() * 0.9;
      const cx = 40 + Math.random() * 300;
      const cy = 18 + Math.random() * 40;
      const color = ['#ff6b6b', '#ffd93d', '#6bcbff', '#c77dff', '#7dffb3'][Math.floor(Math.random() * 5)];
      for (let i = 0; i < 34; i++) {
        const a = (i / 34) * Math.PI * 2;
        const v = 18 + Math.random() * 16;
        this.fireworks.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0, life: 1.2 + Math.random() * 0.6, color, size: 1, seed: i });
      }
    }
    for (const p of this.fireworks) {
      p.age += dt;
      p.vy += 16 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.fireworks = this.fireworks.filter((p) => p.age < p.life);
  }

  // ---------------------------------------------------------- 배경

  private drawFar(c: Ctx, season: SeasonId, light: Lighting): void {
    const far = mix({ spring: '#b9c9dc', summer: '#a9c3d6', autumn: '#c8b9aa', winter: '#c5cfdb' }[season], light.skyBottom, 0.35);
    const near = mix(far, '#7d8a99', 0.25);
    for (let i = 0; i < 26; i++) {
      const x = i * 16 - 8 + Math.floor(hash01(i * 3) * 6);
      const w = 14 + Math.floor(hash01(i * 5) * 12);
      const h = 26 + Math.floor(hash01(i * 7) * 28);
      const top = 142 - h;
      px(c, x, top, w, h + 30, far);
      if (hash01(i * 11) > 0.5) {
        for (let r = 0; r < 4; r++) px(c, x - 1 + r, top - 4 + r, w + 2 - r * 2, 1, far);
      }
      if (hash01(i * 19) > 0.6) px(c, x + 3, top + 6, 3, 3, mix(far, '#ffffff', 0.25));
    }
    for (let i = 0; i < 18; i++) {
      const x = i * 23 + Math.floor(hash01(i * 23) * 10);
      const h = 18 + Math.floor(hash01(i * 29) * 16);
      px(c, x, 150 - h, 16 + Math.floor(hash01(i * 31) * 8), h + 20, near);
    }
    // 전봇대와 전선: 골목 분위기
    const pole = '#5f5750';
    for (const pxl of [62, 300]) {
      px(c, pxl, 46, 3, 122, pole);
      px(c, pxl - 8, 54, 19, 2, pole);
      px(c, pxl - 5, 62, 13, 1, pole);
    }
    c.fillStyle = '#3f3a36';
    for (const [y0, sag] of [
      [55, 9],
      [63, 7],
    ] as const) {
      for (let x = 0; x < VIEW_W; x++) {
        let y: number;
        if (x < 62) y = y0 + sag * (1 - ((x - 62) / 62) ** 2) * 0.6;
        else if (x < 300) y = y0 + sag * (1 - ((x - 181) / 119) ** 2);
        else y = y0 + sag * (1 - ((x - 300) / 84) ** 2) * 0.6;
        c.fillRect(x, Math.round(y), 1, 1);
      }
    }
    // 전선 위 참새
    for (const bx of [120, 128, 236]) {
      const y = 55 + 9 * (1 - ((bx - 181) / 119) ** 2);
      const hop = Math.sin(this.t * 1.3 + bx) > 0.93 ? -1 : 0;
      px(c, bx, Math.round(y) - 3 + hop, 3, 2, '#6b5444');
      px(c, bx + 2, Math.round(y) - 4 + hop, 2, 2, '#6b5444');
    }
  }

  private drawCanopy(c: Ctx, season: SeasonId): void {
    const palette: Record<SeasonId, string[]> = {
      spring: ['#f29bb4', '#f7b8c8', '#ffd6e0'],
      summer: ['#4a8b48', '#5fa35a', '#7cc06f'],
      autumn: ['#d65a31', '#e8823a', '#f2b04c'],
      winter: ['#6b5444', '#6b5444', '#f4f8fb'],
    };
    const cols = palette[season];
    const sway = Math.round(Math.sin(this.t * 0.7));
    // 가지
    c.fillStyle = '#5a4536';
    for (const [x0, dir] of [
      [0, 1],
      [VIEW_W, -1],
    ] as const) {
      for (let i = 0; i < 70; i++) c.fillRect(x0 + dir * i - (dir < 0 ? 1 : 0), Math.round(4 + i * 0.18 + Math.sin(i / 9) * 2), 1, 2);
      for (let i = 0; i < 30; i++) c.fillRect(x0 + dir * (20 + i), Math.round(12 + i * 0.4), 1, 1);
    }
    if (season === 'winter') {
      for (let i = 0; i < 26; i++) {
        const x = i < 13 ? i * 6 : VIEW_W - (i - 13) * 6;
        px(c, x, Math.round(4 + (i % 13) * 1.2), 3, 1, '#f4f8fb');
      }
      return;
    }
    for (let i = 0; i < 34; i++) {
      const left = i < 17;
      const k = left ? i : i - 17;
      const x = left ? k * 5 - 4 : VIEW_W - k * 5 + 4;
      const y = -4 + Math.floor(hash01(i * 37) * 18) + (k > 10 ? 4 : 0);
      const r = 5 + Math.floor(hash01(i * 41) * 5) - (k > 12 ? 2 : 0);
      disc(c, x + sway, y, r, cols[0]);
      disc(c, x + sway - 1, y - 1, Math.max(1, r - 2), cols[1]);
      if (hash01(i * 43) > 0.5) px(c, x + sway - 2, y - 3, 2, 2, cols[2]);
    }
  }

  private drawStreetRow(c: Ctx, game: Game, env: BuildEnv, lights: Light[]): void {
    for (let tile = 0; tile < STREET_TILES; tile++) {
      if (game.s.buildings.some((b) => tile >= b.x && tile <= spanOf(b)[1])) continue;
      if (game.s.unlocked[tile]) drawEmptyLot(c, tile * TILE_PX, TILE_PX, env);
      else drawLockedLot(c, tile * TILE_PX, TILE_PX, env);
    }
    for (const b of game.s.buildings) drawBuilding(c, b.type, b.x * TILE_PX, env, lights, b.tuning);
  }

  private drawGround(c: Ctx, season: SeasonId, weather: WeatherId): void {
    const wet = weather === 'rain';
    const snow = season === 'winter' && weather === 'snow';
    px(c, 0, G, VIEW_W, SIDEWALK_BOTTOM - G, wet ? '#bcb4a7' : '#d4ccbe');
    for (let row = 0; row < 3; row++) {
      const y = G + row * 7;
      px(c, 0, y, VIEW_W, 1, wet ? '#aaa295' : '#c2b8a8');
      for (let x = (row % 2) * 6; x < VIEW_W; x += 12) px(c, x, y, 1, 7, wet ? '#aaa295' : '#c2b8a8');
    }
    px(c, 0, SIDEWALK_BOTTOM - 1, VIEW_W, 3, '#a39b8e');
    px(c, 0, SIDEWALK_BOTTOM - 1, VIEW_W, 1, '#bdb5a8');
    px(c, 0, SIDEWALK_BOTTOM + 2, VIEW_W, VIEW_H - SIDEWALK_BOTTOM - 2, wet ? '#5e6168' : '#74767b');
    for (let i = 0; i < 90; i++) px(c, Math.floor(hash01(i * 3 + 7) * VIEW_W), SIDEWALK_BOTTOM + 3 + Math.floor(hash01(i * 5 + 9) * 22), 1, 1, wet ? '#686b73' : '#6b6d72');
    for (let x = 6; x < VIEW_W; x += 32) px(c, x, 205, 14, 1, wet ? '#9a9da3' : '#d9d7cf');
    for (const gx of [70, 230]) {
      px(c, gx, SIDEWALK_BOTTOM + 2, 12, 3, '#4d4f54');
      for (let i = 1; i < 12; i += 2) px(c, gx + i, SIDEWALK_BOTTOM + 2, 1, 3, '#7d8086');
    }
    if (wet) {
      for (let i = 0; i < 6; i++) {
        const cx = 20 + Math.floor(hash01(i * 17) * 340);
        const cy = 196 + Math.floor(hash01(i * 19) * 16);
        const rw = 8 + Math.floor(hash01(i * 23) * 10);
        px(c, cx - rw, cy, rw * 2, 2, '#7d8fa3');
        px(c, cx - rw + 2, cy - 1, rw * 2 - 4, 1, '#7d8fa3');
        const ring = ((this.t * 0.8 + hash01(i)) % 1) * rw;
        c.fillStyle = rgba('#c9d6e3', 0.6 * (1 - ring / rw));
        c.fillRect(Math.round(cx - ring), cy, 1, 1);
        c.fillRect(Math.round(cx + ring), cy, 1, 1);
      }
    }
    if (snow || (season === 'winter' && weather !== 'clear')) {
      for (let x = 0; x < VIEW_W; x += 3) {
        const h = 1 + Math.floor(hash01(x * 7) * 3);
        px(c, x, G, 3, h, '#eef2f6');
        px(c, x, SIDEWALK_BOTTOM + 2, 3, 1 + Math.floor(hash01(x * 11) * 2), '#e6ecf2');
      }
    }
    const decor =
      season === 'spring' ? ['#f7b8c8', '#ffd6e0'] : season === 'autumn' ? ['#e8823a', '#d65a31', '#f2b04c'] : null;
    if (decor) {
      for (let i = 0; i < 34; i++) {
        const x = Math.floor(hash01(i * 29 + 3) * VIEW_W);
        const y = G + 1 + Math.floor(hash01(i * 31 + 5) * 36);
        if (y > SIDEWALK_BOTTOM - 1 && y < SIDEWALK_BOTTOM + 3) continue;
        px(c, x, y, 2, 1, decor[i % decor.length]);
      }
    }
  }

  // ---------------------------------------------------------- 사람·고양이

  private drawActors(c: Ctx, game: Game, dt: number, season: SeasonId): void {
    const items: { y: number; draw: () => void }[] = [];
    for (const rt of game.cats) {
      const cat = game.s.cats.find((k) => k.id === rt.id);
      if (!cat) continue;
      items.push({
        y: CAT_Y,
        draw: () => drawCat(c, { x: rt.x, y: CAT_Y, dir: rt.dir, state: rt.state, breed: cat.breed, legendary: cat.legendary, t: this.t, seed: cat.id }),
      });
    }
    const alive = new Set<number>();
    for (const p of game.peds) {
      alive.add(p.id);
      const target = p.state === 'counter' || p.state === 'inside' ? G + 4 : p.state === 'resting' ? G + 1 : WALK_Y + p.lane;
      const prev = this.displayY.get(p.id) ?? target;
      const y = prev + (target - prev) * Math.min(1, dt * 10);
      this.displayY.set(p.id, y);
      let face = p.dir;
      if (p.state === 'petting') {
        const cat = game.cats.reduce<{ x: number } | null>((best, rt) => (!best || Math.abs(rt.x - p.x) < Math.abs(best.x - p.x) ? rt : best), null);
        if (cat) face = cat.x >= p.x ? 1 : -1;
      }
      items.push({
        y,
        draw: () =>
          drawPerson(c, {
            type: p.type,
            x: p.x,
            y,
            face,
            state: p.state,
            walkPhase: p.walkPhase,
            seed: p.lookSeed,
            umbrella: p.umbrella,
            winter: season === 'winter',
            fan: p.fan,
          }),
      });
    }
    for (const id of this.displayY.keys()) if (!alive.has(id)) this.displayY.delete(id);
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();
  }

  /** 장면 레이어에 시간대 색을 곱한다. 투명한 부분(하늘)은 그대로 둔다. */
  private shadeLayer(shade: string): void {
    if (shade.toLowerCase() === '#ffffff') return;
    this.m.clearRect(0, 0, VIEW_W, VIEW_H);
    this.m.drawImage(this.layer, 0, 0);
    const l = this.l;
    l.globalCompositeOperation = 'multiply';
    l.fillStyle = shade;
    l.fillRect(0, 0, VIEW_W, VIEW_H);
    l.globalCompositeOperation = 'destination-in';
    l.drawImage(this.mask, 0, 0);
    l.globalCompositeOperation = 'source-over';
  }

  private drawDapples(light: Lighting, season: SeasonId): void {
    if (light.sunlight <= 0.02 || season === 'winter') return;
    const w = this.w;
    w.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 16; i++) {
      const x = hash01(i * 53) * VIEW_W + Math.sin(this.t * 0.6 + i) * 2;
      const y = 112 + hash01(i * 59) * 76;
      const rw = 3 + Math.floor(hash01(i * 61) * 4);
      w.fillStyle = rgba('#fff3c4', 0.16 * light.sunlight);
      w.fillRect(Math.round(x - rw), Math.round(y), rw * 2, 2);
      w.fillRect(Math.round(x - rw + 1), Math.round(y - 1), rw * 2 - 2, 1);
    }
    w.globalCompositeOperation = 'source-over';
  }

  private drawLights(lights: Light[], glow: number): void {
    if (glow <= 0.02) return;
    const w = this.w;
    w.globalCompositeOperation = 'lighter';
    for (const lt of lights) {
      if (lt.r) {
        const grad = w.createRadialGradient(lt.x, lt.y, 0, lt.x, lt.y, lt.r);
        grad.addColorStop(0, rgba(lt.color, 0.55 * glow));
        grad.addColorStop(1, rgba(lt.color, 0));
        w.fillStyle = grad;
        w.fillRect(lt.x - lt.r, lt.y - lt.r, lt.r * 2, lt.r * 2);
      } else {
        w.fillStyle = rgba(lt.color, 0.45 * glow);
        w.fillRect(lt.x, lt.y, lt.w, lt.h);
        w.fillStyle = rgba(lt.color, 0.12 * glow);
        w.fillRect(lt.x - 2, lt.y - 2, lt.w + 4, lt.h + 4);
      }
    }
    w.globalCompositeOperation = 'source-over';
  }

  // ---------------------------------------------------------- 날씨·향기 입자

  private updateWeather(season: SeasonId, weather: WeatherId, festival: boolean, dt: number): void {
    const key = `${season}/${weather}/${festival}`;
    if (key !== this.particleKey) {
      this.particleKey = key;
      this.particles = [];
      const count =
        weather === 'rain' ? 150 : weather === 'snow' ? 100 : season === 'spring' ? (festival ? 40 : 14) : season === 'autumn' ? (festival ? 30 : 10) : 0;
      for (let i = 0; i < count; i++) this.particles.push(this.spawnParticle(season, weather, true));
    }
    const w = this.w;
    for (const p of this.particles) {
      p.age += dt;
      p.x += (p.vx + (weather === 'rain' ? 0 : Math.sin(this.t * 1.5 + p.seed) * 6)) * dt;
      p.y += p.vy * dt;
      if (p.y > p.life || p.x < -10 || p.x > VIEW_W + 10) Object.assign(p, this.spawnParticle(season, weather, false));
      if (weather === 'rain') {
        w.fillStyle = 'rgba(200,215,235,0.55)';
        w.fillRect(Math.round(p.x), Math.round(p.y), 1, 3);
        if (p.life - p.y < 2) w.fillRect(Math.round(p.x) - 1, Math.round(p.life), 3, 1);
      } else {
        w.fillStyle = p.color;
        const flip = Math.sin(this.t * 4 + p.seed) > 0;
        w.fillRect(Math.round(p.x), Math.round(p.y), flip ? p.size : Math.max(1, p.size - 1), flip ? Math.max(1, p.size - 1) : p.size);
      }
    }
  }

  private spawnParticle(season: SeasonId, weather: WeatherId, anywhere: boolean): Particle {
    const seed = Math.random() * 100;
    const ground = G + 2 + Math.random() * 44;
    const y = anywhere ? Math.random() * ground : -4;
    if (weather === 'rain') return { x: Math.random() * (VIEW_W + 40), y, vx: -28, vy: 170, age: 0, life: ground, color: '', size: 1, seed };
    if (weather === 'snow') return { x: Math.random() * VIEW_W, y, vx: -3, vy: 12 + Math.random() * 10, age: 0, life: ground, color: '#ffffff', size: Math.random() > 0.7 ? 2 : 1, seed };
    const petals = ['#f7b8c8', '#ffd6e0', '#f29bb4'];
    const leaves = ['#e8823a', '#d65a31', '#f2b04c'];
    const cols = season === 'spring' ? petals : leaves;
    return {
      x: anywhere ? Math.random() * VIEW_W : Math.random() * VIEW_W * 0.8,
      y,
      vx: 6 + Math.random() * 8,
      vy: 10 + Math.random() * 9,
      age: 0,
      life: ground,
      color: cols[Math.floor(Math.random() * cols.length)],
      size: 2,
      seed,
    };
  }

  /** 향기 입자: 향기 반경만큼 옆으로 흘러가며 옅어진다 */
  private updateWisps(game: Game, dt: number): void {
    const open = game.phase === 'business' && !game.closingTime;
    if (open) {
      for (const b of game.s.buildings) {
        const def = BUILDINGS[b.type];
        if (def.kind !== 'shop' || !def.aroma) continue;
        const acc = (this.wispAcc.get(b.uid) ?? 0) + dt * 2.4 * def.aroma.strength;
        let n = Math.floor(acc);
        this.wispAcc.set(b.uid, acc - n);
        while (n-- > 0) {
          const dir = Math.random() < 0.5 ? -1 : 1;
          const vx = dir * (8 + Math.random() * 8);
          const reach = (def.aroma.radius + widthOf(b.type) / 2) * TILE_PX;
          const doorCenter = (b.x + widthOf(b.type) / 2) * TILE_PX;
          this.wisps.push({
            x: doorCenter + (Math.random() - 0.5) * 8,
            y: G - 18 - Math.random() * 14,
            vx,
            vy: -2 - Math.random() * 2,
            age: 0,
            life: reach / Math.abs(vx),
            color: def.aroma.color,
            size: 2,
            seed: Math.random() * 10,
          });
        }
      }
    }
    const w = this.w;
    for (const p of this.wisps) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const a = 0.5 * (1 - p.age / p.life);
      w.fillStyle = rgba(p.color, a);
      const wob = Math.round(Math.sin(this.t * 5 + p.seed + p.age * 4));
      w.fillRect(Math.round(p.x), Math.round(p.y) + wob, 2, 1);
      w.fillRect(Math.round(p.x - Math.sign(p.vx)), Math.round(p.y) + wob + 1, 1, 1);
    }
    this.wisps = this.wisps.filter((p) => p.age < p.life);
  }

  private drawEffects(game: Game): void {
    const w = this.w;
    for (const e of game.effects) {
      if (e.kind !== 'heart') continue;
      const rise = e.age * 10;
      w.globalAlpha = Math.max(0, 1 - e.age / e.ttl);
      heart(w, Math.round(e.x - 2), Math.round(e.y - 16 - rise));
      w.globalAlpha = 1;
    }
    for (const rt of game.cats) {
      const cat = game.s.cats.find((k) => k.id === rt.id);
      if (rt.state === 'sleep') {
        const k = (this.t * 0.8 + rt.id) % 1;
        w.fillStyle = rgba('#ffffff', 0.9 * (1 - k));
        const zx = Math.round(rt.x + 3 + k * 4);
        const zy = Math.round(CAT_Y - 8 - k * 8);
        w.fillRect(zx, zy, 3, 1);
        w.fillRect(zx + 1, zy + 1, 1, 1);
        w.fillRect(zx, zy + 2, 3, 1);
      }
      if (cat?.legendary && Math.sin(this.t * 2.3 + rt.id) > 0.85) {
        w.fillStyle = '#fff2a8';
        const sx = Math.round(rt.x + Math.sin(this.t * 7) * 5);
        w.fillRect(sx, CAT_Y - 12, 1, 3);
        w.fillRect(sx - 1, CAT_Y - 11, 3, 1);
      }
    }
  }

  // ---------------------------------------------------------- 건설 모드 표시

  private drawBuildOverlay(game: Game, view: ViewState, env: BuildEnv): void {
    const w = this.w;
    const outline = (x0: number, wTiles: number, top: number, color: string): void => {
      const x = x0 * TILE_PX;
      const width = wTiles * TILE_PX;
      w.fillStyle = color;
      w.fillRect(x, top, width, 1);
      w.fillRect(x, G + 1, width, 1);
      w.fillRect(x, top, 1, G + 1 - top);
      w.fillRect(x + width - 1, top, 1, G + 1 - top);
    };
    const aromaBars = (type: BuildingType, x: number): void => {
      const def = BUILDINGS[type];
      if (def.kind !== 'shop' || !def.aroma) return;
      for (const { tile, f } of aromaTiles(type, x)) {
        w.fillStyle = rgba(def.aroma.color, 0.18 + 0.4 * f);
        w.fillRect(tile * TILE_PX + 1, G + 1, TILE_PX - 2, 3);
      }
    };
    const synergyLinks = (list: ActiveSynergy[]): void => {
      for (const s of list) {
        const col = s.def.negative ? '#ff6b6b' : '#ffd93d';
        for (const b of [s.a, s.b]) if (b.uid !== -1) outline(b.x, widthOf(b.type), G - BUILDING_HEIGHT[b.type] - 2, col);
      }
    };

    if (view.build) {
      for (let tile = 0; tile < STREET_TILES; tile++) {
        if (!game.s.unlocked[tile] || game.s.buildings.some((b) => tile >= b.x && tile <= spanOf(b)[1])) continue;
        w.fillStyle = 'rgba(255,255,255,0.18)';
        w.fillRect(tile * TILE_PX + 2, G - 30, TILE_PX - 4, 30);
      }
      if (view.ghostX !== null) {
        const x = view.ghostX;
        const ok = checkPlacement(game.s.buildings, game.s.unlocked, view.build, x).ok && game.s.money >= BUILDINGS[view.build].cost;
        const g = ctx2d(this.ghostCanvas);
        g.clearRect(0, 0, VIEW_W, VIEW_H);
        drawBuilding(g, view.build, x * TILE_PX, { ...env, open: true }, [], 5);
        w.globalAlpha = 0.72;
        w.drawImage(this.ghostCanvas, 0, 0);
        w.globalAlpha = 1;
        outline(x, widthOf(view.build), G - BUILDING_HEIGHT[view.build] - 2, ok ? '#7dffb3' : '#ff6b6b');
        aromaBars(view.build, x);
        synergyLinks(previewSynergies(game.s.buildings, view.build, x));
      }
      return;
    }

    if (view.hoverLocked !== null) outline(view.hoverLocked, 1, G - 40, '#ffd93d');
    const hover = game.building(view.hoverUid);
    if (hover && hover.uid !== view.selectedUid) {
      outline(hover.x, widthOf(hover.type), G - BUILDING_HEIGHT[hover.type] - 2, view.demolish ? '#ff6b6b' : 'rgba(255,255,255,0.7)');
    }
    const sel = game.building(view.selectedUid);
    if (sel) {
      outline(sel.x, widthOf(sel.type), G - BUILDING_HEIGHT[sel.type] - 2, '#ffffff');
      aromaBars(sel.type, sel.x);
      synergyLinks(activeSynergies(game.s.buildings).filter((s) => synergyAffects(s, sel) || s.a.uid === sel.uid || s.b.uid === sel.uid));
    }
  }

  // ---------------------------------------------------------- 글자(고해상도 오버레이)

  private drawOverlayText(game: Game, view: ViewState): void {
    const o = this.o;
    o.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    o.clearRect(0, 0, this.cssW, this.cssH);
    const s = this.scale;
    const fontSize = Math.round(Math.max(11, Math.min(16, 9 + s * 1.6)));

    // 동전
    for (const e of game.effects) {
      if (e.kind !== 'coin' || !e.text) continue;
      const a = Math.max(0, 1 - e.age / e.ttl);
      const y = (e.y - e.age * 12) * s;
      o.font = `${fontSize}px ${FONT}`;
      o.textAlign = 'center';
      o.lineWidth = 3;
      o.strokeStyle = rgba('#5b3a1a', a * 0.8);
      o.strokeText(e.text, e.x * s, y);
      o.fillStyle = rgba('#ffd34d', a);
      o.fillText(e.text, e.x * s, y);
    }

    // 말풍선: 새것부터 자리를 잡고, 겹치면 위로 비켜 서거나(최대 2단) 생략한다
    const bubbles = game.peds.filter((p) => p.bubble && p.state !== 'inside').sort((a, b) => a.bubble!.age - b.bubble!.age);
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const drawList: (() => void)[] = [];
    o.font = `${fontSize}px ${FONT}`;
    for (const p of bubbles) {
      if (placed.length >= MAX_BUBBLES) break;
      const b = p.bubble!;
      const yWorld = (this.displayY.get(p.id) ?? WALK_Y + p.lane) - PERSON_HEIGHT - (p.umbrella ? 7 : 1);
      const pop = Math.min(1, b.age / 0.15);
      const alpha = Math.min(pop, Math.max(0, (b.ttl - b.age) / 0.4));
      const w = o.measureText(b.text).width + 14;
      const h = fontSize + 9;
      const x = Math.max(2, Math.min(this.cssW - w - 2, p.x * s - w / 2));
      let bottom = yWorld * s - (1 - pop) * 4;
      let ok = false;
      for (let tries = 0; tries < 3; tries++) {
        const rect = { x, y: bottom - h - 6, w, h: h + 6 };
        if (!placed.some((r) => rect.x < r.x + r.w && r.x < rect.x + rect.w && rect.y < r.y + r.h && r.y < rect.y + rect.h)) {
          placed.push(rect);
          ok = true;
          break;
        }
        bottom -= h + 3;
      }
      if (!ok) continue;
      const by = bottom;
      drawList.push(() => this.bubble(p.x * s, by, b.text, b.mood, alpha, fontSize));
    }
    // 오래된 것을 먼저 그려 새 말풍선이 위로 오게
    for (let i = drawList.length - 1; i >= 0; i--) drawList[i]();

    // 고양이 이름
    if (view.hoverCat !== null) {
      const rt = game.cats.find((c) => c.id === view.hoverCat);
      const cat = game.s.cats.find((c) => c.id === view.hoverCat);
      if (rt && cat) this.label(rt.x * s, (CAT_Y - 16) * s, `${cat.legendary ? '🔔 ' : '🐈 '}${cat.name} · ${CAT_BREED_NAMES[cat.breed]} (쓰다듬기)`, fontSize - 1, '#fffaf3', '#4a3b32');
    }

    if (view.build && view.ghostX !== null) {
      const chips = previewSynergies(game.s.buildings, view.build, view.ghostX);
      const def = BUILDINGS[view.build];
      const cx = (view.ghostX + def.width / 2) * TILE_PX * s;
      let y = (G - BUILDING_HEIGHT[view.build] - 8) * s;
      const check = checkPlacement(game.s.buildings, game.s.unlocked, view.build, view.ghostX);
      const reason = !check.ok ? check.reason : game.s.money < def.cost ? '돈이 부족해요' : null;
      if (reason) {
        this.label(cx, y, reason, fontSize - 1, '#ffecec', '#a23b3b');
        y -= fontSize + 10;
      }
      for (const chip of chips) {
        this.label(cx, y, `${chip.def.negative ? '💢' : '✨'} ${chip.def.name} · ${chip.def.desc}`, fontSize - 1, chip.def.negative ? '#ffecec' : '#fff7d6', chip.def.negative ? '#a23b3b' : '#6b5310');
        y -= fontSize + 10;
      }
      return;
    }

    if (view.hoverLocked !== null) {
      this.label((view.hoverLocked + 0.5) * TILE_PX * s, (G - 46) * s, `공터 확장 ¥${game.unlockCost().toLocaleString('ko-KR')}`, fontSize - 1, '#fff7d6', '#6b5310');
    }
    const hover = game.building(view.hoverUid);
    if (hover) {
      const def = BUILDINGS[hover.type];
      const stars = def.kind === 'shop' ? ` ${'★'.repeat(Math.max(1, Math.round(hover.rating * 5)))}` : '';
      const text = view.demolish ? `철거하기 (환급 ¥${game.refundOf(hover.uid).toLocaleString('ko-KR')})` : `${def.icon} ${def.name}${stars}`;
      this.label((hover.x + def.width / 2) * TILE_PX * s, (G - BUILDING_HEIGHT[hover.type] - 8) * s, text, fontSize - 1, view.demolish ? '#ffecec' : '#fffaf3', view.demolish ? '#a23b3b' : '#4a3b32');
    }
  }

  private bubble(cx: number, bottom: number, text: string, mood: Mood, alpha: number, fontSize: number): void {
    const o = this.o;
    const st = BUBBLE_STYLE[mood];
    o.font = `${fontSize}px ${FONT}`;
    const tw = o.measureText(text).width;
    const w = tw + 14;
    const h = fontSize + 9;
    const x = Math.max(2, Math.min(this.cssW - w - 2, cx - w / 2));
    const y = bottom - h - 6;
    o.globalAlpha = alpha;
    o.fillStyle = st.bg;
    o.strokeStyle = st.border;
    o.lineWidth = 1.5;
    o.beginPath();
    o.roundRect(x, y, w, h, 7);
    o.fill();
    o.stroke();
    const tx = Math.max(x + 8, Math.min(x + w - 8, cx));
    o.beginPath();
    o.moveTo(tx - 4, y + h - 0.5);
    o.lineTo(tx, y + h + 5);
    o.lineTo(tx + 4, y + h - 0.5);
    o.fill();
    o.beginPath();
    o.moveTo(tx - 4, y + h);
    o.lineTo(tx, y + h + 5);
    o.lineTo(tx + 4, y + h);
    o.stroke();
    o.fillStyle = st.bg;
    o.fillRect(tx - 3.5, y + h - 1.5, 7, 2);
    o.fillStyle = st.ink;
    o.textAlign = 'left';
    o.textBaseline = 'middle';
    o.fillText(text, x + 7, y + h / 2 + 1);
    o.textBaseline = 'alphabetic';
    o.globalAlpha = 1;
  }

  private label(cx: number, bottom: number, text: string, fontSize: number, bg: string, ink: string): void {
    const o = this.o;
    o.font = `${fontSize}px ${FONT}`;
    const w = o.measureText(text).width + 14;
    const h = fontSize + 8;
    const x = Math.max(2, Math.min(this.cssW - w - 2, cx - w / 2));
    const y = Math.max(2, bottom - h);
    o.fillStyle = bg;
    o.strokeStyle = rgba('#000000', 0.12);
    o.lineWidth = 1;
    o.beginPath();
    o.roundRect(x, y, w, h, h / 2);
    o.fill();
    o.stroke();
    o.fillStyle = ink;
    o.textAlign = 'left';
    o.textBaseline = 'middle';
    o.fillText(text, x + 7, y + h / 2 + 1);
    o.textBaseline = 'alphabetic';
  }
}

function ctx2d(cv: HTMLCanvasElement): Ctx {
  const c = cv.getContext('2d');
  if (!c) throw new Error('Canvas 2D를 쓸 수 없는 환경이에요');
  c.imageSmoothingEnabled = false;
  return c;
}
