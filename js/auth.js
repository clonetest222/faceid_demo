/* Auth – đăng nhập / đăng ký / hồ sơ tài khoản.
   Máy chủ (migration 004 + 005): mật khẩu bcrypt, token phiên 7 ngày; đăng nhập bằng tên đăng nhập, email hoặc SĐT;
   đăng nhập FaceID (so khớp khuôn mặt ở máy chủ với hồ sơ VNeID đã liên kết) và VNeID (mô phỏng).
   Hồ sơ VNeID, điểm thưởng, tuỳ chọn lưu trên máy chủ → đổi thiết bị vẫn còn.
   Chưa có máy chủ: tài khoản demo trên trình duyệt, chỉ để thử giao diện. */
"use strict";
const Auth = (() => {
  const KEY = "cinevin-session", LOCAL = "cinevin-local-users";
  const DEMO = [
    { username: "khach", pass: "khach123", role: "khach", name: "Nguyễn Văn An", note: "Khách hàng" },
    { username: "giaovien", pass: "giaovien123", role: "khach", name: "Phạm Thu Hà", note: "Khách – giáo viên mua vé đoàn" },
    { username: "nhanvien", pass: "nhanvien123", role: "nhanvien", name: "Lê Minh Tuấn", note: "Nhân viên · CineVin Vinh Centre" },
    { username: "kythuat", pass: "kythuat123", role: "kythuat", name: "Hoàng Văn Kỹ", note: "Kỹ thuật · phòng chiếu, ghế · CineVin Vinh Centre" },
    { username: "phucvu", pass: "phucvu123", role: "phucvu", name: "Đỗ Thị Hạnh", note: "Phục vụ sảnh · nhận ca, chấm công · CineVin Vinh Centre" },
    { username: "quanlyvinh", pass: "quanlyvinh123", role: "quanly", name: "Trần Quốc Bảo", note: "Quản lý rạp · CineVin Vinh Centre" },
    { username: "quanly", pass: "quanly123", role: "quanly", name: "Ngô Thị Lan", note: "Quản lý chuỗi · toàn bộ rạp" },
  ];
  const ROLE_TXT = { khach: "Khách hàng", nhanvien: "Nhân viên", kythuat: "Kỹ thuật", phucvu: "Phục vụ", quanly: "Quản lý" };
  const ERR = {
    invalid_login: "Sai tài khoản hoặc mật khẩu.",
    username_taken: "Tên đăng nhập đã có người dùng.",
    email_taken: "Email này đã đăng ký tài khoản khác.",
    phone_taken: "Số điện thoại này đã đăng ký tài khoản khác.",
    weak_password: "Mật khẩu cần ít nhất 6 ký tự.",
    bad_username: "Tên đăng nhập 3–32 ký tự: chữ thường không dấu, số, dấu chấm hoặc gạch dưới.",
    bad_name: "Nhập họ tên.",
    bad_email: "Email không đúng định dạng.",
    bad_phone: "Số điện thoại 10 số, bắt đầu bằng 0 (hoặc +84).",
    citizen_taken: "Hồ sơ VNeID này đã liên kết với một tài khoản khác. Mỗi người chỉ có một tài khoản đã xác thực.",
    face_not_linked: "Tài khoản chưa liên kết VNeID nên chưa có khuôn mặt để đối chiếu – đăng nhập bằng mật khẩu rồi liên kết ở Tài khoản.",
    face_not_enrolled: "Hồ sơ chưa có ảnh gốc trên máy chủ – xác thực lại VNeID bằng mật khẩu trước.",
    face_mismatch: "Khuôn mặt không khớp với chủ tài khoản.",
    vneid_not_linked: "Số căn cước / tài khoản này chưa gắn với tài khoản nào đã xác thực VNeID.",
    voucher_unknown: "Không có mã này.", voucher_used: "Mã đã dùng rồi.", voucher_expired: "Mã đã hết hạn.", voucher_not_yours: "Thẻ quà tặng này của tài khoản khác.", voucher_invalid: "Mã giảm giá không còn hợp lệ.",
    companion_unknown: "Không tìm thấy tài khoản khách hàng này.", companion_self: "Đó là tài khoản của bạn – chọn “Tôi”.", companion_underage: "Bạn đi cùng chưa đủ tuổi xem phim này (theo hồ sơ VNeID của họ).",
    wrong_cinema: "Vé/suất này thuộc rạp khác – tài khoản của bạn chỉ thao tác ở rạp mình.",
    has_tickets: "Suất đã bán vé: chỉ đổi giờ được, không đổi phòng (ghế gắn với phòng). Muốn đổi phòng hãy huỷ suất.",
    show_cancelled: "Suất này đã huỷ.",
    room_inactive: "Phòng đang tạm ngưng hoạt động.",
    film_not_at_cinema: "Phim chưa được phân phối cho rạp này (Kho phim → phân phối).",
    film_inactive: "Phim đã ngừng chiếu trong kho phim.",
    room_in_use: "Phòng còn vé của suất sắp chiếu – huỷ các suất trước khi xoá phòng.",
    cinema_in_use: "Cơ sở đã có vé bán – chỉ nên tạm ngưng, không xoá.",
    seats_sold: "Không thu nhỏ phòng được: có ghế đã bán nằm ngoài kích thước mới.",
    bad_room_id: "Mã phòng dạng <mã rạp>-R1 (chữ/số, tối đa 6 ký tự).",
    bad_cinema_id: "Mã cơ sở là 3 chữ số.",
    bad_size: "Kích thước phòng: 1–26 hàng, 1–30 ghế mỗi hàng.",
    bad_input: "Thiếu tên hoặc tỉnh/thành.",
    unknown_show: "Không tìm thấy suất chiếu.",
    builtin_type: "Loại ghế mặc định không xoá được (có thể đổi tên, phụ thu).",
    bad_dob: "Ngày sinh không hợp lệ (5–110 tuổi).",
    bad_id_number: "Số căn cước gồm 12 chữ số.",
    id_taken: "Số căn cước này đã gắn với tài khoản khác.",
    already_linked: "Tài khoản đang liên kết hồ sơ khác – huỷ liên kết trước.",
    account_disabled: "Tài khoản đã bị khoá – liên hệ quản lý.",
    shift_overlap: "Nhân viên đã có ca trùng giờ.",
    unknown_shift: "Không tìm thấy ca.",
    too_early: "Chưa tới giờ vào ca (được chấm trước 2 giờ).",
    not_checked_in: "Chưa chấm vào ca nên không chấm ra được.",
    unknown_user: "Không tìm thấy tài khoản.",
    seat_sold_blocked: "Ghế đã bán / đang giữ cho suất sắp chiếu – không đánh dấu bảo trì được. Hoàn hoặc đổi vé trước.",
    forbidden: "Tài khoản không có quyền làm việc này.",
    not_logged_in: "Phiên đăng nhập đã hết – đăng nhập lại.",
  };
  const message = e => { const m = String((e && (e.message || e)) || "");
    const sb = /seat_sold_blocked ([A-Z0-9, ]+)/.exec(m); if (sb) return `Ghế ${sb[1]} đã bán / đang giữ cho suất sắp chiếu – không đánh dấu bảo trì được. Hoàn hoặc đổi vé trước.`;
    for (const k in ERR) if (m.includes(k)) return ERR[k]; return "Không kết nối được máy chủ – thử lại."; };
  let user = null;
  try { user = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  const store = u => { user = u; try { u ? localStorage.setItem(KEY, JSON.stringify(u)) : localStorage.removeItem(KEY); } catch (e) {} };
  const fromServer = r => ({ token: r.token, username: r.username, role: r.role, name: r.name, email: r.email || null, phone: r.phone || null,
    citizenKey: r.citizen_key || null, dob: r.dob || null, vneidAt: r.vneid_verified_at || null, vneidMethod: r.vneid_method || null,
    points: r.points == null ? null : r.points, confirmEvery: !!r.confirm_every, cinemaId: r.cinema_id === undefined ? undefined : (r.cinema_id || null), offline: false });
  const localUsers = () => { let extra = []; try { extra = JSON.parse(localStorage.getItem(LOCAL)) || []; } catch (e) {} return [...DEMO, ...extra]; };
  const okUser = u => /^[a-z0-9_.]{3,32}$/.test(u);
  const norm = s => String(s || "").trim();

  async function login(id, pass) {
    const u = norm(id).toLowerCase();
    if (await Remote.hasV4()) {
      try { store(fromServer(await Remote.rpc("login", { p_user: u, p_pass: pass }))); return { ok: true }; }
      catch (e) { return { ok: false, message: message(e) }; }
    }
    const d = localUsers().find(x => (x.username === u || x.email === u || x.phone === u) && x.pass === pass);
    if (!d) return { ok: false, message: ERR.invalid_login };
    store({ token: null, username: d.username, role: d.role, name: d.name, email: d.email || null, phone: d.phone || null, offline: true });
    return { ok: true };
  }
  /** Đăng nhập FaceID: trình duyệt chỉ gửi vector 128 số, máy chủ so với ảnh gốc của hồ sơ VNeID đã liên kết */
  async function loginFace(id, descriptor) {
    if (!(await Remote.hasV5())) return { ok: false, message: "Máy chủ chưa bật đăng nhập FaceID (migration 005)." };
    try {
      const r = await Remote.rpc("login_face", { p_user: norm(id).toLowerCase(), p_descriptor: descriptor, p_device: Remote.DEVICE });
      if (!r || !r.ok) return { ok: false, message: ERR.face_mismatch, score: r && r.score, dist: r && r.distance };
      store(fromServer(r)); return { ok: true, score: r.score };
    } catch (e) { return { ok: false, message: message(e) }; }
  }
  /** Đăng nhập VNeID (mô phỏng cổng VNeID trả về hồ sơ người dùng đã đồng ý chia sẻ) */
  /** Đăng nhập VNeID (mô phỏng): số căn cước hoặc tài khoản + khuôn mặt của chính chủ (014) */
  async function loginVneid2(id, descriptor) {
    try { const r = await Remote.rpc("login_vneid2", { p_id: norm(id), p_descriptor: descriptor, p_device: Remote.DEVICE });
      if (!r.ok) return { ok: false, message: "Khuôn mặt không khớp với ảnh gốc đã đăng ký.", score: r.score, dist: Number(r.distance) };
      store(fromServer(r)); return { ok: true, score: r.score }; }
    catch (e) { return { ok: false, message: message(e) }; }
  }
  async function loginVneid(key) {
    if (!(await Remote.hasV5())) return { ok: false, message: "Máy chủ chưa bật đăng nhập VNeID (migration 005)." };
    try { store(fromServer(await Remote.rpc("login_vneid", { p_key: key, p_device: Remote.DEVICE }))); return { ok: true }; }
    catch (e) { return { ok: false, message: message(e) }; }
  }
  async function register({ username, pass, name, email = "", phone = "" }) {
    const u = norm(username).toLowerCase(), em = norm(email).toLowerCase(), ph = norm(phone).replace(/[^\d+]/g, "");
    if (norm(name).length < 2) return { ok: false, message: ERR.bad_name, field: "name" };
    if (em && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return { ok: false, message: ERR.bad_email, field: "email" };
    if (ph && !/^(\+84|0)\d{9}$/.test(ph)) return { ok: false, message: ERR.bad_phone, field: "phone" };
    if (!okUser(u)) return { ok: false, message: ERR.bad_username, field: "user" };
    if (String(pass || "").length < 6) return { ok: false, message: ERR.weak_password, field: "pass" };
    if (await Remote.hasV4()) {
      const args = { p_user: u, p_pass: pass, p_name: norm(name) };
      if (await Remote.hasV5()) { args.p_email = em || null; args.p_phone = ph || null; }   // máy chủ cũ (004) chỉ nhận 3 tham số
      try { store(fromServer(await Remote.rpc("register", args))); return { ok: true }; }
      catch (e) { const m = e.message || ""; return { ok: false, message: message(e), field: /username_taken/.test(m) ? "user" : /email/.test(m) ? "email" : /phone/.test(m) ? "phone" : "" }; }
    }
    if (localUsers().some(x => x.username === u)) return { ok: false, message: ERR.username_taken, field: "user" };
    const extra = localUsers().slice(DEMO.length); extra.push({ username: u, pass, role: "khach", name: norm(name), email: em || null, phone: ph || null });
    try { localStorage.setItem(LOCAL, JSON.stringify(extra)); } catch (e) {}
    store({ token: null, username: u, role: "khach", name: norm(name), email: em || null, phone: ph || null, offline: true });
    return { ok: true };
  }
  function logout() { if (user && user.token) Remote.rpc("logout", { p_token: user.token }).catch(() => {}); store(null); }
  /** Cập nhật phiên từ JSON máy chủ trả về (sau liên kết VNeID, đổi tuỳ chọn, thanh toán…) */
  function refresh(r) { if (r && r.username) store(fromServer(r)); }
  function setPoints(p) { if (user && p != null) store({ ...user, points: p }); }
  /** Kiểm lại phiên với máy chủ. Trả về false nếu phiên không còn (cần đăng nhập lại). */
  async function check() {
    if (!user) return false;
    const v4 = await Remote.hasV4();
    if (!v4) return true;
    if (!user.token) { store(null); return false; }
    try { const r = await Remote.rpc("session_info", { p_token: user.token }); if (!r) { store(null); return false; } store(fromServer(r)); } catch (e) {}
    return true;
  }
  return { get user() { return user; }, get token() { return user && user.token; }, login, loginFace, loginVneid, loginVneid2, register, logout, refresh, setPoints, check, message, DEMO, ROLE_TXT };
})();
