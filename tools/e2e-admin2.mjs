// Kiểm thử quản lý đợt 2: báo cáo khoan sâu (phim → cơ sở → phòng, suất → người mua), bán tại quầy trực quan (poster, giờ, loại vé, 3D),
// suất chiếu ngày + giờ tự chọn, lặp nhiều ngày. Mẫu phòng (IMAX/Dolby/4DX/Luxury/Grand + tuỳ chỉnh) kiểm ở tools/e2e-room-design.mjs.
// Chạy: node tools/e2e-admin2.mjs [URL=http://localhost:8767/]
import { spawn } from "node:child_process"; import { mkdtempSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const EDGE = process.env.EDGE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", BASE = process.argv[2] || "http://localhost:8767/", PORT = 9432, sleep = ms => new Promise(r => setTimeout(r, ms));
const edge = spawn(EDGE, ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "adm-"))}`, "--window-size=1400,1100", "about:blank"], { stdio: "ignore" });
for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/json/version`); break; } catch (e) { await sleep(250); } }
const t = await (await fetch(`http://localhost:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(), errs = [], res = []; ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } if (d.method === "Runtime.exceptionThrown") errs.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async e => { const r = (await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result; if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const shot = async n => { const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }); writeFileSync(join("e2e-shots", n + ".png"), Buffer.from(r.result.data, "base64")); };
const check = (n, c, info = "") => { const l = `${c ? "PASS" : "FAIL"}  ${n}${info ? "  — " + info : ""}`; res.push(l); console.log(l); };
await send("Runtime.enable"); await send("Page.enable"); await send("Page.navigate", { url: BASE + "#/dangnhap" }); await sleep(5000);
try {
  await ev("window.confirm=()=>true; localStorage.clear(); 1"); await ev("document.querySelector('[data-act=demo-login][data-u=quanly]').click(); 1"); await sleep(2500);
  // ---------- 1. Báo cáo: toàn chuỗi → phim → cơ sở → phòng/suất → người mua ----------
  await ev("location.hash='#/baocao'; 1"); await sleep(1500);
  await ev("[...document.querySelectorAll('[data-act=bc-scope]')].find(b=>b.dataset.v==='all')?.click(); 1"); await sleep(800);
  check("Báo cáo toàn chuỗi: tên phim bấm được, cơ sở bấm được", await ev("document.querySelectorAll('[data-act=bc-film]').length>0 && document.querySelectorAll('[data-act=bc-cinema]').length>0"));
  const fid = await ev("(()=>{const ids=[...document.querySelectorAll('[data-act=bc-film]')].map(b=>b.dataset.id);return ids.find(id=>S.tickets.some(t=>show(t.showId)&&show(t.showId).filmId===id))||ids[0]})()");
  await ev(`document.querySelector('[data-act=bc-film][data-id="${fid}"]').click(); 1`); await sleep(800);
  const nCin = await ev("document.querySelectorAll('[data-sheet] [data-act=bc-cinema]').length");
  check("Bấm phim → hộp 'bán ở đâu' liệt kê cơ sở có suất, thanh ghế bán", nCin > 0 && /Theo cơ sở/.test(await ev("document.querySelector('[data-sheet]').innerText")), `phim ${fid}, ${nCin} cơ sở`);
  await shot("adm2_01_bc_phim");
  await ev("document.querySelector('[data-sheet] [data-act=bc-cinema]').click(); 1"); await sleep(800);
  const nShow = await ev("document.querySelectorAll('[data-sheet] [data-act=bc-show]').length");
  check("Bấm cơ sở → từng phòng (kèm mẫu phòng) và từng suất", nShow > 0 && await ev("document.querySelectorAll('[data-sheet] [data-bc-rooms] > div').length>0"), `${nShow} suất`);
  await shot("adm2_02_bc_coso");
  await ev("(()=>{const bs=[...document.querySelectorAll('[data-sheet] [data-act=bc-show]')];(bs.find(b=>S.tickets.some(t=>t.showId===b.dataset.show&&t.status!=='refunded'))||bs[0]).click()})()"); await sleep(3000);
  check("Bấm suất → người đã mua (gộp theo người mua, ghế, tiền) + sơ đồ ghế + nút quay lại", await ev("!!document.querySelector('[data-sheet] [data-bc-crumb]') && /Người đã mua/.test(document.querySelector('[data-sheet]').innerText) && !!document.querySelector('[data-sheet] [data-act=bc-back]') && !!document.querySelector('[data-sheet] [data-seat-zoom]')"), await ev("document.querySelectorAll('[data-sheet] [data-bc-buyers] > div').length + ' người mua'"));
  await shot("adm2_03_bc_nguoi_mua");
  await ev("document.querySelector('[data-sheet] [data-act=bc-back]').click(); 1"); await sleep(600);
  check("Quay lại → về hộp phòng/suất của cơ sở", await ev("!!document.querySelector('[data-sheet] [data-act=bc-show]')"));
  await ev("document.querySelector('[data-sheet] [data-act=bc-back-film]')?.click(); 1"); await sleep(500);
  check("Đường dẫn: bấm tên phim → về hộp 'bán ở đâu'", await ev("!!document.querySelector('[data-sheet] [data-bc-cinemas]')"));
  await ev("document.querySelector('#modal-root [data-scrim]')?.click(); 1"); await sleep(300);
  // ---------- 2. Suất chiếu: ngày tự chọn + giờ tự chọn + lặp ----------
  await ev("location.hash='#/suat'; 1"); await sleep(1200);
  check("Suất chiếu: ô Ngày là lịch (type=date), có giờ nhanh và lặp lại", await ev("document.querySelector('#ns-day')?.type==='date' && document.querySelectorAll('[data-act=ns-time-pick]').length>=6 && !!document.querySelector('[data-select=ns-repeat]')"));
  // dọn suất thử còn sót từ lần chạy trước (10:15 / 23:00, ≥9 ngày tới, chưa bán vé) rồi tìm 3 ngày liên tiếp phòng đang chọn chưa có suất nào
  const stale = await ev("S.shows.filter(s=>s.status!=='cancelled'&&(hhmm(s.start)==='10:15'||hhmm(s.start)==='23:00'||hhmm(s.start)==='06:00')&&new Date(s.start)>Date.now()+9*864e5&&soldCount(s)===0).map(s=>s.id)");
  for (const sid0 of stale) await ev(`(async()=>{ if (ON() && Remote.v8) { try { await Remote.rpc('cancel_show_s',{p_token:Auth.token,p_id:'${sid0}',p_reason:'dọn kiểm thử'}); } catch(e){} } const s=show('${sid0}'); if (s) s.status='cancelled'; })()`);
  if (stale.length) { await ev("save(); render(); 1"); await sleep(600); }
  const ymd = await ev("(()=>{const rid=S.view.ns.room;for(let k=14;k<70;k++){const d0=new Date();d0.setHours(0,0,0,0);d0.setDate(d0.getDate()+k);const ok=[0,1,2].every(i=>{const d=new Date(d0);d.setDate(d.getDate()+i);return !S.shows.some(s=>s.roomId===rid&&dayKey(s.start)===dayKey(d))});if(ok)return `${d0.getFullYear()}-${String(d0.getMonth()+1).padStart(2,'0')}-${String(d0.getDate()).padStart(2,'0')}`}return null})()");
  check("Tìm được 3 ngày trống liên tiếp cho phòng đang chọn", !!ymd, ymd);
  await ev(`(()=>{const i=document.querySelector('#ns-day'); i.value='${ymd}'; i.dispatchEvent(new Event('input',{bubbles:true}));})()`); await sleep(900);
  check("Chọn một ngày chưa có suất nào → lưới chuyển sang ngày đó, ô ngày giữ giá trị", await ev(`S.view.ns.day===dayKey(new Date('${ymd}T00:00:00')) && S.view.sday===S.view.ns.day && document.querySelector('#ns-day').value==='${ymd}'`));
  await ev("(()=>{const i=document.querySelector('#ns-time'); i.value='10:15'; i.dispatchEvent(new Event('input',{bubbles:true}));})()"); await sleep(900);
  check("Gõ giờ 10:15 → nút Thêm suất bật, suất mới hiện mờ trên lưới", await ev("!document.querySelector('[data-act=add-show]').disabled && /Suất mới/.test(document.body.innerText)"));
  await shot("adm2_04_suat_custom");
  const n0 = await ev("S.shows.length");
  await ev("document.querySelector('[data-act=add-show]').click(); 1"); await sleep(3500);
  const added = await ev(`S.shows.filter(s=>dayKey(s.start)===dayKey(new Date('${ymd}T00:00:00')) && hhmm(s.start)==='10:15').map(s=>s.id)`);
  check("Thêm suất 10:15 vào ngày tự chọn → có trong lịch", added.length === 1 && (await ev("S.shows.length")) === n0 + 1, JSON.stringify(added) + " " + await ev("document.body.innerText.includes('Trùng suất') ? 'báo trùng' : ''"));
  // suất 06:00 (ngoài khung 8h–1h mặc định) → trục giờ tự nới, vẫn thấy trên lưới
  await ev("(()=>{const i=document.querySelector('#ns-time'); i.value='06:00'; i.dispatchEvent(new Event('input',{bubbles:true}));})()"); await sleep(900);
  check("Gõ 06:00 → trục giờ bắt đầu từ 6:00, suất mới hiện trong lưới (không âm)", await ev("[...document.querySelectorAll('.relative.h-8 span')].some(x=>x.textContent==='6:00') && !!document.querySelector('[data-act=add-show]:not([disabled])') && (()=>{const d=[...document.querySelectorAll('.border-dashed')].find(x=>/Suất mới/.test(x.textContent));return !!d && parseFloat(d.style.left)>=0})()"));
  await ev("document.querySelector('[data-act=add-show]').click(); 1"); await sleep(3500);
  check("Thêm suất 06:00 → có khối suất 06:00 trên lưới ngày đó", await ev("[...document.querySelectorAll('[data-act=show-info]')].some(b=>/06:00/.test(b.textContent))"));
  await shot("adm2_04b_suat_6h");
  await ev("SEL['ns-repeat']({dataset:{select:'ns-repeat'}}, '3'); 1"); await sleep(500);
  await ev("document.querySelector('[data-act=ns-time-pick][data-v=\"23:00\"]').click(); 1"); await sleep(800);
  check("Lặp 3 ngày: nút ghi '× 3 ngày'", /× 3 ngày/.test(await ev("document.querySelector('[data-act=add-show]').textContent")));
  await ev("document.querySelector('[data-act=add-show]').click(); 1"); await sleep(5000);
  const rep = await ev(`[0,1,2].map(i=>{const d=new Date('${ymd}T00:00:00');d.setDate(d.getDate()+i);return S.shows.some(s=>dayKey(s.start)===dayKey(d)&&hhmm(s.start)==='23:00'&&s.roomId===S.view.ns.room)})`);
  check("Thêm suất 23:00 lặp 3 ngày liên tiếp → 3 suất", rep.every(Boolean), JSON.stringify(rep));
  // dọn: huỷ các suất vừa thêm (cả trên máy chủ) để dữ liệu demo sạch
  const ids = await ev(`S.shows.filter(s=>(hhmm(s.start)==='10:15'||hhmm(s.start)==='23:00'||hhmm(s.start)==='06:00') && new Date(s.start)>=new Date('${ymd}T00:00:00') && new Date(s.start)<new Date('${ymd}T00:00:00').getTime()+3*864e5 && s.status!=='cancelled').map(s=>s.id)`);
  for (const sid0 of ids) await ev(`(async()=>{ if (ON() && Remote.v8) { try { await Remote.rpc('cancel_show_s',{p_token:Auth.token,p_id:'${sid0}',p_reason:'kiểm thử'}); } catch(e){} } const s=show('${sid0}'); if (s) s.status='cancelled'; })()`);
  await ev("save(); 1");
  // ---------- 2b. Kho phim: hộp sửa phim có nút Xoá phim (quản lý chuỗi) ----------
  await ev("location.hash='#/phim'; 1"); await sleep(1000);
  await ev("document.querySelector('[data-act=film-edit]').click(); 1"); await sleep(600);
  check("Sửa phim → có nút Xoá phim; phim còn suất sắp chiếu thì bấm báo rõ, không xoá", await ev("!!document.querySelector('[data-sheet] [data-act=del]')") && (await ev("(()=>{const n=S.films.length; document.querySelector('[data-sheet] [data-act=del]').click(); return n})()")) === (await ev("S.films.length")) && /suất sắp chiếu|Ngừng chiếu/.test(await ev("document.querySelector('#toast-root, [data-toast], body').innerText")));
  await ev("document.querySelector('#modal-root [data-scrim]')?.click(); 1"); await sleep(300);
  // ---------- 3. Bán tại quầy trực quan ----------
  await ev("location.hash='#/quay'; S.view.pos={showId:null,seats:[],types:{},docs:{}}; render(); 1"); await sleep(1200);
  check("Quầy: 3 bước, thẻ phim có poster + nút giờ chiếu, vẫn có ô chọn nhanh", await ev("document.querySelectorAll('[data-pos-steps] li').length===3 && document.querySelectorAll('[data-pos-films] article').length>0 && document.querySelectorAll('[data-act=pos-pick]').length>0 && !!document.querySelector('[data-select=pos-show]')"));
  await shot("adm2_05_quay_chon_suat");
  await ev("(()=>{const b=[...document.querySelectorAll('[data-act=pos-pick]:not([disabled])')].find(b=>film(show(b.dataset.show).filmId).rating==='P'&&freeSeats(show(b.dataset.show))>=10)||[...document.querySelectorAll('[data-act=pos-pick]:not([disabled])')].find(b=>freeSeats(show(b.dataset.show))>=10); b.click();})()"); await sleep(1500);
  check("Bấm giờ chiếu → dải suất đang bán + sơ đồ ghế + khung 3D + đơn ở bước 2", await ev("!!S.view.pos.showId && !!document.querySelector('[data-pos-current]') && !!document.querySelector('[data-seat-zoom]') && !!document.querySelector('[data-seat3d-pos] canvas') && /bước 2\\/3/.test(document.body.innerText)"));
  await ev("(()=>{const b=[...document.querySelectorAll('[data-act=pos-seat]:not([disabled])')].filter(b=>!b.dataset.group)[3]; b.click();})()"); await sleep(1800);
  check("Bấm ghế → hàng vé với 4 nút loại vé to, tổng tiền, nút thu tiền; 3D nhìn từ ghế đó", await ev("S.view.pos.seats.length===1 && document.querySelectorAll('[data-pos-row] [data-act=pos-ty]').length===4 && !!document.querySelector('[data-pos-total]') && document.querySelectorAll('[data-act=pos-pay]').length===2 && /Khách sẽ thấy màn hình/.test(document.body.innerText)"));
  const sid = await ev("S.view.pos.seats[0]");
  await ev(`document.querySelector('[data-act=pos-ty][data-seat="${sid}"][data-v=child]').click(); 1`); await sleep(600);
  check("Chọn Trẻ em → cần giấy tờ: ô giấy tờ + Đạt/Không + nút quét", await ev(`S.view.pos.types['${sid}']==='child' && !!document.querySelector('[data-select="pos-doc-${sid}"]') && !!document.querySelector('[data-act=pos-docok][data-seat="${sid}"]') && document.querySelector('[data-act=pos-pay]').disabled`));
  await shot("adm2_06_quay_don");
  await ev(`(()=>{const box=document.querySelector('[data-select="pos-doc-${sid}"]'); box.dataset.value='Thẻ học sinh';})()`);
  await ev(`document.querySelector('[data-act=pos-docok][data-seat="${sid}"][data-ok="1"]').click(); 1`); await sleep(600);
  check("Ghi nhận giấy tờ Đạt → nút thu tiền bật", await ev("!document.querySelector('[data-act=pos-pay]').disabled"));
  await ev("document.querySelector('[data-act=pos-clear]').click(); 1"); await sleep(800);
  check("Bỏ hết ghế → đơn trống, về bước 2", await ev("S.view.pos.seats.length===0 && /Bấm ghế trên sơ đồ/.test(document.body.innerText)"));
  await ev("document.querySelector('[data-act=pos-change]').click(); 1"); await sleep(800);
  check("Đổi suất → về bước 1 chọn suất", await ev("!S.view.pos.showId && document.querySelectorAll('[data-act=pos-pick]').length>0"));
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await sleep(600);
  check("Điện thoại: quầy không tràn ngang", await ev("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2"));
  await shot("adm2_07_quay_mobile");
  await ev("location.hash='#/baocao'; 1"); await sleep(1000);
  check("Điện thoại: báo cáo không tràn ngang", await ev("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2"));
} catch (e) { check("Kịch bản chạy trọn", false, e.message); }
check("Không có lỗi JS", errs.filter(e => !/favicon|net::ERR/.test(e)).length === 0, errs.slice(0, 3).join(" | "));
console.log(`\n${res.filter(r => r.startsWith("PASS")).length} PASS, ${res.filter(r => r.startsWith("FAIL")).length} FAIL`);
edge.kill(); process.exit(res.some(r => r.startsWith("FAIL")) ? 1 : 0);
