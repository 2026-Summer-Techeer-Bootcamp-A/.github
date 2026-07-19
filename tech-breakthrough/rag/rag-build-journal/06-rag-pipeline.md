# RAG 파이프라인 구현: 증분 1

## 목표

데이터가 프로덕션에 올라간 뒤, 이제 하이브리드 Agentic + Graph RAG를 실제 코드로 구현하는 단계로 넘어간다. 이는 나이브 RAG가 아니라 라우터가 도구를 고르고 도구가 결정론적으로 답하고 평가자가 검증하고 합성이 서술하는 구조이며, "AI API만 떼다 쓴 게 아니다"를 코드로 증명하는 것이 이번 작업의 목적이다.

## 증분으로 나눈 이유

설계는 T0부터 T5까지 티어로 나뉘어 있고, sql 도구와 그래프 도구, 벡터 도구, 에이전트 루프, 데모 화면, 평가 하니스가 모두 그 안에 들어간다. 이걸 한 번에 다 만들면 반쯤 동작하는 코드가 여기저기 흩어지게 되므로, 증분 1의 범위를 좁게 잡았다.

- 증분 1: sql_tool, graph_tool, 에이전트 루프, /chat v2. 완전 동작한다.
- 증분 2: vector_tool. 쿼리 임베딩 런타임을 정해야 해서 분리한다.

벡터를 증분 2로 미룬 이유는 단순한 순서 문제가 아니라 런타임 환경의 제약 때문이다. BGE-M3는 로컬 GPU에서 돌지만 프로덕션은 GPU가 없는 VM이라서, 쿼리를 실시간으로 임베딩할 방법을 CPU 추론과 임베딩 서비스 중에서 먼저 정해야 한다. 이건 별도의 결정이 필요한 사안이라 증분 2로 뺐다.

그래서 증분 1은 sql과 graph만 쓴다. 둘 다 순수 SQL이라 임베딩이 필요 없고, 그 덕분에 GPU 없는 VM에서도 바로 동작한다.

## LLM 선택

설계 문서는 Claude를 쓴다고 했지만, 실제 백엔드 config는 Gemini만 배선되어 있었고 `.env`에도 Gemini 키만 있었으며 Anthropic 키는 없었다.

그래서 Gemini로 진행했다. RAG의 핵심 가치는 벤더가 아니라 구조이므로 agentic 흐름과 그래프와 정직성으로 증명하면 되고, 대신 LLM 프로바이더를 인터페이스로 추상화해 나중에 Claude로 교체하기 쉽게 만들었다.

## 구조

```
질문
  -> router(planner)   질문 분해, intent와 도구 선택
  -> tools             sql 또는 graph 실행
  -> evaluator         근거 충분성 판정
  -> synthesis         사실만으로 서술
  -> ChatResponse      steps, tool_results, citations, confidence, degraded
```

파일별 역할은 다음과 같다.

- `llm.py`: Gemini REST 클라이언트로, SDK 대신 urllib로 직접 호출하며 실패하면 None을 반환해 호출부가 폴백을 타도록 만들었다.
- `router.py`: 질문을 intent 6종으로 분류하는데, Gemini로 계획을 뽑고 실패하면 키워드 휴리스틱으로 폴백한다.
- `tools/sql_tool.py`: 기술, 개념, 자격증 랭킹과 특정 기술 수요를 집계하며, 전부 파라미터화 SQL로 구현했다.
- `tools/graph_tool.py`: 기술 공동출현을 순회하고 서브그래프 노드와 엣지도 만든다.
- `evaluator.py`: 도구가 근거를 냈는지 판정하며, 증분 1에서는 결정론으로 동작한다.
- `synthesis.py`: 도구가 낸 사실만으로 답을 쓰고, LLM이 죽으면 템플릿으로 엮는다.
- `pipeline.py`: 위 구성요소를 순서대로 엮고 steps를 기록한다.

## 정직성 설계

이 파이프라인의 핵심은 숫자를 도구가 확정하고 LLM은 그것을 문장으로 옮기는 역할만 한다는 점이다. 그래서 LLM이 죽어도 답이 틀리지 않는데, Gemini가 응답을 주지 않으면 degraded 표시가 붙지만 그래도 템플릿 답에 들어가는 수치는 전부 SQL과 그래프로 실측한 값이라서 할루시네이션이 원천 차단된다.

데이터 밖의 질문, 이를테면 "오늘 점심 뭐 먹지" 같은 질문은 overview로 안전하게 강등해서 없는 답을 지어내지 않도록 했다.

## 검증

로컬 appdb_load 565,191건을 대상으로 6개 질문을 돌려 검증했다.

- "React랑 같이 쓰는 기술" -> graph -> React 공고 7,163건 기준 JavaScript 78.3%, TypeScript 41.6%
- "수요 많은 기술 순위" -> sql -> Python 24,494건, JavaScript 22,968건, AWS 21,327건
- "Python 공고 몇 개" -> sql -> 24,494건, 전체의 4.3%
- "요즘 뜨는 개념" -> sql -> 개인정보 컴플라이언스, 확장성, CI/CD
- "자격증 뭐가 많이 필요해" -> sql -> AWS SA 2,200건, 컴퓨터활용능력 1,601건, PMP 1,446건
- "오늘 점심 뭐 먹지" -> overview로 강등, 환각 없음

여섯 질문 모두 intent가 정확히 잡혔고, 숫자는 전부 실측값이었다.

## 삽질 로그

### AmbiguousParameter

pool 필터에서 다음 에러가 터졌다.

```
could not determine data type of parameter $2
LINE: ... AND ($2 IS NULL OR p.pool = $2)
```

pool이 None일 때 Postgres가 파라미터 타입을 정하지 못해서 생기는 문제였는데, `$2 IS NULL`에서 NULL의 타입이 모호했기 때문이다. `CAST(:pool AS text)`로 감싸서 해결했다.

### Gemini 무응답 문제

전 질문이 degraded로 나왔는데, 처음에는 원인이 모호했다. 나중에 원인을 두 갈래로 분리해 확인할 수 있었다. 첫째는 코드 문제였다. 최초 llm.py는 `/v1beta/interactions`라는 비표준 엔드포인트와 그 요청 포맷을 썼는데, 이는 resume_feedback.py에서 그대로 물려받은 것이었고 유효한 키가 있어도 실패하는 경로였다. 그래서 표준 `/v1beta/models/{model}:generateContent` 엔드포인트와 contents, systemInstruction 요청 포맷으로 교정했다. 둘째는 설정 문제였다. `GEMINI_API_KEY`가 길이 3짜리 placeholder라서, 모델 목록 조회를 시도하자 API가 곧바로 "API key not valid"를 반환했다. 즉 엔드포인트를 고쳐도 유효한 키를 .env와 프로덕션 VM의 .env에 넣기 전까지는 서술이 계속 폴백을 탄다.

그런데 이 실패가 오히려 정직성 설계를 증명하는 계기가 됐다. LLM이 죽어도 라우팅은 휴리스틱으로 정확히 돌았고 답의 숫자도 전부 맞았으며, LLM 서술만 템플릿으로 대체됐을 뿐이었다.

## 증분 2: vector_tool과 사양 문제

의미 검색을 붙이는 일은 코드보다 런타임 결정이 먼저였다. 저장된 공고 임베딩이 BGE-M3라서 쿼리도 반드시 BGE-M3로 임베딩해야 같은 공간에서 코사인 검색이 되는데, 프로덕션 VM에는 GPU도 임베딩 라이브러리도 없었기 때문이다. 다른 모델로 쿼리를 임베딩하면 벡터 공간이 어긋나 검색이 무의미해진다.

그래서 GPU 없이 CPU에서 도는 fastembed의 onnx 백엔드로 BGE-M3를 붙였다. embedder.py가 모델을 지연 로딩하고 L2 정규화한 벡터를 돌려주며, vector_tool은 그 벡터로 posting_embedding에 코사인 top-k를 친다.

문제는 사양이었다. 배포 VM은 e2-standard-2로 2 vCPU에 8GB RAM인데, 이미 관측성 스택 전체와 Traefik과 app이 메모리를 3에서 5GB 쓰고 있었다. 여기에 BGE-M3를 올리면 로딩만으로 RAM 2에서 3GB를 더 먹어 8GB를 넘기고 OOM이 날 위험이 컸다. 그래서 두 가지로 대응했다. 첫째, vector_tool을 enable_vector_search 기능 플래그 뒤에 두어 기본값을 off로 했다. 플래그가 꺼져 있으면 모델을 로딩조차 하지 않고 None을 반환해 라우터가 sql과 graph로 폴백하므로, 코드를 배포해도 현재 VM이 죽지 않는다. 둘째, 활성화의 전제로 VM을 e2-standard-4로 올리기를 권장했다. 16GB 메모리로 여유를 확보하고 4 vCPU로 CPU 추론 지연도 절반으로 줄인다.

활성화 순서는 VM을 상향하고 프로덕션 .env에 ENABLE_VECTOR_SEARCH를 켠 뒤, fastembed의 BGE-M3 출력이 저장된 sentence-transformers 임베딩과 같은 공간인지 알려진 공고 하나로 코사인을 대조해 확인하는 것이다.

## 남은 것

- Gemini 서술 활성화. 엔드포인트는 표준으로 교정했으므로, 유효한 GEMINI_API_KEY를 .env와 프로덕션 VM에 넣으면 바로 동작한다.
- graph global search: 커뮤니티 검출과 리포트.
- evaluator에 재검색 루프.
- 평가 하니스: 골든셋과 recall@k.
- 프론트 인사이트 화면 개편.

## 배운 것

발전형 RAG의 핵심은 도구 분리에 있다. 정량은 SQL이 결정론으로 답하고 LLM은 라우팅과 서술만 담당하기 때문에, LLM 품질이 흔들려도 답의 정확도는 흔들리지 않는다. 이것이 나이브 RAG와의 결정적 차이다.
