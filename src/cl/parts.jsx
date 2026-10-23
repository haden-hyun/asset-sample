/* 두 화면 이상이 쓰는 부품 — 납입 목표 막대 · 탭·필터 · 종목 드로어 링크 · URL 쿼리 갱신 · 공통 상수(묶음·계좌 묶음·기간) · 용어 툴팁 · 빈 상태 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useGoals } from "../lib/queries.js";
import { Failed, Loading } from "./Shell.jsx";
import { krw, manAbs, monthsLeft as leftMonths } from "./format.js";
import { GLOSSARY } from "./glossary.js";

/** 수기 원장 계좌 유형 (= 데이터 › 수기 입력 계좌 id) */
const MANUAL_TYPES = ["IRP", "DC", "INSTALLMENT_SAVINGS", "HOUSING_SUBSCRIPTION"];
/** 합산 목표 막대 조각 색 = 계좌 유형 색 */
const PART_COLOR = { PENSION_CREDIT: "var(--a-pension-credit)", PENSION_NON_CREDIT: "var(--a-pension-non)", IRP: "var(--a-irp)", DC: "var(--a-dc)", ISA: "var(--a-isa)" };

/** 연간 납입 목표 카드 본문 — 목표 대비 막대 · 오늘까지 균등 납입선 · 남은 달 × 필요 월납입. /goals 를 스스로 부른다. */
export function GoalBars() {
  const q = useGoals();
  if (q.isLoading) return <Loading />;
  if (q.isError) return <Failed q={q} what="납입 목표" />;
  const g = q.data;
  if (!g?.goals?.length) return <p className="cl-goal-note">납입 목표 없음</p>;
  const monthsLeft = leftMonths(g.as_of);
  return (
    <div className="cl-goals">
      {g.goals.map((x) => {
        const r = x.target_krw ? x.actual_krw / x.target_krw : 0, full = r >= 1;
        return (
          <div key={x.key}>
            <div className="cl-goal-top"><b>{x.label}</b><span className="cl-num">{manAbs(x.actual_krw)} / {manAbs(x.target_krw, 0)}만원</span></div>
            <div className={`cl-gbar${full ? " cl-full" : ""}${x.parts ? " cl-gbar-parts" : ""}`} role="img"
              aria-label={`${x.label} ${Math.round(r * 100)}%${x.parts ? ` (${x.parts.map((p) => `${p.label} ${manAbs(p.actual_krw)}만원`).join(", ")})` : ""}`}>
              {x.parts ? (() => {
                // 합산 목표: 유형별로 이어 채우고, 합이 목표를 넘으면 목표 폭에 맞춰 줄인다
                const k = Math.min(1, x.target_krw / Math.max(x.actual_krw, 1));
                let left = 0;
                return x.parts.map((p) => {
                  const w = Math.max(0, (p.actual_krw * k) / x.target_krw) * 100, l = left;
                  left += w;
                  return <i key={p.account_type} style={{ left: `${l}%`, width: `${w}%`, background: PART_COLOR[p.account_type] || "var(--accent)" }} />;
                });
              })() : <i style={{ width: `${Math.min(1, r) * 100}%` }} />}
              {!full && <span className="cl-pace" style={{ left: `${g.pace_pct}%` }} title="오늘까지 균등 납입 기준" />}
            </div>
            {x.parts && (
              <div className="cl-goal-parts">
                {x.parts.map((p) => <span key={p.account_type}><i style={{ background: PART_COLOR[p.account_type] || "var(--accent)" }} />{p.label} <b className="cl-num">{manAbs(p.actual_krw)}만원</b></span>)}
              </div>
            )}
            {x.parts?.some((p) => MANUAL_TYPES.includes(p.account_type)) && (
              <Link className="cl-btn-text cl-goal-in" to={`/data?account=${x.parts.find((p) => MANUAL_TYPES.includes(p.account_type)).account_type}`}>납입 입력</Link>
            )}
            <div className="cl-goal-note">
              {full ? (
                <><span className="cl-done">채움</span> · {krw(x.over_krw || x.actual_krw - x.target_krw)} 초과</>
              ) : (
                <>{Math.round(r * 100)}% · 월 {krw(x.remaining_krw / monthsLeft)} × {monthsLeft}개월</>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 탭. items = [[키, 라벨]] · label = 스크린리더 이름 */
export function Tabs({ items, value, onChange, className = "cl-tabs", label }) {
  return (
    <div className={className} role="tablist" aria-label={label}>
      {items.map(([k, l]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} onClick={() => onChange(k)}>{l}</button>
      ))}
    </div>
  );
}

/** 대상(관리 묶음) 고르기 — 밑줄 탭, 가로 스크롤. items = [[키, 라벨]] · flag(키) 가 참이면 '범위 밖' 점 배지. */
export function ScopeTabs({ items, value, onChange, label = "관리 묶음", flag }) {
  return (
    <div className="cl-stabs" role="group" aria-label={label}>
      {items.map(([k, l]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}>
          {l}{flag?.(k) && <span className="cl-flag" role="img" aria-label="목표 범위 밖" />}
        </button>
      ))}
    </div>
  );
}

/** 기간 고르기 — 작은 세그먼트. items = [[키, 라벨, …]] (셋째 값부터 무시 — PERIODS 를 그대로 넘긴다) */
export function PeriodSeg({ items, value, onChange, label = "기간" }) {
  return (
    <div className="cl-pseg" role="group" aria-label={label}>
      {items.map(([k, l]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}>{l}</button>
      ))}
    </div>
  );
}

/** 계좌 유형(DB account_type) → 화면 이름 */
export const TYPE_LABEL = {
  PENSION_CREDIT: "연금저축(세공)", PENSION_NON_CREDIT: "연금저축(안세공)", IRP: "IRP", DC: "DC", ISA: "ISA",
  REGULAR: "위탁", CRYPTO: "가상자산", GOLD: "금현물", HOUSING_SUBSCRIPTION: "주택청약", INSTALLMENT_SAVINGS: "적금", CMA: "CMA",
};

/*
 * 종목 시세 드로어 열기 — 지금 주소에 ?item=코드 를 더한다(셸의 ItemDrawer 가 띄운다). 기간은 ?ip=.
 * 새로 열면 히스토리에 쌓아 뒤로 가기로 닫히게, 이미 열려 있으면 바꿔 끼운다.
 * 연 요소는 닫힌 뒤 초점을 돌려주려고 맡아 둔다(takeItemOpener 로 한 번 꺼낸다).
 */
let itemOpener = null;
export const takeItemOpener = () => { const el = itemOpener; itemOpener = null; return el; };
function itemHref(loc, code) {
  const n = new URLSearchParams(loc.search);
  n.set("item", code);
  n.delete("ip");
  return `${loc.pathname}?${n}${loc.hash || ""}`;
}
export function useOpenItem() {
  const loc = useLocation();
  const navigate = useNavigate();
  return useCallback((code, el) => {
    itemOpener = el || document.activeElement;
    const swap = new URLSearchParams(loc.search).has("item");
    navigate(itemHref(loc, code), { replace: swap, state: swap ? loc.state : { ...(loc.state || {}), item: true } });
  }, [loc, navigate]);
}
/** URL 쿼리 부분 갱신 — patch { 키: 값 }, null·"" 은 지운다. 기록을 늘리지 않게 replace 로 이동(#hash 는 버린다) */
export function useQueryPatch() {
  const [, setSp] = useSearchParams();
  return useCallback((patch) => {
    const n = new URLSearchParams(window.location.search);
    Object.entries(patch).forEach(([k, v]) => (v == null || v === "" ? n.delete(k) : n.set(k, v)));
    setSp(n, { replace: true });
  }, [setSp]);
}
/** 종목 이름 링크 — 누르면 지금 화면 위에 시세 드로어. 보조 키를 누르면 브라우저 기본 동작(새 탭 등). */
export function ItemLink({ code, children, ...rest }) {
  const loc = useLocation();
  const open = useOpenItem();
  return (
    <Link to={itemHref(loc, code)} data-item={code} aria-haspopup="dialog" {...rest}
      onClick={(e) => { if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); open(code, e.currentTarget); }}>
      {children}
    </Link>
  );
}

/** 관리 묶음 [scope_code, 라벨]. 'all' = 필터 없음 */
export const SCOPES = [["all", "전체"], ["ISA", "ISA"], ["BROKERAGE", "위탁"], ["PENSION_SAVINGS", "연금저축"], ["RETIREMENT", "퇴직연금"], ["CRYPTO", "가상자산"]];
/** 배분 묶음 이름 — DB scope_name('크립토'·'유동성') 대신 SCOPES 라벨 + 현금성·목적자금. d = { scope_code, scope_name } */
const SCOPE_NAME = { ...Object.fromEntries(SCOPES), LIQUIDITY: "현금성", PURPOSE_SAVINGS: "목적자금" };
export const scopeName = (d) => SCOPE_NAME[d?.scope_code] || d?.scope_name || "";

/** 계좌 유형 11개 → 세금·인출 성격이 같은 6묶음(유동 → 장기 순). scope = 잔고 요약 탭(DB scope_code), liqk = 유동성 단계.
 *  asset_type CASH 행(RP·발행어음 등)은 어느 계좌에 있든 현금성 묶음으로 간다 */
export const ACCOUNT_GROUPS = [
  { id: "invest", scope: "BROKERAGE", liqk: "free", name: "위탁", types: ["REGULAR"], tax: "과세", liq: "즉시 현금화", note: "해외주식 양도차익 250만원 초과 과세" },
  { id: "crypto", scope: "CRYPTO", liqk: "free", name: "가상자산", types: ["CRYPTO"], tax: "과세 시행 전", liq: "24시간 거래", note: "거래소 계좌 · 배당 없음" },
  { id: "isa", scope: "ISA", liqk: "cond", name: "ISA", types: ["ISA"], tax: "비과세 200만원", liq: "의무보유 3년", note: "연 2,000만원 납입 한도" },
  { id: "cash", scope: null, liqk: "cond", name: "현금성", types: ["HOUSING_SUBSCRIPTION", "INSTALLMENT_SAVINGS", "CMA", "GOLD"], tax: "이자 비과세·소득공제 포함", liq: "청약·적금은 해지 시 혜택 소멸", note: "원금형 자산 · 계좌 안 RP·예수금 포함" },
  { id: "pension", scope: "PENSION_SAVINGS", liqk: "lock", name: "연금저축", types: ["PENSION_CREDIT", "PENSION_NON_CREDIT"], tax: "과세이연", liq: "55세 이후 수령", note: "세액공제 연 600만원" },
  { id: "retire", scope: "RETIREMENT", liqk: "lock", name: "퇴직연금", types: ["IRP", "DC"], tax: "과세이연", liq: "중도인출 제한", note: "IRP + DC · 연금저축 합산 공제 900만원" },
];
/** 계좌 묶음 색 토큰(--a-<id>) */
export const groupColor = (g) => `var(--a-${g.id})`;

/** 기간 [키(서버 preset), 라벨, 일수] */
export const PERIODS = [["1m", "1개월", 31], ["3m", "3개월", 92], ["6m", "6개월", 183], ["1y", "1년", 366], ["all", "전체", Infinity]];
/** 성과·입출금 내역 기간 — '올해'(1월 1일부터) 포함 */
export const PERIODS_PERF = [["1m", "1개월"], ["3m", "3개월"], ["6m", "6개월"], ["ytd", "올해"], ["1y", "1년"], ["all", "전체"]];
/** 시세 드로어 기간 — 기본 '보유기간'(이번 보유 시작일부터). 시세가 최대 1년이라 '전체' 없음 */
export const PERIODS_DRAWER = [["hold", "보유기간", null], ...PERIODS.filter(([k]) => k !== "all")];

/** 용어 툴팁(?). term = GLOSSARY 키. 호버·키보드 포커스·탭으로 열고 Esc·바깥 누름·스크롤로 닫는다(≤760 은 아래 시트 — cl.css). */
export function InfoTip({ term }) {
  const g = GLOSSARY[term];
  const id = useId();
  const btn = useRef(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  useEffect(() => {
    if (!open) return undefined;
    const r = btn.current.getBoundingClientRect();
    setPos({ left: Math.min(Math.max(12, r.left + r.width / 2 - 145), innerWidth - 302), top: r.bottom + 8, above: r.bottom + 220 > innerHeight ? r.top - 8 : null });
    const close = (e) => { if (e.type === "keydown" ? e.key === "Escape" : !btn.current?.contains(e.target)) setOpen(false); };
    const sc = () => setOpen(false);
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", close);
    addEventListener("scroll", sc, { passive: true });
    return () => { document.removeEventListener("keydown", close); document.removeEventListener("pointerdown", close); removeEventListener("scroll", sc); };
  }, [open]);
  if (!g) return null;
  const [t, d, f, e, n] = g; // 이름 · 정의 · 식 · 예 · 덧붙임(선택)
  return (
    <>
      <button ref={btn} type="button" className="cl-info" aria-label={`${t} 설명`} aria-expanded={open} aria-describedby={open ? id : undefined}
        onMouseEnter={(ev) => ev.pointerType !== "touch" && setOpen(true)} onMouseLeave={() => setOpen(false)}
        onFocus={(ev) => ev.target.matches(":focus-visible") && setOpen(true)} onBlur={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}>?</button>
      {open && pos && createPortal(
        <div id={id} role="tooltip" className="cl-infotip" style={pos.above != null ? { left: pos.left, bottom: innerHeight - pos.above } : { left: pos.left, top: pos.top }}>
          <div className="cl-it-t">{t}</div><div>{d}</div><div className="cl-it-f">{f}</div><div className="cl-it-e">{e}</div>{n && <div className="cl-it-n">{n}</div>}
        </div>, document.body)}
    </>
  );
}

/** 빈 상태 — title · body(왜 비었나·무엇을 하면 되나) · action = { label, onClick } */
export function EmptyState({ title, body, action }) {
  return (
    <div className="cl-empty" role="status">
      <b>{title}</b>
      {body && <span>{body}</span>}
      {action && <button type="button" className="cl-btn-ghost" onClick={action.onClick}>{action.label}</button>}
    </div>
  );
}

/** 매매 꼬리표 — 매수 채운 알약 · 매도 빈 알약(DESIGN §4). s = "buy" | "sell" */
export const Side = ({ s }) => <span className={`cl-side cl-side-${s}`}>{s === "buy" ? "매수" : "매도"}</span>;
