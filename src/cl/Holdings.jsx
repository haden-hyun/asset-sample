import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { useAccounts, usePositions } from "../lib/queries.js";
import { Failed, Loading } from "./Shell.jsx";
import { ACCOUNT_GROUPS as AGROUPS, EmptyState, SCOPES, TYPE_LABEL, Tabs, groupColor as gColor, useOpenItem, useQueryPatch } from "./parts.jsx";
import { dir, isFund, krw, krwParts, manAbs, share, pct, px, pxShort, qtyNum, qtyShort, qtyUnit, sKrw, sMan, sWon, shortName, won } from "./format.js";
import { Donut } from "./Donut.jsx";
import "./holdings.css";
import "./hold.css";

const GROUP_OF_TYPE = Object.fromEntries(AGROUPS.flatMap((g) => g.types.map((t) => [t, g.id])));
/** 잔고 요약 탭 = SCOPES(DB scope_code). 현금성은 탭이 아니다 */
const TAB_NAME = Object.fromEntries(SCOPES);
const TAB_NOTE = {
  all: "현금성(청약·적금·CMA·금현물·RP·예수금) 제외",
  BROKERAGE: "주식·ETF · 같은 계좌의 RP·발행어음·예수금 제외",
  PENSION_SAVINGS: "세액공제 + 비공제 · IRP는 퇴직연금",
  RETIREMENT: "IRP + DC · 같은 종목은 한 행",
  CRYPTO: "거래소 계좌 · 24시간 시세 · 배당 없음",
  ISA: "중개형 ISA",
};
/** 현금성 행 이름 — 계좌 유형별. 증권 계좌 안의 CASH 는 예수금(코드 DEPOSIT*) 또는 RP·발행어음 */
const CASH_LABEL = { HOUSING_SUBSCRIPTION: "청약통장", INSTALLMENT_SAVINGS: "적금", CMA: "CMA" };
const cashLabel = (type, code) => (String(code || "").startsWith("DEPOSIT") ? "예수금" : CASH_LABEL[type] || "RP·발행어음");
const LIQ_META = [["free", "유동", "매도 후 2영업일 안에 현금화"], ["cond", "준유동", "해지하면 세제 혜택·약정 이율 손실"], ["lock", "장기", "연금 수령·퇴직 전까지 인출 제한"]];
const LIQ_NAME = Object.fromEntries(LIQ_META.map(([k, n]) => [k, n]));
/** 자산 종류 → [이름, 카테고리 색] */
const AT = { STOCK: ["주식·ETF", "c1"], FUND: ["펀드", "c4"], CASH: ["현금성", "c6"], CRYPTO: ["가상자산", "c5"] };
const AT_COLOR = Object.fromEntries(Object.values(AT));
const CURC = { KRW: "c3", USD: "c2" };
const CUR_NAME = { KRW: "원화", USD: "달러" };
// 추이 열 표시는 CSS(@container panel)가 정하고, JS 는 패널 폭이 이 값 이상이 된 적이 있을 때만 시세를 받는다.
// holdings.css 의 추이 열 문턱과 같은 값이어야 한다
const SPARK_MIN = 1100;

/** 비중 가로 막대 한 줄 + 아래 범례(색 · 이름 · 금액 · %).
 * k = 행 이름, T = 분모, items = [{ key, name, value, color, pressed?, onClick? }] — onClick 이 있으면 칸·범례가 버튼.
 * 칸 안 '이름 · %' 는 칸 폭에 들어갈 때만 보인다(재어서 data-fit) */
function VBar({ k, items, T }) {
  const ref = useRef(null);
  const list = items.filter((x) => x.value > 0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const fit = () => [...el.children].forEach((s) => {
      const l = s.firstElementChild;
      if (l) s.dataset.fit = l.offsetWidth <= s.clientWidth - 16 ? "1" : "0";
    });
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [list.map((x) => `${x.key}:${x.value}`).join(), T]); // eslint-disable-line react-hooks/exhaustive-deps
  const tip = (x) => `${x.name} ${krw(x.value)} · ${share(x.value, T)}`;
  const clickable = list.some((x) => x.onClick);
  return (
    <div className="cl-vrow">
      <span className="cl-k">{k}</span>
      <div className="hold-vcol">
        <div className="cl-vbar hold-vbar" ref={ref} role={clickable ? "group" : "img"} aria-label={clickable ? `${k} 비중` : list.map(tip).join(", ")}>
          {list.map((x) => {
            const body = <span className="hold-vlab"><b>{x.name}</b> · {share(x.value, T, 0)}</span>;
            const style = { width: `${T ? (x.value / T) * 100 : 0}%`, "--c": x.color };
            return x.onClick
              ? <button key={x.key} type="button" style={style} title={tip(x)} aria-label={tip(x)} aria-pressed={!!x.pressed} onClick={x.onClick}>{body}</button>
              : <div key={x.key} style={style} title={tip(x)}>{body}</div>;
          })}
        </div>
        <ul className="hold-vleg">
          {list.map((x) => {
            const body = <><i style={{ background: x.color }} /><span className="hold-vleg-nm">{x.name}</span><b className="cl-num">{krw(x.value)}</b><span className="cl-num hold-vleg-p">{share(x.value, T)}</span></>;
            return (
              <li key={x.key}>
                {x.onClick ? <button type="button" className="hold-vleg-row" aria-pressed={!!x.pressed} onClick={x.onClick}>{body}</button> : <span className="hold-vleg-row">{body}</span>}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** 자산 구성 도넛 한 개. list = [[이름, 금액, 색 토큰]], one = 한 종류일 때 이름 바꾸기. 한 종류뿐이면 '이름 100%' 한 줄 */
function Mix({ k, list, total, sub, one }) {
  return (
    <div className="hold-mix">
      <h3 className="hold-mix-k">{k}</h3>
      {list.length === 1 ? <p className="hold-mix-one cl-num">{one ? one(list[0][0]) : list[0][0]} 100%</p> : (
        <Donut
          size={180}
          label={`${k} 비중 · ${list.map(([n, v]) => `${n} ${share(v, total)}`).join(", ")}`}
          rings={[{ segments: list.map(([n, v, c]) => ({ key: n, label: n, value: v, color: `var(--${c})`, onColor: "var(--on-cat)" })) }]}
          center={{ top: krw(total), sub }}
          legend={list.map(([n, v, c]) => ({ key: n, label: n, value: v, pct: share(v, total), color: `var(--${c})`, selectable: false }))}
        />
      )}
    </div>
  );
}

/** 금액 칸 — 넓을 때·카드형은 원 단위, compact 단은 만원(단위는 머리글로 올린다) */
const Won = ({ v }) => <><span className="cl-k-hide">{won(v)}</span><span className="cl-k-only">{manAbs(v)}</span></>;

/** 상품 한 행의 단가·수량 표기 문맥 */
const fmtCtx = (p) => ({ cur: p.currency_code, mul: p.multiplier || 1, crypto: p.asset_type === "CRYPTO" });

/** 3개월 추이 스파크라인 72×20 — pts [[date, price|null]], avg = 평단(점선), up = 끝점 손익색. 보유하지 않은 날은 비운다 */
function Spark({ pts, avg, up }) {
  if (!pts || pts.filter((p) => p[1] != null).length < 2) return <span className="hd-spark-none" aria-label="추이 없음">—</span>;
  const W = 72, H = 20;
  const t0 = Date.parse(pts[0][0]), t1 = Date.parse(pts[pts.length - 1][0]);
  const vs = pts.filter((p) => p[1] != null).map((p) => p[1]).concat(avg ? [avg] : []);
  const lo = Math.min(...vs), hi = Math.max(...vs);
  const x = (d) => ((Date.parse(d) - t0) / (t1 - t0 || 1)) * (W - 4);
  const y = (v) => 2 + (1 - (v - lo) / (hi - lo || 1)) * (H - 4);
  let d = "", pen = false;
  pts.forEach(([dt, v]) => { if (v == null) { pen = false; return; } d += `${pen ? "L" : "M"}${x(dt).toFixed(1)},${y(v).toFixed(1)}`; pen = true; });
  const held = pts.filter((p) => p[1] != null);
  const first = held[0], last = held[held.length - 1];
  return (
    <svg className="hd-spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`최근 3개월 ${pct((last[1] - first[1]) / first[1])}`}>
      {avg != null && <line className="hd-spark-avg" x1="0" x2={W - 4} y1={y(avg)} y2={y(avg)} />}
      <path className="hd-spark-line" d={d} />
      <circle className={`hd-spark-end cl-${up ? "up" : "down"}`} cx={x(last[0])} cy={y(last[1])} r="2.5" />
    </svg>
  );
}

/** 잔고 요약 — 탭(묶음)별 보유 종목 표. 정렬 · 계좌별 펼침 · 표에서 뺀 현금성 줄 */
function Balance({ tab, setTab, acctRows, typeOf, onOpen, cashRef, cashFlash }) {
  const scope = tab === "all" ? null : tab;
  const pq = usePositions("product", scope);
  const wrap = useRef(null);
  const [wide, setWide] = useState(false);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el || wide) return undefined;
    const ro = new ResizeObserver(([e]) => e.contentRect.width >= SPARK_MIN && setWide(true));
    ro.observe(el);
    return () => ro.disconnect();
  }, [wide]);
  const sq = useQuery({
    queryKey: ["sparklines", scope || "all"], enabled: wide,
    queryFn: () => api.get(`/positions/sparklines?days=92${scope ? `&scope_code=${scope}` : ""}`),
  });
  const spark = sq.data?.series ?? sq.data;
  const showSpark = wide && !!spark && !sq.isError;
  const [sort, setSort] = useState(["ev", -1]);
  const [open, setOpen] = useState(() => new Set());
  useEffect(() => setOpen(new Set()), [tab]);

  const all = pq.data?.positions || [];
  const cash = all.filter((p) => p.asset_type === "CASH");
  const rows = useMemo(() => {
    const k = sort[0];
    const val = (p) => (k === "cost" ? p.cost_krw_real : k === "pl" ? p.eval_krw - p.cost_krw_real : k === "r" ? (p.cost_krw_real ? (p.eval_krw - p.cost_krw_real) / p.cost_krw_real : 0) : p.eval_krw);
    return all.filter((p) => p.asset_type !== "CASH").sort((a, b) => sort[1] * (val(a) - val(b)));
  }, [all, sort]);
  // 계좌별 펼침 행 — 이 탭에 드는 계좌만
  const g0 = scope && AGROUPS.find((g) => g.scope === scope);
  const partsOf = (code) => acctRows.filter((r) => r.product_code === code && r.asset_type !== "CASH" && (!g0 || g0.types.includes(typeOf(r))));
  const cashItems = cash.length ? Object.entries(cash.reduce((o, p) => {
    const ts = acctRows.filter((r) => r.product_code === p.product_code).map(typeOf);
    const l = cashLabel(ts[0], p.product_code);
    o[l] = (o[l] || 0) + p.eval_krw;
    return o;
  }, {})) : [];
  const TC = rows.reduce((s, p) => s + p.cost_krw_real, 0), TV = rows.reduce((s, p) => s + p.eval_krw, 0), TPL = TV - TC;
  const sortBy = (k) => setSort(([sk, sd]) => [k, sk === k ? -sd : -1]);
  const Th = ({ k, cls, children }) => (
    <th className={cls ? `cl-n ${cls}` : "cl-n"} aria-sort={sort[0] === k ? (sort[1] < 0 ? "descending" : "ascending") : "none"}>
      <button type="button" className="hd-sort" onClick={() => sortBy(k)}>{children}<span aria-hidden="true">{sort[0] === k ? (sort[1] < 0 ? "↓" : "↑") : ""}</span></button>
    </th>
  );
  const toggle = (code) => setOpen((s) => { const n = new Set(s); n.has(code) ? n.delete(code) : n.add(code); return n; });

  let body;
  if (pq.isLoading) body = <Loading />;
  else if (pq.isError) body = <Failed q={pq} what="잔고" />;
  else if (!rows.length) body = <EmptyState title={`${TAB_NAME[tab]} 보유 종목 없음`} body="현금성만 있거나 매수 전입니다." action={tab !== "all" ? { label: "전체 보기", onClick: () => setTab("all") } : undefined} />;
  else body = (
    <>
      <p className="hd-headsum">
        <span><span className="hd-lb">평가금 </span><span className="cl-num hd-big">{manAbs(TV)}</span><span className="cl-unit">만원</span></span>
        <span><span className="hd-lb">투자금 </span><span className="cl-num">{manAbs(TC)}만</span></span>
        <span className={`cl-num cl-delta cl-${dir(TPL)}`}>{sMan(TPL)}만 · {pct(TC ? TPL / TC : 0, 2)}</span>
      </p>
      <div className="cl-tscroll"><table className="cl-m hd-bal">
        <caption className="hd-sr">{TAB_NAME[tab]} 보유 종목. 행을 누르면 시세 드로어가 열립니다</caption>
        <thead><tr>
          <th scope="col">종목</th><th className="cl-n cl-k-hide" scope="col">평단</th><th className="cl-n cl-k-hide" scope="col">수량</th><Th k="cost">투자금<span className="cl-k-only">(만원)</span></Th>
          <th className="cl-n cl-k-hide" scope="col">현재가</th><Th k="ev">평가금<span className="cl-k-only">(만원)</span></Th><Th k="r">수익률</Th><Th k="pl" cls="cl-k-hide">평가손익</Th>
          {showSpark && <th className="cl-n hd-spark-c" scope="col">3개월 추이</th>}
        </tr></thead>
        <tbody>
          {rows.map((p) => {
            const a = fmtCtx(p), pl = p.eval_krw - p.cost_krw_real, r = p.cost_krw_real ? pl / p.cost_krw_real : 0;
            const parts = partsOf(p.product_code), multi = parts.length > 1, isOpen = multi && open.has(p.product_code);
            return (
              <Fragment key={p.product_code}>
                <tr className="hd-row" onClick={(e) => !e.target.closest("button") && onOpen(p.product_code, e.currentTarget.querySelector(".hd-nm"))}>
                  <td className="cl-s-nm hd-nmcell">
                    <span className="hd-nmwrap">
                      <button type="button" className="hd-nm" data-item={p.product_code} aria-haspopup="dialog" title={p.product_name} onClick={(e) => onOpen(p.product_code, e.currentTarget)}>{shortName(p.product_name)}</button>
                      {p.currency_code === "USD" && <span className="cl-tag">USD</span>}
                      {isFund(a) && <span className="cl-tag">펀드</span>}
                      {multi && <button type="button" className="hd-chip" aria-expanded={isOpen} aria-label={`${shortName(p.product_name)} ${parts.length}계좌 ${isOpen ? "접기" : "펼치기"}`} onClick={() => toggle(p.product_code)}>{parts.length}계좌</button>}
                    </span>
                    <span className="cl-k-only cl-k-sub">{qtyShort(p.quantity, a)} · {a.crypto ? "" : "평단 "}{pxShort(p.unit_purchase_price, a)} → {pxShort(p.unit_market_price, a)}</span>
                  </td>
                  <td className="cl-n cl-m-hide cl-k-hide">{px(p.unit_purchase_price, a)}{isFund(a) && <span className="hd-u">/1,000좌</span>}</td>
                  <td className="cl-n cl-m-hide cl-k-hide">{qtyNum(p.quantity, a)}<span className="hd-u">{qtyUnit(a)}</span></td>
                  <td className="cl-n cl-m-hide"><Won v={p.cost_krw_real} /></td>
                  <td className="cl-n cl-s-meta cl-k-hide">
                    <span className="cl-m-only">{qtyShort(p.quantity, a)} · {a.crypto ? "" : "평단 "}{pxShort(p.unit_purchase_price, a)} → {pxShort(p.unit_market_price, a)}</span>
                    <span className="cl-m-hide">{px(p.unit_market_price, a)}{isFund(a) && <span className="hd-u">/1,000좌</span>}</span>
                  </td>
                  <td className="cl-n cl-s-v"><Won v={p.eval_krw} /></td>
                  <td className={`cl-n cl-s-sub cl-${dir(pl)}`}><span className={`cl-delta cl-${dir(r)}`}>{pct(r)}</span><span className="cl-m-only"> {sMan(pl)}만</span><span className="cl-k-only cl-k-sub">{sMan(pl)}만</span></td>
                  <td className={`cl-n cl-m-hide cl-k-hide cl-${dir(pl)}`}>{sWon(pl)}</td>
                  {showSpark && <td className="cl-n cl-m-hide hd-spark-c hd-sparkcell"><Spark pts={spark[p.product_code]} avg={p.unit_purchase_price} up={pl >= 0} /></td>}
                </tr>
                {isOpen && parts.map((s) => {
                  const spl = s.eval_krw - s.cost_krw_real, sr = s.cost_krw_real ? spl / s.cost_krw_real : 0;
                  return (
                    <tr key={s.account_code || s.accounts?.[0]} className="hd-sub">
                      <td className="cl-s-nm">{TYPE_LABEL[typeOf(s)] || "미지정"}<span className="cl-k-only cl-k-sub">{qtyShort(s.quantity, a)} · 평단 {pxShort(s.unit_purchase_price, a)}</span></td>
                      <td className="cl-n cl-m-hide cl-k-hide">{px(s.unit_purchase_price, a)}</td>
                      <td className="cl-n cl-m-hide cl-k-hide">{qtyNum(s.quantity, a)}<span className="hd-u">{qtyUnit(a)}</span></td>
                      <td className="cl-n cl-m-hide"><Won v={s.cost_krw_real} /></td>
                      <td className="cl-n cl-s-meta cl-k-hide"><span className="cl-m-only">{qtyShort(s.quantity, a)} · 평단 {pxShort(s.unit_purchase_price, a)}</span></td>
                      <td className="cl-n cl-s-v"><Won v={s.eval_krw} /></td>
                      <td className={`cl-n cl-s-sub cl-${dir(spl)}`}>{pct(sr)}<span className="cl-k-only cl-k-sub">{sMan(spl)}만</span></td>
                      <td className={`cl-n cl-m-hide cl-k-hide cl-${dir(spl)}`}>{sWon(spl)}</td>
                      {showSpark && <td className="cl-m-hide hd-spark-c" />}
                    </tr>
                  );
                })}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot><tr>
          <td className="cl-s-nm">합계 · {rows.length}종목</td>
          <td className="cl-m-hide cl-k-hide" /><td className="cl-m-hide cl-k-hide" />
          <td className="cl-n cl-m-hide"><Won v={TC} /></td>
          <td className="cl-n cl-s-meta cl-k-hide"><span className="cl-m-only">투자금 {manAbs(TC)}만</span></td>
          <td className="cl-n cl-s-v"><Won v={TV} /></td>
          <td className={`cl-n cl-s-sub cl-${dir(TPL)}`}>{pct(TC ? TPL / TC : 0)}<span className="cl-m-only"> {sMan(TPL)}만</span><span className="cl-k-only cl-k-sub">{sMan(TPL)}만</span></td>
          <td className={`cl-n cl-m-hide cl-k-hide cl-${dir(TPL)}`}>{sWon(TPL)}</td>
          {showSpark && <td className="cl-m-hide hd-spark-c" />}
        </tr></tfoot>
      </table></div>
    </>
  );

  return (
    <div className="cl-panel" ref={wrap}>
      <div className="cl-panel-head"><h2>보유 종목</h2><span className="cl-sub">현금성 제외 · 만원</span></div>
      <Tabs className="cl-tabs hd-tabs" items={SCOPES} value={tab} onChange={setTab} />
      <div role="tabpanel" aria-label={`${TAB_NAME[tab]} 잔고`}>
        {body}
        {cashItems.length > 0 && !pq.isLoading && (
          <p className={`hd-excl${cashFlash ? " hd-flash" : ""}`} ref={cashRef} tabIndex={-1}>
            <span className="hd-lb">표에서 뺀 현금성</span>
            {cashItems.map(([l, v]) => <span key={l}>{l} <b className="cl-num">{manAbs(v)}만</b></span>)}
          </p>
        )}
        <p className="cl-goal-note hd-note">{TAB_NOTE[tab]}</p>
      </div>
    </div>
  );
}

export default function Holdings() {
  const pq = usePositions("account_product");
  const aq = useAccounts();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  // 계좌 비중 막대·계좌별 표·잔고 요약 탭이 같은 ?tab= 을 읽고 쓴다
  const tab = SCOPES.some(([k]) => k === sp.get("tab")) ? sp.get("tab") : "all";
  const cashRef = useRef(null);
  const [cashFlash, setCashFlash] = useState(false);

  const setParams = useQueryPatch();
  const setTab = (t) => setParams({ tab: t === "all" ? null : t });
  const openItem = useOpenItem();
  // 옛 주소 /portfolio#concentration → 배분의 쏠림 점검
  useEffect(() => {
    if (location.hash === "#concentration") navigate("/allocation#concentration", { replace: true });
  }, [location.hash, navigate]);

  // 계좌×상품 행의 계좌 유형 — API 값이 없으면 계좌 이름으로 찾는다
  const typeOf = useMemo(() => {
    const byName = Object.fromEntries((aq.data || []).map((a) => [a.account_name, a.account_type]));
    return (p) => p.account_type || p.account_types?.[0] || byName[p.accounts?.[0]];
  }, [aq.data]);
  // [상품 코드, 자산유형, 통화, 묶음, 평가액, 매입액, 계좌유형]
  const POS = useMemo(() => (pq.data?.positions || []).map((p) => {
    const t = typeOf(p);
    return [p.product_code, p.asset_type, p.currency_code, p.asset_type === "CASH" ? "cash" : GROUP_OF_TYPE[t], p.eval_krw, p.cost_krw_real ?? p.cost_krw_nominal ?? p.eval_krw, t];
  }), [pq.data, typeOf]);

  if (pq.isLoading || aq.isLoading) return <section><Loading /></section>;
  if (pq.isError) return <section><Failed q={pq} what="보유 종목" /></section>;
  if (aq.isError) return <section><Failed q={aq} what="계좌 목록" /></section>;

  const T = POS.reduce((a, p) => a + p[4], 0), TC = POS.reduce((a, p) => a + p[5], 0), TPL = T - TC;
  const byG = POS.reduce((o, p) => { (o[p[3]] ||= []).push(p); return o; }, {});
  const inG = (g) => byG[g.id] || [];
  const GV = Object.fromEntries(AGROUPS.map((g) => [g.id, inG(g).reduce((a, p) => a + p[4], 0)]));
  const gv = (g) => GV[g.id];
  const liq = LIQ_META.map(([k, n, sub]) => [k, n, sub, AGROUPS.filter((g) => g.liqk === k).reduce((a, g) => a + gv(g), 0)]);
  const free = liq[0][3];
  const g0 = AGROUPS.find((g) => g.scope && g.scope === tab);
  const sel = g0 ? inG(g0) : POS;
  const ST = sel.reduce((a, p) => a + p[4], 0);
  const nTypes = new Set(POS.map((p) => p[6]).filter(Boolean)).size;
  // 묶음 선택 — 탭이 있는 묶음은 ?tab= 토글, 현금성은 전체 탭의 '표에서 뺀 현금성' 줄로 가서 1초 강조
  const pick = (g) => {
    if (!g) return setTab("all");
    if (!g.scope) {
      setTab("all");
      requestAnimationFrame(() => { cashRef.current?.scrollIntoView({ block: "center" }); cashRef.current?.focus({ preventScroll: true }); });
      setCashFlash(true); setTimeout(() => setCashFlash(false), 1000);
      return;
    }
    setTab(tab === g.scope ? "all" : g.scope);
  };
  const by = (f, map) => {
    const o = {};
    sel.forEach((p) => { const k = f(p); o[k] = (o[k] || 0) + p[4]; });
    return Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v, map[k] || "c3"]);
  };
  const products = new Set(POS.filter((p) => p[1] !== "CASH").map((p) => p[0])).size;
  const asOf = pq.data?.as_of;
  const acctRows = pq.data?.positions || [];
  const [bigN, bigU] = krwParts(T);

  return (
    <section>
      <div className="cl-page-head"><div><h1 tabIndex={-1}>보유</h1><p className="cl-num">종목 {products} · {krw(T)}</p></div></div>
      <div className="cl-stack">
        <div className="cl-acct-cards" role="group" aria-label="전체 요약과 계좌 유형 비중">
          {/* 전체 카드는 버튼이 아니다 — 묶음 선택은 계좌 비중 막대·잔고 요약 탭이 맡는다 */}
          <div className="cl-acard2 cl-acard-total">
            <span className="cl-top"><span className="cl-nm">전체</span><span className="cl-pct">계좌 {AGROUPS.filter((g) => gv(g) > 0).length}</span></span>
            <span className="cl-big2">{bigN}<span className="cl-unit">{bigU}</span></span>
            <span className="cl-pl"><span className={`cl-delta cl-${dir(TPL)}`}>평가손익 {sKrw(TPL)} · {TC ? pct(TPL / TC) : "—"}</span></span>
            <span className="cl-meta">종목 {products}개 · 현금성 포함</span>
            <span className="cl-free"><span>유동 자산</span><b>{krw(free)} · {share(free, T)}</b></span>
          </div>
          <div className="cl-panel cl-acct-viz">
            <div className="cl-panel-head"><h2>계좌 비중</h2><span className="cl-sub">계좌 6 · 유동성 3</span></div>
            <VBar k="계좌" T={T} items={AGROUPS.map((g) => ({ key: g.id, name: g.name, value: gv(g), color: gColor(g), pressed: !!g.scope && tab === g.scope, onClick: () => pick(g) }))} />
            <VBar k="유동성" T={T} items={liq.map(([k, n, , v]) => ({ key: k, name: n, value: v, color: `var(--l-${k})` }))} />
            <p className="cl-liq-note">{liq.map(([k, n, sub], i) => <Fragment key={k}>{i > 0 && " · "}<span title={sub}>{n}</span></Fragment>)} · CMA·RP·금현물은 현금성</p>
          </div>
        </div>

        <Balance tab={tab} setTab={setTab} acctRows={acctRows} typeOf={typeOf} onOpen={openItem} cashRef={cashRef} cashFlash={cashFlash} />

        <div className="cl-panel">
          <div className="cl-panel-head"><h2>계좌별 손익</h2></div>
          <div className="cl-tscroll"><table className="cl-acct-table cl-m">
            <thead><tr><th>계좌</th><th className="cl-n">평가금(만원)</th><th className="cl-n">비중</th><th className="cl-n cl-k-hide">평가손익(만원)</th><th className="cl-n">수익률</th><th className="cl-n cl-k-hide">종목</th><th>유동성</th><th className="cl-k-hide">세제</th></tr></thead>
            <tbody>
              {AGROUPS.map((g) => {
                const ps = inG(g), v = ps.reduce((a, p) => a + p[4], 0), c = ps.reduce((a, p) => a + p[5], 0), pl = v - c, flat = Math.abs(pl) < 1;
                // 부제: 계좌 유형별 금액(큰 순). 둘 이상일 때만, 아니면 묶음 설명
                const subs = Object.entries(ps.reduce((o, p) => { const l = g.id === "cash" && p[1] === "CASH" ? cashLabel(p[6], p[0]) : TYPE_LABEL[p[6]]; o[l] = (o[l] || 0) + p[4]; return o; }, {})).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]);
                const sub = subs.length > 1 ? subs.map(([t, x]) => `${t} ${manAbs(x)}`).join(" · ") : g.note;
                return (
                  <tr key={g.id} tabIndex={0} aria-selected={!!g.scope && tab === g.scope} onClick={() => pick(g)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pick(g))}>
                    <td className="cl-s-nm"><span className="cl-an"><i style={{ background: gColor(g) }} /><span><b>{g.name}</b><small title={sub}>{sub}</small></span></span></td>
                    <td className="cl-n cl-s-v"><b className="cl-v">{manAbs(v)}</b></td>
                    <td className="cl-n cl-m-hide"><span className="cl-sharecell"><span className="cl-sbar"><i style={{ width: `${T ? Math.min(100, (v / T) * 250) : 0}%` }} /></span>{share(v, T)}</span></td>
                    <td className={`cl-n cl-m-hide cl-k-hide cl-${flat ? "flat" : dir(pl)}`}>{flat ? "–" : sMan(pl)}</td>
                    <td className="cl-n cl-s-sub"><span className="cl-m-only">{share(v, T)} · </span>{flat ? <span style={{ color: "var(--muted)" }}>원금형</span> : <span className={`cl-delta cl-${dir(pl)}`}>{pct(c ? pl / c : 0)}</span>}
                      {!flat && <span className={`cl-k-only cl-k-sub cl-${dir(pl)}`}>{sMan(pl)}만</span>}</td>
                    <td className="cl-n cl-m-hide cl-k-hide">{new Set(ps.filter((p) => p[1] !== "CASH").map((p) => p[0])).size}</td>
                    <td className="cl-s-meta"><span className="cl-liqcell"><span className={`cl-tagx cl-l-${g.liqk}`}>{LIQ_NAME[g.liqk]}</span><small className="cl-k-hide">{g.liq}</small></span></td>
                    <td className="cl-m-hide cl-k-hide" style={{ color: "var(--body)" }}>{g.tax}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </div>

        <div className="cl-panel">
          <div className="cl-panel-head"><h2>자산 구성</h2><span className="cl-sub cl-num">{g0 ? `${g0.name} ${krw(ST)} 기준` : "평가금 기준"}</span></div>
          <div className="hold-mixes">
            <Mix k="자산 종류" list={by((p) => (AT[p[1]] || [p[1]])[0], AT_COLOR)} total={ST} sub={g0 ? g0.name : "평가금"} />
            <Mix k="통화" list={by((p) => p[2], CURC)} total={ST} sub={g0 ? g0.name : "평가금"} one={(c) => CUR_NAME[c] || c} />
          </div>
        </div>
      </div>
    </section>
  );
}
