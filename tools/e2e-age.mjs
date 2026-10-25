// Kiểm thử đầu-cuối nghiệp vụ kiểm tuổi tại cửa (Edge headless + CDP, không cần thư viện).
// Chạy: node tools/e2e-age.mjs [URL=http://localhost:8767/] [thư mục ảnh=./e2e-shots]
// Kịch bản: khách chưa xác thực mua 2 vé T16 → nhân viên soát: QR vé → luật giờ vào cửa → vé cần kiểm tuổi
// → quét QR căn cước người 22 tuổi (cho vào) / 15 tuổi (từ chối) → quản lý xuất CSV nhật ký, trang Kiểm thử.
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const EDGE = process.env.EDGE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const BASE = process.argv[2] || "http://localhost:8767/";
const OUT = resolve(process.argv[3] || "e2e-shots"); mkdirSync(OUT, { recursive: true });
const PORT = 9402;
const prof = mkdtempSync(join(tmpdir(), "cinevin-e2e-"));
const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, "--window-size=1280,1000", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "about:blank"], { stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [], errors = [];
const check = (n, c, info = "") => { const l = `${c ? "PASS" : "FAIL"}  ${n}${info ? "  — " + info : ""}`; results.push(l); console.log(l); };
class Tab {
  constructor(ws) { this.id = 0; this.pending = new Map(); this.ws = new WebSocket(ws); }
  async open() { await new Promise(r => this.ws.onopen = r); this.ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && this.pending.has(d.id)) { this.pending.get(d.id)(d); this.pending.delete(d.id); } if (d.method === "Runtime.exceptionThrown") errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).slice(0, 300)); }; for (const m of ["Runtime.enable", "Page.enable", "DOM.enable"]) await this.send(m); }
  send(method, params = {}) { return new Promise(res => { const i = ++this.id; this.pending.set(i, res); this.ws.send(JSON.stringify({ id: i, method, params })); }); }
  async ev(expr) { const r = await this.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error("eval: " + (r.result.exceptionDetails.exception?.description || JSON.stringify(r.result.exceptionDetails)).slice(0, 300)); return r.result?.result?.value; }
  async shot(name) { const r = await this.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }); writeFileSync(join(OUT, name + ".png"), Buffer.from(r.result.data, "base64")); }
  async waitFor(expr, ms = 20000) { const t = Date.now(); while (Date.now() - t < ms) { if (await this.ev(expr).catch(() => false)) return true; await sleep(300); } return false; }
  async setFile(sel, path) { const doc = await this.send("DOM.getDocument", { depth: -1 }); const q = await this.send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: sel }); return this.send("DOM.setFileInputFiles", { nodeId: q.result.nodeId, files: [path] }); }
}
const H = `window.confirm=()=>true;window.$c=(s,i=0)=>{const e=document.querySelectorAll(s)[i];if(!e)throw new Error("missing "+s);e.click();return true};window.$t=s=>(document.querySelector(s)?.innerText||"");
window.$login=(u,p)=>{document.querySelector('#li-user').value=u;document.querySelector('#li-pass').value=p;document.querySelector('[data-form]').requestSubmit();return true};`;
async function login(T, u, p) { await T.ev(`location.hash='#/dangnhap'`); await sleep(500); await T.ev(H); await T.ev(`$login('${u}','${p}')`); await T.waitFor(`!document.querySelector('[data-form]')`, 15000); await sleep(1200); await T.ev(H); }
async function logout(T) { if (!(await T.ev(`!!document.querySelector('[data-act="logout"]')`))) { await T.ev(`location.hash='#/taikhoan'`); await sleep(700); await T.ev(H); } await T.ev(`$c('[data-act="logout"]')`); await sleep(800); await T.ev(H); }
const png = async (T, expr, name) => { const d = await T.ev(`qrPng(${expr})`); const f = join(OUT, name); writeFileSync(f, Buffer.from(d.split(",")[1], "base64")); return f; };

(async () => {
  for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/json/version`); break; } catch (e) { await sleep(250); } }
  const t0 = await (await fetch(`http://localhost:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
  const T = new Tab(t0.webSocketDebuggerUrl); await T.open();
  await T.send("Page.navigate", { url: BASE }); await sleep(2500); await T.ev("localStorage.clear(); location.reload()"); await sleep(3500); await T.ev(H);
  try {
    await T.waitFor(`Remote.v4`, 15000);
    // 1. khách chưa xác thực mua 2 vé phim T16
    await login(T, "khach", "khach123");
    await T.ev(`location.hash='#/taikhoan'`); await sleep(600); await T.ev(H);
    if (await T.ev(`S.user.linked`)) { await T.ev(`$c('[data-act="unlink"]')`); await sleep(400); }
    await T.ev(`location.hash='#/lich'`); await sleep(800); await T.ev(H);
    await T.ev(`if(!location.hash.startsWith('#/lich'))location.hash='#/lich'`); await sleep(700); await T.waitFor(`document.querySelectorAll('[data-act="pick-show"]').length > 0`, 15000);
    const nDays = await T.ev(`document.querySelectorAll('[data-act="lich-day"]').length`); let ok = false;
    for (let d = 0; d < Math.max(1, nDays) && !ok; d++) { if (d) { await T.ev(`$c('[data-act="lich-day"]',${d})`); await sleep(500); }
      ok = await T.ev(`(()=>{const b=[...document.querySelectorAll('[data-act="pick-show"]:not([disabled])')].find(b=>S.shows.find(s=>s.id===b.dataset.show&&s.filmId==='f4'));if(!b)return false;b.click();return true})()`); }
    check("Chọn được suất phim T16", ok); await sleep(900); await T.ev(H);
    // hai khách khác nhau, mỗi người 1 vé → soát từng vé (cùng một chủ mua nhiều vé thì đi luồng "một QR cho cả đơn", kiểm ở e2e-customer)
    const t16Show = await T.ev(`S.draft.showId`), codes = [];
    const buyOne = async () => {
      await T.ev(`(()=>{const s=[...document.querySelectorAll('[data-act="toggle-seat"]:not([disabled])')].filter(b=>b.getAttribute('aria-pressed')==='false');s[Math.floor(s.length/2)].click();return 1})()`); await sleep(1300);
      await T.ev(`$c('[data-act="to-checkout"]')`); await sleep(900); await T.ev(H);
      await T.ev(`$c('[data-act="pay-ok"]')`); await T.waitFor(`location.hash==='#/ve'`, 15000); await sleep(800);
      codes.push(...await T.ev(`myTickets().filter(t=>t.status==='valid'&&t.showId==='${t16Show}').map(t=>({code:t.code,needDoc:t.needDoc})).slice(-1)`));
    };
    // tài khoản mới cho mỗi vé: tài khoản demo đã có vé cùng suất từ lần chạy trước sẽ gộp thành đơn nhiều vé
    const freshUser = async k => { const u = "kta" + Date.now().toString(36).slice(-5) + k;
      await logout(T); await T.ev(`Remote.rpc('register',{p_user:'${u}',p_pass:'matkhau1',p_name:'Khách Kiểm Tuổi',p_email:null,p_phone:null})`);
      await login(T, u, "matkhau1"); await T.ev(`document.querySelector('[data-m="later"]')?.click()`); await sleep(400);
      await T.ev(`location.hash='#/lich'`); await sleep(800); await T.ev(H); await T.ev(`A["pick-show"]({dataset:{show:"${t16Show}"}})`); await sleep(1000); await T.ev(H); };
    await T.ev(`A["cancel-draft"]()`); await sleep(500);
    await freshUser(1); await buyOne();
    await freshUser(2); await buyOne();
    check("2 vé T16 của 2 khách chưa xác thực → phải kiểm tuổi tại cửa", codes.length === 2 && codes.every(c => c.needDoc), JSON.stringify(codes));
    const [tk1, tk2] = codes.map(c => c.code);
    await logout(T);
    // 2. nhân viên soát vé
    await login(T, "nhanvien", "nhanvien123");
    await T.ev(`$c('[data-act="gate-method"][data-v="ma"]')`); await sleep(400); await T.ev(H);
    const qtok = await T.ev(`Remote.rpc('login',{p_user:'quanly',p_pass:'quanly123'}).then(r=>r.token)`);
    const pass = async (code, cccdKey, label) => {
      const payload = await T.ev(`Remote.rpc('ticket_qr',{p_token:'${qtok}',p_code:'${code}'}).then(r=>r.payload)`);
      await T.ev(`gateProcess(${JSON.stringify(payload)}, 'kiểm thử')`); await sleep(1500);
      let kind = await T.ev(`S.view.gate.result && S.view.gate.result.kind`);
      if (kind === "early") { check(`${label}: chưa đến giờ → báo, có nút cho vào sớm`, await T.ev(`!!document.querySelector('[data-act="gate-early"]')`)); await T.ev(`$c('[data-act="gate-early"]')`); await sleep(1500); kind = await T.ev(`S.view.gate.result.kind`); }
      check(`${label}: vé chưa xác thực → thẻ kiểm tuổi có 4 cách điện tử`, kind === "doc" && (await T.ev(`document.querySelectorAll('#gate-result [data-act="age-check"]').length`)) === 4, kind);
      await T.shot(`age_${cccdKey}_card`);
      await T.ev(`$c('#gate-result [data-act="age-check"][data-mode="qr-img"]')`); await sleep(600);
      const f = await png(T, `cccdSample('${cccdKey}')`, `cccd_${cccdKey}.png`);
      await T.setFile("#age-file", f);
      await T.waitFor(`!!document.querySelector('[data-age-result]')`, 15000); await sleep(300);
      const res = await T.ev(`document.querySelector('[data-age-result]').dataset.ageResult + ' | ' + $t('[data-sheet]').split('\\n').slice(1,6).join(' / ')`);
      await T.shot(`age_${cccdKey}_sheet`);
      return res;
    };
    let r = await pass(tk1, "an", "Vé 1");
    check("QR căn cước người 22 tuổi, phim T16 → đủ điều kiện", r.startsWith("ok"), r);
    await T.ev(`$c('[data-m="allow"]')`); await sleep(1800);
    let txt = await T.ev(`$t('#gate-result')`);
    check("Cho vào: kết quả ghi rõ kiểm tuổi qua QR căn cước + bản ghi", txt.includes("Hợp lệ") && /QR căn cước/.test(txt), txt.split("\n").slice(0, 4).join(" / "));
    await T.shot("age_ok_result");
    r = await pass(tk2, "binh", "Vé 2");
    check("QR căn cước người 15 tuổi, phim T16 → không đủ tuổi", r.startsWith("bad"), r);
    await T.ev(`$c('[data-m="deny"]')`); await sleep(1500);
    check("Từ chối được ghi vào 'Vừa quét'", (await T.ev(`$t('#gate-recent')`)).includes("Từ chối"));
    // mã thường không phải căn cước
    await T.ev(`$c('[data-act="gate-method"][data-v="ma"]')`); await sleep(300);
    const payload2 = await T.ev(`Remote.rpc('ticket_qr',{p_token:'${qtok}',p_code:'${tk2}'}).then(r=>r.payload)`);
    await T.ev(`gateProcess(${JSON.stringify(payload2)}, 'kiểm thử')`); await sleep(1500);
    if (await T.ev(`S.view.gate.result.kind==='early'`)) { await T.ev(`$c('[data-act="gate-early"]')`); await sleep(1500); }
    await T.ev(`$c('#gate-result [data-act="age-check"][data-mode="qr-img"]')`); await sleep(600);
    const fb = await png(T, `"https://example.com/khong-phai-can-cuoc"`, "qr_bad.png");
    await T.setFile("#age-file", fb); await T.waitFor(`/Không phải mã QR căn cước/.test($t('[data-sheet]'))`, 15000);
    check("Ảnh QR không phải căn cước → báo rõ, cho thử lại", (await T.ev(`$t('[data-sheet]')`)).includes("Không phải mã QR căn cước"));
    await T.ev(`$c('[data-m="choose"]')`); await sleep(400);
    check("Có đủ 4 cách kiểm tuổi trong hộp thoại", (await T.ev(`document.querySelectorAll('[data-sheet] [data-m]').length`)) >= 5);
    await T.shot("age_choose");
    await T.ev(`$c('[data-m="chip"]')`); await sleep(400); await T.ev(`$c('[data-m="chip-read"]')`); await T.waitFor(`!!document.querySelector('[data-age-result]')`, 10000);
    check("Chip căn cước (mô phỏng): Nguyễn Văn An đủ tuổi T16", (await T.ev(`document.querySelector('[data-age-result]').dataset.ageResult`)) === "ok");
    await T.ev(`document.querySelector('[data-scrim]').click()`); await sleep(400);
    await logout(T);
    // 3. quản lý: xuất CSV, trang Kiểm thử
    await login(T, "quanly", "quanly123");
    await T.ev(`$c('[data-act="export-age"]')`); await sleep(600);
    check("Xuất CSV nhật ký kiểm tra độ tuổi", (await T.ev(`S.view.lastExport`)) > 0, `${await T.ev(`S.view.lastExport`)} dòng`);
    await T.shot("age_tongquan");
    await T.ev(`location.hash='#/kiemthu'`); await sleep(1500); await T.ev(H);
    check("Trang Kiểm thử có thẻ 'Kiểm tuổi tại cửa' + 5 QR mẫu", (await T.ev(`document.querySelectorAll('#lab-cccd .qr-box').length`)) === 5);
    await T.ev(`$c('[data-act="lab-age"]')`); await sleep(500); await T.ev(`$c('[data-m="qr-img"]')`); await sleep(400);
    const fm = await png(T, `cccdSample('binh')`, "cccd_binh2.png"); await T.setFile("#age-file", fm);
    await T.waitFor(`!!document.querySelector('[data-age-result]')`, 15000); await T.ev(`$c('[data-m="deny"]')`); await sleep(800);
    check("Ca kiểm thử 'người chưa đủ tuổi → từ chối' tự đánh dấu đạt", await T.ev(`!!(labCases()['c-minor']&&labCases()['c-minor'].ok)`));
    await T.shot("age_kiemthu");
  } catch (e) { console.log("ABORT:", e.message); await T.shot("abort").catch(() => {}); }
  console.log(`\n${results.filter(r => r.startsWith("PASS")).length} PASS, ${results.filter(r => r.startsWith("FAIL")).length} FAIL`);
  console.log("errors:\n" + [...new Set(errors)].slice(0, 20).join("\n"));
  edge.kill(); process.exit(0);
})();
