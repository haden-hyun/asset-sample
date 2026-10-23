/* 샘플 빌드 전용 /api 대체 — 서버 대신 /fixtures/ 의 미리 뜬 응답을 돌려준다(api.js 의 VITE_SAMPLE 분기만 부른다).
 *
 * 키 = 경로(디코드) + 키·값 순으로 정렬한 쿼리. scripts/sample/dump.py 의 fixture_key 와 같은 규칙이다.
 * 없는 키(사용자 지정 기간 등)는 같은 경로에서 가장 가까운 조합(프리셋·날짜·금액이 가까운 쪽)으로 대신하고 console.warn.
 * 쓰기(목표 저장·계획 확정·수기 입력)는 403. 리밸런싱 미리보기(POST plan)는 본문 필드를 쿼리처럼 붙인 키로 찾는다.
 * 로그인·로그아웃은 늘 성공하고 /auth/me 는 늘 200 이라 새로고침하면 다시 들어온다.
 */
import { ApiError } from "./api.js";

const BASE = "/fixtures/";
const READ_ONLY = "샘플 사이트에서는 저장되지 않습니다";
const DATE_KEYS = new Set(["date_from", "date_to", "from", "to"]);
const ORDER = ["1w", "1m", "3m", "6m", "ytd", "1y", "all", "hold"];

let indexP = null;
const bodies = new Map();

function loadIndex() {
  indexP ||= fetch(`${BASE}index.json`).then((r) => {
    if (!r.ok) throw new ApiError(503, "샘플 데이터를 불러오지 못했습니다");
    return r.json();
  });
  return indexP;
}

/** (경로, [[키, 값]]) → 픽스처 키 */
export function fixtureKey(path, params) {
  const q = [...params].sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`).join("&");
  return decodeURIComponent(path) + (q ? `?${q}` : "");
}

function split(key) {
  const i = key.indexOf("?");
  return i < 0 ? [key, []] : [key.slice(0, i), [...new URLSearchParams(key.slice(i + 1))]];
}

const days = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;

/** 요청 쿼리와 후보 쿼리의 거리 — 다른 값은 크게, 날짜·프리셋·금액은 가까울수록 작게 */
function distance(want, have) {
  const w = Object.fromEntries(want), h = Object.fromEntries(have);
  let s = 0;
  for (const k of new Set([...Object.keys(w), ...Object.keys(h)])) {
    const a = w[k], b = h[k];
    if (a === b) continue;
    if (a == null || b == null) s += 500;
    else if (DATE_KEYS.has(k) && !isNaN(Date.parse(a)) && !isNaN(Date.parse(b))) s += days(a, b);
    else if (ORDER.includes(a) && ORDER.includes(b)) s += 10 * Math.abs(ORDER.indexOf(a) - ORDER.indexOf(b));
    else if (isFinite(+a) && isFinite(+b) && +a > 0 && +b > 0) s += 10 * Math.abs(Math.log(+a / +b));
    else s += 1000;
  }
  return s;
}

async function lookup(path, params) {
  const index = await loadIndex();
  const key = fixtureKey(path, params);
  let hit = index[key];
  if (!hit) {
    const [p] = split(key);
    let best = null, bestS = Infinity;
    for (const k of Object.keys(index)) {
      const [kp, kq] = split(k);
      if (kp !== p) continue;
      const s = distance(params, kq);
      if (s < bestS) [best, bestS] = [k, s];
    }
    if (!best) throw new ApiError(404, "샘플 데이터에 없는 화면입니다");
    console.warn(`[sample] 픽스처 없음: ${key} → ${best}`);
    hit = index[best];
  }
  if (!bodies.has(hit.f)) {
    bodies.set(hit.f, fetch(`${BASE}${hit.f}`).then((r) => {
      if (!r.ok) throw new ApiError(503, "샘플 데이터를 불러오지 못했습니다");
      return r.json();
    }));
  }
  const body = await bodies.get(hit.f);
  if (hit.s) throw new ApiError(hit.s, body?.detail || "요청을 처리하지 못했습니다");
  return structuredClone(body);
}

export async function request(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const url = new URL(path, "http://sample");
  if (method === "GET") return lookup(url.pathname, [...url.searchParams]);
  if (method === "POST" && (url.pathname === "/auth/login" || url.pathname === "/auth/logout")) return { ok: true };
  if (method === "POST" && /^\/allocation\/[^/]+\/plan$/.test(url.pathname)) {
    const body = JSON.parse(options.body || "{}");
    return lookup(url.pathname, Object.entries(body).map(([k, v]) => [k, String(v)]));
  }
  throw new ApiError(403, READ_ONLY);
}
