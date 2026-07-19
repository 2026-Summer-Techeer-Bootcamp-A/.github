// handleSummary(data) 팩토리. 카탈로그의 엔드포인트별 커스텀 메트릭(ep_*_duration,
// ep_*_failed)을 읽어 사람이 읽기 좋은 고정폭 텍스트 테이블로 만들고, 동시에 같은
// 내용을 JSON으로 이 폴더(k6/)의 results/에 저장한다.
//
// k6는 handleSummary가 리턴한 객체의 각 key를 파일 경로로, value를 그 파일 내용으로
// 보고 그대로 써준다(내장 기능, fs 모듈이 따로 필요 없다). stdout 키는 터미널에 그대로
// 출력된다. JSON 저장 경로는 실행 시점 CWD 기준 상대경로인데, k6에는 __dirname 같은
// 스크립트 위치 기준 경로를 구할 방법이 없어서 "이 k6/ 폴더 안에서 실행한다"는 README의
// 관례에 맞춰 짧게(results/...) 하드코드했다. 이 폴더를 통째로 다른 곳에 복사해도(팀원
// 공유 등) 항상 같은 위치(k6/results/)에 저장되도록 저장소 루트 기준 경로는 쓰지 않는다.
import { ENDPOINTS } from "./catalog.js";

function fmt(num, digits = 1) {
  if (num === undefined || num === null || Number.isNaN(num)) {
    return "-";
  }
  return num.toFixed(digits);
}

function padRight(value, width) {
  const s = String(value);
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function padLeft(value, width) {
  const s = String(value);
  return s.length >= width ? s : " ".repeat(width - s.length) + s;
}

// http_req_duration{phase:baseline} 같은 태그 조합 키에서 phase 값을 뽑는다.
// 지금은 spike.js만 { phase } 태그를 쓰지만, 이 로직 자체는 phase 태그가 붙은
// 어떤 스크립트의 데이터에도 범용으로 동작한다 — 해당 키가 data.metrics에 없으면
// (threshold로 참조되지 않았거나, 애초에 이 스크립트가 phase 태그를 안 썼으면)
// 매칭이 없어서 자동으로 스킵된다. k6는 threshold에서 참조된 태그 조합만
// end-of-test summary에 별도 서브 메트릭으로 노출하므로, 이 서브 메트릭들에는
// count 필드가 아예 없을 수 있다(그래서 avg/p95/error%만 다룬다).
const PHASE_DURATION_KEY = /^http_req_duration\{phase:([^}]+)\}$/;
const PHASE_FAILED_KEY = /^http_req_failed\{phase:([^}]+)\}$/;

// spike.js가 쓰는 phase 이름은 시간 순서(baseline → spike → recovery)로 읽는 게
// 자연스럽다. 이 목록에 없는 phase 이름(다른 스크립트가 나중에 다른 이름을 쓰는
// 경우)은 알파벳순으로 뒤에 붙는다 — 하드코딩된 스크립트 전용 로직이 아니라
// 정렬 우선순위 힌트일 뿐이다.
const PHASE_ORDER_HINT = ["baseline", "spike", "recovery"];

function buildPhaseRows(metrics) {
  const phases = new Set();
  for (const key of Object.keys(metrics)) {
    const match = PHASE_DURATION_KEY.exec(key);
    if (match) {
      phases.add(match[1]);
    }
  }
  // http_req_failed{phase:*}만 있고 duration 쪽이 없는 경우도 대비해 같이 훑는다.
  for (const key of Object.keys(metrics)) {
    const match = PHASE_FAILED_KEY.exec(key);
    if (match) {
      phases.add(match[1]);
    }
  }

  return Array.from(phases)
    .sort((a, b) => {
      const ia = PHASE_ORDER_HINT.indexOf(a);
      const ib = PHASE_ORDER_HINT.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    })
    .map((phase) => {
      const durationMetric = metrics[`http_req_duration{phase:${phase}}`];
      const failedMetric = metrics[`http_req_failed{phase:${phase}}`];
      return {
        phase,
        avgMs: durationMetric ? durationMetric.values.avg : undefined,
        p95Ms: durationMetric ? durationMetric.values["p(95)"] : undefined,
        errorRatePct: failedMetric ? (failedMetric.values.rate || 0) * 100 : undefined,
      };
    });
}

export function buildHandleSummary(testType) {
  return function handleSummary(data) {
    const rows = [];

    for (const ep of ENDPOINTS) {
      const durationMetric = data.metrics[`ep_${ep.name}_duration`];
      const failedMetric = data.metrics[`ep_${ep.name}_failed`];
      // 이번 실행에서 한 번도 호출 안 된 엔드포인트는 스킵한다. Rate 메트릭의
      // passes+fails로 호출 횟수를 센다(Trend 메트릭 자체는 기본
      // summaryTrendStats에 count가 없다).
      if (!durationMetric || !failedMetric) {
        continue;
      }
      const passes = failedMetric.values.passes || 0;
      const fails = failedMetric.values.fails || 0;
      const count = passes + fails;
      if (count === 0) {
        continue;
      }

      rows.push({
        name: ep.name,
        tier: ep.tier,
        count,
        avgMs: durationMetric.values.avg,
        p95Ms: durationMetric.values["p(95)"],
        errorRatePct: (failedMetric.values.rate || 0) * 100,
      });
    }

    const phaseRows = buildPhaseRows(data.metrics);

    const overall = {
      totalRequests: (data.metrics.requests_total && data.metrics.requests_total.values.count) || 0,
      httpReqFailedRate:
        (data.metrics.http_req_failed && data.metrics.http_req_failed.values.rate) || 0,
      httpReqDurationP95:
        (data.metrics.http_req_duration && data.metrics.http_req_duration.values["p(95)"]) || 0,
      vusMax: (data.metrics.vus_max && data.metrics.vus_max.values.value) || 0,
      testRunDurationMs: data.state ? data.state.testRunDurationMs : undefined,
      phases: phaseRows,
    };

    const nameWidth = rows.reduce((max, r) => Math.max(max, r.name.length), "endpoint".length) + 2;
    const header =
      padRight("endpoint", nameWidth) +
      padLeft("count", 8) +
      padLeft("avg(ms)", 10) +
      padLeft("p95(ms)", 10) +
      padLeft("error%", 9);
    const divider = "-".repeat(header.length);

    const lines = [];
    lines.push(`===== k6 ${testType} 결과 요약 =====`);
    lines.push(`총 요청 수: ${overall.totalRequests}`);
    lines.push(`전체 http_req_failed rate: ${fmt(overall.httpReqFailedRate * 100, 2)}%`);
    lines.push(`전체 http_req_duration p95: ${fmt(overall.httpReqDurationP95, 1)}ms`);
    lines.push(`최대 VU: ${overall.vusMax}`);
    lines.push(
      `테스트 총 소요 시간: ${
        overall.testRunDurationMs !== undefined
          ? `${fmt(overall.testRunDurationMs / 1000, 1)}s`
          : "-"
      }`
    );
    lines.push("");
    lines.push(header);
    lines.push(divider);
    for (const row of rows) {
      lines.push(
        padRight(row.name, nameWidth) +
          padLeft(row.count, 8) +
          padLeft(fmt(row.avgMs), 10) +
          padLeft(fmt(row.p95Ms), 10) +
          padLeft(fmt(row.errorRatePct, 2), 9)
      );
    }
    lines.push(divider);

    // phase 태그가 있는 실행(현재는 spike.js)에서만 나타난다. 다른 스크립트는
    // phaseRows가 빈 배열이라 이 블록 전체가 자동으로 스킵된다.
    if (phaseRows.length > 0) {
      const phaseWidth =
        phaseRows.reduce((max, r) => Math.max(max, r.phase.length), "phase".length) + 2;
      const phaseHeader =
        padRight("phase", phaseWidth) +
        padLeft("avg(ms)", 10) +
        padLeft("p95(ms)", 10) +
        padLeft("error%", 9);
      const phaseDivider = "-".repeat(phaseHeader.length);

      lines.push("");
      lines.push("--- phase별 요약(phase 태그 기반, count 없음) ---");
      lines.push(phaseHeader);
      lines.push(phaseDivider);
      for (const row of phaseRows) {
        lines.push(
          padRight(row.phase, phaseWidth) +
            padLeft(fmt(row.avgMs), 10) +
            padLeft(fmt(row.p95Ms), 10) +
            padLeft(fmt(row.errorRatePct, 2), 9)
        );
      }
      lines.push(phaseDivider);
    }

    const text = lines.join("\n");
    console.log(text);

    const jsonPayload = JSON.stringify(
      {
        testType,
        generatedAt: new Date().toISOString(),
        rows,
        overall,
      },
      null,
      2
    );

    return {
      stdout: `${text}\n`,
      // k6가 이 key를 파일 경로로 그대로 쓴다. 경로는 실행 시점의 CWD 기준
      // 상대경로인데, README의 모든 실행 예시가 이 k6/ 폴더 안에서
      // `k6 run smoke.js`처럼 스크립트를 지정하는 방식이라 CWD는 항상 이
      // 폴더다. 그래서 이 폴더 기준 짧은 경로를 하드코드한다(k6에는
      // __dirname 같은 스크립트 위치 기준 경로를 구할 방법이 없다).
      [`results/${testType}-${Date.now()}.json`]: jsonPayload,
    };
  };
}
