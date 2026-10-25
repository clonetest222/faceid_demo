// Kiểm thử đầu-cuối: MUA VÉ KHÔNG CẦN TÀI KHOẢN (migration 021): chọn ghế trước → email + mã xác nhận → thanh toán → mail vé → tra cứu → nâng cấp.
// Chạy: node tools/e2e-guest.mjs [URL=http://localhost:8767/] [thư mục ảnh=./e2e-shots]
// Kịch bản: khách vãng lai bấm suất → vào thẳng sơ đồ ghế, giữ 2 ghế → thanh toán: email dùng một lần bị chặn, email sai định dạng bị chặn,
// email hợp lệ → nhận mã (chưa có dịch vụ mail → mã demo hiện trên trang), sai mã → còn n lần, đúng mã → phiên khách → Thanh toán →
// Vé của tôi: QR + "Vé đã gửi về email" + xem mail (ghế, mã vé, link tra cứu) → thoát → Tra cứu vé (sai email bị từ chối; đúng → QR)
// → tạo tài khoản bằng đúng email → vé chuyển sang, 120 điểm → email đã có tài khoản thì không mua vãng lai được.
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const EDGE = process.env.EDGE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const BASE = process.argv[2] || "http://localhost:8767/";
const OUT = resolve(process.argv[3] || "e2e-shots"); mkdirSync(OUT, { recursive: true });
const PORT = 9412, sleep = ms => new Promise(r => setTimeout(r, ms));
const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "cinevin-guest-"))}`, "--window-size=1280,1000", "about:blank"], { stdio: "ignore" });
const results = [], errors = [];
const check = (n, c, info = "") => { const l = `${c ? "PASS" : "FAIL"}  ${n}${info ? "  — " + info : ""}`; results.push(l); console.log(l); };
class Tab {
  constructor(ws) { this.id = 0; this.pending = new Map(); this.ws = new WebSocket(ws); }
  async open() { await new Promise(r => this.ws.onopen = r); this.ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && this.pending.has(d.id)) { this.pending.get(d.id)(d); this.pending.delete(d.id); } if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); }; await this.send("Runtime.enable"); await this.send("Page.enable"); }
  send(method, params = {}) { return new Promise(res => { const i = ++this.id; this.pending.set(i, res); this.ws.send(JSON.stringify({ id: i, method, params })); }); }
  async ev(expr) { const r = await this.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error("eval: " + (r.result.exceptionDetails.exception?.description || JSON.stringify(r.result.exceptionDetails))); return r.result?.result?.value; }
  async shot(name) { const r = await this.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }); writeFileSync(join(OUT, name + ".png"), Buffer.from(r.result.data, "base64")); }
  async waitFor(expr, ms = 20000) { const t = Date.now(); while (Date.now() - t < ms) { if (await this.ev(expr).catch(() => false)) return true; await sleep(300); } return false; }
}
const H = `window.$c=(s,i=0)=>{const e=document.querySelectorAll(s)[i];if(!e)throw new Error("missing "+s);e.click();return true};window.$t=s=>(document.querySelector(s)?.innerText||"");
window.$v=(id,v)=>{const e=document.querySelector('#'+id);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));return true};
window.$sub=f=>document.querySelector('[data-form="'+f+'"]').requestSubmit();`;

(async () => {
  for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/json/version`); break; } catch (e) { await sleep(250); } }
  const t0 = await (await fetch(`http://localhost:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
  const T = new Tab(t0.webSocketDebuggerUrl); await T.open();
  await T.send("Page.navigate", { url: BASE }); await sleep(2500); await T.ev("localStorage.clear(); sessionStorage.setItem('cinevin-promo','1'); location.hash='#/lich'; location.reload()"); await sleep(3500); await T.ev(H);
  const uid = Date.now().toString(36).slice(-5), email = `vanglai${uid}@example.com`, name = "Khách Vãng Lai";
  try {
    await T.waitFor(`Remote.v4 && S.shows.length > 0`, 20000);
    const v21 = await T.ev(`Remote.hasV21()`);
    check("Máy chủ có migration 021 (mua không tài khoản, OTP email, mail vé)", v21);
    if (!v21) throw new Error("Chưa chạy supabase/021_guest.sql trên máy chủ");
    // 1. khách vãng lai chọn suất phim P còn nhiều ghế → vào thẳng sơ đồ ghế
    const picked = await T.ev(`(()=>{const s=S.shows.filter(s=>cinemaOf(s).id==='086'&&film(s.filmId).rating==='P'&&new Date(s.start)>Date.now()+3600e3&&freeSeats(s)>4).sort((a,b)=>new Date(a.start)-new Date(b.start))[0];if(!s)return null;A["pick-show"]({dataset:{show:s.id}});return s.id})()`);
    await sleep(900); await T.ev(H);
    check("Chưa đăng nhập bấm suất → vào thẳng sơ đồ ghế (không bắt đăng nhập)", !!picked && await T.ev(`location.hash==='#/ghe' && !Auth.user && S.draft && S.draft.showId==='${picked}' && document.querySelectorAll('[data-act="toggle-seat"]').length>10`));
    for (let k = 0; k < 2; k++) { await T.ev(`(()=>{const s=[...document.querySelectorAll('[data-act="toggle-seat"]:not([disabled])')].filter(b=>b.getAttribute('aria-pressed')==='false');s[Math.floor(s.length/2)].click();return 1})()`); await sleep(1300); }
    check("Giữ được 2 ghế ở máy chủ khi chưa đăng nhập", (await T.ev(`S.draft.seats.length`)) === 2 && await T.ev(`!!S.draft.until`), await T.ev(`S.draft.seats.join(',')`));
    await T.shot("guest_01_ghe_khach");
    await T.ev(`$c('[data-act="to-checkout"]')`); await sleep(900); await T.ev(H);
    // 2. trang thanh toán: khối email thay cho nút Thanh toán
    check("Trang thanh toán: có form email, KHÔNG có nút Thanh toán, không có điểm/voucher", await T.ev(`location.hash==='#/thanhtoan' && !!document.querySelector('[data-form="guest-send"]') && !document.querySelector('[data-act="pay-ok"]') && !document.querySelector('#voucher')`));
    await T.shot("guest_02_thanh_toan_email");
    await T.ev(`$v('g-email','ai@10minutemail.com');$v('g-name','${name}');$sub('guest-send')`); await sleep(2500); await T.ev(H);
    check("Email dùng một lần (10minutemail.com) → bị từ chối", /dùng một lần/.test(await T.ev(`$t('main')`)) && await T.ev(`!document.querySelector('[data-form="guest-verify"]')`));
    await T.ev(`$v('g-email','khong-phai-email');$sub('guest-send')`); await sleep(800); await T.ev(H);
    check("Email sai định dạng → báo lỗi tại chỗ", /Email không đúng/.test(await T.ev(`$t('main')`)));
    await T.ev(`$v('g-email','${email}');$sub('guest-send')`);
    check("Email hợp lệ → bước nhập mã 6 số (chưa có dịch vụ mail → mã demo hiện trên trang)", await T.waitFor(`!!document.querySelector('[data-form="guest-verify"]')`, 15000) && await T.ev(`!Auth.user && /Đã gửi mã 6 số tới ${email}/.test($t('main'))`));
    await T.ev(H); const demo = await T.ev(`GUEST.demoCode`), mailed = await T.ev(`GUEST.mailed`);
    check("Chế độ demo → mã hiện trên trang; chế độ auth (Supabase gửi) → không lộ mã", mailed ? demo === null : /^\d{6}$/.test(demo || ""), `mode=${await T.ev("GUEST.mode")} mailed=${mailed}`);
    await T.shot("guest_03_nhap_ma");
    await T.ev(`$v('g-code','000000');$sub('guest-verify')`); await sleep(2000); await T.ev(H);
    check("Sai mã → 'Mã không đúng – còn 4 lần thử', vẫn chưa có phiên", /còn 4 lần/.test(await T.ev(`$t('main')`)) && !(await T.ev(`!!Auth.user`)));
    let code = demo;
    if (!code) { throw new Error("otp_mode=auth: mã nằm trong hộp thư thật – kiểm tay, hoặc tạm `update app_config set v='demo' where k='otp_mode'` để chạy tự động"); }
    await T.ev(`$v('g-code','${code.slice(0, 3)} ${code.slice(3)}');$sub('guest-verify')`);
    check("Đúng mã → phiên khách (guest, 0 điểm, email đúng), ghế vẫn giữ, nút Thanh toán hiện ra", await T.waitFor(`Auth.user && Auth.user.guest && !!document.querySelector('[data-act="pay-ok"]')`, 15000) && await T.ev(`/^g_[0-9a-f]{12}$/.test(Auth.user.username) && Auth.user.email==='${email}' && Auth.user.points===0 && S.draft.seats.length===2`), await T.ev(`JSON.stringify({u:Auth.user&&Auth.user.username})`));
    check("Thanh điều hướng của khách vãng lai: không có Vé đoàn, có Tài khoản; trang ghi vé gửi về email", await T.ev(`!document.querySelector('nav a[href="#/doan"]') && !!document.querySelector('nav a[href="#/taikhoan"]') && $t('main').includes('${email}')`));
    await T.shot("guest_04_san_sang_thanh_toan");
    const seats = await T.ev(`S.draft.seats.slice()`);
    await T.ev(`$c('[data-act="pay-ok"]')`);
    check("Thanh toán → Vé của tôi, toast báo đang gửi vé về email", await T.waitFor(`location.hash==='#/ve' && myTickets().length>=2`, 20000) && await T.waitFor(`/gửi vé về ${email}|Chưa deploy Edge Function|Gửi mail lỗi/.test(document.body.innerText)`, 8000));
    await sleep(1200); await T.ev(H);
    const order = await T.ev(`myTickets()[0].orderId`), tcode = await T.ev(`myTickets()[0].code`);
    check("Vé có dòng 'Vé đã gửi về email' + Xem email, banner khách vãng lai có nút Tạo tài khoản", await T.ev(`!!document.querySelector('[data-act="mail-view"]') && !!document.querySelector('[data-act="guest-upgrade"]') && /Vé đã gửi về/.test($t('main'))`));
    await T.shot("guest_05_ve_cua_toi");
    // 3. xem nội dung mail vé
    await T.ev(`$c('[data-act="mail-view"]')`); await T.waitFor(`!!document.querySelector('[data-sheet] iframe')`, 10000); await sleep(500);
    const mail = await T.ev(`document.querySelector('[data-sheet] iframe')?.getAttribute('srcdoc')||''`);
    check("Mail vé: tới đúng email, có cả 2 ghế, mã vé, mã đơn, link tra cứu #/tracuu?ma=<đơn>", (await T.ev(`$t('[data-sheet]')`)).includes(email) && seats.every(s => mail.includes(`>${s}<`)) && mail.includes(tcode) && mail.includes(`#/tracuu?ma=${order}`), `đơn ${order}`);
    await T.shot("guest_06_mail");
    await T.ev(`$c('[data-sheet] [data-m="close"]')`); await sleep(400);
    // 4. thoát → tra cứu
    await T.ev(`A.logout()`); await sleep(800); await T.ev(H);
    check("Thoát phiên khách → trang chủ, không còn phiên", await T.ev(`!Auth.user && location.hash==='#/home'`));
    await T.ev(`location.hash='#/tracuu?ma=${order}'`); await sleep(900); await T.ev(H);
    check("Trang Tra cứu vé công khai, mã đơn điền sẵn từ link trong mail", (await T.ev(`document.querySelector('#tc-code')?.value`)) === order);
    await T.ev(`$v('tc-email','khac@example.com');$sub('tracuu')`); await sleep(2000); await T.ev(H);
    check("Email không khớp → 'Không tìm thấy vé', không cấp phiên", /Không tìm thấy vé/.test(await T.ev(`$t('main')`)) && !(await T.ev(`!!Auth.user`)));
    await T.ev(`$v('tc-code','${tcode.toLowerCase()}');$v('tc-email','${email.toUpperCase()}');$sub('tracuu')`);
    check("Mã vé (chữ thường) + email (chữ hoa) đúng → phiên khách mới, mở đúng vé", await T.waitFor(`Auth.user && Auth.user.guest && location.hash==='#/ve' && S.view.tk==='${tcode}'`, 15000) && await T.waitFor(`/Suất sắp tới|Vé đang xem/.test(document.body.innerText)`, 8000));
    await sleep(800); await T.shot("guest_07_tra_cuu");
    // 5. nâng cấp thành tài khoản thật
    await T.ev(H); await T.ev(`$c('[data-act="guest-upgrade"]')`); await sleep(900); await T.ev(H);
    check("Tạo tài khoản: trang đăng ký điền sẵn email + tên của khách", await T.ev(`location.hash==='#/dangky' && document.querySelector('#li-email').value==='${email}' && document.querySelector('#li-name').value.length>1`));
    await T.ev(`$v('li-user','vl${uid}');$v('li-pass','matkhau1');document.querySelector('[data-form="register"]').requestSubmit()`);
    check("Đăng ký xong → tài khoản thật (không guest), 120 điểm, email giữ nguyên", await T.waitFor(`Auth.user && !Auth.user.guest && Auth.user.username==='vl${uid}'`, 15000) && await T.ev(`Auth.user.points===120 && Auth.user.email==='${email}'`));
    await T.ev(`document.querySelector('[data-m="later"]')?.click(); location.hash='#/ve'`); await T.waitFor(`location.hash==='#/ve' && myTickets().length>=2`, 15000); await sleep(800); await T.ev(H);
    check("Vé mua lúc vãng lai đã thuộc tài khoản mới (2 vé cùng đơn)", (await T.ev(`myTickets().filter(t=>t.orderId==='${order}'&&t.ownerUser==='vl${uid}').length`)) === 2);
    check("Tài khoản thật vẫn có 'Xem email', không còn banner khách vãng lai", await T.ev(`!!document.querySelector('[data-act="mail-view"]') && !document.querySelector('[data-act="guest-upgrade"]')`));
    await T.shot("guest_08_sau_nang_cap");
    // 6. email đã có tài khoản thật → không mua vãng lai được
    await T.ev(`A.logout()`); await sleep(800); await T.ev(`location.hash='#/lich'`); await sleep(900); await T.ev(H);
    await T.ev(`A["pick-show"]({dataset:{show:"${picked}"}})`); await sleep(900); await T.ev(H);
    await T.ev(`(()=>{const s=[...document.querySelectorAll('[data-act="toggle-seat"]:not([disabled])')].filter(b=>b.getAttribute('aria-pressed')==='false');s[0].click();return 1})()`); await sleep(1300);
    await T.ev(`$c('[data-act="to-checkout"]')`); await sleep(900); await T.ev(H);
    await T.ev(`$v('g-email','${email}');$v('g-name','Ai Đó');$sub('guest-send')`); await sleep(2500); await T.ev(H);
    check("Email đã có tài khoản → 'đã có tài khoản CineVin – đăng nhập', không gửi mã", /đã có tài khoản/.test(await T.ev(`$t('main')`)) && await T.ev(`!document.querySelector('[data-form="guest-verify"]')`));
    // đăng nhập ngay tại đây → ghế đang giữ vẫn còn, về sơ đồ ghế
    await T.ev(`location.hash='#/dangnhap'`); await sleep(700); await T.ev(H);
    await T.ev(`$v('li-user','${email}');$v('li-pass','matkhau1');document.querySelector('[data-form="login"]').requestSubmit()`);
    check("Đăng nhập giữa chừng → quay lại sơ đồ ghế, ghế đang giữ vẫn còn", await T.waitFor(`Auth.user && location.hash==='#/ghe' && S.draft && S.draft.seats.length===1`, 15000));
    await T.ev(`A['cancel-draft']()`); await sleep(500);
  } catch (e) { check("Kịch bản chạy trọn", false, e.message); }
  const jsErr = errors.filter(e => !/favicon|net::ERR|Failed to fetch|AbortError|ResizeObserver/.test(e));
  check("Không có lỗi JS trong lúc chạy", jsErr.length === 0, jsErr.slice(0, 3).join(" | "));
  console.log(`\n${results.filter(r => r.startsWith("PASS")).length} PASS, ${results.filter(r => r.startsWith("FAIL")).length} FAIL`);
  edge.kill(); process.exit(results.some(r => r.startsWith("FAIL")) ? 1 : 0);
})();
