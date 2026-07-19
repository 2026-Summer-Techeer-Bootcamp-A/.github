# RAG의 최전선. 검색을 넘어, LLM이 지식을 직접 관리한다

## 개요

앞선 문서들이 다룬 RAG는 모두 질문이 들어오면 그때 문서를 검색한다는(retrieval at query time) 공통 전제 위에 서 있었다. 이 문서에서는 그 전제를 뒤집는 최근의 접근을 다루는데, LLM이 지식베이스를 미리 직접 작성하고 유지하면서 질문에는 그렇게 정제된 위키를 참조해 답하는 방식이다. Andrej Karpathy가 제시한 "LLM-Wiki" 패턴이 이를 대표하며, 흥미롭게도 이 패턴은 우리 `rag-development` 문서 체계 자체가 닮아 있는 구조이기도 하다. 그래서 이 문서에서는 개념을 정리한 뒤 우리 작업과의 관계를 짚어보기로 한다. 공고, 집계, 리포트 같은 용어의 바탕은 `00-orientation.md`와 `04-our-architecture.md`에 있다.

## 검색형 RAG의 한계

검색형 RAG는 매 질문마다 원문 청크를 새로 꺼내 오는 구조라서, 여기에는 몇 가지 구조적 비효율이 따라붙는다. 우선 같은 주제를 열 번 물으면 열 번 모두 원문에서 관련 청크를 긁어 즉석에서 종합하게 되므로, 지식이 쌓이지 않고 매번 처음부터 다시 종합하는 셈이 된다. 게다가 서로 어긋나는 두 문서가 있어도 검색은 그저 유사한 청크를 반환할 뿐이어서, 이 둘이 충돌한다는 사실 자체를 알려주지 못한다. 문서와 문서 사이의 연관, 예컨대 이 개념이 저 사건의 원인이라는 관계 같은 것도 청크 단위 검색에서는 잘 드러나지 않아 그대로 사라지고 만다.

## LLM-Wiki 패턴

Karpathy가 제안하는 것은 검색이 아니라 **점진적 종합**이다(incremental synthesis). 새 자료가 들어오면 LLM이 그것을 읽고 요점을 추출해 기존 위키 페이지에 통합하며, 그 과정에서 교차 참조를 갱신하고 모순이 있으면 표시해 둔다. 그 결과 위키는 자료가 쌓일수록 오히려 더 풍부해지는, 이른바 "살아 있는 종합"이 되어간다. 이 패턴의 핵심 통찰은 다음 한 문장으로 요약된다.

> 지식베이스를 유지하는 일에서 정작 고된 부분은 읽기나 사고가 아니라 **북키핑**이다(bookkeeping). LLM은 지치지 않고 교차 참조와 일관성 관리를 대신 수행해 주므로, 사람들이 포기하곤 했던 위키 유지의 비용이 거의 0에 가깝게 낮아진다.

이 패턴은 세 계층으로 구성된다.

<figure class="fig">
<svg viewBox="0 0 720 316" width="100%" style="height:auto;display:block" preserveAspectRatio="xMidYMid meet" role="img" aria-label="LLM-Wiki 3계층 아키텍처">
  <defs>
    <marker id="w-arw" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L7,3 L0,6 Z" fill="#5b5e66"/>
    </marker>
  </defs>
  <style>
    .wbx{fill:#eef2f9;stroke:#21447c;stroke-width:1.4;}
    .wtl{font-family:Pretendard,sans-serif;font-size:12px;font-weight:700;fill:#21447c;}
    .wtx{font-family:Pretendard,sans-serif;font-size:11.5px;fill:#1a1c20;text-anchor:middle;}
    .wsm{font-family:Pretendard,sans-serif;font-size:10px;fill:#5b5e66;text-anchor:middle;}
    .wfl{stroke:#5b5e66;stroke-width:1.3;fill:none;}
  </style>
  <!-- Schema (top) -->
  <text x="8" y="30" class="wtl">스키마</text>
  <rect class="wbx" x="150" y="16" width="470" height="40" rx="8" fill="#f7f8fa"/>
  <text class="wtx" x="385" y="34">스키마 (CLAUDE.md 등)</text>
  <text class="wsm" x="385" y="49">위키 구조, 명명 규칙, 인제스트/쿼리/린트 워크플로 정의</text>
  <!-- Wiki (middle) -->
  <text x="8" y="140" class="wtl">위키</text>
  <rect class="wbx" x="150" y="112" width="110" height="46" rx="8"/><text class="wtx" x="205" y="140">요약</text>
  <rect class="wbx" x="272" y="112" width="110" height="46" rx="8"/><text class="wtx" x="327" y="134">엔티티</text><text class="wsm" x="327" y="149">페이지</text>
  <rect class="wbx" x="394" y="112" width="110" height="46" rx="8"/><text class="wtx" x="449" y="134">개념</text><text class="wsm" x="449" y="149">페이지</text>
  <rect class="wbx" x="516" y="112" width="104" height="46" rx="8"/><text class="wtx" x="568" y="134">index</text><text class="wsm" x="568" y="149">/ log</text>
  <!-- Raw (bottom) -->
  <text x="8" y="252" class="wtl">원문 소스</text>
  <rect class="wbx" x="150" y="238" width="140" height="40" rx="8" fill="#fbfbfa"/><text class="wtx" x="220" y="263">기사</text>
  <rect class="wbx" x="302" y="238" width="140" height="40" rx="8" fill="#fbfbfa"/><text class="wtx" x="372" y="263">논문</text>
  <rect class="wbx" x="454" y="238" width="166" height="40" rx="8" fill="#fbfbfa"/><text class="wtx" x="537" y="263">데이터 (불변)</text>
  <!-- flows -->
  <path class="wfl" d="M300,238 C320,205 360,190 380,160" marker-end="url(#w-arw)" stroke-dasharray="0"/>
  <text class="wsm" x="270" y="205" text-anchor="start">인제스트: 읽고 통합</text>
  <path class="wfl" d="M385,56 L385,110" marker-end="url(#w-arw)" stroke-dasharray="4 3"/>
  <text class="wsm" x="393" y="86" text-anchor="start">규칙 적용</text>
  <path class="wfl" d="M628,120 C672,128 672,150 632,156" marker-end="url(#w-arw)"/>
  <text class="wsm" x="648" y="142" text-anchor="start">쿼리, 린트</text>
</svg>
<figcaption>그림 1. LLM-Wiki 3계층. 불변의 <b>원문 소스</b>를 LLM이 인제스트해 <b>위키</b>(요약, 엔티티, 개념, index/log)로 종합하고, <b>스키마</b>가 그 구조와 규칙을 규정한다. 작도는 <b>Karpathy의 LLM-Wiki gist</b>를 참고했다.</figcaption>
</figure>

세 계층은 각각 역할이 뚜렷이 나뉜다. **원문 소스**는 기사, 논문, 데이터 등 변경하지 않는 진실의 원천으로, 위키의 내용이 틀렸다고 판단될 때는 언제나 이곳으로 되돌아가 대조하게 된다. **위키**는 LLM이 생성하고 유지하는 마크다운 페이지들로 이루어지는데, 요약과 엔티티 페이지, 개념 페이지, 그리고 탐색을 돕는 `index.md`(내용 목록)와 `log.md`(인제스트, 쿼리, 린트의 시간순 기록)로 구성된다. **스키마**는 위키의 구조와 규칙, 작업 절차를 LLM에게 알려주는 설정 문서로, 위키가 일관된 형태를 유지하도록 기준을 제공한다.

주요 작업은 인제스트, 쿼리, 린트 세 가지로 나뉜다. 인제스트는 새 소스를 읽고 한 번에 10~15개 페이지를 갱신하는 작업이고, 쿼리는 관련 페이지를 찾아 인용과 함께 답한 뒤 그 과정에서 얻은 가치 있는 발견을 다시 위키에 반영하는 작업이며, 린트는 모순, 고아 페이지, 오래된 주장, 누락된 교차 참조를 점검하는 작업이다. 이 패턴은 Vannevar Bush가 1945년에 구상한 Memex를 정신적 선조로 삼는데, 문서 간의 연상적 연결을 갖춘 개인의 정제된 지식 저장소라는 발상이 그 뿌리에 있다.

## 우리 작업과의 관계

이 패턴을 지금 당장 도입하려는 것은 아니지만, 두 가지 이유에서 기록해 둘 가치가 있다.

첫째, **우리 `rag-development` 문서 체계 자체가 이미 LLM-Wiki의 축소판**에 해당한다. 채팅에서 결정한 내용을 개념서(`rag-learning/`)와 구현기(`rag-build-journal/`)로 종합하고, 뷰어의 목차가 `index` 역할을 하며, 자료가 들어올 때마다(이 문서가 바로 그 예다) 관련 페이지를 갱신해 나간다. 결국 북키핑을 LLM이 대신한다는 발상을 우리는 이미 실천하고 있는 셈이다.

둘째, 우리 RAG 아키텍처의 "A+" 원칙과도 철학이 통한다. 우리는 원본 공고 텍스트를 통째로 임베딩하지 않고 집계, 요약, 리포트 단위만 임베딩하기로 결정했는데(`04-our-architecture.md`), 이는 검색 결과가 항상 정제된 근거가 되도록 한다는 뜻이다. LLM-Wiki가 원문 대신 정제된 위키를 참조하는 방향과 같은 지향이며, 커뮤니티 리포트를 미리 생성해 두는 Graph RAG의 global search 역시 질의 시점이 아니라 사전에 종합해 둔다는 점에서 이 패턴과 맞닿아 있다.

정리하면 LLM-Wiki는 검색이냐 종합이냐라는 축에서 RAG의 다음 단계를 보여주는 참조점이고, 우리는 정제된 단위 임베딩, 사전 종합 리포트, 문서 자동 종합이라는 형태로 이미 그 지향의 일부를 채택하고 있다.

## 참고 자료

각 자료가 무엇이고 현재 어떻게 다뤄지고 있는지를 함께 적는다.

| 자료 | 무엇인가 | 현재 상태 |
|---|---|---|
| **ByteByteGo, EP220 "RAG vs Graph RAG vs Agentic RAG"** | 세 RAG 방식의 파이프라인, 강약점, 적합 상황을 비교한 인포그래픽 | 반영 완료. `03-rag-types.md` 그림 1, "언제 무엇을 쓰는가", `04-our-architecture.md` 선택 매트릭스의 근거 |
| **Andrej Karpathy, LLM-Wiki gist** | LLM이 위키를 직접 작성하고 유지하는 영속적 지식베이스 방법론(3계층, 인제스트/쿼리/린트) | 반영 완료. 이 문서(04) 본문과 그림 1의 근거 |
| **GeekNews(hada.io) topic 28208** | 위 Karpathy gist의 한국어 소개글 | 반영 완료. 국문 개념 확인 보조 자료로 참고 |
| **YouTube @sv.developer (에이전틱 AI)** | 에이전틱 AI 개념을 다루는 채널 | 참조 포인터. 특정 영상이 지정되지 않아 본문 미반영. 에이전틱 RAG 심화 학습 시 특정 회차를 골라 반영 예정 |
| **YouTube @the.brain.trinity (LLM 위키: 옵시디언)** | 옵시디언 기반으로 LLM 위키를 구축하는 실전 채널 | 참조 포인터. LLM-Wiki 패턴의 실제 응용 사례로 기록. 도구 도입을 검토할 때 참고 예정 |

유튜브 채널 두 곳은 특정 영상 URL이 아니라 채널 전체 링크이므로, 개별 주장으로 인용하기보다는 학습 경로의 방향 표지로 남겨 둔다. 나중에 특정 회차를 지정하게 되면 그 내용을 개념서와 구현기에 반영할 예정이다.
