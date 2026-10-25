// Kiểm thử phòng chiếu 3D khi chọn ghế (three.js): khung xem từ ghế ở 2D, chế độ Phòng 3D (từ ghế / toàn cảnh), gợi ý ghế đẹp, rời trang giải phóng WebGL.
// Chạy: node tools/e2e-seat3d.mjs [URL=http://localhost:8767/]  (Edge headless + SwiftShader để có WebGL)
import { spawn } from "node:child_process"; import { mkdtempSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", PORT = 9420, sleep = ms => new Promise(r => setTimeout(r, ms));
const edge = spawn(EDGE, ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "s3d-"))}`, "--window-size=1280,900", "about:blank"], { stdio: "ignore" });
for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/json/version`); break; } catch (e) { await sleep(250); } }
const t = await (await fetch(`http://localhost:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(), errs = []; ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } if (d.method === "Runtime.exceptionThrown") errs.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async e => { const r = (await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result; return r.exceptionDetails ? "EXC " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) : r.result.value; };
const shot = async n => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join("e2e-shots", n + ".png"), Buffer.from(r.result.data, "base64")); };
await send("Runtime.enable"); await send("Page.enable"); await send("Page.navigate", { url: (process.argv[2] || "http://localhost:8767/") + "#/lich" }); await sleep(6000);
await ev("sessionStorage.setItem('cinevin-promo','1'); document.querySelector('#modal-root [data-m=close]')?.click(); 1");
console.log("THREE:", await ev("typeof THREE"), "| WebGL:", await ev("!!document.createElement('canvas').getContext('webgl2')"));
console.log("pick:", await ev("(()=>{const s=S.shows.filter(s=>cinemaOf(s).id==='086'&&film(s.filmId).rating==='P'&&new Date(s.start)>Date.now()+3600e3&&freeSeats(s)>4)[0];A['pick-show']({dataset:{show:s.id}});return s.id})()")); await sleep(1500);
console.log("2D: khung preview =", await ev("!!document.querySelector('[data-seat3d][data-compact] canvas') + ' active=' + Seat3D.active"));
await ev("(()=>{const s=[...document.querySelectorAll('[data-act=toggle-seat]:not([disabled])')].filter(b=>b.getAttribute('aria-pressed')==='false');s[Math.floor(s.length*0.6)].click();return 1})()"); await sleep(2500);
console.log("chọn ghế:", await ev("S.draft.seats.join(',') + ' | ' + (document.querySelector('[data-seat3d]').parentElement.querySelector('p')?.textContent||'')"));
await shot("s3d_01_2d_preview");
await ev("document.querySelector('[data-act=seat-view][data-v=\"3d\"]').click(); 1"); await sleep(2500);
console.log("3D: sân khấu =", await ev("!!document.querySelector('[data-seat3d]:not([data-compact]) canvas') + ' size=' + document.querySelector('[data-seat3d] canvas')?.width + 'x' + document.querySelector('[data-seat3d] canvas')?.height"));
await shot("s3d_02_tu_ghe");
await ev("document.querySelector('[data-act=seat3d-mode][data-v=overview]').click(); 1"); await sleep(2000); await shot("s3d_03_dung_day");
console.log("đứng dậy: avatar + khán giả =", await ev("(()=>{const sc=Seat3D; return document.body.innerText.includes('Đứng dậy')})()"), "| số đo:", await ev("[...document.querySelectorAll('[data-seat-metric]')].map(e=>e.dataset.seatMetric+'='+e.textContent).join(' ')"));
await ev("document.querySelector('[data-act=seat-best]').click(); 1"); await sleep(2500);
console.log("gợi ý:", await ev("S.draft.seats.join(',')"), "|", await ev("document.body.innerText.includes('Gợi ý ghế')"));
await shot("s3d_04_goi_y");
await ev("[...document.querySelectorAll('[data-act=seat3d-mode]')].find(b=>b.dataset.v==='arrive').click(); 1"); await sleep(1500);
const a0 = await ev("JSON.stringify(Seat3D.arriveState())"); await sleep(22000);
const a1 = await ev("JSON.stringify(Seat3D.arriveState())"); await shot("s3d_05_di_toi_ghe");
console.log("đi tới ghế: lúc đầu", a0, "→ sau 22 s", a1, "| nhân vật = số ghế:", await ev("Seat3D.arriveState().walkers===S.draft.seats.length"), "| đã ngồi hết:", await ev("Seat3D.arriveState().done"));
await ev("document.querySelector('[data-act=seat3d-replay]').click(); 1"); await sleep(600);
console.log("phát lại: đã ngồi =", await ev("Seat3D.arriveState().seated"), "(0 = bắt đầu lại)");
await ev("A['cancel-draft'](); 1"); await sleep(800);
console.log("rời trang: active =", await ev("Seat3D.active"));
console.log("errs:", errs.filter(e => !/favicon|net::ERR/.test(e)).slice(0, 3));
edge.kill(); process.exit(0);
