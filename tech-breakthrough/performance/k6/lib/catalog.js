// 엔드포인트 카탈로그: smoke/load/stress/breakpoint/spike 다섯 스크립트가 공유하는
// 안전한 GET 엔드포인트 목록이다. 각 항목은 { name, tier, category, weight, build,
// durationMetric, failedMetric } 형태이고, build(fixtures)는 BASE_URL을 제외한
// 나머지 경로(선행 슬래시 포함)를 돌려준다. 실제 요청은 호출부에서
// `taggedGet(name, \`${BASE_URL}${ep.build(fixtures)}\`)` 형태로 조합한다.
//
// tier 분류(부하 강도/성격 기준. thresholds와 pickWeighted 필터링에 쓰인다):
//   infra        - 헬스체크
//   core         - 자주 쓰이는 핵심 조회(공고 목록/상세/피드 등)
//   heavy        - DB에 부담이 큰 조회(지도, 제목 검색)
//   taxonomy     - 기술/자격증/직무 카테고리 등 참조 데이터에 가까운 조회
//   stats        - 통계/트렌드 집계(MV 등 사전 집계 기반이라 상대적으로 가벼움)
//   stats_heavy  - 통계/트렌드 집계 중 posting/tech를 직접 조인해 GROUP BY하는
//                  raw aggregation 쿼리. 로컬 dev 실측(MAX_VUS=20/1분)에서 p95가
//                  4~12초대로 나머지 stats와 자릿수가 달라 별도 tier로 분리했다
//                  (global_domestic_gap, hiring_season, industry_fingerprint,
//                  role_stack_fit, skill_trend_yearly 5개). category는 여전히
//                  "stats"로 둬서 group() 표시는 합쳐서 보인다.
//   external     - 외부 API를 프록시하는 뉴스 엔드포인트(요청 빈도를 낮게 유지해야 함)
//
// category는 tier와 별개로, 스크립트가 k6 group()으로 터미널 로그를 묶어서 보여줄 때
// 쓰는 표시용 분류다(postings/map-search/taxonomy/stats/infra/external).
//
// 주의:
// - news_github(source=github)은 절대 여기 넣지 않는다. 익명 GitHub API는 시간당
//   60회 한도라, 부하테스트가 이를 소진할 위험이 있다(Redis 4시간 캐시가 있어도
//   캐시미스 시 위험은 그대로다).
// - pool을 받는 엔드포인트는 전부 pool=domestic을 명시적으로 고정한다. 코드 자체
//   버그(파라미터 하드 리밋 초과)는 이미 고쳐졌지만, pool 없이 부르면 여전히
//   무필터 전체 스캔이라 위험하다는 게 팀 조사 결론이다.
// - skills만 예외적으로 /api/v1 프리픽스가 없다(app/main.py에서 skills_router가
//   prefix 없이 include_router된다).
// - 아래 목록에 없는 엔드포인트(match/*, cert/gap, stats/skill-unlock, admin/*,
//   auth/*, resume/*, chat, /api/db/*, 그리고 모든 POST/PUT/DELETE)는 절대 추가하지
//   않는다. README.md의 "절대 건드리지 말 것" 섹션에 이유가 적혀 있다.

import { Trend, Rate, Counter } from "k6/metrics";

// 전체 요청 수를 세는 카운터. request.js가 taggedGet 안에서 endpoint 태그와 함께 채운다.
export const requestsTotal = new Counter("requests_total");

function endpoint(name, tier, category, weight, build) {
  return {
    name,
    tier,
    category,
    weight,
    build,
    durationMetric: new Trend(`ep_${name}_duration`),
    failedMetric: new Rate(`ep_${name}_failed`),
  };
}

export const ENDPOINTS = [
  endpoint("healthz", "infra", "infra", 2, () => "/healthz"),

  endpoint(
    "postings_list",
    "core",
    "postings",
    15,
    () => "/api/v1/postings?pool=domestic&page=1&page_size=25"
  ),
  endpoint(
    "postings_search",
    "heavy",
    "map-search",
    4,
    (f) => `/api/v1/postings?pool=domestic&q=${encodeURIComponent(f.postingQuery)}&page_size=10`
  ),
  endpoint("postings_detail", "core", "postings", 10, (f) => `/api/v1/postings/${f.postingId}`),
  endpoint(
    "postings_nearby",
    "core",
    "postings",
    5,
    (f) => `/api/v1/postings/${f.postingId}/nearby`
  ),
  endpoint(
    "postings_similar",
    "core",
    "postings",
    5,
    (f) => `/api/v1/postings/${f.postingId}/similar`
  ),
  endpoint(
    "postings_map",
    "heavy",
    "map-search",
    6,
    // 서울 바운딩박스. 값 자체가 고정 리터럴이라 encodeURIComponent 불필요.
    () => "/api/v1/postings/map?pool=domestic&bbox=126.76,37.41,127.18,37.70"
  ),
  endpoint("feed_postings", "core", "postings", 10, () => "/api/v1/feed/postings?page_size=20"),
  endpoint(
    "search",
    "core",
    "map-search",
    8,
    (f) => `/api/v1/search?q=${encodeURIComponent(f.searchQuery)}&limit=5`
  ),

  endpoint("skills", "taxonomy", "taxonomy", 6, () => "/skills?limit=20"),
  endpoint("job_categories", "taxonomy", "taxonomy", 4, () => "/api/v1/job-categories"),
  endpoint("certs", "taxonomy", "taxonomy", 3, () => "/api/v1/certs"),
  endpoint(
    "company_by_skill",
    "taxonomy",
    "taxonomy",
    4,
    (f) => `/api/v1/company/by-skill?skill=${encodeURIComponent(f.skillName)}`
  ),

  endpoint(
    "trend_hype_vs_hire",
    "stats",
    "stats",
    2,
    (f) => `/api/v1/trend/hype-vs-hire?skill=${encodeURIComponent(f.skillName)}`
  ),
  endpoint("stats_newcomer_gate", "stats", "stats", 2, () => "/api/v1/stats/newcomer-gate"),
  endpoint(
    "stats_global_domestic_gap",
    "stats_heavy",
    "stats",
    2,
    () => "/api/v1/stats/global-domestic-gap"
  ),
  endpoint(
    "stats_hiring_season",
    "stats_heavy",
    "stats",
    2,
    () => "/api/v1/stats/hiring-season"
  ),
  endpoint(
    "stats_industry_fingerprint",
    "stats_heavy",
    "stats",
    2,
    () => "/api/v1/stats/industry-fingerprint"
  ),
  endpoint(
    "stats_role_stack_fit",
    "stats_heavy",
    "stats",
    2,
    () => "/api/v1/stats/role-stack-fit?pool=domestic"
  ),
  endpoint(
    "stats_skill_share",
    "stats",
    "stats",
    2,
    () => "/api/v1/stats/skill-share?pool=domestic"
  ),
  endpoint(
    "stats_cooccurrence",
    "stats",
    "stats",
    2,
    () => "/api/v1/stats/cooccurrence?pool=domestic"
  ),
  endpoint(
    "stats_posting_timeline",
    "stats",
    "stats",
    2,
    () => "/api/v1/stats/posting-timeline?pool=domestic"
  ),
  endpoint(
    "stats_response_rate",
    "stats",
    "stats",
    2,
    () => "/api/v1/stats/response-rate?pool=domestic"
  ),
  endpoint(
    "stats_skill_trend_yearly",
    "stats_heavy",
    "stats",
    2,
    () => "/api/v1/stats/skill-trend-yearly?pool=domestic"
  ),
  endpoint(
    "stats_hot_companies",
    "stats",
    "stats",
    2,
    () => "/api/v1/stats/hot-companies?pool=domestic"
  ),
  endpoint(
    "stats_region_density",
    "stats",
    "stats",
    2,
    () => "/api/v1/stats/region-density?pool=domestic"
  ),
  endpoint("trend_github_vitality", "stats", "stats", 2, () => "/api/v1/trend/github-vitality"),
  endpoint("trend_github_topics", "stats", "stats", 2, () => "/api/v1/trend/github-topics"),
  endpoint(
    "trend_github_chronicle",
    "stats",
    "stats",
    2,
    () => "/api/v1/trend/github-chronicle"
  ),

  endpoint(
    "news_hackernews",
    "external",
    "external",
    1,
    () => "/api/v1/news?source=hackernews&limit=5"
  ),
  endpoint(
    "news_geeknews",
    "external",
    "external",
    1,
    () => "/api/v1/news?source=geeknews&limit=5"
  ),
];
