"""합성 원천 생성기 — spec.py 설계값 → 샘플 DB 에 COPY 할 CSV (기획 SAMPLE_SITE_PLAN §2).

표준 라이브러리만 쓰고 운영 DB 에 접속하지 않는다. 휴장일은 holidays.csv(공개 정보)로 고정했다.

  python3 scripts/sample/generate.py [출력 폴더]    # 기본 scripts/sample/out/

- 결정적: SEED 고정, 종목별 Random(SEED ^ crc32(code)), 금액은 Decimal, 출력 행은 키 순 정렬.
  같은 코드로 두 번 돌리면 manifest 의 sha256 이 같다.
- 시세: 시장 요인을 공유하는 GBM(ρ) → 브라운 브리지로 시작·기준일(·첫 매수일) 목표가에 맞춘다.
- 원가: 기간 전부터 들고 있던 잔고의 평균단가 c0 을 풀어 기준일 손익률을 spec 값에 맞춘다
  (매수 후 평균단가는 c0 에 대해 1차식이라 두 번 시뮬레이션으로 푼다).
- 예수금: 매매일에 순매수만큼(1만 원 단위 올림) 입금하고 순매도면 1만 원 단위로 출금, 배당은 다음 매매에 쓴다.
  기준일 잔고가 계좌 끝수를 흡수하고, 전체 끝수는 CMA 가 흡수해 합계가 정확히 1억이 된다.
"""

import csv
import hashlib
import io
import json
import math
import sys
import zlib
from bisect import bisect_left, bisect_right
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from decimal import ROUND_FLOOR, ROUND_HALF_UP, Decimal
from pathlib import Path
from random import Random

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent))
import spec  # noqa: E402

D = Decimal
HERE = Path(__file__).resolve().parent
ONE_DAY = timedelta(days=1)


def _source_codes() -> dict[str, str]:
    """원천 테이블의 source·price_source 값. 원천 스키마 CHECK 제약 값은 source_codes.json(사설 저장소에만 둔다)에서
    읽고, 없으면(공개판) 중립 코드를 쓴다 — 공개판은 DB 에 싣지 않으므로 생성물 모양만 같으면 된다."""
    path = HERE / "source_codes.json"
    if path.is_file():
        return json.loads(path.read_text(encoding="utf-8"))
    return {k: f"SRC_{k}" for k in ("KR_DAILY", "US_DAILY", "CRYPTO_DAY", "FX_DAILY", "KR_INDEX", "US_INDEX")}


SRC = _source_codes()

# (테이블, 열) — load.sh 가 이 순서(FK 순)로 COPY 한다
TABLES = [
    ("account.account_master", ["account_code", "account_name", "financial_institution", "account_type", "is_active",
                                "insert_datetime"]),
    ("market.product", ["product_code", "product_name", "asset_type", "market", "exchange_code", "currency_code",
                        "price_source", "source_symbol", "first_held_date", "last_held_date", "is_tracked",
                        "price_from_date", "insert_datetime", "update_datetime"]),
    ("market.trading_holiday", ["market", "holiday_date", "name", "source", "is_manual", "insert_datetime"]),
    ("market.exchange_rate_daily", ["standard_date", "source_symbol", "currency_code", "currency_pair_name", "base_rate",
                                    "previous_day_closing_price", "opening_price", "highest_price", "lowest_price",
                                    "insert_datetime", "source", "update_datetime"]),
    ("market.index_daily", ["standard_date", "index_code", "market", "opening_price", "highest_price", "lowest_price",
                            "closing_price", "source", "insert_datetime", "update_datetime"]),
    ("market.product_price_daily", ["standard_date", "product_code", "opening_price", "highest_price", "lowest_price",
                                    "closing_price", "trading_volume", "currency_code", "source", "insert_datetime",
                                    "update_datetime"]),
    ("market.fund_price_daily", ["standard_date", "product_code", "product_name", "standard_price", "insert_datetime"]),
    ("market.dividend_event", ["product_code", "record_date", "dividend_type", "market", "product_name",
                               "dividend_label", "ex_date", "pay_date", "per_share_dividend_amount", "currency_code",
                               "dividend_rate", "is_confirmed", "announce_date", "source", "last_seen_date",
                               "insert_datetime", "update_datetime"]),
    ("account.asset_daily", ["standard_date", "account_code", "account_name", "product_code", "product_name",
                             "asset_type", "currency_code", "exchange_code", "multiplier", "holding_quantity",
                             "unit_purchase_price", "unit_market_price", "total_purchase_amount",
                             "total_evaluation_amount", "total_profit_amount", "valuation_profit_rate",
                             "insert_datetime"]),
    ("account.manual_position_ledger", ["standard_date", "account_code", "product_code", "holding_quantity",
                                        "total_purchase_amount", "insert_datetime"]),
    ("account.dividend_receipt", ["account_code", "product_code", "record_date", "right_type_code", "product_name",
                                  "ex_date", "pay_date", "holding_quantity", "gross_amount", "tax_amount",
                                  "currency_code", "exchange_rate", "is_estimated", "source", "last_seen_date",
                                  "insert_datetime", "update_datetime"]),
    ("dashboard.portfolio_scope", ["scope_code", "scope_name", "note", "insert_datetime"]),
    ("dashboard.account_type", ["account_type", "label", "tax_bucket", "horizon", "liquidity", "note",
                                "insert_datetime"]),
    ("dashboard.portfolio_scope_account", ["scope_code", "account_code"]),
    ("dashboard.allocation_category", ["category_id", "scope_code", "category_name", "target_ratio", "sort_order",
                                       "is_active", "insert_datetime"]),
    ("dashboard.allocation_category_product", ["category_id", "product_code", "weight"]),
    ("dashboard.savings_goal", ["goal_year", "goal_key", "label", "target_krw", "scope_kind", "scope_value",
                                "sort_order", "note", "insert_datetime"]),
    ("dashboard.rebalance_log", ["run_id", "run_date", "scope_code", "input_amount", "result_json", "insert_datetime",
                                 "mode"]),
]
# 정렬 키로 쓸 앞쪽 열 수(테이블 PK 와 같은 열)
SORT_KEYS = {
    "account.asset_daily": (0, 1, 3), "market.exchange_rate_daily": (0, 1), "market.index_daily": (1, 0),
    "market.product_price_daily": (1, 0), "market.fund_price_daily": (1, 0), "market.dividend_event": (0, 1, 2),
    "account.dividend_receipt": (0, 1, 2, 3), "account.manual_position_ledger": (1, 0),
    "market.trading_holiday": (0, 1), "dashboard.portfolio_scope_account": (0, 1),
    "dashboard.allocation_category_product": (0, 1), "dashboard.savings_goal": (0, 1),
}


# ── 공통 ────────────────────────────────────────────────────────────


def rng(key: str) -> Random:
    return Random(spec.SEED ^ zlib.crc32(key.encode()))


def quant(x, step: Decimal) -> Decimal:
    """x 를 step 단위로 반올림(step 은 Decimal)."""
    return ((D(repr(x)) if isinstance(x, float) else D(x)) / step).quantize(D(1), ROUND_HALF_UP) * step


def won(x) -> Decimal:
    return quant(x, D(1))


def stamp(d: date, minute: int = 5, second: int = 0) -> datetime:
    """적재 시각(기준일 07시대) — 고정값이라 결정적이다."""
    return datetime.combine(d, time(7, minute, second))


def days(a: date, b: date):
    d = a
    while d <= b:
        yield d
        d += ONE_DAY


def month_starts(a: date, b: date):
    y, m = a.year, a.month
    while date(y, m, 1) <= b:
        yield y, m
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


# ── 달력 ────────────────────────────────────────────────────────────


class Calendar:
    """KR·US 평일 휴장일(holidays.csv) + 주말. 2025 년 이전은 주말만 본다(배당 일정용)."""

    def __init__(self, path: Path = HERE / "holidays.csv"):
        self.rows = []
        self.hol = {"KR": set(), "US": set()}
        with open(path, encoding="utf-8") as f:
            for r in csv.DictReader(f):
                d = date.fromisoformat(r["holiday_date"])
                self.hol[r["market"]].add(d)
                self.rows.append((r["market"], d, r["name"]))

    def is_open(self, market: str, d: date) -> bool:
        return d.weekday() < 5 and d not in self.hol[market]

    def sessions(self, market: str, a: date, b: date) -> list[date]:
        return [d for d in days(a, b) if self.is_open(market, d)]

    def next_open(self, market: str, d: date) -> date:
        while not self.is_open(market, d):
            d += ONE_DAY
        return d

    def prev_open(self, market: str, d: date) -> date:
        while not self.is_open(market, d):
            d -= ONE_DAY
        return d

    def nth_open_of_month(self, market: str, y: int, m: int, n: int) -> date:
        d = date(y, m, 1)
        k = 0
        while True:
            if self.is_open(market, d):
                k += 1
                if k == n:
                    return d
            d += ONE_DAY

    def last_open_of_month(self, market: str, y: int, m: int) -> date:
        nxt = date(y + (m == 12), 1 if m == 12 else m + 1, 1)
        return self.prev_open(market, nxt - ONE_DAY)


# ── 시세 경로 ────────────────────────────────────────────────────────


def bridge(raw: list[float], anchors: dict[int, float]) -> list[float]:
    """누적 로그 경로 raw 를 앵커(인덱스 → 로그값) 사이 구간마다 브라운 브리지로 맞춘다."""
    idx = sorted(anchors)
    out = list(raw)
    for a, b in zip(idx, idx[1:]):
        va, vb = anchors[a], anchors[b]
        drift = (raw[b] - raw[a]) - (vb - va)
        for i in range(a, b + 1):
            out[i] = va + (raw[i] - raw[a]) - drift * (i - a) / (b - a)
    return out


def tick(code: str, p: dict, x: float) -> Decimal:
    kind = p["kind"]
    if kind == "KR":
        if p.get("etf"):
            step = 5
        else:
            step = next(s for lim, s in ((2000, 1), (5000, 5), (20000, 10), (50000, 50), (200000, 100),
                                         (500000, 500), (float("inf"), 1000)) if x < lim)
        return max(quant(x, D(step)), D(step))
    if kind == "US":
        return max(quant(x, D("0.01")), D("0.01"))
    if kind == "FUND":
        return quant(x, D("0.01"))
    if kind == "CRYPTO":
        return quant(x, D(1000) if x >= 2_000_000 else D(500))
    return quant(x, D(10))  # GOLD 원/g


class Market:
    """세션 목록과 시장 요인(KR·US) — 지수와 종목이 같은 요인을 공유해 상관 ρ 가 생긴다."""

    def __init__(self, cal: Calendar):
        self.cal = cal
        self.sessions = {
            "KR": cal.sessions("KR", spec.PRICE_FROM, spec.END),
            # 미국 종가는 한국 날짜 하루 뒤에 쓰므로 기준일 전날까지
            "US": cal.sessions("US", spec.PRICE_FROM, spec.END - ONE_DAY),
            # 가상자산 일봉(09:00 시작) — 기준일 07:00 값은 전날 일봉 종가
            "CRYPTO": list(days(spec.PRICE_FROM, spec.END - ONE_DAY)),
        }
        self.factor = {}
        for m in ("KR", "US"):
            r = rng(f"MARKET:{m}")
            self.factor[m] = [r.gauss(0, 1) for _ in self.sessions[m]]


def price_market(p: dict) -> str:
    return {"KR": "KR", "FUND": "KR", "GOLD": "KR", "US": "US", "CRYPTO": "CRYPTO"}[p["kind"]]


def as_of_session(sessions: list[date], kind: str, d: date) -> int:
    """d(한국 날짜) 잔고에 쓰는 세션 인덱스. 미국·가상자산은 d 전날까지, 국내는 d 이하 마지막."""
    if kind in ("US", "CRYPTO"):
        return bisect_left(sessions, d) - 1
    return bisect_right(sessions, d) - 1


def build_paths(mk: Market) -> dict[str, dict]:
    """종목별 {sessions, close[Decimal], ohlc 재료}."""
    first_rate: dict[str, float] = {}
    opens: dict[str, list[tuple[date, float]]] = defaultdict(list)
    for h in spec.HOLDINGS:
        first_rate.setdefault(h["code"], h["rate"])
        if "opens" in h:
            # 기간 중 처음 산 보유는 c0 로 맞출 수 없으므로 매수일 가격을 목표 평균단가에 붙인다
            buys = [h["opens"]] + [d for d, frac in h.get("events", []) if frac > 0]
            opens[h["code"]] += [(date.fromisoformat(d), h["rate"]) for d in buys]

    out = {}
    for code, p in spec.PRODUCTS.items():
        m = price_market(p)
        ses = mk.sessions[m]
        r = rng(code)
        steps = 365 if p["kind"] == "CRYPTO" else 252
        sd = p["vol"] / math.sqrt(steps)
        fac = mk.factor.get(m) if p["kind"] in ("KR", "US") else None
        raw = [0.0]
        for i in range(1, len(ses)):
            e = r.gauss(0, 1)
            z = spec.RHO * fac[i] + math.sqrt(1 - spec.RHO**2) * e if fac else e
            raw.append(raw[-1] + sd * z)
        end = float(p["end"])
        growth = p.get("growth", first_rate.get(code, 0.0))
        anchors = {0: math.log(end / (1 + growth)), len(ses) - 1: math.log(end)}
        for d, rate in opens.get(code, []):
            i = as_of_session(ses, p["kind"], d)
            if 0 < i < len(ses) - 1:
                anchors[i] = math.log(end / (1 + rate))
        logs = bridge(raw, anchors)
        close = [tick(code, p, math.exp(v)) for v in logs]
        close[-1] = p["end"]
        out[code] = {"sessions": ses, "close": close, "sd": sd}
    return out


def price_on(paths: dict, code: str, d: date) -> Decimal:
    p = spec.PRODUCTS[code]
    s = paths[code]
    i = as_of_session(s["sessions"], p["kind"], d)
    return s["close"][max(i, 0)]


def build_fx(cal: Calendar) -> dict[str, dict[date, Decimal]]:
    """환율 — 국내 영업일에만 움직이고 주말·휴일은 직전 값 이월. 기준일 값은 spec 고정."""
    ses = cal.sessions("KR", spec.PRICE_FROM, spec.END)
    out = {}
    for symbol, cur, _name, end, vol in spec.FX:
        r = rng(f"FX:{symbol}")
        sd = vol / math.sqrt(252)
        raw = [0.0]
        for _ in ses[1:]:
            raw.append(raw[-1] + sd * r.gauss(0, 1))
        start = float(end) * (1 + 0.03 * r.gauss(0, 1))
        logs = bridge(raw, {0: math.log(start), len(ses) - 1: math.log(float(end))})
        step = D("0.0001") if cur == "JPY" else D("0.01")
        vals = {d: quant(math.exp(v), step) for d, v in zip(ses, logs)}
        vals[ses[-1]] = end
        daily, last = {}, None
        for d in days(spec.PRICE_FROM, spec.END):
            last = vals.get(d, last)
            daily[d] = last
        out[cur] = daily
    return out


# ── 보유 시뮬레이션 ──────────────────────────────────────────────────


def mult_of(p: dict) -> Decimal:
    return D("0.001") if p["kind"] == "FUND" else D(1)


def qty_round(p: dict, x) -> Decimal:
    if p["kind"] in ("KR", "US", "FUND"):
        return quant(x, D(1))
    if p["kind"] == "CRYPTO":
        return quant(x, D("0.00000001"))
    return quant(x, D("0.01"))  # GOLD g


def krw_value(p: dict, q: Decimal, px: Decimal, fx: Decimal) -> Decimal:
    v = q * px * mult_of(p)
    return v * fx if p["kind"] == "US" else v


def trade_day(cal: Calendar, p: dict, nominal: date) -> date:
    return nominal if p["kind"] == "CRYPTO" else cal.next_open("KR", nominal)


def monthly_dates(cal: Calendar, p: dict, day: int) -> list[date]:
    out = []
    for y, m in month_starts(spec.START, spec.END):
        d = trade_day(cal, p, date(y, m, day))
        if spec.START < d <= spec.END:
            out.append(d)
    return out


def simulate(cal: Calendar, paths: dict, fx: dict, warnings: list[str]) -> list[dict]:
    """보유마다 일별 수량·평균단가·매매 목록."""
    out = []
    for h in spec.HOLDINGS:
        code, acct = h["code"], h["acct"]
        p = spec.PRODUCTS[code]
        end_px = p["end"]
        end_fx = spec.USD_KRW if p["kind"] == "US" else D(1)
        deltas: list[tuple[date, Decimal]] = []

        if "closed" in h:
            q0 = qty_round(p, h["closed"]["initial"] / (price_on(paths, code, spec.START) * mult_of(p)))
            sell = trade_day(cal, p, date.fromisoformat(h["closed"]["sell"]))
            deltas.append((sell, -q0))
            Q = D(0)
        else:
            Q = qty_round(p, h["value"] / (end_px * mult_of(p) * end_fx))
            day = spec.MANUAL.get(acct, {}).get("day", spec.MONTHLY_DAY)
            if "monthly" in h:
                for d in monthly_dates(cal, p, day):
                    px = price_on(paths, code, d) * mult_of(p) * (fx["USD"][d] if p["kind"] == "US" else 1)
                    dq = qty_round(p, h["monthly"] / px)
                    if p["kind"] == "KR" and dq < 1:
                        dq = D(1)
                    deltas.append((d, dq))
            for nominal, frac in h.get("events", []):
                d = trade_day(cal, p, date.fromisoformat(nominal))
                dq = qty_round(p, Q * D(repr(frac)))
                if dq == 0:
                    dq = D(1) if frac > 0 else D(-1)
                deltas.append((d, dq))
            rest = sum((dq for _, dq in deltas), D(0))
            if "opens" in h:
                d = trade_day(cal, p, date.fromisoformat(h["opens"]))
                deltas.append((d, Q - rest))
                q0 = D(0)
            else:
                q0 = Q - rest
        first = spec.START if q0 > 0 else min(d for d, dq in deltas if dq > 0)
        by_day: dict[date, Decimal] = defaultdict(D)
        for d, dq in deltas:
            by_day[d] += dq

        def run(c0: float) -> tuple[dict[date, tuple[Decimal, float]], float]:
            q, avg, series = q0, c0, {}
            for d in days(first, spec.END):
                dq = by_day.get(d, D(0))
                if dq > 0:
                    px = float(price_on(paths, code, d))
                    avg = (avg * float(q) + px * float(dq)) / float(q + dq)
                q += dq
                if q < 0:
                    raise ValueError(f"{acct}/{code}: {d} 수량 음수 — spec 매도 비율 확인")
                series[d] = (q, avg)
            return series, avg

        if "closed" in h:
            sell_px = float(price_on(paths, code, sell))
            c0 = sell_px / (1 + h["rate"])
        elif q0 > 0:
            target = float(end_px) / (1 + h["rate"])
            _, b = run(0.0)
            _, ab = run(1.0)
            a = ab - b
            if a == 0:
                raise ValueError(f"{acct}/{code}: 기간 전 잔고가 기준일까지 남지 않아 시작 단가를 풀 수 없다 — spec 확인")
            c0 = (target - b) / a
            if c0 <= 0:
                c0 = float(price_on(paths, code, spec.START)) * 0.5
                warnings.append(f"{acct}/{code}: 목표 손익률을 맞출 수 없어 시작 단가를 임의로 둠")
        else:
            c0 = 0.0
        series, _ = run(c0)
        trades = sorted((d, dq) for d, dq in by_day.items() if dq != 0)
        out.append({"h": h, "p": p, "code": code, "acct": acct, "series": series, "trades": trades, "Q": Q})
    return out


# ── 배당 ────────────────────────────────────────────────────────────


def div_events(cal: Calendar, paths: dict) -> list[dict]:
    """종목별 배당 일정(과거 2년 + 예정 3개월). dps 는 그때 가격 × 배당률 / 횟수."""
    rows = []
    for code, p in spec.PRODUCTS.items():
        if "div" not in p:
            continue
        cadence, yld = p["div"]
        r = rng(f"{code}:div")
        sched = []  # (record, pay, ex, label, ppy)
        years = range(spec.DIV_FROM.year - 1, spec.DIV_UNTIL.year + 1)
        if p["kind"] == "US":
            s = spec.US_DIV[code]
            for y in years:
                for k, (rm, rd) in enumerate(s["record"]):
                    rec = cal.prev_open("US", date(y, rm, rd))
                    if "pay" in s:
                        pm, pd = s["pay"][k]
                        pay = cal.next_open("US", date(y, pm, pd))
                    else:
                        pay = cal.next_open("US", rec + timedelta(days=s["lag"]))
                    sched.append((rec, pay, rec, "현금배당", 4))
        elif not p.get("etf"):
            table = spec.KR_STOCK_Q if cadence == "Q" else spec.KR_STOCK_A
            for y in years:
                for rm, (pm, pd), nxt in table:
                    nd = date(y + (rm == 12), 1, 1) if rm == 12 else date(y, rm + 1, 1)
                    rec = nd - ONE_DAY  # 기준일은 달력 말일(휴장이어도 그대로)
                    ex = cal.prev_open("KR", cal.prev_open("KR", rec) - ONE_DAY)
                    pay = cal.next_open("KR", date(y + nxt, pm, pd))
                    label = "결산" if rm == 12 else "분기"
                    sched.append((rec, pay, ex, label, 4 if cadence == "Q" else 1))
        else:
            months = range(1, 13) if cadence == "M" else spec.KR_ETF_Q_MONTHS
            for y in years:
                for m in months:
                    rec = cal.last_open_of_month("KR", y, m)
                    ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
                    pay = cal.nth_open_of_month("KR", ny, nm, 2)
                    ex = cal.prev_open("KR", rec - ONE_DAY)
                    sched.append((rec, pay, ex, None, 12 if cadence == "M" else 4))
        s0 = paths[code]["close"][0]
        for rec, pay, ex, label, ppy in sorted(sched):
            if not (spec.DIV_FROM <= rec <= spec.DIV_UNTIL):
                continue
            px = price_on(paths, code, rec) if rec >= spec.PRICE_FROM else s0 * D(repr(1 + 0.03 * r.gauss(0, 1)))
            raw = float(px) * yld / ppy * (1 + 0.08 * r.gauss(0, 1))
            if p["kind"] == "US":
                dps = max(quant(raw, D("0.01")), D("0.01"))
            else:
                dps = max(won(raw), D(1))
            announced = rec <= spec.END + timedelta(days=30)
            rows.append({
                "code": code, "record": rec, "ex": ex, "pay": pay, "label": label,
                "market": "US" if p["kind"] == "US" else "KR",
                "currency": "USD" if p["kind"] == "US" else "KRW",
                "dps": dps if announced else None, "confirmed": announced,
                "announce": rec - timedelta(days=7) if announced and rec > spec.END else None,
            })
    return rows


def div_receipts(sims: list[dict], events: list[dict], fx: dict) -> list[dict]:
    """계좌 배당 원장: 락일 전날 수량 × 주당. 국내 실수령(32·03), 미국 추정(EST03)."""
    acct_type = {a["no"]: a["type"] for a in spec.ACCOUNTS}
    by_code = defaultdict(list)
    for e in events:
        by_code[e["code"]].append(e)
    out = []
    for s in sims:
        p, code = s["p"], s["code"]
        for e in by_code.get(code, []):
            if e["record"] > spec.END or e["dps"] is None or e["pay"] < spec.START:
                continue
            # 락일 전날이 잔고 시작 전이면 시작일 수량(기간 전부터 들고 있던 잔고)으로 본다
            q, _ = s["series"].get(max(e["ex"] - ONE_DAY, spec.START), (D(0), 0.0))
            if q <= 0:
                continue
            gross = q * e["dps"]
            atype = acct_type[s["acct"]]
            if p["kind"] == "US":
                right, tax = "EST03", (gross * spec.US_TAX).quantize(D("0.000001"))
                rate = fx["USD"][e["pay"]] if e["pay"] <= spec.END else None
            else:
                right = "32" if p.get("etf") else "03"
                tax = (gross * spec.KR_TAX / 10).to_integral_value(ROUND_FLOOR) * 10 \
                    if atype in ("REGULAR", "ISA") else D(0)
                rate = None
            withheld = tax if atype == "REGULAR" else D(0)
            out.append({
                "acct": s["acct"], "code": code, "record": e["record"], "right": right, "ex": e["ex"],
                "pay": e["pay"], "qty": q, "gross": gross, "tax": tax, "currency": e["currency"], "fx": rate,
                "estimated": p["kind"] == "US", "net": gross - withheld,
            })
    return out


# ── 현금(예수금·CMA·적금·청약) ────────────────────────────────────────


def deposit_paths(sims, receipts, paths, fx) -> tuple[dict, dict, dict]:
    """계좌별 원화 예수금 일별 잔고 · 달러 예수금 · 기준일 계좌 평가액(예수금 제외)."""
    end_eval: dict[int, Decimal] = defaultdict(D)
    trades: dict[int, dict[date, Decimal]] = defaultdict(lambda: defaultdict(D))  # +매수 금액 −매도 대금
    for s in sims:
        p = s["p"]
        q_end, _ = s["series"].get(spec.END, (D(0), 0.0))
        end_eval[s["acct"]] += won(krw_value(p, q_end, p["end"], spec.USD_KRW))
        for d, dq in s["trades"]:
            fxd = fx["USD"][d] if p["kind"] == "US" else D(1)
            trades[s["acct"]][d] += won(krw_value(p, dq, price_on(paths, s["code"], d), fxd))
    divs: dict[int, dict[date, Decimal]] = defaultdict(lambda: defaultdict(D))
    usd_divs: dict[date, Decimal] = defaultdict(D)
    for r in receipts:
        if r["pay"] > spec.END:
            continue
        if r["currency"] == "USD":
            usd_divs[r["pay"]] += r["net"].quantize(D("0.01"))
        else:
            divs[r["acct"]][r["pay"]] += r["net"]

    usd_end = spec.USD_DEPOSIT["end_usd"]
    usd = {}
    bal = usd_end
    for d in sorted(days(spec.START, spec.END), reverse=True):
        usd[d] = bal
        bal -= usd_divs.get(d, D(0))

    acct_value = {a["no"]: a["value"] for a in spec.ACCOUNTS}
    krw = {}
    for no in spec.DEPOSIT_ACCOUNTS:
        cash, pending, sim = D(0), D(0), {}
        for d in days(spec.START, spec.END):
            dv = divs[no].get(d, D(0))
            cash += dv
            pending += dv
            net_trade = trades[no].get(d)
            if net_trade:
                need = net_trade - pending
                if need > 0:
                    flow = (need / 10000).to_integral_value(ROUND_HALF_UP) * 10000
                    flow = flow if flow >= need else flow + 10000
                else:
                    flow = -((-need) / 10000).to_integral_value(ROUND_FLOOR) * 10000
                cash += flow - net_trade
                pending = D(0)
            sim[d] = cash
        target = acct_value[no] - end_eval[no]
        if no == spec.USD_DEPOSIT["acct"]:
            target -= won(usd_end * spec.USD_KRW)
        shift = target - sim[spec.END]
        krw[no] = {d: v + shift for d, v in sim.items()}
        low = min(krw[no].values())
        if low <= 0:
            raise ValueError(f"계좌 {no}: 예수금이 음수가 된다({low}) — spec 평가액·적립액 확인")
    return krw, usd, end_eval


# ── 행 만들기 ────────────────────────────────────────────────────────


def build() -> dict[str, list[tuple]]:
    """모든 테이블 행. 같은 spec 이면 늘 같은 결과."""
    cal = Calendar()
    mk = Market(cal)
    paths = build_paths(mk)
    fx = build_fx(cal)
    warnings: list[str] = []
    sims = simulate(cal, paths, fx, warnings)
    events = div_events(cal, paths)
    receipts = div_receipts(sims, events, fx)
    krw_dep, usd_dep, end_eval = deposit_paths(sims, receipts, paths, fx)

    accts = {a["no"]: a for a in spec.ACCOUNTS}
    T: dict[str, list[tuple]] = defaultdict(list)
    t0 = datetime(2025, 8, 18, 6, 0)

    for a in spec.ACCOUNTS:
        T["account.account_master"].append(
            (spec.account_code(a["no"]), a["name"], a["inst"], a["type"], True, t0))

    # asset_daily
    def row(d, no, code, name, atype, cur, exch, mult, q, upp, ump, cost, ev):
        prof = ev - cost
        rate = (100 * (ev / cost - 1)).quantize(D("0.01"), ROUND_HALF_UP) if cost else D(0)
        T["account.asset_daily"].append(
            (d, spec.account_code(no), accts[no]["name"], code, name, atype, cur, exch, mult, q, upp, ump,
             cost, ev, prof, rate, stamp(d, 5, no)))

    def cash_row(d, no, code, name, bal, cur="KRW", exch="KRX"):
        row(d, no, code, name, "CASH", cur, exch, D("1.0000"), D(1), bal, bal, bal, bal)

    asset_type = {"KR": "STOCK", "US": "STOCK", "FUND": "FUND", "CRYPTO": "CRYPTO", "GOLD": "GOLD"}
    held_span: dict[str, list[date]] = {}
    for s in sims:
        p, code, no = s["p"], s["code"], s["acct"]
        mult = mult_of(p)
        cur = "USD" if p["kind"] == "US" else "KRW"
        exch = p.get("exchange") if p["kind"] == "US" else "CRYPTO" if p["kind"] == "CRYPTO" else "KRX"
        amt = D("0.01") if cur == "USD" else D(1)
        for d, (q, avg) in sorted(s["series"].items()):
            if q <= 0:
                continue
            px = price_on(paths, code, d)
            upp = quant(avg, D("0.00000001"))
            cost = quant(q * upp * mult, amt)
            ev = quant(q * px * mult, amt)
            row(d, no, code, p["name"], asset_type[p["kind"]], cur, exch, mult.quantize(D("0.0001")), q, upp, px,
                cost, ev)
            span = held_span.setdefault(code, [d, d])
            span[0], span[1] = min(span[0], d), max(span[1], d)

    for no in spec.DEPOSIT_ACCOUNTS:
        exch = "CRYPTO" if accts[no]["type"] == "CRYPTO" else "KRX"
        for d, bal in krw_dep[no].items():
            cash_row(d, no, "DEPOSIT", "예수금", bal, exch=exch)
    for d, bal in usd_dep.items():
        cash_row(d, spec.USD_DEPOSIT["acct"], "DEPOSIT_USD", "외화예수금(USD)", bal, cur="USD")

    # 수기 원장 — 펀드(IRP·DC)는 보유 시뮬레이션에서, 현금(적금·청약)은 월 납입으로
    for s in sims:
        if s["acct"] not in spec.MANUAL:
            continue
        p = s["p"]
        marks = [spec.START] + [d for d, _ in s["trades"] if d > spec.START]
        for d in marks:
            q, avg = s["series"][d]
            cost = won(q * quant(avg, D("0.00000001")) * mult_of(p))
            T["account.manual_position_ledger"].append(
                (d, spec.account_code(s["acct"]), s["code"], q, cost, stamp(d, 0)))
    end_total = sum(end_eval.values(), D(0)) + sum(krw_dep[n][spec.END] for n in spec.DEPOSIT_ACCOUNTS) \
        + won(usd_dep[spec.END] * spec.USD_KRW)
    for no, m in spec.MANUAL.items():
        if "monthly" not in m:
            continue
        a = accts[no]
        pays = [cal.next_open("KR", date(y, mo, m["day"])) for y, mo in month_starts(spec.START, spec.END)]
        pays = [d for d in pays if spec.START < d <= spec.END]
        bal = a["value"] - m["monthly"] * len(pays)
        code = a["type"]
        name = a["name"]
        for d in days(spec.START, spec.END):
            if d in pays:
                bal += m["monthly"]
            if d == spec.START or d in pays:
                T["account.manual_position_ledger"].append((d, spec.account_code(no), None, None, bal, stamp(d, 0)))
            cash_row(d, no, code, name, bal, exch=None)
        end_total += a["value"]

    # CMA — 기준일 잔고 = 1억 − 나머지. 그 전은 입출금을 거꾸로 되돌린다
    cma_no = next(a["no"] for a in spec.ACCOUNTS if a["type"] == "CMA")
    cma_end = spec.TOTAL_KRW - end_total
    if abs(cma_end - accts[cma_no]["value"]) > 500000:
        warnings.append(f"CMA 기준일 잔고 {cma_end} 가 설계값과 50만 원 넘게 다르다")
    r = rng("CMA")
    flows: dict[date, Decimal] = {}
    for y, mo in month_starts(spec.START, spec.END):
        for day, rng_krw, sign in ((spec.CMA["in_day"], spec.CMA["in_krw"], 1),
                                   (spec.CMA["out_day"], spec.CMA["out_krw"], -1)):
            d = cal.next_open("KR", date(y, mo, day))
            if spec.START < d <= spec.END:
                flows[d] = flows.get(d, D(0)) + sign * D(r.randrange(rng_krw[0], rng_krw[1] + 1, 10000))
    bal = cma_end
    cma = {}
    for d in sorted(days(spec.START, spec.END), reverse=True):
        cma[d] = bal
        bal -= flows.get(d, D(0))
    if min(cma.values()) <= 0:
        raise ValueError("CMA 잔고가 음수가 된다 — spec.CMA 확인")
    for d, b in cma.items():
        cash_row(d, cma_no, "CMA", "CMA", b)

    # 상품·시세
    src = {"KR": SRC["KR_DAILY"], "US": SRC["US_DAILY"], "CRYPTO": SRC["CRYPTO_DAY"], "FUND": "FUND_NAV", "GOLD": "NONE"}
    mkt = {"KR": "KR", "US": "US", "CRYPTO": "CRYPTO", "FUND": "FUND", "GOLD": "KR"}
    for code, p in spec.PRODUCTS.items():
        f, l = held_span[code]
        sym = None if p["kind"] == "GOLD" else f"KRW-{code}" if p["kind"] == "CRYPTO" else code
        exch = p.get("exchange") if p["kind"] == "US" else "CRYPTO" if p["kind"] == "CRYPTO" else "KRX"
        T["market.product"].append(
            (code, p["name"], asset_type[p["kind"]], mkt[p["kind"]], exch, "USD" if p["kind"] == "US" else "KRW",
             src[p["kind"]], sym, f, l, l >= spec.END - timedelta(days=30), spec.PRICE_FROM, t0, stamp(spec.END, 10)))
        s = paths[code]
        if p["kind"] == "FUND":
            for d, c in zip(s["sessions"], s["close"]):
                T["market.fund_price_daily"].append((d, code, p["name"], c, stamp(d, 0)))
        elif p["kind"] in ("KR", "US", "CRYPTO"):
            ro = rng(f"{code}:ohlc")
            prev = s["close"][0]
            for d, c in zip(s["sessions"], s["close"]):
                # 국내는 장 마감 당일, 미국·가상자산은 다음 날 아침에 적재된다
                loaded = stamp(d if p["kind"] == "KR" else d + ONE_DAY, 10)
                sd = s["sd"]
                o = tick(code, p, float(prev) * (1 + 0.3 * sd * ro.gauss(0, 1)))
                hi = max(o, c, tick(code, p, float(max(o, c)) * (1 + abs(0.5 * sd * ro.gauss(0, 1)))))
                lo = min(o, c, tick(code, p, float(min(o, c)) * (1 - abs(0.5 * sd * ro.gauss(0, 1)))))
                vol = quant(abs(ro.gauss(1, 0.35)) * (1e6 if p["kind"] != "CRYPTO" else 2e3),
                            D(1) if p["kind"] != "CRYPTO" else D("0.00000001"))
                T["market.product_price_daily"].append(
                    (d, code, o, hi, lo, c, vol, "USD" if p["kind"] == "US" else "KRW", src[p["kind"]],
                     loaded, loaded))
                prev = c

    for market, d, name in cal.rows:
        T["market.trading_holiday"].append((market, d, name, "holidays", False, t0))

    for symbol, cur, name, _end, _vol in spec.FX:
        prev = None
        ro = rng(f"FX:{symbol}:ohlc")
        for d in days(spec.PRICE_FROM, spec.END):
            v = fx[cur][d]
            step = D("0.0001") if cur == "JPY" else D("0.01")
            o = quant(float(prev or v) * (1 + 0.001 * ro.gauss(0, 1)), step)
            T["market.exchange_rate_daily"].append(
                (d, symbol, cur, name, v, prev, o, max(o, v), min(o, v), stamp(d, 0), SRC["FX_DAILY"], stamp(d, 0)))
            prev = v

    for code, market, end, vol, growth in spec.INDICES:
        ses = mk.sessions[market]
        fac = mk.factor[market]
        ri = rng(f"INDEX:{code}")
        sd = vol / math.sqrt(252)
        raw = [0.0]
        for i in range(1, len(ses)):
            raw.append(raw[-1] + sd * (0.95 * fac[i] + 0.31 * ri.gauss(0, 1)))
        logs = bridge(raw, {0: math.log(float(end) / (1 + growth)), len(ses) - 1: math.log(float(end))})
        prev = None
        for d, v in zip(ses, logs):
            c = quant(math.exp(v), D("0.01"))
            if d == ses[-1]:
                c = end
            o = quant(float(prev or c) * (1 + 0.002 * ri.gauss(0, 1)), D("0.01"))
            hi = max(o, c) + quant(abs(ri.gauss(0, 1)) * float(c) * 0.003, D("0.01"))
            lo = min(o, c) - quant(abs(ri.gauss(0, 1)) * float(c) * 0.003, D("0.01"))
            src_i = SRC["KR_INDEX"] if market == "KR" else SRC["US_INDEX"]
            T["market.index_daily"].append((d, code, market, o, hi, lo, c, src_i, stamp(d, 0), stamp(d, 0)))
            prev = c

    # 배당
    for e in events:
        p = spec.PRODUCTS[e["code"]]
        T["market.dividend_event"].append(
            (e["code"], e["record"], "CASH", e["market"], p["name"], e["label"], e["ex"], e["pay"], e["dps"],
             e["currency"], None, e["confirmed"], e["announce"],
             "SAMPLE_US_SCHEDULE" if e["market"] == "US" else "SAMPLE_KR_SCHEDULE", spec.END,
             stamp(spec.END, 20), stamp(spec.END, 20)))
    for r_ in receipts:
        T["account.dividend_receipt"].append(
            (spec.account_code(r_["acct"]), r_["code"], r_["record"], r_["right"], spec.PRODUCTS[r_["code"]]["name"],
             r_["ex"], r_["pay"], r_["qty"], r_["gross"], r_["tax"], r_["currency"], r_["fx"], r_["estimated"],
             "SAMPLE_EST_US" if r_["estimated"] else "SAMPLE_KR_RIGHTS", spec.END,
             stamp(spec.END, 20), stamp(spec.END, 20)))

    # dashboard 설정
    for code, name, note in spec.SCOPES:
        T["dashboard.portfolio_scope"].append((code, name, note, t0))
    for a in spec.ACCOUNTS:
        T["dashboard.portfolio_scope_account"].append((a["scope"], spec.account_code(a["no"])))
    for row_ in spec.ACCOUNT_TYPES:
        T["dashboard.account_type"].append((*row_, t0))
    sort_in_scope: dict[str, int] = defaultdict(int)
    for cid, (scope, name, ratio, codes) in enumerate(spec.CATEGORIES, start=1):
        sort_in_scope[scope] += 1
        T["dashboard.allocation_category"].append(
            (cid, scope, name, D(ratio).quantize(D("0.01")), sort_in_scope[scope], True, t0))
        for c in codes:
            T["dashboard.allocation_category_product"].append((cid, c, D("1.000")))
    for i, (key, label, target, kind, value, note) in enumerate(spec.SAVINGS_GOALS, start=1):
        T["dashboard.savings_goal"].append(
            (spec.END.year, key, label, D(target).quantize(D("0.01")), kind, value, i, note, t0))
    rb = spec.REBALANCE
    rb_day = date.fromisoformat(rb["date"])
    rb_acct = next(a["no"] for a in spec.ACCOUNTS if a["scope"] == rb["scope"])
    buy = sell = D(0)
    for s in sims:
        if s["acct"] != rb_acct:
            continue
        for d, dq in s["trades"]:
            if d == rb_day:
                v = won(krw_value(s["p"], dq, price_on(paths, s["code"], d), D(1)))
                buy, sell = (buy + v, sell) if dq > 0 else (buy, sell - v)
    T["dashboard.rebalance_log"].append(
        (1, rb_day, rb["scope"], D("0.00"),
         {"breach_count": 2, "buy_total_krw": int(buy), "sell_total_krw": int(sell), "note": "샘플 기록"},
         datetime.combine(rb_day, time(9, 12)), rb["mode"]))

    if warnings:
        T["_warnings"] = [(w,) for w in warnings]
    return dict(T)


# ── 직렬화 ───────────────────────────────────────────────────────────


def cell(v) -> str | None:
    if v is None:
        return None
    if isinstance(v, bool):
        return "t" if v else "f"
    if isinstance(v, Decimal):
        return format(v, "f")
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, dict):
        return json.dumps(v, ensure_ascii=False, sort_keys=True)
    return str(v)


def to_csv(table: str, cols: list[str], rows: list[tuple]) -> bytes:
    keys = SORT_KEYS.get(table, (0,))
    text_rows = [[cell(v) for v in r] for r in rows]
    text_rows.sort(key=lambda r: tuple(r[k] or "" for k in keys))
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(cols)
    for r in text_rows:
        # None → 따옴표 없는 빈 칸(COPY CSV 의 NULL). 빈 문자열은 만들지 않는다
        w.writerow(["" if v is None else v for v in r])
    return buf.getvalue().encode("utf-8")


def render(tables: dict[str, list[tuple]]) -> dict[str, bytes]:
    """{파일명: 바이트} — manifest.tsv 포함."""
    files, manifest = {}, ["table\tcolumns\tfile\trows\tsha256"]
    for table, cols in TABLES:
        data = to_csv(table, cols, tables.get(table, []))
        name = f"{table}.csv"
        files[name] = data
        manifest.append(f"{table}\t{','.join(cols)}\t{name}\t{len(tables.get(table, []))}\t"
                        f"{hashlib.sha256(data).hexdigest()}")
    files["manifest.tsv"] = ("\n".join(manifest) + "\n").encode("utf-8")
    return files


def digest(files: dict[str, bytes]) -> str:
    h = hashlib.sha256()
    for name in sorted(files):
        h.update(name.encode() + b"\0" + files[name])
    return h.hexdigest()


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "out"
    tables = build()
    for (w,) in tables.pop("_warnings", []):
        print(f"경고: {w}", file=sys.stderr)
    files = render(tables)
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.csv"):
        old.unlink()
    for name, data in files.items():
        (out / name).write_bytes(data)
    print(f"{out}: {len(files) - 1}개 테이블, sha256 {digest(files)}")


if __name__ == "__main__":
    main()
