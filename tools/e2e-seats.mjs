// Kiểm thử ghế khi 2 khách cùng mở một suất (2 trình duyệt riêng, dữ liệu thật trên Supabase).
// Chạy: node tools/e2e-seats.mjs [URL=http://localhost:8767/] [thư mục ảnh=./e2e-shots]
// Kiểm: ghế người khác đang giữ (chưa trả tiền) · ghế đã bán · bỏ giữ / huỷ đơn · giữ hết hạn tự nhả
//       · thanh toán sau khi hết hạn giữ bị từ chối · ghế của chính mình · nhân viên tra cứu ghế ở quầy.
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const EDGE = process.env.EDGE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const BASE = process.argv[2] || "http://localhost:8767/";
const OUT = resolve(process.argv[3] || "e2e-shots"); mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [], errors = [], procs = [];
const check = (n, c, info = "") => { const l = `${c ? "PASS" : "FAIL"}  ${n}${info ? "  — " + info : ""}`; results.push(l); console.log(l); };
async function browser(port, name) {
  procs.push(spawn(EDGE, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "seat-" + name + "-"))}`, "--window-size=1280,1000", "about:blank"], { stdio: "ignore" }));
  for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${port}/json/version`); break; } catch (e) { await sleep(250); } }
  const t = await (await fetch(`http://localhost:${port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } if (d.method === "Runtime.exceptionThrown") errors.push(name + ": " + (d.params.exceptionDetails.exception?.description || "").slice(0, 200)); };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  for (const m of ["Runtime.enable", "Page.enable"]) await send(m);
  const ev = async expr => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(name + ": " + (r.result.exceptionDetails.exception?.description || "").slice(0, 300)); return r.result?.result?.value; };
  const waitFor = async (expr, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr).catch(() => false)) return true; await sleep(300); } return false; };
  const shot = async n => { const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }); writeFileSync(join(OUT, n + ".png"), Buffer.from(r.result.data, "base64")); };
  await send("Page.navigate", { url: BASE }); await sleep(2500); await ev("localStorage.clear(); location.reload()"); await sleep(3500);
  return { ev, waitFor, shot };
}
const login = async (P, u, p) => { await P.ev(`location.hash='#/dangnhap'`); await sleep(500); await P.ev(`document.querySelector('#li-user').value='${u}';document.querySelector('#li-pass').value='${p}';document.querySelector('[data-form]').requestSubmit()`); await P.waitFor(`!document.querySelector('[data-form]')`); await sleep(1500); };
// trạng thái một ghế trên sơ đồ đang hiện
const seat = (P, sid) => P.ev(`(()=>{const b=document.querySelector('[data-seat="${sid}"]');return b?{label:b.getAttribute('aria-label'),dis:b.disabled,pressed:b.getAttribute('aria-pressed')}:null})()`);
const openShow = (P, id) => P.ev(`(A["pick-show"]({dataset:{show:"${id}"}}), true)`);

(async () => {
  try {
    const PA = await browser(9361, "A"), PB = await browser(9362, "B");
    await PA.waitFor(`Remote.v4`); await PB.waitFor(`Remote.v4`);
    await login(PA, "khach", "khach123"); await login(PB, "giaovien", "giaovien123");
    // suất phim P sớm nhất còn ≥ 6 ghế, chưa chiếu (không cần kiểm tuổi)
    const showId = await PA.ev(`S.shows.filter(s=>cinemaOf(s).id==='086'&&film(s.filmId).rating==='P'&&new Date(s.start)>Date.now()+3600e3&&freeSeats(s)>6).sort((a,b)=>new Date(a.start)-new Date(b.start))[0].id`);
    await openShow(PA, showId); await openShow(PB, showId); await sleep(1200);
    const free = await PA.ev(`[...document.querySelectorAll('[data-act="toggle-seat"]:not([disabled])')].map(b=>b.dataset.seat)`);
    const [s1, s2, s3, s4] = [free[2], free[5], free[8], free[11]];
    check("Hai khách cùng mở một suất", free.length > 12, `${showId}, ${free.length} ghế trống`);

    // 1. A chọn ghế (đang giữ, chưa trả tiền) → B thấy "người khác đang giữ", không bấm được
    await PA.ev(`document.querySelector('[data-seat="${s1}"]').click()`); await sleep(1500);
    const okB = await PB.waitFor(`(()=>{const b=document.querySelector('[data-seat="${s1}"]');return b&&b.disabled&&/đang giữ/.test(b.getAttribute('aria-label'))})()`, 10000);
    check("A giữ ghế (chưa trả tiền) → B thấy 'người khác đang giữ', không chọn được", okB, JSON.stringify(await seat(PB, s1)));
    const grab = await PB.ev(`Remote.rpc('hold_seat',{p_show:'${showId}',p_seat:'${s1}',p_hold:'B-TRANH',p_until:new Date(Date.now()+60000).toISOString()})`);
    check("B cố giữ ghế A đang giữ qua API → máy chủ từ chối", grab === false, String(grab));
    await PB.shot("seat_B_sees_held");

    // 2. A thanh toán → B thấy "đã bán"
    await PA.ev(`A["to-checkout"]()`); await sleep(900); await PA.ev(`document.querySelector('[data-act="pay-ok"]').click()`); await PA.waitFor(`location.hash==='#/ve'`, 15000);
    const soldB = await PB.waitFor(`(()=>{const b=document.querySelector('[data-seat="${s1}"]');return b&&/đã bán/.test(b.getAttribute('aria-label'))})()`, 10000);
    check("A thanh toán xong → B thấy ghế 'đã bán' ngay (realtime)", soldB, JSON.stringify(await seat(PB, s1)));

    // 3. A mở lại suất đó → nhận ra ghế của mình
    await openShow(PA, showId); await sleep(1200);
    const mine = await seat(PA, s1);
    check("A mở lại suất → ghế đã mua hiện là 'ghế của bạn'", mine && /của bạn/.test(mine.label), JSON.stringify(mine));
    await PA.shot("seat_A_mine");

    // 4. B giữ rồi huỷ (quay lại lịch chiếu) → A thấy ghế trống lại ngay
    await PB.ev(`document.querySelector('[data-seat="${s2}"]').click()`); await sleep(1500);
    const heldA = await PA.waitFor(`/đang giữ/.test(document.querySelector('[data-seat="${s2}"]').getAttribute('aria-label'))`, 10000);
    await PB.ev(`A["cancel-draft"]()`); await sleep(500);
    const freeA = await PA.waitFor(`(()=>{const b=document.querySelector('[data-seat="${s2}"]');return !b.disabled&&!/đang giữ|đã bán/.test(b.getAttribute('aria-label'))})()`, 10000);
    check("B giữ rồi huỷ → A thấy ghế trống lại ngay", heldA && freeA);

    // 5. Giữ hết hạn mà không ai bấm gì → sơ đồ của A tự trả ghế về trống
    await PB.ev(`Remote.rpc('hold_seat',{p_show:'${showId}',p_seat:'${s3}',p_hold:'B-NGAN',p_until:new Date(Date.now()+4000).toISOString()})`);
    const h3 = await PA.waitFor(`/đang giữ/.test(document.querySelector('[data-seat="${s3}"]').getAttribute('aria-label'))`, 8000);
    const back = await PA.waitFor(`(()=>{const b=document.querySelector('[data-seat="${s3}"]');return !b.disabled&&!/đang giữ/.test(b.getAttribute('aria-label'))})()`, 20000);
    check("Người khác giữ quá hạn (bỏ dở, đóng trình duyệt) → ghế tự trống lại trên màn hình", h3 && back, JSON.stringify(await seat(PA, s3)));
    await PA.ev(`document.querySelector('[data-seat="${s3}"]').click()`); await sleep(1500);
    check("…và A giữ được ghế đó (máy chủ dọn khoá hết hạn)", await PA.ev(`S.draft.seats.includes('${s3}')`));

    // 6. B giữ ghế, để hết hạn, A lấy mất, rồi B bấm thanh toán → bị từ chối, không ra vé
    await openShow(PB, showId); await sleep(1000);
    await PB.ev(`document.querySelector('[data-seat="${s4}"]').click()`); await sleep(1500);
    const holdB = await PB.ev(`S.draft.id`);
    await PB.ev(`(async()=>{const d=S.draft,u=new Date(Date.now()+3000).toISOString();await Remote.rpc('release_seat',{p_show:d.showId,p_seat:'${s4}',p_hold:d.id});await Remote.rpc('hold_seat',{p_show:d.showId,p_seat:'${s4}',p_hold:d.id,p_until:u});d.until=u;S.seats[d.showId]['${s4}'].until=u;return 1})()`);
    await sleep(3800);
    await PA.waitFor(`!document.querySelector('[data-seat="${s4}"]').disabled`, 15000);
    await PA.ev(`document.querySelector('[data-seat="${s4}"]').click()`); await sleep(1500);
    check("Giữ của B hết hạn → A lấy được ghế", await PA.ev(`S.draft.seats.includes('${s4}')`));
    check("Hết giờ giữ: máy B tự nhả ghế, đưa khách về Lịch chiếu", (await PB.ev(`location.hash`)) === "#/lich" && !(await PB.ev(`S.draft`)));
    const late = await PB.ev(`Remote.rpc('sell_order_u',{p_token:Auth.token,p_show:'${showId}',p_hold:'${"${HOLD}"}',p_tickets:[{code:'VLATE'+Date.now().toString(36).slice(-4).toUpperCase(),order_id:'x',device_id:'x',seat:'${s4}',viewer_name:'B',aud:'Người lớn',price:85000,channel:'Online'}]}).then(()=>'ok').catch(e=>e.message)`.replace("${HOLD}", holdB));
    check("B cố thanh toán bằng lượt giữ đã hết hạn → máy chủ từ chối (hold_expired), không ra vé", /hold_expired/.test(late), late);
    // 7. Đăng xuất khi đang giữ → nhả ghế
    await PA.ev(`A.logout()`); await sleep(1500);
    const rel = await PB.ev(`(async()=>{const r=await Remote.rpc('hold_seat',{p_show:'${showId}',p_seat:'${s3}',p_hold:'B-SAU',p_until:new Date(Date.now()+30000).toISOString()});if(r)await Remote.rpc('release_seat',{p_show:'${showId}',p_seat:'${s3}',p_hold:'B-SAU'});return r})()`);
    check("A đăng xuất khi đang giữ ghế → ghế được nhả cho người khác", rel === true);

    // 8. Nhân viên tra cứu ghế ở quầy
    await login(PA, "nhanvien", "nhanvien123");
    await PA.ev(`location.hash='#/quay'`); await sleep(800);
    await PA.ev(`(S.view.pos={showId:'${showId}',seats:[],types:{},docs:{}}, render(), 1)`); await sleep(800);
    await PA.ev(`document.querySelector('[data-seat="${s1}"]').click()`); await sleep(1200);
    const info = await PA.ev(`document.querySelector('[data-sheet]')?.innerText||''`);
    check("Quầy: bấm ghế đã bán → xem vé (mã, người mua, đã vào hay chưa)", /Đã bán/.test(info) && /V[A-Z0-9]{6}/.test(info), info.split("\n").slice(0, 6).join(" / "));
    await PA.shot("seat_pos_info");
  } catch (e) { console.log("ABORT:", e.message); }
  console.log(`\n${results.filter(r => r.startsWith("PASS")).length} PASS, ${results.filter(r => r.startsWith("FAIL")).length} FAIL`);
  console.log("errors:\n" + [...new Set(errors)].slice(0, 20).join("\n"));
  procs.forEach(p => p.kill()); process.exit(0);
})();
