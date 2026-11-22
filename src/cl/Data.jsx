/* 데이터 화면 — 하위 탭 수기 입력(기본) · 흐름(?tab=lineage, Lineage.jsx).
   수기 입력: 수기 계좌(IRP·DC 펀드, 적금·청약) 원장 입력 → 확인 창 → Airflow DAG 실행 → 단계별 진행 · 입력 내역. 원천은 /manual-entry.
   덮어쓰기·과거 날짜·이후 기록 조정은 계좌 원장 목록(ledger)으로 Airflow 와 같은 규칙을 미리 적용해 보여 준다.
   ?account=<id> 로 오면 그 계좌를 고른 채 연다(납입 목표·입출금 내역·신뢰 상세에서 오는 링크). */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { Failed, Loading } from "./Shell.jsx";
import { EmptyState, PeriodSeg, ScopeTabs, Tabs } from "./parts.jsx";
import Lineage, { LineageStamp, LineageSub } from "./Lineage.jsx";
import { useManualEntry } from "../lib/queries.js";
import { md, won } from "./format.js";
import "./data.css";

const STEP_GLYPH = { success: "✓", skipped: "–", failed: "✕", upstream_failed: "–", running: "…", queued: "…" };
/** 결과 → [꼬리표, 한 줄]. partial 의 한 줄은 실패 단계로 정한다(partialText) */
const OUTCOME = {
  running: ["진행 중", ""],
  success: ["완료", ""],
  rejected: ["검증 실패", "원장 변경 없음"],
  partial: ["일부 실패", ""],
  failed: ["실패", "저장 실패"],
};
const FAILED_STEP = { rebuild_from_ledger: "재계산", refresh_dashboard_views: "화면 반영", report_entry: "알림" };
const partialText = (step) => `저장됨 · ${FAILED_STEP[step] || "후속 단계"} 실패`;
/** 결과 꼬리표 — 끝났는데 완료가 아니면 진하게 */
const Tag = ({ outcome }) => (
  <span className={`cl-tag cl-me-tag${outcome !== "success" && outcome !== "running" ? " cl-me-tag-x" : ""}`}>{(OUTCOME[outcome] || OUTCOME.running)[0]}</span>
);
const BLOCK = ["06:50", "07:30"];   // 정기 적재 시간 (KST) — 저장은 서버가 다시 막는다
/** 예적금 입력 방식 */
const CASH_MODES = [["deposit", "납입액"], ["total", "총 납입액"]];
/** 쉼표·공백 허용 숫자 입력 → 숫자 | null(빈 칸) | NaN(잘못된 값) */
const num = (s) => {
  const t = String(s ?? "").replace(/[,\s]/g, "");
  return t === "" ? null : Number(t);
};
/** 지금(KST) ISO 문자열 — 날짜 [0,10), 시각 [11,16) */
const kstNow = () => new Date(Date.now() + 9 * 36e5).toISOString();
const todayKst = () => kstNow().slice(0, 10);
/** 요청 id(UUID v4). randomUUID 는 HTTPS·localhost 에서만 있어 평문 HTTP 는 getRandomValues 로 만든다 */
const newId = () => crypto.randomUUID?.() ?? "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
  (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
const qtyText = (q) => `${q.toLocaleString("ko-KR", { maximumFractionDigits: 8 })}좌`;
/** 정기 적재 시간이면 안내 문구 — 30초마다 다시 본다 */
function useBlocked() {
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    const tick = () => { const t = kstNow().slice(11, 16); setMsg(t >= BLOCK[0] && t < BLOCK[1] ? `${BLOCK[0]}~${BLOCK[1]} 정기 적재 중에는 저장할 수 없습니다` : null); };
    tick();
    const id = setInterval(tick, 30e3);
    return () => clearInterval(id);
  }, []);
  return msg;
}

/** 내역 행 요약 — 납입 / 총 납입액 / 좌수·납입원금 */
function confText(c) {
  if (!c) return "—";
  if (c.deposit_amount != null) return `납입 ${won(c.deposit_amount)}원`;
  if (c.holding_quantity != null) return `${qtyText(c.holding_quantity)} · ${won(c.total_purchase_amount)}원`;
  return `총 납입액 ${won(c.total_purchase_amount)}원`;
}

/** 총 납입액 변동 — 문구 `+27.8%` · 크게 변동(감소 또는 ±50% 초과) 여부. 직전이 0 이하면 비율 없음 */
const BIG_CHANGE = 0.5;
function totalChange(old, next) {
  if (next == null || Number.isNaN(next) || next === old) return { text: "", big: false };
  const pct = old > 0 ? (next - old) / old : null;
  const text = pct == null ? "" : `${pct > 0 ? "+" : "−"}${(Math.abs(pct) * 100).toFixed(1)}%`;
  return { text, big: next < old || (pct != null && Math.abs(pct) > BIG_CHANGE) };
}

function Field({ label, hint, value, onChange, id }) {
  return (
    <label className="cl-field cl-me-f" htmlFor={id}>{label}
      <input id={id} type="text" inputMode="decimal" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="cl-me-hint">{hint}</span>}
    </label>
  );
}

/** 최종 확인 창 — 저장할 값을 다시 보여 주고 '저장'을 눌러야 Airflow 를 실행한다.
 *  처음 초점 = 취소(덜 위험한 쪽), Tab 은 창 안에서 돈다, Esc·바깥 누름 = 취소, 닫히면 초점은 폼의 저장 버튼으로 */
function ConfirmDialog({ rows, notes, alerts, onCancel, onConfirm }) {
  const ref = useRef(null);
  const tid = useId();
  useEffect(() => {
    const opener = document.activeElement;
    ref.current?.querySelector("button")?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      if (e.key !== "Tab") return;
      const bs = [...ref.current.querySelectorAll("button")];
      const i = bs.indexOf(document.activeElement);
      e.preventDefault();
      bs[(i + (e.shiftKey ? bs.length - 1 : 1)) % bs.length].focus();
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); opener?.focus?.(); };
  }, [onCancel]);
  return (
    <div className="cl-me-dlg-bg" onClick={onCancel}>
      <div className="cl-me-dlg" role="alertdialog" aria-modal="true" aria-labelledby={tid} ref={ref} onClick={(e) => e.stopPropagation()}>
        <h2 id={tid}>확인</h2>
        <dl className="cl-me-dlg-rows">
          {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="cl-num">{v}</dd></div>)}
        </dl>
        {alerts.map((n) => <p key={n} className="cl-me-warn cl-me-warn-x" role="alert">{n}</p>)}
        {notes.map((n) => <p key={n} className="cl-me-warn">{n}</p>)}
        <div className="cl-me-dlg-btns">
          <button type="button" className="cl-btn-ghost" onClick={onCancel}>취소</button>
          <button type="button" className="cl-btn" onClick={onConfirm}>저장</button>
        </div>
      </div>
    </div>
  );
}

function EntryForm({ acct, disabled, pending, onSubmitted }) {
  const fund = acct.kind === "fund";
  const [day, setDay] = useState(todayKst);
  const [v, setV] = useState({ qty: "", total: "", evaluation: "", deposit: "" });
  const [mode, setMode] = useState("deposit");   // 예적금: 납입액 | 총 납입액
  const direct = mode === "total";
  const [backdate, setBackdate] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);   // 확인 창에 띄운 { body, rows, notes }
  const rid = useRef(null);   // 같은 입력을 다시 보내면 같은 id → run 은 하나
  if (rid.current === null) rid.current = newId();

  const set = (k) => (x) => { setV((o) => ({ ...o, [k]: x })); rid.current = newId(); setErr(null); };
  // Airflow check_ledger_date 와 같은 규칙: 기존 날짜 = 덮어쓰기(정정), 그 밖의 마지막 기록 이전 날짜 = 과거 날짜 확인 필요
  const ledger = acct.ledger || [];
  const exists = ledger.some(([d]) => d === day);
  const past = !exists && acct.last_date && day < String(acct.last_date);
  // 예적금 총 납입액 변화: 직전(그날 미포함) 기록 + 납입액, 기존 = 그날 기록 → 없으면 직전 → 없으면 0 (upsert_cash_ledger 와 같음)
  const before = ledger.filter(([d]) => d < day);
  const prev = before.length ? Number(before[before.length - 1][1]) : 0;
  const old = exists ? Number(ledger.find(([d]) => d === day)[1]) : prev;
  const deposit = num(v.deposit);
  const newTotal = fund ? null : direct ? num(v.total) : deposit > 0 ? prev + deposit : null;
  const later = ledger.filter(([d]) => d > day).length;
  const preview = !pending && newTotal != null && !Number.isNaN(newTotal) ? newTotal : null;
  const change = totalChange(old, preview);

  const cancelConfirm = useCallback(() => setConfirm(null), []);

  /** 폼 제출 → 값 검사 → 확인 창. 실제 전송은 send() */
  function submit(e) {
    e.preventDefault();
    const body = { request_id: rid.current, account_id: acct.account_id, standard_date: day || null, allow_backdate: !!past && backdate };
    if (fund) Object.assign(body, { holding_quantity: num(v.qty), total_purchase_amount: num(v.total), evaluation_amount: num(v.evaluation) });
    else if (direct) body.total_purchase_amount = num(v.total);
    else body.deposit_amount = deposit;
    if (Object.values(body).some((x) => Number.isNaN(x))) return setErr("숫자만 입력하세요");
    const need = fund ? [body.holding_quantity, body.total_purchase_amount] : [direct ? body.total_purchase_amount : body.deposit_amount];
    if (need.some((x) => x == null)) return setErr(fund ? "좌수와 납입원금을 입력하세요" : direct ? "총 납입액을 입력하세요" : "납입액을 입력하세요");
    // 서버·Airflow 가 거절할 값은 확인 창 전에 막는다
    if (fund && (body.holding_quantity <= 0 || body.total_purchase_amount <= 0)) return setErr("좌수와 납입원금은 0보다 커야 합니다");
    if (fund && body.evaluation_amount != null && body.evaluation_amount <= 0) return setErr("평가금액은 0보다 커야 합니다");
    if (!fund && !direct && body.deposit_amount <= 0) return setErr("납입액은 0보다 커야 합니다");
    if (!fund && direct && body.total_purchase_amount < 0) return setErr("총 납입액은 0 이상이어야 합니다");
    const lows = ledger.filter(([d]) => d > day).map(([, t]) => Number(t));
    if (!fund && lows.length && Math.min(...lows) + (newTotal - old) < 0) return setErr("이후 기록의 총 납입액이 음수가 됩니다");
    const chg = fund ? { text: "", big: false } : totalChange(old, newTotal);
    const rows = [["계좌", acct.account_name], [fund ? "결제일" : "납입일", day || todayKst()]];
    if (fund) {
      rows.push(["좌수", qtyText(body.holding_quantity)], ["납입원금", `${won(body.total_purchase_amount)}원`],
        ["평가금액", body.evaluation_amount != null ? `${won(body.evaluation_amount)}원` : "—"]);
    } else {
      if (!direct) rows.push(["납입액", `${won(body.deposit_amount)}원`]);
      rows.push(["총 납입액", `${won(old)} → ${won(newTotal)}원${chg.text ? ` (${chg.text})` : ""}`]);
    }
    const alerts = chg.big ? [`총 납입액이 ${newTotal < old ? "줄어듭니다" : "크게 변동합니다"}${chg.text ? ` (${chg.text})` : ""} — 계좌와 금액이 맞는지 확인하세요`] : [];
    const notes = [];
    if (exists) notes.push(`${md(day)} 기록을 덮어씁니다`);
    if (!fund && later && newTotal !== old) notes.push(`이후 기록 ${later}건 ${newTotal > old ? "+" : "−"}${won(Math.abs(newTotal - old))}원`);
    setErr(null);
    setConfirm({ body, rows, notes, alerts });
  }

  async function send() {
    const { body } = confirm;
    setConfirm(null);
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post("/manual-entry", body);
      rid.current = newId();
      setV({ qty: "", total: "", evaluation: "", deposit: "" });
      setBackdate(false);
      onSubmitted(r.run_id);
    } catch (x) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="cl-me-form" onSubmit={submit} noValidate>
      {!fund && (
        <div className="cl-me-mode">
          <PeriodSeg items={CASH_MODES} value={mode} onChange={(k) => { setMode(k); rid.current = newId(); setErr(null); }} label="입력 방식" />
        </div>
      )}
      <div className="cl-me-grid">
        <label className="cl-field cl-me-f" htmlFor="me-day">{fund ? "결제일" : "납입일"}
          <input id="me-day" type="date" max={todayKst()} value={day} onChange={(e) => { setDay(e.target.value); setBackdate(false); rid.current = newId(); }} />
        </label>
        {fund ? (
          <>
            <Field id="me-qty" label="좌수" value={v.qty} onChange={set("qty")} />
            <Field id="me-total" label="납입원금 (원)" value={v.total} onChange={set("total")} />
            <Field id="me-eval" label="평가금액 (원)" hint="선택 · 검증용" value={v.evaluation} onChange={set("evaluation")} />
          </>
        ) : direct ? (
          <Field id="me-total" label="총 납입액 (원)" value={v.total} onChange={set("total")} />
        ) : (
          <Field id="me-dep" label="납입액 (원)" hint="하루 합계" value={v.deposit} onChange={set("deposit")} />
        )}
      </div>
      {past && (
        <label className="cl-radio cl-me-check">
          <input type="checkbox" checked={backdate} onChange={(e) => setBackdate(e.target.checked)} />
          과거 날짜로 저장 <span className="cl-me-hint">마지막 기록 {md(acct.last_date)} 이전</span>
        </label>
      )}
      {exists && <p className="cl-me-warn" role="note">{md(day)} 기록을 덮어씁니다</p>}
      <div className="cl-me-actions">
        <button type="submit" className="cl-btn" disabled={disabled || busy || pending || (past && !backdate)}>{busy || pending ? "저장 중…" : "저장"}</button>
        {preview != null && (
          <span className={`cl-me-preview cl-num${change.big ? " cl-me-preview-x" : ""}`}>
            총 납입액 {won(old)} → {won(preview)}원{change.text && ` (${change.text})`}{change.big && " · 확인 필요"}
          </span>
        )}
        {err && <p className="cl-me-err" role="alert">{err}</p>}
      </div>
      {confirm && <ConfirmDialog rows={confirm.rows} notes={confirm.notes} alerts={confirm.alerts} onCancel={cancelConfirm} onConfirm={send} />}
    </form>
  );
}

function RunProgress({ runId, airflowUi, onDone }) {
  const q = useQuery({
    queryKey: ["manual-run", runId],
    queryFn: () => api.get(`/manual-entry/runs/${encodeURIComponent(runId)}`),
    refetchInterval: (query) => (query.state.data && query.state.data.outcome !== "running" ? false : 2500),
  });
  const r = q.data;
  const finished = r && r.outcome !== "running";
  useEffect(() => { if (finished) onDone(r.outcome); }, [finished]);
  useEffect(() => { if (q.isError) onDone("error"); }, [q.isError]);
  if (q.isLoading) return <Loading />;
  if (q.isError) return <Failed q={q} what="진행 상태" />;
  const text = r.outcome === "partial" ? partialText(r.failed_step)
    : r.outcome === "success" && r.rebuild_skipped ? "자산은 내일 아침 반영"
    : r.outcome === "running" && r.queued_suspect ? "대기 중 · Airflow 확인"
    : (OUTCOME[r.outcome] || OUTCOME.running)[1];
  const link = airflowUi && `${airflowUi.replace(/\/$/, "")}/dags/account_upsert_manual_position_ledger/runs/${encodeURIComponent(runId)}`;
  return (
    <div className="cl-me-run" aria-live="polite">
      <div className="cl-me-run-head">
        <Tag outcome={r.outcome} />
        {text && <span>{text}</span>}
      </div>
      <ol className="cl-me-steps">
        {r.steps.map((s) => (
          <li key={s.task_id} data-state={s.state || "none"}>
            <i aria-hidden="true">{STEP_GLYPH[s.state] || "·"}</i>{s.label}
            {s.task_id === "rebuild_from_ledger" && s.state === "skipped" && <span className="cl-me-hint">내일</span>}
          </li>
        ))}
      </ol>
      {r.error && <p className="cl-me-err">{r.error}</p>}
      {link && <a className="cl-btn-text" href={link} target="_blank" rel="noreferrer">Airflow 로그</a>}
    </div>
  );
}

function History({ rows, names }) {
  if (!rows.length) return <p className="cl-goal-note">내역 없음</p>;
  return (
    <div className="cl-tscroll"><table className="cl-m cl-me-t">
      <caption className="sr-only">입력 내역</caption>
      <thead><tr>
        <th scope="col">일시</th><th scope="col">계좌</th><th scope="col">기준일</th><th scope="col">내용</th><th scope="col">상태</th>
      </tr></thead>
      <tbody>
        {rows.map((x) => {
          const at = new Date(x.submitted_at);
          const when = `${at.getMonth() + 1}/${at.getDate()} ${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
          return (
            <tr key={x.request_id}>
              <td className="cl-num cl-m-hide">{when}</td>
              <td className="cl-s-nm">{names[x.account_id] || x.account_id}</td>
              <td className="cl-num cl-m-hide">{md(x.conf?.standard_date)}</td>
              <td className="cl-num cl-s-v">{confText(x.conf)}</td>
              <td className="cl-m-hide" title={x.error_text || undefined}><Tag outcome={x.outcome} /></td>
              <td className="cl-s-meta cl-m-only-cell">{md(x.conf?.standard_date)} · {when} 입력</td>
              <td className="cl-s-sub cl-m-only-cell"><Tag outcome={x.outcome} /></td>
            </tr>
          );
        })}
      </tbody>
    </table></div>
  );
}

/** 수기 입력 탭 */
function Manual() {
  const qc = useQueryClient();
  const q = useManualEntry();
  const [sp, setSp] = useSearchParams();
  const sel = sp.get("account");
  const setSel = (k) => setSp((p) => { p.set("account", k); return p; }, { replace: true });
  const [runId, setRunId] = useState(null);
  const [pending, setPending] = useState(false);   // 진행 중 run 이 끝나야 다음 입력 (미리보기·최근 원장이 갱신된 뒤)
  const d = q.data;
  const submitted = (id) => { setRunId(id); setPending(true); qc.invalidateQueries({ queryKey: ["manual-entry"] }); };
  const accounts = d?.accounts || [];
  const acct = accounts.find((a) => a.account_id === sel) || accounts[0];
  const names = Object.fromEntries(accounts.map((a) => [a.account_id, a.account_name]));
  const blocked = useBlocked();

  function done(outcome) {
    setPending(false);
    // 원장이 바뀌었으면 자산·성과 화면도 새로 불러온다(입력 화면 포함), 아니면 입력 화면만
    if (outcome === "success" || outcome === "partial") qc.invalidateQueries({ predicate: (x) => x.queryKey[0] !== "manual-run" });
    else qc.invalidateQueries({ queryKey: ["manual-entry"] });
  }

  return (
    <div className="cl-stack">
      <div className="cl-panel">
        <div className="cl-panel-head"><h2>수기 입력</h2></div>
        {q.isLoading ? <Loading /> : q.isError ? <Failed q={q} what="수기 계좌" /> : !accounts.length ? (
          <EmptyState title="수기 계좌 없음" body="IRP·DC·적금·청약 계좌를 등록하면 표시됩니다." />
        ) : (
          <>
            <ScopeTabs items={accounts.map((a) => [a.account_id, a.account_name])} value={acct.account_id}
              onChange={(k) => { setSel(k); setRunId(null); setPending(false); }} label="계좌" />
            <p className="cl-me-last cl-num">
              {acct.last_date
                ? <>마지막 기록 {md(acct.last_date)} · {acct.kind === "fund" ? `${Number(acct.last_quantity).toLocaleString("ko-KR")}좌 · 납입원금 ` : "총 납입액 "}{won(acct.last_total)}원</>
                : "기록 없음"}
            </p>
            {!d.enabled && <p className="cl-me-err" role="status">Airflow 연결 설정이 없습니다</p>}
            {blocked && <p className="cl-me-err" role="status">{blocked}</p>}
            <EntryForm key={acct.account_id} acct={acct} disabled={!d.enabled || !!blocked} pending={pending} onSubmitted={submitted} />
            {runId && <RunProgress key={runId} runId={runId} airflowUi={d.airflow_ui} onDone={done} />}
          </>
        )}
      </div>
      {d && (
        <div className="cl-panel">
          <div className="cl-panel-head"><h2>입력 내역</h2><span className="cl-sub">최근 10건</span></div>
          <History rows={d.recent} names={names} />
        </div>
      )}
    </div>
  );
}

export default function Data() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get("tab") === "lineage" ? "lineage" : "manual";
  const me = useManualEntry({ enabled: tab === "manual" });
  const n = me.data?.accounts?.length;
  return (
    <section>
      <div className="cl-page-head">
        <div><h1>데이터</h1>{tab === "lineage" ? <LineageSub /> : <p>수기 계좌 {n || ""}개</p>}</div>
        {tab === "lineage" && <LineageStamp />}
      </div>
      <Tabs className="cl-subtabs" items={[["manual", "수기 입력"], ["lineage", "흐름"]]} value={tab} label="데이터"
        onChange={(t) => setSp(() => (t === "lineage" ? new URLSearchParams({ tab: t }) : new URLSearchParams()), { replace: true })} />
      {tab === "lineage" ? <Lineage /> : <Manual />}
      {import.meta.env.VITE_SAMPLE && <p className="cl-goal-note" style={{ marginTop: 24 }}>모든 금액·시세는 합성한 가상 데이터입니다 · 투자 권유 아님</p>}
    </section>
  );
}
