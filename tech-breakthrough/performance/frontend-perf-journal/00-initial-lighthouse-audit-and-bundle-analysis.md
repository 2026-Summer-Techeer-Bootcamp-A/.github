# 프론트엔드 첫 성능 측정: 단일 번들 크기와 렌더 차단 리소스 분석

**일정**: 2026-07-14  

## 목표

성능 분석을 시작하기에 앞서 로컬 빌드를 수행하고, Lighthouse 및 브라우저 성능 계측 도구를 활용해 현재 프론트엔드 시스템의 렌더링 성능 지표를 측정했다. 초기 페이지 진입 시 발생하는 지연의 원인을 분석하고, 가장 먼저 개선해야 할 핵심 지점이 어디인지 정의하고자 했다.

## 프로덕션 빌드 크기 확인

성능 측정을 위해 개발 서버 대신 실제 운영 환경과 유사하게 최적화가 반영되는 프로덕션 빌드를 수행했다. `npm run build` 명령을 실행해 산출된 파일의 크기를 계측했다.

빌드 콘솔을 통해 계측된 결과에서 `index.css` 파일은 489.32 KB였고, 메인 자바스크립트 파일인 `index.js` 번들 하나는 **3.98 MB (3,981.13 kB)**로 확인되었다. 번들 크기가 500 kB를 초과할 경우 롤업에서 경고를 발생시키는데, 해당 결과물은 기준치의 약 8배에 달하는 단일 파일이다.

이러한 파일 크기는 브라우저가 초기 페이지를 로드할 때 다운로드 및 구문 분석에 많은 리소스를 소모하게 만들며, 이는 초기 렌더링 지연의 일차적인 원인이 된다.

## Lighthouse 성능 측정 결과

빌드된 결과물을 `npm run preview` 명령으로 실행하여 로컬 프리뷰 서버(`http://localhost:4173`) 환경을 구성한 뒤 Lighthouse 진단을 수행했다. 측정된 성능(Performance) 종합 점수는 **50점**으로 진단되었다.

구체적인 세부 메트릭 수치는 다음과 같다.

| 메트릭 명칭 | 측정값 | 스코어 | 설명 |
| :--- | :--- | :--- | :--- |
| **First Contentful Paint (FCP)**<sup class="fnref" id="fnref1"><a href="#fn1">1</a></sup> | 8.7초 | 0 / 100 | 첫 텍스트나 이미지가 화면에 그려지는 시간 |
| **Largest Contentful Paint (LCP)**<sup class="fnref" id="fnref2"><a href="#fn2">2</a></sup> | 9.6초 | 0 / 100 | 가장 큰 주요 콘텐츠가 화면에 그려지는 시간 |
| **Speed Index (SI)**<sup class="fnref" id="fnref3"><a href="#fn3">3</a></sup> | 8.7초 | 17 / 100 | 페이지 콘텐츠가 채워지는 시각적 속도 |
| **Total Blocking Time (TBT)**<sup class="fnref" id="fnref4"><a href="#fn4">4</a></sup> | 320ms | 76 / 100 | FCP부터 상호작용성까지 메인 스레드가 차단된 시간 |
| **Cumulative Layout Shift (CLS)**<sup class="fnref" id="fnref5"><a href="#fn5">5</a></sup> | 0 | 100 / 100 | 화면 레이아웃의 비정상적인 흔들림 정도 |

첫 화면 렌더링 시작을 의미하는 FCP가 8.7초, 주요 요소가 완전히 노출되는 LCP가 9.6초로 나타나 초기 페이지 로딩 시 지연이 심각함을 수치적으로 확인했다. 한편 레이아웃 변경 안정성을 나타내는 CLS 지표는 0으로 안정적인 상태를 유지했다.

## 두 가지 핵심 병목 원인 분석

첫째, **단일 자바스크립트 번들의 비대한 크기**이다. `package.json` 파일의 의존성 구성을 검토한 결과, 데이터 시각화 라이브러리(`d3`), 차트 컴포넌트(`echarts`), 지도 서비스(`leaflet`), 구문 강조 모듈(`highlight.js`), 마크다운 변환기(`marked`) 등 용량이 큰 외부 라이브러리들이 다수 도입되어 있었다. 이 라이브러리들이 Vite 빌드 설정에서 개별 청크로 분할되지 않고 하나의 파일로 병합되어 번들 용량이 3.98 MB까지 도달한 것이다.

둘째, **렌더 차단 리소스(Render-blocking Resources)**의 존재이다. 외부에서 참조하는 구글 웹폰트 링크(`Poppins`, `Inter`)와 489KB에 달하는 `index.css` 파일이 브라우저의 렌더 트리를 빌드하는 시점에 로딩을 지연시켰다. 브라우저는 스타일시트와 폰트의 다운로드가 완료되어 CSSOM을 구성하기 전까지는 화면 페인팅을 시작하지 않기 때문이다.

<figure class="fig">
<svg viewBox="0 0 700 200" role="img" aria-label="대용량 단일 번들 구조로 인한 브라우저의 초기 렌더링 차단 흐름">
<defs>
<marker id="arrow00fe" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
<path d="M0,0 L10,5 L0,10 z" fill="#8a8d95"></path>
</marker>
</defs>
<text x="20" y="24" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="13" font-weight="700" fill="#1a1c20">현재 초기 렌더링 파이프라인 (대용량 단일 번들로 인한 병목)</text>
<line x1="120" y1="100" x2="180" y2="100" stroke="#8a8d95" stroke-width="1.5" marker-end="url(#arrow00fe)"></line>
<line x1="430" y1="100" x2="490" y2="100" stroke="#8a8d95" stroke-width="1.5" marker-end="url(#arrow00fe)"></line>
<rect x="20" y="65" width="100" height="70" rx="8" fill="#f7f8fa" stroke="#c9ccd3"></rect>
<text x="70" y="95" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="12" font-weight="700" fill="#1a1c20">1. HTML 로드</text>
<text x="70" y="112" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10" fill="#5b5e66">index.html (0.9KB)</text>
<rect x="190" y="55" width="240" height="90" rx="8" fill="#fbeae6" stroke="#b3402f"></rect>
<text x="310" y="76" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" font-weight="700" fill="#b3402f">2. 차단 리소스 다운로드 &amp; 컴파일</text>
<rect x="205" y="90" width="210" height="20" rx="4" fill="#fdfdfc"></rect>
<text x="215" y="104" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10" fill="#b3402f">단일 JS 번들(index.js · 3.98MB)</text>
<rect x="205" y="114" width="210" height="20" rx="4" fill="#fdfdfc"></rect>
<text x="215" y="128" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10" fill="#b3402f">단일 CSS(index.css · 489KB)</text>
<rect x="500" y="65" width="180" height="70" rx="8" fill="#eef2f9" stroke="#21447c"></rect>
<text x="590" y="95" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="12" font-weight="700" fill="#21447c">3. 최초 화면 렌더링</text>
<text x="590" y="113" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" font-weight="700" fill="#b3402f">FCP/LCP 8.7s~9.6s</text>
</svg>
<figcaption><b>그림 1.</b> 대용량 단일 번들 구조로 인한 브라우저의 초기 렌더링 차단 흐름. HTML은 빠르게 도착하지만, 3.98MB JS와 489KB CSS를 전부 내려받고 파싱해야 첫 화면이 그려진다.</figcaption>
</figure>

## 성능 개선 방안 수립

분석된 병목 지점을 해결하고 초기 렌더링 성능을 확보하기 위해 다섯 가지 구체적인 개선 방안을 수립했다.

### 1. Vite 빌드 설정을 통한 번들 크기 분할 (Code Splitting)

현재 단일 파일로 묶여 있는 3.98 MB 크기의 JS 번들을 분할하여 로딩 속도를 단축해야 한다. `package.json` 의 의존성 목록 중 용량이 큰 외부 라이브러리인 `d3`, `echarts`, `leaflet`, `highlight.js`를 개별 청크 파일로 분리하는 설정을 구성한다. 

이를 위해 `vite.config.ts` 파일의 `rollupOptions` 속성 내 `manualChunks` 설정을 아래와 같이 구현하여 빌드를 수행할 예정이다.

```typescript
// vite.config.ts 설정 예시
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('echarts') || id.includes('zrender')) {
              return 'vendor-echarts';
            }
            if (id.includes('d3')) {
              return 'vendor-d3';
            }
            if (id.includes('leaflet')) {
              return 'vendor-leaflet';
            }
            if (id.includes('highlight.js')) {
              return 'vendor-highlight';
            }
            return 'vendor-libs';
          }
        }
      }
    }
  }
});
```

이 설정을 적용하면 브라우저가 첫 화면을 렌더링하는 데 불필요한 대형 라이브러리 코드를 한꺼번에 다운로드하지 않아도 되므로, 초기 전송량을 크게 줄일 수 있다.

### 2. React Lazy Loading 기반의 컴포넌트 지연 로딩 도입

사용자가 첫 진입 화면에서 즉시 사용하지 않는 특정 기능 탭의 컴포넌트들은 초기 렌더링 경로에서 제외해야 한다. 
* **시장(Market) 탭**: 탭 활성화 전까지 `echarts` 관련 라이브러리 로드를 보류한다.
* **지도(Map) 탭**: 탭 활성화 전까지 `leaflet` 관련 라이브러리 로드를 보류한다.
* **어시스턴트(Chat) 탭**: 챗봇 화면이 활성화되기 전까지 `highlight.js` 및 `marked` 로드를 보류한다.

React에서 지원하는 `React.lazy`와 `Suspense` API를 사용해, 해당 화면이나 탭이 활성화되는 시점에만 자바스크립트 리소스를 동적 임포트(Dynamic Import)하도록 코드를 수정한다. 

```typescript
// 지연 로딩 구현 예시
import React, { Suspense } from 'react';

const HeavyChart = React.lazy(() => import('./components/HeavyChart'));

function App() {
  return (
    <Suspense fallback={<div>로딩 중...</div>}>
      <HeavyChart />
    </Suspense>
  );
}
```

이 기법은 첫 페이지 로딩 시 필요한 JS 번들의 크기를 수백 킬로바이트 수준으로 압축하는 데 기여한다.

### 3. 채용 공고 목록에 가상 리스트 (Virtual List) 도입

데이터마트에서 수백 건 이상의 공고 데이터를 조회할 때, 모든 데이터를 개별 DOM 카드로 화면에 한 번에 생성하면 메모리 부하와 렌더링 속도 저하를 유발한다.

이를 방지하기 위해 가상 스크롤 라이브러리(`react-window` 등)를 도입한다. 현재 뷰포트에 노출되는 약 10개의 공고 카드만 실제 DOM 객체로 생성하고, 스크롤 이동 시 DOM 객체를 재활용하여 텍스트 데이터만 동적으로 교체하는 구조로 변경한다. 이는 많은 양의 카드 목록을 스크롤할 때 렌더링 오버헤드를 제어하는 표준적인 방안이다.

### 4. 공고 로고 이미지 네이티브 지연 로딩 적용

페이지 로드와 동시에 보이지 않는 하단 영역의 기업 로고 이미지들까지 한꺼번에 네트워크 요청이 발생하면 대역폭 병목을 초과하게 된다.

공고 목록 카드를 렌더링하는 `<img>` 태그에 HTML 표준 속성인 `loading="lazy"`를 적용한다. 이를 통해 첫 화면 영역에 노출되지 않는 스크롤 하단의 로고 이미지들은 다운로드 시점을 뒤로 늦춰 초기 로드 시점의 네트워크 병목을 완화한다.

### 5. 렌더 차단 웹폰트 최적화

구글 웹폰트와 스타일시트 파일이 다운로드 완료되기 전까지 글자를 그리지 않고 숨기는 현상을 제어한다. HTML `<head>` 영역의 외부 폰트 임포트 링크 끝에 `&display=swap` 옵션을 강제하여 폰트 로드 전에도 기본 시스템 폰트로 텍스트가 즉시 렌더링되게 함으로써 첫 화면 구성 시간을 단축한다.

개선 조치 및 이에 따른 성능 지표의 변화 수치는 다음 문서에 순차적으로 기록한다.

<hr>
<ol class="footnotes">
<li id="fn1">사용자가 웹페이지에 접속했을 때 브라우저가 화면에 첫 번째 텍스트나 이미지 요소를 그리기 시작하는 시점까지 걸린 시간. <a class="fnback" href="#fnref1">↩</a></li>
<li id="fn2">사용자가 웹페이지를 요청한 시점부터 뷰포트 내에서 가장 크기가 큰 텍스트 블록이나 이미지 요소가 완전히 화면에 렌더링될 때까지 걸린 시간. <a class="fnback" href="#fnref2">↩</a></li>
<li id="fn3">페이지가 로드되는 동안 콘텐츠가 시각적으로 얼마나 빨리 채워지는지를 나타내는 속도 지수. <a class="fnback" href="#fnref3">↩</a></li>
<li id="fn4">FCP와 상호작용 가능 시간(TTI) 사이의 마우스 클릭, 키보드 입력 등 사용자 입력에 반응하지 못하도록 차단된 메인 스레드 대기 시간의 총합. <a class="fnback" href="#fnref4">↩</a></li>
<li id="fn5">로드 단계에서 화면 내 요소들이 예기치 않게 이동하여 발생하는 시각적 불안정성을 계량화한 점수. <a class="fnback" href="#fnref5">↩</a></li>
</ol>
