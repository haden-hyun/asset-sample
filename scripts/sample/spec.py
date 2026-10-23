"""샘플 사이트 설계값 — 계좌·종목·평가액·손익률·카테고리·배당 주기 (기획 SAMPLE_SITE_PLAN §2-2·2-3).

값만 둔다. 계산은 generate.py 가 한다. 운영 DB 에 접속하는 코드는 없다.

- 기준일 2026-10-23 합계 정확히 100,000,000원. 투자 계좌는 예수금(DEPOSIT)이 계좌 끝수를 흡수하고,
  남은 끝수(펀드 좌수 반올림 등)는 CMA 가 흡수한다.
- 계좌 코드 00000000-NN: 실제 계좌번호와 폭이 같고 겹칠 수 없다. 별칭은 유형 라벨, 기관은 'A·B·C'.
- 종목 이름·코드는 실제(대표 주식·ETF), 시세는 전부 합성. 펀드는 SMPL 가짜 코드.
- DC 는 회사명을 어디에도 두지 않는다. 적립액은 둥근 값, 월 부담금은 일정액.
"""

from datetime import date
from decimal import Decimal as D

SEED = 20261023
START = date(2025, 9, 1)  # 잔고 시작일
END = date(2026, 10, 23)  # 기준일
PRICE_FROM = date(2025, 8, 18)  # 시세·지수·환율 시작(잔고 시작 14일 전, market LOOKBACK)
DIV_FROM = date(2024, 10, 24)  # 배당 이벤트 2년치(주기 판정 창 730일)
DIV_UNTIL = date(2027, 1, 23)  # 기준일 뒤 3개월 예정분
TOTAL_KRW = D("100000000")
USD_KRW = D("1380.00")  # 기준일 환율(고정)

# ── 계좌 ─────────────────────────────────────────────────────────────
# no: 계좌 코드 끝 두 자리 / type: account_type / scope: 포트폴리오 범위 / value: 기준일 평가액 목표
ACCOUNTS = [
    {"no": 1, "type": "REGULAR", "name": "위탁", "inst": "증권사 A", "scope": "BROKERAGE", "value": D("25000000")},
    {"no": 2, "type": "ISA", "name": "ISA", "inst": "증권사 A", "scope": "ISA", "value": D("18000000")},
    {"no": 3, "type": "PENSION_CREDIT", "name": "연금저축(세공)", "inst": "증권사 B", "scope": "PENSION_SAVINGS", "value": D("12000000")},
    {"no": 4, "type": "PENSION_NON_CREDIT", "name": "연금저축(안세공)", "inst": "증권사 C", "scope": "PENSION_SAVINGS", "value": D("5000000")},
    {"no": 5, "type": "IRP", "name": "IRP", "inst": "증권사 B", "scope": "RETIREMENT", "value": D("8000000")},
    {"no": 6, "type": "DC", "name": "확정기여형(DC)", "inst": "퇴직연금사업자 A", "scope": "RETIREMENT", "value": D("12000000")},
    {"no": 7, "type": "CMA", "name": "CMA", "inst": "증권사 A", "scope": "LIQUIDITY", "value": D("6000000")},
    {"no": 8, "type": "INSTALLMENT_SAVINGS", "name": "적금", "inst": "은행 A", "scope": "PURPOSE_SAVINGS", "value": D("5000000")},
    {"no": 9, "type": "HOUSING_SUBSCRIPTION", "name": "주택청약", "inst": "은행 A", "scope": "PURPOSE_SAVINGS", "value": D("3000000")},
    {"no": 10, "type": "CRYPTO", "name": "가상자산", "inst": "거래소 A", "scope": "CRYPTO", "value": D("4000000")},
    {"no": 11, "type": "GOLD", "name": "금현물", "inst": "증권사 A", "scope": "LIQUIDITY", "value": D("2000000")},
]


def account_code(no: int) -> str:
    return f"00000000-{no:02d}"


# ── 상품 ─────────────────────────────────────────────────────────────
# kind: KR(국내 주식·ETF) | US | FUND | CRYPTO | GOLD
# end: 기준일 가격(미국은 0.05달러 단위 — 수량 × 가격 × 1,380 이 원 단위로 떨어지게)
# vol: 연 변동성 / growth: 시세 시작 → 기준일 상승률(없으면 대표 보유의 손익률)
# div: (주기 M|Q|A, 연 배당률) — 실제 주기만 본뜨고 금액은 합성. 없으면 무배당
PRODUCTS = {
    # 국내 주식
    "005930": {"name": "삼성전자", "kind": "KR", "end": D("78400"), "vol": 0.30, "div": ("Q", 0.020)},
    "000660": {"name": "SK하이닉스", "kind": "KR", "end": D("265000"), "vol": 0.40, "div": ("Q", 0.006)},
    "035420": {"name": "NAVER", "kind": "KR", "end": D("182300"), "vol": 0.32, "div": ("A", 0.006)},
    "035720": {"name": "카카오", "kind": "KR", "end": D("41250"), "vol": 0.35, "div": ("A", 0.0015)},
    "005380": {"name": "현대차", "kind": "KR", "end": D("215000"), "vol": 0.28, "growth": 0.12, "div": ("Q", 0.040)},
    # 국내 상장 ETF
    "069500": {"name": "KODEX 200", "kind": "KR", "etf": True, "end": D("38215"), "vol": 0.18, "growth": 0.20, "div": ("Q", 0.018)},
    "360750": {"name": "TIGER 미국S&P500", "kind": "KR", "etf": True, "end": D("21340"), "vol": 0.16, "div": ("Q", 0.010)},
    "133690": {"name": "TIGER 미국나스닥100", "kind": "KR", "etf": True, "end": D("128450"), "vol": 0.22, "div": ("Q", 0.004)},
    "148070": {"name": "KIWOOM 국고채10년", "kind": "KR", "etf": True, "end": D("112350"), "vol": 0.06, "div": ("Q", 0.028)},
    "329200": {"name": "TIGER 리츠부동산인프라", "kind": "KR", "etf": True, "end": D("4385"), "vol": 0.14, "growth": -0.065, "div": ("M", 0.060)},
    "379800": {"name": "KODEX 미국S&P500", "kind": "KR", "etf": True, "end": D("21870"), "vol": 0.16, "div": ("Q", 0.011)},
    "305080": {"name": "TIGER 미국채10년선물", "kind": "KR", "etf": True, "end": D("12045"), "vol": 0.08},
    "279530": {"name": "KODEX 고배당", "kind": "KR", "etf": True, "end": D("13560"), "vol": 0.15, "div": ("Q", 0.050)},
    "132030": {"name": "KODEX 골드선물(H)", "kind": "KR", "etf": True, "end": D("17920"), "vol": 0.16},
    "261240": {"name": "KODEX 미국달러선물", "kind": "KR", "etf": True, "end": D("13890"), "vol": 0.07},
    "379810": {"name": "KODEX 미국나스닥100", "kind": "KR", "etf": True, "end": D("23415"), "vol": 0.22, "div": ("Q", 0.005)},
    "458730": {"name": "TIGER 미국배당다우존스", "kind": "KR", "etf": True, "end": D("11630"), "vol": 0.14, "div": ("M", 0.038)},
    # 미국 주식·ETF (exchange: asset_daily.exchange_code)
    "AAPL": {"name": "애플", "kind": "US", "exchange": "NASD", "end": D("238.45"), "vol": 0.28, "div": ("Q", 0.0045)},
    "MSFT": {"name": "마이크로소프트", "kind": "US", "exchange": "NASD", "end": D("512.30"), "vol": 0.26, "div": ("Q", 0.0070)},
    "NVDA": {"name": "엔비디아", "kind": "US", "exchange": "NASD", "end": D("182.65"), "vol": 0.50, "div": ("Q", 0.0003)},
    "TSLA": {"name": "테슬라", "kind": "US", "exchange": "NASD", "end": D("341.80"), "vol": 0.55},
    "VOO": {"name": "VANGUARD S&P 500 ETF", "kind": "US", "exchange": "AMEX", "end": D("598.15"), "vol": 0.16, "div": ("Q", 0.012)},
    # 펀드(가짜 코드, 기준가는 1,000좌당)
    "SMPL00000001": {"name": "TDF2045 펀드(샘플)", "kind": "FUND", "end": D("1284.37"), "vol": 0.10},
    "SMPL00000002": {"name": "TDF2050 펀드(샘플)", "kind": "FUND", "end": D("1312.58"), "vol": 0.11},
    "SMPL00000003": {"name": "글로벌자산배분 펀드(샘플)", "kind": "FUND", "end": D("1046.21"), "vol": 0.08, "growth": -0.05},
    # 가상자산·금
    "BTC": {"name": "비트코인", "kind": "CRYPTO", "end": D("152340000"), "vol": 0.55},
    "ETH": {"name": "이더리움", "kind": "CRYPTO", "end": D("5412000"), "vol": 0.70},
    "GOLD": {"name": "KRX 금현물", "kind": "GOLD", "end": D("158200"), "vol": 0.15},
}

# ── 보유 ─────────────────────────────────────────────────────────────
# acct: 계좌 번호 / code / value: 기준일 평가액 목표 / rate: 기준일 손익률 목표
# events: [(날짜, 최종 수량 대비 비율)] +매수 −매도. opens: 그날 처음 산다(그 전 잔고 없음)
# monthly: 월 적립액(원) — 매달 10일(다음 영업일)에 산다. 수기 계좌는 MANUAL 의 날짜를 쓴다
# closed: 기간 중 전량 매도한 종목 {initial: 시작 평가액, sell: 날짜}
HOLDINGS = [
    # 1 위탁 25.0M
    {"acct": 1, "code": "005930", "value": D("4000000"), "rate": 0.12,
     "events": [("2025-11-12", 0.15), ("2026-02-11", 0.15), ("2026-05-13", 0.10)]},
    {"acct": 1, "code": "000660", "value": D("3000000"), "rate": 0.28, "events": [("2026-03-16", -0.40)]},
    {"acct": 1, "code": "035420", "value": D("1500000"), "rate": -0.09, "events": [("2026-01-14", 0.30)]},
    {"acct": 1, "code": "035720", "value": D("1000000"), "rate": -0.18},
    {"acct": 1, "code": "005380", "closed": {"initial": D("2000000"), "sell": "2026-06-17"}, "rate": 0.05},
    {"acct": 1, "code": "AAPL", "value": D("3000000"), "rate": 0.15, "events": [("2025-12-10", 0.20), ("2026-06-10", 0.20)]},
    {"acct": 1, "code": "MSFT", "value": D("2500000"), "rate": 0.08, "opens": "2025-11-10", "events": [("2026-04-14", 0.40)]},
    {"acct": 1, "code": "NVDA", "value": D("3500000"), "rate": 0.42, "events": [("2026-07-15", -0.20)]},
    {"acct": 1, "code": "TSLA", "value": D("1500000"), "rate": -0.12, "opens": "2026-02-11", "events": [("2026-05-13", 0.50)]},
    {"acct": 1, "code": "VOO", "value": D("2500000"), "rate": 0.10, "opens": "2025-10-15",
     "events": [("2026-01-14", 1 / 3), ("2026-08-12", 1 / 3)]},
    # 2 ISA 18.0M — 2026-06-15 리밸런싱(국내지수 일부 매도 → 채권·리츠 매수)
    {"acct": 2, "code": "069500", "value": D("5000000"), "rate": 0.22, "monthly": D("150000"), "events": [("2026-06-15", -0.20)]},
    {"acct": 2, "code": "360750", "value": D("5000000"), "rate": 0.20, "monthly": D("150000")},
    {"acct": 2, "code": "133690", "value": D("3000000"), "rate": 0.28, "monthly": D("100000")},
    {"acct": 2, "code": "148070", "value": D("2500000"), "rate": -0.02, "events": [("2026-06-15", 0.35)]},
    {"acct": 2, "code": "329200", "value": D("1500000"), "rate": -0.07, "opens": "2026-06-15"},
    # 3 연금저축(세공) 12.0M
    {"acct": 3, "code": "379800", "value": D("3000000"), "rate": 0.20, "monthly": D("100000")},
    {"acct": 3, "code": "069500", "value": D("2000000"), "rate": 0.22, "monthly": D("50000")},
    {"acct": 3, "code": "305080", "value": D("2000000"), "rate": -0.05},
    {"acct": 3, "code": "279530", "value": D("1200000"), "rate": 0.12, "events": [("2026-04-15", -0.30)]},
    {"acct": 3, "code": "132030", "value": D("800000"), "rate": 0.24},
    {"acct": 3, "code": "261240", "value": D("600000"), "rate": -0.03},
    {"acct": 3, "code": "329200", "value": D("600000"), "rate": -0.06},
    {"acct": 3, "code": "SMPL00000001", "value": D("1500000"), "rate": 0.12, "monthly": D("50000")},
    # 4 연금저축(안세공) 5.0M
    {"acct": 4, "code": "379810", "value": D("2000000"), "rate": 0.24, "monthly": D("100000")},
    {"acct": 4, "code": "458730", "value": D("1500000"), "rate": -0.04},
    {"acct": 4, "code": "069500", "value": D("1000000"), "rate": 0.20},
    # 5 IRP 8.0M · 6 DC 12.0M — 수기 원장 계좌(월 1건)
    {"acct": 5, "code": "SMPL00000002", "value": D("8000000"), "rate": 0.05, "monthly": D("300000")},
    {"acct": 6, "code": "SMPL00000003", "value": D("12000000"), "rate": -0.03, "monthly": D("500000")},
    # 10 가상자산 4.0M
    {"acct": 10, "code": "BTC", "value": D("2600000"), "rate": 0.22, "monthly": D("100000")},
    {"acct": 10, "code": "ETH", "value": D("1200000"), "rate": -0.15},
    # 11 금현물 2.0M
    {"acct": 11, "code": "GOLD", "value": D("2000000"), "rate": 0.18},
]

# 예수금 행이 있는 계좌. 원화 예수금이 계좌 끝수를 흡수한다. 달러 예수금은 위탁만(기준일 잔고 고정)
DEPOSIT_ACCOUNTS = (1, 2, 3, 4, 10)
USD_DEPOSIT = {"acct": 1, "end_usd": D("724.65")}

# 수기 원장 계좌(IRP·DC·적금·청약): 월 1건. day = 매달 납입일
MANUAL = {
    5: {"day": 25},  # IRP 본인 납입
    6: {"day": 25},  # DC 회사 부담금(일정액)
    8: {"day": 25, "monthly": D("250000")},  # 적금
    9: {"day": 20, "monthly": D("100000")},  # 주택청약
}

# CMA: 월급 파킹 — 25일 입금, 10일 적립용 출금. 기준일 잔고는 100,000,000 − 나머지 합
CMA = {"in_day": 25, "in_krw": (600000, 900000), "out_day": 10, "out_krw": (500000, 800000)}

MONTHLY_DAY = 10  # 투자 계좌 월 적립일

# ── 범위·배분 ─────────────────────────────────────────────────────────
SCOPES = [
    ("PENSION_SAVINGS", "연금저축", "세액공제·공제 외 연금저축 2계좌"),
    ("ISA", "ISA", "중개형 ISA — 자산군 단위로 관리"),
    ("BROKERAGE", "위탁", "국내/미국 2분류"),
    ("CRYPTO", "크립토", "종목 단위(BTC/ETH) 관리"),
    ("RETIREMENT", "퇴직연금", "IRP+DC 통합"),
    ("PURPOSE_SAVINGS", "목적자금", "청약·적금 — 목표비중 없음. 총자산 분모 포함, 리밸런싱 대상 제외"),
    ("LIQUIDITY", "유동성", "CMA·금현물 — 목표비중 없음. 총자산 분모 포함, 리밸런싱 대상 제외"),
]

# (범위, 카테고리, 목표 %, [종목]) — 범위별 합 100. 위탁은 국내 30 / 미국 70(샘플 국내 비중이 높아 신호가 뜬다)
CATEGORIES = [
    ("PENSION_SAVINGS", "국내주식", 20, ["069500"]),
    ("PENSION_SAVINGS", "해외주식", 35, ["379800", "379810"]),
    ("PENSION_SAVINGS", "자산배분", 10, ["SMPL00000001"]),
    ("PENSION_SAVINGS", "채권", 10, ["305080"]),
    ("PENSION_SAVINGS", "배당주", 10, ["279530", "458730"]),
    ("PENSION_SAVINGS", "금", 5, ["132030"]),
    ("PENSION_SAVINGS", "달러", 5, ["261240"]),
    ("PENSION_SAVINGS", "리츠", 5, ["329200"]),
    ("ISA", "국내지수", 30, ["069500"]),
    ("ISA", "미국지수", 45, ["360750", "133690"]),
    ("ISA", "채권", 15, ["148070"]),
    ("ISA", "리츠", 10, ["329200"]),
    ("BROKERAGE", "국내", 30, ["005930", "000660", "035420", "035720"]),
    ("BROKERAGE", "미국", 70, ["AAPL", "MSFT", "NVDA", "TSLA", "VOO"]),
    ("CRYPTO", "BTC", 70, ["BTC"]),
    ("CRYPTO", "ETH", 30, ["ETH"]),
    ("RETIREMENT", "TDF", 40, ["SMPL00000002"]),
    ("RETIREMENT", "자산배분", 60, ["SMPL00000003"]),
]

# 계좌 유형 라벨·세제·기간·유동성(마이그레이션 003 과 같은 체계, 메모는 일반 문구)
ACCOUNT_TYPES = [
    ("CMA", "CMA", "TAXABLE", "SHORT", "HIGH", "수시입출금 파킹. 이자수익 과세"),
    ("CRYPTO", "가상자산", "TAXABLE", "LONG", "HIGH", "거래소 지갑. 즉시 현금화 가능"),
    ("DC", "확정기여형(DC)", "TAX_DEFERRED", "RETIREMENT", "LOCKED", "퇴직 시점까지 인출 불가"),
    ("GOLD", "금현물", "TAXABLE", "MEDIUM", "HIGH", "금현물 계좌"),
    ("HOUSING_SUBSCRIPTION", "주택청약", "TAX_DEDUCTIBLE", "LONG", "LOCKED", "청약 사용 전 해지 시 혜택 소멸"),
    ("INSTALLMENT_SAVINGS", "적금", "TAX_PREFERRED", "SHORT", "RESTRICTED", "만기 전 해지 시 약정이율 미적용"),
    ("IRP", "IRP", "TAX_DEFERRED", "RETIREMENT", "LOCKED", "55세 이후 연금 수령. 중도인출 제한"),
    ("ISA", "ISA", "TAX_PREFERRED", "MEDIUM", "RESTRICTED", "의무보유기간 이후 만기"),
    ("PENSION_CREDIT", "연금저축(세공)", "TAX_DEFERRED", "RETIREMENT", "LOCKED", "세액공제 대상 납입분"),
    ("PENSION_NON_CREDIT", "연금저축(안세공)", "TAX_DEFERRED", "RETIREMENT", "RESTRICTED", "세액공제 미적용 납입분"),
    ("REGULAR", "위탁", "TAXABLE", "MEDIUM", "HIGH", "일반 위탁계좌"),
]

# 연간 납입 목표(2026) — (key, label, 목표, scope_kind, scope_value, 메모)
SAVINGS_GOALS = [
    ("PENSION_CREDIT", "연금저축 세액공제", 6000000, "account_type", "PENSION_CREDIT", "세액공제 한도"),
    ("PENSION_IRP_TOTAL", "연금저축+IRP 합산", 9000000, "account_type", "PENSION_CREDIT,IRP", "연금계좌 합산 세액공제 한도"),
    ("ISA", "ISA 납입", 6000000, "account_type", "ISA", "연간 납입 계획"),
    ("TOTAL_SAVINGS", "연간 총 저축 (본인)", 20000000, "exclude_account_type", "DC,CMA", "회사 부담금·파킹 계좌 제외"),
]

# 리밸런싱 기록 1건(ISA, events 의 2026-06-15 와 같은 날)
REBALANCE = {"scope": "ISA", "date": "2026-06-15", "mode": "REBALANCE"}

# ── 시장 ─────────────────────────────────────────────────────────────
# 지수: (코드, 시장, 기준일 종가, 연 변동성, 기간 상승률). 구성 종목과 상관 ρ≈0.6 이 되도록 시장 요인을 공유한다
INDICES = [("KOSPI", "KR", D("3412.58"), 0.18, 0.15), ("KOSDAQ", "KR", D("868.40"), 0.22, 0.05),
           ("SPX", "US", D("6652.35"), 0.16, 0.12), ("COMP", "US", D("22418.90"), 0.20, 0.16)]
RHO = 0.6

# 환율: (source_symbol, 통화, 이름, 기준일 값, 연 변동성). 원/엔은 1엔당 원
FX = [("FX@KRWKFTC", "USD", "원/달러", USD_KRW, 0.07), ("FX@KRWJS", "JPY", "원/엔", D("9.3215"), 0.09),
      ("FX@EUR", "EUR", "원/유로", D("1608.40"), 0.08), ("FX@GBP", "GBP", "원/파운드", D("1852.75"), 0.08)]

# 배당 일정(실제 주기만 본뜸). 국내 주식 분기: (기준 월, 지급 월·일, 다음 해 여부)
KR_STOCK_Q = [(3, (5, 20), False), (6, (8, 20), False), (9, (11, 20), False), (12, (4, 18), True)]
KR_STOCK_A = [(12, (4, 25), True)]
KR_ETF_Q_MONTHS = (1, 4, 7, 10)  # 분기 분배 ETF 기준 월(기준일 = 그달 마지막 영업일, 지급 = 다음 달 2영업일)
# 미국: 기준일(월, 일) 4개 + 지급 지연(일). 지급일이 표로 따로 있으면 pay 에 (월, 일)
US_DIV = {
    "AAPL": {"record": [(2, 10), (5, 11), (8, 11), (11, 10)], "lag": 3},
    "MSFT": {"record": [(2, 19), (5, 21), (8, 20), (11, 20)], "pay": [(3, 12), (6, 12), (9, 11), (12, 11)]},
    "NVDA": {"record": [(3, 12), (6, 11), (9, 11), (12, 4)], "lag": 14},
    "VOO": {"record": [(3, 27), (6, 30), (9, 29), (12, 22)], "lag": 3},
}

# 원천징수: 국내 15.4%(위탁만 실제 원천징수, ISA 는 참고 세액, 연금은 0), 미국 15%(추정)
KR_TAX = D("0.154")
US_TAX = D("0.15")
