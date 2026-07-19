# 지연 히스토그램 관측성 버그와 그 아래 숨어 있던 raw aggregation 병목

**일정**: 2026-07-15  
**요약**: 프로덕션 부하 테스트 중 VU를 늘려도 처리량이 늘지 않는 정체 현상을 조사하다가, Grafana 대시보드의 p95/p99 지연 패널이 처음부터 잘못된 값을 보여주고 있었다는 사실을 발견했다. `prometheus_fastapi_instrumentator`가 노출하는 handler별 히스토그램의 버킷 상한이 1초뿐이라 그 이상은 전부 뭉개져 항상 1000ms 근처로 고정된 값만 나왔다. 버킷을 60초까지 넓히고 로컬과 프로덕션에서 다시 부하 테스트를 돌려 검증했더니, 이번에는 대시보드가 k6 자체 측정치와 거의 일치하는 값을 보여줬다. 그리고 그 정확해진 값이 알려준 사실은, 관측이 고장 나 있는 동안 가려져 있던 진짜 문제였다. `postings_search`, `stats_newcomer_gate`, `feed_postings` 같은 엔드포인트가 서버 CPU와 DB 커넥션은 멀쩡한데도 수십 초씩 걸리고 있었다.  

## 도입 배경

07번 문서에서 uvicorn 워커를 2개로 늘리고 커넥션 풀을 명시한 뒤, 실제로 프로덕션에 부하를 걸어 그 효과를 확인하는 절차로 넘어갔다. VU를 20에서 100까지 올리는 부하 테스트를 진행하던 중, k6 콘솔에는 요청 실패가 찍히는데 Grafana 대시보드의 에러율은 계속 0.00%를 보여주는 모순이 발견됐다. 동시에 VU 수가 41에서 73으로 거의 두 배 늘었는데도 처리량은 2.4에서 2.9 req/s 사이에 머물러 있었다. 그런데 그 순간 VM CPU는 11~18%, DB 커넥션 사용률은 10% 안팎으로 전혀 바쁘지 않았다. 서버는 한가한데 처리량이 안 느는 이 조합이 조사의 출발점이었다.

## 관측성 버그 규명

k6 자체가 만든 최종 결과 요약을 열어 보니 실제 그림은 대시보드와 완전히 달랐다. 전체 p95가 37783.2ms였고, `postings_search`는 p95 60000.4ms로 k6의 기본 HTTP 타임아웃과 정확히 맞아떨어지는 값이었다. 그런데 같은 시간대 Grafana의 p95 패널은 처음부터 끝까지 정확히 1000ms만 보여주고 있었다. 정확히 딱 떨어지는 1000ms라는 숫자 자체가 실측값이라기엔 부자연스러웠고, 이게 버킷 경계값이라는 의심으로 이어졌다.

FastAPI 앱의 메트릭 엔드포인트를 직접 열어 확인하자 원인이 드러났다. `http_request_duration_seconds_bucket`(핸들러별로 쪼갤 수 있는 라벨이 붙은 히스토그램<sup class="fnref" id="fnref1"><a href="#fn1">1</a></sup>)의 버킷 상한이 0.1초, 0.5초, 1.0초, 그리고 무한대뿐이었다. `prometheus_fastapi_instrumentator`의 소스를 확인하니 이 라이브러리는 애초에 두 종류의 히스토그램을 의도적으로 나눠 노출하고 있었다.

| 메트릭 | 라벨 | 버킷 | 용도 |
|---|---|---|---|
| `http_request_duration_highr_seconds` | 없음(전체 통합) | 0.01초부터 60초까지 21단계 | 정확한 백분위수 계산 |
| `http_request_duration_seconds` | handler, method | 0.1, 0.5, 1초뿐 | SLI<sup class="fnref" id="fnref2"><a href="#fn2">2</a></sup>(1초 넘었는지 아닌지)만 판정 |

<figure class="fig">
<svg viewBox="0 0 660 240" role="img" aria-label="히스토그램 버킷 상한을 넓히기 전과 후의 구조 비교, 넓히기 전에는 실제 지연이 얼마든 1000ms로만 보였다">
<text x="165" y="22" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="13" font-weight="700" fill="#b3402f">수정 전 · 버킷 상한 1초</text>
<rect x="20" y="34" width="290" height="26" rx="6" fill="#f7f8fa" stroke="#c9ccd3"></rect>
<text x="165" y="52" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" fill="#5b5e66">버킷: 0.1s · 0.5s · 1.0s · +Inf</text>
<rect x="20" y="66" width="290" height="30" rx="6" fill="#fbeae6" stroke="#b3402f"></rect>
<text x="165" y="86" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" fill="#1a1c20">실제 지연 5s, 30s, 37.8s, 60s</text>
<rect x="20" y="104" width="290" height="30" rx="6" fill="#fbeae6" stroke="#b3402f"></rect>
<text x="165" y="124" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" font-weight="700" fill="#b3402f">→ 전부 1000ms로 보간 불가 · 마지막 유한 버킷값 반환</text>
<text x="495" y="22" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="13" font-weight="700" fill="#21447c">수정 후 · 버킷 상한 60초</text>
<rect x="350" y="34" width="290" height="26" rx="6" fill="#f7f8fa" stroke="#c9ccd3"></rect>
<text x="495" y="52" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#5b5e66">버킷: 0.1·0.5·1·2.5·5·10·30·60s</text>
<rect x="350" y="66" width="290" height="30" rx="6" fill="#eef2f9" stroke="#21447c"></rect>
<text x="495" y="86" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" fill="#1a1c20">동일 요청, 60초 이내 어디든 구간 존재</text>
<rect x="350" y="104" width="290" height="30" rx="6" fill="#eef2f9" stroke="#21447c"></rect>
<text x="495" y="124" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" font-weight="700" fill="#21447c">→ p95 7306.8ms(대시보드) ≈ 8190.3ms(k6)</text>
<line x1="20" y1="160" x2="640" y2="160" stroke="#e4e6ec" stroke-width="1"></line>
<text x="330" y="182" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11.5" fill="#1a1c20">버킷을 넓힌 뒤에야 stress 테스트에서 postings_search p95 54709.2ms 같은</text>
<text x="330" y="200" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11.5" fill="#1a1c20">진짜 raw aggregation 병목이 대시보드에 그대로 드러났다.</text>
</svg>
<figcaption><b>그림 1.</b> 버킷 상한이 1초였던 이전 구조에서는 그 이상 지연이 전부 1000ms로 뭉개져, 관측이 고장 난 채로 실제 병목을 가리고 있었다.</figcaption>
</figure>

이 프로젝트의 대시보드들은 엔드포인트별로 쪼개 보려고 후자를 썼는데, 그 히스토그램은 애초에 "1초 안에 끝났는가"라는 이진 판정용으로 설계된 것이었다. Prometheus의 `histogram_quantile` 함수<sup class="fnref" id="fnref3"><a href="#fn3">3</a></sup>는 목표 백분위수가 마지막 유한 버킷을 넘어서는 위치에 있으면 그 이상을 보간할 방법이 없어 그냥 마지막 유한 버킷값을 반환한다. 그래서 실제 지연이 5초든 60초든 이 메트릭 위에서는 전부 1000ms로 보였다. 관측 자체가 고장 나 있었을 뿐, 서버가 실제로 괜찮았던 적은 없었다.

## 수정과 검증

`app/main.py`에서 계측을 초기화하는 부분에 `latency_lowr_buckets`를 명시해 handler별 히스토그램의 버킷을 0.1, 0.5, 1, 2.5, 5, 10, 30, 60초까지 넓혔다. 라벨 없는 고해상도 히스토그램은 원래도 60초까지 세밀했으므로 손대지 않았다.

```python
Instrumentator().instrument(
    app,
    latency_lowr_buckets=(0.1, 0.5, 1, 2.5, 5, 10, 30, 60),
).expose(app)
```

로컬에서 메트릭 엔드포인트를 다시 확인해 버킷이 실제로 넓어진 것을 확인한 뒤, 이 변경을 포함한 오늘 하루의 수정 전체를 커밋해 main에 푸시했다. 배포 파이프라인이 완료된 뒤 프로덕션에 다시 부하 테스트를 걸어 수정 전후를 비교했다.

첫 번째 검증은 load 테스트였다. k6 자체가 측정한 전체 p95는 8190.3ms였고, 같은 시간대 라벨 없는 고해상도 Prometheus 메트릭은 7306.8ms를 보여줬다. 클라이언트가 재는 왕복 시간과 서버가 재는 처리 시간의 정상적인 차이 범위 안에서 두 값이 일치했다. 수정 전이었다면 이 값은 무조건 1000ms로 나왔을 것이다.

두 번째 검증은 stress 테스트였다. heavy tier 엔드포인트의 가중치를 3배로 올리고 VU를 40까지 올려 조금 더 강하게 밀어붙였다. k6 자체 결과는 전체 p95 33060.0ms였고, 이번엔 handler별로 쪼갠 저해상도 메트릭도(버킷을 넓힌 뒤이므로) 유의미한 값을 낼 수 있었다. Grafana 대시보드의 p95/p99 패널은 각각 28초, 42초를 보여줬다. k6 실측치와 오차 범위 안에서 일치했다. 두 테스트 모두에서 에러율은 0.00%였다. 요청이 실패하고 있던 게 아니라 정말로 느리기만 했다는 뜻이다.

## 정확해진 관측이 드러낸 것

버킷을 고치고 나니 대시보드가 더 이상 거짓 신호를 주지 않았고, 그 결과 이전에는 안 보이던 진짜 병목이 그대로 드러났다. stress 테스트에서 측정된 엔드포인트별 평균 지연을 정리하면 다음과 같다.

| 엔드포인트 | tier | 평균(ms) | p95(ms) |
|---|---|---|---|
| stats_newcomer_gate | stats | 37793.6 | 47540.8 |
| postings_search | heavy | 36867.9 | 54709.2 |
| feed_postings | core | 22903.6 | 26518.5 |
| postings_list | core | 17066.6 | 24399.9 |
| postings_map | heavy | 13798.5 | 18844.2 |
| stats_skill_share | stats | 10697.2 | 12043.5 |
| stats_region_density | stats | 5916.8 | 6167.3 |
| postings_nearby | core | 5015.9 | 6522.9 |

같은 부하 동안 VM CPU 사용률은 20.1%, DB 커넥션 사용률은 11.8%였다. 서버 자원은 전혀 한계에 몰리지 않은 채로 개별 요청만 수십 초씩 걸리고 있었다.

체크리스트 문서(`performance/checklist.md`)에서 이미 배정했던 다섯 엔드포인트, `stats_global_domestic_gap`, `stats_skill_trend_yearly`, `stats_industry_fingerprint`, `stats_role_stack_fit`, `stats_hiring_season`은 이번 stress 테스트에서 전부 평균 1초 미만으로 빨랐다. `app/main.py`의 기동 시 구체화 뷰 생성 목록을 확인해 보니 `mv_global_domestic_gap`, `mv_skill_trend_yearly`, `mv_industry_fingerprint`, `mv_role_stack_fit`이 이미 만들어져 있었다. 팀원 배정 작업은 끝났고 효과도 실측으로 확인된다. 오늘 표에 새로 등장한 여덟 개는 그 작업 범위 밖에 있던, 지금까지 관측이 고장 나 있어서 아무도 못 보고 있던 엔드포인트들이다.

관련 CRUD 코드를 훑어 병목 후보를 짚어 뒀다. `postings_list`, `postings_search`, `feed_postings`는 전부 `app/crud/posting.py`의 `_apply_posting_filters`를 공유하는데, 검색어 조건이 `title.ilike("%검색어%")`처럼 앞뒤로 와일드카드가 붙은 패턴이라 인덱스를 못 타고 테이블 전체를 훑어야 한다. 매칭 필터(`match_only`, `min_match`)는 후보 행마다 `PostingTech`를 다시 스캔하는 상관 서브쿼리를 쓰고, 목록 조회와 별도로 카운트 쿼리가 같은 조건으로 테이블을 한 번 더 훑는다. `stats_newcomer_gate`는 구체화 뷰 없이 `Posting`과 `PostingTech`와 `Skill`을 조인해 매 요청마다 다시 집계하는, 체크리스트에서 이미 다뤘던 것과 같은 유형의 raw aggregation이다. `stats_skill_share`는 구체화 뷰(`mv_skill_share`)를 쓰고 있는데도 느린 것으로 보아 그 뷰에 조회 조건에 맞는 인덱스가 없을 가능성이 있다.

구체적인 조치 계획은 `backend/0715-db-improvement-plan.md`에 별도로 정리했다. 이번 문서는 문제를 규명하는 데까지이고, 다음 세션에서 그 계획을 따라 구현한다.

## 엔지니어링 교훈

관측 도구 자체가 거짓말을 하고 있으면, 그 위에서 아무리 열심히 조사해도 엉뚱한 결론에 도달한다. 오늘 조사의 첫 단서는 "VU를 늘려도 처리량이 안 는다"였는데, 만약 그 순간 대시보드의 p95가 1초로 고정된 걸 그대로 믿었다면 서버가 멀쩡한데 뭔가 클라이언트나 네트워크 쪽이 이상하다는 방향으로 계속 헛다리를 짚었을 것이다. k6가 자체적으로 남긴 원본 측정치와 대시보드 값을 나란히 놓고 비교한 것이 실제 원인을 찾은 결정적 전환점이었다. 성능 조사에서는 지표 자체의 신뢰성을 먼저 의심하는 단계가 반드시 필요하다.

또한 오늘 새로 드러난 병목이 어제 체크리스트에서 이미 처리한 다섯 엔드포인트와 겹치지 않는다는 사실은, 부분적인 최적화가 전체 그림을 보장하지 않는다는 걸 보여준다. 가장 무거워 보이는 엔드포인트 몇 개를 고치고 나면 그다음으로 무거운 엔드포인트가 새로운 병목으로 떠오른다. 관측이 정확해야 그 다음 병목이 어디인지도 매번 정확히 짚을 수 있다.

<hr>
<ol class="footnotes">
<li id="fn1">관측값을 미리 정해둔 구간(버킷) 경계별 누적 개수로 저장하는 방식. 어느 버킷까지 값이 들어왔는지로 백분위수를 근사하며, 버킷 경계가 성기거나 상한이 낮으면 그 이상의 실제 값 차이를 구분하지 못한다. <a class="fnback" href="#fnref1">↩</a></li>
<li id="fn2">Service Level Indicator. 서비스 품질을 판정하는 데 쓰는 측정 지표로, 여기서는 "요청이 1초 안에 끝났는가"라는 이진 판정에만 쓰도록 설계된 저해상도 히스토그램을 가리킨다. <a class="fnback" href="#fnref2">↩</a></li>
<li id="fn3">Prometheus의 PromQL 함수로, 히스토그램 버킷 데이터로부터 지정한 백분위수(예: 0.95)에 해당하는 근사값을 계산한다. 목표 지점이 버킷 경계 사이에 있으면 선형 보간하지만, 마지막 유한 버킷보다 큰 값은 보간할 상한이 없어 그 버킷값을 그대로 반환한다. <a class="fnback" href="#fnref3">↩</a></li>
</ol>
