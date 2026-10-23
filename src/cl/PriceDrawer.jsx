/* 종목 시세 드로어 — 종가 추이 · 내 평단 · 매매 시점. 상태는 URL ?item=<코드>&ip=<기간> 이 전부이고, 셸의 ItemDrawer 가 어느 화면에서든 띄운다. */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { useAccounts, useDividends, usePositions } from "../lib/queries.js";
import { useSources } from "../lib/sources.jsx";
import { Failed, Loading } from "./Shell.jsx";
import { PeriodSeg, PERIODS_DRAWER, TYPE_LABEL, takeItemOpener } from "./parts.jsx";
import { FREQ_NAME, dir, isFund, isoMs as T, md, pct, px, qtyNum, qtyUnit, shortName, won } from "./format.js";
import { niceTicks, vGrid } from "./charts.js";
import "./holdings.css"; // hd-* 드로어 모양 — 다른 화면에서 열려도 실리게

const DAY = 864e5;
const MON = (iso) => `${+String(iso).slice(5, 7)}월`;

/** 시세 출처 → 사용자 문구 */
const SOURCE_TEXT = {
  asset_daily: "보유일 종가",
  product_price: "종가 1년",
};

/** 매매 표식. byMonth 면 같은 달·같은 방향을 하나로 묶는다(라벨 '9월 매수 3회 · 45'). */
function groupEvents(evs, byMonth) {
  if (!byMonth) return evs.map((e) => ({ ...e, n: 1, label: `${md(e.d)} ${e.side === "sell" ? "매도" : "매수"} ${won(Math.abs(e.qty))}` }));
  const m = new Map();
  evs.forEach((e) => {
    const k = `${String(e.d).slice(0, 7)}|${e.side}`;
    const g = m.get(k) || { d: e.d, side: e.side, qty: 0, n: 0 };
    g.qty += Math.abs(e.qty || 0); g.n += 1;
    m.set(k, g);
  });
  return [...m.values()].map((g) => ({ ...g, label: `${MON(g.d)} ${g.side === "sell" ? "매도" : "매수"} ${g.n}회 · ${won(g.qty)}` }));
}

/** 종가 차트. data = 시세 응답, a = { cur, mul, crypto }, avgNow = 지금 평단(기준선) */
function PriceChart({ data, period, a, avgNow, name }) {
  const host = useRef(null);
  const [W, setW] = useState(0);
  const [hi, setHi] = useState(null);
  const hid = useId().replace(/:/g, "");
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const all = data.series || [];
  const endIso = all.length ? all[all.length - 1].d : null;
  const t1 = endIso ? T(endIso) : 0;
  // 기간 시작: 보유기간 = 첫 점(서버가 보유 시작일부터 준다), 그 밖은 기간 일수
  const days = (PERIODS_DRAWER.find(([k]) => k === period) || [])[2];
  const t0 = period === "hold" ? (all.length ? T(all[0].d) : t1) : t1 - (days || 366) * DAY;
  const pts = all.filter((p) => T(p.d) >= t0);
  const priced = pts.filter((p) => p.close != null);

  if (!W || !priced.length) {
    return (
      <div className="hd-chart" ref={host}>
        {W > 0 && <p className="hd-note">이 기간 시세 없음 · 기간을 늘려 보세요</p>}
      </div>
    );
  }
  const narrow = W < 520;
  // 기준선 = 지금 내 평단. 종가 선과 면은 평단 위 --rise · 아래 --fall
  const H = narrow ? 240 : 280, m = { l: narrow ? 44 : 54, r: narrow ? 66 : 84, t: 14, b: 28 };
  const pb = H - m.b;
  const ref = avgNow ?? null;
  const vals = priced.map((p) => p.close);
  if (ref != null) vals.push(ref);
  let lo = Math.min(...vals), top = Math.max(...vals);
  const rg = top - lo || Math.abs(top) * 0.02 || 1;
  lo -= rg * 0.12; top += rg * 0.1;
  const X = (iso) => m.l + ((T(iso) - t0) / (t1 - t0 || 1)) * (W - m.l - m.r);
  const Y = (v) => m.t + (1 - (v - lo) / (top - lo)) * (pb - m.t);
  const fmt = (v) => (a.cur === "USD" ? "$" + (Math.abs(v) >= 100 ? Math.round(v) : v.toFixed(1)) : Math.abs(v) >= 1e6 ? (Math.abs(v) >= 1e8 ? (v / 1e8).toFixed(2) + "억" : Math.round(v / 1e4).toLocaleString("ko-KR") + "만") : won(v));
  const xL = m.l, xR = W - m.r;
  const yRef = ref != null ? Y(ref) : null;

  // fmtOk = fmt 라벨이 반올림 없이 읽히는 눈금값만
  const fmtOk = (v) => {
    const u = a.cur === "USD" ? (Math.abs(v) >= 100 ? 1 : 0.1) : Math.abs(v) >= 1e8 ? 1e6 : Math.abs(v) >= 1e6 ? 1e4 : 1;
    const r = v / u;
    return Math.abs(r - Math.round(r)) < 1e-6;
  };
  const grid = niceTicks(lo, top, 4, 5, false, fmtOk);
  const vg = vGrid(pts.map((p) => T(p.d)), pts.map((p) => X(p.d)), m.t, pb);
  const span = t1 - t0, xt = [];
  if (span <= 40 * DAY) {
    for (let t = t0 + DAY; t <= t1; t += DAY) if (new Date(t).getUTCDay() === 1) xt.push(new Date(t).toISOString().slice(0, 10));
  } else {
    const step = span > 200 * DAY && narrow ? 2 : 1;
    const d = new Date(t0); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1);
    for (; d.getTime() <= t1; d.setUTCMonth(d.getUTCMonth() + step)) xt.push(d.toISOString().slice(0, 10));
  }

  // 종가 선: 보유 전(lPre) · 보유 중(lHeld). 시세 없는 날은 끊는다
  const isHeld = (p) => p.qty > 0;
  let lPre = "", lHeld = "", penP = false, penH = false;
  pts.forEach((p, i) => {
    if (p.close == null) { penP = penH = false; return; }
    const x = X(p.d).toFixed(1), y = Y(p.close).toFixed(1);
    if (isHeld(p)) {
      if (penH) lHeld += `L${x},${y}`;
      // 보유 시작점은 직전 종가와 잇는다
      else if (i > 0 && pts[i - 1].close != null) lHeld += `M${X(pts[i - 1].d).toFixed(1)},${Y(pts[i - 1].close).toFixed(1)}L${x},${y}`;
      else lHeld += `M${x},${y}`;
      penH = true; penP = false;
    } else { lPre += `${penP ? "L" : "M"}${x},${y}`; penP = true; penH = false; }
  });
  // 보유 구간 면(종가 선 ↔ 평단) — 시세가 끊기는 구간마다 닫는다
  const heldPts = priced.filter(isHeld);
  let area = "";
  if (heldPts.length > 1 && yRef != null) {
    let run = [];
    const flush = () => { if (run.length > 1) area += run.map((p, k) => `${k ? "L" : "M"}${X(p.d).toFixed(1)},${Y(p.close).toFixed(1)}`).join("") + `L${X(run[run.length - 1].d).toFixed(1)},${yRef.toFixed(1)}L${X(run[0].d).toFixed(1)},${yRef.toFixed(1)}Z`; run = []; };
    pts.forEach((p) => { if (p.close != null && isHeld(p)) run.push(p); else flush(); });
    flush();
  }
  // 시세 없는 구간(상장 전 등) 빗금
  const hatch = [];
  const firstP = priced[0].d;
  if (T(firstP) > t0 + 3 * DAY) hatch.push([xL, X(firstP)]);
  let gapFrom = null;
  pts.forEach((p, i) => {
    if (T(p.d) < T(firstP)) return;
    if (p.close == null && gapFrom == null) gapFrom = i ? X(pts[i - 1].d) : X(p.d);
    if (p.close != null && gapFrom != null) { hatch.push([gapFrom, X(p.d)]); gapFrom = null; }
  });
  const hf = data.held_from;
  const xHold = hf && T(hf) > t0 + DAY && T(hf) <= t1 ? X(hf) : null;

  const qev = (data.quality_events || []).filter((e) => T(e.d) >= t0 && T(e.d) <= t1).map((e) => {
    const p = priced.find((x) => T(x.d) >= T(e.d)) || priced[priced.length - 1];
    return { ...e, y: Y(p.close) };
  });
  const evs = groupEvents((data.events || []).filter((e) => T(e.d) >= t0), span > 100 * DAY).map((e) => {
    const p = priced.find((x) => T(x.d) >= T(e.d)) || priced[priced.length - 1];
    return { ...e, x: X(p.d), y: Y(p.close) };
  });
  const last = priced[priced.length - 1];
  const yc = Y(last.close);
  const upNow = ref == null || last.close >= ref;
  let dc = 0;
  if (yRef != null && Math.abs(yc - yRef) < 20) dc = yc <= yRef ? -10 : 10;

  const h = hi == null ? null : pts[hi];
  const held = h && isHeld(h);
  const hpr = held && h.close != null && ref != null ? (h.close - ref) / ref : null;
  const hev = h ? (data.events || []).filter((e) => e.d === h.d) : [];
  const pick = (clientX) => {
    const r = host.current.querySelector("svg").getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * W;
    let b = 0, bd = Infinity;
    pts.forEach((p, i) => { const dd = Math.abs(X(p.d) - x); if (dd < bd) { bd = dd; b = i; } });
    setHi(b);
  };
  const onKey = (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      setHi((i) => Math.max(0, Math.min(pts.length - 1, (i == null ? pts.length - 1 : i) + (e.key === "ArrowLeft" ? -1 : 1))));
    } else if (e.key === "Home" || e.key === "End") { e.preventDefault(); setHi(e.key === "Home" ? 0 : pts.length - 1); }
  };
  const label = `${name} 일별 종가 ${md(pts[0].d)}부터 ${md(endIso)}까지. 마지막 ${px(last.close, a)}${ref != null ? `, 지금 내 평단 ${px(ref, a)}` : ""}. 좌우 화살표로 날짜를 옮깁니다.`;
  const flagX = h ? Math.min(Math.max(X(h.d) - 24, xL), xR - 48) : 0;
  const tipLeft = h ? (X(h.d) + 14 + 190 > W ? X(h.d) - 14 - 190 : X(h.d) + 14) : 0;
  const tipTop = h && h.close != null ? (Y(h.close) < (m.t + pb) / 2 ? Y(h.close) + 18 : Math.max(m.t, Y(h.close) - 108)) : m.t;

  return (
    <div className="hd-chart cl-chart" ref={host} tabIndex={0} role="img" aria-label={label} onKeyDown={onKey}
      onBlur={() => setHi(null)}>
      <div className="hd-readout" aria-live="polite">
        {h ? <>{md(h.d)} · 종가 <b>{h.close != null ? px(h.close, a) : "없음"}</b>{held ? <>{hpr != null && <> · 평단 대비 <span className={`cl-${dir(hpr)}`}>{pct(hpr)}</span></>} · 보유 <b>{qtyNum(h.qty, a)}{qtyUnit(a)}</b></> : " · 보유 전"}</>
          : <span className="hd-hint">눌러서 날짜별 값 보기</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} height={H} aria-hidden="true"
        onPointerMove={(e) => pick(e.clientX)} onPointerDown={(e) => pick(e.clientX)}
        onPointerLeave={(e) => e.pointerType === "mouse" && setHi(null)}>
        <defs>
          <pattern id={`hd-h-${hid}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line className="hd-hatch-l" x1="0" y1="0" x2="0" y2="6" />
          </pattern>
          {yRef != null && <>
            <clipPath id={`hd-cu-${hid}`}><rect x="0" y="0" width={W} height={yRef} /></clipPath>
            <clipPath id={`hd-cd-${hid}`}><rect x="0" y={yRef} width={W} height={H - yRef} /></clipPath>
            <linearGradient id={`hd-up-${hid}`} gradientUnits="userSpaceOnUse" x1="0" y1={m.t} x2="0" y2={yRef}>
              <stop offset="0" style={{ stopColor: "var(--rise)", stopOpacity: 0.3 }} /><stop offset="1" style={{ stopColor: "var(--rise)", stopOpacity: 0.03 }} />
            </linearGradient>
            <linearGradient id={`hd-dn-${hid}`} gradientUnits="userSpaceOnUse" x1="0" y1={pb} x2="0" y2={yRef}>
              <stop offset="0" style={{ stopColor: "var(--fall)", stopOpacity: 0.3 }} /><stop offset="1" style={{ stopColor: "var(--fall)", stopOpacity: 0.03 }} />
            </linearGradient>
          </>}
        </defs>
        {hatch.filter(([a0, a1]) => a1 - a0 > 1).map(([a0, a1], i) => (
          <g key={i}>
            <rect className="hd-nodata" x={a0} y={m.t} width={a1 - a0} height={pb - m.t} fill={`url(#hd-h-${hid})`} />
            {a1 - a0 > 56 && <text className="cl-ax-ui hd-region-lb" x={a0 + 8} y={m.t + 14}>{T(firstP) > t0 + 3 * DAY && a0 === xL ? "상장 전 · 시세 없음" : "시세 없음"}</text>}
          </g>
        ))}
        <g dangerouslySetInnerHTML={{ __html: vg }} />
        {grid.map((v) => (
          <g key={v}><line className="cl-grid-l" x1={xL} x2={xR} y1={Y(v)} y2={Y(v)} /><text className="cl-ax" x={xL - 8} y={Y(v) + 4} textAnchor="end">{fmt(v)}</text></g>
        ))}
        <line className="hd-base" x1={xL} x2={xR} y1={pb} y2={pb} />
        {xt.map((d) => <text key={d} className="cl-ax" x={X(d)} y={H - 8} textAnchor="middle">{span <= 40 * DAY ? md(d) : `${+d.slice(5, 7) === 1 ? `'${d.slice(2, 4)}.` : ""}${+d.slice(5, 7)}월`}</text>)}
        {area && yRef != null && <>
          <path d={area} fill={`url(#hd-up-${hid})`} clipPath={`url(#hd-cu-${hid})`} />
          <path d={area} fill={`url(#hd-dn-${hid})`} clipPath={`url(#hd-cd-${hid})`} />
        </>}
        {yRef != null && <line className="hd-ref" x1={xL} x2={xR} y1={yRef} y2={yRef} />}
        {xHold != null && <g><line className="hd-holdline" x1={xHold} x2={xHold} y1={m.t} y2={pb} /><text className="cl-ax-ui hd-region-lb" x={xHold + 6} y={m.t + 12}>보유 시작</text></g>}
        {lPre && <path className="hd-line-pre" d={lPre} />}
        {yRef != null ? <>
          <path className="cl-l-value hd-line-up" d={lHeld} clipPath={`url(#hd-cu-${hid})`} />
          <path className="cl-l-value hd-line-dn" d={lHeld} clipPath={`url(#hd-cd-${hid})`} />
        </> : <path className="cl-l-value" d={lHeld} />}
        {evs.map((e, i) => {
          // 크기는 2단계(묶음 여부)만
          const r = e.n > 1 ? 5.5 : 4;
          return e.side === "sell"
            ? <rect key={i} className="hd-ev-sell" x={e.x - r} y={e.y - r} width={r * 2} height={r * 2} rx="1"><title>{e.label}</title></rect>
            : <circle key={i} className="hd-ev-buy" cx={e.x} cy={e.y} r={r}><title>{e.label}</title></circle>;
        })}
        {qev.map((e) => (
          <g key={e.d}>
            <circle className="hd-qring" cx={X(e.d)} cy={e.y} r="5"><title>{`${md(e.d)} 기준가 재산정${e.magnitude_pct ? ` +${Math.round(+e.magnitude_pct)}%` : ""}`}</title></circle>
            <text className="hd-qlb" x={X(e.d) + 8} y={e.y + 16}>재산정</text>
          </g>
        ))}
        <circle className={`hd-end ${upNow ? "hd-end-up" : "hd-end-dn"}`} cx={X(last.d)} cy={yc} r="4.5" />
        <g className={`hd-pill ${upNow ? "hd-pill-up" : "hd-pill-dn"}`}><rect x={xR + 6} y={yc - 10 + dc} width={m.r - 8} height="20" rx="10" /><text x={xR + 6 + (m.r - 8) / 2} y={yc + 4 + dc} textAnchor="middle">{fmt(last.close)}</text></g>
        {yRef != null && <g className="hd-pill hd-pill-ref"><rect x={xR + 6} y={yRef - 10 - dc} width={m.r - 8} height="20" rx="10" /><text x={xR + 6 + (m.r - 8) / 2} y={yRef + 4 - dc} textAnchor="middle">평단 {fmt(ref)}</text></g>}
        {h && (
          <g>
            <line className="hd-cross" x1={X(h.d)} x2={X(h.d)} y1={m.t} y2={pb} />
            {h.close != null && <circle className="hd-dot" cx={X(h.d)} cy={Y(h.close)} r="4.5" />}
            <g className="hd-flag"><rect x={flagX} y={pb + 4} width="48" height="18" rx="4" /><text x={flagX + 24} y={pb + 17} textAnchor="middle">{md(h.d)}</text></g>
          </g>
        )}
      </svg>
      {h && !narrow && h.close != null && (
        <div className="hd-tip" style={{ left: tipLeft, top: tipTop + 26 }}>
          <div className="hd-tip-d">{md(h.d)}</div>
          <div><span>종가</span><b>{px(h.close, a)}</b></div>
          {held && hpr != null && <div><span>평단 대비</span><b className={`cl-${dir(hpr)}`}>{pct(hpr)}</b></div>}
          <div><span>보유</span><b>{held ? `${qtyNum(h.qty, a)}${qtyUnit(a)}` : "보유 전"}</b></div>
          {hev.map((e, i) => <div key={i}><span>{e.side === "sell" ? "매도" : "매수"}</span><b>{qtyNum(Math.abs(e.qty), a)}{qtyUnit(a)}{e.px ? ` · ${px(e.px, a)}` : ""}</b></div>)}
        </div>
      )}
      {priced.length === 1 && <p className="hd-note">첫 매수일 · 내일부터 선 표시</p>}
    </div>
  );
}

/** 최근 12개월 배당 한 줄. ttm = 시세 응답의 배당 요약(없으면 /dividends 에서 찾는다). 배당 기록이 없으면 숨긴다. */
function DividendLine({ code, a, ttm }) {
  const q = useDividends("all", "pre", { enabled: !ttm });
  if (!ttm && !q.data?.available) return null;
  let text;
  if (isFund(a)) text = "재투자형 · 분배금은 기준가에 포함";
  else if (a.crypto) text = "가상자산은 배당이 없습니다";
  else {
    const r = ttm || (q.data.products || []).find((x) => x.product_code === code);
    const dps = r ? r.ttm_dps ?? r.dps_ttm : null;
    if (!r || !dps) text = "분배 이력 없음 · 첫 분배 후 표시";
    else {
      const freq = r.freq || FREQ_NAME[r.pays_per_year];
      const y = r.yield_on_market_pct, yc = r.yield_on_cost_pct;
      text = <>주당 {px(dps, a)}{a.cur === "USD" ? "" : "원"}{freq ? ` · ${freq} 지급` : ""} · 지금 수량 기준 연 <b className="cl-num">{won(r.expected_annual_krw)}원</b>{y != null ? ` · 시가 ${(+y).toFixed(2)}%` : ""}{yc != null ? ` · 매입가 ${(+yc).toFixed(2)}%` : ""}</>;
    }
  }
  return (
    <div className="hd-div">
      <h3>배당</h3>
      <p>{text}</p>
    </div>
  );
}

const FOCUSABLE = 'button:not([disabled]),[href],input,select,[tabindex]:not([tabindex="-1"])';

/** 드로어 본체. pos = 보유 합산 행(없으면 시세 응답만), scope = scope_code | null, accountsLabel = 부제의 계좌 유형 */
function PriceDrawer({ code, period, onPeriod, onClose, pos, scope, accountsLabel }) {
  const src = useSources();
  const ref = useRef(null);
  const titleRef = useRef(null);
  const tid = useId();
  const q = useQuery({
    queryKey: ["price", code, period, scope || "all"],
    queryFn: () => api.get(`/positions/${encodeURIComponent(code)}/price?period=${period}${scope ? `&scope_code=${scope}` : ""}`),
    retry: (n, e) => e?.status !== 404 && n < 2,
  });

  // 열리면 제목으로 초점 · 본문 스크롤 잠금 · Esc 닫기 · Tab 가두기
  useEffect(() => {
    titleRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab" || !ref.current) return;
      const f = [...ref.current.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], lastF = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current)) { e.preventDefault(); lastF.focus(); }
      else if (!e.shiftKey && document.activeElement === lastF) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const d = q.data;
  const name = pos?.product_name || d?.product_name || code;
  const a = useMemo(() => ({
    cur: pos?.currency_code || d?.currency_code || "KRW",
    mul: pos?.multiplier || (d?.unit_note && /1,?000/.test(d.unit_note) ? 0.001 : 1),
    crypto: (pos?.asset_type || d?.asset_type) === "CRYPTO",
  }), [pos, d]);
  const series = d?.series || [];
  const lastS = series.length ? series[series.length - 1] : null;
  const now = pos?.unit_market_price ?? lastS?.close;
  const avg = pos?.unit_purchase_price ?? lastS?.avg_cost;
  const qty = pos?.quantity ?? lastS?.qty;
  const r = pos ? (pos.cost_krw_real ? (pos.eval_krw - pos.cost_krw_real) / pos.cost_krw_real : null) : now && avg ? (now - avg) / avg : null;
  const firstClose = series.find((p) => p.close != null)?.close;
  const lastClose = [...series].reverse().find((p) => p.close != null)?.close;
  const chg = firstClose && lastClose ? (lastClose - firstClose) / firstClose : null;
  const unitNote = d?.unit_note || (isFund(a) ? "원/1,000좌" : null);

  return (
    <div className="hd-scrim" onClick={onClose}>
      <div className="hd-drawer" role="dialog" aria-modal="true" aria-labelledby={tid} ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="hd-head">
          <div className="hd-titles">
            <h2 id={tid} ref={titleRef} tabIndex={-1} title={name}>{shortName(name)}</h2>
            <p>{[accountsLabel, d?.source ? SOURCE_TEXT[d.source] || SOURCE_TEXT.asset_daily : null].filter(Boolean).join(" · ")}</p>
          </div>
          <button type="button" className="hd-x" aria-label="닫기" onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <div className="hd-body">
          <PeriodSeg label="기간" items={PERIODS_DRAWER} value={period} onChange={onPeriod} />
          {now != null && (
            <div className="hd-kpi">
              <div className="hd-kpi-main"><span className="hd-kpi-now">{px(now, a)}</span>{r != null && <span className={`hd-kpi-pl cl-delta cl-${dir(r)}`}>내 평단 대비 {pct(r)}</span>}
                {chg != null && <span className="hd-kpi-chg">{period === "hold" ? "보유기간" : (PERIODS_DRAWER.find(([k]) => k === period) || [, ""])[1]} 등락 <b className={`cl-${dir(chg)}`}>{pct(chg)}</b></span>}</div>
              <div className="hd-kpi-sub">
                {avg != null && <span>내 평단 <b>{px(avg, a)}</b></span>}
                {qty != null && <span>보유 <b>{qtyNum(qty, a)}</b>{qtyUnit(a)}</span>}
                {pos?.eval_krw != null && <span>평가 <b>{won(pos.eval_krw)}</b>원</span>}
              </div>
            </div>
          )}
          {q.isLoading ? <div className="hd-chart"><Loading /></div>
            : q.isError ? (q.error?.status === 404 ? <p className="hd-note">보유 중이 아닌 종목 · 시세 없음</p> : <Failed q={q} what="시세" />)
            : d?.available === false ? <p className="hd-note">시세 없음</p>
            : <PriceChart key={period} data={d} period={period} a={a} avgNow={avg} name={name} />}
          {d && !q.isError && d.available !== false && (
            <div className="cl-legend hd-legend">
              <span><i className="hd-sw-updn" />종가(평단 위 · 아래)</span>
              <span><i className="hd-sw-ref" />내 평단</span>
              <span><svg viewBox="0 0 12 12" aria-hidden="true"><circle className="hd-ev-buy" cx="6" cy="6" r="4" /></svg>매수</span>
              {(d.events || []).some((e) => e.side === "sell") && <span><svg viewBox="0 0 12 12" aria-hidden="true"><rect className="hd-ev-sell" x="2" y="2" width="8" height="8" rx="1" /></svg>매도</span>}
              {series.some((p) => p.close != null && !(p.qty > 0)) && <span><i className="hd-sw-pre2" />보유 전</span>}
              {(d.quality_events || []).length > 0 && <span><svg viewBox="0 0 12 12" aria-hidden="true"><circle className="hd-qring" cx="6" cy="6" r="4" /></svg>기준가 재산정</span>}
              {unitNote && <span className="hd-unit">단위 {unitNote}</span>}
            </div>
          )}
          {d && !q.isError && (
            <p className="hd-note">
              {d.source === "product_price" ? "" : "보유일 종가만 · "}매수가는 원가 변화 ÷ 수량 변화로 추정{a.cur === "USD" ? " · 미국 종가는 하루 밀린 날 있음" : ""}{a.crypto ? " · 가상자산은 아침 7시 시세" : ""}
            </p>
          )}
          {src.dividend && d && <DividendLine code={code} a={a} ttm={d.dividend_ttm} />}
        </div>
      </div>
    </div>
  );
}

const isPeriod = (k) => PERIODS_DRAWER.some(([x]) => x === k);

/**
 * 셸 수준 드로어 — 주소의 ?item= 이 있으면 띄운다.
 * 닫기: 히스토리에 쌓아 연 것이면 뒤로, 주소로 바로 들어왔으면 item·ip 만 지운다. 옛 주소(/portfolio?item=&p=)는 p → ip.
 */
export function ItemDrawer() {
  const [sp] = useSearchParams();
  const loc = useLocation();
  const navigate = useNavigate();
  const item = sp.get("item");
  const legacyP = item && !sp.has("ip") && loc.pathname === "/portfolio" && isPeriod(sp.get("p")) ? sp.get("p") : null;
  const raw = sp.get("ip") ?? legacyP;
  const period = isPeriod(raw) ? raw : "hold"; // 기본 = 보유기간

  const setParams = useCallback((patch) => {
    const n = new URLSearchParams(window.location.search);
    Object.entries(patch).forEach(([k, v]) => (v == null || v === "" ? n.delete(k) : n.set(k, v)));
    // setSearchParams 는 #hash 를 버리므로 쿼리만 바꿔 이동한다
    navigate({ search: n.toString() ? `?${n}` : "", hash: window.location.hash }, { replace: true, state: loc.state });
  }, [navigate, loc.state]);
  useEffect(() => {
    if (legacyP) setParams({ p: null, ip: legacyP === "hold" ? null : legacyP });
  }, [legacyP, setParams]);
  // 참조 고정 — 기간을 바꿀 때 드로어의 초점 effect 가 다시 돌지 않게
  const closeRef = useRef(null);
  closeRef.current = () => {
    if (loc.state?.item && window.history.state?.idx > 0) navigate(-1);
    else setParams({ item: null, ip: null });
  };
  const close = useCallback(() => closeRef.current(), []);

  // 닫히면 연 자리로 초점을 돌려준다(스크롤 그대로)
  const opener = useRef(null);
  const prev = useRef(null);
  useEffect(() => {
    if (item && !prev.current) opener.current = takeItemOpener();
    else if (item) takeItemOpener(); // 열린 채 종목만 바뀌면 남은 opener 를 버린다
    if (prev.current && !item) {
      const el = opener.current?.isConnected ? opener.current : document.querySelector(`[data-item="${CSS.escape(prev.current)}"]`);
      (el || document.querySelector("main h1"))?.focus?.({ preventScroll: true });
      opener.current = null;
    }
    prev.current = item;
  }, [item]);

  // 부제(계좌 유형)·평가 줄 — 보유 화면과 같은 쿼리 키로 캐시를 나눠 쓴다
  const pall = usePositions("product", null, { enabled: !!item });
  const pq = usePositions("account_product", null, { enabled: !!item });
  const aq = useAccounts({ enabled: !!item });
  if (!item) return null;
  const pos = (pall.data?.positions || []).find((p) => p.product_code === item);
  const byName = Object.fromEntries((aq.data || []).map((a) => [a.account_name, a.account_type]));
  const typeOf = (p) => p.account_type || p.account_types?.[0] || byName[p.accounts?.[0]];
  const accts = [...new Set((pq.data?.positions || []).filter((r) => r.product_code === item).map((r) => TYPE_LABEL[typeOf(r)]).filter(Boolean))].join(" + ");
  return (
    <PriceDrawer code={item} period={period} onPeriod={(k) => setParams({ ip: k === "hold" ? null : k })}
      onClose={close} pos={pos} scope={null} accountsLabel={accts} />
  );
}
