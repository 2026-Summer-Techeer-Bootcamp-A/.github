# 프론트엔드 성능 개선 설계: 라우트 기반 스플리팅과 라이브러리 청크 분리 계획

**일정**: 2026-07-14  

## 목표

00번 성능 분석 문서에서 분석된 FCP<sup class="fnref" id="fnref1"><a href="#fn1">1</a></sup> 및 LCP<sup class="fnref" id="fnref2"><a href="#fn2">2</a></sup> 병목 문제를 해결하기 위해, 프론트엔드 애플리케이션의 번들 용량 및 렌더링 경로를 최적화하는 상세 구현 계획을 수립했다. 메인 번들 크기를 500 KB 이하로 축소하고 로딩 지연 수치를 단축하는 데 주안점을 둔다.

## 대상 코드 분석 및 상태 정의

앱 진입점인 App.tsx를 분석한 결과, 90개 이상의 라우트와 연관 컴포넌트들이 정적 임포트(Static Import) 형태로 작성되어 있다. 이 구조는 사용자가 접속하지 않는 위젯 실험실(`/widgets`), 디자인 시스템(`/design-system`), 개별 신호 실험 페이지(`/signal`)의 모든 코드와 무거운 서드파티 라이브러리(d3, echarts, leaflet)들을 최초 진입 시 무조건 일시에 로딩하게 만드는 주된 요인이다.

따라서 최적화의 타겟을 다음 세 가지 영역으로 분류했다.
1. **의존성 모듈 청크 분리**: 빌드 설정 파일인 vite.config.ts를 통한 라이브러리 분리.
2. **라우트 수준 코드 스플리팅**: 라우터 설정인 App.tsx의 정적 임포트 동적 로딩화.
3. **가상화 및 지연 로드 적용**: 공고 목록 화면인 JobsScreen.tsx의 렌더링 제어.

<figure class="fig">
<svg viewBox="0 0 660 220" role="img" aria-label="세 가지 최적화 타겟과 각각의 수정 대상 파일, 목표 수치를 정리한 구조도">
<rect x="15" y="20" width="200" height="90" rx="8" fill="#eef2f9" stroke="#21447c"></rect>
<text x="115" y="42" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="12" font-weight="700" fill="#21447c">1. 의존성 청크 분리</text>
<text x="115" y="60" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#5b5e66">vite.config.ts</text>
<text x="115" y="76" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#5b5e66">manualChunks로</text>
<text x="115" y="92" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#5b5e66">echarts/d3/leaflet 분리</text>
<rect x="230" y="20" width="200" height="90" rx="8" fill="#eef2f9" stroke="#21447c"></rect>
<text x="330" y="42" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="12" font-weight="700" fill="#21447c">2. 라우트 코드 스플리팅</text>
<text x="330" y="60" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#5b5e66">App.tsx</text>
<text x="330" y="76" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#5b5e66">React.lazy + Suspense로</text>
<text x="330" y="92" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#5b5e66">90여 개 라우트 지연화</text>
<rect x="445" y="20" width="200" height="90" rx="8" fill="#eef2f9" stroke="#21447c"></rect>
<text x="545" y="42" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="12" font-weight="700" fill="#21447c">3. 가상화·지연 로드</text>
<text x="545" y="60" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#5b5e66">JobsScreen.tsx</text>
<text x="545" y="76" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#5b5e66">react-window로</text>
<text x="545" y="92" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#5b5e66">보이는 영역만 DOM 생성</text>
<line x1="15" y1="130" x2="645" y2="130" stroke="#e4e6ec" stroke-width="1"></line>
<rect x="15" y="145" width="300" height="55" rx="8" fill="#f7f8fa" stroke="#c9ccd3"></rect>
<text x="165" y="167" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11.5" font-weight="700" fill="#1a1c20">목표: index.js 500KB 이하</text>
<text x="165" y="184" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#5b5e66">현재 3.98MB의 약 8분의 1 수준</text>
<rect x="345" y="145" width="300" height="55" rx="8" fill="#f7f8fa" stroke="#c9ccd3"></rect>
<text x="495" y="167" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11.5" font-weight="700" fill="#1a1c20">목표: FCP/LCP 2.5~3.0초</text>
<text x="495" y="184" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#5b5e66">현재 8.7초/9.6초에서 단축</text>
</svg>
<figcaption><b>그림 1.</b> 세 가지 최적화 타겟과 각각의 수정 대상, 검증 시나리오가 겨냥하는 목표 수치.</figcaption>
</figure>

## 최적화 구현 계획 및 설계

### 1. 빌드 설정을 통한 서드파티 청크 세분화

* **수정 대상**: 빌드 설정 파일인 vite.config.ts
* **설계**: `build.rollupOptions.output.manualChunks`에 조건문을 구현하여 `node_modules` 내부의 큰 패키지들을 독립된 JS 리소스로 빌드한다.
  - `echarts` 및 `zrender` ➔ `vendor-echarts`로 격리
  - `d3` 및 의존 라이브러리 ➔ `vendor-d3`로 격리
  - `leaflet` 및 마커클러스터 ➔ `vendor-leaflet`로 격리
  - `highlight.js` 및 `marked` ➔ `vendor-highlight`로 격리
  - 기타 라이브러리 ➔ `vendor-libs`로 격리

### 2. 라우팅 구조의 동적 로딩화

* **수정 대상**: 라우터 설정 파일인 App.tsx
* **설계**:
  - `React.lazy`를 도입해 핵심 뷰(`DesktopJobs`, `DesktopMarket`, `DesktopMy`, `AssistantWorkspace`) 및 디자인 시스템, 위젯 페이지 컴포넌트들을 지연 로딩 컴포넌트로 선언한다.
  - 라우터 최상위 영역에 `<Suspense fallback={<DefaultSpinner />}>`를 감싸 데이터 로딩 단계의 화면 깜빡임을 제어한다.

### 3. 채용 공고 및 대시보드 리스트 가상 스크롤화

* **대상 컴포넌트**: 공고 목록 화면인 JobsScreen.tsx 및 데스크톱 전용 컴포넌트
* **설계**:
  - `react-window` 라이브러리를 도입하여, 한 화면에 렌더링되는 채용 공고 카드의 개수를 현재 브라우저 높이에 맞는 범위로 제안한다.
  - 스크롤 이벤트 발생 시 DOM 객체 인스턴스를 추가로 늘리지 않고, 위치 값을 재계산하여 노출 영역의 데이터만 실시간 바인딩 처리하도록 수정한다.

### 4. 렌더 차단 스타일 및 폰트 개선

* **수정 대상**: 메인 HTML인 index.html 및 스타일시트
* **설계**: Google Fonts API 호출 링크에 `display=swap` 옵션을 삽입하여 웹폰트 미조회로 인한 첫 글자 렌더링 지연(FOIT)을 해결한다.

## 검증 시나리오

1. **빌드 산출물 크기 비교**: 최적화 반영 후 빌드를 다시 수행하여 `index.js` 크기가 500 KB 이하로 축소되었는지 점검한다.
2. **Lighthouse 수치 실측**: 로컬 프리뷰 환경을 다시 띄우고 Lighthouse 오딧을 재수행하여 FCP/LCP가 2.5초~3.0초 구간 내로 들어오는지 검증한다.
3. **UX 렌더링 무결성 점검**: 탭 전환 및 대시보드 스크롤 시 지연 현상이나 흰 화면 노출 등의 사이드 이펙트가 발생하지 않는지 감시한다.

<hr>
<ol class="footnotes">
<li id="fn1">사용자가 웹페이지에 접속했을 때 브라우저가 화면에 첫 번째 텍스트나 이미지 요소를 그리기 시작하는 시점까지 걸린 시간. <a class="fnback" href="#fnref1">↩</a></li>
<li id="fn2">사용자가 웹페이지를 요청한 시점부터 뷰포트 내에서 가장 크기가 큰 텍스트 블록이나 이미지 요소가 완전히 화면에 렌더링될 때까지 걸린 시간. <a class="fnback" href="#fnref2">↩</a></li>
</ol>
