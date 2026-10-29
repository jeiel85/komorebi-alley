import type { SaveState } from '../sim/game.ts';
import { parseSave, serializeSave } from '../sim/save.ts';

const KEY = 'komorebi-alley/save/v1';

export interface LoadResult {
  state: SaveState | null;
  /** 사용자에게 알릴 문제(없으면 null) */
  error: string | null;
}

/** 브라우저 저장소에서 진행 상황을 읽는다. 손상된 데이터는 지우지 않고 별도 키로 옮겨 둔다. */
export function loadStoredSave(): LoadResult {
  let text: string | null;
  try {
    text = localStorage.getItem(KEY);
  } catch (err) {
    console.error('localStorage 읽기 실패', err);
    return { state: null, error: '브라우저 저장소를 쓸 수 없어 진행 상황이 저장되지 않아요.' };
  }
  if (!text) return { state: null, error: null };
  try {
    return { state: parseSave(text), error: null };
  } catch (err) {
    console.error('저장 데이터를 읽지 못했어요', err);
    const backupKey = `${KEY}.broken-${Date.now()}`;
    try {
      localStorage.setItem(backupKey, text);
      localStorage.removeItem(KEY);
    } catch (backupErr) {
      console.error('손상된 저장 데이터 보관 실패', backupErr);
      return { state: null, error: '저장 데이터가 손상돼 새 게임으로 시작해요. 원본을 따로 보관하지 못했어요.' };
    }
    return { state: null, error: `저장 데이터가 손상돼 새 게임으로 시작해요. 원본은 '${backupKey}'에 보관했어요.` };
  }
}

export function storeSave(s: SaveState): boolean {
  try {
    localStorage.setItem(KEY, serializeSave(s));
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
