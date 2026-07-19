# RAG의 종류: Naive부터 Agentic, Graph까지

## 개요

RAG는 하나의 고정된 방식이 아니라, 검색과 생성을 어떻게 조합하느냐에 따라 여러 세대로 발전해온 기술이다. 학계에서는 이 발전 과정을 크게 Naive RAG, Advanced RAG, Modular RAG 세 단계로 정리하는데, Naive RAG는 검색 한 번 뒤에 곧바로 답을 생성하는 가장 단순한 형태이고, Advanced RAG는 여기에 데이터 전처리 개선과 반복 검색 같은 장치를 더한 형태이며, Modular RAG는 라우팅과 여러 기능 모듈을 자유롭게 갈아 끼울 수 있는 유연한 형태다[1]. 이 문서는 이 흐름을 실무에서 가장 많이 부딕히는 세 가지 이름인 Naive, Agentic, Graph로 나누어 다루고, 마지막에는 이를 하나의 비교표로 정리한다. Agentic과 Graph는 각각 Modular RAG가 취할 수 있는 대표적인 형태라고 볼 수 있다. 공고 같은 프로젝트 용어는 `00-orientation.md`에서 설명하며, 아래 그림은 세 방식의 파이프라인이 서로 어떻게 다른지 보여준다.

<figure class="fig">
<svg viewBox="0 0 720 372" width="100%" style="height:auto;display:block" preserveAspectRatio="xMidYMid meet" role="img" aria-label="세 가지 RAG 파이프라인 비교">
  <defs>
    <marker id="arw" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L7,3 L0,6 Z" fill="#5b5e66"/>
    </marker>
  </defs>
  <style>
    .bx{fill:#eef2f9;stroke:#21447c;stroke-width:1.4;}
    .tl{font-family:Pretendard,sans-serif;font-size:13px;font-weight:700;fill:#21447c;}
    .tx{font-family:Pretendard,sans-serif;font-size:11.5px;fill:#1a1c20;text-anchor:middle;}
    .sm{font-family:Pretendard,sans-serif;font-size:10px;fill:#5b5e66;text-anchor:middle;}
    .fl{stroke:#5b5e66;stroke-width:1.3;}
  </style>
  <!-- Naive RAG -->
  <text x="8" y="24" class="tl">Naive RAG</text>
  <rect class="bx" x="88" y="38" width="112" height="46" rx="8"/><text class="tx" x="144" y="66">질문</text>
  <rect class="bx" x="218" y="38" width="112" height="46" rx="8"/><text class="tx" x="274" y="66">임베딩</text>
  <rect class="bx" x="348" y="38" width="112" height="46" rx="8"/><text class="tx" x="404" y="60">벡터 DB</text><text class="sm" x="404" y="75">top-k 청크</text>
  <rect class="bx" x="478" y="38" width="112" height="46" rx="8"/><text class="tx" x="534" y="66">LLM</text>
  <rect class="bx" x="608" y="38" width="112" height="46" rx="8"/><text class="tx" x="664" y="66">답변</text>
  <line class="fl" x1="200" y1="61" x2="216" y2="61" marker-end="url(#arw)"/>
  <line class="fl" x1="330" y1="61" x2="346" y2="61" marker-end="url(#arw)"/>
  <line class="fl" x1="460" y1="61" x2="476" y2="61" marker-end="url(#arw)"/>
  <line class="fl" x1="590" y1="61" x2="606" y2="61" marker-end="url(#arw)"/>
  <!-- Graph RAG -->
  <text x="8" y="132" class="tl">Graph RAG</text>
  <rect class="bx" x="88" y="146" width="112" height="46" rx="8"/><text class="tx" x="144" y="174">질문</text>
  <rect class="bx" x="218" y="146" width="112" height="46" rx="8"/><text class="tx" x="274" y="174">유형 분류</text>
  <rect class="bx" x="348" y="146" width="112" height="46" rx="8"/><text class="sm" x="404" y="166">Local: 벡터+그래프 순회</text><text class="sm" x="404" y="181">Global: 커뮤니티 리포트</text>
  <rect class="bx" x="478" y="146" width="112" height="46" rx="8"/><text class="tx" x="534" y="174">LLM</text>
  <rect class="bx" x="608" y="146" width="112" height="46" rx="8"/><text class="tx" x="664" y="174">답변</text>
  <line class="fl" x1="200" y1="169" x2="216" y2="169" marker-end="url(#arw)"/>
  <line class="fl" x1="330" y1="169" x2="346" y2="169" marker-end="url(#arw)"/>
  <line class="fl" x1="460" y1="169" x2="476" y2="169" marker-end="url(#arw)"/>
  <line class="fl" x1="590" y1="169" x2="606" y2="169" marker-end="url(#arw)"/>
  <!-- Agentic RAG -->
  <text x="8" y="262" class="tl">Agentic RAG</text>
  <path class="fl" d="M534,300 C534,272 404,272 404,298" fill="none" stroke-dasharray="4 3" marker-end="url(#arw)"/>
  <text class="sm" x="469" y="270">재검색 루프</text>
  <rect class="bx" x="88" y="300" width="112" height="46" rx="8"/><text class="tx" x="144" y="328">질문</text>
  <rect class="bx" x="218" y="300" width="112" height="46" rx="8"/><text class="tx" x="274" y="322">에이전트</text><text class="sm" x="274" y="337">분해, 도구 선택</text>
  <rect class="bx" x="348" y="300" width="112" height="46" rx="8"/><text class="tx" x="404" y="322">도구 실행</text><text class="sm" x="404" y="337">SQL, 벡터, 그래프</text>
  <rect class="bx" x="478" y="300" width="112" height="46" rx="8"/><text class="tx" x="534" y="322">검증자</text><text class="sm" x="534" y="337">근거 충분?</text>
  <rect class="bx" x="608" y="300" width="112" height="46" rx="8"/><text class="tx" x="664" y="322">LLM 합성</text><text class="sm" x="664" y="337">→ 답변</text>
  <line class="fl" x1="200" y1="323" x2="216" y2="323" marker-end="url(#arw)"/>
  <line class="fl" x1="330" y1="323" x2="346" y2="323" marker-end="url(#arw)"/>
  <line class="fl" x1="460" y1="323" x2="476" y2="323" marker-end="url(#arw)"/>
  <line class="fl" x1="590" y1="323" x2="606" y2="323" marker-end="url(#arw)"/>
</svg>
<figcaption>그림 1. 세 가지 RAG 파이프라인 비교. Naive는 벡터 검색 1회로 끝나고, Graph는 질문 유형에 따라 지역과 전역 검색을 나누며, Agentic은 도구 선택과 검증, 재검색 루프를 갖는다. 구조 비교의 뼈대는 ByteByteGo의 정리[2]를 참고해 자체 작도했다.</figcaption>
</figure>

## Naive RAG

Naive RAG는 가장 기본적인 형태이며, 흐름이 단순하다. 사용자 질문을 그대로 임베딩한 뒤 벡터 DB에서 코사인 유사도 기준 top-k 문서를 가져오고, 가져온 문서를 프롬프트에 그대로 붙여 언어모델에 "이 문서들을 참고해 답하라"고 요청하면 모델이 답을 한 번에 생성하는 것으로 흐름이 끝난다. 학계에서는 이 두 단계를 검색과 읽기(retrieval-reading)로 부르기도 한다[1].

Naive RAG는 구현이 간단하고 빠르지만, 한계도 뚜렷하다.

- 도구가 하나뿐이다. 질문이 "지금 통계 몇 건인가" 같은 정량 질문이든 "React와 함께 쓰는 기술은 무엇인가" 같은 관계 질문이든 무조건 벡터 검색 한 가지로 처리하는데, 정량 질문에 벡터 검색을 쓰면 숫자가 부정확해질 위험이 크다. 벡터는 의미가 비슷한 텍스트를 찾을 뿐, 정확한 집계를 계산하지 않기 때문이다.
- 검증이 없다. 검색된 문서가 질문에 답하기 충분한지 확인하는 단계가 없어서, 근거가 부족해도 그대로 답을 생성한다. 잘못된 청크를 가져와도 이를 바로잡을 장치가 아예 없다는 뜻이다[3].
- 정밀도와 재현율이 흔들린다. 질문과 표현이 다르면 관련 문서를 놓치거나, 관련 없는 청크가 함께 섞여 들어와 모델을 헷갈리게 한다. 특히 관련 청크가 길게 이어진 근거 뭉치 가운데에 묻히면 모델이 그 부분을 그냥 무시해버리는 현상이 알려져 있는데, 이를 "lost in the middle"이라 부른다[3].
- 문서를 일정 길이로 잘라 저장하는 청킹(chunking) 과정에서 하나의 답이 두 청크에 걸쳐 나뉘어 있으면, 어느 쪽 청크를 가져와도 답의 절반만 담겨 있는 문제가 생긴다[3].
- 관계를 파악하지 못한다. 벡터 검색은 개별 문서 단위로 유사한 것을 찾을 뿐이어서, 엔티티 사이의 구조적 관계(회사의 소재 지역, 소속 산업군 등)를 순회해 답하지 못한다.

## Agentic RAG

Agentic RAG는 Naive RAG에 판단하는 두뇌를 더한 방식으로, 검색을 한 번에 끝내지 않는다. 여기서 에이전트(agent)란 스스로 상황을 판단해서 어떤 행동을 할지 결정하고, 필요하면 도구를 사용하고, 그 결과를 보고 다음 행동을 다시 정하는 프로그램을 가리킨다[4]. Agentic RAG는 이 에이전트가 질문을 분석해 어떤 도구를 쓸지 스스로 선택하고, 검색 결과가 부족하면 재검색하는 루프를 수행한다는 점이 Naive RAG와 다르다.

일반적인 Agentic RAG 흐름은 다음과 같다.

1. 라우터 또는 플래너가 질문을 분석해 의도를 파악하고, 어떤 도구(SQL 조회, 벡터 검색, 그 외 API 등)를 쓸지 계획을 세운다. 질문을 분류해서 알맞은 처리 경로로 보내는 이 패턴을 라우팅(routing)이라 부른다[5].
2. 계획대로 도구를 실행하며, 필요하면 여러 도구를 동시에 실행한다.
3. 평가자(grader)가 확보된 근거가 질문에 답하기 충분한지 점검하고, 부족하면 도구나 검색어를 바꿔 재검색한다. 검색 결과를 평가해서 부족하면 스스로 고쳐 다시 검색하는 이 방식을 Self-RAG 또는 Corrective RAG라 부르며, 이 반성(reflection) 능력이 Agentic RAG를 Naive RAG와 구분 짓는 핵심 특징이다[6][5]. 보통 무한 루프를 막기 위해 재검색 횟수에 제한을 둔다.
4. 충분하다고 판단되면 합성(synthesis) 단계에서 근거를 인용해 최종 답을 생성한다.

이를 아주 단순화한 의사코드로 적으면 다음과 같다.

```
def agentic_rag_answer(question, max_retries=2):
    plan = route(question)              # 라우팅: 어떤 도구를 쓸지 결정
    for attempt in range(max_retries + 1):
        evidence = run_tools(plan)      # 도구 실행: SQL, 벡터, 그래프 등
        if is_sufficient(question, evidence):   # 평가: 근거가 충분한가
            return synthesize(question, evidence)
        plan = rewrite(question, evidence)      # 부족하면 계획을 다시 세운다
    return "충분한 근거를 찾지 못했다"
```

에이전트를 하나만 두고 이 과정 전체를 그 하나가 판단하게 만들 수도 있고, 검색 전담, 평가 전담, 답변 작성 전담처럼 역할을 나눈 여러 에이전트가 서로 결과를 주고받게 만들 수도 있는데, 앞의 구조를 단일 에이전트, 뒤의 구조를 다중 에이전트 Agentic RAG라 부른다[6].

이 방식의 핵심은 질문의 성격에 맞는 도구를 선택하는 것과, 근거가 부족하면 그대로 넘어가지 않고 재검색하는 것 두 가지로 요약된다. 정량 질문은 정확한 계산이 가능한 도구로 보내고 의미 질문은 검색으로 라우팅하며, 검색 결과가 빈약할 때 얼버무리지 않고 재시도하기 때문에 Naive RAG보다 신뢰도 높은 답을 생성한다.

## Graph RAG(local/global)

Graph RAG는 문서들 사이의 관계를 지식그래프로 미리 구축해두는 방식이며, 지식그래프는 엔티티를 노드로, 관계를 엣지로 표현한 구조다. 이 그래프를 순회하거나 요약해 답을 생성하는데, 벡터 검색이 의미가 비슷한 것을 찾는 데 강점이 있다면 Graph RAG는 이것과 저것이 어떻게 연결되어 있는지를 답하는 데 강점이 있다.

이 그래프는 질문이 들어오기 전에 미리 만들어둔다. 원본 문서에서 엔티티와 관계를 추출해서 그래프를 세우고, 그래프 전체를 서로 밀접하게 연결된 노드끼리 묶은 커뮤니티(community)로 계층적으로 나눈 뒤, 각 커뮤니티가 무엇을 담고 있는지 언어모델이 요약한 커뮤니티 리포트까지 미리 생성해둔다[7]. 질문이 들어오면 이렇게 미리 준비해둔 그래프와 리포트를 검색 방식에 따라 다르게 활용한다.

Graph RAG는 검색 방식에 따라 크게 두 가지로 나뉜다.

- Local search(지역 탐색)는 특정 엔티티 하나를 중심으로 그 이웃 노드들로 뻗어나가며(fan-out) 순회하는 방식으로[8], "React를 요구하는 공고와 함께 요구되는 기술은 무엇인가", "이 회사의 소재 지역은 어디인가"처럼 특정 대상에서 출발해 가까운 관계를 정확히 짚는 질문에 강하다.
- Global search(전역 탐색)는 그래프 전체를 앞서 만들어둔 커뮤니티 단위로 쪼갠 뒤, 각 커뮤니티 리포트를 맵리듀스 방식으로 훑어 질문과 관련도가 높은 리포트를 골라 종합해 답하는 방식이다[7][9]. "최근 프론트엔드 채용 시장의 전반적인 분위기는 어떠한가"처럼 개별 사실 하나가 아니라 그래프 전체를 조망해야 답할 수 있는 넓은 질문에 강하다.

정리하면 Local search는 나무 하나를 자세히 살펴보는 방식이고, Global search는 숲 전체를 구역별로 요약해 훑어보는 방식이다. 아래 그림은 이 두 탐색 방식의 차이를 그래프 구조로 보여준다.

<figure class="fig">
<svg viewBox="0 0 720 260" width="100%" style="height:auto;display:block" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Graph RAG의 local search와 global search 비교">
  <defs>
    <marker id="arw3" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L7,3 L0,6 Z" fill="#5b5e66"/>
    </marker>
  </defs>
  <style>
    .tl{font-family:Pretendard,sans-serif;font-size:13px;font-weight:700;fill:#21447c;}
    .sm{font-family:Pretendard,sans-serif;font-size:10.5px;fill:#5b5e66;text-anchor:middle;}
    .rp{font-family:Pretendard,sans-serif;font-size:10px;fill:#21447c;text-anchor:middle;}
    .fin{font-family:Pretendard,sans-serif;font-size:10.5px;fill:#1f7a3d;text-anchor:middle;}
    .nd{fill:#eef2f9;stroke:#21447c;stroke-width:1.4;}
    .ndHi{fill:#fdece3;stroke:#b3441f;stroke-width:1.8;}
    .ndFar{fill:#f1f1f1;stroke:#9a9a9a;stroke-width:1.2;}
    .eHi{stroke:#b3441f;stroke-width:1.8;}
    .eNorm{stroke:#c7ccd6;stroke-width:1.2;}
    .eFar{stroke:#c7ccd6;stroke-width:1.2;stroke-dasharray:3 3;}
    .cl{fill:#f7f3ec;stroke:#8a6a3d;stroke-width:1.2;stroke-dasharray:4 3;}
    .fl{stroke:#5b5e66;stroke-width:1.3;}
    .box{fill:#eef2f9;stroke:#21447c;stroke-width:1.2;}
    .boxFin{fill:#e8f5ec;stroke:#1f7a3d;stroke-width:1.4;}
  </style>
  <text x="20" y="24" class="tl">Local search</text>
  <line class="eHi" x1="170" y1="140" x2="90" y2="90"/>
  <line class="eHi" x1="170" y1="140" x2="250" y2="85"/>
  <line class="eHi" x1="170" y1="140" x2="85" y2="195"/>
  <line class="eHi" x1="170" y1="140" x2="255" y2="195"/>
  <line class="eNorm" x1="90" y1="90" x2="250" y2="85"/>
  <line class="eFar" x1="85" y1="195" x2="30" y2="230"/>
  <circle class="ndHi" cx="170" cy="140" r="22"/>
  <circle class="nd" cx="90" cy="90" r="16"/>
  <circle class="nd" cx="250" cy="85" r="16"/>
  <circle class="nd" cx="85" cy="195" r="16"/>
  <circle class="nd" cx="255" cy="195" r="16"/>
  <circle class="ndFar" cx="30" cy="230" r="13"/>
  <text x="170" y="250" class="sm">질문과 매칭된 엔티티(주황)에서 이웃까지 순회</text>
  <text x="370" y="24" class="tl">Global search</text>
  <rect class="cl" x="370" y="40" width="130" height="70" rx="10"/>
  <rect class="cl" x="370" y="150" width="130" height="70" rx="10"/>
  <line class="eNorm" x1="400" y1="62" x2="432" y2="80"/>
  <line class="eNorm" x1="432" y1="80" x2="464" y2="62"/>
  <line class="eNorm" x1="400" y1="172" x2="432" y2="190"/>
  <line class="eNorm" x1="432" y1="190" x2="464" y2="172"/>
  <circle class="nd" cx="400" cy="62" r="12"/>
  <circle class="nd" cx="432" cy="80" r="12"/>
  <circle class="nd" cx="464" cy="62" r="12"/>
  <circle class="nd" cx="400" cy="172" r="12"/>
  <circle class="nd" cx="432" cy="190" r="12"/>
  <circle class="nd" cx="464" cy="172" r="12"/>
  <rect class="box" x="530" y="48" width="90" height="28" rx="6"/><text class="rp" x="575" y="66">요약 리포트</text>
  <rect class="box" x="530" y="158" width="90" height="28" rx="6"/><text class="rp" x="575" y="176">요약 리포트</text>
  <line class="fl" x1="500" y1="62" x2="527" y2="62" marker-end="url(#arw3)"/>
  <line class="fl" x1="500" y1="172" x2="527" y2="172" marker-end="url(#arw3)"/>
  <rect class="boxFin" x="650" y="95" width="55" height="60" rx="8"/><text class="fin" x="677" y="120">답변</text><text class="fin" x="677" y="136">합성</text>
  <line class="fl" x1="620" y1="62" x2="648" y2="108" marker-end="url(#arw3)"/>
  <line class="fl" x1="620" y1="172" x2="648" y2="140" marker-end="url(#arw3)"/>
  <text x="530" y="250" class="sm">커뮤니티 리포트를 종합해 전체 답을 만든다</text>
</svg>
<figcaption>그림 2. Local search는 질문과 매칭된 엔티티(주황 원)에서 이웃 노드로 뻗어나가며 순회한다. 점선으로 이어진 먼 노드는 순회 범위 밖이다. Global search는 그래프를 커뮤니티(점선 사각형)로 나눠 미리 요약해둔 리포트를 모아 종합한다.</figcaption>
</figure>

Graph RAG는 이 그래프와 커뮤니티 리포트를 미리 구축해야 하므로 색인 단계의 비용과 시간이 Naive RAG나 Agentic RAG보다 훨씬 크고, 원본 데이터가 바뀔 때마다 그래프를 다시 세우거나 갱신해야 한다는 부담이 있다. 다만 그 대가로 엔티티 사이의 관계를 정확하게 짚어내고, 그래프 전체를 조망하는 질문에도 답할 수 있다는 점에서 벡터 검색만으로는 다루기 어려운 영역을 커버한다.

## 세 가지 비교

| 구분 | Naive RAG | Agentic RAG | Graph RAG |
|---|---|---|---|
| 검색 방식 | 벡터 검색 1회 | 라우터가 도구 선택 + 평가 후 재검색 | 그래프 순회(local) / 커뮤니티 요약(global) |
| 강점 | 구현이 단순, 빠름 | 질문 성격에 맞는 도구 선택, 근거 부족 시 재시도 | 엔티티 간 관계, 구조적 질문에 정확 |
| 약점 | 정량, 관계 질문에 취약, 검증 없음 | 그래프형 관계 질문은 여전히 못 다룸 | 그래프 구축, 유지 비용 부담, 단독으로는 정량 계산 불가 |
| 적합한 질문 예 | "이런 내용의 문서를 찾아달라" | "지금 상황을 종합해서 정리해달라"(도구 여러 개 필요) | "A와 함께 자주 나오는 것은 무엇인가", "최근 이 분야 전반 분위기는 어떠한가" |
| 정직성 리스크 | 근거가 부족해도 답을 지어낼 수 있음 | 평가자가 부족함을 감지해 재검색/모름 처리 가능 | 관계는 정확하나 정량 집계는 별도 보강 필요 |

## 상황별 선택 기준

세 방식은 우열 관계가 아니라 트레이드오프 관계이며, 이 트레이드오프를 정리하면 다음과 같다[2].

- Naive RAG는 답이 문서 안에 있고 속도가 중요할 때 적합하다. 빠르고 저렴하지만, 잘못된 청크를 가져와도 바로잡을 장치가 없다는 것이 근본 약점이다.
- Graph RAG는 법률, 컴플라이언스, 바이오처럼 지식이 구조적으로 얽혀 있을 때 적합하다. 구축과 갱신 비용이 크고 느리지만, 엔티티 사이의 관계를 정확히 다룬다.
- Agentic RAG는 다단계 추론과 자기교정이 필요할 때 적합하다. 가장 유연하고 강력하지만, 느리고 비싸며 디버깅이 어렵다.

여기서 얻는 교훈은 두 가지다. 첫째, 방식 선택은 질문의 성격이 결정한다는 것이고, 둘째, 강력한 방식일수록 대가가 따른다는 것이다. 비용, 지연, 디버깅 난이도가 함께 늘어나므로 필요 이상으로 무거운 방식을 남용하면 안 된다. 이 트레이드오프를 우리 서비스의 질문 분포에 대입한 결과가 다음 문서에서 다룰 하이브리드 설계다.

## 우리의 선택

이 시스템은 세 가지 중 하나만 선택하지 않고, Agentic RAG의 도구 선택과 검증 구조 위에 도구 하나로 Graph RAG(local/global)를 결합한 하이브리드를 채택했다. 그 이유와 구체적인 구조는 다음 문서인 `04-our-architecture.md`에서 설명한다.

## 참고 자료

1. [Retrieval-Augmented Generation for Large Language Models: A Survey](https://arxiv.org/abs/2312.10997)
2. [ByteByteGo, EP220: RAG vs Graph RAG vs Agentic RAG](https://blog.bytebytego.com/p/ep220-rag-vs-graph-rag-vs-agentic)
3. [Naive RAG: Why It Fails and How to Fix It](https://unstructured.io/blog/level-up-your-genai-apps-rag-beyond-the-basics)
4. [What is Agentic RAG?](https://www.ibm.com/think/topics/agentic-rag)
5. [Self-Reflective RAG with LangGraph](https://blog.langchain.com/agentic-rag-with-langgraph/)
6. [Agentic Retrieval-Augmented Generation: A Survey on Agentic RAG](https://arxiv.org/abs/2501.09136)
7. [GraphRAG: Query-time overview](https://microsoft.github.io/graphrag/query/overview/)
8. [From Local to Global: A Graph RAG Approach to Query-Focused Summarization](https://www.microsoft.com/en-us/research/publication/from-local-to-global-a-graph-rag-approach-to-query-focused-summarization/)
9. [GraphRAG: Improving global search via dynamic community selection](https://www.microsoft.com/en-us/research/blog/graphrag-improving-global-search-via-dynamic-community-selection/)
