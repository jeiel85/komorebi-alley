import type { Effect, Game } from '../sim/game.ts';

/**
 * Web Audio로 그 자리에서 만드는 소리. 오디오 파일은 쓰지 않는다.
 * - 음악: 느린 로파이 코드 진행(건반·베이스·부드러운 북) + 레코드 잡음
 * - 환경음: 빗소리(눈 오는 날은 작고 먹먹하게), 손님 수에 따른 웅성거림, 여름 풍경(風鈴)
 * - 효과음: 동전, 고양이, 건설·업그레이드, 목표 달성, 마감 종
 * 브라우저 자동 재생 정책 때문에 첫 클릭·키 입력 때 켠다(unlock). 연출이라 Math.random을 쓴다.
 */

const PREF_KEY = 'komorebi-alley/sound';
const BPM = 68;
const EIGHTH = 60 / BPM / 2;
const STEPS_PER_BAR = 8;
const LOOKAHEAD = 0.25;
const COIN_GAP = 0.09;

const midi = (n: number): number => 440 * 2 ** ((n - 69) / 12);

/** Gmaj7 → F#m7 → Em7 → Dmaj7 (MIDI 음 번호, 가운데 도 = 60) */
const CHORDS: readonly (readonly number[])[] = [
  [55, 59, 62, 66],
  [54, 57, 61, 64],
  [52, 55, 59, 62],
  [50, 54, 57, 61],
];
/** D 장조 5음 음계(멜로디용, 한 옥타브 위) */
const MELODY = [74, 76, 78, 81, 83, 86];

function readPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

function writePref(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch {
    // 저장소를 못 써도 이번 세션 동안은 설정이 유지된다
  }
}

interface Graph {
  ctx: AudioContext;
  master: GainNode;
  music: GainNode;
  sfx: GainNode;
  rain: GainNode;
  rainFilter: BiquadFilterNode;
  crowd: GainNode;
  noise: AudioBuffer;
}

export class Sound {
  private g: Graph | null = null;
  private on = readPref();
  private nextStep = 0;
  private step = 0;
  private nextChime = 0;
  private lastCoin = 0;
  private seen = new WeakSet<Effect>();

  get enabled(): boolean {
    return this.on;
  }

  /** 사용자 입력 안에서 불러야 소리가 난다. 여러 번 불러도 된다. */
  unlock(): void {
    if (!this.on) return;
    if (!this.g) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.g = this.createGraph(new Ctor());
      } catch (err) {
        console.error('오디오를 켜지 못했어요', err);
        return;
      }
    }
    if (this.g.ctx.state === 'suspended') void this.g.ctx.resume();
  }

  setEnabled(on: boolean): void {
    this.on = on;
    writePref(on);
    if (on) this.unlock();
    else if (this.g && this.g.ctx.state === 'running') void this.g.ctx.suspend();
  }

  /** 매 프레임. 음악 예약, 환경음 세기, 새로 생긴 동전·하트 효과음. */
  update(game: Game): void {
    const g = this.g;
    if (!g || !this.on || g.ctx.state !== 'running') return;
    const now = g.ctx.currentTime;
    if (this.nextStep < now) this.nextStep = now + 0.05;
    while (this.nextStep < now + LOOKAHEAD) {
      this.playStep(this.step, this.nextStep);
      this.step = (this.step + 1) % (STEPS_PER_BAR * CHORDS.length);
      this.nextStep += EIGHTH;
    }

    const weather = game.s.today.weather;
    const rain = weather === 'rain' ? 0.22 : weather === 'snow' ? 0.06 : 0;
    g.rain.gain.setTargetAtTime(rain, now, 0.8);
    g.rainFilter.frequency.setTargetAtTime(weather === 'snow' ? 450 : 1400, now, 0.5);
    const walkers = game.phase === 'business' ? game.peds.filter((p) => p.state !== 'inside').length : 0;
    g.crowd.gain.setTargetAtTime(Math.min(walkers, 30) * 0.004, now, 1.2);

    if (game.season === 'summer' && weather !== 'rain' && now >= this.nextChime) {
      if (this.nextChime > 0) this.windChime(now);
      this.nextChime = now + 6 + Math.random() * 10;
    }

    for (const e of game.effects) {
      if (this.seen.has(e)) continue;
      this.seen.add(e);
      if (e.age > 0.2) continue;
      if (e.kind === 'coin') this.coin();
      else this.meow();
    }
  }

  // ---------------------------------------------------------- 효과음

  coin(): void {
    const g = this.ready();
    if (!g) return;
    const t = g.ctx.currentTime;
    if (t - this.lastCoin < COIN_GAP) return;
    this.lastCoin = t;
    this.tone(g.sfx, 'square', midi(88), t, 0.07, 0.05);
    this.tone(g.sfx, 'square', midi(95), t + 0.06, 0.16, 0.05);
  }

  meow(): void {
    const g = this.ready();
    if (!g) return;
    const t = g.ctx.currentTime;
    const o = g.ctx.createOscillator();
    const f = g.ctx.createBiquadFilter();
    const v = g.ctx.createGain();
    o.type = 'sawtooth';
    const base = 520 + Math.random() * 160;
    o.frequency.setValueAtTime(base, t);
    o.frequency.linearRampToValueAtTime(base * 1.5, t + 0.12);
    o.frequency.linearRampToValueAtTime(base * 0.9, t + 0.4);
    f.type = 'bandpass';
    f.frequency.setValueAtTime(1200, t);
    f.frequency.linearRampToValueAtTime(1800, t + 0.15);
    f.frequency.linearRampToValueAtTime(900, t + 0.4);
    f.Q.value = 4;
    this.envelope(v, t, 0.03, 0.4, 0.09);
    o.connect(f).connect(v).connect(g.sfx);
    o.start(t);
    o.stop(t + 0.45);
  }

  build(): void {
    const g = this.ready();
    if (!g) return;
    const t = g.ctx.currentTime;
    this.thump(g.sfx, t, 140, 0.25);
    this.thump(g.sfx, t + 0.12, 110, 0.18);
  }

  upgrade(): void {
    const g = this.ready();
    if (!g) return;
    const t = g.ctx.currentTime;
    [74, 78, 81, 86].forEach((n, i) => this.tone(g.sfx, 'triangle', midi(n), t + i * 0.07, 0.35, 0.07));
  }

  goal(): void {
    const g = this.ready();
    if (!g) return;
    const t = g.ctx.currentTime;
    [69, 73, 76, 81].forEach((n, i) => this.bell(g.sfx, midi(n), t + i * 0.11, 1.2, 0.06));
  }

  /** 마감 종(딸랑) */
  closingBell(): void {
    const g = this.ready();
    if (!g) return;
    const t = g.ctx.currentTime;
    for (let i = 0; i < 3; i++) this.bell(g.sfx, midi(84), t + i * 0.16, 0.9, 0.05);
  }

  /** 새 아침 */
  morning(): void {
    const g = this.ready();
    if (!g) return;
    const t = g.ctx.currentTime;
    this.bell(g.sfx, midi(79), t, 1.6, 0.05);
    this.bell(g.sfx, midi(86), t + 0.25, 1.8, 0.04);
  }

  // ---------------------------------------------------------- 내부

  private ready(): Graph | null {
    return this.on && this.g && this.g.ctx.state === 'running' ? this.g : null;
  }

  private createGraph(ctx: AudioContext): Graph {
    const master = ctx.createGain();
    master.gain.value = 0.7;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);

    const music = ctx.createGain();
    music.gain.value = 0.55;
    const warm = ctx.createBiquadFilter();
    warm.type = 'lowpass';
    warm.frequency.value = 2200;
    music.connect(warm).connect(master);

    const sfx = ctx.createGain();
    sfx.gain.value = 0.8;
    sfx.connect(master);

    // 2초짜리 흰 잡음 하나를 빗소리·웅성거림·북·레코드 잡음이 나눠 쓴다
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const rainFilter = ctx.createBiquadFilter();
    rainFilter.type = 'lowpass';
    rainFilter.frequency.value = 1400;
    const rain = ctx.createGain();
    rain.gain.value = 0;
    this.loop(ctx, noise).connect(rainFilter).connect(rain).connect(master);

    const crowdFilter = ctx.createBiquadFilter();
    crowdFilter.type = 'bandpass';
    crowdFilter.frequency.value = 420;
    crowdFilter.Q.value = 0.8;
    const crowd = ctx.createGain();
    crowd.gain.value = 0;
    this.loop(ctx, noise, 0.5).connect(crowdFilter).connect(crowd).connect(master);

    // 레코드 잡음: 드문드문 튀는 딸깍 소리
    const crackleBuf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const cd = crackleBuf.getChannelData(0);
    for (let i = 0; i < cd.length; i++) cd[i] = Math.random() < 0.0006 ? (Math.random() * 2 - 1) * 0.6 : (Math.random() * 2 - 1) * 0.01;
    const crackleFilter = ctx.createBiquadFilter();
    crackleFilter.type = 'highpass';
    crackleFilter.frequency.value = 1500;
    const crackle = ctx.createGain();
    crackle.gain.value = 0.18;
    this.loop(ctx, crackleBuf).connect(crackleFilter).connect(crackle).connect(music);

    return { ctx, master, music, sfx, rain, rainFilter, crowd, noise };
  }

  private loop(ctx: AudioContext, buf: AudioBuffer, rate = 1): AudioBufferSourceNode {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = rate;
    src.start();
    return src;
  }

  private playStep(step: number, t: number): void {
    const g = this.g!;
    const bar = Math.floor(step / STEPS_PER_BAR);
    const beat = step % STEPS_PER_BAR;
    const chord = CHORDS[bar];
    if (beat === 0) {
      chord.forEach((n, i) => this.keys(g.music, midi(n), t + i * 0.015, EIGHTH * 7.5, 0.045));
      this.tone(g.music, 'sine', midi(chord[0] - 12), t, EIGHTH * 3, 0.16);
    }
    if (beat === 5) this.tone(g.music, 'sine', midi(chord[0] - 12), t, EIGHTH * 2.5, 0.12);
    if (beat === 0 || beat === 3) this.thump(g.music, t, 90, 0.22);
    if (beat === 2 || beat === 6) this.hiss(g.music, t, 2200, 0.12, 0.05);
    if (beat % 2 === 1) this.hiss(g.music, t, 7000, 0.04, 0.025);
    // 박이 지난 자리에 띄엄띄엄 멜로디
    if (beat !== 0 && Math.random() < 0.3) {
      const n = MELODY[Math.floor(Math.random() * MELODY.length)];
      this.keys(g.music, midi(n), t, EIGHTH * 2.5, 0.03);
    }
  }

  /** 낡은 전자 피아노 느낌: 사인 + 살짝 어긋난 삼각파 */
  private keys(dest: AudioNode, freq: number, t: number, dur: number, vol: number): void {
    this.tone(dest, 'sine', freq, t, dur, vol);
    this.tone(dest, 'triangle', freq * 1.003, t, dur * 0.6, vol * 0.4);
  }

  private tone(dest: AudioNode, type: OscillatorType, freq: number, t: number, dur: number, vol: number): void {
    const ctx = this.g!.ctx;
    const o = ctx.createOscillator();
    const v = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    this.envelope(v, t, 0.01, dur, vol);
    o.connect(v).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private bell(dest: AudioNode, freq: number, t: number, dur: number, vol: number): void {
    this.tone(dest, 'sine', freq, t, dur, vol);
    this.tone(dest, 'sine', freq * 2.76, t, dur * 0.4, vol * 0.35);
  }

  private windChime(t: number): void {
    const g = this.g!;
    const base = 2300 + Math.random() * 500;
    this.bell(g.sfx, base, t, 1.8, 0.025);
    if (Math.random() < 0.6) this.bell(g.sfx, base * 1.19, t + 0.18 + Math.random() * 0.2, 1.4, 0.018);
  }

  /** 부드러운 북: 내려가는 사인 */
  private thump(dest: AudioNode, t: number, freq: number, vol: number): void {
    const ctx = this.g!.ctx;
    const o = ctx.createOscillator();
    const v = ctx.createGain();
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.45, t + 0.18);
    this.envelope(v, t, 0.005, 0.22, vol);
    o.connect(v).connect(dest);
    o.start(t);
    o.stop(t + 0.3);
  }

  /** 잡음 한 번(스네어·하이햇 자리) */
  private hiss(dest: AudioNode, t: number, freq: number, dur: number, vol: number): void {
    const g = this.g!;
    const src = g.ctx.createBufferSource();
    src.buffer = g.noise;
    const f = g.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 1.2;
    const v = g.ctx.createGain();
    this.envelope(v, t, 0.003, dur, vol);
    src.connect(f).connect(v).connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  private envelope(v: GainNode, t: number, attack: number, dur: number, vol: number): void {
    v.gain.setValueAtTime(0.0001, t);
    v.gain.exponentialRampToValueAtTime(vol, t + attack);
    v.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
}
