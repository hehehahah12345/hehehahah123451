// JARVIS HUD – ported from the original jarvis-hud.html.
// The look, layout, panel format, boards, history, timer, notes, skins and
// all-night screen work the same way. What changed: instead of the browser's
// limited abilities, this version talks to the desktop app (window.jarvis) for
// Claude, real voice, real computer info, school, weather and staying awake.
(function(){
"use strict";
var J=window.jarvis;
var $=function(id){return document.getElementById(id)};
var board=$("board"),cols=$("cols"),home=$("home"),statusEl=$("status"),orb=$("orb"),
    form=$("form"),qIn=$("q"),go=$("go"),chips=$("chips"),sheet=$("sheet"),setSheet=$("setSheet"),
    bHist=$("bHist"),bSet=$("bSet"),bFull=$("bFull"),bHome=$("bHome"),
    bPhoto=$("bPhoto"),bMic=$("bMic"),bCam=$("bCam"),file=$("file"),thumb=$("thumb"),thumbImg=$("thumbImg"),thumbX=$("thumbX"),drop=$("drop"),
    cap=$("cap"),capTxt=$("capTxt"),capBtns=$("capBtns");
var reduce=window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches;
var root=document.documentElement;

/* ---------- helpers ---------- */
function store(k,v){try{if(v===undefined){var r=localStorage.getItem(k);return r==null?null:JSON.parse(r)}localStorage.setItem(k,JSON.stringify(v))}catch(e){return null}}
function S(x,max){if(x==null)return"";x=String(x).replace(/\s+/g," ").trim();return max&&x.length>max?x.slice(0,max-1)+"…":x}
function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}
function noop(){}
function setStatus(head,rest,err){statusEl.className="status"+(err?" err":"");statusEl.textContent="";statusEl.append(el("b",null,head));if(rest)statusEl.append(" · "+rest)}
function caption(text,buttons){capTxt.textContent=text||"";capBtns.textContent="";(buttons||[]).forEach(function(b){capBtns.append(b)});cap.hidden=!text}

/* ---------- settings (kept by the desktop app so Jarvis's tools can change them too) ---------- */
var app={};   // full settings from the desktop app
var cfg={voice:true,voiceName:"",rate:1.05,skin:"ice",sfx:true,depth:"default"};
var SKINS=["ice","arc","ember","ghost"],cLine,cHot,cFg;
function readColours(){var cs=getComputedStyle(root);cLine=cs.getPropertyValue("--line").trim();cHot=cs.getPropertyValue("--hot").trim();cFg=cs.getPropertyValue("--fg").trim()}
function applySkin(){if(SKINS.indexOf(cfg.skin)<0)cfg.skin="ice";if(cfg.skin==="ice")root.removeAttribute("data-skin");else root.setAttribute("data-skin",cfg.skin);readColours();
  document.querySelectorAll("#skins .sw").forEach(function(b){b.classList.toggle("on",b.dataset.skin===cfg.skin)})}
function saveCfg(){J.settings.set({voice:cfg.voice,voiceName:cfg.voiceName,rate:cfg.rate,skin:cfg.skin,sfx:cfg.sfx,depth:cfg.depth}).then(function(s){app=s;paintCfg()});paintCfg()}
function tog(id,on){$(id).textContent=on?"On":"Off";$(id).classList.toggle("on",!!on)}
function paintCfg(){
  tog("sVoice",cfg.voice);tog("sSfx",cfg.sfx);tog("sWake",app.wakeWord);tog("sAuto",app.startWithComputer);
  $("sDepth").textContent=cfg.depth==="quick"?"Fast":"Deep";$("sRate").value=cfg.rate;
  if(cfg.voiceName)$("sVoiceName").value=cfg.voiceName;
  $("kClaudeSt").textContent=app.anthropicKeySet?"saved ✓":"required";$("kElevenSt").textContent=app.elevenKeySet?"saved ✓":"not set: using the built-in voice";
  if(document.activeElement!==$("kVoiceId"))$("kVoiceId").value=app.elevenVoiceId||"";
  if(document.activeElement!==$("sModel"))$("sModel").value=app.model||"";
  $("sPtt").value=app.pushToTalkKey||"RightCtrl";$("sUnits").value=app.units||"metric";$("sSchMin").value=app.schoolRefreshMinutes||120;
}
var SW={ice:["#8fcfff","#ff2f5e"],arc:["#5ee6ff","#ffb52e"],ember:["#ffb37a","#ff5a1f"],ghost:["#7dffb8","#e8ff4a"]};
SKINS.forEach(function(s){var b=el("button","sw");b.type="button";b.dataset.skin=s;b.title=s;b.setAttribute("aria-label",s+" skin");b.style.background="linear-gradient(135deg,"+SW[s][0]+" 50%,"+SW[s][1]+" 50%)";
  b.addEventListener("click",function(){cfg.skin=s;saveCfg();applySkin();blip(660,.06)});$("skins").append(b)});
applySkin();
function fillVoices(){var sel=$("sVoiceName"),vs=Voice.builtInVoices();sel.textContent="";var a=el("option",null,"Automatic");a.value="";sel.append(a);
  vs.forEach(function(v){var o=el("option",null,v.name);o.value=v.name;sel.append(o)});sel.value=cfg.voiceName||""}
speechSynthesis.addEventListener("voiceschanged",fillVoices);fillVoices();
$("sVoice").addEventListener("click",function(){cfg.voice=!cfg.voice;saveCfg();if(!cfg.voice)Voice.stopSpeaking()});
$("sSfx").addEventListener("click",function(){cfg.sfx=!cfg.sfx;saveCfg();blip(880,.06)});
$("sDepth").addEventListener("click",function(){cfg.depth=cfg.depth==="quick"?"default":"quick";saveCfg()});
$("sVoiceName").addEventListener("change",function(){cfg.voiceName=this.value;saveCfg()});
$("sRate").addEventListener("change",function(){cfg.rate=Number(this.value)||1;saveCfg()});
$("sTest").addEventListener("click",function(){say("Good "+dayPart()+", Sir. All systems are standing by.",true)});
$("sWake").addEventListener("click",function(){J.settings.set({wakeWord:!app.wakeWord}).then(function(s){app=s;paintCfg();Voice.setWake(!!s.wakeWord);refreshSystems()})});
$("sAuto").addEventListener("click",function(){J.settings.set({startWithComputer:!app.startWithComputer}).then(function(s){app=s;paintCfg()})});
$("sPtt").addEventListener("change",function(){J.settings.set({pushToTalkKey:this.value}).then(function(s){app=s;refreshSystems()})});
$("sUnits").addEventListener("change",function(){J.settings.set({units:this.value}).then(function(s){app=s;wxLoad()})});
$("sSchMin").addEventListener("change",function(){J.settings.set({schoolRefreshMinutes:Math.max(15,Number(this.value)||120)}).then(function(s){app=s;paintCfg()})});
$("sModel").addEventListener("change",function(){var m=this.value.trim();if(m)J.settings.set({model:m}).then(function(s){app=s})});
$("kSave").addEventListener("click",function(){
  var p={},a=$("kClaude").value.trim(),e=$("kEleven").value.trim(),v=$("kVoiceId").value.trim();
  if(a)p.anthropicKey=a;if(e)p.elevenKey=e;if(v)p.elevenVoiceId=v;
  J.settings.set(p).then(function(s){app=s;$("kClaude").value="";$("kEleven").value="";paintCfg();refreshSystems();chime();setStatus("Keys saved")});
});
$("sSignOut").addEventListener("click",function(){J.school.signOut().then(function(){setStatus("School","signed out of Brightspace and Classroom on this app")})});

/* ---------- sound effects (synthesised) ---------- */
var ac=null;
function blip(f,d,type,vol){
  if(!cfg.sfx)return;
  try{ac=ac||new (window.AudioContext||window.webkitAudioContext)();if(ac.state==="suspended")ac.resume();
    var o=ac.createOscillator(),g=ac.createGain(),t=ac.currentTime;o.type=type||"sine";o.frequency.setValueAtTime(f,t);o.frequency.exponentialRampToValueAtTime(f*1.4,t+d);
    g.gain.setValueAtTime(vol||.045,t);g.gain.exponentialRampToValueAtTime(.0001,t+d);o.connect(g).connect(ac.destination);o.start(t);o.stop(t+d+.02)}catch(e){}
}
function chime(){blip(520,.12);setTimeout(function(){blip(780,.18)},110)}
function alarm(){for(var i=0;i<4;i++)setTimeout(function(){blip(940,.22,"square",.05)},i*380)}

/* ---------- example board ---------- */
var EXAMPLE={q:"Example: pull up the Raspberry Pi 5",items:[
 {d:{t:"subject",title:"Raspberry Pi 5",kicker:"Example board",tagline:"A credit-card-sized computer that is quick enough to use as a real desktop.",say:""}},
 {d:{t:"stat",value:"2–3×",label:"Faster than the Pi 4",detail:"Raspberry Pi's own figure for CPU speed against the previous model."}},
 {d:{t:"list",title:"What's on the board",items:["Quad-core Arm Cortex-A76 at 2.4 GHz","2, 4, 8 or 16 GB of memory","Two micro-HDMI ports, each up to 4K at 60 Hz","Two USB 3.0, two USB 2.0, gigabit Ethernet","Wi-Fi 5 and Bluetooth 5.0","PCIe connector for an SSD, plus a power button"]}},
 {d:{t:"bars",title:"Launch price by memory",unit:"USD",bars:[{l:"16 GB",v:120},{l:"8 GB",v:80},{l:"4 GB",v:60},{l:"2 GB",v:50}],note:"Launch prices in US dollars. Prices have moved since, so check a current listing."}},
 {d:{t:"note",title:"What people build",body:"Retro game consoles, home media servers, network ad blockers, robot brains, weather stations and small always-on computers for running code or AI assistants."}},
 {d:{t:"warn",title:"Catches",body:"It wants a 27 W (5 V, 5 A) USB-C power supply to run every port at full power, and it runs hot under load, so plan on the fan cooler. Case, card and supply are all extra."}},
 {d:{t:"links",title:"Look it up",links:[{label:"Current price in Canada",q:"Raspberry Pi 5 8GB price Canada",site:"web"},{label:"Beginner setup guide",q:"Raspberry Pi 5 beginner setup",site:"youtube"},{label:"Project ideas",q:"best Raspberry Pi 5 projects",site:"web"}]}}
]};
var CHIPS=["Brief me on my day","How are my marks?","What homework is due this week?","Solve 2x² − 5x − 3 = 0 and show the steps","Will it snow in Caledon this week?","What are my computer's specs?","Start a 25 minute focus timer","Open Spotify","Pause the music","Gaming laptop vs desktop at $1,500","Switch to the arc skin","Show the example board"];

/* ---------- board state + layout ---------- */
var cards=[],colEls=[],nCols=0,subject=null,isExample=false,curQ="",busy=false,shotUrl=null,boardId=Date.now();
function colCount(){var w=board.clientWidth;return w<620?1:w<1000?2:w<1500?3:4}
function buildCols(){
  nCols=colCount();cols.textContent="";colEls=[];cols.classList.toggle("wide",nCols>=3);
  var mid=Math.floor((nCols-1)/2);
  for(var i=0;i<nCols;i++){var c=el("div","col"+(nCols>=3&&i===mid?" mid":""));cols.append(c);colEls.push(c)}
  cards.forEach(function(c){c.el.style.translate="";c.el.style.animation="none";place(c)});
}
function place(c){
  var target;
  if(c.d.t==="subject")target=colEls[Math.floor((nCols-1)/2)];
  else{target=colEls[0];for(var i=1;i<colEls.length;i++)if(colEls[i].offsetHeight<target.offsetHeight-4)target=colEls[i]}
  target.append(c.el);
}
function clearBoard(){cards=[];subject=null;cols.querySelectorAll(".card").forEach(function(n){n.remove()});if(shotUrl){URL.revokeObjectURL(shotUrl);shotUrl=null}}
function showBoard(){home.hidden=true;cols.hidden=false;if(colCount()!==nCols||!colEls.length)buildCols()}
function showHome(){home.hidden=false;cols.hidden=true;paintRecent();board.scrollTop=0}
var rz;window.addEventListener("resize",function(){clearTimeout(rz);rz=setTimeout(function(){if(!cols.hidden&&colCount()!==nCols)buildCols()},120)});

/* ---------- panel rendering ---------- */
var LABEL={subject:"Subject",note:"Note",stat:"Figure",list:"Brief",steps:"Steps",bars:"Chart",table:"Compare",warn:"Caution",links:"Search"};
function normalize(d){
  if(!d||typeof d!=="object")return null;
  var t=String(d.t||d.type||"");if(!LABEL[t])return null;
  var o={t:t,title:S(d.title,90)};
  if(t==="subject"){o.kicker=S(d.kicker,40);o.tagline=S(d.tagline,220);o.say=S(d.say,400);if(!o.title)return null}
  else if(t==="note"||t==="warn"){o.body=S(d.body,520);if(!o.body)return null}
  else if(t==="stat"){o.value=S(d.value,24);o.label=S(d.label,80);o.detail=S(d.detail,200);if(!o.value)return null}
  else if(t==="list"||t==="steps"){o.items=(Array.isArray(d.items)?d.items:[]).map(function(x){return S(x,170)}).filter(Boolean).slice(0,10);if(!o.items.length)return null}
  else if(t==="bars"){o.unit=S(d.unit,16);o.note=S(d.note,220);
    o.bars=(Array.isArray(d.bars)?d.bars:[]).map(function(b){return{l:S(b&&b.l,40),v:Number(b&&b.v)}}).filter(function(b){return b.l&&isFinite(b.v)&&b.v>=0}).slice(0,8);
    if(o.bars.length<2)return null}
  else if(t==="table"){o.cols=(Array.isArray(d.cols)?d.cols:[]).map(function(x){return S(x,40)}).slice(0,5);
    o.rows=(Array.isArray(d.rows)?d.rows:[]).filter(Array.isArray).map(function(r){return r.slice(0,5).map(function(x){return S(x,90)})}).slice(0,9);
    if(!o.rows.length)return null}
  else if(t==="links"){o.links=(Array.isArray(d.links)?d.links:[]).map(function(l){return{label:S(l&&l.label,70),q:S(l&&l.q,120),site:l&&l.site==="youtube"?"youtube":"web"}}).filter(function(l){return l.q}).slice(0,6);if(!o.links.length)return null}
  return o;
}
function fmt(v){return Math.abs(v)>=1000?Math.round(v).toLocaleString("en-CA"):String(Math.round(v*100)/100)}
function render(d,idx){
  var c=el("article","card "+d.t);
  var hd=el("div","hd");hd.append(el("span",null,LABEL[d.t]+" // "+String(idx).padStart(2,"0")),el("span",null,d.t==="subject"?"LOCK":"LINK"));c.append(hd);
  if(d.t==="subject"){
    if(d.kicker)c.append(el("div","kick",d.kicker));
    if(shotUrl){var sh=el("div","shot"),im=el("img");im.src=shotUrl;im.alt="Photo you attached";sh.append(im);c.append(sh)}
    c.append(el("h3",null,d.title));
    if(d.tagline)c.append(el("p","tag",d.tagline));
    if(curQ)c.append(el("div","q","> "+curQ));
  }else if(d.t==="stat"){
    c.append(el("div","val",d.value));if(d.label)c.append(el("div","lab",d.label));if(d.detail)c.append(el("p","det",d.detail));
  }else{
    if(d.title)c.append(el("h3",null,d.title));
    if(d.t==="note"||d.t==="warn")c.append(el("p",null,d.body));
    if(d.t==="list"||d.t==="steps"){var L=el(d.t==="steps"?"ol":"ul");d.items.forEach(function(x){L.append(el("li",null,x))});c.append(L)}
    if(d.t==="bars"){
      var max=Math.max.apply(null,d.bars.map(function(b){return b.v}))||1,g=el("div","bgrid");
      d.bars.forEach(function(b){var tr=el("div","tr"),bar=el("div","b");bar.style.width=Math.max(1,b.v/max*100)+"%";tr.append(bar);g.append(el("div","l",b.l),tr,el("div","v",fmt(b.v)))});
      c.append(g);c.append(el("div","fine",(d.unit?"Unit: "+d.unit+". ":"")+(d.note||"")));
    }
    if(d.t==="table"){
      var w=el("div","tw"),tb=el("table");
      if(d.cols.length){var th=el("tr");d.cols.forEach(function(x){th.append(el("th",null,x))});tb.append(th)}
      d.rows.forEach(function(r){var tr=el("tr");r.forEach(function(x){tr.append(el("td",null,x))});tb.append(tr)});
      w.append(tb);c.append(w);
    }
    if(d.t==="links"){
      var ls=el("div","links");
      d.links.forEach(function(l){var a=el("a");a.target="_blank";a.rel="noopener noreferrer";
        a.href=l.site==="youtube"?"https://www.youtube.com/results?search_query="+encodeURIComponent(l.q):"https://www.google.com/search?q="+encodeURIComponent(l.q);
        a.append(el("span",null,l.site==="youtube"?"VIDEO":"WEB"),document.createTextNode(l.label||l.q));ls.append(a)});
      c.append(ls);
    }
  }
  if(d.t!=="subject"&&d.t!=="links"){
    var ft=el("div","ft");ft.append(el("span",null,"JRV-"+(1000+idx*37%9000)));
    var dig=el("button","dig","+ Dig deeper");dig.type="button";dig.disabled=busy;dig.addEventListener("click",function(){expand(c)});ft.append(dig);c.append(ft);
  }
  enableDrag(c,hd);
  return c;
}
function addCard(raw,parentEl){
  var d=normalize(raw);if(!d)return null;
  if(d.t==="subject"&&subject)return null;
  var c={d:d,parent:parentEl||null};
  c.el=render(d,cards.length+1);
  if(nCols>=3&&d.t!=="subject"&&!reduce){var j=(cards.length*53)%17-8;c.el.style.translate=j+"px 0"}
  cards.push(c);if(d.t==="subject")subject=c.el;
  place(c);return c;
}
function enableDrag(card,handle){
  var sx,sy,ox=0,oy=0,on=false;
  handle.addEventListener("pointerdown",function(e){
    if(nCols<2||e.button)return;on=true;sx=e.clientX;sy=e.clientY;
    var t=(card.style.translate||"0px 0px").split(" ");ox=parseFloat(t[0])||0;oy=parseFloat(t[1])||0;
    card.classList.add("drag");handle.setPointerCapture(e.pointerId);e.preventDefault();
  });
  handle.addEventListener("pointermove",function(e){if(on)card.style.translate=(ox+e.clientX-sx)+"px "+(oy+e.clientY-sy)+"px"});
  function end(){on=false;card.classList.remove("drag")}
  handle.addEventListener("pointerup",end);handle.addEventListener("pointercancel",end);
}

/* ---------- graphics: dust + board wires, and the home reactor ---------- */
var fx=$("fx"),g=fx.getContext("2d"),dust=[],W=0,H=0,core=$("core"),k=core.getContext("2d");
function sizeFx(){var r=Math.min(window.devicePixelRatio||1,2);W=innerWidth;H=innerHeight;fx.width=W*r;fx.height=H*r;g.setTransform(r,0,0,r,0,0)}
sizeFx();window.addEventListener("resize",sizeFx);
for(var i=0;i<46;i++)dust.push({x:Math.random(),y:Math.random(),s:.4+Math.random()*1.4,v:.00008+Math.random()*.00022});
function centre(n){var r=n.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}}
var listening=false,speaking=false,spin=0,amp=3,lastT=0;
function mode(){return listening?"listen":speaking?"speak":busy?"think":"idle"}
function arc(r,a0,a1,w,col,al){k.globalAlpha=al;k.strokeStyle=col;k.lineWidth=w;k.beginPath();k.arc(440,440,r,a0,a1);k.stroke()}
function drawCore(t,dt){
  var m=mode(),speed={idle:1,think:5,listen:2,speak:2.5}[m],target={idle:4,think:9,listen:22,speak:30}[m];
  if(!reduce)spin+=dt*.00022*speed;amp+=(target-amp)*.08;
  k.clearRect(0,0,880,880);k.lineCap="butt";
  var sec=new Date().getSeconds();
  for(var i=0;i<60;i++){var a=i/60*Math.PI*2-Math.PI/2,big=i%5===0,r0=big?396:408,cur=i===sec;
    k.globalAlpha=cur?1:big?.7:.3;k.strokeStyle=cur?cHot:cLine;k.lineWidth=cur?6:big?3:2;k.beginPath();
    k.moveTo(440+Math.cos(a)*(cur?388:r0),440+Math.sin(a)*(cur?388:r0));k.lineTo(440+Math.cos(a)*424,440+Math.sin(a)*424);k.stroke()}
  for(var j=0;j<3;j++)arc(366,spin+j*2.094,spin+j*2.094+1.5,10,cLine,.55);
  k.setLineDash([4,14]);arc(330,-spin*1.7,-spin*1.7+Math.PI*2,3,cLine,.5);k.setLineDash([]);
  arc(298,-spin*2.4,-spin*2.4+1.1,5,cHot,.95);arc(298,-spin*2.4+Math.PI,-spin*2.4+Math.PI+1.1,5,cHot,.95);
  arc(298,0,Math.PI*2,1,cLine,.25);
  k.globalAlpha=.9;k.strokeStyle=m==="idle"?cLine:cHot;k.lineWidth=2.5;k.beginPath();
  for(var s=0;s<=180;s++){var th=s/180*Math.PI*2,tt=reduce?0:t/1000,
    wv=Math.sin(th*7+tt*3.1)*.5+Math.sin(th*13-tt*4.3)*.3+Math.sin(th*3+tt*1.7)*.2,
    rr=262+wv*amp*(m==="speak"?(.6+.4*Math.sin(tt*9)):1);
    var x=440+Math.cos(th)*rr,y=440+Math.sin(th)*rr;if(s)k.lineTo(x,y);else k.moveTo(x,y)}
  k.closePath();k.stroke();k.globalAlpha=1;
}
function frame(t){
  var dt=Math.min(60,t-lastT);lastT=t;
  g.clearRect(0,0,W,H);g.fillStyle=cLine;
  dust.forEach(function(p){if(!reduce){p.y-=p.v;if(p.y<0)p.y=1}g.globalAlpha=.16+.14*Math.sin(p.x*40+t/1700);g.fillRect(p.x*W,p.y*H,p.s,p.s)});
  if(!cols.hidden&&nCols>=2&&cards.length>1){
    var b=board.getBoundingClientRect();g.save();g.beginPath();g.rect(b.left,b.top,b.width,b.height);g.clip();
    cards.forEach(function(c,i){
      var from=c.parent&&c.parent.isConnected?c.parent:subject;if(!from||from===c.el||!c.el.isConnected)return;
      var a=centre(from),z=centre(c.el);
      g.globalAlpha=.45;g.strokeStyle=cLine;g.lineWidth=1;g.beginPath();g.moveTo(a.x,a.y);g.lineTo(z.x,z.y);g.stroke();
      if(!reduce){var kk=((t/2600)+i*.17)%1;g.globalAlpha=.9;g.fillStyle=cHot;g.fillRect(a.x+(z.x-a.x)*kk-2,a.y+(z.y-a.y)*kk-2,4,4)}
    });
    g.restore();
  }
  g.globalAlpha=1;
  if(!home.hidden)drawCore(t,dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* ---------- clock, greeting ---------- */
function dayPart(){var h=new Date().getHours();return h<5?"evening":h<12?"morning":h<18?"afternoon":"evening"}
function tickClock(){var d=new Date();$("bigClock").textContent=d.toLocaleTimeString("en-CA",{hour:"2-digit",minute:"2-digit",hour12:false});
  $("bigDate").textContent=d.toLocaleDateString("en-CA",{weekday:"long",month:"long",day:"numeric"});$("greet").textContent="Good "+dayPart()+", Sir"}
tickClock();setInterval(tickClock,5000);

/* ---------- focus timer (runs in the desktop app, so it keeps going when the HUD is hidden) ---------- */
var tm={label:"",totalMs:1500000,remainingMs:1500000,running:false,endsAt:null};
function mmss(s){s=Math.max(0,Math.round(s));var h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;return(h?h+":"+String(m).padStart(2,"0"):String(m).padStart(2,"0"))+":"+String(x).padStart(2,"0")}
function timerLeft(){return(tm.running?tm.endsAt-Date.now():tm.remainingMs)/1000}
function paintTimer(){
  var run=tm.running,paused=!run&&tm.remainingMs>0&&tm.remainingMs<tm.totalMs,left=timerLeft();
  $("tTime").textContent=mmss(left);$("tState").textContent=run?"Busy":paused?"Hold":"Idle";$("tState").classList.toggle("idle",!run);
  $("tSub").innerHTML="";$("tSub").append(run?"left":paused?"paused":"min",el("br"),run?"to go":paused?"":"set");
  $("tLabel").textContent=tm.label||(run?"Running":"Ready");$("tGo").textContent=run?"Pause":paused?"Resume":"Start";
  $("mini").hidden=!run;if(run)$("mini").textContent="BUSY "+mmss(left);
}
J.on.timer(function(t){tm=t;paintTimer()});
J.on.timerDone(function(lb){alarm();var line="Sir, your "+(lb?lb+" ":"")+"timer is done.";caption(line);say(line);setStatus("Timer done")});
setInterval(function(){if(tm.running)paintTimer()},500);
document.querySelectorAll("[data-min]").forEach(function(b){b.addEventListener("click",function(){J.timer({action:"set",minutes:Number(b.dataset.min)});blip(600,.05)})});
$("tGo").addEventListener("click",function(){
  var paused=!tm.running&&tm.remainingMs>0&&tm.remainingMs<tm.totalMs;
  J.timer(tm.running?{action:"pause"}:paused?{action:"resume"}:{action:"start",minutes:tm.totalMs/60000});blip(700,.06)});
$("tReset").addEventListener("click",function(){J.timer({action:"reset"});blip(400,.06)});
$("mini").addEventListener("click",function(){goHome()});

/* ---------- notes ---------- */
var notes=$("notes"),nt;
notes.addEventListener("input",function(){clearTimeout(nt);nt=setTimeout(function(){J.setNotes(notes.value)},400)});
J.on.notes(function(t){if(document.activeElement!==notes)notes.value=t||""});

/* ---------- voice ---------- */
function say(text,force){if((!cfg.voice&&!force)||!text)return;Voice.say(S(text,1800),{rate:cfg.rate,voiceName:cfg.voiceName})}
Voice.on("state",function(m){
  listening=m==="listening";speaking=m==="speaking";
  bMic.classList.toggle("on",listening);orb.classList.toggle("talk",speaking);
  if(m==="listening")setStatus("Listening","stop talking, or let go of the talk key, to send");
  else if(m==="transcribing")setStatus("Hearing you","turning speech into text on this computer");
  else if(m==="idle"&&!busy&&/Listening|Hearing/.test(statusEl.textContent))setStatus("Standby");
  refreshSystems();
});
Voice.on("text",function(t){if(busy)return;qIn.value=t;submit()});
Voice.on("error",function(m){setStatus("Voice",m,true)});
function talk(){if(busy)return;if(Voice.listening)Voice.toggleTalk();else{blip(880,.05);Voice.toggleTalk()}}
bMic.addEventListener("click",talk);
J.on.ptt(function(down){if(busy&&down)return;if(down)blip(880,.05);Voice.pushToTalk(down)});
J.on.talkToggle(talk);
var spaceHeld=false;
function typing(){var a=document.activeElement;return a&&(a.tagName==="INPUT"||a.tagName==="TEXTAREA"||a.tagName==="SELECT"||a.tagName==="BUTTON")}
document.addEventListener("keydown",function(e){
  if(e.code==="Space"&&!e.repeat&&!typing()&&!busy&&$("night").hidden&&$("cam").hidden){e.preventDefault();spaceHeld=true;blip(880,.05);Voice.pushToTalk(true)}
  else if(e.code==="Space"&&spaceHeld)e.preventDefault();
  if(e.key==="/"&&!typing()){e.preventDefault();qIn.focus()}
  if(e.key==="Escape"){if(busy)J.cancel();Voice.stopSpeaking();Voice.cancelRecording();closeSheets();if(!$("cam").hidden)camCancel();if(typeof nightStop==="function")nightStop()}
});
document.addEventListener("keyup",function(e){if(e.code==="Space"&&spaceHeld){spaceHeld=false;Voice.pushToTalk(false)}});

/* ---------- systems panel ---------- */
var school={updated:null,brightspace:null,classroom:null},awake={on:false,since:0};
function refreshSystems(){
  var v=Voice.state,rows=[],online=0,total=0;
  function row(name,sub,p){total++;if(p[1]==="on")online++;rows.push([name,sub,p])}
  row("Brain","Claude answers, uses tools, builds boards",app.anthropicKeySet?["Online","on"]:["Add key","off"]);
  row("Web search","Claude's live search for anything recent",app.anthropicKeySet?["Online","on"]:["Add key","off"]);
  row("Voice",app.elevenKeySet?"ElevenLabs, with the built-in voice as backup":"Built-in computer voice",cfg.voice?["Online","on"]:["Muted",""]);
  row("Microphone","Hold Space here, or "+(app.pushToTalkKey||"Right Ctrl")+" anywhere",v.micReady?["Online","on"]:["Ready","rdy"]);
  row("Wake word","Say \"Jarvis\", then your request",!app.wakeWord?["Off",""]:v.wakeReady?["Online","on"]:v.wakeLoading?["Loading","rdy"]:v.wakeError?["Failed","off"]:["Ready","rdy"]);
  row("Speech to text","Whisper, running on this computer",v.sttReady?["Online","on"]:v.sttError?["Failed","off"]:["Loading","rdy"]);
  var b=school.brightspace,c=school.classroom;
  row("Brightspace","TDSB courses, grades, due dates",!b?["Ready","rdy"]:b.signedIn?["Online","on"]:["Sign in","off"]);
  row("Classroom","Google Classroom to-do and classes",!c?["Ready","rdy"]:c.signedIn?["Online","on"]:["Sign in","off"]);
  row("Stay awake","Blocks sleep for all-night work",awake.on?["Online","on"]:["Ready","rdy"]);
  var box=$("sys");box.textContent="";
  rows.forEach(function(x){var d=el("div");d.append(document.createTextNode(x[0]),el("small",null,x[1]));box.append(d,el("span","pill "+x[2][1],x[2][0]))});
  $("sysCount").textContent=online+" of "+total+" online";
}
$("bOnline").addEventListener("click",function(){
  blip(520,.08);setStatus("Bringing systems online","allow the microphone if asked");
  Voice.start({wake:!!app.wakeWord}).then(function(){schLoad();return wxLoad()}).then(function(){refreshSystems();chime();var l="Systems check complete, Sir.";caption(l);say(l);setStatus("Systems checked")});
});
$("bBrief").addEventListener("click",function(){if(busy)return;qIn.value="Brief me on my day";submit()});

/* ---------- photo attach + camera scan ---------- */
var photo=null,photoUrl=null,lastScanUrl=null;
function setPhoto(f){
  if(photoUrl){URL.revokeObjectURL(photoUrl);photoUrl=null}
  photo=f&&/^image\//.test(f.type)?f:null;
  if(photo){photoUrl=URL.createObjectURL(photo);thumbImg.src=photoUrl;qIn.placeholder="Add a question, or just hit Run to identify it"}
  else qIn.placeholder="Ask Jarvis anything, say \"Jarvis\", or hold Space to talk…";
  thumb.hidden=!photo;
}
// Shrink a photo to at most 1568 px and turn it into base64 JPEG for Claude.
function photoData(blob){
  return createImageBitmap(blob).then(function(bm){
    var sc=Math.min(1,1568/Math.max(bm.width,bm.height)),cv=document.createElement("canvas");
    cv.width=Math.round(bm.width*sc);cv.height=Math.round(bm.height*sc);cv.getContext("2d").drawImage(bm,0,0,cv.width,cv.height);
    return{data:cv.toDataURL("image/jpeg",.86).split(",")[1],mediaType:"image/jpeg"};
  });
}
bPhoto.addEventListener("click",function(){file.click()});
file.addEventListener("change",function(){setPhoto(file.files[0]);file.value="";qIn.focus()});
thumbX.addEventListener("click",function(){setPhoto(null)});
var dragN=0;
window.addEventListener("dragenter",function(e){if(!e.dataTransfer||[].indexOf.call(e.dataTransfer.types,"Files")<0)return;dragN++;drop.hidden=false});
window.addEventListener("dragleave",function(){dragN=Math.max(0,dragN-1);if(!dragN)drop.hidden=true});
window.addEventListener("dragover",function(e){e.preventDefault()});
window.addEventListener("drop",function(e){dragN=0;drop.hidden=true;e.preventDefault();var f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0];if(f)setPhoto(f)});
window.addEventListener("paste",function(e){if(!e.clipboardData)return;var fs=e.clipboardData.files;if(fs&&fs[0]&&/^image\//.test(fs[0].type)){setPhoto(fs[0]);e.preventDefault()}});

var camStream=null,camDone=null,camTick=null;
function camera(){
  if(camDone)return Promise.resolve(null);
  $("cam").hidden=false;$("camHint").textContent="Hold the object up to the camera";blip(520,.06);
  return navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:960}}}).then(function(s){
    camStream=s;$("camVideo").srcObject=s;
    return new Promise(function(res){camDone=res;var n=5;$("camCount").textContent=n;
      camTick=setInterval(function(){n--;$("camCount").textContent=n>0?n:"";if(n>0)blip(700,.04);else camShoot()},1000)});
  },function(){camClose();setStatus("Camera","no camera found, or access was blocked",true);return null});
}
function camShoot(){
  var v=$("camVideo");if(!camDone||!v.videoWidth)return;
  var cv=document.createElement("canvas");cv.width=v.videoWidth;cv.height=v.videoHeight;cv.getContext("2d").drawImage(v,0,0);
  var r=camDone;camClose();chime();cv.toBlob(function(b){r(b)},"image/jpeg",.9);
}
function camCancel(){var r=camDone;camClose();if(r)r(null)}
function camClose(){clearInterval(camTick);camDone=null;if(camStream)camStream.getTracks().forEach(function(t){t.stop()});camStream=null;$("cam").hidden=true;$("camCount").textContent=""}
$("camShot").addEventListener("click",camShoot);$("camX").addEventListener("click",camCancel);
bCam.addEventListener("click",function(){if(busy)return;camera().then(function(b){if(!b)return;setPhoto(b);if(!qIn.value.trim())qIn.value="What is this? Build me a board about it.";submit()})});
// Jarvis asked to use the camera (camera_scan tool)
J.on.cameraScan(function(req){camera().then(function(b){
  if(!b){J.cameraResult(req.id,null);return}
  if(lastScanUrl)URL.revokeObjectURL(lastScanUrl);lastScanUrl=URL.createObjectURL(b);
  photoData(b).then(function(p){J.cameraResult(req.id,p.data)});
})});

/* ---------- asking Jarvis ---------- */
var saidMoment=false;
function lookingUp(what){setStatus("Looking it up",what);if(!saidMoment){saidMoment=true;say("One moment.")}}
J.on.lookup(lookingUp);
function setBusy(b){busy=b;orb.classList.toggle("busy",b);go.textContent=b?"Stop":"Run";go.classList.toggle("stop",b);document.querySelectorAll(".dig").forEach(function(n){n.disabled=b})}
// Streams Jarvis's reply. Each finished line becomes a panel straight away.
var onDelta=null;
J.on.askText(function(d){if(onDelta)onDelta(d)});
function stream(call,opts){
  var pending="",n=0;
  function eat(line){
    line=line.trim().replace(/^```\w*|```$/g,"").replace(/,$/,"");if(!line||line[0]!=="{")return;
    var o;try{o=JSON.parse(line)}catch(e){return}
    if(opts.onFirst&&!n){if(opts.onFirst(o)===false){n++;return}}
    var c=addCard(o,opts.parent);if(!c)return;n++;blip(500+n*45,.05);
    if(c.d.t==="subject"&&c.d.say){caption(c.d.say);say(c.d.say)}
    setStatus("Building",n+" panel"+(n>1?"s":"")+" on screen");
    if(opts.parent||n<3)c.el.scrollIntoView({block:"nearest",behavior:reduce?"auto":"smooth"});
  }
  var got="";   // everything streamed so far
  function feed(d){got+=d;var ls=(pending+d).split("\n");pending=ls.pop();ls.forEach(eat)}
  onDelta=feed;
  return call().then(function(res){
    onDelta=null;
    // The final reply can arrive before the last streamed pieces: catch up from the full text.
    if(res.text&&!res.error&&res.text.length>got.length&&res.text.indexOf(got)===0)feed(res.text.slice(got.length));
    if(pending)eat(pending);pending="";
    if(res.busy)throw{code:"busy"};
    if(res.cancelled)throw{code:"cancelled"};
    if(res.error){var o={};try{o=JSON.parse(res.text)}catch(e){}throw{code:"error",message:o.say||"The connection dropped."}}
    return n;
  },function(e){onDelta=null;throw e});
}
function fail(e){
  setBusy(false);var code=e&&e.code;
  if(code==="cancelled"){setStatus("Stopped",cards.length?"kept what was already on screen":"");if(cards.length)saveBoard()}
  else if(code==="busy")setStatus("Busy","still working on the last request");
  else{var m=(e&&e.message)||"The connection dropped. Hit Run to try again";setStatus("Problem",m,true);caption(m);say(m);blip(180,.25,"sawtooth")}
  if(!cards.length)showHome();
}
function submit(){
  if(busy)return;
  var q=qIn.value.trim(),img=photo;
  if(!q&&!img){qIn.focus();return}
  if(/^show (me )?the example board$/i.test(q)){qIn.value="";load(EXAMPLE,true);setStatus("Example board");return}
  Voice.stopSpeaking();
  closeSheets();qIn.value="";var imgUrl=img?URL.createObjectURL(img):null;setPhoto(null);saidMoment=false;caption("");
  var t0=performance.now(),ack=false;
  setBusy(true);blip(440,.07);setStatus(img?"Scanning":"Thinking",cfg.depth==="quick"?"fast mode":"deep mode, first panels can take a few seconds");
  var send=img?photoData(img).then(function(p){return J.ask(q,p)}):null;
  stream(function(){return send||J.ask(q,null)},{onFirst:function(o){
    if(o&&(o.t==="ack"||o.type==="ack")){ack=true;var line=S(o.say,400)||"Done, Sir.";caption(line);say(line);return false}
    clearBoard();isExample=false;boardId=Date.now();curQ=q||"Identify this";
    if(imgUrl){shotUrl=imgUrl;imgUrl=null}else if(lastScanUrl){shotUrl=lastScanUrl;lastScanUrl=null}
    showBoard();board.scrollTop=0;
  }}).then(function(n){
    setBusy(false);if(imgUrl)URL.revokeObjectURL(imgUrl);
    if(ack){chime();setStatus("Done");return}
    if(!n||!cards.length){setStatus("Problem","Nothing usable came back. Try wording it differently",true);if(!cards.length)showHome();return}
    chime();setStatus("Done",cards.length+" panel"+(cards.length===1?"":"s")+" in "+((performance.now()-t0)/1000).toFixed(1)+"s");
    saveBoard();
  },fail);
}
function expand(cardEl){
  if(busy)return;
  setBusy(true);setStatus("Digging deeper");var before=cards.length;
  var subj=subject?subject.querySelector("h3").textContent:curQ;
  stream(function(){return J.expand({subject:subj,q:curQ,card:cardEl.textContent.replace(/\+ Dig deeper/,"")})},{parent:cardEl})
    .then(function(){setBusy(false);chime();setStatus("Done",(cards.length-before)+" new panels");saveBoard()},fail);
}
form.addEventListener("submit",function(e){e.preventDefault();if(busy){J.cancel();return}submit()});

/* ---------- history, home, sheets ---------- */
function saveBoard(){
  if(isExample||!subject)return;
  var items=cards.map(function(c){var p=-1;if(c.parent)cards.forEach(function(x,i){if(x.el===c.parent)p=i});return{d:c.d,p:p}});
  var h=(store("jarvis.boards")||[]).filter(function(b){return b.id!==boardId});
  h.unshift({id:boardId,q:curQ,title:cards[0].d.title,ts:Date.now(),items:items});store("jarvis.boards",h.slice(0,15));
}
function load(b,example){
  clearBoard();isExample=!!example;curQ=b.q||"";boardId=b.id||Date.now();showBoard();
  b.items.forEach(function(it){addCard(it.d,it.p>=0&&cards[it.p]?cards[it.p].el:null)});board.scrollTop=0;
}
function boardButton(b,cls){var bt=el("button",cls);bt.type="button";
  bt.append(el("b",null,b.title||b.q),el("small",null,b.q+" · "+new Date(b.ts).toLocaleString("en-CA",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})));
  bt.addEventListener("click",function(){if(busy)return;load(b);closeSheets();blip(600,.05);setStatus("Restored",b.items.length+" panels")});return bt}
function paintRecent(){var h=store("jarvis.boards")||[],box=$("rec");box.textContent="";
  if(!h.length){box.append(el("div","fine","Boards you build show up here. Try one of the suggestions below, or ask for anything."));return}
  h.slice(0,4).forEach(function(b){box.append(boardButton(b))})}
function closeSheets(){sheet.hidden=true;setSheet.hidden=true;var hs=$("helpSheet");hs.hidden=true;$("bHelp").setAttribute("aria-expanded","false");bHist.setAttribute("aria-expanded","false");bSet.setAttribute("aria-expanded","false")}
bHist.addEventListener("click",function(){
  var open=sheet.hidden;closeSheets();if(!open)return;
  var h=store("jarvis.boards")||[];sheet.textContent="";sheet.append(el("h4",null,h.length?"Recent boards on this computer":"No boards yet"));
  if(!h.length)sheet.append(el("div","fine","Boards you build are kept here, on this computer only."));
  h.forEach(function(b){sheet.append(boardButton(b,"item"))});
  sheet.hidden=false;bHist.setAttribute("aria-expanded","true");
});
function openSettings(){closeSheets();paintCfg();fillVoices();setSheet.hidden=false;bSet.setAttribute("aria-expanded","true")}
bSet.addEventListener("click",function(){if(setSheet.hidden)openSettings();else closeSheets()});
J.on.openSettings(openSettings);
document.addEventListener("pointerdown",function(e){var hs=$("helpSheet");if(sheet.contains(e.target)||setSheet.contains(e.target)||hs.contains(e.target)||e.target===bHist||e.target===bSet||e.target.id==="bHelp")return;closeSheets()});
function goHome(){if(busy)J.cancel();showHome();refreshSystems();setStatus("Standby")}
bHome.addEventListener("click",function(){goHome();blip(520,.05)});
bFull.addEventListener("click",function(){J.windowAction("fullscreen")});
document.querySelectorAll("[data-win]").forEach(function(b){b.addEventListener("click",function(){J.windowAction(b.dataset.win)})});

/* ---------- weather (Open-Meteo, free, no key) ---------- */
var wxPlace=null,wxLive=false,wxBusy=false;
function wxMsg(t){$("wxNow").textContent="";$("wxNow").append(el("div","fine",t));$("wxDays").textContent=""}
function wxPaintBtns(){document.querySelectorAll("[data-wx]").forEach(function(b){b.classList.toggle("on",b.dataset.wx===wxPlace)});$("wxGo").textContent=wxLive?"Refresh":"Load weather"}
function wxLoad(){
  if(wxBusy)return Promise.resolve();wxBusy=true;if(!wxLive)wxMsg("Loading "+(wxPlace==="caledon"?"Caledon":"Toronto")+"…");
  return J.weather(wxPlace).then(function(w){
    wxBusy=false;
    if(!w||w.error){if(!wxLive)wxMsg("Couldn't load the weather just now. Press Load weather to try again.");wxPaintBtns();return}
    wxLive=true;
    var now=$("wxNow");now.textContent="";now.append(el("div","wxT",w.now.temp));
    var p=el("div","wxP",w.now.phrase);p.append(el("small",null,w.short+" · feels "+w.now.feels+" · wind "+w.now.wind+" · humidity "+w.now.humidity));now.append(p);
    var box=$("wxDays");box.textContent="";
    w.days.slice(0,5).forEach(function(d){var snow=d.snowCm>=0.5,wet=d.pop>=50||snow;
      var e=el("div","wxD"+(wet?" wet":""));e.title=d.phrase;
      e.append(el("b",null,d.dow),el("span",null,d.hi),el("small",null,"low "+d.lo),el("small",null,snow?"snow "+Math.round(d.snowCm)+" cm":"rain "+(d.pop==null?"–":d.pop+"%")));box.append(e)});
    $("wxWhen").textContent="Open-Meteo · "+new Date().toLocaleTimeString("en-CA",{hour:"2-digit",minute:"2-digit",hour12:false});wxPaintBtns();
  },function(){wxBusy=false;if(!wxLive)wxMsg("Couldn't load the weather just now.");wxPaintBtns()});
}
document.querySelectorAll("[data-wx]").forEach(function(b){b.addEventListener("click",function(){wxPlace=b.dataset.wx;J.settings.set({place:wxPlace});wxPaintBtns();wxLive=false;wxLoad();blip(600,.05)})});
$("wxGo").addEventListener("click",function(){wxLoad();blip(600,.05)});
setInterval(function(){if(!home.hidden&&document.visibilityState==="visible")wxLoad()},20*60*1000);

/* ---------- school (Brightspace + Classroom, read with your own sign-in) ---------- */
var schBusy=false;
function fmtDue(d){return d.toLocaleDateString("en-CA",{weekday:"short",month:"short",day:"numeric"})}
function schPaint(){
  var box=$("sch"),due=$("schDue");box.textContent="";due.textContent="";
  var b=school.brightspace,c=school.classroom,all=[],msgs=[];
  if(b&&b.signedIn)b.courses.forEach(function(x){
    var up=x.due.filter(function(d){return Date.parse(d.due)>=Date.now()});
    box.append(el("div",null,S(x.name,50)),el("b",null,x.grade||"--"),el("small",null,up.length+" due"));
    up.forEach(function(d){all.push({t:d.title,d:new Date(d.due),c:x.name})});
  });
  if(c&&c.signedIn){
    (c.classes||[]).forEach(function(n){if(!(b&&b.signedIn&&b.courses.some(function(x){return x.name===n})))box.append(el("div",null,S(n,50)),el("b",null,"--"),el("small",null,"Classroom"))});
    (c.todo||[]).forEach(function(t){all.push({t:t.title,d:null,when:t.due,c:t.course})});
  }
  all.sort(function(x,y){return(x.d?x.d.getTime():9e15)-(y.d?y.d.getTime():9e15)});
  all.slice(0,5).forEach(function(u){var r=el("div");r.append(el("span",null,u.t),el("span",null,u.d?fmtDue(u.d):S(u.when,24)||"to do"));due.append(r)});
  if(!b)msgs.push("Brightspace not checked yet.");else if(!b.signedIn)msgs.push("Brightspace: press Brightspace sign-in and log in yourself.");
  if(!c)msgs.push("Classroom not checked yet.");else if(!c.signedIn)msgs.push("Classroom: press Classroom sign-in and log in yourself.");
  if(!msgs.length)msgs.push("Grades are what Brightspace shows you. Jarvis never sees or saves your password.");
  $("schMsg").textContent=msgs.join(" ");
  $("schWhen").textContent=school.updated?"Checked "+new Date(school.updated).toLocaleTimeString("en-CA",{hour:"2-digit",minute:"2-digit",hour12:false}):"Brightspace · Classroom";
  $("schGo").textContent=school.updated?"Refresh":"Load school";
  refreshSystems();
}
function schLoad(){
  if(schBusy)return;schBusy=true;$("schMsg").textContent="Reading your classes…";
  J.school.refresh().then(function(d){schBusy=false;school=d||school;schPaint()},function(){schBusy=false;$("schMsg").textContent="Couldn't read school just now. Press Load school to try again."});
}
J.on.school(function(d){school=d||school;schPaint()});
$("schGo").addEventListener("click",function(){schLoad();blip(600,.05)});
document.querySelectorAll("[data-signin]").forEach(function(b){b.addEventListener("click",function(){J.school.signIn(b.dataset.signin);setStatus("Sign in","log in yourself in the window that opened, then close it")})});

/* ---------- this computer (exact, from the desktop app) ---------- */
var specData={};
function paintSpecs(){var box=$("spec");box.textContent="";Object.keys(specData).forEach(function(k){if(specData[k])box.append(el("dt",null,k),el("dd",null,specData[k]))})}
function gatherSpecs(){
  return J.specs().then(function(s){
    specData.System=s.os||"";
    if(s.cpu)specData.Processor=s.cpu.name+" · "+s.cpu.cores+" cores / "+s.cpu.threads+" threads"+(s.cpu.maxGHz?" · up to "+s.cpu.maxGHz+" GHz":"");
    if(s.memory)specData.Memory=s.memory.totalGB+" GB";
    specData.Graphics=(s.graphics||[]).map(function(g){return g.name+(g.vramMB?" ("+(Math.round(g.vramMB/102.4)/10)+" GB)":"")}).join(" · ");
    specData.Screen=(s.displays||[]).join(" · ");
    specData.Disk=(s.disks||[]).slice(0,3).map(function(d){return d.mount+" "+d.usedGB+" of "+d.sizeGB+" GB used"}).join(" · ");
    specData.Battery=typeof s.battery==="string"?s.battery:s.battery.percent+"%"+(s.battery.charging?", charging":s.battery.pluggedIn?", plugged in":", on battery");
    specData.Network=s.network?((s.network.wifi&&s.network.wifi.ssid?"Wi-Fi “"+s.network.wifi.ssid+"”":s.network.type||"Connected")+(s.network.speedMbps>0?" · "+s.network.speedMbps+" Mbps":"")):"Offline";
    paintSpecs();
  });
}
J.on.live(function(l){
  if(!l)return;
  specData.Now="CPU "+(l.cpu!=null?l.cpu+"%":"–")+" · RAM "+(l.memUsedGB!=null?l.memUsedGB+"/"+l.memTotalGB+" GB":"–")+(l.tempC!=null?" · "+l.tempC+"°C":"");
  if(l.battery)specData.Battery=l.battery.percent+"%"+(l.battery.charging?", charging":", on battery");
  paintSpecs();
});

/* ---------- all-night mode: the desktop app blocks sleep, the HUD shows a dim clock ---------- */
var night=$("night"),nightOn=false;
function paintNight(){
  var d=new Date();$("nClock").textContent=d.toLocaleTimeString("en-CA",{hour:"2-digit",minute:"2-digit",hour12:false});
  $("nState").textContent="";$("nState").append(el("b",null,"Keeping this computer awake"),document.createTextNode(". It switches off when you quit Jarvis."));
  var m=Math.floor((Date.now()-awake.since)/60000);$("nSince").textContent=awake.on?"Since "+new Date(awake.since).toLocaleTimeString("en-CA",{hour:"2-digit",minute:"2-digit",hour12:false})+" · "+Math.floor(m/60)+"h "+String(m%60).padStart(2,"0")+"m"+(tm.running?" · timer "+mmss(timerLeft()):""):"";
  $("awakeTag").textContent=awake.on?"Held awake":"Normal sleep";
  $("bNight").classList.toggle("on",awake.on);
}
function nightMove(){var b=$("nightIn"),mw=Math.max(0,innerWidth-b.offsetWidth-40),mh=Math.max(0,innerHeight-b.offsetHeight-40);b.style.left=(20+Math.random()*mw)+"px";b.style.top=(20+Math.random()*mh)+"px"}
function showNight(on){
  var was=nightOn;nightOn=on;night.hidden=!on;
  if(on&&!was){closeSheets();nightMove();var l="Night watch on, Sir. I'll keep the machine awake.";caption(l);say(l)}
  if(!on&&was){var m=Math.round((Date.now()-awake.since)/60000);setStatus("Night watch ended","awake for "+Math.floor(m/60)+"h "+(m%60)+"m")}
  paintNight();refreshSystems();
}
function nightStart(){J.setAwake(true)}
function nightStop(){if(awake.on)J.setAwake(false)}
J.on.awake(function(a){awake=a;showNight(a.on)});
setInterval(function(){if(nightOn)paintNight()},15000);
setInterval(function(){if(nightOn)nightMove()},60000);
$("bNight").addEventListener("click",function(){if(awake.on)nightStop();else nightStart()});$("bNight2").addEventListener("click",nightStart);
night.addEventListener("click",nightStop);

/* ---------- help ---------- */
var helpSheet=$("helpSheet"),bHelp=$("bHelp");
["Brief me on my day","What are my computer's specs?","Start a 45 minute study timer","Note that I need new ski wax","Open my history essay","Compare the PS5 Pro and a $1,500 gaming PC","Keep my computer awake all night"].forEach(function(t){
  var b=el("button",null,"“"+t+"”");b.type="button";b.addEventListener("click",function(){if(busy)return;closeSheets();qIn.value=t;submit()});$("helpEx").append(b)});
bHelp.addEventListener("click",function(){var open=helpSheet.hidden;closeSheets();if(open){helpSheet.hidden=false;bHelp.setAttribute("aria-expanded","true")}});
$("core").parentNode.addEventListener("click",function(){if(busy)return;talk()});

/* ---------- chips, boot ---------- */
CHIPS.forEach(function(t){var b=el("button","chip",t);b.type="button";b.addEventListener("click",function(){if(busy)return;qIn.value=t;submit()});chips.append(b)});
J.on.skin(function(s){cfg.skin=s;applySkin()});
J.on.settings(function(s){app=s;paintCfg();Voice.setWake(!!s.wakeWord);refreshSystems()});
Promise.all([J.settings.get(),J.timerGet(),J.notesGet(),J.school.get(),J.awakeGet()]).then(function(r){
  app=r[0];cfg={voice:app.voice!==false,voiceName:app.voiceName||"",rate:Number(app.rate)||1.05,skin:app.skin||"ice",sfx:app.sfx!==false,depth:app.depth||"default"};
  applySkin();paintCfg();
  tm=r[1];paintTimer();notes.value=r[2]||"";school=r[3]||school;schPaint();awake=r[4];showNight(awake.on);
  wxPlace=app.place==="caledon"?"caledon":"toronto";wxPaintBtns();wxLoad();
  gatherSpecs().catch(noop);paintRecent();refreshSystems();
  $("tapHint").textContent="Click here, say \"Jarvis\", or hold Space to talk";
  if(!app.anthropicKeySet){caption("Welcome, Sir. Paste your Claude API key in Settings to wake me up.");openSettings()}
  else if(!store("jarvis.seen")){store("jarvis.seen",true);caption("Welcome, Sir. Say \"Jarvis\", hold the Space bar and talk, or type below. Press Help any time for examples.")}
  // Start listening for the wake word straight away (the microphone light comes on).
  Voice.start({wake:!!app.wakeWord}).then(refreshSystems);
});
})();
