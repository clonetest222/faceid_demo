// Kiểm thử tải: N khách ảo cùng lúc giữ ghế + thanh toán trên Supabase thật.
// Chạy: node tools/loadtest.mjs [số khách=1000] [đồng thời=100]
// Chỉ dùng publishable key (đọc từ js/config.js). Thêm suất thử và dọn dữ liệu cần quyền quản lý (migration 004):
// đặt LT_USER / LT_PASS, mặc định tài khoản demo quanly / quanly123.
import { readFileSync } from "node:fs";
const cfgTxt = readFileSync(new URL("../js/config.js", import.meta.url), "utf8");
const URL_ = /supabaseUrl:\s*"([^"]+)"/.exec(cfgTxt)[1], KEY = /supabaseKey:\s*"([^"]+)"/.exec(cfgTxt)[1];
const N = +process.argv[2] || 1000, CONC = +process.argv[3] || 100;
const H = { apikey: KEY, "Content-Type": "application/json" };
const rpc = async (fn, body) => { const t = Date.now(); const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: "POST", headers: H, body: JSON.stringify(body) }); const ms = Date.now() - t; const txt = await r.text(); return { ok: r.ok, status: r.status, ms, data: txt ? JSON.parse(txt) : null }; };
const get = async path => (await fetch(`${URL_}/rest/v1/${path}`, { headers: H })).json();
const rid = (n = 6) => Array.from({ length: n }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.random() * 32 | 0]).join("");

const login = await rpc("login", { p_user: process.env.LT_USER || "quanly", p_pass: process.env.LT_PASS || "quanly123" });
if (!login.ok) { console.error("Không đăng nhập được tài khoản quản lý – đã chạy 004_auth_qr.sql chưa?", login.status, login.data); process.exit(1); }
const TOKEN = login.data.token;
// 3 suất thử, 140 ghế mỗi suất (phòng 3) = 420 ghế cho N khách → buộc tranh chấp
const day = new Date(); day.setDate(day.getDate() + 5); day.setHours(10, 0, 0, 0);
const shows = [0, 1, 2].map(i => { const s = new Date(day.getTime() + i * 3 * 3600e3); return { id: "LT-" + rid(4), start: s, end: new Date(s.getTime() + 2 * 3600e3) }; });
for (const s of shows) { const r = await rpc("add_show_s", { p_token: TOKEN, p_id: s.id, p_film: "f1", p_room: "R3", p_start: s.start.toISOString(), p_end: s.end.toISOString() }); if (!r.ok) { console.error("Không tạo được suất thử – đã chạy schema.sql chưa?", r.status, r.data); process.exit(1); } }
const SEATS = []; for (let r = 0; r < 10; r++) for (let c = 0; c < 14; c++) SEATS.push(String.fromCharCode(65 + r) + (c + 1));

const lat = { hold: [], sell: [] }; let holdOk = 0, holdTaken = 0, sold = 0, sellFail = 0, errors = 0, customersServed = 0;
async function customer(i) {
  const show = shows[i % shows.length], want = 1 + (Math.random() * 3 | 0), hold = "LTH-" + rid(8), until = new Date(Date.now() + 5 * 60e3).toISOString(), got = [];
  for (let k = 0; k < want; k++) {
    const seat = SEATS[Math.random() * SEATS.length | 0];
    const r = await rpc("hold_seat", { p_show: show.id, p_seat: seat, p_hold: hold, p_until: until });
    lat.hold.push(r.ms); if (!r.ok) { errors++; continue; }
    if (r.data === true) { holdOk++; got.push(seat); } else holdTaken++;
  }
  if (!got.length) return;
  const r = await rpc("sell_order", { p_show: show.id, p_hold: hold, p_tickets: got.map(seat => ({ code: "LT" + rid(8), order_id: hold, device_id: "loadtest", seat, viewer_name: "Khách " + i, aud: "Người lớn", price: 85000, channel: "Online" })) });
  lat.sell.push(r.ms); if (r.ok) { sold += got.length; customersServed++; } else sellFail++;
}
const t0 = Date.now(); let next = 0;
await Promise.all(Array.from({ length: CONC }, async () => { while (next < N) await customer(next++); }));
const wall = (Date.now() - t0) / 1000;

// Kiểm tra toàn vẹn: không ghế nào có 2 vé
const ids = shows.map(s => s.id).join(",");
const tickets = await get(`tickets?select=show_id,seat&show_id=in.(${ids})`);
const seen = new Map(); let dup = 0; for (const t of tickets) { const k = t.show_id + "/" + t.seat; seen.set(k, (seen.get(k) || 0) + 1); } for (const v of seen.values()) if (v > 1) dup++;
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))] : 0; };
console.log(`Khách ảo: ${N} (đồng thời ${CONC}) – ${wall.toFixed(1)} giây`);
console.log(`Giữ ghế: ${holdOk} thành công, ${holdTaken} bị từ chối vì ghế đã có người, ${errors} lỗi mạng/máy chủ`);
console.log(`Thanh toán: ${customersServed} đơn, ${sold} vé; ${sellFail} đơn lỗi`);
console.log(`Độ trễ giữ ghế: p50 ${pct(lat.hold, 50)} ms, p95 ${pct(lat.hold, 95)} ms · thanh toán: p50 ${pct(lat.sell, 50)} ms, p95 ${pct(lat.sell, 95)} ms`);
console.log(`Vé trong CSDL: ${tickets.length} · ghế bị bán trùng: ${dup}`);
await rpc("reset_demo_s", { p_token: TOKEN });
console.log("Đã dọn dữ liệu thử (reset_demo_s).");
