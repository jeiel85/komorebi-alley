import type { SaveState } from '../sim/game.ts';
import { parseSave, serializeSave } from '../sim/save.ts';

export const SAVE_KEY = 'komorebi-alley/save/v1';
const BROKEN_PREFIX = `${SAVE_KEY}.broken-`;
/** 손상 데이터 백업을 몇 개까지 남길지. 반복해서 손상되면 백업이 쌓여 저장 공간을 잠식하므로 최근 것만 둔다. */
export const BROKEN_BACKUPS_KEPT = 3;

/** 저장소 키 목록에서 가장 최근 `keep`개를 뺀 나머지 손상 백업 키를 고른다. */
export function staleBrokenBackups(keys: readonly string[], keep: number): string[] {
  return keys
    .filter((k) => k.startsWith(BROKEN_PREFIX) && /^\d+$/.test(k.slice(BROKEN_PREFIX.length)))
    .sort((a, b) => Number(b.slice(BROKEN_PREFIX.length)) - Number(a.slice(BROKEN_PREFIX.length)))
    .slice(Math.max(0, keep));
}

export interface LoadResult {
  state: SaveState | null;
  /** 사용자에게 알릴 문제(없으면 null) */
  error: string | null;
}

/** 브라우저 저장소에서 진행 상황을 읽는다. 손상된 데이터는 지우지 않고 별도 키로 옮겨 둔다. */
export function loadStoredSave(): LoadResult {
  let text: string | null;
  try {
    text = localStorage.getItem(SAVE_KEY);
  } catch (err) {
    console.error('localStorage 읽기 실패', err);
    return { state: null, error: '브라우저 저장소를 쓸 수 없어 진행 상황이 저장되지 않아요.' };
  }
  if (!text) return { state: null, error: null };
  try {
    return { state: parseSave(text), error: null };
  } catch (err) {
    console.error('저장 데이터를 읽지 못했어요', err);
    const backupKey = `${BROKEN_PREFIX}${Date.now()}`;
    try {
      // 새 백업 자리를 먼저 비워 둔다(저장 공간이 꽉 찬 경우에도 백업이 들어가게)
      const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((k): k is string => k !== null);
      for (const k of staleBrokenBackups(keys, BROKEN_BACKUPS_KEPT - 1)) localStorage.removeItem(k);
      localStorage.setItem(backupKey, text);
      localStorage.removeItem(SAVE_KEY);
    } catch (backupErr) {
      console.error('손상된 저장 데이터 보관 실패', backupErr);
      return { state: null, error: '저장 데이터가 손상돼 새 게임으로 시작해요. 원본을 따로 보관하지 못했어요.' };
    }
    return { state: null, error: `저장 데이터가 손상돼 새 게임으로 시작해요. 원본은 '${backupKey}'에 보관했어요.` };
  }
}

/** 저장된 진행 상황 원문(오류 보고용). 없거나 읽을 수 없으면 null. */
export function readRawSave(): string | null {
  try {
    return localStorage.getItem(SAVE_KEY);
  } catch (err) {
    console.error('localStorage 읽기 실패', err);
    return null;
  }
}

export function storeSave(s: SaveState): boolean {
  try {
    localStorage.setItem(SAVE_KEY, serializeSave(s));
    return true;
  } catch (err) {
    console.error('저장 실패', err);
    return false;
  }
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
