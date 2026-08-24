const ROUNDS = [
  "10:00 PM",
  "10:30 PM",
  "11:00 PM",
  "11:30 PM",
  "12:00 AM",
  "12:30 AM"
];

const COOKIE_NAME = "night2d_admin";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {

      // =========================
      // ADMIN PAGE
      // =========================
      if (path === "/admin" && request.method === "GET") {
        if (!isAdmin(request)) {
          return html(adminLoginPage());
        }
        return html(adminPage());
      }

      // =========================
      // ADMIN LOGIN
      // =========================
      if (path === "/admin/login" && request.method === "POST") {
        const form = await request.formData();
        const password = String(form.get("password") || "");

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
            Location: "/admin",
            "Set-Cookie":
              COOKIE_NAME +
              "=yes; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000"
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
              "=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
          }
        });
      }

      // =========================
      // USER LIVE API
      // =========================
      if (path === "/api/live" && request.method === "GET") {
        return json(await getUserState(env));
      }

      // =========================
      // USER HISTORY
      // =========================
      if (path === "/api/history" && request.method === "GET") {
        const rows = await env.DB.prepare(`
          SELECT
            result_date,
            round_time,
            result,
            set_value,
            market_value,
            updated_at
          FROM results
          ORDER BY result_date DESC, id DESC
          LIMIT 100
        `).all();

        const now = Date.now();

        const visible = (rows.results || []).filter((row) => {
          return roundPublishTime(
            row.result_date,
            row.round_time
          ) <= now;
        });

        return json(visible);
      }

      // =========================
      // ADMIN RESULT LIST
      // SET / VALUE မပြ
      // =========================
      if (
        path === "/api/admin/list" &&
        request.method === "GET"
      ) {
        if (!isAdmin(request)) {
          return json(
            { ok: false, error: "Unauthorized" },
            401
          );
        }

        const rows = await env.DB.prepare(`
          SELECT
            id,
            result_date,
            round_time,
            result,
            updated_at
          FROM results
          ORDER BY result_date DESC, id DESC
          LIMIT 200
        `).all();

        return json({
          ok: true,
          results: rows.results || []
        });
      }

      // =========================
      // ADMIN PRESET RESULT
      // Result + SET + VALUE
      // =========================
      if (
        path === "/api/admin/save" &&
        request.method === "POST"
      ) {
        if (!isAdmin(request)) {
          return json(
            { ok: false, error: "Unauthorized" },
            401
          );
        }

        const body = await request.json();

        const resultDate = cleanDate(body.result_date);
        const roundTime = cleanRound(body.round_time);
        const result = cleanResult(body.result);
        const setValue = cleanNumber(body.set_value);
        const marketValue = cleanNumber(body.market_value);

        if (!resultDate) {
          return json(
            { ok: false, error: "Date လိုအပ်ပါတယ်" },
            400
          );
        }

        if (!roundTime) {
          return json(
            { ok: false, error: "Round Time မမှန်ပါ" },
            400
          );
        }

        if (!result) {
          return json(
            { ok: false, error: "2D Result ၂လုံး ထည့်ပါ" },
            400
          );
        }

        if (!setValue) {
          return json(
            { ok: false, error: "SET ထည့်ပါ" },
            400
          );
        }

        if (!marketValue) {
          return json(
            { ok: false, error: "VALUE ထည့်ပါ" },
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
          VALUES (?, ?, ?, ?, ?, datetime('now'))

          ON CONFLICT(result_date, round_time)
          DO UPDATE SET
            result = excluded.result,
            set_value = excluded.set_value,
            market_value = excluded.market_value,
            updated_at = datetime('now')
        `)
        .bind(
          resultDate,
          roundTime,
          result,
          setValue,
          marketValue
        )
        .run();

        return json({
          ok: true,
          message: "Result သတ်မှတ်ပြီးပါပြီ",
          result_date: resultDate,
          round_time: roundTime,
          result
        });
      }

      // =========================
      // ADD OLD HISTORY
      // Result only
      // =========================
      if (
        path === "/api/admin/add-history" &&
        request.method === "POST"
      ) {
        if (!isAdmin(request)) {
          return json(
            { ok: false, error: "Unauthorized" },
            401
          );
        }

        const body = await request.json();

        const resultDate = cleanDate(body.result_date);
        const roundTime = cleanRound(body.round_time);
        const result = cleanResult(body.result);

        if (!resultDate) {
          return json(
            { ok: false, error: "History Date လိုပါတယ်" },
            400
          );
        }

        if (!roundTime) {
          return json(
            { ok: false, error: "Round Time မမှန်ပါ" },
            400
          );
        }

        if (!result) {
          return json(
            { ok: false, error: "2D Result ၂လုံး ထည့်ပါ" },
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
          VALUES (?, ?, ?, NULL, NULL, datetime('now'))

          ON CONFLICT(result_date, round_time)
          DO UPDATE SET
            result = excluded.result,
            updated_at = datetime('now')
        `)
        .bind(
          resultDate,
          roundTime,
          result
        )
        .run();

        return json({
          ok: true,
          message: "Old History ထည့်ပြီးပါပြီ"
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
            { ok: false, error: "Unauthorized" },
            401
          );
        }

        const body = await request.json();
        const id = Number(body.id);

        if (!Number.isInteger(id)) {
          return json(
            { ok: false, error: "Invalid ID" },
            400
          );
        }

        await env.DB.prepare(
          "DELETE FROM results WHERE id = ?"
        )
        .bind(id)
        .run();

        return json({
          ok: true,
          message: "ဖျက်ပြီးပါပြီ"
        });
      }

      if (path === "/history") {
        return html(historyPage());
      }

      if (path === "/") {
        return html(userPage());
      }

      return new Response("Not Found", {
        status: 404
      });

    } catch (error) {
      return json(
        {
          ok: false,
          error:
            error && error.message
              ? error.message
              : String(error)
        },
        500
      );
    }
  }
};


// ==================================================
// USER LIVE STATE
// ==================================================

async function getUserState(env) {

  const sessionDate = getCurrentSessionDate();

  const rows = await env.DB.prepare(`
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

  const data = rows.results || [];
  const now = Date.now();

  const roundResults = {};

  let latest = null;

  for (const round of ROUNDS) {
    roundResults[round] = "--";
  }

  for (const row of data) {

    const publishTime = roundPublishTime(
      row.result_date,
      row.round_time
    );

    // User မှာ အချိန်မရောက်ခင် --
    if (now >= publishTime) {

      roundResults[row.round_time] = row.result;

      if (
        !latest ||
        publishTime >
          roundPublishTime(
            latest.result_date,
            latest.round_time
          )
      ) {
        latest = row;
      }
    }
  }

  return {
    ok: true,

    session_date: sessionDate,

    main_result:
      latest
        ? latest.result
        : "--",

    set_value:
      latest && latest.set_value
        ? latest.set_value
        : "--",

    market_value:
      latest && latest.market_value
        ? latest.market_value
        : "--",

    updated_at:
      latest && latest.updated_at
        ? latest.updated_at
        : null,

    rounds: roundResults
  };
}


// ==================================================
// YANGON TIME
// ==================================================

function yangonNow() {
  const now = new Date();

  return new Date(
    now.getTime() +
    6.5 * 60 * 60 * 1000
  );
}


function getCurrentSessionDate() {

  const d = yangonNow();

  // 12:00 AM / 12:30 AM
  // မနေ့ည session အဖြစ်ယူ
  if (d.getUTCHours() === 0) {
    d.setUTCDate(
      d.getUTCDate() - 1
    );
  }

  return (
    d.getUTCFullYear() +
    "-" +
    pad(d.getUTCMonth() + 1) +
    "-" +
    pad(d.getUTCDate())
  );
}


function roundPublishTime(date, round) {

  const parts = date.split("-");

  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);

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

  let utc = Date.UTC(
    year,
    month - 1,
    day,
    hour - 6,
    minute - 30,
    0
  );

  if (nextDay) {
    utc += 24 * 60 * 60 * 1000;
  }

  return utc;
}


// ==================================================
// INPUT CLEAN
// ==================================================

function cleanDate(value) {

  value = String(value || "");

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return "";
  }

  return value;
}


function cleanRound(value) {

  value = String(value || "");

  return ROUNDS.includes(value)
    ? value
    : "";
}


function cleanResult(value) {

  value = String(value || "")
    .replace(/\D/g, "")
    .slice(0, 2);

  return value.length === 2
    ? value
    : "";
}


function cleanNumber(value) {

  value =
    String(value || "").trim();

  if (
    !/^-?\d+(\.\d+)?$/.test(value)
  ) {
    return "";
  }

  return value;
}


// ==================================================
// ADMIN COOKIE
// ==================================================

function isAdmin(request) {

  const cookie =
    request.headers.get("Cookie") || "";

  return cookie
    .split(";")
    .map(x => x.trim())
    .includes(
      COOKIE_NAME + "=yes"
    );
}


// ==================================================
// RESPONSE
// ==================================================

function html(body, status = 200) {

  return new Response(body, {
    status,
    headers: {
      "content-type":
        "text/html;charset=UTF-8",
      "cache-control":
        "no-store, no-cache, must-revalidate"
    }
  });
}


function json(data, status = 200) {

  return new Response(
    JSON.stringify(data),
    {
      status,
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
  return String(n).padStart(2, "0");
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

<meta
name="viewport"
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
font-family:
Arial,
Helvetica,
sans-serif;
overflow-x:hidden;
}

.app{
width:100%;
max-width:720px;
margin:0 auto;
padding:
18px
18px
22px;
}


/* HEADER */

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


/* MAIN RESULT */

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


/* UPDATED */

.updated{
text-align:center;
font-size:14px;
font-weight:700;
margin:
11px
0
15px;
white-space:nowrap;
}


/* SET VALUE */

.info{
display:grid;
grid-template-columns:
1fr 1fr;
gap:10px;
}

.info-card{
border:
2px solid
#163044;
border-radius:17px;
padding:
13px
7px;
text-align:center;
background:
rgba(
3,
14,
25,
.78
);
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


/* 6 ROUNDS */

.rounds{
display:grid;
grid-template-columns:
1fr 1fr;
gap:
9px
10px;
margin-top:14px;
}

.round{
border:
2px solid
#163044;
border-radius:17px;

height:101px;

background:
rgba(
3,
14,
25,
.78
);

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


/* HISTORY */

.history-btn{
display:flex;
align-items:center;
justify-content:center;

width:100%;

margin-top:13px;

background:
linear-gradient(
135deg,
#1284f8,
#0967d8
);

border-radius:16px;

color:#fff;

padding:14px 10px;

font-size:19px;
font-weight:900;
text-align:center;
text-decoration:none;
}


/* VERY SMALL PHONE */

@media(max-width:380px){

.app{
padding:
12px
11px
15px;
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
padding:
7px
9px;
}

.main-result{
font-size:100px;
height:96px;
margin-top:19px;
}

.updated{
font-size:12px;
margin:
8px
0
11px;
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


/* TALL PHONE */

@media(
min-width:431px
){

.app{
padding:
22px
20px
30px;
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

<span class="menu">
☰
</span>

<span class="moon">
☾
</span>

<span>
NIGHT
<span class="blue">
2D
</span>
</span>

</div>


<div class="live">

<span class="live-dot">
●
</span>

2D LIVE NOW

</div>

</div>



<div
id="mainResult"
class="main-result">
--
</div>



<div class="updated">

Updated

<span id="updatedText">
--/--/---- | --:--:--
</span>

</div>



<div class="info">


<div class="info-card">

<div
class="
info-label
set-color
">
SET
</div>

<div
id="setValue"
class="info-value">
--
</div>

</div>



<div class="info-card">

<div
class="
info-label
value-color
">
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

<span>
☾
</span>

${round}

</div>

<div
id="r_${round.replace(/[^0-9A-Z]/gi,"_")}"
class="
round-result
empty
">
--
</div>

</div>

`).join("")}


</div>



<a
class="history-btn"
href="/history">

◷ &nbsp;
2D HISTORY

</a>


</div>



<script>

const ROUNDS =
${JSON.stringify(ROUNDS)};


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

return (
"--/--/---- | " +
"--:--:--"
);

}


var d =
new Date(

value.indexOf("Z") > -1

? value

: value.replace(
" ",
"T"
) + "Z"

);


if(
isNaN(
d.getTime()
)
){

return value;

}


return d
.toLocaleString(
"en-GB",
{
timeZone:
"Asia/Yangon",

day:"2-digit",
month:"2-digit",
year:"numeric",

hour:"2-digit",
minute:"2-digit",
second:"2-digit",

hour12:true
}
)
.replace(
",",
""
);

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


document
.getElementById(
"mainResult"
)
.textContent =
data.main_result || "--";


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


if(
value === "--"
){

el.classList.add(
"empty"
);

}else{

el.classList.remove(
"empty"
);

}

}
);


}catch(e){

console.log(e);

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
// ADMIN LOGIN
// ==================================================

function adminLoginPage() {

return `
<!DOCTYPE html>

<html>

<head>

<meta charset="UTF-8">

<meta
name="viewport"
content="
width=device-width,
initial-scale=1
">

<title>
NIGHT 2D ADMIN
</title>


<style>

*{
box-sizing:border-box;
}

body{
margin:0;
font-family:Arial;
background:#07111c;
color:white;
}

.wrap{
max-width:500px;
margin:auto;
padding:30px 20px;
}

.card{
background:#0d1d2a;
border:1px solid #17344a;
padding:25px;
border-radius:20px;
}

h1{
text-align:center;
color:#168cff;
}

input{
width:100%;
padding:16px;
border-radius:12px;
border:1px solid #365064;
font-size:18px;
margin:12px 0;
}

button{
width:100%;
padding:16px;
background:#087cf0;
border:0;
border-radius:12px;
color:white;
font-size:19px;
font-weight:bold;
}

</style>

</head>


<body>

<div class="wrap">

<div class="card">

<h1>
NIGHT 2D ADMIN
</h1>


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
placeholder="Admin password"
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
content="
width=device-width,
initial-scale=1
">

<title>
NIGHT 2D ADMIN
</title>


<style>

*{
box-sizing:border-box;
}

body{
margin:0;
background:#f4f7fa;
font-family:Arial;
color:#162330;
}

.header{
background:#07111c;
color:white;
padding:22px;
text-align:center;
font-size:28px;
font-weight:900;
}

.wrap{
max-width:720px;
margin:auto;
padding:20px;
}

.card{
background:white;
border-radius:20px;
padding:22px;
margin-bottom:22px;
box-shadow:
0 8px 25px
rgba(0,0,0,.07);
}

h2{
color:#087cf0;
margin-top:0;
}

label{
font-weight:700;
display:block;
margin-top:14px;
}

input,
select{
width:100%;
padding:15px;
font-size:17px;
border:
1px solid
#c9d2dc;
border-radius:12px;
margin-top:7px;
}

button{
width:100%;
border:0;
border-radius:12px;
padding:16px;
font-size:18px;
font-weight:800;
color:#fff;
margin-top:18px;
cursor:pointer;
}

.save{
background:#0783f3;
}

.history-save{
background:#15a04b;
}

.logout{
display:block;
background:#e12d35;
color:#fff;
padding:14px;
border-radius:12px;
text-decoration:none;
text-align:center;
font-weight:800;
margin-bottom:20px;
}

.notice{
padding:14px;
border-radius:12px;
margin:12px 0;
display:none;
}

.success{
display:block;
background:#ddf8e7;
color:#087c32;
}

.error{
display:block;
background:#ffe1e1;
color:#b41515;
}

.admin-list{
margin-top:18px;
}

.item{
display:flex;
align-items:center;
justify-content:space-between;
gap:12px;
border:
1px solid
#dbe2e8;
border-radius:12px;
padding:12px;
margin-bottom:9px;
}

.item-result{
font-size:25px;
font-weight:900;
color:#087cf0;
}

.small{
font-size:13px;
color:#65717d;
}

.delete{
width:auto;
padding:8px 12px;
margin:0;
background:#dc3545;
font-size:13px;
}

</style>

</head>


<body>


<div class="header">
🌙 NIGHT 2D ADMIN
</div>


<div class="wrap">


<a
class="logout"
href="/admin/logout"
>
LOGOUT ADMIN
</a>



<div class="card">

<h2>
ကြိုတင် Result သတ်မှတ်ရန်
</h2>


<div
id="saveNotice"
class="notice">
</div>


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
r =>
`<option>${r}</option>`
).join("")}

</select>


<label>
2D RESULT
</label>

<input
id="result"
inputmode="numeric"
maxlength="2"
placeholder="00"
>


<label>
SET
</label>

<input
id="set"
inputmode="decimal"
placeholder="1234.56"
>


<label>
VALUE
</label>

<input
id="value"
inputmode="decimal"
placeholder="56789.12"
>


<button
class="save"
onclick="saveResult()"
>
SAVE / UPDATE RESULT
</button>


</div>



<div class="card">


<h2>
Add Old History
</h2>


<div
id="historyNotice"
class="notice">
</div>


<label>
History Date
</label>

<input
id="historyDate"
type="date"
>


<label>
Round Time
</label>


<select id="historyRound">

${ROUNDS.map(
r =>
`<option>${r}</option>`
).join("")}

</select>


<label>
2D RESULT
</label>


<input
id="historyResult"
inputmode="numeric"
maxlength="2"
placeholder="00"
>


<button
class="history-save"
onclick="addHistory()"
>
ADD OLD HISTORY
</button>



<h3>
Admin Add Old History စာရင်း
</h3>


<div class="small">

SET / VALUE မပြပါ။

ကြိုတင်သတ်မှတ်ထားတဲ့ Result
ဂဏန်းကိုတော့ Admin မှာ
ချက်ချင်းမြင်ရပါမယ်။

User App မှာ Round အချိန်
မရောက်သေးရင် -- ပဲပြပါမယ်။

</div>


<div
id="adminList"
class="admin-list"
>
Loading...
</div>


</div>


</div>



<script>


function todayYangon(){

var now =
new Date();


var parts =
new Intl.DateTimeFormat(
"en-CA",
{
timeZone:
"Asia/Yangon",

year:"numeric",
month:"2-digit",
day:"2-digit"
}
)
.formatToParts(now);


var obj = {};


parts.forEach(
function(p){

obj[p.type] =
p.value;

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
.getElementById(
"date"
)
.value =
todayYangon();


document
.getElementById(
"historyDate"
)
.value =
todayYangon();



function showNotice(
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
? "success"
: "error"
);

}



async function saveResult(){

var payload = {

result_date:
document
.getElementById(
"date"
)
.value,

round_time:
document
.getElementById(
"round"
)
.value,

result:
document
.getElementById(
"result"
)
.value,

set_value:
document
.getElementById(
"set"
)
.value,

market_value:
document
.getElementById(
"value"
)
.value

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


showNotice(
"saveNotice",
data.message ||
data.error ||
"Unknown",
!!data.ok
);


if(data.ok){

loadAdminList();

}


}catch(e){

showNotice(
"saveNotice",
"Save Error",
false
);

}

}



async function addHistory(){

var payload = {

result_date:
document
.getElementById(
"historyDate"
)
.value,

round_time:
document
.getElementById(
"historyRound"
)
.value,

result:
document
.getElementById(
"historyResult"
)
.value

};


try{

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
JSON.stringify(
payload
)
}
);


var data =
await res.json();


showNotice(
"historyNotice",
data.message ||
data.error ||
"Unknown",
!!data.ok
);


if(data.ok){

document
.getElementById(
"historyResult"
)
.value = "";

loadAdminList();

}


}catch(e){

showNotice(
"historyNotice",
"History Save Error",
false
);

}

}



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


var box =
document
.getElementById(
"adminList"
);


if(
!data.results ||
data.results.length === 0
){

box.innerHTML =
'<div class="small">' +
'စာရင်းမရှိသေးပါ' +
'</div>';

return;

}


box.innerHTML =
data.results
.map(
function(r){

return (

'<div class="item">' +

'<div>' +

'<div class="small">' +

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

'<button class="delete" ' +

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
"List load error";

}

}



async function deleteResult(id){

if(
!confirm(
"ဒီ Result ကို ဖျက်မလား?"
)
){

return;

}


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


if(data.ok){

loadAdminList();

}else{

alert(
data.error ||
"Delete error"
);

}

}



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


loadAdminList();


</script>


</body>

</html>
`;

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
content="
width=device-width,
initial-scale=1
">

<title>
NIGHT 2D HISTORY
</title>


<style>

*{
box-sizing:border-box;
}

body{
margin:0;
background:#020b15;
color:white;
font-family:Arial;
}

.wrap{
max-width:650px;
margin:auto;
padding:22px;
}

h1{
color:#168cff;
text-align:center;
}

.back{
display:block;
text-align:center;
color:white;
text-decoration:none;
background:#087cf0;
padding:14px;
border-radius:14px;
margin-bottom:20px;
}

.item{
background:#071725;
border:
1px solid
#17354a;
border-radius:15px;
padding:17px;
margin-bottom:10px;
}

.date{
color:#8595a4;
font-size:13px;
}

.row{
display:flex;
justify-content:space-between;
align-items:center;
margin-top:7px;
}

.result{
font-size:30px;
font-weight:900;
color:#168cff;
}

</style>

</head>


<body>


<div class="wrap">


<h1>
🌙 2D HISTORY
</h1>


<a
class="back"
href="/"
>
← BACK TO NIGHT 2D
</a>


<div id="list">
Loading...
</div>


</div>



<script>


async function load(){

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


var list =
document
.getElementById(
"list"
);


if(!rows.length){

list.textContent =
"History မရှိသေးပါ";

return;

}


list.innerHTML =
rows
.map(
function(r){

return (

'<div class="item">' +

'<div class="date">' +

escapeHtml(
r.result_date
) +

'</div>' +

'<div class="row">' +

'<strong>' +

escapeHtml(
r.round_time
) +

'</strong>' +

'<div class="result">' +

escapeHtml(
r.result
) +

'</div>' +

'</div>' +

'</div>'

);

}
)
.join("");


}catch(e){

document
.getElementById(
"list"
)
.textContent =
"History Load Error";

}

}



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


load();


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
) {

return `
<!DOCTYPE html>

<html>

<head>

<meta
name="viewport"
content="
width=device-width,
initial-scale=1
">

<title>
NIGHT 2D
</title>

</head>


<body
style="
font-family:Arial;
padding:30px;
text-align:center;
"
>

<h2>
${escapeServer(message)}
</h2>

<a
href="${escapeServer(back)}"
>
ပြန်သွားရန်
</a>

</body>

</html>
`;

}


function escapeServer(text) {

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
