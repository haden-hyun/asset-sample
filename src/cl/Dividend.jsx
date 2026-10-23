/* 배당 화면 — 받은 배당 · 예상 · 지급 예정 · 종목별 · 지급 내역. 범위·세금·기간은 URL(?scope=&tax=&mx=) */
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { useDividends } from "../lib/queries.js";
import { useSources } from "../lib/sources.jsx";
import { Failed, Loading } from "./Shell.jsx";
import { EmptyState, InfoTip, PeriodSeg, ScopeTabs, SCOPES as ALL_SCOPES, useOpenItem, useQueryPatch } from "./parts.jsx";
import { divBars, useChart } from "./charts.js";
import { FREQ_NAME, krw, krwParts, md, shortName, won } from "./format.js";
import "./div.css";

/** 배당 범위 탭 — 가상자산은 배당이 없어 뺀다 */
const SCOPES = ALL_SCOPES.filter(([k]) => k !== "CRYPTO");
/** '전체' 막대를 쌓는 묶음 [키, 이름, 색 토큰] — 보유·홈과 같은 계좌 색 */
const STACK = [["ISA", "ISA", "a-isa"], ["BROKERAGE", "위탁", "a-invest"], ["PENSION_SAVINGS", "연금저축", "a-pension"], ["RETIREMENT", "퇴직연금", "a-retire"]];
const NOTE = {
  all: "ISA · 위탁 · 연금저축 합계 · 퇴직연금(재투자형 TDF) 제외",
  ISA: "지급 때 원천징수 없음 · 세전 = 세후",
  BROKERAGE: "국내 실수령 · 미국 추정(원천징수 15%)",
  PENSION_SAVINGS: "세액공제 + 비공제 · 과세이연 · 세전 = 세후",
  RETIREMENT: "IRP·DC 분배금 · 과세이연 · 세전 = 세후",
};
const freqOf = (r) => r.freq || FREQ_NAME[r.pays_per_year] || "";
const rate = (v) => (v == null ? "—" : `${v.toFixed(2)}%`);
/** 주당 배당 — 외화는 $ */
const dps = (v, cur) => (v == null ? "—" : cur && cur !== "KRW" ? `$${v.toFixed(2)}` : `${won(v)}원`);
const TAX_ITEMS = [["pre", "세전"], ["post", "세후"]];
const MX_ITEMS = [["ttm", "최근 12개월"], ["ytd", "올해"]];
const NO_SOURCE = "증권사 배당 내역을 매일 아침 가져오는 작업이 켜지면 다음 날부터 나타납니다.";
/** 요약 카드 큰 숫자 — [숫자, 단위] */
const Fig = ({ parts: [n, u] }) => <div className="cl-v cl-num">{n}<span className="cl-unit">{u}</span></div>;

/** 배당 추이 — 월별 받음 · 예상 막대. 전체 범위면 묶음별로 쌓는다 */
function MonthPanel({ d, scope, taxLabel }) {
  // kind: received(지난달까지) · current(이번 달 = 받은 몫 + 남은 예정) · expected(다음 달부터)
  const bars = useMemo(() => (d.monthly || []).map((b) => ({
    month: b.month, kind: b.kind === "projected" ? "expected" : b.kind, total: b.total_krw || 0, by: b.by_scope || {},
    pend: b.pending_krw || 0, pby: b.pending_by_scope || null,
  })), [d]);
  const stack = scope === "all" ? STACK.filter(([k]) => bars.some((b) => b.by[k] > 0 || b.pby?.[k] > 0)) : null;
  const nowMonth = bars.find((b) => b.kind === "current")?.month || String(d.ref_date || d.as_of || "").slice(0, 7);
  const ref = useChart((host, W) => divBars(host, W, bars, { stack, nowMonth, taxLabel }), [d, scope]);
  const recv = bars.filter((b) => b.kind !== "expected").reduce((t, b) => t + b.total, 0);
  const exp = bars.filter((b) => b.kind === "expected").reduce((t, b) => t + b.total, 0);
  return (
    <section className="cl-sect">
      <div className="cl-panel-head"><h2>배당 추이</h2><span className="cl-sub cl-num">받음 <b className="cl-ink">{krw(recv)}</b> · 예상 <b className="cl-ink">{krw(exp)}</b> · 월별</span></div>
      <div className="cl-chart" ref={ref} />
      <div className="cl-legend">
        {stack ? <>{stack.map(([k, l, c]) => <span key={k}><i className="cl-lg-sq" style={{ background: `var(--${c})` }} />{l}</span>)}<span>진한 막대 받음 · 옅은 막대 예상</span></>
          : <><span><i className="cl-lg-sq" style={{ background: "var(--accent)" }} />받음</span><span><i className="cl-lg-sq cl-lg-exp" />예상</span></>}
        {exp > recv * 1.2 && <span className="cl-axnote">예상 증가분 · 지난 1년 보유 확대</span>}
      </div>
    </section>
  );
}

/** 지급 상태 → 배지(확정은 없음) */
const UPC = { confirmed: null, announced: "공시", announced_amount_pending: "금액 추정", projected: "추정" };
/** 지급 예정 — 가까운 7건. more = 앞으로 12개월 전체 건수 */
function Upcoming({ rows, more }) {
  const list = (rows || []).slice(0, 7);
  return (
    <section className="cl-sect">
      <div className="cl-panel-head"><h2>지급 예정</h2></div>
      {list.length === 0 ? <p className="cl-goal-note">지급 예정 없음</p> : (
        <ul className="cl-upc">
          {list.map((u, i) => (
            <li key={`${u.pay_date}-${u.product_code}-${i}`}>
              <span className="cl-dt cl-num">{md(u.pay_date)}</span>
              <span className="cl-nm" title={u.product_name}>{u.product_name}{UPC[u.status] && <span className="cl-tag">{UPC[u.status]}</span>}</span>
              <span className="cl-am cl-num">{u.amount_krw == null ? "—" : `${won(u.amount_krw)}원`}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="cl-goal-note" style={{ marginTop: 10 }}>{more > list.length ? `앞으로 12개월 ${more}건 중 가까운 ${list.length}건 · ` : ""}추정 = 공시 전, 작년 같은 달 주당 기준</p>
    </section>
  );
}

/** 종목별 배당 — 상위 8개 + '그 외 n종목' 접힘. 행을 누르면 종목 시세 드로어. funds = 제외한 재투자형 펀드 */
function Products({ rows, funds }) {
  const [key, setKey] = useState("expected_annual_krw");
  const [all, setAll] = useState(false);
  const go = useOpenItem();
  const sorted = useMemo(() => (rows || []).slice().sort((a, b) => (b[key] ?? -1) - (a[key] ?? -1)), [rows, key]);
  const top = all ? sorted : sorted.slice(0, 8), rest = sorted.slice(8);
  const sum = sorted.reduce((t, r) => t + (r.expected_annual_krw || 0), 0);
  const restSum = rest.reduce((t, r) => t + (r.expected_annual_krw || 0), 0);
  const ev = sorted.reduce((t, r) => t + (r.ev_krw || 0), 0);
  const cost = sorted.reduce((t, r) => t + (r.cost_krw || 0), 0);
  const sortBtn = (k, l, cls = "cl-n cl-m-hide") => (
    <th scope="col" className={cls} aria-sort={key === k ? "descending" : "none"}>
      <button type="button" className="cl-sortbtn" onClick={() => setKey(k)}>{l}{key === k && <span aria-hidden="true"> ↓</span>}</button>
    </th>
  );
  return (
    <section className="cl-sect">
      <div className="cl-panel-head"><h2>종목별 배당</h2><span className="cl-sub">지금 보유 기준{funds?.length ? ` · 재투자형 펀드 ${funds.length}종 제외` : ""}</span></div>
      {sorted.length === 0 ? <p className="cl-goal-note">배당 종목 없음</p> : (
        <div className="cl-tscroll"><table className="cl-m cl-divp">
          <caption className="sr-only">종목별 배당</caption>
          <thead><tr>
            <th scope="col">종목</th><th scope="col" className="cl-m-hide cl-k-hide">주기</th><th scope="col" className="cl-n cl-m-hide cl-k-hide">주당 · 12개월</th><th scope="col" className="cl-n cl-m-hide cl-k-hide">보유</th>
            {sortBtn("expected_annual_krw", "예상 연배당", "cl-n")}
            {sortBtn("yield_on_market_pct", <><span className="cl-k-hide">시가배당률</span><span className="cl-k-only">시가</span></>)}
            {sortBtn("yield_on_cost_pct", <><span className="cl-k-hide">매입가 대비</span><span className="cl-k-only">매입가</span></>)}
            <th scope="col" className="cl-m-hide cl-k-hide">최근 지급</th>
          </tr></thead>
          <tbody>
            {top.map((r) => (
              <tr key={r.product_code} tabIndex={0} data-item={r.product_code} aria-haspopup="dialog" onClick={(e) => go(r.product_code, e.currentTarget)} onKeyDown={(e) => e.key === "Enter" && go(r.product_code, e.currentTarget)}>
                <td className="cl-s-nm" title={r.product_name}>{r.product_name}{r.has_history === false && <span className="cl-tag">분배 이력 없음</span>}{r.expected_is_reference && <span className="cl-tag" title="지급 주기를 판정할 수 없어 최근 12개월 실지급 합으로 계산했습니다">참고치</span>}
                  <span className="cl-k-only cl-k-sub">{freqOf(r)} · 주당 {dps(r.ttm_dps, r.currency_code)} · {won(r.quantity)}주</span></td>
                <td className="cl-m-hide cl-k-hide">{freqOf(r)}</td>
                <td className="cl-n cl-m-hide cl-k-hide">{dps(r.ttm_dps, r.currency_code)}</td>
                <td className="cl-n cl-m-hide cl-k-hide">{won(r.quantity)}<span className="cl-unit">주</span></td>
                <td className="cl-n cl-s-v">{won(r.expected_annual_krw)}</td>
                <td className="cl-n cl-m-hide">{rate(r.yield_on_market_pct)}</td>
                <td className="cl-n cl-m-hide">{rate(r.yield_on_cost_pct)}</td>
                <td className="cl-m-hide cl-k-hide cl-num">{r.last_pay_date ? md(r.last_pay_date) : "—"}</td>
                <td className="cl-s-meta cl-m-only-cell">{freqOf(r)} · 주당 {dps(r.ttm_dps, r.currency_code)} · {won(r.quantity)}주</td>
                <td className="cl-s-sub cl-m-only-cell">시가 {rate(r.yield_on_market_pct)} · 매입가 {rate(r.yield_on_cost_pct)}</td>
              </tr>
            ))}
            {rest.length > 0 && (
              <tr className="cl-fold">
                <td colSpan={8}><button type="button" className="cl-btn-text" aria-expanded={all} onClick={() => setAll((v) => !v)}>
                  {all ? "상위 8개만 보기" : `그 외 ${rest.length}종목 · 합 ${won(restSum)}원 펼치기`}</button></td>
              </tr>
            )}
          </tbody>
          <tfoot><tr>
            <td className="cl-s-nm">합계 · {sorted.length}종목</td><td className="cl-m-hide cl-k-hide" /><td className="cl-m-hide cl-k-hide" /><td className="cl-m-hide cl-k-hide" />
            <td className="cl-n cl-s-v">{won(sum)}</td><td className="cl-n cl-m-hide">{ev ? rate((sum / ev) * 100) : "—"}</td><td className="cl-n cl-m-hide">{cost ? rate((sum / cost) * 100) : "—"}</td><td className="cl-m-hide cl-k-hide" />
          </tr></tfoot>
        </table></div>
      )}
    </section>
  );
}

/**
 * 지급 내역 행 — 받은 배당(matrix)에 지급 예정(upcoming)을 '예상'으로 얹는다.
 * 칸 = { amt 받음, exp 예상 합, expUnknown 금액 미정 공시 }. 받은 것도 예상도 없는 종목은 뺀다
 */
function heatRows(m, upcoming) {
  const months = m.months || [], at = new Map(months.map((mo, k) => [mo, k]));
  const rows = (m.rows || []).map((r) => ({ ...r, cells: months.map((mo, k) => ({ ...(r.cells?.[k] || { month: mo }), exp: 0 })) }));
  const byCode = new Map(rows.map((r) => [r.product_code, r]));
  (upcoming || []).forEach((u) => {
    const k = at.get(String(u.pay_date).slice(0, 7));
    if (k == null) return;
    let r = byCode.get(u.product_code);
    if (!r) {
      r = { product_code: u.product_code, product_name: u.product_name || u.product_code, cells: months.map((mo) => ({ month: mo, exp: 0 })) };
      rows.push(r); byCode.set(u.product_code, r);
    }
    if (u.amount_krw == null) r.cells[k].expUnknown = true; else r.cells[k].exp += u.amount_krw;
  });
  rows.forEach((r) => { r.sum = r.cells.reduce((t, c) => t + (c.amt || 0) + c.exp, 0); r.hasExp = r.cells.some((c) => c.exp || c.expUnknown); });
  return rows.filter((r) => r.sum > 0 || r.hasExp).sort((a, b) => b.sum - a.sum);
}

/** 칸 배당률(매입가 대비 연환산, 세전) — 칸이 좁아 소수 1자리, 툴팁은 2자리 */
const cellRate = (v) => (v == null ? "" : `${v.toFixed(1)}%`);
/** 히트맵 칸 바탕 — 잉크 농도 4~16%(DESIGN §4). 틸·손익색을 쓰지 않는다 */
const heat = (v, max) => ({ background: `color-mix(in srgb, var(--ink) ${(4 + 12 * (v / (max || 1))).toFixed(1)}%, transparent)` });
const Up = () => <><span aria-hidden="true" className="cl-mx-up">▲</span><span className="sr-only">분배금 인상 </span></>;
/** 최근 n개월로 자른 { rows, months, totals, grand } — 합계를 다시 내고 그 기간에 없는 종목은 뺀다 */
function recent(rows, months, totals, n) {
  const k0 = Math.max(0, months.length - n);
  const rs = rows.map((r) => {
    const cells = r.cells.slice(k0);
    return { ...r, cells, sum: cells.reduce((t, c) => t + (c.amt || 0) + c.exp, 0), hasExp: cells.some((c) => c.exp || c.expUnknown) };
  }).filter((r) => r.sum > 0 || r.hasExp).sort((a, b) => b.sum - a.sum);
  const ts = totals.slice(k0);
  return { rows: rs, months: months.slice(k0), totals: ts, grand: ts.reduce((t, v) => t + v, 0) };
}

/** 히트맵 최소 폭 = 이름 160 + 월 n×72 + 합계 88 + 칸 간격. 패널이 더 좁으면 래퍼가 가로로 민다(div.css 와 같은 값) */
const MIN_W = (n) => 160 + 88 + n * 72 + (n + 3) * 3;
/** 지급 내역 히트맵 — 종목 × 월 금액·배당률 표 */
function Heatmap({ rows, months, totals, grand }) {
  const max = Math.max(1, ...rows.flatMap((r) => r.cells.map((c) => (c.amt || 0) + c.exp)));
  const years = [];
  months.forEach((mo) => { const y = mo.slice(0, 4), l = years[years.length - 1]; if (l && l.y === y) l.n++; else years.push({ y, n: 1 }); });
  const cell = (c, k, r) => {
    const v = (c.amt || 0) + c.exp, exp = c.exp > 0 || c.expUnknown;
    if (!v && !exp) return <td key={k}><span className="cl-dvh-c" title={`${r.product_name} · ${+c.month.slice(5, 7)}월 · ${c.held === false ? "보유 전" : "지급 없음"}`} /></td>;
    const tip = [r.product_name, `${+c.month.slice(5, 7)}월`, c.amt ? `받음 ${won(c.amt)}원` : "", c.exp ? `예상 ${won(c.exp)}원` : "", c.expUnknown ? "금액 미정" : "",
      c.rate != null ? `배당률(세전) ${c.rate.toFixed(2)}%` : ""].filter(Boolean).join(" · ");
    return (
      <td key={k}><span className={`cl-dvh-c${exp ? " cl-dvh-exp" : ""}`} style={exp ? undefined : heat(v, max)} title={tip}>
        <span className="cl-dvh-v cl-num">{c.up && <Up />}{v ? won(v) : "?"}{exp && <span className="sr-only"> 예상</span>}</span>
        <span className="cl-dvh-r cl-num">{c.rate != null && <span className="sr-only">배당률 </span>}{cellRate(c.rate)}</span>
      </span></td>
    );
  };
  return (
    <table className="cl-dvh" style={{ minWidth: MIN_W(months.length) }}>
      <caption className="sr-only">종목별 월별 배당금(원)과 배당률(세전, 매입가 대비 연환산)</caption>
      <colgroup><col className="cl-dvh-nmcol" />{months.map((mo) => <col key={mo} />)}<col className="cl-dvh-totcol" /></colgroup>
      <thead>
        {years.length > 1 && <tr className="cl-dvh-yr"><td />{years.map((g) => <th key={g.y} colSpan={g.n} scope="colgroup">{g.y}</th>)}<td /></tr>}
        <tr><th scope="col" className="cl-dvh-nm">종목</th>{months.map((mo) => <th scope="col" key={mo} className={mo.endsWith("-01") ? "cl-dvh-jan" : ""}>{+mo.slice(5, 7)}월</th>)}<th scope="col" className="cl-dvh-tot">합계</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.product_code}>
            <th scope="row" className="cl-dvh-nm" title={r.product_name}>{shortName(r.product_name)}</th>
            {r.cells.map((c, k) => cell(c, k, r))}
            <td className="cl-dvh-tot cl-num">{r.sum ? won(r.sum) : "—"}</td>
          </tr>
        ))}
      </tbody>
      <tfoot><tr><th scope="row" className="cl-dvh-nm">월 합계</th>{totals.map((v, k) => <td key={months[k]} className="cl-num">{v ? won(v) : ""}</td>)}<td className="cl-dvh-tot cl-num">{won(grand)}</td></tr></tfoot>
    </table>
  );
}

/** 좁은 패널용 월 목록 — 최근 달이 위, 처음에는 가장 최근 달만 펼친다 */
function MonthList({ rows, months, totals, grand }) {
  const items = months.map((mo, k) => {
    const list = rows.map((r) => ({ r, c: r.cells[k] })).filter(({ c }) => c.amt || c.exp || c.expUnknown)
      .sort((a, b) => (b.c.amt || 0) + b.c.exp - (a.c.amt || 0) - a.c.exp);
    return { mo, list, sum: totals[k], exp: list.some(({ c }) => c.exp || c.expUnknown) };
  }).reverse();
  const [open, setOpen] = useState(() => new Set(items.length ? [items[0].mo] : []));
  const flip = (mo) => setOpen((s) => { const n = new Set(s); if (n.has(mo)) n.delete(mo); else n.add(mo); return n; });
  return (
    <ul className="cl-mlist">
      {items.map(({ mo, list, sum, exp }) => {
        const on = open.has(mo);
        return (
          <li key={mo}>
            <button type="button" className="cl-mlist-h" aria-expanded={on} disabled={!list.length} onClick={() => flip(mo)}>
              <span className="cl-mlist-mo">{mo.slice(0, 4)}년 {+mo.slice(5, 7)}월{exp && <span className="cl-tag">예상 포함</span>}</span>
              <span className="cl-num cl-mlist-v">{sum ? `${won(sum)}원` : ""}</span>
              <span className="cl-mlist-sub">{list.length ? `${list.length}종목 · 최대 ${list[0].r.product_name}` : "지급 없음"}</span>
            </button>
            {on && list.length > 0 && (
              <ul className="cl-mlist-in">
                {list.map(({ r, c }) => (
                  <li key={r.product_code}>
                    <span className="cl-mlist-nm">{r.product_name}</span>
                    <span className={`cl-num${c.amt ? "" : " cl-dvh-expv"}`}>{c.up && <Up />}{c.amt || c.exp ? won((c.amt || 0) + c.exp) : "—"}</span>
                    <span className="cl-mlist-sub">{[r.pays_per_year && `${freqOf(r)}배당`, c.rate != null && `배당률(세전) ${c.rate.toFixed(1)}%`, c.exp || c.expUnknown ? (c.amt ? `예상 ${won(c.exp)} 포함` : "예상") : ""].filter(Boolean).join(" · ")}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
      <li className="cl-mlist-total"><span>합계</span><span className="cl-num">{won(grand)}원</span></li>
    </ul>
  );
}

/** 지급 내역 — 히트맵(12개월 · 최근 6개월)과 월 목록을 다 그리고 패널 폭(CSS)으로 하나만 보인다.
 *  pending = 이번 달 { month, total 받음, pend 남은 예정 } — upcoming(앞 8건)보다 크면 월 합계에 서버 값을 쓴다 */
function History({ scope, tax, mx, setQ, upcoming, pending }) {
  const period = mx === "ytd" ? "ytd" : "ttm";
  const q = useQuery({
    queryKey: ["div-matrix", scope, tax, period],
    queryFn: () => api.get(`/dividends/matrix?scope_code=${scope}&tax=${tax}&period=${period}&base=cost`),
    placeholderData: (prev) => prev,
  });
  const m = q.data;
  const pm = pending?.month, pv = pending ? pending.total + pending.pend : 0;
  const { months, rows, totals, grand, six } = useMemo(() => {
    const months = m?.months || [];
    const rows = m?.available ? heatRows(m, upcoming) : [];
    const totals = months.map((mo, k) => {
      const v = rows.reduce((t, r) => t + (r.cells[k].amt || 0) + r.cells[k].exp, 0);
      return pm === mo ? Math.max(v, pv) : v;
    });
    const six = months.length > 6 ? recent(rows, months, totals, 6) : null;
    return { months, rows, totals, grand: totals.reduce((t, v) => t + v, 0), six };
  }, [m, upcoming, pm, pv]);
  return (
    <section className="cl-sect">
      <div className="cl-panel-head">
        <h2>지급 내역</h2><span className="cl-sub cl-num">{six && <span className="cl-dvh-six">최근 6개월 · </span>}{tax === "post" ? "세후" : "세전"}<span className="cl-dvh-unit"> · 원</span> · 배당률(세전) = 매입가 대비 연환산</span>
        <div className="cl-ctrl-row cl-ctrl-tight">
          <PeriodSeg items={MX_ITEMS} value={period} onChange={(k) => setQ({ mx: k === "ttm" ? null : k })} label="내역 기간" />
        </div>
      </div>
      {q.isLoading ? <Loading /> : q.isError ? <Failed q={q} what="지급 내역" /> : !rows.length ? <p className="cl-goal-note">받은 배당 없음</p>
        : <>
          <div className={`cl-mx-wide cl-dvh-wrap${six ? " cl-dvh-full" : ""}`}><Heatmap rows={rows} months={months} totals={totals} grand={grand} /></div>
          {six && <div className="cl-mx-wide cl-dvh-wrap cl-dvh-part"><Heatmap rows={six.rows} months={six.months} totals={six.totals} grand={six.grand} /></div>}
          <div className="cl-mx-narrow"><MonthList key={`${period}-${scope}`} rows={rows} months={months} totals={totals} grand={grand} /></div>
          <p className="cl-goal-note cl-dvh-note"><span><i className="cl-dvh-key" style={heat(1, 1)} />진할수록 큰 금액</span><span><i className="cl-dvh-key cl-dvh-exp" />예상</span><span><span className="cl-mx-up" aria-hidden="true">▲</span>분배금 인상</span><span>빈 칸 지급 없음</span></p></>}
    </section>
  );
}

/** 배당 본문 — URL 값(scope · tax · mx)과 setQ(patch) 를 받는다 */
export default function Dividend({ scope: scopeQ, tax: taxQ, mx, setQ }) {
  const scope = SCOPES.some(([k]) => k === scopeQ) ? scopeQ : "all";
  const tax = taxQ === "post" ? "post" : "pre";
  const q = useDividends(scope, tax, { placeholderData: (prev) => prev });
  const d = q.data;
  // 퇴직연금 탭은 그 범위에 배당이 있을 때만(서버 scopes)
  const chips = SCOPES.filter(([k]) => k !== "RETIREMENT" || scope === "RETIREMENT" || (d?.scopes || []).some((x) => (x.scope_code ?? x) === "RETIREMENT" && x.eligible !== false));
  const label = SCOPES.find(([k]) => k === scope)[1];
  const c = d?.cards || {};
  const brk = scope === "all" || scope === "BROKERAGE";
  const cur = (d?.monthly || []).find((b) => b.kind === "current");
  const empty = d?.available && !c.received_ttm_krw && !c.expected_annual_krw && !(d.products || []).length;
  return (
    <>
      <div className="cl-filters">
        <ScopeTabs items={chips} value={scope} onChange={(k) => setQ({ scope: k === "all" ? null : k })} label="배당 범위" />
        <PeriodSeg items={TAX_ITEMS} value={tax} onChange={(k) => setQ({ tax: k === "pre" ? null : k })} label="세금 기준" />
      </div>
      <p className="cl-scope-note">{NOTE[scope]}{(scope === "all" || scope === "ISA") && c.isa_tax_reference_krw > 0 ? ` · ISA 원장 세액 ${krw(c.isa_tax_reference_krw)}(만기 정산 참고)` : ""}</p>
      {q.isLoading ? <Loading /> : q.isError ? <Failed q={q} what="배당" /> : !d?.available ? (
        <EmptyState title="배당 기록 없음" body={NO_SOURCE} />
      ) : empty ? (
        <EmptyState title={`${label} 배당 없음`} body="분배형 종목을 사면 다음 지급 후 나타납니다."
          action={scope !== "all" ? { label: "전체 보기", onClick: () => setQ({ scope: "all" }) } : undefined} />
      ) : (
        <div aria-busy={q.isFetching}>
          <div className="cl-figs cl-figs-4">
            <div><div className="cl-label">받은 배당<InfoTip term="received" /></div><Fig parts={krwParts(c.received_ttm_krw)} />
              <div className="cl-h">{brk && c.withheld_ttm_krw > 0 ? (tax === "post" ? `위탁 세금 ${won(c.withheld_ttm_krw)}원 차감` : `위탁 징수세액 ${won(c.withheld_ttm_krw)}원 별도`) : "세전 = 세후"}</div></div>
            <div><div className="cl-label">예상 연배당<InfoTip term="expected" /></div><Fig parts={krwParts(c.expected_annual_krw)} /><div className="cl-h">현재 보유 기준{c.has_us_estimate ? " · 미국 추정" : ""}</div></div>
            <div><div className="cl-label">시가배당률<InfoTip term="yield" /></div><Fig parts={[c.yield_on_market_pct == null ? "—" : c.yield_on_market_pct.toFixed(2), "%"]} /><div className="cl-h">묶음 전체 대비 {rate(c.yield_on_scope_value_pct)}</div></div>
            <div><div className="cl-label">매입가 대비<InfoTip term="yoc" /></div><Fig parts={[c.yield_on_cost_pct == null ? "—" : c.yield_on_cost_pct.toFixed(2), "%"]} /><div className="cl-h">예상 연배당 ÷ 실질원가</div></div>
          </div>
          <div className="cl-div-grid">
            <MonthPanel d={d} scope={scope} taxLabel={tax === "post" ? "세후" : "세전"} />
            <Upcoming rows={d.upcoming} more={d.upcoming_total_count} />
          </div>
          <Products rows={d.products} funds={d.funds_excluded} />
          <History scope={scope} tax={tax} mx={mx} setQ={setQ} upcoming={d.upcoming} pending={cur && { month: cur.month, total: cur.total_krw || 0, pend: cur.pending_krw || 0 }} />
        </div>
      )}
    </>
  );
}

/** /dividend 페이지 — 배당 원천이 없으면 빈 상태 */
export function DividendPage() {
  const [sp] = useSearchParams();
  const src = useSources();
  const setQ = useQueryPatch();
  return (
    <section>
      <div className="cl-page-head"><div><h1>배당</h1></div></div>
      <div className="cl-panel">
        {src.loading ? <Loading /> : !src.dividend
          ? <EmptyState title="배당 기록 없음" body={NO_SOURCE} />
          : <Dividend scope={sp.get("scope")} tax={sp.get("tax")} mx={sp.get("mx")} setQ={setQ} />}
      </div>
    </section>
  );
}
