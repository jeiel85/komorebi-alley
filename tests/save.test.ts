import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game.ts';
import { SaveError, parseSave, serializeSave } from '../src/sim/save.ts';

function playedGame(): Game {
  const g = new Game(21);
  g.s.money = 50_000;
  g.place('ramen', 4);
  g.place('feeder', 6);
  g.startBusiness();
  for (let i = 0; i < 2000 && g.phase === 'business'; i++) g.tick(1);
  g.advanceDay();
  return g;
}

describe('저장과 불러오기', () => {
  it('저장한 상태를 그대로 되돌린다', () => {
    const g = playedGame();
    const restored = parseSave(serializeSave(g.s));
    expect(restored).toEqual(g.s);
    const g2 = new Game(99, restored);
    expect(g2.s.day).toBe(2);
    expect(g2.phase).toBe('prep');
  });

  it('JSON이 아니거나 다른 파일이면 거절한다', () => {
    expect(() => parseSave('not json')).toThrow(SaveError);
    expect(() => parseSave('{"format":"other"}')).toThrow(/저장 파일이 아니에요/);
    expect(() => parseSave(JSON.stringify({ format: 'komorebi-alley-save', version: 999, state: {} }))).toThrow(/버전/);
  });

  const mutate = (fn: (state: Record<string, any>) => void): string => {
    const raw = JSON.parse(serializeSave(playedGame().s));
    fn(raw.state);
    return JSON.stringify(raw);
  };

  it('겹친 건물을 거절한다', () => {
    const text = mutate((s) => s.buildings.push({ uid: 50, type: 'vending', x: 5, tuning: 5, price: 150, rating: 0.5 }));
    expect(() => parseSave(text)).toThrow(/배치/);
  });

  it('잠긴 땅의 건물을 거절한다', () => {
    const text = mutate((s) => s.buildings.push({ uid: 50, type: 'vending', x: 0, tuning: 5, price: 150, rating: 0.5 }));
    expect(() => parseSave(text)).toThrow(/공터/);
  });

  it('범위를 벗어난 가격·알 수 없는 건물을 거절한다', () => {
    expect(() => parseSave(mutate((s) => (s.buildings[0].price = 99_999)))).toThrow(/price/);
    expect(() => parseSave(mutate((s) => (s.buildings[0].type = 'castle')))).toThrow(/type/);
    expect(() => parseSave(mutate((s) => (s.money = -1)))).toThrow(/money/);
    expect(() => parseSave(mutate((s) => (s.nextUid = 1)))).toThrow(/nextUid/);
  });
});
