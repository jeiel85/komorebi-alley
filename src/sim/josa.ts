/** 한국어 조사 고르기. 마지막 글자에 받침이 있는지로 정한다(한글이 아니면 받침 없음으로 본다). */
function hasBatchim(word: string): boolean {
  const code = word.charCodeAt(word.length - 1);
  if (Number.isNaN(code) || code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 !== 0;
}

export const iGa = (word: string): string => (hasBatchim(word) ? '이' : '가');
export const eunNeun = (word: string): string => (hasBatchim(word) ? '은' : '는');
export const gwaWa = (word: string): string => (hasBatchim(word) ? '과' : '와');
