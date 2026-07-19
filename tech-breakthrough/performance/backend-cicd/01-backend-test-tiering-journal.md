# 백엔드 유닛과 통합 테스트 2계층화, 그리고 배포 게이트 구축 기록

이 문서는 백엔드의 기능 테스트를 CI 파이프라인 안에서 어떻게 구조화했는지를 다룬다. 빠른 테스트를 먼저 게이트로 세우고 느린 테스트를 뒤에 붙인다는 요구에서 출발했고, 그 과정에서 드러난 설계상의 빈틈과 그것을 메운 판단을 함께 남긴다. 앞선 소개편 문서가 우리 코드와 실전 실행의 수치를 다룬다면, 이 글은 그것을 만든 과정과 판단을 다룬다.

## 시작점의 상태

손대기 전의 백엔드는 CI가 단일 잡 하나로 모든 일을 순차 처리하는 구조였다. 의존성을 설치하고 린트를 돌린 뒤 테스트를 한 번에 실행하고 마지막으로 도커 이미지를 빌드했는데, 캐싱이 없어 매번 무거운 패키지까지 새로 받았고 빠른 테스트와 느린 테스트를 나누는 개념 자체가 없었다. 스물아홉 개의 테스트 파일은 거의 전부 인메모리 SQLite 위에서 돌아 이미 빠르긴 했지만, 그만큼 프로덕션과 다른 것을 검증하고 있었다.

| 영역 | 시작점의 상태 | 문제 |
| --- | --- | --- |
| 테스트 실행 | 단일 잡에서 순차 실행, fast/slow 구분 없음 | 느린 것이 빠른 피드백을 막음 |
| 테스트 대상 | 전부 인메모리 SQLite | pgvector, CITEXT 등 실 DB 동작 미검증 |
| 캐싱 | 없음 | 매 실행마다 무거운 의존성 재설치 |
| 배포 검증 | `ci.yml`은 main 제외, `deploy.yml`은 main 전용 | main 병합 시 테스트 없이 배포 |

가장 큰 문제는 마지막 줄에 있었다. 두 워크플로의 트리거가 서로 겹치지 않게 갈라져 있어서, main에 병합되거나 직접 푸시되는 순간 테스트는 한 번도 실행되지 않고 배포만 나갔다. 풀 리퀘스트에서 통과했더라도 병합 커밋 자체는 검증되지 않은 채 프로덕션에 닿을 수 있었다. 이 지점을 닫는 것이 이번 작업의 첫 목표였다.

## 빠른 계층과 느린 계층

방향은 테스트를 두 계층으로 가르는 것으로 잡았다. 마커가 없는 기본 테스트는 인메모리 SQLite에서 도는 빠른 계층으로 두고, 실제 Postgres가 있어야 의미가 있는 테스트는 integration 마커<sup class="fnref" id="fnref1"><a href="#fn1">1</a></sup>를 붙여 느린 계층으로 분리했다. 개발자가 로컬에서 실 Postgres 없이도 피드백을 받을 수 있도록, DATABASE_URL이 없으면 통합 테스트를 자동으로 건너뛰게 만들었다.

<figure>
<svg viewBox="0 0 720 352" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:'Pretendard',-apple-system,'Segoe UI',sans-serif" role="img" aria-label="빠른 계층과 느린 계층 비교">
  <rect x="24" y="16" width="320" height="262" rx="12" fill="#ffffff" stroke="#e4e6ec"/>
  <path d="M24 28 q0 -12 12 -12 h296 q12 0 12 12 v34 h-320 z" fill="#eef2f9"/>
  <text x="44" y="40" font-size="15" font-weight="700" fill="#21447c">빠른 계층</text>
  <text x="44" y="55" font-size="11" fill="#5b5e66">Fast tier</text>
  <g font-size="12.5">
    <text x="44" y="92" font-size="11" fill="#8a8d95">마커</text><text x="150" y="92" fill="#1a1c20">없음 (기본)</text>
    <text x="44" y="122" font-size="11" fill="#8a8d95">데이터베이스</text><text x="150" y="122" fill="#1a1c20">인메모리 SQLite</text>
    <text x="44" y="152" font-size="11" fill="#8a8d95">테스트 수</text><text x="150" y="152" fill="#1a1c20" font-weight="700">215개</text>
    <text x="44" y="182" font-size="11" fill="#8a8d95">실행 시간</text><text x="150" y="182" fill="#1a1c20">약 9초</text>
    <text x="44" y="212" font-size="11" fill="#8a8d95">선택자</text><text x="150" y="212" fill="#294a86" font-size="11.5">-m "not integration"</text>
    <text x="44" y="242" font-size="11" fill="#8a8d95">검증 대상</text><text x="150" y="242" fill="#1a1c20" font-size="11.5">앱 로직, 라우터, 스키마</text>
  </g>
  <rect x="376" y="16" width="320" height="262" rx="12" fill="#ffffff" stroke="#e4e6ec"/>
  <path d="M376 28 q0 -12 12 -12 h296 q12 0 12 12 v34 h-320 z" fill="#21447c"/>
  <text x="396" y="40" font-size="15" font-weight="700" fill="#ffffff">느린 계층</text>
  <text x="396" y="55" font-size="11" fill="#c7d3e8">Slow tier</text>
  <g font-size="12.5">
    <text x="396" y="92" font-size="11" fill="#8a8d95">마커</text><text x="502" y="92" fill="#294a86" font-size="11.5">@pytest.mark.integration</text>
    <text x="396" y="122" font-size="11" fill="#8a8d95">데이터베이스</text><text x="502" y="122" fill="#1a1c20" font-size="11.5">실 Postgres (pgvector)</text>
    <text x="396" y="152" font-size="11" fill="#8a8d95">테스트 수</text><text x="502" y="152" fill="#1a1c20" font-weight="700">5개</text>
    <text x="396" y="182" font-size="11" fill="#8a8d95">실행 시간</text><text x="502" y="182" fill="#1a1c20">1.70초</text>
    <text x="396" y="212" font-size="11" fill="#8a8d95">선택자</text><text x="502" y="212" fill="#294a86" font-size="11.5">-m integration</text>
    <text x="396" y="242" font-size="11" fill="#8a8d95">검증 대상</text><text x="502" y="242" fill="#1a1c20" font-size="11.5">pgvector 거리, CITEXT 유니크</text>
  </g>
  <rect x="24" y="296" width="672" height="40" rx="9" fill="#f7f8fa" stroke="#e4e6ec"/>
  <text x="360" y="321" font-size="12" fill="#5b5e66" text-anchor="middle">DATABASE_URL이 없으면 conftest.py가 느린 계층을 자동으로 건너뛴다. 개발자는 실 Postgres 없이 빠른 계층만 돌린다.</text>
</svg>
<figcaption><b>그림 1.</b> 마커 하나로 갈라지는 두 계층. 빠른 계층은 SQLite 위에서 대부분의 로직을, 느린 계층은 실 Postgres에서 SQLite가 못 보는 동작을 검증한다.<sup class="fnref" id="fnref2"><a href="#fn2">2</a></sup></figcaption>
</figure>

이 자동 건너뛰기는 conftest.py의 수집 훅<sup class="fnref" id="fnref3"><a href="#fn3">3</a></sup>에서 처리한다. 수집된 테스트 중 integration 마커가 붙은 것을 훑어, 환경변수에 DATABASE_URL이 없으면 일괄로 skip 마커를 덧붙이는 방식이다. 덕분에 개별 테스트 파일은 마커만 선언하면 되고 실 DB 유무를 판단하는 로직을 각자 반복하지 않는다. 이 관례는 이미 저장소에 비슷한 사례가 있었다. fix_source_pool 통합 테스트가 세션 로컬 임시 테이블로 실 데이터를 보호하는 패턴을 쓰고 있었는데, 이것을 표준으로 승격해 conftest가 게이팅을 전담하도록 정리했다.

느린 계층을 실제로 채우는 일도 함께 했다. 인프라만 세우고 느린 테스트가 비면 계층이 유명무실해지므로, SQLite가 못 잡는 지점을 정확히 짚는 테스트를 새로 넣었다.

- **pgvector 거리 정렬** — 3차원 벡터 세 개를 임시 테이블에 넣고 특정 벡터에 대한 L2 거리 순으로 정렬해, 가장 가까운 둘이 기대한 순서로 나오는지 확인한다.
- **CITEXT 유니크** — 대소문자만 다른 값을 두 번 넣어 유니크 위반이 발생하는지 확인한다.
- **fix_source_pool** — 기존 통합 테스트를 integration 마커로 표준화한다.

세 가지 모두 세션 로컬 임시 테이블<sup class="fnref" id="fnref4"><a href="#fn4">4</a></sup>에서만 쓰므로 실 테이블을 건드리지 않고, 커넥션이 닫히면 임시 테이블도 사라져 뒷정리가 필요 없다.

## 단계형 파이프라인과 배포 게이트

파이프라인은 이 계층 구분을 그대로 반영해 단계형으로 재구성했다. 린트와 빠른 유닛을 먼저 게이트로 세우고, 유닛이 통과한 뒤에만 pgvector 서비스 컨테이너를 띄워 느린 통합 테스트를 실행한다. 이 전체 흐름을 workflow_call로 호출되는 재사용 워크플로<sup class="fnref" id="fnref5"><a href="#fn5">5</a></sup> 하나에 담아 CI 워크플로와 배포 워크플로가 함께 부르게 했고, 배포 잡에는 이 테스트 잡을 통과해야만 진행되도록 needs 게이트<sup class="fnref" id="fnref6"><a href="#fn6">6</a></sup>로 걸었다.

<figure>
<svg viewBox="0 0 760 300" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:'Pretendard',-apple-system,'Segoe UI',sans-serif" role="img" aria-label="단계형 CI 파이프라인과 배포 게이트">
  <defs>
    <marker id="ar" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0 0 L7 3 L0 6 z" fill="#8a8d95"/></marker>
    <marker id="arN" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0 0 L7 3 L0 6 z" fill="#21447c"/></marker>
  </defs>
  <rect x="16" y="44" width="470" height="212" rx="12" fill="#fafbfc" stroke="#8a8d95" stroke-dasharray="5 4"/>
  <text x="30" y="66" font-size="12" font-weight="700" fill="#5b5e66">test.yml 재사용 워크플로</text>
  <g>
    <rect x="40" y="120" width="104" height="44" rx="8" fill="#ffffff" stroke="#21447c"/>
    <text x="92" y="147" font-size="13" font-weight="700" fill="#21447c" text-anchor="middle">lint</text>
    <text x="92" y="180" font-size="10.5" fill="#8a8d95" text-anchor="middle">31초</text>
    <rect x="176" y="120" width="104" height="44" rx="8" fill="#ffffff" stroke="#21447c"/>
    <text x="228" y="147" font-size="13" font-weight="700" fill="#21447c" text-anchor="middle">unit</text>
    <text x="228" y="180" font-size="10.5" fill="#8a8d95" text-anchor="middle">31초, 215개</text>
    <rect x="312" y="64" width="152" height="44" rx="8" fill="#ffffff" stroke="#21447c"/>
    <text x="388" y="91" font-size="13" font-weight="700" fill="#21447c" text-anchor="middle">integration</text>
    <text x="388" y="126" font-size="10.5" fill="#8a8d95" text-anchor="middle">49초, 5개, pgvector</text>
    <rect x="312" y="176" width="152" height="44" rx="8" fill="#ffffff" stroke="#21447c"/>
    <text x="388" y="203" font-size="13" font-weight="700" fill="#21447c" text-anchor="middle">docker-build</text>
    <text x="388" y="236" font-size="10.5" fill="#8a8d95" text-anchor="middle">24초</text>
  </g>
  <path d="M144 142 H172" fill="none" stroke="#8a8d95" stroke-width="1.5" marker-end="url(#ar)"/>
  <path d="M280 138 C296 138 300 90 308 88" fill="none" stroke="#8a8d95" stroke-width="1.5" marker-end="url(#ar)"/>
  <path d="M280 146 C296 146 300 196 308 198" fill="none" stroke="#8a8d95" stroke-width="1.5" marker-end="url(#ar)"/>
  <path d="M486 142 H600" fill="none" stroke="#21447c" stroke-width="1.8" marker-end="url(#arN)"/>
  <rect x="516" y="123" width="54" height="20" rx="10" fill="#21447c"/>
  <text x="543" y="137" font-size="10.5" font-weight="700" fill="#ffffff" text-anchor="middle">게이트</text>
  <text x="543" y="112" font-size="10.5" fill="#21447c" text-anchor="middle">needs: test</text>
  <rect x="608" y="118" width="126" height="48" rx="8" fill="#eef2f9" stroke="#21447c"/>
  <text x="671" y="141" font-size="13" font-weight="700" fill="#21447c" text-anchor="middle">deploy</text>
  <text x="671" y="157" font-size="10" fill="#5b5e66" text-anchor="middle">2분 5초</text>
</svg>
<figcaption><b>그림 2.</b> 앞 단계가 실패하면 뒤 단계로 넘어가지 않는다. 네 개의 테스트 잡이 모두 통과해야 <b>needs: test</b> 게이트가 열리고 배포가 시작된다.<sup class="fnref" id="fnref7"><a href="#fn7">7</a></sup></figcaption>
</figure>

이 구조에서 배포는 테스트에 매달려 있다. 재사용 워크플로 안의 잡 중 하나라도 실패하면 이를 호출한 test 잡이 실패로 표시되고, needs 조건이 충족되지 않아 배포 잡은 시작조차 하지 않는다. 시작점에서 지적한 무검증 배포의 경로가 여기서 차단된다.

## 구현 산출물

작업은 테스트 인프라를 만드는 묶음과 워크플로를 배선하는 묶음으로 나눠 진행했다. 파일 단위로 정리하면 다음과 같다.

| 파일 | 종류 | 역할 |
| --- | --- | --- |
| `pyproject.toml` | 신규 | pytest 설정과 `integration` 마커 등록 |
| `tests/conftest.py` | 신규 | 공용 픽스처와 DATABASE_URL 기반 자동 skip 훅 |
| `tests/test_pg_integration.py` | 신규 | pgvector 거리 정렬, CITEXT 유니크 통합 테스트 |
| `tests/test_fix_source_pool.py` | 수정 | skipif를 integration 마커로 표준화 |
| `scripts/init_test_db.py` | 신규 | CI 부트스트랩, 확장 설치 후 전체 스키마 생성 |
| `.github/workflows/test.yml` | 신규 | lint/unit/integration/docker-build 재사용 워크플로 |
| `.github/workflows/ci.yml` | 수정 | 본문을 재사용 워크플로 호출로 축소 |
| `.github/workflows/deploy.yml` | 수정 | `test` 잡 추가와 `deploy: needs: test` 게이트 |

## 검증하며 알게 된 것

CI가 빈 Postgres에서 통합 테스트를 돌리려면 스키마가 먼저 있어야 한다는 점이 실제로 돌려 보기 전까지 놓치기 쉬운 대목이었다. fix_source_pool 테스트는 실 posting 테이블과 같은 구조의 임시 테이블을 만드는데, 원본 테이블이 이미 있어야 성립한다. 개발용 DB에서는 성립하지만 방금 띄운 CI의 빈 컨테이너에서는 성립하지 않는다. 그래서 확장을 설치하고 전체 스키마를 생성하는 부트스트랩 스크립트를 통합 잡이 테스트 전에 먼저 실행하도록 했다.

이 과정에서 계획 문서 자체에 잠복해 있던 버그가 하나 드러났다. 부트스트랩을 파일 경로로 직접 실행하도록 적어 두었는데, 그렇게 하면 스크립트가 있는 디렉터리가 파이썬 경로의 맨 앞에 놓여 app 패키지를 찾지 못해 ModuleNotFoundError로 죽는다. 저장소의 scripts는 실제 패키지이므로 `python -m scripts.init_test_db`처럼 모듈로 실행해야 저장소 루트가 경로에 들어가 import가 정상으로 풀린다. 구현을 맡은 쪽이 이 차이를 잡아내 모듈 실행 형태로 고쳤다. 계획에 완성된 코드를 적어 두었더라도 실제로 돌려 보지 않으면 이런 실행 맥락의 함정은 드러나지 않는다는 것을 다시 확인한 대목이었다.

## 막혔던 지점과 판단의 흐름

작업 도중 가장 신경 쓴 외부 변수는 저장소를 여러 세션이 동시에 쓰고 있다는 사실이었다. 처음에는 main 브랜치였는데 잠시 뒤 다시 보니 다른 세션이 기능 브랜치로 전환하고 커밋까지 올려 둔 상태였고, 그 사이에 내 문서 커밋이 남의 커밋과 같은 브랜치에 뒤섞여 있었다. 공유된 작업 트리에서 브랜치를 갈아타면 동시 세션의 체크아웃을 흔들 수 있었으므로, main에서 갈라진 별도 워크트리를 새 디렉터리에 만들고 문서 커밋만 골라 옮겨 CI 작업을 그 안에서 격리했다.

설계의 핵심을 하나로 줄이면 SQLite와 Postgres의 분기를 어떻게 다룰지의 문제였다. 빠른 테스트를 위해 SQLite를 쓰는 이점과 프로덕션과 같은 것을 검증해야 하는 요구는 서로 당긴다. 둘 중 하나를 버리는 대신 계층으로 나눠, 대부분의 로직은 빠른 SQLite 계층에서 확인하고 Postgres에서만 의미가 있는 소수의 동작은 느린 통합 계층으로 몰아 실 DB에서 확인하도록 했다. 통합 계층을 처음부터 무겁게 짓기보다, 실 DB를 파괴할 위험이 있는 load_mart 전체 적재를 실 DB에 돌리는 대신 임시 테이블로 격리된 pgvector와 citext 테스트로 빈틈을 정확히 짚는 쪽을 택한 것도 같은 판단의 연장이었다.

## 회고

돌아보면 가장 값어치 있는 산출은 새 테스트 자체보다 배포 게이트였다. 테스트를 아무리 잘 나눠도 그것이 배포 앞에 서 있지 않으면 무검증 배포의 경로는 그대로 남는다. 재사용 워크플로와 needs 체인으로 그 경로를 차단한 것이, 실제 사고를 막는다는 관점에서는 계층화보다 앞선 성과였다. 이 게이트가 실전에서 어떻게 작동했고 어떤 수치를 남겼는지는 앞선 소개편에서 다뤘다.

<hr>
<ol class="footnotes">
<li id="fn1">pytest의 커스텀 마커 기능. <code>pyproject.toml</code>의 <code>markers</code> 목록에 등록해야 경고 없이 쓸 수 있고, <code>-m "not integration"</code>처럼 선택자로 특정 마커가 붙은 테스트만 골라 실행할 수 있다. <a class="fnback" href="#fnref1">↩</a></li>
<li id="fn2">테스트 수와 실행 시간은 test.yml 재사용 워크플로가 실제로 실행된 GitHub Actions 로그의 잡별 요약에서 그대로 가져온 값이다. <a class="fnback" href="#fnref2">↩</a></li>
<li id="fn3">pytest_collection_modifyitems 훅. pytest가 테스트를 전부 수집한 뒤, 실행 직전에 그 목록을 가로채 마커를 추가하거나 제외할 수 있게 해준다. <a class="fnback" href="#fnref3">↩</a></li>
<li id="fn4">PostgreSQL의 CREATE TEMP TABLE로 만든 테이블. 만든 세션(커넥션)에서만 보이고, 세션이 끊기면 자동으로 삭제되어 별도 정리가 필요 없다. <a class="fnback" href="#fnref4">↩</a></li>
<li id="fn5">GitHub Actions에서 한 워크플로 파일을 다른 워크플로가 함수처럼 호출할 수 있게 하는 트리거. 여기서는 test.yml을 ci.yml과 deploy.yml이 공통으로 호출한다. <a class="fnback" href="#fnref5">↩</a></li>
<li id="fn6">잡(job) 사이의 의존 관계를 선언하는 GitHub Actions 키워드. 지정한 잡이 실패하면 이를 참조하는 잡은 아예 시작하지 않는다. <a class="fnback" href="#fnref6">↩</a></li>
<li id="fn7">각 잡의 소요 시간과 게이트 통과 여부는 실제 main 병합으로 트리거된 워크플로 실행 로그를 그대로 옮긴 값이다. <a class="fnback" href="#fnref7">↩</a></li>
</ol>
