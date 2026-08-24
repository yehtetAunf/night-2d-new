export default {
  async fetch(request, env) {

    const url = new URL(request.url);

    if (url.pathname === "/api/today") {
      const today = new Date().toISOString().slice(0,10);

      const data = await env.DB.prepare(
        "SELECT * FROM results WHERE result_date=? ORDER BY round_time"
      )
      .bind(today)
      .all();

      return Response.json(data.results);
    }


    if (url.pathname === "/admin") {
      return new Response(adminPage(), {
        headers:{
          "content-type":"text/html;charset=UTF-8"
        }
      });
    }


    return new Response(homePage(),{
      headers:{
        "content-type":"text/html;charset=UTF-8"
      }
    });
  }
};


function homePage(){

return `
<!DOCTYPE html>
<html>
<head>
<title>NIGHT 2D</title>
<style>
body{
background:#020817;
color:white;
font-family:Arial;
text-align:center;
}
h1{
font-size:45px;
}
.result{
font-size:120px;
font-weight:bold;
}
.box{
display:grid;
grid-template-columns:1fr 1fr;
gap:15px;
padding:20px;
}
.card{
border:1px solid #123;
border-radius:20px;
padding:25px;
font-size:25px;
}
.blue{
color:#0787ff;
}
.green{
color:#00ff99;
}
</style>
</head>

<body>

<h1>☾ NIGHT <span class="blue">2D</span></h1>

<div class="result">--</div>

<p>Updated --</p>

<div class="box">

<div class="card blue">
SET<br>--
</div>

<div class="card green">
VALUE<br>--
</div>

</div>


<div class="box">

<div class="card">
☾ 10:00 PM<br><br>--
</div>

<div class="card">
☾ 10:30 PM<br><br>--
</div>


<div class="card">
☾ 11:00 PM<br><br>--
</div>


<div class="card">
☾ 11:30 PM<br><br>--
</div>


<div class="card">
☾ 12:00 AM<br><br>--
</div>


<div class="card">
☾ 12:30 AM<br><br>--
</div>

</div>

</body>
</html>
`;

}



function adminPage(){

return `
<html>
<body>

<h1>NIGHT 2D ADMIN</h1>

<h2>Set Result</h2>

Date<br>
<input type="date"><br><br>

Round<br>
<select>
<option>10:00 PM</option>
<option>10:30 PM</option>
<option>11:00 PM</option>
<option>11:30 PM</option>
<option>12:00 AM</option>
<option>12:30 AM</option>
</select>

<br><br>

2D Result<br>
<input placeholder="00">

<br><br>

SET<br>
<input>

<br><br>

VALUE<br>
<input>


<h2>Add Old History</h2>

Result Only:
<input placeholder="00">


</body>
</html>
`;

}
