export interface PickHtmlShot {
  seq: number
  width: number
  height: number
  b64: string
}

export interface PickHtmlInput {
  token: string
  title: string
  client: string
  shots: PickHtmlShot[]
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** 生成给客户看的自包含选片页：图片 base64 内嵌，断网也能打开 */
export function buildPickHtml({ token, title, client, shots }: PickHtmlInput): string {
  const data = JSON.stringify(
    shots.map(({ seq, width, height, b64 }) => ({ seq, w: width, h: height, b64 }))
  ).replace(/</g, '\\u003c')
  const meta = JSON.stringify({ token, title, client }).replace(/</g, '\\u003c')
  const sub = `${client ? `${escapeXml(client)}，` : ''}这一组共 ${shots.length} 张，选您喜欢的就行`
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${escapeXml(title)} · 选片</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  :root {
    --bg: #f7f5f1; --card: #ffffff; --ink: #22201d; --ink2: #6b655c; --ink3: #a39c92;
    --line: #e6e1d9; --pick: #2f6b56; --pick-soft: #eaf2ee; --drop: #b8b1a7; --fix: #b0703a; --fix-soft: #fbf0e6;
  }
  body { background: var(--bg); color: var(--ink);
    font: 15px/1.6 -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    -webkit-font-smoothing: antialiased; padding-bottom: 96px; }
  header { position: sticky; top: 0; z-index: 20; background: rgba(247,245,241,.92);
    backdrop-filter: blur(14px); border-bottom: 1px solid var(--line); padding: 18px 20px 14px; }
  .brand { font-size: 11px; letter-spacing: .22em; color: var(--ink3); text-transform: uppercase; }
  h1 { font-size: 19px; font-weight: 500; margin: 7px 0 4px; letter-spacing: .01em; }
  .sub { font-size: 13px; color: var(--ink2); }
  .bar { margin-top: 13px; height: 3px; background: var(--line); border-radius: 2px; overflow: hidden; }
  .bar i { display: block; height: 100%; width: 0; background: var(--pick); transition: width .25s; }
  .stat { display: flex; gap: 16px; margin-top: 9px; font-size: 12px; color: var(--ink2); }
  .stat b { color: var(--pick); font-weight: 500; font-variant-numeric: tabular-nums; }
  .stat .fx b { color: var(--fix); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(158px, 1fr));
    gap: 12px; padding: 18px 20px 8px; }
  .card { position: relative; background: var(--card); border-radius: 10px; overflow: hidden;
    box-shadow: 0 1px 3px rgba(34,32,29,.07), 0 6px 18px rgba(34,32,29,.04);
    cursor: pointer; transition: transform .14s, box-shadow .14s; }
  .card:active { transform: scale(.985); }
  .card img { width: 100%; display: block; aspect-ratio: var(--ar, 3/4); object-fit: cover; }
  .card .no { position: absolute; left: 8px; top: 8px; font-size: 11px; font-variant-numeric: tabular-nums;
    color: #fff; background: rgba(34,32,29,.52); backdrop-filter: blur(6px);
    border-radius: 5px; padding: 2px 7px; letter-spacing: .04em; }
  .card .mark { position: absolute; right: 8px; top: 8px; width: 24px; height: 24px; border-radius: 50%;
    display: grid; place-items: center; font-size: 13px; color: #fff; opacity: 0;
    transition: opacity .14s, transform .14s; transform: scale(.7); }
  .card.pick .mark { opacity: 1; transform: scale(1); background: var(--pick); }
  .card.fix .mark { opacity: 1; transform: scale(1); background: var(--fix); }
  .card.pick { box-shadow: 0 0 0 2.5px var(--pick), 0 8px 22px rgba(47,107,86,.18); }
  .card.fix { box-shadow: 0 0 0 2.5px var(--fix), 0 8px 22px rgba(176,112,58,.16); }
  .card.drop img { opacity: .3; filter: grayscale(.7); }
  .card.drop .mark { opacity: 1; transform: scale(1); background: var(--drop); }
  .tools { position: absolute; left: 0; right: 0; bottom: 0; display: flex; gap: 4px;
    padding: 6px; background: linear-gradient(transparent, rgba(20,18,16,.62)); }
  .tools button { flex: 1; height: 26px; border: none; border-radius: 5px; font-size: 11.5px;
    font-family: inherit; cursor: pointer; background: rgba(255,255,255,.9); color: #3a352f;
    transition: background .12s; }
  .tools button:hover { background: #fff; }
  .tools button.on { background: var(--pick); color: #fff; }
  .tools button.fxon { background: var(--fix); color: #fff; }
  .tools button.noxn { background: var(--drop); color: #fff; }
  .foot { position: fixed; left: 0; right: 0; bottom: 0; z-index: 30;
    background: rgba(247,245,241,.95); backdrop-filter: blur(14px);
    border-top: 1px solid var(--line); padding: 12px 20px max(12px, env(safe-area-inset-bottom)); }
  .foot button { width: 100%; height: 46px; border: none; border-radius: 10px; font-family: inherit;
    font-size: 15px; font-weight: 500; cursor: pointer; background: var(--ink); color: #fff;
    transition: opacity .14s; }
  .foot button:hover { opacity: .88; }
  .foot button:disabled { background: var(--line); color: var(--ink3); cursor: default; }
  .modal { position: fixed; inset: 0; z-index: 50; display: none; place-items: center;
    background: rgba(20,18,16,.5); padding: 20px; }
  .modal.on { display: grid; }
  .sheet { background: #fff; border-radius: 14px; width: 100%; max-width: 460px; overflow: hidden;
    max-height: 84vh; display: flex; flex-direction: column; }
  .sheet h2 { font-size: 15px; font-weight: 500; padding: 18px 20px 12px; }
  .sheet pre { flex: 1; overflow-y: auto; margin: 0 20px 14px; padding: 14px;
    background: #faf8f5; border: 1px solid var(--line); border-radius: 8px;
    font: 12.5px/1.75 "SF Mono", Consolas, monospace; color: #3a352f; white-space: pre-wrap; }
  .sheet .acts { display: flex; gap: 9px; padding: 0 20px 18px; }
  .sheet .acts button { flex: 1; height: 40px; border-radius: 8px; font-family: inherit; font-size: 13.5px;
    cursor: pointer; border: 1px solid var(--line); background: #fff; color: var(--ink); }
  .sheet .acts button.pri { background: var(--pick); border-color: var(--pick); color: #fff; }
  .note { padding: 4px 20px 8px; }
  .note label { display: block; margin-bottom: 6px; font-size: 11.5px; color: var(--ink3); }
  .note textarea { width: 100%; min-height: 62px; resize: vertical; padding: 10px 12px;
    border: 1px solid var(--line); border-radius: 8px; background: var(--card); color: var(--ink);
    font-family: inherit; font-size: 13px; line-height: 1.6; outline: none; }
  .note textarea:focus { border-color: var(--pick); }
  @media (max-width: 520px) {
    .grid { grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 9px; padding: 14px 12px 8px; }
    header { padding: 14px 14px 11px; }
    h1 { font-size: 17px; }
    .note { padding: 2px 12px 8px; }
  }
</style>
</head>
<body>
<header>
  <div class="brand">Selected for you</div>
  <h1>${escapeXml(title)}</h1>
  <div class="sub">${sub}</div>
  <div class="bar"><i id="bar"></i></div>
  <div class="stat">
    <span>已选 <b id="nPick">0</b></span>
    <span class="fx">待修 <b id="nFix">0</b></span>
    <span>已排除 <b id="nDrop">0</b></span>
  </div>
</header>
<div class="grid" id="grid"></div>
<div class="note">
  <label for="note">想说的可以写在这里（可不填）</label>
  <textarea id="note" rows="2" placeholder="比如：第 15 张能不能再亮一点"></textarea>
</div>
<div class="foot"><button id="gen" disabled>先选几张吧</button></div>
<div class="modal" id="modal">
  <div class="sheet">
    <h2>把这段发给摄影师就行</h2>
    <pre id="out"></pre>
    <div class="acts">
      <button id="close">关闭</button>
      <button class="pri" id="copy">复制</button>
    </div>
  </div>
</div>
<noscript><div style="padding:24px;text-align:center;color:#6b655c">这个页面需要开启 JavaScript 才能选片。</div></noscript>
<script>
var SHOTS = ${data};
var META = ${meta};
var KEY = 'pick:' + META.token;
var NOTE_KEY = KEY + ':note';
var state = {};
try { state = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { state = {}; }
var note = '';
try { note = localStorage.getItem(NOTE_KEY) || ''; } catch (e) { note = ''; }

function pad(n) { return String(n).padStart(3, '0') }

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  render()
}

function update() {
  var pick = 0, fix = 0, drop = 0;
  for (var key in state) {
    if (!Object.prototype.hasOwnProperty.call(state, key)) continue;
    if (state[key] === 'pick') pick++;
    else if (state[key] === 'fix') fix++;
    else if (state[key] === 'drop') drop++;
  }
  document.getElementById('nPick').textContent = pick;
  document.getElementById('nFix').textContent = fix;
  document.getElementById('nDrop').textContent = drop;
  document.getElementById('bar').style.width = Math.min(100, (pick + fix) / SHOTS.length * 100) + '%';
  var btn = document.getElementById('gen');
  btn.disabled = pick + fix === 0;
  btn.textContent = pick + fix ? '生成选片清单（' + (pick + fix) + ' 张）' : '先选几张吧';
}

function render() {
  var html = '';
  for (var i = 0; i < SHOTS.length; i++) {
    var s = SHOTS[i];
    var st = state[s.seq] || '';
    var cls = st === 'pick' ? 'pick' : st === 'fix' ? 'fix' : st === 'drop' ? 'drop' : '';
    var mark = st === 'pick' ? '✓' : st === 'fix' ? '✎' : st === 'drop' ? '×' : '';
    var ar = s.w && s.h ? (s.w + '/' + s.h) : '3/4';
    html += '<div class="card ' + cls + '" data-seq="' + s.seq + '">'
      + '<img src="data:image/jpeg;base64,' + s.b64 + '" alt="" loading="lazy" style="--ar:' + ar + '" />'
      + '<span class="no">' + pad(s.seq) + '</span>'
      + '<span class="mark">' + mark + '</span>'
      + '<div class="tools">'
      + '<button data-a="pick" class="' + (st === 'pick' ? 'on' : '') + '">要</button>'
      + '<button data-a="fix" class="' + (st === 'fix' ? 'fxon' : '') + '">要修</button>'
      + '<button data-a="drop" class="' + (st === 'drop' ? 'noxn' : '') + '">不要</button>'
      + '</div></div>';
  }
  document.getElementById('grid').innerHTML = html;
  var cards = document.querySelectorAll('.card');
  for (var j = 0; j < cards.length; j++) {
    (function (card) {
      var seq = card.getAttribute('data-seq');
      var buttons = card.querySelectorAll('button');
      for (var k = 0; k < buttons.length; k++) {
        (function (btn) {
          btn.onclick = function (ev) {
            ev.stopPropagation();
            var a = btn.getAttribute('data-a');
            state[seq] = state[seq] === a ? '' : a;
            save();
          };
        })(buttons[k]);
      }
    })(cards[j]);
  }
  update();
}

document.getElementById('gen').onclick = function () {
  var pick = [], fix = [];
  for (var i = 0; i < SHOTS.length; i++) {
    var seq = SHOTS[i].seq;
    var st = state[seq];
    if (st === 'pick') pick.push(pad(seq));
    if (st === 'fix') fix.push(pad(seq));
  }
  var lines = ['【选片结果】' + META.title];
  if (META.client) lines.push('客户：' + META.client);
  lines.push('');
  lines.push('要的（' + pick.length + ' 张）：');
  lines.push(pick.join(', ') || '（无）');
  lines.push('');
  lines.push('要修的（' + fix.length + ' 张）：');
  lines.push(fix.join(', ') || '（无）');
  lines.push('');
  lines.push('不要的：其余');
  lines.push('');
  lines.push('备注：');
  lines.push((note || '').trim() || '（无）');
  document.getElementById('out').textContent = lines.join('\\n');
  document.getElementById('modal').classList.add('on');
};

document.getElementById('close').onclick = function () {
  document.getElementById('modal').classList.remove('on');
};

document.getElementById('copy').onclick = function () {
  var text = document.getElementById('out').textContent;
  var done = function () {
    document.getElementById('copy').textContent = '已复制';
    setTimeout(function () { document.getElementById('copy').textContent = '复制'; }, 1600);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(fallback);
  } else {
    fallback();
  }
  function fallback() {
    var ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    ta.remove();
    done();
  }
};

var noteInput = document.getElementById('note');
noteInput.value = note;
noteInput.oninput = function () {
  note = noteInput.value;
  try { localStorage.setItem(NOTE_KEY, note); } catch (e) {}
};

render()
</script>
</body>
</html>`
}


