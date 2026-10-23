import { Fragment, useEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { useAllocations, useGoals, useXray } from "../lib/queries.js";
import { Failed, Loading } from "./Shell.jsx";
import { GoalBars, ScopeTabs as Underline, Tabs, scopeName as nameOf } from "./parts.jsx";
import { useChart } from "./charts.js";
import { drawContrib } from "./contrib-chart.js";
import Ledger from "./Ledger.jsx";
import { krw, monthsLeft, sKrw, sgn, shortName, won } from "./format.js";
import "./holdings.css";
import "./alloc.css";

/** 리밸런싱 결과 아래 묶음별 세금 안내 */
const NOTES = {
  BROKERAGE: "위탁 계좌에서 해외주식을 팔면 연간 양도차익 250만원을 넘는 부분에 22%가 과세됩니다. 세금이 부담되면 '매수만'으로 맞추세요.",
  ISA: "ISA 안의 매매는 손익을 합산해 비과세 한도(200만원)까지 세금이 없습니다.",
  PENSION_SAVINGS: "연금저축 안에서 사고팔면 세금이 생기지 않고 인출할 때까지 미뤄집니다.",
  CRYPTO: "가상자산 매매 차익은 현재 비과세입니다(과세 시행 전).",
  RETIREMENT: "퇴직연금 안의 매매는 과세가 이연됩니다. 위험자산은 70%까지만 담을 수 있습니다.",
};
const fmtP = (v) => (Math.round(v * 10) / 10).toLocaleString("ko-KR", { maximumFractionDigits: 1 }) + "%";
const fmtPP = (v) => sgn(v, 1) + Math.abs(v).toFixed(1) + "%p";
const near100 = (v) => Math.abs(v - 100) < 0.05;
const num = (s) => +String(s).replace(/[^\d.]/g, "") || 0;

/** 목표 대비 행 — rows [{ name, cur, tgt, band, out }]. 이름 | 트랙(허용 범위 띠 · 목표 눈금 · 현재 점) | 현재 / 목표. 축은 맨 아래 한 번 */
function TargetRows({ rows }) {
  const mx = Math.max(40, Math.ceil(Math.max(...rows.map((r) => Math.max(r.cur, r.tgt + r.band))) / 10) * 10);
  const cl = (v) => Math.min(mx, Math.max(0, v));
  const pc = (v) => `${(cl(v) / mx) * 100}%`;
  return (
    <div className="cl-tg">
      {rows.map((r) => {
        const diff = r.cur - r.tgt, o = r.out ?? Math.abs(diff) > r.band;
        const lo = r.tgt - r.band, hi = r.tgt + r.band;
        // 범위 밖: 점에서 가까운 범위 끝까지 점선
        const gap = o && r.cur > hi ? [hi, r.cur] : o && r.cur < lo ? [r.cur, lo] : null;
        // 현재 % 라벨은 목표 눈금 반대편에 둔다(겹침 방지). 트랙 양 끝에서는 안쪽으로
        const f = cl(r.cur) / mx, left = f > 0.88 || (f >= 0.12 && r.cur < r.tgt);
        return (
          <div className={`cl-tg-row${o ? " cl-out" : ""}`} key={r.name}>
            <span className="cl-tg-nm" title={r.name}>{shortName(r.name)}</span>
            <div className="cl-tg-trk" role="img" aria-label={`${r.name} 현재 ${r.cur.toFixed(1)}%, 목표 ${fmtP(r.tgt)}, 허용 ±${fmtP(r.band)}${o ? `, 범위 밖 ${fmtPP(diff)}` : ""}`}>
              <i className="cl-tg-groove" />
              <i className="cl-tg-band" style={{ left: pc(lo), width: `calc(${pc(hi)} - ${pc(lo)})` }} />
              {gap && <i className="cl-tg-gap" style={{ left: pc(gap[0]), width: `calc(${pc(gap[1])} - ${pc(gap[0])})` }} />}
              <i className="cl-tg-tick" style={{ left: pc(r.tgt) }} />
              <i className="cl-tg-dot" style={{ left: pc(r.cur) }} />
              <span className={`cl-tg-lbl cl-num${left ? " cl-l" : ""}`} style={{ left: pc(r.cur) }} aria-hidden="true">{r.cur.toFixed(1)}%</span>
            </div>
            <span className="cl-tg-v cl-num"><b>{r.cur.toFixed(1)}%</b> / {fmtP(r.tgt)}{o && <span className="cl-tg-tag" title={`목표와 ${fmtPP(diff)}`}>범위 밖</span>}</span>
          </div>
        );
      })}
      <div className="cl-tg-axis cl-num" aria-hidden="true">
        <span className="cl-tg-scale"><span>0%</span><span>{mx / 2}%</span><span>{mx}%</span></span>
        <span className="cl-n">현재 / 목표</span>
      </div>
    </div>
  );
}

const rowsOf = (d) => (d?.categories || []).map((c) => ({ name: c.category_name, cur: c.current_ratio_pct, tgt: c.target_ratio_pct, band: c.band_pp, out: c.in_band === false }));
const outCount = (d) => (d?.categories || []).filter((c) => c.in_band === false).length;

/** 관리 묶음 탭 — list = 묶음 상세, flag(묶음) 이 참이면 점 배지 */
function ScopeTabs({ list, value, onChange, flag }) {
  return <Underline items={list.map((d) => [d.scope_code, nameOf(d)])} value={value} onChange={onChange}
    flag={flag && ((k) => flag(list.find((d) => d.scope_code === k)))} />;
}

/** 납입 차트 목표 { goal, field } — 연금저축+IRP 합산 목표만(없으면 null). field = /goals/monthly 의 같은 범위 열.
 *  다른 목표는 범위가 monthly 값과 달라 숫자가 어긋나므로 쓰지 않는다 */
function contribGoal(goals) {
  const pen = goals.find((x) => x.key === "PENSION_IRP_TOTAL") || goals.find((x) => x.scope_kind === "account_type" && /IRP/.test(x.scope_value || ""));
  return pen ? { goal: pen, field: "pension_krw" } : null;
}

/** 납입 — 누적 납입 계단 선 + 균등 페이스 + 한도 · 아래 납입 목표 막대 */
function Deposits() {
  const q = useQuery({ queryKey: ["goals-monthly"], queryFn: () => api.get("/goals/monthly") });
  const g = useGoals();
  const asOf = g.data?.as_of ? String(g.data.as_of).slice(0, 10) : null;
  const year = g.data?.year || q.data?.year;
  const pick = contribGoal(g.data?.goals || []);
  const rows = (q.data?.rows || []).map((r) => ({ month: r.month, v: pick ? r[pick.field] || 0 : 0 }));
  const target = pick?.goal.target_krw || 0;
  // 머리 숫자·남은 금액은 GoalBars 와 같은 goal.actual_krw. 선만 월별 합
  const paid = pick?.goal.actual_krw ?? rows.filter((r) => !asOf || r.month <= asOf.slice(0, 7)).reduce((a, r) => a + r.v, 0);
  const left = Math.max(0, target - paid), n = asOf ? monthsLeft(asOf) : 1;
  const label = pick ? `${year}년 ${pick.goal.label} 누적 납입 ${krw(paid)}, 한도 ${krw(target)}` : "누적 납입";
  const ref = useChart((host, W) => drawContrib(host, W, { year, asOf, rows, target, label }), [q.data, g.data]);
  const busy = q.isLoading || g.isLoading, err = q.isError ? q : g.isError ? g : null;
  return (
    <div className="cl-panel">
      <div className="cl-panel-head">
        <h2>납입</h2>
        {pick && !busy && <span className="cl-ctb-fig cl-num"><b>{krw(paid)}</b> / {krw(target)}</span>}
        {pick && <span className="cl-sub cl-num">{year} · {pick.goal.label}</span>}
      </div>
      {busy ? <Loading /> : err ? <Failed q={err} what="납입" /> : !pick ? <p className="cl-goal-note">납입 목표 없음</p> : (
        <>
          <div className="cl-chart" ref={ref} />
          <div className="cl-ctb-leg cl-num">
            <span><i className="cl-ctb-k-line" />누적 납입</span>
            <span><i className="cl-ctb-k-pace" />균등 페이스</span>
            <span><i className="cl-ctb-k-cap" />한도</span>
            <span>{left > 0 ? `남은 ${krw(left)} · 월 ${krw(left / n)} × ${n}` : "한도 채움"}</span>
          </div>
        </>
      )}
      <div className="cl-panel-head" style={{ marginTop: 28 }}><h2>납입 목표</h2></div>
      <GoalBars />
    </div>
  );
}

/** 쏠림 규칙 id → [이름, 이유(null 이면 서버 detail)] */
const RULE_TEXT = {
  UNMANAGED_ASSETS: ["목표 밖 자산", "목적자금·유동성처럼 일부러 뺀 자산 포함. 목표가 없으면 리밸런싱에서 빠집니다."],
  TOP5_CONCENTRATION: ["상위 5종목", "상위 5종목이 클수록 나머지 종목의 분산 효과가 작아집니다."],
  SINGLE_POSITION: ["최대 종목", null],
  EFFECTIVE_N: ["실질 종목 수", null],
  SINGLE_ACCOUNT: ["최대 계좌", "한 계좌에 몰리면 금융사 장애·세제 변화에 한꺼번에 묶입니다."],
  FX_EXPOSURE: ["외화 비중", "환율이 1% 움직이면 이 비중의 1%만큼 총자산이 함께 움직입니다."],
};
/** 판정 → [글자, 상태 클래스] */
const VERDICT = { pass: ["정상", " cl-ok"], caution: ["주의", " cl-cau"], warn: ["경고", " cl-out"], unknown: ["—", ""] };
/** 쏠림 점검 — /risk/xray 규칙 표(전체 자산). 행을 펼치면 이유 한 줄(터치에서도 읽히게 툴팁에 두지 않는다) */
function Concentration() {
  const q = useXray();
  const loc = useLocation();
  const [open, setOpen] = useState(() => new Set());
  useEffect(() => {
    if (q.data && loc.hash === "#concentration") document.getElementById("concentration")?.scrollIntoView({ block: "start" });
  }, [q.data, loc.hash, loc.key]);
  const fmt = (r, v) => `${Number(v).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}${r.unit || (r.id === "EFFECTIVE_N" ? "개" : "")}`;
  const toggle = (id) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <div className="cl-panel" id="concentration">
      <div className="cl-panel-head"><h2>쏠림 점검</h2><span className="cl-sub">전체 자산 · 기준 일반값</span></div>
      {q.isLoading ? <Loading /> : q.isError ? <Failed q={q} what="쏠림 점검" /> : !(q.data?.rules || []).length ? <p className="cl-goal-note">쏠림 점검 없음</p> : (
        <table className="cl-xr">
          <thead><tr><th>규칙</th><th className="cl-n">현재</th><th className="cl-n">기준</th><th>판정</th></tr></thead>
          <tbody>
            {q.data.rules.map((r) => {
              const [name, why] = RULE_TEXT[r.id] || [r.label, r.detail];
              const op = r.id === "EFFECTIVE_N" ? "≤" : "≥";
              const [vl, vc] = VERDICT[r.verdict] || VERDICT.unknown;
              const detail = why || (r.id === "SINGLE_POSITION" ? `${shortName(r.detail)} · 이 종목이 10% 빠지면 전체가 약 ${(r.value / 10).toFixed(1)}% 빠집니다.` : r.detail);
              const on = open.has(r.id);
              return (
                <Fragment key={r.id}>
                  <tr className={`cl-xr-row${on ? " cl-on" : ""}`} onClick={() => toggle(r.id)}>
                    <td className="cl-xr-nm"><button type="button" aria-expanded={on} aria-controls={`xr-${r.id}`} onClick={(e) => { e.stopPropagation(); toggle(r.id); }}>
                      <svg className={`cl-chev${on ? " cl-open" : ""}`} viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>{name}</button></td>
                    <td className="cl-n cl-xr-v">{r.value == null ? "—" : fmt(r, r.value)}</td>
                    <td className="cl-n cl-xr-b">{r.threshold ? `${op}${fmt(r, r.threshold.caution)}` : "—"}</td>
                    <td><span className={`cl-state${vc}`}><i />{vl}</span></td>
                  </tr>
                  {on && (
                    <tr className="cl-xr-why" id={`xr-${r.id}`}><td colSpan={4}>
                      {detail}{r.threshold && <span className="cl-num"> · 주의 {op}{fmt(r, r.threshold.caution)} · 경고 {op}{fmt(r, r.threshold.warn)}</span>}
                    </td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** 범위 밖 조정 방향 한 줄 — d = 묶음 상세. 예 '해외주식 −355만 → 국내주식 · 채권'.
    trade_krw = 목표까지 되돌릴 금액(+매수 · −매도), 반대편 = 목표와 반대쪽으로 벗어난 범위 안 카테고리 */
function OutSummary({ d }) {
  const cats = d.categories || [];
  const outs = cats.filter((c) => c.in_band === false);
  const moves = outs.filter((c) => Math.abs(c.trade_krw || 0) >= 1e4);
  if (!moves.length) return <b>범위 밖 {outs.length}</b>;
  const sells = moves.every((c) => c.trade_krw < 0), buys = moves.every((c) => c.trade_krw > 0);
  const other = cats.filter((c) => c.in_band !== false && (sells ? c.deviation_pct > 0 : buys ? c.deviation_pct < 0 : false)).map((c) => shortName(c.category_name));
  const head = moves.map((c) => `${shortName(c.category_name)} ${sKrw(c.trade_krw)}`).join(" · ");
  if (!other.length) return <b>{head}</b>;
  // 반대편이 셋 이상이면 개수만 — 한 줄을 넘기지 않는다
  const tail = other.length > 2 ? `나머지 ${other.length}` : other.join(" · ");
  return <><b>{head}</b> {sells ? "→" : "←"} {tail}</>;
}

/** 목표 관리 묶음 카드 — 이름 · 금액(ev(묶음)) · 범위 상태. 누르면 onChange(scope_code) */
function ScopeCards({ list, value, onChange, ev }) {
  return (
    <div className="cl-sc-cards" role="group" aria-label="목표 관리 묶음">
      {list.map((x) => {
        const oc = outCount(x);
        return (
          <button key={x.scope_code} type="button" className="cl-sc-card" aria-pressed={value === x.scope_code} onClick={() => onChange(x.scope_code)}>
            <span className="cl-sc-top"><b className="cl-sc-nm">{nameOf(x)}</b>{oc > 0 && <span className="cl-tg-tag">범위 밖 {oc}</span>}</span>
            <span className="cl-sc-v cl-num">{krw(ev(x))}{oc ? "" : " · 범위 안"}</span>
          </button>
        );
      })}
    </div>
  );
}

/** 목표 대비 탭 — 선택 묶음의 목표 대비 행 · 리밸런싱 바로가기 + 쏠림 점검. all = 전체 묶음, managed = 목표 있는 묶음 */
function Status({ all, managed, scope, setScope, nav }) {
  const d = managed.find((x) => x.scope_code === scope);
  // total_krw 는 비중 분모라 대기 현금(RP 등)을 뺀 값 — 묶음 평가는 대기 현금을 더해 보인다
  const ev = (x) => (x.total_krw || 0) + (x.mode === "categories" ? x.cash_krw || 0 : 0);
  // 목표 없는 묶음은 카드 대신 한 줄
  const free = all.filter((x) => !managed.includes(x));
  const freeT = free.reduce((a, x) => a + ev(x), 0);
  return (
    <div className="cl-alloc-pair">
      {d ? (
        <div className="cl-panel">
          <div className="cl-panel-head"><h2>목표 대비</h2><button type="button" className="cl-btn-text" onClick={() => nav("settings", d.scope_code)}>목표 설정 ›</button><span className="cl-sub cl-num">{nameOf(d)} {krw(d.total_krw)}{d.cash_krw > 0 ? " · 대기 현금 제외" : ""} · 범위 밖 {outCount(d)}</span></div>
          <ScopeCards list={managed} value={d.scope_code} onChange={setScope} ev={ev} />
          {free.length > 0 && <p className="cl-sc-free cl-num">목표 없음 {free.length} · {free.map(nameOf).join(" · ")} · {krw(freeT)}</p>}
          <TargetRows rows={rowsOf(d)} />
          {outCount(d) > 0 && (
            <div className="cl-rebal-cta">
              <span className="cl-rebal-sum cl-num"><OutSummary d={d} /></span>
              <button type="button" className="cl-btn" onClick={() => nav("rebal", d.scope_code)}>리밸런싱 계산</button>
            </div>
          )}
          {d.cash_krw > 0 && <p className="cl-goal-note cl-num" style={{ marginTop: 10 }}>대기 현금(RP 등) {krw(d.cash_krw)} · 목표 밖, 비중 계산 제외</p>}
          {d.unmapped_krw > 0.5 && <p className="cl-goal-note cl-num" style={{ marginTop: 10 }}>미분류 종목 {krw(d.unmapped_krw)} · 분모에 포함, 비중 합 100% 미만</p>}
        </div>
      ) : <div className="cl-panel"><div className="cl-panel-head"><h2>목표 대비</h2></div><p className="cl-goal-note">목표 관리 묶음 없음</p></div>}
      <Concentration />
    </div>
  );
}

/** 목표 비중 입력 − 값 + (0.5%p 단위). onType = 입력 중 글자 그대로, onSet = 맞춘 값으로 확정(벗어날 때·버튼·화살표) */
function Stepper({ name, value, onSet, onType }) {
  const v = +value || 0;
  return (
    <span className="cl-step">
      <button type="button" aria-label={`${name} 0.5%p 내리기`} disabled={v <= 0} onClick={() => onSet(v - 0.5)}>−</button>
      <input type="text" inputMode="decimal" value={value ?? 0} aria-label={`${name} 목표 비중(%)`} onChange={(e) => onType(e.target.value)} onBlur={(e) => onSet(e.target.value)}
        onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); onSet(num(e.currentTarget.value) + (e.key === "ArrowUp" ? 0.5 : -0.5)); } }} />
      <span className="cl-step-u" aria-hidden="true">%</span>
      <button type="button" aria-label={`${name} 0.5%p 올리기`} disabled={v >= 100} onClick={() => onSet(v + 0.5)}>+</button>
    </span>
  );
}

/** 목표 설정 탭 — 선택 묶음의 카테고리 목표 비중 편집 · 저장 */
function Settings({ managed, scope, setScope }) {
  const qc = useQueryClient();
  const d = managed.find((x) => x.scope_code === scope);
  const saved = useMemo(() => Object.fromEntries((d?.categories || []).map((c) => [c.category_id, c.target_ratio_pct])), [d]);
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(saved), [saved]);
  const save = useMutation({
    mutationFn: () => api.put(`/allocation/${d.scope_code}/targets`, { targets: Object.entries(draft).map(([k, v]) => ({ category_id: +k, target_ratio_pct: +v || 0 })) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alloc"] }),
  });
  if (!d) return <p className="cl-goal-note">목표 관리 묶음 없음</p>;
  const sum = Object.values(draft).reduce((a, b) => a + (num(b) || 0), 0);
  const dirty = Object.keys(saved).some((k) => num(draft[k]) !== saved[k]);
  const set = (id, v) => setDraft((x) => ({ ...x, [id]: Math.min(100, Math.max(0, Math.round(num(v) * 2) / 2)) }));
  const fit = () => {
    const ids = Object.keys(draft), diff = 100 - sum;
    let k = ids.reduce((a, b) => (num(draft[b]) > num(draft[a]) ? b : a));
    if (diff < 0 && num(draft[k]) + diff < 0) k = ids.find((x) => num(draft[x]) + diff >= 0) || k;
    set(k, num(draft[k]) + diff);
  };
  const ok = near100(sum);
  let msg;
  if (save.isPending) msg = "저장 중";
  else if (save.isError) msg = `저장 실패 · ${save.error.message}`;
  else if (!ok) msg = <>합계 <b>{fmtP(sum)}</b> · 100%일 때 저장</>;
  else if (dirty) msg = <><b>저장 안 한 변경</b> · 저장하면 목표 대비·홈 점검에 반영</>;
  else msg = save.isSuccess ? <><b>저장됨</b> · {nameOf(d)} 목표</> : <>{nameOf(d)} 현재 목표</>;
  return (
    <div className="cl-stack">
      <div className="cl-panel">
        <div className="cl-panel-head"><h2>목표 설정</h2><span className="cl-sub cl-num">{nameOf(d)} · 허용 {d.band_rule || "5/25"} · 0.5%p 단위</span></div>
        <ScopeTabs list={managed} value={d.scope_code} onChange={(s) => { setScope(s); save.reset(); }} />
        <div className="cl-st-rows">
          <div className="cl-st-row cl-st-head" aria-hidden="true"><span>항목</span><span>목표</span><span className="cl-n">현재</span></div>
          {d.categories.map((c) => (
            <div className="cl-st-row" key={c.category_id}>
              <span className="cl-st-nm" title={c.category_name}>{shortName(c.category_name)}</span>
              <Stepper name={c.category_name} value={draft[c.category_id]} onSet={(v) => set(c.category_id, v)} onType={(v) => setDraft((x) => ({ ...x, [c.category_id]: v }))} />
              <span className="cl-st-cur cl-num">{c.current_ratio_pct.toFixed(1)}%</span>
            </div>
          ))}
        </div>
        <div className="cl-st-sum">
          <div className="cl-st-sumtop cl-num">
            <span>합계 <b>{fmtP(sum)}</b>{!ok && <span className="cl-tg-tag">{sum < 100 ? `${fmtP(100 - sum)} 남음` : `${fmtP(sum - 100)} 초과`}</span>}</span>
            {!ok && <button type="button" className="cl-btn-text" onClick={fit}>100%로 맞추기</button>}
          </div>
          <div className={`cl-st-bar${sum > 100.05 ? " cl-over" : ""}`} role="img" aria-label={`합계 ${fmtP(sum)}`}><i style={{ width: `${Math.min(100, sum)}%` }} /></div>
        </div>
      </div>
      <div className="cl-savebar" role="region" aria-label="저장">
        <p className="cl-st">{msg}</p>
        <button className="cl-btn-ghost" type="button" disabled={!dirty || save.isPending} onClick={() => { setDraft(saved); save.reset(); }}>되돌리기</button>
        <button className="cl-btn" type="button" disabled={!dirty || !ok || save.isPending} onClick={() => save.mutate()}>목표 저장</button>
      </div>
    </div>
  );
}

/** 납입·리밸런싱 계산 결과 표 + 계획 저장. res = 계산 응답 */
function PlanResult({ res, scope, mode, amount, onCommitted }) {
  const commit = useMutation({ mutationFn: () => api.post(`/allocation/${scope}/plan/commit`, { mode, amount_krw: amount, result: res }), onSuccess: onCommitted });
  const totalAfter = res.total_krw + (res.buy_total_krw || 0) + (res.sell_total_krw || 0); // sell_total 은 음수
  return (
    <>
      <div className="cl-kpis">
        <span>묶음 평가 <b>{won(res.total_krw)}원</b></span>
        <span>매수 합계 <b>{won(res.buy_total_krw)}원</b></span>
        <span>매도 합계 <b>{won(res.sell_total_krw)}원</b></span>
        {res.external_cash_needed_krw > 0 && <span>필요한 입금 <b>{won(res.external_cash_needed_krw)}원</b></span>}
        {mode === "REBALANCE" && <span>밴드 이탈 <b>{res.breach_count}건</b></span>}
      </div>
      {mode === "REBALANCE" && !res.triggered && <p className="cl-goal-note" style={{ marginTop: 8 }}>모두 범위 안 · 아래는 목표로 되돌릴 때의 계산</p>}
      <div className="cl-tscroll" style={{ marginTop: 12 }}><table className="cl-trades cl-m">
        <thead><tr><th>카테고리</th><th className="cl-n">현재 금액</th><th className="cl-n">현재</th><th className="cl-n">매매</th><th className="cl-n">이후</th><th className="cl-n">목표</th></tr></thead>
        <tbody>
          {res.categories.map((c) => {
            const signed = c.amount_krw || 0; // API 가 부호를 붙여 준다(+매수 · −매도)
            const after = totalAfter ? ((c.current_amount_krw + signed) / totalAfter) * 100 : 0;
            return (
              <Fragment key={c.category_id}>
                <tr style={{ cursor: "default" }}>
                  <td className="cl-s-nm">{shortName(c.category_name)}</td><td className="cl-n cl-s-sub">{won(c.current_amount_krw)}</td><td className="cl-n cl-s-meta">{c.current_ratio_pct.toFixed(1)}%<span className="cl-m-only"> → {after.toFixed(1)}% (목표 {fmtP(c.target_ratio_pct)})</span></td>
                  <td className="cl-n cl-s-v">{signed > 0 ? <b className="cl-buy">매수 {won(signed)}</b> : signed < 0 ? <b className="cl-sell">매도 {won(-signed)}</b> : <span style={{ color: "var(--muted)" }}>없음</span>}</td>
                  <td className="cl-n cl-m-hide">{after.toFixed(1)}%</td><td className="cl-n cl-m-hide" style={{ color: "var(--muted)" }}>{fmtP(c.target_ratio_pct)}</td>
                </tr>
                {(c.products || []).length > 0 && (
                  <tr className="cl-drill"><td colSpan={6}>
                    {c.products.map((p) => <div className="cl-prod" key={p.product_code}><span>{p.product_name} · {p.side === "SELL" ? "매도" : "매수"} {p.quantity}주{p.quantity ? ` (1주 약 ${won(p.amount_krw / p.quantity)}원)` : ""}</span><span>{won(p.amount_krw)}원</span></div>)}
                  </td></tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table></div>
      {NOTES[scope] && <p className="cl-mini-note" style={{ marginTop: 12 }}>{NOTES[scope]}</p>}
      <div className="cl-calc" style={{ marginTop: 12 }}>
        <button className="cl-btn-ghost" type="button" disabled={commit.isPending || commit.isSuccess} onClick={() => commit.mutate()}>{commit.isSuccess ? "저장했습니다" : "이 계획 저장"}</button>
        {commit.isError && <span className="cl-mini-note">저장하지 못했습니다: {commit.error.message}</span>}
      </div>
    </>
  );
}

/** 지난 계획 — 묶음의 저장한 계획 최근 20건 */
function History({ scope }) {
  const q = useQuery({ queryKey: ["alloc-history", scope], queryFn: () => api.get(`/allocation/${scope}/history`) });
  const rows = q.data?.rows || [];
  return (
    <div className="cl-panel">
      <div className="cl-panel-head"><h2>지난 계획</h2><span className="cl-sub">최근 20건</span></div>
      {q.isLoading ? <Loading /> : q.isError ? <Failed q={q} what="지난 계획" /> : rows.length === 0 ? <p className="cl-goal-note">지난 계획 없음</p> : (
        <div className="cl-tscroll"><table className="cl-m">
          <thead><tr><th>날짜</th><th>방식</th><th className="cl-n">넣은 금액</th><th className="cl-n">매수</th><th className="cl-n">매도</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.run_id} style={{ cursor: "default" }}><td className="cl-n cl-s-nm" style={{ textAlign: "left" }}>{String(r.insert_datetime || r.run_date).slice(0, 10)}</td><td className="cl-s-meta">{r.mode === "REBALANCE" ? "리밸런싱" : r.mode === "CONTRIBUTE" ? "납입" : r.mode}</td>
              <td className="cl-n cl-s-v">{won(r.input_amount)}</td><td className="cl-n cl-s-sub"><span className="cl-m-only">매수 </span>{won(r.buy_total_krw)}<span className="cl-m-only"> · 매도 {won(r.sell_total_krw)}</span></td><td className="cl-n cl-m-hide">{won(r.sell_total_krw)}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}

/** 납입 배분(CONTRIBUTE) · 리밸런싱(REBALANCE) 계산기 — 묶음·옵션이 바뀌면 바로 다시 계산 */
function Planner({ managed, mode, scope: sel, setScope }) {
  const qc = useQueryClient();
  const [amt, setAmt] = useState(mode === "CONTRIBUTE" ? "1,000,000" : "0");
  const [sell, setSell] = useState(true);
  const plan = useMutation({ mutationFn: (body) => api.post(`/allocation/${sel}/plan`, body) });
  const run = (e) => {
    e?.preventDefault();
    const a = num(amt);
    setAmt(a.toLocaleString("ko-KR"));
    plan.mutate({ mode, amount_krw: a, allow_sell: mode === "REBALANCE" ? sell : false });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (sel) run(); }, [sel, sell]);
  return (
    <div className="cl-stack">
      <div className="cl-panel">
        <div className="cl-panel-head">
          <h2>{mode === "CONTRIBUTE" ? "납입 배분" : "리밸런싱"}</h2>
          <span className="cl-sub">{mode === "CONTRIBUTE" ? "매수만 · 저장한 목표 기준" : "묶음 안에서만 매매"}</span>
        </div>
        <ScopeTabs list={managed} value={sel} onChange={setScope} flag={(x) => outCount(x) > 0} />
        <form className="cl-opts" onSubmit={run}>
          {mode === "REBALANCE" && (
            <>
              <label className="cl-radio"><input type="radio" name="rmode" checked={sell} onChange={() => setSell(true)} />매도 포함 (목표에 맞춤)</label>
              <label className="cl-radio"><input type="radio" name="rmode" checked={!sell} onChange={() => setSell(false)} />매수만 (추가 납입으로 맞춤)</label>
            </>
          )}
          <label className="cl-field">{mode === "CONTRIBUTE" ? "넣을 금액 (원)" : "추가 납입 (원)"}<input type="text" inputMode="numeric" value={amt} onChange={(e) => setAmt(e.target.value)} /></label>
          <button className="cl-btn" type="submit">{mode === "CONTRIBUTE" ? "계획 만들기" : "계산"}</button>
        </form>
        {plan.isPending ? <Loading /> : plan.isError ? <div className="cl-err" style={{ marginTop: 12 }}>{plan.error.message}</div> :
          plan.data ? <PlanResult res={plan.data} scope={sel} mode={mode} amount={num(amt)} onCommitted={() => qc.invalidateQueries({ queryKey: ["alloc-history", sel] })} /> : null}
      </div>
      {sel && <History scope={sel} />}
    </div>
  );
}

export default function Allocation() {
  const [sp, setSp] = useSearchParams();
  const { hash } = useLocation();
  // #concentration → 목표 대비 탭(쏠림 점검), #ledger → 납입 탭(입출금 내역)
  const tab = hash === "#ledger" ? "contrib" : hash !== "#concentration" && ["status", "settings", "contrib", "rebal"].includes(sp.get("tab")) ? sp.get("tab") : "status";
  const { scopes, details } = useAllocations();
  const loading = scopes.isLoading || details.some((d) => d.isLoading);
  const failed = scopes.isError ? scopes : details.find((d) => d.isError);
  const all = details.map((d) => d.data).filter(Boolean);
  const managed = all.filter((d) => d.mode === "categories" && d.categories?.length);
  // 선택 묶음 = ?scope= → 범위 밖이 있는 첫 묶음 → 첫 묶음. 모든 탭이 이 값 하나를 쓴다
  const scope = (managed.some((d) => d.scope_code === sp.get("scope")) && sp.get("scope")) || managed.find((d) => outCount(d))?.scope_code || managed[0]?.scope_code;
  const nav = (t, s) => setSp(() => { const n = new URLSearchParams(); if (t !== "status") n.set("tab", t); if (s) n.set("scope", s); return n; }, { replace: true });
  const setScope = (s) => nav(tab, s);
  const outN = managed.reduce((a, d) => a + outCount(d), 0);
  const sc = { managed, scope, setScope };
  return (
    <section>
      <div className="cl-page-head"><div><h1>배분</h1>{!loading && !failed && <p className="cl-num">묶음 {managed.length} · 범위 밖 {outN}</p>}</div></div>
      <Tabs className="cl-subtabs" items={[["status", "목표 대비"], ["settings", "목표 설정"], ["contrib", "납입"], ["rebal", "리밸런싱"]]} value={tab} onChange={(t) => nav(t, scope)} />
      {loading ? <Loading /> : failed ? <Failed q={failed} what="배분 정보" /> :
        tab === "status" ? <Status all={all} {...sc} nav={nav} /> :
        tab === "settings" ? <Settings {...sc} /> :
        tab === "contrib" ? <div className="cl-stack"><Deposits /><Planner key={tab} {...sc} mode="CONTRIBUTE" /><div className="cl-panel" id="ledger"><Ledger /></div></div> :
        <Planner key={tab} {...sc} mode="REBALANCE" />}
    </section>
  );
}
