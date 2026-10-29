import { describe, expect, it } from 'vitest';
import { SAVE_KEY, staleBrokenBackups } from '../src/ui/storage.ts';

const backup = (t: number) => `${SAVE_KEY}.broken-${t}`;

describe('손상 저장 백업 정리', () => {
  it('가장 최근 백업만 남기고 오래된 것을 고른다', () => {
    const stale = staleBrokenBackups([backup(100), backup(400), backup(200), backup(300)], 2);
    expect(stale.sort()).toEqual([backup(100), backup(200)].sort());
  });

  it('시각을 문자열이 아니라 숫자로 비교한다', () => {
    expect(staleBrokenBackups([backup(9), backup(10)], 1)).toEqual([backup(9)]);
  });

  it('저장 키와 다른 키, 형식이 다른 키는 건드리지 않는다', () => {
    const keys = [SAVE_KEY, 'other-app/data', `${SAVE_KEY}.broken-abc`, `${SAVE_KEY}.broken-`, backup(1)];
    expect(staleBrokenBackups(keys, 0)).toEqual([backup(1)]);
  });

  it('남길 개수 이하이면 고를 것이 없다', () => {
    expect(staleBrokenBackups([backup(1), backup(2)], 3)).toEqual([]);
    expect(staleBrokenBackups([], 0)).toEqual([]);
  });
});
