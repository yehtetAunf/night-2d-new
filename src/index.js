export default {
  async fetch(request, env) {

    const url = new URL(request.url);

    if (url.pathname === "/admin") {
      return new Response(adminPage(), {
        headers:{
          "content-type":"text/html;charset=UTF-8"
        }
      });
    }

    return new Response(userPage(), {
      headers:{
        "content-type":"text/html;charset=UTF-8"
      }
    });

  }
}


function userPage(){

return `
<!DOCTYPE html>
<html>
<head>
<title>NIGHT 2D</title>

<style>

body{
margin:0;
background:#020817;
color:white;
font-family:Arial;
text-align:center;
}

.header{
padding:25px;
font-size:35px;
font-weight:bold;
}

.live{
border:2px solid #0787ff;
border-radius:30px;
padding:8px 20px;
font-size:16px;
color:white;
}

.result{
font-size:150px;
font-weight:bold;
margin-top:30px;
}

.time{
font-size:20px;
color:#ddd;
}

.info{
display:grid;
grid-template-columns:1fr 1fr;
gap:15px;
padding:20px;
}

.box{
border:1px solid #234;
border-radius:20px;
padding:25px;
font-size:25px;
}

.set{
color:#0787ff;
}

.value{
color:#00ff99;
}


.rounds{

display:grid;
grid-template-columns:1fr 1fr;
gap:15px;
padding:20px;

}

.card{

border:2px solid #123;
border-radius:20px;
padding:25px;
font-size:25px;

}


button{

width:90%;
padding:20px;
border-radius:30px;
border:none;
background:#0787ff;
color:white;
font-size:25px;

}

</style>

</head>


<body>


<div class="header">
☾ NIGHT <span style="color:#0787ff">2D</span>

<br>

<span class="live">
● 2D LIVE NOW
</span>

</div>


<div class="result">
--
</div>


<div class="time">
Updated --/--/---- | --:--
</div>


<div class="info">

<div class="box set">
SET
<br>
--
</div>


<div class="box value">
VALUE
<br>
--
</div>

</div>



<div class="rounds">


<div class="card">
☾ 10:00 PM
<br><br>
--
</div>


<div class="card">
☾ 10:30 PM
<br><br>
--
</div>


<div class="card">
☾ 11:00 PM
<br><br>
--
</div>


<div class="card">
☾ 11:30 PM
<br><br>
--
</div>


<div class="card">
☾ 12:00 AM
<br><br>
--
</div>


<div class="card">
☾ 12:30 AM
<br><br>
--
</div>


</div>


<button>
◷ 2D HISTORY
</button>


</body>
</html>

`;

}



function adminPage(){

return `

<!DOCTYPE html>

<html>

<head>

<title>NIGHT 2D ADMIN</title>

<style>

body{
font-family:Arial;
padding:20px;
}

input,select{

width:100%;
padding:15px;
margin:8px;

font-size:18px;

}


button{

padding:15px;
width:100%;
background:#0787ff;
color:white;
border:0;
border-radius:10px;

}

</style>


</head>


<body>


<h1>
NIGHT 2D ADMIN
</h1>


<h2>
Set Result
</h2>


Date

<input type="date">


Round Time

<select>

<option>10:00 PM</option>
<option>10:30 PM</option>
<option>11:00 PM</option>
<option>11:30 PM</option>
<option>12:00 AM</option>
<option>12:30 AM</option>

</select>



2D Result

<input placeholder="00">



SET

<input placeholder="SET">



VALUE

<input placeholder="VALUE">



<button>
SAVE RESULT
</button>



<h2>
Add Old History
</h2>


Result Only

<input placeholder="00">


<button>
ADD HISTORY
</button>


</body>

</html>

`;

}
