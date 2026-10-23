/* 데이터 흐름 공용 — 시각·소요 글, 정기 수집 집계. 흐름 탭(Lineage.jsx)과 신뢰 상세 수집 줄(Shell.jsx)이 쓴다. */
import { md } from "./format.js";

/** ISO 시각 → KST { d, hm } (plusSec 만큼 뒤). 오프셋 없는 값은 KST 로 본다. 읽을 수 없으면 null */
export const kst = (iso, plusSec = 0) => {
  if (!iso) return null;
  const s = String(iso);
  const naive = !/(Z|[+-]\d\d:?\d\d)$/i.test(s);
  const t = Date.parse(naive ? `${s.slice(0, 19).replace(" ", "T")}Z` : s);
  const o = new Date(t + (Number(plusSec) || 0) * 1e3 + (naive ? 0 : 9 * 36e5));
  if (Number.isNaN(o.getTime())) return null;
  const x = o.toISOString();
  return { d: x.slice(0, 10), hm: x.slice(11, 16) };
};
/** 기준 날짜(ref)와 같은 날이면 hh:mm, 아니면 m/d hh:mm */
export const at = (iso, ref, plusSec) => {
  const k = kst(iso, plusSec);
  return !k ? null : k.d === ref ? k.hm : `${md(k.d)} ${k.hm}`;
};
/** 응답의 기준 날짜(KST) */
export const refDay = (d) => kst(d?.generated_at)?.d ?? null;
/** 초 → "1분 12초" · "4초" · "1.9초" */
export const dur = (s) => {
  if (!Number.isFinite(s) || s < 0) return null;
  if (s < 60) return `${Math.round(s * 10) / 10}초`;
  const r = Math.round(s);
  return `${Math.floor(r / 60)}분${r % 60 ? ` ${r % 60}초` : ""}`;
};
/** 실패 시각 = 시작 + 소요(없으면 시작) */
export const failAt = (n, ref) => (n.fields?.last_start ? at(n.fields.last_start, ref, n.fields.duration_s || 0) : null);

/** 수집 노드 집계 — dags 전체 · reg 정기 · known 정기 중 상태를 아는 것 · ok 정상 수 */
export function collectStats(nodes) {
  const dags = (nodes || []).filter((n) => n.kind === "dag");
  const reg = dags.filter((n) => n.fields?.schedule);
  const known = reg.filter((n) => n.state !== "unknown");
  return { dags, reg, known, ok: known.filter((n) => n.state === "ok").length };
}
