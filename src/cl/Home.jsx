import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { useAllocations, useDividends, useGoals, useXray } from "../lib/queries.js";
import { useSources } from "../lib/sources.jsx";
import { Failed, Loading } from "./Shell.jsx";
import { GoalBars, InfoTip, ItemLink, PeriodSeg, PERIODS, scopeName, Side } from "./parts.jsx";
import { drawTrend2, useChart } from "./charts.js";
import { dLabel, dir, isoMs, krw, krwParts, md, monthsLeft, pctP, sKrw, shortName, tradeQty, won } from "./format.js";
import "./trend.css";
import "./home.css";

/** ISO 날짜 문자열(UTC) 더하기 */
const addDays = (iso, n) => new Date(isoMs(iso) + n * 864e5).toISOString().slice(0, 10);
const addMonths = (iso, n) => {
  const [y, m, d] = iso.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
};
/** 홈 화면 기간 = 공통 기간 + 앞뒤 1주·직접. 자산 추이 카드만 자체 기간(1년·전체) */
const RANGES = [["1w", "1주"], ...PERIODS, ["custom", "직접"]];
const MONTHS = { "1m": 1, "3m": 3, "6m": 6, "1y": 12 };

/**
 * URL(?r= · ?from=&to=) → 화면 기간 { r, qFrom, from, to, note, label, past }.
 * API는 date_from 날의 종가를 시작값으로 쓰므로 qFrom = 보이는 시작일(from)의 하루 전.
 */
function resolveRange(sp, asOf, first) {
  const r = sp.get("r") || (sp.get("from") || sp.get("to") ? "custom" : "1w");
  let qFrom, to = asOf, note = "";
  if (r === "custom") {
    to = sp.get("to") && sp.get("to") < asOf ? sp.get("to") : asOf;
    if (sp.get("to") && sp.get("to") > asOf) note = `${md(asOf)}까지 반영`;
    const f = sp.get("from") || addDays(to, -6);
    qFrom = addDays(f, -1);
  } else if (MONTHS[r]) qFrom = addMonths(asOf, -MONTHS[r]);
  else if (r === "all") qFrom = first;
  else qFrom = addDays(asOf, -7);
  if (qFrom < first) { qFrom = first; note = note || `데이터 ${md(first)}부터`; }
  if (qFrom > to) qFrom = to;
  const label = r === "custom" ? `${md(addDays(qFrom, 1))}–${md(to)}` : RANGES.find((x) => x[0] === r)?.[1] || "1주";
  return { r, qFrom, from: addDays(qFrom, 1), to, note, label, past: to !== asOf };
}

/** 화면 기간 요약 — 총자산 오른쪽과 시장 카드가 같은 쿼리를 나눠 쓴다 */
const useRangeSummary = (rg) => useQuery({
  queryKey: ["perf-sum", "range", rg.qFrom, rg.to],
  queryFn: () => api.get(`/performance/summary?date_from=${rg.qFrom}&date_to=${rg.to}`),
  placeholderData: (prev) => prev,
  enabled: rg.qFrom < rg.to,
});
/** 운용 수익률 { tot: 총수익률 여부, v } — 배당 원천이 없으면 가격 기준(성과 화면과 같다) */
const opRet = (s) => {
  const tot = s.return_basis === "total" && s.twr_total_pct != null;
  return { tot, v: tot ? s.twr_total_pct : s.twr_pct };
};

/** 퍼센트 증감(손익색 · ▲▼). 값이 없으면 — */
const Delta = ({ v, dec = 2 }) =>
  v == null ? <b className="cl-num">—</b> : <b className={`cl-delta cl-${dir(v)} cl-num`}>{pctP(v, dec)}</b>;
/** 큰 금액(숫자 + 단위). signed = 부호 붙임 */
const Big = ({ v, signed, title, className = "" }) => {
  const [n, u] = krwParts(v);
  const s = signed && n !== "0" && n !== "—" ? (v > 0 ? "+" : "−") : "";
  return <div className={`cl-big${className && ` ${className}`}`} title={title}><span className="cl-bn">{s}{n}</span><span className="cl-unit">{u}</span></div>;
};
const NO_PREV = <p className="cl-goal-note">비교할 전날 없음</p>;

/** 점검 항목 [{ title, tag, why, measure, go, to }] — 배분 범위 밖 · 쏠림 경고 · 남은 납입 목표 · 기준가 재산정 */
function useCheckItems(sumAll) {
  const { scopes, details } = useAllocations();
  const xray = useXray();
  const goals = useGoals();
  const loading = scopes.isLoading || xray.isLoading || goals.isLoading || details.some((d) => d.isLoading);
  const items = [];
  details.forEach((d) => {
    (d.data?.categories || []).forEach((c) => {
      if (c.in_band === false)
        items.push({
          title: `${scopeName(d.data)} ${shortName(c.category_name)}`, tag: "범위 밖",
          why: "목표 비중에서 멀어질수록 처음 정한 위험 수준과 달라집니다.",
          measure: `${c.current_ratio_pct.toFixed(1)}% / ${c.target_ratio_pct}±${c.band_pp}`,
          go: "리밸런싱 계산", to: `/allocation?tab=rebal&scope=${d.data.scope_code}`,
        });
    });
  });
  (xray.data?.rules || []).filter((r) => r.verdict === "warn").forEach((r) =>
    items.push({
      title: r.label, tag: "주의", why: r.detail,
      measure: `${Number(r.value).toLocaleString("ko-KR")}${r.unit || ""} / 기준 ${Number(r.threshold?.warn).toLocaleString("ko-KR")}${r.unit || ""}`,
      go: "쏠림 점검", to: "/allocation#concentration",
    }));
  const g = goals.data?.goals?.find((x) => x.remaining_krw > 0);
  if (g) {
    const left = monthsLeft(goals.data.as_of);
    items.push({
      title: g.label, tag: "남음",
      why: "연말까지 채우지 못하면 남은 금액만큼 목표(세액공제 한도)에 못 미칩니다.",
      measure: `${krw(g.remaining_krw)} · 월 ${krw(g.remaining_krw / left)} × ${left}개월`,
      go: "납입 계획", to: "/allocation?tab=contrib",
    });
  }
  if (sumAll.event_dates?.length)
    items.push({
      title: "기준가 재산정", tag: `${sumAll.event_dates.length}건`,
      why: `${sumAll.event_dates.map(dLabel).join(", ")} 일회성 재산정이라 운용 실력과는 다릅니다.`,
      measure: `빼면 운용 수익률 ${pctP(sumAll.twr_ex_events_pct)}`,
      go: "성과", to: "/performance",
    });
  return { items, loading };
}

/** 점검 띠 — 기본 접힘('점검 n' + 대상 한 줄), 펼치면 대상 · 꼬리표 · 수치(+이유) · 행동 */
function CheckBand({ sumAll }) {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const { items, loading } = useCheckItems(sumAll);
  if (loading) return <section className="cl-hm-checks" aria-busy="true"><div className="cl-hm-chk-row"><span className="cl-hm-chk-h">점검</span></div></section>;
  if (!items.length)
    return <section className="cl-hm-checks"><div className="cl-hm-chk-row"><span className="cl-hm-chk-h">점검</span><span className="cl-hm-chk-ok">✓ 이상 없음</span></div></section>;
  return (
    <section className="cl-hm-checks">
      <button type="button" className="cl-hm-chk-row cl-hm-chk-toggle" aria-expanded={open} aria-controls="hm-checks" onClick={() => setOpen((o) => !o)}>
        <span className="cl-hm-chk-h">점검 <span className="cl-num">{items.length}</span></span>
        {!open && (
          <span className="cl-hm-chk-sum">
            {items.map((it, i) => <span key={`${it.to}-${it.tag}-${it.title}`}>{i > 0 && <span className="cl-hm-dot" aria-hidden="true"> · </span>}{it.title}<span className="cl-tag cl-chk-tag">{it.tag}</span></span>)}
          </span>
        )}
        <svg className="cl-hm-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <ul className="cl-hm-chk-list" id="hm-checks">
          {items.map((it, i) => (
            <li key={`${it.to}-${it.tag}-${it.title}`}>
              <b className="cl-hm-chk-t">{it.title}</b>
              <span className="cl-tag cl-chk-tag">{it.tag}</span>
              <span className="cl-hm-chk-m">
                <span className="cl-num">{it.measure}</span>
                {it.why && <small>{it.why}</small>}
              </span>
              <button type="button" className={i === 0 ? "cl-btn" : "cl-btn-ghost"} onClick={() => nav(it.to)}>{it.go}</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** 총자산 카드 — 왼쪽 = 끝 날짜 잔액 + 처음부터 누적, 오른쪽 = 화면 기간(RangePart) */
function Total({ sumAll, rg, divOn, onLatest }) {
  // 입금액/투자손익은 기간과 무관하게 처음부터 누적 — 기간 기준이면 이전 투자손익이 '입금액'으로 둔갑한다
  const upto = useQuery({
    queryKey: ["perf-sum", "upto", rg.to], enabled: rg.past,
    queryFn: () => api.get(`/performance/summary?date_to=${rg.to}`), placeholderData: (prev) => prev,
  });
  const cum = rg.past ? upto.data : sumAll;
  const head = (
    <div className="cl-panel-head">
      <h2>총자산{rg.past && <span className="cl-tag">과거 시점</span>}</h2>
      <span className="cl-sub cl-num">{md(rg.to)} 잔액</span>
      {rg.past && <button type="button" className="cl-btn-text" onClick={onLatest}>최신으로</button>}
    </div>
  );
  let left;
  if (upto.isError) left = <Failed q={upto} what="총자산" />;
  else if (!cum) left = <Loading />;
  else {
    // 배당 원천이 있으면 투자손익 = 지급 배당(평가금에 이미 있음)을 빼고 락일 배당을 더한 값
    const div = divOn && cum.dividend_krw != null ? cum.dividend_krw : null;
    const total = cum.end_value_krw, principal = cum.start_value_krw + cum.net_flow_krw, earned = total - principal - (cum.dividend_paid_krw || 0) + (div || 0);
    // 입금액/투자손익 막대 — 이익은 입금액 뒤에 잇고, 손실은 입금액 끝의 잃은 몫을 빗금으로
    const M = Math.max(1, principal + Math.max(0, earned));
    const pw = (Math.max(0, principal) / M) * 100, ew = (Math.min(Math.abs(earned), Math.max(0, principal)) / M) * 100;
    left = (
      <>
        <Big v={total} title={`${won(total)}원`} />
        <div className="cl-hm-tcum"><span className="cl-tag">처음부터 누적</span></div>
        <dl className="cl-hm-tdl">
          <dt><span className="cl-label">내 돈 수익률</span><InfoTip term="mwr" /></dt>
          <dd><Delta v={cum.mwr_period_pct} />{cum.annualizable && cum.mwr_pct != null && <span className="cl-mini-note cl-num">연 {pctP(cum.mwr_pct)}</span>}</dd>
          <dt><span className="cl-sw" style={{ background: "var(--accent-soft)" }} /><span className="cl-label">입금액</span></dt>
          <dd><b className="cl-num">{krw(principal)}</b></dd>
          <dt>
            <span className={`cl-sw cl-hm-sw-${dir(earned)}`} />
            <span className="cl-label">투자손익</span><InfoTip term={div != null ? "earnTotal" : "earnPrice"} />
            <span className="cl-tag">{div != null ? "배당 포함" : "가격"}</span>
          </dt>
          <dd><b className={`cl-num cl-${dir(earned)}`}>{sKrw(earned)}</b></dd>
        </dl>
        <div className="cl-hm-pe" role="img" aria-label={`입금액 ${krw(principal)}, 투자손익 ${sKrw(earned)}`}>
          {earned >= 0 ? (
            <><i className="cl-hm-pe-p" style={{ width: `${pw}%` }} /><i className="cl-hm-pe-e cl-up" style={{ width: `${ew}%` }} /></>
          ) : (
            <><i className="cl-hm-pe-p" style={{ width: `${pw - ew}%` }} /><i className="cl-hm-pe-e cl-down" style={{ width: `${ew}%` }} /></>
          )}
        </div>
      </>
    );
  }
  return (
    <div className="cl-panel cl-hero cl-hm-total">
      {head}
      <div className="cl-hm-tot2">
        <div className="cl-hm-tl">{left}</div>
        <div className="cl-hm-tr"><RangePart rg={rg} /></div>
      </div>
    </div>
  );
}

/** 총자산 오른쪽 — 화면 기간 증감(입금이 섞여 손익색 없음) + 운용 수익률 + 입금 / 시장 → 가격 · 환 · 배당 */
function RangePart({ rg }) {
  const q = useRangeSummary(rg);
  const s = q.data;
  const pp = ["1m", "3m", "6m", "1y", "all"].includes(rg.r) ? `?p=${rg.r}` : "";
  const head = (
    <div className="cl-hm-tr-head">
      <span className="cl-tag cl-num">{md(rg.from)}–{md(rg.to)}</span>
      {rg.note && <span className="cl-hm-tr-note cl-num">{rg.note}</span>}
      <Link className="cl-btn-text" to={`/performance${pp}#causes`}>성과 ›</Link>
    </div>
  );
  if (rg.qFrom >= rg.to) return <>{head}{NO_PREV}</>;
  if (q.isError) return <>{head}<Failed q={q} what="기간 증감" /></>;
  if (!s) return <>{head}<Loading /></>;
  if (!s.has_data) return <>{head}<p className="cl-goal-note">기간 데이터 없음</p></>;
  const ch = s.end_value_krw - s.start_value_krw, dep = s.net_flow_krw, mk = s.total_gain_krw;
  const op = opRet(s);
  const paid = Math.abs(s.dividend_paid_krw || 0) >= 1 ? s.dividend_paid_krw : null;
  const rows = [
    { k: dep < 0 ? "출금" : "입금", v: dep, kind: "dep" },
    { k: "시장", v: mk, kind: "mk" },
    { k: "가격", v: s.price_gain_krw, sub: true },
    { k: "환", v: s.fx_gain_krw, sub: true },
    ...(paid != null ? [{ k: "배당", v: paid, sub: true }] : []),
  ];
  const M = Math.max(1, ...rows.map((r) => Math.abs(r.v || 0)));
  return (
    <div aria-busy={q.isFetching}>
      {head}
      <div className="cl-hm-rangefig">
        <Big v={ch} signed />
        <span className="cl-hm-kv">
          <span className="cl-label">운용 수익률</span><InfoTip term={op.tot ? "twrTotal" : "twrOp"} />
          <Delta v={op.v} />
          {!op.tot && <span className="cl-tag">가격</span>}
        </span>
      </div>
      <div className="cl-hm-flow" role="list">
        {rows.map((r) => (
          <div key={r.k} role="listitem" className={r.sub ? "cl-hm-flow-sub" : ""}>
            <span className="cl-hm-flow-k">{r.k}</span>
            <span className="cl-hm-track">
              <i className={r.kind === "dep" ? `cl-hm-dep${r.v < 0 ? " cl-neg" : ""}` : `cl-${dir(r.v)}`} style={{ width: `${(Math.abs(r.v || 0) / M) * 100}%` }} />
            </span>
            {/* 입금은 성과가 아니라 잉크(DESIGN §1-4) */}
            <b className={`cl-num${r.kind === "dep" ? "" : ` cl-${dir(r.v)}`}`}>{sKrw(r.v)}</b>
          </div>
        ))}
      </div>
      {(s.stale_days > 0 || s.event_dates?.length > 0) && (
        <p className="cl-goal-note cl-num">
          {s.stale_days > 0 && `누락 ${s.stale_days}일 · 직전 값`}
          {s.stale_days > 0 && s.event_dates?.length > 0 && " · "}
          {s.event_dates?.length > 0 && `재산정 ${s.event_dates.length}건 · 제외 시 ${pctP(s.twr_ex_events_pct, 2)}`}
        </p>
      )}
    </div>
  );
}

const TOP = 5;
/** 등락 TOP 5 — 보유 종목 원화 기간 등락률 상·하위 5 */
function Movers({ rg }) {
  const q = useQuery({
    queryKey: ["movers", rg.qFrom, rg.to],
    queryFn: () => api.get(`/positions/movers?date_from=${rg.qFrom}&date_to=${rg.to}`),
    placeholderData: (prev) => prev,
    enabled: rg.qFrom < rg.to,
  });
  const d = q.data;
  const rows = d?.rows || [];
  const up = rows.filter((r) => r.change_pct > 0).sort((a, b) => b.change_pct - a.change_pct).slice(0, TOP);
  const down = rows.filter((r) => r.change_pct < 0).sort((a, b) => a.change_pct - b.change_pct).slice(0, TOP);
  const col = (label, list) => (
    <div>
      <span className="cl-label">{label}</span>
      {list.length === 0 ? <p className="cl-goal-note">{label} 없음</p> : (
        <ul className="cl-hm-mv">
          {list.map((r) => (
            <li key={r.product_code}>
              <ItemLink code={r.product_code} title={r.start_date ? `${r.product_name} · ${md(r.start_date)}부터` : r.product_name}>{shortName(r.product_name)}{r.start_date ? <sup className="cl-hm-mv-late" aria-label={`${md(r.start_date)}부터`}>*</sup> : null}</ItemLink>
              <span className={`cl-num cl-${dir(r.change_krw)}`}>{sKrw(r.change_krw)}</span>
              <Delta v={r.change_pct} dec={1} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  return (
    <div className="cl-panel" aria-busy={q.isFetching}>
      <div className="cl-panel-head">
        <h2>등락 TOP 5</h2>
        <span className="cl-sub cl-num">{d?.clipped ? `${md(d.date_from)}부터` : rg.label} · 원화</span>
      </div>
      {rg.qFrom >= rg.to ? NO_PREV :
        q.isError ? <Failed q={q} what="등락 TOP 5" /> : !d ? <Loading /> : !rows.length ? <p className="cl-goal-note">등락 없음</p> : (
          <div className="cl-hm-mv2">{col("상승", up)}{col("하락", down)}</div>
        )}
      <div className="cl-hm-foot">
        <span className="cl-num">비중 0.5% 미만 제외{d?.skipped ? ` · 시세 없음 ${d.skipped}` : ""}{rows.some((r) => r.start_date) ? " · 기간 중 편입은 첫 시세부터" : ""}</span>
        <Link className="cl-btn-text" to="/portfolio">보유 ›</Link>
      </div>
    </div>
  );
}

const OVERSEAS = new Set(["SPX", "COMP"]);
const fmt2 = (v) => (v == null ? "—" : Math.abs(v).toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
/** 시장 스파크라인 72×20 — pts [{date, close}], end = 끝점 색(up·down·flat·fx). 보유 '3개월 추이'와 같은 그림 */
function Spark({ pts, end }) {
  const ok = (pts || []).filter((p) => p.close != null);
  if (ok.length < 2) return <span className="cl-hm-spark-none" aria-hidden="true">—</span>;
  const W = 72, H = 20;
  const t0 = isoMs(ok[0].date), t1 = isoMs(ok[ok.length - 1].date);
  const vs = ok.map((p) => p.close), lo = Math.min(...vs), hi = Math.max(...vs);
  const x = (d) => ((isoMs(d) - t0) / (t1 - t0 || 1)) * (W - 4);
  const y = (v) => 2 + (1 - (v - lo) / (hi - lo || 1)) * (H - 4);
  const d = ok.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.close).toFixed(1)}`).join("");
  const last = ok[ok.length - 1];
  return (
    <svg className="cl-hm-spark" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <line className="cl-hm-spark-base" x1="0" x2={W - 4} y1={y(ok[0].close)} y2={y(ok[0].close)} />
      <path className="cl-hm-spark-line" d={d} />
      <circle className={`cl-hm-spark-end cl-hm-sp-${end}`} cx={x(last.date)} cy={y(last.close)} r="2.5" />
    </svg>
  );
}
/** 시장 — 지수 · 환율 종가와 기간 변동, 아래 내 운용 수익률 */
function Market({ rg }) {
  const q = useQuery({
    queryKey: ["market", rg.qFrom, rg.to],
    queryFn: () => api.get(`/market/overview?date_from=${rg.qFrom}&date_to=${rg.to}`),
    placeholderData: (prev) => prev,
    enabled: rg.qFrom < rg.to,
  });
  const sq = useRangeSummary(rg);
  const d = q.data;
  const idx = d?.indices_available ? d.indices || [] : [];
  const items = [...idx.map((x) => ({ ...x, fx: false })), ...(d?.fx || []).map((x) => ({ ...x, fx: true }))];
  const ovs = idx.filter((x) => OVERSEAS.has(x.key) && x.series?.length);
  const ovDate = ovs.length ? ovs.map((x) => x.series[x.series.length - 1].date).sort()[0] : null;
  const op = sq.data?.has_data ? opRet(sq.data) : null;
  return (
    <div className="cl-panel cl-hm-mkp" aria-busy={q.isFetching}>
      <div className="cl-panel-head">
        <h2>시장</h2>
        <span className="cl-sub cl-num">{rg.label} · 종가</span>
      </div>
      {rg.qFrom >= rg.to ? NO_PREV :
        q.isError ? <Failed q={q} what="시장" /> : !d ? <Loading /> : !items.length ? <p className="cl-goal-note">시장 데이터 없음</p> : (
          <div className="cl-hm-mk" role="table" aria-label="시장 종가와 기간 변동">
            <div role="row" className="cl-hm-mk-h">
              <span role="columnheader">{idx.length ? "지수 · 환율" : "환율"}</span><span role="columnheader">종가</span><span role="columnheader">변동</span><span role="columnheader" aria-hidden="true" />
            </div>
            {items.map((x) => {
              const dr = dir(x.change);
              return (
                <div role="row" key={x.key}>
                  <span role="cell" className="cl-hm-mk-n">{x.name}</span>
                  <span role="cell" className="cl-num">{fmt2(x.close)}</span>
                  {/* 지수는 손익색, 환율은 잉크(▲▼·부호는 둘 다) */}
                  <b role="cell" className={`cl-delta cl-${dr} cl-num${x.fx ? " cl-hm-ink" : ""}`}>
                    {dr === "flat" ? "" : x.change > 0 ? "+" : "−"}{fmt2(x.change)} · {x.change_pct == null ? "—" : pctP(x.change_pct, 1)}
                  </b>
                  <span role="cell"><Spark pts={x.series} end={x.fx ? "fx" : dr} /></span>
                </div>
              );
            })}
          </div>
        )}
      <div className="cl-hm-mine">
        <span className="cl-label">내 운용 수익률{op && !op.tot && <span className="cl-tag">가격</span>}</span>
        <Delta v={op?.v} />
      </div>
      {ovDate && <div className="cl-hm-foot"><span className="cl-num">해외 {md(ovDate)} 현지 종가</span></div>}
    </div>
  );
}

const TREND_PER = [["1y", "1년"], ["all", "전체"]];
/** 품질 등급 → 표시: partial = 일부 누락(◐), degraded = 이상(▲) */
const QG = { partial: "part", degraded: "bad" };
/** 자산 추이 — 평가금 · 입금액 두 선과 사이 면(이익·손실 구간). pts = 일별 계열, quality = 날짜별 품질 등급 */
function TrendPanel({ pts, quality, divOn }) {
  const [period, setPeriod] = useState("all");
  const first = pts[0].date, last = pts[pts.length - 1].date;
  const from = period === "1y" ? addMonths(last, -12) : first;
  const data = useMemo(() => {
    // 등급이 없는 날은 이월 여부로만 본다
    const qOf = Object.fromEntries((quality || []).map((x) => [x.date, QG[x.grade] || "ok"]));
    const sl = pts.filter((p) => p.date >= from);
    return sl.map((p, i) => ({
      date: p.date, v: p.market_value_krw, p: p.invested_krw, q: qOf[p.date] || (p.is_stale ? "part" : "ok"), ev: p.is_event,
      flow: i ? p.invested_krw - sl[i - 1].invested_krw : 0, d: p.dividend_cum_krw ?? null, pd: p.dividend_paid_cum_krw || 0,
    }));
  }, [pts, quality, from]);
  const on = divOn && data.some((o) => o.d != null);
  const label = TREND_PER.find((p) => p[0] === period)[1];
  const ref = useChart((host, W) => drawTrend2(host, W, data, { weekly: true, divOn: on, label }), [data, on, label]);
  if (data.length < 2) return <div className="cl-panel"><p className="cl-goal-note">데이터 없음</p></div>;
  const b = data[data.length - 1];
  const nPart = data.filter((o) => o.q === "part").length, nBad = data.filter((o) => o.q === "bad").length;
  return (
    <div className="cl-panel">
      <div className="cl-panel-head">
        <div className="cl-trend-title">
          <h2>자산 추이</h2>
          <span className="cl-trend-fig cl-num">{krw(b.v)}</span>
        </div>
        <PeriodSeg items={TREND_PER} value={period} onChange={setPeriod} label="자산 추이 기간" />
      </div>
      <div className="cl-chart" ref={ref} />
      <div className="cl-legend">
        <span><i className="cl-lg-line" />평가금</span><span><i className="cl-lg-dash" />입금액</span>
        <span><i className="cl-lg-wash-up" />이익 구간</span><span><i className="cl-lg-wash-down" />손실 구간</span>
        {data.some((o) => o.ev) && <span><i className="cl-lg-ring" />기준가 재산정</span>}
        {nPart > 0 && <span><span className="cl-q-part-t" aria-hidden="true">◐</span>일부 누락 {nPart}일</span>}
        {nBad > 0 && <span><span className="cl-q-bad-t" aria-hidden="true">▲</span>이상 {nBad}일</span>}
      </div>
      {from < first && <p className="cl-goal-note cl-num" style={{ marginTop: 6 }}>데이터 {md(first)}부터</p>}
    </div>
  );
}

/** 기간 매매 — 매수 위 · 매도 아래, 각 금액 상위 5. 매수 = 낸 돈(원가 증가), 매도 = 판 수량 × 직전 평가액(추정) */
function Trades({ rg }) {
  const q = useQuery({
    queryKey: ["trades", rg.qFrom, rg.to],
    queryFn: () => api.get(`/positions/trades?date_from=${rg.qFrom}&date_to=${rg.to}`),
    placeholderData: (prev) => prev,
    enabled: rg.qFrom < rg.to,
  });
  const d = q.data;
  const col = (side, label, total) => {
    const list = (d.rows || []).filter((r) => r.side === side).slice(0, TOP);
    return (
      <div>
        <div className="cl-hm-trd-h">
          <Side s={side} />
          <b className="cl-num">{side === "sell" && total ? `추정 ${krw(total)}` : krw(total)}</b>
        </div>
        {list.length === 0 ? <p className="cl-goal-note">{label} 없음</p> : (
          <ul className="cl-hm-mv cl-hm-trd">
            {list.map((r) => (
              <li key={r.product_code}>
                <span title={`${r.product_name} · ${r.count}회 · 마지막 ${md(r.last_date)}`}>{shortName(r.product_name)}</span>
                <b className="cl-num">{krw(r.amount_krw)}</b>
                <span className="cl-num cl-hm-trd-d">{tradeQty(r.qty, r.asset_type, true)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };
  return (
    <div className="cl-panel" aria-busy={q.isFetching}>
      <div className="cl-panel-head">
        <h2>기간 매매</h2>
        <span className="cl-sub cl-num">{rg.label} · 원화</span>
      </div>
      {rg.qFrom >= rg.to ? NO_PREV :
        q.isError ? <Failed q={q} what="기간 매매" /> : !d ? <Loading /> : (
          <div className="cl-hm-mv2">{col("buy", "매수", d.buy_krw)}{col("sell", "매도", d.sell_krw)}</div>
        )}
      <div className="cl-hm-foot">
        <span className="cl-num">매도는 직전 평가액 기준{d?.ignored ? ` · 수량만 바뀐 날 ${d.ignored}건 제외` : ""}</span>
        <Link className="cl-btn-text" to="/trades">매매 ›</Link>
      </div>
    </div>
  );
}

/** 이번 달 배당 — 받음 · 예정 · 다음 지급. 배당 데이터가 없으면 카드를 그리지 않는다 */
function DividendCard() {
  const q = useDividends("all", "pre");
  const t = q.data?.available ? q.data.this_month : null;
  if (q.data && !t) return null;
  return (
    <div className="cl-panel">
      <div className="cl-panel-head">
        <h2>이번 달 배당</h2>
        <span className="cl-sub">세전</span>
        <Link className="cl-btn-text" to="/dividend">배당 ›</Link>
      </div>
      {q.isError ? <Failed q={q} what="이번 달 배당" /> : !t ? <Loading /> : (
        <>
          <Big v={(t.received_krw || 0) + (t.pending_krw || 0)} className="cl-hm-big-sm" />
          <dl className="cl-hm-dl">
            <dt>받음</dt><dd className="cl-num">{krw(t.received_krw || 0)}</dd>
            <dt>예정</dt><dd className="cl-num">{krw(t.pending_krw || 0)}{t.pending_count ? ` · ${t.pending_count}건${t.estimated_count ? ` · 추정 ${t.estimated_count}` : ""}` : ""}</dd>
            {t.next && <><dt>다음 지급</dt><dd className="cl-num"><span title={t.next.product_name}>{md(t.next.pay_date)} · {shortName(t.next.product_name)}</span></dd></>}
          </dl>
        </>
      )}
    </div>
  );
}

export default function Home() {
  const src = useSources();
  const [sp, setSp] = useSearchParams();
  const sum = useQuery({ queryKey: ["perf-sum", "all"], queryFn: () => api.get("/performance/summary?preset=all") });
  const ser = useQuery({ queryKey: ["series-value", "all"], queryFn: () => api.get("/performance/series?metric=value&preset=all") });
  const pts = ser.data?.points || [];
  const ready = sum.data && pts.length > 0;
  const rg = ready ? resolveRange(sp, sum.data.as_of, pts[0].date) : null;
  const [draft, setDraft] = useState(null);
  const editing = draft != null || rg?.r === "custom";
  const pick = (k) => {
    if (k === "custom") { setDraft({ from: rg.from, to: rg.to }); return; }
    setDraft(null);
    setSp(k === "1w" ? {} : { r: k }, { replace: true });
  };
  const dv = draft || (rg ? { from: rg.from, to: rg.to } : null);
  const bad = dv && dv.from > dv.to;
  const apply = (e) => {
    e.preventDefault();
    if (!bad) { setSp({ from: dv.from, to: dv.to }, { replace: true }); setDraft(null); }
  };
  return (
    <section>
      <div className="cl-page-head">
        <div><h1>홈</h1>{sum.data?.as_of && <p className="cl-num">{md(sum.data.as_of)} 종가</p>}</div>
        {rg && <PeriodSeg items={RANGES} value={editing ? "custom" : rg.r} onChange={pick} label="화면 기간" />}
      </div>
      {rg && editing && (
        <form className="cl-range-form cl-hm-range" onSubmit={apply}>
          <label className="cl-field" htmlFor="rg-from">시작일<input id="rg-from" type="date" min={addDays(pts[0].date, 1)} max={sum.data.as_of} value={dv.from} onChange={(e) => setDraft({ ...dv, from: e.target.value })} /></label>
          <label className="cl-field" htmlFor="rg-to">끝일<input id="rg-to" type="date" min={addDays(pts[0].date, 1)} max={sum.data.as_of} value={dv.to} onChange={(e) => setDraft({ ...dv, to: e.target.value })} /></label>
          <button className="cl-btn" type="submit" disabled={bad || !dv.from || !dv.to}>적용</button>
          {bad && <span className="cl-mini-note" role="alert">시작일이 끝일보다 늦음</span>}
        </form>
      )}
      {sum.isError ? <Failed q={sum} what="성과 요약" /> : ser.isError ? <Failed q={ser} what="자산 추이" /> :
        !ready ? <Loading /> : (
          <div className="cl-hm">
            <CheckBand sumAll={sum.data} />
            <div className="cl-hm-row21">
              <Total sumAll={sum.data} rg={rg} divOn={src.dividend} onLatest={() => pick("1w")} />
              <Movers rg={rg} />
            </div>
            <div className="cl-hm-row21">
              <TrendPanel pts={pts} quality={ser.data?.meta?.quality} divOn={src.dividend} />
              <Market rg={rg} />
            </div>
            <div className="cl-hm-row3">
              <Trades rg={rg} />
              {src.dividend && <DividendCard />}
              <div className="cl-panel">
                <div className="cl-panel-head">
                  <h2>납입 목표</h2>
                  <Link className="cl-btn-text" to="/allocation?tab=contrib">납입 ›</Link>
                </div>
                <GoalBars />
              </div>
            </div>
          </div>
        )}
    </section>
  );
}
