/* 데이터 › 흐름 — /lineage/graph · /lineage/nodes/{id} → 점검 띠 · 지표 · 전체 흐름 그래프 · 단계별 상태 표 · 노드 상세 창(?node=<id>).
   ≤760px 은 그래프 대신 단계 버튼 + 그룹 목록. */
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useLineage, useLineageNode, useManualEntry } from "../lib/queries.js";
import { Failed, Loading } from "./Shell.jsx";
import { EmptyState, Tabs } from "./parts.jsx";
import { md, won } from "./format.js";
import { at, collectStats, dur, failAt, kst, refDay } from "./lineageFmt.js";
import "./lineage.css";

/** 상태 → 모양 · 색 · 글 (모양은 품질 색만) */
const Q = {
  ok: { g: "●", c: "var(--q-ok)", t: "정상" },
  late: { g: "◐", c: "var(--q-part)", t: "지연" },
  up: { g: "◐", c: "var(--q-part)", t: "이전 단계 영향" },
  bad: { g: "▲", c: "var(--q-bad)", t: "실패" },
  man: { g: "○", c: "var(--muted)", t: "수동" },
  unknown: { g: "—", c: "var(--faint)", t: "확인 불가" },
};
const qOf = (s) => Q[s] || Q.unknown;
const isPart = (s) => s === "late" || s === "up";
/** 표·목록 정렬: 문제 행이 위 */
const SO = { bad: 0, late: 1, up: 2, unknown: 3, man: 4, ok: 5 };
const NUM = ["①", "②", "③", "④", "⑤"];
const SUBS = ["API · 크롤링", "dag_id", "schema.table", "dashboard.", "탭 경로"];
const OWNER = ["외부", "Airflow", "PostgreSQL", "PostgreSQL", "대시보드"];
const RUN_TYPE = { scheduled: "정기", manual: "수동", backfill: "보충", asset_triggered: "선행 데이터" };
const RUN_STATE = { success: ["ok", "성공"], failed: ["bad", "실패"], running: ["late", "실행 중"], queued: ["late", "대기"] };
/** 14일 칸 값 → 모양 · 글 (정상 = 모양 없는 면, 미실행 = 빈 테두리) */
const DAY = {
  ok: { k: "ok", g: "", t: "정상" },
  late: { k: "part", g: "◐", t: "지연" },
  up: { k: "part", g: "◐", t: "이전 단계 영향" },
  bad: { k: "bad", g: "▲", t: "실패" },
  man: { k: "man", g: "○", t: "수동" },
};
const dayOf = (v) => DAY[v] || { k: "none", g: "", t: "미실행" };

const full = (n) => `${n.prefix || ""}${n.name}`;
const line2 = (n) => (n.state === "unknown"
  ? `확인 불가${kst(n.fields?.last_start) ? ` · 마지막 ${kst(n.fields.last_start).hm}` : ""}`
  : [n.role, n.info].filter(Boolean).join(" · "));
const gKey = (g) => (g ? `var(--g-${g})` : "var(--muted)");
const gBg = (g) => (g ? `var(--g-${g}-bg)` : "transparent");

/* ── 배치: 띠 격자 · 무게중심 정렬 · 포트 분산 · 경유점 ── */
const COMMON = "_";
// 열 폭은 이름이 잘리지 않는 폭
const W = [120, 296, 240, 208, 110], GUT = 32, PAD = 4, GAP = 30, RH = 52, NH = 44;
const TX = [];
W.reduce((x, w, i) => { TX[i] = x; return x + w + PAD * 2 + GAP; }, GUT);
const TW = (c) => W[c] + PAD * 2;
const GW = TX[4] + TW(4);
const colOf = (n) => Math.min(4, Math.max(0, Number(n.stage) || 0));

/** 그래프 응답 → { V(노드·경유점 자리), E(간선 + 경로 d), GO(띠 순서), GR(띠 자리), H } */
function layout(d) {
  const V = {};
  d.nodes.forEach((n) => { const c = colOf(n); V[n.id] = { id: n.id, c, g: c > 0 && c < 4 ? n.group || COMMON : null, via: false }; });
  // 경유점: 열을 건너뛰는 선은 중간 열마다, 같은 열 선은 배치에서 뺀다
  const E = [], SEG = [];
  (d.edges || []).forEach((x) => {
    if (!V[x.from] || !V[x.to] || x.from === x.to) return;
    const fwd = V[x.from].c <= V[x.to].c;
    const e = { from: x.from, to: x.to, a: fwd ? x.from : x.to, b: fwd ? x.to : x.from, dash: !!x.ref, segs: [] };
    E.push(e);
    if (V[e.a].c === V[e.b].c) { e.same = true; return; }
    const chain = [e.a];
    for (let c = V[e.a].c + 1; c < V[e.b].c; c++) {
      const id = `via${E.length}_${c}`;
      V[id] = { id, c, g: V[e.a].g || V[e.b].g || COMMON, via: true };
      chain.push(id);
    }
    chain.push(e.b);
    for (let k = 0; k < chain.length - 1; k++) { const s = { a: chain[k], b: chain[k + 1], e }; SEG.push(s); e.segs.push(s); }
  });
  const all = Object.values(V);
  const COL = [0, 1, 2, 3, 4].map((c) => all.filter((v) => v.c === c));
  // 띠 순서 = 응답 그룹 순서, 그룹 없는 노드는 끝의 '공통' 띠
  const used = new Set(all.map((v) => v.g).filter(Boolean));
  const GO = [...new Set([...(d.groups || []).map((g) => g.id), ...used, COMMON])].filter((k) => used.has(k)).sort((p, q) => (p === COMMON) - (q === COMMON));

  // 띠 행 수
  const GR = {};
  let top = 0;
  GO.forEach((k) => {
    const rows = Math.max(1, ...[1, 2, 3].map((c) => COL[c].filter((v) => v.g === k).length));
    GR[k] = { rows, top, h: rows * RH + 8 };
    top += GR[k].h + 12;
  });
  const H = Math.max(top - 12, COL[0].length * RH, COL[4].length * RH, NH);
  const mid = (v) => v.y + NH / 2;

  // 처음 자리
  COL.forEach((col, c) => {
    if (c === 0 || c === 4) {
      const slot = Math.max(RH, H / Math.max(1, col.length));
      col.forEach((v, i) => { v.y = Math.round(slot * i + (slot - NH) / 2); });
    } else {
      GO.forEach((k) => {
        const g = GR[k], part = col.filter((v) => v.g === k);
        part.forEach((v, i) => { v.y = g.top + 8 + Math.floor((g.rows - part.length) / 2) * RH + i * RH; });
      });
    }
  });

  // 무게중심 정렬
  const ins = {}, outs = {};
  all.forEach((v) => { ins[v.id] = []; outs[v.id] = []; });
  SEG.forEach((s) => { outs[s.a].push(s.b); ins[s.b].push(s.a); });
  const bary = (v, fromLeft) => {
    const nb = fromLeft ? ins[v.id] : outs[v.id];
    const alt = fromLeft ? outs[v.id] : ins[v.id];
    const use = nb.length ? nb : alt;
    return use.length ? use.reduce((s, id) => s + mid(V[id]), 0) / use.length : mid(v);
  };
  const place = (c, fromLeft) => {
    const col = COL[c];
    col.forEach((v) => { v.b = bary(v, fromLeft); });
    if (c === 0 || c === 4) {
      const list = col.slice().sort((p, q) => p.b - q.b);
      list.forEach((v, i) => { v.y = Math.max(v.b - NH / 2, 0, i ? list[i - 1].y + RH : 0); });
      for (let i = list.length - 1; i >= 0; i--) list[i].y = Math.round(Math.min(list[i].y, H - NH, i < list.length - 1 ? list[i + 1].y - RH : H));
      return;
    }
    GO.forEach((k) => {
      const g = GR[k], list = col.filter((v) => v.g === k).sort((p, q) => p.b - q.b);
      const r = list.map((v) => Math.min(g.rows - 1, Math.max(0, Math.round((v.b - NH / 2 - g.top - 8) / RH))));
      for (let i = 1; i < r.length; i++) r[i] = Math.max(r[i], r[i - 1] + 1);
      for (let i = r.length - 1; i >= 0; i--) r[i] = Math.min(r[i], i < r.length - 1 ? r[i + 1] - 1 : g.rows - 1);
      list.forEach((v, i) => { v.y = g.top + 8 + r[i] * RH; });
    });
  };
  // 비용 = 교차 수 + 동점 가르기용 선 길이
  const cost = () => {
    let x = 0, len = 0;
    for (let i = 0; i < SEG.length; i++) {
      const s = SEG[i], a = mid(V[s.a]), b = mid(V[s.b]);
      len += Math.abs(a - b);
      for (let j = i + 1; j < SEG.length; j++) {
        const t = SEG[j];
        if (V[t.a].c === V[s.a].c && s.a !== t.a && s.b !== t.b && (a - mid(V[t.a])) * (b - mid(V[t.b])) < 0) x++;
      }
    }
    return x + len / 100000;
  };
  const snap = () => all.map((v) => v.y);
  let best = cost(), keep = snap();
  for (let it = 0; it < 4; it++) {
    for (let c = 1; c <= 4; c++) place(c, true);
    for (let c = 3; c >= 0; c--) place(c, false);
    const k = cost();
    if (k < best) { best = k; keep = snap(); }
  }
  all.forEach((v, i) => { v.y = keep[i]; });
  // 다듬기: 교차가 줄 때만 자리 바꾸기·빈 행 옮기기
  for (let pass = 0; pass < 6; pass++) {
    let moved = false;
    all.forEach((v) => {
      const c = v.c;
      const mates = COL[c].filter((u) => u !== v && (c === 0 || c === 4 || u.g === v.g));
      const cand = mates.map((u) => ({ u, y: u.y }));
      if (c > 0 && c < 4) {
        const g = GR[v.g];
        for (let r = 0; r < g.rows; r++) { const y = g.top + 8 + r * RH; if (!mates.some((u) => u.y === y) && y !== v.y) cand.push({ u: null, y }); }
      } else {
        for (let y = 0; y <= H - NH; y += RH / 4) if (!mates.some((u) => Math.abs(u.y - y) < RH) && y !== v.y) cand.push({ u: null, y });
      }
      cand.forEach((m) => {
        const y0 = v.y;
        v.y = m.y; if (m.u) m.u.y = y0;
        const k = cost();
        if (k < best - 1e-9) { best = k; moved = true; } else { v.y = y0; if (m.u) m.u.y = m.y; }
      });
    });
    if (!moved) break;
  }

  // 포트 분산
  const port = (v, i, k) => (k === 1 || v.via ? mid(v) : v.y + 8 + ((i + 0.5) * (NH - 16)) / k);
  const outY = new Map(), inY = new Map();
  all.forEach((v) => {
    SEG.filter((s) => s.a === v.id).sort((p, q) => mid(V[p.b]) - mid(V[q.b])).forEach((s, i, o) => outY.set(s, port(v, i, o.length)));
    SEG.filter((s) => s.b === v.id).sort((p, q) => mid(V[p.a]) - mid(V[q.a])).forEach((s, i, o) => inY.set(s, port(v, i, o.length)));
  });
  const dot = (x, y) => `M${x - 2} ${y}a2 2 0 1 0 4 0a2 2 0 1 0 -4 0`;
  E.forEach((e) => {
    if (e.same) {
      // 같은 열 선 = 오른쪽 괄호
      const a = V[e.a], b = V[e.b], x = TX[a.c] + PAD + W[a.c], y1 = mid(a), y2 = mid(b);
      e.d = `M${x} ${y1}C${x + 20} ${y1} ${x + 20} ${y2} ${x} ${y2}`;
      e.dots = dot(x + 2, y1) + dot(x + 2, y2);
      return;
    }
    let p = "", end = null;
    e.segs.forEach((s, k) => {
      const a = V[s.a], b = V[s.b];
      const x1 = TX[a.c] + PAD + W[a.c], y1 = outY.get(s), x2 = TX[b.c] + PAD, y2 = inY.get(s), dx = Math.max(12, (x2 - x1) * 0.5);
      if (k === 0) p += `M${x1} ${y1}`;
      p += `C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`;
      if (b.via) p += `L${x2 + W[b.c]} ${y2}`;
      else end = [x2, y2];
    });
    e.d = p;
    e.dots = dot(TX[V[e.a].c] + PAD + W[V[e.a].c] + 2, outY.get(e.segs[0])) + dot(end[0] - 2, end[1]);
  });
  return { V, E, GO, GR, H };
}

/** 이전·이후 단계 전부(간선 방향 그대로) */
function walk(start, adj) {
  const seen = new Set(), q = [start];
  while (q.length) { const cur = q.shift(); (adj.get(cur) || []).forEach((to) => { if (!seen.has(to)) { seen.add(to); q.push(to); } }); }
  return seen;
}

/** 단계 요약 조각 — "수집 7 · 실패 1 · 수동 2" */
const stageSummary = (label, list) => [`${label} ${list.length}`, ...["bad", "late", "up", "unknown", "man"]
  .map((s) => [s, list.filter((n) => n.state === s).length]).filter(([, k]) => k).map(([s, k]) => `${Q[s].t} ${k}`)].join(" · ");

/** 페이지 머리 부제 — 단계별 노드 수 · 주의 수 */
export function LineageSub() {
  const d = useLineage().data;
  if (!d?.nodes) return null;
  const bad = d.nodes.filter((n) => n.state === "bad").length;
  return <p className="cl-num">{(d.stages || []).map((s, c) => `${s} ${d.nodes.filter((n) => colOf(n) === c).length}`).join(" · ")}{bad ? ` · 주의 ${bad}` : ""}</p>;
}
/** 페이지 머리 오른쪽 — 확인 시각 */
export function LineageStamp() {
  const d = useLineage().data;
  const k = d && kst(d.generated_at);
  return k ? <p className="ln-stamp"><span className="cl-num">{md(k.d)} {k.hm}</span> 확인 · 5분 주기</p> : null;
}

/** 단계별 표 칸 [머리, 정렬, (fields, ref) → [값, 꼬리]] */
const STAGE_COLS = {
  0: [["종류", "l", (f) => [f.type]], ["사용 수집", "r", (f) => [f.dags != null ? `${f.dags}` : null]]],
  1: [["일정", "r", (f) => [f.schedule || "수동"]],
    ["최근 실행", "r", (f, r) => [at(f.last_start, r), f.duration_s != null ? ` · ${dur(f.duration_s)}` : ""]],
    ["14일 실행", "r", (f) => [f.runs_14d != null ? `${f.runs_14d}회` : null]],
    ["실패 태스크", "l", (f) => [f.failed_task]]],
  2: [["기준일", "r", (f) => [f.data_date ? md(f.data_date) : null]], ["최근 갱신", "r", (f, r) => [at(f.loaded_at, r)]],
    ["행 수", "r", (f) => [f.rows != null ? won(f.rows) : null]],
    ["이번 적재", "r", (f) => [f.last_rows != null ? `${won(f.last_rows)}행` : null]], ["수집 작업", "l", (f) => [f.producer]]],
  3: [["종류", "l", (f) => [f.type]], ["기준일", "r", (f) => [f.data_date ? md(f.data_date) : null]],
    ["최근 갱신", "r", (f, r) => [at(f.refreshed_at, r), f.duration_s != null ? ` · ${dur(f.duration_s)}` : ""]],
    ["행 수", "r", (f) => [f.rows != null ? won(f.rows) : null]]],
  4: [["경로", "l", (f) => [f.path]], ["입력", "r", (f) => [f.inputs != null ? `${f.inputs}` : null]],
    ["영향", "r", (f) => [f.affected ? `${f.affected}` : f.inputs != null ? "0" : null]]],
};

/** 14일 칸 줄 */
function Strip({ history, days, big }) {
  if (!history?.some((v) => v != null)) return null;
  const bad = history.filter((v) => v === "bad" || isPart(v)).length;
  return (
    <div className={`ln-strip${big ? " ln-strip-big" : ""}`} role="img" aria-label={`14일 기록 · 문제 ${bad}일`}>
      {history.map((v, i) => { const x = dayOf(v); return <span key={i} data-k={x.k} title={`${days?.[i] ? md(days[i]) : ""} · ${x.t}`}>{x.g}</span>; })}
    </div>
  );
}

/** 노드 이름 — 흐린 접두어 + 이름 */
const Name = ({ n }) => <><span className="ln-pre">{n.prefix}</span>{n.name}</>;

/** 점검 띠 — 실패 노드 · Airflow 확인 불가 */
function Check({ d, m, onPath, onOpen }) {
  const bad = d.nodes.filter((n) => n.state === "bad").sort((p, q) => colOf(p) - colOf(q));
  const air = d.sources?.airflow;
  const unknown = d.nodes.filter((n) => n.state === "unknown").length;
  if (!bad.length && air === "ok" && d.sources?.catalog !== "error") return null;
  const n = bad[0];
  const screens = n ? [...walk(n.id, m.fwd)].map((id) => m.byId[id]).filter((x) => x.kind === "screen").map((x) => x.name) : [];
  const t = n && failAt(n, m.ref);
  return (
    <section className="ln-check" aria-label="점검">
      {n && (
        <div className="ln-check-row">
          <span className="ln-check-ico" data-q="bad" aria-hidden="true">▲</span>
          <div className="ln-check-txt">
            <div className="ln-check-t">{full(n).replace(/_/g, "_\u200b")} <span>실패{t ? <> · <span className="cl-num">{t}</span></> : ""}{bad.length > 1 ? ` · 외 ${bad.length - 1}곳` : ""}</span></div>
            <div className="ln-check-s">{[n.role, n.fields?.failed_task, n.reason].filter(Boolean).join(" · ")}</div>
            {screens.length > 0 && <div className="ln-check-b">영향 화면 {screens.join(" · ")}</div>}
          </div>
          <div className="ln-check-act">
            <button type="button" className="cl-btn-ghost ln-btn-sm ln-desk" onClick={() => onPath(n.id)}>경로 보기</button>
            <button type="button" className="cl-btn-text" data-node={n.id} onClick={(e) => onOpen(n.id, e.currentTarget)}>자세히</button>
          </div>
        </div>
      )}
      {air !== "ok" && (
        <div className="ln-check-row">
          <span className="ln-check-ico" data-q="unknown" aria-hidden="true">—</span>
          <div className="ln-check-txt">
            <div className="ln-check-t">Airflow 확인 불가 · 일부만 보임</div>
            <div className="ln-check-s">{[{ partial: "일부 수집만 읽힘", unreachable: "연결 실패", off: "연결 설정 없음" }[air] || "응답 없음", unknown ? `확인 불가 ${unknown}곳` : null].filter(Boolean).join(" · ")}</div>
          </div>
        </div>
      )}
      {d.sources?.catalog === "error" && (
        <div className="ln-check-row">
          <span className="ln-check-ico" data-q="unknown" aria-hidden="true">—</span>
          <div className="ln-check-txt"><div className="ln-check-t">DB 연결 확인 불가 · 저장·계산 일부만 보임</div></div>
        </div>
      )}
    </section>
  );
}

/** 지표 4칸 — 수집 성공 · 최근 저장 · 계산 갱신 · 영향 화면 */
function Kpis({ d, m }) {
  const { ref } = m;
  const { dags, reg, known, ok } = collectStats(d.nodes);
  const tables = d.nodes.filter((n) => n.kind === "table" && n.fields?.loaded_at).sort((p, q) => Date.parse(q.fields.loaded_at) - Date.parse(p.fields.loaded_at));
  const mvs = d.nodes.filter((n) => n.kind === "mv" && n.fields?.refreshed_at).sort((p, q) => Date.parse(q.fields.refreshed_at) - Date.parse(p.fields.refreshed_at));
  const screens = d.nodes.filter((n) => n.kind === "screen");
  const hit = screens.filter((n) => n.state === "up" || n.state === "bad");
  const t = tables[0], mv = mvs[0];
  const cells = [
    ["수집 성공", known.length ? `${ok}/${reg.length}` : "—", null,
      !reg.length ? "정기 수집 없음" : known.length ? `정기 ${reg.length} · 수동 ${dags.length - reg.length} 제외` : "Airflow 확인 불가"],
    ["최근 저장", t ? at(t.fields.loaded_at, ref) : "—", t ? "갱신" : null, t ? `${t.fields.producer || full(t)}${t.fields.data_date ? ` · 기준일 ${md(t.fields.data_date)}` : ""}` : "기록 없음"],
    ["계산 갱신", mv ? at(mv.fields.refreshed_at, ref) : "—", mv ? "갱신" : null, mv ? `MV ${mvs.length}${mv.fields.duration_s != null ? ` · 소요 ${dur(mv.fields.duration_s)}` : ""}` : "기록 없음"],
    ["영향 화면", `${hit.length}`, "곳", `화면 ${screens.length} 중`],
  ];
  return (
    <div className="ln-kpis ln-desk">
      {cells.map(([k, v, u, s]) => (
        <div key={k} className="ln-kpi">
          <div className="ln-kpi-k">{k}</div>
          <div className="ln-kpi-v"><b className="cl-num">{v}</b>{u && <span>{u}</span>}</div>
          <div className="ln-kpi-s" title={s}>{s}</div>
        </div>
      ))}
    </div>
  );
}

/** 전체 흐름 — 담당 영역 · 단계 머리 바 · 띠 격자 그래프 · 범례 */
function Graph({ d, m, stage, setStage, sel, setSel, onOpen, graphRef }) {
  const { V, E, GO, GR, H } = m.L;
  const [preview, setPreview] = useState(null);
  const [cur, setCur] = useState(null);   // 로빙 tabindex
  const btns = useRef({});
  const focus = preview || sel;
  const up = focus ? walk(focus, m.back) : new Set();
  const down = focus ? walk(focus, m.fwd) : new Set();
  const { label, nodes, tiles, bad, part } = useMemo(() => {
    const lb = Object.fromEntries((d.groups || []).map((g) => [g.id, g.label]));
    lb[COMMON] = "공통";
    const tl = [];
    [1, 2, 3].forEach((c) => m.L.GO.forEach((k) => tl.push({ c, k })));
    return {
      label: lb,
      nodes: d.nodes.map((n) => ({ n, c: colOf(n), y: m.L.V[n.id].y })).sort((p, q) => p.c - q.c || p.y - q.y),
      tiles: tl,
      bad: d.nodes.filter((n) => n.state === "bad").length,
      part: d.nodes.filter((n) => isPart(n.state)).length,
    };
  }, [d, m]);
  const tabStop = cur && V[cur] ? cur : sel && V[sel] ? sel : nodes[0]?.n.id;

  let dS = "", dD = "", dDot = "", hS = "", hD = "", hDot = "";
  E.forEach((e) => {
    const hi = focus && ((up.has(e.from) && (e.to === focus || up.has(e.to))) || (down.has(e.to) && (e.from === focus || down.has(e.from))));
    if (hi) { if (e.dash) hD += e.d; else hS += e.d; hDot += e.dots; }
    // 같은 열 선은 경로에 들 때만(평소엔 괄호가 몰려 흐름을 가린다)
    else if (!e.same) { if (e.dash) dD += e.d; else dS += e.d; dDot += e.dots; }
  });

  // ←→ 이웃 열에서 가장 가까운 노드, ↑↓ 같은 열 위·아래
  const move = (e, id) => {
    const k = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
    if (!k) return;
    e.preventDefault();
    const me = nodes.find((x) => x.n.id === id);
    let to = null;
    if (k[1]) {
      const col = nodes.filter((x) => x.c === me.c);
      to = col[col.indexOf(me) + k[1]];
    } else {
      for (let c = me.c + k[0]; c >= 0 && c <= 4 && !to; c += k[0]) {
        const col = nodes.filter((x) => x.c === c);
        if (col.length) to = col.reduce((b, x) => (Math.abs(x.y - me.y) < Math.abs(b.y - me.y) ? x : b));
      }
    }
    if (to) { setCur(to.n.id); btns.current[to.n.id]?.focus(); }
  };
  const zones = [[0, TX[0], TW(0)], [1, TX[1], TW(1)], [2, TX[2], TW(2) + GAP + TW(3)], [4, TX[4], TW(4)]];
  const selN = sel && m.byId[sel];
  const selUp = sel ? walk(sel, m.back) : null, selDown = sel ? walk(sel, m.fwd) : null;

  return (
    <section className="cl-panel ln-graph ln-desk" ref={graphRef} aria-labelledby="ln-graph-h">
      <div className="ln-graph-head">
        <div>
          <h2 id="ln-graph-h">전체 흐름</h2>
          <div className="ln-sub">단계 5 · 그룹 {GO.filter((k) => k !== COMMON).length} · 노드 <span className="cl-num">{d.nodes.length}</span>
            {bad > 0 && <> · <span aria-hidden="true" style={{ color: Q.bad.c }}>▲</span><span className="cl-num">{bad}</span></>}
            {part > 0 && <> <span aria-hidden="true" style={{ color: Q.late.c }}>◐</span><span className="cl-num">{part}</span></>}</div>
        </div>
        {selN && (
          <div className="ln-selchip">
            <span><b>{full(selN)}</b> · 앞 <span className="cl-num">{selUp.size}</span>곳 · 뒤 <span className="cl-num">{selDown.size}</span>곳 · 화면 <span className="cl-num">{[...selDown].filter((id) => m.byId[id]?.kind === "screen").length}</span></span>
            <button type="button" onClick={() => setSel(null)}>선택 해제</button>
          </div>
        )}
      </div>
      <div className="ln-scroll">
        <div className="ln-canvas" style={{ width: GW }}>
          <div className="ln-zones" aria-label="담당 영역">
            {zones.map(([c, x, w]) => (
              <div key={c} style={{ left: x, width: w }}><span>{OWNER[c]}</span><i aria-hidden="true" /></div>
            ))}
          </div>
          <div className="ln-steps" role="group" aria-label="단계">
            {m.stages.map((s, c) => {
              const col = d.nodes.filter((n) => colOf(n) === c);
              const nb = col.filter((n) => n.state === "bad").length, np = col.filter((n) => isPart(n.state)).length;
              const is = nb ? ["bad", nb] : np ? ["late", np] : null;
              return (
                <Fragment key={c}>
                  <button type="button" className="ln-step" aria-pressed={stage === c} style={{ left: TX[c], width: TW(c) }} onClick={() => setStage(c)}>
                    <span className="ln-step-1">
                      <span className="ln-step-n" aria-hidden="true">{c + 1}</span>
                      <span className="ln-step-l">{s}</span>
                      <span className="ln-step-c cl-num">{col.length}</span>
                      <span className="ln-step-sp" />
                      {is && <span className="ln-step-i cl-num"><span aria-hidden="true" style={{ color: Q[is[0]].c }}>{Q[is[0]].g}</span>{is[1]}<span className="sr-only">{Q[is[0]].t}</span></span>}
                    </span>
                    <span className="ln-step-2">{SUBS[c]}</span>
                  </button>
                  {c < 4 && <span className="ln-chev" aria-hidden="true" style={{ left: TX[c] + TW(c) }}>›</span>}
                </Fragment>
              );
            })}
          </div>
          <div className="ln-grid" style={{ height: H }} data-stage={stage}>
            {GO.map((k) => (
              <div key={k} className="ln-band-l" style={{ top: GR[k].top, height: GR[k].h, color: gKey(k === COMMON ? null : k) }}>
                <span>{label[k] || k}</span>
                <span className="cl-num">{d.nodes.filter((n) => colOf(n) > 0 && colOf(n) < 4 && (n.group || COMMON) === k).length}개</span>
              </div>
            ))}
            {tiles.map(({ c, k }) => (
              <div key={`${c}${k}`} aria-hidden="true" className={`ln-tile${c === stage ? " ln-on" : ""}${k === COMMON ? " ln-tile-c" : ""}`}
                style={{ left: TX[c], top: GR[k].top, width: TW(c), height: GR[k].h, "--gk": gKey(k), "--gb": gBg(k) }} />
            ))}
            {(stage === 0 || stage === 4) && <div aria-hidden="true" className="ln-frame" style={{ left: TX[stage], width: TW(stage), height: H }} />}
            <svg className="ln-edges" width={GW} height={H} viewBox={`0 0 ${GW} ${H}`} aria-hidden="true">
              <g style={{ opacity: focus ? 0.6 : 1 }}>
                <path d={dS} className="ln-e" />
                <path d={dD} className="ln-e ln-e-ref" />
                <path d={dDot} className="ln-e-dot" />
              </g>
              <path d={hS} className="ln-e ln-hi" />
              <path d={hD} className="ln-e ln-hi ln-e-ref" />
              <path d={hDot} className="ln-e-dot ln-hi" />
            </svg>
            {nodes.map(({ n, c, y }) => {
              const q = qOf(n.state);
              const on = !focus || n.id === focus || up.has(n.id) || down.has(n.id);
              return (
                <button key={n.id} ref={(el) => { btns.current[n.id] = el; }} type="button" className="ln-node" data-node={n.id} data-q={n.state}
                  aria-haspopup="dialog" aria-current={n.id === sel ? "true" : undefined} data-dim={on ? undefined : ""} tabIndex={n.id === tabStop ? 0 : -1}
                  aria-label={`${full(n)} · ${line2(n)} · ${m.stages[c] ?? ""}${n.group ? ` · ${label[n.group] || n.group}` : ""} · ${q.t}`}
                  title={full(n)} style={{ left: TX[c] + PAD, top: y, width: W[c] }}
                  onClick={(e) => { setCur(n.id); onOpen(n.id, e.currentTarget); }}
                  onKeyDown={(e) => move(e, n.id)}
                  onPointerEnter={(e) => e.pointerType === "mouse" && setPreview(n.id)} onPointerLeave={() => setPreview(null)}
                  onFocus={(e) => { setCur(n.id); if (e.target.matches(":focus-visible")) setPreview(n.id); }} onBlur={() => setPreview(null)}>
                  <span className="ln-g" aria-hidden="true" style={{ color: q.c }}>{q.g}</span>
                  <span className="ln-txt">
                    <span className="ln-n1"><Name n={n} /></span>
                    <span className="ln-n2">{line2(n)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="ln-legend">
        <div>
          <span className="ln-lg-h">그룹</span>
          {GO.filter((k) => k !== COMMON).map((k) => (
            <span key={k} className="ln-lg-g" style={{ color: gKey(k), "--gk": gKey(k), "--gb": gBg(k) }}><i aria-hidden="true" />{label[k] || k}</span>
          ))}
          <span>띠 밖 = 공통</span>
        </div>
        <div>
          <span className="ln-lg-h">상태</span>
          {["ok", "late", "bad", "man"].map((s) => <span key={s}><span aria-hidden="true" style={{ color: Q[s].c }}>{Q[s].g}</span> {s === "late" ? "지연 · 이전 단계 영향" : Q[s].t}</span>)}
          {d.nodes.some((n) => n.state === "unknown") && <span><span aria-hidden="true" style={{ color: Q.unknown.c }}>—</span> 확인 불가</span>}
        </div>
        <div>
          <span className="ln-lg-h">선</span>
          <span><svg width="24" height="6" aria-hidden="true"><line x1="1" y1="3" x2="23" y2="3" className="ln-e" /></svg>수집·저장</span>
          <span><svg width="24" height="6" aria-hidden="true"><line x1="1" y1="3" x2="23" y2="3" className="ln-e ln-e-ref" /></svg>참조</span>
          <span><svg width="24" height="6" aria-hidden="true"><line x1="1" y1="3" x2="23" y2="3" className="ln-e ln-hi" /></svg>선택 경로</span>
        </div>
      </div>
    </section>
  );
}

/** 단계별 상태 표 — 문제 행이 위, 14일 기록 칸 */
function StageTable({ d, m, stage, setStage, onOpen }) {
  const { ref, stages } = m;
  const label = Object.fromEntries((d.groups || []).map((g) => [g.id, g.label]));
  const gi = (n) => { const i = (d.groups || []).findIndex((g) => g.id === n.group); return i < 0 ? 99 : i; };
  const list = d.nodes.filter((n) => colOf(n) === stage);
  const rows = list.map((n, i) => ({ n, i })).sort((p, q) => (SO[p.n.state] ?? 9) - (SO[q.n.state] ?? 9) || gi(p.n) - gi(q.n) || p.i - q.i).map(({ n }) => n);
  const cols = STAGE_COLS[stage] || [];
  const days = d.days || [];
  return (
    <section className="cl-panel ln-desk" aria-labelledby="ln-tbl-h">
      <div className="ln-graph-head">
        <div><h2 id="ln-tbl-h">단계별 상태</h2><div className="ln-sub">{stageSummary(stages[stage], list)}</div></div>
        <Tabs className="ln-tabs" label="단계" items={stages.map((s, c) => [c, s])} value={stage} onChange={setStage} />
      </div>
      {!rows.length ? <p className="cl-goal-note">{stages[stage]} 없음</p> : (
        <div className="cl-tscroll">
          <table className="ln-tbl">
            <caption className="sr-only">{stages[stage]} 단계 상태</caption>
            <thead><tr>
              <th scope="col">항목</th><th scope="col">그룹</th><th scope="col">상태</th>
              {cols.map(([h, al]) => <th key={h} scope="col" className={al === "r" ? "cl-n" : undefined}>{h}</th>)}
              <th scope="col">사유</th><th scope="col">14일 기록</th>
            </tr></thead>
            <tbody>
              {rows.map((n) => {
                const q = qOf(n.state);
                const f = n.fields || {};
                const t = n.state === "bad" && failAt(n, ref);
                return (
                  <tr key={n.id} onClick={(e) => e.target.closest("button") || onOpen(n.id, e.currentTarget.querySelector("button"))}>
                    <td><button type="button" className="ln-rowbtn" data-node={n.id} onClick={(e) => onOpen(n.id, e.currentTarget)}>
                      <span className="ln-n1"><Name n={n} /></span><span className="ln-n2">{n.state === "unknown" ? line2(n) : [n.role, n.info].filter(Boolean).join(" · ")}</span>
                    </button></td>
                    <td className="ln-grp" style={{ color: gKey(n.group) }}>{n.group && <i aria-hidden="true" style={{ background: gKey(n.group) }} />}{n.group ? label[n.group] || n.group : "공통"}</td>
                    <td><span aria-hidden="true" className="ln-g" style={{ color: q.c }}>{q.g}</span>{q.t}{t ? <> · <span className="cl-num">{t}</span></> : null}</td>
                    {cols.map(([h, al, fn]) => {
                      const [v, tail] = fn(f, ref);
                      return <td key={h} className={al === "r" ? "cl-n cl-num" : undefined}>{v ?? "—"}{tail && <span className="ln-tail">{tail}</span>}</td>;
                    })}
                    <td className="ln-why" title={n.reason || undefined}>{n.reason || ""}</td>
                    <td><Strip history={n.history} days={days} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {days.length > 0 && <div className="ln-foot"><span className="cl-num">{md(days[0])}~{md(days[days.length - 1])}</span> · 회색 = 정상 · 빈칸 = 미실행</div>}
    </section>
  );
}

/** ≤760px — 단계 버튼 + 담당 줄 + 그룹 소제목 목록 */
function MobileList({ d, m, stage, setStage, onOpen }) {
  const { stages } = m;
  const label = Object.fromEntries((d.groups || []).map((g) => [g.id, g.label]));
  const list = d.nodes.filter((n) => colOf(n) === stage);
  const sort = (a) => a.slice().sort((p, q) => (SO[p.state] ?? 9) - (SO[q.state] ?? 9));
  const banded = stage > 0 && stage < 4;
  const order = [...new Set([...(d.groups || []).map((g) => g.id), ...list.map((n) => n.group || COMMON)])];
  const parts = banded ? order.map((k) => [k, sort(list.filter((n) => (n.group || COMMON) === k))]).filter(([, a]) => a.length) : [[null, sort(list)]];
  return (
    <div className="ln-mob">
      <div className="ln-mtabs" role="group" aria-label="단계">
        {stages.map((s, c) => {
          const col = d.nodes.filter((n) => colOf(n) === c);
          const nb = col.filter((n) => n.state === "bad").length, np = col.filter((n) => isPart(n.state)).length;
          const is = nb ? ["bad", nb] : np ? ["late", np] : null;
          return (
            <button key={c} type="button" aria-pressed={stage === c} onClick={() => setStage(c)}>
              <span className="cl-num">{c + 1}{is && <> · <i aria-hidden="true" style={{ color: Q[is[0]].c }}>{Q[is[0]].g}</i>{is[1]}<span className="sr-only">{Q[is[0]].t}</span></>}</span>{s}
            </button>
          );
        })}
      </div>
      <div className="ln-own">담당 {OWNER[stage]} · {SUBS[stage]} · {stageSummary(stages[stage], list)}</div>
      <div className="ln-mlist">
        {!list.length && <p className="cl-goal-note ln-mempty">{stages[stage]} 없음</p>}
        {parts.map(([k, a]) => (
          <Fragment key={k || "all"}>
            {k && <div className="ln-mhead" style={{ "--gk": gKey(k === COMMON ? null : k), "--gb": gBg(k === COMMON ? null : k) }}>{k === COMMON ? "공통" : label[k] || k} <span className="cl-num">{a.length}</span></div>}
            {a.map((n) => {
              const q = qOf(n.state);
              return (
                <button key={n.id} type="button" className="ln-mrow" data-node={n.id} data-q={n.state} onClick={(e) => onOpen(n.id, e.currentTarget)}>
                  <span className="ln-n1"><Name n={n} /></span>
                  <span className="ln-mrow-2"><span>{line2(n)}</span><span><i aria-hidden="true" style={{ color: q.c }}>{q.g}</i>{q.t}</span></span>
                </button>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

const FOCUSABLE = 'button:not([disabled]),[href],input,select,[tabindex]:not([tabindex="-1"])';

/** 노드 상세 창 — 머리는 그래프 노드, 본문은 /lineage/nodes/{id}. 초점 가둠 · Esc·배경으로 닫힘 */
function NodeDrawer({ id, d, m, onClose, onPick, onPath }) {
  const q = useLineageNode(id, { retry: (k, e) => e?.status !== 404 && k < 2 });
  const ref = useRef(null);
  const titleRef = useRef(null);
  const tid = useId();
  const closeRef = useRef(onClose);
  const det = q.data;
  const n = det?.node || m.byId[id];
  const air = useManualEntry({ enabled: !!det?.airflow_path }).data?.airflow_ui;

  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    titleRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== "Tab" || !ref.current) return;
      const f = [...ref.current.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], lastF = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current)) { e.preventDefault(); lastF.focus(); }
      else if (!e.shiftKey && document.activeElement === lastF) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; document.removeEventListener("keydown", onKey); };
  }, []);
  useEffect(() => { titleRef.current?.focus({ preventScroll: true }); }, [id]);

  const ref0 = m.ref;
  const c = n ? colOf(n) : 0;
  const qq = n ? qOf(n.state) : Q.unknown;
  const f = n?.fields || {};
  const label = Object.fromEntries((d.groups || []).map((g) => [g.id, g.label]));
  const t = n?.state === "bad" && failAt(n, ref0);
  const cells = n ? (STAGE_COLS[c] || []).map(([h, , fn]) => { const [v, tail] = fn(f, ref0); return [h, v, tail]; }).filter(([, v]) => v != null && v !== "") : [];
  const hist = n?.history || [];
  const okN = hist.filter((v) => v === "ok").length, badN = hist.filter((v) => v === "bad").length;
  const near = (ids) => {
    const by = new Map();
    (ids || []).map((x) => m.byId[x]).filter(Boolean).forEach((x) => { const k = colOf(x); by.set(k, [...(by.get(k) || []), x]); });
    return [...by.entries()].sort((p, q2) => p[0] - q2[0]);
  };
  const screenName = (p) => d.nodes.find((x) => x.kind === "screen" && x.fields?.path === p)?.name || p;
  const list = (title, ids) => {
    const g = near(ids);
    return (
      <div className="ln-dr-near">
        <h3>{title}</h3>
        {!g.length && <p className="ln-dr-none">없음</p>}
        {g.map(([k, a]) => (
          <Fragment key={k}>
            <div className="ln-dr-st">{NUM[k]} {m.stages[k]}</div>
            {a.map((x) => (
              <button key={x.id} type="button" className="ln-dr-link" onClick={() => onPick(x.id)}>
                <i aria-hidden="true" style={{ color: qOf(x.state).c }}>{qOf(x.state).g}</i>
                <span><span className="ln-n1"><Name n={x} /></span><span className="ln-n2">{line2(x)}</span></span>
              </button>
            ))}
          </Fragment>
        ))}
      </div>
    );
  };

  return (
    <div className="hd-scrim" onClick={onClose}>
      <div className="hd-drawer ln-dr" role="dialog" aria-modal="true" aria-labelledby={tid} ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="hd-head">
          <div className="hd-titles ln-dr-titles">
            {n && (
              <div className="ln-dr-chips">
                <span className="ln-chip">{NUM[c]} {m.stages[c]}</span>
                {n.group && <span className="ln-gchip" style={{ "--gk": gKey(n.group), "--gb": gBg(n.group) }}>{label[n.group] || n.group}</span>}
                <span className="ln-dr-own">{n.role ? `${n.role} · ` : ""}담당 {OWNER[c]}{c === 1 ? ` · ${f.schedule ? `매일 ${f.schedule}` : "수동"}` : ""}</span>
              </div>
            )}
            <h2 id={tid} ref={titleRef} tabIndex={-1}>{n ? <Name n={n} /> : id}</h2>
            {n && (
              <div className="ln-dr-state">
                <span className="ln-pill" data-q={n.state}><span aria-hidden="true" style={{ color: qq.c }}>{qq.g}</span>{qq.t}{t ? <> · <span className="cl-num">{t}</span></> : null}</span>
                {n.reason && <span className="ln-dr-why">{n.reason}</span>}
              </div>
            )}
          </div>
          <button type="button" className="hd-x" aria-label="닫기" onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <div className="hd-body ln-dr-body">
          {cells.length > 0 && (
            <dl className="ln-dr-kpis">
              {cells.map(([h, v, tail]) => <div key={h}><dt>{h}</dt><dd className={String(v).length > 12 ? "ln-dr-long" : "cl-num"}>{v}</dd>{tail && <dd className="ln-dr-k2">{tail.replace(/^ · /, "")}</dd>}</div>)}
            </dl>
          )}
          {hist.some((v) => v != null) && (
            <section className="ln-dr-sec">
              <div className="ln-dr-sech"><h3>14일 기록</h3><span>{[okN && `성공 ${okN}`, badN && `실패 ${badN}`].filter(Boolean).join(" · ")}</span></div>
              <Strip history={hist} days={d.days} big />
              {d.days?.length > 0 && <div className="ln-dr-axis cl-num"><span>{md(d.days[0])}</span><span>{md(d.days[Math.floor(d.days.length / 2)])}</span><span>{md(d.days[d.days.length - 1])}</span></div>}
            </section>
          )}
          {q.isLoading ? <Loading /> : q.isError ? (q.error?.status === 404 ? <p className="hd-note">흐름에서 사라진 항목</p> : <Failed q={q} what="상세" />) : det && (
            <>
              {det.runs?.length > 0 && (
                <section className="ln-dr-sec">
                  <h3>실행 이력</h3>
                  <table className="ln-dr-runs">
                    <thead><tr><th scope="col">날짜</th><th scope="col">구분</th><th scope="col">결과</th><th scope="col">실패 태스크</th><th scope="col" className="cl-n">소요</th></tr></thead>
                    <tbody>
                      {det.runs.map((r, i) => {
                        const [k, txt] = RUN_STATE[r.state] || ["unknown", r.state || "—"];
                        const s = kst(r.start);
                        const t0 = Date.parse(r.start), t1 = Date.parse(r.end);
                        const sec = t1 >= t0 ? (t1 - t0) / 1e3 : null;
                        return (
                          <tr key={i}>
                            <td className="cl-num">{s ? `${md(s.d)} ${s.hm}` : "—"}</td>
                            <td>{RUN_TYPE[r.run_type] || r.run_type || "—"}</td>
                            <td><i aria-hidden="true" className="ln-g" style={{ color: qOf(k).c }}>{qOf(k).g}</i>{txt}</td>
                            <td>{r.failed_task || ""}</td>
                            <td className="cl-n cl-num">{dur(sec) || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </section>
              )}
              <section className="ln-dr-two">
                {list("이전 단계", det.upstream)}
                {list("이후 단계", det.downstream)}
              </section>
              {det.screens?.length > 0 && (
                <section className="ln-dr-screens">
                  <h3>영향 화면 {det.screens.length}</h3>
                  <div>{det.screens.map((p) => <Link key={p} to={p}>{screenName(p)}</Link>)}</div>
                </section>
              )}
            </>
          )}
        </div>
        <div className={`ln-dr-foot${air && det?.airflow_path ? "" : " ln-desk"}`}>
          <button type="button" className="cl-btn-ghost ln-desk" onClick={onPath}>흐름 경로</button>
          {air && det?.airflow_path && (
            <>
              <a href={`${air.replace(/\/$/, "")}${det.airflow_path}`} target="_blank" rel="noreferrer">Airflow 상세</a>
              <span>내부망 전용</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Lineage() {
  const q = useLineage();
  const d = q.data;
  const [sp] = useSearchParams();
  const loc = useLocation();
  const navigate = useNavigate();
  const nodeId = sp.get("node");
  const [stage, setStage] = useState(1);
  const [sel, setSel] = useState(nodeId);
  const graphRef = useRef(null);
  const opener = useRef(null);
  const prevNode = useRef(nodeId);

  const m = useMemo(() => {
    if (!d?.nodes) return null;
    const byId = Object.fromEntries(d.nodes.map((n) => [n.id, n]));
    const fwd = new Map(), back = new Map();
    (d.edges || []).filter((e) => byId[e.from] && byId[e.to]).forEach((e) => {
      fwd.set(e.from, [...(fwd.get(e.from) || []), e.to]);
      back.set(e.to, [...(back.get(e.to) || []), e.from]);
    });
    return { byId, fwd, back, L: layout(d), ref: refDay(d), stages: d.stages || [] };
  }, [d]);

  useEffect(() => { if (nodeId) setSel(nodeId); }, [nodeId]);
  // 상세 창이 닫히면 연 자리로 초점 복귀
  useEffect(() => {
    const was = prevNode.current;
    prevNode.current = nodeId;
    if (!was || nodeId) return;
    const el = opener.current?.isConnected && opener.current.offsetParent !== null ? opener.current
      : [...document.querySelectorAll(`[data-node="${CSS.escape(was)}"]`)].find((x) => x.offsetParent !== null);
    el?.focus({ preventScroll: true });
    opener.current = null;
  }, [nodeId]);

  const setNode = useCallback((id, push) => {
    const n = new URLSearchParams(window.location.search);
    if (id) n.set("node", id); else n.delete("node");
    navigate({ search: `?${n}` }, { replace: !push, state: push ? { ...(loc.state || {}), node: true } : loc.state });
  }, [navigate, loc.state]);
  const open = useCallback((id, el) => {
    opener.current = el || document.activeElement;
    setSel(id);
    setNode(id, !nodeId);
  }, [nodeId, setNode]);
  const close = useCallback(() => {
    if (loc.state?.node && window.history.state?.idx > 0) navigate(-1);
    else setNode(null, false);
  }, [loc.state, navigate, setNode]);
  const showPath = (id) => {
    setSel(id);
    graphRef.current?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  };

  if (q.isLoading) return <Loading />;
  if (q.isError) return <Failed q={q} what="데이터 흐름" />;
  if (!d?.nodes?.length) return <div className="cl-panel"><EmptyState title="흐름 없음" body="DB·Airflow 연결이 돌아오면 표시됩니다." /></div>;
  const sp2 = { d, m, stage, setStage, onOpen: open };
  return (
    <div className="cl-stack ln">
      <Check d={d} m={m} onPath={showPath} onOpen={open} />
      <Kpis d={d} m={m} />
      <Graph {...sp2} sel={sel && m.byId[sel] ? sel : null} setSel={setSel} graphRef={graphRef} />
      <StageTable {...sp2} />
      <MobileList {...sp2} />
      {nodeId && <NodeDrawer id={nodeId} d={d} m={m} onClose={close} onPick={(id) => { setSel(id); setNode(id, false); }}
        onPath={() => { close(); showPath(nodeId); }} />}
    </div>
  );
}
