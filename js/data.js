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
/* Chuỗi rạp: Tỉnh/Thành → Rạp (mã 3 số) → Phòng → Suất. Giá vé theo hạng rạp: A (Hà Nội, TP.HCM), B (Vinh, Đà Nẵng).
   Nghệ An có 2 cơ sở cùng TP Vinh để thử tình huống "một nơi nhiều cơ sở". */
const PRICE_TIERS = {
  A: { weekday: { adult: 115000, child: 68000, senior: 83000, u22: 70000 }, wed: { adult: 79000, child: 68000, senior: 79000, u22: 70000 }, weekend: { adult: 135000, child: 68000, senior: 93000, u22: 70000 }, vip: 5500, couple: 26000, gold: 60000, imax: 80000, s3d: { weekday: 32000, weekend: 53000 }, holiday: 11000 },
  B: { weekday: { adult: 70000, child: 50000, senior: 50000, u22: 60000 }, wed: { adult: 60000, child: 50000, senior: 60000, u22: 60000 }, weekend: { adult: 85000, child: 58000, senior: 58000, u22: 60000 }, vip: 5500, couple: 16000, gold: 40000, imax: 60000, s3d: { weekday: 32000, weekend: 32000 }, holiday: 11000 },
};
const CINEMAS = [
  { id: "086", name: "CineVin Vinh Centre", city: "Nghệ An", district: "TP Vinh", address: "Tầng 4, TTTM Vinh Center, 69 Hồ Tùng Mậu, P. Trường Thi", hotline: "1900 6017", tier: "B" },
  { id: "087", name: "CineVin Hưng Dũng", city: "Nghệ An", district: "TP Vinh", address: "Tầng 3, Aeon Vinh, P. Hưng Dũng", hotline: "1900 6017", tier: "B" },
  { id: "054", name: "CineVin Royal City", city: "Hà Nội", district: "Thanh Xuân", address: "B2, Vincom Mega Mall Royal City, 72A Nguyễn Trãi", hotline: "1900 6017", tier: "A" },
  { id: "027", name: "CineVin Long Biên", city: "Hà Nội", district: "Long Biên", address: "Tầng 4, Aeon Mall Long Biên, 27 Cổ Linh", hotline: "1900 6017", tier: "A" },
  { id: "035", name: "CineVin Đồng Khởi", city: "TP. Hồ Chí Minh", district: "Quận 1", address: "Tầng 3, Vincom Center Đồng Khởi, 72 Lê Thánh Tôn", hotline: "1900 6017", tier: "A" },
  { id: "012", name: "CineVin Tân Phú", city: "TP. Hồ Chí Minh", district: "Tân Phú", address: "Tầng 3, Aeon Mall Tân Phú, 30 Bờ Bao Tân Thắng", hotline: "1900 6017", tier: "A" },
  { id: "025", name: "CineVin Đà Nẵng", city: "Đà Nẵng", district: "Hải Châu", address: "Tầng 4, Vincom Đà Nẵng, 910A Ngô Quyền", hotline: "1900 6017", tier: "B" },
];
/* kind: 2D · 3D (phụ thu 3D) · GOLD (ghế premium, phụ thu gold). Mã phòng = <mã rạp>-<phòng> để suất luôn mang mã rạp. */
const ROOM_PLAN = {
  "086": [["R1", "2D", 8, 12, [3, 4, 5]], ["R2", "3D", 7, 10, [3, 4]]],
  "087": [["R1", "2D", 10, 14, [4, 5, 6]], ["R2", "GOLD", 6, 8, [0, 1, 2, 3, 4, 5]]],
  "054": [["R1", "2D", 10, 14, [4, 5, 6]], ["R2", "3D", 8, 12, [3, 4, 5]], ["R3", "GOLD", 6, 8, [0, 1, 2, 3, 4, 5]]],
  "027": [["R1", "2D", 8, 12, [3, 4, 5]], ["R2", "2D", 7, 10, [3, 4]]],
  "035": [["R1", "2D", 10, 14, [4, 5, 6]], ["R2", "3D", 8, 12, [3, 4, 5]], ["R3", "GOLD", 6, 8, [0, 1, 2, 3, 4, 5]]],
  "012": [["R1", "2D", 8, 12, [3, 4, 5]], ["R2", "2D", 7, 10, [3, 4]]],
  "025": [["R1", "2D", 8, 12, [3, 4, 5]], ["R2", "3D", 7, 10, [3, 4]]],
};
const ROOM_KIND_TXT = { "2D": "2D Phụ đề", "3D": "3D Phụ đề", GOLD: "2D Phụ đề · Phòng GOLD", IMAX: "IMAX 2D" };
const ROOM_KINDS = ["2D", "3D", "GOLD", "IMAX"];
const ROOMS = [];
for (const cid in ROOM_PLAN) ROOM_PLAN[cid].forEach(([r, kind, rows, cols, vip], i) => ROOMS.push({ id: `${cid}-${r}`, cinemaId: cid, name: `Phòng ${i + 1}${kind === "2D" ? "" : " · " + kind}`, kind, rows, cols, vip, vipSeats: [], couple: [], blocked: [], seatMap: {}, active: true, note: "" }));
/* Lịch chiếu cố định theo ngày (hôm nay + 2 ngày tới): mọi máy sinh ra cùng một lịch với cùng mã suất,
   nên khi nối Supabase chỉ máy đầu tiên tạo, các máy sau dùng chung. Ghế "đã bán sẵn" sinh theo hạt giống cố định. */
function buildSchedule() {
  // mỗi rạp 9 suất/ngày xoay vòng qua các phòng; giờ lệch vài phút theo rạp cho khác nhau
  const plan = [["f1", 9, 30], ["f2", 11, 0], ["f3", 13, 30], ["f4", 15, 0], ["f1", 16, 30], ["f2", 18, 0], ["f4", 19, 30], ["f3", 20, 0], ["f5", 22, 0]];
  const rows = [], sold = [];
  for (let day = 0; day < 3; day++) {
    // ngày theo giờ Việt Nam: máy ở múi giờ khác vẫn sinh đúng lịch (cùng mã suất, cùng giờ chiếu)
    const vn = new Date(Date.now() + 7 * 3600000 + day * 864e5), Y = vn.getUTCFullYear(), M = vn.getUTCMonth(), D = vn.getUTCDate();
    const ymd = Y + pad(M + 1) + pad(D);
    CINEMAS.forEach((c, ci) => {
      const rooms = ROOMS.filter(r => r.cinemaId === c.id);
      plan.forEach(([fid, h, m], i) => {
        const r = rooms[(i + ci) % rooms.length], st = new Date(Date.UTC(Y, M, D, h - 7, m + (ci * 5) % 20));
        const f = FILMS.find(x => x.id === fid), en = new Date(st.getTime() + (f.dur + 15) * 60000), id = `${ymd}-${c.id}-${i + 1}`;
        rows.push({ id, film_id: fid, room_id: r.id, cinema_id: c.id, format: ROOM_KIND_TXT[r.kind], start_at: st.toISOString(), end_at: en.toISOString() });
        let seed = [...id].reduce((a, c2) => (a * 31 + c2.charCodeAt(0)) >>> 0, 7);
        const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
        // không gieo ghế "đã bán" mẫu nữa: mọi suất bắt đầu từ 0, số liệu chỉ đến từ giao dịch thật
        const seen = new Set(), fill = 0;
        for (let k = 0; k < r.rows * r.cols * fill; k++) { const sid = seatId(rnd() * r.rows | 0, rnd() * r.cols | 0); if (!seen.has(sid)) { seen.add(sid); sold.push({ show_id: id, seat: sid }); } }
      });
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
  const shows = sch.rows.map(r => ({ id: r.id, filmId: r.film_id, roomId: r.room_id, cinemaId: r.cinema_id, format: r.format, start: r.start_at, end: r.end_at }));
  const seats = {}; shows.forEach(s => seats[s.id] = {}); sch.sold.forEach(x => seats[x.show_id][x.seat] = { st: "sold" });
  return {
    v: 7, day: new Date().toDateString(), view: {},
    params: { holdMin: 5, refundMin: 45, refundLimit: { Member: 2, U22: 2, VIP: 3, VVIP: 4 }, maxTickets: 8, spot: 5, groupMin: 10, parentRequired: ["T13", "T16", "T18"], groupDiscount: 0.15 },
    prices: PRICE_TIERS, cinemas: CINEMAS,
    profiles: {}, user: newProfile().user, teacher: newProfile().teacher, dependents: [],
    films: FILMS.map(f => ({ ...f })), rooms: ROOMS, shows, seats, tickets: [], groups: [], gifts: [], logs: [], verifs: [], draft: null,
  };
}
/* ---------- Store (localStorage + đồng bộ tab) ---------- */
const Store = (() => {
  const KEY = "cinevin-state-v7";
  function load() { try { const raw = localStorage.getItem(KEY); if (raw) { const s = JSON.parse(raw); if (s && s.v === 7 && s.day === new Date().toDateString()) return s; } } catch (e) {} return seedState(); }
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
  // có migration 005: liên kết VNeID, điểm, tuỳ chọn là của máy chủ (đổi thiết bị vẫn còn); passkey, người phụ thuộc, vai giáo viên vẫn theo thiết bị
  if (Remote.v5 && u.token) {
    if (u.citizenKey) Object.assign(p.user, { linked: true, key: u.citizenKey, name: u.name, dob: u.dob, verifiedAt: u.vneidAt, method: u.vneidMethod || p.user.method });
    else Object.assign(p.user, { linked: false, key: null, dob: null, verifiedAt: null, name: u.name });
    if (u.points != null) p.user.points = u.points;
    p.user.confirmEvery = !!u.confirmEvery;
  }
  S.user = p.user; S.teacher = p.teacher; S.dependents = p.dependents;
}
const film = id => S.films.find(f => f.id === id) || { id, title: "Phim mới", rating: "P", dur: 100, genre: "", img: null };
const room = id => S.rooms.find(r => r.id === id) || S.rooms[0];
/* ---------- chuỗi rạp ---------- */
const cinema = id => CINEMAS.find(c => c.id === id) || CINEMAS[0];
const cinemaOf = sh => cinema(sh && (sh.cinemaId || String(sh.roomId || "").split("-")[0]));
const cities = () => [...new Set(CINEMAS.filter(c => c.active !== false).map(c => c.city))];
/* ---------- danh mục từ máy chủ (migration 006/008): rạp, phòng, phim, phân phối – thay cho dữ liệu mẫu ---------- */
const DIST = new Set();   // cặp "rạp|phim" đã bị bỏ phân phối
const SEED_ORDER = CINEMAS.map(c => c.id);   // giữ thứ tự hiển thị như dữ liệu mẫu (rạp nhà trước), rạp mới thêm xếp sau theo mã
const seedRank = id => { const i = SEED_ORDER.indexOf(id); return i < 0 ? 1000 + Number(id) : i; };
function applyCatalog({ cinemas, rooms, films, cinemaFilms, seatTypes, priceTiers } = {}) {
  if (cinemas && cinemas.length) { CINEMAS.length = 0; [...cinemas].sort((a, b) => seedRank(a.id) - seedRank(b.id)).forEach(c => CINEMAS.push({ id: c.id, name: c.name, city: c.city, district: c.district || "", address: c.address || "", hotline: c.hotline || "", tier: c.tier || "B", prices: c.prices && c.prices.weekday ? c.prices : null, active: c.active !== false })); }
  if (rooms && rooms.length) { ROOMS.length = 0; rooms.forEach(r => ROOMS.push({ id: r.id, cinemaId: r.cinema_id, name: r.name, kind: r.kind || "2D", rows: r.rows, cols: r.cols, vip: r.vip || [], vipSeats: r.vip_seats || [], couple: r.couple || [], blocked: r.blocked || [], seatMap: r.seat_map || {}, active: r.active !== false, note: r.note || "" })); S.rooms = ROOMS; }
  if (films && films.length) { FILMS.length = 0; films.forEach(f => FILMS.push({ id: f.id, title: f.title, rating: f.rating, dur: f.dur, genre: f.genre || "", img: f.img || null, active: f.active !== false })); S.films = FILMS; }
  if (seatTypes && seatTypes.length) setSeatTypes(seatTypes.map(t => ({ id: t.id, name: t.name, persons: t.persons || 1, surchargeA: Number(t.surcharge_a) || 0, surchargeB: Number(t.surcharge_b) || 0, fixedA: t.fixed_a == null ? null : Number(t.fixed_a), fixedB: t.fixed_b == null ? null : Number(t.fixed_b), color: t.color || "gray", icon: t.icon || null, sellable: t.sellable !== false, sort: t.sort ?? 100, builtin: !!t.builtin, active: t.active !== false })));
  if (priceTiers && priceTiers.length) priceTiers.forEach(t => { if (t.prices && t.prices.weekday) PRICE_TIERS[t.id] = { ...PRICE_TIERS[t.id], ...t.prices }; });
  if (cinemaFilms) { DIST.clear(); cinemaFilms.forEach(x => { if (!x.active) DIST.add(x.cinema_id + "|" + x.film_id); }); }
}
const filmAt = (cid, fid) => !DIST.has(cid + "|" + fid);
/** Phim đang chiếu được tại một rạp: còn hoạt động và được phân phối */
const filmsAt = cid => S.films.filter(f => f.active !== false && filmAt(cid, f.id));
const isBlocked = (r, sid) => isBlockedKind(seatKind(r, sid));
const cinemasIn = city => CINEMAS.filter(c => c.city === city);
/** Rạp khách đang xem (nhớ trên thiết bị). Mặc định rạp đầu tiên của chuỗi. */
const CINEMA_KEY = "cinevin-cinema";
function curCinema() { let id = null; try { id = localStorage.getItem(CINEMA_KEY); } catch (e) {} return cinema(id || "086"); }
function setCurCinema(id) { try { localStorage.setItem(CINEMA_KEY, id); } catch (e) {} }
/** Rạp của nhân viên/quản lý: máy chủ (006) gắn cinema_id; quản lý chuỗi (null) chọn rạp đang thao tác. */
const STAFF_DEMO_CINEMA = { nhanvien: "086", quanlyvinh: "086", kythuat: "086" };
function staffCinemaId() { const u = Auth.user; if (!u) return null; if (u.cinemaId !== undefined) return u.cinemaId; return STAFF_DEMO_CINEMA[u.username] ?? null; }
const isChainManager = () => Auth.user && Auth.user.role === "quanly" && staffCinemaId() === null;
function workCinema() { const fixed = staffCinemaId(); if (fixed) return cinema(fixed); let id = null; try { id = localStorage.getItem("cinevin-work-cinema"); } catch (e) {} return cinema(id || "086"); }
function setWorkCinema(id) { try { localStorage.setItem("cinevin-work-cinema", id); } catch (e) {} }
const showsOf = cid => S.shows.filter(s => cinemaOf(s).id === cid && s.status !== "cancelled");
const roomsOf = cid => S.rooms.filter(r => r.cinemaId === cid);
const formatOf = sh => sh.format || ROOM_KIND_TXT[(room(sh.roomId) || {}).kind] || "2D Phụ đề";
/** "CineVin Vinh Centre · Phòng 2 · 3D" – nơi chiếu in trên vé, lịch, quầy */
const placeOf = sh => `${cinemaOf(sh).name} · ${room(sh.roomId).name}`;
/** Giá thường / VIP (người lớn) của một suất, cho chú giải sơ đồ ghế */
/** Giá từng loại ghế có trong phòng của suất: { std, vip, …, types: [{ id, name, price, n }] } */
function priceLegend(sh) {
  const r = room(sh.roomId), out = {}, n = {};
  for (let i = 0; i < r.rows; i++) for (let j = 0; j < r.cols; j++) { const sid = seatId(i, j), k = seatKind(r, sid); n[k] = (n[k] || 0) + 1; if (!isBlockedKind(k) && out[k] == null) out[k] = seatPrice(sh, sid); }
  // loại nhiều chỗ: giá hiện cho cả nhóm (ví dụ ghế đôi = 2 ghế)
  const types = seatTypeList().filter(t => n[t.id]).map(t => { let price = out[t.id] ?? null; if (price != null && t.persons > 1) { const first = (() => { for (let i = 0; i < r.rows; i++) for (let j = 0; j < r.cols; j++) { const sid = seatId(i, j); if (seatKind(r, sid) === t.id) return sid; } })(); const unit = seatUnit(r, first); price = unit.reduce((a, m) => a + seatPrice(sh, m), 0); return { ...t, price, n: n[t.id], unitSize: unit.length }; } return { ...t, price, n: n[t.id], unitSize: 1 }; });
  const base = out.std ?? (types.find(t => t.price != null) || {}).price ?? 0;
  return { ...out, std: base, types, hasVip: out.vip != null, hasCouple: out.couple != null };
}
const show = id => S.shows.find(s => s.id === id);
const ON = () => Remote.online;
/** Vé của tôi: tôi mua, hoặc bạn mua cho tôi (viewer_user) */
const mine = t => !!Auth.user && (t.ownerUser === Auth.user.username || t.viewerUser === Auth.user.username);

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
/* ---------- loại ghế: danh mục tự định nghĩa (011), mặc định 4 loại; mỗi loại: số người ngồi, phụ thu theo hạng rạp, màu, biểu tượng, có bán hay không ---------- */
const SEAT_TYPES = {};
const SEAT_TYPE_DEFAULTS = [
  { id: "std", name: "Thường", persons: 1, surchargeA: 0, surchargeB: 0, fixedA: null, fixedB: null, color: "gray", icon: null, sellable: true, sort: 1, builtin: true },
  { id: "vip", name: "VIP", persons: 1, surchargeA: 5500, surchargeB: 5500, fixedA: null, fixedB: null, color: "amber", icon: "crown", sellable: true, sort: 2, builtin: true },
  { id: "couple", name: "Ghế đôi", persons: 2, surchargeA: 26000, surchargeB: 16000, fixedA: null, fixedB: null, color: "rose", icon: "heart", sellable: true, sort: 3, builtin: true },
  { id: "blocked", name: "Bảo trì", persons: 1, surchargeA: 0, surchargeB: 0, fixedA: null, fixedB: null, color: "gray", icon: "wrench", sellable: false, sort: 99, builtin: true },
];
function setSeatTypes(list) { for (const k in SEAT_TYPES) delete SEAT_TYPES[k]; list.forEach(t => SEAT_TYPES[t.id] = { ...t }); }
setSeatTypes(SEAT_TYPE_DEFAULTS);
const seatTypeList = () => Object.values(SEAT_TYPES).filter(t => t.active !== false).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
const seatType = id => SEAT_TYPES[id] || SEAT_TYPES.std;
/** Màu loại ghế → lớp CSS: sơ đồ khách (seat), nút công cụ (tool), chú giải (dot) */
const SEAT_COLORS = {
  gray: { seat: "bg-surface border-border-strong text-foreground hover:bg-button-hover", tool: "border-border-strong bg-surface", dot: "border-border-strong bg-surface" },
  amber: { seat: "bg-surface border-warning/60 text-foreground hover:bg-warning-bg", tool: "border-warning/60 bg-warning-bg text-warning", dot: "border-warning/60 bg-surface" },
  rose: { seat: "bg-surface border-[var(--primary)]/50 text-foreground hover:bg-primary-light", tool: "border-[var(--primary)]/50 bg-primary-light text-primary", dot: "border-[var(--primary)]/50 bg-surface" },
  sky: { seat: "bg-surface border-sky-400 text-foreground hover:bg-sky-50", tool: "border-sky-400 bg-sky-50 text-sky-700", dot: "border-sky-400 bg-surface" },
  violet: { seat: "bg-surface border-violet-400 text-foreground hover:bg-violet-50", tool: "border-violet-400 bg-violet-50 text-violet-700", dot: "border-violet-400 bg-surface" },
  green: { seat: "bg-surface border-success/60 text-foreground hover:bg-success-bg", tool: "border-success/60 bg-success-bg text-success", dot: "border-success/60 bg-surface" },
  orange: { seat: "bg-surface border-orange-400 text-foreground hover:bg-orange-50", tool: "border-orange-400 bg-orange-50 text-orange-700", dot: "border-orange-400 bg-surface" },
};
const seatColor = (t, part) => (SEAT_COLORS[t.color] || SEAT_COLORS.gray)[part];
const SEAT_ICONS = ["crown", "heart", "sofa", "armchair", "users", "star", "gem", "sparkles", "baby", "accessibility", "wrench", "ban"];
/** Loại ghế của một ghế: sơ đồ theo ghế (011) → mảng 009 → hàng VIP (006) → thường. Loại đã xoá → thường. */
function seatKind(r, sid) {
  const m = r.seatMap && r.seatMap[sid]; if (m && SEAT_TYPES[m]) return m;
  if ((r.blocked || []).includes(sid)) return "blocked";
  if ((r.couple || []).includes(sid)) return "couple";
  if ((r.vipSeats || []).includes(sid) || (r.vip || []).includes(sid.charCodeAt(0) - 65)) return "vip";
  return "std";
}
const isBlockedKind = k => seatType(k).sellable === false;
/** Ghế nhiều chỗ (đôi 2, ghế 3, sofa 4…) chiếm n ghế liền nhau trong hàng: trả về Map ghế → các ghế cùng nhóm (ghế đầu đứng trước) */
function seatGroups(r) {
  const key = `${r.rows}x${r.cols}|${JSON.stringify(r.seatMap || {})}|${(r.couple || []).join()}|${Object.keys(SEAT_TYPES).join()}`;
  if (r._gk === key && r._g instanceof Map) return r._g;
  const g = new Map();
  for (let i = 0; i < r.rows; i++) { let j = 0; while (j < r.cols) { const sid = seatId(i, j), k = seatKind(r, sid), ty = seatType(k);
    if (ty.persons > 1 && ty.sellable) { const members = [sid]; let jj = j + 1; while (jj < r.cols && members.length < ty.persons && seatKind(r, seatId(i, jj)) === k) { members.push(seatId(i, jj)); jj++; } members.forEach(m => g.set(m, members)); j = jj; }
    else j++; } }
  r._gk = key; r._g = g; return g;
}
/** Các ghế đi cùng một nút trên sơ đồ: ghế nhóm → cả nhóm, ghế thường → chính nó */
const seatUnit = (r, sid) => seatGroups(r).get(sid) || [sid];
/** Bảng giá của rạp: bảng riêng (quản lý tự đặt) hoặc bảng theo hạng A/B */
const tierOf = c => (c && c.prices && c.prices.weekday) ? c.prices : (PRICE_TIERS[(c || {}).tier] || PRICE_TIERS.B);
const isVip = (r, sid) => seatKind(r, sid) === "vip";
const isCouple = (r, sid) => seatKind(r, sid) === "couple";
const SEAT_KIND_TXT = new Proxy({}, { get: (_, k) => seatType(k).name });
/** Loại ngày của suất: thứ Tư vui vẻ · cuối tuần (T6, T7, CN) · ngày thường */
function dayType(sh) { const d = new Date(sh.start).getDay(); return d === 3 ? "wed" : (d === 0 || d === 5 || d === 6) ? "weekend" : "weekday"; }
/** Giá một ghế = bảng giá của rạp [loại ngày][đối tượng] + phụ thu ghế VIP + phụ thu 3D / phòng GOLD */
function seatPrice(sh, sid, aud = "adult") {
  const r = room(sh.roomId), c = cinemaOf(sh), t = tierOf(c), dt = dayType(sh);
  let p = t[dt][aud] ?? t[dt].adult;
  // loại ghế: ghế nhiều chỗ (đôi, ghế 3, sofa…) chiếm n ghế liền – mỗi ghế thành viên = giá cơ bản + phụ thu chia đều; cả nhóm = giá cơ bản × n + phụ thu
  const ty = seatType(seatKind(r, sid)), sur = Number(c.tier === "A" ? ty.surchargeA : ty.surchargeB) || 0, fixed = c.tier === "A" ? ty.fixedA : ty.fixedB;
  // giá cứng: giá cuối cùng của cả ghế/nhóm, không theo ngày, đối tượng hay loại phòng
  if (fixed != null) return ty.persons > 1 ? Math.round(fixed / seatUnit(r, sid).length) : fixed;
  p += ty.persons > 1 ? Math.round(sur / seatUnit(r, sid).length) : sur;
  if (r.kind === "3D") p += t.s3d[dt === "weekend" ? "weekend" : "weekday"];
  if (r.kind === "GOLD") p += t.gold;
  if (r.kind === "IMAX") p += t.imax || t.gold;
  return p;
}
function audience(age) { if (age == null) return { label: "Người lớn", key: "adult", disc: 0 }; if (age < 13) return { label: "Trẻ em", key: "child", disc: 0 }; if (age <= 22) return { label: "U22", key: "u22", disc: 0 }; if (age >= 60) return { label: "Người cao tuổi", key: "senior", disc: 0 }; return { label: "Người lớn", key: "adult", disc: 0 }; }
const AUD_KEY = { adult: "adult", child: "child", u22: "u22", senior: "senior" };
function viewerInfo(v, when) {
  if (v.kind === "self") return S.user.linked ? { name: S.user.name, age: ageAt(S.user.dob, when), verified: true, level: "VNeID" } : { name: S.user.name + " (chưa xác thực)", age: null, verified: false, level: null };
  if (v.kind === "dep") { const d = S.dependents.find(x => x.id === v.depId); return d ? { name: d.name, age: ageAt(d.dob, when), verified: d.level === "VNeID", level: d.level } : { name: "?", age: null, verified: false }; }
  // bạn đi cùng có tài khoản: máy chủ đã trả tên, đã xác thực chưa, tuổi tại ngày chiếu
  if (v.kind === "friend") return v.verified ? { name: v.name, age: v.age, verified: true, level: "VNeID", user: v.user } : { name: v.name + " (chưa xác thực)", age: null, verified: false, level: null, user: v.user };
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
function freeSeats(s) { const r = room(s.roomId); let n = 0; for (let i = 0; i < r.rows; i++) for (let j = 0; j < r.cols; j++) { const sid = seatId(i, j); if (!isBlocked(r, sid) && !seatState(s.id, sid)) n++; } return n; }
const capacity = s => { const r = room(s.roomId); return r.rows * r.cols - (r.blocked || []).filter(sid => { const i = sid.charCodeAt(0) - 65, j = +sid.slice(1) - 1; return i < r.rows && j < r.cols; }).length; };
const soldCount = s => Object.values(S.seats[s.id] || {}).filter(x => x.st === "sold").length;
function releaseDraft(msg) { const d = S.draft; if (!d) return; if (ON()) Remote.rpc("release_hold", { p_hold: d.id }).catch(() => {}); d.seats.forEach(sid => { const s = S.seats[d.showId]?.[sid]; if (s && s.st === "held" && s.by === d.id) delete S.seats[d.showId][sid]; }); S.draft = null; if (msg) toast(msg); }
setInterval(() => {
  const d = S.draft; if (!d || !d.until) return; const left = new Date(d.until) - new Date();
  if (left <= 0) { releaseDraft("Hết thời gian giữ ghế – ghế đã được nhả"); log("hold", "Nhả ghế quá hạn đơn " + d.id); save(); go("lich"); return; }
  $$("[data-hold-timer]").forEach(el => el.textContent = pad(Math.floor(left / 60000)) + ":" + pad(Math.floor(left / 1000) % 60));
}, 500);
/* Ghế người khác giữ mà bỏ dở (đóng trình duyệt, không trả tiền): máy chủ hết giữ sau 5 phút.
   Màn hình đang mở sơ đồ ghế phải tự trả ghế đó về trống – không thì nút vẫn khoá, không ai chọn được. */
setInterval(() => {
  const ids = [S.draft && S.draft.showId, S.view.pos && S.view.pos.showId].filter(Boolean), now = Date.now();
  let changed = false;
  ids.forEach(id => { const m = S.seats[id] || {}; for (const sid in m) if (m[sid].st === "held" && new Date(m[sid].until).getTime() < now) { delete m[sid]; changed = true; } });
  if (changed && typeof scheduleRender === "function") scheduleRender();
}, 1000);
const endOf = s => s.end ? new Date(s.end) : new Date(new Date(s.start).getTime() + (film(s.filmId).dur + 15) * 60000);
const dayKey = d => new Date(d).toDateString();
