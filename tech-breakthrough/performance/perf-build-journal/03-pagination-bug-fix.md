# 버그 수정: DB 레벨 페이지네이션과 IN절 청크 처리

## 목표

02 문서에서 찾은 파라미터 폭증 버그를 실제로 고친다. 무엇을 왜 그렇게 고쳤는지, 그리고 고친 뒤 실제 운영 규모에서 검증한 결과를 기록한다.

## 문제 재요약

공고 목록 조회 함수가 필터에 맞는 공고를 데이터베이스에서 전부 가져온 뒤, 페이지 자르기는 파이썬 리스트 슬라이싱으로 마지막에 했다. 그 사이에 있는 기술 스택 조회 쿼리가 그 전체 공고 id를 하나의 IN 절에 다 묶어서 보냈는데, 필터 없이 부르면 공고 수가 56만 건을 넘어 PostgreSQL의 파라미터 하드 리밋인 65,535개를 훌쩍 넘겼다. 이 유형의 결함에는 이름이 있다. 필요한 것보다 훨씬 많은 데이터를 데이터베이스에서 끌어온 뒤 애플리케이션 쪽에서 자르는 패턴을 무경계 조회 안티패턴이라 부르는데, 개발 환경처럼 데이터가 적을 때는 전혀 드러나지 않고 운영 규모로 커졌을 때만 비용을 치르는 특징이 있다[1].

## 두 갈래로 나눈 수정

이 함수는 두 가지 쓰임을 겸하고 있었다. 하나는 이력서 매칭 없이 단순히 필터로 공고를 훑어보는 조회이고, 다른 하나는 로그인한 사용자가 자신의 보유 기술과 얼마나 겹치는지로 걸러보는 매칭 조회다. 둘의 성격이 달라서 고치는 방법도 나눴다.

<figure class="fig">
<svg viewBox="0 0 640 270" role="img" aria-label="매칭이 필요 없는 조회와 매칭이 필요한 조회를 서로 다른 방식으로 고친 구조 비교">
<defs>
<marker id="arrow03" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
<path d="M0,0 L10,5 L0,10 z" fill="#21447c"></path>
</marker>
</defs>
<text x="150" y="22" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="13" font-weight="700" fill="#21447c">매칭 불필요 조회</text>
<rect x="30" y="34" width="240" height="34" rx="8" fill="#f7f8fa" stroke="#c9ccd3"></rect>
<text x="150" y="55" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="12" fill="#1a1c20">필터 조건 생성(공통 함수)</text>
<line x1="150" y1="68" x2="150" y2="86" stroke="#21447c" stroke-width="1.5" marker-end="url(#arrow03)"></line>
<rect x="30" y="88" width="240" height="42" rx="8" fill="#eef2f9" stroke="#21447c"></rect>
<text x="150" y="106" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="12" font-weight="700" fill="#21447c">DB 레벨 COUNT + LIMIT/OFFSET</text>
<text x="150" y="122" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#5b5e66">페이지 크기만큼만 오간다</text>
<line x1="150" y1="130" x2="150" y2="148" stroke="#21447c" stroke-width="1.5" marker-end="url(#arrow03)"></line>
<rect x="30" y="150" width="240" height="34" rx="8" fill="#f7f8fa" stroke="#c9ccd3"></rect>
<text x="150" y="171" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="12" fill="#1a1c20">응답 20건 · 0.31초</text>
<line x1="320" y1="10" x2="320" y2="255" stroke="#e4e6ec" stroke-width="1"></line>
<text x="490" y="22" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="13" font-weight="700" fill="#b3402f">매칭 필요 조회</text>
<rect x="370" y="34" width="240" height="34" rx="8" fill="#f7f8fa" stroke="#c9ccd3"></rect>
<text x="490" y="55" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="12" fill="#1a1c20">필터 조건 생성(공통 함수)</text>
<line x1="490" y1="68" x2="490" y2="86" stroke="#21447c" stroke-width="1.5" marker-end="url(#arrow03)"></line>
<rect x="370" y="88" width="240" height="34" rx="8" fill="#fbeae6" stroke="#b3402f"></rect>
<text x="490" y="109" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="12" fill="#1a1c20">필터에 걸리는 id 전체 조회</text>
<line x1="490" y1="122" x2="490" y2="140" stroke="#21447c" stroke-width="1.5" marker-end="url(#arrow03)"></line>
<rect x="370" y="142" width="240" height="42" rx="8" fill="#eef2f9" stroke="#21447c"></rect>
<text x="490" y="160" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="12" font-weight="700" fill="#21447c">5,000개 단위 청크로 IN절 반복</text>
<text x="490" y="176" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#5b5e66">파라미터 하드 리밋을 피한다</text>
<line x1="490" y1="184" x2="490" y2="202" stroke="#21447c" stroke-width="1.5" marker-end="url(#arrow03)"></line>
<rect x="370" y="204" width="240" height="34" rx="8" fill="#f7f8fa" stroke="#c9ccd3"></rect>
<text x="490" y="225" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="12" fill="#1a1c20">매칭 계산 후 슬라이싱 · 응답 20건</text>
</svg>
<figcaption><b>그림 1.</b> 트래픽이 많은 매칭 불필요 경로는 DB 레벨 페이지네이션으로 근본 해결하고, 매칭 필요 경로는 여전히 전체를 가져오되 IN절만 청크로 나눠 크래시만 막았다.</figcaption>
</figure>

매칭이 필요 없는 조회는 압도적으로 많이 쓰이는 경로이고, 로그인도 필요 없다. 이 경로는 페이지를 정하는 데 다른 조건이 필요 없으므로, 데이터베이스에 직접 몇 번째 페이지를 달라고 요청할 수 있다. 그래서 전체 개수를 세는 COUNT 쿼리와, 정확히 그 페이지 크기만큼만 가져오는 LIMIT과 OFFSET<sup class="fnref" id="fnref1"><a href="#fn1">1</a></sup>을 적용했다. 카운트 쿼리와 조회 쿼리가 같은 필터 조건을 쓰지 않으면 전체 개수와 실제 반환 건수가 어긋나는 문제가 생기므로, 필터를 만드는 코드를 함수 하나로 뽑아 두 쿼리가 반드시 같은 조건을 쓰게 만들었다.

```python
def _apply_posting_filters(stmt, *, pool, position, district, deadline_within_days):
    stmt = stmt.where(Posting.is_deleted.is_(False))
    if pool is not None:
        stmt = stmt.where(Posting.pool == pool)
    if position is not None:
        stmt = stmt.join(PostingCategory, ...).where(PostingCategory.category == position, ...)
    # district, deadline_within_days 조건도 동일하게 적용
    return stmt
```

이렇게 하면 이 경로가 다루는 공고 id 개수는 페이지 크기(최대 100건) 이하로 항상 묶인다. 필터에 걸리는 공고가 몇만 건이든 몇십만 건이든, 실제로 데이터베이스와 애플리케이션 사이를 오가는 데이터는 한 페이지 분량뿐이다.

매칭이 필요한 조회는 사정이 다르다. 어떤 공고가 매칭 기준을 넘는지는 그 공고가 요구하는 기술과 사용자가 보유한 기술을 겹쳐봐야 알 수 있고, 이 계산은 페이지를 정하기 전에 필터에 걸리는 공고 전체에 대해 이루어져야 한다. 데이터베이스에 곧바로 몇 번째 페이지를 달라고 할 수 없는 구조라서, 이 경로는 여전히 필터에 걸리는 공고 전체를 가져온다. 다만 그 전체 목록으로 기술 스택을 조회하는 함수 자체를 고쳤다. IN 절에 넣는 id 목록을 5000개 단위로 청크<sup class="fnref" id="fnref2"><a href="#fn2">2</a></sup>로 잘라 여러 번 쿼리하고 결과를 합치도록 바꿔서, id가 몇 개든 파라미터 하드 리밋에 걸리지 않게 만들었다.

```python
_IN_CLAUSE_CHUNK_SIZE = 5000

def _chunked(items, size):
    for i in range(0, len(items), size):
        yield items[i : i + size]

def _get_posting_skills(session, posting_ids):
    ids = list(posting_ids)
    skill_map, skill_id_map = {}, {}
    for batch in _chunked(ids, _IN_CLAUSE_CHUNK_SIZE):
        rows = session.execute(select(...).where(PostingTech.posting_id.in_(batch), ...)).all()
        # 각 공고의 결과는 정확히 하나의 청크에서만 채워지므로 합치는 과정에서 순서가 섞이지 않는다.
        ...
    return skill_map, skill_id_map
```

이 청크 처리는 매칭 경로만이 아니라 기술 스택과 원문 URL을 조회하는 다른 모든 호출부에도 똑같이 적용된다. 같은 함수를 쓰는 곳이라면 어디든 이제 크래시 위험이 없다.

## 수정 후 실제 규모 검증

단위 테스트로는 이 버그의 조건(56만 건 규모)을 재현할 수 없다. 개발 환경 데이터베이스에는 훨씬 적은 수의 공고만 있기 때문이다. 그래서 이전에 만들어 두었던, 실제 운영 데이터를 그대로 옮겨둔 별도의 검증용 데이터베이스를 가리켜 똑같은 호출을 직접 실행했다.

```python
cards, total = list_posting_cards(
    session, pool=None, position=None, sort="latest", match_only=False,
    resume_id=None, user_id=None, page=1, page_size=20,
)
```

결과는 다음과 같았다.

| 항목 | 수정 전 | 수정 후 |
|---|---|---|
| 대상 공고 수(필터 없음) | 565,191건 | 565,191건 |
| 결과 | 결정적으로 실패(파라미터 하드 리밋 초과) | 성공 |
| 소요 시간 | 최대 39.78초(실패 직전까지 대기) | 0.31초 |
| 반환 건수 | - | 20건(요청한 page_size와 일치) |

56만 건을 필터 없이 조회해도 0.31초에 끝났다. 페이지 크기만큼만 데이터베이스와 오가기 때문에, 전체 데이터가 얼마나 크든 이 경로의 속도는 거의 일정하게 유지된다.

기존 테스트도 전부 다시 돌렸다. 페이지네이션을 검증하는 테스트, 필터를 검증하는 테스트, 매칭 필터를 검증하는 테스트를 포함해 145개 전부 통과했다. 특히 매칭 경로의 동작(어떤 공고가 몇 퍼센트 매칭되는지, 매칭되지 않는 공고는 제외되는지)은 로직을 건드리지 않고 내부 쿼리 방식만 바꿨기 때문에 결과가 완전히 동일하게 나왔다.

## 배운 것

이 수정에서 중요한 판단은 두 경로를 다르게 고친 것이다. 하나의 함수처럼 보였지만 실제로는 성격이 다른 두 가지 조회가 섞여 있었고, 그 차이를 무시하고 하나의 해법으로 억지로 통일하려 했다면 매칭 로직을 SQL로 옮기는 훨씬 큰 작업이 됐을 것이다. 대신 트래픽이 많은 쪽은 근본적으로 고치고, 트래픽이 적은 쪽은 크래시만 막는 선에서 안전하게 만들어 위험과 작업 범위를 맞췄다.

또 하나는 검증 방법이다. 이 버그는 작은 데이터로는 존재 자체를 확인할 수 없었다. 실제 운영 규모의 데이터를 담은 별도 환경을 미리 마련해 둔 것이, 수정이 정말 문제를 해결했는지 확인하는 유일한 방법이었다.

## 참고 자료

1. [Extraneous Fetching antipattern (Azure Architecture Center, Microsoft Learn)](https://learn.microsoft.com/en-us/azure/architecture/antipatterns/extraneous-fetching/)

<hr>
<ol class="footnotes">
<li id="fn1">SQL에서 결과 집합의 시작 위치를 건너뛰고(OFFSET) 지정한 개수만 가져오는(LIMIT) 절. 데이터베이스가 필요한 행만 골라 반환하므로, 애플리케이션이 전체를 받은 뒤 자르는 방식보다 오가는 데이터양이 훨씬 적다. <a class="fnback" href="#fnref1">↩</a></li>
<li id="fn2">한 번에 처리하기엔 너무 큰 목록을 정해진 크기(여기서는 5,000개)로 나눈 부분 묶음. 나눈 조각을 순서대로 처리하고 결과를 합치면, 쿼리 하나가 감당할 수 있는 크기 제한을 넘지 않으면서도 전체를 처리할 수 있다. <a class="fnback" href="#fnref2">↩</a></li>
</ol>
