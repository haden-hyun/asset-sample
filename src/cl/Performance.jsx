import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useLocation, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { usePositions } from "../lib/queries.js";
import { useSources } from "../lib/sources.jsx";
import { Failed, Loading } from "./Shell.jsx";
import { InfoTip, ItemLink, PERIODS_PERF, PeriodSeg, SCOPES, ScopeTabs, useQueryPatch } from "./parts.jsx";
import { lineChart, useChart } from "./charts.js";
import { returnsChart } from "./perf-chart.js";
import { MINUS, dLabel, dir, isoMs, krw, md, pctP, sKrw, shortName } from "./format.js";
import "./perf.css";

/** 축 눈금 % — 10% 미만이고 소수가 있으면 1자리 */
const fp = (v) => (v >= 0 ? (v > 0 ? "+" : "") : MINUS) + Math.abs(v).toFixed(Math.abs(v) < 10 && v % 1 ? 1 : 0) + "%";
/** 배당 화면에 범위 탭이 있는 묶음 */
const DIV_SCOPES = ["ISA", "BROKERAGE", "PENSION_SAVINGS"];
const scopeQ = (scope) => (scope === "all" ? "" : `&scope_code=${scope}`);
const normScope = (c) => (!c || String(c).toLowerCase() === "all" ? "all" : c);
const periodLabel = (preset) => (preset === "all" ? "처음부터" : PERIODS_PERF.find(([k]) => k === preset)?.[1] || "");
/** 계열의 실제 기간(예 1/28–10/15). 계열이 없으면 기간 이름 */
const spanOf = (pts, preset) => (pts.length ? `${md(pts[0].date)}–${md(pts[pts.length - 1].date)}` : periodLabel(preset));

/** 묶음별 수익률 표 — 묶음 · 매입금 · 평가금 · 손익률 · 운용 수익률. 행을 누르면 setScope.
 *  매입금·평가금·손익률은 지금 보유(현금성 제외, 원화 실질원가) 기준이고 운용 수익률만 기간을 따른다.
 *  묶음별 원가 합 API 가 없어 계좌×종목 행을 scope_code 로 더한다. total = 배당 포함 기준 여부 */
function ScopeTable({ preset, scope, setScope, total }) {
  const q = useQuery({ queryKey: ["perf-scopes", preset], queryFn: () => api.get(`/performance/scopes?preset=${preset}`) });
  const pq = useQuery({ queryKey: ["positions", "account_product", "nocash"], queryFn: () => api.get("/positions?view=account_product&exclude_cash=true") });
  const book = useMemo(() => {
    if (!pq.data) return null;
    const o = { all: { cost: 0, ev: 0 } };
    (pq.data.positions || []).forEach((p) => {
      const c = p.cost_krw_real || 0, v = p.eval_krw || 0;
      o.all.cost += c; o.all.ev += v;
      if (!p.scope_code) return;
      const t = (o[p.scope_code] ||= { cost: 0, ev: 0 });
      t.cost += c; t.ev += v;
    });
    return o;
  }, [pq.data]);
  if (q.isLoading || pq.isLoading) return <Loading />;
  if (q.isError) return <Failed q={q} what="묶음별 수익률" />;
  const rows = (q.data?.rows || []).map((r) => ({ ...r, k: normScope(r.scope_code) }));
  return (
    <div className="cl-perf-st-wrap">
      <table className="cl-scope-t cl-perf-st">
        <caption className="sr-only">묶음별 매입금 · 평가금 · 손익률 · {total ? "운용" : "가격"} 수익률</caption>
        <thead><tr>
          <th scope="col">묶음</th><th scope="col" className="cl-n">매입금</th><th scope="col" className="cl-n">평가금</th>
          <th scope="col" className="cl-n">손익률</th><th scope="col" className="cl-n">{total ? "운용 수익률" : "가격 수익률"}</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => {
            const on = r.k === scope, b = book?.[r.k];
            // 재투자형·가상자산은 총수익률이 비어 가격 수익률이 곧 운용
            const v = total ? r.twr_total_pct ?? r.twr_price_pct : r.twr_price_pct;
            const pl = b && b.cost > 0 ? (b.ev / b.cost - 1) * 100 : null;
            return (
              <tr key={r.k} aria-selected={on} className={on ? "cl-row-on" : ""} onClick={() => setScope(r.k)}>
                <td className="cl-s-nm"><button type="button" className="cl-rowbtn" aria-pressed={on} onClick={(e) => { e.stopPropagation(); setScope(r.k); }}>{r.label}</button></td>
                <td className="cl-n cl-num">{b ? krw(b.cost) : "—"}</td>
                <td className="cl-n cl-num">{krw(b ? b.ev : r.ev_krw)}</td>
                <td className={`cl-n cl-num cl-${dir(pl)}`}>{pl == null ? "—" : pctP(pl, 1)}</td>
                <td className={`cl-n cl-num cl-${dir(v)}`}><b>{v == null ? "—" : pctP(v, 1)}</b></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 하락 폭 계열에서 가장 깊은 저점과 그 앞 고점·회복일을 찾는다. 회복 전이면 rec 는 null */
function ddMarks(d) {
  if (d.length < 2) return null;
  let lo = 0;
  d.forEach((p, i) => { if ((p.drawdown_pct ?? 0) < (d[lo].drawdown_pct ?? 0)) lo = i; });
  if (!((d[lo].drawdown_pct ?? 0) < 0)) return null;
  let pk = lo;
  while (pk > 0 && (d[pk].drawdown_pct ?? 0) < -1e-9) pk--;
  const r = d.findIndex((p, i) => i > lo && (p.drawdown_pct ?? 0) >= -1e-9);
  return { peak: d[pk].date, low: d[lo].date, rec: r < 0 ? null : Math.round((isoMs(d[r].date) - isoMs(d[lo].date)) / 864e5) };
}

/** 성과 본문 — 지표 3칸 · 수익률 차트 · 묶음별 수익률 · 원인 · 하락 폭. sum = 기간·묶음 요약 */
function Returns({ preset, sum, scope, setScope, divSrc }) {
  const total = sum.return_basis === "total";
  const [showEx, setShowEx] = useState(false);
  const rq = useQuery({ queryKey: ["series-returns", preset, scope], queryFn: () => api.get(`/performance/series?metric=returns&preset=${preset}${scopeQ(scope)}`) });
  const dq = useQuery({ queryKey: ["series-dd", preset, scope], queryFn: () => api.get(`/performance/series?metric=drawdown&preset=${preset}${scopeQ(scope)}`) });
  const r = useMemo(() => rq.data?.points || [], [rq.data]);
  const d = useMemo(() => dq.data?.points || [], [dq.data]);
  // ex = 재산정 제외 선(이벤트 날 일간 수익률만 빼고 다시 연결), inc = 가격 누적, tot = 배당 포함 누적(없으면 null)
  const { ex, inc, tot, evIndex } = useMemo(() => {
    let idx = 100;
    return {
      ex: r.map((p, i) => {
        if (i && p.daily_return_pct != null && !p.is_event) idx *= 1 + p.daily_return_pct / 100;
        return idx - 100;
      }),
      inc: r.map((p) => p.cum_twr_pct),
      tot: total && r.some((p) => p.cum_total_pct != null) ? r.map((p) => p.cum_total_pct ?? p.cum_twr_pct) : null,
      evIndex: r.map((p, i) => (p.is_event ? i : -1)).filter((i) => i >= 0),
    };
  }, [r, total]);
  const exOn = evIndex.length > 0 && (!tot || showEx);
  const twrRef = useChart((host, W) => {
    // 운용 선(배당 포함, 원천이 없으면 가격)은 0 위·아래 손익색 + 면, 가격 선·재산정 제외 선은 --muted 점선
    const main = tot || inc;
    const gap = (main[main.length - 1] ?? 0) - (ex[ex.length - 1] ?? 0);
    const extra = tot ? [{ v: inc, cls: "cl-l-muted", dy: 8 }] : [];
    if (exOn) extra.push({ v: ex, cls: "cl-l-muted cl-l-ex", dy: Math.abs(gap) < 3 ? 8 : 0 });
    const L = r.length - 1;
    const row = (k, v, cls = `cl-${dir(v)}`) => `<div class="cl-row"><span>${k}</span><span class="${cls}">${pctP(v, 2)}</span></div>`;
    returnsChart(host, W, {
      dates: r.map((p) => p.date), H: W < 520 ? 220 : W < 700 ? 260 : 320, main, extra, yFmt: fp, endFmt: pctP, evIndex,
      label: tot ? `누적 수익률. 운용 ${pctP(tot[L], 2)}, 가격 ${pctP(inc[L], 2)}, 배당 기여 ${pctP(tot[L] - inc[L], 2)}.` : `누적 수익률 ${pctP(inc[L], 2)}${exOn ? `, 재산정 제외 ${pctP(ex[L], 2)}` : ""}.`,
      hover: (i) => `<div class="cl-d">${dLabel(r[i].date)}</div>` + (tot
        ? row("운용", tot[i]) + row("가격", inc[i]) + row("배당 기여", tot[i] - inc[i], "")
        : row("운용", inc[i])) + (exOn ? row("재산정 제외", ex[i]) : "") + (r[i].is_event ? `<div class="cl-note">기준가 재산정 · 성과에 포함</div>` : ""),
      read: (i) => `${md(r[i].date)} · 운용 <b class="cl-${dir(main[i])}">${pctP(main[i], 2)}</b>${tot ? ` · 가격 <b class="cl-${dir(inc[i])}">${pctP(inc[i], 2)}</b>` : ""}`,
    });
  }, [rq.data, total, showEx]);
  const ddRef = useChart((host, W) => {
    lineChart(host, W, { dates: d.map((p) => p.date), H: 140, zero: 0, yFmt: fp, endFmt: pctP, label: `하락 폭. 지금 고점 대비 ${pctP(sum.current_drawdown_pct)}, 기간 최대 ${pctP(sum.mdd_pct)}.`, series: [{ v: d.map((p) => p.drawdown_pct), cls: "cl-l-dd", fill: "fall", invert: true, color: "fall" }] });
  }, [dq.data, sum.current_drawdown_pct, sum.mdd_pct]);
  const mk = useMemo(() => ddMarks(d), [d]);
  const span = spanOf(r, preset);
  const exPct = total && sum.twr_total_ex_events_pct != null ? sum.twr_total_ex_events_pct : sum.twr_ex_events_pct;
  // 내 돈 수익률은 기간값이 주 숫자 — 짧은 기간에 연율을 두면 크게 부풀어 읽힌다. 연율은 꼬리에만.
  // mwr_flag 'unstable' = 두 계산법이 1%p 넘게 갈림 → 참고치
  const mwrP = sum.mwr_period_pct, mwrYr = sum.annualizable ? sum.mwr_pct : null;
  const mwrTail = [sum.mwr_basis === "price" ? "가격 기준" : null, mwrYr != null ? `연 ${pctP(mwrYr)}` : null,
    sum.mwr_flag === "unstable" ? "참고치" : null].filter(Boolean);
  const divScope = DIV_SCOPES.includes(scope) ? scope : null;
  const main = total ? sum.twr_total_pct : sum.twr_pct;
  const mdd = sum.mdd_pct ?? 0;
  const ddTail = mk ? `고점 ${md(mk.peak)} → 저점 ${md(mk.low)}` : sum.mdd_date && mdd < 0 ? `저점 ${md(sum.mdd_date)}` : "하락 없음";
  return (
    <>
      <div className="cl-perf-kpis">
        <div className="cl-panel cl-perf-kpi"><div className="cl-label">운용 수익률{total ? "" : <span className="cl-tag">가격</span>}<InfoTip term={total ? "twrTotal" : "twrOp"} /></div>
          <div className={`cl-v cl-num cl-${dir(main)}`}>{pctP(main, 2)}</div>
          <div className="cl-h cl-num">{total ? `가격 ${pctP(sum.twr_price_pct, 2)} · 배당 ${pctP(sum.dividend_contrib_pct, 2)}` : "가격만"}</div></div>
        <div className="cl-panel cl-perf-kpi"><div className="cl-label">내 돈 수익률<InfoTip term="mwr" /></div>
          <div className={`cl-v cl-num cl-${dir(mwrP)}`}>{mwrP == null ? "—" : pctP(mwrP, 2)}</div>
          <div className="cl-h cl-num">{["기간값", ...mwrTail].join(" · ")}</div></div>
        <div className="cl-panel cl-perf-kpi"><div className="cl-label">하락 폭</div>
          <div className={`cl-v cl-num cl-${dir(mdd)}`}>{pctP(mdd)}</div>
          <div className="cl-h cl-num">{ddTail}</div></div>
      </div>
      {sum.event_dates?.length > 0 && (
        <div className="cl-notice">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.01" /></svg>
          <span>재산정 {sum.event_dates.map(md).join(", ")} 포함 · 제외 시 운용 수익률 <b className={`cl-${dir(exPct)} cl-num`}>{pctP(exPct)}</b></span>
        </div>
      )}
      <div className="cl-perf-row cl-perf-row-even">
        <section className="cl-panel cl-perf-card" aria-labelledby="perf-ret-h">
          <div className="cl-panel-head"><h2 id="perf-ret-h">수익률</h2><span className="cl-sub cl-num">누적{r.length ? ` · ${md(r[0].date)} 0%` : ""}</span></div>
          {rq.isError ? <Failed q={rq} what="수익률 추이" /> : <div className="cl-chart" ref={twrRef} />}
          <div className="cl-legend">
            <span><i className="cl-perf-lg-ret" />운용 수익률</span>
            {tot && <span><i className="cl-lg-mdash" />가격 수익률</span>}
            {exOn && <span><i className="cl-lg-mdash cl-lg-ex" />재산정 제외</span>}
            {evIndex.length > 0 && <span><i className="cl-lg-ring" />기준가 재산정</span>}
            {tot && evIndex.length > 0 && <button type="button" className="cl-btn-text cl-lg-toggle" aria-pressed={showEx} onClick={() => setShowEx((v) => !v)}>{showEx ? "제외 선 숨기기" : "제외 선 보기"}</button>}
          </div>
          {(total || sum.event_dates?.length > 0 || divSrc) && (
            <p className="cl-aux cl-num">
              {total && <><span className="cl-nw">가격 수익률<InfoTip term="twrPrice" /> <b className={`cl-${dir(sum.twr_price_pct)}`}>{pctP(sum.twr_price_pct, 2)}</b></span> · <span className="cl-nw">배당 기여<InfoTip term="divContrib" /> <b>{pctP(sum.dividend_contrib_pct, 2)}</b><span className="cl-tail">배당 {krw(sum.dividend_krw || 0)}</span></span></>}
              {sum.event_dates?.length > 0 && <>{total ? " · " : ""}재산정 제외 시 {sum.twr_total_ex_events_pct != null && total ? "운용" : "가격"} <b className={`cl-${dir(exPct)}`}>{pctP(exPct)}</b></>}
              {divSrc && <>{total || sum.event_dates?.length > 0 ? " · " : ""}<Link className="cl-nw" to={`/dividend${divScope ? `?scope=${divScope}` : ""}`}>배당 ›</Link></>}
            </p>
          )}
          {sum.observation_days > 0 && <p className="cl-perf-foot cl-num">관측 {sum.observation_days}일{sum.mwr_span_days ? ` · ${sum.mwr_span_days}일 구간` : ""}{sum.mwr_span_days > 365 ? " · 연 환산 함께 표시" : ""}</p>}
        </section>
        <section className="cl-panel cl-perf-card" aria-labelledby="perf-scope-h">
          <div className="cl-panel-head"><h2 id="perf-scope-h">묶음별 수익률</h2><span className="cl-sub cl-num">현금성 제외 · 운용 수익률만 현금 포함 {span}</span></div>
          <ScopeTable preset={preset} scope={scope} setScope={setScope} total={total} />
          {total && <p className="cl-perf-foot">배당락일 인식 · 퇴직연금 재투자형</p>}
        </section>
      </div>
      <div className="cl-perf-row">
        <Causes preset={preset} scope={scope} sum={sum} total={total} span={span} />
        <section className="cl-panel cl-perf-card" aria-labelledby="perf-dd-h">
          <div className="cl-panel-head"><h2 id="perf-dd-h">하락 폭</h2><b className={`cl-perf-fig cl-num cl-${dir(mdd)}`}>{pctP(mdd)}</b><span className="cl-sub">고점 대비 · 가격 기준</span></div>
          {dq.isError ? <Failed q={dq} what="하락 폭" /> : dq.isLoading ? <Loading /> : <div className="cl-chart" ref={ddRef} />}
          <dl className="cl-perf-dl cl-num">
            <dt>저점</dt><dd>{mk ? md(mk.low) : sum.mdd_date && mdd < 0 ? md(sum.mdd_date) : "—"}</dd>
            <dt>회복</dt><dd>{!mk ? "—" : mk.rec == null ? <span className="cl-tag">회복 전</span> : `${mk.rec}일`}</dd>
            <dt>현재</dt><dd className={`cl-${dir(sum.current_drawdown_pct)}`}>{pctP(sum.current_drawdown_pct)}</dd>
          </dl>
        </section>
      </div>
    </>
  );
}

/** 0 기준 가운데 막대 — v / mx 비율, 왼쪽 = 손실 · 오른쪽 = 이익. kind: "sum"(테두리) · "rest"(회색) */
function ZeroBar({ v, mx, kind }) {
  const w = (Math.abs(v) / mx) * 50;
  const cls = kind === "rest" ? "cl-perf-rest" : `cl-${v >= 0 ? "up" : "down"}${kind === "sum" ? " cl-perf-sum" : ""}`;
  return (
    <span className="cl-ctrack cl-perf-zt" aria-hidden="true">
      <i className={`cl-cbar ${cls}`} style={v >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }} />
      <span className="cl-br-axis" style={{ left: "50%" }} />
    </span>
  );
}

/** 원인 — 투자손익(입금 제외)을 요인(가격 · 환율 · 배당 · 기타 → 합계)과 종목 기여(상위 3 · 하위 3 · 그 외)로 쪼갠다 */
function Causes({ preset, scope, sum, total, span }) {
  const q = useQuery({ queryKey: ["contrib", preset, scope], queryFn: () => api.get(`/performance/contribution?preset=${preset}${scopeQ(scope)}`) });
  const pq = usePositions("account_product");
  const held = useMemo(() => new Set((pq.data?.positions || []).map((p) => p.product_code)), [pq.data]);
  const rows = useMemo(() => (q.data?.rows || []).slice().sort((a, b) => b.total_krw - a.total_krw), [q.data]);
  const top = rows.length > 6 ? [...rows.slice(0, 3), ...rows.slice(-3)] : rows;
  const rest = rows.filter((r) => !top.includes(r));
  const restSum = rest.reduce((a, r) => a + r.total_krw, 0);
  const pmx = Math.max(1, ...top.map((r) => Math.abs(r.total_krw)), Math.abs(restSum));
  const evRows = rows.filter((r) => r.event_driven && Math.abs(r.total_krw - (r.total_ex_events_krw ?? r.total_krw)) >= 1e5);
  // 투자손익 = 끝 − 시작 − 입금. 배당 원천이 있으면 지급 배당 대신 락일 배당(운용 수익률과 같은 기준)
  const div = total && sum.dividend_krw != null ? sum.dividend_krw : null;
  const paid = sum.dividend_paid_krw || 0;
  const gain = (sum.end_value_krw ?? 0) - (sum.start_value_krw ?? 0) - (sum.net_flow_krw ?? 0);
  const earned = div != null ? gain - paid + div : gain;
  const price = sum.price_gain_krw ?? 0, fx = sum.fx_gain_krw ?? 0;
  const parts = [["가격", price], ["환율", fx]];
  if (div != null) parts.push(["배당", div]);
  // 가격·환·배당으로 설명되지 않는 몫은 평가금의 0.1%를 넘을 때만 '기타'로
  const other = earned - parts.reduce((a, [, v]) => a + v, 0);
  if (Math.abs(other) > Math.abs(sum.end_value_krw || 0) * 0.001) parts.push(["기타", other]);
  const fmx = Math.max(1, ...parts.map(([, v]) => Math.abs(v)), Math.abs(earned));
  return (
    <section className="cl-panel cl-perf-card cl-perf-why" id="causes" aria-labelledby="perf-why-h">
      <div className="cl-panel-head"><h2 id="perf-why-h">원인</h2>
        <span className="cl-perf-fig cl-num"><span className="cl-perf-fig-k">투자손익</span> <b className={`cl-${dir(earned)}`}>{sKrw(earned)}</b></span>
        <span className="cl-sub cl-num">{span} · 입금 제외</span></div>
      <div className="cl-perf-why-grid">
        <div className="cl-perf-col">
          <h3 className="cl-perf-k">요인</h3>
          <ul className="cl-perf-zl cl-perf-zl-f" aria-label={`투자손익 ${sKrw(earned)} 요인`}>
            {parts.map(([nm, v]) => (
              <li key={nm}><span className="cl-perf-zn">{nm}</span><ZeroBar v={v} mx={fmx} /><span className={`cl-perf-zv cl-num cl-${dir(v)}`}>{sKrw(v)}</span></li>
            ))}
            <li className="cl-perf-zsum"><span className="cl-perf-zn">합계</span><ZeroBar v={earned} mx={fmx} kind="sum" /><span className={`cl-perf-zv cl-num cl-${dir(earned)}`}>{sKrw(earned)}</span></li>
          </ul>
        </div>
        <div className="cl-perf-col">
          <h3 className="cl-perf-k">종목 기여</h3>
          {q.isLoading ? <Loading /> : q.isError ? <Failed q={q} what="종목 기여" /> : !rows.length ? <p className="cl-goal-note">기여 종목 없음</p> : (
            <ul className="cl-perf-zl cl-perf-zl-p" aria-label="종목 기여 · 가격 + 환">
              {top.map((r) => (
                <li key={r.key}>
                  <span className="cl-perf-zn" title={r.label}>{held.has(r.key) ? <ItemLink code={r.key}>{shortName(r.label)}</ItemLink> : shortName(r.label)}</span>
                  <ZeroBar v={r.total_krw} mx={pmx} /><span className={`cl-perf-zv cl-num cl-${dir(r.total_krw)}`}>{sKrw(r.total_krw)}</span>
                </li>
              ))}
              {rest.length > 0 && (
                <li className="cl-perf-zrest"><span className="cl-perf-zn">그 외 {rest.length}종목</span><ZeroBar v={restSum} mx={pmx} kind="rest" /><span className="cl-perf-zv cl-num">{sKrw(restSum)}</span></li>
              )}
            </ul>
          )}
          {evRows.map((r) => (
            <p className="cl-goal-note cl-num" key={r.key}>{shortName(r.label)} · 재산정 제외 시 {sKrw(r.total_ex_events_krw)}</p>
          ))}
        </div>
      </div>
    </section>
  );
}

/** 옛 주소(?tab=div·dep·why·log) → 새 주소. 쓸모 있는 쿼리(scope·p)만 넘긴다 */
function moved(sp, raw) {
  const n = new URLSearchParams(sp);
  n.delete("tab");
  if (raw === "log") return "/allocation?tab=contrib#ledger";
  if (raw === "div") { n.delete("p"); const q = n.toString(); return `/dividend${q ? `?${q}` : ""}`; }
  if (raw === "dep") return "/allocation?tab=contrib";
  const q = n.toString();
  return `/performance${q ? `?${q}` : ""}#causes`;
}

export default function Performance() {
  const [sp] = useSearchParams();
  const { hash } = useLocation();
  const src = useSources();
  const raw = sp.get("tab");
  const preset = PERIODS_PERF.some(([k]) => k === sp.get("p")) ? sp.get("p") : "all";
  const scope = SCOPES.some(([k]) => k === sp.get("scope")) ? sp.get("scope") : "all";
  const setQ = useQueryPatch(); // 상태는 URL 하나에
  const setScope = (k) => setQ({ scope: k === "all" ? null : k });
  const old = ["div", "dep", "why", "log"].includes(raw);
  const sum = useQuery({
    queryKey: ["perf-sum", preset, scope], enabled: !old,
    queryFn: () => api.get(`/performance/summary?preset=${preset}${scopeQ(scope)}`),
  });
  const s = sum.data;
  // #causes 로 오면 원인 카드로 스크롤. 위 카드들이 늦게 그려져 높이가 바뀌므로 2.5초 동안
  // 높이 변화를 따라 다시 맞추고, 사용자가 먼저 스크롤하면 그만둔다
  const ready = !!s?.has_data;
  const root = useRef(null);
  useEffect(() => {
    if (hash !== "#causes" || !ready) return;
    const go = () => document.getElementById("causes")?.scrollIntoView({ block: "start" });
    const ro = new ResizeObserver(go);
    const stop = () => { ro.disconnect(); ["wheel", "touchstart", "keydown"].forEach((e) => window.removeEventListener(e, stop)); clearTimeout(t); };
    const t = setTimeout(stop, 2500);
    ["wheel", "touchstart", "keydown"].forEach((e) => window.addEventListener(e, stop, { passive: true }));
    if (root.current) ro.observe(root.current);
    requestAnimationFrame(go);
    return stop;
  }, [hash, ready]);
  if (old) return <Navigate to={moved(sp, raw)} replace />;
  const body = () => {
    if (sum.isLoading) return <div className="cl-panel"><Loading /></div>;
    if (sum.isError) return <div className="cl-panel"><Failed q={sum} what="성과 요약" /></div>;
    if (!s?.has_data) return <div className="cl-panel"><p className="cl-goal-note">이 기간 데이터 없음</p></div>;
    return <Returns preset={preset} sum={s} scope={scope} setScope={setScope} divSrc={src.dividend} />;
  };
  return (
    <section ref={root}>
      <div className="cl-page-head">
        <div><h1>성과</h1>{s?.has_data && <p className="cl-num">운용 {pctP(s.return_basis === "total" ? s.twr_total_pct : s.twr_pct, 2)} · {periodLabel(preset)}</p>}</div>
      </div>
      <div className="cl-filters cl-perf-filters">
        <ScopeTabs items={SCOPES} value={scope} onChange={setScope} label="관리 묶음" />
        <PeriodSeg items={PERIODS_PERF} value={preset} onChange={(k) => setQ({ p: k === "all" ? null : k })} label="기간" />
      </div>
      {body()}
    </section>
  );
}
