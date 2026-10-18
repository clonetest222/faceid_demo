// Kiểm thử đầu-cuối nghiệp vụ khách hàng (Edge headless + CDP). Cần migration 005 trên máy chủ.
// Chạy: node tools/e2e-customer.mjs [URL=http://localhost:8767/] [thư mục ảnh=./e2e-shots] [thư mục ảnh mặt]
// Kịch bản: đăng ký đủ thông tin → mời xác thực VNeID → liên kết VNeID (ảnh) lưu máy chủ → đăng xuất →
// đăng nhập bằng email, bằng SĐT, bằng FaceID (ảnh đúng người / người khác), bằng VNeID → hồ sơ (email, SĐT, lịch sử, voucher)
// → thanh toán có mã khuyến mãi + điểm → hoàn vé ra thẻ quà tặng → nhân viên: khách quên vé vào bằng FaceID.
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const EDGE = process.env.EDGE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const BASE = process.argv[2] || "http://localhost:8767/";
const OUT = resolve(process.argv[3] || "e2e-shots"); mkdirSync(OUT, { recursive: true });
const FACES = process.argv[4] ? resolve(process.argv[4]) : null;
const PORT = 9352, sleep = ms => new Promise(r => setTimeout(r, ms));
const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "cinevin-cust-"))}`, "--window-size=1280,1000", "about:blank"], { stdio: "ignore" });
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
const H = `window.$c=(s,i=0)=>{const e=document.querySelectorAll(s)[i];if(!e)throw new Error("missing "+s);e.click();return true};window.$t=s=>(document.querySelector(s)?.innerText||"");
window.$v=(id,v)=>{const e=document.querySelector('#'+id);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));return true};
window.$sel=(id,v)=>{const b=document.querySelector('[data-select="'+id+'"]');b.querySelector('[data-sel-open]').click();b.querySelector('[data-sel-opt="'+v+'"]').click();return true};`;
const toLogin = async T => { await T.ev(`location.hash='#/dangnhap'`); await sleep(500); await T.ev(H); };
const logout = async T => { if (!(await T.ev(`!!document.querySelector('[data-act="logout"]')`))) { await T.ev(`location.hash='#/taikhoan'`); await sleep(700); await T.ev(H); } await T.ev(`$c('[data-act="logout"]')`); await sleep(800); await T.ev(H); };
const sheetDone = async (T, ms = 60000) => { await T.waitFor(`/thành công|không thành công|không đăng nhập được/i.test($t('[data-sheet] header'))`, ms); const t = await T.ev(`$t('[data-sheet]')`); return t; };

(async () => {
  for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/json/version`); break; } catch (e) { await sleep(250); } }
  const t0 = await (await fetch(`http://localhost:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
  const T = new Tab(t0.webSocketDebuggerUrl); await T.open();
  await T.send("Page.navigate", { url: BASE }); await sleep(2500); await T.ev("localStorage.clear(); location.hash=''; location.reload()"); await sleep(3500); await T.ev(H);
  const uid = Date.now().toString(36).slice(-5), user = "kt" + uid, email = `kt${uid}@example.com`, phone = "09" + String(Date.now()).slice(-8);
  try {
    await T.waitFor(`Remote.v4`, 15000);
    const v5 = await T.ev(`Remote.hasV5()`);
    check("Máy chủ có migration 005", v5);
    if (!v5) throw new Error("Chưa chạy supabase/005_customer.sql");
    // 1. đăng ký đầy đủ
    await T.ev(`location.hash='#/dangky'`); await sleep(600); await T.ev(H);
    check("Form đăng ký có họ tên, email, SĐT, tên đăng nhập, mật khẩu", await T.ev(`!!(document.querySelector('#li-name')&&document.querySelector('#li-email')&&document.querySelector('#li-phone')&&document.querySelector('#li-user')&&document.querySelector('#li-pass'))`));
    await T.shot("cust_01_dangky");
    await T.ev(`$v('li-name','Khách Kiểm Thử');$v('li-email','sai-dinh-dang');$v('li-phone','${phone}');$v('li-user','${user}');$v('li-pass','matkhau1');document.querySelector('[data-form]').requestSubmit()`); await sleep(1200);
    check("Email sai định dạng → báo lỗi, không tạo", (await T.ev(`$t('main')`)).includes("Email không đúng") && !(await T.ev(`!!Auth.user`)));
    await T.ev(`$v('li-email','${email}');document.querySelector('[data-form]').requestSubmit()`);
    await T.waitFor(`!!Auth.user && location.hash==='#/lich'`, 15000); await sleep(800); await T.ev(H);
    check("Tạo tài khoản → vào Lịch chiếu, hồ sơ có email + SĐT từ máy chủ", (await T.ev(`Auth.user.email`)) === email && (await T.ev(`Auth.user.phone`)) === phone && (await T.ev(`Auth.user.points`)) === 120);
    check("Mời xác thực VNeID ngay sau đăng ký (có nút Để sau)", await T.ev(`/Xác thực VNeID ngay/.test($t('[data-sheet]')) && !!document.querySelector('[data-m="later"]')`));
    await T.shot("cust_02_moi_vneid");
    // 2. liên kết VNeID bằng ảnh → lưu máy chủ
    if (FACES) {
      await T.ev(`$c('[data-m="now"]')`); await sleep(600);
      await T.ev(`$sel('vn-id','cuc')`); await T.ev(`$c('[data-m="methods"]')`); await T.waitFor(`!!document.querySelector('#fk-file')`, 10000);
      await T.setFile("#fk-file", join(FACES, "sheldon1.png")); await sheetDone(T);
      await T.ev(`document.querySelector('[data-scrim]')?.click()`); await sleep(1200); await T.ev(H);
      check("Liên kết VNeID → phiên máy chủ có citizen_key, tên theo hồ sơ", (await T.ev(`Auth.user.citizenKey`)) === "cuc" && (await T.ev(`Auth.user.name`)) === "Lê Thị Cúc" && (await T.ev(`S.user.linked`)));
      await T.ev(`location.hash='#/taikhoan'`); await sleep(800);
      check("Tài khoản: Đã xác thực VNeID · email · SĐT · lịch sử · voucher", await T.ev(`/Đã xác thực VNeID/.test($t('main')) && /${email}/.test($t('main')) && /Lịch sử đặt vé/.test($t('main')) && /Voucher/.test($t('main'))`));
      await T.shot("cust_03_taikhoan");
    } else { await T.ev(`$c('[data-m="later"]')`); }
    // 3. đăng nhập bằng email / SĐT / FaceID / VNeID
    await logout(T); await toLogin(T);
    check("Màn đăng nhập có 3 cách: Mật khẩu · FaceID · VNeID", (await T.ev(`document.querySelectorAll('[data-act="login-mode"]').length`)) === 3);
    await T.shot("cust_04_dangnhap");
    await T.ev(`$v('li-user','${email.toUpperCase()}');$v('li-pass','matkhau1');document.querySelector('[data-form]').requestSubmit()`); await T.waitFor(`!!Auth.user`, 15000); await sleep(600); await T.ev(H);
    check("Đăng nhập bằng email (không phân biệt hoa thường)", (await T.ev(`Auth.user.username`)) === user);
    await logout(T); await toLogin(T);
    await T.ev(`$v('li-user','${phone.slice(0, 4) + " " + phone.slice(4)}');$v('li-pass','matkhau1');document.querySelector('[data-form]').requestSubmit()`); await T.waitFor(`!!Auth.user`, 15000); await sleep(600); await T.ev(H);
    check("Đăng nhập bằng SĐT (có khoảng trắng)", (await T.ev(`Auth.user.username`)) === user);
    await logout(T); await toLogin(T);
    if (FACES) {
      await T.ev(`$c('[data-act="login-mode"][data-v="face"]')`); await sleep(400); await T.ev(H);
      await T.ev(`$v('li-user','${user}');document.querySelector('[data-form="login-face"]').requestSubmit()`); await sleep(1500);
      await T.waitFor(`!!document.querySelector('#lf-file')`, 10000);
      await T.setFile("#lf-file", join(FACES, "raj1.png")); await sheetDone(T);
      check("Đăng nhập FaceID bằng mặt người khác → từ chối, không có phiên", (await T.ev(`$t('[data-sheet]')`)).includes("không khớp") && !(await T.ev(`!!Auth.user`)));
      await T.shot("cust_05_face_sai");
      await T.setFile("#lf-file", join(FACES, "sheldon2.png"));
      await T.waitFor(`!!Auth.user`, 60000); await sleep(800); await T.ev(H);
      check("Đăng nhập FaceID đúng người → vào thẳng, không cần mật khẩu", (await T.ev(`Auth.user && Auth.user.username`)) === user && (await T.ev(`location.hash`)) === "#/lich");
      const nLogin = await T.ev(`(S.verifs||[]).filter(v=>v.kind==='login').length`);
      check("Mỗi lần đăng nhập FaceID (kể cả thất bại) có bản ghi", nLogin >= 2, nLogin + " bản ghi");
      await logout(T); await toLogin(T);
      await T.ev(`$c('[data-act="login-mode"][data-v="vneid"]')`); await sleep(400); await T.ev(H);
      await T.ev(`$sel('li-vneid','cuc')`); await T.ev(`$c('[data-act="login-vneid"]')`); await T.waitFor(`!!Auth.user`, 15000); await sleep(600); await T.ev(H);
      check("Đăng nhập qua VNeID → đúng tài khoản đã liên kết hồ sơ", (await T.ev(`Auth.user.username`)) === user);
      await logout(T); await toLogin(T);
      await T.ev(`$c('[data-act="login-mode"][data-v="vneid"]')`); await sleep(400); await T.ev(H);
      await T.ev(`$sel('li-vneid','binh')`); await T.ev(`$c('[data-act="login-vneid"]')`); await sleep(1500);
      check("VNeID của hồ sơ chưa gắn tài khoản → báo rõ", (await T.ev(`$t('main')`)).includes("chưa gắn với tài khoản nào"));
      await T.ev(`$c('[data-act="login-mode"][data-v="pass"]')`); await sleep(300); await T.ev(H);
    }
    await T.ev(`$v('li-user','${user}');$v('li-pass','matkhau1');document.querySelector('[data-form]').requestSubmit()`); await T.waitFor(`!!Auth.user`, 15000); await sleep(800); await T.ev(H);
    // 4. thanh toán với mã khuyến mãi + điểm
    await T.waitFor(`document.querySelectorAll('[data-act="pick-show"]').length > 0`, 15000);
    const nDays = await T.ev(`document.querySelectorAll('[data-act="lich-day"]').length`); let ok = false;
    for (let d = 0; d < Math.max(1, nDays) && !ok; d++) { if (d) { await T.ev(`$c('[data-act="lich-day"]',${d})`); await sleep(500); }
      ok = await T.ev(`(()=>{const b=[...document.querySelectorAll('[data-act="pick-show"]:not([disabled])')].find(b=>S.shows.find(s=>s.id===b.dataset.show&&s.filmId==='f1'&&new Date(s.start)>Date.now()+3600e3));if(!b)return false;b.click();return true})()`); }
    await sleep(900); await T.ev(H);
    for (let k = 0; k < 2; k++) { await T.ev(`(()=>{const s=[...document.querySelectorAll('[data-act="toggle-seat"]:not([disabled])')].filter(b=>b.getAttribute('aria-pressed')==='false');s[Math.floor(s.length/2)].click();return 1})()`); await sleep(1300); }
    await T.ev(`$c('[data-act="to-checkout"]')`); await sleep(900); await T.ev(H);
    const gross = await T.ev(`S.draft.gross`);
    await T.ev(`$v('voucher','chaonhom05');$c('[data-act="voucher-apply"]')`); await sleep(1500);
    check("Mã CHAONHOM05 → giảm 10%", (await T.ev(`S.draft.discount`)) === Math.round(gross * 0.1), `${gross} → −${await T.ev(`S.draft.discount`)}`);
    await T.ev(`$c('[data-act="points-use"][data-v="max"]')`); await sleep(500);
    const used = await T.ev(`S.draft.points`), total = await T.ev(`S.draft.total`);
    check("Dùng điểm thưởng: trừ 1.000 đ/điểm, tổng không âm", used > 0 && total === Math.max(0, gross - Math.round(gross * 0.1) - used * 1000), `dùng ${used} điểm, trả ${total}`);
    await T.shot("cust_06_thanhtoan");
    await T.ev(`$c('[data-act="pay-ok"]')`); await T.waitFor(`location.hash==='#/ve'`, 15000); await sleep(1000);
    const pts = await T.ev(`Auth.user.points`);
    check("Thanh toán: máy chủ trừ điểm, cộng 5% điểm, điểm mới về phiên", pts === 120 - used + Math.floor(total * 0.05 / 1000), `điểm còn ${pts}`);
    const tk = await T.ev(`myTickets().filter(t=>t.status==='valid').map(t=>t.code).pop()`);
    await T.ev(`location.hash='#/taikhoan'`); await sleep(1200);
    check("Voucher đã dùng hiện mờ trong Tài khoản; lịch sử có đơn vừa mua", await T.ev(`/CHAONHOM05/.test($t('main')) && /Lịch sử đặt vé/.test($t('main')) && !!document.querySelector('[data-act="hist-open"]')`));
    // 4a. mua thêm vé phim T16 cho bạn đi cùng có tài khoản đã xác thực (giaovien ↔ hồ sơ gv) và một bạn chưa xác thực
    const gvTok = await T.ev(`Remote.rpc('login',{p_user:'giaovien',p_pass:'giaovien123'}).then(r=>r.token)`);
    await T.ev(`(async()=>{const d=Array.from({length:128},(_,i)=>Math.cos(i)/9);try{await Remote.rpc('face_check',{p_key:'gv',p_descriptor:d,p_device:'e2e',p_account:'e2e',p_method:'ảnh',p_liveness:false})}catch(e){};try{await Remote.rpc('link_vneid',{p_token:'${gvTok}',p_key:'gv',p_method:'e2e'})}catch(e){};return 1})()`);
    await T.ev(`location.hash='#/lich'`); await sleep(800); await T.ev(H);
    const okT16 = await T.ev(`(()=>{const s=S.shows.filter(s=>s.filmId==='f4'&&new Date(s.start)>Date.now()+3600e3&&freeSeats(s)>4).sort((a,b)=>new Date(a.start)-new Date(b.start))[0];if(!s)return false;A["pick-show"]({dataset:{show:s.id}});return true})()`);
    check("Chọn suất phim T16 để mua cho bạn", okT16); await sleep(1200);
    for (let k = 0; k < 2; k++) { await T.ev(`(()=>{const s=[...document.querySelectorAll('[data-act="toggle-seat"]:not([disabled])')].filter(b=>b.getAttribute('aria-pressed')==='false');s[Math.floor(s.length/3)].click();return 1})()`); await sleep(1300); }
    await T.ev(`A["to-checkout"]()`); await sleep(900); await T.ev(H);
    check("Chọn người xem có mục 'Bạn đi cùng có tài khoản CineVin…'", await T.ev(`!!document.querySelector('[data-select="viewer-0"] [data-sel-opt="friend"]')`));
    await T.ev(`$sel('viewer-0','friend')`); await sleep(400); await T.ev(H);
    check("Chưa nhập bạn → nút thanh toán khoá", await T.ev(`document.querySelector('[data-act="pay-ok"]').disabled`));
    await T.ev(`$v('friend-0','nhanvien');$c('[data-act="friend-check"][data-i="0"]')`); await sleep(1200);
    check("Nhập tài khoản nhân viên → không tìm thấy (không lộ nhân sự)", !(await T.ev(`!!S.draft.assign[0].viewer.user`)));
    await T.ev(`$v('friend-0','GIAOVIEN');$c('[data-act="friend-check"][data-i="0"]')`); await sleep(1500);
    check("Bạn đã xác thực VNeID → hiện tên, tuổi, 'vé vào thẳng'", await T.ev(`S.draft.assign[0].viewer.user==='giaovien' && S.draft.assign[0].viewer.verified===true && /vào thẳng/.test($t('main'))`), await T.ev(`JSON.stringify(S.draft.assign[0].viewer)`));
    await T.ev(`$sel('viewer-1','friend')`); await sleep(400); await T.ev(`$v('friend-1','${email}');$c('[data-act="friend-check"][data-i="1"]')`); await sleep(1500);
    check("Bạn chưa xác thực (tra theo email) → cảnh báo kiểm giấy tờ ở cửa", await T.ev(`S.draft.assign[1].viewer.user==='${user}' && S.draft.assign[1].viewer.verified===false`));
    await T.shot("cust_10_ban_di_cung");
    await T.ev(`$c('[data-act="pay-ok"]')`); await T.waitFor(`location.hash==='#/ve'`, 15000); await sleep(1200);
    const fTk = await T.ev(`myTickets().filter(t=>t.viewerUser==='giaovien').map(t=>({code:t.code,verified:t.verified,needDoc:t.needDoc,name:t.viewerName}))`);
    check("Vé của bạn đã xác thực: verified, không cần kiểm tuổi, tên theo hồ sơ VNeID", fTk.length === 1 && fTk[0].verified && !fTk[0].needDoc && fTk[0].name === "Phạm Thu Hà", JSON.stringify(fTk));
    check("Trang Vé ghi 'Vé của bạn đi cùng … đã xác thực, vào thẳng'", await T.ev(`S.view.tk='${fTk[0] && fTk[0].code}'; render(); /Vé của bạn đi cùng/.test($t('main')) && /vào thẳng/.test($t('main'))`));
    await T.shot("cust_11_ve_cua_ban");
    await logout(T); await toLogin(T);
    await T.ev(`$v('li-user','giaovien');$v('li-pass','giaovien123');document.querySelector('[data-form]').requestSubmit()`); await T.waitFor(`!!Auth.user`, 15000); await sleep(800); await T.ev(H);
    await T.ev(`location.hash='#/ve'`); await sleep(1500);
    check("Bạn đăng nhập → thấy vé trong Vé của tôi, ghi 'do @… mua cho bạn', có QR", await T.ev(`myTickets().some(t=>t.code==='${fTk[0] && fTk[0].code}') && (S.view.tk='${fTk[0] && fTk[0].code}', render(), /mua cho bạn/.test($t('main')) && !!document.querySelector('#qr-box'))`));
    await T.shot("cust_12_ve_ban_nhan");
    await logout(T); await toLogin(T);
    await T.ev(`$v('li-user','${user}');$v('li-pass','matkhau1');document.querySelector('[data-form]').requestSubmit()`); await T.waitFor(`!!Auth.user`, 15000); await sleep(800); await T.ev(H);
    // 4b. nhân viên quét một vé của đơn 2 vé → bảng cả đơn → cho vào 2 người một lần
    const tkAll = await T.ev(`myTickets().filter(t=>t.status==='valid'&&t.showId===S.tickets.find(x=>x.code==='${tk}').showId).map(t=>t.code)`);
    await logout(T); await toLogin(T);
    await T.ev(`$v('li-user','nhanvien');$v('li-pass','nhanvien123');document.querySelector('[data-form]').requestSubmit()`); await T.waitFor(`location.hash==='#/soat'`, 15000); await sleep(800); await T.ev(H);
    await T.ev(`$c('[data-act="gate-method"][data-v="ma"]')`); await sleep(400); await T.ev(H);
    const qtok = await T.ev(`Remote.rpc('login',{p_user:'quanly',p_pass:'quanly123'}).then(r=>r.token)`);
    const payload = await T.ev(`Remote.rpc('ticket_qr',{p_token:'${qtok}',p_code:'${tk}'}).then(r=>r.payload)`);
    await T.ev(`gateProcess(${JSON.stringify(payload)}, 'kiểm thử')`); await sleep(1800);
    if (await T.ev(`S.view.gate.result && S.view.gate.result.kind==='early'`)) { await T.ev(`$c('[data-act="gate-early"]')`); await sleep(1800); }
    check("Quét 1 QR → bảng cả đơn, đủ số vé, tick sẵn", (await T.ev(`S.view.gate.result && S.view.gate.result.kind`)) === "order" && (await T.ev(`document.querySelectorAll('#gate-result input[data-order-code]:checked').length`)) === tkAll.length, `${tkAll.length} vé`);
    await T.shot("cust_09_don_nhieu_ve");
    await T.ev(`$c('[data-act="gate-admit-order"]')`); await sleep(2200);
    check("Cho vào cả nhóm một lần → mọi vé 'Đã vào'", (await T.ev(`S.view.gate.result.order.filter(x=>x.status==='used').length`)) === tkAll.length);
    await T.ev(`gateProcess(${JSON.stringify(await T.ev(`Remote.rpc('ticket_qr',{p_token:'${qtok}',p_code:'${tkAll[0]}'}).then(r=>r.payload)`))}, 'kiểm thử')`); await sleep(1800);
    check("Quét lại đơn đã vào → không cho vào thêm", await T.ev(`!document.querySelector('[data-act="gate-admit-order"]') || document.querySelector('[data-act="gate-admit-order"]').disabled`));
    await logout(T); await toLogin(T);
    await T.ev(`$v('li-user','${user}');$v('li-pass','matkhau1');document.querySelector('[data-form]').requestSubmit()`); await T.waitFor(`!!Auth.user`, 15000); await sleep(800); await T.ev(H);
    // 5. hoàn vé → thẻ quà tặng của chính chủ (vé đã vào không hoàn được → mua thêm 1 vé mới để thử hoàn)
    await T.ev(`location.hash='#/lich'`); await sleep(800); await T.ev(H);
    await T.ev(`(()=>{const s=S.shows.filter(s=>film(s.filmId).rating==='P'&&new Date(s.start)>Date.now()+3600e3&&freeSeats(s)>2).sort((a,b)=>new Date(a.start)-new Date(b.start))[0];A["pick-show"]({dataset:{show:s.id}});return 1})()`); await sleep(1200);
    await T.ev(`(()=>{const s=[...document.querySelectorAll('[data-act="toggle-seat"]:not([disabled])')];s[1].click();return 1})()`); await sleep(1300);
    await T.ev(`A["to-checkout"]()`); await sleep(900); await T.ev(`document.querySelector('[data-act="pay-ok"]').click()`); await T.waitFor(`location.hash==='#/ve'`, 15000); await sleep(1000);
    const tk2 = await T.ev(`myTickets().filter(t=>t.status==='valid').map(t=>t.code).pop()`);
    await T.ev(`location.hash='#/ve'`); await sleep(800); await T.ev(H);
    await T.ev(`window.confirm=()=>true`); await T.ev(`S.view.tk='${tk2}'; render()`); await sleep(300);
    await T.ev(`$c('[data-act="refund"][data-code="${tk2}"]')`); await sleep(2000);
    await T.ev(`location.hash='#/taikhoan'`); await T.waitFor(`/GC[A-Z0-9]{6}/.test($t('main'))`, 10000);
    check("Hoàn vé → thẻ quà tặng GC… hiện ở Tài khoản", /GC[A-Z0-9]{6}/.test(await T.ev(`$t('main')`)));
    await T.shot("cust_07_voucher");
    // 6. nhân viên: khách quên vé → FaceID → tìm vé → cho vào
    if (FACES) {
      await logout(T); await toLogin(T);
      await T.ev(`$v('li-user','nhanvien');$v('li-pass','nhanvien123');document.querySelector('[data-form]').requestSubmit()`); await T.waitFor(`location.hash==='#/soat'`, 15000); await sleep(800); await T.ev(H);
      check("Soát vé có nút 'Khách quên vé'", await T.ev(`!!document.querySelector('[data-act="gate-noticket"]')`));
      await T.ev(`$c('[data-act="gate-noticket"]')`); await sleep(500);
      await T.ev(`$sel('vn-id','cuc')`); await T.ev(`$c('[data-m="methods"]')`); await T.waitFor(`!!document.querySelector('#fk-file')`, 10000);
      await T.setFile("#fk-file", join(FACES, "sheldon2.png")); await sheetDone(T);
      await T.ev(`document.querySelector('[data-m="close"]')?.click()`);
      const found = await T.waitFor(`/Vé của Lê Thị Cúc/.test($t('[data-sheet]'))`, 15000);
      const n = await T.ev(`document.querySelectorAll('[data-sheet] [data-m="pick"]').length`);
      check("FaceID khách → tra vé hôm nay theo hồ sơ VNeID (đã vào hết thì báo không còn vé)", found || await T.ev(`/Không có vé hôm nay/.test($t('[data-sheet]'))`), `${n} vé`);
      if (!n) { await T.ev(`$c('[data-sheet] [data-m="close"]')`); await sleep(300); }
      await T.shot("cust_08_quen_ve");
      if (n) { await T.ev(`$c('[data-sheet] [data-m="pick"]')`); await sleep(2000);
        const res = await T.ev(`$t('#gate-result')`);
        check("Chọn vé → đi qua luật cửa (giờ vào / cho vào)", /Hợp lệ|Chưa đến giờ|Đơn/.test(res), res.split("\n")[0]); }
    }
  } catch (e) { console.log("ABORT:", e.message); await T.shot("cust_abort").catch(() => {}); }
  console.log(`\n${results.filter(r => r.startsWith("PASS")).length} PASS, ${results.filter(r => r.startsWith("FAIL")).length} FAIL`);
  console.log("errors:\n" + [...new Set(errors)].slice(0, 20).join("\n"));
  edge.kill(); process.exit(0);
})();
