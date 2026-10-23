/* 배분 › 납입 차트 — 올해 누적 납입 계단 · 균등 페이스 점선 · 한도 가로선 · 오늘 점. x 축 = 1/1 ~ 12/31. */
import { esc } from "./charts.js";
import { axWon, isoMs, krw, niceStep } from "./format.js";

/**
 * 누적 계단 꼭짓점 — 지난 달은 말일, 기준일이 든 달은 기준일에 오른다.
 * rows = [{month:'YYYY-MM', v}] → [{t(ms), cum}] (1/1 0원에서 시작)
 */
function cumSteps(year, asOf, rows) {
  const y0 = Date.UTC(year, 0, 1), aMs = isoMs(asOf), aMon = String(asOf).slice(0, 7);
  const pts = [{ t: y0, cum: 0 }];
  let cum = 0;
  rows.slice().sort((a, b) => a.month.localeCompare(b.month)).forEach((r) => {
    const mo = +r.month.slice(5, 7);
    const end = Math.min(Date.UTC(year, mo, 0), aMs);
    if (r.month > aMon) return;
    cum += r.v;
    pts.push({ t: r.month === aMon ? aMs : end, cum });
  });
  return pts;
}

/** opts = { year, asOf(YYYY-MM-DD), rows:[{month, v}], target(한도, 원), label(낭독 요약) } */
export function drawContrib(host, W, { year, asOf, rows, target, label = "" }) {
  if (!asOf) { host.innerHTML = `<p class="cl-goal-note">납입 없음</p>`; return; }
  if (!target) { host.innerHTML = `<p class="cl-goal-note">한도 없음</p>`; return; }
  const narrow = W < 520;
  const H = narrow ? 190 : 220;
  const m = narrow ? { l: 44, r: 16, t: 22, b: 28 } : { l: 56, r: 24, t: 24, b: 30 };
  const pb = H - m.b;
  const t0 = Date.UTC(year, 0, 1), t1 = Date.UTC(year, 11, 31), aMs = Math.min(t1, Math.max(t0, isoMs(asOf)));
  const pts = cumSteps(year, asOf, rows);
  const now = pts[pts.length - 1].cum;
  const lo = Math.min(0, ...pts.map((p) => p.cum));
  const hiRaw = Math.max(target, now, 1) * 1.06;
  // 가로 격자 4줄(0 포함) — 위 끝을 간격의 배수로 올린다
  const st = niceStep((hiRaw - lo) / 3);
  const hi = Math.max(hiRaw, Math.ceil(hiRaw / st) * st);
  const x = (t) => m.l + ((t - t0) / (t1 - t0)) * (W - m.l - m.r);
  const y = (v) => m.t + ((hi - v) / (hi - lo)) * (pb - m.t);
  let g = "";
  for (let v = Math.ceil(lo / st) * st; v <= hi + 1e-6; v += st)
    g += `<line class="${Math.abs(v) < 1e-6 ? "cl-base-l" : "cl-grid-l"}" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text class="cl-ax" x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${axWon(v)}</text>`;
  // 월 경계 세로 점선 + 월 라벨(좁으면 홀수 달만)
  let mo = "";
  for (let k = 0; k < 12; k++) {
    const a = Date.UTC(year, k, 1), b = Date.UTC(year, k + 1, 1);
    if (k) mo += `<line class="cl-ctb-mgrid" x1="${x(a)}" x2="${x(a)}" y1="${m.t}" y2="${pb}"/>`;
    if (!narrow || k % 2 === 0) mo += `<text class="cl-ax" x="${(x(a) + x(b)) / 2}" y="${pb + 18}" text-anchor="middle">${k + 1}월</text>`;
  }
  const yt = y(target);
  const cap = `<line class="cl-ctb-cap" x1="${m.l}" x2="${W - m.r}" y1="${yt}" y2="${yt}"/><text class="cl-ctb-capl" x="${W - m.r}" y="${yt - 6}" text-anchor="end">한도 ${esc(krw(target))}</text>`;
  // 균등 페이스 — 1/1 0원 → 12/31 한도
  const pace = `<line class="cl-ctb-pace" x1="${x(t0)}" y1="${y(0)}" x2="${x(t1)}" y2="${yt}"/>`;
  // 누적 계단(오른쪽으로 간 뒤 위로)
  let d = `M${x(pts[0].t).toFixed(1)},${y(0).toFixed(1)}`;
  if (pts.length === 1) d += `H${x(aMs).toFixed(1)}`;
  pts.slice(1).forEach((p, i) => { d += `H${x(p.t).toFixed(1)}V${y(p.cum).toFixed(1)}`; if (i === pts.length - 2 && p.t < aMs) d += `H${x(aMs).toFixed(1)}`; });
  const ex = x(aMs), ey = y(now);
  // 끝값 라벨: 오른쪽 여유가 없으면 점 왼쪽, 한도 라벨과 가까우면 아래로(월 라벨 위까지)
  const right = ex + 70 < W - m.r;
  const ly = Math.min(Math.abs(ey - (yt - 6)) < 14 ? ey + 16 : ey - 8, pb - 4);
  const dot = `<circle class="cl-ctb-dot" cx="${ex}" cy="${ey}" r="4.5"/><text class="cl-end-label cl-ctb-endl" x="${right ? ex + 8 : ex - 8}" y="${ly}" text-anchor="${right ? "start" : "end"}">${esc(krw(now))}</text>`;
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(label)}">${g}${mo}${cap}${pace}<path class="cl-ctb-line" d="${d}"/>${dot}</svg>`;
}
