// Nghiệp vụ đầu-cuối + REALTIME với máy chủ thật, hai trình duyệt: A = quản lý chuỗi, B = khách có hồ sơ (Nguyễn Văn An).
// A thêm phim "test1" cho mọi cơ sở, tạo 6 phòng đủ mẫu (IMAX, Dolby, 4DX, Luxury, Grand, Tiêu chuẩn) bằng trình thiết kế,
// xếp suất ngày mai cho từng phòng → B (đang mở lịch, KHÔNG tải lại) phải thấy phim + suất xuất hiện → B mua 1 vé →
// A (không tải lại) thấy ghế bán, vé, người mua trong Báo cáo khoan sâu. Dữ liệu để lại để xem; chạy lại không tạo trùng.
// Chạy: node tools/e2e-realtime.mjs [URL=http://localhost:8767/]
import { spawn } from "node:child_process"; import { mkdtempSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const EDGE = process.env.EDGE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", BASE = process.argv[2] || "http://localhost:8767/", sleep = ms => new Promise(r => setTimeout(r, ms));
const res = [], check = (n, c, info = "") => { const l = `${c ? "PASS" : "FAIL"}  ${n}${info ? "  — " + info : ""}`; res.push(l); console.log(l); };
async function browser(port, tag) {
  const edge = spawn(EDGE, ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), tag + "-"))}`, "--window-size=1400,1000", "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${port}/json/version`); break; } catch (e) { await sleep(250); } }
  const t = await (await fetch(`http://localhost:${port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map(), errs = []; ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } if (d.method === "Runtime.exceptionThrown") errs.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async e => { const r = (await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result; if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const shot = async n => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join("e2e-shots", n + ".png"), Buffer.from(r.result.data, "base64")); };
  const waitFor = async (expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(500); } return false; };
  await send("Runtime.enable"); await send("Page.enable");
  return { ev, shot, send, waitFor, errs, kill: () => edge.kill() };
}
const A = await browser(9451, "rtA"), B = await browser(9452, "rtB");
const ymd = (() => { const d = new Date(Date.now() + 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
try {
  // ---- B: khách có hồ sơ mở lịch chiếu trước, không tải lại nữa
  await B.send("Page.navigate", { url: BASE + "#/dangnhap" }); await sleep(5000);
  await B.ev("localStorage.clear(); sessionStorage.setItem('cinevin-promo','1'); document.querySelector('[data-act=demo-login][data-u=khach]').click(); 1"); await sleep(3000);
  await B.ev("location.hash='#/lich'; 1"); await sleep(1500);
  check("B: khách Nguyễn Văn An (có hồ sơ) đang mở Lịch chiếu, trực tuyến", await B.ev("Auth.user && Auth.user.role==='khach' && ON() && location.hash==='#/lich'"), await B.ev("Auth.user.name + ' · điểm ' + Auth.user.points"));
  const hadFilm = await B.ev("!!film('test1')");
  // ---- A: quản lý chuỗi
  await A.send("Page.navigate", { url: BASE + "#/dangnhap" }); await sleep(5000);
  await A.ev("window.confirm=()=>true; localStorage.clear(); document.querySelector('[data-act=demo-login][data-u=quanly]').click(); 1"); await sleep(3000);
  check("A: quản lý chuỗi trực tuyến, máy chủ có 008/022", await A.ev("isChainManager() && ON() && !!Remote.v8"));
  await A.ev("const _t=toast; window.__toasts=[]; window.toast=(m,k)=>{__toasts.push((k||'')+': '+m); _t(m,k)}; 1");   // ghi lại thông báo để chẩn đoán
  // 1. phim test1 cho toàn bộ cơ sở (hộp Thêm phim)
  await A.ev("location.hash='#/phim'; 1"); await sleep(1200);
  if (!(await A.ev("S.films.some(f=>f.title==='Test1')"))) {
    await A.ev("document.querySelector('[data-act=film-new]').click(); 1"); await sleep(800);
    await A.ev("(()=>{const sh=document.querySelector('[data-sheet]'); const set=(id,v)=>{const i=sh.querySelector('#'+id); i.value=v; i.dispatchEvent(new Event('input',{bubbles:true}));}; set('fm-title','Test1'); set('fm-dur','95'); set('fm-genre','Kiểm thử realtime'); [...sh.querySelectorAll('input[type=checkbox][id^=fm-c-]')].forEach(c=>c.checked=true); return 1})()");
    await A.ev("document.querySelector('[data-sheet] [data-act=save]').click(); 1"); await sleep(4000);
  }
  // mã phim do hộp sinh ngẫu nhiên → dùng phim có tên Test1 (bất kể mã)
  const fid = await A.ev("(S.films.find(f=>f.title==='Test1')||{}).id || null");
  check("A: phim Test1 có trong kho, phân phối cho toàn bộ cơ sở", !!fid && await A.ev(`CINEMAS.every(c=>filmAt(c.id,'${fid}'))`), `mã ${fid} · ${await A.ev(`CINEMAS.filter(c=>filmAt(c.id,'${fid}')).length`)}/${await A.ev("CINEMAS.length")} rạp`);
  await A.shot("rt_01_phim_test1");
  // 2. sáu phòng đủ mẫu ở Vinh Centre bằng trình thiết kế (bỏ qua phòng đã có)
  const PRESETS = [["standard", "T1"], ["imax", "T2"], ["dolby", "T3"], ["4dx", "T4"], ["luxury", "T5"], ["grand", "T6"]];
  for (const [pid, suf] of PRESETS) { const rid = "086-" + suf; if (await A.ev(`ROOMS.some(x=>x.id==='${rid}')`)) continue;
    await A.ev("location.hash='#/coso'; 1"); await sleep(800); await A.ev("document.querySelector('[data-act=room-new][data-cinema=\"086\"]').click(); 1"); await sleep(1500);
    await A.ev(`document.querySelector('[data-act=rd-preset][data-v="${pid}"]').click(); 1`); await sleep(1200);
    await A.ev(`(()=>{const set=(id,v)=>{const i=document.querySelector('#'+id); i.value=v; i.dispatchEvent(new Event('input',{bubbles:true}));}; set('rd-id','${rid}'); set('rd-name','Test1 · ${pid.toUpperCase()}'); return 1})()`);
    await A.ev("__toasts.length=0; 1"); await A.ev("document.querySelector('[data-act=rd-save]').click(); 1"); await sleep(5000);
    console.log("  lưu " + rid + ":", await A.ev("JSON.stringify(__toasts)")); }
  const roomsOk = await A.ev(`JSON.stringify(${JSON.stringify(PRESETS)}.map(([p,s])=>{const r=ROOMS.find(x=>x.id==='086-'+s); return r && r.layout && r.layout.preset===p ? r.id+'='+p : 'THIẾU '+s+(r?'(layout '+JSON.stringify(r.layout)+')':'')}))`);
  check("A: 6 phòng Test1 đủ mẫu (Tiêu chuẩn, IMAX, Dolby, 4DX, Luxury, Grand) lưu trên máy chủ kèm layout", !/THIẾU/.test(roomsOk), roomsOk);
  await A.ev("RD.on=false; location.hash='#/coso'; 1"); await sleep(1000); await A.shot("rt_02_phong_test1");
  // 3. suất ngày mai cho từng phòng (bỏ qua nếu đã có suất Test1 trong phòng ngày mai)
  const made = [];
  for (let k = 0; k < PRESETS.length; k++) { const rid = "086-" + PRESETS[k][1], h = 9 + k * 2;
    const has = await A.ev(`S.shows.some(s=>s.roomId==='${rid}'&&s.filmId==='${fid}'&&s.status!=='cancelled'&&dayKey(s.start)===dayKey(new Date('${ymd}T00:00:00')))`); if (has) { made.push(rid + ":có"); continue; }
    const r = await A.ev(`(async()=>{const s0=new Date('${ymd}T${String(h).padStart(2, "0")}:00:00'), e0=new Date(s0.getTime()+(film('${fid}').dur+15)*60000); const id='t1'+Date.now().toString(36).slice(-5)+'${PRESETS[k][1]}'; try { const c=await Remote.rpc('add_show_s',{p_token:Auth.token,p_id:id,p_film:'${fid}',p_room:'${rid}',p_start:s0.toISOString(),p_end:e0.toISOString()}); return c===null?'ok':'trùng '+c; } catch(e){ return 'ERR '+e.message; } })()`);
    made.push(rid + ":" + r); }
  check("A: xếp suất Test1 ngày mai cho cả 6 phòng (09:00 → 19:00)", made.every(x => /:(ok|có)$/.test(x)), made.join(" "));
  await A.ev(`S.view.sday=dayKey(new Date('${ymd}T00:00:00')); location.hash='#/suat'; 1`); await sleep(2000); await A.shot("rt_03_suat_test1");
  // ---- B: không tải lại – phim và suất phải tự hiện (realtime)
  const seenFilm = await B.waitFor(`!!film('${fid}')`, 25000), seenShows = await B.waitFor(`S.shows.filter(s=>s.filmId==='${fid}'&&s.status!=='cancelled').length>=6`, 25000);
  check("B (không tải lại): phim Test1 và 6 suất tự xuất hiện qua realtime", seenFilm && seenShows, `film=${seenFilm} shows=${await B.ev(`S.shows.filter(s=>s.filmId==='${fid}'&&s.status!=='cancelled').length`)}`);
  await B.ev(`A['lich-day']({dataset:{v:dayKey(new Date('${ymd}T00:00:00'))}}); 1`); await sleep(1200);
  check("B: lịch ngày mai hiện phim Test1 với các giờ ở phòng Test1", await B.ev("/Test1/.test(document.body.innerText)"));
  await B.shot("rt_04_khach_thay_test1");
  // ---- B mua 1 vé suất IMAX (ghế tốt nhất) → thanh toán
  const showB = await B.ev(`(S.shows.find(s=>s.filmId==='${fid}'&&s.roomId==='086-T2'&&s.status!=='cancelled')||{}).id`);
  await B.ev(`A['pick-show']({dataset:{show:'${showB}'}}); 1`); await sleep(1500);
  await B.ev("document.querySelector('[data-act=seat-best]').click(); 1"); await sleep(1500);
  const seatB = await B.ev("S.draft.seats[0]");
  await B.ev("document.querySelector('[data-act=to-checkout]')?.click(); 1"); await sleep(1500);
  await B.ev("document.querySelector('[data-act=pay-ok]').click(); 1"); const paid = await B.waitFor("location.hash==='#/ve'", 20000); await sleep(1500);
  check("B: mua ghế tốt nhất suất IMAX Test1 và thanh toán xong (vé về Vé của tôi)", paid && await B.ev(`myTickets().some(t=>t.showId==='${showB}'&&t.seat==='${seatB}')`), `ghế ${seatB}`);
  await B.shot("rt_05_khach_ve_test1");
  // ---- A (không tải lại): ghế bán + vé + người mua tự cập nhật
  const soldSeen = await A.waitFor(`soldCount(show('${showB}'))>=1 && S.tickets.some(t=>t.showId==='${showB}'&&t.seat==='${seatB}')`, 25000);
  check("A (không tải lại): ghế bán và vé của B tự hiện qua realtime", soldSeen, `sold=${await A.ev(`soldCount(show('${showB}'))`)}`);
  await A.ev("S.view.bcScope='all'; location.hash='#/baocao'; 1"); await sleep(1500);
  await A.ev(`document.querySelector('[data-act=bc-film][data-id="${fid}"]').click(); 1`); await sleep(800);
  await A.ev("document.querySelector('[data-sheet] [data-act=bc-cinema][data-cinema=\"086\"]').click(); 1"); await sleep(800);
  await A.ev(`document.querySelector('[data-sheet] [data-act=bc-show][data-show="${showB}"]').click(); 1`); await sleep(3500);
  const buyers = await A.ev("document.querySelector('[data-sheet] [data-bc-buyers]')?.innerText || ''");
  check("A: Báo cáo → Test1 → Vinh Centre → suất IMAX → người mua là Nguyễn Văn An (có hồ sơ) với ghế vừa mua", /Nguyễn Văn An/.test(buyers) && buyers.includes(seatB), buyers.replace(/\n+/g, " / ").slice(0, 160));
  await A.shot("rt_06_bao_cao_nguoi_mua");
} catch (e) { check("Kịch bản chạy trọn", false, e.message); }
check("Không có lỗi JS (A)", A.errs.filter(e => !/favicon|net::ERR/.test(e)).length === 0, A.errs.slice(0, 2).join(" | "));
check("Không có lỗi JS (B)", B.errs.filter(e => !/favicon|net::ERR/.test(e)).length === 0, B.errs.slice(0, 2).join(" | "));
console.log(`\n${res.filter(r => r.startsWith("PASS")).length} PASS, ${res.filter(r => r.startsWith("FAIL")).length} FAIL`);
A.kill(); B.kill(); process.exit(res.some(r => r.startsWith("FAIL")) ? 1 : 0);
