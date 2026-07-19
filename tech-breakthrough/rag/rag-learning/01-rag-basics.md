# RAG 기초. 검색으로 근거를 만든 다음에 답한다

## 개요

이 문서는 RAG(Retrieval-Augmented Generation)를 처음 접하는 완전 초보자를 위한 입문 문서다. 언어모델이 무엇이고 왜 그럴듯한 거짓말을 지어내는지부터 시작해서, 검색을 붙여 근거를 주는 것이 왜 RAG라는 이름으로 불리는지, 모델을 다시 학습시키는 파인튜닝과는 어떻게 다른지, 그리고 언제 RAG를 쓰는 것이 유리한지를 순서대로 다룬다. 마지막에는 이 프로젝트에서 RAG가 차지하는 위치를 정리한다.

이 문서는 공고, 점수화, 서비스 데이터 같은 프로젝트 용어를 설명 없이 쓰는데, 그 바닥은 `00-orientation.md`에 이미 정리해두었다. 프로젝트와 데이터 구조가 낯설다면 그 문서를 먼저 읽는다.

## LLM의 정의와 할루시네이션 원인

RAG를 이해하려면 먼저 그 재료가 되는 대규모 언어모델(LLM, Large Language Model)이 어떻게 동작하는지 알아야 한다. LLM은 인터넷에 있는 방대한 양의 글을 학습해서, 어떤 문장이 주어졌을 때 그다음에 올 단어 조각인 토큰을 확률적으로 예측하도록 훈련된 프로그램이다. 질문에 답할 때도 모델은 사실 여부를 확인하는 별도의 검증 절차를 거치지 않고, 학습 과정에서 익힌 통계적 패턴을 바탕으로 가장 자연스럽게 이어질 것 같은 단어를 하나씩 골라 이어붙여 문장을 완성한다[1].

이 방식은 대부분의 상황에서 매끄럽고 사람이 쓴 것 같은 문장을 만들어내지만, 부작용도 함께 따라온다. 모델의 학습 목표가 처음부터 사실을 정확히 진술하는 것이 아니라 다음 토큰을 그럴듯하게 잇는 것이었기 때문에, 정확성과 그럴듯함이 어긋나는 순간에는 그럴듯함이 이긴다. 그 결과 모델이 답을 실제로 알지 못하는 질문에서도 마치 알고 있는 것처럼 자연스러운 문장을 지어내는 현상이 나타나는데, 이를 할루시네이션(hallucination)이라고 부른다[1]. 여기에 더해 사람이 선호하는 답을 학습시키는 후속 훈련 과정에서 "모른다"고 답하는 모델보다 확신에 차서 답하는 모델이 더 좋은 평가를 받는 경향이 있고, 이 경향이 모델이 모르는 내용조차 자신 있는 어조로 지어내도록 강화하는 요인이 되기도 한다[1].

정리하면 LLM은 기억을 조회하는 기계가 아니라 다음 단어를 예측하는 기계이고, 이 근본적인 동작 방식 때문에 모르는 것을 모른다고 인정하기보다 그럴듯한 답을 지어내는 쪽으로 기울어져 있다. RAG는 바로 이 지점을 겨냥해서 설계된 방식이다.

## RAG의 정의

RAG는 "Retrieval-Augmented Generation", 즉 검색으로 보강한 생성을 의미하며, 대규모 언어모델의 답변이 학습 데이터가 아닌 신뢰할 수 있는 외부 지식 기반을 참조하도록 최적화하는 절차다[2]. 이 정의를 처음 제시한 2020년 논문은 언어모델의 지식을 두 종류로 나누어 설명하는데, 모델의 가중치 안에 저장되어 학습이 끝나면 고정되는 지식을 파라메트릭(parametric) 메모리라 부르고, 모델 바깥의 문서 저장소에 있어서 언제든 갱신할 수 있는 지식을 논파라메트릭(non-parametric) 메모리라 부른다[3][4]. RAG는 이 두 메모리를 결합해서, 모델의 생성 능력은 그대로 유지한 채 답을 만드는 시점마다 최신 정보를 외부에서 조회해 덧붙이는 구조를 만든다.

이 이름은 그대로 동작 순서를 가리킨다.

1. **Retrieve(검색)**: 사용자의 질문과 관련된 자료를 보유 데이터(DB, 문서, 그래프 등)에서 찾아온다.
2. **Augment(보강)**: 찾아온 자료를 질문과 함께 프롬프트에 결합해서, 모델이 참고할 근거를 명시적으로 만들어준다.
3. **Generate(생성)**: 보강된 프롬프트를 언어모델에 전달해서, 그 근거를 바탕으로 답을 생성한다.

핵심은 이 순서에 있다. 언어모델은 먼저 생각하고 답하는 것이 아니라 먼저 찾고, 찾은 것 안에서만 답한다. 다시 말해 언어모델이 파라미터 지식만으로 답을 즉석에서 구성하게 두지 않고, 검색으로 확보한 근거 문서 범위 안에서만 답을 구성하도록 강제하는 방식이다.

> 오픈북 시험에 비유할 수 있다. RAG가 없는 언어모델은 책을 덮고 기억나는 대로 쓰는 학생이고, RAG를 쓰는 언어모델은 문제를 보자마자 관련 페이지를 펼쳐 그 내용만 인용해서 쓰는 학생이다. 후자는 책에 없는 내용을 답으로 쓸 이유가 없고, 책이 바뀌면 곧바로 그 내용을 답에 반영할 수 있다.

아래 그림은 이 차이를 흐름으로 보여준다. 위쪽은 질문을 검증 없이 곧바로 모델에 넣는 방식이고, 아래쪽은 질문과 답 사이에 검색과 근거 결합 단계를 끼워 넣은 RAG의 흐름이다.

<figure class="fig">
<svg viewBox="0 0 760 230" width="100%" style="height:auto;display:block" preserveAspectRatio="xMidYMid meet" role="img" aria-label="AI API만 호출하는 방식과 RAG 방식의 비교">
  <defs>
    <marker id="arw2" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L7,3 L0,6 Z" fill="#5b5e66"/>
    </marker>
  </defs>
  <style>
    .bx{fill:#eef2f9;stroke:#21447c;stroke-width:1.4;}
    .bxWarn{fill:#fdece3;stroke:#b3441f;stroke-width:1.4;}
    .bxGood{fill:#e8f5ec;stroke:#1f7a3d;stroke-width:1.4;}
    .tl{font-family:Pretendard,sans-serif;font-size:13px;font-weight:700;fill:#21447c;}
    .tx{font-family:Pretendard,sans-serif;font-size:11.5px;fill:#1a1c20;text-anchor:middle;}
    .sm{font-family:Pretendard,sans-serif;font-size:10px;fill:#5b5e66;text-anchor:middle;}
    .warn{font-family:Pretendard,sans-serif;font-size:10px;fill:#8a3b12;text-anchor:middle;}
    .good{font-family:Pretendard,sans-serif;font-size:10px;fill:#1f7a3d;text-anchor:middle;}
    .fl{stroke:#5b5e66;stroke-width:1.3;}
  </style>
  <text x="8" y="24" class="tl">AI API만 그대로 호출</text>
  <rect class="bx" x="40" y="40" width="120" height="46" rx="8"/><text class="tx" x="100" y="68">질문</text>
  <rect class="bx" x="320" y="40" width="120" height="46" rx="8"/><text class="tx" x="380" y="68">LLM</text>
  <rect class="bxWarn" x="600" y="40" width="120" height="46" rx="8"/><text class="tx" x="660" y="63">답변</text><text class="warn" x="660" y="78">근거 없이 추측</text>
  <line class="fl" x1="160" y1="63" x2="316" y2="63" marker-end="url(#arw2)"/>
  <line class="fl" x1="440" y1="63" x2="596" y2="63" marker-end="url(#arw2)"/>
  <text x="8" y="140" class="tl">RAG: Retrieve → Augment → Generate</text>
  <rect class="bx" x="40" y="156" width="120" height="46" rx="8"/><text class="tx" x="100" y="184">질문</text>
  <rect class="bx" x="180" y="156" width="120" height="46" rx="8"/><text class="tx" x="240" y="178">검색</text><text class="sm" x="240" y="193">retrieve</text>
  <rect class="bx" x="320" y="156" width="120" height="46" rx="8"/><text class="tx" x="380" y="178">근거 결합</text><text class="sm" x="380" y="193">augment</text>
  <rect class="bx" x="460" y="156" width="120" height="46" rx="8"/><text class="tx" x="520" y="178">LLM</text><text class="sm" x="520" y="193">generate</text>
  <rect class="bxGood" x="600" y="156" width="120" height="46" rx="8"/><text class="tx" x="660" y="179">답변</text><text class="good" x="660" y="194">근거를 인용</text>
  <line class="fl" x1="160" y1="179" x2="176" y2="179" marker-end="url(#arw2)"/>
  <line class="fl" x1="300" y1="179" x2="316" y2="179" marker-end="url(#arw2)"/>
  <line class="fl" x1="440" y1="179" x2="456" y2="179" marker-end="url(#arw2)"/>
  <line class="fl" x1="580" y1="179" x2="596" y2="179" marker-end="url(#arw2)"/>
</svg>
<figcaption>그림 1. AI API를 그대로 호출하는 방식은 질문을 바로 LLM에 넣어 근거 없는 추측성 답을 얻는다. RAG는 질문과 답변 사이에 검색과 근거 결합 단계를 넣어, LLM이 실제 문서를 인용해 답하도록 만든다.</figcaption>
</figure>

이 흐름을 아주 단순화한 의사코드로 적으면 다음과 같다. 실제 구현은 검색 대상과 프롬프트 구성 방식에 따라 훨씬 복잡해지지만, 뼈대는 항상 이 세 단계를 벗어나지 않는다.

```
def rag_answer(question):
    documents = retrieve(question, top_k=5)   # 검색: 관련 문서를 찾아온다
    prompt = augment(question, documents)      # 보강: 질문과 근거를 결합한다
    answer = generate(prompt)                  # 생성: 근거를 바탕으로 답한다
    return answer
```

## RAG vs "AI API만 떼다 쓰기"

가장 단순한 형태의 AI 기능은 사용자의 질문을 그대로 언어모델 API에 전달하고 반환된 답을 그대로 노출하는 방식인데, 이는 RAG가 아니며 앞서 설명한 문제를 그대로 안고 있다.

- 언어모델은 서비스 고유 데이터(공고, 통계, 사용자 정보)를 전혀 알지 못하고, 학습 시점에 습득한 일반 지식만 보유한다.
- 그 결과 서비스 관련 질문에 대해 모델이 답을 알지 못함에도 그럴듯하게 지어낼 위험이 크다.
- 데이터가 매일 갱신되어도(새 공고 게시, 통계 갱신) 모델의 지식은 고정되어 있어서, 재학습 없이는 최신 정보를 반영할 방법이 없다.

RAG는 이 문제를 모델을 재학습시키는 대신, 질문이 들어올 때마다 최신 데이터를 검색해 모델에 전달하는 방식으로 해결한다. 모델의 파라미터(가중치)는 고정한 채 답을 생성하는 시점에 필요한 근거만 주입하는 구조이며, 그래서 데이터가 변경되어도 재학습이 필요 없고 모델이 원래 알지 못하는 서비스 데이터에 대해서도 정확한 답변이 가능해진다.

정리하면, "AI API만 떼다 쓰기"는 질문을 모델에 그대로 전달하는 방식이고 RAG는 질문에 답하기 전에 데이터에서 근거를 먼저 확보해 모델에 전달하는 방식인데, 이 한 단계 차이가 답변의 신뢰도를 결정한다.

## RAG vs 파인튜닝의 차이

RAG와 자주 비교되는 또 다른 접근이 파인튜닝(fine-tuning)이다. 파인튜닝은 특정 도메인의 데이터로 모델을 추가 학습시켜서 모델 내부의 가중치 자체를 바꾸는 방식이다. 반면 RAG는 모델의 가중치를 전혀 건드리지 않고, 답을 생성하는 순간에 참고할 자료를 프롬프트에 얹어주는 방식이다. 비유하자면 파인튜닝은 학생을 다시 가르쳐서 사고방식과 말투 자체를 바꾸는 것이고, RAG는 시험장에 참고 자료를 들고 들어가게 해주는 것이다[5].

이 차이 때문에 두 방식은 잘하는 영역이 다르다.

- **RAG가 유리한 경우**: 정보가 자주 바뀌거나, 출처를 밝혀야 하거나, 사용자마다 접근 가능한 데이터가 다른 경우다. 새로운 문서를 색인에 추가하기만 하면 곧바로 반영되고, 답변에 근거 문서를 인용할 수 있어서 검증이 쉽다[5].
- **파인튜닝이 유리한 경우**: 모델이 답하는 방식이나 말투, 형식을 일관되게 바꾸고 싶거나, 분류나 정형 추출처럼 좁고 반복적인 작업을 대량으로 처리해야 하는 경우다. 다만 품질이 좋은 학습 데이터를 충분히 확보해야 하고, 도메인 지식이 바뀔 때마다 다시 학습시켜야 하는 비용이 든다[5].

실무에서는 이 둘을 배타적으로 고르지 않고 함께 쓰는 경우가 많다. 답변의 말투나 형식은 파인튜닝으로 다듬고, 답변에 들어갈 사실은 RAG로 그때그때 조회해서 근거를 붙이는 식이다[5]. 이 프로젝트는 서비스 데이터가 매일 갱신되고 답변마다 근거 인용이 중요하다는 점에서 RAG 쪽에 무게가 실리는 상황이며, 그래서 파인튜닝 대신 RAG를 핵심 접근으로 채택했다.

## 필요성: 할루시네이션과 최신성

지금까지 다룬 내용을 종합하면, RAG가 해결하는 문제는 크게 두 가지로 압축된다.

**할루시네이션(hallucination)**. 앞서 설명했듯 언어모델은 모르는 질문에도 "모른다"고 답하기보다 그럴듯한 문장을 생성하는 경향을 보인다. 특히 숫자나 통계처럼 정확성이 중요한 질문에서는 이 경향이 위험 요소가 되는데, "이 지역 채용 공고가 몇 건인가"라는 질문에 실제 DB를 조회하지 않고 답하면 그럴듯하지만 틀린 숫자가 나올 수 있기 때문이다. RAG는 답변을 생성하기 전에 실제 데이터 검색을 강제함으로써 이런 근거 없는 답변을 원천적으로 줄인다.

**최신성(freshness)**. 언어모델은 학습이 종료된 시점의 지식만 보유하기 때문에, 채용 공고가 매일 게시되고 통계가 지속적으로 갱신되는 도메인에서는 모델의 성능과 무관하게 어제 새로 올라온 공고를 알 방법이 없다. RAG는 질문이 들어올 때마다 그 시점의 최신 데이터를 검색하므로, 모델을 매번 재학습시키지 않고도 항상 최신 정보로 답할 수 있다.

이 두 문제를 종합하면 다음 원칙이 도출된다.

> 답은 검색으로 찾은 근거 안에서만 만들어져야 하며, 근거에 없는 값은 생성하지 않는다.

이는 이 프로젝트 전체를 관통하는 정직성 원칙이기도 한데, 개수, 순위, 비율 같은 정량적인 질문은 벡터 검색이나 그래프가 아니라 반드시 결정론적인 SQL로 답하도록 하고, 검색으로 충분한 근거를 확보하지 못하면 "모른다" 또는 "데이터가 부족하다"고 정직하게 답하도록 한다. 이 원칙이 실제로 어떻게 구현되는지는 `02`부터 `04` 문서에서 반복적으로 다룬다.

## RAG의 다양한 방식

여기까지는 RAG를 가장 단순한 형태로만 설명했지만, 실제로는 검색과 생성을 어떻게 조합하느냐에 따라 여러 방식으로 나뉜다. 질문을 임베딩해서 벡터 데이터베이스에서 상위 몇 개 문서만 가져와 곧바로 답을 생성하는 가장 기본적인 형태를 Naive RAG라 부르고, 여기에 데이터 전처리 개선, 검증 단계, 반복 검색 같은 장치를 더한 형태를 Advanced RAG 또는 Modular RAG라 부른다[6]. 더 나아가 에이전트가 질문의 성격에 맞는 도구를 스스로 고르고 근거가 부족하면 재검색하는 Agentic RAG, 문서 사이의 관계를 그래프로 미리 구축해두고 그 그래프를 순회하며 답하는 Graph RAG도 있다. 이 각각의 방식이 정확히 무엇이고 언제 쓰는 것이 적합한지는 `03-rag-types.md`에서 자세히 다룬다.

## 우리 프로젝트에서의 위치

이 프로젝트에서 AI/RAG 기능은 부가기능(bonus feature)이다. 채용 정보를 점수화해서 보여주는 핵심 기능이 별도로 존재하고 RAG 챗봇은 그 위에 얹히는 부가 기능이지만, 그렇다고 이 부가기능을 질문을 벡터 검색 한 번 돌려 상위 결과를 모델에 붙이는 수준으로 나이브하게 구현하지 않고 진지하게 설계했다.

이유는 두 가지다.

1. **"AI API만 떼다 쓴 게 아니다"를 증명한다.** 단순히 API를 호출해 그럴듯한 답을 내는 구현은 반나절이면 가능하지만, 이 시스템은 질문의 성격에 따라 SQL, 벡터 검색, 지식그래프 중 적절한 도구를 선택하도록 만들었다. 답이 충분한 근거를 갖췄는지 스스로 검증한 뒤 부족하면 재검색하는 구조인 Agentic RAG와, 채용 데이터 내 관계(기술 동시 요구, 회사와 지역의 관계 등)를 그래프로 순회해 답하는 구조인 Graph RAG를 함께 사용하는데, 이 설계는 `03-rag-types.md`와 `04-our-architecture.md`에서 자세히 다룬다.
2. **부가기능에서도 정직성을 지킨다.** 부가기능이라는 이유로 근거 없는 답변을 허용하면 서비스 전체의 신뢰가 훼손되기 때문에, 이 RAG 시스템도 근거 인용 필수, 정량은 SQL, 모르면 모른다고 답하기라는 본 기능과 동일한 원칙을 지키도록 설계했다.

이어지는 문서들은 이 원칙이 구체적으로 어떤 기술(임베딩, 벡터 DB, 지식그래프, 에이전트 파이프라인)로 구현되는지 순서대로 설명한다.

## 참고 자료

1. [Hallucinations in LLMs Are Not a Bug in the Data](https://towardsdatascience.com/hallucinations-in-llms-are-not-a-bug-in-the-data/)
2. [What is RAG? Retrieval-Augmented Generation AI Explained](https://aws.amazon.com/what-is/retrieval-augmented-generation/)
3. [Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks](https://arxiv.org/abs/2005.11401)
4. [Retrieval-augmented generation](https://en.wikipedia.org/wiki/Retrieval-augmented_generation)
5. [RAG vs. Fine-tuning vs. Prompt Engineering: The Complete Guide to AI Optimization](https://www.news.aakashg.com/p/rag-vs-fine-tuning-vs-prompt-engineering)
6. [Retrieval-Augmented Generation for Large Language Models: A Survey](https://arxiv.org/abs/2312.10997)
