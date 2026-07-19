# 우리 아키텍처: 하이브리드 Agentic + Graph RAG

## 개요

앞선 세 문서에서 RAG의 기본 개념과 종류를 살펴봤고, 이 문서에서는 실제 구현 내용을 다룬다. 이 시스템은 나이브 RAG가 아니라 Agentic RAG와 Graph RAG를 결합한 **하이브리드**이며, 이 문서는 이 조합을 선택한 이유와 지식그래프의 절충 방식, 그리고 정직성을 코드 레벨에서 강제하는 방법을 차례로 다룬 뒤 마지막으로 전체 파이프라인을 순서대로 정리한다. 이 문서는 공고, 엔티티 테이블, 동시 요구 같은 데이터 용어를 자주 쓰는데, 그 정의는 `00-orientation.md`에 있다.

## 하이브리드(Agentic+Graph) 선택 이유

이 서비스가 다루는 질문은 크게 세 종류로 구분된다. 첫째는 정량 질문으로, "채용 공고가 몇 건인가", "지역별 분포는 어떠한가"처럼 정확한 숫자가 필요한 경우다. 둘째는 의미 질문으로, "이 이력서와 비슷한 공고를 찾아달라"처럼 뜻이 비슷한 것을 찾아야 하는 경우다. 셋째는 관계 질문으로, "React와 함께 요구되는 기술은 무엇인가", "최근 프론트 시장 분위기는 어떠한가"처럼 엔티티 사이의 연결 구조를 파악해야 하는 경우다.

Naive RAG(벡터 검색 단일 방식)로는 이 세 종류를 모두 감당할 수 없다. 정량 질문에 벡터 검색을 쓰면 숫자가 부정확해질 수 있고, 관계 질문에 벡터 검색을 쓰면 "비슷한 문서"는 찾아도 "왜, 어떻게 연결되는지"는 답하지 못하기 때문이다. 이에 따라 다음 두 가지를 결합했다. 먼저 Agentic 구조를 채택해 질문마다 적절한 도구(SQL, 벡터, 그래프)를 라우터가 선택하게 했고, 근거가 부족하면 평가자가 재검색을 지시하도록 했다. 그리고 그 도구 중 하나로 Graph RAG를 포함시켜, 관계와 클러스터 질문에 정확히 답할 수 있도록 했다.

이는 "AI API만 떼다 쓴 게 아니다"라고 말할 수 있는 근거이기도 하다. 질문 하나를 처리하는 과정에서 라우팅 판단, 여러 도구 실행, 근거 충분성 검증, 필요 시 재검색까지 거치는데, 이런 구조는 단순 API 호출로는 나올 수 없다.

ByteByteGo가 정리한 "각 방식이 언제 적합한가"를 우리 질문 분포에 대입하면, 하이브리드가 필연적임이 분명해진다. 우리 서비스에는 세 성격의 질문이 모두 실제로 존재하기 때문이다.

| 질문 유형 | 예시 | ByteByteGo가 권하는 방식 | 우리 구현 |
|---|---|---|---|
| 정량, 랭킹 | "공고 몇 건인가", "상위 기술 1위는" | 답이 데이터에 있고 속도 중요 → 결정론적 조회 | `sql_tool` (Agentic이 라우팅) |
| 의미 유사 | "이 이력서와 비슷한 공고" | 문서 안에 답, 속도 중요 → Naive RAG | `vector_tool` (BGE-M3 + pgvector) |
| 관계, 구조 | "React와 함께 요구되는 기술", "프론트 시장 분위기" | 구조적 지식 → Graph RAG | `graph_tool` (local/global) |
| 다단계, 자기교정 | "지금 상황 종합 정리" | 다단계 추론, 자기교정 → Agentic RAG | 라우터+평가자 재검색 루프 |

한 방식만으로는 이 네 행을 모두 만족시킬 수 없었으므로, Agentic의 자기교정 골격을 바깥에 두고 그 도구 중 하나로 Graph를 넣는 조합을 택했다. 여기에는 강력한 방식일수록 대가가 크다는 원칙, 즉 느림과 비용과 디버깅 난이도가 커진다는 점도 함께 반영했다. 그래서 무거운 Agentic 루프를 매 질문에 무조건 돌리지는 않으며, 라우터가 정량 질문을 곧장 `sql_tool`로 보내 값싸고 정확하게 끝내도록 한 것이 그 예다.

<figure class="fig">
<svg viewBox="0 0 680 220" width="100%" style="height:auto;display:block" preserveAspectRatio="xMidYMid meet" role="img" aria-label="질문 유형 3종이 각각 다른 도구로 라우팅되어 하나의 답변 규약으로 합류하는 구조">
  <defs>
    <marker id="arwR" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L7,3 L0,6 Z" fill="#5b5e66"/>
    </marker>
  </defs>
  <style>
    .bx{fill:#eef2f9;stroke:#21447c;stroke-width:1.4;}
    .bxAns{fill:#e8f5ec;stroke:#1f7a3d;stroke-width:1.6;}
    .tl{font-family:Pretendard,sans-serif;font-size:12.5px;font-weight:700;fill:#1a1c20;text-anchor:middle;}
    .sm{font-family:Pretendard,sans-serif;font-size:10.5px;fill:#5b5e66;text-anchor:middle;}
    .code{font-family:monospace;font-size:11px;fill:#21447c;text-anchor:middle;font-weight:700;}
    .fl{stroke:#5b5e66;stroke-width:1.3;fill:none;}
  </style>
  <rect class="bx" x="10" y="10" width="150" height="46" rx="8"/>
  <text class="tl" x="85" y="30">정량 질문</text><text class="sm" x="85" y="46">"공고 몇 건?"</text>
  <rect class="bx" x="10" y="87" width="150" height="46" rx="8"/>
  <text class="tl" x="85" y="107">의미 질문</text><text class="sm" x="85" y="123">"비슷한 공고 찾아줘"</text>
  <rect class="bx" x="10" y="164" width="150" height="46" rx="8"/>
  <text class="tl" x="85" y="184">관계 질문</text><text class="sm" x="85" y="200">"React랑 같이 뭐 써?"</text>

  <rect class="bx" x="250" y="10" width="150" height="46" rx="8"/>
  <text class="code" x="325" y="32">sql_tool</text><text class="sm" x="325" y="47">결정론적 집계</text>
  <rect class="bx" x="250" y="87" width="150" height="46" rx="8"/>
  <text class="code" x="325" y="109">vector_tool</text><text class="sm" x="325" y="124">BGE-M3 + pgvector</text>
  <rect class="bx" x="250" y="164" width="150" height="46" rx="8"/>
  <text class="code" x="325" y="186">graph_tool</text><text class="sm" x="325" y="201">공동출현 순회</text>

  <rect class="bxAns" x="500" y="87" width="170" height="46" rx="8"/>
  <text class="tl" x="585" y="107" fill="#1f7a3d">근거 인용 답변</text>
  <text class="sm" x="585" y="123">citations + degraded</text>

  <line class="fl" x1="160" y1="33" x2="248" y2="33" marker-end="url(#arwR)"/>
  <line class="fl" x1="160" y1="110" x2="248" y2="110" marker-end="url(#arwR)"/>
  <line class="fl" x1="160" y1="187" x2="248" y2="187" marker-end="url(#arwR)"/>
  <path class="fl" d="M400,33 C460,33 460,110 498,110" marker-end="url(#arwR)"/>
  <line class="fl" x1="400" y1="110" x2="498" y2="110" marker-end="url(#arwR)"/>
  <path class="fl" d="M400,187 C460,187 460,110 498,110" marker-end="url(#arwR)"/>
</svg>
<figcaption>그림 3. 질문 유형마다 정해진 도구 하나로 고정 라우팅한 뒤, 세 경로 모두 같은 근거 인용·degraded 규약을 지키는 답변으로 합류한다. `router.py`의 `INTENT_TOOLS` 매핑을 그대로 도식화한 것이다.</figcaption>
</figure>

## 지식그래프 A+ 절충

지식그래프 구축에는 두 가지 선택지가 있었고, 각각을 **방식 A**와 **방식 B**로 부른다.

- **방식 A(구조화 속성 그래프)**: 이미 보유한 구조화 데이터, 즉 공고, 기술, 자격증, 회사, 지역, 산업 테이블로 그래프를 직접 구축한다. 숫자와 관계가 전부 데이터에서 결정론적으로 나오므로 빠르고 정확하지만, "그래서 이 관계가 왜 중요한지"를 설명하는 서술이 없다.
- **방식 B(LLM 추출 그래프)**: 모든 것을 LLM에 맡겨 원본 텍스트에서 엔티티와 관계를 추출한다. 유연하지만 느리고 비용이 크며, LLM이 관계를 잘못 추출할 위험도 있다.

이 시스템은 방식 A를 뼈대로 그대로 채택하되, 방식 A의 유일한 약점인 "서술 없음"만 LLM으로 보강했다. 방식 A에 서술력을 한 단계 더한 조합이라는 뜻에서 이를 **"A+" 방식**이라 부른다. 학점 표기를 빌린 이름 그대로, "방식 A + 서술 보강"이 이 명칭의 전부다.

> 뼈대는 구조화 속성 그래프(방식 A)로, 서술만 LLM으로 보강한다. 숫자와 관계는 데이터에서 결정론적으로 추출하고, "그 관계가 어떤 의미인지"를 설명하는 문장만 LLM이 덧붙인다.

<figure class="fig">
<svg viewBox="0 0 680 270" width="100%" style="height:auto;display:block" preserveAspectRatio="xMidYMid meet" role="img" aria-label="방식 A와 방식 B를 절충해 A+ 방식을 만드는 구조">
  <defs>
    <marker id="arwAP" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L7,3 L0,6 Z" fill="#5b5e66"/>
    </marker>
  </defs>
  <style>
    .bxA{fill:#eef2f9;stroke:#21447c;stroke-width:1.4;}
    .bxB{fill:#f7f3ec;stroke:#8a6a3d;stroke-width:1.4;}
    .bxAP{fill:#e8f5ec;stroke:#1f7a3d;stroke-width:1.8;}
    .tl{font-family:Pretendard,sans-serif;font-size:13px;font-weight:700;fill:#1a1c20;text-anchor:middle;}
    .sm{font-family:Pretendard,sans-serif;font-size:10.5px;fill:#5b5e66;text-anchor:middle;}
    .good{font-family:Pretendard,sans-serif;font-size:10.5px;fill:#1f7a3d;text-anchor:middle;}
    .bad{font-family:Pretendard,sans-serif;font-size:10.5px;fill:#b3402f;text-anchor:middle;}
    .fl{stroke:#5b5e66;stroke-width:1.3;fill:none;}
  </style>
  <rect class="bxA" x="20" y="15" width="290" height="100" rx="8"/>
  <text class="tl" x="165" y="38">방식 A · 구조화 속성 그래프</text>
  <text class="sm" x="165" y="56">공고/기술/회사 테이블 직접 구축</text>
  <text class="good" x="165" y="76">+ 빠르고 정확 (결정론적)</text>
  <text class="bad" x="165" y="94">- 서술적 설명 없음</text>
  <rect class="bxB" x="370" y="15" width="290" height="100" rx="8"/>
  <text class="tl" x="515" y="38">방식 B · LLM 추출 그래프</text>
  <text class="sm" x="515" y="56">원본 텍스트에서 엔티티/관계 추출</text>
  <text class="good" x="515" y="76">+ 유연함</text>
  <text class="bad" x="515" y="94">- 느림 · 고비용 · 부정확 위험</text>
  <rect class="bxAP" x="150" y="175" width="380" height="80" rx="10"/>
  <text class="tl" x="340" y="200" fill="#1f7a3d">A+ = 방식 A의 뼈대 + LLM 서술 보강 2곳</text>
  <text class="sm" x="340" y="220">숫자·관계는 결정론적, 문장 생성은 딱 두 지점만</text>
  <text class="sm" x="340" y="238">엣지 설명 1줄 + 커뮤니티 리포트</text>
  <line class="fl" x1="165" y1="115" x2="270" y2="173" marker-end="url(#arwAP)"/>
  <line class="fl" x1="515" y1="115" x2="410" y2="173" marker-end="url(#arwAP)"/>
</svg>
<figcaption>그림 4. 방식 A(구조화 속성 그래프)를 뼈대로 삼고, 방식 B(LLM 추출)의 장점인 서술력만 두 지점에 한정해 빌려온 것이 A+ 방식이다.</figcaption>
</figure>

노드와 엣지는 다음과 같이 구성된다.

```
노드:  Tech, Cert, Company, Region, Industry, Posting
엣지:  Tech ─CO_OCCURS(strength, n)─ Tech      (기술 동시 요구, 기존 co-occurrence 데이터 기반)
       Tech ─LEADS(lag, corr)─ Tech           (트렌드 선후행 관계)
       Posting ─REQUIRES─ Tech / Cert
       Posting ─POSTED_BY─ Company ─LOCATED_IN─ Region ─IN_INDUSTRY─ Industry
```

저장은 Postgres 테이블(`graph_node`, `graph_edge`)에 하며, 순회는 재귀 CTE(SQL로 그래프를 따라가는 쿼리) 또는 오프라인에서 networkx/igraph 같은 그래프 라이브러리로 처리한다.

검색은 앞 문서에서 설명한 두 방식을 그대로 사용한다. Local search는 특정 기술의 이웃, 즉 함께 요구되는 기술과 요구되는 자격증, 주요 채용 회사를 순회해 정확한 수치로 답하는 방식으로, "React를 배우면 무엇을 함께 배워야 하는가" 같은 질문에 쓴다. Global search는 그래프를 커뮤니티로 분할해 답하는 방식인데, 커뮤니티는 Louvain이나 Leiden 알고리즘으로 검출하며 연산 비용이 커 Celery로 오프라인 처리한다. 각 커뮤니티는 LLM이 요약한 리포트로 생성되고, 넓은 질문에는 이 리포트들을 map-reduce 방식으로 종합해 답하는데, "최근 프론트 시장은 어떠한가" 같은 질문이 여기에 해당한다.

LLM을 사용하는 지점은 두 곳으로 제한했으며, 이것이 이 방식을 "A+"라 부르는 이유다. 하나는 엣지 설명 한 줄을 생성하는 것으로, 예를 들어 "React↔TypeScript 82% 동시 요구, 이 조합이 흔한 이유"를 설명하는 문장이다. 다른 하나는 커뮤니티 리포트, 즉 클러스터별 제목과 요약을 생성하는 것이다.

여기에 다음 원칙을 지킨다.

> 원본 공고 텍스트를 통째로 임베딩하지 않는다. 집계, 요약, 리포트 단위만 임베딩하여, 검색 결과가 항상 "정제된 근거"가 되도록 한다.

## 정직성 가드

이 시스템 전체를 관통하는 불변 원칙이 있으며, 다음 네 가지는 코드 레벨에서 강제한다. 정량, 집계, 랭킹 질문은 무조건 SQL로 라우팅해 벡터나 그래프가 숫자를 지어내는 것을 원천 차단한다. 즉 "몇 건인가", "1위는 무엇인가" 같은 질문은 결정론적 SQL 집계 쿼리로만 답한다. 또한 답변마다 근거 인용(citations)을 강제하며, 검색이 빈약하면 "데이터 부족"으로 답하게 해 모른다고 정직하게 답하는 것도 정답 처리에 포함시킨다. LLM 폴백이 발생하면 `degraded: true`로 정직하게 표기해, 정상 파이프라인이 아니라 대체 경로로 답했다는 사실을 숨기지 않는다. 마지막으로 DB에 없는 값, 예를 들어 합격 확률 같은 근거 없는 추정치는 절대 생성하지 않는다.

이 원칙은 `01-rag-basics.md`에서 다룬 "근거 안에서만 답한다"는 원칙을 실제 구현으로 옮긴 것이며, 부가기능이라는 이유로 느슨하게 만들지 않고 본 서비스와 동일한 수준의 정직성을 요구한다.

## 파이프라인 개요

전체 흐름은 다음과 같이 이어진다.

```
사용자 질문
   │
   ▼
[1] Router/Planner (Claude Haiku)
   │   질문 분해 → plan{intent, subqueries[], tools:[sql|vector|graph], pool}
   ▼
[2] Tools 실행 (병렬 가능)
   ├─ sql_tool      정량, 랭킹        결정론적 집계 쿼리 (100% 정확)
   ├─ vector_tool   의미 유사        BGE-M3 임베딩 + pgvector HNSW 코사인 + bge-reranker
   └─ graph_tool    관계, 클러스터    지식그래프 local/global search
   ▼
[3] Evaluator (Claude)  근거 충분? pass / re-retrieve (도구, 파라미터 변경, 최대 2회)
   ▼
[4] Synthesis (Claude Sonnet)  근거 인용 강제 + JSON 구조화 출력
   ▼
프론트: steps[] 단계별 렌더 + tool_results[] 차트 파싱 + citations resolve
```

각 단계는 다음과 같이 요약된다. Router/Planner인 Claude Haiku는 질문을 읽고 필요한 도구를 계획하며, 정량 질문이면 `sql`을 무조건 계획에 포함시킨다. Tools 단계에서는 계획에 따라 SQL, 벡터, 그래프 도구를 실행하는데, 필요하면 여러 도구를 동시에 실행할 수 있다. Evaluator인 Claude는 확보된 근거가 질문에 답하기 충분한지 점수를 매기고, 부족하면 도구나 파라미터를 바꿔 최대 2회까지 재검색한다. Synthesis인 Claude Sonnet은 근거를 인용하며 최종 답을 구조화된 JSON으로 생성하고, 근거가 끝내 부족하면 "모른다"고 답한다.

생성, 즉 자연어 답변 작성은 Claude API에 맡기는데 라우팅은 Haiku, 합성은 Sonnet이 담당한다. 반면 임베딩(BGE-M3)과 리랭킹(bge-reranker)은 로컬 GPU(RTX 4060 8GB)에서 직접 처리하며, 이처럼 로컬 자체 호스팅 파트와 API 파트를 명확히 구분했다. 이 구성 역시 "API만 떼다 쓴 게 아니다"를 뒷받침하는 근거 중 하나다.

프론트엔드는 이 파이프라인이 생성한 응답(`answer`, `route`, `plan`, `steps[]`, `tool_results[]`, `citations`, `confidence`, `degraded`)을 그대로 받아, 라우팅 판단부터 도구 실행, 검증, 합성까지의 과정을 단계별로 펼쳐 보여준다. "기계가 일하는 과정 자체"가 신뢰의 근거가 되도록 설계했다.

## 시나리오로 보는 라우팅

개념 설명만으로는 각 도구가 실제로 언제, 어떻게 갈리는지 감이 잘 안 온다. 아래 네 가지는 실제 질문이 파이프라인을 통과하는 과정을 4단계(라우팅 → 도구 → 검증 → 합성) 순서 그대로 따라간 시나리오이며, 앞의 세 개는 정량·관계·의미 질문이 각각 다른 도구로 갈리는 정상 경로를, 마지막 하나는 근거를 못 찾았을 때 정직성 가드가 작동하는 경로를 보여준다. 프로세 설명과 구분되도록 코드블럭(트레이스 로그 형태)으로 표기한다.

**시나리오 1 — 정량 질문: `sql_tool`로 라우팅**

```text
질문: "React를 요구하는 공고가 몇 건이야?"

[1] Router   intent=skill_demand → tools=[sql]
[2] Tool     sql_tool.skill_demand(skill="React")
             → COUNT(DISTINCT posting_id) = 812건
[3] Eval     total_n=812 > 0 → pass · "근거 표본 812건"
[4] Synth    "채용 공고를 분석한 결과, React를 요구하는 공고는 **812건**이에요."

route: sql · confidence: high · degraded: false
```

**시나리오 2 — 관계 질문: `graph_tool`로 라우팅**

```text
질문: "React랑 같이 많이 쓰는 기술이 뭐야?"

[1] Router   intent=cooccurrence → tools=[graph]
[2] Tool     graph_tool.co_occurring_skills(skill="React")
             → 1-hop: TypeScript(82%) · Next.js(61%) · Redux(38%) ...
[3] Eval     items 존재 → pass · "근거 표본 4건"
[4] Synth    "React와 함께 가장 많이 요구되는 기술은 **TypeScript(82%)**,
             Next.js(61%), Redux(38%) 순이에요."

route: graph · confidence: high · degraded: false
```

**시나리오 3 — 의미 질문: `vector_tool`로 라우팅**

```text
질문: "백엔드 신입이 지원할 만한 공고 추천해줘"

[1] Router   intent=semantic_search → tools=[vector]
[2] Tool     vector_tool.semantic_search(query="...")
             → embed_query() (BGE-M3) → pgvector 코사인 top-8
             (is_tech_posting=true 필터로 비개발 공고 배제)
[3] Eval     items 8건 → pass · "근거 표본 8건"
[4] Synth    "조건에 맞는 공고를 8건 찾았어요: ..."

route: vector · confidence: medium · degraded: false
```

**시나리오 4 — 근거 없음: 정직성 가드가 작동**

```text
질문: "COBOL을 요구하는 공고가 몇 건이야?"

[1] Router   intent=skill_demand → tools=[sql]
[2] Tool     sql_tool.skill_demand(skill="COBOL")
             → resolve_skill() 실패 (skill 테이블에 없는 이름) → None
             → tool_outputs = []
[3] Eval     tool_outputs 비어있음 → fail
             "근거 없음 — 도구가 결과를 반환하지 않음"
[4] Synth    passed=False → "관련 데이터가 부족해요."

route: sql · confidence: 0 · degraded: true
```

네 시나리오를 나란히 보면 이 구조의 핵심이 드러난다. 앞의 세 시나리오는 질문 성격에 따라 도구만 바뀔 뿐 라우팅→도구→검증→합성이라는 흐름 자체는 동일하고, 마지막 시나리오는 그 흐름 중 어느 단계에서든 근거가 없으면 답을 지어내지 않고 `degraded: true`와 함께 "부족하다"고 정직하게 멈춘다. `evaluate()`가 빈 `tool_outputs`를 즉시 실패로 판정하는 코드가 실제로 이 네 번째 경로를 만든다.

## 실제 코드로 확인하는 RAG 유형

지금까지는 설계 관점에서 설명했다. 여기서는 실제로 배포된 소스 코드를 근거로, 이 시스템이 `03-rag-types.md`에서 정리한 분류 중 정확히 어디에 해당하는지 확인한다. 아래 코드는 전부 `backend/app/services/rag/` 아래 실제 파일에서 그대로 발췌했다.

### 라우팅: 질문 성격에 따라 도구를 고른다

`backend/app/services/rag/router.py`의 `INTENT_TOOLS`는 질문의 의도(intent) 하나를 도구 하나에 매핑한다. 정량 질문은 `sql`로, 관계 질문은 `graph`로, 의미 질문은 `vector`로 고정해서 보내는 코드가 그대로 있다.

```python
# backend/app/services/rag/router.py
INTENT_TOOLS = {
    "cooccurrence": ["graph"],
    "skill_demand": ["sql"],
    "skill_ranking": ["sql"],
    "compare": ["sql"],
    "concept_ranking": ["sql"],
    "cert_ranking": ["sql"],
    "semantic_search": ["vector"],
    "overview": ["sql"],
    "region_distribution": ["sql"],
}


def plan(session: Session, llm: LLMClient, question: str, pool: str | None) -> tuple[Plan, bool]:
    """(Plan, degraded). LLM 성공 시 degraded=False, 폴백 시 True."""
    raw = llm.json(_PLANNER_SYSTEM, question, temperature=0.0)
    if not raw or raw.get("intent") not in INTENT_TOOLS:
        return _heuristic(session, question, pool), True
    ...
```

LLM이 의도 분류를 내면 그 결과로 도구를 정하고, LLM 호출이 실패하면 `_heuristic()`이라는 키워드 기반 폴백으로 넘어가 `degraded=True`를 반환한다. 이 "질문마다 도구를 스스로 고르고, 실패를 감추지 않고 표시한다"는 두 가지가 Agentic RAG를 Naive RAG와 가르는 핵심이며, 이 프로젝트에서는 라우터 계층에 그대로 코드화되어 있다.

### 도구: SQL, 벡터, 그래프 세 갈래

정량 질문은 `backend/app/services/rag/tools/sql_tool.py`가 결정론적 SQL 집계로 처리한다.

```python
# backend/app/services/rag/tools/sql_tool.py
def skill_demand(
    session: Session,
    skill_name: str,
    pool: str | None = None,
    category: str | None = None,
    entry_level: bool = False,
    verbose: bool = False,
) -> dict | None:
    resolved = resolve_skill(session, skill_name)
    if not resolved:
        return None
    skill_id, canonical = resolved
    ...
    sql = (
        f"SELECT COUNT(DISTINCT pt.posting_id) FROM posting_tech pt "
        f"JOIN posting p ON p.id = pt.posting_id "
        f"{join}"
        f"WHERE pt.skill_id = :sid AND pt.is_deleted = false AND {_POOL_WHERE}{where_extra}"
    )
```

의미 질문은 `backend/app/services/rag/tools/vector_tool.py`가 BGE-M3 임베딩과 pgvector 코사인 거리로 처리한다.

```python
# backend/app/services/rag/tools/vector_tool.py
def semantic_search(
    session: Session, query: str, pool: str | None = None, limit: int = 8, verbose: bool = False
) -> dict | None:
    vec = embed_query(query)
    if vec is None:
        return None

    qv = "[" + ",".join(f"{x:.6f}" for x in vec) + "]"
    sql = (
        f"SELECT p.id, p.title, p.company, p.pool, "
        f"(e.embedding <=> CAST(:qv AS vector)) AS dist "
        f"FROM posting_embedding e "
        f"JOIN posting p ON p.id = e.id "
        f"WHERE {_POOL_WHERE} "
        f"ORDER BY e.embedding <=> CAST(:qv AS vector) LIMIT :limit"
    )
```

관계 질문은 `backend/app/services/rag/tools/graph_tool.py`가 처리하는데, 여기서 앞서 설명한 설계와 실제 구현 사이에 짚어야 할 차이가 하나 있다. 이 함수의 docstring은 스스로를 이렇게 밝힌다.

```python
# backend/app/services/rag/tools/graph_tool.py
"""graph_tool — 지식그래프 local search(공동출현 순회).

"React 배우면 뭘 같이?" 류 관계 질문에 정확한 수치로 답한다.
엣지 = 같은 공고에서 함께 요구된 기술 쌍. strength = 대상 기술 공고 중 동반 비율.
서브그래프(nodes/edges)를 tool_result.graph 로 반환해 프론트 네트워크 위젯이 렌더.
2-hop 크로스엣지: 1-hop 이웃들끼리의 공동출현도 함께 반환해 2단 네트워크를 구성한다.
"""

def co_occurring_skills(
    session: Session, skill_name: str, pool: str | None = None, limit: int = 8, verbose: bool = False
) -> dict | None:
    ...
    sql_1hop = (
        f"SELECT s2.canonical, s2.id, COUNT(DISTINCT pt2.posting_id) n "
        f"FROM posting_tech pt1 "
        f"JOIN posting_tech pt2 ON pt1.posting_id = pt2.posting_id "
        f"  AND pt2.skill_id <> pt1.skill_id AND pt2.is_deleted = false "
        f"JOIN skill s2 ON s2.id = pt2.skill_id "
        ...
    )
```

`co_occurring_skills`는 위 "지식그래프 A+ 절충"에서 그림으로 설명한 `graph_node`/`graph_edge` 같은 영속 그래프 테이블을 순회하지 않는다. `posting_tech`와 `skill`, `posting` 세 관계형 테이블을 요청이 들어올 때마다 자기 조인(self-join)해서, "같은 공고에 함께 등장한 기술 쌍"이라는 서브그래프를 즉석에서 계산해 반환한다. 즉 Graph RAG의 local search가 노리는 결과(엔티티 하나에서 이웃으로 뻗어나가는 순회)는 그대로 내지만, 그 방법은 별도 그래프 저장소가 아니라 SQL 자기조인이다. 커뮤니티 리포트를 미리 만들어두고 맵리듀스로 종합하는 global search는 이 파일에 아직 구현되어 있지 않다.

### 평가와 합성: 근거 검증과 인용 강제

`backend/app/services/rag/evaluator.py`는 파일 전체가 18줄이다. 도구가 실제로 근거를 냈는지만 결정론적으로 판정한다.

```python
# backend/app/services/rag/evaluator.py
"""Evaluator — 검색 근거 충분성 판정.

증분 1은 결정론적: 도구가 실제 근거(n>0, 항목 존재)를 냈으면 pass.
설계상 재검색 루프(최대 2회)는 후속 증분에서 LLM 평가로 확장한다.
"""

def evaluate(tool_outputs: list[dict]) -> tuple[bool, str]:
    if not tool_outputs:
        return False, "근거 없음 — 도구가 결과를 반환하지 않음"
    total_n = sum(o.get("n", 0) for o in tool_outputs)
    has_items = any(o.get("tool_result", {}).get("items") for o in tool_outputs)
    if total_n <= 0 and not has_items:
        return False, "근거 표본 0 — 데이터 부족"
    return True, f"pass · 근거 표본 {total_n:,}건"
```

docstring이 스스로 밝히듯, 지금 배포된 버전은 "도구가 낸 근거가 있는지 없는지"만 판정하는 1회성 결정론적 게이트다. 위에서 설명한 "부족하면 도구나 검색어를 바꿔 재검색하는" 자기교정 루프(최대 2회)는 아직 이 코드에 없고, 후속 증분 과제로 남아 있다.

근거가 통과되면 `backend/app/services/rag/synthesis.py`가 답을 생성하는데, 여기서는 근거 인용을 강제하는 프롬프트와, LLM이 근거를 무시하고 "데이터 부족"이라고 얼버무릴 때 이를 사실 템플릿으로 되돌리는 방어 코드를 확인할 수 있다.

```python
# backend/app/services/rag/synthesis.py
_SYNTH_SYSTEM = (
    "너는 채용시장 데이터 어시스턴트다. 아래에 주어진 '사실'만 근거로 한국어 2~3문장 답을 작성한다. "
    "사실에 없는 수치나 항목을 절대 지어내지 마라. "
    ...
)

def synthesize(
    llm: LLMClient, question: str, tool_outputs: list[dict], passed: bool
) -> tuple[str, bool, bool]:
    facts = [o["facts"] for o in tool_outputs if o.get("facts")]
    if not passed or not facts:
        return "관련 데이터가 부족해요.", True, False
    ...
    text = llm.text(_SYNTH_SYSTEM, prompt, temperature=0.3)
    if text and text.strip() and not _is_bail(text.strip()):
        return text.strip(), False, True
    # LLM이 미가용이거나, 사실이 있는데도 부족 문구로 답했다면 사실 템플릿으로 덮어써
    # 실제 데이터를 보여준다(허위 '부족' 응답 방지).
    return _fallback(facts), True, True
```

`_is_bail()`이 하는 일이 특히 이 시스템의 정직성 원칙을 코드로 보여준다. LLM이 근거를 받고도 습관적으로 "데이터가 부족하다"는 문구를 내면, 그 답을 그대로 쓰지 않고 실제 근거 문장으로 덮어써 버린다. 근거가 있는데 없다고 둘러대는 것도, 근거가 없는데 있다고 지어내는 것도 둘 다 막는 구조다.

### 오케스트레이션: 라우팅 → 도구 → 평가 → 합성

이 네 단계를 순서대로 묶는 곳은 `backend/app/services/rag/pipeline.py`의 `run_chat_events()`다.

```python
# backend/app/services/rag/pipeline.py
def run_chat_events(
    session: Session, question: str, pool: str | None = None, *,
    verbose: bool = False, collect: dict[str, Any] | None = None,
) -> Iterator[dict[str, Any]]:
    ...
    llm = get_llm()
    p, plan_degraded = make_plan(session, llm, question, pool)          # [1] 라우팅
    ...
    tool_outputs, fell_back = _dispatch(session, p, verbose=verbose)    # [2] 도구 실행
    ...
    passed, eval_detail = evaluate(tool_outputs)                        # [3] 근거 검증
    ...
    answer, synth_degraded, answered = synthesize(llm, question, tool_outputs, passed)  # [4] 합성
```

이 함수를 그대로 노출하는 엔드포인트가 `backend/app/routers/chat.py`다.

```python
# backend/app/routers/chat.py
"""POST /chat — 하이브리드 Agentic + Graph RAG 엔드포인트(v2 구조화 JSON)."""

@router.post("/chat", response_model=ChatResponse)
def chat(body: ChatRequest, session: SessionDep) -> ChatResponse:
    return run_chat(session, body.question, body.pool, verbose=body.verbose)


@router.post("/chat/stream")
def chat_stream(body: ChatRequest, session: SessionDep) -> StreamingResponse:
    def gen() -> Iterator[str]:
        for event in run_chat_events(session, body.question, body.pool, verbose=body.verbose):
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
    return StreamingResponse(gen(), media_type="text/event-stream")
```

### 종합: 어떤 RAG인가, 그리고 지금 어디까지 왔는가

코드를 근거로 정리하면, 이 시스템은 라우팅과 도구 선택, 근거 검증, 합성이라는 Agentic RAG의 뼈대를 갖췄고, 그 도구 중 하나(`graph_tool`)가 Graph RAG의 local search 아이디어를 관계형 데이터 자기조인으로 구현한 하이브리드다. `03-rag-types.md`의 분류에 정확히 대입하면 "Agentic RAG 골격 위에 Graph RAG 스타일 도구 하나를 얹은 구조"에 해당한다.

다만 이 문서 앞부분에서 설명한 완성형 설계와 지금 배포된 코드 사이에는 정직하게 밝혀야 할 차이가 있다. `backend/app/services/rag/llm.py`의 실제 LLM 백엔드는 Gemini이며(`GeminiClient`), "설계상 나중에 Claude로 교체 가능하도록 인터페이스를 좁게 둔다"는 주석대로 아직은 추상화 인터페이스 뒤에 Gemini가 배선된 상태다. 지식그래프도 앞서 설명한 `graph_node`/`graph_edge` 영속 테이블이 아니라, 매 요청마다 관계형 테이블을 자기조인해 즉석으로 서브그래프를 계산하는 방식이며, 커뮤니티 리포트 기반 global search는 아직 구현되지 않았다. 근거 검증(evaluator)도 LLM이 판단해 재검색을 지시하는 루프가 아니라, 근거 유무만 보는 결정론적 1회 게이트다. 이 격차를 감추지 않고 그대로 적어두는 것 자체가, 위 "정직성 가드" 절에서 강제한 원칙(모르면 모른다고 답하고, degraded 상태를 숨기지 않는다)을 이 문서 자신에도 똑같이 적용한 것이다.
