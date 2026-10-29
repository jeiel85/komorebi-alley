/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 배포된 게임 주소(끝에 /). 공유 미리보기(og) 메타에 쓴다. */
  readonly VITE_SITE_URL: string;
  /** 오류 화면에서 안내할 GitHub 이슈 주소 */
  readonly VITE_ISSUES_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
