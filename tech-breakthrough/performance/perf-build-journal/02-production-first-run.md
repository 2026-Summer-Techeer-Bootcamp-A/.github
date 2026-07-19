# 프로덕션 첫 실행: 접근 방식과 실제 버그 발견

## 목표

로컬에서는 이미 스모크와 부하 테스트를 돌려봤다. 이번에는 프로덕션에 처음으로 부하를 걸어보면서, 로컬과 다르게 지켜야 할 접근 방식을 먼저 정하고, 가장 작은 규모로 실행해 결과를 남긴다.

## 프로덕션이 로컬과 다른 점

로컬은 실패해도 아무도 영향을 받지 않지만 프로덕션은 다르다. 세 가지를 먼저 정리했다.

첫째, 어디서 실행하느냐가 중요하다. k6는 퍼블릭 HTTPS 도메인을 향해 로컬 개발 머신에서 실행한다. 절대로 프로덕션 가상머신 안에서 k6를 돌리면 안 되는데, 그 가상머신은 2 vCPU뿐이고 API 서버와 리버스 프록시와 관측 스택 전체가 이미 그 CPU를 나눠 쓰고 있어서, 부하 테스트 도구까지 같은 자원을 다투면 측정값이 오염되고 테스트 도구가 테스트 대상과 자원을 다투는 자기 파괴적인 구도가 된다.

둘째, 작게 시작해서 단계적으로만 올린다. 로컬에서는 가상 사용자 20명을 마음껏 걸었지만, 프로덕션은 데이터베이스가 최근 비용 절감을 위해 1 vCPU로 낮춰진 상태라 작은 부하에도 먼저 무너질 수 있다. 그래서 가상 사용자 몇 명, 십수 초 정도의 가장 작은 규모로 시작하고, 문제가 없을 때만 다음 단계로 올린다.

셋째, 관측 대시보드를 실시간으로 보면서 이상 징후가 보이면 즉시 중단한다. Grafana의 성능 대시보드에서 오류율과 지연 백분위수를 보며, 튀는 순간 테스트를 끊는다.

## 실제 실행

가장 작은 규모로 실행했다.

```
k6 run -e BASE_URL=https://<프로덕션 도메인> \
       -e MAX_VUS=3 -e DURATION=15s \
       performance-test/k6/load.js
```

실행 전 헬스체크는 정상이었다. 그런데 결과가 예상과 달랐다.

| 지표 | 값 |
|---|---|
| 총 요청 | 9건 |
| 체크 통과 | 8/9 (88.88%) |
| 오류율 | 11.11% |
| p95 지연 | 24.94초 |
| 최대 지연 | 39.78초 |

임계값 두 개가 모두 실패로 표시됐다. p95는 800밀리초 미만이어야 했는데 실제로는 24.94초였고, 오류율은 1퍼센트 미만이어야 했는데 11.11퍼센트였다. 가상 사용자 3명, 15초라는 아주 작은 부하에서 나온 결과라 이례적이었다.

<figure class="fig">
<svg viewBox="0 0 640 230" role="img" aria-label="로컬과 프로덕션 실행 결과 비교, 더 작은 부하를 건 프로덕션에서 오히려 오류율과 지연이 크게 나온 역설을 보여준다">
<text x="150" y="24" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="13" font-weight="700" fill="#1a1c20">오류율 비교</text>
<line x1="40" y1="195" x2="260" y2="195" stroke="#c9ccd3" stroke-width="1"></line>
<rect x="75" y="193" width="40" height="2" fill="#21447c"></rect>
<text x="95" y="212" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" fill="#5b5e66">로컬 · VU 20</text>
<text x="95" y="185" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" font-weight="700" fill="#21447c">0.00%</text>
<rect x="165" y="75" width="40" height="120" fill="#b3402f"></rect>
<text x="185" y="212" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" fill="#5b5e66">프로덕션 · VU 3</text>
<text x="185" y="68" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" font-weight="700" fill="#b3402f">11.11%</text>
<line x1="360" y1="21" x2="360" y2="205" stroke="#e4e6ec" stroke-width="1"></line>
<text x="500" y="24" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="13" font-weight="700" fill="#1a1c20">p95 지연 비교 (로그 스케일)</text>
<line x1="400" y1="195" x2="620" y2="195" stroke="#c9ccd3" stroke-width="1"></line>
<rect x="435" y="135" width="40" height="60" fill="#21447c"></rect>
<text x="455" y="212" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" fill="#5b5e66">로컬 · VU 20</text>
<text x="455" y="128" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" font-weight="700" fill="#21447c">156ms</text>
<rect x="525" y="75" width="40" height="120" fill="#b3402f"></rect>
<text x="545" y="212" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" fill="#5b5e66">프로덕션 · VU 3</text>
<text x="545" y="68" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" font-weight="700" fill="#b3402f">24.94s</text>
</svg>
<figcaption><b>그림 1.</b> 프로덕션은 로컬보다 훨씬 작은 부하(VU 3 vs 20)를 받았는데도 오류율과 지연이 압도적으로 높았다. 지연 막대는 값 차이가 커서 로그 스케일로 그렸다. 이 역설이 뒤에서 밝혀지는 실제 버그로 이어진다.</figcaption>
</figure>

## 원인 추적

테스트가 끝난 직후 헬스체크를 다시 확인하니 0.26초로 정상이었다. 서비스가 완전히 멈춘 것은 아니었고, 특정 요청만 문제가 있었다는 뜻이다. 컨테이너 로그를 확인하니 다음 예외가 반복되고 있었다.

```
psycopg.OperationalError: sending query and params failed:
number of parameters must be between 0 and 65535
```

이 예외는 PostgreSQL 자체의 하드 리밋<sup class="fnref" id="fnref1"><a href="#fn1">1</a></sup>이다. 한 쿼리에 바인딩하는 파라미터 개수가 65,535개를 넘으면 데이터베이스가 그 쿼리를 통째로 거부한다. 예외가 발생한 코드 경로를 따라가니 공고 목록 엔드포인트의 구현에 구조적인 문제가 있었다.

```python
postings = _get_filtered_postings(session=session, pool=pool, position=position, ...)
posting_ids = [posting.id for posting in postings]
skill_map, skill_id_map = _get_posting_skills(session, posting_ids)
...
total = len(cards)
offset = (page - 1) * page_size
return cards[offset : offset + page_size], total
```

`_get_filtered_postings`가 필터에 맞는 공고를 데이터베이스 레벨에서 페이지 단위로 자르지 않고 전부 가져온다. 그렇게 모은 전체 posting_id 목록을 그대로 `_get_posting_skills`에 넘기는데, 이 함수는 `posting_id.in_(ids)` 형태의 IN 절<sup class="fnref" id="fnref2"><a href="#fn2">2</a></sup>로 그 모든 id를 하나의 쿼리에 파라미터로 바인딩한다. 페이지 자르기는 그 뒤, 파이썬 리스트 슬라이싱으로 마지막에 한 번 일어난다. 즉 사용자가 몇 건을 보든 상관없이, 필터에 걸리는 전체 공고의 기술 스택을 매번 통째로 조회하는 구조다.

실제 공고 수를 필터 없이 세어보면 다음과 같았다.

| 구분 | 건수 |
|---|---|
| domestic | 47,065 |
| global | 518,126 |
| 합계(필터 없음) | 565,191 |

k6 스크립트는 공고 엔드포인트를 `?limit=20`으로 불렀는데, 그 엔드포인트는 `limit`이라는 쿼리 파라미터를 아예 선언하지 않고 있었다. 선언되지 않은 쿼리 파라미터는 조용히 무시되므로, 실제로는 필터가 하나도 걸리지 않은 상태로 호출된 것과 같았다. 필터가 없으면 55만 건이 전부 대상이 되고, 이는 65,535라는 한도를 압도적으로 넘는다. 그래서 이 호출은 우연이 아니라 매번 결정적으로 실패하는 호출이었다. 관측된 11.11퍼센트의 오류율은, 스크립트가 네 개 엔드포인트를 무작위로 섞어 부르는 와중에 공고 엔드포인트가 뽑힌 비율과 맞아떨어졌다.

## 이 발견의 가치

이 버그는 기능 테스트로는 잡히지 않는다. 공고 몇 건을 눈으로 확인하는 수준의 테스트에서는 응답이 늦게라도 오거나, 데이터 규모가 작을 때는 문제가 전혀 드러나지 않는다. 데이터가 수십만 건으로 커진 지금, 그리고 필터 없이 호출되는 경우에만 이 한계에 부딪힌다. 가상 사용자 3명짜리 가벼운 부하 테스트가 기능적으로는 멀쩡해 보이던 엔드포인트에서 실제 운영 규모의 데이터가 만드는 구조적 한계를 곧바로 드러냈다. 이것이 00 문서에서 부하 테스트가 필요하다고 말한 이유를 그대로 보여주는 사례다.

## 지금 조치한 것과 남긴 것

k6 스크립트는 같은 실패를 반복해서 서버에 부담을 주지 않도록 즉시 고쳤다. 공고 엔드포인트 호출에 `pool=domestic` 필터를 추가했다. domestic만 필터링하면 47,065건으로 한도 아래이므로 안전하게 부하 테스트를 계속할 수 있다.

다만 애플리케이션 코드 자체, 즉 공고 목록 조회에 데이터베이스 레벨 페이지네이션<sup class="fnref" id="fnref3"><a href="#fn3">3</a></sup>을 추가하는 수정은 이번에는 하지 않았다. 이는 프로덕션 비즈니스 로직을 바꾸는 작업이라 별도로 범위를 정해 진행할 문제이고, 이 문서는 그 버그가 존재한다는 사실과 정확한 원인을 기록하는 데 그친다.

## 배운 것

프로덕션에서의 첫 실행은 성능 수치를 재기도 전에 정확성 버그를 먼저 찾았다. 부하 테스트의 가치는 단지 얼마나 빠른지를 재는 데만 있지 않고, 실제 데이터 규모에서만 드러나는 구조적 결함을 찾아내는 데도 있다는 것을 이번 실행이 보여줬다. 그리고 가장 작은 규모로 시작하는 원칙이 유효했다. 만약 처음부터 가상 사용자 수를 크게 잡았다면, 같은 버그가 훨씬 많은 요청에서 동시에 터지면서 데이터베이스에 불필요한 부담을 줬을 것이다.

<hr>
<ol class="footnotes">
<li id="fn1">데이터베이스 엔진이 아니라 PostgreSQL 프로토콜 자체가 정한 제약으로, 애플리케이션 설정으로 늘리거나 우회할 수 없다. 쿼리 하나에 담을 수 있는 바인드 파라미터는 최대 65,535개다. <a class="fnback" href="#fnref1">↩</a></li>
<li id="fn2">SQL에서 <code>WHERE column IN (값1, 값2, ...)</code> 형태로 여러 값 중 하나라도 일치하면 참이 되는 조건절. ORM에서 파이썬 리스트를 그대로 넘기면 리스트 길이만큼 바인드 파라미터가 생긴다. <a class="fnback" href="#fnref2">↩</a></li>
<li id="fn3">전체 결과를 애플리케이션 메모리로 가져온 뒤 파이썬으로 자르는 방식이 아니라, <code>LIMIT</code>/<code>OFFSET</code>이나 커서 조건을 SQL 쿼리 자체에 포함해 데이터베이스가 필요한 행만 반환하게 하는 방식이다. <a class="fnback" href="#fnref3">↩</a></li>
</ol>
