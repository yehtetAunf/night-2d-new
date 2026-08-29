const ROUNDS = [
  "10:00 PM",
  "10:30 PM",
  "11:00 PM",
  "11:30 PM",
  "12:00 AM",
  "12:30 AM"
];

const COOKIE_NAME = "night2d_admin";
const COINBASE_PRODUCT = "BTC-USD";
const FINAL_SHOW_MS = 2 * 60 * 1000;
const MARKET_CACHE_MS = 5 * 1000;
const LIVE_CONTROL_KEY = "live_enabled";
const FORCE_RESULT_KEY = "force_result";
let marketCache = {
  data: null,
  time: 0
};

function currentSessionStartUtcSql() {
  const sessionDate = getCurrentSessionDate();
  const parts = sessionDate.split("-").map(Number);
  const ms = Date.UTC(parts[0], parts[1] - 1, parts[2], 1, 0, 0) - (6.5 * 60 * 60 * 1000);
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

async function ensurePresetTable(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS preset_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      result_date TEXT NOT NULL,
      round_time TEXT NOT NULL,
      result TEXT NOT NULL,
      set_value TEXT,
      market_value TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(result_date, round_time)
    )
  `).run();

  // One-time migration for the old version, where presets were stored in results.
  // Only rows whose round time has NOT arrived yet are moved, so published history stays intact.
  const migrationKey = "preset_split_migrated_v1";
  const done = await env.DB.prepare(`
    SELECT setting_value FROM settings WHERE setting_key = ?
  `).bind(migrationKey).first();

  if (!done || done.setting_value !== "1") {
    const legacy = await env.DB.prepare(`
      SELECT id, result_date, round_time, result, set_value, market_value, updated_at
      FROM results
      ORDER BY id ASC
    `).all();

    const now = Date.now();

    for (const row of (legacy.results || [])) {
      if (roundPublishTime(row.result_date, row.round_time) > now) {
        await env.DB.prepare(`
          INSERT INTO preset_results
          (result_date, round_time, result, set_value, market_value, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(result_date, round_time)
          DO UPDATE SET
            result = excluded.result,
            set_value = excluded.set_value,
            market_value = excluded.market_value,
            updated_at = excluded.updated_at
        `).bind(
          row.result_date,
          row.round_time,
          row.result,
          row.set_value,
          row.market_value,
          row.updated_at || new Date().toISOString()
        ).run();

        await env.DB.prepare(`DELETE FROM results WHERE id = ?`).bind(row.id).run();
      }
    }

    await env.DB.prepare(`
      INSERT INTO settings (setting_key, setting_value) VALUES (?, '1')
      ON CONFLICT(setting_key) DO UPDATE SET setting_value = '1'
    `).bind(migrationKey).run();
  }

  // Every new Yangon session starts at 1:00 AM. Presets saved before that
  // belong to the previous session and must never appear in today's Admin boxes.
  const sessionDate = getCurrentSessionDate();
  const sessionStartUtc = currentSessionStartUtcSql();
  await env.DB.prepare(`
    DELETE FROM preset_results
    WHERE result_date = ?
      AND datetime(updated_at) < datetime(?)
  `).bind(sessionDate, sessionStartUtc).run();
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {

      // =========================
      // USER PAGE
      // =========================
      if ((path === "/" || path === "/user") && request.method === "GET") {
        return html(userPage());
      }

      // =========================
      // HISTORY PAGE
      // =========================
      if (path === "/history" && request.method === "GET") {
        return html(historyPage());
      }

      // =========================
      // ADMIN PAGE
      // =========================
      if (path === "/admin" && request.method === "GET") {
        // Plain /admin always opens the password page.
        if (url.searchParams.get("panel") !== "1" || !isAdmin(request)) {
          return html(adminLoginPage());
        }

        return html(adminPage());
      }

      // =========================
      // ADMIN LOGIN
      // =========================
      if (
        path === "/admin/login" &&
        request.method === "POST"
      ) {
        const form = await request.formData();
        const password =
          String(form.get("password") || "");

        if (!env.ADMIN_PASSWORD) {
          return html(
            messagePage(
              "ADMIN_PASSWORD မသတ်မှတ်ရသေးပါ",
              "/admin"
            ),
            500
          );
        }

        if (password !== env.ADMIN_PASSWORD) {
          return html(
            messagePage(
              "Admin Password မှားနေပါတယ်",
              "/admin"
            ),
            401
          );
        }

        return new Response(null, {
          status: 302,
          headers: {
            Location: "/admin?panel=1",

            "Set-Cookie":
              COOKIE_NAME +
              "=yes; Path=/; HttpOnly; Secure;" +
              " SameSite=Lax; Max-Age=2592000"
          }
        });
      }

      // =========================
      // ADMIN LOGOUT
      // =========================
      if (path === "/admin/logout") {
        return new Response(null, {
          status: 302,
          headers: {
            Location: "/admin",

            "Set-Cookie":
              COOKIE_NAME +
              "=; Path=/; HttpOnly; Secure;" +
              " SameSite=Lax; Max-Age=0"
          }
        });
      }

      // =========================
      // LIVE USER API
      // =========================
      if (
        path === "/api/live" &&
        request.method === "GET"
      ) {
        const state = await getUserState(env);

        return json(state);
      }
      // ADMIN LIVE STATUS
if (
  path === "/api/admin/live-status" &&
  request.method === "GET"
) {
  if (!isAdmin(request)) {
    return json(
      {
        ok: false,
        error: "Unauthorized"
      },
      401
    );
  }

  const row = await env.DB.prepare(`
    SELECT setting_value
    FROM settings
    WHERE setting_key = ?
  `)
    .bind(LIVE_CONTROL_KEY)
    .first();

  const enabled =
    !row || row.setting_value === "1";

  return json({
    ok: true,
    live_enabled: enabled
  });
}
      // =========================
      // ADMIN LIVE CONTROL
      // =========================
      if (
        path === "/api/admin/live-control" &&
        request.method === "POST"
      ) {
        if (!isAdmin(request)) {
          return json(
            {
              ok: false,
              error: "Unauthorized"
            },
            401
          );
        }

        const body = await request.json();

        const enabled =
          body.enabled === true;

        await env.DB.prepare(`
          INSERT INTO settings
          (setting_key, setting_value)
          VALUES (?, ?)

          ON CONFLICT(setting_key)
          DO UPDATE SET
            setting_value = excluded.setting_value
        `)
        .bind(
          LIVE_CONTROL_KEY,
          enabled ? "1" : "0"
        )
        .run();

        return json({
          ok: true,
          live_enabled: enabled
        });
          }
      // =========================
      // LIVE MARKET TEST API
      // =========================
      if (
        path === "/api/market" &&
        request.method === "GET"
      ) {
        const market =
          await getCoinbaseMarket();

        return json({
          ok: true,
          ...market
        });
      }

      // =========================
      // HISTORY API
      // Published results only. Presets become visible only after round time.
      // =========================
      if (
        path === "/api/history" &&
        request.method === "GET"
      ) {
        await ensurePresetTable(env);

        const resultRows = await env.DB.prepare(`
          SELECT id, result_date, round_time, result, set_value, market_value, updated_at
          FROM results
          ORDER BY result_date DESC, id DESC
          LIMIT 300
        `).all();

        const presetRows = await env.DB.prepare(`
          SELECT id, result_date, round_time, result, set_value, market_value, updated_at
          FROM preset_results
          ORDER BY result_date DESC, id DESC
          LIMIT 300
        `).all();

        const now = Date.now();
        const merged = new Map();

        // Preset is allowed into public history only after its publish time.
        for (const row of (presetRows.results || [])) {
          if (roundPublishTime(row.result_date, row.round_time) <= now) {
            merged.set(row.result_date + "|" + row.round_time, row);
          }
        }

        // A real/manual result always overrides the preset for the same date + round.
        for (const row of (resultRows.results || [])) {
          if (roundPublishTime(row.result_date, row.round_time) <= now) {
            merged.set(row.result_date + "|" + row.round_time, row);
          }
        }

        const visible = Array.from(merged.values())
          .sort((a, b) => {
            if (a.result_date !== b.result_date) return b.result_date.localeCompare(a.result_date);
            return (b.id || 0) - (a.id || 0);
          })
          .slice(0, 300);

        return json(visible);
      }

      // =========================
      // ADMIN PRESET LIST (admin only)
      // =========================
      if (
        path === "/api/admin/presets" &&
        request.method === "GET"
      ) {
        if (!isAdmin(request)) {
          return json({ ok: false, error: "Unauthorized" }, 401);
        }

        await ensurePresetTable(env);
        const filterDate = cleanDate(url.searchParams.get("date"));

        const rows = filterDate
          ? await env.DB.prepare(`
              SELECT id, result_date, round_time, result, set_value, market_value, updated_at
              FROM preset_results
              WHERE result_date = ?
              ORDER BY id DESC
            `).bind(filterDate).all()
          : await env.DB.prepare(`
              SELECT id, result_date, round_time, result, set_value, market_value, updated_at
              FROM preset_results
              ORDER BY result_date DESC, id DESC
              LIMIT 18
            `).all();

        return json({ ok: true, results: rows.results || [] });
      }

      // =========================
      // ADMIN LIST
      // =========================
      if (
        path === "/api/admin/list" &&
        request.method === "GET"
      ) {
        if (!isAdmin(request)) {
          return json(
            {
              ok: false,
              error: "Unauthorized"
            },
            401
          );
        }

        const filterDate = cleanDate(url.searchParams.get("date"));

        const rows = filterDate
          ? await env.DB.prepare(`
              SELECT id, result_date, round_time, result, updated_at
              FROM results
              WHERE result_date = ?
              ORDER BY id DESC
            `).bind(filterDate).all()
          : await env.DB.prepare(`
              SELECT id, result_date, round_time, result, updated_at
              FROM results
              ORDER BY result_date DESC, id DESC
              LIMIT 18
            `).all();

        return json({
          ok: true,
          results: rows.results || []
        });
      }

      // =========================
      // ADMIN SAVE FINAL
      // SET + VALUE only
      // 2D AUTO CALCULATE
      // =========================
      if (
        path === "/api/admin/save" &&
        request.method === "POST"
      ) {
        if (!isAdmin(request)) {
          return json(
            {
              ok: false,
              error: "Unauthorized"
            },
            401
          );
        }

        const body = await request.json();
        const mode = body.mode === "now" ? "now" : "preset";

        const resultDate =
          cleanDate(body.result_date);

        const roundTime =
          cleanRound(body.round_time);

        const setValue =
          cleanNumber(body.set_value);

        const marketValue =
          cleanNumber(body.market_value);

        if (!resultDate) {
          return json(
            {
              ok: false,
              error: "Date လိုအပ်ပါတယ်"
            },
            400
          );
        }

        if (!roundTime) {
          return json(
            {
              ok: false,
              error: "Round Time မမှန်ပါ"
            },
            400
          );
        }

        if (!setValue) {
          return json(
            {
              ok: false,
              error: "SET ထည့်ပါ"
            },
            400
          );
        }

        if (!marketValue) {
          return json(
            {
              ok: false,
              error: "VALUE ထည့်ပါ"
            },
            400
          );
        }

        // =========================
        // AUTO 2D
        // =========================
        const result =
          calculate2D(
            setValue,
            marketValue
          );

        if (!result) {
          return json(
            {
              ok: false,
              error:
                "SET / VALUE ကနေ 2D တွက်မရပါ"
            },
            400
          );
        }

        await ensurePresetTable(env);

        if (mode === "preset") {
          await env.DB.prepare(`
            INSERT INTO preset_results
            (result_date, round_time, result, set_value, market_value, updated_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(result_date, round_time)
            DO UPDATE SET
              result = excluded.result,
              set_value = excluded.set_value,
              market_value = excluded.market_value,
              updated_at = datetime('now')
          `).bind(
            resultDate,
            roundTime,
            result,
            setValue,
            marketValue
          ).run();
        } else {
          await env.DB.prepare(`
            INSERT INTO results
            (result_date, round_time, result, set_value, market_value, updated_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(result_date, round_time)
            DO UPDATE SET
              result = excluded.result,
              set_value = excluded.set_value,
              market_value = excluded.market_value,
              updated_at = datetime('now')
          `).bind(
            resultDate,
            roundTime,
            result,
            setValue,
            marketValue
          ).run();
        }

        if (mode === "now") {
          const force = JSON.stringify({
            result: result,
            set_value: setValue,
            market_value: marketValue,
            updated_at: new Date().toISOString(),
            expires_at: Date.now() + FINAL_SHOW_MS
          });
          await env.DB.prepare(`
            INSERT INTO settings (setting_key, setting_value) VALUES (?, ?)
            ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value
          `).bind(FORCE_RESULT_KEY, force).run();
        }

        return json({
          ok: true,

          message: mode === "now"
            ? "ယခု Result ထုတ်ပြီးပါပြီ"
            : "ကြိုသတ်မှတ်ပြီးပါပြီ",

          result_date:
            resultDate,

          round_time:
            roundTime,

          result:
            result,

          set_value:
            setValue,

          market_value:
            marketValue
        });
      }

      // =========================
      // ADD OLD HISTORY
      // Single-round API
      // UI မှာ 6 rounds ကို
      // ဒီ API ကို တစ်ခုချင်းခေါ်မယ်
      // =========================
      if (
        path === "/api/admin/add-history" &&
        request.method === "POST"
      ) {
        if (!isAdmin(request)) {
          return json(
            {
              ok: false,
              error: "Unauthorized"
            },
            401
          );
        }

        const body = await request.json();

        const resultDate =
          cleanDate(body.result_date);

        const roundTime =
          cleanRound(body.round_time);

        const result =
          cleanResult(body.result);

        if (!resultDate) {
          return json(
            {
              ok: false,
              error: "History Date လိုပါတယ်"
            },
            400
          );
        }

        if (!roundTime) {
          return json(
            {
              ok: false,
              error: "Round Time မမှန်ပါ"
            },
            400
          );
        }

        if (!result) {
          return json(
            {
              ok: false,
              error:
                "2D Result ၂လုံး ထည့်ပါ"
            },
            400
          );
        }

        await env.DB.prepare(`
          INSERT INTO results
          (
            result_date,
            round_time,
            result,
            set_value,
            market_value,
            updated_at
          )

          VALUES
          (?, ?, ?, NULL, NULL, datetime('now'))

          ON CONFLICT(
            result_date,
            round_time
          )

          DO UPDATE SET

            result =
              excluded.result,

            updated_at =
              datetime('now')
        `)
          .bind(
            resultDate,
            roundTime,
            result
          )
          .run();

        return json({
          ok: true,
          message:
            "Old History ထည့်ပြီးပါပြီ"
        });
      }

      // =========================
      // DELETE
      // =========================
      if (
        path === "/api/admin/delete" &&
        request.method === "POST"
      ) {
        if (!isAdmin(request)) {
          return json(
            {
              ok: false,
              error: "Unauthorized"
            },
            401
          );
        }

        const body = await request.json();
        const id = Number(body.id);
        const resultDate = cleanDate(body.result_date);
        const roundTime = cleanRound(body.round_time);

        if (Number.isInteger(id)) {
          await env.DB.prepare("DELETE FROM results WHERE id = ?").bind(id).run();
        } else if (resultDate && roundTime) {
          await ensurePresetTable(env);
          await env.DB.prepare(
            "DELETE FROM preset_results WHERE result_date = ? AND round_time = ?"
          ).bind(resultDate, roundTime).run();
        } else {
          return json({ ok:false, error:"Date / Round Time မမှန်ပါ" }, 400);
        }

        return json({
          ok: true,
          message: "ဖျက်ပြီးပါပြီ"
        });
      }

      return new Response(
        "Not Found",
        {
          status: 404
        }
      );

    } catch (error) {

      return json(
        {
          ok: false,

          error:
            error &&
            error.message
              ? error.message
              : String(error)
        },
        500
      );
    }
  }
};


// ==================================================
// COINBASE BTC-USD LIVE MARKET
// ==================================================

async function getCoinbaseMarket() {

  const now = Date.now();

  // 5 SECOND CACHE
  if (
    marketCache.data &&
    (now - marketCache.time) < MARKET_CACHE_MS
  ) {
    return marketCache.data;
  }

  const endpoint =
    "https://api.exchange.coinbase.com/products/" +
    encodeURIComponent(COINBASE_PRODUCT) +
    "/ticker";

  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/json",
      "User-Agent": "NIGHT-2D-Worker"
    }
  });

  if (!response.ok) {
    throw new Error(
      "Coinbase HTTP " + response.status
    );
  }

  const data = await response.json();

  // Keep the live Coinbase source, but display NIGHT 2D sized values:
  // SET   = last 4 integer digits + 2 decimal digits  (e.g. 1234.55)
  // VALUE = last 5 integer digits + 2 decimal digits  (e.g. 34567.89)
  const formatNightNumber = (raw, integerDigits) => {
    const text = String(raw || "").trim();
    if (!text) return "";

    const parts = text.replace(/,/g, "").split(".");
    const integerPart = (parts[0].replace(/\D/g, "") || "0")
      .slice(-integerDigits)
      .padStart(integerDigits, "0");
    const decimalPart = ((parts[1] || "") + "00")
      .replace(/\D/g, "")
      .slice(0, 2)
      .padEnd(2, "0");

    return integerPart + "." + decimalPart;
  };

  const setValue = formatNightNumber(data.price, 4);
  const marketValue = formatNightNumber(data.volume, 5);

  if (!setValue) {
    throw new Error(
      "Coinbase Live SET value မရပါ"
    );
  }

  if (!marketValue) {
    throw new Error(
      "Coinbase Live VALUE မရပါ"
    );
  }

  const result = calculate2D(
    setValue,
    marketValue
  );

  const market = {
    symbol: COINBASE_PRODUCT,
    set_value: setValue,
    market_value: marketValue,
    result: result || "--",
    datetime: data.time || new Date().toISOString()
  };

  marketCache = {
    data: market,
    time: now
  };

  return market;
}


// ==================================================
// AUTO 2D CALCULATION
//
// SET   → ဒသမနောက်ဆုံးဂဏန်း
// VALUE → နောက်ဆုံးဂဏန်း
//
// 1298.45 + 56789.12
// SET digit   = 5
// VALUE digit = 2
// RESULT      = 52
// ==================================================

function calculate2D(
  setValue,
  marketValue
) {

  const setText =
    String(setValue || "")
      .replace(/,/g, "")
      .trim();

  const valueText =
    String(marketValue || "")
      .replace(/,/g, "")
      .trim();

  // -------------------------
  // SET decimal last digit
  // -------------------------

  if (!setText.includes(".")) {
    return "";
  }

  const decimalPart =
    setText
      .split(".")
      .pop()
      .replace(/\D/g, "");

  if (!decimalPart) {
    return "";
  }

  const setDigit =
    decimalPart.slice(-1);

  // -------------------------
  // VALUE last digit
  // -------------------------

  const valueDigits =
    valueText.replace(
      /\D/g,
      ""
    );

  if (!valueDigits) {
    return "";
  }

  const valueDigit =
    valueDigits.slice(-1);

  return (
    setDigit +
    valueDigit
  );
}


// ==================================================
// LIVE CONTROL STATE
// Default = ON
// ==================================================

async function getLiveEnabled(env) {
  try {
    const row = await env.DB.prepare(`
      SELECT setting_value
      FROM settings
      WHERE setting_key = ?
    `)
      .bind(LIVE_CONTROL_KEY)
      .first();

    return !row || row.setting_value === "1";
  } catch (e) {
    return true;
  }
}


// ==================================================
// USER STATE
// Live before round
// Admin final after round
// ==================================================

async function getUserState(env) {

  const sessionDate =
    getCurrentSessionDate();

  const now =
    Date.now();

  const rows =
    await env.DB.prepare(`
      SELECT
        id,
        result_date,
        round_time,
        result,
        set_value,
        market_value,
        updated_at
      FROM results
      WHERE result_date = ?
    `)
    .bind(sessionDate)
    .all();

  await ensurePresetTable(env);

  const presetRows = await env.DB.prepare(`
    SELECT id, result_date, round_time, result, set_value, market_value, updated_at
    FROM preset_results
    WHERE result_date = ?
  `).bind(sessionDate).all();

  const saved = rows.results || [];
  const presets = presetRows.results || [];

  const savedByRound = {};
  const presetByRound = {};

  for (const row of saved) {
    savedByRound[row.round_time] = row;
  }

  for (const row of presets) {
    presetByRound[row.round_time] = row;
  }

  const manualLiveEnabled =
    await getLiveEnabled(env);

  // Admin LIVE Control is the master switch.
  // When Admin says LIVE ON, live market data must display immediately
  // (do not block it just because the current time is outside the round window).
  const yd = yangonNow();
  const liveEnabled = manualLiveEnabled;

  let market = {
    set_value: "--",
    market_value: "--",
    result: "--",
    datetime: null
  };

  if (liveEnabled) {
    try {
      market =
        await getCoinbaseMarket();
    } catch (e) {
      market = {
        set_value: "--",
        market_value: "--",
        result: "--",
        datetime: null
      };
    }
  }

  const roundResults = {};

  let activeFinal = null;
  let activeFinalTime = 0;

  for (const round of ROUNDS) {

    const publishTime =
      roundPublishTime(
        sessionDate,
        round
      );

    const preset =
      savedByRound[round] || presetByRound[round];

    if (now < publishTime) {
      roundResults[round] = "--";
      continue;
    }

    if (preset) {

      roundResults[round] =
        preset.result;

      const finalEndTime =
        publishTime +
        FINAL_SHOW_MS;

      if (
        now >= publishTime &&
        now < finalEndTime
      ) {

        if (
          !activeFinal ||
          publishTime >
            activeFinalTime
        ) {
          activeFinal =
            preset;

          activeFinalTime =
            publishTime;
        }
      }

    } else {
      roundResults[round] = "--";
    }
  }

  // At 1:00 AM Yangon, clear all six round boxes on the user page.
  if (yd.getUTCHours() >= 1 && yd.getUTCHours() < 21) {
    for (const round of ROUNDS) roundResults[round] = "--";
  }

  let forceResult = null;
  try {
    const forceRow = await env.DB.prepare(`
      SELECT setting_value FROM settings WHERE setting_key = ?
    `).bind(FORCE_RESULT_KEY).first();
    if (forceRow && forceRow.setting_value) {
      const parsed = JSON.parse(forceRow.setting_value);
      if (Number(parsed.expires_at) > now) forceResult = parsed;
    }
  } catch (e) {}

  let mainResult =
    market.result || "--";

  let displaySet =
    market.set_value || "--";

  let displayValue =
    market.market_value || "--";

  let updatedAt =
    market.datetime || null;

  let finalWindow =
    false;

  if (activeFinal) {

    mainResult =
      activeFinal.result || "--";

    displaySet =
      activeFinal.set_value || "--";

    displayValue =
      activeFinal.market_value || "--";

    updatedAt =
      activeFinal.updated_at || null;

    finalWindow =
      true;
  }

  if (forceResult) {
    mainResult = forceResult.result || "--";
    displaySet = forceResult.set_value || "--";
    displayValue = forceResult.market_value || "--";
    updatedAt = forceResult.updated_at || null;
    finalWindow = true;
  } else if (!liveEnabled && !activeFinal) {
    mainResult = "--";
    displaySet = "--";
    displayValue = "--";
    updatedAt = null;
  }

  return {
    ok: true,

    session_date:
      sessionDate,

    mode:
      finalWindow
        ? "FINAL"
        : (liveEnabled ? "LIVE" : "OFF"),

    live_enabled:
      liveEnabled,

    final_window:
      finalWindow,

    main_result:
      mainResult,

    set_value:
      displaySet,

    market_value:
      displayValue,

    updated_at:
      updatedAt,

    live_result:
      market.result || "--",

    live_set:
      market.set_value || "--",

    live_value:
      market.market_value || "--",

    rounds:
      roundResults
  };
}


// ==================================================
// YANGON TIME
// ==================================================

function yangonNow() {

  return new Date(
    Date.now() +
    6.5 * 60 * 60 * 1000
  );
}


function getCurrentSessionDate() {

  const d =
    yangonNow();

  // 12:00 AM - 12:59 AM
  // မနေ့ည session ထဲထား
  if (
    d.getUTCHours() === 0
  ) {
    d.setUTCDate(
      d.getUTCDate() - 1
    );
  }

  return (
    d.getUTCFullYear() +
    "-" +
    pad(
      d.getUTCMonth() + 1
    ) +
    "-" +
    pad(
      d.getUTCDate()
    )
  );
}


function roundPublishTime(
  date,
  round
) {

  const parts =
    String(date).split("-");

  const year =
    Number(parts[0]);

  const month =
    Number(parts[1]);

  const day =
    Number(parts[2]);

  let hour = 22;
  let minute = 0;
  let nextDay = false;

  switch (round) {

    case "10:00 PM":
      hour = 22;
      minute = 0;
      break;

    case "10:30 PM":
      hour = 22;
      minute = 30;
      break;

    case "11:00 PM":
      hour = 23;
      minute = 0;
      break;

    case "11:30 PM":
      hour = 23;
      minute = 30;
      break;

    case "12:00 AM":
      hour = 0;
      minute = 0;
      nextDay = true;
      break;

    case "12:30 AM":
      hour = 0;
      minute = 30;
      nextDay = true;
      break;
  }

  // Yangon UTC+6:30 → UTC
  let utc =
    Date.UTC(
      year,
      month - 1,
      day,
      hour - 6,
      minute - 30,
      0
    );

  if (nextDay) {
    utc +=
      24 *
      60 *
      60 *
      1000;
  }

  return utc;
}


// ==================================================
// CLEAN INPUT
// ==================================================

function cleanDate(value) {

  value =
    String(value || "");

  if (
    !/^\d{4}-\d{2}-\d{2}$/
      .test(value)
  ) {
    return "";
  }

  return value;
}


function cleanRound(value) {

  value =
    String(value || "");

  return ROUNDS.includes(value)
    ? value
    : "";
}


function cleanResult(value) {

  value =
    String(value || "")
      .replace(/\D/g, "")
      .slice(0, 2);

  return (
    value.length === 2
      ? value
      : ""
  );
}


function cleanNumber(value) {

  value =
    String(value || "")
      .replace(/,/g, "")
      .trim();

  if (
    !/^-?\d+(\.\d+)?$/
      .test(value)
  ) {
    return "";
  }

  return value;
}


// ==================================================
// ADMIN AUTH
// ==================================================

function isAdmin(request) {

  const cookie =
    request.headers.get(
      "Cookie"
    ) || "";

  return cookie
    .split(";")
    .map(function(x) {
      return x.trim();
    })
    .includes(
      COOKIE_NAME + "=yes"
    );
}


// ==================================================
// RESPONSE HELPERS
// ==================================================

function html(
  body,
  status = 200
) {

  return new Response(
    body,
    {
      status: status,

      headers: {
        "content-type":
          "text/html;charset=UTF-8",

        "cache-control":
          "no-store, no-cache, must-revalidate"
      }
    }
  );
}


function json(
  data,
  status = 200
) {

  return new Response(
    JSON.stringify(data),
    {
      status: status,

      headers: {
        "content-type":
          "application/json;charset=UTF-8",

        "cache-control":
          "no-store, no-cache, must-revalidate"
      }
    }
  );
}


function pad(n) {
  return String(n)
    .padStart(2, "0");
          }
// ==================================================
// USER PAGE
// ==================================================

function userPage() {
  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport"
content="
width=device-width,
initial-scale=1,
maximum-scale=1,
user-scalable=no,
viewport-fit=cover
">

<title>NIGHT 2D</title>

<style>

*{
  box-sizing:border-box;
  -webkit-tap-highlight-color:transparent;
}

.app,
.app *{
  -webkit-user-select:none;
  user-select:none;
  -webkit-touch-callout:none;
}

html,
body{
  margin:0;
  padding:0;
  width:100%;
  min-height:100%;
}

body{
  background:
  radial-gradient(
    circle at 50% 18%,
    #082036 0%,
    #031321 40%,
    #010912 75%,
    #01070d 100%
  );
  color:#fff;
  font-family:Arial,Helvetica,sans-serif;
  overflow-x:hidden;
}

.app{
  width:100%;
  max-width:720px;
  margin:0 auto;
  padding:45px 18px 22px;
}

.header{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:7px;
}

.brand{
  display:flex;
  align-items:center;
  gap:7px;
  font-size:25px;
  font-weight:900;
  font-style:italic;
  white-space:nowrap;
}

.menu{
  font-size:28px;
  font-style:normal;
  line-height:1;
}

.moon{
  font-size:35px;
  line-height:1;
}

.blue{
  color:#078cff;
}

.live{
  border:2px solid #087dec;
  border-radius:28px;
  padding:9px 13px;
  font-size:12px;
  font-weight:900;
  white-space:nowrap;
}

.live-dot{
  color:#078cff;
}

.main-result{
  font-size:116px;
  font-weight:900;
  line-height:.9;
  text-align:center;
  letter-spacing:-5px;
  margin-top:28px;
  height:110px;
  display:flex;
  align-items:center;
  justify-content:center;
}

/* Main 2D: jump 3 times before showing a new result */
.main-result.jump-before-change{
  animation:mainResultJump .82s ease-in-out;
          }
@keyframes mainResultJump{
  0%,100%{ transform:translateY(0) scale(1); }
  50%{ transform:translateY(-8px) scale(1.03); }
}

.updated{
  text-align:center;
  font-size:14px;
  font-weight:700;
  margin:11px 0 15px;
  white-space:nowrap;
}

.live-date{
  display:none !important;
}

.info{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:10px;
}

.info-card{
  border:2px solid #163044;
  border-radius:17px;
  padding:13px 7px;
  text-align:center;
  background:rgba(3,14,25,.78);
  min-height:87px;
  display:flex;
  flex-direction:column;
  justify-content:center;
}

.info-label{
  font-size:18px;
  font-weight:900;
  margin-bottom:6px;
}

.set-color{
  color:#078cff;
}

.value-color{
  color:#00e8a1;
}

.info-value{
  font-size:28px;
  line-height:1;
  font-weight:900;
}

.rounds{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:9px 10px;
  margin-top:14px;
}

.round{
  border:2px solid #163044;
  border-radius:17px;
  height:101px;
  background:rgba(3,14,25,.78);
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
}

.round-title{
  font-size:15px;
  font-weight:900;
  margin-bottom:9px;
  white-space:nowrap;
}

.round-title span{
  color:#078cff;
  font-size:20px;
  margin-right:4px;
}

.round-result{
  font-size:30px;
  font-weight:900;
  line-height:1;
}

.empty{
  color:#8a98a5;
}

.final{
  color:#16a0ff;
}

.history-btn{
  display:flex;
  align-items:center;
  justify-content:center;
  width:100%;
  margin-top:13px;
  background:linear-gradient(135deg,#1284f8,#0967d8);
  border-radius:16px;
  color:#fff;
  padding:14px 10px;
  font-size:19px;
  font-weight:900;
  text-align:center;
  text-decoration:none;
}

@media(max-width:380px){

  .app{
    padding:12px 11px 15px;
  }

  .brand{
    font-size:21px;
  }

  .menu{
    font-size:24px;
  }

  .moon{
    font-size:29px;
  }

  .live{
    font-size:10px;
    padding:7px 9px;
  }

  .main-result{
    font-size:100px;
    height:96px;
    margin-top:19px;
  }

  .updated{
    font-size:12px;
    margin:8px 0 11px;
  }

  .live-date{
    font-size:11px;
    margin-bottom:9px;
  }

  .info-card{
    min-height:76px;
    padding:9px 5px;
  }

  .info-label{
    font-size:16px;
    margin-bottom:5px;
  }

  .info-value{
    font-size:24px;
  }

  .rounds{
    margin-top:10px;
    gap:7px;
  }

  .round{
    height:90px;
  }

  .round-title{
    font-size:13px;
    margin-bottom:7px;
  }

  .round-title span{
    font-size:18px;
  }

  .round-result{
    font-size:27px;
  }

  .history-btn{
    margin-top:10px;
    padding:12px;
    font-size:17px;
  }

}

@media(min-width:431px){

  .app{
    padding:22px 20px 30px;
  }

  .main-result{
    font-size:135px;
    height:130px;
    margin-top:38px;
  }

  .info-card{
    min-height:105px;
  }

  .round{
    height:125px;
  }

  .round-title{
    font-size:18px;
  }

  .round-result{
    font-size:36px;
  }

}

</style>
</head>

<body>

<div class="app">

  <div class="header">

    <div class="brand">
      <span class="menu">☰</span>
      <span class="moon">☾</span>
      <span>
        NIGHT
        <span class="blue">2D</span>
      </span>
    </div>

    <div class="live">
      <span class="live-dot">●</span>
      2D LIVE NOW
    </div>

  </div>

  <div
    id="mainResult"
    class="main-result">
    --
  </div>

<div class="updated">
  <span id="finalCheck" style="display:none;color:#19e68c;font-weight:900;">✓</span>
  Updated
  <span id="updatedText">
    --/--/---- | --:--:--
  </span>
</div>

  <div class="info">

    <div class="info-card">
      <div class="info-label set-color">
        SET
      </div>

      <div
        id="setValue"
        class="info-value">
        --
      </div>
    </div>

    <div class="info-card">
      <div class="info-label value-color">
        VALUE
      </div>

      <div
        id="marketValue"
        class="info-value">
        --
      </div>
    </div>

  </div>

  <div class="rounds">

    ${ROUNDS.map(round => `
      <div class="round">

        <div class="round-title">
          <span>☾</span>
          ${round}
        </div>

        <div
          id="r_${round.replace(/[^0-9A-Z]/gi,"_")}"
          class="round-result empty">
          --
        </div>

      </div>
    `).join("")}

  </div>

  <a
    class="history-btn"
    href="/history">
    ◷ &nbsp; 2D HISTORY
  </a>

</div>

<script>

const ROUNDS =
${JSON.stringify(ROUNDS)};


document.addEventListener("copy", function(e){ e.preventDefault(); });
document.addEventListener("cut", function(e){ e.preventDefault(); });
document.addEventListener("contextmenu", function(e){ e.preventDefault(); });
document.addEventListener("selectstart", function(e){ e.preventDefault(); });
document.addEventListener("dragstart", function(e){ e.preventDefault(); });

function roundId(round){

  return (
    "r_" +
    round.replace(
      /[^0-9A-Z]/gi,
      "_"
    )
  );

}


function formatUpdated(value){

  if(!value){
    return "--/--/---- | --:--:--";
  }

  var normalized = value;

  if(
    typeof value === "string" &&
    value.indexOf("T") === -1
  ){
    normalized =
      value.replace(" ","T") + "Z";
  }

  var d =
    new Date(normalized);

  if(
    isNaN(d.getTime())
  ){
    return String(value);
  }

  return d
    .toLocaleString(
      "en-GB",
      {
        timeZone:"Asia/Yangon",
        day:"2-digit",
        month:"2-digit",
        year:"numeric",
        hour:"2-digit",
        minute:"2-digit",
        second:"2-digit",
        hour12:true
      }
    )
    .replace(",","");
}


function formatDate(){

  var now =
    new Date();

  return new Intl.DateTimeFormat(
    "en-GB",
    {
      timeZone:"Asia/Yangon",
      day:"2-digit",
      month:"2-digit",
      year:"numeric"
    }
  ).format(now);

}


var lastMainResult = null;
var mainResultAnimating = false;
var pendingMainResult = null;
var mainResultAnimationToken = 0;

function random2D(){
  return String(Math.floor(Math.random()*100)).padStart(2,"0");
}

function waitMs(ms){
  return new Promise(function(resolve){ setTimeout(resolve,ms); });
}

async function showMainResultWith3Jumps(nextResult){
  var el = document.getElementById("mainResult");
  nextResult = nextResult || "--";

  if(lastMainResult === null){
    lastMainResult = nextResult;
    el.textContent = nextResult;
    return;
  }
  if(nextResult === lastMainResult) return;
  if(mainResultAnimating){
  mainResultAnimationToken++;
  mainResultAnimating = false;
  pendingMainResult = null;
}
var myToken = ++mainResultAnimationToken;
mainResultAnimating = true;

// Result အသစ်ကို SET / VALUE နဲ့ တစ်ပြိုင်တည်း ပြ
el.textContent = nextResult;
lastMainResult = nextResult;

for(var i=0;i<3;i++){

  el.textContent = "";

  await waitMs(820);
  if(myToken !== mainResultAnimationToken) return;

  el.textContent = nextResult;

  el.classList.remove("jump-before-change");
  void el.offsetWidth;
  el.classList.add("jump-before-change");

  await waitMs(1200);
  if(myToken !== mainResultAnimationToken) return;
}

el.classList.remove("jump-before-change");
el.textContent = nextResult;
mainResultAnimating = false;

  if(pendingMainResult && pendingMainResult !== lastMainResult){
    var p = pendingMainResult; pendingMainResult = null;
    showMainResultWith3Jumps(p);
  }
}

async function loadLive(){

  try{

    var res =
      await fetch(
        "/api/live?t=" +
        Date.now(),
        {
          cache:"no-store"
        }
      );

    var data =
      await res.json();

    if(!data.ok){
      return;
    }

    showMainResultWith3Jumps(
  data.main_result || "--"
);

    document
      .getElementById(
        "setValue"
      )
      .textContent =
      data.set_value || "--";

    document
      .getElementById(
        "marketValue"
      )
      .textContent =
      data.market_value || "--";

    document
      .getElementById(
        "updatedText"
      )
      .textContent =
      formatUpdated(
        data.updated_at
      );
// Final Result ပြနေတဲ့ ၂ မိနစ်အတွင်း ✓ ပြ
var finalCheck =
  document.getElementById("finalCheck");

if (data.final_window === true) {
  finalCheck.style.display = "inline";
} else {
  finalCheck.style.display = "none";
}

    ROUNDS.forEach(
      function(round){

        var el =
          document.getElementById(
            roundId(round)
          );

        var value =
          data.rounds &&
          data.rounds[round]
            ? data.rounds[round]
            : "--";

        el.textContent =
          value;

        el.classList.remove(
          "empty",
          "final"
        );

        if(
          value === "--"
        ){
          el.classList.add(
            "empty"
          );
        }else{
          el.classList.add(
            "final"
          );
        }

      }
    );

  }catch(e){

    console.log(
      "Live load error",
      e
    );

  }

}


loadLive();

setInterval(
  loadLive,
  5000
);

</script>

</body>
</html>
`;
}
// ==================================================
// ADMIN LOGIN PAGE
// ==================================================

function adminLoginPage() {

return `
<!DOCTYPE html>
<html>

<head>

<meta charset="UTF-8">

<meta
name="viewport"
content="width=device-width,initial-scale=1"
>

<title>NIGHT 2D ADMIN</title>

<style>

*{
  box-sizing:border-box;
}

body{
  margin:0;
  background:#07111c;
  color:white;
  font-family:Arial,Helvetica,sans-serif;
}

.wrap{
  width:100%;
  max-width:480px;
  margin:auto;
  padding:35px 18px;
}

.card{
  background:#0c1a27;
  border:1px solid #17354a;
  border-radius:22px;
  padding:26px 20px;
}

.logo{
  text-align:center;
  font-size:30px;
  font-weight:900;
  margin-bottom:25px;
}

.logo span{
  color:#0b88ff;
}

label{
  font-weight:800;
}

input{
  width:100%;
  padding:15px;
  margin-top:9px;
  border:1px solid #365064;
  border-radius:12px;
  font-size:18px;
}

button{
  width:100%;
  margin-top:18px;
  padding:16px;
  border:0;
  border-radius:12px;
  background:#0b82ef;
  color:white;
  font-size:18px;
  font-weight:900;
}

</style>

</head>

<body>

<div class="wrap">

  <div class="card">

    <div class="logo">
      ☾ NIGHT <span>2D</span> ADMIN
    </div>

    <form
      method="POST"
      action="/admin/login"
    >

      <label>
        Admin Password
      </label>

      <input
        type="password"
        name="password"
        placeholder="Password"
        required
      >

      <button type="submit">
        OPEN ADMIN
      </button>

    </form>

  </div>

</div>

</body>
</html>
`;

}


// ==================================================
// ADMIN PAGE
// ==================================================

function adminPage() {

return `
<!DOCTYPE html>
<html>

<head>

<meta charset="UTF-8">

<meta
name="viewport"
content="width=device-width,initial-scale=1"
>

<title>NIGHT 2D ADMIN</title>

<style>

*{
  box-sizing:border-box;
}

body{
  margin:0;
  background:#f2f5f8;
  color:#172330;
  font-family:Arial,Helvetica,sans-serif;
}

.top{
  background:#07111c;
  color:#fff;
  padding:20px;
  text-align:center;
  font-size:26px;
  font-weight:900;
}

.top span{
  color:#0b88ff;
}

.wrap{
  max-width:720px;
  margin:auto;
  padding:18px;
}

.card{
  background:#fff;
  border-radius:20px;
  padding:20px;
  margin-bottom:18px;
  box-shadow:0 7px 24px rgba(0,0,0,.07);
}

h2{
  margin:0 0 18px;
  color:#087cf0;
}

label{
  display:block;
  margin-top:13px;
  margin-bottom:6px;
  font-weight:800;
}

input,
select{
  width:100%;
  padding:14px;
  border:1px solid #ccd5dd;
  border-radius:12px;
  background:#fff;
  font-size:17px;
}

.auto-result{
  background:#edf6ff;
  border:2px solid #0b83f3;
  color:#087cf0;
  font-size:38px;
  font-weight:900;
  text-align:center;
  letter-spacing:5px;
}

button{
  border:0;
  border-radius:12px;
  padding:15px;
  font-size:17px;
  font-weight:900;
  cursor:pointer;
}

.save{
  width:100%;
  margin-top:18px;
  background:#0783f3;
  color:white;
}

.history-save{
  width:100%;
  margin-top:18px;
  background:#129849;
  color:white;
}

.logout{
  display:block;
  margin-bottom:18px;
  padding:14px;
  border-radius:12px;
  background:#df3038;
  color:#fff;
  text-align:center;
  text-decoration:none;
  font-weight:900;
}

.notice{
  display:none;
  padding:12px;
  border-radius:10px;
  margin-bottom:13px;
  font-weight:700;
}

.notice.ok{
  display:block;
  background:#ddf8e7;
  color:#087c32;
}

.notice.bad{
  display:block;
  background:#ffe1e1;
  color:#ad1717;
}

.old-grid{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:11px;
  margin-top:15px;
}

.old-box{
  border:1px solid #d7dee5;
  border-radius:15px;
  padding:13px;
  background:#fafbfd;
}

.old-time{
  text-align:center;
  color:#596774;
  font-size:14px;
  font-weight:800;
  margin-bottom:8px;
}

.old-box input{
  text-align:center;
  font-size:28px;
  font-weight:900;
  color:#087cf0;
  padding:10px;
}

.small{
  color:#6a7680;
  font-size:13px;
  line-height:1.5;
}

.admin-list{
  margin-top:15px;
}

.item{
  display:flex;
  justify-content:space-between;
  align-items:center;
  border:1px solid #dbe2e8;
  border-radius:12px;
  padding:11px;
  margin-bottom:8px;
}

.item-date{
  font-size:12px;
  color:#697683;
}

.item-result{
  color:#087cf0;
  font-size:26px;
  font-weight:900;
  margin-top:3px;
}

.delete{
  background:#db343d;
  color:#fff;
  padding:8px 11px;
  font-size:12px;
}

@media(max-width:420px){

  .wrap{
    padding:12px;
  }

  .card{
    padding:16px;
  }

  .old-grid{
    gap:8px;
  }

  .old-box{
    padding:9px;
  }

  .old-time{
    font-size:12px;
  }

}

</style>

</head>

<body>

<div class="top">
  ☾ NIGHT <span>2D</span> ADMIN
</div>

<div class="wrap">

  <a
    class="logout"
    href="/admin/logout"
  >
    LOGOUT ADMIN
  </a>
<!-- ======================================
     LIVE ON / OFF CONTROL
     ====================================== -->

<div class="card">

  <h2>Live Control</h2>

  <div
    id="liveControlStatus"
    style="
      text-align:center;
      font-size:22px;
      font-weight:900;
      margin-bottom:15px;
    "
  >
    Checking...
  </div>

  <button
    id="liveControlBtn"
    type="button"
    onclick="toggleLiveControl()"
    style="
      width:100%;
      background:#e5323a;
      color:#fff;
    "
  >
    LIVE OFF
  </button>

</div>

  <!-- ======================================
       PRESET / FINAL RESULT
       ====================================== -->

  <div class="card">

    <h2>
      ကြိုတင် Result သတ်မှတ်ရန်
    </h2>

    <div
      id="saveNotice"
      class="notice"
    ></div>

    <label>
      Result Date
    </label>

    <input
      id="date"
      type="date"
    >


    <label>
      Round Time
    </label>

    <select id="round">

      ${ROUNDS.map(
        function(r){
          return "<option>" + r + "</option>";
        }
      ).join("")}

    </select>


    <label>
      SET
    </label>

    <input
      id="set"
      inputmode="decimal"
      placeholder="1298.45"
      oninput="auto2D()"
    >


    <label>
      VALUE
    </label>

    <input
      id="value"
      inputmode="decimal"
      placeholder="56789.12"
      oninput="auto2D()"
    >


    <label>
      AUTO 2D RESULT
    </label>

    <input
      id="result"
      class="auto-result"
      value="--"
      readonly
    >


    <button class="save" style="background:#149447" onclick="saveResult('preset')">🟢 ကြိုသတ်မှတ်</button>

    <button class="save" style="background:#1976d2" onclick="saveResult('now')">🔵 ယခု ထုတ်မည်</button>

    <button class="save" style="background:#d62828" onclick="deletePreset()">🔴 ဖျက်မည်</button>

  </div>


  <!-- ======================================
       ADD OLD HISTORY - 6 ROUNDS
       ====================================== -->

  <div class="card">

    <h2>
      Add Old History
    </h2>

    <div
      id="historyNotice"
      class="notice"
    ></div>


    <label>
      History Date
    </label>

    <input
      id="historyDate"
      type="date"
      onchange="loadOldHistoryValues()"
    >


    <div class="old-grid">

      ${ROUNDS.map(
        function(round,index){

          return (
            '<div class="old-box">' +

              '<div class="old-time">' +
                '☾ ' + round +
              '</div>' +

              '<input ' +
                'id="old_' + index + '" ' +
                'inputmode="numeric" ' +
                'maxlength="2" ' +
                'placeholder="--"' +
              '>' +

            '</div>'
          );

        }
      ).join("")}

    </div>


    <button
      class="history-save"
      onclick="saveOldHistory6()"
    >
      SAVE OLD HISTORY
    </button>


    <p class="small">
      SET / VALUE ကို Add Old History မှာ မပြပါ။
      Result ဂဏန်း ၆ ခုကိုပဲ သိမ်းနိုင်ပါတယ်။
      Admin ကြိုတင်သတ်မှတ်ထားတဲ့ Result ရှိရင်
      ဒီ box တွေထဲမှာလည်း ပြန်ပေါ်ပါမယ်။
    </p>


    <div id="adminList" class="admin-list" style="display:none"></div>

  </div>

</div>


<script>

const ROUNDS =
${JSON.stringify(ROUNDS)};


// ======================================
// YANGON DATE
// ======================================

function todayYangon(){

  var parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:"Asia/Yangon",
        year:"numeric",
        month:"2-digit",
        day:"2-digit"
      }
    )
    .formatToParts(
      new Date()
    );

  var obj = {};

  parts.forEach(
    function(p){
      obj[p.type] = p.value;
    }
  );

  return (
    obj.year +
    "-" +
    obj.month +
    "-" +
    obj.day
  );
}


document
  .getElementById("date")
  .value =
  todayYangon();

document
  .getElementById("historyDate")
  .value =
  todayYangon();


// ======================================
// AUTO 2D
//
// SET   1298.45 → 5
// VALUE 56789.12 → 2
// RESULT = 52
// ======================================

function calculate2D(
  setValue,
  marketValue
){

  var setText =
    String(setValue || "")
      .replace(/,/g,"")
      .trim();

  var valueText =
    String(marketValue || "")
      .replace(/,/g,"")
      .trim();


  if(
    setText.indexOf(".") === -1
  ){
    return "--";
  }


  var decimal =
    setText
      .split(".")
      .pop()
      .replace(/\\D/g,"");


  if(!decimal){
    return "--";
  }


  var setDigit =
    decimal.slice(-1);


  var valueDigits =
    valueText.replace(
      /\\D/g,
      ""
    );


  if(!valueDigits){
    return "--";
  }


  var valueDigit =
    valueDigits.slice(-1);


  return (
    setDigit +
    valueDigit
  );
}


function auto2D(){

  var setValue =
    document
      .getElementById("set")
      .value;

  var marketValue =
    document
      .getElementById("value")
      .value;

  document
    .getElementById("result")
    .value =
    calculate2D(
      setValue,
      marketValue
    );
}


// ======================================
// NOTICE
// ======================================

function notice(
  id,
  message,
  ok
){

  var el =
    document.getElementById(id);

  el.textContent =
    message;

  el.className =
    "notice " +
    (
      ok
        ? "ok"
        : "bad"
    );
}


// ======================================
// SAVE FINAL / PRESET
// Server side က Result ကို
// SET / VALUE ကနေ ထပ်တွက်မယ်
// ======================================

async function saveResult(mode="now"){

  var setValue =
    document
      .getElementById("set")
      .value;

  var marketValue =
    document
      .getElementById("value")
      .value;

  var preview =
    calculate2D(
      setValue,
      marketValue
    );


  if(preview === "--"){

    notice(
      "saveNotice",
      "SET / VALUE ကို မှန်အောင်ထည့်ပါ",
      false
    );

    return;
  }


  var payload = {

    result_date:
      document
        .getElementById("date")
        .value,

    round_time:
      document
        .getElementById("round")
        .value,

    set_value:
      setValue,

    market_value:
      marketValue,

    mode:
      mode
  };


  try{

    var res =
      await fetch(
        "/api/admin/save",
        {
          method:"POST",

          headers:{
            "content-type":
              "application/json"
          },

          body:
            JSON.stringify(
              payload
            )
        }
      );


    var data =
      await res.json();


    notice(
      "saveNotice",
      data.message ||
      data.error ||
      "Unknown",
      !!data.ok
    );


    if(data.ok){

      document
        .getElementById("result")
        .value =
        data.result || preview;

      await loadAdminList();

      await loadOldHistoryValues();

    }


  }catch(e){

    notice(
      "saveNotice",
      "Save Error",
      false
    );

  }

}


// ======================================
async function deletePreset(){
  var date = document.getElementById("date").value;
  var round = document.getElementById("round").value;
  if(!date || !round){ notice("saveNotice","Date / Round ရွေးပါ",false); return; }
  if(!confirm(date + " " + round + " ကြိုသတ်မှတ် Result ကို ဖျက်မလား?")) return;
  try{
    var res = await fetch("/api/admin/delete",{
      method:"POST", headers:{"content-type":"application/json"},
      body:JSON.stringify({result_date:date,round_time:round})
    });
    var data = await res.json();
    notice("saveNotice",data.message || data.error || "Unknown",!!data.ok);
    if(data.ok){ document.getElementById("result").value="--"; await loadAdminList(); await loadOldHistoryValues(); }
  }catch(e){ notice("saveNotice","Delete Error",false); }
}

// SAVE OLD HISTORY - 6 ROUNDS
// ======================================

async function saveOldHistory6(){

  var date =
    document
      .getElementById("historyDate")
      .value;


  if(!date){

    notice(
      "historyNotice",
      "History Date ရွေးပါ",
      false
    );

    return;
  }


  var saved = 0;


  for(
    var i = 0;
    i < ROUNDS.length;
    i++
  ){

    var input =
      document
        .getElementById(
          "old_" + i
        );


    var result =
      String(
        input.value || ""
      )
      .replace(/\\D/g,"")
      .slice(0,2);


    // Blank ဖြစ်ရင် skip
    if(!result){
      continue;
    }


    if(result.length !== 2){

      notice(
        "historyNotice",
        ROUNDS[i] +
        " Result ၂လုံးထည့်ပါ",
        false
      );

      return;
    }


    var res =
      await fetch(
        "/api/admin/add-history",
        {
          method:"POST",

          headers:{
            "content-type":
              "application/json"
          },

          body:
            JSON.stringify({
              result_date:
                date,

              round_time:
                ROUNDS[i],

              result:
                result
            })
        }
      );


    var data =
      await res.json();


    if(!data.ok){

      notice(
        "historyNotice",
        data.error ||
        "Save Error",
        false
      );

      return;
    }


    saved++;

  }


  if(saved === 0){

    notice(
      "historyNotice",
      "Result အနည်းဆုံးတစ်ခု ထည့်ပါ",
      false
    );

    return;
  }


  notice(
    "historyNotice",
    saved +
    " Round သိမ်းပြီးပါပြီ",
    true
  );


  await loadAdminList();

  await loadOldHistoryValues();

}


// ======================================
// ADMIN LIST LOAD
// ======================================

var adminResults = [];


async function loadAdminList(){

  try{

    var res =
      await fetch(
        "/api/admin/list?t=" +
        Date.now(),
        {
          cache:"no-store"
        }
      );


    var data =
      await res.json();


    adminResults =
      data.results || [];


    var box =
      document
        .getElementById(
          "adminList"
        );


    if(
      adminResults.length === 0
    ){

      box.innerHTML =
        '<div class="small">' +
        'စာရင်းမရှိသေးပါ' +
        '</div>';

      return;
    }


    box.innerHTML =
      adminResults
      .map(
        function(r){

          return (

            '<div class="item">' +

              '<div>' +

                '<div class="item-date">' +

                  escapeHtml(
                    r.result_date
                  ) +

                  ' &nbsp; ' +

                  escapeHtml(
                    r.round_time
                  ) +

                '</div>' +

                '<div class="item-result">' +

                  escapeHtml(
                    r.result
                  ) +

                '</div>' +

              '</div>' +

              '<button ' +
                'class="delete" ' +
                'onclick="deleteResult(' +
                Number(r.id) +
                ')">' +
                'DELETE' +
              '</button>' +

            '</div>'

          );

        }
      )
      .join("");

  }catch(e){

    document
      .getElementById(
        "adminList"
      )
      .textContent =
      "List Load Error";

  }

}


// ======================================
// PRESET RESULT ကို
// ADD OLD HISTORY 6 BOX ထဲပြန်တင်
// ======================================

async function loadOldHistoryValues(){

  var date =
    document
      .getElementById(
        "historyDate"
      )
      .value;

  // Date changes must never reuse results from another day.
  for(var i = 0; i < ROUNDS.length; i++){
    document.getElementById("old_" + i).value = "";
  }

  if(!date){
    return;
  }

  var todayYangon = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Yangon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());

  try{
    // Today/future: show ONLY admin presets.
    // Past dates: show actual saved history.
    var endpoint = date >= todayYangon
      ? "/api/admin/presets?date="
      : "/api/admin/list?date=";

    var res = await fetch(
      endpoint + encodeURIComponent(date) + "&t=" + Date.now(),
      { cache:"no-store" }
    );

    var data = await res.json();
    var dayResults = data.results || [];

    for(var i = 0; i < ROUNDS.length; i++){
      var found = dayResults.find(function(r){
        return r.result_date === date && r.round_time === ROUNDS[i];
      });

      if(found){
        document.getElementById("old_" + i).value = found.result || "";
      }
    }
  }catch(e){
    notice("historyNotice", "History Load Error", false);
  }
}



// ======================================
// DELETE
// ======================================

async function deleteResult(id){

  if(
    !confirm(
      "ဒီ Result ကို ဖျက်မလား?"
    )
  ){
    return;
  }


  try{

    var res =
      await fetch(
        "/api/admin/delete",
        {
          method:"POST",

          headers:{
            "content-type":
              "application/json"
          },

          body:
            JSON.stringify({
              id:id
            })
        }
      );


    var data =
      await res.json();


    if(!data.ok){

      alert(
        data.error ||
        "Delete Error"
      );

      return;
    }


    await loadAdminList();

    await loadOldHistoryValues();


  }catch(e){

    alert(
      "Delete Error"
    );

  }

}


// ======================================
// HTML SAFE
// ======================================

function escapeHtml(text){

  return String(text || "")

    .replace(
      /&/g,
      "&amp;"
    )

    .replace(
      /</g,
      "&lt;"
    )

    .replace(
      />/g,
      "&gt;"
    )

    .replace(
      /"/g,
      "&quot;"
    )

    .replace(
      /'/g,
      "&#039;"
    );

}

// ======================================
// LIVE CONTROL STATUS
// ======================================

async function loadLiveControlStatus(){

  try{

    var res =
      await fetch(
        "/api/admin/live-status?t=" +
        Date.now(),
        {
          cache:"no-store"
        }
      );

    var data =
      await res.json();

    var status =
      document.getElementById(
        "liveControlStatus"
      );

    var btn =
      document.getElementById(
        "liveControlBtn"
      );

    if(!data.ok){

      status.textContent =
        "Status Error";

      return;
    }

    if(data.live_enabled){

      status.textContent =
        "LIVE ON";

      status.style.color =
        "#129849";

      btn.textContent =
        "LIVE OFF";

      btn.style.background =
        "#e5323a";

    }else{

      status.textContent =
        "LIVE OFF";

      status.style.color =
        "#e5323a";

      btn.textContent =
        "LIVE ON";

      btn.style.background =
        "#129849";
    }

  }catch(e){

    document
      .getElementById(
        "liveControlStatus"
      )
      .textContent =
      "Status Error";
  }
}


// ======================================
// LIVE ON / OFF TOGGLE
// ======================================

async function toggleLiveControl(){

  var status =
    document.getElementById(
      "liveControlStatus"
    );

  var currentlyOn =
    status.textContent ===
    "LIVE ON";

  try{

    var res =
      await fetch(
        "/api/admin/live-control",
        {
          method:"POST",

          headers:{
            "content-type":
              "application/json"
          },

          body:
            JSON.stringify({
              enabled:
                !currentlyOn
            })
        }
      );

    var data =
      await res.json();

    if(!data.ok){

      alert(
        data.error ||
        "Live Control Error"
      );

      return;
    }

    await loadLiveControlStatus();

  }catch(e){

    alert(
      "Live Control Error"
    );
  }
}
// ======================================
// INITIAL
// ======================================

async function startAdmin(){

  await loadLiveControlStatus();

  await loadAdminList();

  await loadOldHistoryValues();

}


startAdmin();

</script>

</body>
</html>
`;
}


// ==================================================
// MESSAGE PAGE
// ==================================================

function messagePage(
  message,
  back
){

return `
<!DOCTYPE html>
<html>

<head>

<meta charset="UTF-8">

<meta
name="viewport"
content="width=device-width,initial-scale=1"
>

<title>NIGHT 2D</title>

</head>

<body
style="
margin:0;
padding:35px 20px;
font-family:Arial;
text-align:center;
background:#07111c;
color:#fff;
"
>

<h2>
${escapeServer(message)}
</h2>

<a
href="${escapeServer(back)}"
style="
color:#38a4ff;
font-weight:bold;
"
>
ပြန်သွားရန်
</a>

</body>
</html>
`;
}


function escapeServer(text){

  return String(text || "")

    .replace(
      /&/g,
      "&amp;"
    )

    .replace(
      /</g,
      "&lt;"
    )

    .replace(
      />/g,
      "&gt;"
    )

    .replace(
      /"/g,
      "&quot;"
    )

    .replace(
      /'/g,
      "&#039;"
    );
}
// ==================================================
// HISTORY PAGE
// ==================================================

function historyPage() {

return `
<!DOCTYPE html>
<html>

<head>

<meta charset="UTF-8">

<meta
name="viewport"
content="width=device-width,initial-scale=1,viewport-fit=cover"
>

<title>NIGHT 2D HISTORY</title>

<style>

*{
  box-sizing:border-box;
  -webkit-tap-highlight-color:transparent;
}

html,
body{
  margin:0;
  padding:0;
  width:100%;
  min-height:100%;
}

body{
  background:
    radial-gradient(
      circle at 50% 12%,
      #111820 0%,
      #090d12 36%,
      #05070a 100%
    );
  color:#fff;
  font-family:Arial,Helvetica,sans-serif;
}

.wrap{
  width:100%;
  max-width:720px;
  margin:auto;
  padding:18px 15px 30px;
}

.topbar{
  display:flex;
  align-items:center;
  gap:12px;
  margin-bottom:24px;
}

.back{
  color:#fff;
  text-decoration:none;
  font-size:30px;
  line-height:1;
}

.title{
  font-size:27px;
  font-weight:900;
}

.day-block{
  margin-bottom:26px;
}

.day-title{
  display:flex;
  align-items:center;
  gap:8px;
  font-size:18px;
  font-weight:900;
  margin-bottom:12px;
}

.day-title .moon{
  color:#278dff;
  font-size:23px;
}

.grid{
  display:grid;
  grid-template-columns:repeat(3,1fr);
  gap:9px;
}

.card{
  min-height:112px;
  border-radius:15px;
  background:
    linear-gradient(
      145deg,
      #242a30,
      #171c21
    );
  border:1px solid #303841;
  padding:10px 7px;
  display:flex;
  flex-direction:column;
  justify-content:space-between;
  align-items:center;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.03);
}

.result{
  font-size:27px;
  font-weight:900;
  line-height:1;
}

.card-moon{
  font-size:25px;
  color:#2a8eff;
  line-height:1;
}

.time{
  font-size:12px;
  font-weight:800;
  color:#d2d8de;
  text-align:center;
  white-space:nowrap;
}

.empty{
  color:#697682;
}

.loading,
.no-history,
.error{
  padding:30px 10px;
  text-align:center;
  color:#8896a3;
  font-weight:700;
}

@media(max-width:380px){

  .wrap{
    padding:14px 10px 25px;
  }

  .title{
    font-size:23px;
  }

  .grid{
    gap:7px;
  }

  .card{
    min-height:99px;
    border-radius:13px;
  }

  .result{
    font-size:24px;
  }

  .card-moon{
    font-size:22px;
  }

  .time{
    font-size:10px;
  }

}

</style>

</head>


<body>

<div class="wrap">

  <div class="topbar">

    <a
      class="back"
      href="/"
    >
      ‹
    </a>

    <div class="title">
      History
    </div>

  </div>


  <div
    id="historyList"
    class="loading"
  >
    Loading...
  </div>

</div>


<script>

const ROUNDS =
${JSON.stringify(ROUNDS)};


// ======================================
// DATE DISPLAY
// ======================================

function displayDate(dateText){

  var p =
    String(dateText || "")
    .split("-");

  if(p.length !== 3){
    return dateText;
  }

  return (
    p[2] +
    "/" +
    p[1] +
    "/" +
    p[0]
  );

}


// ======================================
// GROUP HISTORY BY DATE
// ======================================

function groupByDate(rows){

  var groups = {};

  rows.forEach(
    function(row){

      if(!groups[row.result_date]){
        groups[row.result_date] = {};
      }

      groups[row.result_date][
        row.round_time
      ] = row;

    }
  );

  return groups;

}


// ======================================
// HTML ESCAPE
// ======================================

function escapeHtml(text){

  return String(text || "")

    .replace(
      /&/g,
      "&amp;"
    )

    .replace(
      /</g,
      "&lt;"
    )

    .replace(
      />/g,
      "&gt;"
    )

    .replace(
      /"/g,
      "&quot;"
    )

    .replace(
      /'/g,
      "&#039;"
    );

}


// ======================================
// LOAD
// ======================================

async function loadHistory(){

  var root =
    document
    .getElementById(
      "historyList"
    );


  try{

    var res =
      await fetch(
        "/api/history?t=" +
        Date.now(),
        {
          cache:"no-store"
        }
      );


    var rows =
      await res.json();


    if(
      !Array.isArray(rows) ||
      rows.length === 0
    ){

      root.className =
        "no-history";

      root.textContent =
        "History မရှိသေးပါ";

      return;
    }


    var groups =
      groupByDate(rows);


    var dates =
      Object.keys(groups)
      .sort()
      .reverse();


    root.className = "";


    root.innerHTML =
      dates
      .map(
        function(date){

          var roundMap =
            groups[date];


          var cards =
            ROUNDS
            .map(
              function(round){

                var row =
                  roundMap[round];


                var value =
                  row &&
                  row.result
                    ? row.result
                    : "--";


                return (

                  '<div class="card">' +

                    '<div class="result ' +
                    (
                      value === "--"
                        ? "empty"
                        : ""
                    ) +
                    '">' +

                      escapeHtml(
                        value
                      ) +

                    '</div>' +

                    '<div class="card-moon">' +
                      '☾' +
                    '</div>' +

                    '<div class="time">' +

                      escapeHtml(
                        round
                      ) +

                    '</div>' +

                  '</div>'

                );

              }
            )
            .join("");


          return (

            '<section class="day-block">' +

              '<div class="day-title">' +

                '<span class="moon">' +
                  '☾' +
                '</span>' +

                '<span>' +
                  escapeHtml(
                    displayDate(date)
                  ) +
                '</span>' +

              '</div>' +

              '<div class="grid">' +
                cards +
              '</div>' +

            '</section>'

          );

        }
      )
      .join("");


  }catch(e){

    root.className =
      "error";

    root.textContent =
      "History Load Error";

  }

}


loadHistory();

</script>

</body>
</html>
`;

}
