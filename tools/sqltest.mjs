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
for (const f of ["schema.sql", "002_verification.sql", "003_fix_reset.sql", "004_auth_qr.sql", "005_customer.sql", "005_customer.sql", "006_chain.sql", "006_chain.sql", "007_promo.sql", "007_promo.sql"]) {
  try { await db.exec(fs.readFileSync(new URL(f, DIR), "utf8")); ok("chạy " + f, true); } catch (e) { ok("chạy " + f, false, e.message); process.exit(1); }
}

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
ok("mã khuyến mãi dùng chung: khách khác vẫn dùng được (007)", (await j(`select voucher_check($1,'CHAONHOM05') j`, [reg.token])).percent === 10);
ok("my_vouchers: khách đã dùng thấy mã mờ (used_at), khách khác thấy còn hiệu lực", (await q(`select used_at from my_vouchers($1) where code='CHAONHOM05'`, [kh.token]))[0].used_at !== null && (await q(`select used_at from my_vouchers($1) where code='CHAONHOM05'`, [reg.token]))[0].used_at === null);
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
// ---- bạn đi cùng có tài khoản
const gv = await j(`select login('giaovien','giaovien123') j`);
await q(`select face_check('gv',$1::float8[],'DV','t','ảnh',false)`, [d]); await q(`select link_vneid($1,'gv','ảnh') j`, [gv.token]);
await q(`select add_show_s($1,'S4','f4','R2',now()+interval '3h',now()+interval '5h')`, [ql.token]);   // phim T16
const cc = await j(`select companion_check($1,'giaovien@example.com','S4') j`, [kh.token]).catch(() => null) || await j(`select companion_check($1,'giaovien','S4') j`, [kh.token]);
ok("tra bạn đi cùng theo tên đăng nhập: tên + đã xác thực + tuổi tại ngày chiếu, không lộ ngày sinh", cc.username === "giaovien" && cc.verified === true && cc.age >= 35 && !("dob" in cc), JSON.stringify(cc));
ok("tra chính mình → báo", /companion_self/.test(await err(`select companion_check($1,'khach','S4')`, [kh.token])));
ok("tra tài khoản nhân viên → không tìm thấy (không lộ nhân sự)", /companion_unknown/.test(await err(`select companion_check($1,'nhanvien','S4')`, [kh.token])));
ok("tra tài khoản chưa xác thực → verified false, không có tuổi", (await j(`select companion_check($1,'minh.anh','S4') j`, [kh.token])).verified === false);
await q(`select hold_seat('S4','A1','H4',now()+interval '5 min')`); await q(`select hold_seat('S4','A2','H4',now()+interval '5 min')`);
await q(`select sell_order_u($1,'S4','H4','[{"code":"VC1","seat":"A1","price":85000,"channel":"Online","viewer_user":"giaovien","need_doc":true},{"code":"VC2","seat":"A2","price":85000,"channel":"Online","viewer_user":"minh.anh","need_doc":true}]'::jsonb) j`, [kh.token]);
const vc = await q(`select code, viewer_user, viewer_name, verified, need_doc from tickets where code in ('VC1','VC2') order by code`);
ok("vé của bạn đã xác thực: verified, KHÔNG cần kiểm tuổi ở cửa, tên theo hồ sơ", vc[0].viewer_user === "giaovien" && vc[0].verified === true && vc[0].need_doc === false && vc[0].viewer_name === "Phạm Thu Hà", JSON.stringify(vc[0]));
ok("vé của bạn chưa xác thực: vẫn kiểm tuổi ở cửa", vc[1].viewer_user === "minh.anh" && vc[1].need_doc === true);
ok("bạn đi cùng lấy được QR vé của mình", /^CV1\.VC1\./.test((await j(`select ticket_qr($1,'VC1') j`, [gv.token])).payload));
ok("người lạ không lấy được QR vé đó", /forbidden/.test(await err(`select ticket_qr($1,'VC1')`, [reg.token])));
ok("quên vé: bạn đi cùng FaceID → tìm thấy vé được mua cho mình", (await q(`select * from tickets_by_citizen($1,'gv')`, [nv.token])).some(t => t.code === "VC1"));
await q(`select hold_seat('S4','A3','H5',now()+interval '5 min')`);
await q(`select face_check('binh',$1::float8[],'DV','t','ảnh',false)`, [d]); await q(`select link_vneid($1,'binh','ảnh')`, [reg.token]);
ok("bạn đi cùng 15 tuổi mua phim T16 → máy chủ chặn", /companion_underage/.test(await err(`select sell_order_u($1,'S4','H5','[{"code":"VC3","seat":"A3","price":85000,"channel":"Online","viewer_user":"minh.anh"}]'::jsonb)`, [kh.token])));
// ---- chuỗi nhiều rạp (006)
await q(`select ensure_cinemas('[{"id":"086","name":"CineVin Vinh Centre","city":"Nghệ An","tier":"B"},{"id":"035","name":"CineVin Đồng Khởi","city":"TP. Hồ Chí Minh","tier":"A"}]'::jsonb,'[{"id":"086-R1","cinema_id":"086","name":"Phòng 1","kind":"2D","rows":8,"cols":12,"vip":[3,4,5]},{"id":"035-R1","cinema_id":"035","name":"Phòng 1","kind":"3D","rows":8,"cols":12,"vip":[3,4,5]}]'::jsonb)`);
await q(`select ensure_cinemas('[{"id":"086","name":"KHÁC","city":"X"}]'::jsonb,'[]'::jsonb)`);
ok("ensure_cinemas idempotent (không ghi đè rạp đã có)", (await q(`select name from cinemas where id='086'`))[0].name === "CineVin Vinh Centre" && (await q(`select count(*)::int n from rooms`))[0].n === 2);
await q(`select ensure_schedule('[{"id":"20260101-086-1","film_id":"f1","room_id":"086-R1","cinema_id":"086","format":"2D Phụ đề","start_at":"2026-01-01T02:00:00Z","end_at":"2026-01-01T04:00:00Z"},{"id":"20260101-035-1","film_id":"f1","room_id":"035-R1","start_at":"2026-01-01T02:00:00Z","end_at":"2026-01-01T04:00:00Z"}]'::jsonb,'[]'::jsonb)`);
ok("ensure_schedule ghi cinema_id (suy từ mã phòng khi thiếu)", (await q(`select cinema_id from shows where id='20260101-035-1'`))[0].cinema_id === "035");
const nvv = await j(`select login('nhanvien','nhanvien123') j`), qlv = await j(`select login('quanlyvinh','quanlyvinh123') j`);
ok("phiên nhân viên có cinema_id 086; quản lý chuỗi null", nvv.cinema_id === "086" && qlv.cinema_id === "086" && (await j(`select session_info($1) j`, [ql.token])).cinema_id === null);
await q(`select hold_seat('20260101-086-1','A1','H6',now()+interval '5 min')`); await q(`select hold_seat('20260101-035-1','A1','H7',now()+interval '5 min')`);
await q(`select sell_order_u($1,'20260101-086-1','H6','[{"code":"VR086","seat":"A1","price":70000,"channel":"Online"}]'::jsonb)`, [kh.token]);
await q(`select sell_order_u($1,'20260101-035-1','H7','[{"code":"VR035","seat":"A1","price":115000,"channel":"Online"}]'::jsonb)`, [kh.token]);
ok("nhân viên rạp 086 soát vé rạp 035 → wrong_cinema", /wrong_cinema/.test(await err(`select admit_ticket_s($1,'VR035')`, [nvv.token])));
ok("nhân viên rạp 086 soát vé rạp 086 → được", (await q(`select admit_ticket_s($1,'VR086') r`, [nvv.token]))[0].r === "valid");
ok("quản lý chuỗi soát vé mọi rạp", (await q(`select admit_ticket_s($1,'VR035') r`, [ql.token]))[0].r === "valid");
ok("quản lý rạp 086 không thêm suất cho rạp 035", /wrong_cinema/.test(await err(`select add_show_s($1,'X1','f1','035-R1',now()+interval '1h',now()+interval '3h')`, [qlv.token])));
ok("quản lý rạp 086 thêm suất rạp mình → suất mang cinema_id + format", (await q(`select add_show_s($1,'X2','f1','086-R1',now()+interval '1h',now()+interval '3h') r`, [qlv.token]))[0].r === null && (await q(`select cinema_id, format from shows where id='X2'`))[0].cinema_id === "086");
ok("quản lý rạp chỉ tạo nhân viên cho rạp mình", /wrong_cinema/.test(await err(`select create_user($1,'nv035','abc12345','X','nhanvien','035')`, [qlv.token])));
await q(`select create_user($1,'nv086b','abc12345','Nhân viên B','nhanvien','086')`, [qlv.token]);
ok("quản lý rạp tạo nhân viên rạp mình; list_users chỉ thấy người rạp mình", (await q(`select * from list_users($1)`, [qlv.token])).every(u => u.cinema_id === "086"));
ok("quản lý chuỗi tạo nhân viên rạp bất kỳ; rạp lạ bị chặn", /unknown_cinema/.test(await err(`select create_user($1,'nv999','abc12345','X','nhanvien','999')`, [ql.token])));
const cs = await q(`select * from chain_stats($1,'2026-01-01'::date)`, [ql.token]);
ok("chain_stats: doanh thu/ghế theo rạp", cs.length === 2 && cs.find(x => x.cinema_id === "035").revenue == 115000 && cs.find(x => x.cinema_id === "086").sold === 1, JSON.stringify(cs));
ok("huỷ liên kết VNeID", (await j(`select unlink_vneid($1) j`, [kh.token])).citizen_key === null);
ok("anon không gọi được _find_user", !(await q(`select has_function_privilege('anon','public._find_user(text)','execute') p`))[0].p);
console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
