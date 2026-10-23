import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { useAccounts, usePositions } from "../lib/queries.js";
import { GLOSSARY } from "./glossary.js";
import { SCOPES, useOpenItem } from "./parts.jsx";
import { dLabel, manAbs, shortName } from "./format.js";

/* 찾기(Ctrl+K) — 보유 종목 · 계좌 유형 · 화면 · 용어 · 판 종목을 한 입력칸에서. 대상이 백 건 안팎이라 브라우저에서 거른다. */

const SEP = /[\s()[\]&._\-/]/;
const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const isJamo = (c) => c >= "ㄱ" && c <= "ㅎ";
const isHangul = (c) => c >= "가" && c <= "힣";
/** 음절 → 초성. 한글 음절이 아니면 그대로 */
const cho1 = (c) => (isHangul(c) ? CHO[Math.floor((c.charCodeAt(0) - 0xac00) / 588)] : c);
/** 소문자 + 공백과 ()[]&._-/ 제거. "미국 S&P" → "미국sp" */
const norm = (s) => [...String(s ?? "").toLowerCase()].filter((c) => !SEP.test(c)).join("");
const script = (c) => (isHangul(c) || isJamo(c) ? "k" : /[a-z]/.test(c) ? "a" : /\d/.test(c) ? "d" : "o");

/** 검색 대상 한 건 → + { nl: 정규화 이름, map: 정규화 → 원문 위치, ws: 단어 시작 위치, keysN, codeN } */
function prep(e) {
  const src = [...String(e.label).toLowerCase()];
  let nl = "";
  const map = [];
  const ws = [];
  src.forEach((c, i) => {
    if (SEP.test(c)) return;
    const prev = src[i - 1];
    // 단어 시작 = 맨 앞 · 구분자 뒤 · 글자 종류가 바뀌는 자리("미국S&P" 의 S)
    if (i === 0 || SEP.test(prev) || (script(prev) !== script(c) && script(c) !== "d")) ws.push(nl.length);
    map.push(i);
    nl += c;
  });
  return { ...e, nl, map, ws, keysN: (e.keys || []).map(norm), codeN: e.code ? String(e.code).toLowerCase() : null };
}

/** 질의에 자모가 섞여 있으면 그 글자는 초성과 비교한다("엔ㅂ" — 조합 중인 글자도 맞춘다) */
function findLoose(nl, q) {
  outer: for (let i = 0; i + q.length <= nl.length; i += 1) {
    for (let k = 0; k < q.length; k += 1) {
      const c = nl[i + k];
      if (!(c === q[k] || (isJamo(q[k]) && cho1(c) === q[k]))) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * 일치 점수 { s, hit:[정규화 시작, 길이] | null } | null. q = 정규화 질의.
 * 코드 완전 일치 5 > 이름 같음 4.5 > 이름·코드 앞부분 4 > 단어 앞부분 3 > 포함 2 > 초성 1(단어 시작 1.5). 보조 키워드는 앞부분 일치만 3.
 */
function scoreOf(e, q) {
  if (!q) return null;
  let best = null;
  const take = (s, hit) => { if (!best || s > best.s) best = { s, hit }; };
  if (e.codeN) {
    if (e.codeN === q) take(5, null);
    else if (e.codeN.startsWith(q)) take(4, null);
  }
  if ([...q].some(isJamo)) {
    const i = findLoose(e.nl, q);
    if (i >= 0) take(e.ws.includes(i) ? 1.5 : 1, [i, q.length]);
  } else {
    const i = e.nl.indexOf(q);
    if (i === 0) take(e.nl === q ? 4.5 : 4, [0, q.length]);
    else if (i > 0) {
      const w = e.ws.find((p) => e.nl.startsWith(q, p));
      take(w != null ? 3 : 2, [w ?? i, q.length]);
    }
    // 보조 키워드 가운데 일치는 잡음("금" → '분배금')
    if (e.keysN.some((k) => k.startsWith(q))) take(3, null);
  }
  return best;
}

const GROUPS = [
  ["hold", "보유 종목"], ["acct", "계좌"], ["screen", "화면"], ["term", "용어"], ["closed", "매도한 종목"],
];
const PER_GROUP = 5;
// 용어는 단어 앞부분 일치 이상만
const MIN_SCORE = { term: 3 };

/** 화면·하위 탭. top = 빈 질의일 때 바로가기 */
const SCREENS = [
  { id: "s:/", label: "홈", url: "/", top: true, keys: ["총자산", "요약", "점검", "기간 증감", "월간 변화", "납입 목표"] },
  { id: "s:/performance", label: "성과", url: "/performance", top: true, keys: ["수익률", "운용 수익률", "총수익률"] },
  { id: "s:/portfolio", label: "보유", url: "/portfolio", top: true, keys: ["잔고", "보유 종목", "종목", "계좌"] },
  { id: "s:/trades", label: "매매", url: "/trades", top: true, keys: ["매수", "매도", "거래", "실현손익"] },
  { id: "s:/allocation", label: "배분", url: "/allocation", top: true, keys: ["자산배분", "비중"] },
  { id: "s:/dividend", label: "배당", url: "/dividend", top: true, keys: ["분배금"] },
  { id: "s:/performance?tab=ret", label: "수익률", parent: "성과", url: "/performance", keys: ["내 돈 수익률", "twr", "mwr"] },
  { id: "s:/allocation?tab=contrib#ledger", label: "입출금 내역", parent: "배분", url: "/allocation?tab=contrib#ledger", keys: ["입출금", "기록", "입금", "출금", "누락", "재산정"] },
  { id: "s:/performance#causes", label: "원인", parent: "성과", url: "/performance#causes", keys: ["왜", "변화 요인", "종목별 기여"] },
  { id: "s:/allocation#concentration", label: "쏠림 점검", parent: "배분", url: "/allocation#concentration", keys: ["집중", "상위 5종목", "외화 비중"] },
  { id: "s:/allocation?tab=status", label: "목표 대비", parent: "배분", url: "/allocation", keys: ["현황", "범위 밖", "묶음 비중"] },
  { id: "s:/allocation?tab=settings", label: "목표 설정", parent: "배분", url: "/allocation?tab=settings", keys: ["목표 비중"] },
  { id: "s:/allocation?tab=contrib", label: "납입", parent: "배분", url: "/allocation?tab=contrib", keys: ["납입 한도", "세액공제"] },
  { id: "s:/allocation?tab=rebal", label: "리밸런싱", parent: "배분", url: "/allocation?tab=rebal", keys: ["매수 매도 계획"] },
].map((s) => ({ ...s, g: "screen", sub: s.parent ? `${s.parent} › ${s.label}` : "화면" }));

const SCOPE_NAME = Object.fromEntries(SCOPES);

/**
 * 검색 대상 목록. 계좌는 유형 라벨로만(계좌명에 회사명이 들어 있다). 보유 종목은 현금성을 뺀다(시세 드로어가 없다).
 */
function buildIndex({ positions = [], accounts = [], closed = [] } = {}) {
  const held = new Set();
  const hold = positions.filter((p) => p.asset_type !== "CASH").map((p) => {
    held.add(p.product_code);
    const label = shortName(p.product_name) || p.product_name;
    return {
      id: `h:${p.product_code}`, g: "hold", label, title: p.product_name, code: p.product_code, ev: Number(p.eval_krw) || 0,
      keys: label === p.product_name ? [] : [p.product_name],
      sub: `${p.product_code} · ${manAbs(p.eval_krw, 0)}만원`, url: `/portfolio?item=${encodeURIComponent(p.product_code)}`, drawer: true,
    };
  });
  const seen = new Set();
  const acct = [];
  accounts.forEach((a) => {
    if (seen.has(a.account_type)) return;
    seen.add(a.account_type);
    const scope = SCOPE_NAME[a.scope_code] ? a.scope_code : null;
    const ev = accounts.filter((x) => x.account_type === a.account_type).reduce((s, x) => s + (Number(x.total_evaluation_krw) || 0), 0);
    acct.push({
      id: `a:${a.account_type}`, g: "acct", label: a.account_type_label || a.account_type, code: a.account_type, ev,
      keys: scope ? [SCOPE_NAME[scope]] : ["현금성"],
      sub: scope ? `보유 › ${SCOPE_NAME[scope]} 묶음` : "보유 › 전체(현금성)", url: scope ? `/portfolio?tab=${scope}` : "/portfolio",
    });
  });
  const term = Object.entries(GLOSSARY).map(([k, [t, d, f, ex]]) => ({ id: `t:${k}`, g: "term", label: t, keys: TERM_KEYS[k] || [], sub: "용어", def: d, formula: f, ex }));
  const past = closed.filter((p) => !held.has(p.product_code)).map((p) => ({
    id: `c:${p.product_code}`, g: "closed", label: shortName(p.product_name) || p.product_name, title: p.product_name, code: p.product_code,
    ev: Number(p.peak_krw) || 0, keys: [], sub: `${p.product_code} · 지금은 보유하지 않음`,
    def: `${p.first_held ? dLabel(p.first_held) : "—"} ~ ${p.last_held ? dLabel(p.last_held) : "—"} 보유${p.days_held ? `(${p.days_held}일)` : ""}. 지금은 보유하지 않아 시세 화면이 없습니다.`,
  }));
  return [...hold, ...acct, ...SCREENS, ...term, ...past].map(prep);
}

/** 용어의 옛 이름 — 옛 이름으로 찾아도 나오게 */
const TERM_KEYS = { earnPrice: ["번 돈"], earnTotal: ["번 돈"] };

/**
 * 질의 → [{ g, name, items:[{...entry, s, hit}] }]. 그룹은 최고 점수 순(판 종목은 늘 마지막), 그룹 안은 점수 → 평가금 순, 그룹당 5개.
 */
function search(index, query) {
  const q = norm(query);
  if (!q) return [];
  const by = {};
  index.forEach((e) => {
    const m = scoreOf(e, q);
    if (!m || m.s < (MIN_SCORE[e.g] || 0)) return;
    (by[e.g] ||= []).push({ ...e, s: m.s, hit: m.hit });
  });
  return GROUPS.filter(([g]) => by[g])
    .map(([g, name], order) => {
      const items = by[g].sort((a, b) => b.s - a.s || (b.ev || 0) - (a.ev || 0)).slice(0, PER_GROUP);
      return { g, name, items, top: items[0].s, order };
    })
    .sort((a, b) => (a.g === "closed") - (b.g === "closed") || b.top - a.top || a.order - b.order);
}

/* 최근 연 항목 5개(localStorage · 실패해도 무시) */
const RECENT_KEY = "cl-find-recent";
const readRecent = () => {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
};
const pushRecent = (e) => {
  try {
    const keep = { id: e.id, g: e.g, label: e.label, sub: e.sub, url: e.url, drawer: e.drawer };
    localStorage.setItem(RECENT_KEY, JSON.stringify([keep, ...readRecent().filter((x) => x.id !== e.id)].slice(0, 5)));
  } catch { /* 저장 못 해도 찾기는 된다 */ }
};

/** 이름에서 일치 구간만 <mark> */
function Hl({ e }) {
  if (!e.hit || !e.map) return e.label;
  const [i, n] = e.hit;
  // 원문 첫~끝 글자 사이를 통째로 — 정규화로 빠진 글자("S&P" 의 &)도 함께
  const a = e.map[i];
  const z = e.map[i + n - 1];
  const out = [];
  [...String(e.label)].forEach((c, k) => {
    const m = k >= a && k <= z;
    const last = out[out.length - 1];
    if (last && last.m === m) last.t += c; else out.push({ m, t: c });
  });
  return out.map((r, k) => (r.m ? <mark key={k}>{r.t}</mark> : <Fragment key={k}>{r.t}</Fragment>));
}

/** 찾기 팔레트(대화상자). onGo(항목) = 화면·종목으로 이동 */
function Palette({ onClose, onGo }) {
  const uid = useId();
  const listId = `${uid}-list`;
  const [q, setQ] = useState("");
  const [act, setAct] = useState(0);
  const [openDef, setOpenDef] = useState(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  // 보유 화면·드로어와 같은 쿼리 키 — 캐시를 나눠 쓴다
  const pq = usePositions("product");
  const aq = useAccounts();
  const cq = useQuery({ queryKey: ["positions", "closed"], queryFn: () => api.get("/positions?status=closed"), staleTime: 5 * 60e3 });
  const index = useMemo(
    () => buildIndex({ positions: pq.data?.positions, accounts: aq.data, closed: cq.data?.positions }),
    [pq.data, aq.data, cq.data],
  );
  const groups = useMemo(() => {
    if (norm(q)) return search(index, q);
    const byId = Object.fromEntries(index.map((e) => [e.id, e]));
    const recent = readRecent().map((r) => byId[r.id] || r).filter((r) => r.url);
    const out = [];
    if (recent.length) out.push({ g: "recent", name: "최근 연 항목", items: recent });
    out.push({ g: "screen", name: "화면 바로가기", items: SCREENS.filter((s) => s.top) });
    return out;
  }, [index, q]);
  const flat = useMemo(() => groups.flatMap((g) => g.items.map((e) => ({ ...e, key: `${g.g}:${e.id}` }))), [groups]);
  const count = norm(q) ? flat.length : null;
  const onlyClosed = count > 0 && groups.every((g) => g.g === "closed");
  const loading = pq.isLoading || aq.isLoading;

  useEffect(() => { setAct(0); setOpenDef(null); }, [q]);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [act]);

  const choose = (e) => {
    if (!e) return;
    if (e.g === "term" || e.g === "closed") { setOpenDef((d) => (d === e.id ? null : e.id)); return; }
    pushRecent(e);
    onGo(e);
  };
  const onKey = (ev) => {
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      if (flat.length) setAct((a) => (a + (ev.key === "ArrowDown" ? 1 : -1) + flat.length) % flat.length);
    } else if (ev.key === "Enter") {
      // 한글 조합 중 Enter 는 글자 확정일 뿐
      if (ev.nativeEvent.isComposing || ev.keyCode === 229) return;
      ev.preventDefault();
      choose(flat[act]);
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      onClose();
    }
  };
  // Tab 은 대화상자 안에서만 돈다
  const trap = (ev) => {
    if (ev.key !== "Tab") return;
    const f = [...ev.currentTarget.querySelectorAll("input,button:not([disabled])")];
    const i = f.indexOf(document.activeElement);
    ev.preventDefault();
    f[(i + (ev.shiftKey ? -1 : 1) + f.length) % f.length]?.focus();
  };

  let k = -1;
  const actId = flat[act] ? `${uid}-o${act}` : undefined;
  return (
    <div className="cl-find-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cl-find" role="dialog" aria-modal="true" aria-label="찾기" onKeyDown={trap}>
        <div className="cl-find-head">
          <svg className="cl-find-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
          <input ref={inputRef} className="cl-find-input" type="text" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
            role="combobox" aria-expanded={flat.length > 0} aria-controls={listId} aria-activedescendant={actId} aria-autocomplete="list"
            aria-label="종목·계좌 유형·화면·용어 찾기" placeholder="종목, 코드, 초성, 화면 이름" autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="go" />
          <button type="button" className="cl-find-close" onClick={onClose}>
            <span className="cl-find-esc" aria-hidden="true">Esc</span><span className="cl-find-cancel">닫기</span>
          </button>
        </div>
        <div className="cl-find-list" id={listId} role="listbox" aria-label="찾은 항목" ref={listRef}>
          {groups.map((g) => (
            <div key={g.g} role="group" aria-labelledby={`${uid}-g-${g.g}`} className="cl-find-g">
              <div className="cl-find-gh" id={`${uid}-g-${g.g}`}>{g.name}</div>
              {g.items.map((e) => {
                k += 1;
                const i = k;
                const on = i === act;
                const expand = openDef === e.id && (e.g === "term" || e.g === "closed");
                return (
                  <div key={e.id} id={`${uid}-o${i}`} role="option" aria-selected={on} className="cl-find-opt" data-g={e.g}
                    aria-expanded={e.g === "term" || e.g === "closed" ? expand : undefined}
                    onMouseMove={() => !on && setAct(i)} onClick={() => { setAct(i); choose(e); }}>
                    <div className="cl-find-row">
                      <span className="cl-find-nm" title={e.title}><Hl e={e} /></span>
                      <span className="cl-find-sub">{e.sub}</span>
                    </div>
                    {expand && (
                      <div className="cl-find-def">
                        <p>{e.def}</p>
                        {e.formula && <p className="cl-find-f">{e.formula}</p>}
                        {e.ex && <p className="cl-find-ex">{e.ex}</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {count === 0 && (
            <p className="cl-find-empty">
              {loading ? "종목을 불러오는 중…" : <>‘{q.trim()}’와 맞는 종목·화면이 없습니다. 종목 코드나 초성으로도 찾을 수 있어요.</>}
            </p>
          )}
          {onlyClosed && <p className="cl-find-note">보유 종목 없음 · 매도한 종목만</p>}
        </div>
        <div className="cl-find-foot" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> 이동</span><span><kbd>Enter</kbd> 열기</span><span><kbd>Esc</kbd> 닫기</span></div>
        <div className="cl-find-sr" aria-live="polite">{count == null ? "" : loading && count === 0 ? "" : `결과 ${count}개`}</div>
      </div>
    </div>
  );
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** 헤더 찾기 버튼 + 전역 단축키(Ctrl/⌘+K · /) + 팔레트 */
export function Find() {
  const [open, setOpen] = useState(false);
  const btn = useRef(null);
  const opener = useRef(null);
  const navigate = useNavigate();

  const openRef = useRef(false);
  openRef.current = open;
  const show = useCallback(() => { opener.current = document.activeElement; setOpen(true); }, []);
  const close = useCallback(() => {
    setOpen(false);
    const el = opener.current?.isConnected && opener.current !== document.body ? opener.current : btn.current;
    requestAnimationFrame(() => el?.focus());
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      const typing = t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      const k = (e.key || "").toLowerCase();
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && k === "k") {
        e.preventDefault();
        if (openRef.current) close(); else show();
        return;
      }
      if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // 다른 대화상자가 떠 있으면 / 는 그쪽 것
        if (document.querySelector('[aria-modal="true"]')) return;
        e.preventDefault();
        show();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [show, close]);

  // 보유 종목은 지금 화면 위에 시세 드로어로(닫히면 초점은 찾기 버튼으로)
  const openItem = useOpenItem();

  const go = (e) => {
    setOpen(false);
    if (e.drawer) {
      // 최근 기록의 주소에서 코드만 꺼낸다
      openItem(new URLSearchParams(e.url.split("?")[1] || "").get("item"), btn.current);
    } else {
      navigate(e.url);
      requestAnimationFrame(() => btn.current?.focus());
    }
  };

  return (
    <>
      <button type="button" ref={btn} className="cl-find-btn" aria-haspopup="dialog" aria-expanded={open}
        aria-label="찾기 — 종목·계좌 유형·화면·용어" aria-keyshortcuts={isMac ? "Meta+K /" : "Control+K /"} onClick={show}>
        <svg className="cl-find-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
        <span className="cl-find-lbl" aria-hidden="true">찾기</span>
        <kbd className="cl-find-kbd" aria-hidden="true">{isMac ? "⌘" : "Ctrl"} K</kbd>
      </button>
      {/* 헤더의 쌓임 맥락 밖(.cl-app 바로 아래)에 띄워야 탭바·드로어 위에 뜬다 */}
      {open && createPortal(<Palette onClose={close} onGo={go} />, btn.current?.closest(".cl-app") || document.body)}
    </>
  );
}
