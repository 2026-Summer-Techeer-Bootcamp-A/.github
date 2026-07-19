// setup()에서 한 번만 호출되는 동적 픽스처 조회. GET만 사용해서 postings/skills를
// 하나씩 훑어보고, 실제 존재하는 id와 이름을 뽑아 쓴다. 대상 서버에 데이터가
// 비어 있거나 네트워크 오류가 나도 스크립트가 죽지 않도록, 실패하면 하드코드
// 폴백 값을 쓰고 console.warn으로 남긴다.
import http from "k6/http";

const FALLBACK = {
  postingId: 1,
  postingQuery: "개발",
  skillName: "Python",
  searchQuery: "Python",
};

export function fetchDynamicFixtures(baseUrl) {
  const fixtures = { ...FALLBACK };

  try {
    const res = http.get(`${baseUrl}/api/v1/postings?pool=domestic&page_size=5`);
    if (res.status === 200) {
      const body = res.json();
      const items = body && body.items;
      if (Array.isArray(items) && items.length > 0) {
        const item = items[0];
        if (item && item.id !== undefined && item.id !== null) {
          fixtures.postingId = item.id;
        }
        const titleSource = (item && (item.title || item.company)) || FALLBACK.postingQuery;
        const query = String(titleSource).trim().slice(0, 3);
        fixtures.postingQuery = query.length > 0 ? query : FALLBACK.postingQuery;
      } else {
        console.warn(
          "setupData: /api/v1/postings 응답에 items가 비어 있어 폴백 postingId/postingQuery를 사용합니다."
        );
      }
    } else {
      console.warn(
        `setupData: /api/v1/postings 조회 실패(status=${res.status}), 폴백 postingId/postingQuery를 사용합니다.`
      );
    }
  } catch (err) {
    console.warn(
      `setupData: /api/v1/postings 조회 중 에러(${err}), 폴백 postingId/postingQuery를 사용합니다.`
    );
  }

  try {
    const res = http.get(`${baseUrl}/skills?limit=5`);
    if (res.status === 200) {
      const body = res.json();
      const skills = body && body.skills;
      if (Array.isArray(skills) && skills.length > 0 && skills[0].canonical) {
        fixtures.skillName = skills[0].canonical;
      } else {
        console.warn("setupData: /skills 응답이 비어 있어 폴백 skillName을 사용합니다.");
      }
    } else {
      console.warn(
        `setupData: /skills 조회 실패(status=${res.status}), 폴백 skillName을 사용합니다.`
      );
    }
  } catch (err) {
    console.warn(`setupData: /skills 조회 중 에러(${err}), 폴백 skillName을 사용합니다.`);
  }

  // search 엔드포인트는 별도 픽스처 없이 skillName을 재사용한다.
  fixtures.searchQuery = fixtures.skillName;

  return fixtures;
}
