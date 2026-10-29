import { downloadBlob, readRawSave } from './storage.ts';

let crashed = false;
let describeGame: () => string = () => '';

export function hasCrashed(): boolean {
  return crashed;
}

/**
 * 처리되지 않은 오류가 나면 게임 루프를 멈추고 안내 화면을 띄운다.
 * 예외 뒤의 게임 상태는 믿을 수 없으므로 계속 돌리지 않는다. 저장은 그날 아침 스냅샷이라 새로고침하면 거기서 이어진다.
 * `describe`는 오류 보고에 적을 게임 상황이다(게임이 만들어지기 전이면 던져도 된다).
 */
export function installCrashGuard(describe: () => string): void {
  describeGame = describe;
  window.addEventListener('error', (e) => {
    // error 객체가 없는 이벤트는 우리 코드가 던진 예외가 아니다(브라우저의 무해한 "ResizeObserver loop" 알림,
    // 다른 출처 스크립트의 "Script error." 등). 브라우저가 콘솔에 남기므로 게임은 멈추지 않는다.
    if (e.error == null) return;
    showCrash(e.error);
  });
  window.addEventListener('unhandledrejection', (e) => showCrash(e.reason));
}

export function showCrash(err: unknown): void {
  if (crashed) return;
  crashed = true;
  console.error('게임이 오류로 멈췄어요', err);

  let situation: string;
  try {
    situation = describeGame() || '(게임 시작 전)';
  } catch {
    situation = '(게임 시작 전)';
  }
  const detail = [
    `시각: ${new Date().toISOString()}`,
    `주소: ${location.href}`,
    `브라우저: ${navigator.userAgent}`,
    `게임: ${situation}`,
    `오류: ${err instanceof Error ? (err.stack ?? `${err.name}: ${err.message}`) : String(err)}`,
  ].join('\n');

  const root = document.createElement('div');
  root.className = 'modal-backdrop crash';
  root.innerHTML = `<div class="modal" role="alertdialog" aria-labelledby="crash-title">
      <h2 id="crash-title">😿 문제가 생겨 골목이 멈췄어요</h2>
      <p>새로고침하면 마지막으로 저장된 아침부터 이어서 할 수 있어요.
        아래 내용을 <a target="_blank" rel="noopener">GitHub 이슈</a>로 알려 주시면 고치는 데 큰 도움이 돼요.</p>
      <pre></pre>
      <div class="actions">
        <button data-act="copy">오류 내용 복사</button>
        <button data-act="save">저장 파일 받기</button>
        <button class="primary" data-act="reload">새로고침</button>
      </div>
    </div>`;
  root.querySelector('a')!.href = import.meta.env.VITE_ISSUES_URL;
  const pre = root.querySelector('pre')!;
  pre.textContent = detail;

  const copy = root.querySelector<HTMLButtonElement>('[data-act="copy"]')!;
  copy.addEventListener('click', () => {
    navigator.clipboard.writeText(detail).then(
      () => (copy.textContent = '복사했어요'),
      (copyErr) => {
        console.error('클립보드 복사 실패', copyErr);
        // 복사할 수 없으면 직접 복사하도록 내용을 선택해 둔다
        getSelection()?.selectAllChildren(pre);
        copy.textContent = '선택해 두었어요. 직접 복사해 주세요';
      },
    );
  });

  const save = root.querySelector<HTMLButtonElement>('[data-act="save"]')!;
  const raw = readRawSave();
  if (raw === null) {
    save.disabled = true;
    save.title = '브라우저에 저장된 진행 상황이 없어요';
  } else {
    save.addEventListener('click', () => downloadBlob('komorebi-alley-save.json', new Blob([raw], { type: 'application/json' })));
  }

  root.querySelector('[data-act="reload"]')!.addEventListener('click', () => location.reload());
  document.body.appendChild(root);
}
