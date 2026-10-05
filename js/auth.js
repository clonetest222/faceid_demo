/* Auth – đăng nhập tài khoản/mật khẩu và vai trò.
   Có migration 004: máy chủ kiểm mật khẩu (bcrypt), cấp token phiên; mọi hàm nhạy cảm kiểm vai trò bằng token.
   Chưa có 004 / mất mạng: dùng tài khoản demo kiểm tra trên trình duyệt (chỉ để thử giao diện, không an toàn). */
"use strict";
const Auth = (() => {
  const KEY = "cinevin-session", LOCAL = "cinevin-local-users";
  const DEMO = [
    { username: "khach", pass: "khach123", role: "khach", name: "Nguyễn Văn An", note: "Khách hàng" },
    { username: "giaovien", pass: "giaovien123", role: "khach", name: "Phạm Thu Hà", note: "Khách – giáo viên mua vé đoàn" },
    { username: "nhanvien", pass: "nhanvien123", role: "nhanvien", name: "Lê Minh Tuấn", note: "Nhân viên soát vé, quầy" },
    { username: "quanly", pass: "quanly123", role: "quanly", name: "Ngô Thị Lan", note: "Quản lý rạp" },
  ];
  const ROLE_TXT = { khach: "Khách hàng", nhanvien: "Nhân viên", quanly: "Quản lý" };
  const ERR = {
    invalid_login: "Sai tên đăng nhập hoặc mật khẩu.",
    username_taken: "Tên đăng nhập đã có người dùng.",
    weak_password: "Mật khẩu cần ít nhất 6 ký tự.",
    bad_username: "Tên đăng nhập 3–32 ký tự: chữ thường không dấu, số, dấu chấm hoặc gạch dưới.",
    bad_name: "Nhập họ tên.",
    forbidden: "Tài khoản không có quyền làm việc này.",
    not_logged_in: "Phiên đăng nhập đã hết – đăng nhập lại.",
  };
  const message = e => { const m = String((e && (e.message || e)) || ""); for (const k in ERR) if (m.includes(k)) return ERR[k]; return "Không kết nối được máy chủ – thử lại."; };
  let user = null;
  try { user = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  const store = u => { user = u; try { u ? localStorage.setItem(KEY, JSON.stringify(u)) : localStorage.removeItem(KEY); } catch (e) {} };
  const fromServer = r => ({ token: r.token, username: r.username, role: r.role, name: r.name, offline: false });
  const localUsers = () => { let extra = []; try { extra = JSON.parse(localStorage.getItem(LOCAL)) || []; } catch (e) {} return [...DEMO, ...extra]; };
  const okUser = u => /^[a-z0-9_.]{3,32}$/.test(u);

  async function login(username, pass) {
    const u = String(username || "").trim().toLowerCase();
    if (await Remote.hasV4()) {
      try { store(fromServer(await Remote.rpc("login", { p_user: u, p_pass: pass }))); return { ok: true }; }
      catch (e) { return { ok: false, message: message(e) }; }
    }
    const d = localUsers().find(x => x.username === u && x.pass === pass);
    if (!d) return { ok: false, message: ERR.invalid_login };
    store({ token: null, username: d.username, role: d.role, name: d.name, offline: true });
    return { ok: true };
  }
  async function register(username, pass, name) {
    const u = String(username || "").trim().toLowerCase();
    if (!okUser(u)) return { ok: false, message: ERR.bad_username, field: "user" };
    if (String(pass || "").length < 6) return { ok: false, message: ERR.weak_password, field: "pass" };
    if (String(name || "").trim().length < 2) return { ok: false, message: ERR.bad_name, field: "name" };
    if (await Remote.hasV4()) {
      try { store(fromServer(await Remote.rpc("register", { p_user: u, p_pass: pass, p_name: name.trim() }))); return { ok: true }; }
      catch (e) { return { ok: false, message: message(e), field: /username_taken/.test(e.message) ? "user" : "" }; }
    }
    if (localUsers().some(x => x.username === u)) return { ok: false, message: ERR.username_taken, field: "user" };
    const extra = localUsers().slice(DEMO.length); extra.push({ username: u, pass, role: "khach", name: name.trim() });
    try { localStorage.setItem(LOCAL, JSON.stringify(extra)); } catch (e) {}
    store({ token: null, username: u, role: "khach", name: name.trim(), offline: true });
    return { ok: true };
  }
  function logout() { if (user && user.token) Remote.rpc("logout", { p_token: user.token }).catch(() => {}); store(null); }
  /** Kiểm lại phiên với máy chủ. Trả về false nếu phiên không còn (cần đăng nhập lại). */
  async function check() {
    if (!user) return false;
    const v4 = await Remote.hasV4();
    if (!v4) return true;
    if (!user.token) { store(null); return false; }      // phiên ngoại tuyến cũ – máy chủ đã có đăng nhập thật
    try { const r = await Remote.rpc("session_info", { p_token: user.token }); if (!r) { store(null); return false; } store(fromServer(r)); } catch (e) {}
    return true;
  }
  return { get user() { return user; }, get token() { return user && user.token; }, login, register, logout, check, message, DEMO, ROLE_TXT };
})();
