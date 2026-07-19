# 성능 장애는 이렇게 진단한다: 우리가 겪은 사례로

## 개요

00 문서에서는 왜 성능 테스트가 필요한지, 03 문서에서는 가장 작은 부하조차 구조적 버그를 드러낸 사례 하나를 다뤘다. 이 문서는 그 뒤로 2026년 7월 한 달간 실제 프로덕션에서 쌓인 여섯 번의 조사를 한데 모은다. 목적은 개념을 다시 설명하는 것이 아니라, 다음에 비슷한 증상을 만났을 때 곧바로 꺼내 쓸 수 있는 판단 지도를 남기는 것이다. 여섯 사례 모두 처음 세운 가설이 실측으로 뒤집히거나 절반만 맞았고, 그 뒤집히는 과정 자체가 이 문서에서 가장 남기고 싶은 부분이다. 증상만 보고 원인을 짐작하면 대개 틀렸고, 실행계획을 열거나 관측 지표를 직접 찍어봐야 진짜 원인에 닿았다.

## 진단의 출발점

증상을 마주했을 때 가장 먼저 물어야 할 질문은 하나다. 느린 그 엔드포인트만 느린가, 아니면 그것과 무관한 엔드포인트까지 함께 느려지는가. 이 질문의 답에 따라 살펴볼 곳이 완전히 갈린다. 무관한 것까지 함께 느려진다면 문제는 그 엔드포인트의 로직이 아니라 여러 요청이 공유하는 자원, 즉 스레드풀이나 커넥션 풀이나 데이터베이스 CPU에 있다. 반대로 그 요청만 유독 느리다면 공유 자원은 무죄이고 그 쿼리 자체를 실행계획으로 열어봐야 한다.

이 판단이 왜 중요한지는 요청이 실제로 통과하는 경로를 보면 분명해진다. 클라이언트가 만든 동시 요청은 애플리케이션의 스레드풀을 지나 데이터베이스 커넥션 풀을 지나 커넥션 풀링 계층을 지나 마지막에는 데이터베이스가 실제로 쓸 수 있는 CPU 코어 수에 닿는다. 이 다섯 단계는 각각 자기 나름의 상한을 갖고 있고, 그 상한들은 서로 크기가 다르다. 어느 단계가 들어오는 요청 수보다 먼저 좁아지느냐가 병목의 위치를 결정한다.

<figure class="fig">
<svg viewBox="0 0 680 300" role="img" aria-label="요청이 지나는 다섯 단계의 용량을 비교한 막대 그림">
<defs>
<marker id="arrow04a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
<path d="M0,0 L10,5 L0,10 z" fill="#21447c"></path>
</marker>
</defs>
<text x="200" y="16" text-anchor="end" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="12" font-weight="700" fill="#1a1c20">단계</text>
<line x1="200" y1="30" x2="200" y2="66" stroke="#c9ccd3" stroke-width="1"></line>
<text x="195" y="52" text-anchor="end" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="12" fill="#1a1c20">k6 부하</text>
<rect x="200" y="30" width="389" height="36" rx="6" fill="#f7f8fa" stroke="#c9ccd3"></rect>
<text x="597" y="52" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="12" font-weight="700" fill="#1a1c20">300 VU</text>
<line x1="200" y1="66" x2="200" y2="84" stroke="#21447c" stroke-width="1.5" marker-end="url(#arrow04a)"></line>
<text x="195" y="106" text-anchor="end" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="12" fill="#1a1c20">anyio 스레드풀</text>
<rect x="200" y="84" width="420" height="36" rx="6" fill="#f7f8fa" stroke="#c9ccd3"></rect>
<text x="628" y="106" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="12" font-weight="700" fill="#1a1c20">480(120×4)</text>
<line x1="200" y1="120" x2="200" y2="138" stroke="#21447c" stroke-width="1.5" marker-end="url(#arrow04a)"></line>
<text x="225" y="152" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#5b5e66">300보다 좁아지는 첫 지점</text>
<text x="195" y="160" text-anchor="end" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="12" fill="#1a1c20">SQLAlchemy 풀</text>
<rect x="200" y="138" width="348" height="36" rx="6" fill="#f7f8fa" stroke="#c9ccd3"></rect>
<text x="556" y="160" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="12" font-weight="700" fill="#1a1c20">160(40×4)</text>
<line x1="200" y1="174" x2="200" y2="192" stroke="#21447c" stroke-width="1.5" marker-end="url(#arrow04a)"></line>
<text x="225" y="206" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#5b5e66">한 번 더 크게 좁아진다</text>
<text x="195" y="214" text-anchor="end" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="12" fill="#1a1c20">pgbouncer 백엔드</text>
<rect x="200" y="192" width="211" height="36" rx="6" fill="#f7f8fa" stroke="#c9ccd3"></rect>
<text x="419" y="214" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="12" font-weight="700" fill="#1a1c20">20</text>
<line x1="200" y1="228" x2="200" y2="246" stroke="#b3402f" stroke-width="1.5" marker-end="url(#arrow04a)"></line>
<text x="195" y="268" text-anchor="end" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="12" fill="#1a1c20">DB 컴퓨트</text>
<rect x="200" y="246" width="60" height="36" rx="6" fill="#fbeae6" stroke="#b3402f"></rect>
<text x="272" y="268" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="12" font-weight="700" fill="#b3402f">2 vCPU</text>
<text x="330" y="268" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#5b5e66">물리적 상한, 여기가 최종 병목이다</text>
</svg>
<figcaption><b>그림 1.</b> 요청이 지나는 다섯 단계와 각 단계의 상한이다. 300 VU가 들어와도 앞단 스레드풀(480)은 넉넉하지만, SQLAlchemy 풀(160)에서 이미 요청 수보다 좁아지고 pgbouncer 백엔드(20)에서 한 번 더 크게 좁아진 뒤, DB의 2 vCPU라는 물리적 상한에서 실제 병렬 실행 가능한 양으로 최종 결정된다.</figcaption>
</figure>

이 그림에서 중요한 것은 좁아지는 지점이 하나가 아니라는 사실이다. 스레드풀은 앞서 다룰 사례에서 40에서 120으로 늘려둔 뒤라 300보다 넉넉하지만, 그다음 SQLAlchemy 풀은 워커 4개에 워커당 40개씩이라 전체 160개로 이미 300보다 좁다. 여기서 초과분은 애플리케이션 안에서 커넥션을 기다리며 대기한다. 그 뒤 pgbouncer가 실제 postgres 백엔드로 내보내는 연결은 기본값 20개로 한 번 더 좁아지고, 마지막으로 그 20개 연결이 실제로 나눠 쓰는 것은 데이터베이스의 물리적인 2개 코어다. 스레드풀만 늘리고 끝내면 문제가 다음 단계로 이동할 뿐이라는 뜻이고, 실제로 사례 4가 이 사실을 정확히 보여준다.

이 관찰을 실제 판단 절차로 바꾸면 아래 흐름이 된다.

<figure class="fig">
<svg viewBox="0 0 680 300" role="img" aria-label="증상에서 원인으로 내려가는 진단 흐름도">
<defs>
<marker id="arrow04b" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
<path d="M0,0 L10,5 L0,10 z" fill="#21447c"></path>
</marker>
</defs>
<text x="340" y="16" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11.5" fill="#5b5e66">증상: 특정 엔드포인트 응답이 느리다</text>
<rect x="190" y="24" width="300" height="40" rx="8" fill="#eef2f9" stroke="#21447c"></rect>
<text x="340" y="48" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="12" font-weight="700" fill="#21447c">무관한 엔드포인트도 함께 느린가?</text>
<line x1="270" y1="64" x2="150" y2="90" stroke="#21447c" stroke-width="1.5" marker-end="url(#arrow04b)"></line>
<line x1="410" y1="64" x2="530" y2="90" stroke="#b3402f" stroke-width="1.5" marker-end="url(#arrow04b)"></line>
<text x="150" y="104" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="12" font-weight="700" fill="#21447c">예: 다른 요청도 느리다</text>
<rect x="30" y="112" width="240" height="46" rx="8" fill="#f7f8fa" stroke="#c9ccd3"></rect>
<text x="150" y="130" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11.5" fill="#1a1c20">스레드풀 · 커넥션 풀 · DB CPU 확인</text>
<text x="150" y="146" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#5b5e66">(사례 1, 4, 6)</text>
<line x1="150" y1="158" x2="150" y2="176" stroke="#21447c" stroke-width="1.5" marker-end="url(#arrow04b)"></line>
<rect x="30" y="178" width="240" height="56" rx="8" fill="#eef2f9" stroke="#21447c"></rect>
<text x="150" y="200" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11.5" font-weight="700" fill="#21447c">async 전환 · 풀 크기 조정</text>
<text x="150" y="218" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11.5" font-weight="700" fill="#21447c">캐싱으로 도달 요청 자체를 줄인다</text>
<line x1="340" y1="90" x2="340" y2="250" stroke="#e4e6ec" stroke-width="1"></line>
<text x="530" y="104" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="12" font-weight="700" fill="#b3402f">아니오: 이 요청만 느리다</text>
<rect x="410" y="112" width="240" height="46" rx="8" fill="#fbeae6" stroke="#b3402f"></rect>
<text x="530" y="130" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11.5" fill="#1a1c20">EXPLAIN ANALYZE로 실행계획을 연다</text>
<text x="530" y="146" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#5b5e66">(사례 2, 3)</text>
<line x1="530" y1="158" x2="530" y2="176" stroke="#b3402f" stroke-width="1.5" marker-end="url(#arrow04b)"></line>
<rect x="410" y="178" width="240" height="56" rx="8" fill="#fbeae6" stroke="#b3402f"></rect>
<text x="530" y="200" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11.5" font-weight="700" fill="#b3402f">인덱스가 안 먹히면 조건 재설계</text>
<text x="530" y="218" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11.5" font-weight="700" fill="#b3402f">선택도가 높으면 캐싱</text>
<text x="340" y="264" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#5b5e66">두 갈래 모두 코드 추측이 아니라 실측(EXPLAIN, pg_stat_*)으로 확정한 뒤 처방한다</text>
</svg>
<figcaption><b>그림 2.</b> 증상에서 원인으로 내려가는 판단 순서다. 무관한 엔드포인트도 함께 느리면 공유 자원을 보고, 그 요청만 느리면 쿼리 자체의 실행계획을 연다.</figcaption>
</figure>

아래 여섯 사례는 이 갈림길의 왼쪽과 오른쪽을 각각 채운다. 사례 1, 4, 6은 공유 자원 쪽, 사례 2와 3은 쿼리 자체 쪽이고, 사례 5는 두 갈래 어디에도 속하지 않는 세 번째 함정, 즉 관측 지표 자체가 거짓말을 하는 경우를 다룬다.

## 사례 1. 아무 일도 안 하는 엔드포인트가 27초 걸린다

`/healthz`는 `return {"status": "ok"}`가 전부다. 그런데 300VU 부하에서 이 엔드포인트의 p95가 27.3초로 나왔다. 실행되면 0.1밀리초에 끝나는 함수가 27초를 기록했다면, 그 27초는 함수 실행 시간이 아니라 전부 대기 시간이라는 뜻이다. 자기 코드가 아니라 그 앞에 쌓인 큐를 봐야 한다는 신호였다.

원인을 찾아보니 엔드포인트 303개가 전부 동기 `def`로 짜여 있었다. FastAPI는 동기 함수를 워커당 anyio 스레드풀에서 돌리는데, 이 풀의 기본 크기는 40이다. 느린 요청 몇 개가 이 40개 슬롯을 다 붙잡아버리면, `/healthz`처럼 아무 일도 안 하는 요청조차 슬롯이 빌 때까지 뒤에서 순서를 기다려야 한다. 이런 대기 구조를 head-of-line blocking<sup class="fnref" id="fnref1"><a href="#fn1">1</a></sup>이라 부르는데, 이번 증상이 정확히 그 형태였다.

처방은 두 가지였다. I/O가 없는 엔드포인트는 `async def`로 바꿔 스레드풀을 아예 우회시켰고, 스레드풀 자체의 크기도 워커당 40에서 120으로 올렸다. 결과는 p95 27.3초가 6.1밀리초로 줄었고, 캐시를 타는 다른 엔드포인트들도 함께 정상화됐다. `job_categories`는 26.9초에서 21.9밀리초로, `postings_map`은 약 1분에서 74.2밀리초로 떨어졌다. 이 사례가 남긴 일반화는 하나다. 어떤 엔드포인트가 자기 일과 무관하게 느리다면, 그것은 그 엔드포인트의 문제가 아니라 공유 자원의 문제다.

## 사례 2. 인덱스가 있는데도 전체 스캔을 한다

`/api/v1/postings` 목록 조회가 300VU에서 에러율 86.8퍼센트, 평균 20.3초를 기록했다. 처음 세운 가설은 인덱스가 없을 것이라는 것이었다. 그런데 실제로 확인해보니 인덱스는 있었다. `ix_posting_list_filter`라는 이름으로 이미 만들어져 있었는데, `pg_stat_user_indexes`를 조회해보니 이 인덱스의 스캔 횟수는 단 3회였다. 있기는 해도 쓰이지 않는, 사실상 죽은 인덱스였다.

EXPLAIN ANALYZE로 실행계획을 직접 열어보고서야 이유가 드러났다. 쿼리는 `Parallel Seq Scan on posting`으로 실행되고 있었고, 공고 565,191행 전체를 훑는 데 205.6밀리초, 버퍼 51,365개, 약 400메가바이트를 읽고 있었다. 요청 하나가 병렬 워커 두 개까지 동원하는 무거운 작업이었다. 진짜 원인은 조건절에 있었다. `close_date IS NULL OR close_date >= CURRENT_DATE`라는 조건이었는데, OR로 묶인 조건은 btree 인덱스로 좁혀지지 않는다. 인덱스가 close_date를 컬럼으로 갖고 있어도 이 조건 앞에서는 무용지물이었다.

처방은 인덱스에서 close_date를 아예 빼는 것이었다. `pool` 동등 조건과 정렬 컬럼만으로 먼저 좁힌 뒤, close_date는 결과를 재검사하는 단계에서 걸렀다. 새 인덱스는 `CREATE INDEX ix_posting_list_latest ON posting (pool, post_date DESC NULLS LAST, id DESC) WHERE is_deleted = false`였다. 여기서 `CURRENT_DATE`를 부분 인덱스<sup class="fnref" id="fnref2"><a href="#fn2">2</a></sup>의 WHERE 조건에 넣을 수 없다는 제약도 함께 확인했다. `CURRENT_DATE`는 호출 시점에 따라 값이 달라지므로 IMMUTABLE<sup class="fnref" id="fnref3"><a href="#fn3">3</a></sup>이 아니고, 부분 인덱스의 조건은 IMMUTABLE한 표현식만 허용한다. 결과는 205.6밀리초가 3.6밀리초로, 버퍼 51,365개가 17개로 줄었다. 인덱스가 있다는 것과 그 인덱스를 실제로 쓴다는 것은 다르다. `pg_stat_user_indexes`의 `idx_scan`을 보면 죽은 인덱스가 드러나고, 코드만 읽지 말고 EXPLAIN으로 실행계획을 직접 열어봐야 확정할 수 있다.

## 사례 3. 인덱스로 못 고치는 쿼리도 있다

같은 목록 조회의 COUNT 쿼리는 인덱스를 새로 만들어줘도 플래너가 쓰기를 거부했다. 이유는 선택도<sup class="fnref" id="fnref4"><a href="#fn4">4</a></sup>에 있었다. 조건에 걸리는 행이 229,553건, 전체가 565,191건이니 선택도가 40.6퍼센트였다. 테이블의 40퍼센트를 세야 한다면 인덱스를 타고 한 건씩 찾아가는 것보다 처음부터 순서대로 다 훑는 시퀀셜 스캔이 실제로 더 빠르고, 플래너의 판단은 옳았다.

처방은 인덱스가 아니라 캐싱으로 방향을 바꾸는 것이었다. 다만 응답 전체를 캐시하지 않고 COUNT 값만 골라서 캐시했다. 전체 건수는 페이지 번호나 페이지 크기나 정렬 순서와 무관하게 필터 조건에만 의존하므로, 같은 필터를 쓰는 모든 페이지 요청이 캐시된 값 하나를 공유할 수 있다. 목록 자체는 여전히 인덱스를 타고 매번 새로 조회되므로 신규 공고가 노출되는 시점은 지연되지 않는다. 선택도가 높으면 인덱스는 답이 아니고, 캐싱도 전부 아니면 전무가 아니다. 무거운 부분만 골라 캐시하면 데이터가 살짝 낡아 있을 위험을 최소화하면서도 부하를 걷어낼 수 있다.

## 사례 4. 캐시 유무가 에러율을 그대로 갈랐다

300VU 측정 결과를 정렬해보니 패턴이 완벽하게 갈렸다. Redis 캐시를 앞에 둔 엔드포인트는 예외 없이 에러율 0퍼센트에 응답 시간 10에서 70밀리초였고, 데이터베이스를 직접 두드리는 엔드포인트만 에러율 46에서 64퍼센트에 평균 17에서 24초였다. 처방은 집계성 통계 16개에 캐시를 붙이는 것이었다. 이 값들은 스크래핑 주기로만 바뀌므로 6시간 TTL로도 충분했다. `stats_cooccurrence`는 18.1초에 에러율 64.0퍼센트에서 10.3밀리초에 0퍼센트로, `postings_detail`은 19.4초에 52.8퍼센트에서 8.0밀리초에 0퍼센트로 바뀌었고, 전체 처리량은 3,667건에서 6,362건으로 73퍼센트 늘었다.

여기서 반전이 있었다. 전체 p95는 오히려 41.5초에서 56.1초로 나빠졌고, 캐시를 붙이지 않은 나머지 네 엔드포인트의 에러율은 53퍼센트에서 86퍼센트로 올랐다. 이유는 캐시된 엔드포인트들이 즉시 응답하면서 VU가 더 빨리 다음 요청으로 순환했고, 그 순환이 빨라진 만큼 캐시 없는 나머지 엔드포인트를 더 세게 두들겼기 때문이었다. `postings_list` 요청 수는 417건에서 725건으로 늘었다. 병목을 하나 없애면 부하는 사라지지 않고 다음 병목으로 이동한다. 부분 최적화가 전체 지표를 오히려 악화시켜 보일 수 있다는 것을 이 사례가 그대로 보여줬다.

## 세 번의 300VU 측정: 처방을 쌓아가며 본 전체 곡선

사례 1의 스레드풀 조정을 시작점으로 두고, 사례 4의 통계 16개 캐싱, 그리고 사례 2와 3의 인덱스 재설계와 COUNT 캐싱을 차례로 얹어가며 같은 300VU 조건으로 세 번을 측정했다. 그 결과를 표로 정리하면 아래와 같다.

| 지표 | 1차(시작점) | 2차(캐싱 16개) | 3차(인덱스+COUNT캐싱) |
|---|---|---|---|
| 전체 에러율 | 31.43% | 25.03% | 17.38% |
| DB CPU(플래토) | 99.9% | 100% | 91.2% |
| 처리량 | 18 req/s | 32 req/s | 32 req/s |
| 총 요청 수 | 3,667 | 6,362 | 6,344 |
| 전체 p95 | 41.5초 | 56.1초 | 43.8초 |

<figure class="fig">
<svg viewBox="0 0 640 270" role="img" aria-label="세 번의 300VU 측정에서 에러율과 p95가 서로 다른 패턴을 보인 꺾은선 그래프">
<text x="20" y="26" text-anchor="start" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" fill="#5b5e66">에러율(%)</text>
<line x1="100" y1="110" x2="600" y2="110" stroke="#e4e6ec" stroke-width="1"></line>
<polyline points="150,29 340,46 530,65" fill="none" stroke="#21447c" stroke-width="2"></polyline>
<circle cx="150" cy="29" r="4" fill="#21447c"></circle>
<circle cx="340" cy="46" r="4" fill="#21447c"></circle>
<circle cx="530" cy="65" r="4" fill="#21447c"></circle>
<text x="150" y="20" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" font-weight="700" fill="#21447c">31.43%</text>
<text x="340" y="37" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" font-weight="700" fill="#21447c">25.03%</text>
<text x="530" y="56" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" font-weight="700" fill="#21447c">17.38%</text>
<text x="20" y="150" text-anchor="start" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" fill="#5b5e66">p95(초)</text>
<line x1="100" y1="230" x2="600" y2="230" stroke="#e4e6ec" stroke-width="1"></line>
<polyline points="150,168 340,146 530,164" fill="none" stroke="#b3402f" stroke-width="2"></polyline>
<circle cx="150" cy="168" r="4" fill="#b3402f"></circle>
<circle cx="340" cy="146" r="4" fill="#b3402f"></circle>
<circle cx="530" cy="164" r="4" fill="#b3402f"></circle>
<text x="150" y="184" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" font-weight="700" fill="#b3402f">41.5초</text>
<text x="340" y="132" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" font-weight="700" fill="#b3402f">56.1초</text>
<text x="530" y="180" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" font-weight="700" fill="#b3402f">43.8초</text>
<text x="340" y="120" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10" fill="#5b5e66">2차에서 잠깐 나빠졌다가 3차에서 되돌아온다</text>
<text x="150" y="250" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" fill="#1a1c20">1차(시작점)</text>
<text x="340" y="250" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" fill="#1a1c20">2차(캐싱 16개)</text>
<text x="530" y="250" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" fill="#1a1c20">3차(인덱스+COUNT캐싱)</text>
</svg>
<figcaption><b>그림 3.</b> 에러율(파랑)은 세 번의 측정 내내 단조 감소했지만, 전체 p95(빨강)는 2차에서 오히려 나빠졌다가 3차에서야 되돌아왔다. 같은 최적화 과정을 두고도 두 지표가 다른 곡선을 그린다.</figcaption>
</figure>

에러율은 세 번의 측정 내내 단조 감소했다. 31.43퍼센트에서 25.03퍼센트를 거쳐 17.38퍼센트까지 꾸준히 줄었다. **DB CPU가 3차에서 처음으로 100퍼센트 아래로 내려갔다(91.2퍼센트).** 목록 쿼리가 565,191행을 훑는 시퀀셜 스캔을 멈춘 결과가 여기서 그대로 드러난다. 1차와 2차의 DB CPU가 각각 99.9퍼센트와 100퍼센트로 사실상 포화 상태였던 것과 비교하면, 인덱스 재설계 하나가 DB의 여유를 실제로 만들어냈다는 뜻이다.

반면 **전체 p95는 단조 감소하지 않았다.** 1차 41.5초에서 2차 56.1초로 오히려 나빠졌다가, 3차에 이르러서야 43.8초로 돌아왔다. 이 굴곡은 사례 4에서 이미 짚은 원칙, 즉 병목은 사라지지 않고 이동한다는 사실을 곡선으로 그대로 보여준다. 2차에서 캐시된 16개 엔드포인트는 즉시 응답했지만 그만큼 나머지 요청이 더 세게 몰려 전체 p95가 오히려 늘었고, 3차에서 그 나머지 요청이 두드리던 목록 쿼리 자체를 고치고 나서야 곡선이 내려왔다. 캐시를 타는 엔드포인트들은 이 세 번의 측정 내내 한결같이 에러 0퍼센트에 10밀리초 안팎을 유지했다. 이 구간이 흔들리지 않았기 때문에, 흔들린 것은 전부 DB를 직접 두드리는 나머지 엔드포인트들의 몫이라는 것을 분명히 구분할 수 있었다.

3차 측정에서 개별 엔드포인트의 에러율도 함께 확인했다.

| 엔드포인트 | 3차 이전 에러율 | 3차 이후 에러율 |
|---|---|---|
| postings_list | 86.76% | 58.90% |
| feed_postings | 86.34% | 57.84% |
| postings_nearby | 77.93% | 55.14% |
| postings_search | 70.49% | 52.73% |

넷 다 절반 가까이 개선됐지만, 여전히 절반을 넘거나 절반에 가까운 에러율이 남아 있다. 인덱스와 캐싱으로 DB 쪽 병목을 걷어냈는데도 이 네 엔드포인트가 왜 아직 이만큼 느린지는 다음 절에서 그대로 다룬다.

## 사례 5. 조용한 실패는 관측이 거짓말하게 만든다

벡터 검색이 프로덕션에서 한 번도 성공한 적이 없었는데, 아무도 그 사실을 몰랐다. 원인은 모델 캐시 볼륨이 root 소유로 마운트되어 있어 컨테이너 안의 appuser가 임베딩 모델을 내려받지 못한 것이었다. 그런데 임베더 코드는 `except Exception`으로 예외를 통째로 삼키고 아무 기록도 남기지 않은 채 None만 반환하고 있었다. 더 나빴던 것은 그다음이었다. 이렇게 SQL로 폴백해놓고도 응답에는 `route: "vector"`, `degraded: false`가 그대로 찍혀 나갔다. 실제로는 SQL로 답하면서 벡터로 답했다고 스스로 보고하고 있었던 것이다. 이 사실은 HNSW<sup class="fnref" id="fnref5"><a href="#fn5">5</a></sup> 인덱스의 `idx_scan`이 0이라는 걸 확인하고서야 드러났다.

폴백과 조용한 실패는 다른 것이다. 폴백은 의도된 설계지만, 그 폴백을 기록하지 않는 것은 사고다. 그리고 관측 지표가 실제 동작과 어긋나면 그 위에서 내려진 모든 판단이 함께 틀어진다. 이 사례는 그림 2의 어느 갈래에도 속하지 않는다. 애초에 무엇을 실행하고 있는지 자체가 거짓으로 보고되고 있었으므로, 진단을 시작하기 전에 관측치가 진짜 동작을 반영하는지부터 의심해야 한다는 세 번째 원칙을 남겼다.

## 사례 6. 부하 생성기가 병목이면 측정 자체가 거짓말이다

로컬 PC에서 프로덕션 서버로 300VU를 쏘아보니, 가정용 회선이 그만큼의 동시 커넥션을 열지 못해 k6는 VU가 실행 중이라고 보고하는데 서버는 트래픽을 거의 받지 못하는 상태가 됐다. 그렇다고 타겟 서버 안에서 쏘는 것도 답이 아니었다. 그 경우 k6와 애플리케이션 워커와 관측 스택이 같은 vCPU를 나눠 쓰면서 부하 생성기 자신이 병목이 됐다.

처방은 타겟과 분리된 같은 리전의 별도 VM에서 부하를 생성하는 것이었다. 여기에 더해 부하 생성기의 `ulimit -n`도 확인했는데, 기본값 1024로는 대규모 동시 커넥션을 열기에 부족할 수 있다. 측정 도구가 측정 대상에 영향을 주면 그 숫자는 버려야 한다. 이 원칙은 나머지 다섯 사례의 모든 수치가 신뢰할 만한지를 되짚어보게 만든 전제이기도 했다.

## 정리: 반복해서 나온 원칙

여섯 사례를 관통하는 원칙은 몇 가지로 좁혀진다. 첫째, 자기 일과 무관하게 느린 엔드포인트는 그 엔드포인트의 문제가 아니라 공유 자원의 문제다. 스레드풀, 커넥션 풀, DB CPU가 그림 1의 다섯 단계 중 어디서 먼저 좁아지는지를 봐야 한다. 둘째, 인덱스가 있다는 것과 그 인덱스를 실제로 쓴다는 것은 다르다. `idx_scan`을 확인하고 EXPLAIN으로 실행계획을 열기 전까지는 어떤 가설도 확정이 아니다. 셋째, 선택도가 높으면 인덱스는 답이 아니고, 그럴 때는 캐싱이 대안이 되지만 캐싱은 전부 아니면 전무가 아니라 무거운 부분만 골라 적용할 수 있다. 넷째, 병목 하나를 없애면 부하는 사라지지 않고 다음 병목으로 옮겨간다. 부분적인 개선이 전체 지표를 오히려 나빠 보이게 만들 수 있다는 것을 항상 감안해야 한다. 다섯째, 폴백은 설계이지만 기록 없는 폴백은 사고이며, 관측 지표 자체가 실제 동작과 어긋나 있지 않은지부터 의심해야 한다. 여섯째, 측정 도구가 측정 대상에 영향을 준다면 그 측정값은 버려야 한다.

이 원칙들을 관통하는 하나의 태도가 있다면, 코드를 읽고 세운 가설을 실측으로 확인하기 전까지는 그 가설을 진실로 취급하지 않는 것이다. 여섯 사례 모두 처음 세운 가설이 절반은 틀렸고, 실측이 그 틀림을 드러낸 뒤에야 정확한 처방에 닿았다.

## 아직 못 푼 문제

성공만 적어놓은 문서는 다음 사람에게 거짓말을 하는 셈이다. 그래서 아직 풀지 못한 문제 하나를 그대로 남긴다. 3차 측정 이후에도 `postings_list`는 부하 상태에서 평균 21.8초, 에러율 58.9퍼센트를 기록한다. 목록 SELECT는 인덱스 재설계로 205.6밀리초에서 3.6밀리초로 줄었고, COUNT 캐시도 Redis 키가 실제로 채워지는 것을 확인해 정상 동작을 검증했다. 그런데도 이 수치가 남아 있다.

원인을 찾으며 가설을 두 번 세웠고, 두 가설 모두 실측으로 틀렸다.

첫 번째 가설은 N+1 문제였다. 공고 카드를 조립하는 루프가 공고마다 카테고리와 자격증을 개별 조회한다고 의심했다. 코드를 열어보니 목록 경로의 루프는 미리 배치로 조회해둔 딕셔너리만 참조할 뿐 쿼리를 전혀 쏘지 않았다. 개별 조회는 단건 상세 경로에만 남아 있었고, 그 경로는 이미 캐시가 붙어 8.2밀리초에 끝난다.

두 번째 가설은 `_get_posting_urls`가 URL 하나를 꺼내려고 스크래핑 원본 JSON인 `raw_posting.payload`를 통째로 끌어온다는 것이었다. 실제로 그 컬럼을 select하고 있었으니 근거는 있어 보였다. 그런데 다시 재보니 `raw_posting` 테이블 전체가 672킬로바이트에 2,000행이고, payload 하나의 평균 크기는 151바이트였다. 이 쿼리는 1.7밀리초 만에 끝났다.

무부하 상태에서 이 엔드포인트를 직접 재보니 364밀리초가 걸렸는데, 그 안에서 데이터베이스가 쓰는 시간은 다 합쳐도 9밀리초 안팎이다. 목록 SELECT 3.6밀리초, urls 조회 1.7밀리초, skills 조회 2.4밀리초, COUNT는 캐시 히트라 사실상 0에 가깝다. 같은 서버에서 `/healthz`가 24밀리초로 나오는 것을 감안해도, **약 330밀리초가 어디로 가는지는 아직 설명하지 못한다.** 데이터베이스 바깥, 즉 애플리케이션 계층 어딘가에 남은 문제라는 뜻이다.

여기서 조사를 멈춘 이유도 남겨둔다. 가설을 두 번 연속 세우고 두 번 다 실측으로 틀린 뒤에는, 세 번째 가설을 또 짐작으로 세우기보다 프로파일러를 붙여 시간이 실제로 어디서 쓰이는지 직접 측정하는 편이 낫다고 판단했다. 다음에 이 문제를 이어받는 사람은 추측으로 시작하지 말고 애플리케이션 프로파일링부터 해야 한다.

이 사례가 남기는 원칙은 두 가지다. **쿼리를 다 고쳤는데도 느리다면 병목은 데이터베이스 밖에 있다는 뜻이다.** 그리고 자기가 세운 가설을 실측으로 반증하는 데 드는 비용은, 그 가설을 붙잡고 계속 다음 조치를 미루는 비용보다 훨씬 싸다.

<hr>
<ol class="footnotes">
<li id="fn1">여러 요청이 하나의 처리 자원(여기서는 워커의 스레드풀 슬롯)을 공유할 때, 앞선 요청 하나가 오래 걸리면 그 뒤에 줄 선 요청들이 자기 일과 무관하게 함께 대기해야 하는 현상이다. 맨 앞의 요청이 뒤의 모든 요청을 막는다는 뜻에서 이런 이름이 붙었다. <a class="fnback" href="#fnref1">↩</a></li>
<li id="fn2">테이블 전체가 아니라 WHERE 조건을 만족하는 행에 대해서만 만들어지는 인덱스다. 인덱스 크기가 작아지고 그만큼 스캔과 유지 비용도 줄어들지만, 이 WHERE 조건에는 언제 평가해도 같은 결과가 나오는 IMMUTABLE한 표현식만 쓸 수 있다. <a class="fnback" href="#fnref2">↩</a></li>
<li id="fn3">postgres에서 함수나 표현식에 붙는 성질로, 같은 입력에 대해 항상 같은 결과를 반환한다는 뜻이다. `CURRENT_DATE`는 호출하는 날짜에 따라 값이 달라지므로 IMMUTABLE이 아니며, 이 때문에 부분 인덱스의 조건절이나 함수 기반 인덱스에 그대로 쓸 수 없다. <a class="fnback" href="#fnref3">↩</a></li>
<li id="fn4">어떤 조건이 전체 행 중 얼마나 좁은 범위를 골라내는지 나타내는 비율이다. 선택도가 낮을수록 인덱스로 소수의 행만 콕 집어내는 것이 유리하고, 선택도가 높아 조건에 걸리는 행이 테이블의 상당 부분을 차지하면 postgres 플래너는 인덱스 대신 시퀀셜 스캔을 선택하는 편이 더 빠르다고 판단한다. <a class="fnback" href="#fnref4">↩</a></li>
<li id="fn5">벡터 사이의 근사 최근접 이웃을 빠르게 찾기 위한 그래프 기반 인덱스 구조다. 벡터 검색 쿼리가 이 인덱스를 실제로 타면 `idx_scan` 값이 올라가므로, 이 값이 0으로 남아 있다면 벡터 검색이 애초에 이 경로를 타지 않았다는 뜻이다. <a class="fnback" href="#fnref5">↩</a></li>
</ol>
