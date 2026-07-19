# 8종 Raw Aggregation 및 검색 쿼리 병목의 데이터베이스 최적화

**일정**: 2026-07-15  
**요약**: 프로덕션 부하 테스트를 통해 발견된 8가지 병목 API의 성능 저하를 방지하기 위해 데이터베이스 최적화 작업을 진행했다. 특정 테이블의 Join 연산과 집계를 미리 수행해두는 구체화 뷰를 신설하고, 검색어 조회 성능을 가속화하기 위해 GIN 트라이그램 인덱스를 생성했으며, 복합 범위 검색 및 필터 조건에 대응하는 B-Tree 복합 인덱스들을 구축했다. 개선 후 로컬 부하 테스트 환경에서 각 병목 엔드포인트의 응답 지연 시간이 p95 기준으로 모두 1.3초 미만으로 단축되는 개선 성과를 확인했다.  

## 도입 배경

Grafana 대시보드의 지연 히스토그램 관측성 버그를 수정한 뒤에 진행된 프로덕션 stress 부하 테스트에서, 서버 자원의 사용률이 정상 범위를 유지함에도 불구하고 특정 엔드포인트들의 응답 지연 시간이 극단적으로 길어지는 정체 현상이 발견되었다. 그 중에서도 신입 채용 비율을 집계하는 API와 검색어를 활용한 공고 필터링 조회 API의 지연 시간이 가장 심각했다. 이 문제는 대량의 공고 데이터에 대해 인덱스 없이 전체를 무작위로 스캔하거나 복잡한 조인을 매 요청마다 처음부터 다시 연산하는 로직으로 인해 발생한 구조적 문제였다. 이에 응답 스키마와 데이터 정합성을 그대로 유지하면서 쿼리의 실시간 연산 비용을 최소화하기 위한 DDL 및 인덱스 최적화 개선 계획을 수립했다.

## 핵심 기술 개념

이번 최적화의 중추를 이루는 두 가지 핵심 기술은 구체화 뷰(Materialized View)<sup class="fnref" id="fnref2"><a href="#fn2">2</a></sup>와 PostgreSQL의 pg_trgm 확장 모듈이다. 대용량 테이블 간의 실시간 조인과 복잡한 집계 연산이 매번 호출될 때 발생하는 병목을 제거하기 위해 구체화 뷰를 도입했다. 일반 뷰가 쿼리 실행 시점에 원본 테이블들을 매번 실시간으로 조인하여 결과를 계산하는 것과 달리, 구체화 뷰는 집계 쿼리의 최종 결과 데이터를 디스크 공간에 물리적으로 저장하여 캐싱한다. 이 방식을 채택하면 데이터베이스는 조인 연산을 완전히 생략하고 미리 정렬되고 요약된 결과물만을 디스크에서 직접 읽어오기 때문에 조회 성능이 획기적으로 상승한다. 다만 원본 테이블의 데이터가 변경되더라도 구체화 뷰의 저장된 데이터는 자동으로 갱신되지 않으므로, 데이터 정합성을 유지하기 위해서는 적절한 시점에 `REFRESH MATERIALIZED VIEW` 명령을 명시적으로 실행하여 캐시 데이터를 주기적으로 동기화해야 한다.

한편, 부분 일치 검색 기능의 속도를 높이기 위해서는 pg_trgm 확장 모듈과 GIN(Generalized Inverted Index) 인덱스의 결합을 활용했다. 검색 창에 입력하는 임의의 검색어와 부분 일치하는 데이터를 찾기 위해 일반적으로 `ILIKE '%검색어%'` 조건을 사용하는데, 기존의 B-Tree 인덱스는 인덱스 키의 앞부분부터 순차적으로 일치하는 경우에만 탐색을 지원하므로 검색어가 중간이나 끝에 위치하는 쿼리에서는 전체 테이블을 풀 스캔해야 하는 비효율이 발생했다. pg_trgm 모듈은 문자열을 3개 문자 단위의 트라이그램(Trigram) 토큰들로 쪼개어 분할하는 역할을 하며, 이를 기반으로 GIN 인덱스<sup class="fnref" id="fnref3"><a href="#fn3">3</a></sup>를 구성하면 각 문자열 내의 모든 3글자 조합에 대한 토큰 위치 정보가 역색인(Inverted Index) 형태로 저장된다. 결과적으로 와일드카드가 앞뒤에 붙은 부분 일치 검색 쿼리가 입력되더라도 데이터베이스는 토큰 인덱스를 조회하여 매칭되는 레코드를 찾아내므로, 무거운 테이블 풀 스캔을 우회하고 인덱스 스캔만으로 신속하게 결과를 반환할 수 있게 된다.

## 원인 분석 및 개선 내용

### 신입 채용 비율 집계 최적화

기존 [insight.py:get_newcomer_gate](file:///home/rivermoon/Documents/techeer-2026-summer-a/backend/app/crud/insight.py) 함수는 공고 테이블과 기술 스택 테이블 및 스킬 테이블을 전체 조인하여 매 요청마다 신입 가능 채용 비율을 live 집계했다. 이 방식은 데이터 세트의 크기가 늘어날수록 조인에 소요되는 시간이 비례하여 커지는 큰 연산 부하를 유발했다.

이에 대응하여 실시간 조인 및 집계를 우회하기 위해 [main.py](file:///home/rivermoon/Documents/techeer-2026-summer-a/backend/app/main.py)의 lifespan 블록에 `mv_newcomer_gate` 구체화 뷰를 추가하여 미리 연산된 데이터를 주기적으로 조회하도록 변경했다. 뷰 내부에 생성된 공고 건수의 내림차순 정렬 조회를 지원하도록 `ix_mv_newcomer_gate_postings` 인덱스도 함께 구성했다. 데이터 수집 작업이 완료될 때 이 뷰의 내용이 갱신될 수 있도록 [admin.py:run_collector_job](file:///home/rivermoon/Documents/techeer-2026-summer-a/backend/app/routers/admin.py)의 구체화 뷰 갱신 흐름에 `REFRESH MATERIALIZED VIEW mv_newcomer_gate` 쿼리를 함께 추가하여 정합성 문제를 미연에 방지했다.

### 검색 및 공통 필터 최적화

공고 검색 API는 공고의 제목과 회사 명칭을 필터링하기 위해 `ILIKE '%검색어%'` 형태의 부분 일치 조건을 사용했다. PostgreSQL의 일반 B-Tree 인덱스는 전방 매칭이 아닌 중간 단어 검색에서는 사용될 수 없기 때문에 데이터 테이블 전체를 순차적으로 스캔하는 심각한 병목을 초래했다.

이 문제를 해결하고자 데이터베이스 기동 시 `pg_trgm` 트라이그램 확장 기능 모듈을 먼저 활성화하도록 설정하고, 공고 테이블의 `title`과 `company` 컬럼에 GIN 트라이그램 인덱스인 `ix_posting_title_trgm` 및 `ix_posting_company_trgm`을 추가하여 인덱스 조건 하에 부분 일치 쿼리가 처리되도록 만들었다. 추가적으로 공고 목록 조회 API들에서 항상 공통으로 필터링에 사용하는 pool 조건과 미삭제 조건 및 정렬 순서를 고려해 `(pool, close_date, post_date DESC)` 순서의 부분 복합 인덱스인 `ix_posting_list_filter`를 적용했다.

### 지도 및 공간 범위 검색 최적화

공고 지도 서비스는 사용자가 화면에 보고 있는 좌표 범위 내의 공고를 반환하기 위해 위도와 경도에 대한 범위 쿼리를 반복하여 수행한다. 기존에는 해당 컬럼들에 적합한 가속 장치가 없어 전체 데이터를 순차 탐색하는 비효율이 존재했다.

B-Tree 복합 인덱스를 사용하여 범위 탐색의 영역을 효율적으로 축소할 수 있도록 `(pool, lat, lng)` 복합 범위 인덱스인 `ix_posting_coordinates`를 생성했다. 또한 특정 지역구 코드로 필터링하는 조건에 대응하기 위해 `region_district` 단일 부분 인덱스인 `ix_posting_region_district`도 추가하여 쿼리가 인덱스 필터를 통과하게끔 개선했다.

### 구체화 뷰 및 통계 집계 최적화

통계 기능 중 스킬 점유율을 제공하는 API는 이미 생성되어 있던 구체화 뷰 `mv_skill_share`를 쿼리하고 있었으나, 조회 필터인 `pool`과 `position` 조건에 매핑되는 인덱스가 없어 뷰 전체를 매칭 조건 없이 전체 스캔하는 버그가 있었다. 해당 뷰의 컬럼 조합에 맞춰 복합 인덱스 `ix_mv_skill_share_pool_pos`를 새롭게 추가했다.

추가로 지역 밀도 분석 및 인기 회사 통계를 처리할 때 공고 테이블 내부에서 수행되는 `GROUP BY` 구문의 속도를 높이기 위해, 각 집계 조건에 부합하는 `ix_posting_region_density_agg` 인덱스와 `ix_posting_hot_companies_agg` 복합 인덱스를 신설했다.

## 성능 개선 결과 비교

k6 부하 테스트를 사용하여 데이터베이스 튜닝 작업 수행을 거치기 전의 프로덕션 실측치와 튜닝 적용 이후 로컬 개발 환경에서 20 VUs 부하 조건 하에 측정된 지연 시간을 비교하여 정리했다.<sup class="fnref" id="fnref1"><a href="#fn1">1</a></sup>

| 엔드포인트명 | 최적화 전 평균 지연 (ms) | 최적화 전 p95 지연 (ms) | 최적화 후 평균 지연 (ms) | 최적화 후 p95 지연 (ms) |
| :--- | :--- | :--- | :--- | :--- |
| `stats_newcomer_gate` | 37793.6 | 47540.8 | 229.4 | 398.9 |
| `postings_search` | 36867.9 | 54709.2 | 46.2 | 81.7 |
| `feed_postings` | 22903.6 | 26518.5 | 837.4 | 1221.7 |
| `postings_list` | 17066.6 | 24399.9 | 754.4 | 1044.4 |
| `postings_map` | 13798.5 | 18844.2 | 819.1 | 1258.5 |
| `stats_skill_share` | 10697.2 | 12043.5 | 431.8 | 485.7 |
| `stats_region_density` | 5916.8 | 6167.3 | 242.3 | 435.8 |
| `postings_nearby` | 5015.9 | 6522.9 | 283.7 | 601.7 |

<figure class="fig">
<svg viewBox="0 0 660 280" role="img" aria-label="8개 병목 엔드포인트의 최적화 전후 p95 지연 비교, 로그 스케일 막대 차트">
<text x="330" y="16" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11.5" fill="#8a8d95">p95 지연(ms) · 로그 스케일 · 붉은 막대 = 최적화 전(프로덕션), 파란 막대 = 최적화 후(로컬 VU 20)</text>
<text x="10" y="35" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#1a1c20">stats_newcomer_gate</text>
<rect x="155" y="24" width="363" height="9" fill="#b3402f"></rect>
<text x="523" y="32" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="9.5" fill="#b3402f">47541ms</text>
<rect x="155" y="36" width="126" height="9" fill="#21447c"></rect>
<text x="286" y="44" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="9.5" fill="#21447c">399ms</text>
<text x="10" y="65" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#1a1c20">postings_search</text>
<rect x="155" y="54" width="370" height="9" fill="#b3402f"></rect>
<text x="530" y="62" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="9.5" fill="#b3402f">54709ms</text>
<rect x="155" y="66" width="47" height="9" fill="#21447c"></rect>
<text x="207" y="74" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="9.5" fill="#21447c">82ms</text>
<text x="10" y="95" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#1a1c20">feed_postings</text>
<rect x="155" y="84" width="334" height="9" fill="#b3402f"></rect>
<text x="494" y="92" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="9.5" fill="#b3402f">26519ms</text>
<rect x="155" y="96" width="181" height="9" fill="#21447c"></rect>
<text x="341" y="104" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="9.5" fill="#21447c">1222ms</text>
<text x="10" y="125" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#1a1c20">postings_list</text>
<rect x="155" y="114" width="330" height="9" fill="#b3402f"></rect>
<text x="490" y="122" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="9.5" fill="#b3402f">24400ms</text>
<rect x="155" y="126" width="174" height="9" fill="#21447c"></rect>
<text x="334" y="134" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="9.5" fill="#21447c">1044ms</text>
<text x="10" y="155" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#1a1c20">postings_map</text>
<rect x="155" y="144" width="317" height="9" fill="#b3402f"></rect>
<text x="477" y="152" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="9.5" fill="#b3402f">18844ms</text>
<rect x="155" y="156" width="183" height="9" fill="#21447c"></rect>
<text x="343" y="164" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="9.5" fill="#21447c">1259ms</text>
<text x="10" y="185" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#1a1c20">stats_skill_share</text>
<rect x="155" y="174" width="295" height="9" fill="#b3402f"></rect>
<text x="455" y="182" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="9.5" fill="#b3402f">12044ms</text>
<rect x="155" y="186" width="136" height="9" fill="#21447c"></rect>
<text x="296" y="194" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="9.5" fill="#21447c">486ms</text>
<text x="10" y="215" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#1a1c20">stats_region_density</text>
<rect x="155" y="204" width="262" height="9" fill="#b3402f"></rect>
<text x="422" y="212" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="9.5" fill="#b3402f">6167ms</text>
<rect x="155" y="216" width="130" height="9" fill="#21447c"></rect>
<text x="290" y="224" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="9.5" fill="#21447c">436ms</text>
<text x="10" y="245" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#1a1c20">postings_nearby</text>
<rect x="155" y="234" width="265" height="9" fill="#b3402f"></rect>
<text x="425" y="242" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="9.5" fill="#b3402f">6523ms</text>
<rect x="155" y="246" width="146" height="9" fill="#21447c"></rect>
<text x="306" y="254" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="9.5" fill="#21447c">602ms</text>
<line x1="155" y1="264" x2="155" y2="18" stroke="#e4e6ec" stroke-width="1"></line>
<text x="330" y="272" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#5b5e66">8개 엔드포인트 전부 목표 상한(p95 1.3초) 아래로 내려왔다</text>
</svg>
<figcaption><b>그림 1.</b> 구체화 뷰와 GIN·B-Tree 인덱스 도입 전후 p95 지연을 로그 스케일로 비교했다. postings_search는 54.7초에서 82ms로, 약 670배 단축됐다.</figcaption>
</figure>

모든 엔드포인트에서 지연 시간이 획기적으로 개선되었으며, 부하 상황에서도 p95 지연 시간이 목표 지연 시간 한계치인 1.3초 미만을 만족하는 안정적인 수치를 달성했다.

## 결론 및 검증 소감

실제 데이터베이스에 직접 DDL을 투입하고 인덱스 스캔의 변화를 점검함으로써 쿼리가 풀 스캔을 극복하고 고성능의 인덱스 검색을 타는 과정을 입증했다. 이번 기회를 통해 관측성 확보가 선행된 상태에서의 계측과 튜닝의 반복 단계가 서버 안정화에 결정적인 기여를 한다는 점을 경험했으며, 구체화 뷰의 도입과 이에 특화된 복합 인덱스 설계의 결합이 극적인 개선을 낳는 요인임을 확인했다.

<hr>
<ol class="footnotes">
<li id="fn1">이 표의 "최적화 전" 값은 <a href="10-histogram-bucket-bug-and-raw-aggregation-bottleneck.md">10번 문서</a>가 프로덕션 stress 테스트에서 실측한 수치를 그대로 인용했고, "최적화 후" 값은 이번 최적화를 적용한 뒤 로컬 개발 환경에서 VU 20으로 새로 측정한 값이다. 두 값의 실행 환경(프로덕션 vs 로컬)이 다르다는 점을 함께 밝혀 둔다. <a class="fnback" href="#fnref1">↩</a></li>
<li id="fn2">쿼리 결과를 미리 계산해 디스크에 실제 테이블처럼 저장해 두는 객체. 원본이 바뀌어도 자동으로 갱신되지 않고 <code>REFRESH MATERIALIZED VIEW</code>로 명시적으로 동기화해야 한다. <a class="fnback" href="#fnref2">↩</a></li>
<li id="fn3">Generalized Inverted Index. 값 하나가 여러 개의 작은 구성 요소(여기서는 트라이그램 토큰)를 가질 수 있는 데이터에 적합한 PostgreSQL 인덱스 유형으로, 각 토큰이 어느 행에 속하는지를 역방향으로 저장해 부분 일치 검색을 인덱스 스캔만으로 처리할 수 있게 한다. <a class="fnback" href="#fnref3">↩</a></li>
</ol>
