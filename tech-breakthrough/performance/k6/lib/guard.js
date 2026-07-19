// 프로덕션 오인 실행 방지 가드. stress/breakpoint/spike처럼 서버에 실제로 부담을
// 주는 목적의 테스트는 이 함수를 모듈 최상단(초기화 컨텍스트)에서 호출해서,
// VU가 뜨기도 전에 즉시 에러를 던져 실행 자체를 막는다. smoke/load는 프로덕션에서도
// 소규모로 돌릴 수 있어야 하므로 이 가드를 넣지 않는다.
const PROD_HOSTS = ["duckdns.org"];

export function guardAgainstProd(baseUrl) {
  const isProd = PROD_HOSTS.some((h) => baseUrl.includes(h));
  const confirmed = __ENV.I_UNDERSTAND_PROD_RISK === "yes";
  if (isProd && !confirmed) {
    throw new Error(
      "stress/breakpoint/spike 테스트는 프로덕션(2 vCPU/8GB API + 1 vCPU/3.75GB DB)에서 " +
        "기본적으로 실행이 금지되어 있습니다. 실제 사용자와 데모에 장애를 일으킬 수 있습니다. " +
        "정말 필요하면 팀과 사전에 협의하고 -e I_UNDERSTAND_PROD_RISK=yes 로 명시적으로 재확인하세요."
    );
  }
}
