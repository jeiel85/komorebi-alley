/**
 * 인게임 카메라: 현재 골목 화면을 로파이 필터를 씌운 빈티지 엽서로 만든다.
 */

const SCALE = 4;
const BORDER = 44;
const BOTTOM = 150;

export function makePostcard(world: HTMLCanvasElement, caption: string, stamp: string): HTMLCanvasElement {
  const pw = world.width * SCALE;
  const ph = world.height * SCALE;
  const photo = canvas(pw, ph);
  const p = photo.getContext('2d')!;
  p.imageSmoothingEnabled = false;
  p.drawImage(world, 0, 0, pw, ph);

  // 바랜 필름 톤: 채도 살짝 빼고, 검정을 들어 올리고, 따뜻하게, 주변부 어둡게, 입자
  const img = p.getImageData(0, 0, pw, ph);
  const d = img.data;
  const cx = pw / 2;
  const cy = ph / 2;
  const maxD2 = cx * cx + cy * cy;
  let seed = 0x2545f491;
  for (let i = 0, n = 0; i < d.length; i += 4, n++) {
    const x = n % pw;
    const y = (n / pw) | 0;
    let r = d[i];
    let g = d[i + 1];
    let b = d[i + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    r += (l - r) * 0.18;
    g += (l - g) * 0.18;
    b += (l - b) * 0.18;
    r = 26 + r * 0.9;
    g = 18 + g * 0.9;
    b = 18 + b * 0.82;
    const v = 1 - 0.38 * (((x - cx) ** 2 + (y - cy) ** 2) / maxD2);
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const grain = ((seed >>> 24) - 128) / 14;
    d[i] = r * v + grain;
    d[i + 1] = g * v + grain;
    d[i + 2] = b * v + grain;
  }
  p.putImageData(img, 0, 0);
  // 빛 샘
  p.globalCompositeOperation = 'screen';
  const leak = p.createRadialGradient(0, 0, 0, 0, 0, pw * 0.45);
  leak.addColorStop(0, 'rgba(255,140,60,0.35)');
  leak.addColorStop(1, 'rgba(255,140,60,0)');
  p.fillStyle = leak;
  p.fillRect(0, 0, pw, ph);
  p.globalCompositeOperation = 'source-over';
  // 날짜 각인
  p.font = "bold 40px 'Courier New', monospace";
  p.textAlign = 'right';
  p.shadowColor = 'rgba(255,120,40,0.9)';
  p.shadowBlur = 10;
  p.fillStyle = '#ff9a4d';
  p.fillText(stamp, pw - 40, ph - 36);
  p.shadowBlur = 0;

  const card = canvas(pw + BORDER * 2, ph + BORDER + BOTTOM);
  const c = card.getContext('2d')!;
  c.fillStyle = '#fbf6ec';
  c.fillRect(0, 0, card.width, card.height);
  c.fillStyle = 'rgba(80,60,40,0.18)';
  c.fillRect(BORDER + 6, BORDER + 8, pw, ph);
  c.drawImage(photo, BORDER, BORDER);
  c.fillStyle = '#5b4a3a';
  c.font = "56px Jua, 'Gowun Dodum', 'Malgun Gothic', sans-serif";
  c.textAlign = 'left';
  c.textBaseline = 'middle';
  c.fillText(caption, BORDER + 6, ph + BORDER + BOTTOM / 2);
  // 소인
  const sx = card.width - BORDER - 80;
  const sy = ph + BORDER + BOTTOM / 2;
  c.strokeStyle = 'rgba(201,122,90,0.8)';
  c.lineWidth = 4;
  c.beginPath();
  c.arc(sx, sy, 52, 0, Math.PI * 2);
  c.stroke();
  c.beginPath();
  c.arc(sx, sy, 40, 0, Math.PI * 2);
  c.stroke();
  c.fillStyle = 'rgba(201,122,90,0.9)';
  c.font = "bold 18px 'Courier New', monospace";
  c.textAlign = 'center';
  c.fillText('KOMOREBI', sx, sy - 8);
  c.fillText('ALLEY', sx, sy + 14);
  return card;
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return cv;
}
