# asset-sample — 개인 자산 대시보드 샘플판

개인 자산 포트폴리오 대시보드의 **화면을 그대로 두고 데이터만 가상으로 바꾼** 공개 샘플이다.
서버·DB 없이 정적 파일로 동작한다 — 화면이 부르는 API 응답을 미리 떠 둔 JSON(`public-sample/fixtures/`)이 대신한다.

- 라이브: https://asset-sample.haejunhyun.com (배포 예정)
- **모든 금액·시세는 합성한 가상 데이터다. 투자 권유가 아니다.** 종목 이름·코드만 실제이고 가격·배당·환율은 전부 합성이다.
- 기준일 2026-10-23, 총자산 100,000,000원(계좌 11개·관리 묶음 7개). 언제 열어도 같은 숫자다.
- 저장 기능(목표 저장·리밸런싱 확정·수기 입력)은 "샘플 사이트에서는 저장되지 않습니다"로 끝난다. 리밸런싱 미리보기는 동작한다.

## 로컬 실행

Node.js 24(`.nvmrc`).

```bash
npm ci
npm run dev:sample        # 개발 서버(http://localhost:5173)
npm run build:sample      # → dist-sample/ (정적 호스팅에 그대로 올린다)
npm run preview:sample    # dist-sample 미리 보기
```

로그인 화면이 나오면 아무 값이나 넣으면 들어간다(샘플은 인증이 없다).

## 배포(Cloudflare Pages)

| 항목 | 값 |
|---|---|
| 루트 디렉터리 | `/` |
| 빌드 명령 | `npm ci && npm run build:sample` |
| 출력 폴더 | `dist-sample` |
| Node | `.nvmrc`(24) |

- `public-sample/_redirects`: 모든 경로 → `index.html`(SPA 깊은 링크). 정적 파일(`/assets/*`·`/fixtures/*`)이 먼저다.
- `public-sample/_headers`: `index.html`은 매번 재검증, `/assets/*`는 해시 파일명이라 장기 캐시.

## 구조

```
src/                      화면(React) — 원본 대시보드와 같다
src/lib/api.js            모든 데이터 호출의 한 곳. 샘플 빌드(VITE_SAMPLE)에서만 api.sample.js 로 넘긴다
src/lib/api.sample.js     픽스처 조회 — 키 = 경로 + 정렬된 쿼리, 없는 조합은 가장 가까운 기간으로 대신(console.warn)
public-sample/fixtures/   API 응답 JSON + index.json(키 → 파일)
scripts/sample/           합성 데이터 생성기(spec.py 설계값 → generate.py) · verify.py(생성물 검사)
.env.sample               VITE_SAMPLE=1 (--mode sample 일 때만 읽힌다)
```

## 데이터

- 합성 데이터는 처음부터 만든다. `scripts/sample/spec.py`(계좌·종목·평가액·손익률·매매 일정)를 `generate.py`가 시드 고정(SEED=20261023) 난수로 일별 잔고·시세·배당·환율로 펼친다.
  같은 코드면 같은 결과다(표준 라이브러리만, Python 3.12+).

  ```bash
  python3 scripts/sample/generate.py      # → scripts/sample/out/*.csv
  python3 scripts/sample/verify.py        # 합계·손익 부호·결정성·개인정보 형태 검사
  ```

- 픽스처(API 응답 JSON)는 원 대시보드 저장소에서 이 생성물을 DB 에 싣고 실제 API 로 떠서 이 저장소로 내보낸다. 이 저장소에는 서버·DB 코드가 없으므로 픽스처를 여기서 다시 만들지는 않는다.
- 계좌 코드는 `00000000-NN`, 기관은 `증권사 A` 같은 이름이다. 실제 계좌·기관·보유와 무관하다.

## 기술 스택

React 18 · React Router 6 · TanStack Query 5 · Vite 5. 차트는 직접 그린 SVG(차트 라이브러리 없음). 서체 Pretendard · IBM Plex Sans.

## 라이선스

코드는 MIT(`LICENSE`). 데이터는 가상이다.
