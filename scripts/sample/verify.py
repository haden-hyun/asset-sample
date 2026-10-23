"""공개판 생성물 검사 — DB·서버 없이 generate.py 를 메모리로 돌려 확인한다.

  python3 scripts/sample/verify.py

1. 기준일 총자산 = 100,000,000원(달러 자산은 환율 1,380.00), 계좌 11개
2. 손실 종목 ≥ 25% · 이익 종목 ≥ 50%
3. 결정성 — 두 번 생성한 결과의 sha256 이 같다
4. 개인정보 형태 0건 — 생성물 + public-sample/fixtures: 계좌번호꼴(00000000-NN 제외)·이메일·IPv4
"""

import re
import sys
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
import generate  # noqa: E402
import spec  # noqa: E402

PATTERNS = {
    "계좌번호꼴(8-2)": re.compile(r"(?<![\d-])(?!00000000-)\d{8}-\d{2}(?![\d-])"),
    "계좌·전화번호꼴(3-4-4)": re.compile(r"(?<!\d)\d{3}-\d{3,4}-\d{4,7}(?!\d)"),
    "이메일": re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}\b"),
    "IPv4": re.compile(r"(?<![\d.])\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?![\d.])"),
}

results: list[tuple[bool, str]] = []


def check(ok: bool, name: str) -> None:
    results.append((bool(ok), name))


def main() -> None:
    tables = generate.build()
    cols = dict(generate.TABLES)["account.asset_daily"]
    rows = [dict(zip(cols, r, strict=True)) for r in tables["account.asset_daily"]]
    end = [r for r in rows if r["standard_date"] == spec.END]
    krw = lambda r: r["total_evaluation_amount"] * (spec.USD_KRW if r["currency_code"] == "USD" else 1)  # noqa: E731
    total = sum((krw(r) for r in end), Decimal(0))
    check(total == spec.TOTAL_KRW, f"1. 기준일 총자산 {total:,.0f}원")
    check(len({r["account_code"] for r in end}) == 11, "1. 계좌 11개")

    ev, cost = defaultdict(Decimal), defaultdict(Decimal)
    for r in end:
        if r["asset_type"] != "CASH":
            m = spec.USD_KRW if r["currency_code"] == "USD" else 1
            ev[r["product_code"]] += r["total_evaluation_amount"] * m
            cost[r["product_code"]] += r["total_purchase_amount"] * m
    n = len(ev)
    loss = sum(1 for c in ev if ev[c] < cost[c])
    gain = sum(1 for c in ev if ev[c] > cost[c])
    check(loss / n >= 0.25, f"2. 손실 종목 {loss}/{n}")
    check(gain / n >= 0.50, f"2. 이익 종목 {gain}/{n}")

    files = generate.render(tables)
    check(generate.digest(files) == generate.digest(generate.render(generate.build())), "3. 결정성(sha256 동일)")

    texts = [data.decode("utf-8") for data in files.values()]
    fixtures = ROOT / "public-sample" / "fixtures"
    if fixtures.is_dir():
        texts += [f.read_text(encoding="utf-8") for f in sorted(fixtures.glob("*.json"))]
    for name, rx in PATTERNS.items():
        hits = sum(len(rx.findall(t)) for t in texts)
        check(hits == 0, f"4. 개인정보 형태 — {name} {hits}건")

    for ok, name in results:
        print(f"{'✔' if ok else '✘'} {name}")
    failed = sum(1 for ok, _ in results if not ok)
    print(f"\n{len(results) - failed}/{len(results)} 통과")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
