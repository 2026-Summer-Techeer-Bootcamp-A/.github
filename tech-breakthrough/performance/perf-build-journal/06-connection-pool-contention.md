# 데이터베이스 커넥션 풀 경합과 API 연쇄 지연 규명

**일정**: 2026-07-14  
**요약**: 커넥션 풀 경합으로 무거운 통계 쿼리가 가벼운 API 요청까지 끌고 내려가는 지연 전이 현상을 실측하고, 단기 방어 조치와 장기 아키텍처 개편 방향을 정리했다.  

## 도입 배경 및 문제 제기

애플리케이션 신뢰성은 개별 엔드포인트가 단발성으로 반환하는 응답 속도만으로 보장되지 않는다. 초기 검증 단계에서는 가벼운 단순 조회나 구체적인 최적화가 적용된 API 위주로 확인했기 때문에 시스템의 잠재적 위험 요인이 드러나지 않았다. 부하 테스트의 신뢰성을 높이기 위해 시나리오 커버리지를 기존 4개 엔드포인트에서 대시보드 위젯과 트렌드 집계를 포함한 31개 엔드포인트로 확장했고, 이 과정에서 부하 상황 시 시스템 전체가 급격히 느려지는 지연 전이 현상이 실측되었다.

이 현상의 특징은 연산이 무거운 쿼리가 느려지는 것에 그치지 않고, 시스템 헬스체크나 단순 메타데이터 조회처럼 수 밀리초 내에 응답해야 할 지극히 가벼운 API 요청들까지 동반해서 지연 시간이 늘어난다는 점이다. 이는 시스템에 가용한 자원이 특정 요청에 의해 독점되어 다른 요청들이 연쇄적으로 블로킹되는 자원 경합 문제를 의미한다.

## 병목 원인 및 구조적 분석

확장된 부하 테스트<sup class="fnref" id="fnref1"><a href="#fn1">1</a></sup> 시나리오에는 대시보드 통계 화면을 구성하는 복잡한 집계용 API가 다수 포함되었다. 데이터 분석 결과 지연을 유발하는 5개의 핵심 병목 엔드포인트가 특정되었다. 해당 엔드포인트는 연도별 기술 트렌드 조회를 처리하는 stats_skill_trend_yearly, 채용 시즌 통계를 조회하는 stats_hiring_season, 직무별 스택 적합도를 조회하는 stats_role_stack_fit, 글로벌 국내 기술 갭을 조회하는 stats_global_domestic_gap, 그리고 산업군별 스킬 분포를 조회하는 stats_industry_fingerprint이다.

이 엔드포인트들은 사전에 연산 결과를 캐싱해 두는 구체화 뷰나 별도의 인덱싱 테이블을 거치지 않는다. 요청이 발생할 때마다 데이터베이스에 직접 접근하여 수십만 건의 공고 테이블과 기술 스택 관계 테이블을 조인<sup class="fnref" id="fnref2"><a href="#fn2">2</a></sup>하고 그룹화하여 가공하는 집계 연산인 Raw Aggregation을 매번 처음부터 다시 수행한다.

동시 접속자 수가 증가하여 병목 쿼리가 빈번히 발생하면, 한정된 크기의 데이터베이스 커넥션 풀이 이 무거운 쿼리들을 처리하는 스레드들에 의해 완전히 선점된다. 데이터베이스 커넥션을 획득하지 못한 일반 경량 API 요청들은 백엔드 커넥션 대기열에 쌓이게 되며, 이로 인해 지연 시간이 누적되어 시스템 전체가 동반 지연되는 현상이 발생한다.

<figure class="fig">
<svg viewBox="0 0 720 280" width="100%" style="height:auto;display:block" preserveAspectRatio="xMidYMid meet" role="img" aria-label="커넥션 풀 경합 및 지연 메커니즘">
<defs>
<marker id="arw-perf-1" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
<path d="M0,0 L7,3 L0,6 Z" fill="#5b5e66"/>
</marker>
</defs>
<style>
.bx{fill:#eef2f9;stroke:#21447c;stroke-width:1.4;}
.bxHeavy{fill:#fce8e6;stroke:#c5221f;stroke-width:1.4;}
.bxBlock{fill:#f1f3f4;stroke:#5b5e66;stroke-dasharray:4;stroke-width:1.4;}
.tl{font-family:Pretendard,sans-serif;font-size:14px;font-weight:700;fill:#21447c;}
.tx{font-family:Pretendard,sans-serif;font-size:12px;fill:#1a1c20;text-anchor:middle;}
.sm{font-family:Pretendard,sans-serif;font-size:10px;fill:#5b5e66;text-anchor:middle;}
.fl{stroke:#5b5e66;stroke-width:1.3;}
</style>
<text x="10" y="30" class="tl">1. 클라이언트 요청 유입</text>
<rect class="bxHeavy" x="10" y="50" width="140" height="50" rx="6"/>
<text class="tx" x="80" y="72">무거운 통계 쿼리 요청</text>
<text class="sm" x="80" y="88">stats_heavy 5종</text>
<rect class="bx" x="10" y="160" width="140" height="50" rx="6"/>
<text class="tx" x="80" y="182">가벼운 메타 쿼리 요청</text>
<text class="sm" x="80" y="198">healthz 및 skills</text>
<text x="210" y="30" class="tl">2. WAS 커넥션 풀 상태</text>
<rect class="bxHeavy" x="210" y="50" width="160" height="40" rx="4"/>
<text class="tx" x="290" y="74">커넥션 1: 통계 연산 수행 중</text>
<rect class="bxHeavy" x="210" y="100" width="160" height="40" rx="4"/>
<text class="tx" x="290" y="124">커넥션 2: 통계 연산 수행 중</text>
<rect class="bxBlock" x="210" y="160" width="160" height="50" rx="4"/>
<text class="tx" x="290" y="184">커넥션 3: 대기 상태</text>
<text class="sm" x="290" y="200">가벼운 요청 블로킹</text>
<text x="440" y="30" class="tl">3. 데이터베이스 상태</text>
<rect class="bxHeavy" x="440" y="50" width="260" height="90" rx="6"/>
<text class="tx" x="570" y="85">Posting 테이블 및 PostingTech 테이블 대량 조인</text>
<text class="sm" x="570" y="105">GROUP BY CPU 연산 독점</text>
<line class="fl" x1="150" y1="75" x2="200" y2="75" marker-end="url(#arw-perf-1)"/>
<line class="fl" x1="150" y1="185" x2="200" y2="185" marker-end="url(#arw-perf-1)"/>
<line class="fl" x1="370" y1="95" x2="430" y2="95" marker-end="url(#arw-perf-1)"/>
</svg>
<figcaption>그림 1. 통계 쿼리가 커넥션 풀을 선점하여 발생하는 일반 요청 블로킹 구조</figcaption>
</figure>

## 실측 데이터 분석

동일한 가상 사용자 수인 VU 20 조건에서 1분간 테스트를 수행한 로컬 개발 스택과 프로덕션 환경의 실측 결과를 아래 표로 요약한다.<sup class="fnref" id="fnref3"><a href="#fn3">3</a></sup>

| 요청 분류 | 엔드포인트 | 로컬 평균 지연 시간 | 로컬 95% 신뢰구간 지연 시간 | 프로덕션 평균 지연 시간 | 프로덕션 95% 신뢰구간 지연 시간 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 통계 및 집계 | stats_skill_trend_yearly | 6959.8ms | 12352.9ms | 5412.2ms | 5652.9ms |
| 통계 및 집계 | stats_hiring_season | 5659.5ms | 10422.2ms | 2598.1ms | 2598.1ms |
| 통계 및 집계 | stats_role_stack_fit | 2755.7ms | 4561.2ms | 3513.7ms | 3513.7ms |
| 통계 및 집계 | stats_global_domestic_gap | 3740.3ms | 4909.1ms | N/A | N/A |
| 통계 및 집계 | stats_industry_fingerprint | 2849.4ms | 4126.8ms | N/A | N/A |
| 일반 및 메타 | healthz | 115.0ms | 307.0ms | N/A | N/A |
| 일반 및 메타 | skills | 91.0ms | 214.0ms | N/A | N/A |

수치 분석을 통해 세 가지 사실을 도출했다.
첫째, 정상 동작 시 수십 밀리초 미만이어야 할 헬스체크 API 응답 속도와 기초 스택 목록 조회 API 응답 속도가 부하 상황에서 각각 최대 307ms와 214ms까지 늘어났다. 이는 데이터베이스 조회 지연이 시스템 전체의 IO 대기 시간을 함께 끌어올리고 있음을 증명한다.
둘째, 프로덕션 환경은 CPU 수가 적은 클라우드 가상 머신 사양을 사용하여 로컬 환경보다 데이터베이스 성능이 취약하다. 그 결과 가상 사용자 수가 5명에 불과한 소규모 테스트 환경에서도 로컬 20명 부하 테스트 수준에 육박하는 초 단위 지연이 조기에 재현되었다.
셋째, k6 스파이크 테스트 수치 중 부하 급증이 끝난 후 회복 구간의 지연 시간이 스파이크 발생 순간보다도 나쁘게 유지되는 현상이 기록되었다. 가상 사용자 유입이 차단되었음에도 지연이 복구되지 않는 것은 데이터베이스 풀 내부에 이미 쌓인 대기열이 완전히 소모될 때까지 오랜 시간이 지연되기 때문이다.

## 단계별 문제 해결 및 대응 전략

이 문제를 해결하기 위해 시스템의 결함을 조기에 탐지하는 단기적인 방어 조치와 백엔드 아키텍처를 근본적으로 개편하는 장기적인 성능 최적화 조치로 나누어 대응을 시작했다.

### k6 부하 테스트 스크립트 고도화

테스트 자동화 환경에서 병목을 조기에 격리할 수 있도록 k6 시나리오 설정을 보강했다.
특히, 데이터베이스가 과부하 상태에서도 에러 코드를 반환하지 않고 처리 시간만 지연되는 특성을 잡아내기 위해, 지연 한계점에 따른 강제 중단 기준(threshold)를 시나리오 옵션에 새롭게 주입했다.

```javascript
// performance-test/k6/breakpoint.js 일부 발췌
export const options = {
  stages: buildStairStages(),
  thresholds: {
    http_req_failed: [
      { threshold: `rate<${ERROR_THRESHOLD}`, abortOnFail: true, delayAbortEval: "15s" },
    ],
    // 에러율이 안 오르고 그냥 계속 느려지기만 하는 붕괴 양상도 잡기 위한 지연
    // 기준 abort. 둘 중 하나만 걸려도 멈춘다.
    http_req_duration: [
      { threshold: `p(95)<${LATENCY_ABORT_MS}`, abortOnFail: true, delayAbortEval: "20s" },
    ],
  },
};
```

성능 등급 분류를 통해 지연 우려가 큰 API를 stats_heavy 등급으로 격리하고, 시스템 전체 95% 신뢰구간 지연 시간이 설정한 상한선인 8000ms를 초과하여 20초 이상 지속될 때 테스트를 즉시 비상 중단하는 abort 메커니즘을 적용하여 시스템의 무의미한 자원 소모를 방지했다.

### 아키텍처 최적화 및 쿼리 청크 설계

성능 병목을 근본적으로 해소하기 위해 4명의 팀원에게 최적화 작업을 분배했고 체크리스트를 수립하여 구현 단계에 착수했다.
이에 앞서, 데이터베이스 드라이버 및 SQL 엔진 수준에서 파라미터가 유입 한계를 초과하여 전체 시스템이 정지하던 문제를 해결하기 위해 백엔드 코드의 쿼리 전송부를 청크 단위로 나누어 재구축했다.

```python
# app/crud/posting.py 일부 발췌
_IN_CLAUSE_CHUNK_SIZE = 5000

def _chunked(items: list[int], size: int) -> Iterable[list[int]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]

def _get_posting_skills(
    session: Session,
    posting_ids: Iterable[int],
) -> tuple[dict[int, list[str]], dict[int, set[int]]]:
    ids = list(posting_ids)
    if not ids:
        return {}, {}

    skill_map: dict[int, list[str]] = {}
    skill_id_map: dict[int, set[int]] = {}
    for batch in _chunked(ids, _IN_CLAUSE_CHUNK_SIZE):
        rows = session.execute(
            select(PostingTech.posting_id, Skill.id, Skill.canonical)
            .join(Skill, Skill.id == PostingTech.skill_id)
            .where(
                PostingTech.posting_id.in_(batch),
                PostingTech.is_deleted.is_(False),
                Skill.is_deleted.is_(False),
            )
            .order_by(Skill.canonical.asc())
        ).all()
        for posting_id, skill_id, canonical in rows:
            skill_map.setdefault(posting_id, []).append(canonical)
            skill_id_map.setdefault(posting_id, set()).add(skill_id)

    return skill_map, skill_id_map
```

* **구체화 뷰 신설**: 매 요청마다 수행되던 스킬 연도별 집계 및 채용 시즌 통계용 대량 조인 연산을 백그라운드 스케줄링으로 정기 갱신되는 구체화 뷰로 전환하여 쿼리 지연 속도를 감소시킨다.
* **SQL 쿼리 재작성**: 직무별 스택 적합도 조회 쿼리의 불필요한 테이블 조인 횟수를 최소화하고, 서브쿼리를 최적화하여 런타임 실행 계획 비용을 줄인다.
* **캐싱 계층 도입**: 변동 주기가 길고 동시 조회가 빈번한 통계 및 업계 트렌드 조회 API 응답을 Redis 캐시에 저장하여 데이터베이스 물리 접근 횟수를 줄인다.

## 배운 점

단일 API 기능 구현 완료 단계나 소수의 핵심 API만을 대상으로 수행한 부분 부하 테스트는 실제 시스템이 안고 있는 병목 지점을 포착하지 못한다. 테스트 엔드포인트 커버리지를 다각화하여 실제 사용자가 접할 대시보드 조회 조건까지 밀접하게 구현했을 때 비로소 커넥션 풀 내부의 경합과 API 연쇄 지연 현상을 시각화할 수 있었다. 부하 테스트의 가치는 스크립트 작성의 기교보다도, 운영 환경의 복잡한 요청 형태를 얼마나 높은 정확도로 재현하고 이를 모니터링하여 병목 현상의 인과관계를 찾아내는가에 있음을 보여준다.

<hr>
<ol class="footnotes">
<li id="fn1">임계 상황에서 시스템이 얼마나 버티는지 다량의 가상 트래픽을 가해 측정하는 성능 시험. <a class="fnback" href="#fnref1">↩</a></li>
<li id="fn2">서로 다른 두 테이블을 공통 연결 고리로 엮어 가공하는 연산. <a class="fnback" href="#fnref2">↩</a></li>
<li id="fn3">이 표의 수치는 이 문서에서 새로 측정한 것이 아니라, <a href="04-endpoint-coverage-expansion-and-connection-pool-finding.md">04번 문서</a>와 <a href="05-2026-07-14-local-and-production-results.md">05번 문서</a>가 2026-07-14에 실측해 남긴 k6 실행 로그 원본 수치를 그대로 인용한 것이다. <a class="fnback" href="#fnref3">↩</a></li>
</ol>
