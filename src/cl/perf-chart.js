/* 성과 › 누적 수익률 차트 — 0 위는 --rise, 아래는 --fall 선 + 0까지 엷어지는 같은 색 면. */
import { hintSeen, markHint, monthTicks, niceTicks, vGrid } from "./charts.js";
import { isoMs } from "./format.js";

/**
 * main = 운용 수익률(%) 배열, extra = [{v, cls, dy}] 보조 선.
 * hover(i) = 툴팁 HTML, read(i) = 모바일 읽기 줄 HTML, label = 낭독 요약.
 */
export function returnsChart(host, W, { dates, main, extra = [], H, yFmt, endFmt, evIndex = [], hover, read, label }) {
  const N = dates.length;
  host.removeAttribute("role");
  host.removeAttribute("aria-label");
  host.onkeydown = null;
  host.onblur = null;
  if (N < 2) { host.removeAttribute("tabindex"); host.innerHTML = `<p class="cl-goal-note">데이터 없음</p>`; return; }
  const m = { l: W < 520 ? 48 : 60, r: endFmt ? 64 : 12, t: 12, b: 28 }, pb = H - m.b;
  let lo = 0, hi = 0;
  [main, ...extra.map((s) => s.v)].forEach((vs) => vs.forEach((v) => { if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }));
  const pad = (hi - lo) * 0.08 || 1;
  lo -= pad; hi += pad;
  const xs = dates.map((_, i) => m.l + (i / (N - 1)) * (W - m.l - m.r));
  const y = (v) => m.t + ((hi - v) / (hi - lo)) * (pb - m.t);
  const y0 = y(0);
  let g = vGrid(dates.map(isoMs), xs, m.t, pb);
  (H < 150 ? niceTicks(lo, hi, 3, 4) : niceTicks(lo, hi)).forEach((t) => {
    if (Math.abs(t) > 1e-9) g += `<line class="cl-grid-l" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/>`;
    g += `<text class="cl-ax" x="${m.l - 10}" y="${y(t) + 4}" text-anchor="end">${yFmt(t)}</text>`;
  });
  const xl = monthTicks(dates, (i) => xs[i], pb + 20);
  const id = "pr" + Math.random().toString(36).slice(2, 7);
  const line = (vs) => vs.map((v, i) => (i ? "L" : "M") + xs[i].toFixed(1) + "," + y(v ?? 0).toFixed(1)).join("");
  const lmain = line(main);
  const area = `${lmain}L${xs[N - 1].toFixed(1)},${y0.toFixed(1)}L${xs[0].toFixed(1)},${y0.toFixed(1)}Z`;
  // 0 위·아래 클립 — 선 두께만큼 여유를 둬 0 근처에서 끊기지 않게
  const defs = `<clipPath id="${id}u"><rect x="0" y="-20" width="${W}" height="${(y0 + 20).toFixed(1)}"/></clipPath>
    <clipPath id="${id}d"><rect x="0" y="${y0.toFixed(1)}" width="${W}" height="${(H - y0 + 20).toFixed(1)}"/></clipPath>
    <linearGradient id="${id}gu" gradientUnits="userSpaceOnUse" x1="0" y1="${y(hi)}" x2="0" y2="${y0}"><stop offset="0" style="stop-color:var(--rise);stop-opacity:.30"/><stop offset="1" style="stop-color:var(--rise);stop-opacity:.02"/></linearGradient>
    <linearGradient id="${id}gd" gradientUnits="userSpaceOnUse" x1="0" y1="${y(lo)}" x2="0" y2="${y0}"><stop offset="0" style="stop-color:var(--fall);stop-opacity:.30"/><stop offset="1" style="stop-color:var(--fall);stop-opacity:.02"/></linearGradient>`;
  const fills = `<path d="${area}" fill="url(#${id}gu)" clip-path="url(#${id}u)"/><path d="${area}" fill="url(#${id}gd)" clip-path="url(#${id}d)"/>`;
  const others = extra.map((s) => `<path class="${s.cls}" d="${line(s.v)}"/>`).join("");
  const lines = `<g clip-path="url(#${id}u)"><path class="cl-l-accent cl-perf-l cl-perf-l-up" d="${lmain}"/></g><g clip-path="url(#${id}d)"><path class="cl-l-accent cl-perf-l cl-perf-l-down" d="${lmain}"/></g>`;
  const tone = (v) => ((v ?? 0) >= 0 ? "rise" : "fall");
  let ends = "";
  if (endFmt) {
    const lab = [{ v: main[N - 1], c: tone(main[N - 1]), dy: 0 }, ...extra.map((s) => ({ v: s.v[N - 1], c: "muted", dy: s.dy || 0 }))];
    // 끝 라벨이 13px 안으로 겹치면 밀어낸다
    const ys = lab.map((o) => y(o.v ?? 0) + 4 + o.dy);
    lab.forEach((o, k) => {
      for (let j = 0; j < k; j++) if (Math.abs(ys[k] - ys[j]) < 13) ys[k] = ys[j] + (ys[k] >= ys[j] ? 13 : -13);
      const ex = xs[N - 1], ey = y(o.v ?? 0);
      ends += `<circle class="cl-end-ring" cx="${ex}" cy="${ey}" r="4.5" style="stroke:var(--${o.c})"/><text class="cl-end-label" x="${ex + 9}" y="${ys[k]}" style="fill:var(--${o.c})">${endFmt(o.v ?? 0)}</text>`;
    });
  }
  const evm = evIndex.map((i) => `<circle class="cl-ev-ring" cx="${xs[i]}" cy="${y(main[i] ?? 0)}" r="5"/>`).join("");
  const lastRead = read ? read(N - 1) : "";
  host.setAttribute("role", "group");
  if (label) host.setAttribute("aria-label", `${label} 좌우 화살표로 날짜를 옮깁니다.`);
  host.innerHTML = `${read ? `<div class="cl-readout" aria-live="polite">${hintSeen() ? lastRead : "눌러서 날짜별 값 보기"}</div>` : ""}
  <svg viewBox="0 0 ${W} ${H}" height="${H}" aria-hidden="true"><defs>${defs}</defs>${g}${fills}
    <line class="cl-base-l" x1="${m.l}" x2="${W - m.r}" y1="${y0}" y2="${y0}"/>${others}${lines}${evm}${ends}${xl}
    <g class="xh" style="display:none"><line class="cl-cross" y1="${m.t}" y2="${pb}"/><circle class="cl-dot-a" r="4.5"/></g></svg>${hover ? '<div class="cl-tip" hidden></div>' : ""}`;
  if (!hover) return;
  const svg = host.querySelector("svg"), xh = host.querySelector(".xh"), tip = host.querySelector(".cl-tip"), ro = host.querySelector(".cl-readout");
  const [ln, dot] = xh.children;
  // ki = N: 첫 ← 가 마지막 날짜부터
  let pinned = -1, ki = N;
  const show = (i, say = true) => {
    const X = xs[i];
    xh.style.display = "";
    ln.setAttribute("x1", X); ln.setAttribute("x2", X);
    dot.setAttribute("cx", X); dot.setAttribute("cy", y(main[i] ?? 0));
    dot.style.fill = `var(--${tone(main[i])})`;
    tip.hidden = false;
    tip.innerHTML = hover(i);
    const tw = tip.offsetWidth, roH = ro ? ro.offsetHeight : 0;
    tip.style.left = (X + 14 + tw > W ? Math.max(0, X - 14 - tw) : X + 14) + "px";
    tip.style.top = 8 + roH + "px";
    if (ro && say) ro.innerHTML = read(i); // 마우스 hover 는 낭독하지 않는다
  };
  const hide = () => { if (pinned >= 0) return; xh.style.display = "none"; tip.hidden = true; };
  const idxAt = (cx) => {
    const r = svg.getBoundingClientRect(), X = ((cx - r.left) / r.width) * W;
    return Math.min(N - 1, Math.max(0, Math.round(((X - m.l) / (W - m.l - m.r)) * (N - 1))));
  };
  svg.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") show(idxAt(e.clientX), false); });
  svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hide(); });
  svg.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    markHint();
    const i = idxAt(e.clientX);
    if (pinned === i) { pinned = -1; hide(); if (ro) ro.innerHTML = lastRead; } else { pinned = i; show(i); }
  });
  host.tabIndex = 0;
  host.onkeydown = (e) => {
    if (e.key === "ArrowLeft") ki = Math.max(0, Math.min(N, ki) - 1);
    else if (e.key === "ArrowRight") ki = Math.min(N - 1, ki + 1);
    else if (e.key === "Home") ki = 0;
    else if (e.key === "End") ki = N - 1;
    else if (e.key === "Escape") { pinned = -1; hide(); if (ro) ro.innerHTML = lastRead; return; }
    else return;
    e.preventDefault();
    show(ki);
  };
  host.onblur = () => { pinned = -1; ki = N; hide(); if (ro) ro.innerHTML = lastRead; };
}
