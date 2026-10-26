// Kiểm thử phóng to / rê sơ đồ ghế với phòng to (Grand 25×30): vừa khung, +/−, Ctrl+lăn, kéo chuột để rê tới ghế khuất rồi bấm chọn;
// zoom riêng từng sơ đồ: trang chọn ghế, quầy, hộp suất trong báo cáo; điện thoại vừa khung. Chạy: node tools/e2e-zoom.mjs [URL]
import { spawn } from "node:child_process"; import { mkdtempSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const EDGE = process.env.EDGE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", BASE = process.argv[2] || "http://localhost:8767/", PORT = 9456, sleep = ms => new Promise(r => setTimeout(r, ms));
const edge = spawn(EDGE, ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "zoom-"))}`, "--window-size=1400,1000", "about:blank"], { stdio: "ignore" });
for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/json/version`); break; } catch (e) { await sleep(250); } }
const t = await (await fetch(`http://localhost:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(), errs = [], res = []; ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } if (d.method === "Runtime.exceptionThrown") errs.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async e => { const r = (await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result; if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const shot = async n => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join("e2e-shots", n + ".png"), Buffer.from(r.result.data, "base64")); };
const check = (n, c, info = "") => { const l = `${c ? "PASS" : "FAIL"}  ${n}${info ? "  — " + info : ""}`; res.push(l); console.log(l); };
const drag = async (from, to, steps = 8) => { await send("Input.dispatchMouseEvent", { type: "mousePressed", x: from[0], y: from[1], button: "left", clickCount: 1 }); for (let k = 1; k <= steps; k++) { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from[0] + (to[0] - from[0]) * k / steps, y: from[1] + (to[1] - from[1]) * k / steps, button: "left", buttons: 1 }); await sleep(25); } await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: to[0], y: to[1], button: "left", clickCount: 1 }); await sleep(300); };
const Z = "(()=>{const o=document.querySelector('[data-seat-zoom]');return {z:+o.dataset.z, fit:+o.dataset.fit, sw:o.scrollWidth, cw:o.clientWidth, sl:o.scrollLeft}})()";
await send("Runtime.enable"); await send("Page.enable"); await send("Page.navigate", { url: BASE + "#/lich" }); await sleep(6000);
try {
  await ev("localStorage.clear(); sessionStorage.setItem('cinevin-promo','1'); document.querySelector('#modal-root [data-m=close]')?.click(); 1");
  // phòng to nhất đang có suất sắp chiếu (ưu tiên Grand Test1 25×30)
  const sid = await ev("(()=>{const list=S.shows.filter(s=>s.status!=='cancelled'&&new Date(s.start)>Date.now()+3600e3&&freeSeats(s)>10).sort((a,b)=>room(b.roomId).cols*room(b.roomId).rows-room(a.roomId).cols*room(a.roomId).rows);const s=list[0];A['pick-show']({dataset:{show:s.id}});return s.id})()"); await sleep(1500);
  const dims = await ev(`(()=>{const r=room(show('${sid}').roomId);return r.name+' '+r.rows+'x'+r.cols})()`);
  let z = await ev(Z);
  check("Phòng to: sơ đồ tự thu 'vừa khung' (< 100%), có thanh màn hình trong phần phóng", z.fit < 1 && Math.abs(z.z - z.fit) < .01 && await ev("!!document.querySelector('[data-seat-zoom-inner] [data-screen-bar]')"), `${dims} · fit ${Math.round(z.fit * 100)}%`);
  await ev("[...document.querySelectorAll('[data-act=seat-zoom]')].find(b=>b.dataset.v==='in').click(); [...document.querySelectorAll('[data-act=seat-zoom]')].find(b=>b.dataset.v==='in').click(); [...document.querySelectorAll('[data-act=seat-zoom]')].find(b=>b.dataset.v==='in').click(); 1"); await sleep(400);
  z = await ev(Z);
  check("Bấm + ba lần → ghế phóng to (> 100%), sơ đồ rộng hơn khung → cuộn ngang được", z.z > 1 && z.sw > z.cw + 50, `zoom ${Math.round(z.z * 100)}% · ${z.sw}px trong khung ${z.cw}px`);
  await shot("zoom_01_phong_to");
  // kéo chuột sang trái để rê sơ đồ → scrollLeft tăng; thả ra không chọn ghế
  const n0 = await ev("S.draft.seats.length");
  const box = await ev("(()=>{const b=document.querySelector('[data-seat-zoom]').getBoundingClientRect();return [b.left+b.width*.7,b.top+b.height*.5]})()");
  await drag(box, [box[0] - 400, box[1]], 12);
  z = await ev(Z);
  check("Giữ chuột kéo sang trái → sơ đồ rê theo (scrollLeft > 300), thả ra KHÔNG bấm nhầm ghế", z.sl > 300 && (await ev("S.draft.seats.length")) === n0, `scrollLeft ${z.sl}`);
  // ghế cuối hàng cuối đã vào tầm → bấm chọn được
  const last = await ev(`(()=>{const r=room(show('${sid}').roomId);const bs=[...document.querySelectorAll('[data-act=toggle-seat]:not([disabled])')];const b=bs[bs.length-1];b.scrollIntoView({block:'center',inline:'center'});const rc=b.getBoundingClientRect();const o=document.querySelector('[data-seat-zoom]').getBoundingClientRect();return {sid:b.dataset.seat, visible: rc.left>=o.left&&rc.right<=o.right&&rc.top>=o.top&&rc.bottom<=o.bottom}})()`);
  await ev(`[...document.querySelectorAll('[data-act=toggle-seat]')].find(b=>b.dataset.seat==='${last.sid}').click(); 1`); await sleep(600);
  check("Rê tới ghế cuối phòng (bị khuất lúc đầu) rồi bấm → chọn được, sơ đồ giữ nguyên mức zoom và vị trí cuộn (không nhảy về đầu)", last.visible && await ev(`S.draft.seats.includes('${last.sid}')`) && (await ev(Z)).z > 1 && (await ev(Z)).sl > 300, `ghế ${last.sid} · zoom ${Math.round((await ev(Z)).z * 100)}% · scrollLeft ${(await ev(Z)).sl}`);
  await shot("zoom_02_ghe_khuat");
  // Ctrl + lăn chuột
  await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: box[0], y: box[1], deltaX: 0, deltaY: -120, modifiers: 2 }); await sleep(300);
  const z2 = await ev(Z);
  check("Ctrl + lăn chuột lên → phóng thêm", z2.z > z.z, `${Math.round(z.z * 100)}% → ${Math.round(z2.z * 100)}%`);
  await ev("[...document.querySelectorAll('[data-act=seat-zoom]')].find(b=>b.dataset.v==='fit').click(); 1"); await sleep(400);
  z = await ev(Z); check("Bấm % → về vừa khung", Math.abs(z.z - z.fit) < .01);
  // điện thoại: vừa khung, không tràn ngang trang
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await sleep(800);
  z = await ev(Z);
  check("Điện thoại: sơ đồ phòng to vẫn vừa khung (fit nhỏ hơn), trang không tràn ngang", z.fit < .6 && await ev("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2"), `fit ${Math.round(z.fit * 100)}%`);
  await shot("zoom_03_mobile");
  await send("Emulation.clearDeviceMetricsOverride"); await sleep(500);
  await ev("A['cancel-draft'](); 1");
  // quầy + hộp suất trong báo cáo: zoom riêng từng sơ đồ
  await ev("location.hash='#/dangnhap'; 1"); await sleep(800); await ev("window.confirm=()=>true; document.querySelector('[data-act=demo-login][data-u=quanly]').click(); 1"); await sleep(2500);
  await ev(`location.hash='#/quay'; S.view.pos={showId:'${sid}',seats:[],types:{},docs:{}}; render(); 1`); await sleep(1500);
  const zq = await ev(Z);
  check("Quầy: sơ đồ phòng to cũng vừa khung, có nút zoom riêng", zq.fit < 1 && await ev("document.querySelectorAll('[data-seat-wrap] [data-act=seat-zoom]').length>=3"));
  await ev("[...document.querySelectorAll('[data-act=seat-zoom]')].find(b=>b.dataset.v==='in').click(); 1"); await sleep(300);
  check("Quầy: bấm + → chỉ sơ đồ quầy phóng", (await ev(Z)).z > zq.z);
  await ev("S.view.bcScope='all'; location.hash='#/baocao'; 1"); await sleep(1500);
  await ev(`(()=>{const f=show('${sid}').filmId; document.querySelector('[data-act=bc-film][data-id="'+f+'"]').click(); return 1})()`); await sleep(700);
  await ev(`document.querySelector('[data-sheet] [data-act=bc-cinema][data-cinema="${await ev(`cinemaOf(show('${sid}')).id`)}"]').click(); 1`); await sleep(700);
  await ev(`document.querySelector('[data-sheet] [data-act=bc-show][data-show="${sid}"]').click(); 1`); await sleep(3000);
  const zs = await ev("(()=>{const o=document.querySelector('[data-sheet] [data-seat-zoom]');return o?{z:+o.dataset.z, fit:+o.dataset.fit, bound:o.dataset.bound}:null})()");
  check("Hộp suất trong Báo cáo: sơ đồ cũng tự vừa khung và có zoom riêng", !!zs && zs.bound === "1" && zs.fit <= 1 && Math.abs(zs.z - zs.fit) < .01, JSON.stringify(zs));
  await ev("document.querySelector('[data-sheet] [data-act=seat-zoom][data-v=in]').click(); 1"); await sleep(300);
  check("Hộp suất: bấm + phóng sơ đồ trong hộp", (await ev("+document.querySelector('[data-sheet] [data-seat-zoom]').dataset.z")) > zs.z);
  await shot("zoom_04_bao_cao");
} catch (e) { check("Kịch bản chạy trọn", false, e.message); }
check("Không có lỗi JS", errs.filter(e => !/favicon|net::ERR/.test(e)).length === 0, errs.slice(0, 2).join(" | "));
console.log(`\n${res.filter(r => r.startsWith("PASS")).length} PASS, ${res.filter(r => r.startsWith("FAIL")).length} FAIL`);
edge.kill(); process.exit(res.some(r => r.startsWith("FAIL")) ? 1 : 0);
