# 2026-07-14 실행 결과: 로컬 + 프로덕션 전체 스위트

**일정**: 2026-07-14  
**요약**: 새로 갖춘 5종 k6 스위트를 로컬과 프로덕션 양쪽에서 실제로 돌린 결과를 날짜와 함께 남겼다.  

## 목표

새로 갖춘 5종 k6 스위트(스모크/일반부하/과부하/중단점/스파이크, 31개 GET 엔드포인트)를 로컬과 프로덕션 양쪽에서 실제로 돌린 결과를 날짜와 함께 남긴다. 로컬은 다섯 종류 전부, 프로덕션은 README에 정해둔 원칙대로 스모크와 일반부하만 소규모로 돌렸다(과부하/중단점/스파이크는 `guardAgainstProd`가 기본적으로 막아둔 대상이라 프로덕션에서 실행하지 않았다).

## 실행 환경

- 로컬: `docker-compose.dev.yml` 기반 dev 스택(옵저버빌리티 스택 포함 컨테이너 12개가 한 머신에서 같이 도는 환경). `k6 v2.1.0`.
- 프로덕션: `https://2026-techeer-a.duckdns.org` (2 vCPU/8GB API VM + 1 vCPU/3.75GB Cloud SQL).

## 로컬 결과

### 스모크 (`smoke.js`, 1 VU, 카탈로그 31개 전부 1회씩)

전부 200, 오류율 0%. 전체 p95 2163~2495ms(가장 느린 5개 stats 엔드포인트가 끌어올린 값이고, 나머지 26개는 대부분 수십~수백ms).

### 일반부하 (`load.js`, 기본값 MAX_VUS=20 / DURATION=1m)

| 지표 | 값 |
|---|---|
| 총 요청 수 | 350건<sup class="fnref" id="fnref1"><a href="#fn1">1</a></sup> |
| 오류율 | 0.00% |
| 전체 p95 | 4054.2ms |
| 최대 VU | 20 |

가장 느린 5개(전부 `stats_heavy` tier로 재분류함):

| 엔드포인트 | avg | p95 |
|---|---|---|
| `stats_skill_trend_yearly` | 6959.8ms | 12352.9ms |
| `stats_hiring_season` | 5659.5ms | 10422.2ms |
| `stats_role_stack_fit` | 2755.7ms | 4561.2ms |
| `stats_global_domestic_gap` | 3740.3ms | 4909.1ms |
| `stats_industry_fingerprint` | 2849.4ms | 4126.8ms |

가벼운 엔드포인트(`healthz`, `skills` 등)도 이 부하에서 수백ms~1.6초로 눈에 띄게 느려졌는데, 이 5개가 붙잡은 DB 커넥션 경합의 여파로 보인다. 원인 분석은 [04번 문서](04-endpoint-coverage-expansion-and-connection-pool-finding.md) 참고.

### 과부하 (`stress.js`, MAX_VUS 15~60 범위로 여러 번 실행)

MAX_VUS 15, 30초 실행 기준 총 162건, 오류율 0.00%, 전체 p95 3759.1ms. `stats_skill_trend_yearly`가 p95 12534.9ms까지, `stats_hiring_season`이 8658.4ms까지 나왔다. 이 부하 수준에서도 **에러는 한 건도 없었는데**, 로컬 DB는 무너질 때 5xx를 뱉는 대신 그냥 계속 느려지기만 하는 특성을 보였다(아래 중단점 결과와 같은 맥락).

### 중단점 (`breakpoint.js`)

지연 기준 abort 메커니즘 자체를 검증하기 위해 `LATENCY_ABORT_MS=2000`(의도적으로 낮게)으로 실행한 결과, MAX_VUS 15 계단에서 p95가 2000ms를 15초 이상 초과하자 k6가 실제로 테스트를 스스로 중단시켰다(`thresholds on metrics 'http_req_duration' were crossed; ... stopping test prematurely`). 즉 D 항목(지연 기준 abort 추가)이 의도대로 동작한다는 것을 확인했다. 이건 "이 서버의 진짜 중단점을 찾은 결과"가 아니라 **메커니즘 검증**이다. 실제 중단점을 찾으려면 `MAX_VUS`를 기본값(200)이나 더 높게 두고 `LATENCY_ABORT_MS`도 현실적인 값(기본 8000ms)으로 돌려서 별도로 긴 실행을 돌려야 하는데, 이번 문서의 범위 밖이라 남겨둔다.

### 스파이크 (`spike.js`)

phase별 요약이 처음으로 정상 출력됐다(요청마다 `phase` 태그를 붙이고 그 서브 메트릭을 handleSummary가 표로 만든 결과):

| phase | avg | p95 | error% |
|---|---|---|---|
| baseline | 261.4ms | 630.8ms | 0.00 |
| spike | 1011.4ms | 3860.5ms | 0.00 |
| recovery | 1467.9ms | 3920.0ms | 0.00 |

눈에 띄는 점: `recovery` 구간이 `spike` 구간보다도 지연이 더 나빴다. VU 수는 스파이크가 끝나며 이미 줄었는데도 지연이 계속 나쁘다는 건, 스파이크 동안 쌓인 DB 커넥션 대기열이 VU가 줄어든 뒤에도 바로 안 풀리고 한동안 이어진다는 뜻으로 보이며, 이것도 커넥션 풀 경합 가설과 일치하는 정황이다.

## 프로덕션 결과

### 스모크

로컬과 동일하게 31/31 전부 200, 오류율 0%. 전체 p95 2104.8ms.

### 일반부하 (`MAX_VUS=5`, `DURATION=20s`, README가 정한 프로덕션 기본값)

| 지표 | 값 |
|---|---|
| 총 요청 수 | 50건<sup class="fnref" id="fnref2"><a href="#fn2">2</a></sup> |
| 오류율 | 0.00% |
| 전체 p95 | 3343.8ms |
| 최대 VU | 5 |

가장 느린 것들:

| 엔드포인트 | avg | p95 |
|---|---|---|
| `stats_skill_trend_yearly` | 5412.2ms | 5652.9ms |
| `stats_role_stack_fit` | 3513.7ms | 3513.7ms |
| `stats_newcomer_gate` | 3204.8ms | 3204.8ms |
| `stats_hiring_season` | 2598.1ms | 2598.1ms |
| `search` | 2268.0ms | 2370.5ms |

<figure class="fig">
<svg viewBox="0 0 640 250" role="img" aria-label="로컬 VU 20과 프로덕션 VU 5의 전체 p95 및 가장 느린 엔드포인트 p95 비교, 훨씬 적은 VU에서도 비슷한 자릿수로 느려지는 것을 보여준다">
<text x="150" y="22" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="13" font-weight="700" fill="#1a1c20">전체 p95</text>
<line x1="40" y1="205" x2="260" y2="205" stroke="#c9ccd3" stroke-width="1"></line>
<rect x="75" y="79" width="40" height="126" fill="#21447c"></rect>
<text x="95" y="222" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" fill="#5b5e66">로컬 · VU 20</text>
<text x="95" y="72" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" font-weight="700" fill="#21447c">4054ms</text>
<rect x="165" y="101" width="40" height="104" fill="#b3402f"></rect>
<text x="185" y="222" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" fill="#5b5e66">프로덕션 · VU 5</text>
<text x="185" y="94" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" font-weight="700" fill="#b3402f">3344ms</text>
<line x1="320" y1="10" x2="320" y2="230" stroke="#e4e6ec" stroke-width="1"></line>
<text x="490" y="22" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="13" font-weight="700" fill="#1a1c20">stats_skill_trend_yearly p95</text>
<line x1="400" y1="205" x2="620" y2="205" stroke="#c9ccd3" stroke-width="1"></line>
<rect x="435" y="35" width="40" height="170" fill="#21447c"></rect>
<text x="455" y="222" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" fill="#5b5e66">로컬 · VU 20</text>
<text x="455" y="28" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" font-weight="700" fill="#21447c">12353ms</text>
<rect x="525" y="127" width="40" height="78" fill="#b3402f"></rect>
<text x="545" y="222" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" fill="#5b5e66">프로덕션 · VU 5</text>
<text x="545" y="120" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" font-weight="700" fill="#b3402f">5653ms</text>
</svg>
<figcaption><b>그림 1.</b> 프로덕션은 로컬의 4분의 1 수준인 VU 5에서 측정했는데도 전체 p95와 가장 느린 엔드포인트 p95 모두 같은 자릿수(수 초)로 나왔다. 더 작은 DB 사양(1 vCPU/3.75GB)이 더 적은 동시 사용자로도 같은 병목을 재현하고 있다는 뜻이다.</figcaption>
</figure>

VU 5라는 아주 작은 부하에서도 로컬 20 VU 결과와 비슷한 자릿수(수 초)로 느려진다는 점이 중요하다. 프로덕션 DB(1 vCPU/3.75GB)가 로컬 dev DB보다도 작다는 걸 감안하면, 04번 문서에서 세운 가설(무거운 raw aggregation 쿼리가 커넥션을 오래 붙잡아 도미노 지연을 일으킨다)이 프로덕션에서는 더 적은 동시 사용자로도 재현된다는 뜻이다. 오류는 이번에도 0건이었다. 서비스가 죽지는 않고, 그냥 느려지기만 한다.

### 과부하 / 중단점 / 스파이크

실행하지 않았다. `stress.js`/`breakpoint.js`/`spike.js`는 `lib/guard.js`의 `guardAgainstProd`<sup class="fnref" id="fnref3"><a href="#fn3">3</a></sup>가 `duckdns.org` 호스트를 감지하면 `-e I_UNDERSTAND_PROD_RISK=yes` 없이는 즉시 에러를 던지고 중단하도록 설계돼 있다(실제로 이 가드가 정상 동작하는지도 오늘 확인했는데, 요청을 하나도 보내지 않고 즉시 막혔다). 프로덕션 DB가 이미 작은 부하에서도 수 초대 지연을 보이는 상태라, 의도적으로 더 세게 미는 테스트를 지금 프로덕션에 거는 건 실사용자와 데모에 위험이 크다고 판단해 이번에도 걸지 않았다.

## 다음 액션

오늘 수치를 근거로 MV 신설 2건 + SQL 재작성 1건 + Redis 캐싱 2건으로 나눠 4명에게 배정하는 체크리스트를 만들었다. [`checklist.md`](#backend-performance/checklist) 참고. 개선 작업이 끝나면 이 문서의 로컬/프로덕션 수치와 다시 비교해 실제로 개선됐는지 확인하는 06번 문서를 남긴다.

<hr>
<ol class="footnotes">
<li id="fn1">이 절의 모든 수치는 2026-07-14 로컬 dev 스택에서 <code>load.js</code>를 실행한 k6의 <code>handleSummary</code> 출력 원본을 그대로 옮긴 값이다. <a class="fnback" href="#fnref1">↩</a></li>
<li id="fn2">이 절의 모든 수치는 같은 날 프로덕션(<code>duckdns.org</code>)에서 <code>MAX_VUS=5, DURATION=20s</code>로 실행한 k6 출력 원본을 그대로 옮긴 값이다. <a class="fnback" href="#fnref2">↩</a></li>
<li id="fn3">k6 스크립트가 실행 대상 호스트를 검사해, 프로덕션으로 추정되는 호스트에 위험한 시나리오(과부하·중단점·스파이크)를 실수로 걸지 못하게 막는 안전장치 함수. 명시적인 환경변수 없이는 요청을 아예 보내지 않고 즉시 중단한다. <a class="fnback" href="#fnref3">↩</a></li>
</ol>

