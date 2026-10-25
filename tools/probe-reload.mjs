// Dò trạng thái dải xoay ngay sau F5 (phát hiện nháy / trượt thẻ lúc khởi động). node tools/probe-reload.mjs
import { spawn } from "node:child_process"; import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", PORT = 9406, sleep = ms => new Promise(r => setTimeout(r, ms));
const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "rl2-"))}`, "--window-size=1280,900", "about:blank"], { stdio: "ignore" });
for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/json/version`); break; } catch (e) { await sleep(250); } }
const t = await (await fetch(`http://localhost:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(); ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async e => (await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result.result.value;
await send("Page.enable");
await send("Page.navigate", { url: process.argv[2] || "http://localhost:8767/" }); await sleep(7000); await ev("sessionStorage.setItem('cinevin-promo','1'); 1");
await send("Page.reload"); const S = [];
for (let k = 0; k < 40; k++) { await sleep(50); S.push(await ev("(()=>{if(typeof CF==='undefined'||typeof S==='undefined')return '-'; const c=document.querySelector('.cf-card.is-active'); return [c?Math.round(c.getBoundingClientRect().left):'-', CF.p.toFixed(2), CF.target, CF.vel.toFixed(1), CF.active, (S.view.cfIdx??'u'), (cfFilms()[CF.active]||{}).id, cfFilms().length, document.querySelector('[data-cf]')?.dataset.bound?'B':'nb', typeof RENDERS!=='undefined'?RENDERS:''].join(':')})()").catch(() => "x")); }
console.log(S.join("\n")); edge.kill(); process.exit(0);
