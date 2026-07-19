# 결정론적 도구와 LLM 합성을 분리한 Agentic RAG 및 정직성 설계

**일정**: 2026-07-14  
**요약**: 결정론적 도구 실행과 LLM 합성을 분리한 Agentic RAG의 설계 철학과 정직성 설계, 런타임 제약 극복 과정을 정리했다.  

## 도입 배경 및 설계 철학

전형적인 검색 증강 생성 아키텍처인 RAG는 사용자 질문에 관련된 문서를 단순 검색하여 거대 언어 모델의 프롬프트[^10] 컨텍스트[^11]에 입력한다. 이 방식은 두 가지 구조적 결함을 가진다. 첫째, 통계나 랭킹처럼 정밀한 수치 연산이 필요한 질문에 대해 거대 언어 모델이 컨텍스트의 숫자를 잘못 해석하거나 누락하는 환각 현상인 할루시네이션이 발생한다. 둘째, 거대 언어 모델 API 서버에 통신 장애가 발생하거나 유효하지 않은 키가 입력될 경우 RAG 파이프라인 전체가 멈추며 서비스 중단으로 이어진다.

이 두 가지 결함을 극복하기 위해, 통계적 사실의 추출을 담당하는 결정론적 도구와 문장 표현을 담당하는 생성 모델의 역할을 분리한 Agentic RAG 파이프라인을 설계했다. 이는 생성형 인공지능의 생성 능력에 전적으로 의존하는 구조가 아니며, 외부 API 장애 상황에서도 정확한 실측 수치 정보를 사용자에게 전달하는 것을 목표로 한다.

## 4단계 파이프라인 구조와 모듈식 설계

사용자 질문이 유입되어 최종 답변으로 반환되는 경로는 총 4개의 명확한 결합 단계를 거친다. 각 모듈은 앞 단계의 결과물만을 입력으로 받아 독립적으로 실행되며, 이 모듈식 구조는 중간 단계의 실패가 전체 오류로 번지는 것을 막는다.

<figure class="fig">
<svg viewBox="0 0 720 220" width="100%" style="height:auto;display:block" preserveAspectRatio="xMidYMid meet" role="img" aria-label="RAG 파이프라인 4단계 아키텍처 및 장애 복구 흐름">
<defs>
<marker id="arw-rag-1" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
<path d="M0,0 L7,3 L0,6 Z" fill="#5b5e66"/>
</marker>
</defs>
<style>
.bx{fill:#eef2f9;stroke:#21447c;stroke-width:1.4;}
.bxAlert{fill:#fce8e6;stroke:#c5221f;stroke-width:1.4;}
.bxSuccess{fill:#e8f5ec;stroke:#1f7a3d;stroke-width:1.4;}
.tl{font-family:Pretendard,sans-serif;font-size:13px;font-weight:700;fill:#21447c;}
.tx{font-family:Pretendard,sans-serif;font-size:12px;fill:#1a1c20;text-anchor:middle;}
.sm{font-family:Pretendard,sans-serif;font-size:10px;fill:#5b5e66;text-anchor:middle;}
.fl{stroke:#5b5e66;stroke-width:1.3;}
</style>
<rect class="bx" x="10" y="40" width="130" height="50" rx="6"/>
<text class="tx" x="75" y="65">1. 의도 분류</text>
<text class="sm" x="75" y="80">Gemini 또는 키워드 폴백</text>
<rect class="bx" x="175" y="40" width="130" height="50" rx="6"/>
<text class="tx" x="240" y="65">2. 도구 수행</text>
<text class="sm" x="240" y="80">SQL 및 Graph 쿼리</text>
<rect class="bx" x="340" y="40" width="130" height="50" rx="6"/>
<text class="tx" x="405" y="65">3. 근거 검증</text>
<text class="sm" x="405" y="80">결정론적 근거 충족 판정</text>
<rect class="bx" x="505" y="40" width="200" height="50" rx="6"/>
<text class="tx" x="605" y="65">4. 문장 합성</text>
<text class="sm" x="605" y="80">LLM 자연어 묘사 시도</text>
<rect class="bxAlert" x="505" y="125" width="200" height="40" rx="4"/>
<text class="tx" x="605" y="142">Gemini API 장애 감지</text>
<text class="sm" x="605" y="156">degraded 플래그[^3] 설정</text>
<rect class="bxSuccess" x="250" y="125" width="230" height="40" rx="4"/>
<text class="tx" x="365" y="142">정직성 기반 템플릿 대체 작동</text>
<text class="sm" x="365" y="156">실측 SQL 및 Graph 수치 보존</text>
<line class="fl" x1="140" y1="65" x2="170" y2="65" marker-end="url(#arw-rag-1)"/>
<line class="fl" x1="305" y1="65" x2="335" y2="65" marker-end="url(#arw-rag-1)"/>
<line class="fl" x1="470" y1="65" x2="500" y2="65" marker-end="url(#arw-rag-1)"/>
<line class="fl" x1="605" y1="90" x2="605" y2="120" marker-end="url(#arw-rag-1)"/>
<line class="fl" x1="505" y1="145" x2="485" y2="145" marker-end="url(#arw-rag-1)"/>
</svg>
<figcaption>그림 1. Agentic RAG 파이프라인의 순차적 모듈 흐름 및 LLM 에러 복구 구조</figcaption>
</figure>

* **1단계: 의도 분류**: 사용자 입력을 6종의 의도로 분류한다. 거대 언어 모델을 기본으로 사용하여 계획을 수립하되, 거대 언어 모델 응답 실패 시 입력 텍스트 내 특정 예약어를 판별하는 키워드 휴리스틱[^4] 라우팅 방식으로 즉각 대체된다.
* **2단계: 도구 수행**: 라우팅 결과에 맞춰 sql_tool 또는 graph_tool이 직접 데이터베이스에 접근한다. 통계, 랭킹 및 기술간 연관 네트워크는 파라미터화된 SQL 문으로 직접 조인하여 결정론적으로 처리한다.
* **3단계: 근거 검증**: 도구가 찾아낸 원본 데이터가 최소 신뢰 조건을 충족하는지 검증한다. 정보가 부족하거나 없는 경우 하위 모듈에 이를 명시적으로 전달한다.
* **4단계: 문장 합성**: 도구가 검출해 낸 통계 원천 사실들을 사용자에게 전달하기 위한 자연어 문장으로 서술한다.

## 정직성 설계 및 오탐 방어

이 아키텍처의 유효성은 시스템 장애 테스트 과정에서 증명되었다. 개발 중 Gemini API 키가 올바르게 주입되지 않았거나 비표준 엔드포인트 호출 오류가 발생했을 때, 일반적인 RAG 어플리케이션은 내부 서버 에러를 출력하며 동작을 중단했다.

파이프라인의 의도 분류 모듈은 API 오류를 감지하면 예외를 발생시키지 않고 다음과 같이 키워드 기반의 휴리스틱 라우터로 분기하여 동작 계획을 수립한다.

```python
# app/services/rag/router.py 일부 발췌
def _heuristic(session: Session, q: str, pool: str | None) -> Plan:
    low = q.lower()
    skill = _detect_skill(session, q)
    job_category = _detect_job_category(q)
    entry_level = _detect_entry_level(q)
    if skill and any(k in low for k in _COOCCUR_KW):
        intent = "cooccurrence"
    elif any(k in q for k in _SEMANTIC_KW):
        intent = "semantic_search"
    elif any(k in low for k in _CERT_KW):
        intent = "cert_ranking"
    elif any(k in low for k in _CONCEPT_KW):
        intent = "concept_ranking"
    elif any(k in low for k in _REGION_KW):
        intent = "region_distribution"
    elif skill:
        intent = "skill_demand"
    elif any(k in low for k in _RANK_KW):
        intent = "skill_ranking"
    else:
        intent = "overview"
    return Plan(
        intent=intent,
        tools=INTENT_TOOLS[intent],
        pool=pool,
        entities=_build_entities(skill, job_category, entry_level),
        subqueries=[q],
    )
```

이와 동시에, 문장 합성 단계에서 거대 언어 모델의 통신 불가 상태가 파악되면 degraded 플래그를 활성화하고, 사전에 도구가 데이터베이스로부터 확보한 실측 정량 수치를 보존한 채로 한국어 템플릿에 값을 결합하여 우회 복구를 수행한다.

```python
# app/services/rag/synthesis.py 일부 발췌
def _fallback(facts: list[str]) -> str:
    if len(facts) <= 1:
        return facts[0] if facts else ""
    return "\n".join(f"- {f}" for f in facts)

def synthesize(
    llm: LLMClient, question: str, tool_outputs: list[dict], passed: bool
) -> tuple[str, bool, bool]:
    facts = [o["facts"] for o in tool_outputs if o.get("facts")]
    if not passed or not facts:
        return "관련 데이터가 부족해요.", True, False

    prompt = (
        f"질문: {question}\n\n"
        f"사실(근거):\n- " + "\n- ".join(facts) + "\n\n"
        "위 사실만으로 답을 작성하라."
    )
    text = llm.text(_SYNTH_SYSTEM, prompt, temperature=0.3)
    if text and text.strip() and not _is_bail(text.strip()):
        return text.strip(), False, True
    # LLM이 미가용이거나, 사실이 있는데도 부족 문구로 답했다면 사실 템플릿으로 덮어써
    # 실제 데이터를 보여준다(허위 '부족' 응답 방지).
    return _fallback(facts), True, True
```

실제 검증에서 React와 함께 자주 쓰이는 기술이라는 질문을 보냈을 때, 거대 언어 모델의 통신 오류 상태에서도 시스템은 다음과 같은 템플릿 기반의 정답을 제공했다.

> React 공고 7,163건 기준 JavaScript가 78.3%, TypeScript가 41.6% 공동으로 발견되었습니다.

사용자는 언어 모델의 유려한 서술만 제공받지 못했을 뿐, 데이터베이스에서 물리적으로 집계한 실제 핵심 데이터는 누락과 왜곡 없이 전달받았다. 또한 데이터베이스 범위를 벗어난 질문이 유입될 경우, 언어 모델이 없는 통계를 지어내지 못하도록 overview 라우팅으로 강제 전환하여 오탐을 사전에 차단했다.

## 런타임 제약 극복: fastembed ONNX 기반 CPU 추론 및 OOM 방어

RAG 파이프라인에 의미 기반 벡터[^6] 검색을 확장하는 과정에서 인프라 레벨의 제약 조건이 발견되었다. 적재된 채용공고의 임베딩이 BGE-M3 모델을 활용하여 생성되었기 때문에, 검색 시의 질의 역시 반드시 BGE-M3 모델로 임베딩해야 코사인 유사도 검색 공간이 일치한다.

그러나 배포 대상인 클라우드 가상 머신에는 GPU 장치와 고성능 기계학습 추론 프레임워크가 제공되지 않으며, 이미 그라파나와 프로메테우스를 포함한 관측성 모니터링 컨테이너 스택들이 상시 작동 중이어서 가용 메모리가 부족한 한계가 존재했다.

이러한 한계를 제어하기 위해 물리 계층을 설계했다.

* **ONNX Runtime[^7] 활용 CPU 추론**: GPU 가속 없이 CPU에서 기계학습 모델을 빠르게 돌리기 위해 ONNX Runtime 기반의 fastembed 라이브러리를 채택했다. L2 정규화를 거쳐 pgvector와 호환성을 확보했다.
* **기능 플래그를 통한 OOM[^8] 방지**: e2-standard-2의 8GB RAM 용량 한계에서 BGE-M3 모델이 로드될 때 발생하는 OOM 중단 사고를 예방하기 위해, 의미 검색 활성화 여부를 ENABLE_VECTOR_SEARCH 환경 변수 뒤로 격리하고 지연 로딩을 처리했다. 이 플래그가 비활성화된 상태에서는 임베딩[^9] 라이브러리 자체를 메모리에 적재하지 않고 즉각 SQL 검색 폴백을 유도했다.
* **스케일업 권장 수립**: 운영 환경에서 실시간 임베딩 추론의 연산 지연을 줄이고 안정적인 RAM 마진을 확보하기 위해, 실서비스 활성화 시 VM을 e2-standard-4로 스케일업하는 인프라 실행 가이드를 문서로 수립했다.

## 엔니지어링 교훈

생성형 인공지능 서비스를 설계할 때, 최신의 대규모 언어 모델을 단독으로 사용하는 것보다 역할을 명확히 쪼개고 이를 안정적인 백엔드 로직으로 보완하는 것이 품질 향상의 핵심이다. 언어 모델의 성능이 가변적이거나 물리 인프라 API가 예외를 반환하는 환경에서도, 결정론적 도구들이 사실 관계를 지탱하고 있다면 시스템 전체의 비즈니스 가치는 소실되지 않는다. 기술적 한계를 고려하고 하위 단계의 폴백 구조를 입체적으로 설계하는 것이 상용 서비스 구축의 핵심 기준이 된다.

[^1]: RAG: 거대 언어 모델이 학습하지 않은 최신 외부 데이터를 검색하여 답변의 근거로 활용하는 기술
[^3]: degraded 플래그: 성능 저하나 기능 일부 오작동을 명시하는 시스템 알림 식별자
[^4]: 휴리스틱: 복잡한 연산 대신 사전 정의된 단순 조건식을 활용해 답을 내는 직관적 해결책
[^6]: 벡터: 인공지능이 데이터 간의 유사도를 비교하기 위해 사용하는 다차원의 숫자 리스트
[^7]: ONNX Runtime: 다양한 학습 모델을 여러 하드웨어에서 빠르게 추론하도록 돕는 크로스플랫폼 실행 엔진
[^8]: OOM: 가용 메모리가 소모되어 시스템에서 프로세스를 강제 종료하는 메모리 부족 오류
[^9]: 임베딩: 단어나 문장을 인공지능이 이해할 수 있도록 여러 차원의 숫자로 표현한 벡터 값
[^10]: 프롬프트: 언어모델에게 원하는 작업을 지시하기 위해 입력으로 넣는 텍스트
[^11]: 컨텍스트: 언어모델이 답을 생성할 때 실제로 참고하는 입력 범위 전체
