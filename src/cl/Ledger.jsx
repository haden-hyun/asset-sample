/* 입출금 내역 카드 — 입출금 · 적재 누락 · 기준가 재산정을 월별 타임라인으로. */
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { useDataHealth } from "../lib/queries.js";
import { Failed, Loading } from "./Shell.jsx";
import { PERIODS_PERF, PeriodSeg, SCOPES } from "./parts.jsx";
import { md, sKrw, sWon } from "./format.js";

/* 종류 필터 — 넓으면 알약 3개, 좁으면 select(같은 상태) */
const KINDS = [["dep", "입출금"], ["q", "누락"], ["ev", "재산정"]];
const ALL = KINDS.map(([k]) => k);
const MONTHS = { "1m": 1, "3m": 3, "6m": 6, "1y": 12 };
/** 기간 시작일(서버 resolve_preset 과 같은 규칙, 기준 = asOf). 'all' 은 null */
function startOf(preset, asOf) {
  if (!asOf || preset === "all") return null;
  const [y, m, d] = String(asOf).slice(0, 10).split("-").map(Number);
  if (preset === "ytd") return `${y}-01-01`;
  const n = MONTHS[preset];
  if (!n) return null;
  const last = new Date(Date.UTC(y, m - 1 - n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 - n, Math.min(d, last))).toISOString().slice(0, 10);
}

/**
 * preset = 처음 기간(이후 카드 안에서 바꾼다), scope = 관리 묶음(입출금에만 건다 — 누락·재산정은 전체 기준).
 * 카드 머리까지 그린다. 감싸는 .cl-panel 은 부르는 쪽이 둔다. 입출금은 달마다 한 줄로 접고 누르면 펼친다.
 */
export default function Ledger({ preset: preset0 = "ytd", scope = "all" }) {
  const [preset, setPreset] = useState(preset0);
  const loc = useLocation();
  const [kinds, setKinds] = useState(ALL);
  const [open, setOpen] = useState({});
  const sq = scope === "all" ? "" : `&scope_code=${scope}`;
  const flow = useQuery({ queryKey: ["series-flow", preset, scope], queryFn: () => api.get(`/performance/series?metric=flow&preset=${preset}${sq}`), placeholderData: (p) => p });
  const health = useDataHealth();
  const ready = flow.isSuccess && health.isSuccess;
  // #ledger 로 오면 이 카드로 스크롤 — 이동(loc.key)마다 한 번. 위 카드가 늦게 그려져 밀리면
  // 2.5초 동안 따라가고, 사용자가 스크롤·키 입력을 하면 멈춘다
  const scrolled = useRef(null);
  useEffect(() => {
    if (!ready || loc.hash !== "#ledger" || scrolled.current === loc.key) return;
    scrolled.current = loc.key;
    const el = document.getElementById("ledger");
    if (!el) return;
    el.scrollIntoView({ block: "start" });
    let stop = false;
    const quit = () => { stop = true; };
    const ro = new ResizeObserver(() => { if (!stop) el.scrollIntoView({ block: "start" }); });
    ro.observe(document.body);
    ["wheel", "touchstart", "keydown"].forEach((t) => window.addEventListener(t, quit, { once: true, passive: true }));
    const tm = setTimeout(() => ro.disconnect(), 2500);
    return () => { ro.disconnect(); clearTimeout(tm); ["wheel", "touchstart", "keydown"].forEach((t) => window.removeEventListener(t, quit)); };
  }, [ready, loc.hash, loc.key]);
  const pLabel = PERIODS_PERF.find(([k]) => k === preset)?.[1] || "전체";
  const head = (sub) => (
    <div className="cl-panel-head">
      <h2>입출금 내역</h2>
      <PeriodSeg items={PERIODS_PERF} value={preset} onChange={setPreset} />
      {sub != null && <span className="cl-sub cl-num">{sub}</span>}
    </div>
  );
  if (flow.isLoading || health.isLoading) return <>{head(null)}<Loading /></>;
  if (flow.isError) return <>{head(null)}<Failed q={flow} what="입출금" /></>;
  if (health.isError) return <>{head(null)}<Failed q={health} what="데이터 상태" /></>;

  const from = startOf(preset, health.data?.as_of);
  const inRange = (d) => !from || d >= from;
  const scoped = scope !== "all";
  const allTag = scoped ? <span className="cl-tag" title="누락·재산정은 계좌와 무관해 묶음으로 거르지 않습니다">전체 기준</span> : null;
  const months = {};
  const bucket = (d) => (months[d.slice(0, 7)] ||= { flows: [], items: [] });
  const flows = (flow.data?.points || []).filter((p) => Math.abs(p.flow_krw) >= 1000);
  flows.forEach((p) => bucket(p.date).flows.push(p));
  (health.data?.recent_gaps || []).filter((g) => inRange(g.date)).forEach((g) =>
    bucket(g.date).items.push({ d: g.date, k: "q", ty: "누락", c: "var(--q-part)", ds: `${g.stale_pairs}건 직전 값` }));
  (health.data?.price_events || []).filter((e) => inRange(e.date)).forEach((e) =>
    bucket(e.date).items.push({ d: e.date, k: "ev", ty: "재산정", c: "var(--q-part)", ds: `${e.magnitude_pct ? `+${Math.round(e.magnitude_pct)}% · ` : ""}성과에 포함` }));
  const keys = Object.keys(months).sort().reverse();
  const thisYear = String(health.data?.as_of || "").slice(0, 4);
  const showDep = kinds.includes("dep");
  const tIn = flows.filter((p) => p.flow_krw > 0).length, tNet = flows.reduce((a, p) => a + p.flow_krw, 0);
  const sLabel = SCOPES.find(([k]) => k === scope)?.[1];
  const flip = (k) => setKinds((ks) => (ks.includes(k) ? (ks.length > 1 ? ks.filter((x) => x !== k) : ks) : [...ks, k]));
  const selVal = kinds.length === ALL.length ? "all" : kinds.length === 1 ? kinds[0] : "mix";
  let shown = 0;

  return (
    <>
      {head(<>{pLabel}{scoped ? ` · ${sLabel}` : ""} · 입금 {tIn}일{flows.length - tIn ? ` · 출금 ${flows.length - tIn}일` : ""} · 순 {sKrw(tNet)}</>)}
      <div className="cl-led-head">
        <div className="cl-led-kind">
          <div className="cl-pills cl-led-pills" role="group" aria-label="종류">
            {KINDS.map(([k, l]) => <button key={k} type="button" aria-pressed={kinds.includes(k)} onClick={() => flip(k)}>{l}</button>)}
          </div>
          <label className="cl-field cl-led-sel">종류
            <select className="cl-sel" value={selVal} onChange={(e) => setKinds(e.target.value === "all" ? ALL : e.target.value === "mix" ? kinds : [e.target.value])}>
              <option value="all">전체</option>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}{selVal === "mix" && <option value="mix">선택 {kinds.length}종</option>}
            </select>
          </label>
        </div>
      </div>
      <p className="cl-scope-note cl-led-note">
        {scoped ? `${sLabel} · 계좌 간 이체 포함` : "전체 계좌 합계 · 이체 상쇄"} · 누락·재산정은 전체 기준
        {" · "}<Link className="cl-btn-text cl-led-in" to="/data">수기 입력</Link>
      </p>
      {keys.map((ym) => {
        const m = months[ym];
        const items = m.items.filter((e) => kinds.includes(e.k)).sort((a, b) => b.d.localeCompare(a.d));
        const showFlows = showDep && m.flows.length > 0;
        if (!items.length && !showFlows) return null;
        shown++;
        const net = m.flows.reduce((a, p) => a + p.flow_krw, 0);
        const ins = m.flows.filter((p) => p.flow_krw > 0).length;
        return (
          <div key={ym}>
            <div className="cl-tl-month">{ym.slice(0, 4) !== thisYear ? `${ym.slice(0, 4)}년 ` : ""}{+ym.slice(5, 7)}월</div>
            {showFlows && (
              <>
                <button type="button" className="cl-tl-sum" aria-expanded={!!open[ym]} onClick={() => setOpen((o) => ({ ...o, [ym]: !o[ym] }))}>
                  <span className="cl-dt" aria-hidden="true"><svg className={`cl-chev${open[ym] ? " cl-open" : ""}`} viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg></span>
                  <span className="cl-ty"><i style={{ background: "var(--accent)" }} />입출금</span>
                  <span className="cl-ds">입금 {ins}일 · 출금 {m.flows.length - ins}일</span>
                  <span className="cl-am" style={{ color: "var(--ink)" }}>순 {sWon(net)}</span>
                </button>
                {open[ym] && m.flows.slice().reverse().map((p) => (
                  <div className="cl-tl cl-sub" key={p.date}>
                    <span className="cl-dt">{md(p.date)}</span>
                    <span className="cl-ty"><i style={{ background: p.flow_krw > 0 ? "var(--accent)" : "var(--muted)" }} />{p.flow_krw > 0 ? "입금" : "출금"}</span>
                    <span className="cl-ds">{scoped ? "이체 포함" : ""}</span>
                    <span className="cl-am">{sWon(p.flow_krw)}</span>
                  </div>
                ))}
              </>
            )}
            {items.map((e, i) => (
              <div className="cl-tl" key={i}>
                <span className="cl-dt">{md(e.d)}</span>
                <span className="cl-ty"><i style={{ background: e.c }} />{e.ty}</span>
                <span className="cl-ds">{e.ds}{allTag}</span>
              </div>
            ))}
          </div>
        );
      })}
      {shown === 0 && <p className="cl-goal-note">기록 없음</p>}
    </>
  );
}
