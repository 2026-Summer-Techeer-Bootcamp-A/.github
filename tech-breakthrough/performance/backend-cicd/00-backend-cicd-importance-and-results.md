# 우리 백엔드로 보는 CI/CD: 2계층 테스트와 배포 게이트

이 글은 우리 프로젝트를 예로 삼아, CI/CD가 왜 중요한지와 실제 코드가 어떻게 구성되어 어떤 결과를 냈는지를 처음 보는 사람도 따라올 수 있게 정리한 것이다. 개념을 설명한 뒤에는 우리 저장소의 실제 모델과 테스트, 워크플로 코드를 그대로 보여준다. 만드는 과정의 세부 결정과 회고는 이어지는 구축 기록에서 다룬다.

## CI/CD의 필요성

CI/CD의 본질은 사람의 규율에 의존하던 검증을 기계의 강제로 바꾸는 데 있다. 테스트를 잘 짜 두어도 병합 전에 그것을 돌리는 일이 개인의 성실함에 맡겨져 있으면, 바쁜 날에는 건너뛰기 마련이고 그렇게 검증되지 않은 코드의 결함이 프로덕션에 도달한다. 파이프라인은 이 지점을 자동화해, 통과하지 못한 코드가 다음 단계로 넘어가지 못하도록 막는다.

우리 프로젝트에는 이 중요성이 추상적인 원칙이 아니라 실제 문제로 존재했다. 손대기 전의 CI는 main을 제외한 브랜치에서만 돌았고 배포는 main 푸시에서만 돌았다. 두 트리거가 겹치지 않게 갈라져 있어서, main에 병합되는 순간 테스트는 실행되지 않고 배포만 나갔다.

<figure>
<svg viewBox="0 0 760 300" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:'Pretendard',-apple-system,'Segoe UI',sans-serif" role="img" aria-label="배포 게이트 도입 전과 후 비교">
  <defs>
    <marker id="r" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0 0 L7 3 L0 6 z" fill="#b3402f"/></marker>
    <marker id="n" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0 0 L7 3 L0 6 z" fill="#21447c"/></marker>
  </defs>
  <text x="24" y="40" font-size="12" font-weight="700" fill="#8a8d95">이전</text>
  <rect x="64" y="52" width="112" height="46" rx="8" fill="#ffffff" stroke="#c9ccd3"/>
  <text x="120" y="80" font-size="12.5" font-weight="700" fill="#5b5e66" text-anchor="middle">main 병합</text>
  <path d="M176 75 H556" fill="none" stroke="#b3402f" stroke-width="1.8" stroke-dasharray="6 4" marker-end="url(#r)"/>
  <rect x="322" y="55" width="152" height="20" rx="10" fill="#fbeae6"/>
  <text x="398" y="69" font-size="11" font-weight="700" fill="#b3402f" text-anchor="middle">테스트 없이 배포</text>
  <rect x="560" y="52" width="112" height="46" rx="8" fill="#fbeae6" stroke="#b3402f"/>
  <text x="616" y="80" font-size="12.5" font-weight="700" fill="#b3402f" text-anchor="middle">배포</text>
  <text x="64" y="122" font-size="10.5" fill="#8a8d95">CI 테스트는 main 트리거에 없어, 병합 커밋은 검증되지 않았다.</text>
  <line x1="24" y1="150" x2="736" y2="150" stroke="#e4e6ec"/>
  <text x="24" y="188" font-size="12" font-weight="700" fill="#21447c">지금</text>
  <rect x="64" y="200" width="100" height="46" rx="8" fill="#ffffff" stroke="#21447c"/>
  <text x="114" y="228" font-size="12.5" font-weight="700" fill="#21447c" text-anchor="middle">main 병합</text>
  <path d="M164 223 H196" fill="none" stroke="#21447c" stroke-width="1.6" marker-end="url(#n)"/>
  <rect x="200" y="196" width="252" height="54" rx="8" fill="#ffffff" stroke="#21447c"/>
  <text x="326" y="219" font-size="12.5" font-weight="700" fill="#21447c" text-anchor="middle">test</text>
  <text x="326" y="237" font-size="10.5" fill="#5b5e66" text-anchor="middle">lint → unit → integration → docker</text>
  <path d="M452 223 H466" fill="none" stroke="#21447c" stroke-width="1.6" marker-end="url(#n)"/>
  <rect x="470" y="213" width="52" height="20" rx="10" fill="#21447c"/>
  <text x="496" y="227" font-size="10.5" font-weight="700" fill="#ffffff" text-anchor="middle">게이트</text>
  <path d="M522 223 H556" fill="none" stroke="#21447c" stroke-width="1.6" marker-end="url(#n)"/>
  <rect x="560" y="200" width="112" height="46" rx="8" fill="#eef2f9" stroke="#21447c"/>
  <text x="616" y="228" font-size="12.5" font-weight="700" fill="#21447c" text-anchor="middle">배포</text>
  <text x="200" y="272" font-size="10.5" fill="#8a8d95">test 잡이 전부 통과해야 needs 조건이 충족되어 배포가 시작된다.</text>
</svg>
<figcaption><b>그림 1.</b> 배포 게이트 도입 전과 후. 이전에는 병합이 곧장 배포로 이어졌지만, 지금은 <b>test</b> 잡을 통과해야만 배포가 시작된다.</figcaption>
</figure>

풀 리퀘스트에서 통과했더라도 병합 커밋 자체는 검증되지 않은 채 프로덕션에 닿을 수 있었다. CI/CD의 가치를 한 문장으로 줄이면, 바로 이 무검증 배포의 경로를 없애는 것이었다.

## 실 Postgres가 필요한 이유

테스트를 빠르게 만들려면 인메모리 SQLite가 편하다. 문제는 우리 모델의 일부가 운영 데이터베이스인 Postgres에서만 다르게 동작한다는 데 있다. 아래 두 컬럼은 SQLAlchemy의 `with_variant`로, postgresql 방언일 때만 특수 타입으로 바뀌고 그 외에는 평범한 문자열이나 텍스트로 격하된다.

```python
# app/models/user.py — email은 운영 Postgres에서만 CITEXT(대소문자 무시)
email: Mapped[str] = mapped_column(
    String(255).with_variant(CITEXT(), "postgresql"), nullable=False, unique=True
)

# app/models/posting.py — embedding은 운영 Postgres에서만 pgvector Vector
embedding: Mapped[list[float]] = mapped_column(
    Text().with_variant(Vector(settings.embedding_dim), "postgresql"), nullable=False
)
```

SQLite에서 email은 그냥 문자열이라 대소문자를 구분하고, embedding은 그냥 텍스트라 벡터 거리 검색을 할 수 없다. 다시 말해 SQLite 위에서 아무리 많은 테스트를 통과시켜도 대소문자 무시 유니크 제약이나 벡터 검색이 실제로 동작하는지는 검증되지 않는다. 그래서 테스트를 두 계층으로 나눈다.

| 구분 | 빠른 계층 | 느린 계층 |
| --- | --- | --- |
| 마커 | 없음 (기본) | `@pytest.mark.integration` |
| 데이터베이스 | 인메모리 SQLite | 실 Postgres (pgvector) |
| 무엇을 잡나 | 앱 로직, 라우터, 스키마 | pgvector 거리, CITEXT 유니크 |
| 개수와 시간 | 215개, 약 9초 | 5개, 1.70초 |
| 로컬 실행 | 항상 | `DATABASE_URL`이 있을 때만 |

## 두 종류의 테스트, 실제 코드로

빠른 계층은 마커가 없는 평범한 테스트다. 인메모리 SQLite로 앱을 띄워 응답만 확인하므로 외부 인프라 없이 즉시 돌아간다.

```python
# tests/test_main.py — 인메모리 SQLite, 외부 인프라 없이 즉시 실행
def test_healthz(client: TestClient) -> None:
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

느린 계층은 `@pytest.mark.integration` 마커를 붙이고 실제 Postgres에 접속한다. 아래 두 테스트가 바로 SQLite로는 확인할 수 없던 동작을 겨냥한다. 하나는 pgvector의 L2 거리 정렬이 기대한 순서로 나오는지, 다른 하나는 CITEXT 컬럼이 대소문자만 다른 값을 중복으로 막는지를 확인한다. 둘 다 세션 로컬 임시 테이블에서만 쓰므로 실제 데이터를 건드리지 않는다.

```python
# tests/test_pg_integration.py — 실 Postgres에서만 의미가 있는 동작
pytestmark = pytest.mark.integration


def test_pgvector_orders_by_l2_distance(pg_conn):
    with pg_conn.cursor() as cur:
        cur.execute("CREATE TEMP TABLE emb (id int, v vector(3))")
        cur.execute("INSERT INTO emb VALUES (1, '[1,0,0]'), (2, '[0,1,0]'), (3, '[0.9,0.1,0]')")
        pg_conn.commit()
        cur.execute("SELECT id FROM emb ORDER BY v <-> '[1,0,0]' LIMIT 2")
        nearest = [row[0] for row in cur.fetchall()]
    assert nearest == [1, 3]


def test_citext_unique_is_case_insensitive(pg_conn):
    import psycopg
    with pg_conn.cursor() as cur:
        cur.execute("CREATE TEMP TABLE u (email citext UNIQUE)")
        cur.execute("INSERT INTO u VALUES ('User@Example.com')")
        pg_conn.commit()
        with pytest.raises(psycopg.errors.UniqueViolation):
            cur.execute("INSERT INTO u VALUES ('user@example.com')")
        pg_conn.commit()
    pg_conn.rollback()
```

두 계층을 이어 주는 것은 `conftest.py`의 수집 훅이다. `DATABASE_URL` 환경변수가 없으면 integration 마커가 붙은 테스트를 전부 건너뛴다. 덕분에 개발자는 실 Postgres 없이도 빠른 계층만 돌려 즉시 피드백을 받고, 실 DB가 준비된 CI에서만 느린 계층이 실행된다.

```python
# tests/conftest.py — DATABASE_URL이 없으면 통합 테스트를 자동으로 건너뛴다
def pytest_collection_modifyitems(config, items):
    if os.environ.get("DATABASE_URL"):
        return
    skip_integration = pytest.mark.skip(
        reason="requires a live Postgres (set DATABASE_URL)"
    )
    for item in items:
        if "integration" in item.keywords:
            item.add_marker(skip_integration)
```

## CI의 강제 방식

CI에서는 유닛 잡이 통과한 뒤에만 통합 잡이 돌고, 통합 잡은 pgvector 이미지를 서비스 컨테이너로 띄운 다음 확장과 스키마를 부트스트랩하고 나서 느린 테스트를 실행한다. `DATABASE_URL`이 이 잡에만 주어지므로, conftest의 훅이 여기서는 테스트를 건너뛰지 않는다.

```yaml
# .github/workflows/test.yml — 유닛 통과 후 실 Postgres를 띄워 통합 테스트
integration:
  needs: unit
  runs-on: ubuntu-latest
  services:
    postgres:
      image: pgvector/pgvector:pg17
      env: { POSTGRES_USER: postgres, POSTGRES_PASSWORD: postgres, POSTGRES_DB: testdb }
      ports: ["5432:5432"]
      options: >-
        --health-cmd "pg_isready -U postgres"
        --health-interval 5s --health-timeout 3s --health-retries 10
  env:
    DATABASE_URL: postgresql+psycopg://postgres:postgres@localhost:5432/testdb
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-python@v5
      with: { python-version: "3.12", cache: pip }
    - run: pip install -r requirements.txt -r requirements-dev.txt
    - run: python -m scripts.init_test_db          # 확장 설치 + 스키마 생성
    - run: pytest -m integration -v --tb=short -ra
```

이 테스트 파이프라인은 `workflow_call`로 호출되는 재사용 워크플로 하나에 담겨 있고, 배포 워크플로가 그것을 test 잡으로 부른 뒤 배포 잡에 needs로 건다. test가 실패하면 needs 조건이 충족되지 않아 배포는 시작조차 하지 않는다.

```yaml
# .github/workflows/deploy.yml — 배포는 test 통과에 의존한다
jobs:
  test:
    uses: ./.github/workflows/test.yml
  deploy:
    needs: test           # test가 실패하면 배포는 시작조차 하지 않는다
    runs-on: ubuntu-latest
    steps: [ ... 이미지 빌드, 푸시, 배포 ... ]
```

## 실제 실행이 말해 준 것

이 구조가 main에 병합되자 배포 워크플로가 트리거되었고, 그것이 첫 실전이자 가장 중요한 검증이었다. 로그에 잡힌 실행 순서는 설계 의도를 그대로 보여 준다. 네 개의 테스트 단계가 전부 초록이 된 다음에 비로소 배포 잡이 실행되었다.

| 잡 | 시간 | 내용 |
| --- | --- | --- |
| lint | 31초 | ruff 검사, All checks passed |
| unit | 31초 | 220개 중 215개 선택, 전부 통과 |
| integration | 49초 | 5개 선택, 실 Postgres에서 통과 (테스트 자체는 1.70초) |
| docker-build | 24초 | 이미지 빌드 |
| deploy | 2분 5초 | 테스트 통과 후 실행, 이미지 푸시와 배포 |

배포가 테스트 뒤에 매달려 있었다는 사실, 곧 테스트가 끝나기 전에는 배포가 시작조차 하지 않았다는 사실이 게이트가 실제로 작동했다는 증거다. 전체 220개 가운데 유닛 잡에서는 통합 5개를 제외한 215개가 통과했고, 통합 잡에서는 반대로 215개를 제외한 5개가 실제 Postgres에 대해 1.70초 만에 전부 통과했다.

통합 로그에는 특히 눈여겨볼 대목이 하나 있다. 서비스 컨테이너 로그에 duplicate key value violates unique constraint라는 ERROR가 찍혀 있는데, 이것은 실패가 아니라 오히려 테스트가 제대로 동작했다는 신호다. 위의 `test_citext_unique_is_case_insensitive`가 대소문자만 다른 값을 두 번 넣어 유니크 위반을 일부러 유도하기 때문이다. Postgres가 위반을 로그로 남긴 것이 곧 검증의 성공이고, SQLite였다면 이 에러 자체가 발생하지 않았을 것이다.

## 소요 시간 분석

로그를 뜯어보면 파이프라인의 병목이 테스트가 아니라 의존성 설치에 있다는 점이 분명하게 드러난다. 아래는 각 잡이 실제로 소요한 시간이다.

<figure>
<svg viewBox="0 0 720 262" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:'Pretendard',-apple-system,'Segoe UI',sans-serif" role="img" aria-label="CI 잡별 소요 시간">
  <line x1="150" y1="28" x2="150" y2="222" stroke="#c9ccd3"/>
  <g stroke="#eef2f9" stroke-width="1"><line x1="258" y1="28" x2="258" y2="222"/><line x1="366" y1="28" x2="366" y2="222"/><line x1="474" y1="28" x2="474" y2="222"/><line x1="582" y1="28" x2="582" y2="222"/></g>
  <g font-size="10" fill="#8a8d95" text-anchor="middle"><text x="258" y="240">30초</text><text x="366" y="240">60초</text><text x="474" y="240">90초</text><text x="582" y="240">120초</text></g>
  <g font-size="12.5" fill="#1a1c20" text-anchor="end">
    <text x="140" y="55">lint</text><text x="140" y="95">unit</text><text x="140" y="135">integration</text><text x="140" y="175">docker-build</text><text x="140" y="215">deploy</text>
  </g>
  <rect x="150" y="42" width="112" height="22" rx="3" fill="#21447c"/><text x="270" y="58" font-size="11" fill="#5b5e66">31초</text>
  <rect x="150" y="82" width="112" height="22" rx="3" fill="#21447c"/><text x="270" y="98" font-size="11" fill="#5b5e66">31초</text>
  <rect x="150" y="122" width="176" height="22" rx="3" fill="#21447c"/><text x="334" y="138" font-size="11" fill="#5b5e66">49초</text>
  <rect x="150" y="162" width="86" height="22" rx="3" fill="#21447c"/><text x="244" y="178" font-size="11" fill="#5b5e66">24초</text>
  <rect x="150" y="202" width="450" height="22" rx="3" fill="#eef2f9" stroke="#21447c"/><text x="608" y="218" font-size="11" fill="#5b5e66">2분 5초</text>
</svg>
<figcaption><b>그림 2.</b> 잡별 소요 시간. 통합 테스트 자체 실행은 1.70초에 불과하고, 그 앞의 의존성 설치가 각 테스트 잡 시간의 대부분을 차지한다.</figcaption>
</figure>

통합 테스트는 실제 검증에 1.70초밖에 걸리지 않았는데, 그 앞의 설치 단계는 fastembed와 onnxruntime, tokenizers를 포함한 일흔 개 안팎의 패키지를 내려받고 까느라 훨씬 더 오래 걸렸다. 게다가 린트와 유닛과 통합 세 잡이 각자 전체 의존성을 다시 설치한다. 속도를 개선할 여지가 가장 큰 지점이 여기다.

## 남은 개선점

파이프라인이 자리를 잡은 지금, 다음 개선을 순서대로 붙여 나가면 된다.

| 개선점 | 무엇이 문제인가 | 방향 |
| --- | --- | --- |
| 설치가 병목 | 세 잡이 fastembed 등 무거운 의존성을 매번 재설치 | 테스트 전용 경량 의존성 분리, 가상환경 캐싱 |
| 린트의 과잉 설치 | ruff 하나면 되는데 앱 전체 의존성을 끌어옴 | 린트 잡은 ruff만 설치 |
| Node 20 종료 예고 | checkout과 setup-python 등이 경고를 냄 | 액션 버전 상향 |
| 선택 과제 미착수 | 도커 레이어 캐시, 오래된 실행 취소, JUnit 요약 게시 | 후속 정리로 순차 반영 |

이것들은 실패를 만드는 문제가 아니라 파이프라인을 더 빠르고 깔끔하게 만드는 항목이다. 지금의 구조가 이미 목적을 다하고 있으므로, 급하지 않은 순서로 하나씩 정리하면 된다.

## 회고

이번 작업에서 가장 중요한 부분은 새 테스트 자체보다 배포 게이트였다. 테스트를 아무리 잘 나눠도 그것이 배포 앞에 서 있지 않으면 무검증 배포의 경로는 그대로 남는다. 그리고 그 게이트가 첫 병합에서 곧바로 작동해, 테스트가 끝나기 전에는 배포가 시작하지 않는 모습을 로그로 확인한 것이 이번 검증의 핵심이었다. 빠른 것을 먼저 돌리고 느린 것을 뒤에 두라는 요구는 결국 피드백을 빠르게 받으면서도 프로덕션과 같은 것을 검증하려는 두 목표를 함께 만족시키는 문제였고, 220개 가운데 215개를 몇십 초 만에 통과시키고 나머지 5개를 실제 Postgres에서 확인하는 지금의 구조가 그 결과다. 이 구조를 어떤 판단으로 만들었는지는 이어지는 구축 기록에서 다룬다.
