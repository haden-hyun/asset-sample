/* SVG 차트 — host 요소 하나에 innerHTML 로 그린다. 색은 CSS 클래스·토큰으로만 지정한다(라이트/다크 자동). */
import { useEffect, useRef } from "react";
import { axWon, dLabel, dir, isoMs as T0, krw, md, monthOf, niceStep, sKrw, won } from "./format.js";

/** draw(host, width) 를 마운트·deps 변경·폭 변경 때 호출한다. 반환 = host 에 달 ref. */
export function useChart(draw, deps) {
  const ref = useRef(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return undefined;
    let raf = 0, lastW = -1;
    // 폭이 같으면 다시 그리지 않는다 — 그린 결과로 높이가 바뀌어 오는 ResizeObserver 알림은 건너뛴다
    const run = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const w = host.clientWidth;
        if (!w || w === lastW) return;
        lastW = w;
        draw(host, w);
      });
    };
    run();
    const ro = new ResizeObserver(run);
    ro.observe(host);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

/** 월이 바뀌는 자리마다 'n월' 눈금(x(i) = 점 i 의 x). 첫 점은 그달 5일 이전일 때만 단다. */
export const monthTicks = (dates, x, y0) => {
  let xl = "", lm = -1;
  dates.forEach((d, i) => {
    const mo = monthOf(d);
    if (mo !== lm) {
      if (i > 0 || +String(d).slice(8, 10) <= 5)
        xl += `<text class="cl-ax" x="${x(i)}" y="${y0}" text-anchor="${i ? "middle" : "start"}">${mo}월</text>`;
      lm = mo;
    }
  });
  return xl;
};

/**
 * 가로 격자 눈금값 — 1·2·2.5·5×10ⁿ 간격 중 [lo, hi] 안에 max 줄 이하인 가장 촘촘한 간격(min 줄 미만이면 max+2 줄까지 허용).
 * from0 = 0 줄을 빼고 센다(막대 기준선). ok(v) = 라벨이 반올림 없이 읽히는 값만 허용.
 */
export function niceTicks(lo, hi, min = 4, max = 5, from0 = false, ok = null) {
  const at = (st) => {
    const t = [];
    for (let k = Math.ceil(lo / st - 1e-9); k * st <= hi + st * 1e-9; k++) if (!from0 || k) t.push(k ? k * st : 0);
    return t;
  };
  let st = niceStep((hi - lo) / (max + 4)), prev = null;
  for (let n = 0; n < 20; n++) {
    const t = at(st);
    if (ok && !t.every(ok)) { st = niceStep(st * 1.0001); continue; }
    if (t.length <= max) return t.length < min && prev && prev.length <= max + 2 ? prev : t;
    prev = t;
    st = niceStep(st * 1.0001);
  }
  // ok 를 만족하는 간격이 없으면 ok 없이 — 격자가 사라지지 않게
  return prev || (ok ? niceTicks(lo, hi, min, max, from0, null) : []);
}

/** 세로 격자 SVG — 월 경계(40일 이하는 월요일) 점선. ts = 점별 시각(ms), xs = 점별 x. 칸이 좁으면 분기·해 경계만. */
export function vGrid(ts, xs, y1, y2) {
  const N = ts.length, span = ts[N - 1] - ts[0], short = span <= 40 * 864e5;
  const mKey = (d) => d.getUTCFullYear() * 12 + d.getUTCMonth();
  const cand = [];
  let last = mKey(new Date(ts[0]));
  for (let i = 1; i < N; i++) {
    const d = new Date(ts[i]), key = mKey(d);
    if (short ? d.getUTCDay() === 1 : key !== last) cand.push([i, d.getUTCMonth()]);
    last = key;
  }
  const w = xs[N - 1] - xs[0], gap = w / (cand.length + 1);
  const keep = short || gap >= 18 ? cand : cand.filter(([, mo]) => (gap * 3 >= 18 ? mo % 3 === 0 : mo === 0));
  return keep.map(([i]) => `<line class="cl-grid-v" x1="${xs[i].toFixed(1)}" x2="${xs[i].toFixed(1)}" y1="${y1}" y2="${y2}"/>`).join("");
}

/** axWon 라벨이 반올림 없이 나오는 값인가(1억 미만 1만 단위, 이상 0.1억 단위) */
const wonOk = (v) => { const u = Math.abs(v) >= 1e8 ? 1e7 : 1e4, r = v / u; return Math.abs(r - Math.round(r)) < 1e-6; };

export const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** 모바일 '눌러서…' 안내 — 모든 차트가 한 키를 나눠 써서, 한 번 누르면 어디서든 사라진다. */
const HINT_KEY = "cl-chart-hint-seen";
export const hintSeen = () => { try { return localStorage.getItem(HINT_KEY) === "1"; } catch { return true; } };
export const markHint = () => { try { localStorage.setItem(HINT_KEY, "1"); } catch { /* 저장 불가면 매번 보인다 */ } };

/** 입금액 계단값 — 1만 원 미만 변화는 다음 계단에 합치고, weekly 면 월요일에만 꺾는다. */
function principalSteps(pts, weekly) {
  let shown = pts[0].p;
  return pts.map((o, i) => {
    const edge = !weekly || new Date(T0(o.date)).getUTCDay() === 1 || i === pts.length - 1;
    if (Math.abs(o.p - shown) >= 1e4 && edge) shown = o.p;
    return shown;
  });
}

/**
 * 자산 추이 — 평가금 실선 · 입금액 점선 계단 · 두 선 사이 면 = 투자손익(이익 --rise-wash / 손실 --fall-wash).
 * pts = [{date, v(평가금), p(입금액), q:'ok'|'part'|'bad', ev(재산정), flow(그날 순입금), d(락일 배당 누적|null), pd(예수금 배당 누적)}]
 * opts = { weekly(입금액 계단 주 단위), divOn(배당 원천 있음), label(기간 이름) }
 */
export function drawTrend2(host, W, pts, { weekly = false, divOn = false, label = "" } = {}) {
  const N = pts.length;
  if (N < 2) { host.innerHTML = `<p class="cl-goal-note">데이터 없음</p>`; return; }
  const narrow = W < 520, mid = W < 900;
  const Ht = narrow ? 200 : mid ? 230 : 260;
  const m = narrow ? { l: 44, r: 58, t: 12, b: 30 } : mid ? { l: 52, r: 64, t: 14, b: 34 } : { l: 60, r: 70, t: 16, b: 36 };
  const yT1 = m.t + Ht, H = yT1 + m.b;
  const ps = principalSteps(pts, weekly);
  // 투자손익 = 평가금 − 입금액 − 예수금 배당(pd) + 락일 배당(d) — 배당 이중 계산 방지
  const earnP = pts.map((o) => o.v - o.p - (o.pd || 0));
  const divC = pts.map((o) => (divOn ? o.d ?? 0 : 0));
  const earn = earnP.map((v, i) => v + divC[i]);
  const earnLb = divOn ? "투자손익(배당 포함)" : "투자손익(가격)";
  let lo = Infinity, hi = -Infinity;
  pts.forEach((o, i) => { lo = Math.min(lo, o.v, ps[i]); hi = Math.max(hi, o.v, ps[i]); });
  const rg = hi - lo || 1;
  lo -= rg * 0.1; hi += rg * 0.06;
  if (lo < 0 && Math.min(...pts.map((o) => o.v), ...ps) >= 0) lo = 0;
  const ts = pts.map((o) => T0(o.date)), t0 = ts[0], t1 = ts[N - 1];
  const xs = ts.map((t) => m.l + ((t - t0) / (t1 - t0 || 1)) * (W - m.l - m.r));
  const y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * Ht;
  let g = vGrid(ts, xs, m.t, yT1);
  niceTicks(lo, hi, 4, 5, false, wonOk).forEach((v) => {
    g += `<line class="cl-grid-l" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text class="cl-ax" x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${axWon(v)}</text>`;
  });
  g += `<line class="cl-base-l" x1="${m.l}" x2="${W - m.r}" y1="${yT1}" y2="${yT1}"/>`;
  // 축이 0에서 시작하지 않으면 x 눈금 줄 왼쪽 끝에 '축 x억~'(겹치는 x 눈금은 건너뛴다)
  const axU = lo >= 1e8 ? 1e7 : lo >= 1e7 ? 1e6 : 1e5, axFrom = lo > 0 ? 66 : 0;
  if (lo > 0) g += `<text class="cl-trend-axfrom" x="0" y="${yT1 + 20}">축 ${axWon(Math.floor(lo / axU) * axU)}~</text>`;
  // x 눈금: 40일 이하 월요일 · 그 외 매월(좁고 주 단위면 두 달마다, 3년 초과는 1월에 연도)
  let xl = "";
  const short = t1 - t0 <= 40 * 864e5, years = t1 - t0 > 3 * 366 * 864e5;
  let lastMo = -1;
  pts.forEach((o, i) => {
    const d = new Date(T0(o.date));
    const room = xs[i] - 14 >= axFrom;
    if (short) { if (room && d.getUTCDay() === 1) xl += `<text class="cl-ax" x="${xs[i]}" y="${yT1 + 20}" text-anchor="middle">${md(o.date)}</text>`; return; }
    const mo = d.getUTCMonth();
    if (mo !== lastMo) {
      if (room && i > 0 && (years ? mo === 0 : !narrow || !weekly || mo % 2 === 0))
        xl += `<text class="cl-ax" x="${xs[i]}" y="${yT1 + 20}" text-anchor="middle">${years ? `${d.getUTCFullYear()}` : `${mo + 1}월`}</text>`;
      lastMo = mo;
    }
  });
  const f1 = (n) => n.toFixed(1);
  const lv = pts.map((o, i) => `${i ? "L" : "M"}${f1(xs[i])},${f1(y(o.v))}`).join("");
  // 입금액 계단 꼭짓점 — 선·사이 면·클립이 같이 쓴다
  const sp = [[xs[0], y(ps[0])]];
  for (let i = 1; i < N; i++) { sp.push([xs[i], y(ps[i - 1])]); sp.push([xs[i], y(ps[i])]); }
  const lp = sp.map(([a, b], i) => `${i ? "L" : "M"}${f1(a)},${f1(b)}`).join("");
  const back = sp.slice().reverse().map(([a, b]) => `L${f1(a)},${f1(b)}`).join("");
  const band = `${lv}${back}Z`;
  const xL = xs[0], xR = xs[N - 1];
  // 계단 위쪽(이익)·아래쪽(손실) 클립
  const clipU = `${lp}L${f1(xR + 1)},${f1(y(ps[N - 1]))}L${f1(xR + 1)},0L${f1(xL - 1)},0L${f1(xL - 1)},${f1(y(ps[0]))}Z`;
  const clipD = `${lp}L${f1(xR + 1)},${f1(y(ps[N - 1]))}L${f1(xR + 1)},${H}L${f1(xL - 1)},${H}L${f1(xL - 1)},${f1(y(ps[0]))}Z`;
  const id = "t2" + Math.random().toString(36).slice(2, 7);
  let qm = "";
  pts.forEach((o, i) => {
    if (o.q === "bad") qm += `<path class="cl-qmark-bad" d="M${xs[i]},${yT1 - 9}l4,7h-8z"/>`;
    else if (o.q === "part") qm += `<circle class="cl-qmark-part" cx="${xs[i]}" cy="${yT1 - 5}" r="3"/>`;
  });
  let ev = "";
  pts.forEach((o, i) => { if (o.ev) ev += `<circle class="cl-ev-ring" cx="${xs[i]}" cy="${y(o.v)}" r="5"/>`; });
  // 끝값 라벨 — 가까우면 위아래로 벌린다
  const L = pts[N - 1], yv = y(L.v), yp = y(ps[N - 1]), eE = earn[N - 1];
  let dyv = 0, dyp = 0;
  if (Math.abs(yv - yp) < 16) { const sg = yv <= yp ? -1 : 1; dyv = sg * (8 - Math.abs(yv - yp) / 2); dyp = -dyv; }
  const ends = `<circle class="cl-end-ring" style="stroke:var(--ink)" cx="${xR}" cy="${yv}" r="4.5"/><circle class="cl-end-ring" style="stroke:var(--accent)" cx="${xR}" cy="${yp}" r="4"/>
    <text class="cl-end-label" x="${xR + 9}" y="${yv + 4 + dyv}" style="fill:var(--ink)">${krw(L.v)}</text>
    <text class="cl-end-label" x="${xR + 9}" y="${yp + 4 + dyp}" style="fill:var(--accent)">${krw(ps[N - 1])}</text>`;
  const sum = `자산 추이 ${label}: ${dLabel(pts[0].date)}부터 ${dLabel(L.date)}까지. 끝 평가금 ${krw(L.v)}원, 입금액 ${krw(L.p)}원, ${earnLb} ${sKrw(eE)}원${divOn ? `(가격 ${sKrw(earnP[N - 1])} · 배당 ${sKrw(divC[N - 1])})` : ""}. 이 기간 평가금 ${sKrw(L.v - pts[0].v)}원 중 입금 ${sKrw(L.p - pts[0].p)}원. 좌우 화살표로 날짜를 옮깁니다.`;
  host.setAttribute("role", "group");
  host.setAttribute("aria-label", sum);
  const readOf = (o, e) => `${md(o.date)} · 평가 <b>${krw(o.v)}</b> · ${earnLb} <b class="cl-${dir(e)}">${sKrw(e)}</b>`;
  const lastRead = readOf(L, eE);
  host.innerHTML = `<div class="cl-readout" aria-live="polite">${hintSeen() ? lastRead : "눌러서 날짜별 값 보기"}</div>
  <svg viewBox="0 0 ${W} ${H}" height="${H}" aria-hidden="true">
    <defs><clipPath id="${id}u"><path d="${clipU}"/></clipPath><clipPath id="${id}d"><path d="${clipD}"/></clipPath></defs>
    ${g}${xl}
    <path class="cl-trend-band-up" d="${band}" clip-path="url(#${id}u)"/><path class="cl-trend-band-down" d="${band}" clip-path="url(#${id}d)"/>
    <path class="cl-l-principal" d="${lp}"/><path class="cl-l-value" d="${lv}"/>
    ${qm}${ev}${ends}
    <g class="xh" style="display:none"><line class="cl-cross" y1="${m.t}" y2="${yT1}"/><circle class="cl-dot-p" r="4"/><circle class="cl-dot-v" r="4.5"/></g>
  </svg><div class="cl-tip" hidden></div>`;
  const svg = host.querySelector("svg"), xh = host.querySelector(".xh"), tip = host.querySelector(".cl-tip"), ro = host.querySelector(".cl-readout");
  const [ln, dp, dv] = xh.children;
  let pinned = -1, ki = N - 1;
  const show = (i) => {
    const o = pts[i], X = xs[i], e = earn[i];
    xh.style.display = "";
    ln.setAttribute("x1", X); ln.setAttribute("x2", X);
    dv.setAttribute("cx", X); dv.setAttribute("cy", y(o.v));
    dp.setAttribute("cx", X); dp.setAttribute("cy", y(ps[i]));
    tip.hidden = false;
    tip.innerHTML = `<div class="cl-d">${dLabel(o.date)}</div>
      <div class="cl-row"><span>평가금</span><span>${krw(o.v)}</span></div>
      <div class="cl-row"><span>입금액</span><span>${krw(o.p)}</span></div>
      <div class="cl-row"><span>${earnLb}</span><span class="cl-${dir(e)}">${sKrw(e)}</span></div>
      ${divOn ? `<div class="cl-sub-row">가격 ${sKrw(earnP[i])} · 배당 ${sKrw(divC[i])}</div>` : ""}
      ${Math.abs(o.flow || 0) >= 1e4 ? `<div class="cl-row"><span>그날 입금</span><span>${sKrw(o.flow)}</span></div>` : ""}
      ${o.q === "part" ? `<div class="cl-row"><span>◐ 데이터</span><span class="cl-q-part-t">일부 누락 · 직전 값</span></div>` : o.q === "bad" ? `<div class="cl-row"><span>▲ 데이터</span><span class="cl-q-bad-t">이상</span></div>` : ""}
      ${o.ev ? `<div class="cl-note">기준가 재산정 · 성과에 포함</div>` : ""}`;
    const tw = tip.offsetWidth, upper = Math.min(y(o.v), y(ps[i])) < (m.t + yT1) / 2;
    tip.style.left = (X + 14 + tw > W ? X - 14 - tw : X + 14) + "px";
    tip.style.top = (upper ? Math.max(0, yT1 - tip.offsetHeight + 6) : m.t + 2) + ro.offsetHeight + "px";
    ro.innerHTML = readOf(o, e);
  };
  const hide = () => { if (pinned >= 0) return; xh.style.display = "none"; tip.hidden = true; };
  const idxAt = (cx) => {
    const r = svg.getBoundingClientRect(), X = ((cx - r.left) / r.width) * W;
    let b = 0, bd = Infinity;
    xs.forEach((v, i) => { const dd = Math.abs(v - X); if (dd < bd) { bd = dd; b = i; } });
    return b;
  };
  svg.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") show(idxAt(e.clientX)); });
  svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hide(); });
  svg.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    markHint();
    const i = idxAt(e.clientX);
    if (pinned === i) { pinned = -1; hide(); ro.innerHTML = lastRead; } else { pinned = i; show(i); }
  });
  host.tabIndex = 0;
  host.onkeydown = (e) => {
    if (e.key === "ArrowLeft") ki = Math.max(0, ki - 1);
    else if (e.key === "ArrowRight") ki = Math.min(N - 1, ki + 1);
    else if (e.key === "Escape") { pinned = -1; hide(); return; }
    else return;
    e.preventDefault();
    show(ki);
  };
  host.onblur = () => { pinned = -1; hide(); };
}

/**
 * 월별 배당 막대 — 지난 12개월 받음 + 다음 12개월 예상(좁은 폭 <520 은 예상 6개월만).
 * bars = [{month:'YYYY-MM', kind:'received'|'current'|'expected', total, by:{scope:원}, pend?, pby?}] — current 는 받은 몫 위에 남은 예정(pend)을 옅게.
 * opts = { stack: [[scope, 이름, 색 토큰]] | null(--accent 한 색), nowMonth, taxLabel }
 */
export function divBars(host, W, bars, { stack = null, nowMonth = "", taxLabel = "세전" } = {}) {
  if (!bars.length) { host.innerHTML = `<p class="cl-goal-note">데이터 없음</p>`; return; }
  const narrow = W < 520;
  const past = (b) => b.kind !== "expected";
  const B = narrow ? bars.slice(0, bars.filter(past).length + 6) : bars;
  if (!B.length) { host.innerHTML = ""; return; }
  const hOf = (b) => b.total + (b.pend || 0);
  const H = narrow ? 200 : 240, m = { l: narrow ? 40 : 52, r: 8, t: 22, b: 30 }, pb = H - m.b;
  // 최댓값 막대에만 값 라벨. 그 막대가 이번 달이면 두 줄이라 위 여백을 더 둔다
  const iMax = B.reduce((a, b, i) => (hOf(b) > hOf(B[a]) ? i : a), 0);
  const isNow = (b) => b.kind === "current" || b.month === nowMonth;
  const hi = Math.max(1, ...B.map(hOf)) * (isNow(B[iMax]) ? 1.25 : 1.12);
  const bw = (W - m.l - m.r) / B.length, y = (v) => m.t + (1 - v / hi) * (pb - m.t);
  let g = "";
  for (const v of niceTicks(0, hi, 3, 4, true, wonOk)) g += `<line class="cl-grid-l" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text class="cl-ax" x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${axWon(v)}</text>`;
  g += `<line class="cl-base-l" x1="${m.l}" x2="${W - m.r}" y1="${pb}" y2="${pb}"/>`;
  const nRecv = B.filter(past).length, sep = m.l + bw * nRecv;
  const id = "db" + Math.random().toString(36).slice(2, 7);
  let bs = "", defs = "";
  // 묶음 색별 세로 그라데이션(위 → 아래 72%)
  (stack || []).forEach(([, , c]) => { defs += `<linearGradient id="${id}s-${c}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--${c})"/><stop offset="1" style="stop-color:var(--${c});stop-opacity:.72"/></linearGradient>`; });
  B.forEach((b, i) => {
    const X = m.l + i * bw + bw * 0.21, w = bw * 0.58, top = y(hOf(b)), exp = b.kind === "expected";
    // 조각마다 세로 그라데이션 · 막대 전체를 둥근 사각형으로 자름 · 왼쪽 절반 광택
    let base = pb, inner = "";
    const seg = (v, cls, style, fill) => {
      const h = (v / hi) * (pb - m.t);
      if (h <= 0) return;
      base -= h;
      inner += `<rect${cls ? ` class="${cls}"` : ""} x="${X}" y="${base}" width="${w}" height="${h}"${fill ? ` fill="${fill}"` : ""}${style ? ` style="${style}"` : ""}/>`;
    };
    const lightStyle = (c) => `fill:var(--${c});fill-opacity:.32;stroke:var(--${c});stroke-width:1`;
    if (stack) {
      stack.forEach(([k, , c]) => seg(b.by?.[k] || 0, "", exp ? lightStyle(c) : "", exp ? "" : `url(#${id}s-${c})`));
      if (b.pby) stack.forEach(([k, , c]) => seg(b.pby[k] || 0, "", lightStyle(c), ""));
    } else {
      seg(b.total, exp ? "cl-mb-exp" : "cl-mb-act", "", exp ? "" : `url(#${id}v)`);
      if (b.pend) seg(b.pend, "cl-mb-exp", "", "");
    }
    if (pb - base > 0) {
      defs += `<clipPath id="${id}c${i}"><rect x="${X}" y="${base}" width="${w}" height="${pb - base + 4}" rx="4"/></clipPath>`;
      bs += `<g class="cl-mb${exp ? "" : " cl-mb-act-g"}" data-i="${i}"><g clip-path="url(#${id}c${i})">${inner}<rect x="${X}" y="${base}" width="${w / 2}" height="${pb - base}" fill="url(#${id}g)" pointer-events="none"/></g></g>`;
    } else bs += `<g class="cl-mb" data-i="${i}"></g>`;
    const valLb = i === iMax && hOf(b) > 0;
    if (valLb) bs += `<text class="cl-ax-ink" x="${X + w / 2}" y="${top - 6}" text-anchor="middle">${krw(hOf(b))}</text>`;
    if (isNow(b)) bs += `<text class="cl-ax-ui cl-ax-now" x="${X + w / 2}" y="${top - (valLb ? 21 : 6)}" text-anchor="middle">이번 달</text>`;
    const mo = +b.month.slice(5, 7);
    if (mo % (narrow ? 3 : 2) === 1 || mo === 1) bs += `<text class="cl-ax" x="${X + w / 2}" y="${pb + 16}" text-anchor="middle">${mo === 1 ? "'" + b.month.slice(2, 4) + "." : ""}${mo}월</text>`;
  });
  const sumOf = (k) => bars.filter((b) => (k === "received" ? past(b) : !past(b))).reduce((t, b) => t + b.total, 0);
  const top = bars.filter(past).reduce((a, b) => (b.total > (a?.total ?? -1) ? b : a), null);
  host.setAttribute("role", "group");
  host.setAttribute("aria-label", `월별 배당(${taxLabel}). 지난 12개월 받음 ${won(sumOf("received"))}원, 다음 12개월 예상 ${won(sumOf("expected"))}원${top ? `, 가장 많은 달 ${+top.month.slice(5, 7)}월 ${won(top.total)}원` : ""}. 좌우 화살표로 월을 옮깁니다.`);
  host.tabIndex = 0;
  host.innerHTML = `<div class="cl-readout" aria-live="polite">눌러서 월별 금액 보기</div><svg viewBox="0 0 ${W} ${H}" height="${H}" aria-hidden="true">
    <defs><linearGradient id="${id}v" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--accent-hover)"/><stop offset="1" style="stop-color:var(--accent);stop-opacity:.72"/></linearGradient><linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" style="stop-color:#fff;stop-opacity:.22"/><stop offset=".5" style="stop-color:#fff;stop-opacity:0"/></linearGradient>${defs}</defs>
    ${g}<line class="cl-mb-sep" x1="${sep}" x2="${sep}" y1="${m.t - 8}" y2="${pb}"/>
    <text class="cl-ax-ui" x="${sep - 6}" y="${m.t - 10}" text-anchor="end">받음</text><text class="cl-ax-ui" x="${sep + 6}" y="${m.t - 10}">예상</text>
    ${bs}</svg><div class="cl-tip" hidden></div>`;
  const svg = host.querySelector("svg"), tip = host.querySelector(".cl-tip"), ro = host.querySelector(".cl-readout");
  const show = (i) => {
    const b = B[i], X = m.l + i * bw + bw / 2, [yy, mm] = b.month.split("-");
    host.querySelectorAll(".cl-mb-on").forEach((r) => r.classList.remove("cl-mb-on"));
    host.querySelector(`[data-i="${i}"]`)?.classList.add("cl-mb-on");
    const kind = b.kind === "current" ? "이번 달" : b.kind === "received" ? "받음" : "예상";
    tip.hidden = false;
    tip.innerHTML = `<div class="cl-d">${yy}년 ${+mm}월 · ${kind}</div><div class="cl-row"><span>${taxLabel} ${b.kind === "current" ? "받음" : "합계"}</span><span>${won(b.total)}원</span></div>` +
      (b.pend ? `<div class="cl-row"><span>남은 예정</span><span>${won(b.pend)}원</span></div>` : "") +
      (stack ? stack.filter(([k]) => b.by?.[k] + (b.pby?.[k] || 0) > 0).map(([k, l, c]) => `<div class="cl-row"><span><i class="cl-sw" style="background:var(--${c})"></i>${esc(l)}</span><span>${won(b.by[k] + (b.pby?.[k] || 0))}원</span></div>`).join("") : "");
    const tw = tip.offsetWidth;
    tip.style.left = (X + 12 + tw > W ? X - 12 - tw : X + 12) + "px";
    tip.style.top = ro.offsetHeight + 8 + "px";
    ro.innerHTML = `${yy}년 ${+mm}월 · ${kind} <b>${won(b.total)}원</b>${b.pend ? ` + 예정 ${won(b.pend)}원` : ""}`;
  };
  const hide = () => { tip.hidden = true; host.querySelectorAll(".cl-mb-on").forEach((r) => r.classList.remove("cl-mb-on")); };
  const idxAt = (cx) => { const r = svg.getBoundingClientRect(); return Math.min(B.length - 1, Math.max(0, Math.floor((((cx - r.left) / r.width) * W - m.l) / bw))); };
  svg.addEventListener("pointermove", (e) => show(idxAt(e.clientX)));
  svg.addEventListener("pointerdown", (e) => show(idxAt(e.clientX)));
  svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hide(); });
  let ki = Math.max(0, B.findIndex((b) => b.month === nowMonth));
  host.onkeydown = (e) => {
    if (e.key === "ArrowLeft") ki = Math.max(0, ki - 1);
    else if (e.key === "ArrowRight") ki = Math.min(B.length - 1, ki + 1);
    else if (e.key === "Escape") { hide(); return; }
    else return;
    e.preventDefault();
    show(ki);
  };
  host.onblur = hide;
}

/**
 * 시간축 선 차트. series = [{v:[..], cls, fill?(0선까지 엷어지는 면의 색 토큰), invert?, color?, dy?}]
 * opts: zero(기준선 값) · endFmt(선 끝 값 라벨) · band([a, b] 두 계열 사이 면) · hover(i → 툴팁 HTML) · label(낭독 요약)
 */
export function lineChart(host, W, { dates, series, H, yFmt, zero, evIndex = [], hover, endFmt, band, label }) {
  const N = dates.length;
  if (N < 2) { host.innerHTML = `<p class="cl-goal-note">데이터 없음</p>`; return; }
  const m = { l: W < 520 ? 48 : 60, r: endFmt ? 64 : 12, t: 12, b: 28 }, pb = H - m.b;
  let lo = Infinity, hi = -Infinity;
  series.forEach((s) => s.v.forEach((v) => { if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }));
  if (zero != null) { lo = Math.min(lo, zero); hi = Math.max(hi, zero); }
  const pad = (hi - lo) * 0.08 || 1;
  lo -= pad; hi += pad;
  const x = (i) => m.l + (i / (N - 1)) * (W - m.l - m.r), y = (v) => m.t + ((hi - v) / (hi - lo)) * (pb - m.t);
  let g = vGrid(dates.map(T0), dates.map((_, i) => x(i)), m.t, pb);
  (H < 150 ? niceTicks(lo, hi, 3, 4) : niceTicks(lo, hi)).forEach((t) => {
    g += `<line class="cl-grid-l" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text class="cl-ax" x="${m.l - 10}" y="${y(t) + 4}" text-anchor="end">${yFmt(t)}</text>`;
  });
  if (zero != null) g += `<line class="cl-base-l" x1="${m.l}" x2="${W - m.r}" y1="${y(zero)}" y2="${y(zero)}"/>`;
  const gid = "lc" + Math.random().toString(36).slice(2, 7);
  let defs = "", paths = "", ends = "";
  if (band) {
    const [a, b] = band.map((k) => series[k].v);
    const top = a.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + "," + y(v ?? 0).toFixed(1)).join("");
    const bot = b.map((v, i) => "L" + x(i).toFixed(1) + "," + y(v ?? 0).toFixed(1)).reverse().join("");
    paths += `<path class="cl-area-div" d="${top}${bot}Z"/>`;
  }
  series.forEach((s, k) => {
    let d = "";
    s.v.forEach((v, i) => { d += (i ? "L" : "M") + x(i).toFixed(1) + "," + y(v ?? 0).toFixed(1); });
    if (s.fill) {
      const yz = y(zero), yfar = s.invert ? y(lo) : y(hi);
      defs += `<linearGradient id="${gid}${k}" gradientUnits="userSpaceOnUse" x1="0" y1="${yfar}" x2="0" y2="${yz}"><stop offset="0" style="stop-color:var(--${s.fill});stop-opacity:.30"/><stop offset="1" style="stop-color:var(--${s.fill});stop-opacity:.02"/></linearGradient>`;
      paths += `<path d="${d}L${x(N - 1)},${yz}L${x(0)},${yz}Z" fill="url(#${gid}${k})"/>`;
    }
    paths += `<path class="${s.cls}" d="${d}"/>`;
    if (endFmt) {
      const v = s.v[N - 1], ex = x(N - 1), ey = y(v);
      const c = s.color || "accent";
      ends += `<circle class="cl-end-ring" cx="${ex}" cy="${ey}" r="4.5" style="stroke:var(--${c})"/><text class="cl-end-label" x="${ex + 9}" y="${ey + 4 + (s.dy || 0)}" style="fill:var(--${c})">${endFmt(v)}</text>`;
    }
  });
  const evm = evIndex.map((i) => `<circle class="cl-ev-ring" cx="${x(i)}" cy="${y(series[0].v[i])}" r="5"/>`).join("");
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img"${label ? ` aria-label="${esc(label)}"` : ""}><defs>${defs}</defs>${g}${paths}${evm}${ends}${monthTicks(dates, x, pb + 20)}
    ${hover ? `<g class="xh" style="display:none"><line class="cl-cross" y1="${m.t}" y2="${pb}"/><circle class="cl-dot-a" r="4.5"/></g><rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${pb - m.t}" fill="transparent" class="hit"/>` : ""}</svg>${hover ? '<div class="cl-tip" hidden></div>' : ""}`;
  if (hover) {
    const hit = host.querySelector(".hit"), xh = host.querySelector(".xh"), tip = host.querySelector(".cl-tip");
    hit.addEventListener("pointermove", (e) => {
      const r = host.getBoundingClientRect();
      const i = Math.min(N - 1, Math.max(0, Math.round(((e.clientX - r.left - m.l) / (W - m.l - m.r)) * (N - 1))));
      xh.style.display = "";
      xh.children[0].setAttribute("x1", x(i)); xh.children[0].setAttribute("x2", x(i));
      xh.children[1].setAttribute("cx", x(i)); xh.children[1].setAttribute("cy", y(series[0].v[i] ?? 0));
      tip.hidden = false;
      tip.innerHTML = hover(i);
      const tx = x(i) + 14;
      tip.style.left = (tx + 200 > W ? x(i) - 214 : tx) + "px";
    });
    hit.addEventListener("pointerleave", () => { xh.style.display = "none"; tip.hidden = true; });
  }
}
