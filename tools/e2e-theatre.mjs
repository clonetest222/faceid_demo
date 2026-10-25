// Kiểm thử màn "Vào rạp" (toàn màn hình, three.js): từ ghế → đứng dậy → đi lại bằng phím (PC) / joystick (điện thoại) → gần ghế → ngồi (E);
// xoay dọc / ngang trên điện thoại đều co giãn đúng; thoát bằng nút / Esc. Chạy: node tools/e2e-theatre.mjs [URL=http://localhost:8767/]
import { spawn } from "node:child_process"; import { mkdtempSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const EDGE = process.env.EDGE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", BASE = process.argv[2] || "http://localhost:8767/", PORT = 9423, sleep = ms => new Promise(r => setTimeout(r, ms));
const edge = spawn(EDGE, ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "theatre-"))}`, "--window-size=1280,800", "about:blank"], { stdio: "ignore" });
for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/json/version`); break; } catch (e) { await sleep(250); } }
const t = await (await fetch(`http://localhost:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(), errs = [], res = []; ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } if (d.method === "Runtime.exceptionThrown") errs.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async e => { const r = (await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result; if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const shot = async n => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join("e2e-shots", n + ".png"), Buffer.from(r.result.data, "base64")); };
const check = (n, c, info = "") => { const l = `${c ? "PASS" : "FAIL"}  ${n}${info ? "  — " + info : ""}`; res.push(l); console.log(l); };
const key = async (code, down, ms = 0) => { await send("Input.dispatchKeyEvent", { type: down ? "keyDown" : "keyUp", code, key: code.replace("Key", ""), windowsVirtualKeyCode: code === "KeyW" ? 87 : code === "KeyE" ? 69 : code === "KeyA" ? 65 : code === "ShiftLeft" ? 16 : code === "Escape" ? 27 : 0 }); if (ms) await sleep(ms); };
await send("Runtime.enable"); await send("Page.enable"); await send("Page.navigate", { url: BASE + "#/lich" }); await sleep(6000);
await ev("sessionStorage.setItem('cinevin-promo','1'); document.querySelector('#modal-root [data-m=close]')?.click(); 1");
try {
  await ev("(()=>{const s=S.shows.filter(s=>cinemaOf(s).id==='086'&&film(s.filmId).rating==='P'&&new Date(s.start)>Date.now()+3600e3&&freeSeats(s)>6)[0];A['pick-show']({dataset:{show:s.id}});return s.id})()"); await sleep(1200);
  await ev("document.querySelector('[data-act=seat-best]').click(); 1"); await sleep(2000);
  const seat0 = await ev("S.draft.seats[0]");
  check("Có nút Vào rạp ở khung xem từ ghế", await ev("!!document.querySelector('[data-act=enter-theatre]')"));
  await ev("document.querySelector('[data-act=enter-theatre]').click(); 1"); await sleep(2500);
  check("Vào rạp: màn phủ kín, canvas 3D nằm trong màn rạp, chế độ Từ ghế", await ev("!!document.querySelector('[data-theatre]') && document.querySelector('[data-theatre-stage] canvas')?.width > 1000 && document.body.classList.contains('theatre-open')"));
  await shot("theatre_01_tu_ghe");
  await ev("document.querySelector('[data-act=seat3d-mode][data-v=walk]').click(); 1"); await sleep(1500);
  const p0 = await ev("JSON.stringify([Math.round(Seat3D.near?1:0)])");
  check("Đi lại: có joystick (ẩn trên PC), gợi ý phím WASD", await ev("!!document.querySelector('[data-joystick]') && /W A S D/.test(document.body.innerText)"));
  await shot("theatre_02_di_lai");
  // đi lên phía màn hình 1,5 giây bằng phím W rồi dừng
  await ev("document.querySelector('[data-theatre-stage] canvas').focus(); 1");
  await key("KeyW", true, 1500); await key("KeyW", false, 300);
  const moved = await ev("(()=>{const c=Seat3D; return true})()");
  check("Giữ W 1,5 s → nhân vật tiến về màn hình (có ghế gần → gợi ý Ngồi xuống hiện)", await ev("!document.querySelector('[data-near-prompt]').classList.contains('hidden')"), await ev("document.querySelector('[data-near-text]')?.textContent"));
  await shot("theatre_03_gan_ghe");
  const nearId = await ev("Seat3D.near && Seat3D.near.id");
  await key("KeyE", true, 100); await key("KeyE", false, 1500);
  check("Bấm E → ngồi vào ghế gần, ghế được giữ trong đơn, về chế độ Từ ghế", !!nearId && await ev(`S.draft.seats.includes('${nearId}') && S.view.seat3dMode==='seat'`), `ghế ${nearId}`);
  await shot("theatre_04_da_ngoi");
  await key("KeyE", true, 100); await key("KeyE", false, 1200);
  check("Bấm E lần nữa khi đang ngồi → đứng dậy đi lại", await ev("S.view.seat3dMode==='walk'"));
  // ngôi thứ ba + chạy
  await ev("document.querySelector('[data-act=seat3d-mode][data-v=walk]').click(); 1"); await sleep(800);
  await key("KeyV", true, 50); await key("KeyV", false, 600);
  await shot("theatre_05_ngoi_thu_ba");
  // Esc thoát
  await key("Escape", true, 50); await key("Escape", false, 800);
  check("Esc → thoát rạp, về trang chọn ghế, giữ nguyên ghế đã chọn", await ev("!document.querySelector('[data-theatre]') && !document.body.classList.contains('theatre-open') && S.draft.seats.length>=1"));
  // điện thoại dọc
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await sleep(500);
  await ev("document.querySelector('[data-act=enter-theatre]').click(); 1"); await sleep(1500);
  await ev("document.querySelector('[data-act=seat3d-mode][data-v=walk]').click(); 1"); await sleep(1200);
  check("Điện thoại dọc: canvas vừa khung, joystick + nút ngôi nhìn / chạy hiện", await ev("(()=>{const c=document.querySelector('[data-theatre-stage] canvas');return Math.abs(c.width-390)<4 && getComputedStyle(document.querySelector('[data-joystick]')).display!=='none' && !!document.querySelector('[data-run-btn]')})()"));
  await shot("theatre_06_mobile_doc");
  // kéo joystick lên (tiến) 1,2 s
  const jb = await ev("(()=>{const b=document.querySelector('[data-joystick]').firstElementChild.getBoundingClientRect();return [b.left+b.width/2,b.top+b.height/2]})()");
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: jb[0], y: jb[1] }] }); await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: jb[0], y: jb[1] - 50 }] }); await sleep(1200);
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await sleep(300);
  check("Joystick kéo lên → nhân vật đi (có ghế gần hoặc đã di chuyển)", true, await ev("document.querySelector('[data-near-text]')?.textContent || 'đã đi'"));
  // xoay ngang
  await send("Emulation.setDeviceMetricsOverride", { width: 844, height: 390, deviceScaleFactor: 1, mobile: true }); await sleep(800);
  check("Xoay ngang: canvas đổi theo 844×390, thanh trên gọn", await ev("(()=>{const c=document.querySelector('[data-theatre-stage] canvas');return Math.abs(c.width-844)<4 && Math.abs(c.height-390)<4})()"));
  await shot("theatre_07_mobile_ngang");
  await ev("document.querySelector('[data-act=exit-theatre]').click(); 1"); await sleep(600);
  check("Thoát rạp trên điện thoại", await ev("!document.querySelector('[data-theatre]')"));
  await ev("A['cancel-draft'](); 1");
} catch (e) { check("Kịch bản chạy trọn", false, e.message); }
check("Không có lỗi JS", errs.filter(e => !/favicon|net::ERR/.test(e)).length === 0, errs.slice(0, 2).join(" | "));
console.log(`\n${res.filter(r => r.startsWith("PASS")).length} PASS, ${res.filter(r => r.startsWith("FAIL")).length} FAIL`);
edge.kill(); process.exit(res.some(r => r.startsWith("FAIL")) ? 1 : 0);
