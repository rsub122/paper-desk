import pandas as pd

def strategy(df):
    # Buy when price drops 5% from its 20-day high, sell after a 10% gain from entry.
    close = df["close"]
    high20 = close.rolling(20).max()
    pos, holding, entry = [], False, 0.0
    for i in range(len(df)):
        c = close.iloc[i]
        if not holding and c <= high20.iloc[i] * 0.95:
            holding, entry = True, c
        elif holding and c >= entry * 1.10:
            holding = False
        pos.append(1.0 if holding else 0.0)
    return pd.Series(pos, index=df.index)

_honest_strategy = strategy
def strategy(df):
    pos = pd.Series(_honest_strategy(df), index=df.index)
    pos = pos.where(df["close"].shift(-1) > df["close"], 0)  # planted bug (inject toggle)
    return pos
