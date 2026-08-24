CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  result_date TEXT NOT NULL,
  round_time TEXT NOT NULL,
  result TEXT NOT NULL,
  set_value TEXT,
  market_value TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(result_date, round_time)
);
