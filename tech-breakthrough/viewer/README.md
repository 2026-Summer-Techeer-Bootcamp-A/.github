# RAG 연구 노트 뷰어

`rag-development/`의 개념서·구현기 md를 논문처럼 읽는 정적 뷰어다. HTML/CSS/JS만 사용하며, 별도 서버 없이 파일을 바로 열어 볼 수 있다.

## 여는 법

`index.html`을 브라우저로 열면 된다(더블클릭 또는 `file://` 경로). 문서 내용은 `docs.js`에 미리 구워져 있어 네트워크·서버가 필요 없다.

## 문서를 고친 뒤

md를 수정했으면 아래를 실행해 `docs.js`를 다시 굽는다.

```bash
node rag-development/viewer/build.mjs
```

`build.mjs`가 `rag-learning/*.md`와 `rag-build-journal/*.md`를 모아 `docs.js`(`window.DOCS`)로 직렬화한다.

## 구성

| 파일 | 역할 |
|---|---|
| `index.html` | 셸(상단 바 · 좌측 문서 네비 · 본문 · 우측 목차) |
| `paper.css` | 논문 서식(세리프 본문, 섹션 자동 번호, 표·코드·인용 스타일) |
| `viewer.js` | md 렌더(marked) · 목차 생성 · 스크롤 스파이 |
| `marked.min.js` | 벤더링한 마크다운 파서(오프라인) |
| `build.mjs` | md → `docs.js` 생성기 |
| `docs.js` | 생성물(직접 편집하지 않는다) |

섹션 번호(1, 1.1 …)는 `paper.css`의 CSS 카운터가 자동으로 매긴다. 그래서 md의 `##`/`###`에는 수동 번호를 넣지 않는다.
