import './ui/style.css';
import { GAME_MIN_PER_SEC } from './sim/data.ts';
import { Game } from './sim/game.ts';
import { Renderer } from './render/renderer.ts';
import { loadStoredSave, storeSave } from './ui/storage.ts';
import { UI } from './ui/ui.ts';

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

const renderer = new Renderer(document.getElementById('world') as HTMLCanvasElement, document.getElementById('overlay') as HTMLCanvasElement);
const loaded = loadStoredSave();
const ui = new UI(new Game(randomSeed(), loaded.state ?? undefined), renderer, randomSeed);
if (loaded.error) ui.toast('⚠️', loaded.error);
if (!loaded.state) storeSave(ui.game.s);
else ui.toast('🌤️', `${ui.game.s.day}일차 아침부터 이어서 해요.`);

// 개발 서버에서만 콘솔 점검용 핸들을 연다(프로덕션 빌드에서는 제거된다)
if (import.meta.env.DEV) Object.assign(window, { komorebi: { ui, renderer } });

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const speed = ui.effectiveSpeed();
  const game = ui.game;
  if (speed > 0) {
    game.tick(dt * GAME_MIN_PER_SEC * speed);
    game.updateRealtime(dt);
  }
  ui.update(dt);
  renderer.render(game, ui.view, speed > 0 ? dt : 0);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
