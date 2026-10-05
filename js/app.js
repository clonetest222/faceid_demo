/* CineVin – điều hướng theo vai trò, đăng nhập, xác thực VNeID + FaceID, hành động và khởi động. */
"use strict";
/* ============================ điều hướng ============================ */
const ROUTES = {
  lich: { roles: ["khach"], view: () => vLich() }, ghe: { roles: ["khach"], view: () => vGhe() }, thanhtoan: { roles: ["khach"], view: () => vThanhToan() },
  ve: { roles: ["khach"], view: () => vVe() }, doan: { roles: ["khach"], view: () => vDoan() }, taikhoan: { roles: ["khach"], view: () => vTaiKhoan() },
  tongquan: { roles: ["quanly"], view: () => vTongQuan() }, suat: { roles: ["quanly"], view: () => vSuat() }, soat: { roles: ["nhanvien", "quanly"], view: () => vSoat() },
  quay: { roles: ["nhanvien", "quanly"], view: () => vQuay() }, kiemthu: { roles: ["quanly"], view: () => vKiemThu() }, quyen: { roles: ["quanly"], view: () => vQuyen() },
};
const HOME = { khach: "lich", nhanvien: "soat", quanly: "tongquan" };
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
  const pass = `<div class="relative">${`<input id="li-pass" type="${LOGIN.show ? "text" : "password"}" autocomplete="${reg ? "new-password" : "current-password"}" placeholder="${reg ? "Ít nhất 6 ký tự" : "Mật khẩu"}" class="${INPUT} !h-12 pr-12" ${LOGIN.field === "pass" ? 'aria-invalid="true"' : ""}>`}<button type="button" class="${B.icon} absolute right-1 top-1" data-act="toggle-pass" aria-label="${LOGIN.show ? "Ẩn" : "Hiện"} mật khẩu">${ic(LOGIN.show ? "eye-off" : "eye")}</button></div>`;
  const form = reg
    ? `<form class="grid gap-4" data-form="register" novalidate>${field("Họ và tên", `<input id="li-name" autocomplete="name" placeholder="Nguyễn Văn A" class="${INPUT} !h-12" ${LOGIN.field === "name" ? 'aria-invalid="true"' : ""}>`)}${field("Tên đăng nhập", `<input id="li-user" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="vd: nguyenvana" class="${INPUT} !h-12" ${LOGIN.field === "user" ? 'aria-invalid="true"' : ""}>`, "Chữ thường không dấu, số, dấu chấm hoặc gạch dưới.")}${field("Mật khẩu", pass)}${err}<button type="submit" class="${B.primary} min-h-12" ${LOGIN.busy ? "disabled" : ""}>${LOGIN.busy ? "Đang tạo…" : "Tạo tài khoản khách"}</button></form>
       <p class="text-center text-sm text-muted">Đã có tài khoản? <a href="#/dangnhap" class="font-medium text-foreground underline underline-offset-2">Đăng nhập</a></p>`
    : `<form class="grid gap-4" data-form="login" novalidate>${field("Tên đăng nhập", `<input id="li-user" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="Tên đăng nhập" class="${INPUT} !h-12" ${LOGIN.field ? 'aria-invalid="true"' : ""}>`)}${field("Mật khẩu", pass)}${err}<button type="submit" class="${B.primary} min-h-12" ${LOGIN.busy ? "disabled" : ""}>${LOGIN.busy ? "Đang đăng nhập…" : "Đăng nhập"}</button></form>
       <p class="text-center text-sm text-muted">Chưa có tài khoản? <a href="#/dangky" class="font-medium text-foreground underline underline-offset-2">Tạo tài khoản khách</a></p>`;
  return `<main class="grid min-h-screen place-items-center p-4">
    <div class="grid w-full max-w-[400px] gap-6">
      <div class="grid justify-items-center gap-3 text-center">${LOGO}<div><h1 class="text-xl font-semibold">${reg ? "Tạo tài khoản" : "Đăng nhập"}</h1><p class="mt-1 text-sm text-muted">Hệ thống bán vé xem phim CineVin</p></div></div>
      <section class="grid gap-4 rounded-2xl border border-border bg-surface p-5 sm:p-6">${form}</section>
      ${reg ? "" : `<section class="rounded-2xl border border-border bg-surface p-2"><p class="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted">Tài khoản demo – bấm để vào</p>${demo}</section>`}
      <p class="text-center text-xs text-muted">${Remote.v4 ? "Mật khẩu kiểm tra trên máy chủ (bcrypt)." : Remote.status === "connecting" ? "Đang kết nối máy chủ…" : "Máy chủ chưa bật đăng nhập (migration 004) – đang dùng tài khoản demo trên trình duyệt."}</p>
    </div></main>`;
}
async function doLogin(u, p) {
  LOGIN = { ...LOGIN, busy: true, err: "", field: "" }; render();
  const r = await Auth.login(u, p);
  LOGIN.busy = false;
  if (!r.ok) { LOGIN.err = r.message; LOGIN.field = "user"; render(); const x = $("#li-user"); if (x) x.value = u; return; }
  LOGIN = { err: "", field: "", busy: false, show: false };
  bindProfile(); save(); location.hash = "#/" + HOME[Auth.user.role]; render();
  toast(`Xin chào ${Auth.user.name}`);
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
  const ids = fixedKey ? IDENTITIES.filter(i => i.key === fixedKey) : who === "lab" ? IDENTITIES : who === "teacher" ? IDENTITIES.filter(i => i.key === "gv") : IDENTITIES.filter(i => i.key !== "gv");
  let chosen = ids[0], stopCam = null, pairH = null;
  const account = who === "gate-teacher" ? "Soát vé" : who === "lab" ? "Kiểm thử · " + Auth.user.name : S.user.name;
  const sh = openSheet("", { label: title, onClose: () => { stopCam && stopCam(); pairH && pairH.close(); render(); } });
  const consent = () => sh.set(`${sheetHead(title)}
    ${who === "gate-teacher" ? `<p class="text-sm">Đối chiếu khuôn mặt 1:1 người phụ trách đoàn với ảnh gốc trong CSDL dân cư.</p>` : `
    <div class="rounded-xl border border-border p-4"><p class="text-sm font-medium">CINEVIN yêu cầu chia sẻ từ VNeID</p>
      <ul class="mt-2 grid gap-1.5 text-sm"><li class="flex items-center gap-2 text-success">${ic("check")}<span class="text-foreground">Họ và tên</span></li><li class="flex items-center gap-2 text-success">${ic("check")}<span class="text-foreground">Ngày sinh</span></li><li class="flex items-center gap-2 text-muted">${ic("x")}Ảnh khuôn mặt, số căn cước, địa chỉ</li></ul></div>`}
    ${field(`Hồ sơ dân cư mẫu ${badge("Mô phỏng VNeID", TONE.neutral)}`, selectBox("vn-id", ids.map(i => [i.key, `${i.name} – ${i.note}`]), chosen.key))}
    <button type="button" class="${B.primary}" data-m="methods">${who === "gate-teacher" ? "Tiếp tục" : "Mở VNeID để xác thực"}</button>`);
  const methods = async () => {
    chosen = IDENTITIES.find(i => i.key === (selVal("vn-id") || chosen.key)) || chosen;
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
    if (r.ok && who !== "gate-teacher") vneidRec = await logVerif("vneid", true, { key: chosen.key, method: "đồng ý chia sẻ họ tên, ngày sinh (mô phỏng)", detail: { name: chosen.name, dob: chosen.dob, who, face_record: r.recordId || null } });
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
      if (qr && qr.status === "static") { g.result = { kind: "static", code, qr }; gatePush(code, "static", d + " · " + via); return; }
      if (t.needDoc) { g.result = { kind: "doc", code, qr }; gatePush(code, "doc", d); return; }
      if (!(await admit(t))) { g.result = { kind: t.status === "valid" ? "none" : t.status, code, qr }; return; }
      log("gate", `Vào phòng: ${t.code} (${t.viewerName})`); g.result = { kind: "ok", code, qr }; gatePush(code, "ok", d);
    } else if (grp) {
      g.result = { kind: "group", code: grp.code }; gatePush(grp.code, "group", `${grp.students.length} học sinh · ${grp.teacher}`);
      if (code !== grp.code) setTimeout(() => scanCard(code));
    } else { g.result = { kind: "none", code, qr }; gatePush(code, "none", via); log("gate", `Mã không hợp lệ ${code}`, false); }
  } finally { GATE.busy = false; save(); gateRefresh(); }
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
  "vneid-self"() { verifyFace({ who: "self", title: "Liên kết VNeID", onDone(id, r) { Object.assign(S.user, { linked: true, key: id.key, name: id.name, dob: id.dob, verifiedAt: new Date().toISOString(), faceScore: r.score, method: r.method }); log("vneid", `Liên kết VNeID: ${id.name}, ${ageAt(id.dob, new Date())} tuổi, qua ${r.method}`); } }); },
  unlink() { Object.assign(S.user, { linked: false, dob: null, key: null, name: Auth.user.name, passkey: null }); S.dependents.length = 0; save(); render(); },
  "add-dep"() { openAddDep(); },
  "del-dep"(el) { const i = S.dependents.findIndex(x => x.id === el.dataset.id); if (i >= 0) S.dependents.splice(i, 1); save(); render(); },
  "lich-day"(el) { S.view.day = el.dataset.v; save(); render(); },
  "pick-show"(el) { releaseDraft(); S.draft = { id: rid("D"), showId: el.dataset.show, seats: [], until: null }; save(); go("ghe"); },
  async "toggle-seat"(el) { const d = S.draft, sid = el.dataset.seat, i = d.seats.indexOf(sid);
    if (i >= 0) { d.seats.splice(i, 1); delete S.seats[d.showId][sid]; call("release_seat", { p_show: d.showId, p_seat: sid, p_hold: d.id }); }
    else {
      if (d.seats.length >= S.params.maxTickets) return toast(`Tối đa ${S.params.maxTickets} vé mỗi đơn`); if (seatState(d.showId, sid)) return toast("Ghế vừa có người giữ");
      const until = d.until || new Date(Date.now() + S.params.holdMin * 60000).toISOString();
      el.disabled = true;
      const ok = await call("hold_seat", { p_show: d.showId, p_seat: sid, p_hold: d.id, p_until: until });
      if (!ok) { if (ok === false) toast("Ghế vừa có người khác giữ"); return render(); }
      d.until = until; d.seats.push(sid); (S.seats[d.showId] ||= {})[sid] = { st: "held", by: d.id, until };
    }
    d.assign = null; save(); render(); },
  "cancel-draft"() { releaseDraft(); save(); go("lich"); },
  "to-checkout"() { go("thanhtoan"); },
  "back-seats"() { go("ghe"); },
  "pay-method"(el) { S.view.payMethod = el.dataset.v; render(); },
  async "pay-ok"(el) {
    const d = S.draft;
    if (!d || new Date(d.until) < new Date()) { releaseDraft("Ghế đã hết hạn giữ – giao dịch tự huỷ"); save(); return go("lich"); }
    const sh = show(d.showId), f = film(sh.filmId);
    // vé phim giới hạn tuổi dùng tuổi đã xác thực của tài khoản → chủ tài khoản xác nhận bằng Face ID/vân tay
    const selfAge = RATINGS[f.rating] > 0 && d.assign.some(a => a.viewer.kind !== "other" && S.user.linked);
    let pkFallback = false;
    if (selfAge) { const r = await requirePasskey(`Mua vé phim ${f.rating} bằng tuổi đã xác thực`); if (r === "cancel") return; if (r === "fallback") pkFallback = true; }
    const chk = checkOrder(sh, d.assign); let pts = 0;
    chk.res.forEach((r, i) => log("age", `Đơn ${d.id} ghế ${d.seats[i]} – ${f.rating} – ${r.name}: ${r.block ? r.reason : r.needDoc || (pkFallback && r.verified) ? "cần kiểm tra giấy tờ" : "đạt"}`, !r.block));
    const tks = d.seats.map((sid, i) => { const r = chk.res[i], aud = audience(r.verified || r.level === "Cam kết" ? r.age : null), price = seatPrice(sh, sid) * (1 - aud.disc); pts += Math.round(price * 0.05 / 1000);
      const nd = r.needDoc || (pkFallback && r.verified && RATINGS[f.rating] > 0);
      return { code: rid("V"), orderId: d.id, owner: "user", ownerUser: Auth.user.username, showId: d.showId, seat: sid, viewerName: r.name, aud: aud.label, verified: r.verified, needDoc: nd, reason: pkFallback && r.verified && !r.needDoc ? "Thiết bị không xác nhận chính chủ bằng sinh trắc – kiểm tra giấy tờ tại cửa" : r.reason, price, status: "valid", channel: "Online" }; });
    el.disabled = true;
    const ok = await call("sell_order", { p_show: d.showId, p_hold: d.id, p_tickets: tks.map(t => ({ code: t.code, order_id: t.orderId, device_id: Remote.DEVICE, seat: t.seat, viewer_name: t.viewerName, aud: t.aud, verified: t.verified, need_doc: t.needDoc, reason: t.reason, price: t.price, channel: t.channel })) });
    if (!ok) { releaseDraft(); save(); return go("lich"); }
    tks.forEach(t => { S.seats[d.showId][t.seat] = { st: "sold" }; const ex = S.tickets.find(x => x.code === t.code); ex ? Object.assign(ex, { ownerUser: t.ownerUser }) : S.tickets.push(t); });
    S.user.points += pts; log("pay", `Thanh toán đơn ${d.id}: ${vnd(d.total)} (${S.view.payMethod || "momo"})`);
    S.draft = null; S.view.tk = tks[0].code; save(); go("ve"); toast(`Đặt vé thành công · cộng ${pts} điểm`); },
  "ticket-pick"(el) { S.view.tk = el.dataset.code; render(); window.scrollTo({ top: 0, behavior: "smooth" }); },
  async refund(el) { const t = S.tickets.find(x => x.code === el.dataset.code), mins = (new Date(show(t.showId).start) - new Date()) / 60000;
    if (mins < S.params.refundMin) return toast(`Chỉ hoàn trước giờ chiếu ${S.params.refundMin} phút (còn ${Math.max(0, Math.round(mins))} phút)`);
    if (S.user.refunds >= S.params.refundLimit[tier()]) return toast("Đã hết lượt hoàn vé tháng này");
    if (!confirm(`Hoàn vé ${t.code}? Tiền vào thẻ quà tặng.`)) return;
    const ok = await call("refund_ticket", { p_code: t.code }); if (!ok) { if (ok === false) toast("Vé đã được sử dụng hoặc đã hoàn"); return; }
    t.status = "refunded"; delete S.seats[t.showId][t.seat]; S.user.refunds++; const g = { code: rid("GC"), amount: t.price }; S.gifts.push(g); log("refund", `Hoàn vé ${t.code} → thẻ quà tặng ${g.code}`); save(); render(); toast("Đã hoàn vào thẻ quà tặng " + g.code); },
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
    const code = "G-" + rid("", 5), unit = S.prices.std * (1 - S.params.groupDiscount);
    const students = g.students.map((s, i) => ({ ...s, id: code + "-" + pad(i + 1), card: code + "-" + pad(i + 1), idx: i, entered: false }));
    el.disabled = true;
    const ok = await call("create_group", { p_code: code, p_show: sh.id, p_seats: seats, p_teacher: S.teacher.name, p_teacher_key: S.teacher.key || "gv", p_org: S.teacher.org, p_total: unit * need, p_members: students.map(s => ({ card: s.card, idx: s.idx, name: s.name, dob: s.dob, cls: s.cls })) });
    if (!ok) { if (ok === false) toast("Có ghế vừa bị đặt ở máy khác – bấm lại để chọn khối ghế mới"); return render(); }
    seats.forEach(sid => S.seats[sh.id][sid] = { st: "sold", grp: true });
    const ex = S.groups.find(x => x.code === code), grp = { id: code, code, showId: sh.id, seats, teacher: S.teacher.name, teacherKey: S.teacher.key || "gv", org: S.teacher.org, students, total: unit * need, status: "valid", counted: 0 };
    ex ? Object.assign(ex, grp, { students: ex.students.length ? ex.students : students }) : S.groups.push(grp);
    log("group", `Phát hành vé đoàn ${code}: ${g.students.length} HS, cam kết bởi ${S.teacher.name}`); S.view.gdraft = null; S.view.lastGroup = code; save(); render(); toast("Đã phát hành vé đoàn " + code); },
  /* quầy */
  async "pos-seat"(el) { const p = S.view.pos, sid = el.dataset.seat, i = p.seats.indexOf(sid), hold = "POS-" + Remote.DEVICE;
    if (i >= 0) { p.seats.splice(i, 1); delete S.seats[p.showId][sid]; call("release_seat", { p_show: p.showId, p_seat: sid, p_hold: hold }); }
    else { if (seatState(p.showId, sid)) return; const until = new Date(Date.now() + 600000).toISOString();
      const ok = await call("hold_seat", { p_show: p.showId, p_seat: sid, p_hold: hold, p_until: until }); if (!ok) { if (ok === false) toast("Ghế vừa có người khác giữ"); return render(); }
      p.seats.push(sid); S.seats[p.showId][sid] = { st: "held", by: hold, until }; }
    save(); render(); },
  "pos-docok"(el) { const sid = el.dataset.seat, type = selVal("pos-doc-" + sid); if (!type) return toast("Chọn loại giấy tờ trước"); S.view.pos.docs[sid] = { type, ok: el.dataset.ok === "1" }; log("doc", `Quầy – ghế ${sid}: ${type} – ${el.dataset.ok === "1" ? "đạt" : "không đạt"}`, el.dataset.ok === "1"); save(); render(); },
  async "pos-pay"(el) { const p = S.view.pos, sh = show(p.showId), f = film(sh.filmId);
    const bad = p.seats.filter(sid => p.docs[sid]?.ok === false && RATINGS[f.rating] > 0); if (bad.length) return toast("Vé không đạt độ tuổi – bỏ ghế " + bad.join(", ") + " trước");
    const tks = p.seats.map(sid => { const ty = p.types[sid] || "adult", ok = p.docs[sid]?.ok !== false, disc = ok ? { adult: 0, child: S.prices.child, u22: S.prices.u22, senior: S.prices.senior }[ty] : 0;
      return { code: rid("V"), orderId: "POS", owner: "pos", ownerUser: null, showId: p.showId, seat: sid, viewerName: "Khách tại quầy", aud: { adult: "Người lớn", child: "Trẻ em", u22: "U22", senior: "Người cao tuổi" }[ok ? ty : "adult"], verified: !!p.docs[sid], needDoc: false, price: seatPrice(sh, sid) * (1 - disc), status: "valid", channel: "Quầy" }; });
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
    if (!show(id)) S.shows.push({ id, filmId: f.film, roomId: f.room, start: s0.toISOString(), end: e0.toISOString() }); S.seats[id] ||= {};
    log("admin", `Thêm suất ${film(f.film).title} ${ddmm(s0)} ${hhmm(s0)}`); f.time = ""; delete f._s0; delete f._e0; save(); render(); toast("Đã thêm suất chiếu"); },
  /* tài khoản & quyền */
  async "create-user"() {
    const name = $("#nu-name").value.trim(), u = $("#nu-user").value.trim().toLowerCase(), p = $("#nu-pass").value, role = selVal("nu-role");
    if (name.length < 2) return toast("Nhập họ tên", "bad");
    try { await Remote.rpc("create_user", { p_token: Auth.token, p_user: u, p_pass: p, p_name: name, p_role: role }); S.view.users = null; toast(`Đã tạo tài khoản @${u}`); render(); }
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
const SEL = {
  assign(box, v) { const d = S.draft, i = +box.dataset.i; d.assign[i] = { viewer: v.startsWith("dep:") ? { kind: "dep", depId: v.slice(4) } : { kind: v } }; save(); render(); },
  ns(box, v) { const f = S.view.ns; f[box.dataset.select.slice(3)] = v; if (box.dataset.select === "ns-day") S.view.sday = v; save(); render(); },
  "pos-show"(box, v) { const p = S.view.pos; p.seats.forEach(sid => { delete S.seats[p.showId]?.[sid]; call("release_seat", { p_show: p.showId, p_seat: sid, p_hold: "POS-" + Remote.DEVICE }); }); S.view.pos = { showId: v || null, seats: [], types: {}, docs: {} }; save(); render(); },
  "pos-type"(box, v) { S.view.pos.types[box.dataset.seat] = v; delete S.view.pos.docs[box.dataset.seat]; save(); render(); },
  "gate-doc-type"(box, v) { S.view.gateDoc = v; },
  "nu-role"(box, v) { S.view.nu.role = v; },
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
  const u = $("#li-user").value, p = $("#li-pass").value;
  if (f.dataset.form === "login") { if (!u || !p) { LOGIN.err = "Nhập tên đăng nhập và mật khẩu."; LOGIN.field = "user"; render(); return; } doLogin(u, p); }
  else { const n = $("#li-name").value; LOGIN.busy = true; LOGIN.err = ""; render(); $("#li-user").value = u; $("#li-pass").value = p; $("#li-name").value = n;
    Auth.register(u, p, n).then(r => { LOGIN.busy = false; if (!r.ok) { LOGIN.err = r.message; LOGIN.field = r.field || ""; render(); $("#li-user").value = u; $("#li-pass").value = p; $("#li-name").value = n; return; }
      LOGIN = { err: "", field: "", busy: false, show: false }; bindProfile(); save(); location.hash = "#/lich"; render(); toast("Đã tạo tài khoản – chào mừng " + Auth.user.name); }); }
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
