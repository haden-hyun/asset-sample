/* 금액·비율·날짜·단가·수량 표기 */
export const MINUS = "−";
const WD = ["일", "월", "화", "수", "목", "금", "토"];

/** 원 단위 정수 "12,300" */
export const won = (v) => Math.round(v || 0).toLocaleString("ko-KR");
/** 부호 붙은 원 단위 정수 — "+12,300" · "−4,500" · "0" */
export const sWon = (v) => (v > 0 ? "+" : v < 0 ? MINUS : "") + won(Math.abs(v));
/** 부호 문자 — 소수 dec 자리로 반올림해 0이면 "", 음수는 U+2212 */
export const sgn = (v, dec = 1) => {
  const r = +Math.abs(v || 0).toFixed(dec);
  return r === 0 ? "" : v > 0 ? "+" : MINUS;
};
/** 만 원 단위 절댓값 "1,234.5" */
export const manAbs = (v, dec = 1) =>
  (Math.abs(v || 0) / 1e4).toLocaleString("ko-KR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
/** 부호 붙은 만 원 단위 "+1,234.5" */
export const sMan = (v, dec = 1) => sgn((v || 0) / 1e4, dec) + manAbs(v, dec);
/** 카드 금액 → [숫자, 단위]. 1억 이상 "3.12"+"억", 100만 이상 "4,820"+"만", 그 아래 "18.4"+"만", 값 없음 "—" */
export const krwParts = (v) => {
  if (v == null || Number.isNaN(+v)) return ["—", ""];
  const a = Math.abs(+v);
  if (a < 50) return ["0", ""];
  // 반올림한 값으로 단위를 정한다(99,995,000 → 1.00억)
  if (Math.round(a / 1e6) >= 100) return [(a / 1e8).toFixed(2), "억"];
  if (Math.round(a / 1e3) >= 1000) return [manAbs(a, 0), "만"];
  return [manAbs(a, 1), "만"];
};
/** 카드 금액 "4,820만" · "−1.02억" */
export const krw = (v) => {
  const [n, u] = krwParts(v);
  return (v < 0 && n !== "0" ? MINUS : "") + n + u;
};
/** 부호 붙은 카드 금액 — "+184만" · "−1.02억". 0 으로 반올림되면 부호 없음, 값 없음은 "—" */
export const sKrw = (v) => {
  const [n, u] = krwParts(v);
  return (n === "0" || n === "—" ? "" : v > 0 ? "+" : MINUS) + n + u;
};
/** 비중 — 분모가 0이면 "—"(NaN%·Infinity% 대신) */
export const share = (v, T, dec = 1) => (T ? `${((v / T) * 100).toFixed(dec)}%` : "—");
/** 비율(0.05) → "+5.0%" */
export const pct = (v, dec = 1) => sgn((v || 0) * 100, dec) + Math.abs((v || 0) * 100).toFixed(dec) + "%";
/** 이미 퍼센트(5.0) → "+5.0%" */
export const pctP = (p, dec = 1) => sgn(p, dec) + Math.abs(p || 0).toFixed(dec) + "%";
/** 방향 → 'up' | 'down' | 'flat' (클래스 cl-up·cl-down·cl-flat 에 쓴다) */
export const dir = (v) => (Math.abs(v || 0) < 1e-9 ? "flat" : v > 0 ? "up" : "down");

/** 'YYYY-MM-DD…' → 그날 0시(UTC) 밀리초. 날짜 계산은 모두 UTC 기준 */
export const isoMs = (iso) => Date.parse(String(iso).slice(0, 10) + "T00:00:00Z");
const D = (iso) => new Date(isoMs(iso));
/** "10월 13일(월)" */
export const dLabel = (iso) => {
  const d = D(iso);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일(${WD[d.getUTCDay()]})`;
};
/** "10/13" */
export const md = (iso) => {
  const d = D(iso);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};
export const monthOf = (iso) => +String(iso).slice(5, 7);
/** 기준일 이후 올해 남은 달 수(최소 1) */
export const monthsLeft = (asOf) => Math.max(1, 12 - monthOf(asOf));
/** 연 지급 횟수 → 주기 이름 */
export const FREQ_NAME = { 12: "월", 4: "분기", 2: "반기", 1: "연" };
/** 축 라벨 "3억" · "4,820만" */
export const axWon = (v) =>
  Math.abs(v) >= 1e8
    ? (v / 1e8).toFixed(Math.round(v / 1e7) % 10 === 0 ? 0 : 1) + "억"
    : Math.round(v / 1e4).toLocaleString("ko-KR") + "만";
/** raw 이상인 가장 작은 1·2·2.5·5×10ⁿ */
export function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
/** 긴 펀드명에서 괄호·클래스 표기를 걷어낸다 */
export const shortName = (n) =>
  String(n || "")
    .replace(/\[.*?\]/g, "")
    .replace(/_?C-?[Pp]e.*$/, "")
    .replace(/증권자투자신탁/, "")
    .trim();

/* 단가·수량 — a = { cur: 통화, mul: 수량 배수(펀드 0.001), crypto: 가상자산 여부 } */
export const isFund = (a) => Math.abs((a.mul || 1) - 1) > 1e-9;
/** 원통화 단가. 펀드(1,000좌 기준가)·미국($)은 소수 2자리 */
export const px = (v, a) =>
  a.cur === "USD"
    ? "$" + (v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : (v || 0).toLocaleString("ko-KR", { maximumFractionDigits: isFund(a) ? 2 : Math.abs(v) < 100 ? 2 : 0 });
/** 짧은 단가 — 10만 원 이상은 만·억으로 */
export const pxShort = (v, a) =>
  a.cur !== "USD" && !isFund(a) && Math.abs(v) >= 1e5
    ? Math.abs(v) >= 1e8 ? (v / 1e8).toFixed(2) + "억" : manAbs(v) + "만"
    : px(v, a);
/** 수량 단위 — 펀드 좌 · 가상자산 개(소수 8자리) · 그 외 주 */
export const qtyUnit = (a) => (isFund(a) ? "좌" : a.crypto ? "개" : "주");
export const qtyNum = (q, a) =>
  a.crypto ? (q || 0).toFixed(8) : (q || 0).toLocaleString("ko-KR", { maximumFractionDigits: 4 });
/** 짧은 수량 — 펀드 좌수는 만좌로 */
export const qtyShort = (q, a) => (isFund(a) ? manAbs(q, 0) + "만좌" : qtyNum(q, a) + qtyUnit(a));
/** 매매 수량(asset_type 기준) — 펀드 좌 · 가상자산 개 · 그 외 주. short = 카드용(펀드 1만좌 이상은 만좌 — 100만좌부터 정수, 코인은 유효 3자리) */
export const tradeQty = (q, type, short = false) => {
  if (type === "FUND") return short && q >= 1e4 ? manAbs(q, q >= 1e6 ? 0 : 1) + "만좌" : won(q) + "좌";
  if (type === "CRYPTO") return (+q).toLocaleString("ko-KR", short ? { maximumSignificantDigits: 3 } : { maximumFractionDigits: 8 }) + "개";
  return won(q) + "주";
};
