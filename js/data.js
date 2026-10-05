/* Dữ liệu & luật nghiệp vụ: phim, phòng, lịch chiếu, giá, độ tuổi, giữ ghế.
   Trạng thái lưu trong trình duyệt (localStorage); khi có Supabase thì vé/ghế/suất lấy từ máy chủ và cập nhật realtime. */
"use strict";
const RATINGS = { P: 0, K: 0, T13: 13, T16: 16, T18: 18 };
const RATING_TXT = { P: "Mọi lứa tuổi", K: "Dưới 13 tuổi xem cùng cha mẹ/người giám hộ", T13: "Từ đủ 13 tuổi", T16: "Từ đủ 16 tuổi", T18: "Từ đủ 18 tuổi" };
/* Hồ sơ mẫu thay cho dữ liệu dân cư thật mà VNeID trả về */
const IDENTITIES = [
  { key: "an", name: "Nguyễn Văn An", dob: "2004-03-12", note: "22 tuổi – giá U22" },
  { key: "binh", name: "Trần Thị Bình", dob: "2011-08-20", note: "15 tuổi – bị chặn phim T16, T18" },
  { key: "cuc", name: "Lê Thị Cúc", dob: "1958-01-05", note: "68 tuổi – giá người cao tuổi" },
  { key: "gv", name: "Phạm Thu Hà", dob: "1990-11-02", note: "Giáo viên chủ nhiệm" },
];
const seatId = (r, c) => String.fromCharCode(65 + r) + (c + 1);
function seatRows(seats) { const rows = [...new Set(seats.map(s => s[0]))].sort(); return `${seats.length} ghế, hàng ${rows[0]}${rows.length > 1 ? "–" + rows[rows.length - 1] : ""}`; }
const IMG = id => `https://images.unsplash.com/photo-${id}?w=400&q=70&auto=format&fit=crop`;
/* Ảnh poster là ảnh mẫu Unsplash – thay bằng poster thật khi triển khai. "Vụ Án Phòng Số 7" cố ý không có ảnh. */
const FILMS = [
  { id: "f1", title: "Siêu Nhí Tí Hon", rating: "P", dur: 95, genre: "Hoạt hình", img: IMG("1558060370-d644479cb6f7") },
  { id: "f2", title: "Chú Mèo Lạc Đường", rating: "K", dur: 100, genre: "Gia đình", img: IMG("1514888286974-6c03e2ca1dba") },
  { id: "f3", title: "Đỉnh Gió Hồng Lĩnh", rating: "T13", dur: 118, genre: "Phiêu lưu", img: IMG("1506905925346-21bda4d32df4") },
  { id: "f4", title: "Vụ Án Phòng Số 7", rating: "T16", dur: 112, genre: "Trinh thám", img: null },
  { id: "f5", title: "Bóng Đêm Phố Cổ", rating: "T18", dur: 106, genre: "Kinh dị", img: IMG("1509248961158-e54f6934749c") },
];
const ROOMS = [
  { id: "R1", name: "Phòng 1", rows: 8, cols: 12, vip: [3, 4, 5] },
  { id: "R2", name: "Phòng 2", rows: 7, cols: 10, vip: [3, 4] },
  { id: "R3", name: "Phòng 3", rows: 10, cols: 14, vip: [4, 5, 6] },
];
/* Lịch chiếu cố định theo ngày (hôm nay + 2 ngày tới): mọi máy sinh ra cùng một lịch với cùng mã suất,
   nên khi nối Supabase chỉ máy đầu tiên tạo, các máy sau dùng chung. Ghế "đã bán sẵn" sinh theo hạt giống cố định. */
function buildSchedule() {
  const plan = [["f1", "R3", 9, 30], ["f2", "R2", 11, 0], ["f3", "R2", 13, 30], ["f4", "R1", 15, 0], ["f1", "R3", 16, 30], ["f2", "R2", 18, 0], ["f4", "R1", 19, 30], ["f3", "R3", 20, 0], ["f5", "R1", 22, 0]];
  const rows = [], sold = [];
  for (let day = 0; day < 3; day++) {
    // ngày theo giờ Việt Nam: máy ở múi giờ khác vẫn sinh đúng lịch (cùng mã suất, cùng giờ chiếu)
    const vn = new Date(Date.now() + 7 * 3600000 + day * 864e5), Y = vn.getUTCFullYear(), M = vn.getUTCMonth(), D = vn.getUTCDate();
    const ymd = Y + pad(M + 1) + pad(D);
    plan.forEach(([fid, rid_, h, m], i) => {
      const st = new Date(Date.UTC(Y, M, D, h - 7, m));
      const f = FILMS.find(x => x.id === fid), en = new Date(st.getTime() + (f.dur + 15) * 60000), id = `${ymd}-${i + 1}`;
      rows.push({ id, film_id: fid, room_id: rid_, start_at: st.toISOString(), end_at: en.toISOString() });
      let seed = [...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
      const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
      const r = ROOMS.find(x => x.id === rid_), seen = new Set();
      for (let k = 0; k < r.rows * r.cols * 0.16; k++) { const sid = seatId(rnd() * r.rows | 0, rnd() * r.cols | 0); if (!seen.has(sid)) { seen.add(sid); sold.push({ show_id: id, seat: sid }); } }
    });
  }
  return { rows, sold };
}
const newProfile = name => ({
  user: { name: name || "Khách", linked: false, dob: null, key: null, verifiedAt: null, faceScore: null, points: 120, refunds: 0 },
  teacher: { linked: false, name: null, dob: null, org: "Trường THCS Lê Lợi (dữ liệu mẫu)" },
  dependents: [],
});
function seedState() {
  const sch = buildSchedule();
  const shows = sch.rows.map(r => ({ id: r.id, filmId: r.film_id, roomId: r.room_id, start: r.start_at, end: r.end_at }));
  const seats = {}; shows.forEach(s => seats[s.id] = {}); sch.sold.forEach(x => seats[x.show_id][x.seat] = { st: "sold" });
  return {
    v: 6, day: new Date().toDateString(), view: {},
    params: { holdMin: 5, refundMin: 45, refundLimit: { Member: 2, U22: 2, VIP: 3, VVIP: 4 }, maxTickets: 8, spot: 5, groupMin: 10, parentRequired: ["T13", "T16", "T18"], groupDiscount: 0.15 },
    prices: { std: 85000, vip: 95000, weekend: 10000, child: 0.30, u22: 0.20, senior: 0.30 },
    profiles: {}, user: newProfile().user, teacher: newProfile().teacher, dependents: [],
    films: FILMS.map(f => ({ ...f })), rooms: ROOMS, shows, seats, tickets: [], groups: [], gifts: [], logs: [], verifs: [], draft: null,
  };
}
/* ---------- Store (localStorage + đồng bộ tab) ---------- */
const Store = (() => {
  const KEY = "cinevin-state-v6";
  function load() { try { const raw = localStorage.getItem(KEY); if (raw) { const s = JSON.parse(raw); if (s && s.v === 6 && s.day === new Date().toDateString()) return s; } } catch (e) {} return seedState(); }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }
  function reset() { try { localStorage.removeItem(KEY); } catch (e) {} return seedState(); }
  function onRemoteChange(cb) { window.addEventListener("storage", e => { if (e.key === KEY && e.newValue) cb(); }); }
  return { load, save, reset, onRemoteChange };
})();
let S = Store.load();
const save = () => Store.save(S);
/** Mỗi tài khoản có hồ sơ riêng trên thiết bị (liên kết VNeID, passkey, người phụ thuộc, vai giáo viên) */
function bindProfile() {
  const u = Auth.user; if (!u) return;
  const p = S.profiles[u.username] || (S.profiles[u.username] = newProfile(u.name));
  if (!p.user.linked) p.user.name = u.name;
  S.user = p.user; S.teacher = p.teacher; S.dependents = p.dependents;
}
const film = id => S.films.find(f => f.id === id) || { id, title: "Phim mới", rating: "P", dur: 100, genre: "", img: null };
const room = id => S.rooms.find(r => r.id === id);
const show = id => S.shows.find(s => s.id === id);
const ON = () => Remote.online;
const mine = t => Auth.user && (t.ownerUser ? t.ownerUser === Auth.user.username : false);

/* Hàm máy chủ có bản kiểm tra vai trò (migration 004): gọi bản đó kèm token */
const RPC4 = { sell_order: "sell_order_u", refund_ticket: "refund_ticket_u", create_group: "create_group_u", admit_ticket: "admit_ticket_s", scan_member: "scan_member_s", member_spot: "member_spot_s", group_update: "group_update_s", add_show: "add_show_s", reset_demo: "reset_demo_s", reset_citizen_face: "reset_citizen_face_s" };
async function rpcAuth(name, args) {
  if (Remote.v4 && RPC4[name]) return Remote.rpc(RPC4[name], { p_token: Auth.token, ...args });
  return Remote.rpc(name, args);
}
/** Gọi RPC khi trực tuyến; ngoại tuyến trả về `offline` để xử lý cục bộ. Lỗi → thông báo, trả về null. */
async function call(name, args, offline = true) {
  if (!ON()) return offline;
  try { return await rpcAuth(name, args); }
  catch (e) {
    console.warn(name, e);
    toast(/hold_expired/.test(e.message) ? "Ghế đã hết hạn giữ" : /forbidden|not_logged_in/.test(e.message) ? Auth.message(e) : "Lỗi kết nối máy chủ – thử lại", "bad");
    if (/not_logged_in/.test(e.message)) { Auth.logout(); go("dangnhap"); }
    return null;
  }
}
function log(type, msg, ok = true) {
  if (type === "passkey") logVerif("passkey", ok, { key: S.user.key, method: (S.user.passkey && S.user.passkey.label) || "passkey", detail: { msg } });
  if (type === "doc") logVerif("doc", ok, { method: "kiểm tra giấy tờ tại rạp", detail: { msg } });
  if (ON()) { Remote.rpc("add_log", { p_type: type, p_msg: msg, p_ok: ok }).catch(() => {}); return; }
  S.logs.unshift({ t: new Date().toISOString(), type, msg, ok }); S.logs = S.logs.slice(0, 400);
}
async function logVerif(kind, ok, { key = null, method = "", detail = {} } = {}) {
  if (!Remote.v2 || !Remote.ensureClient()) return null;
  try { return await Remote.rpc("log_verification", { p_kind: kind, p_ok: ok, p_key: key, p_account: (S.user && S.user.name) || "Khách", p_device: Remote.DEVICE, p_method: method, p_detail: detail }); } catch (e) { return null; }
}
function tier() { if (S.user.linked && ageAt(S.user.dob, new Date()) <= 22) return "U22"; return S.user.points >= 4000 ? "VIP" : "Member"; }

/* ---------- giá & độ tuổi ---------- */
const isVip = (r, sid) => r.vip.includes(sid.charCodeAt(0) - 65);
function seatPrice(sh, sid) { const r = room(sh.roomId); let p = isVip(r, sid) ? S.prices.vip : S.prices.std; const d = new Date(sh.start).getDay(); if (d === 0 || d === 5 || d === 6) p += S.prices.weekend; return p; }
function audience(age) { if (age == null) return { label: "Người lớn", disc: 0 }; if (age < 13) return { label: "Trẻ em", disc: S.prices.child }; if (age <= 22) return { label: "U22", disc: S.prices.u22 }; if (age >= 60) return { label: "Người cao tuổi", disc: S.prices.senior }; return { label: "Người lớn", disc: 0 }; }
function viewerInfo(v, when) {
  if (v.kind === "self") return S.user.linked ? { name: S.user.name, age: ageAt(S.user.dob, when), verified: true, level: "VNeID" } : { name: S.user.name + " (chưa xác thực)", age: null, verified: false, level: null };
  if (v.kind === "dep") { const d = S.dependents.find(x => x.id === v.depId); return d ? { name: d.name, age: ageAt(d.dob, when), verified: d.level === "VNeID", level: d.level } : { name: "?", age: null, verified: false }; }
  return { name: "Người đi cùng", age: null, verified: false, level: null };
}
function checkOrder(sh, assigns) {
  const f = film(sh.filmId), min = RATINGS[f.rating];
  const res = assigns.map(a => {
    const vi = viewerInfo(a.viewer, sh.start); const r = { ...vi, block: false, needDoc: false, reason: "" };
    if (vi.age != null && min > 0 && vi.age < min) { r.block = true; r.reason = `Chưa đủ ${min} tuổi tại ngày chiếu (${vi.age} tuổi)`; }
    else if (min > 0 && (vi.age == null || vi.level === "Cam kết")) { r.needDoc = true; r.reason = "Chưa xác thực tuổi – kiểm tra giấy tờ tại cửa"; }
    return r;
  });
  let orderErr = "";
  if (f.rating === "K") {
    const hasChild = res.some(r => r.age != null && r.age < 13), hasAdult = res.some(r => (r.age != null && r.age >= 18) || r.age == null);
    if (hasChild && !hasAdult) orderErr = "Phim K: trẻ dưới 13 tuổi phải đi cùng cha mẹ hoặc người giám hộ – thêm vé người lớn vào đơn.";
    res.forEach(r => { if (r.age == null) { r.needDoc = true; r.reason = "Phim K: kiểm tra người lớn đi kèm tại cửa"; } });
  }
  return { res, orderErr, ok: !orderErr && !res.some(r => r.block) };
}

/* ---------- ghế & giữ chỗ ---------- */
function seatState(showId, sid) { const s = S.seats[showId]?.[sid]; if (!s) return null; if (s.st === "held" && new Date(s.until) < new Date()) { delete S.seats[showId][sid]; return null; } return s; }
function freeSeats(s) { const r = room(s.roomId); let n = 0; for (let i = 0; i < r.rows; i++) for (let j = 0; j < r.cols; j++) if (!seatState(s.id, seatId(i, j))) n++; return n; }
const capacity = s => { const r = room(s.roomId); return r.rows * r.cols; };
function releaseDraft(msg) { const d = S.draft; if (!d) return; if (ON()) Remote.rpc("release_hold", { p_hold: d.id }).catch(() => {}); d.seats.forEach(sid => { const s = S.seats[d.showId]?.[sid]; if (s && s.st === "held" && s.by === d.id) delete S.seats[d.showId][sid]; }); S.draft = null; if (msg) toast(msg); }
setInterval(() => {
  const d = S.draft; if (!d || !d.until) return; const left = new Date(d.until) - new Date();
  if (left <= 0) { releaseDraft("Hết thời gian giữ ghế – ghế đã được nhả"); log("hold", "Nhả ghế quá hạn đơn " + d.id); save(); go("lich"); return; }
  $$("[data-hold-timer]").forEach(el => el.textContent = pad(Math.floor(left / 60000)) + ":" + pad(Math.floor(left / 1000) % 60));
}, 500);
const endOf = s => s.end ? new Date(s.end) : new Date(new Date(s.start).getTime() + (film(s.filmId).dur + 15) * 60000);
const dayKey = d => new Date(d).toDateString();
