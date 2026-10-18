// Chụp màn hình các màn chuỗi rạp: khách chọn rạp / lịch theo phim, quản lý chuỗi, quản lý rạp. Chạy: node tools/shots-chain.mjs [URL] [thư mục ảnh]
import { spawn } from "node:child_process"; import { writeFileSync, mkdtempSync, mkdirSync } from "node:fs"; import { tmpdir } from "node:os"; import { join, resolve } from "node:path";
const EDGE = process.env.EDGE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", BASE = process.argv[2] || "http://localhost:8767/", OUT = resolve(process.argv[3] || "e2e-shots"); mkdirSync(OUT, { recursive: true });
const PORT = 9381, sleep = ms => new Promise(r => setTimeout(r, ms)), results = [];
const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "chain-"))}`, "--window-size=1280,1000", "about:blank"], { stdio: "ignore" });
const check = (n, c, info = "") => { const l = `${c ? "PASS" : "FAIL"}  ${n}${info ? "  — " + info : ""}`; results.push(l); console.log(l); };
for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/json/version`); break; } catch (e) { await sleep(250); } }
const t0 = await (await fetch(`http://localhost:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(t0.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(), errs = []; ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } if (d.method === "Runtime.exceptionThrown") errs.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).slice(0, 200)); };
const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async e => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error((r.result.exceptionDetails.exception?.description || "").slice(0, 300)); return r.result.result?.value; };
const wait = async (e, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(e).catch(() => false)) return true; await sleep(300); } return false; };
const shot = async n => { const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }); writeFileSync(join(OUT, n + ".png"), Buffer.from(r.result.data, "base64")); };
const txt = () => ev("document.body.innerText");
const login = async (u, p) => { await ev("Auth.logout && Auth.logout(); localStorage.removeItem('cinevin-work-cinema'); location.hash='#/dangnhap'"); await sleep(600); await ev(`document.querySelector('#li-user').value='${u}';document.querySelector('#li-pass').value='${p}';document.querySelector('[data-form]').requestSubmit()`); await wait("!!Auth.user && !document.querySelector('[data-form]')"); await sleep(1500); };
await send("Runtime.enable"); await send("Page.enable");
await send("Page.navigate", { url: BASE }); await sleep(2500); await ev("localStorage.clear(); location.hash=''; location.reload()"); await sleep(3500);
try {
  await wait("Remote.v4");
  // ---- khách: rạp mặc định, đổi rạp, theo phim
  await login("khach", "khach123"); await ev("location.hash='#/lich'"); await sleep(800);
  check("Khách: lịch mặc định rạp 086, chỉ hiện suất của rạp này", /CineVin Vinh Centre/.test(await txt()) && await ev("[...document.querySelectorAll('[data-act=\"pick-show\"]')].every(b=>cinemaOf(show(b.dataset.show)).id==='086')"), await ev("document.querySelectorAll('[data-act=\"pick-show\"]').length") + " suất");
  await shot("chain_01_lich_rap");
  await ev("document.querySelector('[data-act=\"cinema-pick\"]').click()"); await sleep(600);
  check("Bảng chọn rạp: 4 tỉnh/thành, Nghệ An có 2 cơ sở", await ev("document.querySelectorAll('[data-act=\"cinema-city\"]').length") === 4 && await ev("document.querySelectorAll('[data-act=\"cinema-set\"]').length") === 2);
  await shot("chain_02_chon_rap");
  await ev("[...document.querySelectorAll('[data-act=\"cinema-city\"]')].find(b=>b.dataset.v==='TP. Hồ Chí Minh').click()"); await sleep(400);
  await ev("[...document.querySelectorAll('[data-act=\"cinema-set\"]')].find(b=>b.dataset.v==='035').click()"); await sleep(900);
  check("Chọn Đồng Khởi (TP.HCM) → lịch đổi theo rạp, nhớ trên máy", /CineVin Đồng Khởi/.test(await txt()) && await ev("curCinema().id==='035' && localStorage.getItem('cinevin-cinema')==='035'") && await ev("[...document.querySelectorAll('[data-act=\"pick-show\"]')].every(b=>cinemaOf(show(b.dataset.show)).id==='035')"));
  // suất 3D (phòng R2) còn bán ở Đồng Khởi: chuyển sang ngày của suất đó rồi bấm giờ
  await ev("(()=>{const s=showsOf('035').filter(s=>s.roomId.endsWith('R2')&&new Date(s.start)>Date.now()+3600e3&&freeSeats(s)>0).sort((a,b)=>new Date(a.start)-new Date(b.start))[0];A['lich-day']({dataset:{v:dayKey(s.start)}});return 1})()"); await sleep(600);
  await ev("(()=>{const b=[...document.querySelectorAll('[data-act=\"pick-show\"]:not([disabled])')].find(b=>show(b.dataset.show).roomId.endsWith('R2'));b.click();return 1})()"); await sleep(1000);
  const leg = await ev("priceLegend(show(S.draft.showId))"), fmt = await ev("formatOf(show(S.draft.showId))");
  check("Sơ đồ ghế Đồng Khởi phòng 3D: giá hạng A + phụ thu 3D, chú giải đúng", leg.std >= 115000 + 32000 && leg.vip === leg.std + 5500 && /3D/.test(fmt) && new RegExp(leg.std.toLocaleString("vi-VN").replace(/\./g, "\\.")).test(await txt()), `${fmt}: thường ${leg.std}, VIP ${leg.vip}`);
  await shot("chain_03_ghe_3d");
  await ev("A['cancel-draft']()"); await sleep(600);
  await ev("document.querySelector('[data-act=\"lich-mode\"][data-v=\"phim\"]').click()"); await sleep(800);
  check("Theo phim: chọn phim → tỉnh → từng rạp có suất", await ev("document.querySelectorAll('[data-act=\"lich-city\"]').length") >= 3 && await ev("document.querySelectorAll('[data-act=\"cinema-set\"]').length") >= 1);
  await ev("[...document.querySelectorAll('[data-act=\"lich-city\"]')].find(b=>b.dataset.v==='Nghệ An').click()"); await sleep(600);
  check("Nghệ An hiện cả 2 cơ sở ở TP Vinh", await ev("document.querySelectorAll('[data-act=\"cinema-set\"]').length") === 2 && /Hưng Dũng/.test(await txt()));
  await shot("chain_04_theo_phim");
  // ---- nhân viên rạp 086: quầy chỉ suất rạp mình
  await login("nhanvien", "nhanvien123"); await ev("location.hash='#/quay'"); await sleep(800);
  check("Nhân viên 086: quầy chỉ liệt kê suất của Vinh Centre", await ev("[...document.querySelectorAll('[data-select=\"pos-show\"] [data-sel-opt]')].every(o=>cinemaOf(show(o.dataset.selOpt)).id==='086')") && /Vinh Centre/.test(await txt()));
  // ---- quản lý chuỗi
  await login("quanly", "quanly123"); await ev("location.hash='#/tongquan'"); await sleep(1000);
  check("Quản lý chuỗi: bảng toàn chuỗi 7 rạp theo tỉnh, có ô đổi rạp", await ev("isChainManager()") && await ev("document.querySelectorAll('[data-act=\"work-cinema-set\"]').length") === 7 && await ev("!!document.querySelector('[data-select=\"work-cinema\"]')") && /nhiều cơ sở cùng thành phố/i.test(await txt()));
  await shot("chain_05_tong_quan_chuoi");
  await ev("[...document.querySelectorAll('[data-act=\"work-cinema-set\"]')].find(b=>b.dataset.v==='054').click()"); await sleep(900);
  check("Đổi rạp thao tác sang Royal City → KPI theo rạp đó", await ev("workCinema().id==='054'") && /Royal City/.test(await ev("document.querySelector('header h1').parentElement.innerText")));
  await ev("location.hash='#/suat'"); await sleep(900);
  check("Suất chiếu: lưới phòng của Royal City (3 phòng, có GOLD)", await ev("roomsOf(workCinema().id).length") === 3 && /GOLD/.test(await txt()) && await ev("[...document.querySelectorAll('[data-select=\"ns-room\"] [data-sel-opt]')].every(o=>o.dataset.selOpt.startsWith('054-'))"));
  await shot("chain_06_suat_royal");
  await ev("location.hash='#/quyen'"); await sleep(1500);
  check("Tài khoản & quyền: quản lý chuỗi chọn rạp khi tạo nhân viên", await ev("!!document.querySelector('[data-select=\"nu-cinema\"]')"));
  await shot("chain_07_quyen_chuoi");
  // ---- quản lý rạp (chỉ khi máy chủ có 006; ngoại tuyến hoặc chưa 006 thì tài khoản demo)
  const ql2 = await ev(`Auth.login('quanlyvinh','quanlyvinh123').then(r=>r.ok?true:r.message)`);
  if (ql2 === true) { await sleep(800); await ev("location.hash='#/tongquan'"); await sleep(600); await ev("location.hash='#/quyen'"); await sleep(1500); console.log('quanlyvinh:', JSON.stringify(await ev("({u:Auth.user.username,cid:Auth.user.cinemaId,staff:staffCinemaId(),chain:isChainManager(),hash:location.hash})")));
    check("Quản lý rạp 086: không chọn rạp khi tạo nhân viên (cố định Vinh Centre), không có ô đổi rạp", await ev("staffCinemaId()==='086' && !isChainManager()") && await ev("!document.querySelector('[data-select=\"work-cinema\"]')") && await ev("!!document.querySelector('#nu-cinema-fixed')"));
    await shot("chain_08_quyen_rap"); }
  else console.log("SKIP  Quản lý rạp quanlyvinh – máy chủ chưa chạy migration 006: " + ql2);
} catch (e) { console.log("ABORT:", e.message); }
console.log(`${results.filter(r => r.startsWith("PASS")).length} PASS, ${results.filter(r => r.startsWith("FAIL")).length} FAIL`); if (errs.length) console.log("errors:\n" + errs.join("\n"));
edge.kill(); process.exit(0);
