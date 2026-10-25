// Kéo chuột trên dải "Phim đang chiếu" ở trang chủ: dải cuộn, không mở trang đặt vé. node tools/probe-drag.mjs
import { spawn } from "node:child_process"; import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", PORT = 9410, sleep = ms => new Promise(r => setTimeout(r, ms));
const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "drag-"))}`, "--window-size=1280,900", "about:blank"], { stdio: "ignore" });
for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/json/version`); break; } catch (e) { await sleep(250); } }
const t = await (await fetch(`http://localhost:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(); ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async e => (await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result.result.value;
const mouse = (type, x, y, extra = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", pointerType: "mouse", ...extra });
await send("Page.enable"); await send("Page.navigate", { url: process.argv[2] || "http://localhost:8767/" }); await sleep(6000);
await ev("sessionStorage.setItem('cinevin-promo','1'); document.querySelector('#modal-root [data-m=close]')?.click(); document.getElementById('sec-dangchieu').scrollIntoView(); 1"); await sleep(400);
const r = await ev("(()=>{const b=document.querySelector('#sec-dangchieu [data-strip]').getBoundingClientRect(); return [b.left+300, b.top+120]})()");
await ev("window.__pm=[]; const bx=document.querySelector('#sec-dangchieu [data-strip]'); ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture','click'].forEach(t=>bx.addEventListener(t,e=>__pm.push(t+':'+Math.round(e.clientX)+':'+(e.target===bx?'box':e.target.tagName)))); 1");
console.log("trước:", await ev("document.querySelector('#sec-dangchieu [data-strip]').scrollLeft + ' ' + location.hash"));
await mouse("mousePressed", r[0], r[1], { clickCount: 1 }); for (let i = 1; i <= 10; i++) { await mouse("mouseMoved", r[0] - i * 30, r[1], { buttons: 1 }); await sleep(20); } await mouse("mouseReleased", r[0] - 300, r[1], { clickCount: 1 }); await sleep(300);
console.log("sự kiện:", await ev("__pm.join(' ')"));
console.log("sau kéo 300px:", await ev("document.querySelector('#sec-dangchieu [data-strip]').scrollLeft + ' ' + location.hash + ' dragging=' + document.querySelector('#sec-dangchieu [data-strip]').classList.contains('is-dragging')"));
await mouse("mousePressed", r[0], r[1], { clickCount: 1 }); await mouse("mouseReleased", r[0], r[1], { clickCount: 1 }); await sleep(600);
console.log("sự kiện 2:", await ev("__pm.slice(-6).join(' ') + ' | elem=' + document.elementFromPoint(" + r[0] + "," + r[1] + ")?.tagName"));
console.log("bấm thường vào poster:", await ev("location.hash + ' ' + (S.view.lichFilm||'')"));
edge.kill(); process.exit(0);
