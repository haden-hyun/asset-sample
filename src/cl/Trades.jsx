/* 매매 화면 — 기간 매수·매도 합계 · 날짜별 내역 · 종목별 묶음. 원천은 /positions/trades(일별 수량·원가 변화 추정) */
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { Failed, Loading } from "./Shell.jsx";
import { EmptyState, PERIODS_PERF, PeriodSeg, ScopeTabs, SCOPES, Side, Tabs, useQueryPatch } from "./parts.jsx";
import { MINUS, dir, isoMs, krw, krwParts, md, sKrw, tradeQty, won } from "./format.js";
import "./trades.css";

const VIEWS = [["day", "날짜별"], ["product", "종목별"]];
const SIDES = [["all", "전체"], ["buy", "매수"], ["sell", "매도"]];
const pick = (items, v, d) => (items.some(([k]) => k === v) ? v : d);
/** API date_from 은 시작 전날(미포함) — 보이는 시작일은 그다음 날 */
const nextDay = (iso) => new Date(isoMs(iso) + 864e5).toISOString().slice(0, 10);
/** 날짜 표기 — 기간이 해를 넘기면 2025.12.3, 아니면 12/3 */
const dateFmt = (multiYear) => (iso) => (multiYear ? `${+iso.slice(0, 4)}.${+iso.slice(5, 7)}.${+iso.slice(8, 10)}` : md(iso));

const FOLD = 20;
/** 매도 실현손익(추정) — 매수는 없음 */
const Pl = ({ v }) => (v == null ? "—" : <span className={`cl-num cl-${dir(v)}`}>{sKrw(v)}</span>);
/** 카드 큰 숫자 — 음수면 앞에 − */
const Fig = ({ v }) => { const [n, u] = krwParts(v); return <div className="cl-v cl-num">{v < 0 && n !== "0" ? MINUS : ""}{n}<span className="cl-unit">{u}</span></div>; };

/** 접기 — 상위 FOLD 행만, 나머지는 펼치기 */
function Fold({ n, all, onToggle, cols, unit }) {
  if (n <= FOLD) return null;
  return (
    <tr className="cl-fold"><td colSpan={cols}><button type="button" className="cl-btn-text" aria-expanded={all} onClick={onToggle}>
      {all ? `처음 ${FOLD}${unit}만 보기` : `나머지 ${n - FOLD}${unit} 펼치기`}</button></td></tr>
  );
}

function DayTable({ rows, fd }) {
  const [all, setAll] = useState(false);
  return (
    <div className="cl-tscroll"><table className="cl-m cl-tx-t">
      <caption className="sr-only">날짜별 매매</caption>
      <thead><tr>
        <th scope="col">날짜</th><th scope="col">종목</th><th scope="col" className="cl-k-hide">계좌</th><th scope="col">구분</th>
        <th scope="col" className="cl-n">수량</th><th scope="col" className="cl-n">금액</th><th scope="col" className="cl-n">실현손익</th>
      </tr></thead>
      <tbody>
        {(all ? rows : rows.slice(0, FOLD)).map((e) => (
          <tr key={`${e.date}-${e.account_code}-${e.product_code}`}>
            <td className="cl-num cl-m-hide">{fd(e.date)}</td>
            <td className="cl-s-nm" title={e.product_name}>{e.product_name}<span className="cl-k-only cl-k-sub">{e.account_name}</span></td>
            <td className="cl-m-hide cl-k-hide">{e.account_name}</td>
            <td className="cl-m-hide"><Side s={e.side} /></td>
            <td className="cl-n cl-m-hide">{tradeQty(e.qty, e.asset_type)}</td>
            <td className="cl-n cl-s-v">{won(e.amount_krw)}</td>
            <td className="cl-n cl-m-hide"><Pl v={e.realized_krw} /></td>
            <td className="cl-s-meta cl-m-only-cell"><Side s={e.side} /> {tradeQty(e.qty, e.asset_type, true)} · {fd(e.date)} · {e.account_name}</td>
            <td className="cl-s-sub cl-m-only-cell">{e.side === "sell" ? <Pl v={e.realized_krw} /> : null}</td>
          </tr>
        ))}
        <Fold n={rows.length} all={all} onToggle={() => setAll((v) => !v)} cols={9} unit="건" />
      </tbody>
    </table></div>
  );
}

function ProductTable({ rows, fd }) {
  const [all, setAll] = useState(false);
  return (
    <div className="cl-tscroll"><table className="cl-m cl-tx-t">
      <caption className="sr-only">종목별 매매</caption>
      <thead><tr>
        <th scope="col">종목</th><th scope="col">구분</th><th scope="col" className="cl-n">횟수</th>
        <th scope="col" className="cl-n">수량</th><th scope="col" className="cl-n">금액</th><th scope="col" className="cl-n">실현손익</th><th scope="col" className="cl-k-hide">마지막</th>
      </tr></thead>
      <tbody>
        {(all ? rows : rows.slice(0, FOLD)).map((r) => (
          <tr key={`${r.product_code}-${r.side}`}>
            <td className="cl-s-nm" title={r.product_name}>{r.product_name}</td>
            <td className="cl-m-hide"><Side s={r.side} /></td>
            <td className="cl-n cl-m-hide">{r.count}회</td>
            <td className="cl-n cl-m-hide">{tradeQty(r.qty, r.asset_type)}</td>
            <td className="cl-n cl-s-v">{won(r.amount_krw)}</td>
            <td className="cl-n cl-m-hide"><Pl v={r.realized_krw} /></td>
            <td className="cl-num cl-m-hide cl-k-hide">{fd(r.last_date)}</td>
            <td className="cl-s-meta cl-m-only-cell"><Side s={r.side} /> {tradeQty(r.qty, r.asset_type, true)} · {r.count}회 · 마지막 {fd(r.last_date)}</td>
            <td className="cl-s-sub cl-m-only-cell">{r.side === "sell" ? <Pl v={r.realized_krw} /> : null}</td>
          </tr>
        ))}
        <Fold n={rows.length} all={all} onToggle={() => setAll((v) => !v)} cols={9} unit="줄" />
      </tbody>
    </table></div>
  );
}

export default function Trades() {
  const [sp] = useSearchParams();
  const setQ = useQueryPatch();
  const scope = pick(SCOPES, sp.get("scope"), "all");
  const period = pick(PERIODS_PERF, sp.get("p"), "3m");
  const view = pick(VIEWS, sp.get("view"), "day");
  const side = pick(SIDES, sp.get("side"), "all");
  const q = useQuery({
    queryKey: ["trades", "page", period, scope],
    queryFn: () => api.get(`/positions/trades?preset=${period}${scope === "all" ? "" : `&scope_code=${scope}`}`),
    placeholderData: (prev) => prev,
  });
  const d = q.data;
  const list = (view === "day" ? d?.events : d?.rows) || [];
  const shown = side === "all" ? list : list.filter((r) => r.side === side);
  const fd = dateFmt(!!d?.date_from && nextDay(d.date_from).slice(0, 4) !== String(d.date_to).slice(0, 4));
  const sum = (s0) => shown.reduce((a, r) => a + (r.side === s0 ? r.amount_krw : 0), 0);
  const nProducts = new Set(shown.map((r) => r.product_code)).size;
  return (
    <section>
      <div className="cl-page-head">
        <div><h1>매매</h1>{d?.date_from && <p className="cl-num">{fd(nextDay(d.date_from))}–{fd(d.date_to)}</p>}</div>
      </div>
      <div className="cl-panel">
        <div className="cl-filters">
          <ScopeTabs items={SCOPES} value={scope} onChange={(k) => setQ({ scope: k === "all" ? null : k })} label="매매 범위" />
          <PeriodSeg items={PERIODS_PERF} value={period} onChange={(k) => setQ({ p: k === "3m" ? null : k })} label="매매 기간" />
        </div>
        {q.isLoading ? <Loading /> : q.isError ? <Failed q={q} what="매매" /> : !d.events.length ? (
          <EmptyState title="기간 중 매매 없음" body="기간을 늘리거나 다른 묶음을 고르세요."
            action={period !== "all" ? { label: "전체 기간", onClick: () => setQ({ p: "all" }) } : undefined} />
        ) : (
          <div aria-busy={q.isFetching}>
            <div className="cl-figs cl-figs-4">
              <div><div className="cl-label">매수</div><Fig v={d.buy_krw} /><div className="cl-h">낸 돈(원가 증가)</div></div>
              <div><div className="cl-label">매도</div><Fig v={d.sell_krw} /><div className="cl-h">추정 · 평가액 × 수량</div></div>
              <div><div className="cl-label">순매수</div><Fig v={d.buy_krw - d.sell_krw} /><div className="cl-h">매수 − 매도</div></div>
              <div><div className="cl-label">실현손익</div><div className={`cl-v cl-num cl-${dir(d.realized_krw)}`}>{sKrw(d.realized_krw)}</div><div className="cl-h">추정 · 매도 − 원가</div></div>
            </div>
            <div className="cl-tx-bar">
              <Tabs items={VIEWS} value={view} onChange={(k) => setQ({ view: k === "day" ? null : k })} className="cl-tabs cl-tx-tabs" label="매매 보기" />
              <PeriodSeg items={SIDES} value={side} onChange={(k) => setQ({ side: k === "all" ? null : k })} label="매수·매도" />
            </div>
            {!shown.length ? <p className="cl-goal-note">{side === "buy" ? "매수" : "매도"} 없음</p> : view === "day" ? <DayTable rows={shown} fd={fd} /> : <ProductTable rows={shown} fd={fd} />}
            <p className="cl-goal-note cl-tx-note cl-num">
              {shown.length > 0 && <>{view === "day" ? `${shown.length}건` : `${nProducts}종목`} · {side === "all" ? `매수 ${krw(sum("buy"))} · 매도 ${krw(sum("sell"))}` : `합계 ${krw(sum(side))}`}</>}
              {d.ignored || d.unpriced ? <span className="cl-tx-note-x">{[d.ignored && `원가 변화 없이 수량만 바뀐 날 ${d.ignored}건`, d.unpriced && `환율 없는 날 ${d.unpriced}건`].filter(Boolean).join(" · ")} 제외</span> : null}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
