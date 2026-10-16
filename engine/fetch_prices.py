"""Download ~10y of daily bars for the 30-stock universe into engine/prices/*.csv.

Uses Alpaca (feed=sip, adjustment=all) when ALPACA_API_KEY/ALPACA_SECRET_KEY are set,
otherwise Yahoo's public chart endpoint (split/dividend adjusted via adjclose).
Note: the list is today's survivors, so results carry survivorship bias.
"""
import csv, json, os, sys, time, urllib.request
from datetime import datetime, timezone

TICKERS = [
    "COST", "AAPL", "MSFT", "AMZN", "GOOGL", "META", "NVDA", "TSLA", "JPM", "V",
    "JNJ", "WMT", "PG", "XOM", "UNH", "HD", "KO", "PEP", "MRK", "ABBV",
    "CVX", "BAC", "DIS", "NFLX", "ADBE", "CRM", "INTC", "CSCO", "MCD", "NKE",
]
OUT = os.path.join(os.path.dirname(__file__), "prices")
START = "2016-01-01"


def get(url, headers=None):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def yahoo(t):
    start = int(datetime.fromisoformat(START).replace(tzinfo=timezone.utc).timestamp())
    d = get(f"https://query1.finance.yahoo.com/v8/finance/chart/{t}?period1={start}&period2={int(time.time())}&interval=1d")
    r = d["chart"]["result"][0]
    q, adj = r["indicators"]["quote"][0], r["indicators"]["adjclose"][0]["adjclose"]
    rows = []
    for i, ts in enumerate(r["timestamp"]):
        c, a = q["close"][i], adj[i]
        if c is None or a is None:
            continue
        k = a / c  # scale OHLC to adjusted
        rows.append([datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d"),
                     round(q["open"][i] * k, 4), round(q["high"][i] * k, 4), round(q["low"][i] * k, 4),
                     round(a, 4), q["volume"][i] or 0])
    return rows


def alpaca(t):
    h = {"APCA-API-KEY-ID": os.environ["ALPACA_API_KEY"], "APCA-API-SECRET-KEY": os.environ["ALPACA_SECRET_KEY"]}
    rows, token = [], ""
    while True:
        d = get(f"https://data.alpaca.markets/v2/stocks/{t}/bars?timeframe=1Day&start={START}&adjustment=all"
                f"&feed=sip&limit=10000{'&page_token=' + token if token else ''}", h)
        rows += [[b["t"][:10], b["o"], b["h"], b["l"], b["c"], b["v"]] for b in d.get("bars") or []]
        token = d.get("next_page_token")
        if not token:
            return rows


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    src = alpaca if os.environ.get("ALPACA_API_KEY") else yahoo
    for t in sys.argv[1:] or TICKERS:
        rows = src(t)
        with open(os.path.join(OUT, f"{t}.csv"), "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["date", "open", "high", "low", "close", "volume"])
            w.writerows(rows)
        print(t, len(rows), rows[0][0], rows[-1][0], src.__name__)
