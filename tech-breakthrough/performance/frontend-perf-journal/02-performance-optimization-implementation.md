# 성능 최적화 구현: 코드 분할 실행 및 브라우저 렌더링 부하 제어

**일정**: 2026-07-14  

## 목표

수립된 최적화 설계를 바탕으로, 번들 크기를 제어하기 위한 빌드 설정 및 컴포넌트 구조 변경을 실행했다. 아울러 렌더링 성능을 개선하기 위해 CSS 최적화 기법을 도입하고, 페이지 간 이동 시의 사용자 경험을 가다듬어 초기 로딩과 조작 반응성을 모두 개선하고자 했다.

## 자바스크립트 번들의 물리적 격리

Vite 빌드 설정의 manualChunks 속성을 보완하여, 전체 용량의 큰 지분을 차지하던 외부 라이브러리인 d3, echarts, leaflet, highlight.js를 각각의 독립된 자바스크립트 리소스 파일로 나누어 생성했다. 

또한, 애플리케이션의 핵심 진입점 코드에서 각 탭별 대형 화면 구성 컴포넌트인 시장 탭, 지도 탭, 어시스턴트 탭과 실험실 관련 라우트 파일들을 지연 로딩과 로딩 바운더리를 사용해 동적 임포트(Dynamic Import) 구조로 개편했다.

그 결과, 프로덕션 빌드 시 생성되는 청크의 세분화 및 번들 크기의 축소 효과를 확인했다.

| 리소스 구분 | 최적화 적용 전 | 최적화 적용 후 | 결과 |
| :--- | :--- | :--- | :--- |
| **메인 엔트리 번들 (index.js)** | **3,981.13 kB (약 4.0 MB)** | **1,180.32 kB (약 1.18 MB)** | **70% 축소** |
| **개별 서드파티 청크 분할** | 없음 (단일 번들 내 통합) | vendor-echarts (1.13 MB)<br>vendor-highlight (939 KB)<br>vendor-libs (356 KB)<br>vendor-leaflet (149 KB)<br>vendor-d3 (55 KB) | 특정 기능 실행 전 로딩 제외 성공 |

이를 통해 메인 자바스크립트 엔트리 번들의 전송량을 약 70%가량 축소하여, 브라우저가 첫 화면을 띄울 때 다운로드해야 하는 최초 바이트의 압축에 기여했다.

<figure class="fig">
<svg viewBox="0 0 400 240" role="img" aria-label="최적화 전 단일 번들과 최적화 후 즉시 로드/지연 로드 청크 구성 비교">
<text x="90" y="20" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="12" font-weight="700" fill="#b3402f">최적화 전</text>
<rect x="40" y="30" width="100" height="179" fill="#fbeae6" stroke="#b3402f"></rect>
<text x="90" y="115" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" font-weight="700" fill="#b3402f">index.js</text>
<text x="90" y="130" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10" fill="#b3402f">3981KB</text>
<text x="90" y="145" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="9.5" fill="#b3402f">전부 즉시 로드</text>
<text x="290" y="20" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="12" font-weight="700" fill="#21447c">최적화 후</text>
<rect x="240" y="156" width="100" height="53" fill="#eef2f9" stroke="#21447c"></rect>
<text x="290" y="176" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10" font-weight="700" fill="#21447c">index.js 1180KB</text>
<text x="290" y="190" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="9" fill="#21447c">즉시 로드</text>
<rect x="240" y="105" width="100" height="51" fill="#f7f8fa" stroke="#c9ccd3"></rect>
<text x="290" y="134" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="9.5" fill="#5b5e66">vendor-echarts 1130KB</text>
<rect x="240" y="63" width="100" height="42" fill="#f7f8fa" stroke="#c9ccd3"></rect>
<text x="290" y="87" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="9.5" fill="#5b5e66">vendor-highlight 939KB</text>
<rect x="240" y="47" width="100" height="16" fill="#f7f8fa" stroke="#c9ccd3"></rect>
<text x="290" y="58" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="8" fill="#5b5e66">vendor-libs 356KB</text>
<rect x="240" y="40" width="100" height="7" fill="#f7f8fa" stroke="#c9ccd3"></rect>
<rect x="240" y="37" width="100" height="3" fill="#f7f8fa" stroke="#c9ccd3"></rect>
<text x="290" y="30" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="8" fill="#5b5e66">vendor-leaflet 149KB · vendor-d3 55KB</text>
<text x="200" y="228" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#5b5e66">회색 청크들은 해당 탭·기능을 실제로 열 때만 로드된다</text>
</svg>
<figcaption><b>그림 1.</b> 이전에는 3.98MB 전체가 첫 화면 진입 시 함께 로드됐지만, 청크 분리 후에는 index.js 1.18MB만 즉시 로드되고 나머지는 필요한 시점에 지연 로드된다.</figcaption>
</figure>

## 브라우저 렌더링 오버헤드 감소 조치

채용 공고 목록의 경우, 페이지 이동 및 필터링 시 수백 건 이상의 공고 카드가 일시에 DOM에 생성될 때 브라우저 렌더링 엔진의 오버헤드가 급증했다. 높이가 가변적으로 변하는 카드 디자인의 특성을 유지하면서 오버헤드를 감소시키기 위해 CSS의 `content-visibility: auto`<sup class="fnref" id="fnref1"><a href="#fn1">1</a></sup>와 `contain-intrinsic-size`<sup class="fnref" id="fnref2"><a href="#fn2">2</a></sup> 속성을 도입했다.

* **대상 스타일**: 일반 공고 카드 스타일시트 및 컴팩트 공고 카드 스타일시트
* **설정 규칙**:
  - 일반 공고 카드 클래스인 cr-card: `content-visibility: auto; contain-intrinsic-size: auto 150px;` 지정
  - 컴팩트 카드 클래스인 kit-jc: `content-visibility: auto; contain-intrinsic-size: auto 66px;` 지정

이 CSS 선언을 통해 브라우저는 현재 사용자가 바라보는 화면 영역인 뷰포트 외부에 있는 공고 카드 요소들의 레이아웃 및 렌더링 계산을 완전히 생략하고, 스크롤 진입 시에만 동적으로 렌더링하게 된다. 

추가적으로 공고 리스트 내에 사용되는 이미지 컴포넌트에 지연 로드 속성을 부여하여 뷰포트 외부의 로고 이미지 다운로드를 지연시킴으로써 초기 대역폭 병목을 차단했다.

## 페이지 전환 시 로딩 체감 완화 조치

사이드바 메뉴 조작에 따른 라우트 이동 시 자바스크립트 비동기 적재 대기 시간으로 인한 빈 화면 노출감을 방지하기 위해 페이드인 애니메이션을 도입했다.
* **적용 범위**: 메인 레이아웃 셸의 본문 표출 영역
* **조정 수치**: 애니메이션 지속 시간을 기존 300ms에서 **160ms**로 단축하여, 지연감 없이 부드럽게 화면이 페이드 전환되도록 구성했다.

<hr>
<ol class="footnotes">
<li id="fn1">요소가 뷰포트 밖에 있을 때 레이아웃·페인트·자식 요소의 렌더링 계산을 브라우저가 건너뛰게 하는 CSS 속성. 스크롤로 요소가 뷰포트에 들어오는 순간 다시 렌더링을 계산한다. <a class="fnback" href="#fnref1">↩</a></li>
<li id="fn2">content-visibility로 렌더링을 건너뛴 요소의 예상 크기를 미리 지정하는 속성. 이 값이 없으면 브라우저가 요소 크기를 0으로 취급해 스크롤바 길이가 실제 콘텐츠양과 어긋나는 문제가 생긴다. <a class="fnback" href="#fnref2">↩</a></li>
</ol>
