import { WEATHER_INFO, type WeatherId } from '../sim/data.ts';

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((ch) => ch + ch).join('') : h.slice(0, 6);
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: Rgb): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

export function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex([ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t]);
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
}

/** 정수 해시 → 0~1. 장식 배치처럼 매 프레임 같은 값이 나와야 하는 곳에 쓴다. */
export function hash01(n: number): number {
  let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

interface SkyKey {
  t: number;
  top: string;
  bottom: string;
  /** 장면 전체에 곱할 색(낮엔 흰색) */
  shade: string;
  /** 창문·등불이 켜지는 정도 */
  glow: number;
}

const SKY_KEYS: SkyKey[] = [
  { t: 9 * 60, top: '#9fd8ff', bottom: '#e6f6ff', shade: '#ffffff', glow: 0 },
  { t: 12 * 60, top: '#7cc6ff', bottom: '#d6f0ff', shade: '#ffffff', glow: 0 },
  { t: 16 * 60, top: '#86b9ee', bottom: '#ffe9c4', shade: '#fff4e6', glow: 0 },
  { t: 17.5 * 60, top: '#7d86d6', bottom: '#ffc49c', shade: '#ffdcc0', glow: 0.35 },
  { t: 18.5 * 60, top: '#4b4a9c', bottom: '#f59c8a', shade: '#d9a8b8', glow: 0.75 },
  { t: 19.5 * 60, top: '#262c68', bottom: '#7a5a8f', shade: '#8a8fc4', glow: 1 },
  { t: 21 * 60, top: '#151a44', bottom: '#3a3466', shade: '#6d72ad', glow: 1 },
];

export interface Lighting {
  skyTop: string;
  skyBottom: string;
  shade: string;
  glow: number;
  /** 나뭇잎 사이 햇살(코모레비) 세기 */
  sunlight: number;
}

export function lighting(time: number, weather: WeatherId): Lighting {
  let i = 0;
  while (i < SKY_KEYS.length - 2 && time > SKY_KEYS[i + 1].t) i++;
  const a = SKY_KEYS[i];
  const b = SKY_KEYS[i + 1];
  const t = Math.max(0, Math.min(1, (time - a.t) / (b.t - a.t)));
  let skyTop = mix(a.top, b.top, t);
  let skyBottom = mix(a.bottom, b.bottom, t);
  let shade = mix(a.shade, b.shade, t);
  const glow = a.glow + (b.glow - a.glow) * t;
  let sunlight = time < 16 * 60 ? 1 : Math.max(0, 1 - (time - 16 * 60) / 120);

  switch (weather) {
    case 'cloudy':
      skyTop = mix(skyTop, '#a9b6c2', 0.45);
      skyBottom = mix(skyBottom, '#d5dde3', 0.45);
      shade = mix(shade, '#e3e6ea', 0.25);
      sunlight *= 0.35;
      break;
    case 'rain':
      skyTop = mix(skyTop, '#8e99a6', 0.7);
      skyBottom = mix(skyBottom, '#b5bec8', 0.7);
      shade = mix(shade, '#c3c9d4', 0.5);
      sunlight = 0;
      break;
    case 'snow':
      skyTop = mix(skyTop, '#b9c3cf', 0.55);
      skyBottom = mix(skyBottom, '#e6ecf2', 0.55);
      shade = mix(shade, '#e0e6ee', 0.3);
      sunlight *= 0.15;
      break;
    case 'heatwave':
      skyBottom = mix(skyBottom, '#fff0b8', 0.45);
      shade = mix(shade, '#fff1d0', 0.35);
      break;
    case 'clear':
      break;
  }
  // 궂은 날엔 낮에도 창문 불빛이 은은하게 보인다
  const gloomy = WEATHER_INFO[weather].umbrella ? 0.25 : 0;
  return { skyTop, skyBottom, shade, glow: Math.max(glow, gloomy), sunlight };
}
