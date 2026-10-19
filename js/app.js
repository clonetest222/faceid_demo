/* CineVin – điều hướng theo vai trò, đăng nhập, xác thực VNeID + FaceID, hành động và khởi động. */
"use strict";
/* ============================ điều hướng ============================ */
const ROUTES = {
  lich: { roles: ["khach"], view: () => vLich() }, ghe: { roles: ["khach"], view: () => vGhe() }, thanhtoan: { roles: ["khach"], view: () => vThanhToan() },
  ve: { roles: ["khach"], view: () => vVe() }, doan: { roles: ["khach"], view: () => vDoan() }, taikhoan: { roles: ["khach"], view: () => vTaiKhoan() },
  tongquan: { roles: ["quanly"], view: () => vTongQuan() }, suat: { roles: ["quanly"], view: () => vSuat() }, soat: { roles: ["nhanvien", "quanly"], view: () => vSoat() },
  quay: { roles: ["nhanvien", "quanly"], view: () => vQuay() }, kiemthu: { roles: ["quanly"], view: () => vKiemThu() }, quyen: { roles: ["quanly"], view: () => vQuyen() },
  coso: { roles: ["quanly", "kythuat"], view: () => vCoSo() }, phim: { roles: ["quanly"], view: () => vPhim() }, baocao: { roles: ["quanly"], view: () => vBaoCao() },
};
const HOME = { khach: "lich", nhanvien: "soat", kythuat: "coso", quanly: "tongquan" };
let CUR_ROUTE = "", PHONE_MODE = false;
const routeName = () => (location.hash.match(/^#\/([a-z]+)/) || [])[1] || "";
function go(r) { if (routeName() === r) { render(); window.scrollTo({ top: 0 }); } else location.hash = "#/" + r; }
window.addEventListener("hashchange", () => { document.body.removeAttribute("data-menu-open"); render(); window.scrollTo({ top: 0 }); });

/* Vẽ lại khi dữ liệu realtime đổi; hoãn nếu người dùng đang gõ trong ô nhập */
let rerenderPending = false;
function scheduleRender() {
  if (rerenderPending) return; rerenderPending = true;
  requestAnimationFrame(() => {
    const a = document.activeElement;
    if (a && a.closest && a.closest("#app") && /INPUT|TEXTAREA/.test(a.tagName)) { a.addEventListener("blur", () => { rerenderPending = false; scheduleRender(); }, { once: true }); return; }
    if ($("#app [data-select] [role=listbox]:not([hidden])")) { setTimeout(() => { rerenderPending = false; scheduleRender(); }, 400); return; }
    rerenderPending = false; render();
  });
}
function render() {
  if (PHONE_MODE) return;
  const app = $("#app"), user = Auth.user;
  let r = routeName();
  if (!user) { CUR_ROUTE = r === "dangky" ? "dangky" : "dangnhap"; stopMedia(); app.innerHTML = vLogin(CUR_ROUTE === "dangky"); document.title = "Đăng nhập – CineVin"; return; }
  if (!r || r === "dangnhap" || r === "dangky" || !ROUTES[r]) { history.replaceState(null, "", "#/" + HOME[user.role]); r = HOME[user.role]; }
  bindProfile();
  if (CUR_ROUTE !== r) stopMedia(r);
  CUR_ROUTE = r;
  // giữ nguyên khung camera đang chạy (soát vé, Haar) qua các lần vẽ lại
  const keep = {}; $$("#app [data-keep]").forEach(el => keep[el.id] = el);
  try { app.innerHTML = ROUTES[r].roles.includes(user.role) ? ROUTES[r].view() : v403(); }
  catch (e) { console.error(e); app.innerHTML = `<div class="p-6">${banner("bad", "Lỗi hiển thị", esc(e.message), `<button class="${B.outline}" data-act="reset-local">Đặt lại dữ liệu trên máy</button>`)}</div>`; }
  // gỡ khỏi trang thì trình duyệt tự dừng video → gắn lại khung cũ rồi phát tiếp, camera không bị đen
  for (const id in keep) { const n = $("#" + id); if (n && n.dataset.keep !== undefined) { n.replaceWith(keep[id]); keep[id].querySelectorAll("video").forEach(v => v.play().catch(() => {})); } }
  document.title = ({ lich: "Lịch chiếu", ghe: "Chọn ghế", thanhtoan: "Thanh toán", ve: "Vé của tôi", doan: "Vé đoàn", taikhoan: "Tài khoản", tongquan: "Tổng quan", suat: "Suất chiếu", soat: "Soát vé", quay: "Bán tại quầy", kiemthu: "Kiểm thử", quyen: "Tài khoản & quyền" }[r] || "CineVin") + " – CineVin";
  if (r === "soat") gateCamStart();
}
function stopMedia(next) {
  if (GATE.stop && next !== "soat") { GATE.stop(); GATE.stop = null; }
  if (LAB.haar.stop && next !== "kiemthu") { LAB.haar.stop(); LAB.haar.stop = null; }
  if (LAB.nfc.stop && next !== "kiemthu") { LAB.nfc.stop(); LAB.nfc.on = false; LAB.nfc.stop = null; }
}

/* ============================ đăng nhập / đăng ký ============================ */
let LOGIN = { err: "", field: "", busy: false, show: false };
function vLogin(reg) {
  const demo = Auth.DEMO.map(d => `<button type="button" data-act="demo-login" data-u="${d.username}" class="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-item-hover">${avatar(d.name)}<span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium">${esc(d.note)}</span><span class="block font-mono text-xs text-muted">${d.username} / ${d.pass}</span></span>${ic("arrow-right", "size-4 text-muted")}</button>`).join("");
  const err = LOGIN.err ? `<p class="text-sm text-[var(--error-text)]" role="alert" id="login-err">${esc(LOGIN.err)}</p>` : "";
  const inv = f => LOGIN.field === f ? 'aria-invalid="true"' : "";
  const pass = `<div class="relative"><input id="li-pass" type="${LOGIN.show ? "text" : "password"}" autocomplete="${reg ? "new-password" : "current-password"}" placeholder="${reg ? "Ít nhất 6 ký tự" : "Mật khẩu"}" class="${INPUT} !h-12 pr-12" ${inv("pass")}><button type="button" class="${B.icon} absolute right-1 top-1" data-act="toggle-pass" aria-label="${LOGIN.show ? "Ẩn" : "Hiện"} mật khẩu">${ic(LOGIN.show ? "eye-off" : "eye")}</button></div>`;
  const idField = field("Tài khoản", `<input id="li-user" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="Tên đăng nhập, email hoặc số điện thoại" class="${INPUT} !h-12" ${inv("user")}>`);
  let form;
  if (reg) form = `<form class="grid gap-4" data-form="register" novalidate>
      ${field("Họ và tên", `<input id="li-name" autocomplete="name" placeholder="Nguyễn Văn A" class="${INPUT} !h-12" ${inv("name")}>`)}
      <div class="grid gap-4 sm:grid-cols-2">${field("Email", `<input id="li-email" type="email" autocomplete="email" placeholder="ban@example.com" class="${INPUT} !h-12" ${inv("email")}>`)}${field("Số điện thoại", `<input id="li-phone" type="tel" autocomplete="tel" inputmode="numeric" placeholder="0912 345 678" class="${INPUT} !h-12" ${inv("phone")}>`)}</div>
      ${field("Tên đăng nhập", `<input id="li-user" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="vd: nguyenvana" class="${INPUT} !h-12" ${inv("user")}>`, "Chữ thường không dấu, số, dấu chấm hoặc gạch dưới.")}
      ${field("Mật khẩu", pass)}${err}
      <button type="submit" class="${B.primary} min-h-12" ${LOGIN.busy ? "disabled" : ""}>${LOGIN.busy ? "Đang tạo…" : "Tạo tài khoản"}</button>
      <p class="text-pretty text-center text-xs text-muted">Sau khi tạo, bạn được mời xác thực VNeID + FaceID để mua vé theo độ tuổi và vào thẳng phim T13–T18. Có thể làm sau.</p></form>
      <p class="text-center text-sm text-muted">Đã có tài khoản? <a href="#/dangnhap" class="font-medium text-foreground underline underline-offset-2">Đăng nhập</a></p>`;
  else {
    const m = LOGIN.mode || "pass";
    const tabs = seg([["pass", "Mật khẩu", "key-round"], ["face", "FaceID", "scan-face"], ["vneid", "VNeID", "badge-check"]], m, "login-mode");
    const inner = m === "pass" ? `<form class="grid gap-4" data-form="login" novalidate>${idField}${field("Mật khẩu", pass)}${err}<button type="submit" class="${B.primary} min-h-12" ${LOGIN.busy ? "disabled" : ""}>${LOGIN.busy ? "Đang đăng nhập…" : "Đăng nhập"}</button></form>`
      : m === "face" ? `<form class="grid gap-4" data-form="login-face" novalidate>${idField}${err}<button type="submit" class="${B.primary} min-h-12" ${LOGIN.busy ? "disabled" : ""}>${ic("scan-face")}Quét khuôn mặt để đăng nhập</button>
          <p class="text-pretty text-xs text-muted">Dùng được sau khi tài khoản đã liên kết VNeID. Camera xử lý trên thiết bị, máy chủ chỉ nhận vector 128 số để đối chiếu với ảnh gốc – không nhận ảnh.</p></form>`
      : `<div class="grid gap-4">${banner("info", "Mô phỏng ứng dụng VNeID", "Thực tế: web chuyển sang app VNeID, bạn quét Face ID trong app và đồng ý chia sẻ. Ở bản demo: nhập số căn cước đã khai khi liên kết, rồi quét khuôn mặt của chính bạn.")}
          ${field("Số căn cước", input("li-vneid-id", LOGIN.vneid && /^\d{12}$/.test(LOGIN.vneid) ? LOGIN.vneid : "", 'inputmode="numeric" maxlength="12" placeholder="12 chữ số (hoặc tên đăng nhập / email / SĐT)" autocomplete="off"'))}${err}
          <button type="button" class="${B.primary} min-h-12" data-act="login-vneid" ${LOGIN.busy ? "disabled" : ""}>${ic("badge-check")}Mở VNeID – quét khuôn mặt</button></div>`;
    form = `<div class="flex justify-center">${tabs}</div>${inner}<p class="text-center text-sm text-muted">Chưa có tài khoản? <a href="#/dangky" class="font-medium text-foreground underline underline-offset-2">Tạo tài khoản</a></p>`;
  }
  return `<main class="grid min-h-screen place-items-center p-4">
    <div class="grid w-full max-w-[440px] gap-6">
      <div class="grid justify-items-center gap-3 text-center">${LOGO}<div><h1 class="text-xl font-semibold">${reg ? "Tạo tài khoản" : "Đăng nhập"}</h1><p class="mt-1 text-sm text-muted">Hệ thống bán vé xem phim CineVin</p></div></div>
      <section class="grid gap-4 rounded-2xl border border-border bg-surface p-5 sm:p-6">${form}</section>
      ${reg ? "" : `<section class="rounded-2xl border border-border bg-surface p-2"><p class="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted">Tài khoản demo – bấm để vào</p>${demo}</section>`}
      <p class="text-center text-xs text-muted">${Remote.v5 ? "Mật khẩu bcrypt, FaceID và VNeID kiểm tra trên máy chủ." : Remote.v4 ? "Mật khẩu kiểm tra trên máy chủ (bcrypt). Chạy migration 005 để bật FaceID / VNeID." : Remote.status === "connecting" ? "Đang kết nối máy chủ…" : "Máy chủ chưa bật đăng nhập (migration 004) – đang dùng tài khoản demo trên trình duyệt."}</p>
    </div></main>`;
}
function afterLogin(msg) {
  LOGIN = { err: "", field: "", busy: false, show: false, mode: LOGIN.mode };
  bindProfile(); save(); location.hash = "#/" + HOME[Auth.user.role]; render(); toast(msg || `Xin chào ${Auth.user.name}`);
}
async function doLogin(u, p) {
  LOGIN = { ...LOGIN, busy: true, err: "", field: "" }; render();
  const r = await Auth.login(u, p);
  LOGIN.busy = false;
  if (!r.ok) { LOGIN.err = r.message; LOGIN.field = "user"; render(); const x = $("#li-user"); if (x) x.value = u; return; }
  afterLogin();
}
/** Đăng nhập bằng khuôn mặt: camera (hoặc ảnh khi không có camera) → máy chủ so với ảnh gốc của hồ sơ VNeID đã liên kết */
function doLoginFace(id, mode = "face") {
  if (!id) { LOGIN.err = "Nhập tên đăng nhập, email hoặc số điện thoại trước."; LOGIN.field = "user"; return render(); }
  FaceKit.preload();
  let stop = null;
  const vn = mode === "vneid", ttl = vn ? "VNeID – quét khuôn mặt" : "Đăng nhập FaceID";
  const sh = openSheet("", { label: ttl, onClose: () => { stop && stop(); } });
  const serverMatch = async desc => { const r = vn ? await Auth.loginVneid2(id, desc) : await Auth.loginFace(id, desc); return { ok: r.ok, score: r.score, dist: r.dist, message: r.message, session: r.ok }; };
  const done = r => { stop = null;
    if (r.ok && r.session) { sh.close(); return afterLogin(vn ? `Đăng nhập qua VNeID · khuôn mặt khớp ${r.score}%` : `Đăng nhập bằng khuôn mặt · tương đồng ${r.score}%`); }
    sh.set(`${sheetHead("Không đăng nhập được")}${banner("bad", "", esc(r.message || "Khuôn mặt không khớp."))}${r.dist ? `<p class="text-sm text-muted">Khoảng cách đặc trưng ${String(r.dist).replace(".", ",")} > ngưỡng 0,5.</p>` : ""}<div class="grid gap-2"><button type="button" class="${B.primary}" data-m="cam">Thử lại</button><label class="${B.outline}">Dùng ảnh<input type="file" accept="image/*" capture="user" id="lf-file" class="sr-only"></label><button type="button" class="${B.ghost}" data-m="close">Đăng nhập bằng mật khẩu</button></div>`); };
  const cam = async () => {
    if (!(await FaceKit.hasCamera())) return sh.set(`${sheetHead(ttl, "Máy này không có camera")}<p class="text-sm text-muted">Chọn ảnh khuôn mặt để đối chiếu (không kiểm tra được người thật).</p><label class="${B.primary}">Chọn ảnh<input type="file" accept="image/*" capture="user" id="lf-file" class="sr-only"></label><button type="button" class="${B.ghost}" data-m="close">Huỷ</button>`);
    sh.set(`${sheetHead(ttl, esc(id))}<div id="fk-host" class="grid gap-4"></div><button type="button" class="${B.ghost}" data-m="close">Huỷ</button>`);
    stop = FaceKit.runCamera($("#fk-host", sh.el), { refKey: null, ref: null, serverMatch, onResult: done });
  };
  sh.el.onclick = e => { const m = e.target.closest("[data-m]")?.dataset.m; if (m === "close") { stop && stop(); sh.close(); } if (m === "cam") { stop && stop(); cam(); } };
  sh.el.onchange = e => { if (e.target.id === "lf-file" && e.target.files[0]) { stop && stop(); stop = null; sh.set(`${sheetHead(ttl)}<div id="fk-host" class="grid gap-4"></div>`); FaceKit.runImage($("#fk-host", sh.el), e.target.files[0], { refKey: null, ref: null, serverMatch, onResult: done }); } };
  cam();
}
/** Sau khi đăng ký: mời xác thực VNeID ngay (có thể làm sau) */
function offerVneid() {
  const sh = openSheet(`${sheetHead("Tài khoản đã tạo", `Chào ${esc(Auth.user.name)}`)}
    <div class="rounded-xl border border-border p-4 text-sm"><p class="font-medium">Xác thực VNeID + FaceID một lần để:</p><ul class="mt-2 grid gap-1 pl-5 text-muted" style="list-style:disc"><li>Mua vé theo độ tuổi (trẻ em, U22, người cao tuổi) đúng giá</li><li>Vào thẳng phim T13–T18 không cần giấy tờ ở cửa</li><li>Đăng nhập bằng khuôn mặt hoặc qua VNeID</li></ul></div>
    <div class="grid gap-2"><button type="button" class="${B.primary}" data-m="now">${ic("badge-check")}Xác thực VNeID ngay</button><button type="button" class="${B.outline}" data-m="later">Để sau – xem lịch chiếu</button></div>
    <p class="text-pretty text-xs text-muted">Chưa xác thực vẫn mua được vé; vé phim có giới hạn tuổi sẽ kiểm giấy tờ tại cửa.</p>`, { label: "Xác thực VNeID" });
  sh.el.onclick = e => { const m = e.target.closest("[data-m]")?.dataset.m; if (!m) return; sh.close(); if (m === "now") A["vneid-self"](); };
}

/* ============================ Passkey (Face ID của thiết bị) ============================ */
const PK = { avail: false };
Passkey.available().then(v => { PK.avail = v; scheduleRender(); });
async function setupPasskey() {
  if (!S.user.linked) { toast("Liên kết VNeID trước để gắn Face ID với danh tính đã xác thực"); return false; }
  try {
    const pk = await Passkey.register({ userKey: S.user.key || "user", name: S.user.name });
    S.user.passkey = pk; log("passkey", `Bật ${pk.label} cho tài khoản ${S.user.name}`); save(); toast(`Đã bật ${pk.label}`); return true;
  } catch (e) { toast(e.name === "NotAllowedError" ? "Đã huỷ tạo passkey" : "Không tạo được passkey: " + e.message); return false; }
}
/** Bắt buộc chủ tài khoản xác nhận bằng Face ID. Trả về "ok" | "fallback" | "cancel" */
async function requirePasskey(reason) {
  if (S.user.passkey) {
    const r = await Passkey.verify(S.user.passkey); log("passkey", `${reason}: ${r.ok ? "đạt" : r.message}`, r.ok);
    if (r.ok) { toast(`${S.user.passkey.label}: đúng chủ tài khoản`); return "ok"; }
    toast(r.message, "bad"); return "cancel";
  }
  if (!PK.avail) return "fallback";
  return new Promise(res => {
    let done = false; const fin = v => { if (!done) { done = true; res(v); } };
    const sh = openSheet(`${sheetHead("Xác nhận chính chủ", esc(reason))}
      <p class="text-pretty text-sm">Bật <b>${esc(Passkey.label())}</b> một lần để mỗi lần mua vé có giới hạn tuổi, máy xác nhận đúng chủ tài khoản đã xác thực VNeID. Rạp không nhận khuôn mặt hay vân tay – thiết bị chỉ gửi chữ ký số.</p>
      <div class="grid gap-2"><button type="button" class="${B.primary}" data-m="on">Bật ${esc(Passkey.label())} và tiếp tục</button><button type="button" class="${B.outline}" data-m="skip">Bỏ qua – kiểm tra giấy tờ tại cửa</button></div>`, { label: "Xác nhận chính chủ", onClose: () => fin("cancel") });
    sh.el.onclick = async e => { const m = e.target.closest("[data-m]")?.dataset.m; if (!m) return;
      if (m === "close") sh.close();
      if (m === "skip") { fin("fallback"); sh.close(); }
      if (m === "on") { if (await setupPasskey()) { fin("ok"); sh.close(); } } };
  });
}

/* ============================ VNeID + FaceID ============================ */
/** So khớp khuôn mặt ở máy chủ: CSDL dân cư mô phỏng giữ ảnh gốc, trình duyệt chỉ gửi vector của lần quét này */
function makeServerMatch(key, account) {
  if (!Remote.v2 && !PHONE_MODE) return null;
  if (!Remote.ensureClient()) return null;
  return async (desc, live, method) => {
    const r = await Remote.rpc("face_check", { p_key: key, p_descriptor: desc, p_device: Remote.DEVICE, p_account: account || "Khách", p_method: method, p_liveness: !!live });
    return { ok: r.ok, enrolled: r.enrolled, dist: Number(r.distance), score: r.score, recordId: r.id, savedAt: r.saved_at, message: r.ok ? "" : "Khuôn mặt không khớp với ảnh gốc trong CSDL dân cư (mô phỏng)." };
  };
}
/** who: self | teacher | parent | gate-teacher | lab.  onDone(identity, r) khi đạt; onResult(r, identity) mọi kết quả */
function verifyFace({ who, title, fixedKey, onDone = () => {}, onResult = () => {} }) {
  FaceKit.preload();
  const ids = fixedKey ? IDENTITIES.filter(i => i.key === fixedKey) : who === "lab" || who === "gate-viewer" ? IDENTITIES : who === "teacher" ? IDENTITIES.filter(i => i.key === "gv") : IDENTITIES.filter(i => i.key !== "gv");
  let chosen = ids[0], stopCam = null, pairH = null;
  const own = who === "self" || who === "teacher", lookup = who === "gate-viewer";   // chính chủ khai hồ sơ · nhân viên tra khách
  const me = Auth.user || {};
  const account = who === "gate-teacher" || who === "gate-viewer" ? "Soát vé · " + Auth.user.name : who === "lab" ? "Kiểm thử · " + Auth.user.name : S.user.name;
  const sh = openSheet("", { label: title, onClose: () => { stopCam && stopCam(); pairH && pairH.close(); render(); } });
  const consent = () => sh.set(`${sheetHead(title)}
    ${who === "gate-teacher" ? `<p class="text-sm">Đối chiếu khuôn mặt 1:1 người phụ trách đoàn với ảnh gốc trong CSDL dân cư.</p>` : `
    <div class="rounded-xl border border-border p-4"><p class="text-sm font-medium">CINEVIN yêu cầu chia sẻ từ VNeID</p>
      <ul class="mt-2 grid gap-1.5 text-sm"><li class="flex items-center gap-2 text-success">${ic("check")}<span class="text-foreground">Họ và tên</span></li><li class="flex items-center gap-2 text-success">${ic("check")}<span class="text-foreground">Ngày sinh</span></li><li class="flex items-center gap-2 text-muted">${ic("x")}Ảnh khuôn mặt, số căn cước, địa chỉ</li></ul></div>`}
    ${own ? `<div class="grid gap-3 sm:grid-cols-2"><div class="sm:col-span-2">${field("Họ và tên (theo căn cước)", input("vn-name", S.user.name || me.name || "", 'autocomplete="name"'))}</div>${field("Ngày sinh", input("vn-dob", S.user.dob || "", 'type="date"'))}${field("Số căn cước", input("vn-idno", S.user.idNumber || "", 'inputmode="numeric" maxlength="12" placeholder="12 chữ số" autocomplete="off"'), "Mô phỏng: thực tế VNeID gửi về, không phải tự khai")}</div>
       <p class="text-pretty text-xs text-muted">Khuôn mặt của <b>bạn</b> được ghi làm ảnh gốc cho hồ sơ này; FaceID / VNeID sau này so với nó. Không dùng hồ sơ mẫu.</p>`
     : lookup ? field("Khách là ai?", input("vn-lookup", "", 'placeholder="Số căn cước, SĐT, email hoặc tên đăng nhập" autocomplete="off"'), "Tra hồ sơ VNeID đã liên kết của khách rồi đối chiếu khuôn mặt.")
     : field(`Hồ sơ dân cư mẫu ${badge("Mô phỏng VNeID", TONE.neutral)}`, selectBox("vn-id", ids.map(i => [i.key, `${i.name} – ${i.note}`]), chosen.key))}
    <button type="button" class="${B.primary}" data-m="methods">${who === "gate-teacher" ? "Tiếp tục" : lookup ? "Tra hồ sơ và quét khuôn mặt" : "Mở VNeID để xác thực"}</button>`);
  const methods = async () => {
    if (own && $("#vn-name", sh.el)) {
      const name = $("#vn-name").value.trim(), dob = $("#vn-dob").value, idno = $("#vn-idno").value.replace(/\D/g, "");
      if (name.length < 2) return toast("Nhập họ và tên", "bad"); if (!dob) return toast("Chọn ngày sinh", "bad"); if (!/^\d{12}$/.test(idno)) return toast("Số căn cước gồm 12 chữ số", "bad");
      const age = ageAt(dob, new Date()); if (age < 5 || age > 110) return toast("Ngày sinh không hợp lệ", "bad");
      if (ON() && Auth.token) { try { const r = await Remote.rpc("register_citizen_s", { p_token: Auth.token, p_name: name, p_dob: dob, p_id_number: idno }); chosen = { key: r.key, name: r.name, dob: r.dob, idNumber: idno, note: "" }; }
        catch (e) { if (/PGRST202|not find|does not exist/i.test(e.message || "")) chosen = { key: "u_" + (me.username || "local"), name, dob, idNumber: idno, note: "" }; else return toast(Auth.message(e), "bad"); } }
      else chosen = { key: "u_" + (me.username || "local"), name, dob, idNumber: idno, note: "" };
    } else if (lookup && $("#vn-lookup", sh.el)) {
      const idv = $("#vn-lookup").value.trim(); if (!idv) return toast("Nhập số căn cước, SĐT, email hoặc tên đăng nhập của khách", "bad");
      if (!(ON() && Auth.token)) return toast("Cần kết nối máy chủ để tra hồ sơ khách", "bad");
      try { const r = await Remote.rpc("citizen_lookup_s", { p_token: Auth.token, p_id: idv }); chosen = { key: r.key, name: r.name, dob: r.dob, note: "@" + r.username }; if (!r.has_template) toast("Khách chưa ghi ảnh gốc – không đối chiếu được", "bad"); }
      catch (e) { return toast(Auth.message(e), "bad"); }
    } else chosen = IDENTITIES.find(i => i.key === (selVal("vn-id") || chosen.key)) || chosen;
    const cam = await FaceKit.hasCamera();
    let refNote = FaceKit.getRef(chosen.key) ? "" : banner("warn", "", "Hồ sơ này chưa có ảnh gốc trên thiết bị. Lần quét này sẽ được lưu làm ảnh gốc; các lần sau so khớp với nó.");
    if (Remote.v2) { try { const st = (await Remote.rpc("citizen_status", {})).find(x => x.key === chosen.key);
      refNote = st && st.has_template ? banner("info", "", `CSDL dân cư mô phỏng (Supabase) đã có ảnh gốc của hồ sơ này từ ${new Date(st.template_at).toLocaleString("vi-VN")}. Lần quét này được so khớp ở máy chủ.`)
        : banner("warn", "", "CSDL dân cư mô phỏng chưa có ảnh gốc của hồ sơ này. Lần quét này sẽ được lưu làm ảnh gốc trên Supabase; các lần sau, ở bất kỳ máy nào, đều so với nó."); } catch (e) {} }
    sh.set(`${sheetHead("Xác thực khuôn mặt", `<b class="text-foreground">${esc(chosen.name)}</b> · sinh ${dmy(chosen.dob)}`)}${refNote}
      <div class="grid gap-2">${choiceCard("cam", "camera", "Dùng camera của máy này", cam ? "Kiểm tra người thật + so khớp 1:1, chạy ngay trên trình duyệt." : "Không tìm thấy camera hoặc trang chưa chạy HTTPS.", !cam)}
      ${choiceCard("phone", "smartphone", "Dùng điện thoại", "Quét mã QR bằng điện thoại, xác thực khuôn mặt trên điện thoại, kết quả gửi về đây ngay.")}
      <label class="flex w-full cursor-pointer items-start gap-3 rounded-xl border border-border-strong bg-surface p-4 text-left hover:bg-button-hover"><span class="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-muted">${ic("image")}</span><span class="min-w-0"><span class="block font-medium">Chụp hoặc chọn ảnh</span><span class="mt-0.5 block text-xs text-muted">Dự phòng khi không có camera – không kiểm tra được người thật.</span></span><input type="file" accept="image/*" capture="user" id="fk-file" class="sr-only"></label></div>`);
  };
  const done = async r => {
    stopCam = null;
    let vneidRec = null;
    if (r.ok && who !== "gate-teacher" && who !== "gate-viewer") vneidRec = await logVerif("vneid", true, { key: chosen.key, method: "đồng ý chia sẻ họ tên, ngày sinh (mô phỏng)", detail: { name: chosen.name, dob: chosen.dob, who, face_record: r.recordId || null } });
    r.vneidRecord = vneidRec && vneidRec.id;
    onResult(r, chosen);
    if (!r.ok) return sh.set(`${sheetHead("Xác thực không thành công")}${banner("bad", "", esc(r.message || "Không xác thực được."))}
      ${r.dist ? `<p class="text-sm text-muted">Khoảng cách đặc trưng ${String(r.dist).replace(".", ",")} &gt; ngưỡng ${String(FaceKit.THRESHOLD).replace(".", ",")}.</p>` : ""}${r.recordId ? savedLine(r) : ""}<button type="button" class="${B.primary}" data-m="methods">Thử lại</button>`);
    const how = r.enrolled ? "đã lưu ảnh gốc cho hồ sơ demo" : `độ tương đồng ${r.score}% (khoảng cách ${String(r.dist).replace(".", ",")} ≤ ngưỡng ${String(FaceKit.THRESHOLD).replace(".", ",")})`;
    const method = (r.via === "phone" ? "điện thoại" : r.method === "ảnh" ? "ảnh chụp" : "camera") + (r.live ? (r.liveBy === "blink" ? " + chớp mắt" : " + quay đầu") : "");
    sh.set(`${sheetHead("Xác thực thành công")}
      <div class="flex items-start gap-3 rounded-xl border border-border p-4"><span class="grid size-10 shrink-0 place-items-center rounded-lg bg-success-bg text-success">${ic("badge-check", "size-5")}</span><div class="min-w-0"><p class="text-xs font-medium uppercase tracking-wide text-success">Đã xác thực</p><p class="text-base font-semibold">${esc(chosen.name)}</p><p class="text-sm text-muted">Sinh ${dmy(chosen.dob)} · ${ageAt(chosen.dob, new Date())} tuổi</p><p class="mt-1 text-pretty text-xs text-muted">Khuôn mặt: ${esc(how)} · qua ${esc(method)}${r.perf ? ` · ${r.perf.ms} ms/khung` : ""}</p></div></div>
      ${savedLine(r)}
      <p class="text-xs text-muted">Rạp nhận: họ tên, ngày sinh, mức xác thực, thời điểm. Không nhận ảnh.</p>
      ${who === "self" && PK.avail && !S.user.passkey ? `<div class="rounded-xl border border-border p-4"><p class="text-sm font-medium">Bật ${esc(Passkey.label())} cho tài khoản?</p><p class="mt-0.5 text-xs text-muted">Lần sau mua vé phim có giới hạn tuổi chỉ cần quét ${esc(Passkey.label())} – khoảng 1 giây.</p><button type="button" class="${B.outline} mt-3" data-m="pk">Bật ${esc(Passkey.label())}</button></div>` : ""}
      <button type="button" class="${B.primary}" data-m="close">Xong</button>`);
    onDone(chosen, { score: r.enrolled ? null : r.score, method, live: r.live, recordId: r.recordId });
    save();
  };
  const runCam = () => { sh.set(`${sheetHead("Nhìn vào camera")}<div id="fk-host" class="grid gap-4"></div><button type="button" class="${B.ghost}" data-m="methods">Đổi cách xác thực</button>`); stopCam = FaceKit.runCamera($("#fk-host", sh.el), { refKey: chosen.key, ref: FaceKit.getRef(chosen.key), serverMatch: makeServerMatch(chosen.key, account), onResult: done }); };
  const runPhone = () => {
    sh.set(`${sheetHead("Dùng điện thoại")}<div class="grid justify-items-center gap-3 text-center" id="pair-box"><p class="text-sm text-muted">Đang tạo mã ghép nối…</p></div><button type="button" class="${B.ghost}" data-m="methods">Đổi cách xác thực</button>`);
    const ref = FaceKit.getRef(chosen.key);
    pairH = Pair.host({ who, server: Remote.v2, account, profile: { key: chosen.key, name: chosen.name, dob: chosen.dob }, ref: !Remote.v2 && ref ? Array.from(ref) : null }, {
      onStatus(st, info) {
        const box = $("#pair-box", sh.el); if (!box) return;
        if (st === "ready") box.innerHTML = `<div class="qr-box size-48 rounded-xl border border-border p-2">${qrSvg(pairH.url)}</div><p class="text-pretty text-sm">Quét mã bằng camera điện thoại, hoặc mở <b class="font-mono">${esc(baseUrl().replace(/^https?:\/\//, ""))}?pair</b> và nhập mã:</p><div class="pair-code font-mono text-3xl font-semibold tracking-[.3em]">${info}</div><p class="text-sm text-muted">Đang chờ điện thoại kết nối…</p>`;
        if (st === "connected") box.innerHTML = `${banner("ok", "Điện thoại đã kết nối", "Làm theo hướng dẫn trên điện thoại.")}<p class="text-sm text-muted" id="pair-prog">Đang chờ kết quả…</p>`;
        if (st === "progress") { const p = $("#pair-prog", sh.el); if (p) p.textContent = info; }
        if (st === "lost") box.innerHTML = banner("warn", "", "Điện thoại đã ngắt kết nối.");
        if (st === "error") box.innerHTML = banner("bad", "", `Không ghép nối được: ${esc(info)}. Kiểm tra mạng rồi thử lại.`);
      },
      onResult(r) { pairH = null; if (r.ok && r.enrolled && r.descriptor) FaceKit.setRef(chosen.key, new Float32Array(r.descriptor)); done({ ...r, via: "phone" }); },
    });
  };
  sh.el.onclick = async e => {
    const a = e.target.closest("[data-m]"); if (!a || a.getAttribute("aria-disabled") === "true") return;
    const m = a.dataset.m;
    if (m === "close") { stopCam && stopCam(); pairH && pairH.close(); sh.close(); }
    if (m === "methods") { stopCam && stopCam(); stopCam = null; pairH && pairH.close(); pairH = null; methods(); }
    if (m === "cam") runCam();
    if (m === "phone") runPhone();
    if (m === "pk") { if (await setupPasskey()) sh.close(); }
  };
  sh.el.onchange = e => { if (e.target.id === "fk-file" && e.target.files[0]) { sh.set(`${sheetHead("Phân tích ảnh")}<div id="fk-host" class="grid gap-4"></div>`); FaceKit.runImage($("#fk-host", sh.el), e.target.files[0], { refKey: chosen.key, ref: FaceKit.getRef(chosen.key), serverMatch: makeServerMatch(chosen.key, account), onResult: done }); } };
  consent();
}

/* Trang trên điện thoại khi mở link ?pair=MÃ */
function phonePage(code) {
  PHONE_MODE = true; Remote.ensureClient();
  const app = $("#app");
  const wrap = inner => `<main class="grid min-h-screen place-items-start justify-center p-4 pt-10"><div class="grid w-full max-w-[420px] gap-5"><div class="flex justify-center">${LOGO}</div><section class="grid gap-4 rounded-2xl border border-border bg-surface p-5" id="ph">${inner}</section></div></main>`;
  const ask = msg => { app.innerHTML = wrap(`<h1 class="text-xl font-semibold">Xác thực trên điện thoại</h1>${msg ? banner("bad", "", esc(msg)) : ""}${field("Mã ghép nối hiển thị trên máy tính", `<input id="pc" maxlength="6" autocomplete="off" class="${INPUT} !h-14 text-center font-mono !text-2xl uppercase tracking-[.3em]">`)}<button type="button" class="${B.primary} min-h-12" id="pc-go">Kết nối</button>`);
    $("#pc-go").onclick = () => { const c = $("#pc").value.trim().toUpperCase(); if (c.length === 6) { history.replaceState(null, "", "?pair=" + c); phonePage(c); } }; };
  if (!code) return ask("");
  app.innerHTML = wrap(`<h1 class="text-xl font-semibold">Xác thực trên điện thoại</h1><p class="text-sm text-muted">Đang kết nối tới máy tính (mã <b class="font-mono text-foreground">${esc(code)}</b>)…</p>`);
  Pair.join(code, {
    onStatus(st, info) {
      const ph = $("#ph"); if (!ph) return;
      if (st === "error") ask(info);
      if (st === "closed") ph.insertAdjacentHTML("beforeend", `<p class="text-sm text-muted">Đã ngắt kết nối.</p>`);
    },
    onJob(job, ch) {
      const p = job.profile;
      $("#ph").innerHTML = `<h1 class="text-xl font-semibold">Xác thực khuôn mặt</h1><div class="rounded-xl border border-border p-4"><p class="font-semibold">${esc(p.name)}</p><p class="text-sm text-muted">Sinh ${dmy(p.dob)} · ${job.who === "gate-teacher" ? "đối chiếu 1:1 người phụ trách đoàn tại cửa" : "liên kết VNeID cho tài khoản trên máy tính"}</p></div>
        ${job.server ? banner("info", "", "So khớp với ảnh gốc trong CSDL dân cư mô phỏng trên máy chủ; kết quả được lưu và hiện mã bản ghi.") : job.ref ? "" : banner("warn", "", "Chưa có ảnh gốc cho hồ sơ này – lần quét này sẽ được lưu làm ảnh gốc.")}
        <button type="button" class="${B.primary} min-h-12" id="ph-go">Bắt đầu quét khuôn mặt</button><p class="text-pretty text-xs text-muted">Ảnh chỉ xử lý trên điện thoại, không gửi đi. ${job.server ? "Máy chủ chỉ nhận vector đặc trưng để so với ảnh gốc." : "Máy tính chỉ nhận kết quả."}</p>`;
      FaceKit.preload();
      ch.progress("Điện thoại đã sẵn sàng, chờ người dùng bắt đầu quét");
      $("#ph-go").onclick = () => {
        $("#ph").innerHTML = `<div id="fk-host" class="grid gap-4"></div>`;
        ch.progress("Đang quét khuôn mặt trên điện thoại…");
        const ref = job.ref ? new Float32Array(job.ref) : FaceKit.getRef(p.key);
        FaceKit.runCamera($("#fk-host"), { refKey: job.ref ? null : p.key, ref, serverMatch: job.server ? makeServerMatch(p.key, job.account) : null, onResult: r => {
          ch.result({ ok: r.ok, enrolled: r.enrolled, live: r.live, liveBy: r.liveBy, dist: r.dist, score: r.score, method: "camera", message: r.message, recordId: r.recordId || null, savedAt: r.savedAt || null, descriptor: r.enrolled && !r.recordId ? r.descriptor : null });
          $("#ph").insertAdjacentHTML("beforeend", (r.recordId ? savedLine(r) : "") + (r.ok ? banner("ok", "Xong", "Kết quả đã gửi về máy tính. Bạn có thể đóng trang này.") : banner("bad", "", `${esc(r.message || "Không xác thực được")}. Kết quả đã gửi về máy tính – bấm “Thử lại” trên máy tính.`)));
        } });
      };
    },
  });
}

/* ============================ người phụ thuộc ============================ */
function openAddDep() {
  const sh = openSheet(`${sheetHead("Thêm trẻ dưới 14 tuổi")}
    ${field("Họ tên", input("dep-name", "Nguyễn Minh Khôi"))}
    <div class="grid grid-cols-2 gap-3">${field("Ngày sinh", input("dep-dob", `01/06/${new Date().getFullYear() - 9}`, 'placeholder="dd/mm/yyyy" inputmode="numeric"'))}${field("Số định danh", input("dep-idno", "040217012345", 'inputmode="numeric" class="' + INPUT + ' font-mono"'))}</div>
    ${field("Cách xác nhận", selectBox("dep-way", [["VNeID", "Con đã có tài khoản định danh – xác nhận qua VNeID của cha/mẹ"], ["Cam kết", "Chưa có – cam kết theo giấy khai sinh"]], "VNeID"))}
    <p id="dep-err" class="text-sm text-[var(--error-text)]" role="alert"></p><button type="button" class="${B.primary}" data-m="ok">Thêm và xác nhận</button>`, { label: "Thêm người phụ thuộc" });
  sh.el.onclick = e => {
    const m = e.target.closest("[data-m]")?.dataset.m; if (!m) return; if (m === "close") return sh.close();
    const name = $("#dep-name").value.trim(), dm = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec($("#dep-dob").value.trim()), idno = $("#dep-idno").value.replace(/\D/g, ""), way = selVal("dep-way"), err = $("#dep-err");
    if (!name || !dm) return err.textContent = "Nhập họ tên và ngày sinh dạng dd/mm/yyyy.";
    const dob = `${dm[3]}-${pad(dm[2])}-${pad(dm[1])}`;
    if (ageAt(dob, new Date()) >= 14) return err.textContent = "Trẻ từ 14 tuổi tự liên kết VNeID bằng tài khoản riêng.";
    if (idno.length !== 12) return err.textContent = "Số định danh cá nhân gồm 12 chữ số.";
    if (S.dependents.some(d => d.idHash === idno.slice(-6))) return err.textContent = "Số định danh đã gắn với một tài khoản.";
    const add = () => { S.dependents.push({ id: rid("d", 4), name, dob, level: way, idMasked: "••••" + idno.slice(-4), idHash: idno.slice(-6) }); log("dep", `Thêm người phụ thuộc ${name} (${way})`); save(); sh.close(); toast("Đã thêm " + name); };
    if (way === "VNeID") { sh.set(`${sheetHead("Xác nhận qua VNeID")}<div class="rounded-xl border border-border p-4 text-sm">Phụ huynh <b>${esc(S.user.name)}</b> đồng ý chia sẻ họ tên, ngày sinh của con <b>${esc(name)}</b> cho CINEVIN. ${badge("Mô phỏng VNeID", TONE.neutral)}</div><button type="button" class="${B.primary}" data-m2="ok">Đồng ý</button>`); sh.el.onclick = e2 => { if (e2.target.closest("[data-m2]")) add(); if (e2.target.closest('[data-m="close"]')) sh.close(); }; }
    else add();
  };
}

/* ============================ soát vé ============================ */
function gatePush(code, kind, detail) { const L = S.view.gateLog || (S.view.gateLog = []); L.unshift({ t: new Date().toISOString(), code, kind, detail }); S.view.gateLog = L.slice(0, 50); }
function gateRefresh() { const a = $("#gate-result"), b = $("#gate-recent"); if (a && b) { a.innerHTML = gateResultCard(); b.innerHTML = gateRecent(); } else render(); }
function gateCamStart() {
  if (GATE.method !== "cam" || GATE.stop) return;
  const st = $("#gate-stage"); if (!st) return;
  st.setAttribute("data-keep", "");
  GATE.stop = Scan.start(st, code => { GATE.stop = null; gateProcess(code, "camera").finally(() => setTimeout(() => { if (CUR_ROUTE === "soat" && GATE.method === "cam") { const s = $("#gate-stage"); if (s) { s.innerHTML = `<div class="frame"></div>`; gateCamStart(); } } }, 1800)); },
    err => { GATE.stop = null; const s = $("#gate-stage"); if (s) s.innerHTML = `<div class="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white/80">${esc(err)}<br>Dùng tab Ảnh QR hoặc Nhập mã.</div>`; });
}
/** Xử lý một lần quét: kiểm chữ ký + thời gian QR ở máy chủ, rồi kiểm vé; vé hợp lệ không cần giấy tờ thì cho vào luôn */
async function gateProcess(raw, via) {
  raw = String(raw || "").trim(); if (!raw || GATE.busy) return;
  GATE.busy = true;
  try {
    const g = S.view.gate = {};
    const up = raw.toUpperCase();
    const isGroup = /^G-[A-Z0-9]{5}(-\d+)?$/.test(up);
    let code = up, qr = null;
    if (!isGroup) {
      if (Remote.v4 && ON() && Auth.token) { try { qr = await Remote.rpc("verify_qr", { p_token: Auth.token, p_payload: raw }); code = qr.code; } catch (e) { toast(Auth.message(e), "bad"); return; } }
      else { const p = raw.split("."); code = p.length === 4 && p[0] === "CV1" ? p[1].toUpperCase() : up; qr = { status: "static" }; }
    }
    if (qr && (qr.status === "expired" || qr.status === "forged")) { g.result = { kind: qr.status, code, qr }; gatePush(code, qr.status, qr.status === "expired" ? `QR tạo cách đây ${qr.age_seconds} giây · ${via}` : `chữ ký không khớp · ${via}`); log("gate", `Từ chối QR ${code}: ${qr.status}`, false); return; }
    if (ON() && !S.tickets.some(t => t.code === code) && !S.groups.some(x => x.code === code || x.students.some(s => s.card === code))) {
      try { const t = await Remote.fetchTicket(code); if (t) S.tickets.push(t); else { const gr = await Remote.fetchGroup(code.replace(/-\d+$/, "")); if (gr && !S.groups.some(x => x.code === gr.code)) S.groups.push(gr); } } catch (e) {}
    }
    const t = S.tickets.find(x => x.code === code);
    const grp = S.groups.find(x => x.code === code) || S.groups.find(x => x.students.some(s => s.card === code));
    if (t) {
      const sh = show(t.showId), f = sh ? film(sh.filmId) : { title: "?" }, d = `${f.title} · ${t.seat}`;
      if (t.status !== "valid") { g.result = { kind: t.status, code, qr }; gatePush(code, t.status, d); return; }
      await gateTicketFlow(t, qr, via, false);
    } else if (grp) {
      g.result = { kind: "group", code: grp.code }; gatePush(grp.code, "group", `${grp.students.length} học sinh · ${grp.teacher}`);
      if (code !== grp.code) setTimeout(() => scanCard(code));
    } else { g.result = { kind: "none", code, qr }; gatePush(code, "none", via); log("gate", `Mã không hợp lệ ${code}`, false); }
  } finally { GATE.busy = false; save(); gateRefresh(); }
}
/** Luật nghiệp vụ một vé hợp lệ tại cửa: đúng khung giờ → mã có chữ ký → tuổi đã xác thực hay phải kiểm → cho vào */
async function gateTicketFlow(t, qr, via, allowEarly) {
  const g = S.view.gate, sh = show(t.showId), f = film(sh.filmId), d = `${f.title} · ${t.seat}`, code = t.code, now = Date.now();
  if (cinemaOf(sh).id !== workCinema().id) { g.result = { kind: "cinema", code, qr }; gatePush(code, "cinema", `${d} · ${cinemaOf(sh).name}`); log("gate", `Từ chối ${code}: vé của ${cinemaOf(sh).name}, soát tại ${workCinema().name}`, false); return; }
  if (now > endOf(sh).getTime()) { g.result = { kind: "over", code, qr }; gatePush(code, "over", d); log("gate", `Từ chối ${code}: suất đã kết thúc`, false); return; }
  if (!allowEarly && new Date(sh.start).getTime() - now > GATE_OPEN_MIN * 60000) { g.result = { kind: "early", code, qr }; gatePush(code, "early", `${d} · chiếu ${hhmm(sh.start)}`); return; }
  if (qr && qr.status === "static") { g.result = { kind: "static", code, qr }; gatePush(code, "static", d + " · " + via); return; }
  // một QR cho cả đơn: vé thuộc đơn nhiều vé → bảng cả đơn, cho vào một lần
  if (Remote.v5 && ON() && Auth.token) { const order = await fetchOrder(t.code); if (order && order.length > 1) { g.result = { kind: "order", code, qr, order, early: allowEarly }; gatePush(code, "order", `${d} · đơn ${order.length} vé`); return; } }
  if (t.needDoc) { g.result = { kind: "doc", code, qr }; gatePush(code, "doc", d); return; }
  if (!(await admit(t))) { g.result = { kind: t.status === "valid" ? "none" : t.status, code, qr }; return; }
  log("gate", `Vào phòng: ${t.code} (${t.viewerName})${allowEarly ? " – cho vào sớm" : ""}`); g.result = { kind: "ok", code, qr }; gatePush(code, "ok", d);
}
async function fetchOrder(code) {
  try { const list = await Remote.rpc("order_tickets", { p_token: Auth.token, p_code: code });
    list.forEach(x => { const ex = S.tickets.find(y => y.code === x.code); if (ex) Object.assign(ex, { status: x.status, needDoc: x.need_doc }); });
    return list; } catch (e) { return null; }
}
/** Cho vào phòng chiếu. Trực tuyến: máy chủ đảm bảo một vé chỉ qua cửa một lần dù nhiều máy cùng quét. */
async function admit(t) {
  const prev = await call("admit_ticket", { p_code: t.code }, "valid");
  if (prev == null) return false;
  if (prev !== "valid") { t.status = prev === "none" ? t.status : prev; log("gate", `Từ chối ${t.code}: vé ${prev}`, false); return false; }
  t.status = "used"; return true;
}
async function scanCard(card) {
  const g = S.view.gate || {}, grp = g.result && S.groups.find(x => x.code === g.result.code); if (!grp) return;
  const s = grp.students.find(x => x.card === card);
  let res = !s ? "foreign" : s.entered ? "dup" : "ok";
  if (ON()) { const r = await call("scan_member", { p_group: grp.code, p_card: card }, res); if (r == null) return; res = r; }
  if (res === "foreign") { g.cardMsg = { ok: false, text: `Thẻ ${card} không thuộc đoàn ${grp.code} – từ chối.` }; log("gate", `Thẻ lạ ${card} tại đoàn ${grp.code}`, false); }
  else if (res === "dup") { if (s) s.entered = true; g.cardMsg = { ok: false, text: `Thẻ của ${s ? s.name : card} đã được quét – chặn quét lại.` }; log("gate", `Quét lại thẻ ${card}`, false); }
  else { s.entered = true; g.cardMsg = { ok: true, text: `${s.name} – lớp ${s.cls}: hợp lệ.` }; }
  save(); gateRefresh();
}
function openScanner(title, onCode) {
  const sh = openSheet(`${sheetHead(title)}<div class="cam-stage aspect-square w-full" id="scan-stage"><div class="frame"></div></div><p class="text-sm text-muted" id="scan-msg">Đưa mã QR vào khung.</p>`, { label: title, onClose: () => stop && stop() });
  let stop = Scan.start($("#scan-stage", sh.el), code => { stop = null; sh.close(); onCode(code); }, err => { const m = $("#scan-msg", sh.el); if (m) { m.textContent = err; m.className = "text-sm text-[var(--error-text)]"; } });
  sh.el.onclick = e => { if (e.target.closest('[data-m="close"]')) sh.close(); };
}

/** Vẽ lại riêng danh sách ca + huy hiệu của một thẻ kiểm thử (camera trong thẻ vẫn chạy) */
function refreshLabCard(group) {
  const el = $("#lab-" + group); if (!el) return;
  const tmp = document.createElement("div"); tmp.innerHTML = caseList(group);
  const old = el.querySelector("ul:last-of-type"); if (old) old.replaceWith(tmp.firstElementChild);
  const [n, t, bad] = caseCount(group), b = el.querySelector("h2 + span"); if (b) b.outerHTML = tone(`${n}/${t} ca đạt`, n === t ? "ok" : bad ? "bad" : "neutral");
}
/* ============================ kiểm thử QR ============================ */
async function labQrVerify(payload, via) {
  const sm = LAB.qr.samples || {};
  let r; try { r = await Remote.rpc("verify_qr", { p_token: Auth.token, p_payload: payload }); } catch (e) { return toast(Auth.message(e), "bad"); }
  LAB.qr.last = { ...r, via };
  const kind = Object.keys(sm).find(k => ["ok", "expired", "forged", "static"].includes(k) && sm[k] === payload);
  const expect = { ok: ["q-ok", "ok"], expired: ["q-exp", "expired"], forged: ["q-forged", "forged"], static: ["q-static", "static"] }[kind];
  if (expect) setCase(expect[0], r.status === expect[1], r.status === expect[1] ? `${via} · bản ghi #${r.record_id}` : `Mong đợi "${expect[1]}", nhận "${r.status}"${kind === "ok" && r.status === "expired" ? " – mẫu đã quá 30 giây, bấm Tạo lại mẫu" : ""}`);
  if (via === "ảnh") setCase("q-image", true, `Đọc được QR (${kind ? "mẫu " + kind : "mã ngoài"}) từ ảnh`);
  if (via === "camera") setCase("q-cam", true, `Đọc được QR (${kind ? "mẫu " + kind : "mã ngoài"}) bằng camera`);
  render();
}

/* ============================ hành động ============================ */
const A = {
  logout() { stopMedia(""); releaseDraft(); Auth.logout(); save(); location.hash = "#/dangnhap"; render(); },
  menu() { document.body.toggleAttribute("data-menu-open"); },
  "toggle-pass"() { const v = $("#li-pass")?.value || "", u = $("#li-user")?.value || "", n = $("#li-name")?.value || ""; LOGIN.show = !LOGIN.show; render(); if ($("#li-pass")) $("#li-pass").value = v; if ($("#li-user")) $("#li-user").value = u; if ($("#li-name")) $("#li-name").value = n; },
  "demo-login"(el) { const d = Auth.DEMO.find(x => x.username === el.dataset.u); doLogin(d.username, d.pass); },
  async reset() {
    if (!confirm("Xoá toàn bộ vé, suất, nhật ký trên máy chủ và làm lại từ đầu?")) return;
    if (ON()) await call("reset_demo", {});
    const keep = { profiles: S.profiles, labCases: S.labCases }; S = Object.assign(Store.reset(), keep); bindProfile(); render();
    if (ON()) await Remote.init(S, buildSchedule(), scheduleRender); save(); render(); toast("Đã đặt lại dữ liệu demo");
  },
  "reset-local"() { S = Store.reset(); bindProfile(); render(); },
  "vneid-self"() { verifyFace({ who: "self", title: "Liên kết VNeID", async onDone(id, r) {
      Object.assign(S.user, { linked: true, key: id.key, name: id.name, dob: id.dob, idNumber: id.idNumber || S.user.idNumber || null, verifiedAt: new Date().toISOString(), faceScore: r.score, method: r.method });
      if (Remote.v5 && Auth.token) { try { Auth.refresh(await Remote.rpc("link_vneid", { p_token: Auth.token, p_key: id.key, p_method: r.method, p_face_record: r.recordId || null })); bindProfile(); }
        catch (e) { Object.assign(S.user, { linked: false, key: null, dob: null, verifiedAt: null, name: Auth.user.name }); toast(Auth.message(e), "bad"); } }
      log("vneid", `Liên kết VNeID: ${id.name}, ${ageAt(id.dob, new Date())} tuổi, qua ${r.method}`); save(); } }); },
  async unlink() { if (!confirm("Huỷ liên kết VNeID? Vé mới sẽ phải kiểm giấy tờ ở cửa; đăng nhập FaceID/VNeID tắt.")) return;
    if (Remote.v5 && Auth.token) { try { Auth.refresh(await Remote.rpc("unlink_vneid", { p_token: Auth.token })); } catch (e) { return toast(Auth.message(e), "bad"); } }
    Object.assign(S.user, { linked: false, dob: null, key: null, name: Auth.user.name, passkey: null }); S.dependents.length = 0; bindProfile(); save(); render(); },
  "login-mode"(el) { LOGIN.mode = el.dataset.v; LOGIN.err = ""; render(); },
  "login-vneid"() { const id = ($("#li-vneid-id")?.value || "").trim(); LOGIN.vneid = id; if (!id) { LOGIN.err = "Nhập số căn cước (hoặc tên đăng nhập / email / SĐT)."; return render(); } doLoginFace(id, "vneid"); },
  async "pref-confirm"(el) { const on = el.getAttribute("aria-checked") !== "true"; S.user.confirmEvery = on;
    if (Remote.v5 && Auth.token) { try { Auth.refresh(await Remote.rpc("set_pref", { p_token: Auth.token, p_confirm_every: on })); } catch (e) { toast(Auth.message(e), "bad"); } }
    save(); render(); },
  async "voucher-apply"() { const d = S.draft, code = ($("#voucher").value || "").trim().toUpperCase(); if (!code) { d.voucher = null; save(); return render(); }
    if (!Remote.v5 || !Auth.token) return toast("Máy chủ chưa bật voucher (migration 005)", "bad");
    try { const v = await Remote.rpc("voucher_check", { p_token: Auth.token, p_code: code }); d.voucher = v; toast(`Áp dụng ${v.kind === "gift" ? "thẻ quà tặng " + vnd(v.amount) : "giảm " + v.percent + "%"}`); }
    catch (e) { d.voucher = null; toast(Auth.message(e), "bad"); }
    save(); render(); },
  async "friend-check"(el) {
    const i = +el.dataset.i, d = S.draft, idv = ($("#friend-" + i).value || "").trim(); if (!idv) return toast("Nhập email, SĐT hoặc tên đăng nhập của bạn đi cùng");
    try { const f = await Remote.rpc("companion_check", { p_token: Auth.token, p_id: idv, p_show: d.showId }); d.assign[i] = { viewer: { kind: "friend", user: f.username, name: f.name, verified: !!f.verified, age: f.age } }; }
    catch (e) { return toast(Auth.message(e), "bad"); }
    save(); render(); },
  "friend-clear"(el) { S.draft.assign[+el.dataset.i] = { viewer: { kind: "friend" } }; save(); render(); },
  "voucher-clear"() { S.draft.voucher = null; save(); render(); },
  "points-use"(el) { const d = S.draft, max = Math.min(S.user.points || 0, Math.floor(Math.max(0, (d.gross || 0) - (d.discount || 0)) / 1000)); d.points = el.dataset.v === "max" ? max : 0; save(); render(); },
  async "gate-noticket"() {
    verifyFace({ who: "gate-viewer", title: "Khách quên vé – xác thực để tìm vé", async onDone(id) {
      let list = [];
      try { list = await Remote.rpc("tickets_by_citizen", { p_token: Auth.token, p_key: id.key }); } catch (e) { return toast(Auth.message(e), "bad"); }
      list.forEach(t => { if (!S.tickets.some(x => x.code === t.code)) S.tickets.push({ code: t.code, showId: t.show_id, seat: t.seat, viewerName: t.viewer_name, status: t.status, needDoc: t.need_doc, ownerUser: t.owner_user, owner: "other", price: 0, verified: true, channel: "Online" }); });
      setTimeout(() => {
        const sh = openSheet(`${sheetHead("Vé của " + esc(id.name), "Hôm nay · theo hồ sơ VNeID đã xác thực khuôn mặt")}${list.length ? `<div class="grid gap-2">${list.map(t => { const s = show(t.show_id), f = s && film(s.filmId); return `<button type="button" data-m="pick" data-code="${t.code}" class="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-border-strong p-3 text-left hover:bg-button-hover"><span class="min-w-0 flex-1"><span class="block font-medium">${f ? esc(f.title) : t.show_id} · ghế ${esc(t.seat)}</span><span class="block text-xs text-muted">${s ? hhmm(s.start) + " · " + room(s.roomId).name : ""} · ${t.code}${t.need_doc ? " · cần kiểm tuổi" : ""}</span></span>${ic("arrow-right", "size-4 text-muted")}</button>`; }).join("")}</div>` : banner("warn", "Không có vé hôm nay", "Tài khoản này không có vé hợp lệ cho suất trong 12 giờ tới.")}<button type="button" class="${B.ghost}" data-m="close">Đóng</button>`, { label: "Vé theo hồ sơ" });
        sh.el.onclick = async e => { const a = e.target.closest("[data-m]"); if (!a) return; if (a.dataset.m === "close") return sh.close();
          sh.close(); const t = S.tickets.find(x => x.code === a.dataset.code); S.view.gate = {}; await gateTicketFlow(t, { status: "ok", age_seconds: 0 }, "FaceID không cần vé", false); save(); gateRefresh(); };
      }, 50);
    } }); },
  "add-dep"() { openAddDep(); },
  "del-dep"(el) { const i = S.dependents.findIndex(x => x.id === el.dataset.id); if (i >= 0) S.dependents.splice(i, 1); save(); render(); },
  "lich-day"(el) { S.view.day = el.dataset.v; save(); render(); },
  "buy-more"(el) { const sh = show(el.dataset.show); if (!sh || new Date(sh.start) <= new Date()) return toast("Suất này đã chiếu – chọn suất khác", "bad"); releaseDraft(); S.draft = { id: rid("D"), showId: sh.id, seats: [], until: null, more: true }; save(); go("ghe"); toast("Ghế bạn đã mua hiện màu xanh – chọn thêm ghế cho người đi cùng"); },
  "pick-show"(el) { releaseDraft(); S.draft = { id: rid("D"), showId: el.dataset.show, seats: [], until: null }; save(); go("ghe"); },
  // ghế nhóm (đôi, ghế 3, sofa…): một nút = cả nhóm ghế → giữ / nhả tất cả thành viên, đơn có đủ n ghế
  async "toggle-seat"(el) { const d = S.draft, list = el.dataset.group ? el.dataset.group.split(",") : [el.dataset.seat];
    if (list.some(sid => d.seats.includes(sid))) { list.forEach(sid => { const i = d.seats.indexOf(sid); if (i >= 0) d.seats.splice(i, 1); delete S.seats[d.showId][sid]; call("release_seat", { p_show: d.showId, p_seat: sid, p_hold: d.id }); }); }
    else {
      if (d.seats.length + list.length > S.params.maxTickets) return toast(`Tối đa ${S.params.maxTickets} vé mỗi đơn`); if (list.some(sid => seatState(d.showId, sid))) return toast("Ghế vừa có người giữ");
      const until = d.until || new Date(Date.now() + S.params.holdMin * 60000).toISOString();
      el.disabled = true; const got = [];
      for (const sid of list) { const ok = await call("hold_seat", { p_show: d.showId, p_seat: sid, p_hold: d.id, p_until: until });
        if (!ok) { got.forEach(g => call("release_seat", { p_show: d.showId, p_seat: g, p_hold: d.id })); if (ok === false) toast(list.length > 1 ? "Ghế trong nhóm vừa có người khác giữ" : "Ghế vừa có người khác giữ"); return render(); } got.push(sid); }
      if (S.draft !== d) { got.forEach(g => call("release_seat", { p_show: d.showId, p_seat: g, p_hold: d.id })); return render(); }   // đơn đã bị huỷ/hết hạn trong lúc chờ máy chủ
      d.until = until; list.forEach(sid => { d.seats.push(sid); (S.seats[d.showId] ||= {})[sid] = { st: "held", by: d.id, until }; });
      if (list.length > 1) toast(`${seatType(seatKind(room(show(d.showId).roomId), list[0])).name}: đã lấy ${list.length} ghế ${list.join(", ")}`);
    }
    d.assign = null; save(); render(); },
  /* quản trị chuỗi: cơ sở, phòng, phim, suất */
  "cinema-new"() { cinemaSheet(null); },
  "cinema-edit"(el) { cinemaSheet(cinema(el.dataset.id)); },
  "room-new"(el) { roomSheet(el.dataset.cinema, null); },
  "room-edit"(el) { const r = room(el.dataset.id); roomSheet(r.cinemaId, r); },
  "seattype-new"() { seatTypeSheet(null); },
  "cinema-prices"(el) { pricesSheet(cinema(el.dataset.id)); },
  "seattype-edit"(el) { seatTypeSheet(SEAT_TYPES[el.dataset.id]); },
  "film-new"() { filmSheet(null); },
  "film-edit"(el) { filmSheet(film(el.dataset.id)); },
  async "film-dist"(el) {
    const fid = el.dataset.film, cid = el.dataset.cinema, on = el.getAttribute("aria-pressed") !== "true";
    el.disabled = true;
    if (Remote.v8 && Auth.token) { try { await Remote.rpc("set_film_cinema_s", { p_token: Auth.token, p_film: fid, p_cinema: cid, p_active: on }); await Remote.reloadCatalog(); } catch (e) { el.disabled = false; return toast(Auth.message(e), "bad"); } }
    else if (ON()) { el.disabled = false; return toast("Máy chủ chưa chạy migration 008", "bad"); }
    else { on ? DIST.delete(cid + "|" + fid) : DIST.add(cid + "|" + fid); }
    log("admin", `${on ? "Phân phối" : "Bỏ"} phim ${film(fid).title} ${on ? "cho" : "khỏi"} ${cinema(cid).name}`); save(); render(); toast(`${film(fid).title}: ${on ? "đang chiếu tại" : "không chiếu tại"} ${cinema(cid).name}`); },
  "show-info"(el) { showSheet(show(el.dataset.show)); },
  "bc-scope"(el) { S.view.bcScope = el.dataset.v; save(); render(); },
  "bc-day"(el) { S.view.bcDay = el.dataset.v; save(); render(); },
  /* chuỗi rạp */
  "cinema-pick"() { const sheet = openSheet(cinemaSheetHtml(curCinema().city), { label: "Chọn rạp" }); CINEMA_SHEET = sheet;
    sheet.el.onclick = e => { const b = e.target.closest("[data-act]"); if (!b) return; if (b.dataset.act === "cinema-city") sheet.set(cinemaSheetHtml(b.dataset.v)); else if (b.dataset.act === "cinema-set") A["cinema-set"](b); else if (e.target.closest('[data-m="close"]')) sheet.close(); }; },
  "cinema-set"(el) { setCurCinema(el.dataset.v); if (CINEMA_SHEET) { CINEMA_SHEET.close(); CINEMA_SHEET = null; } S.view.lichMode = "rap"; save(); render(); toast(`Đang xem lịch ${cinema(el.dataset.v).name}`); },
  "lich-mode"(el) { S.view.lichMode = el.dataset.v; save(); render(); },
  "lich-film"(el) { S.view.lichFilm = el.dataset.v; save(); render(); },
  "lich-city"(el) { S.view.lichCity = el.dataset.v; save(); render(); },
  "work-cinema-set"(el) { SEL["work-cinema"](null, el.dataset.v); },
  "seat-blocked"(el) { toast(`Ghế ${el.dataset.seat} đang bảo trì – không chọn được, mời chọn ghế khác`, "bad"); },
  "cancel-draft"() { releaseDraft(); save(); go("lich"); },
  "to-checkout"() { go("thanhtoan"); },
  "back-seats"() { go("ghe"); },
  "pay-method"(el) { S.view.payMethod = el.dataset.v; render(); },
  async "pay-ok"(el) {
    const d = S.draft;
    if (!d || new Date(d.until) < new Date()) { releaseDraft("Ghế đã hết hạn giữ – giao dịch tự huỷ"); save(); return go("lich"); }
    const sh = show(d.showId), f = film(sh.filmId);
    // vé phim giới hạn tuổi dùng tuổi đã xác thực của tài khoản → chủ tài khoản xác nhận bằng Face ID/vân tay
    // vé cho bạn đi cùng dùng tuổi đã xác thực của chính bạn đó → không cần chủ tài khoản xác nhận sinh trắc
    const selfAge = RATINGS[f.rating] > 0 && d.assign.some(a => a.viewer.kind !== "other" && a.viewer.kind !== "friend" && S.user.linked);
    let pkFallback = false;
    if (selfAge) { const r = await requirePasskey(`Mua vé phim ${f.rating} bằng tuổi đã xác thực`); if (r === "cancel") return; if (r === "fallback") pkFallback = true; }
    else if (S.user.confirmEvery && S.user.passkey) { const r = await Passkey.verify(S.user.passkey); log("passkey", `Xác nhận đặt vé đơn ${d.id}: ${r.ok ? "đạt" : r.message}`, r.ok); if (!r.ok) return toast(r.message, "bad"); }
    const chk = checkOrder(sh, d.assign); let pts = 0;
    chk.res.forEach((r, i) => log("age", `Đơn ${d.id} ghế ${d.seats[i]} – ${f.rating} – ${r.name}: ${r.block ? r.reason : r.needDoc || (pkFallback && r.verified) ? "cần kiểm tra giấy tờ" : "đạt"}`, !r.block));
    const tks = d.seats.map((sid, i) => { const r = chk.res[i], aud = audience(r.verified || r.level === "Cam kết" ? r.age : null), price = seatPrice(sh, sid, aud.key); pts += Math.round(price * 0.05 / 1000);
      const nd = r.needDoc || (pkFallback && r.verified && RATINGS[f.rating] > 0);
      return { code: rid("V"), orderId: d.id, owner: "user", ownerUser: Auth.user.username, viewerUser: r.user || null, showId: d.showId, seat: sid, viewerName: r.name, aud: aud.label, verified: r.verified, needDoc: nd, reason: pkFallback && r.verified && !r.needDoc ? "Thiết bị không xác nhận chính chủ bằng sinh trắc – kiểm tra giấy tờ tại cửa" : r.reason, price, status: "valid", channel: "Online" }; });
    el.disabled = true;
    const args = { p_show: d.showId, p_hold: d.id, p_tickets: tks.map(t => ({ code: t.code, order_id: t.orderId, device_id: Remote.DEVICE, seat: t.seat, viewer_name: t.viewerName, viewer_user: t.viewerUser, aud: t.aud, verified: t.verified, need_doc: t.needDoc, reason: t.reason, price: t.price, channel: t.channel })) };
    if (Remote.v5) { args.p_voucher = d.voucher ? d.voucher.code : null; args.p_points = d.points || 0; }
    let ok;
    if (ON()) { try { ok = await rpcAuth("sell_order", args); } catch (e) { el.disabled = false; if (/companion_/.test(e.message)) return toast(Auth.message(e), "bad"); if (/hold_expired/.test(e.message)) { releaseDraft("Ghế đã hết hạn giữ"); save(); return go("lich"); } return toast(Auth.message(e), "bad"); } }
    else ok = true;
    if (!ok) { releaseDraft(); save(); return go("lich"); }
    // realtime có thể đã chèn vé (chưa có viewer_user – máy chủ gắn bạn đi cùng ở bước sau) → giữ thông tin bạn đi cùng đã biết
    tks.forEach(t => { S.seats[d.showId][t.seat] = { st: "sold" }; const ex = S.tickets.find(x => x.code === t.code); ex ? Object.assign(ex, { ownerUser: t.ownerUser, viewerUser: ex.viewerUser || t.viewerUser }) : S.tickets.push(t); });
    if (ok && typeof ok === "object" && ok.points != null) { pts = ok.points_earned; S.user.points = ok.points; Auth.setPoints(ok.points); } else S.user.points += pts;
    log("pay", `Thanh toán đơn ${d.id}: ${vnd(ok && ok.paid != null ? ok.paid : d.total)} (${S.view.payMethod || "momo"})`);
    S.draft = null; S.view.tk = tks[0].code; S.view.vouchers = null; save(); go("ve"); toast(`Đặt vé thành công · ${ok && ok.discount > 0 ? "giảm " + vnd(ok.discount) + " · " : ""}cộng ${pts} điểm`); },
  "qr-split"() { S.view.splitQr = !S.view.splitQr; render(); },
  "hist-open"(el) { S.view.tk = el.dataset.code; go("ve"); },
  "ticket-pick"(el) { S.view.tk = el.dataset.code; render(); window.scrollTo({ top: 0, behavior: "smooth" }); },
  async refund(el) { const t = S.tickets.find(x => x.code === el.dataset.code), mins = (new Date(show(t.showId).start) - new Date()) / 60000;
    if (mins < S.params.refundMin) return toast(`Chỉ hoàn trước giờ chiếu ${S.params.refundMin} phút (còn ${Math.max(0, Math.round(mins))} phút)`);
    if (S.user.refunds >= S.params.refundLimit[tier()]) return toast("Đã hết lượt hoàn vé tháng này");
    if (!confirm(`Hoàn vé ${t.code}? Tiền vào thẻ quà tặng.`)) return;
    const ok = await call("refund_ticket", { p_code: t.code }); if (!ok) { if (ok === false || ok === null) toast("Vé đã được sử dụng hoặc đã hoàn"); return; }
    t.status = "refunded"; delete S.seats[t.showId][t.seat]; S.user.refunds++; const g = ok && ok.gift ? { code: ok.gift, amount: Number(ok.amount) } : { code: rid("GC"), amount: t.price }; if (!ok.gift) S.gifts.push(g); S.view.vouchers = null; log("refund", `Hoàn vé ${t.code} → thẻ quà tặng ${g.code}`); save(); render(); toast("Đã hoàn vào thẻ quà tặng " + g.code); },
  async "pk-create"() { await setupPasskey(); render(); },
  async "pk-test"() { const r = await Passkey.verify(S.user.passkey); toast(r.ok ? `Xác thực ${S.user.passkey.label} thành công – chữ ký hợp lệ` : r.message, r.ok ? "" : "bad"); log("passkey", `Thử passkey: ${r.ok ? "đạt" : r.message}`, r.ok); },
  "pk-del"() { S.user.passkey = null; save(); render(); toast("Đã tắt passkey trên tài khoản"); },
  async "pk-reveal"(el) { const r = await Passkey.verify(S.user.passkey); if (!r.ok) return toast(r.message, "bad"); REVEAL[el.dataset.code] = Date.now() + 60000; log("passkey", `Mở vé ${el.dataset.code} bằng ${S.user.passkey.label}`); render(); setTimeout(() => scheduleRender(), 60500); },
  /* vé đoàn */
  "vneid-teacher"() { verifyFace({ who: "teacher", title: "Xác thực người phụ trách đoàn", onDone(id) { Object.assign(S.teacher, { linked: true, name: id.name, dob: id.dob, key: id.key }); log("vneid", `Người phụ trách ${id.name} xác thực VNeID + FaceID`); } }); },
  "new-group"() { S.view.gdraft = { id: rid("DO", 4), step: 0, showId: null, students: [], commit: false }; save(); render(); },
  "g-cancel"() { S.view.gdraft = null; save(); render(); },
  "g-show"(el) { const g = S.view.gdraft; g.showId = el.dataset.show; g.step = 1; save(); render(); },
  "g-sample"(el) { S.view.gdraft.students = sampleClass(el.dataset.k); save(); render(); },
  "g-parse"() { const out = []; ($("#g-csv").value || "").split(/\n/).map(x => x.trim()).filter(Boolean).forEach((ln, i) => { const [name, dob, cls] = ln.split(",").map(x => x.trim()); const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(dob || ""); if (name && m) out.push({ id: "hs" + i, name, dob: `${m[3]}-${pad(m[2])}-${pad(m[1])}`, cls: cls || "", parentOk: false, entered: false }); });
    if (!out.length) return toast("Không đọc được dòng nào. Định dạng: Họ tên, dd/mm/yyyy, Lớp"); S.view.gdraft.students = out; save(); render(); toast(`Đã đọc ${out.length} học sinh`); },
  "g-next"() { const g = S.view.gdraft; if (g.step === 1 && g.students.length < S.params.groupMin) return toast(`Tối thiểu ${S.params.groupMin} người`); g.step++; save(); render(); },
  "g-back"() { S.view.gdraft.step--; save(); render(); },
  "g-change"() { S.view.gdraft.step = 0; save(); render(); },
  "g-drop"() { const g = S.view.gdraft, sh = show(g.showId), chk = groupRule(film(sh.filmId).rating, g.students, sh.start), n = g.students.length; g.students = g.students.filter((s, i) => chk[i].ok); save(); render(); toast(`Đã bỏ ${n - g.students.length} em`); },
  "g-sms"() { toast(`Đã gửi ${S.view.gdraft.students.length} SMS (mô phỏng)`); },
  "g-parent-many"() { S.view.gdraft.students.forEach((s, i) => { if (i % 10 !== 3) s.parentOk = true; }); log("parent", `Đơn ${S.view.gdraft.id}: phụ huynh xác nhận qua VNeID`); save(); render(); },
  "g-parent-one"() { const s = S.view.gdraft.students.find(x => !x.parentOk); if (!s) return toast("Tất cả đã xác nhận"); verifyFace({ who: "parent", title: `Phụ huynh của ${s.name}`, onDone(id) { s.parentOk = true; log("parent", `Phụ huynh ${id.name} xác nhận cho ${s.name}`); } }); },
  "g-drop-unconfirmed"() { const g = S.view.gdraft; g.students = g.students.filter(s => s.parentOk); save(); render(); },
  async "g-pay"(el) { const g = S.view.gdraft, sh = show(g.showId), r = room(sh.roomId), need = g.students.length + 1, seats = [];
    outer: for (let i = r.rows - 1; i >= 0; i--) for (let j = 0; j < r.cols; j++) { const sid = seatId(i, j); if (!seatState(sh.id, sid)) { seats.push(sid); if (seats.length === need) break outer; } }
    if (seats.length < need) return toast("Không đủ ghế cho đoàn ở suất này");
    const code = "G-" + rid("", 5), unit = Math.round(priceLegend(sh).std * (1 - S.params.groupDiscount) / 1000) * 1000;
    const students = g.students.map((s, i) => ({ ...s, id: code + "-" + pad(i + 1), card: code + "-" + pad(i + 1), idx: i, entered: false }));
    el.disabled = true;
    const ok = await call("create_group", { p_code: code, p_show: sh.id, p_seats: seats, p_teacher: S.teacher.name, p_teacher_key: S.teacher.key || "gv", p_org: S.teacher.org, p_total: unit * need, p_members: students.map(s => ({ card: s.card, idx: s.idx, name: s.name, dob: s.dob, cls: s.cls })) });
    if (!ok) { if (ok === false) toast("Có ghế vừa bị đặt ở máy khác – bấm lại để chọn khối ghế mới"); return render(); }
    seats.forEach(sid => S.seats[sh.id][sid] = { st: "sold", grp: true });
    const ex = S.groups.find(x => x.code === code), grp = { id: code, code, showId: sh.id, seats, teacher: S.teacher.name, teacherKey: S.teacher.key || "gv", org: S.teacher.org, students, total: unit * need, status: "valid", counted: 0 };
    ex ? Object.assign(ex, grp, { students: ex.students.length ? ex.students : students }) : S.groups.push(grp);
    log("group", `Phát hành vé đoàn ${code}: ${g.students.length} HS, cam kết bởi ${S.teacher.name}`); S.view.gdraft = null; S.view.lastGroup = code; save(); render(); toast("Đã phát hành vé đoàn " + code); },
  /* quầy */
  async "pos-seat"(el) { const p = S.view.pos, list = el.dataset.group ? el.dataset.group.split(",") : [el.dataset.seat], hold = "POS-" + Remote.DEVICE;
    if (list.some(sid => p.seats.includes(sid))) { list.forEach(sid => { const i = p.seats.indexOf(sid); if (i >= 0) p.seats.splice(i, 1); delete S.seats[p.showId][sid]; call("release_seat", { p_show: p.showId, p_seat: sid, p_hold: hold }); }); }
    else { if (list.some(sid => seatState(p.showId, sid))) return; const until = new Date(Date.now() + 600000).toISOString(); const got = [];
      for (const sid of list) { const ok = await call("hold_seat", { p_show: p.showId, p_seat: sid, p_hold: hold, p_until: until }); if (!ok) { got.forEach(g => call("release_seat", { p_show: p.showId, p_seat: g, p_hold: hold })); if (ok === false) toast("Ghế vừa có người khác giữ"); return render(); } got.push(sid); }
      list.forEach(sid => { p.seats.push(sid); S.seats[p.showId][sid] = { st: "held", by: hold, until }; }); }
    save(); render(); },
  "pos-docok"(el) { const sid = el.dataset.seat, type = selVal("pos-doc-" + sid); if (!type) return toast("Chọn loại giấy tờ trước"); S.view.pos.docs[sid] = { type, ok: el.dataset.ok === "1" }; log("doc", `Quầy – ghế ${sid}: ${type} – ${el.dataset.ok === "1" ? "đạt" : "không đạt"}`, el.dataset.ok === "1"); save(); render(); },
  async "pos-pay"(el) { const p = S.view.pos, sh = show(p.showId), f = film(sh.filmId);
    const bad = p.seats.filter(sid => p.docs[sid]?.ok === false && RATINGS[f.rating] > 0); if (bad.length) return toast("Vé không đạt độ tuổi – bỏ ghế " + bad.join(", ") + " trước");
    const tks = p.seats.map(sid => { const ty = p.types[sid] || "adult", ok = p.docs[sid]?.ok !== false;
      return { code: rid("V"), orderId: "POS", owner: "pos", ownerUser: null, showId: p.showId, seat: sid, viewerName: "Khách tại quầy", aud: { adult: "Người lớn", child: "Trẻ em", u22: "U22", senior: "Người cao tuổi" }[ok ? ty : "adult"], verified: !!p.docs[sid], needDoc: false, price: seatPrice(sh, sid, ok ? ty : "adult"), status: "valid", channel: "Quầy" }; });
    el.disabled = true;
    const okSell = await call("sell_order", { p_show: p.showId, p_hold: "POS-" + Remote.DEVICE, p_tickets: tks.map(t => ({ code: t.code, order_id: "POS", device_id: Remote.DEVICE, seat: t.seat, viewer_name: t.viewerName, aud: t.aud, verified: t.verified, need_doc: false, reason: "", price: t.price, channel: "Quầy" })) });
    if (!okSell) return render();
    tks.forEach(t => { S.seats[p.showId][t.seat] = { st: "sold" }; if (!S.tickets.some(x => x.code === t.code)) S.tickets.push(t); });
    log("pos", `Quầy bán ${p.seats.length} vé – ${el.dataset.m}`); S.view.pos = { showId: p.showId, seats: [], types: {}, docs: {} }; save(); render(); toast(`Đã thu tiền và in ${tks.length} vé: ${tks.map(t => t.code).join(", ")}`); },
  /* soát vé */
  "gate-method"(el) { if (GATE.stop) { GATE.stop(); GATE.stop = null; } GATE.method = el.dataset.v; render(); },
  "gate-scan"() { const v = $("#gate-code")?.value; gateProcess(v, "gõ tay"); },
  async "gate-nfc"() { toast("Chạm thẻ NFC vào điện thoại…"); try { let stop = null; stop = await Nfc.read({ onTag: tag => { stop && stop(); gateProcess(tag.text, "NFC"); }, onError: m => toast(m, "bad") }); } catch (e) { toast("Không bật được NFC: " + e.message, "bad"); } },
  async "gate-doc"(el) { const t = S.tickets.find(x => x.code === el.dataset.code), ok = el.dataset.ok === "1", type = selVal("gate-doc") || "Căn cước"; log("doc", `Cửa – vé ${t.code}: ${type} – ${ok ? "đủ điều kiện" : "không đạt"}`, ok);
    if (ok) { if (!(await admit(t))) { S.view.gate = { result: { kind: t.status, code: t.code } }; return gateRefresh(); } log("gate", `Vào phòng sau kiểm tra giấy tờ: ${t.code}`); gatePush(t.code, "ok", `${type} – đạt`); S.view.gate = { result: { kind: "ok", code: t.code } }; }
    else { gatePush(t.code, "rejected", `${type} – không đạt`); S.view.gate = {}; }
    save(); gateRefresh(); toast(ok ? "Đã cho vào" : "Đã ghi nhận từ chối"); },
  async "gate-early"(el) { const t = S.tickets.find(x => x.code === el.dataset.code), qr = S.view.gate.result && S.view.gate.result.qr; log("gate", `Cho vào sớm vé ${t.code} (nhân viên ${Auth.user.name} quyết định)`); await gateTicketFlow(t, qr, "cho vào sớm", true); save(); gateRefresh(); },
  async "gate-admit-order"() {
    const r = S.view.gate.result; if (!r || r.kind !== "order") return;
    const codes = [...document.querySelectorAll('#gate-result input[data-order-code]:checked')].map(i => i.dataset.orderCode);
    if (!codes.length) return toast("Chọn ít nhất một vé");
    let res; try { res = await Remote.rpc("admit_many_s", { p_token: Auth.token, p_codes: codes }); } catch (e) { return toast(Auth.message(e), "bad"); }
    const okN = codes.filter(c => res[c] === "valid").length, dup = codes.filter(c => res[c] === "used");
    codes.forEach(c => { const t = S.tickets.find(x => x.code === c); if (t && res[c] === "valid") t.status = "used"; });
    log("gate", `Đơn ${r.code}: cho vào ${okN} vé${dup.length ? `, ${dup.length} vé đã dùng` : ""} (${codes.join(", ")})`, okN > 0);
    gatePush(r.code, "ok", `đơn: cho vào ${okN} người${dup.length ? " · " + dup.length + " vé đã dùng" : ""}`);
    toast(`Đã cho vào ${okN} người${dup.length ? ` · ${dup.length} vé đã quét ở cửa khác` : ""}`, dup.length ? "bad" : "");
    r.order = (await fetchOrder(r.code)) || r.order; save(); gateRefresh(); },
  "age-check"(el) {
    if (el.dataset.seat) { // quầy vé
      const p = S.view.pos, sh = show(p.showId), sid = el.dataset.seat;
      return openAgeCheck({ rating: film(sh.filmId).rating, when: sh.start, title: `Kiểm tuổi ghế ${sid}`, onResult(r) { p.docs[sid] = { type: r.method, ok: r.ok, age: r.age }; save(); render(); toast(r.ok ? `Ghế ${sid}: ${r.name}, ${r.age} tuổi – đạt` : `Ghế ${sid}: không đạt – ${r.reason}`, r.ok ? "" : "bad"); } });
    }
    const t = S.tickets.find(x => x.code === el.dataset.code), sh = show(t.showId), f = film(sh.filmId), prev = S.view.gate.result || {};
    openAgeCheck({ rating: f.rating, when: sh.start, expectName: t.viewerName, mode: el.dataset.mode, title: `Kiểm tuổi vé ${t.code}`, async onResult(r) {
      if (r.ok) {
        if (!(await admit(t))) { S.view.gate = { result: { kind: t.status, code: t.code } }; return gateRefresh(); }
        log("gate", `Vào phòng sau kiểm tuổi qua ${r.method}: ${t.code}`); gatePush(t.code, "ok", `${r.name}, ${r.age} tuổi · ${r.method}`);
        if (prev.kind === "order") { prev.order = (await fetchOrder(prev.code)) || prev.order; S.view.gate = { result: prev }; toast(`${r.name} – cho vào (ghế ${t.seat})`); }
        else S.view.gate = { result: { kind: "ok", code: t.code, qr: prev.qr, via: `${r.method}: ${r.name}, ${r.age} tuổi`, recordId: r.recordId } };
      } else { gatePush(t.code, "rejected", `${r.name || ""}${r.age != null ? ", " + r.age + " tuổi" : ""} · ${r.method} – ${r.reason}`); S.view.gate = {}; toast("Đã ghi nhận từ chối: " + r.reason, "bad"); }
      save(); gateRefresh(); } });
  },
  "export-age"() {
    const rows = [["Thời điểm", "Nguồn", "Loại", "Nội dung", "Kết quả"]];
    S.logs.filter(l => ["age", "gate", "spot", "doc", "vneid", "parent"].includes(l.type)).forEach(l => rows.push([new Date(l.t).toLocaleString("vi-VN"), "Nhật ký rạp", l.type, l.msg, l.ok ? "Đạt" : "Từ chối"]));
    (S.verifs || []).filter(v => ["doc", "qr", "vneid", "faceid"].includes(v.kind)).forEach(v => rows.push([new Date(v.created_at).toLocaleString("vi-VN"), `Supabase #${v.id}`, v.kind, `${v.account_name || ""} · ${verifDetail(v)}`, v.ok ? "Đạt" : "Không đạt"]));
    const q = c => '"' + String(c ?? "").replace(/"/g, '""') + '"';
    const csv = "\ufeff" + rows.map(r => r.map(q).join(",")).join("\r\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = `nhat-ky-kiem-tra-tuoi-${dmy(new Date()).replace(/\//g, "-")}.csv`; document.body.appendChild(a); a.click(); a.remove();
    S.view.lastExport = rows.length - 1; toast(`Đã xuất ${rows.length - 1} dòng`); },
  "lab-age"() {
    const rating = LAB.ageRating || "T18", min = RATINGS[rating] || 0;
    const mark = (id, ok, note) => { setCase(id, ok, note); refreshLabCard("cccd"); };
    openAgeCheck({ rating, when: new Date(), title: `Kiểm thử kiểm tuổi phim ${rating}`, onBad(m) { mark("c-bad", true, m); },
      onResult(r) {
        const adult = r.age >= min, note = `${r.name}, ${r.age} tuổi · ${r.ok ? "cho vào" : "từ chối"}${r.recordId ? " · bản ghi #" + r.recordId : ""}`;
        if (/QR/.test(r.method)) mark(adult ? "c-adult" : "c-minor", adult ? r.ok === true : r.ok === false, note);
        if (/chip/.test(r.method)) mark("c-chip", true, note);
        if (/FaceID/.test(r.method)) mark("c-face", true, note);
        render(); } }); },
  "lab-age-rating"(el) { LAB.ageRating = el.dataset.v; render(); },
  "seat-info"(el) { const sh = show(el.closest("[data-show]")?.dataset.show || (S.view.pos || {}).showId); if (sh) seatDetail(sh, el.dataset.seat); },
  "gate-face"(el) { const grp = S.groups.find(x => x.code === el.dataset.code); verifyFace({ who: "gate-teacher", title: "Đối chiếu người phụ trách", fixedKey: grp.teacherKey || "gv", onDone(id, r) { grp.faceOk = true; grp.faceScore = r.score; call("group_update", { p_code: grp.code, p_counted: null, p_face_ok: true, p_face_score: r.score, p_finish: false }); log("gate", `Đối chiếu khuôn mặt ${grp.teacher}: ${r.score ?? "ảnh gốc mới"}%`); } }); },
  "gate-count"(el) { const grp = S.groups.find(x => x.code === S.view.gate.result.code); grp.counted = Math.max(0, Math.min(grp.students.length, (grp.counted || 0) + Number(el.dataset.d))); if (grp.counted === grp.students.length && Number(el.dataset.d) > 0) toast("Đã đủ số học sinh – người tiếp theo bị chặn"); call("group_update", { p_code: grp.code, p_counted: grp.counted, p_face_ok: null, p_face_score: null, p_finish: false }); save(); gateRefresh(); },
  "gate-card-camera"() { openScanner("Quét thẻ học sinh", code => scanCard(code.trim().toUpperCase())); },
  async "gate-card-nfc"() { toast("Chạm thẻ học sinh vào điện thoại…"); try { let stop = null; stop = await Nfc.read({ onTag: tag => { stop && stop(); scanCard((tag.text || "").trim().toUpperCase()); }, onError: m => toast(m, "bad") }); } catch (e) { toast("Không bật được NFC: " + e.message, "bad"); } },
  "gate-next-card"() { const grp = S.groups.find(x => x.code === S.view.gate.result.code), s = grp.students.find(x => !x.entered); s ? scanCard(s.card) : toast("Đã quét hết thẻ"); },
  "gate-dup"() { const grp = S.groups.find(x => x.code === S.view.gate.result.code), s = grp.students.find(x => x.entered); s ? scanCard(s.card) : toast("Chưa có thẻ nào được quét"); },
  "gate-foreign"() { scanCard("G-XXXXX-99"); },
  "gate-spotpick"() { const grp = S.groups.find(x => x.code === S.view.gate.result.code); grp.spot = grp.students.filter(s => s.entered).map(s => s.id).sort(() => Math.random() - .5).slice(0, S.params.spot); save(); gateRefresh(); },
  "gate-spot"(el) { const grp = S.groups.find(x => x.code === S.view.gate.result.code), s = grp.students.find(x => x.id === el.dataset.id); s.spot = el.dataset.ok === "1"; call("member_spot", { p_card: s.card, p_ok: s.spot }); log("spot", `Kiểm tra ngẫu nhiên ${s.name} (${grp.code}): ${s.spot ? "khớp" : "không khớp"}`, s.spot); save(); gateRefresh(); },
  "gate-finish"() { const grp = S.groups.find(x => x.code === S.view.gate.result.code), f = film(show(grp.showId).filmId); grp.enteredCount = RATINGS[f.rating] >= 13 ? grp.students.filter(s => s.entered).length : (grp.counted || 0); grp.status = "used"; call("group_update", { p_code: grp.code, p_counted: grp.enteredCount, p_face_ok: null, p_face_score: null, p_finish: true }); log("gate", `Vé đoàn ${grp.code}: ${grp.enteredCount}/${grp.students.length} vào`); gatePush(grp.code, "group", `Hoàn tất ${grp.enteredCount}/${grp.students.length}`); S.view.gate = {}; save(); gateRefresh(); toast("Đã hoàn tất soát vé đoàn"); },
  /* suất chiếu */
  "suat-day"(el) { S.view.sday = el.dataset.v; if (S.view.ns) S.view.ns.day = el.dataset.v; save(); render(); },
  "focus-ns"() { const x = $("#ns-time"); if (x) { x.scrollIntoView({ behavior: "smooth", block: "center" }); x.focus(); } },
  async "add-show"() {
    const f = S.view.ns; if (!f || !f._s0) return;
    const s0 = f._s0, e0 = f._e0, id = rid("s", 6);
    let clash = S.shows.find(s => s.roomId === f.room && new Date(s.start) < e0 && endOf(s) > s0);
    if (!clash && ON()) { const cid = await call("add_show", { p_id: id, p_film: f.film, p_room: f.room, p_start: s0.toISOString(), p_end: e0.toISOString() }, null); if (cid === null && !show(id) && Remote.v4 === false) return; if (cid) clash = show(cid) || { start: s0, filmId: f.film, roomId: f.room }; }
    if (clash) { toast(`Trùng suất ${hhmm(clash.start)} (${film(clash.filmId).title})`, "bad"); return render(); }
    if (!show(id)) S.shows.push({ id, filmId: f.film, roomId: f.room, cinemaId: room(f.room).cinemaId, format: formatOf({ roomId: f.room }), start: s0.toISOString(), end: e0.toISOString(), status: "on" }); S.seats[id] ||= {};
    log("admin", `Thêm suất ${film(f.film).title} ${ddmm(s0)} ${hhmm(s0)}`); f.time = ""; delete f._s0; delete f._e0; save(); render(); toast("Đã thêm suất chiếu"); },
  /* tài khoản & quyền */
  async "create-user"() {
    const name = $("#nu-name").value.trim(), u = $("#nu-user").value.trim().toLowerCase(), p = $("#nu-pass").value, role = selVal("nu-role");
    if (name.length < 2) return toast("Nhập họ tên", "bad");
    const args = { p_token: Auth.token, p_user: u, p_pass: p, p_name: name, p_role: role };
    if (Remote.v6 && role !== "khach") args.p_cinema = staffCinemaId() || S.view.nu.cinema || null;
    try { await Remote.rpc("create_user", args); S.view.users = null; toast(`Đã tạo tài khoản @${u}`); render(); }
    catch (e) { toast(Auth.message(e), "bad"); } },
  /* kiểm thử */
  "lab-expect"(el) { LAB.expect = el.dataset.v; render(); },
  "lab-filter"(el) { LAB.filter = el.dataset.v; render(); },
  "lab-clear"() { S.labCases = {}; LAB.qr.last = null; save(); render(); },
  "lab-face"() { verifyFace({ who: "lab", title: "Kiểm thử FaceID", onResult(r) {
      if (r.error && r.error !== "noface") return;
      if (r.enrolled) setCase("f-enroll", r.ok, r.recordId ? `Bản ghi #${r.recordId}` : "Lưu trên thiết bị (chưa có máy chủ)");
      else if (LAB.expect === "same") setCase("f-same", !!r.ok, r.ok ? `Tương đồng ${r.score}% · khoảng cách ${r.dist}` : `Bị từ chối dù cùng người: khoảng cách ${r.dist}`);
      else setCase("f-other", !r.ok, !r.ok ? `Từ chối đúng: khoảng cách ${r.dist} > ${FaceKit.THRESHOLD}` : `Nhận nhầm: tương đồng ${r.score}%`);
      if (r.live) setCase("f-live", true, `Người thật qua ${r.liveBy === "blink" ? "chớp mắt" : "quay đầu"} · ${r.perf ? r.perf.ms + " ms/khung" : ""}`);
      setCase("f-saved", !!r.recordId, r.recordId ? `Bản ghi #${r.recordId}${r.vneidRecord ? ` + VNeID #${r.vneidRecord}` : ""}` : "Không có mã bản ghi – kiểm tra migration 002");
      if (r.vneidRecord) setCase("v-link", true, `Bản ghi VNeID #${r.vneidRecord}`);
      LAB.citizens = null; } }); },
  "lab-vneid"() { verifyFace({ who: "lab", title: "Liên kết VNeID (kiểm thử)", onResult(r) { if (r.ok) setCase("v-link", !!r.vneidRecord, r.vneidRecord ? `Bản ghi VNeID #${r.vneidRecord}` : "Chưa lưu được – kiểm tra migration 002"); LAB.citizens = null; } }); },
  async "lab-pk-create"() { try { LAB.pk = await Passkey.register({ userKey: "lab-" + Auth.user.username, name: Auth.user.name + " (kiểm thử)" }); const s = await logVerif("passkey", true, { method: LAB.pk.label, detail: { msg: "tạo passkey kiểm thử" } }); setCase("p-create", true, `${LAB.pk.label} · ${LAB.pk.alg === -7 ? "ES256" : "RS256"}${s ? " · bản ghi #" + s.id : ""}`); } catch (e) { setCase("p-create", false, e.name === "NotAllowedError" ? "Người dùng huỷ" : e.message); } render(); },
  async "lab-pk-verify"() { const r = await Passkey.verify(LAB.pk); const s = await logVerif("passkey", r.ok, { method: LAB.pk.label, detail: { msg: r.ok ? "chữ ký hợp lệ" : r.message } }); setCase("p-verify", r.ok, (r.ok ? "Chữ ký hợp lệ" : r.message) + (s ? " · bản ghi #" + s.id : "")); render(); },
  async "lab-reset-face"(el) { try { await call("reset_citizen_face", { p_key: el.dataset.key }); FaceKit.clearRef(el.dataset.key); toast("Đã xoá ảnh gốc – lần quét sau sẽ đăng ký lại"); } catch (e) {} LAB.citizens = null; render(); },
  async "lab-chip"() {
    const key = selVal("chip-key") || "an"; let data = null;
    if (Remote.v2) { try { data = await Remote.rpc("mock_chip_read", { p_key: key }); } catch (e) {} }
    if (!data) { const i = IDENTITIES.find(x => x.key === key); data = { name: i.name, dob: i.dob, id_number: "040000000000" }; }
    const saved = await logVerif("nfc", true, { key, method: "chip CCCD (mô phỏng)", detail: { name: data.name, dob: data.dob } });
    LAB.chip = { ...data, saved: saved ? { recordId: saved.id, savedAt: saved.saved_at } : null };
    setCase("n-chip", !!saved, saved ? `${data.name} · bản ghi #${saved.id}` : "Không lưu được – kiểm tra migration 002"); render(); },
  async "nfc-read"() {
    const n = LAB.nfc; n.err = "";
    try {
      n.stop = await Nfc.read({
        onTag: async tag => { const saved = await logVerif("nfc", true, { method: "thẻ NDEF", detail: { serial: tag.serial, text: tag.text } }); n.last = { ...tag, saved: saved ? { recordId: saved.id, savedAt: saved.saved_at } : null }; setCase("n-read", true, `UID ${tag.serial || "–"}${tag.text ? " · " + tag.text : ""}${saved ? " · bản ghi #" + saved.id : ""}`); render(); },
        onError: m => { n.err = m; setCase("n-read", false, m); render(); },
      });
      n.on = true;
    } catch (e) { n.err = e.name === "NotAllowedError" ? "Bạn chưa cho phép dùng NFC." : "Không bật được NFC: " + e.message; setCase("n-read", false, n.err); }
    render(); },
  "nfc-stop"() { const n = LAB.nfc; n.stop && n.stop(); n.on = false; n.stop = null; render(); },
  async "nfc-write"() {
    const t = $("#nfc-text").value.trim(); if (!t) return toast("Nhập nội dung cần ghi"); toast("Chạm thẻ trống vào mặt sau điện thoại…");
    try { await Nfc.write(t); toast("Đã ghi " + t + " vào thẻ"); const s = await logVerif("nfc", true, { method: "ghi thẻ NDEF", detail: { text: t } }); setCase("n-write", true, `Ghi "${t}"${s ? " · bản ghi #" + s.id : ""}`); }
    catch (e) { const m = e.name === "NotAllowedError" ? "Bạn chưa cho phép dùng NFC" : "Không ghi được thẻ: " + e.message; toast(m, "bad"); setCase("n-write", false, m); }
    render(); },
  async "qr-make"() {
    LAB.qr.busy = true; render();
    try {
      let t = S.tickets.find(x => x.status === "valid" && show(x.showId) && new Date(show(x.showId).start) > new Date());
      if (!t) { // tạo một vé thử ở suất sắp tới
        const sh = S.shows.filter(s => new Date(s.start) > new Date() && freeSeats(s) > 0).sort((a, b) => new Date(a.start) - new Date(b.start))[0];
        if (!sh) throw new Error("Không còn suất nào để tạo vé thử");
        const r = room(sh.roomId); let sid = null; for (let i = r.rows - 1; i >= 0 && !sid; i--) for (let j = r.cols - 1; j >= 0; j--) if (!seatState(sh.id, seatId(i, j))) { sid = seatId(i, j); break; }
        const hold = rid("LAB"), code = rid("V");
        await Remote.rpc("hold_seat", { p_show: sh.id, p_seat: sid, p_hold: hold, p_until: new Date(Date.now() + 120000).toISOString() });
        await Remote.rpc("sell_order_u", { p_token: Auth.token, p_show: sh.id, p_hold: hold, p_tickets: [{ code, order_id: "LAB", device_id: Remote.DEVICE, seat: sid, viewer_name: "Vé kiểm thử", aud: "Người lớn", verified: false, need_doc: false, reason: "", price: 0, channel: "Kiểm thử" }] });
        t = await Remote.fetchTicket(code); if (t && !S.tickets.some(x => x.code === code)) S.tickets.push(t);
      }
      const ok = await Remote.rpc("ticket_qr", { p_token: Auth.token, p_code: t.code }), old = await Remote.rpc("ticket_qr", { p_token: Auth.token, p_code: t.code, p_back: 3 });
      const p = ok.payload.split("."), other = t.code.slice(0, -1) + (t.code.endsWith("A") ? "B" : "A");
      LAB.qr.samples = { code: t.code, at: new Date().toISOString(), ok: ok.payload, expired: old.payload, forged: `CV1.${other}.${p[2]}.${p[3]}`, static: t.code };
    } catch (e) { toast(Auth.message(e) + (e.message && !/forbidden|not_logged/.test(e.message) ? " (" + e.message + ")" : ""), "bad"); }
    LAB.qr.busy = false; render(); },
  "qr-check"(el) { labQrVerify(LAB.qr.samples[el.dataset.k], "kiểm tra trực tiếp"); },
  "qr-cam"() { openScanner("Quét QR kiểm thử", code => labQrVerify(code, "camera")); },
  "haar-cam"() {
    LAB.haar.err = ""; LAB.haar.stats = { status: "Đang khởi động…" }; LAB.haar.img = null;
    LAB.haar.stop = () => {}; render();
    const host = $("#haar-stage"); host.setAttribute("data-keep", "");
    FaceKit.preload();
    LAB.haar.stop = Haar.runLive(host, {
      onStats(s) { LAB.haar.stats = s; const el = $("#haar-stats"); if (el) el.innerHTML = haarStats(s);
        const c = labCases(); let changed = false;
        if (s.faces > 0 && !(c["h-face"] && c["h-face"].ok)) { setCase("h-face", true, "Camera: thấy khuôn mặt"); changed = true; }
        if (s.eyes === 2 && !(c["h-eyes"] && c["h-eyes"].ok)) { setCase("h-eyes", true, "Camera: 2 mắt trong vùng mặt"); changed = true; }
        if (s.blinks > 0 && (!c["h-blink"] || !c["h-blink"].ok || c["h-blink"].n !== s.blinks)) { setCase("h-blink", true, `Đếm được ${s.blinks} lần chớp mắt`); labCases()["h-blink"].n = s.blinks; changed = true; }
        if (s.tinyMs != null && !(c["h-speed"] && c["h-speed"].live)) { setCase("h-speed", true, `Haar ${s.ms} ms · TinyFace ${s.tinyMs} ms mỗi khung 320px`); labCases()["h-speed"].live = true; changed = true; }
        if (changed) refreshLabCard("haar"); },
      onError(m) { LAB.haar.err = m; LAB.haar.stop = null; render(); },
    }); },
  "haar-stop"() { LAB.haar.stop && LAB.haar.stop(); LAB.haar.stop = null; render(); },
};
/* ô chọn tuỳ biến đổi giá trị */
let CINEMA_SHEET = null;
/* ---------- hộp thoại quản trị: form cơ sở / phòng / phim / suất ---------- */
const SELECT = "h-11 md:h-10 w-full rounded-xl border border-border-strong bg-surface px-3 text-base md:text-sm outline-hidden focus:border-focus focus:ring-2 focus:ring-focus";
const sel = (id, opts, v) => `<select id="${id}" class="${SELECT}">${opts.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
const chk = (id, label, on) => `<label class="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" id="${id}" ${on ? "checked" : ""} class="size-4 accent-[var(--primary)]">${label}</label>`;
/** Mở hộp thoại có các nút data-act xử lý riêng (bộ xử lý chung bỏ qua phần tử trong #modal-root) */
function adminSheet(html, handlers, opts = {}) {
  const sh = openSheet(html, { label: opts.label || "Quản trị", wide: opts.wide });
  sh.el.addEventListener("click", async e => { const b = e.target.closest("[data-act]"); if (b && handlers[b.dataset.act]) { e.preventDefault(); b.disabled = true; try { await handlers[b.dataset.act](b, sh); } finally { if (document.body.contains(b)) b.disabled = false; } } else if (e.target.closest('[data-m="close"]')) sh.close(); });
  return sh;
}
const v = id => ($("#" + id)?.value ?? "").trim();
/** Gọi hàm máy chủ 008 nếu có; không có máy chủ → chỉ sửa cục bộ (demo ngoại tuyến) */
async function adminCall(name, args, local) {
  if (Remote.v8 && Auth.token) { await Remote.rpc(name, { p_token: Auth.token, ...args }); await Remote.reloadCatalog(); }
  else if (ON()) throw new Error("need_008");
  else local();
}
function cinemaSheet(c) {
  const isNew = !c; c = c || { id: "", name: "CineVin ", city: "", district: "", address: "", hotline: "1900 6017", tier: "B", active: true };
  const html = `${sheetHead(isNew ? "Thêm cơ sở" : `Sửa cơ sở ${c.id}`, isNew ? "Mã 3 chữ số đi vào mã suất, mã phòng và QR vé – đặt một lần, không đổi." : esc(c.name))}
    <div class="grid gap-3 sm:grid-cols-2">${field("Mã cơ sở", input("cs-id", c.id, `placeholder="088" inputmode="numeric" maxlength="3" ${isNew ? "" : "disabled"}`))}${field("Tên", input("cs-name", c.name, 'placeholder="CineVin Huế"'))}${field("Tỉnh/Thành", input("cs-city", c.city, 'placeholder="Thừa Thiên Huế" list="cs-cities"'))}<datalist id="cs-cities">${cities().map(x => `<option value="${esc(x)}">`).join("")}</datalist>${field("Quận/Huyện", input("cs-district", c.district, 'placeholder="TP Huế"'))}${field("Địa chỉ", input("cs-address", c.address, 'placeholder="Tầng 4, Vincom Huế, 50A Hùng Vương"'))}${field("Hotline", input("cs-hotline", c.hotline, 'placeholder="1900 6017"'))}${field("Hạng giá", sel("cs-tier", [["A", "A – Hà Nội, TP.HCM (giá cao)"], ["B", "B – tỉnh"]], c.tier), "Bảng giá vé theo hạng; phụ thu VIP/3D/GOLD/IMAX đi kèm.")}<div class="flex items-end pb-2">${chk("cs-active", "Đang hoạt động (bỏ chọn = tạm ngưng, khách không thấy)", c.active !== false)}</div></div>
    <div class="flex flex-wrap items-center gap-2"><button type="button" class="${B.primary} min-h-11 md:min-h-10" data-act="save">${ic("save")}Lưu</button>${!isNew && isChainManager() ? `<button type="button" class="${B.ghost} ml-auto text-err" data-act="del">${ic("trash-2")}Xoá cơ sở</button>` : ""}</div>`;
  adminSheet(html, {
    async save(b, sh) {
      const p = { id: isNew ? v("cs-id") : c.id, name: v("cs-name"), city: v("cs-city"), district: v("cs-district"), address: v("cs-address"), hotline: v("cs-hotline"), tier: v("cs-tier") || "B", active: $("#cs-active").checked };
      if (!/^[0-9]{3}$/.test(p.id)) return toast(Auth.message({ message: "bad_cinema_id" }), "bad");
      if (p.name.length < 3 || p.city.length < 2) return toast(Auth.message({ message: "bad_input" }), "bad");
      if (isNew && CINEMAS.some(x => x.id === p.id)) return toast("Mã cơ sở đã tồn tại", "bad");
      try { await adminCall("save_cinema_s", { p }, () => { const i = CINEMAS.findIndex(x => x.id === p.id); i >= 0 ? Object.assign(CINEMAS[i], p) : CINEMAS.push({ ...p }); }); }
      catch (e) { return toast(e.message === "need_008" ? "Máy chủ chưa chạy migration 008" : Auth.message(e), "bad"); }
      log("admin", `${isNew ? "Thêm" : "Sửa"} cơ sở ${p.id} ${p.name}`); sh.close(); save(); render(); toast(`Đã lưu cơ sở ${p.id} · ${p.name}`); },
    async del(b, sh) {
      if (!confirm(`Xoá cơ sở ${c.id} ${c.name}? Chỉ xoá được khi chưa bán vé; nếu không hãy tạm ngưng.`)) return;
      try { await adminCall("delete_cinema_s", { p_id: c.id }, () => { const i = CINEMAS.findIndex(x => x.id === c.id); if (i >= 0) CINEMAS.splice(i, 1); for (let k = ROOMS.length - 1; k >= 0; k--) if (ROOMS[k].cinemaId === c.id) ROOMS.splice(k, 1); S.shows = S.shows.filter(s => cinemaOf(s).id !== c.id); }); }
      catch (e) { return toast(e.message === "need_008" ? "Máy chủ chưa chạy migration 008" : Auth.message(e), "bad"); }
      if (curCinema().id === c.id) setCurCinema(CINEMAS[0].id); if (workCinema().id === c.id) setWorkCinema(CINEMAS[0].id);
      log("admin", `Xoá cơ sở ${c.id}`); sh.close(); save(); render(); toast("Đã xoá cơ sở " + c.id); },
  }, { label: "Cơ sở", wide: true });
}
function roomSheet(cid, r) {
  const isNew = !r, c = cinema(cid), n = roomsOf(cid).length;
  r = r || { id: `${cid}-R${n + 1}`, name: `Phòng ${n + 1}`, kind: "2D", rows: 8, cols: 12, vip: [3, 4, 5], vipSeats: [], couple: [], blocked: [], seatMap: {}, active: true, note: "" };
  // trạng thái trình sửa: loại từng ghế (chỉ ghi ghế khác "thường"); công cụ = một loại ghế trong danh mục (kể cả loại tự tạo)
  const ed = { rows: r.rows, cols: r.cols, tool: "vip", types: {}, groups: {} };
  for (let i = 0; i < r.rows; i++) for (let j = 0; j < r.cols; j++) { const sid = seatId(i, j), k = seatKind(r, sid); if (k !== "std") ed.types[sid] = k; }
  seatGroups(r).forEach((members, sid) => ed.groups[sid] = members);
  // bỏ nhóm chứa ghế: mọi thành viên về thường
  const ungroup = sid => { const g = ed.groups[sid]; if (!g) return; g.forEach(m => { delete ed.types[m]; delete ed.groups[m]; }); };
  // áp loại ghế tại một ghế: loại nhiều chỗ lấy n ghế liền bên phải (hết hàng thì ngắn lại); loại 1 chỗ chỉ ghế đó
  const applyAt = (i, j, tid) => { const ty = seatType(tid), n = ty.sellable && ty.persons > 1 ? Math.min(ty.persons, ed.cols - j) : 1, members = [];
    for (let jj = j; jj < j + n; jj++) { const m = seatId(i, jj); ungroup(m); members.push(m); }
    members.forEach(m => { if (tid === "std") delete ed.types[m]; else ed.types[m] = tid; });
    if (n > 1) members.forEach(m => ed.groups[m] = members); return n; };
  const tools = () => seatTypeList();
  const toolCls = t => t.sellable ? seatColor(t, "tool") : "border-dashed border-border bg-background text-muted";
  const count = () => { const o = {}; tools().forEach(t => o[t.id] = 0); for (let i = 0; i < ed.rows; i++) for (let j = 0; j < ed.cols; j++) { const k = ed.types[seatId(i, j)] || "std"; o[k] = (o[k] || 0) + 1; } return o; };
  const tierSur = t => Number(c.tier === "A" ? t.surchargeA : t.surchargeB) || 0;
  const grid = () => { const half = Math.ceil(ed.cols / 2), cnt = count(), T = tools(); let h = `<div class="mb-2 flex flex-wrap items-center justify-between gap-2"><span class="text-sm font-medium">Loại ghế – chọn công cụ rồi bấm ghế, hoặc bấm chữ hàng để áp cả hàng</span>${isChainManager() ? `<button type="button" class="${B.ghost} min-h-8 px-2 text-xs" data-act="newtype">${ic("plus", "size-3.5")}Loại ghế mới</button>` : ""}</div>
      <div class="mb-3 flex flex-wrap gap-2">${T.map(t => `<button type="button" data-act="tool" data-v="${t.id}" aria-pressed="${ed.tool === t.id}" title="${esc(t.name)}${t.sellable ? ` · ${t.persons} người · ${(c.tier === "A" ? t.fixedA : t.fixedB) != null ? "giá cứng " + vnd(c.tier === "A" ? t.fixedA : t.fixedB) : "phụ thu " + vnd(tierSur(t))}` : " · không bán"}" class="flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border px-3 text-sm ${toolCls(t)} ${ed.tool === t.id ? "ring-2 ring-focus" : ""}">${ic(t.icon || "square", "size-4")}${esc(t.name)}<span class="tabular-nums opacity-70">${cnt[t.id] || 0}</span></button>`).join("")}</div>
      <div class="mx-auto mb-3 max-w-[420px]"><div class="h-1 rounded-full bg-foreground/20"></div><p class="mt-1 text-center text-xs text-muted">Màn hình</p></div><div class="overflow-x-auto pb-1"><div class="mx-auto grid w-max gap-1">`;
    for (let i = 0; i < ed.rows; i++) { const L = String.fromCharCode(65 + i); h += `<div class="flex items-center gap-1"><button type="button" data-act="row" data-v="${i}" title="Áp ${esc(seatType(ed.tool).name)} cho cả hàng ${L}" class="grid size-7 cursor-pointer place-items-center rounded-md text-xs font-medium text-muted hover:bg-item-hover">${L}</button>`;
      for (let j = 0; j < ed.cols; j++) { const sid = seatId(i, j), g = ed.groups[sid]; if (g && g[0] !== sid) continue; const n = g ? g.length : 1, k = ed.types[sid] || "std", t = seatType(k), label = n > 1 ? `${g[0]}–${g[n - 1]}` : sid;
        h += `<button type="button" data-act="seat" data-v="${sid}" title="${label} · ${esc(t.name)}${n > 1 ? ` (${n} ghế)` : ""}" ${n > 1 ? `style="width:calc(${n} * 1.75rem + ${n - 1} * 0.25rem)"` : ""} class="grid size-7 cursor-pointer place-items-center rounded-md border text-[10px] tabular-nums hover:ring-2 hover:ring-focus ${toolCls(t)}">${k === "std" ? j + 1 : n > 1 ? `<span class="flex items-center gap-1">${ic(t.icon || "square", "size-3")}${label}</span>` : ic(t.icon || "square", "size-3")}</button>${j + n - 1 === half - 1 ? '<span class="w-2"></span>' : ""}`; j += n - 1; }
      h += `</div>`; }
    const total = Object.values(cnt).reduce((a, b) => a + b, 0), sellable = T.filter(t => t.sellable).reduce((a, t) => a + (cnt[t.id] || 0), 0), units = new Set(Object.values(ed.groups).map(g => g[0])).size + T.filter(t => t.sellable && t.persons === 1).reduce((a, t) => a + (cnt[t.id] || 0), 0);
    return h + `</div></div><p class="mt-2 text-xs text-muted">${total} ghế · bán được ${sellable} ghế = ${units} nút chọn (ghế đôi / ghế 3 / sofa chiếm n ghế liền, khách bấm một lần lấy cả nhóm). Giá nhóm = giá cơ bản × số ghế + phụ thu (rạp hạng ${c.tier}${c.prices ? ", bảng giá riêng" : ""}).</p>`; };
  const html = `${sheetHead(isNew ? `Thêm phòng · ${esc(c.name)}` : `Sửa ${esc(r.name)} · ${esc(c.name)}`, "Ghế = hàng (A, B, C…) × số ghế. Phòng tạm ngưng không xếp suất.")}
    <div class="grid gap-3 sm:grid-cols-2">${field("Mã phòng", input("rm-id", r.id, `${isNew ? "" : "disabled"} placeholder="${cid}-R${n + 1}"`), isNew ? `Dạng ${cid}-R1` : "")}${field("Tên phòng", input("rm-name", r.name, 'placeholder="Phòng 3 · IMAX"'))}${field("Công nghệ / loại phòng", sel("rm-kind", ROOM_KINDS.map(k => [k, ROOM_KIND_TXT[k]]), r.kind), "Phụ thu theo loại: 3D, GOLD, IMAX.")}<div class="grid grid-cols-2 gap-3">${field("Số hàng", input("rm-rows", r.rows, 'type="number" min="1" max="26" inputmode="numeric"'))}${field("Ghế mỗi hàng", input("rm-cols", r.cols, 'type="number" min="1" max="30" inputmode="numeric"'))}</div></div>
    <div id="rm-grid" class="rounded-xl border border-border p-3">${grid()}</div>
    <div class="grid gap-3 sm:grid-cols-2">${field("Ghi chú", input("rm-note", r.note || "", 'placeholder="Đang thay máy chiếu – xong 20/10"'))}<div class="flex items-end pb-2">${chk("rm-active", "Phòng đang hoạt động (bỏ chọn = tạm ngưng)", r.active !== false)}</div></div>
    <div class="flex flex-wrap items-center gap-2"><button type="button" class="${B.primary} min-h-11 md:min-h-10" data-act="save">${ic("save")}Lưu</button>${!isNew && Auth.user.role === "quanly" ? `<button type="button" class="${B.ghost} ml-auto text-err" data-act="del">${ic("trash-2")}Xoá phòng</button>` : ""}</div>`;
  const redraw = () => { $("#rm-grid").innerHTML = grid(); };
  const sh = adminSheet(html, {
    tool(b) { ed.tool = b.dataset.v; redraw(); },
    newtype() { seatTypeSheet(null, () => roomSheet(cid, { ...r, rows: ed.rows, cols: ed.cols, seatMap: { ...ed.types }, vipSeats: [], couple: [], blocked: [], vip: [] })); },
    seat(b) { const sid = b.dataset.v, i = sid.charCodeAt(0) - 65, j = +sid.slice(1) - 1; if (ed.tool !== "std" && ed.types[sid] === ed.tool && !(ed.groups[sid] && ed.groups[sid][0] !== sid)) { ungroup(sid); delete ed.types[sid]; } else applyAt(i, j, ed.tool); redraw(); },
    row(b) { const i = +b.dataset.v; for (let j = 0; j < ed.cols;) j += applyAt(i, j, ed.tool); redraw(); },
    async save(b, sh) {
      const rows = ed.rows, cols = ed.cols, id = isNew ? v("rm-id").toUpperCase() : r.id;
      const inside = sid => sid.charCodeAt(0) - 65 < rows && +sid.slice(1) <= cols;
      const seatMap = {}; Object.keys(ed.types).filter(inside).sort().forEach(sid => { if (SEAT_TYPES[ed.types[sid]]) seatMap[sid] = ed.types[sid]; });
      const pick = k => Object.keys(seatMap).filter(sid => seatMap[sid] === k);
      const vipSeats = pick("vip"), couple = pick("couple"), blocked = Object.keys(seatMap).filter(sid => isBlockedKind(seatMap[sid]));
      const p = { id, cinema_id: cid, name: v("rm-name") || id, kind: v("rm-kind") || "2D", rows, cols, vip: [], vip_seats: vipSeats, couple, blocked, seat_map: seatMap, active: $("#rm-active").checked, note: v("rm-note") };
      if (!new RegExp(`^${cid}-[A-Z0-9]{1,6}$`).test(id)) return toast(Auth.message({ message: "bad_room_id" }), "bad");
      if (!(rows >= 1 && rows <= 26 && cols >= 1 && cols <= 30)) return toast(Auth.message({ message: "bad_size" }), "bad");
      if (isNew && ROOMS.some(x => x.id === id)) return toast("Mã phòng đã tồn tại", "bad");
      try { await adminCall("save_room_s", { p }, () => { const i = ROOMS.findIndex(x => x.id === id); const obj = { id, cinemaId: cid, name: p.name, kind: p.kind, rows, cols, vip: [], vipSeats, couple, blocked, seatMap, active: p.active, note: p.note }; i >= 0 ? Object.assign(ROOMS[i], obj) : ROOMS.push(obj); }); }
      catch (e) { return toast(e.message === "need_008" ? "Máy chủ chưa chạy migration 008/009" : Auth.message(e), "bad"); }
      log("admin", `${isNew ? "Thêm" : "Sửa"} phòng ${id} (${p.kind}, ${rows}×${cols}, ${Object.keys(seatMap).length} ghế đặc biệt${p.active ? "" : ", tạm ngưng"})`); sh.close(); save(); render(); toast(`Đã lưu ${p.name}`); },
    async del(b, sh) {
      if (!confirm(`Xoá ${r.name} (${r.id})? Chỉ xoá được khi không còn vé của suất sắp chiếu.`)) return;
      try { await adminCall("delete_room_s", { p_id: r.id }, () => { const i = ROOMS.findIndex(x => x.id === r.id); if (i >= 0) ROOMS.splice(i, 1); S.shows = S.shows.filter(s => s.roomId !== r.id); }); }
      catch (e) { return toast(e.message === "need_008" ? "Máy chủ chưa chạy migration 008" : Auth.message(e), "bad"); }
      log("admin", `Xoá phòng ${r.id}`); sh.close(); save(); render(); toast("Đã xoá phòng " + r.id); },
  }, { label: "Phòng chiếu", wide: true });
  // đổi số hàng / ghế mỗi hàng → vẽ lại sơ đồ (giữ loại ghế đã đánh dấu còn nằm trong kích thước mới)
  sh.el.addEventListener("input", e => { if (e.target.id === "rm-rows" || e.target.id === "rm-cols") { const rows = Math.min(26, Math.max(1, +$("#rm-rows").value || 1)), cols = Math.min(30, Math.max(1, +$("#rm-cols").value || 1)); ed.rows = rows; ed.cols = cols; redraw(); } });
}
/** Thêm / sửa loại ghế tự định nghĩa (quản lý chuỗi): tên, số người, phụ thu A/B, màu, biểu tượng, có bán */
/** Bảng giá riêng của một rạp: giá cơ bản theo loại ngày × đối tượng, phụ thu phòng. Trống = dùng bảng theo hạng A/B. */
function pricesSheet(c) {
  const base = PRICE_TIERS[c.tier] || PRICE_TIERS.B, cur = c.prices && c.prices.weekday ? c.prices : base, own = !!(c.prices && c.prices.weekday);
  const DAYS = [["weekday", "Ngày thường (T2–T5)"], ["wed", "Thứ Tư vui vẻ"], ["weekend", "Cuối tuần (T6–CN)"]], AUD = [["adult", "Người lớn"], ["u22", "U22"], ["child", "Trẻ em"], ["senior", "Người cao tuổi"]];
  const num = (id, val) => `<input id="${id}" value="${val}" type="number" min="0" step="1000" inputmode="numeric" class="${INPUT} !h-9 text-right tabular-nums">`;
  const html = `${sheetHead(`Bảng giá · ${esc(c.name)}`, `${own ? "Đang dùng bảng giá riêng." : `Đang dùng bảng giá hạng ${c.tier}.`} Giá cơ bản theo loại ngày × đối tượng; đối tượng lấy từ tuổi đã xác thực VNeID. Phụ thu ghế VIP / đôi… đặt ở Loại ghế.`)}
    <div class="-mx-2 overflow-x-auto"><table class="w-full min-w-[520px] text-sm"><thead><tr class="text-left text-xs text-muted"><th class="px-2 py-1.5 font-medium">Đối tượng</th>${DAYS.map(([k, l]) => `<th class="px-2 py-1.5 font-medium">${l}</th>`).join("")}</tr></thead>
      <tbody>${AUD.map(([a, al]) => `<tr><td class="px-2 py-1.5">${al}</td>${DAYS.map(([d]) => `<td class="px-2 py-1.5">${num(`pr-${d}-${a}`, cur[d][a])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    <div class="grid gap-3 sm:grid-cols-2">${field("Phụ thu 3D ngày thường", num("pr-s3d-weekday", cur.s3d.weekday))}${field("Phụ thu 3D cuối tuần", num("pr-s3d-weekend", cur.s3d.weekend))}${field("Phụ thu phòng GOLD", num("pr-gold", cur.gold))}${field("Phụ thu phòng IMAX", num("pr-imax", cur.imax ?? cur.gold))}${field("Phụ thu ngày lễ", num("pr-holiday", cur.holiday))}</div>
    <div class="flex flex-wrap items-center gap-2"><button type="button" class="${B.primary} min-h-11 md:min-h-10" data-act="save">${ic("save")}Lưu bảng giá riêng</button>${own ? `<button type="button" class="${B.outline}" data-act="reset">${ic("rotate-ccw")}Dùng lại bảng hạng ${c.tier}</button>` : ""}</div>`;
  const push = async p => {
    if (Remote.v11 && Auth.token) { await Remote.rpc("save_cinema_prices_s", { p_token: Auth.token, p_cinema: c.id, p }); await Remote.reloadCatalog(); }
    else if (ON()) throw new Error("need_011");
    else c.prices = p;
  };
  adminSheet(html, {
    async save(b, sh) {
      const g = id => Math.max(0, Math.round(+v(id) || 0)); const p = { s3d: { weekday: g("pr-s3d-weekday"), weekend: g("pr-s3d-weekend") }, gold: g("pr-gold"), imax: g("pr-imax"), holiday: g("pr-holiday"), vip: base.vip, couple: base.couple };
      DAYS.forEach(([d]) => { p[d] = {}; AUD.forEach(([a]) => p[d][a] = g(`pr-${d}-${a}`)); });
      if (DAYS.some(([d]) => p[d].adult <= 0)) return toast("Giá người lớn phải lớn hơn 0", "bad");
      try { await push(p); } catch (e) { return toast(e.message === "need_011" ? "Máy chủ chưa chạy migration 011" : Auth.message(e), "bad"); }
      log("admin", `Bảng giá riêng ${c.name}: người lớn ${vnd(p.weekday.adult)} / ${vnd(p.wed.adult)} / ${vnd(p.weekend.adult)}`); sh.close(); save(); render(); toast("Đã lưu bảng giá " + c.name); },
    async reset(b, sh) {
      try { await push(null); } catch (e) { return toast(e.message === "need_011" ? "Máy chủ chưa chạy migration 011" : Auth.message(e), "bad"); }
      log("admin", `${c.name}: dùng lại bảng giá hạng ${c.tier}`); sh.close(); save(); render(); toast("Đã bỏ bảng giá riêng"); },
  }, { label: "Bảng giá", wide: true });
}
function seatTypeSheet(t, after) {
  const isNew = !t; t = t || { id: "", name: "", persons: 1, surchargeA: 0, surchargeB: 0, fixedA: null, fixedB: null, color: "sky", icon: "sofa", sellable: true, sort: 10 };
  const fixedMode = t.fixedA != null || t.fixedB != null;
  const swatch = (k, on) => `<button type="button" data-act="color" data-v="${k}" aria-pressed="${on}" class="grid size-9 cursor-pointer place-items-center rounded-lg border ${SEAT_COLORS[k].tool} ${on ? "ring-2 ring-focus" : ""}" title="${k}">${on ? ic("check", "size-4") : ""}</button>`;
  const iconBtn = (k, on) => `<button type="button" data-act="icon" data-v="${k}" aria-pressed="${on}" class="grid size-9 cursor-pointer place-items-center rounded-lg border ${on ? "border-foreground bg-foreground text-surface" : "border-border bg-surface hover:bg-button-hover"}" title="${k || "không biểu tượng"}">${k ? ic(k, "size-4") : `<span class="text-xs">–</span>`}</button>`;
  const st = { color: t.color, icon: t.icon || "" };
  const html = `${sheetHead(isNew ? "Loại ghế mới" : `Sửa loại ghế · ${esc(t.name)}`, "Dùng chung toàn chuỗi. Ví dụ: Ghế 3 người, Sofa 4, Ghế trẻ em, Lối đi (không bán).")}
    <div class="grid gap-3 sm:grid-cols-2">${field("Mã", input("st-id", t.id, `placeholder="sofa4" autocapitalize="none" ${isNew ? "" : "disabled"}`), isNew ? "chữ thường, số, gạch dưới" : "")}${field("Tên hiển thị", input("st-name", t.name, 'placeholder="Sofa 4 người"'))}${field("Số người ngồi", input("st-persons", t.persons, 'type="number" min="1" max="8" inputmode="numeric"'), "Ghế nhiều người chiếm n ghế liền trên sơ đồ")}${field("Cách tính giá", sel("st-mode", [["formula", "Giá cơ bản × số người + phụ thu"], ["fixed", "Giá cứng – một giá cố định"]], fixedMode ? "fixed" : "formula"), "Giá cứng: không theo ngày, đối tượng hay loại phòng; ghế đôi = giá cả cặp")}
      <div id="st-formula" class="grid grid-cols-2 gap-3 ${fixedMode ? "hidden" : ""}">${field("Phụ thu hạng A", input("st-sa", t.surchargeA, 'type="number" min="0" step="1000" inputmode="numeric"'))}${field("Phụ thu hạng B", input("st-sb", t.surchargeB, 'type="number" min="0" step="1000" inputmode="numeric"'))}</div>
      <div id="st-fixed" class="grid grid-cols-2 gap-3 ${fixedMode ? "" : "hidden"}">${field("Giá cứng hạng A", input("st-fa", t.fixedA ?? "", 'type="number" min="0" step="1000" inputmode="numeric" placeholder="150000"'))}${field("Giá cứng hạng B", input("st-fb", t.fixedB ?? "", 'type="number" min="0" step="1000" inputmode="numeric" placeholder="120000"'))}</div>
      <div><p class="mb-1.5 text-sm font-medium">Màu trên sơ đồ</p><div id="st-colors" class="flex flex-wrap gap-2">${Object.keys(SEAT_COLORS).map(k => swatch(k, k === st.color)).join("")}</div></div>
      <div><p class="mb-1.5 text-sm font-medium">Biểu tượng</p><div id="st-icons" class="flex flex-wrap gap-2">${iconBtn("", !st.icon)}${SEAT_ICONS.map(k => iconBtn(k, k === st.icon)).join("")}</div></div>
      <div class="flex items-end pb-2 sm:col-span-2">${chk("st-sell", "Bán được (bỏ chọn = loại không bán: bảo trì, lối đi, ghế hỏng…)", t.sellable !== false)}</div></div>
    <div class="flex flex-wrap items-center gap-2"><button type="button" class="${B.primary} min-h-11 md:min-h-10" data-act="save">${ic("save")}Lưu</button>${!isNew && !t.builtin ? `<button type="button" class="${B.ghost} ml-auto text-err" data-act="del">${ic("trash-2")}Xoá loại ghế</button>` : ""}</div>`;
  const done = () => { save(); render(); after && after(); };
  const sheetT = adminSheet(html, {
    color(b) { st.color = b.dataset.v; $("#st-colors").innerHTML = Object.keys(SEAT_COLORS).map(k => swatch(k, k === st.color)).join(""); },
    icon(b) { st.icon = b.dataset.v; $("#st-icons").innerHTML = iconBtn("", !st.icon) + SEAT_ICONS.map(k => iconBtn(k, k === st.icon)).join(""); },
    async save(b, sh) {
      const fixed = v("st-mode") === "fixed", id = isNew ? v("st-id").toLowerCase() : t.id;
      const p = { id, name: v("st-name"), persons: Math.min(8, Math.max(1, +v("st-persons") || 1)), surcharge_a: +v("st-sa") || 0, surcharge_b: +v("st-sb") || 0, fixed_a: fixed ? Math.round(+v("st-fa")) || null : null, fixed_b: fixed ? Math.round(+v("st-fb")) || null : null, color: st.color, icon: st.icon || null, sellable: $("#st-sell").checked, sort: t.sort ?? 10, active: true };
      if (!/^[a-z0-9_]{1,16}$/.test(id)) return toast("Mã: 1–16 ký tự chữ thường, số, gạch dưới", "bad");
      if (!p.name) return toast("Nhập tên loại ghế", "bad");
      if (fixed && (!p.fixed_a || !p.fixed_b)) return toast("Nhập giá cứng cho cả hạng A và hạng B (lớn hơn 0)", "bad");
      if (isNew && SEAT_TYPES[id]) return toast("Mã loại ghế đã có", "bad");
      const local = () => { SEAT_TYPES[id] = { id, name: p.name, persons: p.persons, surchargeA: p.surcharge_a, surchargeB: p.surcharge_b, fixedA: p.fixed_a, fixedB: p.fixed_b, color: p.color, icon: p.icon, sellable: p.sellable, sort: p.sort, builtin: !!t.builtin, active: true }; };
      if (Remote.v11 && Auth.token) { try { await Remote.rpc("save_seat_type_s", { p_token: Auth.token, p }); await Remote.reloadCatalog(); } catch (e) { return toast(Auth.message(e), "bad"); } }
      else if (ON() && Remote.v8) return toast("Máy chủ chưa chạy migration 011 (loại ghế)", "bad");
      else if (ON()) return toast("Máy chủ chưa chạy migration 008", "bad");
      else local();
      log("admin", `${isNew ? "Thêm" : "Sửa"} loại ghế ${p.name} (${p.persons} người, ${fixed ? `giá cứng A ${vnd(p.fixed_a)} / B ${vnd(p.fixed_b)}` : `phụ thu A ${vnd(p.surcharge_a)} / B ${vnd(p.surcharge_b)}`}${p.sellable ? "" : ", không bán"})`); sh.close(); done(); toast(`Đã lưu loại ghế ${p.name}`); },
    async del(b, sh) {
      if (!confirm(`Xoá loại ghế ${t.name}? Ghế đang mang loại này sẽ thành ghế thường.`)) return;
      if (Remote.v11 && Auth.token) { try { await Remote.rpc("delete_seat_type_s", { p_token: Auth.token, p_id: t.id }); await Remote.reloadCatalog(); } catch (e) { return toast(Auth.message(e), "bad"); } }
      else if (ON()) return toast("Máy chủ chưa chạy migration 011", "bad");
      else { delete SEAT_TYPES[t.id]; ROOMS.forEach(r => { if (r.seatMap) for (const k in r.seatMap) if (r.seatMap[k] === t.id) delete r.seatMap[k]; }); }
      log("admin", `Xoá loại ghế ${t.name}`); sh.close(); done(); toast("Đã xoá loại ghế"); },
  }, { label: "Loại ghế", wide: true });
  sheetT.el.addEventListener("change", e => { if (e.target.id === "st-mode") { const fx = e.target.value === "fixed"; $("#st-formula").classList.toggle("hidden", fx); $("#st-fixed").classList.toggle("hidden", !fx); } });
}
function filmSheet(f) {
  const isNew = !f; f = f || { id: "f" + Date.now().toString(36).slice(-5), title: "", rating: "P", dur: 100, genre: "", img: "", active: true };
  const html = `${sheetHead(isNew ? "Thêm phim vào kho" : `Sửa phim · ${esc(f.title)}`, "Kho phim dùng chung toàn chuỗi; chọn rạp được chiếu ở dưới.")}
    <div class="grid gap-3 sm:grid-cols-2">${field("Tên phim", input("fm-title", f.title, 'placeholder="Tên phim"'))}${field("Nhãn tuổi", sel("fm-rating", [["P", "P – mọi lứa tuổi"], ["K", "K – dưới 13 có người lớn"], ["T13", "T13"], ["T16", "T16"], ["T18", "T18"]], f.rating))}${field("Thời lượng (phút)", input("fm-dur", f.dur, 'type="number" min="30" max="300" inputmode="numeric"'))}${field("Thể loại", input("fm-genre", f.genre, 'placeholder="Hành động"'))}<div class="sm:col-span-2">${field("Ảnh poster (URL)", input("fm-img", f.img || "", 'placeholder="https://…"'))}</div><div class="flex items-end pb-2">${chk("fm-active", "Đang chiếu (bỏ chọn = ngừng chiếu toàn chuỗi)", f.active !== false)}</div></div>
    <div><p class="mb-2 text-sm font-medium">Phân phối cho cơ sở</p><div class="grid gap-1.5 sm:grid-cols-2">${CINEMAS.filter(c => c.active !== false).map(c => chk("fm-c-" + c.id, `<span class="font-mono text-xs text-muted">${c.id}</span> ${esc(c.name)}`, isNew ? true : filmAt(c.id, f.id))).join("")}</div></div>
    <div class="flex flex-wrap items-center gap-2"><button type="button" class="${B.primary} min-h-11 md:min-h-10" data-act="save">${ic("save")}Lưu</button></div>`;
  adminSheet(html, {
    async save(b, sh) {
      const p = { id: f.id, title: v("fm-title"), rating: v("fm-rating") || "P", dur: +v("fm-dur") || 100, genre: v("fm-genre"), img: v("fm-img"), active: $("#fm-active").checked };
      if (!p.title) return toast("Nhập tên phim", "bad");
      const cs = CINEMAS.filter(c => c.active !== false && $("#fm-c-" + c.id)?.checked).map(c => c.id);
      try { await adminCall("save_film_s", { p, p_cinemas: cs }, () => { const i = FILMS.findIndex(x => x.id === p.id); const obj = { ...p, img: p.img || null }; i >= 0 ? Object.assign(FILMS[i], obj) : FILMS.push(obj); S.films = FILMS; CINEMAS.forEach(c => cs.includes(c.id) ? DIST.delete(c.id + "|" + p.id) : DIST.add(c.id + "|" + p.id)); }); }
      catch (e) { return toast(e.message === "need_008" ? "Máy chủ chưa chạy migration 008" : Auth.message(e), "bad"); }
      log("admin", `${isNew ? "Thêm" : "Sửa"} phim ${p.title} (${p.rating}) · ${cs.length} rạp`); sh.close(); save(); render(); toast(`Đã lưu phim ${p.title}`); },
  }, { label: "Phim", wide: true });
}
/** Tra cứu một ghế: dữ liệu thật từ máy chủ (010: vé, người mua, người xem, đơn, khoá ghế, vé đoàn, lịch sử hoàn); chưa có 010 → dữ liệu đã tải */
async function seatDetail(sh, sid, back) {
  const f = film(sh.filmId), r = room(sh.roomId);
  const head = sheetHead(`Ghế ${sid}${seatKind(r, sid) !== "std" ? " · " + esc(seatType(seatKind(r, sid)).name) : ""}`, `${esc(f.title)} ${f.rating} · ${dayLabel(sh.start)} ${hhmm(sh.start)} · ${esc(placeOf(sh))}`);
  const sheet = openSheet(`${head}<div class="grid gap-2">${skelRows(4, "h-8")}</div>`, { label: "Tra cứu ghế " + sid });
  const row = (k, v) => `<div class="flex items-start justify-between gap-4 border-b border-border py-2 text-sm last:border-0"><span class="shrink-0 text-muted">${k}</span><span class="min-w-0 text-right">${v}</span></div>`;
  let info = null, body = "", src = "máy chủ (thời gian thực)";
  if (ON() && Auth.token) { try { info = await Remote.rpc("seat_info_s", { p_token: Auth.token, p_show: sh.id, p_seat: sid }); } catch (e) { if (!/PGRST202|not find|does not exist/i.test(e.message || "")) body = banner("bad", "Không tra cứu được", esc(Auth.message(e))); } }
  if (info) body = seatInfoHtml(info, row);
  else if (!body) { src = ON() ? "dữ liệu đã tải trên máy (máy chủ chưa chạy migration 010)" : "dữ liệu trên máy (ngoại tuyến)"; body = await seatLocalHtml(sh, sid, row); }
  if (!document.body.contains(sheet.el)) return;
  sheet.set(head + `<div>${body}</div><p class="mt-3 text-xs text-muted">Nguồn: ${src}.${info && info.ticket && info.ticket.owner ? " SĐT/email che bớt; không hiển thị số giấy tờ." : ""}</p>${back ? `<button type="button" class="${B.outline} mt-3" data-act="back">${ic("chevron-left")}Quay lại sơ đồ</button>` : ""}`);
  sheet.el.onclick = e => { if (e.target.closest('[data-act="back"]')) { sheet.close(); back(); } else if (e.target.closest('[data-m="close"]')) sheet.close(); };
}
const fmtAt = t => t ? `${hhmm(t)} ${ddmm(t)}` : "–";
function seatInfoHtml(x, row) {
  const t = x.ticket, l = x.lock, g = x.group; let h = "";
  if (x.blocked) h += `<div class="mb-2">${banner("warn", "Ghế đang bảo trì", "Không bán ghế này cho tới khi kỹ thuật mở lại.")}</div>`;
  if (t) {
    const o = t.owner, vw = t.viewer, pos = (t.channel || "") === "Quầy";
    h += row("Trạng thái", t.status === "used" ? tone(`Đã vào phòng lúc ${fmtAt(t.used_at)}`, "neutral") : tone("Đã bán – chưa vào phòng", "ok"))
      + row("Mã vé · đơn", `<span class="font-mono">${esc(t.code)}</span>${t.order_id ? ` · đơn <span class="font-mono">${esc(t.order_id)}</span>` : ""}${t.order_size > 1 ? ` <span class="text-xs text-muted">(${t.order_size} vé cùng chủ, một QR)</span>` : ""}`)
      + row("Người mua", o ? `<span class="block font-medium">${esc(o.name)} <span class="font-mono text-xs text-muted">@${esc(o.username)}</span></span><span class="block text-xs text-muted">${o.phone ? esc(o.phone) : "không SĐT"} · ${o.email ? esc(o.email) : "không email"}</span><span class="mt-1 inline-block">${o.vneid ? tone(`VNeID · xác thực ${fmtAt(o.vneid_at)}`, "ok") : tone("Chưa liên kết VNeID", "warn")}</span>` : pos ? "Khách tại quầy (không tài khoản)" : "—")
      + row("Người xem", `<span class="block">${esc(t.viewer_name || "—")}${vw ? ` <span class="font-mono text-xs text-muted">@${esc(vw.username)}</span>${vw.vneid ? " " + tone("VNeID", "ok") : ""}` : ""}</span><span class="block text-xs text-muted">${esc(t.aud || "")}</span>`)
      + row("Kiểm tuổi", t.need_doc ? `${tone("Phải kiểm giấy tờ tại cửa", "warn")}${t.reason ? `<span class="block text-xs text-muted">${esc(t.reason)}</span>` : ""}` : t.verified ? tone("Đã xác thực tuổi qua VNeID", "ok") : "Không giới hạn")
      + row("Giá · kênh", `${vnd(Number(t.price))} · ${esc(t.channel || "Online")}`)
      + row("Mua lúc", `${fmtAt(t.created_at)}${t.device_id ? ` <span class="font-mono text-xs text-muted">${esc(String(t.device_id).slice(0, 10))}</span>` : ""}`);
  } else if (l && l.status === "held") {
    const left = Math.max(0, Math.round((new Date(l.until) - Date.now()) / 1000));
    h += row("Trạng thái", tone("Đang giữ – chưa thanh toán", "warn")) + row("Ai giữ", String(l.hold_id || "").startsWith("POS-") ? (l.hold_id === "POS-" + Remote.DEVICE ? "Quầy này" : "Quầy khác") : `Khách đặt online <span class="font-mono text-xs text-muted">${esc(l.hold_id || "")}</span>`) + row("Tự nhả sau", `<span class="tabular-nums">${pad(Math.floor(left / 60))}:${pad(left % 60)}</span>`)
      + `<p class="mt-2 text-pretty text-xs text-muted">Hết hạn giữ mà chưa trả tiền thì ghế tự trống lại. Máy chủ khoá theo suất + ghế nên không bán chồng được.</p>`;
  } else if (g) {
    h += row("Trạng thái", tone(g.status === "used" ? `Vé đoàn – đã vào ${g.entered}/${g.members}` : "Vé đoàn – chưa vào", g.status === "used" ? "neutral" : "ok")) + row("Mã đoàn", `<span class="font-mono">${esc(g.code)}</span>`) + row("Phụ trách", `${esc(g.teacher || "")}${g.org ? ` · ${esc(g.org)}` : ""}`) + row("Sĩ số", `${g.members} học sinh + 1 · ${(g.seats || []).length} ghế`) + row("Tổng", vnd(Number(g.total || 0)));
  } else if (l && l.status === "sold") {
    h += row("Trạng thái", tone("Đã bán", "neutral")) + `<p class="mt-2 text-pretty text-xs text-muted">Ghế bán trước khi mở hệ thống (dữ liệu mẫu của lịch chiếu) – không có vé điện tử hay người mua.</p>`;
  } else h += banner("ok", "Ghế trống", "Có thể bán ghế này.");
  if (x.refunds && x.refunds.length) h += `<div class="mt-3 rounded-xl bg-background p-3 text-xs"><p class="mb-1 font-medium">Lịch sử hoàn vé ghế này</p>${x.refunds.map(rf => `<p class="text-muted"><span class="font-mono">${esc(rf.code)}</span> · ${fmtAt(rf.at)} · ${vnd(Number(rf.price))}${rf.owner ? ` · @${esc(rf.owner)}` : ""}</p>`).join("")}</div>`;
  if (x.show && x.show.status === "cancelled") h = `<div class="mb-2">${banner("bad", "Suất đã huỷ", "Vé của suất này đã được hoàn vào thẻ quà tặng.")}</div>` + h;
  return h;
}
async function seatLocalHtml(sh, sid, row) {
  const st = seatState(sh.id, sid), f = film(sh.filmId);
  if (!st) return banner("ok", "Ghế trống", "Có thể bán ghế này.");
  if (st.st === "held") { const left = Math.max(0, Math.round((new Date(st.until) - Date.now()) / 1000));
    return `${row("Trạng thái", tone("Đang giữ – chưa thanh toán", "warn"))}${row("Ai giữ", String(st.by || "").startsWith("POS-") ? (st.by === "POS-" + Remote.DEVICE ? "Quầy này" : "Quầy khác") : "Khách đặt online")}${row("Tự nhả sau", `<span class="tabular-nums">${pad(Math.floor(left / 60))}:${pad(left % 60)}</span>`)}`; }
  let t = S.tickets.find(x => x.showId === sh.id && x.seat === sid && x.status !== "refunded");
  if (!t && ON()) { try { t = await Remote.fetchSeatTicket(sh.id, sid); if (t && !S.tickets.some(x => x.code === t.code)) S.tickets.push(t); } catch (e) {} }
  const grp = S.groups.find(g => g.showId === sh.id && (g.seats || []).includes(sid));
  if (t) return `${row("Trạng thái", t.status === "used" ? tone("Đã vào phòng", "neutral") : tone("Đã bán – chưa vào", "ok"))}${row("Mã vé", `<span class="font-mono">${t.code}</span>`)}${row("Người mua", t.ownerUser ? "@" + esc(t.ownerUser) : t.channel === "Quầy" ? "Khách tại quầy" : "—")}${row("Người xem", esc(t.viewerName || "—"))}${row("Đối tượng · giá", `${esc(t.aud || "")} · ${vnd(t.price)}`)}${row("Kênh", esc(t.channel || ""))}${row("Tuổi", t.needDoc ? tone("Phải kiểm tại cửa", "warn") : t.verified ? tone("Đã xác thực VNeID", "ok") : RATINGS[f.rating] ? "—" : "Không giới hạn")}`;
  if (grp) return `${row("Trạng thái", tone("Vé đoàn", "ok"))}${row("Mã đoàn", `<span class="font-mono">${grp.code}</span>`)}${row("Phụ trách", esc(grp.teacher))}${row("Sĩ số", `${grp.students.length} học sinh + 1`)}`;
  return `${row("Trạng thái", tone("Đã bán", "neutral"))}<p class="mt-2 text-pretty text-xs text-muted">Ghế bán trước khi mở hệ thống (dữ liệu mẫu của lịch chiếu) – không có vé điện tử.</p>`;
}
function showSheet(s) {
  if (!s) return;
  const f = film(s.filmId), r = room(s.roomId), c = cinemaOf(s), sold = soldCount(s), cap = capacity(s), tks = S.tickets.filter(t => t.showId === s.id && t.status !== "refunded"), off = s.status === "cancelled", past = endOf(s) < new Date();
  const canEdit = Auth.user.role === "quanly" && !off && !past, roomsOn = roomsOf(c.id).filter(x => x.active !== false || x.id === s.roomId);
  const d = new Date(s.start), ymd = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const html = `${sheetHead(`${esc(f.title)} ${f.rating}`, `${dayLabel(s.start)} · ${hhmm(s.start)} – ${hhmm(endOf(s).getTime() - 15 * 60000)} · ${esc(placeOf(s))} · ${esc(formatOf(s))}`)}
    ${off ? banner("bad", "Suất đã huỷ", esc(s.cancelReason || "Không ghi lý do") + ". Vé đã bán được hoàn vào thẻ quà tặng của từng khách.") : ""}
    <div class="grid grid-cols-3 gap-3">${[["Ghế bán", `${sold}/${cap}`], ["Lấp đầy", `${cap ? Math.round(sold / cap * 100) : 0}%`], ["Vé qua hệ thống", `${tks.length} · ${vnd(tks.reduce((a, t) => a + t.price, 0))}`]].map(([l, x]) => `<div class="rounded-xl bg-background p-3"><p class="text-xs text-muted">${l}</p><p class="mt-0.5 text-base font-semibold tabular-nums">${x}</p></div>`).join("")}</div>
    ${tks.length ? `<div class="max-h-40 overflow-auto rounded-xl border border-border text-sm">${tks.slice(0, 30).map(t => `<div class="flex items-center gap-2 border-b border-border px-3 py-1.5 last:border-0"><span class="w-10 font-mono font-medium">${t.seat}</span><span class="min-w-0 flex-1 truncate">${esc(t.viewerName || "")}${t.ownerUser ? ` <span class="font-mono text-xs text-muted">@${esc(t.ownerUser)}</span>` : ""}</span>${t.status === "used" ? tone("Đã vào", "neutral") : tone(t.channel || "Online", "ok")}</div>`).join("")}</div>` : ""}
    <div class="rounded-xl border border-border p-3" data-show="${s.id}"><p class="mb-1 text-sm font-medium">Sơ đồ ghế</p><p class="mb-2 text-xs text-muted">Bấm ghế đã bán / đang giữ để xem người mua, người xem, đơn, giờ vào phòng – dữ liệu thật từ máy chủ.</p>${seatMap(s, [], "seat-none", { inspect: true })}</div>
    ${canEdit ? `<div class="grid gap-3 border-t border-border pt-4"><p class="text-sm font-medium">Điều chỉnh suất</p><div class="grid gap-3 sm:grid-cols-3">${field("Ngày", input("sh-day", ymd, 'type="date"'))}${field("Giờ bắt đầu", input("sh-time", hhmm(s.start), 'placeholder="19:30" maxlength="5"'))}${field("Phòng", sel("sh-room", roomsOn.map(x => [x.id, `${x.name} · ${x.rows * x.cols} ghế`]), s.roomId), tks.length ? "Đã bán vé: chỉ đổi giờ." : "")}</div>
      <div class="flex flex-wrap items-center gap-2"><button type="button" class="${B.primary} min-h-11 md:min-h-10" data-act="save">${ic("save")}Lưu thay đổi</button><span class="text-xs text-muted">Khách đã mua vé nhận thông báo đổi giờ (mô phỏng).</span></div>
      <div class="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-border p-3"><div class="min-w-[200px] flex-1">${field("Lý do huỷ", input("sh-reason", "", 'placeholder="Hỏng máy chiếu / bảo trì phòng"'))}</div><button type="button" class="${B.outline} min-h-11 md:min-h-10 text-err" data-act="cancel">${ic("calendar-x")}Huỷ suất${tks.length ? ` · hoàn ${tks.length} vé` : ""}</button></div></div>` : ""}`;
  adminSheet(html, {
    "seat-info"(b, sh) { sh.close(); seatDetail(s, b.dataset.seat, () => showSheet(show(s.id) || s)); },
    "seat-blocked"(b) { toast(`Ghế ${b.dataset.seat} đang bảo trì – không bán`, "bad"); },
    async save(b, sh) {
      const t = v("sh-time"); if (!/^\d{1,2}:\d{2}$/.test(t)) return toast("Giờ dạng HH:MM", "bad");
      const [h, m] = t.split(":").map(Number), s0 = new Date(v("sh-day") + "T00:00:00"); s0.setHours(h, m, 0, 0); const e0 = new Date(s0.getTime() + (f.dur + 15) * 60000), rid_ = v("sh-room");
      if (rid_ !== s.roomId && tks.length) return toast(Auth.message({ message: "has_tickets" }), "bad");
      const clash = S.shows.find(x => x.id !== s.id && x.status !== "cancelled" && x.roomId === rid_ && new Date(x.start) < e0 && endOf(x) > s0);
      if (clash) return toast(`Trùng suất ${hhmm(clash.start)} (${film(clash.filmId).title})`, "bad");
      if (ON() && Remote.v8) { try { const cid = await Remote.rpc("update_show_s", { p_token: Auth.token, p_id: s.id, p_room: rid_, p_start: s0.toISOString(), p_end: e0.toISOString() }); if (cid) return toast(`Máy chủ báo trùng suất ${cid}`, "bad"); } catch (e) { return toast(Auth.message(e), "bad"); } }
      else if (ON()) return toast("Máy chủ chưa chạy migration 008", "bad");
      Object.assign(s, { roomId: rid_, start: s0.toISOString(), end: e0.toISOString(), format: formatOf({ roomId: rid_ }) });
      log("admin", `Đổi suất ${s.id}: ${f.title} → ${room(rid_).name} ${ddmm(s0)} ${hhmm(s0)}`); sh.close(); save(); render(); toast("Đã cập nhật suất chiếu"); },
    async cancel(b, sh) {
      const reason = v("sh-reason") || "Không ghi lý do";
      if (!confirm(`Huỷ suất ${f.title} ${hhmm(s.start)} ${ddmm(s.start)}?${tks.length ? ` ${tks.length} vé sẽ được hoàn vào thẻ quà tặng của khách.` : ""}`)) return;
      let n = tks.length;
      if (ON() && Remote.v8) { try { n = await Remote.rpc("cancel_show_s", { p_token: Auth.token, p_id: s.id, p_reason: reason }); } catch (e) { return toast(Auth.message(e), "bad"); } }
      else if (ON()) return toast("Máy chủ chưa chạy migration 008", "bad");
      s.status = "cancelled"; s.cancelReason = reason; S.seats[s.id] = {}; S.tickets.forEach(t => { if (t.showId === s.id && t.status === "valid") t.status = "refunded"; });
      log("admin", `Huỷ suất ${s.id} (${reason}): hoàn ${n} vé`, false); sh.close(); save(); render(); toast(`Đã huỷ suất · hoàn ${n} vé vào thẻ quà tặng`); },
  }, { label: "Suất chiếu", wide: true });
}
const SEL = {
  "work-cinema"(box, v) { if (!isChainManager()) return; setWorkCinema(v); S.view.ns = null; S.view.pos = { showId: null, seats: [], types: {}, docs: {} }; S.view.gate = {}; save(); render(); toast(`Đang thao tác tại ${cinema(v).name}`); },
  "nu-cinema"(box, v) { S.view.nu.cinema = v || null; },
  assign(box, v) { const d = S.draft, i = +box.dataset.i; d.assign[i] = { viewer: v.startsWith("dep:") ? { kind: "dep", depId: v.slice(4) } : { kind: v } }; save(); render(); if (v === "friend") { const x = $("#friend-" + i); x && x.focus(); } },
  ns(box, v) { const f = S.view.ns; f[box.dataset.select.slice(3)] = v; if (box.dataset.select === "ns-day") S.view.sday = v; save(); render(); },
  "pos-show"(box, v) { const p = S.view.pos; p.seats.forEach(sid => { delete S.seats[p.showId]?.[sid]; call("release_seat", { p_show: p.showId, p_seat: sid, p_hold: "POS-" + Remote.DEVICE }); }); S.view.pos = { showId: v || null, seats: [], types: {}, docs: {} }; save(); render(); },
  "pos-type"(box, v) { S.view.pos.types[box.dataset.seat] = v; delete S.view.pos.docs[box.dataset.seat]; save(); render(); },
  "gate-doc-type"(box, v) { S.view.gateDoc = v; },
  "nu-role"(box, v) { S.view.nu.role = v; render(); },
  "chip-key"(box, v) { LAB.chipKey = v; },
};
document.addEventListener("sel-change", e => { const box = e.target.closest("[data-select]"); const f = box && SEL[box.dataset.selAct]; if (f) f(box, e.detail.value); });
document.addEventListener("click", e => {
  const el = e.target.closest("[data-act]"); if (!el || el.closest("#modal-root") || el.tagName === "INPUT" || el.disabled || el.getAttribute("aria-disabled") === "true") return;
  const f = A[el.dataset.act]; if (f) { e.preventDefault(); f(el); }
});
document.addEventListener("change", e => {
  const el = e.target;
  if (el.id === "g-commit") { S.view.gdraft.commit = el.checked; save(); render(); }
  if (el.id === "log-type") { S.view.logType = el.value; save(); render(); }
  if (el.id === "gate-file" && el.files[0]) gateImage(el.files[0]);
  if (el.id === "haar-file" && el.files[0]) { const file = el.files[0]; LAB.haar.err = ""; LAB.haar.stats = { status: "Đang chạy Haar trên ảnh…" }; render(); FaceKit.preload();
    Haar.runImage(file, m => { const s = $("#haar-stats"); if (s) s.innerHTML = haarStats({ status: m }); }).then(r => { LAB.haar.img = r.dataUrl; LAB.haar.stats = { ms: r.ms, tinyMs: r.tinyMs, faces: r.faces, eyes: r.eyes, fps: null, blinks: null };
      setCase("h-face", r.faces > 0, r.faces ? `Ảnh: ${r.faces} khuôn mặt` : "Không thấy khuôn mặt trong ảnh"); if (r.faces) setCase("h-eyes", r.eyes === 2, `Ảnh: ${r.eyes} mắt`); if (r.tinyMs != null) setCase("h-speed", true, `Haar ${r.ms} ms · TinyFace ${r.tinyMs} ms (ảnh 480px)`); render(); })
      .catch(err => { LAB.haar.err = err.message; LAB.haar.stats = null; render(); }); }
  if (el.id === "qr-file" && el.files[0]) decodeQrImage(el.files[0]).then(t => { if (!t) { setCase("q-image", false, "Không đọc được QR trong ảnh"); render(); return toast("Không thấy mã QR trong ảnh", "bad"); } labQrVerify(t, "ảnh"); });
});
async function gateImage(file) {
  const t = await decodeQrImage(file);
  if (!t) { gatePush("—", "none", "không đọc được QR trong ảnh"); S.view.gate = { result: { kind: "none", code: "" } }; gateRefresh(); return toast("Không thấy mã QR trong ảnh", "bad"); }
  gateProcess(t, "ảnh");
}
/* kéo thả ảnh QR */
document.addEventListener("dragover", e => { const d = e.target.closest("[data-drop]"); if (d) { e.preventDefault(); d.setAttribute("data-over", ""); } });
document.addEventListener("dragleave", e => { const d = e.target.closest("[data-drop]"); if (d) d.removeAttribute("data-over"); });
document.addEventListener("drop", e => { const d = e.target.closest("[data-drop]"); if (!d) return; e.preventDefault(); d.removeAttribute("data-over"); const f = e.dataTransfer.files[0]; if (f) gateImage(f); });
document.addEventListener("submit", e => {
  const f = e.target.closest("[data-form]"); if (!f) return; e.preventDefault();
  const v = id => ($("#" + id) || {}).value || "";
  const u = v("li-user"), p = v("li-pass");
  if (f.dataset.form === "login") { if (!u || !p) { LOGIN.err = "Nhập tài khoản và mật khẩu."; LOGIN.field = "user"; render(); $("#li-user").value = u; return; } return doLogin(u, p); }
  if (f.dataset.form === "login-face") return doLoginFace(u.trim());
  const vals = { username: u, pass: p, name: v("li-name"), email: v("li-email"), phone: v("li-phone") };
  const refill = () => { for (const [k, id] of [["username", "li-user"], ["pass", "li-pass"], ["name", "li-name"], ["email", "li-email"], ["phone", "li-phone"]]) { const x = $("#" + id); if (x) x.value = vals[k]; } };
  LOGIN.busy = true; LOGIN.err = ""; render(); refill();
  Auth.register(vals).then(r => { LOGIN.busy = false; if (!r.ok) { LOGIN.err = r.message; LOGIN.field = r.field || ""; render(); refill(); const x = $("#li-" + ({ user: "user", pass: "pass", name: "name", email: "email", phone: "phone" }[r.field] || "user")); x && x.focus(); return; }
    LOGIN = { err: "", field: "", busy: false, show: false }; bindProfile(); save(); location.hash = "#/lich"; render(); offerVneid(); });
});
document.addEventListener("input", e => {
  if (e.target.id === "ns-time") { let v = e.target.value.replace(/[^\d:]/g, ""); if (/^\d{3,4}$/.test(v)) v = v.slice(0, v.length - 2) + ":" + v.slice(-2); S.view.ns.time = v;
    if (/^\d{1,2}:\d{2}$/.test(v) || v === "") { render(); const x = $("#ns-time"); if (x) { x.focus(); x.setSelectionRange(v.length, v.length); } } }
});
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.id === "gate-code") { e.preventDefault(); gateProcess(e.target.value, "gõ tay"); } if (e.key === "Escape") document.body.removeAttribute("data-menu-open"); });
// đồng hồ watermark QR + đếm ngược đổi mã
setInterval(() => {
  const now = Date.now();
  $$("[data-clock]").forEach(e => e.textContent = hhmmss(now));
  if (QRLive.nextAt) { const left = Math.max(0, Math.ceil((QRLive.nextAt - now) / 1000)); $$("[data-count]").forEach(e => e.textContent = left); $$("[data-ring]").forEach(e => e.setAttribute("stroke-dashoffset", String(50.3 * (1 - left / 15)))); }
  const box = $("#qr-box"); if (box && QRLive.code === box.dataset.code && now >= QRLive.nextAt) refreshQr(box.dataset.code);
}, 1000);
// Ngoại tuyến: tab khác đổi dữ liệu → nạp lại. Trực tuyến: Supabase Realtime lo việc này.
Store.onRemoteChange(() => { if (ON() || $("#modal-root").innerHTML) return; const view = S.view; S = Store.load(); S.view = view; bindProfile(); render(); });

/* ============================ khởi động ============================ */
Remote.onStatus(() => { $$("[data-net]").forEach(n => n.outerHTML = netBadge()); });
const params = new URLSearchParams(location.search);
if (params.has("pair")) phonePage((params.get("pair") || "").toUpperCase());
else {
  render();
  Remote.init(S, buildSchedule(), t => scheduleRender(t)).then(async ok => {
    if (ok) save();
    const still = await Auth.check();
    if (!still && routeName() !== "dangky") location.hash = "#/dangnhap";
    render();
  });
}
