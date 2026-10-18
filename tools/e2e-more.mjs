// Mua thêm vé cùng suất cho bạn bè sau khi đã có vé. Chạy: node tools/e2e-more.mjs [URL] [thư mục ảnh]
import { spawn } from "node:child_process"; import { writeFileSync, mkdtempSync, mkdirSync } from "node:fs"; import { tmpdir } from "node:os"; import { join, resolve } from "node:path";
const EDGE = process.env.EDGE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", BASE = process.argv[2] || "http://localhost:8767/", OUT = resolve(process.argv[3] || "e2e-shots"); mkdirSync(OUT, { recursive: true });
const PORT = 9353, sleep = ms => new Promise(r => setTimeout(r, ms)), results = [];
const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "more-"))}`, "--window-size=1280,1000", "about:blank"], { stdio: "ignore" });
const check = (n, c, info = "") => { const l = `${c ? "PASS" : "FAIL"}  ${n}${info ? "  — " + info : ""}`; results.push(l); console.log(l); };
for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/json/version`); break; } catch (e) { await sleep(250); } }
const t0 = await (await fetch(`http://localhost:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(t0.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(); ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async e => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error((r.result.exceptionDetails.exception?.description || "").slice(0, 300)); return r.result.result?.value; };
const wait = async (e, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(e).catch(() => false)) return true; await sleep(300); } return false; };
const shot = async n => { const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }); writeFileSync(join(OUT, n + ".png"), Buffer.from(r.result.data, "base64")); };
await send("Runtime.enable"); await send("Page.enable");
await send("Page.navigate", { url: BASE }); await sleep(2500); await ev("localStorage.clear(); location.hash=''; location.reload()"); await sleep(3500);
try {
  await wait("Remote.v4"); await ev("location.hash='#/dangnhap'"); await sleep(500);
  await ev("document.querySelector('#li-user').value='khach';document.querySelector('#li-pass').value='khach123';document.querySelector('[data-form]').requestSubmit()"); await wait("!!Auth.user"); await sleep(1200);
  const showId = await ev("S.shows.filter(s=>cinemaOf(s).id==='086'&&film(s.filmId).rating==='P'&&new Date(s.start)>Date.now()+3600e3&&freeSeats(s)>6).sort((a,b)=>new Date(a.start)-new Date(b.start))[0].id");
  await ev(`A["pick-show"]({dataset:{show:"${showId}"}})`); await sleep(1200);
  await ev(`(()=>{const s=[...document.querySelectorAll('[data-act="toggle-seat"]:not([disabled])')];s[3].click();return 1})()`); await sleep(1300);
  await ev(`A["to-checkout"]()`); await sleep(900); await ev(`document.querySelector('[data-act="pay-ok"]').click()`); await wait("location.hash==='#/ve'"); await sleep(1000);
  const first = await ev(`myTickets().filter(t=>t.status==='valid'&&t.showId==='${showId}').map(t=>t.seat)`), before = first.length;
  check("Mua 1 vé → trang Vé của tôi có nút Mua thêm vé cùng suất", await ev("!!document.querySelector('[data-act=\"buy-more\"]')"), "ghế " + first.join(","));
  await shot("more_01_ve");
  await ev(`document.querySelector('[data-act="buy-more"]').click()`); await sleep(1200);
  check("Bấm → sang sơ đồ ghế đúng suất, có thông báo ghế đã mua", (await ev("location.hash")) === "#/ghe" && (await ev("S.draft.showId")) === showId && await ev("/Bạn đã có vé suất này/.test(document.querySelector('main').innerText)"));
  const own = await ev(`document.querySelector('[data-seat="${first[0]}"]').getAttribute('aria-label')`);
  check("Ghế đã mua hiện 'ghế của bạn', không chọn lại được", /của bạn/.test(own) && await ev(`document.querySelector('[data-seat="${first[0]}"]').disabled`), own);
  await shot("more_02_ghe");
  for (let k = 0; k < 2; k++) { await ev(`(()=>{const s=[...document.querySelectorAll('[data-act="toggle-seat"]:not([disabled])')].filter(b=>b.getAttribute('aria-pressed')==='false');s[Math.floor(s.length/2)].click();return 1})()`); await sleep(1300); }
  check("Chọn thêm 2 ghế cho bạn", (await ev("S.draft.seats.length")) === 2);
  await ev(`A["to-checkout"]()`); await sleep(900);
  check("Thanh toán: 2 vé mới mặc định là 'Người đi cùng'", (await ev("S.draft.assign.filter(a=>a.viewer.kind==='other').length")) >= 1);
  await ev(`document.querySelector('[data-act="pay-ok"]').click()`); await wait("location.hash==='#/ve'"); await sleep(1200);
  const all = await ev(`myTickets().filter(t=>t.status==='valid'&&t.showId==='${showId}').length`);
  check("Sau thanh toán: cùng suất thêm đúng 2 vé; mặc định MỘT QR cho cả đơn", all === before + 2 && await ev(`/1 QR cho cả đơn · ${all} vé/.test(document.querySelector('main').innerText)`) && (await ev(`document.querySelectorAll('[aria-pressed][data-act="ticket-pick"]').length`)) === 0, `${before} → ${all} vé`);
  await ev(`document.querySelector('[data-act="qr-split"]').click()`); await sleep(500);
  const tabs = await ev(`document.querySelectorAll('[aria-pressed][data-act="ticket-pick"]').length`);
  check("Tách từng vé → dải ghế, mỗi vé một QR riêng", tabs === all, `${tabs} nút ghế`);
  await ev(`document.querySelectorAll('[aria-pressed="false"][data-act="ticket-pick"]')[0].click()`); await sleep(600);
  check("Bấm ghế khác → chuyển sang vé đó", await ev(`document.querySelector('[aria-pressed="true"][data-act="ticket-pick"]').dataset.code === S.view.tk`));
  await ev(`document.querySelector('[data-act="qr-split"]').click()`); await sleep(400);
  check("Gộp lại → về một QR cho cả đơn", await ev(`/1 QR cho cả đơn/.test(document.querySelector('main').innerText)`));
  check("'Vé khác' gom theo suất (mỗi suất một dòng)", await ev("[...document.querySelectorAll('section:last-child [data-act=\"ticket-pick\"]')].every(b=>!b.hasAttribute('aria-pressed'))") && (await ev("document.querySelectorAll('section:last-child [data-act=\"ticket-pick\"]').length")) <= (await ev("new Set(myTickets().filter(t=>t.showId!=='"+showId+"').map(t=>t.showId+t.status)).size")));
  await shot("more_03_ve_3");
  await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true }); await sleep(600); await shot("more_04_ve_375");
} catch (e) { console.log("ABORT:", e.message); await shot("more_abort").catch(() => {}); }
console.log(`\n${results.filter(r => r.startsWith("PASS")).length} PASS, ${results.filter(r => r.startsWith("FAIL")).length} FAIL`);
edge.kill(); process.exit(0);
