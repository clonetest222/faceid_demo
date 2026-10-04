/* CineVin – ứng dụng chính. Dữ liệu demo lưu trong trình duyệt (localStorage) và tự đồng bộ giữa các tab.
   Lớp lưu trữ gói trong Store để sau thay bằng Supabase (Postgres + Realtime) mà không đổi giao diện. */
"use strict";

/* ============================ dữ liệu mẫu ============================ */
const RATINGS = { P: 0, K: 0, T13: 13, T16: 16, T18: 18 };
const RATING_TXT = { P: "Mọi lứa tuổi", K: "Dưới 13 tuổi xem cùng cha mẹ/người giám hộ", T13: "Từ đủ 13 tuổi", T16: "Từ đủ 16 tuổi", T18: "Từ đủ 18 tuổi" };
/* Hồ sơ mẫu thay cho dữ liệu dân cư thật mà VNeID trả về */
const IDENTITIES = [
  { key: "an", name: "Nguyễn Văn An", dob: "2004-03-12", note: "22 tuổi – được giá U22" },
  { key: "binh", name: "Trần Thị Bình", dob: "2011-08-20", note: "15 tuổi – bị chặn phim T16, T18" },
  { key: "cuc", name: "Lê Thị Cúc", dob: "1958-01-05", note: "68 tuổi – giá người cao tuổi" },
  { key: "gv", name: "Phạm Thu Hà", dob: "1990-11-02", note: "Giáo viên chủ nhiệm" },
];
const seatId = (r, c) => String.fromCharCode(65 + r) + (c + 1);
function seatRows(seats) { const rows = [...new Set(seats.map(s => s[0]))].sort(); return `${seats.length} ghế, hàng ${rows[0]}${rows.length > 1 ? "–" + rows[rows.length - 1] : ""}`; }

const FILMS = [
  { id: "f1", title: "Siêu Nhí Tí Hon", rating: "P", dur: 95, genre: "Hoạt hình", hue: 150 },
  { id: "f2", title: "Chú Mèo Lạc Đường", rating: "K", dur: 100, genre: "Gia đình", hue: 210 },
  { id: "f3", title: "Đỉnh Gió Hồng Lĩnh", rating: "T13", dur: 118, genre: "Phiêu lưu", hue: 45 },
  { id: "f4", title: "Vụ Án Phòng Số 7", rating: "T16", dur: 112, genre: "Trinh thám", hue: 25 },
  { id: "f5", title: "Bóng Đêm Phố Cổ", rating: "T18", dur: 106, genre: "Kinh dị", hue: 350 },
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
    const d0 = new Date(); d0.setHours(0, 0, 0, 0); d0.setDate(d0.getDate() + day);
    const ymd = d0.getFullYear() + pad(d0.getMonth() + 1) + pad(d0.getDate());
    plan.forEach(([fid, rid_, h, m], i) => {
      const st = new Date(d0); st.setHours(h, m);
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
function seedState() {
  const sch = buildSchedule();
  const shows = sch.rows.map(r => ({ id: r.id, filmId: r.film_id, roomId: r.room_id, start: r.start_at, end: r.end_at }));
  const seats = {}; shows.forEach(s => seats[s.id] = {}); sch.sold.forEach(x => seats[x.show_id][x.seat] = { st: "sold" });
  return {
    v: 5, day: new Date().toDateString(), role: "kh", view: { name: "home" },
    params: { holdMin: 5, refundMin: 45, refundLimit: { Member: 2, U22: 2, VIP: 3, VVIP: 4 }, maxTickets: 8, spot: 5, groupMin: 10, parentRequired: ["T13", "T16", "T18"], groupDiscount: 0.15 },
    prices: { std: 85000, vip: 95000, weekend: 10000, child: 0.30, u22: 0.20, senior: 0.30 },
    user: { name: "Khách", linked: false, dob: null, key: null, verifiedAt: null, faceScore: null, points: 120, refunds: 0 },
    teacher: { linked: false, name: null, dob: null, org: "Trường THCS Lê Lợi (dữ liệu mẫu)" },
    dependents: [], films: FILMS.map(f => ({ ...f })), rooms: ROOMS, shows, seats, tickets: [], groups: [], gifts: [], logs: [], draft: null,
  };
}
/* ============================ Store (localStorage + đồng bộ tab) ============================ */
const Store = (() => {
  const KEY = "cinevin-state-v5";
  function load() { try { const raw = localStorage.getItem(KEY); if (raw) { const s = JSON.parse(raw); if (s && s.v === 5 && s.day === new Date().toDateString()) return s; } } catch (e) {} return seedState(); }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }
  function reset() { try { localStorage.removeItem(KEY); } catch (e) {} return seedState(); }
  // tab khác thay đổi dữ liệu → nạp lại (ví dụ: tab Soát vé thấy vé vừa bán ở tab Khách hàng)
  function onRemoteChange(cb) { window.addEventListener("storage", e => { if (e.key === KEY && e.newValue) cb(); }); }
  return { load, save, reset, onRemoteChange };
})();

let S = Store.load();
const save = () => Store.save(S);
const film = id => S.films.find(f => f.id === id) || { id, title: "Phim mới", rating: "P", dur: 100, genre: "", hue: 0 };
const room = id => S.rooms.find(r => r.id === id);
const show = id => S.shows.find(s => s.id === id);
const ON = () => Remote.online;     // đang dùng dữ liệu chung trên Supabase
function log(type, msg, ok = true) {
  if (ON()) { Remote.rpc("add_log", { p_type: type, p_msg: msg, p_ok: ok }).catch(() => {}); return; }   // realtime sẽ đưa bản ghi về
  S.logs.unshift({ t: new Date().toISOString(), type, msg, ok }); S.logs = S.logs.slice(0, 400);
}
/** Gọi RPC khi trực tuyến; ngoại tuyến trả về `offline` để xử lý cục bộ. Lỗi mạng → thông báo, trả về null. */
async function call(name, args, offline = true) {
  if (!ON()) return offline;
  try { return await Remote.rpc(name, args); } catch (e) { console.warn(name, e); toast(e.message === "hold_expired" || /hold_expired/.test(e.message) ? "Ghế đã hết hạn giữ" : "Lỗi kết nối máy chủ – thử lại"); return null; }
}
/* Vẽ lại khi dữ liệu realtime đổi; hoãn nếu người dùng đang gõ trong ô nhập */
let rerenderPending = false;
function scheduleRender() {
  if (rerenderPending) return; rerenderPending = true;
  requestAnimationFrame(() => {
    const a = document.activeElement;
    if (a && a.closest && a.closest("#app") && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) { a.addEventListener("blur", () => { rerenderPending = false; scheduleRender(); }, { once: true }); return; }
    rerenderPending = false; render();
  });
}
function tier() { if (S.user.linked && ageAt(S.user.dob, new Date()) <= 22) return "U22"; return S.user.points >= 4000 ? "VIP" : "Member"; }

/* ============================ giá & độ tuổi ============================ */
function seatPrice(sh, sid) { const r = room(sh.roomId); let p = r.vip.includes(sid.charCodeAt(0) - 65) ? S.prices.vip : S.prices.std; const d = new Date(sh.start).getDay(); if (d === 0 || d === 5 || d === 6) p += S.prices.weekend; return p; }
function audience(age) { if (age == null) return { label: "Người lớn", disc: 0 }; if (age < 13) return { label: "Trẻ em", disc: S.prices.child }; if (age <= 22) return { label: "U22", disc: S.prices.u22 }; if (age >= 60) return { label: "Người cao tuổi", disc: S.prices.senior }; return { label: "Người lớn", disc: 0 }; }
function viewerInfo(v, when) {
  if (v.kind === "self") return S.user.linked ? { name: S.user.name, age: ageAt(S.user.dob, when), verified: true, level: "VNeID" } : { name: S.user.name + " (chưa xác thực)", age: null, verified: false, level: null };
  if (v.kind === "dep") { const d = S.dependents.find(x => x.id === v.depId); return d ? { name: d.name, age: ageAt(d.dob, when), verified: d.level === "VNeID", level: d.level } : { name: "?", age: null, verified: false }; }
  return { name: "Người khác", age: null, verified: false, level: null };
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

/* ============================ ghế & giữ chỗ ============================ */
function seatState(showId, sid) { const s = S.seats[showId]?.[sid]; if (!s) return null; if (s.st === "held" && new Date(s.until) < new Date()) { delete S.seats[showId][sid]; return null; } return s; }
function freeSeats(s) { const r = room(s.roomId); let n = 0; for (let i = 0; i < r.rows; i++) for (let j = 0; j < r.cols; j++) if (!seatState(s.id, seatId(i, j))) n++; return n; }
function releaseDraft(msg) { const d = S.draft; if (!d) return; if (ON()) Remote.rpc("release_hold", { p_hold: d.id }).catch(() => {}); d.seats.forEach(sid => { const s = S.seats[d.showId][sid]; if (s && s.st === "held" && s.by === d.id) delete S.seats[d.showId][sid]; }); S.draft = null; if (msg) toast(msg); }
setInterval(() => {
  const d = S.draft; if (!d || !d.until) return; const left = new Date(d.until) - new Date(); const el = $("#hold-timer");
  if (left <= 0) { releaseDraft("Hết thời gian giữ ghế – ghế đã được nhả"); log("hold", "Nhả ghế quá hạn đơn " + d.id); save(); go({ name: "home" }); return; }
  if (el) el.textContent = pad(Math.floor(left / 60000)) + ":" + pad(Math.floor(left / 1000) % 60);
}, 500);

/* ============================ điều hướng ============================ */
const ROLES = [["kh", "Khách hàng"], ["gv", "Giáo viên · vé đoàn"], ["pos", "Quầy vé"], ["gate", "Soát vé"], ["ql", "Quản lý"]];
function go(view) { S.view = view; save(); render(); window.scrollTo({ top: 0 }); }
function setRole(r) { S.role = r; S.view = { name: r === "kh" ? "home" : "main" }; save(); render(); history.replaceState(null, "", "#" + r); }
function render() {
  $("#roles").innerHTML = ROLES.map(([k, l]) => `<button class="role" aria-pressed="${S.role === k}" data-role="${k}">${l}</button>`).join("");
  try { $("#app").innerHTML = ({ kh: viewKH, gv: viewGV, pos: viewPOS, gate: viewGate, ql: viewQL })[S.role](); }
  catch (e) { console.error(e); $("#app").innerHTML = `<div class="note bad">Lỗi hiển thị: ${esc(e.message)}. <button class="btn sm" data-act="reset">Đặt lại dữ liệu demo</button></div>`; }
}

/* ============================ KHÁCH HÀNG ============================ */
const ratingBadge = r => `<span class="rating r-${r}" title="${esc(RATING_TXT[r])}">${r}</span>`;
const poster = f => `<div class="poster" style="background:linear-gradient(165deg,hsl(${f.hue} 45% 30%),hsl(${(f.hue + 40) % 360} 50% 12%))">${ratingBadge(f.rating)}<h3>${esc(f.title)}</h3></div>`;
const idBadge = () => S.user.linked ? `<span class="chip ok">${ICON_OK}VNeID · ${ageAt(S.user.dob, new Date())} tuổi</span>` : `<span class="chip warn">Chưa xác thực tuổi</span>`;
function viewKH() {
  const v = S.view.name, inBuy = ["film", "seats", "checkout", "pay", "done"].includes(v);
  const nav = `<div class="row"><div class="tabs" role="tablist">${[["home", "Phim"], ["mytickets", "Vé của tôi"], ["account", "Tài khoản & VNeID"]].map(([k, l]) => `<button class="tab" role="tab" aria-selected="${v === k || (k === "home" && inBuy)}" data-go="${k}">${l}</button>`).join("")}</div><div class="right row">${idBadge()}<span class="chip info">${tier()} · ${S.user.points} điểm</span></div></div>`;
  return nav + ({ home: khHome, film: khFilm, seats: khSeats, checkout: khCheckout, pay: khPay, done: khDone, mytickets: khMyTickets, account: khAccount }[v] || khHome)();
}
function khHome() {
  const banner = S.user.linked ? "" : `<div class="note accent row"><div style="flex:1;min-width:220px"><b>Xác thực một lần, mua mọi loại vé.</b> Liên kết VNeID và quét khuôn mặt để mua vé trẻ em, U22, người cao tuổi ngay trên app và vào thẳng phim T13–T18. Máy không có camera? Dùng điện thoại quét mã QR.</div><button class="btn primary" data-act="vneid-self">Liên kết VNeID</button></div>`;
  return banner + `<section class="grid g3">${S.films.map(f => {
    const ss = S.shows.filter(s => s.filmId === f.id && new Date(s.start) > new Date()).sort((a, b) => new Date(a.start) - new Date(b.start));
    return `<button class="film" data-go="film" data-film="${f.id}">${poster(f)}<div class="meta"><span class="muted">${esc(f.genre)} · ${f.dur} phút</span><span>${esc(RATING_TXT[f.rating])}</span><span class="mono faint">${ss.slice(0, 3).map(s => ddmm(s.start) + " " + hhmm(s.start)).join(" · ") || "Hết suất"}</span></div></button>`;
  }).join("")}</section>`;
}
function khFilm() {
  const f = film(S.view.film); if (!f) return khHome();
  const ss = S.shows.filter(s => s.filmId === f.id && new Date(s.start) > new Date()).sort((a, b) => new Date(a.start) - new Date(b.start));
  const days = [...new Set(ss.map(s => new Date(s.start).toDateString()))];
  const min = RATINGS[f.rating];
  const warn = min ? (S.user.linked ? (ageAt(S.user.dob, new Date()) < min ? `<div class="note bad">Tài khoản của bạn (${ageAt(S.user.dob, new Date())} tuổi) chưa đủ tuổi xem phim ${f.rating}. Vé mua cho người khác sẽ phải kiểm tra giấy tờ tại cửa.</div>` : `<div class="note ok">Bạn đã xác thực VNeID và đủ tuổi xem phim ${f.rating} – vào thẳng, không cần giấy tờ.</div>`) : `<div class="note warn">Phim ${f.rating}: ${esc(RATING_TXT[f.rating])}. Vé của tài khoản chưa xác thực sẽ phải kiểm tra giấy tờ tại cửa.</div>`) : (f.rating === "K" ? `<div class="note warn">Phim K: trẻ dưới 13 tuổi phải xem cùng cha mẹ hoặc người giám hộ – đơn phải có vé người lớn.</div>` : "");
  return `<button class="btn ghost sm" data-go="home" style="justify-self:start">← Danh sách phim</button>
  <section class="hero"><div class="film" style="cursor:default">${poster(f)}</div>
  <div class="stack"><h1>${esc(f.title)}</h1><div class="row">${ratingBadge(f.rating)}<span class="muted">${esc(f.genre)} · ${f.dur} phút</span></div>${warn}
  ${days.map(d => `<div class="stack"><h3>${new Date(d).toLocaleDateString("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit" })}</h3><div class="shows">${ss.filter(s => new Date(s.start).toDateString() === d).map(s => `<button class="show" data-act="pick-show" data-show="${s.id}"><b>${hhmm(s.start)}</b><span class="small muted">${room(s.roomId).name} · ${freeSeats(s)} trống</span></button>`).join("")}</div></div>`).join("") || "<p class='muted'>Không còn suất chiếu.</p>"}
  </div></section>`;
}
function seatMapHtml(sh, selected, mode) {
  const r = room(sh.roomId); let h = '<div class="seatmap-wrap"><div class="screen"></div><p class="small faint" style="text-align:center">Màn hình</p><div class="seatmap">';
  for (let i = 0; i < r.rows; i++) {
    h += `<div class="srow"><span class="lbl">${String.fromCharCode(65 + i)}</span>`;
    for (let j = 0; j < r.cols; j++) {
      const sid = seatId(i, j), st = seatState(sh.id, sid), sel = selected.includes(sid);
      const cls = ["seat", r.vip.includes(i) ? "vip" : "", st?.st === "sold" ? (st.grp ? "grp" : "sold") : "", st?.st === "held" && !sel ? "held" : "", sel ? "sel" : ""].join(" ");
      h += `<button class="${cls}" data-act="${mode}" data-seat="${sid}" aria-label="Ghế ${sid}" ${st && !sel ? "disabled" : ""}>${j + 1}</button>`;
    }
    h += `<span class="lbl">${String.fromCharCode(65 + i)}</span></div>`;
  }
  return h + `</div></div><div class="legend"><span><i style="background:var(--seat)"></i>Thường ${vnd(S.prices.std)}</span><span><i style="background:var(--seat-vip)"></i>VIP ${vnd(S.prices.vip)}</span><span><i style="background:var(--accent)"></i>Đang chọn</span><span><i style="background:var(--seat-sold)"></i>Đã bán</span><span><i style="background:var(--r-k)"></i>Vé đoàn</span></div>`;
}
function khSeats() {
  const d = S.draft; if (!d) return khHome(); const sh = show(d.showId), f = film(sh.filmId);
  return `<div class="row"><button class="btn ghost sm" data-act="cancel-draft">← Huỷ</button><h2>${esc(f.title)}</h2>${ratingBadge(f.rating)}<span class="muted">${room(sh.roomId).name} · ${ddmm(sh.start)} ${hhmm(sh.start)}</span>${d.until ? `<span class="timer right" id="hold-timer">--:--</span>` : ""}</div>
  <div class="panel">${seatMapHtml(sh, d.seats, "toggle-seat")}
  <div class="row"><span>${d.seats.length ? "Ghế: <b class='mono'>" + d.seats.join(", ") + "</b>" : "<span class='muted'>Chọn tối đa " + S.params.maxTickets + " ghế. Ghế được giữ " + S.params.holdMin + " phút.</span>"}</span>
  <button class="btn primary right" data-act="to-checkout" ${d.seats.length ? "" : "disabled"}>Tiếp tục</button></div></div>`;
}
function khCheckout() {
  const d = S.draft; if (!d) return khHome(); const sh = show(d.showId), f = film(sh.filmId);
  if (!d.assign) d.assign = d.seats.map(() => ({ viewer: { kind: S.user.linked ? "self" : "other" } }));
  const chk = checkOrder(sh, d.assign); let total = 0;
  const rows = d.seats.map((sid, i) => {
    const a = d.assign[i], r = chk.res[i], aud = audience(r.verified || r.level === "Cam kết" ? r.age : null), price = seatPrice(sh, sid) * (1 - aud.disc);
    if (!r.block) total += price;
    const opts = [`<option value="other" ${a.viewer.kind === "other" ? "selected" : ""}>Người khác (chưa xác thực)</option>`, `<option value="self" ${a.viewer.kind === "self" ? "selected" : ""}>Tôi – ${esc(S.user.name)}${S.user.linked ? "" : " (chưa xác thực)"}</option>`,
      ...S.dependents.map(x => `<option value="dep:${x.id}" ${a.viewer.kind === "dep" && a.viewer.depId === x.id ? "selected" : ""}>Con – ${esc(x.name)} (${ageAt(x.dob, sh.start)} tuổi, ${x.level})</option>`)];
    return `<tr><td data-label="Ghế" class="mono">${sid}</td><td data-label="Người xem"><select id="viewer-${i}" data-act="assign" data-i="${i}" aria-label="Người xem ghế ${sid}">${opts.join("")}</select></td>
      <td data-label="Độ tuổi">${r.block ? `<span class="chip bad">Chặn</span>` : r.needDoc ? `<span class="chip warn">Kiểm tra giấy tờ</span>` : `<span class="chip ok">Đã xác thực</span>`}<div class="small muted">${esc(r.reason)}</div></td>
      <td data-label="Đối tượng">${aud.label}</td><td data-label="Giá" class="num">${r.block ? "—" : vnd(price)}</td></tr>`;
  }).join("");
  const combo = d.combo || 0; total += combo * 79000; total = Math.max(0, total - Math.min(d.points || 0, S.user.points) * 1000); d.total = total;
  return `<div class="row"><button class="btn ghost sm" data-act="back-seats">← Chọn ghế</button><h2>Người xem & thanh toán</h2><span class="timer right" id="hold-timer">--:--</span></div>
  <div class="panel"><div class="row"><b>${esc(f.title)}</b>${ratingBadge(f.rating)}<span class="muted">${ddmm(sh.start)} ${hhmm(sh.start)} · ${room(sh.roomId).name}</span></div>
  <p class="small muted">Mỗi vé gắn với một người xem. Tuổi tính tại ngày chiếu để áp giá và kiểm tra nhãn ${f.rating}.</p>
  <div class="tbl"><table class="cards"><thead><tr><th>Ghế</th><th>Người xem</th><th>Độ tuổi</th><th>Đối tượng</th><th class="num">Giá</th></tr></thead><tbody>${rows}</tbody></table></div>
  ${chk.orderErr ? `<div class="note bad">${esc(chk.orderErr)}</div>` : ""}${chk.res.some(r => r.block) ? `<div class="note bad">Vé bị chặn sẽ không được bán. Đổi người xem hoặc bỏ ghế.</div>` : ""}
  ${!S.user.linked ? `<div class="note accent row"><span style="flex:1">Liên kết VNeID để được giá theo độ tuổi và không phải xuất trình giấy tờ.</span><button class="btn sm" data-act="vneid-self">Liên kết ngay</button></div>` : ""}
  <div class="row"><label style="width:140px">Combo (79.000 đ)<input id="combo" type="number" min="0" max="8" value="${combo}" data-act="combo"></label>
  <label style="width:170px">Dùng điểm (có ${S.user.points})<input id="points" type="number" min="0" max="${S.user.points}" value="${d.points || 0}" data-act="points"></label>
  <div class="right" style="text-align:right"><div class="muted small">Tổng thanh toán</div><b style="font-family:var(--display);font-size:1.7rem">${vnd(total)}</b></div></div>
  <button class="btn primary" style="justify-self:end" data-act="to-pay" ${chk.ok && d.seats.length ? "" : "disabled"}>Thanh toán</button></div>`;
}
function khPay() {
  const d = S.draft; if (!d) return khHome();
  return `<div class="row"><h2>Thanh toán</h2><span class="sim">Cổng thanh toán mô phỏng</span><span class="timer right" id="hold-timer">--:--</span></div>
  <div class="grid g2"><div class="panel" style="justify-items:center"><h3>Quét mã để thanh toán</h3><div class="qr">${qrSvg("PAY|" + d.id + "|" + d.total, 4)}</div><b style="font-family:var(--display);font-size:1.5rem">${vnd(d.total)}</b><p class="small muted">Mã đơn ${d.id}</p></div>
  <div class="panel"><h3>Kết quả từ cổng thanh toán</h3><button class="btn primary" data-act="pay-ok">Giả lập: thanh toán thành công</button><button class="btn" data-act="pay-fail">Giả lập: khách huỷ</button><p class="small muted">Hệ thống kiểm tra chữ ký, số tiền và hạn giữ ghế trước khi chuyển ghế sang “đã bán”.</p></div></div>`;
}
function ticketCard(t) {
  const sh = show(t.showId), f = film(sh.filmId);
  const st = t.status === "valid" ? (t.needDoc ? `<span class="chip warn">Cần kiểm tra giấy tờ</span>` : `<span class="chip ok">Vào thẳng</span>`) : t.status === "used" ? `<span class="chip info">Đã sử dụng</span>` : `<span class="chip bad">Đã hoàn</span>`;
  return `<div class="panel ticket"><div class="qr">${qrSvg(t.code, 3)}</div><div class="stack" style="gap:4px;min-width:0"><div class="row"><b>${esc(f.title)}</b>${ratingBadge(f.rating)}</div>
  <span class="mono">${ddmm(sh.start)} ${hhmm(sh.start)} · ${room(sh.roomId).name} · Ghế ${t.seat}</span><span class="small muted">${esc(t.viewerName)} · ${esc(t.aud)} · ${vnd(t.price)}</span>
  <div class="row">${st}<span class="mono small faint">${t.code}</span>${t.status === "valid" && t.channel === "Online" ? `<button class="btn sm right" data-act="refund" data-code="${t.code}">Hoàn vé</button>` : ""}</div></div></div>`;
}
function khDone() { const ts = S.tickets.filter(t => t.orderId === S.view.order); return `<div class="note ok"><b>Đặt vé thành công.</b> Cộng ${S.view.pts || 0} điểm thành viên. Đưa mã QR cho nhân viên soát vé (hoặc mở tab Soát vé trên điện thoại để quét).</div><div class="grid g2">${ts.map(ticketCard).join("")}</div><button class="btn" data-go="mytickets" style="justify-self:start">Xem tất cả vé</button>`; }
function khMyTickets() {
  const ts = S.tickets.filter(t => t.owner === "user").sort((a, b) => new Date(show(a.showId).start) - new Date(show(b.showId).start));
  return `<div class="row"><h2>Vé của tôi</h2><span class="muted small right">Hoàn trước giờ chiếu ${S.params.refundMin} phút · còn ${Math.max(0, S.params.refundLimit[tier()] - S.user.refunds)} lượt tháng này</span></div>
  ${S.gifts.length ? `<div class="row"><span class="small muted">Thẻ quà tặng:</span>${S.gifts.map(g => `<span class="chip info mono">${g.code} · ${vnd(g.amount)}</span>`).join("")}</div>` : ""}
  ${ts.length ? `<div class="grid g2">${ts.map(ticketCard).join("")}</div>` : `<div class="panel"><p class="muted">Chưa có vé.</p><button class="btn primary" data-go="home">Chọn phim</button></div>`}`;
}
function khAccount() {
  const u = S.user, hasRef = u.key && FaceKit.getRef(u.key);
  const id = u.linked ? `<div class="note ok stack" style="gap:4px"><span class="chip ok" style="justify-self:start">${ICON_OK}ĐÃ XÁC THỰC VNeID + KHUÔN MẶT</span><b style="font-size:1.1rem">${esc(u.name)}</b><span>Sinh ${dmy(u.dob)} · ${ageAt(u.dob, new Date())} tuổi</span><span class="small muted">Lúc ${new Date(u.verifiedAt).toLocaleString("vi-VN")} · ${esc(u.method || "")}${u.faceScore != null ? " · độ tương đồng " + u.faceScore + "%" : ""}</span></div>
    <p class="small muted">Rạp chỉ lưu ngày sinh, mức và thời điểm xác thực – không lưu ảnh khuôn mặt.</p><div class="row"><button class="btn sm" data-act="vneid-self">Xác thực lại</button><button class="btn sm ghost" data-act="unlink">Huỷ liên kết</button></div>`
    : `<div class="note warn">Chưa xác thực. Vé tính giá người lớn và phim từ T13 phải xuất trình giấy tờ tại cửa.</div><button class="btn primary" data-act="vneid-self">Liên kết VNeID + FaceID</button>`;
  const deps = S.dependents.map(d => `<tr><td data-label="Họ tên">${esc(d.name)}</td><td data-label="Ngày sinh" class="mono">${dmy(d.dob)}</td><td data-label="Tuổi">${ageAt(d.dob, new Date())}</td><td data-label="Xác nhận">${d.level === "VNeID" ? `<span class="chip ok">VNeID</span>` : `<span class="chip warn">Cam kết</span>`}</td><td data-label="Định danh" class="mono small">${esc(d.idMasked)}</td><td data-label=""><button class="btn sm" data-act="del-dep" data-id="${d.id}">Xoá</button></td></tr>`).join("");
  const refs = IDENTITIES.filter(i => FaceKit.getRef(i.key));
  return `<section class="grid g2"><div class="panel"><h2>Định danh</h2>${id}</div>
  <div class="panel"><h2>Thành viên</h2><div class="kpis"><div class="kpi"><span class="small muted">Hạng</span><b>${tier()}</b></div><div class="kpi"><span class="small muted">Điểm</span><b>${u.points}</b></div></div><p class="small muted">Hạng U22 xét tự động theo ngày sinh đã xác thực, hết hạn khi đủ 23 tuổi.</p></div></section>
  <section class="panel"><div class="row"><h2>Người phụ thuộc</h2><button class="btn primary right" data-act="add-dep" ${u.linked ? "" : "disabled"}>Thêm trẻ</button></div>
  <p class="small muted">Trẻ dưới 14 tuổi thường chưa có thẻ căn cước. Cha mẹ đã xác thực VNeID khai báo con; con có tài khoản định danh thì xác nhận qua VNeID, chưa có thì cam kết theo giấy khai sinh.</p>
  ${u.linked ? "" : `<div class="note warn">Cần liên kết VNeID trước.</div>`}${deps ? `<div class="tbl"><table class="cards"><thead><tr><th>Họ tên</th><th>Ngày sinh</th><th>Tuổi</th><th>Xác nhận</th><th>Định danh</th><th></th></tr></thead><tbody>${deps}</tbody></table></div>` : ""}</section>
  <section class="panel"><h3>Ảnh gốc mô phỏng CSDL dân cư (trên thiết bị này)</h3><p class="small muted">Thực tế ảnh gốc nằm trong CSDL quốc gia, rạp không giữ. Bản demo lưu vector đặc trưng 128 số (không phải ảnh) của lần quét đầu tiên trên máy này để so khớp các lần sau.</p>
  ${refs.length ? `<div class="row">${refs.map(i => `<span class="chip info">${esc(i.name)}</span><button class="btn sm ghost" data-act="clear-ref" data-key="${i.key}">Xoá</button>`).join("")}</div>` : `<p class="small faint">Chưa có ảnh gốc nào.</p>`}${hasRef ? "" : ""}</section>`;
}

/* ============================ VNeID + FaceID ============================ */
/**
 * who: 'self' | 'teacher' | 'parent' | 'gate-teacher'
 * onDone(identity, result) – result: {score, method, live}
 */
function verifyFace({ who, title, fixedKey, onDone }) {
  const ids = fixedKey ? IDENTITIES.filter(i => i.key === fixedKey) : who === "teacher" ? IDENTITIES.filter(i => i.key === "gv") : IDENTITIES.filter(i => i.key !== "gv");
  let chosen = ids[0], stopCam = null, pairH = null;
  const sh = openSheet("", { label: title, onClose: () => { stopCam && stopCam(); pairH && pairH.close(); render(); } });
  const head = t => `<header><h2>${esc(t)}</h2><button class="btn ghost sm" data-m="close" aria-label="Đóng">${ICON_NO}</button></header>`;
  const consent = () => sh.set(`${head(title)}
    ${who === "gate-teacher" ? `<p>Đối chiếu khuôn mặt 1:1 người phụ trách đoàn với ảnh gốc trong CSDL dân cư.</p>` : `
    <div class="panel"><span class="small muted">Vì sao cần xác thực?</span><span>Xác thực một lần để mua vé theo độ tuổi ngay trên app và vào thẳng phòng chiếu phim T13–T18.</span></div>
    <div class="panel consent"><b>CINEVIN yêu cầu chia sẻ từ VNeID</b><span style="color:var(--ok)">${ICON_OK}<span style="color:var(--fg)">Họ và tên</span></span><span style="color:var(--ok)">${ICON_OK}<span style="color:var(--fg)">Ngày sinh</span></span>
    <span class="small muted" style="margin-top:4px">Không chia sẻ</span><span class="faint">${ICON_NO}Ảnh khuôn mặt</span><span class="faint">${ICON_NO}Số căn cước, địa chỉ</span></div>`}
    <label for="vn-id">Hồ sơ dân cư mẫu <span class="sim">Mô phỏng VNeID</span><select id="vn-id">${ids.map(i => `<option value="${i.key}">${esc(i.name)} – ${esc(i.note)}</option>`).join("")}</select></label>
    <button class="btn primary block" data-m="methods">${who === "gate-teacher" ? "Tiếp tục" : "Mở VNeID để xác thực"}</button>`);
  const methods = async () => {
    chosen = IDENTITIES.find(i => i.key === ($("#vn-id", sh.el)?.value || chosen.key)) || chosen;
    const ref = FaceKit.getRef(chosen.key); const cam = await FaceKit.hasCamera();
    sh.set(`${head("Xác thực khuôn mặt")}
    <p><b>${esc(chosen.name)}</b> · sinh ${dmy(chosen.dob)}</p>
    ${ref ? "" : `<div class="note warn small">Hồ sơ này chưa có ảnh gốc trên thiết bị. Lần quét này sẽ được lưu làm ảnh gốc (thay cho ảnh trong CSDL dân cư); các lần sau sẽ so khớp với nó.</div>`}
    <button class="choice" data-m="cam" ${cam ? "" : 'aria-disabled="true"'}><b>Dùng camera của máy này</b><span>${cam ? "Kiểm tra người thật + so khớp 1:1, chạy ngay trên trình duyệt." : "Không tìm thấy camera hoặc trang chưa chạy HTTPS."}</span></button>
    <button class="choice" data-m="phone"><b>Dùng điện thoại</b><span>Quét mã QR bằng điện thoại, xác thực khuôn mặt trên điện thoại, kết quả gửi về đây ngay lập tức.</span></button>
    <label class="choice" style="color:var(--fg)"><b>Chụp hoặc chọn ảnh</b><span>Dự phòng khi không có camera trực tiếp – không kiểm tra được người thật.</span><input type="file" accept="image/*" capture="user" id="fk-file" hidden></label>`);
  };
  const done = r => {
    stopCam = null;
    if (!r.ok) return sh.set(`${head("Xác thực không thành công")}<div class="note bad">${esc(r.message || "Không xác thực được.")}</div>
      ${r.dist ? `<p class="small muted">Khoảng cách đặc trưng ${String(r.dist).replace(".", ",")} > ngưỡng ${String(FaceKit.THRESHOLD).replace(".", ",")}.</p>` : ""}<button class="btn primary block" data-m="methods">Thử lại</button>`);
    const how = r.enrolled ? "đã lưu ảnh gốc cho hồ sơ demo" : `độ tương đồng ${r.score}% (khoảng cách ${String(r.dist).replace(".", ",")} ≤ ngưỡng ${String(FaceKit.THRESHOLD).replace(".", ",")})`;
    const method = (r.via === "phone" ? "điện thoại" : r.method === "ảnh" ? "ảnh chụp" : "camera") + (r.live ? " + kiểm tra người thật" : "");
    sh.set(`${head("Xác thực thành công")}<div class="note ok stack" style="gap:4px"><span class="chip ok" style="justify-self:start">${ICON_OK}ĐÃ XÁC THỰC</span><b style="font-size:1.1rem">${esc(chosen.name)}</b><span>Sinh ${dmy(chosen.dob)} · ${ageAt(chosen.dob, new Date())} tuổi</span><span class="small muted">Khuôn mặt: ${esc(how)} · qua ${esc(method)}</span></div>
      <p class="small muted">Rạp nhận: họ tên, ngày sinh, mức xác thực, thời điểm. Không nhận ảnh.</p><button class="btn primary block" data-m="close">Xong</button>`);
    onDone(chosen, { score: r.enrolled ? null : r.score, method, live: r.live });
    save();
  };
  const runCam = () => { sh.set(`${head("Nhìn vào camera")}<div id="fk-host" class="stack"></div><button class="btn ghost" data-m="methods">Đổi cách xác thực</button>`); stopCam = FaceKit.runCamera($("#fk-host", sh.el), { refKey: chosen.key, ref: FaceKit.getRef(chosen.key), onResult: done }); };
  const runPhone = () => {
    sh.set(`${head("Dùng điện thoại")}<div class="stack" style="justify-items:center;text-align:center" id="pair-box"><p class="muted">Đang tạo mã ghép nối…</p></div><button class="btn ghost" data-m="methods">Đổi cách xác thực</button>`);
    const ref = FaceKit.getRef(chosen.key);
    pairH = Pair.host({ who, profile: { key: chosen.key, name: chosen.name, dob: chosen.dob }, ref: ref ? Array.from(ref) : null }, {
      onStatus(st, info) {
        const box = $("#pair-box", sh.el); if (!box) return;
        if (st === "ready") box.innerHTML = `<div class="qr">${qrSvg(pairH.url, 4)}</div><p>Quét mã bằng camera điện thoại, hoặc mở <b class="mono">${esc(baseUrl().replace(/^https?:\/\//, ""))}?pair</b> và nhập mã:</p><div class="pair-code">${info}</div><p class="small muted"><span class="live-dot"></span> Đang chờ điện thoại kết nối…</p>`;
        if (st === "connected") box.innerHTML = `<div class="note ok">Điện thoại đã kết nối. Làm theo hướng dẫn trên điện thoại.</div><p class="small muted" id="pair-prog"><span class="live-dot"></span> Đang chờ kết quả…</p>`;
        if (st === "progress") { const p = $("#pair-prog", sh.el); if (p) p.innerHTML = `<span class="live-dot"></span> ${esc(info)}`; }
        if (st === "lost") box.innerHTML = `<div class="note warn">Điện thoại đã ngắt kết nối.</div>`;
        if (st === "error") box.innerHTML = `<div class="note bad">Không ghép nối được: ${esc(info)}. Kiểm tra mạng rồi thử lại.</div>`;
      },
      onResult(r) { pairH = null; if (r.ok && r.enrolled && r.descriptor) FaceKit.setRef(chosen.key, new Float32Array(r.descriptor)); done({ ...r, via: "phone" }); },
    });
  };
  sh.el.onclick = e => {
    const a = e.target.closest("[data-m]"); if (!a || a.getAttribute("aria-disabled") === "true") return;
    const m = a.dataset.m;
    if (m === "close") { stopCam && stopCam(); pairH && pairH.close(); $("#modal-root").innerHTML = ""; render(); }
    if (m === "methods") { stopCam && stopCam(); stopCam = null; pairH && pairH.close(); pairH = null; methods(); }
    if (m === "cam") runCam();
    if (m === "phone") runPhone();
  };
  sh.el.onchange = e => { if (e.target.id === "fk-file" && e.target.files[0]) { sh.set(`${head("Phân tích ảnh")}<div id="fk-host" class="stack"></div>`); FaceKit.runImage($("#fk-host", sh.el), e.target.files[0], { refKey: chosen.key, ref: FaceKit.getRef(chosen.key), onResult: done }); } };
  if (fixedKey && who === "gate-teacher") { consent(); } else consent();
}

/* Trang trên điện thoại khi mở link ?pair=MÃ */
function phonePage(code) {
  document.body.classList.add("phone");
  $("#roles").innerHTML = "";
  const app = $("#app");
  const ask = msg => { app.innerHTML = `<div class="panel stack" style="max-width:460px;margin:0 auto"><h1>Xác thực trên điện thoại</h1>${msg ? `<div class="note bad">${esc(msg)}</div>` : ""}<label for="pc">Mã ghép nối hiển thị trên máy tính<input id="pc" class="mono" maxlength="6" autocomplete="off" style="text-transform:uppercase;font-size:1.4rem;letter-spacing:.2em"></label><button class="btn primary block" id="pc-go">Kết nối</button></div>`; $("#pc-go").onclick = () => { const c = $("#pc").value.trim().toUpperCase(); if (c.length === 6) { history.replaceState(null, "", "?pair=" + c); phonePage(c); } }; };
  if (!code) return ask("");
  app.innerHTML = `<div class="panel stack" style="max-width:460px;margin:0 auto" id="ph"><h1>Xác thực trên điện thoại</h1><p class="muted"><span class="live-dot"></span> Đang kết nối tới máy tính (mã <b class="mono">${esc(code)}</b>)…</p></div>`;
  Pair.join(code, {
    onStatus(st, info) {
      const ph = $("#ph"); if (!ph) return;
      if (st === "error") ask(info);
      if (st === "closed") ph.insertAdjacentHTML("beforeend", `<p class="small muted">Đã ngắt kết nối.</p>`);
    },
    onJob(job, ch) {
      const p = job.profile;
      $("#ph").innerHTML = `<h1>Xác thực khuôn mặt</h1><div class="note"><b>${esc(p.name)}</b> · sinh ${dmy(p.dob)}<br><span class="small muted">${job.who === "gate-teacher" ? "Đối chiếu 1:1 người phụ trách đoàn tại cửa" : "Liên kết VNeID cho tài khoản trên máy tính"}</span></div>
        ${job.ref ? "" : `<div class="note warn small">Chưa có ảnh gốc cho hồ sơ này – lần quét này sẽ được lưu làm ảnh gốc.</div>`}
        <button class="btn primary block" id="ph-go">Bắt đầu quét khuôn mặt</button><p class="small muted">Ảnh chỉ xử lý trên điện thoại, không gửi đi. Máy tính chỉ nhận kết quả.</p>`;
      ch.progress("Điện thoại đã sẵn sàng, chờ người dùng bắt đầu quét");
      $("#ph-go").onclick = () => {
        $("#ph").innerHTML = `<div id="fk-host" class="stack"></div>`;
        ch.progress("Đang quét khuôn mặt trên điện thoại…");
        const ref = job.ref ? new Float32Array(job.ref) : FaceKit.getRef(p.key);
        FaceKit.runCamera($("#fk-host"), { refKey: job.ref ? null : p.key, ref, onResult: r => {
          ch.result({ ok: r.ok, enrolled: r.enrolled, live: r.live, dist: r.dist, score: r.score, method: "camera", message: r.message, descriptor: r.enrolled ? r.descriptor : null });
          $("#ph").insertAdjacentHTML("beforeend", r.ok ? `<div class="note ok"><b>Xong.</b> Kết quả đã gửi về máy tính. Bạn có thể đóng trang này.</div>` : `<div class="note bad">${esc(r.message || "Không xác thực được")}. Kết quả đã gửi về máy tính – bấm “Thử lại” trên máy tính.</div>`);
        } });
      };
    },
  });
}

/* ============================ người phụ thuộc ============================ */
function openAddDep() {
  const sh = openSheet(`<header><h2>Thêm trẻ dưới 14 tuổi</h2><button class="btn ghost sm" data-m="close" aria-label="Đóng">${ICON_NO}</button></header>
  <label>Họ tên<input id="dep-name" value="Nguyễn Minh Khôi"></label><div class="row" style="flex-wrap:nowrap"><label style="flex:1">Ngày sinh<input id="dep-dob" type="date" value="${new Date().getFullYear() - 9}-06-01"></label><label style="flex:1.3">Số định danh (khai sinh)<input id="dep-idno" class="mono" value="040217012345" inputmode="numeric"></label></div>
  <label>Cách xác nhận<select id="dep-way"><option value="VNeID">Con đã có tài khoản định danh – xác nhận qua VNeID của cha/mẹ</option><option value="Cam kết">Chưa có – cam kết theo giấy khai sinh</option></select></label>
  <p id="dep-err" class="small" style="color:var(--bad)"></p><button class="btn primary block" data-m="ok">Thêm và xác nhận</button>`, { label: "Thêm người phụ thuộc" });
  sh.el.onclick = e => {
    const m = e.target.closest("[data-m]")?.dataset.m; if (!m) return; if (m === "close") return sh.close();
    const name = $("#dep-name").value.trim(), dob = $("#dep-dob").value, idno = $("#dep-idno").value.replace(/\D/g, ""), way = $("#dep-way").value, err = $("#dep-err");
    if (!name || !dob) return err.textContent = "Nhập họ tên và ngày sinh.";
    if (ageAt(dob, new Date()) >= 14) return err.textContent = "Trẻ từ 14 tuổi tự liên kết VNeID bằng tài khoản riêng.";
    if (idno.length !== 12) return err.textContent = "Số định danh cá nhân gồm 12 chữ số.";
    if (S.dependents.some(d => d.idHash === idno.slice(-6))) return err.textContent = "Số định danh đã gắn với một tài khoản.";
    const add = () => { S.dependents.push({ id: rid("d", 4), name, dob, level: way, idMasked: "••••" + idno.slice(-4), idHash: idno.slice(-6) }); log("dep", `Thêm người phụ thuộc ${name} (${way})`); save(); sh.close(); toast("Đã thêm " + name); };
    if (way === "VNeID") sh.set(`<header><h2>Xác nhận qua VNeID</h2></header><div class="panel consent"><span>Phụ huynh <b>${esc(S.user.name)}</b> đồng ý chia sẻ họ tên, ngày sinh của con <b>${esc(name)}</b> cho CINEVIN.</span><span class="sim" style="justify-self:start">Mô phỏng VNeID</span></div><button class="btn primary block" data-m2="ok">Đồng ý</button>`), sh.el.onclick = e2 => { if (e2.target.closest("[data-m2]")) add(); };
    else add();
  };
}

/* ============================ GIÁO VIÊN – VÉ ĐOÀN ============================ */
const FIRST = ["An", "Bảo", "Chi", "Dũng", "Giang", "Hà", "Hiếu", "Hoa", "Huy", "Khánh", "Lan", "Linh", "Long", "Mai", "Minh", "Nam", "Ngọc", "Nhung", "Phúc", "Quân", "Sơn", "Tâm", "Thảo", "Trang", "Tuấn", "Vy"];
const LAST = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Phan", "Vũ", "Đặng", "Bùi", "Đỗ", "Hồ", "Ngô"], MID = ["Văn", "Thị", "Minh", "Đức", "Thu", "Gia", "Ngọc", "Quốc", "Hải", "Bảo"];
function sampleClass(kind, n = 50) {
  const yr = new Date().getFullYear(); const list = [];
  for (let i = 0; i < n; i++) { let y = kind === "4A" ? yr - 10 : yr - 14, m = 1 + (i * 7 % 12), d = 1 + (i * 11 % 27); if (kind === "8A" && i === 17) { y = yr - 12; m = 12; d = 20; }
    list.push({ id: "hs" + i, name: `${LAST[i % LAST.length]} ${MID[(i * 3) % MID.length]} ${FIRST[(i * 5) % FIRST.length]}`, dob: `${y}-${pad(m)}-${pad(d)}`, cls: kind, parentOk: false, entered: false }); }
  return list;
}
function groupRule(rating, students, when) {
  const min = RATINGS[rating];
  return students.map(s => { const age = ageAt(s.dob, when);
    if (rating === "K" && age < 13) return { ...s, age, ok: false, why: "Phim K: dưới 13 tuổi cần cha mẹ/người giám hộ – giáo viên không phải người giám hộ" };
    if (min && age < min) return { ...s, age, ok: false, why: `Chưa đủ ${min} tuổi tại ngày chiếu` };
    return { ...s, age, ok: true, why: "" }; });
}
function viewGV() {
  const t = S.teacher, g = S.view.gdraft;
  const head = `<div class="row"><h1>Đặt vé đoàn</h1><span class="muted">${esc(t.org)}</span><span class="right">${t.linked ? `<span class="chip ok">${ICON_OK}${esc(t.name)} · đã xác thực</span>` : `<span class="chip warn">Người phụ trách chưa xác thực</span>`}</span></div>
  <div class="note accent"><b>Không quét mặt 50 em.</b> Xác thực chặt một người lớn chịu trách nhiệm (VNeID + FaceID), kiểm tra tuổi theo danh sách với nhãn phim, phát một mã QR cho cả đoàn. Phim P chỉ đếm người; phim từ T13 quét thẻ QR từng em và kiểm tra ngẫu nhiên.</div>`;
  if (!t.linked) return head + `<div class="panel"><p>Bước 1: người phụ trách xác thực VNeID và khuôn mặt – người duy nhất trong đoàn cần sinh trắc học.</p><button class="btn primary" data-act="vneid-teacher">Xác thực người phụ trách</button></div>` + groupList();
  if (!g) return head + `<div class="panel"><button class="btn primary" data-act="new-group">Tạo đơn vé đoàn mới</button></div>` + groupList();
  const steps = ["Phim & suất", "Danh sách", "Kiểm tra tuổi", "Phụ huynh", "Cam kết & thanh toán"];
  const sh = g.showId && show(g.showId), f = sh && film(sh.filmId); let body = "";
  if (g.step === 0) body = `<div class="grid g2">${S.films.map(ff => `<div class="panel"><div class="row"><b>${esc(ff.title)}</b>${ratingBadge(ff.rating)}</div><div class="shows">${S.shows.filter(s => s.filmId === ff.id && new Date(s.start) > new Date()).map(s => `<button class="show" data-act="g-show" data-show="${s.id}"><b>${ddmm(s.start)} ${hhmm(s.start)}</b><span class="small muted">${room(s.roomId).name} · ${freeSeats(s)} trống</span></button>`).join("")}</div></div>`).join("")}</div>`;
  else if (g.step === 1) body = `<div class="panel"><div class="row"><b>${esc(f.title)}</b>${ratingBadge(f.rating)}<span class="muted">${ddmm(sh.start)} ${hhmm(sh.start)}</span></div>
    <p>Tải danh sách học sinh (xuất từ phần mềm quản lý của trường). Mỗi dòng: <span class="mono">Họ tên, dd/mm/yyyy, Lớp</span>.</p>
    <div class="row"><button class="btn" data-act="g-sample" data-k="4A">Mẫu lớp 4A (50 em, 9–10 tuổi)</button><button class="btn" data-act="g-sample" data-k="8A">Mẫu lớp 8A (có 1 em 12 tuổi)</button></div>
    <label for="g-csv">Hoặc dán danh sách<textarea id="g-csv" placeholder="Nguyễn Văn A, 12/05/2015, 4A"></textarea></label>
    <div class="row"><button class="btn" data-act="g-parse">Đọc danh sách</button><span class="muted">${g.students.length ? g.students.length + " học sinh" : ""}</span><button class="btn primary right" data-act="g-next" ${g.students.length >= S.params.groupMin ? "" : "disabled"}>Kiểm tra tuổi</button></div></div>`;
  else if (g.step === 2) { const chk = groupRule(f.rating, g.students, sh.start), bad = chk.filter(x => !x.ok);
    body = `<div class="panel"><div class="row"><b>${esc(f.title)}</b>${ratingBadge(f.rating)}<span class="muted">${esc(RATING_TXT[f.rating])}</span></div>
    ${bad.length ? `<div class="note bad">${bad.length} em không đủ điều kiện xem phim ${f.rating}.</div>` : `<div class="note ok">Cả ${chk.length} em đủ điều kiện. ${f.rating === "P" ? "Phim P: tại cửa chỉ cần đếm người." : "Tại cửa quét thẻ QR từng em."}</div>`}
    <div class="tbl" style="max-height:380px;overflow:auto"><table class="cards"><thead><tr><th>#</th><th>Họ tên</th><th>Ngày sinh</th><th class="num">Tuổi</th><th>Kết quả</th></tr></thead><tbody>${chk.map((s, i) => `<tr><td data-label="#">${i + 1}</td><td data-label="Họ tên">${esc(s.name)}</td><td data-label="Ngày sinh" class="mono">${dmy(s.dob)}</td><td data-label="Tuổi" class="num">${s.age}</td><td data-label="Kết quả">${s.ok ? `<span class="chip ok">Đạt</span>` : `<span class="chip bad">Không đạt</span> <span class="small">${esc(s.why)}</span>`}</td></tr>`).join("")}</tbody></table></div>
    <div class="row"><button class="btn" data-act="g-back">←</button>${bad.length ? `<button class="btn" data-act="g-drop">Bỏ ${bad.length} em</button><button class="btn" data-act="g-change">Chọn phim khác</button>` : ""}<button class="btn primary right" data-act="g-next" ${bad.length ? "disabled" : ""}>Tiếp tục</button></div></div>`; }
  else if (g.step === 3) { const need = S.params.parentRequired.includes(f.rating), done = g.students.filter(s => s.parentOk).length;
    body = `<div class="panel"><h3>Phụ huynh xác nhận qua VNeID</h3><p class="small muted">${need ? `Phim ${f.rating}: phụ huynh xác nhận ngày sinh và đồng ý cho con tham gia (đồng thời là sự đồng ý xử lý dữ liệu của trẻ).` : `Phim ${f.rating}: không bắt buộc – nhà trường cam kết danh sách là đủ.`}</p>
    <div class="row"><span class="mono">${done}/${g.students.length}</span><div class="bar" style="flex:1;min-width:120px"><i style="width:${done / g.students.length * 100}%"></i></div></div>
    <div class="row"><button class="btn" data-act="g-sms">Gửi SMS cho ${g.students.length} phụ huynh</button><button class="btn" data-act="g-parent-one">Thử vai 1 phụ huynh</button><button class="btn" data-act="g-parent-many">Giả lập 90% xác nhận</button></div>
    <div class="row"><button class="btn" data-act="g-back">←</button>${need && done < g.students.length ? `<button class="btn" data-act="g-drop-unconfirmed">Bỏ các em chưa xác nhận</button>` : ""}<button class="btn primary right" data-act="g-next" ${need && done < g.students.length ? "disabled" : ""}>Tiếp tục</button></div></div>`; }
  else if (g.step === 4) { const n = g.students.length + 1, unit = S.prices.std * (1 - S.params.groupDiscount);
    body = `<div class="panel"><div class="kpis"><div class="kpi"><span class="small muted">Số vé</span><b>${n}</b><span class="small muted">${g.students.length} HS + 1 phụ trách</span></div><div class="kpi"><span class="small muted">Giá vé đoàn</span><b>${vnd(unit)}</b></div><div class="kpi"><span class="small muted">Tổng</span><b>${vnd(unit * n)}</b></div></div>
    <label class="row" style="flex-wrap:nowrap;color:var(--fg);align-items:flex-start"><input type="checkbox" id="g-commit" ${g.commit ? "checked" : ""} data-act="g-commit"><span>Tôi, ${esc(t.name)}, đại diện ${esc(t.org)}, cam kết danh sách và ngày sinh học sinh là chính xác và chịu trách nhiệm quản lý đoàn tại rạp.</span></label>
    <div class="row"><button class="btn" data-act="g-back">←</button><button class="btn primary right" data-act="g-pay" ${g.commit ? "" : "disabled"}>Xác nhận & thanh toán chuyển khoản</button></div></div>`; }
  return head + `<section class="panel"><div class="row"><h2>Đơn ${g.id}</h2><button class="btn ghost sm right" data-act="g-cancel">Huỷ đơn</button></div><div class="steps">${steps.map((s, i) => `<span class="step ${i === g.step ? "on" : i < g.step ? "done" : ""}">${i + 1}. ${s}</span>`).join("")}</div></section>` + body + groupList();
}
function groupList() {
  if (!S.groups.length) return "";
  return `<section class="stack"><h2>Đơn đã phát hành</h2>${S.groups.map(g => { const sh = show(g.showId), f = film(sh.filmId), cards = RATINGS[f.rating] >= 13;
    return `<div class="panel"><div class="ticket"><div class="qr">${qrSvg(g.code, 3)}</div><div class="stack" style="gap:4px"><div class="row"><b>${esc(f.title)}</b>${ratingBadge(f.rating)}<span class="mono small faint">${g.code}</span></div><span class="mono">${ddmm(sh.start)} ${hhmm(sh.start)} · ${room(sh.roomId).name} · ${seatRows(g.seats)}</span><span>${g.students.length} học sinh + 1 phụ trách · ${g.status === "used" ? `<span class="chip info">Đã vào ${g.enteredCount}/${g.students.length}</span>` : `<span class="chip ok">Chưa sử dụng</span>`}</span><span class="small muted">${cards ? "Phim " + f.rating + ": in thẻ QR cá nhân, phát cho từng em." : "Phim P: không cần thẻ cá nhân."}</span></div></div>
    ${cards ? `<details><summary class="small">Thẻ QR cá nhân (${g.students.length})</summary><div class="cards-grid" style="margin-top:8px">${g.students.map(s => `<div class="scard"><div class="qr">${qrSvg(s.card, 2)}</div><b>${esc(s.name)}</b><span>Lớp ${esc(s.cls)}</span><span class="mono">${s.card}</span></div>`).join("")}</div></details>` : ""}</div>`; }).join("")}</section>`;
}

/* ============================ QUẦY VÉ ============================ */
function viewPOS() {
  const p = S.view.pos || (S.view.pos = { showId: null, seats: [], types: {}, docs: {} });
  const up = S.shows.filter(s => new Date(s.start) > new Date()).sort((a, b) => new Date(a.start) - new Date(b.start));
  let h = `<div class="row"><h1>Quầy vé</h1><span class="muted">Dùng chung sơ đồ ghế với kênh trực tuyến</span></div>
  <div class="panel"><label for="pos-show">Suất chiếu<select id="pos-show" data-act="pos-show"><option value="">— Chọn suất —</option>${up.map(s => `<option value="${s.id}" ${p.showId === s.id ? "selected" : ""}>${ddmm(s.start)} ${hhmm(s.start)} · ${esc(film(s.filmId).title)} (${film(s.filmId).rating}) · ${room(s.roomId).name}</option>`).join("")}</select></label></div>`;
  if (!p.showId) return h;
  const sh = show(p.showId), f = film(sh.filmId); h += `<div class="panel">${seatMapHtml(sh, p.seats, "pos-seat")}</div>`;
  if (p.seats.length) { let total = 0; const need = [];
    const rows = p.seats.map(sid => { const ty = p.types[sid] || "adult", disc = { adult: 0, child: S.prices.child, u22: S.prices.u22, senior: S.prices.senior }[ty], nd = ty !== "adult" || RATINGS[f.rating] > 0; if (nd) need.push(sid);
      const doc = p.docs[sid], price = seatPrice(sh, sid) * (1 - (doc?.ok === false ? 0 : disc)); total += price;
      return `<tr><td data-label="Ghế" class="mono">${sid}</td><td data-label="Đối tượng"><select id="pos-ty-${sid}" data-act="pos-type" data-seat="${sid}" aria-label="Đối tượng ghế ${sid}">${[["adult", "Người lớn"], ["child", "Trẻ em"], ["u22", "U22 / HSSV"], ["senior", "Người cao tuổi"]].map(([k, l]) => `<option value="${k}" ${ty === k ? "selected" : ""}>${l}</option>`).join("")}</select></td>
      <td data-label="Giấy tờ">${nd ? `<div class="row"><select id="pos-doc-${sid}" style="flex:1;min-width:150px" aria-label="Giấy tờ ghế ${sid}"><option value="">Chọn giấy tờ…</option>${["Căn cước", "Căn cước điện tử VNeID", "Giấy khai sinh", "Thẻ học sinh", "Hộ chiếu"].map(x => `<option ${doc?.type === x ? "selected" : ""}>${x}</option>`).join("")}</select><button class="btn sm" data-act="pos-docok" data-seat="${sid}" data-ok="1">Đạt</button><button class="btn sm" data-act="pos-docok" data-seat="${sid}" data-ok="0">Không</button>${doc ? (doc.ok ? `<span class="chip ok">Đạt</span>` : `<span class="chip bad">Không đạt</span>`) : ""}</div>` : `<span class="muted small">Không cần</span>`}</td><td data-label="Giá" class="num">${vnd(price)}</td></tr>`; }).join("");
    const pending = need.filter(sid => !p.docs[sid]);
    h += `<div class="panel"><div class="tbl"><table class="cards"><thead><tr><th>Ghế</th><th>Đối tượng</th><th>Kiểm tra giấy tờ (không lưu ảnh)</th><th class="num">Giá</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="row"><b style="font-family:var(--display);font-size:1.5rem">${vnd(total)}</b><span class="muted small">${pending.length ? pending.length + " vé chưa ghi nhận giấy tờ" : ""}</span><button class="btn right" data-act="pos-pay" data-m="Tiền mặt" ${pending.length ? "disabled" : ""}>Tiền mặt</button><button class="btn primary" data-act="pos-pay" data-m="Thẻ/ví" ${pending.length ? "disabled" : ""}>Thẻ / ví</button></div></div>`; }
  return h;
}

/* ============================ SOÁT VÉ ============================ */
function viewGate() {
  const g = S.view.gate || (S.view.gate = {}); const valid = S.tickets.filter(t => t.status === "valid"), groups = S.groups.filter(x => x.status !== "used");
  return `<div class="row"><h1>Soát vé</h1><span class="muted">Mở tab này trên điện thoại để quét QR bằng camera</span></div>
  <div class="panel"><div class="row" style="align-items:flex-end"><label style="flex:1;min-width:200px">Mã vé / mã đoàn<input id="gate-code" class="mono" placeholder="VXXXXXX hoặc G-XXXXX" value="${esc(g.code || "")}"></label><button class="btn primary" data-act="gate-scan">Kiểm tra</button><button class="btn" data-act="gate-camera">Quét bằng camera</button></div>
  <p class="small muted">Vé đang có trên thiết bị này – bấm để kiểm tra nhanh:</p>
  <div class="row">${valid.slice(0, 12).map(t => `<button class="btn sm mono" data-act="gate-pick" data-code="${t.code}">${t.code}</button>`).join("")}${groups.map(x => `<button class="btn sm mono" data-act="gate-pick" data-code="${x.code}">${x.code} (đoàn)</button>`).join("")}${!valid.length && !groups.length ? `<span class="muted small">Chưa có vé. Mua vé ở tab Khách hàng hoặc tạo vé đoàn ở tab Giáo viên.</span>` : ""}</div></div>
  ${g.result ? gateResult(g) : ""}`;
}
function gateResult(g) {
  const r = g.result;
  if (r.kind === "none") return `<div class="note bad"><b>Không tìm thấy vé ${esc(r.code)}.</b> ${ON() ? "Vé giả hoặc sai mã – đã đối chiếu với máy chủ." : "Vé giả, sai mã, hoặc vé bán ở máy khác (đang ngoại tuyến nên chưa đối chiếu được với máy chủ)."}</div>`;
  if (r.kind === "ticket") { const t = S.tickets.find(x => x.code === r.code), sh = show(t.showId), f = film(sh.filmId);
    if (t.status !== "valid") return `<div class="note bad"><b>Vé ${t.status === "used" ? "đã sử dụng" : "đã hoàn"}.</b> Không cho vào.</div>`;
    const head = `<div class="row"><b>${esc(f.title)}</b>${ratingBadge(f.rating)}<span class="mono">${hhmm(sh.start)} · ${room(sh.roomId).name} · ${t.seat}</span></div><p>${esc(t.viewerName)} · ${esc(t.aud)}</p>`;
    if (!t.needDoc) return `<div class="panel" style="border-color:var(--ok)">${head}<div class="note ok"><b>Hợp lệ – mời vào.</b> ${t.verified ? "Tuổi đã xác thực qua VNeID khi mua." : "Phim không giới hạn tuổi."}</div><button class="btn primary" data-act="gate-admit" data-code="${t.code}">Cho vào</button></div>`;
    return `<div class="panel" style="border-color:var(--warn)">${head}<div class="note warn"><b>Cần kiểm tra giấy tờ.</b> ${esc(t.reason || "Người xem chưa xác thực tuổi.")}</div>
    <label for="gate-doc">Giấy tờ khách xuất trình<select id="gate-doc">${["Căn cước", "Căn cước điện tử VNeID", "Giấy khai sinh", "Thẻ học sinh", "Hộ chiếu", "Giấy phép lái xe"].map(x => `<option>${x}</option>`).join("")}</select></label>
    <div class="row"><button class="btn primary" data-act="gate-doc" data-code="${t.code}" data-ok="1">Đủ tuổi – cho vào</button><button class="btn" data-act="gate-doc" data-code="${t.code}" data-ok="0">Không đủ tuổi – từ chối</button></div></div>`; }
  const grp = S.groups.find(x => x.code === r.code), sh = show(grp.showId), f = film(sh.filmId), cards = RATINGS[f.rating] >= 13;
  if (grp.status === "used") return `<div class="note bad">Vé đoàn đã sử dụng.</div>`;
  const ent = grp.students.filter(s => s.entered).length;
  let h = `<div class="panel" style="border-color:var(--r-k)"><div class="row"><b>Vé đoàn ${grp.code}</b>${ratingBadge(f.rating)}<span>${esc(f.title)}</span><span class="mono">${hhmm(sh.start)} · ${room(sh.roomId).name} · ${seatRows(grp.seats)}</span></div>
  <div class="row"><span>Phụ trách: <b>${esc(grp.teacher)}</b></span><span class="chip ok">VNeID</span>${grp.faceOk ? `<span class="chip ok">Khuôn mặt khớp ${grp.faceScore ?? ""}%</span>` : `<button class="btn sm" data-act="gate-face" data-code="${grp.code}">Đối chiếu khuôn mặt 1:1</button>`}</div>`;
  if (!cards) h += `<div class="note ok"><b>Phim P – chỉ cần đếm người.</b> Chặn khi vượt ${grp.students.length} em.</div>
    <div class="row"><button class="btn" data-act="gate-count" data-d="-1" aria-label="Bớt 1">−</button><b style="font-family:var(--display);font-size:1.8rem">${grp.counted || 0}</b><span class="muted">/ ${grp.students.length}</span><button class="btn" data-act="gate-count" data-d="1" aria-label="Thêm 1">+</button><button class="btn" data-act="gate-count" data-d="10">+10</button><button class="btn primary right" data-act="gate-finish">Hoàn tất (${grp.students.length - (grp.counted || 0)} vắng)</button></div>`;
  else { const spot = grp.spot || [];
    h += `<div class="note warn"><b>Phim ${f.rating} – quét thẻ QR từng em.</b> Thẻ đã quét bị chặn; thẻ không thuộc đoàn bị từ chối; sau đó kiểm tra ngẫu nhiên ${S.params.spot} em.</div>
    <div class="row"><span class="mono">${ent}/${grp.students.length}</span><div class="bar" style="flex:1;min-width:120px"><i style="width:${ent / grp.students.length * 100}%"></i></div></div>
    <div class="row"><button class="btn primary" data-act="gate-card-camera">Quét thẻ bằng camera</button><button class="btn" data-act="gate-next-card">Giả lập thẻ tiếp theo</button><button class="btn sm" data-act="gate-dup">Giả lập quét lại</button><button class="btn sm" data-act="gate-foreign">Giả lập thẻ lạ</button></div>
    ${g.cardMsg ? `<div class="note ${g.cardMsg.ok ? "ok" : "bad"}">${esc(g.cardMsg.text)}</div>` : ""}
    <details><summary class="small">Danh sách ${grp.students.length} em</summary><div class="cards-grid" style="margin-top:8px">${grp.students.map(s => `<div class="scard ${s.entered ? "in" : ""}"><button data-act="gate-card" data-card="${s.card}"><b>${esc(s.name)}</b><span class="mono">${s.card}</span><span>${s.entered ? "Đã vào" : "Bấm để quét"}</span></button></div>`).join("")}</div></details>
    ${spot.length ? `<div class="stack"><h3>Kiểm tra ngẫu nhiên</h3><div class="tbl"><table class="cards"><thead><tr><th>Họ tên</th><th>Ngày sinh</th><th>Lớp</th><th>Đối chiếu</th></tr></thead><tbody>${spot.map(id => { const s = grp.students.find(x => x.id === id); return `<tr><td data-label="Họ tên">${esc(s.name)}</td><td data-label="Ngày sinh" class="mono">${dmy(s.dob)}</td><td data-label="Lớp">${esc(s.cls)}</td><td data-label="Đối chiếu">${s.spot === true ? `<span class="chip ok">Khớp</span>` : s.spot === false ? `<span class="chip bad">Không khớp</span>` : `<button class="btn sm" data-act="gate-spot" data-id="${s.id}" data-ok="1">Khớp</button> <button class="btn sm" data-act="gate-spot" data-id="${s.id}" data-ok="0">Không</button>`}</td></tr>`; }).join("")}</tbody></table></div></div>` : `<button class="btn" data-act="gate-spotpick" style="justify-self:start" ${ent ? "" : "disabled"}>Chọn ngẫu nhiên ${S.params.spot} em để đối chiếu</button>`}
    <button class="btn primary" style="justify-self:end" data-act="gate-finish" ${spot.length && spot.every(id => grp.students.find(x => x.id === id).spot != null) ? "" : "disabled"}>Hoàn tất (${grp.students.length - ent} vắng)</button>`; }
  return h + "</div>";
}
function openScanner(title, onCode) {
  const sh = openSheet(`<header><h2>${esc(title)}</h2><button class="btn ghost sm" data-m="close" aria-label="Đóng">${ICON_NO}</button></header><div class="scan-stage" id="scan-stage"></div><p class="small muted" id="scan-msg">Đưa mã QR vào khung.</p>`, { label: title, onClose: () => stop && stop() });
  let stop = Scan.start($("#scan-stage", sh.el), code => { sh.close(); onCode(code); }, err => { const m = $("#scan-msg", sh.el); if (m) { m.textContent = err; m.style.color = "var(--bad)"; } });
  sh.el.onclick = e => { if (e.target.closest('[data-m="close"]')) sh.close(); };
}
async function doScan(code) {
  const g = S.view.gate || (S.view.gate = {}); code = (code || "").trim().toUpperCase(); g.code = code; g.cardMsg = null;
  // vé vừa bán ở máy khác mà realtime chưa tới → hỏi thẳng máy chủ
  if (ON() && !S.tickets.some(t => t.code === code) && !S.groups.some(x => x.code === code)) {
    try { const t = await Remote.fetchTicket(code); if (t) S.tickets.push(t); else { const gr = await Remote.fetchGroup(code); if (gr) S.groups.push(gr); } } catch (e) {}
  }
  if (S.tickets.some(t => t.code === code)) g.result = { kind: "ticket", code };
  else if (S.groups.some(x => x.code === code)) g.result = { kind: "group", code };
  else { g.result = { kind: "none", code }; log("gate", `Mã không hợp lệ ${code}`, false); }
  save(); render();
}
/** Cho vào phòng chiếu. Trực tuyến: máy chủ đảm bảo một vé chỉ qua cửa một lần dù nhiều máy cùng quét. */
async function admit(t) {
  const prev = await call("admit_ticket", { p_code: t.code }, "valid");
  if (prev == null) return false;
  if (prev !== "valid") { t.status = prev === "none" ? t.status : prev; toast(prev === "used" ? "Vé đã được quét ở cửa khác" : prev === "refunded" ? "Vé đã hoàn" : "Không tìm thấy vé"); log("gate", `Từ chối ${t.code}: vé ${prev}`, false); save(); render(); return false; }
  t.status = "used"; return true;
}
async function scanCard(card) {
  const grp = S.groups.find(x => x.code === S.view.gate.result.code), g = S.view.gate, s = grp.students.find(x => x.card === card);
  let res = !s ? "foreign" : s.entered ? "dup" : "ok";
  if (ON()) { const r = await call("scan_member", { p_group: grp.code, p_card: card }, res); if (r == null) return; res = r; }
  if (res === "foreign") { g.cardMsg = { ok: false, text: `Thẻ ${card} không thuộc đoàn ${grp.code} – từ chối.` }; log("gate", `Thẻ lạ ${card} tại đoàn ${grp.code}`, false); }
  else if (res === "dup") { if (s) s.entered = true; g.cardMsg = { ok: false, text: `Thẻ của ${s ? s.name : card} đã được quét – chặn quét lại.` }; log("gate", `Quét lại thẻ ${card}`, false); }
  else { s.entered = true; g.cardMsg = { ok: true, text: `${s.name} – lớp ${s.cls}: hợp lệ.` }; }
  save(); render();
}

/* ============================ QUẢN LÝ ============================ */
function viewQL() {
  const tab = S.view.tab || "report";
  let h = `<div class="row"><h1>Quản lý rạp</h1><button class="btn sm right" data-act="reset">Đặt lại dữ liệu demo</button></div><div class="tabs" role="tablist">${[["report", "Báo cáo"], ["age", "Kiểm tra độ tuổi"], ["shows", "Lịch chiếu"], ["films", "Phim"], ["params", "Tham số"]].map(([k, l]) => `<button class="tab" role="tab" aria-selected="${tab === k}" data-act="ql-tab" data-tab="${k}">${l}</button>`).join("")}</div>`;
  if (tab === "report") { const sold = S.tickets.filter(t => t.status !== "refunded"); const byCh = {}; sold.forEach(t => byCh[t.channel] = (byCh[t.channel] || 0) + t.price); S.groups.forEach(g => byCh["Vé đoàn"] = (byCh["Vé đoàn"] || 0) + g.total);
    const rev = Object.values(byCh).reduce((a, b) => a + b, 0), max = Math.max(1, ...Object.values(byCh));
    h += `<div class="kpis"><div class="kpi"><span class="small muted">Doanh thu</span><b>${vnd(rev)}</b></div><div class="kpi"><span class="small muted">Vé lẻ</span><b>${sold.length}</b></div><div class="kpi"><span class="small muted">Vé đoàn</span><b>${S.groups.reduce((a, g) => a + g.students.length + 1, 0)}</b></div><div class="kpi"><span class="small muted">Đã hoàn</span><b>${S.tickets.filter(t => t.status === "refunded").length}</b></div></div>
    <div class="grid g2"><div class="panel"><h3>Doanh thu theo kênh</h3>${Object.entries(byCh).map(([k, v]) => `<div class="stack" style="gap:3px"><div class="row"><span>${k}</span><span class="mono right">${vnd(v)}</span></div><div class="bar"><i style="width:${v / max * 100}%;background:var(--accent)"></i></div></div>`).join("") || "<p class='muted'>Chưa có giao dịch.</p>"}</div>
    <div class="panel"><h3>Tỷ lệ lấp đầy</h3><div class="tbl"><table><thead><tr><th>Suất</th><th>Phim</th><th class="num">Lấp đầy</th></tr></thead><tbody>${S.shows.map(s => { const r = room(s.roomId), tot = r.rows * r.cols; return `<tr><td class="mono">${ddmm(s.start)} ${hhmm(s.start)}</td><td>${esc(film(s.filmId).title)}</td><td class="num">${Math.round((tot - freeSeats(s)) / tot * 100)}%</td></tr>`; }).join("")}</tbody></table></div></div></div>`; }
  else if (tab === "age") { const L = S.logs.filter(l => ["age", "gate", "spot", "doc", "vneid"].includes(l.type)), c = k => L.filter(l => l.type === k).length;
    h += `<div class="note">Bằng chứng khi cơ quan chức năng kiểm tra (phạt 60–80 triệu đồng nếu để người xem sai độ tuổi). Chỉ lưu loại giấy tờ, kết quả, thời điểm – không lưu ảnh.</div>
    <div class="kpis"><div class="kpi"><span class="small muted">Xác thực VNeID</span><b>${c("vneid")}</b></div><div class="kpi"><span class="small muted">Kiểm tra khi bán</span><b>${c("age")}</b></div><div class="kpi"><span class="small muted">Kiểm tra giấy tờ</span><b>${c("doc")}</b></div><div class="kpi"><span class="small muted">Từ chối</span><b>${L.filter(l => !l.ok).length}</b></div></div>
    <div class="panel tbl"><table class="cards"><thead><tr><th>Lúc</th><th>Loại</th><th>Nội dung</th><th>Kết quả</th></tr></thead><tbody>${L.slice(0, 80).map(l => `<tr><td data-label="Lúc" class="mono small">${new Date(l.t).toLocaleTimeString("vi-VN")}</td><td data-label="Loại">${l.type}</td><td data-label="Nội dung">${esc(l.msg)}</td><td data-label="Kết quả">${l.ok ? `<span class="chip ok">Đạt</span>` : `<span class="chip bad">Từ chối</span>`}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">Chưa có bản ghi.</td></tr>`}</tbody></table></div>`; }
  else if (tab === "shows") h += `<div class="panel"><h3>Thêm suất chiếu</h3><div class="row" style="align-items:flex-end"><label style="flex:1;min-width:180px">Phim<select id="ns-film">${S.films.map(f => `<option value="${f.id}">${esc(f.title)} (${f.rating}, ${f.dur}′)</option>`).join("")}</select></label><label style="width:130px">Phòng<select id="ns-room">${S.rooms.map(r => `<option value="${r.id}">${r.name}</option>`).join("")}</select></label><label style="width:230px">Bắt đầu<input id="ns-start" type="datetime-local"></label><button class="btn primary" data-act="add-show">Thêm & kiểm tra trùng</button></div>${S.view.showErr ? `<div class="note bad">${esc(S.view.showErr)}</div>` : ""}<p class="small muted">Giờ kết thúc = bắt đầu + thời lượng + 15 phút dọn phòng.</p></div>
    <div class="panel tbl"><table class="cards"><thead><tr><th>Ngày</th><th>Giờ</th><th>Phòng</th><th>Phim</th><th class="num">Trống</th></tr></thead><tbody>${[...S.shows].sort((a, b) => new Date(a.start) - new Date(b.start)).map(s => `<tr><td data-label="Ngày" class="mono">${ddmm(s.start)}</td><td data-label="Giờ" class="mono">${hhmm(s.start)}–${hhmm(new Date(s.start).getTime() + film(s.filmId).dur * 60000)}</td><td data-label="Phòng">${room(s.roomId).name}</td><td data-label="Phim">${esc(film(s.filmId).title)} ${ratingBadge(film(s.filmId).rating)}</td><td data-label="Trống" class="num">${freeSeats(s)}</td></tr>`).join("")}</tbody></table></div>`;
  else if (tab === "films") h += `<div class="panel"><h3>Thêm phim</h3><div class="row" style="align-items:flex-end"><label style="flex:1;min-width:180px">Tên phim<input id="nf-title"></label><label style="width:110px">Nhãn<select id="nf-rating">${Object.keys(RATINGS).map(r => `<option>${r}</option>`).join("")}</select></label><label style="width:110px">Phút<input id="nf-dur" type="number" value="100"></label><button class="btn primary" data-act="add-film">Thêm</button></div></div>
    <div class="panel tbl"><table><thead><tr><th>Phim</th><th>Nhãn</th><th>Điều kiện</th></tr></thead><tbody>${S.films.map(f => `<tr><td>${esc(f.title)}</td><td>${ratingBadge(f.rating)}</td><td class="small">${esc(RATING_TXT[f.rating])}</td></tr>`).join("")}</tbody></table></div>`;
  else { const P = S.params; h += `<div class="panel"><div class="grid g4"><label>Giữ ghế (phút)<input type="number" id="p-hold" value="${P.holdMin}"></label><label>Hoàn trước (phút)<input type="number" id="p-refund" value="${P.refundMin}"></label><label>Vé tối đa/đơn<input type="number" id="p-max" value="${P.maxTickets}"></label><label>Kiểm tra ngẫu nhiên<input type="number" id="p-spot" value="${P.spot}"></label><label>Vé đoàn tối thiểu<input type="number" id="p-gmin" value="${P.groupMin}"></label></div>
    <fieldset style="border:1px solid var(--line);border-radius:10px"><legend class="small muted">Bắt buộc phụ huynh xác nhận với nhãn</legend><div class="row">${Object.keys(RATINGS).map(r => `<label style="display:flex;gap:6px;color:var(--fg)"><input type="checkbox" id="p-pr-${r}" ${P.parentRequired.includes(r) ? "checked" : ""}>${r}</label>`).join("")}</div></fieldset><button class="btn primary" data-act="save-params">Lưu tham số</button></div>`; }
  return h;
}

/* ============================ hành động ============================ */
const A = {
  async reset() {
    if (ON()) { if (!(await call("reset_demo", {}))) { /* reset_demo trả void → null */ } }
    S = Store.reset(); render(); if (ON()) await Remote.init(S, buildSchedule(), scheduleRender); render(); toast("Đã đặt lại dữ liệu demo");
  },
  "vneid-self"() { verifyFace({ who: "self", title: "Liên kết VNeID", onDone(id, r) { Object.assign(S.user, { linked: true, key: id.key, name: id.name, dob: id.dob, verifiedAt: new Date().toISOString(), faceScore: r.score, method: r.method }); log("vneid", `Liên kết VNeID: ${id.name}, ${ageAt(id.dob, new Date())} tuổi, qua ${r.method}`); } }); },
  unlink() { Object.assign(S.user, { linked: false, dob: null, key: null, name: "Khách" }); S.dependents = []; save(); render(); },
  "clear-ref"(el) { FaceKit.clearRef(el.dataset.key); render(); toast("Đã xoá ảnh gốc trên thiết bị"); },
  "add-dep"() { openAddDep(); },
  "del-dep"(el) { S.dependents = S.dependents.filter(x => x.id !== el.dataset.id); save(); render(); },
  "pick-show"(el) { releaseDraft(); S.draft = { id: rid("D"), showId: el.dataset.show, seats: [], until: null }; go({ name: "seats" }); },
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
  "cancel-draft"() { releaseDraft(); go({ name: "home" }); },
  "to-checkout"() { go({ name: "checkout" }); },
  "back-seats"() { go({ name: "seats" }); },
  "to-pay"() { const d = S.draft, sh = show(d.showId); checkOrder(sh, d.assign).res.forEach((r, i) => log("age", `Đơn ${d.id} ghế ${d.seats[i]} – ${film(sh.filmId).rating} – ${r.name}: ${r.block ? r.reason : r.needDoc ? "cần kiểm tra giấy tờ" : "đạt"}`, !r.block)); go({ name: "pay" }); },
  async "pay-ok"(el) { const d = S.draft;
    if (!d || new Date(d.until) < new Date()) { releaseDraft("Ghế đã hết hạn giữ – giao dịch tự hoàn tiền"); return go({ name: "home" }); }
    const sh = show(d.showId), chk = checkOrder(sh, d.assign); let pts = 0;
    const tks = d.seats.map((sid, i) => { const r = chk.res[i], aud = audience(r.verified || r.level === "Cam kết" ? r.age : null), price = seatPrice(sh, sid) * (1 - aud.disc); pts += Math.round(price * 0.05 / 1000);
      return { code: rid("V"), orderId: d.id, owner: "user", showId: d.showId, seat: sid, viewerName: r.name, aud: aud.label, verified: r.verified, needDoc: r.needDoc, reason: r.reason, price, status: "valid", channel: "Online" }; });
    el.disabled = true;
    const ok = await call("sell_order", { p_show: d.showId, p_hold: d.id, p_tickets: tks.map(t => ({ code: t.code, order_id: t.orderId, device_id: Remote.DEVICE, seat: t.seat, viewer_name: t.viewerName, aud: t.aud, verified: t.verified, need_doc: t.needDoc, reason: t.reason, price: t.price, channel: t.channel })) });
    if (!ok) { releaseDraft(); return go({ name: "home" }); }
    tks.forEach(t => { S.seats[d.showId][t.seat] = { st: "sold" }; if (!S.tickets.some(x => x.code === t.code)) S.tickets.push(t); });
    S.user.points = S.user.points - Math.min(d.points || 0, S.user.points) + pts; log("pay", `Thanh toán đơn ${d.id}: ${vnd(d.total)}`); const id = d.id; S.draft = null; save(); go({ name: "done", order: id, pts }); },
  "pay-fail"() { releaseDraft("Đã huỷ thanh toán, ghế được nhả"); go({ name: "home" }); },
  async refund(el) { const t = S.tickets.find(x => x.code === el.dataset.code), mins = (new Date(show(t.showId).start) - new Date()) / 60000;
    if (mins < S.params.refundMin) return toast(`Chỉ hoàn trước giờ chiếu ${S.params.refundMin} phút (còn ${Math.max(0, Math.round(mins))} phút)`);
    if (S.user.refunds >= S.params.refundLimit[tier()]) return toast("Đã hết lượt hoàn vé tháng này");
    const ok = await call("refund_ticket", { p_code: t.code }); if (!ok) { if (ok === false) toast("Vé đã được sử dụng hoặc đã hoàn"); return; }
    t.status = "refunded"; delete S.seats[t.showId][t.seat]; S.user.refunds++; const g = { code: rid("GC"), amount: t.price }; S.gifts.push(g); log("refund", `Hoàn vé ${t.code} → thẻ quà tặng ${g.code}`); save(); render(); toast("Đã hoàn vào thẻ quà tặng " + g.code); },
  "vneid-teacher"() { verifyFace({ who: "teacher", title: "Xác thực người phụ trách đoàn", onDone(id) { Object.assign(S.teacher, { linked: true, name: id.name, dob: id.dob, key: id.key }); log("vneid", `Người phụ trách ${id.name} xác thực VNeID + FaceID`); } }); },
  "new-group"() { S.view.gdraft = { id: rid("DO", 4), step: 0, showId: null, students: [], commit: false }; save(); render(); },
  "g-cancel"() { S.view.gdraft = null; save(); render(); },
  "g-show"(el) { const g = S.view.gdraft; g.showId = el.dataset.show; g.step = 1; save(); render(); },
  "g-sample"(el) { S.view.gdraft.students = sampleClass(el.dataset.k); save(); render(); },
  "g-parse"() { const out = []; $("#g-csv").value.split(/\n/).map(x => x.trim()).filter(Boolean).forEach((ln, i) => { const [name, dob, cls] = ln.split(",").map(x => x.trim()); const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(dob || ""); if (name && m) out.push({ id: "hs" + i, name, dob: `${m[3]}-${pad(m[2])}-${pad(m[1])}`, cls: cls || "", parentOk: false, entered: false }); });
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
    ex ? Object.assign(ex, grp) : S.groups.push(grp);
    log("group", `Phát hành vé đoàn ${code}: ${g.students.length} HS, cam kết bởi ${S.teacher.name}`); S.view.gdraft = null; save(); render(); toast("Đã phát hành vé đoàn " + code); },
  async "pos-seat"(el) { const p = S.view.pos, sid = el.dataset.seat, i = p.seats.indexOf(sid), hold = "POS-" + Remote.DEVICE;
    if (i >= 0) { p.seats.splice(i, 1); delete S.seats[p.showId][sid]; call("release_seat", { p_show: p.showId, p_seat: sid, p_hold: hold }); }
    else { if (seatState(p.showId, sid)) return; const until = new Date(Date.now() + 600000).toISOString();
      const ok = await call("hold_seat", { p_show: p.showId, p_seat: sid, p_hold: hold, p_until: until }); if (!ok) { if (ok === false) toast("Ghế vừa có người khác giữ"); return render(); }
      p.seats.push(sid); S.seats[p.showId][sid] = { st: "held", by: hold, until }; }
    save(); render(); },
  "pos-docok"(el) { const sid = el.dataset.seat, type = $("#pos-doc-" + sid)?.value; if (!type) return toast("Chọn loại giấy tờ trước"); S.view.pos.docs[sid] = { type, ok: el.dataset.ok === "1" }; log("doc", `Quầy – ghế ${sid}: ${type} – ${el.dataset.ok === "1" ? "đạt" : "không đạt"}`, el.dataset.ok === "1"); save(); render(); },
  async "pos-pay"(el) { const p = S.view.pos, sh = show(p.showId), f = film(sh.filmId);
    const bad = p.seats.filter(sid => p.docs[sid]?.ok === false && RATINGS[f.rating] > 0); if (bad.length) return toast("Vé không đạt độ tuổi – bỏ ghế " + bad.join(", ") + " trước");
    const tks = p.seats.map(sid => { const ty = p.types[sid] || "adult", ok = p.docs[sid]?.ok !== false, disc = ok ? { adult: 0, child: S.prices.child, u22: S.prices.u22, senior: S.prices.senior }[ty] : 0;
      return { code: rid("V"), orderId: "POS", owner: "pos", showId: p.showId, seat: sid, viewerName: "Khách tại quầy", aud: { adult: "Người lớn", child: "Trẻ em", u22: "U22", senior: "Người cao tuổi" }[ok ? ty : "adult"], verified: !!p.docs[sid], needDoc: false, price: seatPrice(sh, sid) * (1 - disc), status: "valid", channel: "Quầy" }; });
    el.disabled = true;
    const okSell = await call("sell_order", { p_show: p.showId, p_hold: "POS-" + Remote.DEVICE, p_tickets: tks.map(t => ({ code: t.code, order_id: "POS", device_id: Remote.DEVICE, seat: t.seat, viewer_name: t.viewerName, aud: t.aud, verified: t.verified, need_doc: false, reason: "", price: t.price, channel: "Quầy" })) });
    if (!okSell) return render();
    tks.forEach(t => { S.seats[p.showId][t.seat] = { st: "sold" }; if (!S.tickets.some(x => x.code === t.code)) S.tickets.push(t); });
    log("pos", `Quầy bán ${p.seats.length} vé – ${el.dataset.m}`); S.view.pos = { showId: p.showId, seats: [], types: {}, docs: {} }; save(); render(); toast("Đã thu tiền và in vé"); },
  "gate-pick"(el) { doScan(el.dataset.code); },
  "gate-scan"() { doScan($("#gate-code")?.value); },
  "gate-camera"() { openScanner("Quét QR vé", code => doScan(code)); },
  "gate-card-camera"() { openScanner("Quét thẻ học sinh", code => scanCard(code.trim().toUpperCase())); },
  async "gate-admit"(el) { const t = S.tickets.find(x => x.code === el.dataset.code); if (!(await admit(t))) return; log("gate", `Vào phòng: ${t.code} (${t.viewerName})`); S.view.gate = {}; save(); render(); toast("Đã cho vào"); },
  async "gate-doc"(el) { const t = S.tickets.find(x => x.code === el.dataset.code), ok = el.dataset.ok === "1", type = $("#gate-doc").value; log("doc", `Cửa – vé ${t.code}: ${type} – ${ok ? "đủ tuổi" : "không đủ tuổi"}`, ok);
    if (ok) { if (!(await admit(t))) return; log("gate", `Vào phòng sau kiểm tra giấy tờ: ${t.code}`); } else log("gate", `Từ chối ${t.code}: không đủ tuổi`, false); S.view.gate = {}; save(); render(); toast(ok ? "Đã cho vào" : "Đã ghi nhận từ chối"); },
  "gate-face"(el) { const grp = S.groups.find(x => x.code === el.dataset.code); verifyFace({ who: "gate-teacher", title: "Đối chiếu người phụ trách", fixedKey: grp.teacherKey || "gv", onDone(id, r) { grp.faceOk = true; grp.faceScore = r.score; call("group_update", { p_code: grp.code, p_counted: null, p_face_ok: true, p_face_score: r.score, p_finish: false }); log("gate", `Đối chiếu khuôn mặt ${grp.teacher}: ${r.score ?? "ảnh gốc mới"}%`); } }); },
  "gate-count"(el) { const grp = S.groups.find(x => x.code === S.view.gate.result.code); grp.counted = Math.max(0, Math.min(grp.students.length, (grp.counted || 0) + Number(el.dataset.d))); if (grp.counted === grp.students.length && Number(el.dataset.d) > 0) toast("Đã đủ số học sinh – người tiếp theo bị chặn"); call("group_update", { p_code: grp.code, p_counted: grp.counted, p_face_ok: null, p_face_score: null, p_finish: false }); save(); render(); },
  "gate-card"(el) { scanCard(el.dataset.card); },
  "gate-next-card"() { const grp = S.groups.find(x => x.code === S.view.gate.result.code), s = grp.students.find(x => !x.entered); s ? scanCard(s.card) : toast("Đã quét hết thẻ"); },
  "gate-dup"() { const grp = S.groups.find(x => x.code === S.view.gate.result.code), s = grp.students.find(x => x.entered); s ? scanCard(s.card) : toast("Chưa có thẻ nào được quét"); },
  "gate-foreign"() { scanCard("G-XXXXX-99"); },
  "gate-spotpick"() { const grp = S.groups.find(x => x.code === S.view.gate.result.code); grp.spot = grp.students.filter(s => s.entered).map(s => s.id).sort(() => Math.random() - .5).slice(0, S.params.spot); save(); render(); },
  "gate-spot"(el) { const grp = S.groups.find(x => x.code === S.view.gate.result.code), s = grp.students.find(x => x.id === el.dataset.id); s.spot = el.dataset.ok === "1"; call("member_spot", { p_card: s.card, p_ok: s.spot }); log("spot", `Kiểm tra ngẫu nhiên ${s.name} (${grp.code}): ${s.spot ? "khớp" : "không khớp"}`, s.spot); save(); render(); },
  "gate-finish"() { const grp = S.groups.find(x => x.code === S.view.gate.result.code), f = film(show(grp.showId).filmId); grp.enteredCount = RATINGS[f.rating] >= 13 ? grp.students.filter(s => s.entered).length : (grp.counted || 0); grp.status = "used"; call("group_update", { p_code: grp.code, p_counted: grp.enteredCount, p_face_ok: null, p_face_score: null, p_finish: true }); log("gate", `Vé đoàn ${grp.code}: ${grp.enteredCount}/${grp.students.length} vào`); S.view.gate = {}; save(); render(); toast("Đã hoàn tất soát vé đoàn"); },
  "ql-tab"(el) { S.view.tab = el.dataset.tab; save(); render(); },
  "add-film"() { const t = $("#nf-title").value.trim(); if (!t) return toast("Nhập tên phim"); S.films.push({ id: rid("f", 4), title: t, rating: $("#nf-rating").value, dur: Number($("#nf-dur").value) || 100, genre: "Phim mới", hue: Math.random() * 360 | 0 }); save(); render(); },
  async "add-show"() { const fId = $("#ns-film").value, rId = $("#ns-room").value, st = $("#ns-start").value; if (!st) { S.view.showErr = "Chọn giờ bắt đầu."; return render(); }
    const s0 = new Date(st), e0 = new Date(s0.getTime() + (film(fId).dur + 15) * 60000), id = rid("s", 6);
    const endOf = s => s.end ? new Date(s.end) : new Date(new Date(s.start).getTime() + (film(s.filmId).dur + 15) * 60000);
    let clash = S.shows.find(s => s.roomId === rId && new Date(s.start) < e0 && endOf(s) > s0);
    if (!clash && ON()) {
      try { const cid = await Remote.rpc("add_show", { p_id: id, p_film: fId, p_room: rId, p_start: s0.toISOString(), p_end: e0.toISOString() }); if (cid) clash = show(cid) || { start: s0, filmId: fId }; }
      catch (e) { return toast("Lỗi kết nối máy chủ – thử lại"); }
    }
    if (clash) { S.view.showErr = `Trùng suất ${hhmm(clash.start)} (${film(clash.filmId).title}) trong ${room(rId).name}.`; return render(); }
    if (!show(id)) S.shows.push({ id, filmId: fId, roomId: rId, start: s0.toISOString(), end: e0.toISOString() }); S.seats[id] ||= {}; S.view.showErr = ""; log("admin", `Thêm suất ${film(fId).title} ${ddmm(s0)} ${hhmm(s0)}`); save(); render(); toast("Đã thêm suất chiếu"); },
  "save-params"() { const P = S.params; P.holdMin = +$("#p-hold").value || 5; P.refundMin = +$("#p-refund").value || 45; P.maxTickets = +$("#p-max").value || 8; P.spot = +$("#p-spot").value || 5; P.groupMin = +$("#p-gmin").value || 10; P.parentRequired = Object.keys(RATINGS).filter(r => $("#p-pr-" + r).checked); save(); toast("Đã lưu tham số"); },
};
document.addEventListener("click", e => {
  const el = e.target.closest("[data-act],[data-go],[data-role]"); if (!el || el.closest("#modal-root") || el.tagName === "SELECT" || el.tagName === "INPUT") return;
  if (el.dataset.role) return setRole(el.dataset.role);
  if (el.dataset.go) { if (S.draft && !["seats", "checkout", "pay"].includes(el.dataset.go)) releaseDraft(); return go({ name: el.dataset.go, film: el.dataset.film }); }
  const f = A[el.dataset.act]; if (f) f(el);
});
document.addEventListener("change", e => {
  const el = e.target, a = el.dataset.act; if (!a || el.closest("#modal-root")) return; const d = S.draft;
  if (a === "assign") { const v = el.value; d.assign[el.dataset.i] = { viewer: v.startsWith("dep:") ? { kind: "dep", depId: v.slice(4) } : { kind: v } }; }
  if (a === "combo") d.combo = Math.max(0, Math.min(8, +el.value || 0));
  if (a === "points") d.points = Math.max(0, Math.min(S.user.points, +el.value || 0));
  if (a === "pos-show") { const p = S.view.pos; p.seats.forEach(sid => delete S.seats[p.showId]?.[sid]); S.view.pos = { showId: el.value || null, seats: [], types: {}, docs: {} }; }
  if (a === "pos-type") { S.view.pos.types[el.dataset.seat] = el.value; delete S.view.pos.docs[el.dataset.seat]; }
  if (a === "g-commit") S.view.gdraft.commit = el.checked;
  save(); render();
});
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.id === "gate-code") { e.preventDefault(); doScan(e.target.value); } });
// Ngoại tuyến: tab khác đổi dữ liệu → nạp lại. Trực tuyến: Supabase Realtime lo việc này.
Store.onRemoteChange(() => { if (ON() || $("#modal-root").innerHTML) return; const role = S.role, view = S.view; S = Store.load(); S.role = role; S.view = view; render(); });

/* ============================ khởi động ============================ */
const NET_TXT = { offline: "Ngoại tuyến – chỉ máy này", connecting: "Đang kết nối…", online: "Trực tuyến · realtime", reconnecting: "Đang kết nối lại…", error: "Không kết nối được máy chủ – chạy ngoại tuyến" };
function showNet(st) { const n = $("#net"); if (n) { n.className = "net " + st; n.innerHTML = `<i></i>${NET_TXT[st] || st}`; } }
Remote.onStatus(showNet); showNet(Remote.status);
const params = new URLSearchParams(location.search);
if (params.has("pair")) phonePage((params.get("pair") || "").toUpperCase());
else {
  const h0 = (location.hash || "").slice(1);
  if (ROLES.some(([k]) => k === h0) && S.role !== h0) { S.role = h0; S.view = { name: h0 === "kh" ? "home" : "main" }; }
  render();
  Remote.init(S, buildSchedule(), () => scheduleRender()).then(ok => { if (ok) { save(); render(); } });
}
