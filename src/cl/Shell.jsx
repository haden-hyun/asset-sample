/* 셸 — 상단 헤더 · 신뢰 줄 · 모바일 하단 탭 · ⋯ 표시 설정 · 종목 드로어. 공통 Loading/Failed 도 여기 있다. */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { useDataHealth, useLineage, useManualEntry } from "../lib/queries.js";
import { useAuth } from "../lib/auth.jsx";
import { useTheme } from "../lib/theme.jsx";
import { useFreshness } from "../lib/freshness.jsx";
import { dLabel, md } from "./format.js";
import { collectStats, failAt, refDay } from "./lineageFmt.js";
import { Find } from "./Search.jsx";
import { ItemDrawer } from "./PriceDrawer.jsx";

/** 주 메뉴 [경로, 이름, 아이콘 SVG 내용] */
const NAV = [
  ["/", "홈", '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9v12h14V9"/>'],
  ["/performance", "성과", '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>'],
  ["/portfolio", "보유", '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/>'],
  ["/trades", "매매", '<path d="M7 20V4M3 8l4-4 4 4"/><path d="M17 4v16M13 16l4 4 4-4"/>'],
  ["/allocation", "배분", '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>'],
  ["/dividend", "배당", '<path d="M12 2.5v8M8.5 7 12 10.5 15.5 7"/><circle cx="12" cy="16.5" r="5"/><path d="M12 14.5v4"/>'],
];
const MK = { KR: "국내", US: "미국" };
/** 원천 상태 { state, available, latest } → 사용자 문구 */
const srcText = (x) => {
  if (!x) return "확인 중";
  if (x.state === "stale") return `멈춤 · ${x.latest ? md(x.latest) : "—"}부터`;
  if (x.available) return `정상${x.latest ? ` · ${md(x.latest)}` : ""}`;
  return "없음";
};

/** 읽는 화면 6개 뒤에 떼어 두는 '다루는 화면' — 데스크톱 주 메뉴 끝, 모바일은 ⋯ 시트 */
const DATA_NAV = ["/data", "데이터"];

function NavLinks() {
  return NAV.map(([to, label, icon]) => (
    <NavLink key={to} to={to} end={to === "/"}>
      <svg viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: icon }} />
      <span>{label}</span>
    </NavLink>
  ));
}

/** /data-health → { h, recentGap(7일 안 적재 누락), issues(주의 문구 목록) }. 데이터 없으면 { h: null } */
function useTrust() {
  const q = useDataHealth();
  const h = q.data;
  if (!h?.has_data) return { h: null };
  const gaps = h.recent_gaps || [];
  const recentGap = gaps.find((g) => (new Date(h.as_of) - new Date(g.date)) / 864e5 <= 7);
  const issues = [];
  if (recentGap) issues.push(`적재 누락(최근 ${recentGap.date})`);
  if (h.fx_stale_positions > 0) issues.push(`환율 지연 ${h.fx_worst_days_stale}일`);
  if (h.sources?.dividend?.state === "stale") issues.push("배당 기록 지연");
  return { h, recentGap, issues };
}

/** 헤더 신뢰 배지 — 기준일 · 주의 건수. 누르면 신뢰 상세를 펼친다. */
function TrustBadge({ open, onToggle }) {
  const { h, issues } = useTrust();
  if (!h) return <span className="cl-badge cl-badge-wait"><span className="cl-badge-dot" aria-hidden="true" />확인 중</span>;
  const n = issues.length;
  return (
    <button type="button" className={`cl-badge${n ? " cl-warn" : ""}`} aria-expanded={open} aria-controls="cl-trust-detail"
      aria-label={`${dLabel(h.as_of)} 종가 기준${n ? ` · 주의 ${n}건: ${issues.join(", ")}` : " · 이상 없음"} — 데이터 상태 ${open ? "접기" : "자세히"}`}
      title={n ? issues.join(" · ") : "이상 없음"} onClick={onToggle}>
      <span className="cl-badge-dot" aria-hidden="true" />
      <span className="cl-num">{md(h.as_of)}</span><span className="cl-badge-unit">종가</span>
      {n > 0 && <span className="cl-badge-n">주의 {n}</span>}
      <svg className="cl-badge-chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5l3-3" /></svg>
    </button>
  );
}

/** 신뢰 줄 — 기준일 · 휴장 · 재산정 · 환율 지연(최근 7일 적재 누락은 주의로만). 새 적재를 감지하면 화면 전체 쿼리를 다시 받는다(useFreshness). */
function TrustLine({ open, onToggle }) {
  const fresh = useFreshness();
  const { h, recentGap, issues } = useTrust();
  if (!h) return <div className="cl-trust"><div className="cl-trust-row">상태 확인 중…</div></div>;
  const warn = issues.length > 0;
  const day = h.markets?.as_of || {};
  const today = h.markets?.today || {};
  const notes = [];
  if (day.KR && !day.KR.open)
    notes.push(day.KR.reason === "주말" ? "주말 · 직전 거래일 가격" : `국내 휴장(${day.KR.reason}) · 직전 거래일 가격`);
  else if (day.US && !day.US.open && day.US.reason !== "주말") notes.push(`미국 휴장(${day.US.reason}) · 해외 직전 가격`);
  if (h.markets?.today_date && h.markets.today_date !== h.as_of)
    for (const m of ["KR", "US"]) {
      const s = today[m];
      if (s && !s.open && s.reason !== "주말") notes.push(`오늘 ${MK[m]} 휴장(${s.reason})`);
    }
  const ev = h.price_events || [];
  const src = h.sources || {};
  // 주의·휴장·집계 대기가 없고 접혀 있으면 줄을 그리지 않는다(기준일은 배지가 보여 준다)
  if (!open && !warn && !notes.length && !fresh.spineStale) return null;
  return (
    <div className="cl-trust" role="status">
      <div className="cl-trust-row">
        <div className="cl-trust-state">
          <span className={`cl-ok-dot${warn ? " cl-warn" : ""}`} aria-hidden="true">
            <svg viewBox="0 0 12 12">{warn ? <path d="M6 3v4M6 9v.01" /> : <path d="M2.5 6.2 5 8.5l4.5-5" />}</svg>
          </span>
          <span>
            <b style={{ color: "var(--ink)", fontWeight: 600 }}>{dLabel(h.as_of)} 종가 기준</b>
            {notes.map((n) => ` · ${n}`).join("")}
          </span>
        </div>
        {ev.length > 0 && <span className="cl-chip"><span className="cl-ring" aria-hidden="true" />재산정 {ev.length}건</span>}
        {fresh.spineStale && <span className="cl-chip" title="값은 정확합니다. 화면이 조금 느릴 수 있습니다."><span className="cl-ring" aria-hidden="true" />갱신 중</span>}
        {h.fx_stale_positions > 0 && <span className="cl-chip"><span className="cl-ring" aria-hidden="true" />환율 지연 {h.fx_worst_days_stale}일</span>}
        {src.dividend?.state === "stale" && <span className="cl-chip"><span className="cl-ring" aria-hidden="true" />배당 기록 지연</span>}
        <button className="cl-btn-text" aria-expanded={open} aria-controls="cl-trust-detail" onClick={onToggle}>{open ? "접기" : "자세히"}</button>
      </div>
      <dl className="cl-trust-detail" id="cl-trust-detail" hidden={!open}>
        <div><dt>기준일</dt><dd>{dLabel(h.as_of)} 종가{h.loaded_at ? ` · ${String(h.loaded_at).slice(11, 16)} 반영` : ""}</dd></div>
        <div><dt>반영</dt><dd>{h.rows_today}건{recentGap ? ` · 적재 누락 ${md(recentGap.date)}` : ""}</dd></div>
        <div><dt>휴장</dt><dd>{["KR", "US"].map((m) => `${MK[m]} ${day[m]?.open ? "개장" : `휴장(${day[m]?.reason || "-"})`}`).join(" · ")}</dd></div>
        <div><dt>환율</dt><dd>{h.fx_stale_positions > 0 ? `${h.fx_stale_positions}건 최대 ${h.fx_worst_days_stale}일 지연` : "정상"}</dd></div>
        <div><dt>재산정</dt><dd>{ev.length ? ev.map((e) => `${e.date} ${e.magnitude_pct ? `+${Math.round(e.magnitude_pct)}%` : ""} 재산정 · 성과에 포함`).join(" / ") : "없음"}</dd></div>
        <div><dt>배당 기록</dt><dd>{srcText(src.dividend)}</dd></div>
        <div><dt>시세</dt><dd>{src.price?.available ? srcText(src.price) : "없음 · 보유일 종가만"}</dd></div>
        {open && <ManualRow />}
        {open && <CollectRow />}
        <div><dt>집계 시각</dt><dd>{h.spine?.refreshed_at ? String(h.spine.refreshed_at).slice(0, 16).replace("T", " ") : "—"}</dd></div>
      </dl>
    </div>
  );
}

/** 신뢰 상세 '수기 원장' 줄 — 계좌별 최근 원장일 + 입력 링크 (펼쳤을 때만 부른다) */
function ManualRow() {
  const q = useManualEntry();
  const accts = q.data?.accounts || [];
  if (!accts.length) return null;
  return (
    <div><dt>수기 원장</dt><dd>
      {accts.map((a, i) => <span key={a.account_id}>{i ? " · " : ""}<Link to={`/data?account=${a.account_id}`}>{a.type_label} {a.last_date ? md(a.last_date) : "없음"}</Link></span>)}
    </dd></div>
  );
}

/** 신뢰 상세 '수집' 줄 — 정기 수집 정상 수 · 실패 수집 + 흐름 탭 링크 (펼쳤을 때만 부른다) */
function CollectRow() {
  const d = useLineage().data;
  if (!d?.nodes) return null;
  const { dags, reg, known, ok } = collectStats(d.nodes);
  const bad = dags.find((n) => n.state === "bad");
  const air = d.sources?.airflow;
  const t = bad && failAt(bad, refDay(d));
  const [g, c] = bad ? ["▲", "var(--q-bad)"] : !known.length || air !== "ok" || dags.some((n) => n.state === "late") ? ["◐", "var(--q-part)"] : ["●", "var(--q-ok)"];
  const text = air !== "ok" && !known.length ? "Airflow 확인 불가"
    : [reg.length ? `정기 ${ok}/${reg.length} 정상` : "정기 수집 없음",
      bad && `${(bad.role || bad.name).replace(/\s*수집$/, "")} 실패${t ? ` ${t}` : ""}`,
      air !== "ok" && `확인 불가 ${reg.length - known.length}`].filter(Boolean).join(" · ");
  return (
    <div><dt>수집</dt><dd>
      <span aria-hidden="true" className="cl-trust-g" style={{ color: c }}>{g}</span>{text} <Link to="/data?tab=lineage">데이터 › 흐름 →</Link>
    </dd></div>
  );
}

/** 표시 설정 — 다크 모드 · 기기 설정 따르기 · 상승 색 */
function DisplaySettings() {
  const t = useTheme();
  const dark = t.resolvedTheme === "dark";
  return (
    <div className="cl-disp">
      <div className="cl-disp-h">표시</div>
      <button type="button" role="switch" aria-checked={dark} className="cl-switch-row" onClick={() => t.setTheme(dark ? "light" : "dark")}>
        <svg className="cl-switch-ico" viewBox="0 0 24 24" aria-hidden="true">
          {dark ? <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" /> : <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>}
        </svg>
        <span className="cl-switch-lbl">다크 모드</span>
        <span className="cl-switch" aria-hidden="true"><i /></span>
      </button>
      {t.theme === "system"
        ? <p className="cl-disp-note">기기 설정 따름</p>
        : <button type="button" className="cl-disp-link" onClick={() => t.setTheme("system")}>기기 설정 따르기</button>}
      <div className="cl-disp-h" id="cl-sign-h">상승 색</div>
      <div className="cl-seg" role="radiogroup" aria-labelledby="cl-sign-h">
        {[["kr", "빨강", "var(--red)"], ["global", "초록", "var(--green)"]].map(([k, l, c]) => (
          <button key={k} type="button" role="radio" aria-checked={t.sign === k} onClick={() => t.setSign(k)}>
            <span style={{ color: c }} aria-hidden="true">▲</span>{l}
          </button>
        ))}
      </div>
    </div>
  );
}

/** ⋯ 설정 대화상자(≤760 하단 시트 · 그 위 팝오버 — cl.css). 열리면 첫 버튼에 초점, Esc·바깥 누름으로 닫는다. */
function Sheet({ open, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    ref.current?.querySelector("button")?.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="cl-sheet-bg" onClick={onClose}>
      <div className="cl-sheet" role="dialog" aria-modal="true" aria-label="표시 설정" ref={ref} onClick={(e) => e.stopPropagation()}>
        {children}
        <button type="button" className="cl-btn-ghost cl-sheet-close" onClick={onClose}>닫기</button>
      </div>
    </div>
  );
}

export function Shell({ children }) {
  const { logout } = useAuth();
  const [menu, setMenu] = useState(false);
  const [trustOpen, setTrustOpen] = useState(false);
  const moreRef = useRef(null);
  // 닫으면 초점을 ⋯ 로. 참조 고정 — Sheet 의 effect 가 렌더마다 초점을 다시 옮기지 않게
  const closeMenu = useCallback(() => { setMenu(false); moreRef.current?.focus(); }, []);
  // 배지로 펼치면 신뢰 줄이 화면 밖일 수 있어 보이게 스크롤한다
  const toggleFromBadge = () => {
    const next = !trustOpen;
    setTrustOpen(next);
    if (next) requestAnimationFrame(() => document.getElementById("cl-trust-detail")?.closest(".cl-trust")?.scrollIntoView({ block: "nearest" }));
  };
  return (
    <div className="cl-app">
      <div className="cl-viewport">
        <header className="cl-top">
          <div className="cl-top-in">
            <Link to="/" className="cl-brand" aria-label="내 자산 — 홈으로"><span className="cl-brand-mark" aria-hidden="true" /><span className="cl-brand-txt">내 자산</span>{import.meta.env.VITE_SAMPLE && <span className="cl-tag">샘플</span>}</Link>
            <nav className="cl-nav" aria-label="주 메뉴"><NavLinks /><span className="cl-nav-sep" aria-hidden="true" /><NavLink to={DATA_NAV[0]}>{DATA_NAV[1]}</NavLink></nav>
            <div className="cl-top-end">
              <div className="cl-top-find"><Find /></div>
              <TrustBadge open={trustOpen} onToggle={toggleFromBadge} />
              <button type="button" className="cl-more" ref={moreRef} aria-label="표시 설정과 로그아웃" aria-haspopup="dialog" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
              </button>
            </div>
          </div>
        </header>
        <TrustLine open={trustOpen} onToggle={() => setTrustOpen((o) => !o)} />
        <main>
          {children}
        </main>
      </div>
      <nav className="cl-tabbar" aria-label="주 메뉴"><NavLinks /></nav>
      <ItemDrawer />
      <Sheet open={menu} onClose={closeMenu}>
        <Link to={DATA_NAV[0]} className="cl-sheet-nav" onClick={() => setMenu(false)}>{DATA_NAV[1]}<span>수기 입력</span></Link>
        <DisplaySettings />
        <button type="button" className="cl-btn-ghost cl-sheet-logout" onClick={logout}>로그아웃</button>
      </Sheet>
    </div>
  );
}

/** 패널 불러오는 중 */
export function Loading() {
  return <div className="cl-skel" aria-label="불러오는 중" />;
}
/** 패널 오류 — q = 실패한 쿼리(다시 시도), what = 무엇을 못 불렀나 */
export function Failed({ q, what = "데이터" }) {
  return (
    <div className="cl-err" role="alert">
      {what} 불러오기 실패{q?.error?.message ? ` (${q.error.message})` : ""}{" "}
      <button type="button" className="cl-btn-text" onClick={() => q?.refetch?.()}>다시 시도</button>
    </div>
  );
}
