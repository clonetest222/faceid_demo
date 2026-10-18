// Chạy toàn bộ migration trên PGlite (Postgres nhúng) và kiểm thử các hàm máy chủ – không đụng Supabase thật.
// Chạy: npm i --prefix tools/.pg @electric-sql/pglite  rồi  node tools/sqltest.mjs
import { PGlite } from "./.pg/node_modules/@electric-sql/pglite/dist/index.js";
import { pgcrypto } from "./.pg/node_modules/@electric-sql/pglite/dist/contrib/pgcrypto.js";
import fs from "node:fs";
const DIR = new URL("../supabase/", import.meta.url);
const db = new PGlite({ extensions: { pgcrypto } });
let pass = 0, fail = 0;
const ok = (name, cond, info = "") => { cond ? pass++ : fail++; console.log((cond ? "PASS " : "FAIL ") + name + (info ? "  — " + info : "")); };
const q = async (sql, params) => (await db.query(sql, params)).rows;
const err = async (sql, params) => { try { await db.query(sql, params); return null; } catch (e) { return e.message; } };
const j = async (sql, params) => (await q(sql, params))[0].j;

await db.exec(`create role anon; create role authenticated; create schema if not exists extensions; create publication supabase_realtime;`);
for (const f of ["schema.sql", "002_verification.sql", "003_fix_reset.sql", "004_auth_qr.sql", "005_customer.sql"]) {
  try { await db.exec(fs.readFileSync(new URL(f, DIR), "utf8")); ok("chạy " + f, true); } catch (e) { ok("chạy " + f, false, e.message); process.exit(1); }
}
try { await db.exec(fs.readFileSync(new URL("005_customer.sql", DIR), "utf8")); ok("005 chạy lại lần 2 không lỗi", true); } catch (e) { ok("005 chạy lại lần 2", false, e.message); }

// ---- đăng ký đầy đủ, đăng nhập bằng email / SĐT
const reg = await j(`select register('minh.anh','matkhau1','Minh Anh','Minh.Anh@example.com','0912345678') j`);
ok("đăng ký họ tên + email + SĐT", reg.role === "khach" && reg.email === "minh.anh@example.com" && reg.phone === "0912345678" && reg.points === 120, JSON.stringify({ email: reg.email, phone: reg.phone }));
ok("email sai định dạng bị chặn", /bad_email/.test(await err(`select register('abc.def','matkhau1','X Y','khong-phai-email',null)`)));
ok("SĐT sai bị chặn", /bad_phone/.test(await err(`select register('abc.def','matkhau1','X Y',null,'12345')`)));
ok("email trùng bị chặn", /email_taken/.test(await err(`select register('abc.def','matkhau1','X Y','MINH.ANH@example.com',null)`)));
ok("đăng ký không email/SĐT vẫn được (tương thích cũ)", (await j(`select register('abc.def','matkhau1','X Y') j`)).username === "abc.def");
ok("đăng nhập bằng email", (await j(`select login('minh.anh@example.com','matkhau1') j`)).username === "minh.anh");
ok("đăng nhập bằng SĐT (có khoảng trắng)", (await j(`select login('0912 345 678','matkhau1') j`)).username === "minh.anh");
const kh = await j(`select login('khach','khach123') j`);
ok("phiên trả về hồ sơ: chưa liên kết VNeID", kh.citizen_key === null && kh.vneid_verified_at === null && kh.confirm_every === false);

// ---- liên kết VNeID trên máy chủ
const d = Array.from({ length: 128 }, (_, i) => Math.sin(i) / 11);
const f1 = await j(`select face_check('an',$1::float8[],'DV','t','camera',true) j`, [d]);
const linked = await j(`select link_vneid($1,'an','camera + chớp mắt',$2) j`, [kh.token, f1.id]);
ok("liên kết VNeID: phiên có citizen_key, ngày sinh, thời điểm", linked.citizen_key === "an" && linked.dob === "2004-03-12" && !!linked.vneid_verified_at && linked.name === "Nguyễn Văn An");
ok("hồ sơ còn sau khi đăng nhập lại (lưu máy chủ)", (await j(`select login('khach','khach123') j`)).citizen_key === "an");
ok("hồ sơ VNeID đã gắn tài khoản khác → từ chối", /citizen_taken/.test(await err(`select link_vneid($1,'an','x')`, [reg.token])));
ok("ghi bản ghi verifications loại vneid", (await q(`select count(*)::int n from verifications where kind='vneid' and detail->>'user'='khach'`))[0].n === 1);

// ---- đăng nhập FaceID
const lf = await j(`select login_face('khach',$1::float8[],'DV2') j`, [d.map(x => x + 0.005)]);
ok("đăng nhập FaceID: khuôn mặt khớp → có phiên", !!lf.token && lf.username === "khach");
const bad = await j(`select login_face('khach',$1::float8[],'DV2') j`, [d.map((x, i) => x + (i % 2 ? .3 : -.3))]);
ok("đăng nhập FaceID: người khác → từ chối, không có phiên", bad.ok === false && bad.error === "face_mismatch" && !bad.token, JSON.stringify(bad));
ok("đăng nhập FaceID: tài khoản chưa liên kết → báo rõ", /face_not_linked/.test(await err(`select login_face('minh.anh',$1::float8[],'DV2')`, [d])));
ok("mỗi lần đăng nhập FaceID được ghi (kể cả thất bại)", (await q(`select count(*)::int n from verifications where kind='login' and method='FaceID'`))[0].n === 2);
// ---- đăng nhập VNeID
ok("đăng nhập VNeID: hồ sơ đã gắn → phiên của đúng tài khoản", (await j(`select login_vneid('an','DV3') j`)).username === "khach");
ok("đăng nhập VNeID: hồ sơ chưa gắn → báo", /vneid_not_linked/.test(await err(`select login_vneid('cuc','DV3')`)));
// ---- tuỳ chọn
ok("bật xác nhận mỗi lần đặt vé", (await j(`select set_pref($1,true) j`, [kh.token])).confirm_every === true);

// ---- voucher + điểm khi thanh toán
const ql = await j(`select login('quanly','quanly123') j`);
await q(`select add_show_s($1,'S1','f1','R1',now()+interval '2h',now()+interval '4h')`, [ql.token]);
ok("mã khuyến mãi mẫu hợp lệ", (await j(`select voucher_check($1,'chaonhom05') j`, [kh.token])).percent === 10);
ok("mã lạ → báo", /voucher_unknown/.test(await err(`select voucher_check($1,'XXX')`, [kh.token])));
await q(`select hold_seat('S1','A1','H1',now()+interval '5 min')`); await q(`select hold_seat('S1','A2','H1',now()+interval '5 min')`);
const pay = await j(`select sell_order_u($1,'S1','H1','[{"code":"VT01","seat":"A1","price":85000,"channel":"Online"},{"code":"VT02","seat":"A2","price":85000,"channel":"Online"}]'::jsonb,'CHAONHOM05',20) j`, [kh.token]);
ok("thanh toán: 170.000 − 10% − 20 điểm = 133.000, cộng 6 điểm", +pay.gross === 170000 && +pay.discount === 17000 && pay.points_used === 20 && +pay.paid === 133000 && pay.points_earned === 6 && pay.points === 106, JSON.stringify(pay));
ok("voucher dùng rồi không dùng lại", /voucher_used/.test(await err(`select voucher_check($1,'CHAONHOM05')`, [kh.token])));
ok("điểm lưu trên máy chủ", (await j(`select session_info($1) j`, [kh.token])).points === 106);
await q(`select hold_seat('S1','A3','H2',now()+interval '5 min')`);
const pay2 = await j(`select sell_order_u($1,'S1','H2','[{"code":"VT03","seat":"A3","price":85000,"channel":"Online"}]'::jsonb,null,999) j`, [kh.token]);
ok("dùng quá số điểm đang có → chỉ trừ tối đa 85 (giá vé) và không quá 106", pay2.points_used === 85 && +pay2.paid === 0, JSON.stringify(pay2));
const rf = await j(`select refund_ticket_u($1,'VT01') j`, [kh.token]);
ok("hoàn vé → thẻ quà tặng 85.000 của chính chủ", rf.gift.startsWith("GC") && +rf.amount === 85000);
ok("thẻ quà tặng người khác không dùng được", /voucher_not_yours/.test(await err(`select voucher_check($1,$2)`, [reg.token, rf.gift])));
ok("my_vouchers liệt kê thẻ của tôi", (await q(`select * from my_vouchers($1)`, [kh.token])).some(v => v.code === rf.gift));

// ---- vào rạp không cần vé
const nv = await j(`select login('nhanvien','nhanvien123') j`);
const found = await q(`select * from tickets_by_citizen($1,'an')`, [nv.token]);
ok("nhân viên tra vé hôm nay theo hồ sơ VNeID (sau FaceID)", found.length === 2 && found.every(t => t.username === "khach"), found.map(t => t.code).join(","));
ok("khách không gọi được tickets_by_citizen", /forbidden/.test(await err(`select * from tickets_by_citizen($1,'an')`, [kh.token])));
// ---- một QR cho cả đơn
await q(`select hold_seat('S1','B1','H3',now()+interval '5 min')`); await q(`select hold_seat('S1','B2','H3',now()+interval '5 min')`); await q(`select hold_seat('S1','B3','H3',now()+interval '5 min')`);
await q(`select sell_order_u($1,'S1','H3','[{"code":"VB1","seat":"B1","price":85000,"channel":"Online","need_doc":false},{"code":"VB2","seat":"B2","price":85000,"channel":"Online","need_doc":true},{"code":"VB3","seat":"B3","price":85000,"channel":"Online"}]'::jsonb) j`, [kh.token]);
const ord = await q(`select * from order_tickets($1,'VB2')`, [nv.token]);
ok("quét một vé → ra cả đơn cùng chủ + cùng suất (gồm vé mua thêm VT02, VT03)", ord.map(x => x.code).sort().join(",") === "VB1,VB2,VB3,VT02,VT03", ord.map(x => x.code).join(","));
const adm = await j(`select admit_many_s($1, array['VB1','VB3','VT02']) j`, [nv.token]);
ok("cho vào 3 vé một lần", adm.VB1 === "valid" && adm.VB3 === "valid" && adm.VT02 === "valid");
ok("quét lại đơn: 3 vé đã vào, vé cần kiểm tuổi vẫn chờ", (await q(`select * from order_tickets($1,'VB2')`, [nv.token])).filter(x => x.status === "used").length === 3);
ok("cho vào lần 2 cùng vé → báo đã dùng", (await j(`select admit_many_s($1, array['VB1']) j`, [nv.token])).VB1 === "used");
ok("khách không gọi được order_tickets", /forbidden/.test(await err(`select * from order_tickets($1,'VB2')`, [kh.token])));
ok("huỷ liên kết VNeID", (await j(`select unlink_vneid($1) j`, [kh.token])).citizen_key === null);
ok("anon không gọi được _find_user", !(await q(`select has_function_privilege('anon','public._find_user(text)','execute') p`))[0].p);
console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
