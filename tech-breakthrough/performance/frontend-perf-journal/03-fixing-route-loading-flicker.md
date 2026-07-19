# 라우팅 전환 개선: 청크 적재 단계의 전체 화면 하얗게 깜빡임 해결 및 최종 성능 검증

**일정**: 2026-07-14  

## 목표

동적 코드 분할 적용 이후 특정 탭 페이지를 처음 방문할 때, 브라우저가 사이드바 영역을 포함해 화면 전체를 지우고 하얗게 새로고침을 일으키는 사용자 경험(UX) 저하 문제를 인지하고 이를 해결하고자 했다. 또한, 수립된 최적화 기술들을 최종 반영한 후 최초 진단 시점인 00번 문서와 동일한 환경에서 Lighthouse 측정을 다시 수행하여 개선 결과를 수치로 확인하고자 했다.

## 화면 깜빡임 현상의 원인 분석

문제의 원인은 기존 라우터 진입점 파일인 App.tsx의 Suspense 바운더리 선언 위치에 있었다. 

모든 라우팅 규칙의 바깥(최상위 레벨)에 단 하나의 Suspense가 구성되어 있어, 특정 하위 컴포넌트(예: 시장 개요 또는 채용 검색 등)의 비동기 JS 청크 로딩이 시작되는 즉시 최상위 Suspense 바운더리가 동작했다. 이 과정에서 상위 셸 레이아웃인 DesktopShell 컴포넌트의 렌더링마저 함께 차단되어 화면 전체가 흰색 대기 화면(fallback)으로 교체되는 현상이 나타났다.

## 해결 방안 및 구현

이를 해결하기 위해 셸 레이아웃 구조 내부로 Suspense 바운더리를 격리시키는 하위 배치 전략을 도입했다.

* **레이아웃 셸 수정**: 공통 셸 레이아웃 파일인 ResponsiveProductLayout.tsx 내부의 중첩 라우트 렌더링 객체인 Outlet을 직접 Suspense로 감싸도록 개편했다.

이 구조 변경을 통해 브라우저는 비동기 청크를 다운로드하는 동안에도 상위 크롬 셸(사이드바 레일 및 상단 Crumbs 바)을 그대로 유지하며, 변경이 일어나는 중심부의 Outlet 영역만 지연 렌더링 대기 상태로 노출한다.

<figure class="fig">
<svg viewBox="0 0 640 230" role="img" aria-label="Suspense 경계를 최상위에 둔 이전 구조와 Outlet 내부로 옮긴 이후 구조 비교, 이전에는 청크 로딩 시 화면 전체가 흰 화면으로 대체됐다">
<text x="150" y="22" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="13" font-weight="700" fill="#b3402f">수정 전 · 최상위 Suspense</text>
<rect x="30" y="34" width="240" height="160" rx="10" fill="#fbeae6" stroke="#b3402f"></rect>
<text x="150" y="58" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" font-weight="700" fill="#b3402f">&lt;Suspense&gt; (App.tsx 최상위)</text>
<rect x="45" y="70" width="210" height="110" rx="6" fill="#fdfdfc" stroke="#e4e6ec" stroke-dasharray="3,3"></rect>
<text x="150" y="90" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10" fill="#8a8d95">사이드바 · 톱바 · Outlet</text>
<text x="150" y="108" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10" fill="#8a8d95">전부 같은 경계 안</text>
<text x="150" y="140" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" font-weight="700" fill="#b3402f">청크 하나만 로딩해도</text>
<text x="150" y="158" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" font-weight="700" fill="#b3402f">전체가 흰 화면으로 대체</text>
<text x="490" y="22" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="13" font-weight="700" fill="#21447c">수정 후 · Outlet 내부 Suspense</text>
<rect x="370" y="34" width="240" height="160" rx="10" fill="#f7f8fa" stroke="#c9ccd3"></rect>
<rect x="385" y="48" width="210" height="30" rx="6" fill="#eef2f9" stroke="#21447c"></rect>
<text x="490" y="67" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#21447c">사이드바 · 톱바(고정 유지)</text>
<rect x="385" y="86" width="210" height="94" rx="6" fill="#eef2f9" stroke="#21447c"></rect>
<text x="490" y="106" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" font-weight="700" fill="#21447c">&lt;Suspense&gt;(Outlet만)</text>
<text x="490" y="126" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10" fill="#5b5e66">청크 로딩 중에는</text>
<text x="490" y="142" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10" fill="#5b5e66">이 영역만 대기 상태</text>
<text x="490" y="158" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10" fill="#5b5e66">셸은 그대로 유지</text>
</svg>
<figcaption><b>그림 1.</b> Suspense 경계를 셸 레이아웃 내부의 Outlet만 감싸도록 옮기면, 청크를 다운로드하는 동안에도 사이드바와 톱바가 그대로 유지된다.</figcaption>
</figure>

## 결과 및 효과

최적화 적용 후, 사이드바와 톱바가 깜빡이거나 사라지지 않고 고정된 상태에서 탭 영역 내부 콘텐츠만 자연스럽게 로드되는 것을 확인했다. 앞서 설정한 160ms의 페이드 트랜지션 애니메이션과 맞물려, 첫 진입 페이지 전환 단계에서의 조작 단절감과 로딩 대기 체감이 줄어들었다.

---

## 최종 성능 검증 및 최적화 비교

초기 번들 분할 이후에도 메인 번들의 JS(1.18 MB) 및 CSS(368 KB) 파일 크기가 여전히 커서 성능 지표가 정체되었다. 이를 보완하기 위해 70여 개의 자잘한 실험실 서브 페이지(위젯 라우트, 디자인 시스템 20여 개 디테일 뷰)까지 전부 dynamic import 구조로 전환하고, 빌드 파일인 vite.config.ts의 분할 규칙을 재정의하여 로컬 소스 코드 청크를 완전히 격리하는 2차 극단적 최적화를 집행했다.

그 결과 메인 엔트리 자바스크립트는 **30.33 kB**, 메인 CSS는 **10.33 kB**로 수축하며 약 97% 이상의 최초 다운로드 용량이 감량되는 성과를 확인했다.

최적화 단계별 성능 지표 변화는 아래와 같이 진단되었다.

| 메트릭 명칭 | 최적화 적용 전 | 1차 최적화 적용 후 | 극단적 최적화 적용 후 (최종) | 결과 |
| :--- | :--- | :--- | :--- | :--- |
| **Performance 종합 점수** | 50 / 100 | 57 / 100 | **61 / 100** | **+11점 상승 (60점대 돌파)** |
| **First Contentful Paint (FCP)**<sup class="fnref" id="fnref1"><a href="#fn1">1</a></sup> | 8.7초 | 8.4초 | **6.3초** | **2.4초 단축** |
| **Largest Contentful Paint (LCP)**<sup class="fnref" id="fnref2"><a href="#fn2">2</a></sup> | 9.6초 | 8.5초 | **6.7초** | **2.9초 단축** |
| **Total Blocking Time (TBT)**<sup class="fnref" id="fnref3"><a href="#fn3">3</a></sup> | 320ms | 0ms | **0ms** | **320ms 감소 (메인 스레드 부하 소멸)** |
| **Speed Index (SI)**<sup class="fnref" id="fnref4"><a href="#fn4">4</a></sup> | 8.7초 | 8.4초 | **6.3초** | **2.4초 단축** |
| **Cumulative Layout Shift (CLS)**<sup class="fnref" id="fnref5"><a href="#fn5">5</a></sup> | 0 | 0 | **0** | **안정 상태 유지** |

<figure class="fig">
<svg viewBox="0 0 640 220" role="img" aria-label="최적화 전, 1차 최적화 후, 극단적 최적화 후 3단계에 걸친 FCP와 LCP 변화 비교">
<text x="320" y="16" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11.5" fill="#8a8d95">단계별 지연(초) · 막대 길이는 지연 시간에 비례</text>
<text x="10" y="40" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" font-weight="700" fill="#1a1c20">FCP</text>
<text x="40" y="40" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="9.5" fill="#5b5e66">최적화 전</text>
<rect x="110" y="30" width="348" height="12" fill="#b3402f"></rect>
<text x="463" y="40" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="9.5" fill="#b3402f">8.7s</text>
<text x="40" y="58" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="9.5" fill="#5b5e66">1차 후</text>
<rect x="110" y="48" width="336" height="12" fill="#e8a196"></rect>
<text x="451" y="58" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="9.5" fill="#b3402f">8.4s</text>
<text x="40" y="76" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="9.5" fill="#5b5e66">최종</text>
<rect x="110" y="66" width="252" height="12" fill="#21447c"></rect>
<text x="367" y="76" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="9.5" font-weight="700" fill="#21447c">6.3s</text>
<line x1="110" y1="20" x2="110" y2="90" stroke="#e4e6ec" stroke-width="1"></line>
<text x="10" y="120" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" font-weight="700" fill="#1a1c20">LCP</text>
<text x="40" y="120" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="9.5" fill="#5b5e66">최적화 전</text>
<rect x="110" y="110" width="384" height="12" fill="#b3402f"></rect>
<text x="499" y="120" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="9.5" fill="#b3402f">9.6s</text>
<text x="40" y="138" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="9.5" fill="#5b5e66">1차 후</text>
<rect x="110" y="128" width="340" height="12" fill="#e8a196"></rect>
<text x="455" y="138" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="9.5" fill="#b3402f">8.5s</text>
<text x="40" y="156" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="9.5" fill="#5b5e66">최종</text>
<rect x="110" y="146" width="268" height="12" fill="#21447c"></rect>
<text x="383" y="156" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="9.5" font-weight="700" fill="#21447c">6.7s</text>
<line x1="110" y1="100" x2="110" y2="170" stroke="#e4e6ec" stroke-width="1"></line>
<text x="320" y="195" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#5b5e66">Performance 점수 50 → 57 → 61, TBT는 320ms → 0ms → 0ms</text>
<text x="320" y="211" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10" fill="#8a8d95">메인 엔트리 JS 3.98MB → 1.18MB → 30.33KB</text>
</svg>
<figcaption><b>그림 2.</b> 1차 최적화(청크 분리·지연 로딩)와 2차 극단적 최적화(전체 서브 페이지 dynamic import)를 거치며 FCP·LCP가 단계적으로 줄었다.</figcaption>
</figure>

자바스크립트 실행 지연(TBT) 0ms 상태를 견고히 유지함과 동시에, 최초 렌더링 시점인 FCP와 LCP 지표가 기존에 비해 각각 **2.4초, 2.9초씩 대폭 단축**되어 6초대 진입에 안착했다. 이는 모듈 분할 및 불필요한 스타일시트의 최초 경로 배제를 통해 브라우저 엔진의 렌더 트리 빌드 부하를 최소화했음을 명확히 증명한다.

<hr>
<ol class="footnotes">
<li id="fn1">사용자가 웹페이지에 접속했을 때 브라우저가 화면에 첫 번째 텍스트나 이미지 요소를 그리기 시작하는 시점까지 걸린 시간. <a class="fnback" href="#fnref1">↩</a></li>
<li id="fn2">사용자가 웹페이지를 요청한 시점부터 뷰포트 내에서 가장 크기가 큰 텍스트 블록이나 이미지 요소가 완전히 화면에 렌더링될 때까지 걸린 시간. <a class="fnback" href="#fnref2">↩</a></li>
<li id="fn3">FCP와 상호작용 가능 시간(TTI) 사이의 마우스 클릭, 키보드 입력 등 사용자 입력에 반응하지 못하도록 차단된 메인 스레드 대기 시간의 총합. <a class="fnback" href="#fnref3">↩</a></li>
<li id="fn4">페이지가 로드되는 동안 콘텐츠가 시각적으로 얼마나 빨리 채워지는지를 나타내는 속도 지수. <a class="fnback" href="#fnref4">↩</a></li>
<li id="fn5">로드 단계에서 화면 내 요소들이 예기치 않게 이동하여 발생하는 시각적 불안정성을 계량화한 점수. <a class="fnback" href="#fnref5">↩</a></li>
</ol>
