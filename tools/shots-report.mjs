// Chụp các màn còn thiếu cho báo cáo (vé đoàn, soát vé, quầy, ca của tôi, chấm công, lương). Chạy: node tools/shots-report.mjs [URL] [thư mục ảnh]
import { spawn } from "node:child_process"; import { writeFileSync, mkdtempSync, mkdirSync } from "node:fs"; import { tmpdir } from "node:os"; import { join, resolve } from "node:path";
const EDGE = process.env.EDGE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", BASE = process.argv[2] || "http://localhost:8767/", OUT = resolve(process.argv[3] || "e2e-shots"); mkdirSync(OUT, { recursive: true });
const PORT = 9387, sleep = ms => new Promise(r => setTimeout(r, ms));
const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "rep-"))}`, "--window-size=1280,1000", "about:blank"], { stdio: "ignore" });
for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/json/version`); break; } catch (e) { await sleep(250); } }
const t0 = await (await fetch(`http://localhost:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(t0.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(); ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async e => { const r = await Promise.race([send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true, timeout: 15000 }), sleep(20000).then(() => ({ error: { message: "evaluate timeout" } }))]); if (r.error) throw new Error(r.error.message); if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text + " " + (r.result.exceptionDetails.exception?.description || "")); return r.result.result.value; };
const wait = async (e, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(e).catch(() => false)) return true; await sleep(300); } return false; };
const shot = async n => { const r = await Promise.race([send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }), sleep(20000).then(() => null)]); if (!r || !r.result) { console.log("shot timeout: " + n); return; } writeFileSync(join(OUT, n + ".png"), Buffer.from(r.result.data, "base64")); console.log("đã chụp " + n); };
const login = async (u, p) => { await ev("Auth.logout && Auth.logout(); localStorage.removeItem('cinevin-work-cinema'); location.hash='#/dangnhap'"); await sleep(600); await ev(`document.querySelector('#li-user').value='${u}';document.querySelector('#li-pass').value='${p}';document.querySelector('[data-form]').requestSubmit()`); await wait("!!Auth.user && !document.querySelector('[data-form]')"); await sleep(1500); };
const go = async (h, ms = 1200) => { await ev(`location.hash='${h}'`); await sleep(ms); };
await send("Runtime.enable"); await send("Page.enable");
await send("Page.navigate", { url: BASE }); await sleep(2500); await ev("localStorage.clear(); location.hash=''; location.reload()"); await sleep(3500);
try {
  await wait("Remote.v4");
  await login("giaovien", "giaovien123"); await go("#/doan"); await shot("rep_01_ve_doan");
  await go("#/taikhoan"); await shot("rep_02_tai_khoan");
  await login("nhanvien", "nhanvien123"); await go("#/soat"); await shot("rep_03_soat_ve");
  await go("#/quay"); await shot("rep_04_quay");
  await login("phucvu", "phucvu123"); await go("#/calam"); await shot("rep_05_ca_cua_toi");
  await login("quanly", "quanly123"); await go("#/nhansu", 1800);
  await ev("document.querySelector('[data-act=\"hr-tab\"][data-v=\"nv\"]')?.click()"); await sleep(1200); await shot("rep_06_nhan_vien");
  await ev("document.querySelector('[data-act=\"hr-tab\"][data-v=\"cc\"]')?.click()"); await sleep(1200); await shot("rep_07_cham_cong");
  await ev("document.querySelector('[data-act=\"hr-tab\"][data-v=\"hs\"]')?.click()"); await sleep(1500); await shot("rep_08_luong");
  await go("#/suat", 1500); await shot("rep_09_suat_chieu");
  await go("#/kiemthu", 1500); await shot("rep_10_kiem_thu");
} catch (e) { console.log("LỖI: " + e.message); }
edge.kill(); process.exit(0);
