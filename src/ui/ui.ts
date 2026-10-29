import {
  BUILDINGS,
  CAT_BREED_NAMES,
  CAT_PERSONALITY_INFO,
  GOALS,
  GOAL_IDS,
  GROUND_Y,
  PROP_IDS,
  RESIDENT_INFO,
  SEASON_INFO,
  SHOP_IDS,
  STREET_TILES,
  TILE_PX,
  WEATHER_INFO,
  type BuildingType,
  type SeasonId,
} from '../sim/data.ts';
import { REASON_LABELS, type FeedbackReason } from '../sim/economy.ts';
import { Game, emptyShopStats, type DayReport, type GameEvent } from '../sim/game.ts';
import { catCapacity } from '../sim/cats.ts';
import { iGa } from '../sim/josa.ts';
import { SaveError, parseSave, serializeSave } from '../sim/save.ts';
import { buildingAtTile, synergyEffects, widthOf, type Building } from '../sim/street.ts';
import { dayInSeason, forecastNotes, type DayWeather } from '../sim/weather.ts';
import { makePostcard } from '../render/postcard.ts';
import { Renderer, type ViewState } from '../render/renderer.ts';
import { BUILDING_HEIGHT, drawBuilding } from '../render/sprites.ts';
import { downloadBlob, storeSave } from './storage.ts';
import { aromaFalloff } from '../sim/aroma.ts';

const yen = (n: number): string => `¥${Math.round(n).toLocaleString('ko-KR')}`;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

function $(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} 요소가 없어요`);
  return node;
}

function weatherText(w: DayWeather): string {
  const info = WEATHER_INFO[w.weather];
  return `${info.emoji} ${info.name} ${w.temp}°C`;
}

function clockText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function reasonText(type: BuildingType, reason: FeedbackReason): string {
  const def = BUILDINGS[type];
  if (def.kind === 'shop' && reason === 'tooHigh') return `“${def.tuning.tooHigh}”`;
  if (def.kind === 'shop' && reason === 'tooLow') return `“${def.tuning.tooLow}”`;
  return REASON_LABELS[reason];
}

/** 팔레트·패널에 쓰는 건물 썸네일 */
function thumbnail(type: BuildingType, season: SeasonId = 'spring'): HTMLCanvasElement {
  const def = BUILDINGS[type];
  const h = Math.max(BUILDING_HEIGHT[type], 36) + 12;
  const cv = document.createElement('canvas');
  cv.width = def.width * TILE_PX + 4;
  cv.height = h;
  const c = cv.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  c.translate(2, h - 2 - GROUND_Y);
  drawBuilding(c, type, 0, { season, snow: false, open: true }, []);
  return cv;
}

type Mode = { kind: 'none' } | { kind: 'build'; type: BuildingType } | { kind: 'demolish' };
type ModalKind = 'report' | 'menu' | 'postcard' | 'confirm';

export class UI {
  game: Game;
  readonly view: ViewState = { build: null, ghostX: null, demolish: false, selectedUid: null, hoverUid: null, hoverLocked: null, hoverCat: null };

  private renderer: Renderer;
  private mode: Mode = { kind: 'none' };
  private speed = 1;
  private lastSpeed = 1;
  private modalKind: ModalKind | null = null;
  private inspectorUid: number | null = null;
  private inspectorTimer = 0;
  private prepCollapsed = false;
  private saveFailedNotified = false;
  private lastMoney = -1;
  private seedFn: () => number;

  constructor(game: Game, renderer: Renderer, seedFn: () => number) {
    this.game = game;
    this.renderer = renderer;
    this.seedFn = seedFn;
    this.buildPalette();
    this.bindHud();
    this.bindPointer();
    this.bindKeys();
    this.bindResize();
    this.renderPrepCard();
  }

  /** 실제로 적용할 속도(모달이 열려 있으면 멈춤) */
  effectiveSpeed(): number {
    if (this.modalKind !== null) return 0;
    return this.speed;
  }

  update(dt: number): void {
    for (const e of this.game.drainEvents()) this.handleEvent(e);
    this.updateHud();
    this.inspectorTimer -= dt;
    if (this.inspectorUid !== null && this.inspectorTimer <= 0) {
      this.inspectorTimer = 0.4;
      this.refreshInspector();
    }
    if (this.game.s.money !== this.lastMoney) {
      this.lastMoney = this.game.s.money;
      this.refreshPalette();
    }
  }

  toast(icon: string, text: string): void {
    const box = $('toasts');
    const message = `${icon} ${text}`;
    // 같은 안내가 연달아 쌓이지 않게
    if (box.lastElementChild?.textContent === message && !box.lastElementChild.classList.contains('out')) return;
    const node = document.createElement('div');
    node.className = 'toast';
    node.textContent = message;
    box.appendChild(node);
    while (box.children.length > 3) box.firstElementChild?.remove();
    setTimeout(() => node.classList.add('out'), 3600);
    setTimeout(() => node.remove(), 4100);
  }

  // ---------------------------------------------------------- 저장

  private persist(): void {
    if (storeSave(this.game.s)) return;
    if (!this.saveFailedNotified) {
      this.saveFailedNotified = true;
      this.toast('⚠️', '브라우저에 저장하지 못했어요. 메뉴에서 저장 파일로 내보내 두세요.');
    }
  }

  private replaceGame(game: Game): void {
    this.game = game;
    this.setMode({ kind: 'none' });
    this.select(null);
    this.closeModal();
    this.prepCollapsed = false;
    this.lastMoney = -1;
    this.persist();
    this.renderPrepCard();
  }

  // ---------------------------------------------------------- 이벤트

  private handleEvent(e: GameEvent): void {
    switch (e.kind) {
      case 'toast':
        this.toast(e.icon, e.text);
        break;
      case 'goal':
        this.toast('🏅', `목표 달성: ${GOALS[e.id].name} — ${GOALS[e.id].desc}`);
        break;
      case 'phase':
        this.renderPrepCard();
        break;
      case 'dayEnd':
        this.setMode({ kind: 'none' });
        if (this.game.report) this.showReport(this.game.report);
        break;
      case 'newDay':
        this.persist();
        this.prepCollapsed = false;
        this.renderPrepCard();
        if (e.seasonChanged) {
          const info = SEASON_INFO[this.game.season];
          this.banner(`${info.emoji} ${info.name}`, info.arrival);
        }
        break;
      case 'mascot':
        this.banner('🔔 딸랑, 방울 소리', `${e.name}${iGa(e.name)} 골목의 마스코트가 되었어요! 고양이를 보러 관광객 팬이 찾아와요.`);
        break;
    }
  }

  private banner(big: string, text: string): void {
    const node = $('banner');
    node.innerHTML = `<div class="inner"><div class="big">${esc(big)}</div><p>${esc(text)}</p></div>`;
    node.classList.remove('hidden');
    // 애니메이션을 처음부터 다시 돌린다
    node.style.animation = 'none';
    void node.offsetWidth;
    node.style.animation = '';
    window.setTimeout(() => node.classList.add('hidden'), 3300);
  }

  // ---------------------------------------------------------- HUD

  private bindHud(): void {
    for (const btn of $('speed').querySelectorAll<HTMLButtonElement>('button')) {
      btn.addEventListener('click', () => this.setSpeed(Number(btn.dataset.speed)));
    }
    $('btn-photo').addEventListener('click', () => this.takePhoto());
    $('btn-menu').addEventListener('click', () => this.showMenu());
    this.setSpeed(1);
  }

  private setSpeed(s: number): void {
    if (s > 0) this.lastSpeed = s;
    this.speed = s;
    for (const btn of $('speed').querySelectorAll<HTMLButtonElement>('button')) btn.classList.toggle('on', Number(btn.dataset.speed) === s);
  }

  private updateHud(): void {
    const g = this.game;
    const season = SEASON_INFO[g.season];
    setText('hud-day', `${g.s.day}일차`);
    setText('hud-season', `${season.emoji} ${season.name} ${dayInSeason(g.s.day)}/4${g.festival ? ` · ${season.festival.emoji} ${season.festival.name}` : ''}`);
    $('hud-season').classList.toggle('festival', g.festival);
    setText('hud-weather', weatherText(g.s.today));
    setText('hud-clock', g.phase === 'prep' ? '아침 준비' : g.phase === 'accounting' ? '결산' : `${g.closingTime ? '마감 ' : ''}${clockText(g.time)}`);
    setText('hud-money', yen(g.s.money));
    const happy = g.phase === 'business' ? g.liveHappiness : g.s.lastHappiness;
    const bar = $('hud-happy').querySelector('i') as HTMLElement;
    bar.style.width = `${Math.round(happy)}%`;
    setText('hud-happy-value', String(Math.round(happy)));
    ($('hud-happy').querySelector('.happy-icon') as HTMLElement).textContent = happy >= 75 ? '😊' : happy >= 55 ? '🙂' : '😐';
  }

  // ---------------------------------------------------------- 팔레트

  private buildPalette(): void {
    const pal = $('palette');
    pal.innerHTML = '';
    const section = (label: string, ids: readonly BuildingType[]): void => {
      const lab = document.createElement('div');
      lab.className = 'palette-label';
      lab.textContent = label;
      pal.appendChild(lab);
      for (const id of ids) {
        const def = BUILDINGS[id];
        const btn = document.createElement('button');
        btn.className = 'build-card';
        btn.dataset.type = id;
        btn.title = `${def.name} (${def.width}칸) — ${def.desc}`;
        btn.appendChild(thumbnail(id));
        btn.insertAdjacentHTML('beforeend', `<span class="name">${esc(def.name)}</span><span class="cost">${yen(def.cost)}</span>`);
        btn.addEventListener('click', () => {
          if (this.mode.kind === 'build' && this.mode.type === id) this.setMode({ kind: 'none' });
          else this.setMode({ kind: 'build', type: id });
        });
        pal.appendChild(btn);
      }
    };
    section('가게', SHOP_IDS);
    section('소품', PROP_IDS);
    const tool = document.createElement('button');
    tool.className = 'tool-card';
    tool.id = 'tool-demolish';
    tool.innerHTML = '🔨<br>철거';
    tool.title = '건물을 철거하고 비용의 절반을 돌려받아요';
    tool.addEventListener('click', () => this.setMode(this.mode.kind === 'demolish' ? { kind: 'none' } : { kind: 'demolish' }));
    pal.appendChild(tool);
  }

  private refreshPalette(): void {
    for (const btn of $('palette').querySelectorAll<HTMLButtonElement>('.build-card')) {
      const type = btn.dataset.type as BuildingType;
      btn.classList.toggle('poor', this.game.s.money < BUILDINGS[type].cost);
      btn.classList.toggle('on', this.mode.kind === 'build' && this.mode.type === type);
    }
    $('tool-demolish').classList.toggle('on', this.mode.kind === 'demolish');
  }

  private setMode(mode: Mode): void {
    if (mode.kind !== 'none' && this.game.phase === 'accounting') return;
    this.mode = mode;
    this.view.build = mode.kind === 'build' ? mode.type : null;
    this.view.demolish = mode.kind === 'demolish';
    this.view.ghostX = null;
    if (mode.kind !== 'none') {
      this.select(null);
      this.collapsePrepCard();
    }
    const ov = this.renderer.overlay;
    ov.classList.toggle('cursor-build', mode.kind === 'build');
    ov.classList.toggle('cursor-demolish', mode.kind === 'demolish');
    this.refreshPalette();
  }

  // ---------------------------------------------------------- 포인터

  private bindPointer(): void {
    const ov = this.renderer.overlay;
    ov.addEventListener('pointermove', (e) => this.hover(e.clientX, e.clientY));
    ov.addEventListener('pointerleave', (e) => {
      // 터치는 손을 떼면 leave가 오므로 미리보기를 지우지 않는다
      if (e.pointerType !== 'mouse') return;
      this.view.hoverUid = null;
      this.view.hoverLocked = null;
      this.view.hoverCat = null;
      this.view.ghostX = null;
    });
    ov.addEventListener('contextmenu', (e) => e.preventDefault());
    ov.addEventListener('pointerdown', (e) => {
      if (e.button === 2) {
        this.setMode({ kind: 'none' });
        return;
      }
      const prevGhost = this.view.ghostX;
      this.hover(e.clientX, e.clientY);
      // 터치는 마우스처럼 미리보기를 볼 수 없으니, 같은 자리를 한 번 더 눌러야 짓는다
      if (this.mode.kind === 'build' && e.pointerType !== 'mouse' && prevGhost !== this.view.ghostX) {
        this.toast('👆', '미리보기 자리를 한 번 더 누르면 지어요.');
        return;
      }
      this.click();
    });
  }

  private hover(clientX: number, clientY: number): void {
    const { x, y } = this.renderer.screenToWorld(clientX, clientY);
    const g = this.game;
    if (this.mode.kind === 'build') {
      const w = widthOf(this.mode.type);
      this.view.ghostX = Math.max(0, Math.min(STREET_TILES - w, Math.round(x / TILE_PX - w / 2)));
      return;
    }
    this.view.hoverCat = this.mode.kind === 'none' ? this.renderer.catAt(g, x, y) : null;
    const tile = this.view.hoverCat === null ? this.renderer.tileAt(x, y) : null;
    const b = tile === null ? undefined : buildingAtTile(g.s.buildings, tile);
    this.view.hoverUid = b?.uid ?? null;
    this.view.hoverLocked = tile !== null && !b && !g.s.unlocked[tile] && this.mode.kind === 'none' && g.phase !== 'accounting' ? tile : null;
    this.renderer.overlay.classList.toggle('cursor-pointer', this.view.hoverCat !== null || this.view.hoverUid !== null || this.view.hoverLocked !== null);
  }

  private click(): void {
    const g = this.game;
    const mode = this.mode;
    if (mode.kind === 'build') {
      if (this.view.ghostX === null) return;
      const res = g.place(mode.type, this.view.ghostX);
      if (!res.ok) {
        this.toast('🚧', res.reason);
        return;
      }
      if (g.phase === 'prep') this.persist();
      const placed = g.s.buildings.find((b) => b.type === mode.type && b.x === this.view.ghostX);
      this.setMode({ kind: 'none' });
      if (placed) this.select(placed.uid);
      this.renderPrepCard();
      return;
    }
    if (mode.kind === 'demolish') {
      const b = g.building(this.view.hoverUid);
      if (!b) return;
      const def = BUILDINGS[b.type];
      const catWarn = (b.type === 'feeder' || b.type === 'catTower') && g.s.cats.length > 0 ? ' 고양이 쉼터가 줄면 내일 아침 고양이가 떠날 수 있어요.' : '';
      this.confirm(`${def.icon} ${def.name} 철거`, `철거하면 ${yen(g.refundOf(b.uid))}을 돌려받아요.${catWarn}`, '철거', () => {
        const res = g.demolish(b.uid);
        if (!res.ok) this.toast('🚧', res.reason);
        else if (g.phase === 'prep') this.persist();
        this.setMode({ kind: 'none' });
        this.renderPrepCard();
      });
      return;
    }
    if (this.view.hoverCat !== null) {
      g.petCat(this.view.hoverCat);
      return;
    }
    if (this.view.hoverLocked !== null) {
      const x = this.view.hoverLocked;
      const cost = g.unlockCost();
      this.confirm('공터 확장', `이 공터를 ${yen(cost)}에 사서 골목을 넓힐까요?`, '확장', () => {
        const res = g.unlock(x);
        if (!res.ok) this.toast('🚧', res.reason);
        else if (g.phase === 'prep') this.persist();
      });
      return;
    }
    this.select(this.view.hoverUid);
  }

  // ---------------------------------------------------------- 키보드·크기

  private bindKeys(): void {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Escape') {
        if (this.modalKind && this.modalKind !== 'report') this.closeModal();
        else if (this.mode.kind !== 'none') this.setMode({ kind: 'none' });
        else this.select(null);
      } else if (this.modalKind) {
        return;
      } else if (e.key === ' ') {
        e.preventDefault();
        this.setSpeed(this.speed === 0 ? this.lastSpeed : 0);
      } else if (e.key === '1' || e.key === '2' || e.key === '3') {
        this.setSpeed(Number(e.key));
      } else if (e.key === 'p' || e.key === 'P') {
        this.takePhoto();
      }
    });
  }

  private bindResize(): void {
    const stage = $('stage');
    const fit = (): void => this.renderer.resize(stage.clientWidth - 16, stage.clientHeight - 16);
    new ResizeObserver(fit).observe(stage);
    fit();
  }

  // ---------------------------------------------------------- 아침 준비 카드

  private renderPrepCard(): void {
    const card = $('prep-card');
    const g = this.game;
    if (g.phase !== 'prep') {
      card.classList.add('hidden');
      return;
    }
    card.classList.remove('hidden');
    card.classList.toggle('mini', this.prepCollapsed);
    if (this.prepCollapsed) {
      card.innerHTML = `<div class="row"><button class="primary" data-act="open">🔔 영업 시작</button><button data-act="expand">예보 보기</button></div>`;
    } else {
      const season = SEASON_INFO[g.season];
      const notes = forecastNotes(g.season, g.s.today.weather, g.festival);
      const shops = g.s.buildings.filter((b) => BUILDINGS[b.type].kind === 'shop').length;
      const hint =
        shops === 0
          ? '아래 팔레트에서 가게를 골라 골목에 지어 보세요. 처음엔 라멘 노점과 자판기를 추천해요.'
          : WEATHER_INFO[g.s.today.weather].umbrella
            ? '궂은 날엔 처마 있는 가게로 손님이 몰려요. 자판기 온도도 확인해 보세요.'
            : '가게를 누르면 맛과 가격을 바꿀 수 있어요. 손님 말풍선이 힌트예요.';
      card.innerHTML = `
        <button class="collapse" data-act="collapse" title="접기">접기</button>
        <h2>☀️ ${g.s.day}일차 아침</h2>
        <p class="weather-line">${season.emoji} ${season.name} ${dayInSeason(g.s.day)}/4일 · ${esc(weatherText(g.s.today))}</p>
        ${g.festival ? `<p><span class="chip festival">${season.festival.emoji} 오늘은 ${esc(season.festival.name)}</span> ${esc(season.festival.desc)}</p>` : ''}
        ${notes.length ? `<ul>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '<p class="note">평범한 하루가 될 것 같아요.</p>'}
        <div class="row">
          <button class="primary" data-act="open">🔔 영업 시작</button>
          <span class="note">내일 예보: ${esc(weatherText(g.s.tomorrow))}</span>
        </div>
        <p class="hint">${esc(hint)}</p>`;
    }
    card.querySelector('[data-act="open"]')?.addEventListener('click', () => {
      const res = this.game.startBusiness();
      if (!res.ok) this.toast('🚧', res.reason);
      if (this.speed === 0) this.setSpeed(this.lastSpeed);
    });
    card.querySelector('[data-act="collapse"]')?.addEventListener('click', () => {
      this.prepCollapsed = true;
      this.renderPrepCard();
    });
    card.querySelector('[data-act="expand"]')?.addEventListener('click', () => {
      this.prepCollapsed = false;
      this.renderPrepCard();
    });
  }

  // ---------------------------------------------------------- 가게 패널

  private select(uid: number | null): void {
    this.view.selectedUid = uid;
    this.inspectorUid = uid;
    const panel = $('inspector');
    const b = this.game.building(uid);
    if (!b) {
      panel.classList.add('hidden');
      this.inspectorUid = null;
      return;
    }
    panel.classList.remove('hidden');
    this.buildInspector(b);
    this.inspectorTimer = 0;
    this.collapsePrepCard();
  }

  /** 건설·가게 조절 중엔 아침 카드가 골목을 가리지 않게 접는다 */
  private collapsePrepCard(): void {
    if (this.prepCollapsed || this.game.phase !== 'prep') return;
    this.prepCollapsed = true;
    this.renderPrepCard();
  }

  private buildInspector(b: Building): void {
    const panel = $('inspector');
    const def = BUILDINGS[b.type];
    panel.innerHTML = '';
    const header = document.createElement('header');
    header.appendChild(thumbnail(b.type, this.game.season));
    header.insertAdjacentHTML(
      'beforeend',
      `<div><h3>${esc(def.name)}</h3><div class="stars" data-f="stars"></div></div><button class="close" title="닫기">✕</button>`,
    );
    header.querySelector('.close')!.addEventListener('click', () => this.select(null));
    panel.appendChild(header);

    if (def.kind === 'shop') {
      panel.insertAdjacentHTML(
        'beforeend',
        `<div class="stats">
          <div>오늘 손님<b data-f="customers">0</b></div>
          <div>오늘 매출<b data-f="revenue">¥0</b></div>
          <div>만족도<b data-f="sat">–</b></div>
        </div>
        <label class="slider"><div class="slider-head"><span>${esc(def.tuning.label)}</span><output data-f="tuning-out"></output></div>
          <input type="range" min="0" max="10" step="1" data-f="tuning" />
          <div class="slider-ends"><span>${esc(def.tuning.low)}</span><span>${esc(def.tuning.high)}</span></div></label>
        <label class="slider"><div class="slider-head"><span>가격</span><output data-f="price-out"></output></div>
          <input type="range" min="${def.price.min}" max="${def.price.max}" step="${def.price.step}" data-f="price" />
          <div class="slider-ends"><span>${yen(def.price.min)}</span><span>${yen(def.price.max)}</span></div></label>
        <div class="chips" data-f="chips"></div>
        <p class="note" data-f="aroma"></p>
        <h4>손님 목소리</h4>
        <ul class="feedback" data-f="feedback"></ul>`,
      );
      const tuning = panel.querySelector<HTMLInputElement>('[data-f="tuning"]')!;
      const price = panel.querySelector<HTMLInputElement>('[data-f="price"]')!;
      tuning.value = String(b.tuning);
      price.value = String(b.price);
      const sync = (): void => {
        const cur = this.game.building(b.uid);
        if (!cur) return;
        setField(panel, 'tuning-out', `${cur.tuning} / 10`);
        setField(panel, 'price-out', yen(cur.price));
      };
      tuning.addEventListener('input', () => {
        this.game.setTuning(b.uid, Number(tuning.value));
        sync();
      });
      price.addEventListener('input', () => {
        this.game.setPrice(b.uid, Number(price.value));
        sync();
      });
      const persistIfPrep = (): void => {
        if (this.game.phase === 'prep') this.persist();
      };
      tuning.addEventListener('change', persistIfPrep);
      price.addEventListener('change', persistIfPrep);
      sync();
    } else {
      panel.insertAdjacentHTML('beforeend', `<p class="note">${esc(def.desc)}</p><div data-f="prop"></div>`);
    }
    const foot = document.createElement('div');
    foot.className = 'actions';
    foot.style.marginTop = '10px';
    const demolish = document.createElement('button');
    demolish.className = 'danger';
    demolish.textContent = `철거 (환급 ${yen(this.game.refundOf(b.uid))})`;
    demolish.addEventListener('click', () => {
      this.confirm(`${def.icon} ${def.name} 철거`, `철거하면 ${yen(this.game.refundOf(b.uid))}을 돌려받아요.`, '철거', () => {
        const res = this.game.demolish(b.uid);
        if (!res.ok) this.toast('🚧', res.reason);
        else if (this.game.phase === 'prep') this.persist();
        this.select(null);
        this.renderPrepCard();
      });
    });
    foot.appendChild(demolish);
    panel.appendChild(foot);
  }

  private refreshInspector(): void {
    const g = this.game;
    const b = g.building(this.inspectorUid);
    const panel = $('inspector');
    if (!b) {
      this.select(null);
      return;
    }
    const def = BUILDINGS[b.type];
    if (def.kind === 'shop') {
      const st = g.stats.shops[b.uid] ?? emptyShopStats();
      setField(panel, 'stars', `${'★'.repeat(Math.max(1, Math.round(b.rating * 5)))}${'☆'.repeat(5 - Math.max(1, Math.round(b.rating * 5)))} 평판`);
      setField(panel, 'customers', String(st.customers));
      setField(panel, 'revenue', yen(st.revenue));
      setField(panel, 'sat', st.customers > 0 ? `${Math.round((st.satisfactionSum / st.customers) * 100)}%` : '–');
      const syn = synergyEffects(g.s.buildings, b);
      const chips = panel.querySelector('[data-f="chips"]') as HTMLElement;
      const chipHtml = syn.active.map((s) => `<span class="syn${s.negative ? ' bad' : ''}">${s.negative ? '💢' : '✨'} ${esc(s.name)} · ${esc(s.desc)}</span>`).join('');
      if (chips.innerHTML !== chipHtml) chips.innerHTML = chipHtml;
      const aroma = def.aroma
        ? `♨️ ${def.aroma.label}${iGa(def.aroma.label)} ${def.aroma.radius}칸까지 퍼져요. 오늘 향기에 이끌려 되돌아온 손님 ${st.aromaPulls}명.`
        : `${def.indoor ? '🏠 실내' : '🧺 가판'} · 손님 ${def.capacity}명까지 · 머무는 시간 약 ${Math.round(def.serviceMin * syn.dwell)}분`;
      setField(panel, 'aroma', aroma);
      const list = g.feedback.get(b.uid) ?? [];
      const fbHtml = list.length
        ? list.map((f) => `<li class="${f.mood}">${RESIDENT_INFO[f.resident].icon} ${esc(f.text)}</li>`).join('')
        : '<li class="note">아직 들은 이야기가 없어요.</li>';
      const fb = panel.querySelector('[data-f="feedback"]') as HTMLElement;
      if (fb.innerHTML !== fbHtml) fb.innerHTML = fbHtml;
    } else {
      setField(panel, 'stars', '');
      const prop = panel.querySelector('[data-f="prop"]') as HTMLElement;
      let html = '';
      if (b.type === 'feeder' || b.type === 'catTower') {
        const cats = g.s.cats;
        html = `<p class="note">고양이 정원 ${cats.filter((c) => !c.legendary).length} / ${catCapacity(g.s.buildings)}</p>`;
        html += cats.length
          ? `<ul class="feedback">${cats
              .map((c) => `<li>${c.legendary ? '🔔' : '🐈'} ${esc(c.name)} · ${CAT_BREED_NAMES[c.breed]} · ${CAT_PERSONALITY_INFO[c.personality].name} · 💕${c.affection}</li>`)
              .join('')}</ul>`
          : '<p class="note">아직 찾아온 고양이가 없어요. 아침이나 점심 무렵에 찾아와요.</p>';
      } else if (b.type === 'lantern') {
        html = `<p class="note">저녁(17시~)에 손님이 늘어나요. ${g.season === 'winter' ? '겨울이라 효과가 2배예요.' : ''}</p>`;
      } else if (b.type === 'bench') {
        const near = g.s.buildings.filter((o) => o.uid !== b.uid && Math.abs(o.x - b.x) <= 2 && aromaFalloff(o, b.x) > 0);
        html = `<p class="note">${near.length ? '향기 나는 가게 옆이라 쉬어 가는 손님이 간식을 사 먹어요.' : '비·눈 오는 날엔 아무도 앉지 않아요.'}</p>`;
      }
      if (prop.innerHTML !== html) prop.innerHTML = html;
    }
  }

  // ---------------------------------------------------------- 모달

  private openModal(kind: ModalKind, html: string): HTMLElement {
    this.modalKind = kind;
    const back = $('modal');
    const box = back.querySelector('.modal') as HTMLElement;
    box.innerHTML = html;
    back.classList.remove('hidden');
    return box;
  }

  private closeModal(): void {
    this.modalKind = null;
    $('modal').classList.add('hidden');
  }

  private confirm(title: string, body: string, okLabel: string, onOk: () => void): void {
    const box = this.openModal(
      'confirm',
      `<h2>${esc(title)}</h2><p>${esc(body)}</p><div class="actions"><button data-act="cancel">취소</button><button class="primary" data-act="ok">${esc(okLabel)}</button></div>`,
    );
    box.querySelector('[data-act="cancel"]')!.addEventListener('click', () => this.closeModal());
    box.querySelector('[data-act="ok"]')!.addEventListener('click', () => {
      this.closeModal();
      onOk();
    });
  }

  private showReport(r: DayReport): void {
    const season = SEASON_INFO[r.season];
    const delta = (cur: number, prev: number): string => {
      const d = Math.round((cur - prev) * 10) / 10;
      if (Math.abs(d) < 0.05) return '<span class="delta">–</span>';
      return `<span class="delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'}${Math.abs(d)}</span>`;
    };
    const rows = r.shops
      .map((s) => {
        const def = BUILDINGS[s.type];
        const voice = s.topReason ? `${reasonText(s.type, s.topReason)} ×${s.topReasonCount}` : '–';
        return `<tr><td>${def.icon} ${esc(def.name)}</td><td class="num">${s.customers}</td><td class="num">${yen(s.revenue)}</td><td class="num">${s.avgSatisfaction === null ? '–' : `${Math.round(s.avgSatisfaction * 100)}%`}</td><td>${esc(voice)}</td></tr>`;
      })
      .join('');
    const notes: string[] = [];
    if (r.aromaPulls) notes.push(`♨️ 향기에 이끌려 되돌아온 손님 ${r.aromaPulls}명`);
    if (r.refusals) notes.push(`💸 너무 비싸 돌아선 손님 ${r.refusals}명`);
    if (r.catPets) notes.push(`🐈 고양이를 쓰다듬은 손님 ${r.catPets}명`);
    if (r.playerPets) notes.push(`🫳 내가 쓰다듬은 횟수 ${r.playerPets}번`);
    const goals = r.goals.map((id) => `<li class="done">🏅 ${esc(GOALS[id].name)} <small>${esc(GOALS[id].desc)}</small></li>`).join('');
    const tomorrowSeason = SEASON_INFO[r.tomorrowSeason];
    const box = this.openModal(
      'report',
      `<h2>🌙 ${r.day}일차 결산</h2>
       <p class="note">${season.emoji} ${season.name} · ${esc(weatherText(r.weather))}${r.festival ? ` · ${season.festival.emoji} ${esc(season.festival.name)}` : ''}</p>
       <div class="kpis">
         <div>매출<b>${yen(r.revenue)}</b></div>
         <div>구매 손님<b>${r.customers}</b>지나간 사람 ${r.visitors}</div>
         <div>평균 행복도<b>${Math.round(r.avgHappiness)}</b>${delta(r.avgHappiness, r.prevHappiness)}</div>
         <div>골목 인기도<b>${Math.round(r.popularity)}</b>${delta(r.popularity, r.prevPopularity)}</div>
       </div>
       ${rows ? `<table><thead><tr><th>가게</th><th class="num">손님</th><th class="num">매출</th><th class="num">만족</th><th>가장 많이 들은 말</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="note">아직 가게가 없어 지나가기만 했어요.</p>'}
       ${notes.length ? `<p class="note">${notes.map(esc).join(' · ')}</p>` : ''}
       ${goals ? `<ul class="goal-list">${goals}</ul>` : ''}
       <p class="note">내일 예보: ${tomorrowSeason.emoji} ${tomorrowSeason.name} · ${esc(weatherText(r.tomorrow))}${r.tomorrowSeason !== r.season ? ' — 계절이 바뀌어요!' : ''}</p>
       <div class="actions"><button class="primary" data-act="next">다음 날 아침으로 ▶</button></div>`,
    );
    box.querySelector('[data-act="next"]')!.addEventListener('click', () => {
      this.closeModal();
      const res = this.game.advanceDay();
      if (!res.ok) this.toast('🚧', res.reason);
    });
  }

  private showMenu(): void {
    if (this.modalKind === 'report') return;
    const g = this.game;
    const goals = GOAL_IDS.map((id) => {
      const done = g.s.goals.includes(id);
      return `<li class="${done ? 'done' : ''}">${done ? '✅' : '⬜'} ${esc(GOALS[id].name)} <small>${esc(GOALS[id].desc)}</small></li>`;
    }).join('');
    const box = this.openModal(
      'menu',
      `<h2>☰ 메뉴</h2>
       <p class="note">${g.s.day}일차 · 누적 매출 ${yen(g.s.totalRevenue)} · 하루 최고 ${yen(g.s.bestDayRevenue)} · 인기도 ${Math.round(g.s.popularity)}</p>
       <h4>골목 목표</h4><ul class="goal-list">${goals}</ul>
       <h4>저장</h4>
       <p class="note">매일 아침(준비 단계)에 이 브라우저에 자동 저장돼요. 영업 중에 창을 닫으면 그날 아침으로 돌아가요.</p>
       <div class="actions" style="justify-content:flex-start">
         <button data-act="export">💾 저장 파일 내보내기</button>
         <button data-act="import">📂 저장 파일 불러오기</button>
         <button class="danger" data-act="new">새 골목 시작</button>
       </div>
       <input type="file" accept="application/json,.json" data-act="file" hidden />
       <details class="help"><summary>도움말</summary>
         <ul>
           <li>아침에 날씨 예보를 보고 가게를 짓거나 맛·가격을 조절한 뒤 <b>영업 시작</b>을 눌러요.</li>
           <li>손님 말풍선이 힌트예요. “싱거워요/짜요”는 맛 슬라이더, “비싸요”는 가격을 뜻해요. 손님 유형마다 입맛이 달라요.</li>
           <li>베이커리·라멘·붕어빵의 <b>향기</b>는 옆 칸까지 퍼져 지나가던 사람을 붙잡거나 되돌아오게 해요.</li>
           <li>가게를 <b>붙여 지으면</b> 시너지가 생겨요(책과 차, 빵과 차, 벤치 간식). 라멘 냄새는 찻집·헌책방이 싫어해요.</li>
           <li>비 오는 날엔 라멘, 폭염엔 빙수와 차가운 자판기, 가을엔 헌책방·붕어빵, 겨울엔 등롱이 빛나요.</li>
           <li>급식소를 놓으면 길고양이가 찾아오고, 손님과 당신이 쓰다듬을 수 있어요. 특별한 고양이도 있다는 소문이…</li>
           <li>단축키: Space 일시정지 · 1/2/3 속도 · P 엽서 · Esc 취소</li>
         </ul>
       </details>
       <div class="actions"><button class="primary" data-act="close">닫기</button></div>`,
    );
    box.querySelector('[data-act="close"]')!.addEventListener('click', () => this.closeModal());
    box.querySelector('[data-act="export"]')!.addEventListener('click', () => {
      downloadBlob(`komorebi-alley-day${g.s.day}.json`, new Blob([serializeSave(g.s)], { type: 'application/json' }));
    });
    const file = box.querySelector<HTMLInputElement>('[data-act="file"]')!;
    box.querySelector('[data-act="import"]')!.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      try {
        const state = parseSave(await f.text());
        this.confirm('저장 파일 불러오기', `${state.day}일차 골목을 불러올까요? 지금 진행 중인 골목은 사라져요.`, '불러오기', () => {
          this.replaceGame(new Game(this.seedFn(), state));
          this.toast('📂', `${state.day}일차 골목을 불러왔어요.`);
        });
      } catch (err) {
        if (!(err instanceof SaveError)) console.error(err);
        this.toast('⚠️', `불러오지 못했어요: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
    box.querySelector('[data-act="new"]')!.addEventListener('click', () => {
      this.confirm('새 골목 시작', '지금 골목의 진행 상황이 사라져요. 필요하면 먼저 저장 파일로 내보내세요.', '새로 시작', () => {
        this.replaceGame(new Game(this.seedFn()));
        this.toast('🌱', '새 골목을 시작했어요.');
      });
    });
  }

  private takePhoto(): void {
    if (this.modalKind) return;
    const g = this.game;
    const season = SEASON_INFO[g.season];
    const caption = `코모레비 앨리 · ${season.name} ${g.s.day}일차 · ${WEATHER_INFO[g.s.today.weather].name}`;
    const now = new Date();
    const stamp = `'${String(now.getFullYear()).slice(2)} ${String(now.getMonth() + 1).padStart(2, '0')} ${String(now.getDate()).padStart(2, '0')}`;
    // 건설 표시·선택 테두리 없이 지금 장면을 한 번 새로 그려서 찍는다(탭이 백그라운드였어도 빈 사진이 되지 않게)
    this.renderer.render(g, { build: null, ghostX: null, demolish: false, selectedUid: null, hoverUid: null, hoverLocked: null, hoverCat: null }, 0);
    const card = makePostcard(this.renderer.world, caption, stamp);
    const url = card.toDataURL('image/png');
    const box = this.openModal(
      'postcard',
      `<h2>📷 엽서</h2><img class="postcard-img" alt="${esc(caption)}" src="${url}" />
       <div class="actions"><button data-act="close">닫기</button><button class="primary" data-act="save">PNG로 저장</button></div>`,
    );
    box.querySelector('[data-act="close"]')!.addEventListener('click', () => this.closeModal());
    box.querySelector('[data-act="save"]')!.addEventListener('click', () => {
      card.toBlob((blob) => {
        if (blob) downloadBlob(`komorebi-postcard-day${g.s.day}.png`, blob);
        else this.toast('⚠️', '엽서 이미지를 만들지 못했어요.');
      }, 'image/png');
    });
  }
}

function setText(id: string, text: string): void {
  const node = document.getElementById(id);
  if (node && node.textContent !== text) node.textContent = text;
}

function setField(root: HTMLElement, field: string, text: string): void {
  const node = root.querySelector(`[data-f="${field}"]`);
  if (node && node.textContent !== text) node.textContent = text;
}
