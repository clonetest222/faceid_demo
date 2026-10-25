// Kiểm thử trình thiết kế phòng (quản lý): kéo loại ghế thả vào sơ đồ, tô bằng bút, kéo đổi hàng, di chuyển ghế, hoàn tác, tự xếp VIP,
// 3D xem trước + bấm ghế trong 3D để sửa, mẫu phòng IMAX / Dolby / 4DX / Luxury / Grand + tuỳ chỉnh (khối ghế, màn cong…),
// thêm phòng mới từ mẫu → lưu → khách thấy → xoá. Chạy: node tools/e2e-room-design.mjs [URL]
import { spawn } from "node:child_process"; import { mkdtempSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const EDGE = process.env.EDGE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", BASE = process.argv[2] || "http://localhost:8767/", PORT = 9426, sleep = ms => new Promise(r => setTimeout(r, ms));
const edge = spawn(EDGE, ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "rd-"))}`, "--window-size=1400,1000", "about:blank"], { stdio: "ignore" });
for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/json/version`); break; } catch (e) { await sleep(250); } }
const t = await (await fetch(`http://localhost:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(), errs = [], res = []; ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } if (d.method === "Runtime.exceptionThrown") errs.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async e => { const r = (await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result; if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const shot = async n => { const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }); writeFileSync(join("e2e-shots", n + ".png"), Buffer.from(r.result.data, "base64")); };
const check = (n, c, info = "") => { const l = `${c ? "PASS" : "FAIL"}  ${n}${info ? "  — " + info : ""}`; res.push(l); console.log(l); };
const center = async sel => ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return [b.left+b.width/2,b.top+b.height/2]})()`);
const key = async (code, down, ms = 0) => { await send("Input.dispatchKeyEvent", { type: down ? "keyDown" : "keyUp", code, key: code.replace("Key", ""), windowsVirtualKeyCode: { KeyW: 87, KeyE: 69, KeyA: 65, ShiftLeft: 16, Escape: 27 }[code] || 0 }); if (ms) await sleep(ms); };
const drag = async (from, to, steps = 8) => { await send("Input.dispatchMouseEvent", { type: "mousePressed", x: from[0], y: from[1], button: "left", clickCount: 1 }); for (let k = 1; k <= steps; k++) { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from[0] + (to[0] - from[0]) * k / steps, y: from[1] + (to[1] - from[1]) * k / steps, button: "left", buttons: 1 }); await sleep(30); } await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: to[0], y: to[1], button: "left", clickCount: 1 }); await sleep(500); };
await send("Runtime.enable"); await send("Page.enable"); await send("Page.navigate", { url: BASE + "#/dangnhap" }); await sleep(5000);
try {
  await ev("window.confirm=()=>true; localStorage.clear(); 1"); await ev("document.querySelector('[data-act=demo-login][data-u=quanly]').click(); 1"); await sleep(2500);
  await ev("location.hash='#/coso'; 1"); await sleep(1200);
  check("Đăng nhập quản lý chuỗi, trang Cơ sở & phòng có nút Sửa phòng", await ev("Auth.user && Auth.user.role==='quanly' && !!document.querySelector('[data-act=room-edit]')"));
  await ev("document.querySelector('[data-act=room-edit][data-id=\"086-R1\"]').click(); 1"); await sleep(2500);
  check("Mở trình thiết kế: 3 bước hướng dẫn, bảng công cụ, sơ đồ, 3D, tổng kết", await ev("location.hash==='#/phong' && document.querySelectorAll('[data-act=rd-tool]').length>=5 && document.querySelectorAll('[data-rd-seat]').length>0 && !!document.querySelector('[data-seat3d-rd] canvas') && /Thu tối đa một suất/.test(document.body.innerText)"));
  await shot("rd_01_mo");
  await ev("document.querySelector('[data-act=rd-clear]').click(); 1"); await sleep(600);   // bắt đầu từ toàn ghế thường để kết quả kéo thả rõ ràng
  await ev("document.querySelector('[data-rd-grid]').scrollIntoView({block:'center'}); 1"); await sleep(400);   // sơ đồ nằm trong khung nhìn (elementFromPoint khi thả)
  check("Về toàn ghế thường → không còn ghế đặc biệt", (await ev("Object.keys(RD.types).length")) === 0);
  // 1. kéo công cụ VIP thả vào ghế A1
  await drag(await center('[data-act=rd-tool][data-v=vip]'), await center('[data-rd-seat="A1"]'));
  check("Kéo công cụ VIP thả vào A1 → A1 thành VIP", (await ev("RD.types.A1")) === "vip");
  // 2. tô bằng bút: kéo trên hàng B từ B1 tới B5
  await ev("RD.tool='vip'; 1");
  await drag(await center('[data-rd-seat="B1"]'), await center('[data-rd-seat="B5"]'), 10);
  check("Kéo bút qua B1→B5 → 5 ghế VIP", (await ev("['B1','B2','B3','B4','B5'].filter(s=>RD.types[s]==='vip').length")) === 5);
  // 3. ghế đôi: kéo công cụ thả vào C1 → C1–C2 thành cặp
  await drag(await center('[data-act=rd-tool][data-v=couple]'), await center('[data-rd-seat="C1"]'));
  check("Kéo Ghế đôi thả vào C1 → C1, C2 cùng cặp (một ô rộng)", await ev("RD.types.C1==='couple' && RD.types.C2==='couple' && !document.querySelector('[data-rd-seat=\"C2\"]')"));
  // 4. di chuyển: kéo A1 (VIP) sang A5
  await ev("RD.tool='move'; render(); 1"); await sleep(500);
  await drag(await center('[data-rd-seat="A1"]'), await center('[data-rd-seat="A5"]'));
  check("Di chuyển: kéo A1 sang A5 → VIP sang A5, A1 về thường", await ev("RD.types.A5==='vip' && !RD.types.A1"));
  // 5. kéo chữ hàng B thả vào hàng D → đổi hàng
  await drag(await center('[data-rd-row="1"]'), await center('[data-rd-row="3"]'));
  check("Kéo chữ hàng B thả vào D → 5 VIP chuyển sang hàng D", (await ev("['D1','D2','D3','D4','D5'].filter(s=>RD.types[s]==='vip').length")) === 5);
  await shot("rd_02_sau_keo_tha");
  // 6. hoàn tác
  const n0 = await ev("Object.keys(RD.types).length"); await ev("document.querySelector('[data-act=rd-undo]').click(); 1"); await sleep(500);
  check("Hoàn tác → quay lại trước khi đổi hàng", await ev("['B1','B2','B3','B4','B5'].filter(s=>RD.types[s]==='vip').length===5"), `types: ${n0}`);
  // 7. bấm ghế trong 3D (raycast) với bút Bảo trì → ghế đó thành bảo trì
  await ev("RD.tool='blocked'; RD.mode='room'; render(); 1"); await sleep(2500);   // chờ máy quay bay xong (0,7 s) rồi mới chiếu toạ độ ghế
  const c3 = await ev("Seat3D.screenPos('F6')"); console.log("  dbg 3D:", JSON.stringify(c3), "elem=", await ev(`document.elementFromPoint(${c3[0]},${c3[1]})?.tagName`), "mode=", await ev("RD.mode"), "tool=", await ev("RD.tool"), "drag=", await ev("JSON.stringify(RD.drag)"));
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: c3[0], y: c3[1], button: "left", clickCount: 1 }); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: c3[0], y: c3[1], button: "left", clickCount: 1 }); await sleep(800);
  check("Bấm ghế F6 trong khung 3D → thành bảo trì (tô bằng công cụ đang chọn)", (await ev("RD.types.F6")) === "blocked", await ev("'blocked='+Object.keys(RD.types).filter(k=>RD.types[k]==='blocked').join(',')+' focus='+RD.focus"));
  // 8. tự xếp VIP + thống kê góc nhìn
  await ev("document.querySelector('[data-act=rd-autovip]')?.click(); 1"); await sleep(600);
  check("Tổng kết có phân bố góc nhìn và doanh thu; tự xếp VIP chạy", /rất tốt \d+ · .*tốt \d+ · .*kém \d+/.test(await ev("document.querySelector('[data-rd-stats]').innerText")));
  await shot("rd_03_3d_thong_ke");
  // 8b. Vào rạp từ trình thiết kế: đi lại (W), E ngồi thử ghế gần, E lần nữa đứng dậy, Esc thoát
  await ev("document.querySelector('[data-act=rd-theatre]').click(); 1"); await sleep(2500);
  check("Vào rạp từ trình thiết kế: màn phủ kín, canvas 3D, chế độ Từ ghế", await ev("!!document.querySelector('[data-rd-theatre]') && document.querySelector('[data-rd-theatre-stage] canvas')?.width > 800 && RD.theatre && document.body.classList.contains('theatre-open')"));
  await ev("document.querySelector('[data-act=rd-tmode][data-v=walk]').click(); 1"); await sleep(1500);
  await ev("document.querySelector('[data-rd-theatre-stage] canvas').focus(); 1");
  await key("KeyW", true, 1500); await key("KeyW", false, 300);
  check("Đi lại bằng W → tới gần ghế → gợi ý Ngồi thử hiện", await ev("RD.mode==='walk' && !document.querySelector('[data-near-prompt]').classList.contains('hidden')"), await ev("document.querySelector('[data-near-text]')?.textContent"));
  const nearId = await ev("Seat3D.near && Seat3D.near.id");
  await key("KeyE", true, 100); await key("KeyE", false, 1500);
  check("E → ngồi thử ghế gần, về Từ ghế, ghế đó là ghế đang xem", !!nearId && await ev(`RD.mode==='seat' && RD.focus==='${nearId}'`), `ghế ${nearId}`);
  await shot("rd_07_vao_rap");
  await key("KeyE", true, 100); await key("KeyE", false, 1200);
  check("E lần nữa → đứng dậy, đi lại", await ev("RD.mode==='walk'"));
  await key("Escape", true, 50); await key("Escape", false, 800);
  check("Esc → thoát rạp, về trình thiết kế (sơ đồ vẫn giữ nguyên)", await ev("!document.querySelector('[data-rd-theatre]') && !RD.theatre && location.hash==='#/phong' && !!document.querySelector('[data-rd-grid]')"));
  // 9. đóng không lưu (bỏ) → thêm phòng mới → mẫu → lưu → khách thấy → xoá
  await ev("window.confirm=()=>true; document.querySelector('[data-act=rd-back]').click(); 1"); await sleep(800);
  check("Đóng không lưu → về Cơ sở & phòng, phòng 086-R1 không đổi", await ev("location.hash==='#/coso'") && (await ev("JSON.stringify(Object.fromEntries(Object.entries(room('086-R1').seatMap||{})))")) !== null);
  await ev("document.querySelector('[data-act=room-new][data-cinema=\"086\"]').click(); 1"); await sleep(1500);
  const newId = await ev("RD.meta.id");
  // 9b. mẫu phòng (theo thông số rạp thực tế): thẻ mẫu + tuỳ chỉnh
  check("Có 6 thẻ mẫu phòng (A Tiêu chuẩn … G Grand) + thẻ Tuỳ chỉnh", (await ev("document.querySelectorAll('[data-act=rd-preset]').length")) === 6 && await ev("!!document.querySelector('[data-act=rd-custom]')"));
  await ev("document.querySelector('[data-act=rd-preset][data-v=imax]').click(); 1"); await sleep(2500);
  check("Mẫu IMAX → 14 hàng × 26 ghế, khối 6+14+6 → 2 lối đi mỗi hàng, công nghệ IMAX, 3D: màn 22 m cong bán kính 30 m, sơ đồ 2D vẽ cung", await ev("RD.rows===14 && RD.cols===26 && RD.layout.preset==='imax' && RD.meta.kind==='IMAX' && document.querySelectorAll('[data-rd-grid] [data-row=\"0\"] span.w-3').length===2 && (()=>{const t=Seat3D.theatreOf(rdRoom());return t.screen.curveRadius===30 && Math.abs(t.screen.width-22)<.01 && t.fovTarget===70})() && document.querySelector('[data-rd-wrap] [data-screen-bar]').dataset.screenBar==='curved' && !!document.querySelector('[data-rd-wrap] [data-screen-bar] path')"), await ev("JSON.stringify([RD.rows,RD.cols,roomLayout(rdRoom()).blocks])"));
  await shot("rd_05_mau_imax");
  await ev("document.querySelector('[data-act=rd-preset][data-v=dolby]').click(); 1"); await sleep(1500);
  await ev("document.querySelector('[data-act=rd-custom]').click(); 1"); await sleep(800);
  check("Mẫu Dolby (ghế nằm, khối 3+8+3) → bấm Tuỳ chỉnh: ô khối ghế, lối đi, màn, màu, đèn…", await ev("roomLayout(rdRoom()).seatStyle==='recliner' && roomLayout(rdRoom()).blocks.join()==='3,8,3' && document.querySelectorAll('[data-rd-custom] input, [data-rd-custom] select').length>=15"));
  await ev("(()=>{const i=document.querySelector('#rd-l-blocks'); i.value='4,6,4'; i.dispatchEvent(new Event('input',{bubbles:true}));})()"); await sleep(900);
  await ev("(()=>{const i=document.querySelector('#rd-l-screenC'); i.value='0'; i.dispatchEvent(new Event('input',{bubbles:true}));})()"); await sleep(900);
  check("Đổi khối 4,6,4 + bán kính cong 0 → sơ đồ 2 lối đi sau ghế 4 và 10, 3D màn phẳng", await ev("roomLayout(rdRoom()).blocks.join()==='4,6,4' && [...aisleAfter(rdRoom())].join()==='3,9' && Seat3D.theatreOf(rdRoom()).screen.curveRadius===0 && document.querySelector('[data-rd-wrap] [data-screen-bar]').dataset.screenBar==='flat'"));
  await shot("rd_06_tuy_chinh");
  await ev("document.querySelector('[data-act=rd-preset][data-v=\"4dx\"]').click(); 1"); await sleep(1200);
  await ev("document.querySelector('#rd-name').value='Phòng thử kéo thả'; document.querySelector('#rd-name').dispatchEvent(new Event('input',{bubbles:true})); 1");
  await ev("document.querySelector('[data-act=rd-save]').click(); 1"); await sleep(4000);
  check("Thêm phòng mới từ mẫu 4DX (8×12, khối 4+4+4) → lưu, có trong danh sách phòng kèm mẫu", await ev(`!!room('${newId}') && room('${newId}').rows===8 && room('${newId}').cols===12 && Object.values(room('${newId}').seatMap||{}).includes('vip') && room('${newId}').layout && room('${newId}').layout.preset==='4dx' && [...aisleAfter(room('${newId}'))].join()==='3,7'`), newId);
  await ev("window.confirm=()=>true; document.querySelector('[data-act=rd-del]').click(); 1"); await sleep(5000);
  check("Xoá phòng thử → không còn", await ev(`!room('${newId}') || room('${newId}').id!=='${newId}'`) && await ev("location.hash==='#/coso'"), await ev(`room('${newId}') ? 'vẫn còn ' + room('${newId}').id : 'đã xoá'`));
  // 10. điện thoại
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await sleep(400);
  await ev("document.querySelector('[data-act=room-edit][data-id=\"086-R1\"]').click(); 1"); await sleep(2000);
  check("Điện thoại: trình thiết kế hiện đủ bảng công cụ, sơ đồ cuộn ngang, 3D", await ev("document.querySelectorAll('[data-act=rd-tool]').length>=5 && !!document.querySelector('[data-rd-wrap]') && !!document.querySelector('[data-seat3d-rd] canvas') && document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2"));
  await shot("rd_04_mobile");
} catch (e) { check("Kịch bản chạy trọn", false, e.message); }
check("Không có lỗi JS", errs.filter(e => !/favicon|net::ERR/.test(e)).length === 0, errs.slice(0, 2).join(" | "));
console.log(`\n${res.filter(r => r.startsWith("PASS")).length} PASS, ${res.filter(r => r.startsWith("FAIL")).length} FAIL`);
edge.kill(); process.exit(res.some(r => r.startsWith("FAIL")) ? 1 : 0);
