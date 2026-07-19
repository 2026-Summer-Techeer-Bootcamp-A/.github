# 답변 품질 감사: 왜 디테일한 질문에서 무너지는가

**일정**: 2026-07-14  
**요약**: "답변이 디테일한 질문에 제대로 못 답한다"는 피드백을 받고 질문 18개를 직접 던져 응답을 감사했다. 단일 라운드 디스패치, 꺼진 벡터 검색, 표본 크기만 보는 신뢰도 계산이라는 세 원인을 찾아 같은 날 조치했다.  

## 개요

"답변이 멍청하고 디테일한 질문에 제대로 못 답한다"는 피드백을 받고, 실제로 떠 있는 프로덕션 백엔드(`/api/v1/chat`)에 다양한 난이도의 질문 18개를 직접 던져 응답을 전부 수집했다. 이 문서는 그 표본을 근거로 무엇이 왜 무너지는지를 코드까지 추적해 정리하고, 오늘 적용한 조치와 아직 남은 과제를 구분해 남긴다.

## 방법

`docker ps`로 이미 떠 있던 `backend-app-1`에 curl로 직접 질의했다. 단순 랭킹부터 직군, 연차, 회사규모, 연봉, 원격근무처럼 스키마에 없을 법한 조건까지, 난이도를 의도적으로 섞어 질문 18개를 구성했다.

| # | 질문 | intent | route | n(표본) | 평가 |
|---|---|---|---|---|---|
| 1 | React 배우면 뭘 같이 알아야 해? | cooccurrence | graph | 7,163 | 정상 |
| 2 | 국내 채용 시장, 가장 많이 쓰는 언어, 프레임워크는? **백엔드 기준.** | skill_ranking | sql | 442,768 | "백엔드" 조건 무시, 전체 랭킹으로 대체 |
| 3 | 신입 백엔드 개발자는 보통 어떤 스택을 요구받아? | skill_ranking | sql | 565,191 | "신입", "백엔드" 둘 다 무시 |
| 4 | Python이랑 Java 중 연봉이 더 높아? | skill_ranking | sql | 565,191 | 연봉 데이터 자체가 없음, 무관한 언급 빈도로 대체 |
| 5 | 스타트업이랑 대기업 기술 스택 차이 있어? | overview | sql | 442,768 | 회사 규모 차원 없음, 전체 랭킹으로 대체 |
| 6 | AWS 자격증 있으면 취업에 도움 될까? | cert_ranking | sql | 565,191 | 정상(질문 취지에 맞게 답함) |
| 7 | MSA 경험 요구하는 공고 많아? | skill_demand | sql | 810 | 정상 |
| 8 | 판교 쪽 IT 공고 많아? | region_distribution | sql | 565,191 | 지역 매칭은 정확, 불필요한 IT 헷지 추가 |
| 9 | 주니어 프론트엔드 공고에서 TypeScript 필수 비율은? | skill_demand | sql | 4,713 | "주니어" 조건 무시, 정직하게 캐비엇은 붙음 |
| 10 | Spring Boot 쓰는 회사는 어떤 DB를 같이 써? | cooccurrence | graph | 8,435 | 정상 |
| 11 | 리모트 근무 가능한 개발자 공고 있어? | semantic_search | vector | 565,191 | **vector 완전 실패 → SQL로 조용히 대체** |
| 12 | 데이터 엔지니어 공고에서 요구하는 자격증은? | cert_ranking | sql | 565,191 | 직군 필터 없음, 전체 자격증 랭킹으로 대체 |
| 13 | 머신러닝 관련 공고 추천해줘 | semantic_search | vector | 565,191 | **vector 완전 실패 → SQL로 조용히 대체** |
| 14 | 가장 많이 요구되는 자격증 top 5는? | cert_ranking | sql | 565,191 | 정상 |
| 15 | 쿠버네티스랑 도커 같이 쓰는 공고 많아? | cooccurrence | graph | 9,302 | 정상 |
| 16 | 신입 개발자 지원 가능 공고 비율은? | overview | sql | 565,191 | 데이터 없다고 정직하게 답함(다만 #4, #5와 처리가 다름) |
| 17 | Java 개발자한테 Spring 말고 또 뭘 요구해? | cooccurrence | graph | 20,172 | 정상 |
| 18 | 글로벌이랑 국내 기술 스택 차이가 뭐야? | skill_ranking | sql | 565,191 | 비교 질문인데 한쪽 합산 통계만 반환 |

18건 중 정확히 질문에 답한 것은 7건, 조건 일부 또는 전부를 놓치고 무관한 대체 통계를 내놓은 것은 11건이었다. 표만 보면 "절반 이상 실패"로 보이지만, 실패들이 전부 제각각의 버그는 아니었다. 코드를 추적해보니 네 가지 근본 원인으로 수렴했다.

## 원인 1. 질문당 단일 도구 호출, 재질의 부재

`router.py`의 플래너는 질문을 `cooccurrence`, `skill_demand`, `skill_ranking`, `concept_ranking`, `cert_ranking`, `semantic_search`, `overview`, `region_distribution` 여덟 개 intent 중 정확히 하나로 분류한다. `pipeline.py`의 `_dispatch`는 그 intent 하나에 대응하는 도구를 정확히 한 번 호출하고, 대상을 못 찾거나 intent가 매칭되지 않으면 무조건 `top_skills`(전체 상위 기술 랭킹)로 떨어진다.

```python
if not out:  # 위에서 못 채웠으면(대상 미해소 등) 기술 랭킹으로 폴백
    out.append(sql_tool.top_skills(session, pool))
```

이 구조에서는 질문에 직군, 연차, 회사 규모, 연봉, 원격근무 같은 조건이 섞여 있어도 담을 자리가 없다. 엔티티 추출은 `skill` 하나뿐이고, 그 외 조건은 애초에 스키마에 없거나(연봉, 원격근무) 있어도 추출 대상이 아니다(직군, 연차, 회사규모). `evaluator.py`의 재검색 루프도 아직 스텁 상태다.

> 설계상 재검색 루프(최대 2회)는 후속 증분에서 LLM 평가로 확장한다(`evaluator.py`의 docstring).

즉 이 시스템은 스스로를 "하이브리드 Agentic + Graph RAG[^1]"라 부르지만(`chat.py` 상단 주석), 근거가 부족할 때 스스로 다시 검색하거나 질문을 쪼개 재시도하는 에이전틱 루프는 설계 문서에만 있고 아직 구현되지 않았다. 지금은 planner가 한 번 분류하고, 도구가 한 번 실행되고, 그걸로 끝이다.

<figure class="fig">
<svg viewBox="0 0 760 260" width="100%" style="height:auto;display:block" preserveAspectRatio="xMidYMid meet" role="img" aria-label="단일 라운드 디스패치 구조에서 조건이 소실되는 지점">
  <defs>
    <marker id="arw-09-1" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
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
    .fl{stroke:#5b5e66;stroke-width:1.3;}
  </style>
  <text x="8" y="22" class="tl">"신입 백엔드 개발자는 어떤 스택을 요구받아?"</text>
  <rect class="bx" x="20" y="45" width="150" height="50" rx="8"/>
  <text class="tx" x="95" y="66">질문</text>
  <text class="sm" x="95" y="82">신입 + 백엔드 + 스택</text>
  <rect class="bxWarn" x="220" y="45" width="170" height="50" rx="8"/>
  <text class="tx" x="305" y="66">planner(LLM, 1회)</text>
  <text class="warn" x="305" y="82">skill 못 찾음 → skill_ranking 강등</text>
  <rect class="bx" x="440" y="45" width="150" height="50" rx="8"/>
  <text class="tx" x="515" y="66">도구 호출(1회)</text>
  <text class="sm" x="515" y="82">top_skills(pool=전체)</text>
  <rect class="bxWarn" x="640" y="45" width="100" height="50" rx="8"/>
  <text class="tx" x="690" y="66">답변</text>
  <text class="warn" x="690" y="82">전체 랭킹</text>
  <line class="fl" x1="170" y1="70" x2="216" y2="70" marker-end="url(#arw-09-1)"/>
  <line class="fl" x1="390" y1="70" x2="436" y2="70" marker-end="url(#arw-09-1)"/>
  <line class="fl" x1="590" y1="70" x2="636" y2="70" marker-end="url(#arw-09-1)"/>
  <text x="8" y="140" class="tl">소실되는 조건</text>
  <rect class="bx" x="20" y="155" width="220" height="34" rx="6"/><text class="tx" x="130" y="176">직군(백엔드, 프론트): 추출 대상 아님</text>
  <rect class="bx" x="20" y="195" width="220" height="34" rx="6"/><text class="tx" x="130" y="216">연차(신입, 주니어): 추출 대상 아님</text>
  <rect class="bx" x="260" y="155" width="220" height="34" rx="6"/><text class="tx" x="370" y="176">회사 규모: 스키마에 없음</text>
  <rect class="bx" x="260" y="195" width="220" height="34" rx="6"/><text class="tx" x="370" y="216">연봉, 원격근무: 스키마에 없음</text>
  <rect class="bx" x="500" y="155" width="220" height="34" rx="6"/><text class="tx" x="610" y="176">재검색, 재질의 루프: 미구현(스텁)</text>
  <rect class="bx" x="500" y="195" width="220" height="34" rx="6"/><text class="tx" x="610" y="216">비교 질문(글로벌 vs 국내): 미지원</text>
</svg>
<figcaption>그림 1. 질문은 planner를 한 번, 도구를 한 번 거쳐 곧바로 답이 된다. 여덟 개 intent 밖에 있는 조건은 담을 자리가 없어 그대로 사라지고, 전체 랭킹이라는 최소공배수 답으로 수렴한다.</figcaption>
</figure>

표 1의 실패 11건 중 8건(#2, #3, #4, #5, #9, #12, #16, #18)이 정확히 이 패턴이다. 질문이 구체적일수록, 즉 사람이 실제로 궁금해할 법한 질문일수록 이 시스템은 오히려 더 자주 전체 랭킹으로 도망친다.

## 원인 2. 의미검색 비활성 배포와 vector 오표시

"추천해줘", "찾아줘" 같은 질문(#11, #13)은 `semantic_search` intent로 정확히 분류됐다. 문제는 그다음이다.

```python
enable_vector_search: bool = False
```

`app/core/config.py`의 기본값이 꺼져 있다. `embedder.py`는 이 플래그가 꺼져 있으면 임베딩을 만들지 않고 곧바로 `None`을 반환하도록 설계되어 있고(RAM 2~3GB를 쓰는 BGE-M3 로딩을 프로덕션 VM에서 피하려는 의도적 설계다), `vector_tool.semantic_search`도 `None`을 받으면 그대로 `None`을 반환한다. 그러면 `_dispatch`의 `if not out` 분기가 걸려 `top_skills`로 대체된다. 여기까지는 "정직한 폴백"으로 설계된 그대로다.

문제는 프론트에 노출되는 단계(step) 라벨이다. `pipeline.py`에서 도구 실행 결과를 스텝으로 바꿀 때, `graph`가 아닌 결과는 무조건 원래 계획했던 도구 이름(`p.tools[0]`)을 그대로 쓴다.

```python
step = Step(
    kind="tool",
    tool=tr["kind"] if tr["kind"] in ("graph",) else p.tools[0],
    label=tr["label"],
    detail=o["citation"]["label"],
)
```

실제로 "머신러닝 관련 공고 추천해줘"를 던져 원본 JSON을 받아보면 이렇게 나온다.

```json
{
  "route": "vector",
  "steps": [
    { "kind": "plan", "detail": "intent=semantic_search · tools=vector · skill=머신러닝" },
    { "kind": "tool", "tool": "vector", "label": "수요 상위 기술",
      "detail": "기술태그 집계 · 공고 565,191건" },
    { "kind": "eval", "detail": "pass · 근거 표본 565,191건" }
  ]
}
```

`tool`은 `"vector"`인데 `label`과 `detail`은 명백히 SQL 랭킹 결과다. 사용자 화면에는 "🔧 벡터[^2] 검색: 수요 상위 기술"처럼 상충하는 배지가 뜨는 셈이다. 이건 단순히 답이 부정확한 수준을 넘어, 시스템이 실제로 무엇을 했는지를 UI 자체가 잘못 증언하는 문제라서 우선순위가 높다고 판단했다.

<figure class="fig">
<svg viewBox="0 0 720 190" width="100%" style="height:auto;display:block" preserveAspectRatio="xMidYMid meet" role="img" aria-label="semantic_search 폴백이 vector로 오표시되는 경로">
  <defs>
    <marker id="arw-09-2" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L7,3 L0,6 Z" fill="#5b5e66"/>
    </marker>
  </defs>
  <style>
    .bx2{fill:#eef2f9;stroke:#21447c;stroke-width:1.4;font-family:Pretendard,sans-serif;}
    .bxBad2{fill:#fdece3;stroke:#b3441f;stroke-width:1.4;}
    .tx2{font-family:Pretendard,sans-serif;font-size:11.5px;fill:#1a1c20;text-anchor:middle;}
    .sm2{font-family:Pretendard,sans-serif;font-size:10px;fill:#5b5e66;text-anchor:middle;}
    .bad2{font-family:Pretendard,sans-serif;font-size:10px;fill:#8a3b12;text-anchor:middle;}
    .fl2{stroke:#5b5e66;stroke-width:1.3;}
  </style>
  <rect class="bx2" x="10" y="20" width="140" height="50" rx="8"/><text class="tx2" x="80" y="41">intent=semantic_search</text><text class="sm2" x="80" y="57">tools=[vector]</text>
  <rect class="bx2" x="190" y="20" width="140" height="50" rx="8"/><text class="tx2" x="260" y="41">embed_query()</text><text class="sm2" x="260" y="57">enable_vector_search=False</text>
  <rect class="bxBad2" x="370" y="20" width="120" height="50" rx="8"/><text class="tx2" x="430" y="46">None 반환</text>
  <rect class="bx2" x="530" y="20" width="170" height="50" rx="8"/><text class="tx2" x="615" y="41">top_skills()로 대체</text><text class="sm2" x="615" y="57">kind=list, label=수요 상위 기술</text>
  <line class="fl2" x1="150" y1="45" x2="186" y2="45" marker-end="url(#arw-09-2)"/>
  <line class="fl2" x1="330" y1="45" x2="366" y2="45" marker-end="url(#arw-09-2)"/>
  <line class="fl2" x1="490" y1="45" x2="526" y2="45" marker-end="url(#arw-09-2)"/>
  <rect class="bxBad2" x="270" y="120" width="220" height="50" rx="8"/>
  <text class="tx2" x="380" y="141">Step.tool = p.tools[0] = "vector"</text>
  <text class="bad2" x="380" y="157">라벨만 "vector", 내용은 SQL 결과</text>
  <line class="fl2" x1="615" y1="70" x2="615" y2="100" marker-end="url(#arw-09-2)"/>
  <line class="fl2" x1="615" y1="100" x2="490" y2="130" marker-end="url(#arw-09-2)"/>
</svg>
<figcaption>그림 2. 벡터 검색이 실패해 SQL로 대체되는 것 자체는 설계된 안전장치지만, 프론트에 노출되는 도구 배지는 여전히 원래 계획이었던 "vector"를 그대로 표시한다.</figcaption>
</figure>

## 원인 3. 신뢰도 배지의 표본 크기 편중

`confidence.level`은 오직 `n`(도구가 반환한 표본 수)만으로 계산된다.

```python
def _confidence_level(n: int) -> int:
    if n <= 0: return 0
    if n < 50: return 2
    if n < 500: return 3
    if n < 5000: return 4
    return 5
```

전체 공고 565,191건 기준 랭킹을 폴백으로 냈을 뿐인데 `n`은 항상 크기 때문에, 질문과 전혀 무관한 대체 답에도 신뢰도는 늘 "5 / 높음"으로 뜬다. 표 1의 #2, #3, #4, #5, #11, #12, #13, #18이 전부 이 경우였다. 사용자 입장에서는 질문을 비껴간 답에 최고 신뢰도 배지가 붙어 있는 걸 보는 셈이라, "믿음직스럽지 않은데 자신만만하다"는 인상, 정확히는 오늘 피드백에서 나온 "멍청하다"는 인상을 여기서 상당 부분 받았을 것으로 판단한다. 신뢰도는 표본 크기가 아니라 "이 표본이 실제로 질문이 겨냥한 대상을 담고 있는가"를 반영해야 의미가 있는데, 지금 구조에는 그 판별 자체가 없다.

## 원인 4. 시스템 프롬프트의 표현 차단 누락

`synthesis.py`의 `_SYNTH_SYSTEM`은 사실 근거로만 답하라고 지시할 뿐, 어떤 어투로 말하라는 규정이 없었다. 그 결과 LLM이 자기지시적 문구를 자유롭게 골랐고, 18건 중 5건(#4, #5, #11, #16, #18로 약 28%)에서 "제공된 데이터에는 ~정보가 없습니다", "주어진 사실에는 ~포함되어 있지 않습니다" 같은 표현이 나왔다. 같은 이유로 원인 1에 해당하는 실패에서도 "이 데이터는 백엔드 직군에 한정된 수치는 아닙니다"류 헷지가 반복됐는데, 그 자체는 정직한 태도지만 문장이 매번 비슷한 톤으로 반복되니 기계적으로 느껴졌다.

## 오늘 적용한 조치

`_SYNTH_SYSTEM`에 두 규칙을 추가했다.

- "제공된 데이터에 따르면", "주어진 사실에는" 류 메타 표현을 금지하고, "국내 채용 공고들을 종합한 결과," 같은 자연스러운 표현을 예시로 제시했다.
- 이 서비스가 IT와 개발자 채용 공고만 다룬다는 전제를 명시해, "IT 공고만 집계한 수치는 아니다" 같은 무의미한 헷지를 제거했다. 직군, 연차, 회사규모, 연봉처럼 실제로 데이터에 없는 조건에 대한 한계 고지는 계속 허용한다.

적용 뒤 같은 질문들을 다시 던져 확인했다. IT 헷지 제거는 재현한 모든 케이스(#8 판교, #5 스타트업/대기업)에서 사라졌고, 메타 표현도 대부분 "국내 채용 공고 데이터를 분석한 결과," 같은 자연스러운 문장으로 바뀌었다. 다만 완전히는 아니다. "리모트 근무 가능한 개발자 공고 있어?"(#11)처럼 근거가 사실상 하나도 없는 질문에서는 "현재 제공된 데이터에는 ~정보가 포함되어 있지 않습니다"처럼 금지 목록에 정확히 없는 근접 변형이 다시 나왔다. 온도(temperature=0.3)를 쓰는 생성형 응답이라 문구를 프롬프트[^3]만으로 100퍼센트 결정론적으로 막기는 어렵고, 남은 재발은 낮은 빈도로 감수하거나 후처리 검증을 추가하는 다음 단계가 필요하다.

이 조치는 원인 4를 직접 겨냥한다. 원인 1~3은 프롬프트 문구로 고칠 수 있는 범위를 넘어서는 구조적 문제라 이번에는 손대지 않았고, 아래에 우선순위와 함께 남겨둔다.

## 남은 과제

| 원인 | 심각도 | 손볼 범위 | 상태 |
|---|---|---|---|
| 1. 8-intent 단일 디스패치, 재질의 없음 | 높음 | router.py + pipeline.py + evaluator.py 재설계 | **부분 완료(같은 날 후속 조치).** 재질의 루프는 여전히 없지만, 직군, 신입 여부 두 축을 새로 추가해 실패 사례 다수를 재질의 없이도 해소했다. 연봉, 회사규모, 원격근무는 데이터 자체가 없어 여전히 불가능. 아래 "같은 날 후속 조치" 절 참고 |
| 2. vector 폴백 오표시 | 중간 | pipeline.py 15줄 내외 | **완료(같은 날 후속 조치)** |
| 2-부속. 의미검색 자체가 꺼져 있음 | 판단 필요 | config.py 플래그 1줄 | **완료(같은 날 후속 조치).** 켰을 뿐 아니라, 켜는 과정에서 별도의 잠복 버그(아래 참고)도 함께 잡았다 |
| 3. 신뢰도 배지가 적합도 미반영 | 중간 | pipeline.py + schemas.py | **완료(같은 날 후속 조치)** |
| 4. 메타 표현과 과잉 헷지 | 낮음(완료) | synthesis.py | 완료 |
| 5(신규). "정보 없음" 답에도 도구 성공 시 confidence, degraded가 그대로 높게 나옴 | 중간 | evaluator.py + synthesis.py | 미착수. 오늘 발견. skill_demand처럼 도구는 정상 실행됐지만 질문이 원한 축(연봉 등)은 애초에 답할 수 없는 경우, `fell_back`로는 못 잡는다. evaluator가 "사실이 질문에 실제로 부합하는지"까지 판정하도록 확장해야 함 |

## 같은 날 후속 조치 (2026-07-14, 같은 세션 이어서)

사용자가 "vector search를 켜고 아픈 지점 3가지도 지금 손보자"고 요청해서, 위 표의 원인 1~3을 같은 세션에서 이어 처리했다.

### Vector search를 켜는 과정에서 발견한 잠복 버그

`enable_vector_search`를 프로덕션에 켜기 전에, GCP Compute Engine 사양(`e2-standard-2`, 7.8GB RAM, 여유 4.5GB 확인)부터 점검하고 여유가 충분함을 확인한 뒤 플래그를 켰다. 그런데 실제로 켜고 나서야 더 근본적인 문제가 드러났다. `embedder.py`가 쓰던 `fastembed` 라이브러리는 `BAAI/bge-m3`를 애초에 지원하지 않았다(0.7.4와 최신 0.8.0 둘 다 `ValueError: Model BAAI/bge-m3 is not supported`). 이 예외는 `except Exception: _load_failed = True`에 걸려 조용히 삼켜지고 있었다. 즉 `enable_vector_search`가 꺼져 있어서 발현되지 않았을 뿐, 이 경로는 배포된 이후 단 한 번도 실제로 성공한 적이 없었다.

저장된 `posting_embedding`(565,191건)을 실제로 만든 라이브러리를 추적해보니(로컬 GPU 작업에 쓰인 venv를 조사) `sentence-transformers`였다. 그래서 `embedder.py`를 fastembed 대신 `sentence-transformers`로 교체했다. 이러면 쿼리 임베딩과 저장된 공고 임베딩이 완전히 같은 라이브러리, 같은 모델로 만들어져 벡터 공간이 확실히 일치한다. 로컬 dev에서 이미지를 재빌드해 검증했고, "머신러닝 관련 공고 추천해줘", "쿠버네티스 관련 공고 찾아줘" 같은 질문에 실제로 65~68% 유사도로 관련성 높은 공고들이 반환되는 것을 확인했다.

이 발견은 원인 2를 다루면서 나온 부산물이었다. 처음엔 "플래그만 켜면 된다"고 생각했지만, 실제로 켜보지 않았다면 라이브러리가 애초에 그 모델을 지원하지 않는다는 사실 자체를 몰랐을 것이다. 설정값 하나를 바꾸는 작업도 실제로 실행 경로를 타 봐야 검증이 끝난다는 원칙을 다시 확인했다.

### 도구 배지 오표시 + confidence 적합도 반영

원인 2와 3은 함께 고쳤다. 각 도구(`sql_tool`, `graph_tool`, `vector_tool`)가 반환하는 dict 최상위에 `"tool": "sql"|"graph"|"vector"`를 명시적으로 추가해, `pipeline.py`가 계획된 도구(`p.tools[0]`)가 아니라 실제 실행된 도구를 배지로 표시하게 했다. 동시에 `_dispatch`가 `fell_back`(의도된 도구가 대상을 못 찾아 일반 랭킹으로 강제 대체됐는지) 신호를 반환하도록 바꿔, 이 경우 confidence를 표본 크기와 무관하게 상한 2로 낮추고 `degraded=True`로 표시하게 했다. "스타트업이랑 대기업 채용 공고 기술 스택 차이가 있어?" 같은 질문은 수정 전 `confidence: 5(높음)`였다가 수정 후 `confidence: 2`로 정직하게 낮아졌고, 폴백이 없는 정상 케이스("React 배우면 뭘 같이 알아야 해?")는 그대로 `confidence: 5`를 유지하는 것으로 회귀 없음을 확인했다.

### 직군, 신입 여부 엔티티 축 추가

원인 1은 재질의 루프 전체를 새로 짜는 대신, DB를 먼저 조사해 실현 가능한 범위를 좁혔다. `posting_category.category`(자유 텍스트 컬럼)에 이미 "서버/백엔드 개발자", "데이터엔지니어", "프론트엔드 개발자" 같은 구체적인 직군명이 들어 있고, `posting.career_min = 0`인 공고가 117,186건으로 신입 신호로 쓸 만하다는 걸 확인했다. 반면 연봉, 회사규모, 원격근무는 `posting` 테이블에 대응 컬럼 자체가 없어 여전히 불가능하다.

그래서 router.py의 엔티티 추출에 `job_category`와 `entry_level` 두 축을 추가하고, `sql_tool.py`의 `top_skills`/`top_certs`/`skill_demand`가 이 필터를 받아 `posting_category` 조인과 `career_min = 0` 조건을 적용하도록 확장했다. 구현 과정에서 `posting_category`가 공고당 평균 1.87개 행(최대 9개)을 갖는다는 걸 확인했는데, 이 상태로 단순 JOIN만 붙이면 `COUNT(*)` 집계가 부풀려지므로 카테고리 필터가 있을 때는 `COUNT(DISTINCT posting_id)`로 바꿔 정확도를 지켰다.

실제로 재검증한 결과, "신입 백엔드 개발자는 보통 어떤 기술 스택을 요구받아?"는 이제 전체 565,191건이 아니라 신입 백엔드로 좁힌 1,185건을 근거로 JavaScript(39.9%), AWS(37.9%), Java(32.7%) 순으로 정확히 답한다. "가장 많이 요구되는 자격증 top 5"처럼 필터가 없는 질문은 수정 전과 동일하게 전체 565,191건 기준으로 답해 회귀가 없음을 확인했다.

이 축 추가로 못 잡는 케이스도 명확히 남아 있다. "Python이랑 Java 중 연봉이 더 높아?"는 라우터가 Python을 스킬로 정확히 인식해 `skill_demand`가 정상 실행되므로 애초에 폴백 경로를 타지 않는다. 그런데도 답은 "연봉 데이터가 없다"로 나온다. 이건 `fell_back` 신호의 문제가 아니라, confidence와 degraded가 "도구 실행이 성공했는지"만 보고 "질문이 실제로 원하는 답을 얻었는지"는 보지 않는 `evaluator.py`/`synthesis.py` 쪽의 더 근본적인 갭이다. 오늘은 손대지 않았고, 다음 라운드 후보로 남긴다.

## 배운 점

이번 감사에서 가장 크게 배운 것은, 겉보기엔 흩어져 보이는 "답이 이상하다"는 느낌이 실제로는 소수의 구조적 지점에서 반복적으로 새어 나온다는 점이다. 18개 질문의 답을 하나씩 고쳐야 할 것 같았지만, 실제로는 도구가 한 번만 실행되는 구조, 꺼진 벡터 검색, 표본 크기만 보는 신뢰도 계산, 이 셋이 겹쳐서 대부분의 실패를 설명했다. 증상을 낱개로 손대기 전에 실제 요청을 대량으로 던져 패턴을 먼저 잡는 방식이, 이번에도 문제의 뿌리를 빠르게 좁히는 데 유효했다.

또 하나는 UI에 노출되는 메타데이터(여기서는 도구 배지)도 실제 실행 경로와 어긋날 수 있다는 점이다. 답변 텍스트만 읽었다면 원인 2를 놓쳤을 것이고, 원본 JSON의 `steps` 배열까지 내려가 봐서야 `tool: "vector"`와 `label: "수요 상위 기술"`이라는 모순을 잡을 수 있었다. 답변 품질을 감사할 때는 최종 텍스트뿐 아니라 그 답이 만들어진 경로 전체를 펼쳐봐야 한다는 원칙을 다시 확인했다.

[^1]: RAG: 거대 언어 모델이 학습하지 않은 최신 외부 데이터를 검색하여 답변의 근거로 활용하는 기술
[^2]: 벡터: 인공지능이 데이터 간의 유사도를 비교하기 위해 사용하는 다차원의 숫자 리스트
[^3]: 프롬프트: 언어모델에게 원하는 작업을 지시하기 위해 입력으로 넣는 텍스트
