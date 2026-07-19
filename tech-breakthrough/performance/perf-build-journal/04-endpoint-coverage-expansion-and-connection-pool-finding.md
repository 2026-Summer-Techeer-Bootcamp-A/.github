# k6 커버리지 확장, 그리고 새로 드러난 커넥션 풀 경합

**일정**: 2026-07-14  
**요약**: k6 스위트를 5종으로 늘리고 커버리지를 31개 엔드포인트로 넓히는 과정에서, 이전 스위트로는 안 보이던 커넥션 풀 경합 문제를 새로 발견했다.  

## 목표

`smoke.js`/`load.js` 두 개, 4개 GET 엔드포인트만 다루던 k6 스위트를 스모크/일반부하/과부하/중단점/스파이크 5종으로 늘리고, 안전하게 다룰 수 있는 GET 엔드포인트를 31개까지 넓혔다(카탈로그와 제외 기준은 `performance-test/k6/README.md`에 있다). 이 문서는 커버리지를 넓히는 과정에서 실제로 로컬에서 돌려보다 발견한, 이전 스위트로는 안 보이던 문제를 기록한다.

## 이전에는 보이지 않았던 이유

기존 `load.js`는 `/healthz`, `/api/v1/postings`, `/skills`, `/api/v1/job-categories` 딱 4개만 때렸다. 이 넷은 전부 가볍다. 단순 조회거나 materialized view 기반이다. `perf-build-journal/02-production-first-run.md`가 남긴 로컬 baseline(VU 20, 1분)은 p95 156ms였다.

새 카탈로그는 `/api/v1/stats/*`, `/api/v1/trend/*` 계열의 대시보드 위젯용 엔드포인트를 대거 추가했다. 이 중 5개는 materialized view<sup class="fnref" id="fnref1"><a href="#fn1">1</a></sup>가 없는데, `mv_skill_share`/`mv_cooccurrence`를 쓰는 것들과 달리 매 요청마다 `Posting`/`PostingTech`를 직접 조인해서 GROUP BY로 집계한다.

## 실측: VU=20/1분 조건 결과

새 `load.js`(카탈로그 31개, 가중치 랜덤)를 기존과 동일한 기본값(`MAX_VUS=20`, `DURATION=1m`)으로 로컬 dev 스택(`docker-compose.dev.yml`, observability 스택까지 포함해 컨테이너 12개가 한 머신에서 같이 도는 환경)에 돌린 결과다.

| 엔드포인트 | tier(당시 분류) | avg | p95 |
|---|---|---|---|
| `stats_skill_trend_yearly` | stats | 6959ms | **12353ms** |
| `stats_hiring_season` | stats | 5659ms | **10422ms** |
| `stats_role_stack_fit` | stats | 2755ms | 4561ms |
| `stats_global_domestic_gap` | stats | 3740ms | 4909ms |
| `stats_industry_fingerprint` | stats | 2849ms | 4127ms |
| (참고) `stats_cooccurrence`(MV 기반) | stats | 91ms | 214ms |
| (참고) `healthz` | infra | 115ms | 307ms |
| 전체 `http_req_duration` | - | - | **4054ms** |

전체 요청 실패율은 0%였다. 에러는 하나도 안 났다. 문제는 정확성이 아니라 지연이다.

가벼운 엔드포인트(`healthz`, `skills`, `certs` 등)도 이전 baseline(수십~백여 ms)보다 눈에 띄게 느려졌다(수백ms~1.6초). 무거운 쿼리 자체가 느린 것과는 별개로, 나머지 전부가 도미노로 느려졌다는 뜻이다. 가장 그럴듯한 설명은 커넥션 풀<sup class="fnref" id="fnref2"><a href="#fn2">2</a></sup> 경합이다. 5개의 무거운 쿼리가 각각 몇 초씩 DB 커넥션을 붙잡고 있는 동안, 풀 크기가 작으면 나머지 가벼운 요청들이 커넥션을 기다리며 줄을 선다. 다만 이번 조사에서 실제 풀 크기나 쿼리 플랜을 확인하지는 않았으므로, 이 문서는 증상을 실측한 기록이지 원인을 확정한 진단은 아니다.

<figure class="fig">
<svg viewBox="0 0 640 250" role="img" aria-label="무거운 집계 쿼리 5종이 커넥션 풀을 오래 붙잡아 가벼운 요청들이 대기하며 함께 느려지는 개념도">
<defs>
<marker id="arrow04" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
<path d="M0,0 L10,5 L0,10 z" fill="#21447c"></path>
</marker>
</defs>
<text x="105" y="24" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="12.5" font-weight="700" fill="#b3402f">무거운 집계 쿼리 5종</text>
<rect x="20" y="36" width="170" height="26" rx="6" fill="#fbeae6" stroke="#b3402f"></rect>
<text x="105" y="53" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" fill="#1a1c20">stats_skill_trend_yearly · p95 12.4s</text>
<rect x="20" y="66" width="170" height="26" rx="6" fill="#fbeae6" stroke="#b3402f"></rect>
<text x="105" y="83" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" fill="#1a1c20">stats_hiring_season · p95 10.4s</text>
<rect x="20" y="96" width="170" height="26" rx="6" fill="#fbeae6" stroke="#b3402f"></rect>
<text x="105" y="113" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" fill="#1a1c20">그 외 3종 · p95 4~5s</text>
<line x1="192" y1="75" x2="248" y2="75" stroke="#b3402f" stroke-width="1.5" marker-end="url(#arrow04)"></line>
<rect x="250" y="20" width="140" height="180" rx="10" fill="#f7f8fa" stroke="#c9ccd3"></rect>
<text x="320" y="40" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="12" font-weight="700" fill="#1a1c20">커넥션 풀</text>
<text x="320" y="54" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10" fill="#8a8d95">(정확한 크기는 미확인)</text>
<rect x="265" y="64" width="110" height="20" rx="4" fill="#b3402f"></rect>
<text x="320" y="78" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="9.5" fill="#fdfdfc">슬롯 점유 · 수 초</text>
<rect x="265" y="88" width="110" height="20" rx="4" fill="#b3402f"></rect>
<text x="320" y="102" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="9.5" fill="#fdfdfc">슬롯 점유 · 수 초</text>
<rect x="265" y="112" width="110" height="20" rx="4" fill="#e4e6ec" stroke="#c9ccd3"></rect>
<text x="320" y="126" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="9.5" fill="#5b5e66">남은 슬롯 대기 발생</text>
<line x1="320" y1="200" x2="320" y2="215" stroke="#21447c" stroke-width="1.5" marker-end="url(#arrow04)"></line>
<text x="320" y="230" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" fill="#5b5e66">PostgreSQL</text>
<line x1="248" y1="180" x2="192" y2="200" stroke="#5b5e66" stroke-width="1.2" stroke-dasharray="3,3"></line>
<text x="480" y="24" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="12.5" font-weight="700" fill="#1a1c20">가벼운 요청들</text>
<rect x="420" y="36" width="140" height="26" rx="6" fill="#f7f8fa" stroke="#c9ccd3"></rect>
<text x="490" y="53" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" fill="#1a1c20">healthz, skills, certs...</text>
<line x1="490" y1="62" x2="490" y2="100" stroke="#8a8d95" stroke-width="1.5" stroke-dasharray="4,3" marker-end="url(#arrow04)"></line>
<text x="490" y="118" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" fill="#b3402f" font-weight="600">풀이 비길 기다리며 대기</text>
<text x="490" y="134" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" fill="#b3402f" font-weight="600">→ 도미노 지연(수백ms~1.6s)</text>
</svg>
<figcaption><b>그림 1.</b> 무거운 집계 쿼리 5종이 커넥션 풀 슬롯을 몇 초씩 붙잡는 동안, 원래 빨랐던 요청들도 빈 슬롯을 기다리며 함께 느려지는 구조로 추정된다. 실제 풀 크기와 쿼리 플랜은 이번 조사에서 확인하지 않아 추정 단계임을 표시했다.</figcaption>
</figure>

## 지금 한 조치와 하지 않은 조치

k6 스위트 쪽에서는 이 5개를 별도 `stats_heavy` tier로 분리하고, `load.js`/`stress.js`의 threshold를 이 실측치 기준으로(이상적인 목표치가 아니라 회귀를 잡기 위한 여유 있는 상한으로) 다시 잡았다. `breakpoint.js`에는 지연 기준 abort 조건을 추가했는데, 이 백엔드는 에러를 안 뱉고 그냥 계속 느려지기만 해서 에러율 기준 threshold만으로는 중단점을 영영 못 찾을 수 있기 때문이다.

백엔드 코드는 건드리지 않았다. 이 5개 엔드포인트에 `mv_skill_share`/`mv_cooccurrence`처럼 materialized view를 추가하거나, DB 커넥션 풀 크기나 쿼리 타임아웃을 조정하는 건 이 작업의 범위 밖이다. 다만 다음에 이 영역을 손볼 사람을 위해 기록해 둔다:

- 후보 쿼리: `get_hiring_season`, `get_global_domestic_gap`, `get_industry_fingerprint`, `get_role_stack_fit`, `get_skill_trend_yearly` (전부 `app/crud/insight.py` 또는 `app/services/insight` 쪽에 있다)
- 이 엔드포인트들은 프론트 `/widgets` 갤러리와 트렌드 화면에서 쓰인다. 동시 접속자가 늘어나는 시나리오(예: 데모 시연 중 여러 명이 동시에 트렌드 탭을 열 때)에서 이 5개가 다른 모든 API 응답까지 함께 끌고 내려갈 위험이 있다.
- 프로덕션 DB는 로컬보다도 더 작다(1 vCPU/3.75GB, `02-production-first-run.md` 참고). 로컬에서 이 정도로 느려졌다면 프로덕션에서는 더 나쁠 가능성이 높은데, 다만 이건 프로덕션에서 직접 확인한 수치는 아니고 추정이다.

## 배운 것

엔드포인트 커버리지를 넓히는 것 자체가 하나의 발견 도구였다. 4개짜리 좁은 스위트는 통과만 반복했을 뿐, 이미 존재하던 위험(무거운 raw aggregation 5개 + 작은 커넥션 풀)을 전혀 드러내지 못했다. 부하테스트의 가치는 스크립트의 정교함보다 실제로 무엇을 때리느냐에 더 크게 좌우된다는 걸 다시 확인했다.

<hr>
<ol class="footnotes">
<li id="fn1">쿼리 결과를 미리 계산해 디스크에 실제 테이블처럼 저장해 두는 객체. 원본 테이블이 바뀔 때마다 자동으로 갱신되지는 않고 명시적으로 리프레시해야 하지만, 조회 시점에는 무거운 집계를 다시 계산하지 않고 저장된 결과를 그대로 읽기만 하면 된다. <a class="fnback" href="#fnref1">↩</a></li>
<li id="fn2">매 요청마다 데이터베이스 연결을 새로 맺는 비용을 피하려고, 미리 맺어 둔 연결 여러 개를 모아 두고 필요할 때 빌려주는 방식. 풀의 크기(동시에 빌려줄 수 있는 연결 수)가 제한돼 있어, 모든 연결이 사용 중이면 나머지 요청은 하나가 반납될 때까지 기다려야 한다. <a class="fnback" href="#fnref2">↩</a></li>
</ol>

