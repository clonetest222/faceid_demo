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

await db.exec(`create role anon; create role authenticated; create role service_role; create schema if not exists extensions; create publication supabase_realtime;`);
for (const f of ["schema.sql", "002_verification.sql", "003_fix_reset.sql", "004_auth_qr.sql", "005_customer.sql", "005_customer.sql", "006_chain.sql", "006_chain.sql", "007_promo.sql", "007_promo.sql", "008_admin.sql", "008_admin.sql", "009_seats.sql", "009_seats.sql", "010_seat_info.sql", "010_seat_info.sql", "011_seat_types.sql", "011_seat_types.sql", "012_zero.sql", "012_zero.sql", "013_fixed_price.sql", "013_fixed_price.sql", "014_own_identity.sql", "014_own_identity.sql", "015_price_tiers.sql", "015_price_tiers.sql", "016_hr.sql", "016_hr.sql", "017_account.sql", "017_account.sql", "018_shift_request.sql", "018_shift_request.sql", "019_keys.sql", "019_keys.sql", "020_films_cgv.sql", "020_films_cgv.sql", "021_guest.sql", "021_guest.sql"]) {
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
// ---- quản trị chuỗi (008)
const kt = await j(`select login('kythuat','kythuat123') j`);
ok("kỹ thuật đăng nhập: vai trò kythuat gắn rạp 086; nhật ký có bản ghi đăng nhập", kt.role === "kythuat" && kt.cinema_id === "086" && (await q(`select count(*)::int n from audit_logs where type='login' and msg like '@kythuat%'`))[0].n === 1);
await q(`select save_room_s($1,'{"id":"086-R1","cinema_id":"086","name":"Phòng 1","kind":"2D","rows":8,"cols":12,"vip":[3,4,5],"blocked":["h11","H12"],"active":true}'::jsonb)`, [kt.token]);
ok("kỹ thuật khoá ghế H11, H12 phòng 086-R1", JSON.stringify((await q(`select blocked from rooms where id='086-R1'`))[0].blocked) === '["H11","H12"]', JSON.stringify((await q(`select blocked, seat_map from rooms where id='086-R1'`))[0]));
ok("nhân viên không sửa phòng", /forbidden/.test(await err(`select save_room_s($1,'{"id":"086-R1","cinema_id":"086","rows":8,"cols":12}'::jsonb)`, [nvv.token])));
ok("kỹ thuật rạp 086 không sửa phòng rạp 035", /wrong_cinema/.test(await err(`select save_room_s($1,'{"id":"035-R1","cinema_id":"035","rows":8,"cols":12}'::jsonb)`, [kt.token])));
await q(`select save_room_s($1,'{"id":"086-R2","cinema_id":"086","name":"Phòng 2","kind":"IMAX","rows":10,"cols":14,"vip":[4,5],"active":true}'::jsonb)`, [qlv.token]);
ok("quản lý rạp thêm phòng IMAX", (await q(`select kind from rooms where id='086-R2'`))[0].kind === "IMAX");
await q(`select save_room_s($1,'{"id":"086-R2","cinema_id":"086","name":"Phòng 2","kind":"IMAX","rows":10,"cols":14,"vip":[],"vip_seats":["E1","E2"],"couple":["J13","J14"],"blocked":["a5"],"active":true}'::jsonb)`, [kt.token]);
ok("009: loại ghế theo từng ghế (VIP E1,E2 · đôi J13,J14 · bảo trì A5) lưu đúng", JSON.stringify((await q(`select vip_seats, couple, blocked from rooms where id='086-R2'`))[0]) === '{"vip_seats":["E1","E2"],"couple":["J13","J14"],"blocked":["A5"]}');
await q(`select save_cinema_s($1,'{"id":"099","name":"CineVin Huế","city":"Thừa Thiên Huế","district":"TP Huế","tier":"B"}'::jsonb)`, [ql.token]);
ok("quản lý chuỗi thêm cơ sở 099; quản lý rạp không thêm cơ sở khác", (await q(`select name from cinemas where id='099'`))[0].name === "CineVin Huế" && /wrong_cinema/.test(await err(`select save_cinema_s($1,'{"id":"098","name":"CineVin X","city":"Y"}'::jsonb)`, [qlv.token])));
await q(`select save_cinema_s($1,'{"id":"086","name":"CineVin Vinh Centre","city":"Nghệ An","district":"TP Vinh","hotline":"1900 6017","tier":"B"}'::jsonb)`, [qlv.token]);
ok("quản lý rạp sửa thông tin rạp mình", (await q(`select hotline from cinemas where id='086'`))[0].hotline === "1900 6017");
await q(`select ensure_films('[{"id":"f1","title":"Siêu Nhí Tí Hon","rating":"P","dur":95}]'::jsonb)`);
await q(`select save_film_s($1,'{"id":"f9","title":"Phim Mới","rating":"T13","dur":110,"genre":"Hành động"}'::jsonb, array['086'])`, [ql.token]);
ok("quản lý chuỗi thêm phim vào kho, phân phối cho 086 (không cho 035)", (await q(`select active from cinema_films where film_id='f9' and cinema_id='086'`))[0].active === true && (await q(`select active from cinema_films where film_id='f9' and cinema_id='035'`))[0].active === false);
ok("quản lý rạp không sửa kho phim chung", /forbidden/.test(await err(`select save_film_s($1,'{"id":"f8","title":"X"}'::jsonb)`, [qlv.token])));
ok("thêm suất phim chưa phân phối cho rạp → film_not_at_cinema", /film_not_at_cinema/.test(await err(`select add_show_s($1,'X9','f9','035-R1',now()+interval '1h',now()+interval '3h')`, [ql.token])));
await q(`select set_film_cinema_s($1,'f9','086',false)`, [qlv.token]);
ok("quản lý rạp bỏ phân phối phim khỏi rạp mình", (await q(`select active from cinema_films where film_id='f9' and cinema_id='086'`))[0].active === false);
ok("đổi giờ suất X2 (chưa bán vé) → null", (await q(`select update_show_s($1,'X2','086-R1',now()+interval '5h',now()+interval '7h') r`, [qlv.token]))[0].r === null);
await q(`select add_show_s($1,'X3','f1','086-R1',now()+interval '8h',now()+interval '10h')`, [qlv.token]);
ok("đổi giờ trùng suất khác → trả mã suất trùng", (await q(`select update_show_s($1,'X2','086-R1',now()+interval '9h',now()+interval '11h') r`, [qlv.token]))[0].r === "X3");
await q(`select hold_seat('X2','A3','H8',now()+interval '5 min')`);
await q(`select sell_order_u($1,'X2','H8','[{"code":"VX2","seat":"A3","price":70000,"channel":"Online"}]'::jsonb)`, [reg.token]);
ok("thu nhỏ phòng dưới ghế đã bán (A3 của suất sắp chiếu) → seats_sold", /seats_sold/.test(await err(`select save_room_s($1,'{"id":"086-R1","cinema_id":"086","rows":1,"cols":1}'::jsonb)`, [kt.token])));
ok("đã bán vé → không đổi phòng (has_tickets), vẫn đổi giờ được", /has_tickets/.test(await err(`select update_show_s($1,'X2','086-R2',now()+interval '5h',now()+interval '7h')`, [qlv.token])) && (await q(`select update_show_s($1,'X2','086-R1',now()+interval '5h',now()+interval '7h') r`, [qlv.token]))[0].r === null);
ok("quản lý rạp 086 không huỷ suất rạp 035", /wrong_cinema/.test(await err(`select cancel_show_s($1,'20260101-035-1','x')`, [qlv.token])));
const nCancel = (await q(`select cancel_show_s($1,'X2','Hỏng máy chiếu') n`, [qlv.token]))[0].n;
ok("huỷ suất: hoàn 1 vé vào thẻ quà tặng của người mua, nhả ghế, suất = cancelled", nCancel === 1 && (await q(`select status from tickets where code='VX2'`))[0].status === "refunded" && (await q(`select count(*)::int n from vouchers where owner_user=$1 and kind='gift' and amount=70000`, [reg.username]))[0].n === 1 && (await q(`select count(*)::int n from seat_locks where show_id='X2'`))[0].n === 0 && (await q(`select status, cancel_reason from shows where id='X2'`))[0].status === "cancelled");
ok("suất đã huỷ không đổi được nữa", /show_cancelled/.test(await err(`select update_show_s($1,'X2','086-R1',now()+interval '5h',now()+interval '7h')`, [qlv.token])));
await q(`select hold_seat('X3','A1','H9',now()+interval '5 min')`); await q(`select sell_order_u($1,'X3','H9','[{"code":"VX3","seat":"A1","price":70000,"channel":"Online"}]'::jsonb)`, [reg.token]);
const si = await j(`select seat_info_s($1,'X3','A1') j`, [nvv.token]);
ok("010 tra ghế A1 suất X3: vé VX3, người mua là tài khoản thật (SĐT/email che bớt), đã xác thực VNeID, chưa vào", si.ticket && si.ticket.code === "VX3" && si.ticket.owner.username === reg.username && /•/.test(si.ticket.owner.phone) && /•••@/.test(si.ticket.owner.email) && si.ticket.owner.vneid === true && si.ticket.status === "valid" && si.lock.status === "sold", JSON.stringify(si.ticket.owner));
ok("010 ghế đã hoàn (X2/A3 sau huỷ suất): không có vé hiện tại, lịch sử hoàn 1 vé, suất cancelled", (await j(`select seat_info_s($1,'X2','A3') j`, [nvv.token])).refunds.length === 1 && !(await j(`select seat_info_s($1,'X2','A3') j`, [nvv.token])).ticket && (await j(`select seat_info_s($1,'X2','A3') j`, [nvv.token])).show.status === "cancelled");
await q(`select hold_seat('X3','B1','HOLD-UI',now()+interval '4 min')`);
ok("010 ghế đang giữ → lock held kèm hold_id; ghế trống → không vé không khoá", (await j(`select seat_info_s($1,'X3','B1') j`, [nvv.token])).lock.hold_id === "HOLD-UI" && !(await j(`select seat_info_s($1,'X3','C1') j`, [nvv.token])).lock);
ok("010 khách không tra ghế; nhân viên rạp 086 không tra ghế rạp 035; kỹ thuật không xem thông tin khách", /forbidden/.test(await err(`select seat_info_s($1,'X3','A1')`, [kh.token])) && /wrong_cinema/.test(await err(`select seat_info_s($1,'20260101-035-1','A1')`, [nvv.token])) && /forbidden/.test(await err(`select seat_info_s($1,'X3','A1')`, [kt.token])));
ok("010 show_tickets_s: danh sách vé suất X3 kèm tên người mua", (await q(`select * from show_tickets_s($1,'X3')`, [qlv.token])).some(t => t.code === "VX3" && t.owner_name));
// ---- loại ghế tự định nghĩa (011)
ok("011: dữ liệu 009 của 086-R2 được chuyển sang seat_map", JSON.stringify((await q(`select seat_map from rooms where id='086-R2'`))[0].seat_map) === '{"A5":"blocked","E1":"vip","E2":"vip","J13":"couple","J14":"couple"}');
await q(`select save_seat_type_s($1,'{"id":"sofa4","name":"Sofa 4 người","persons":4,"surcharge_a":120000,"surcharge_b":80000,"color":"violet","icon":"sofa"}'::jsonb)`, [ql.token]);
ok("quản lý chuỗi tạo loại ghế Sofa 4 người; quản lý rạp không tạo", (await q(`select persons, surcharge_b from seat_types where id='sofa4'`))[0].persons === 4 && /forbidden/.test(await err(`select save_seat_type_s($1,'{"id":"x","name":"X"}'::jsonb)`, [qlv.token])));
await q(`select save_room_s($1,'{"id":"086-R2","cinema_id":"086","name":"Phòng 2","kind":"IMAX","rows":10,"cols":14,"seat_map":{"j13":"sofa4","J14":"sofa4","A1":"vip","B2":"khongco","A5":"blocked","Z9":"vip"},"active":true}'::jsonb)`, [kt.token]);
ok("sơ đồ phòng theo loại: giữ loại tồn tại, bỏ loại lạ, ghế ngoài kích thước; cột 009 suy ra tương thích", JSON.stringify((await q(`select seat_map, vip_seats, couple, blocked from rooms where id='086-R2'`))[0]) === '{"seat_map":{"A1":"vip","A5":"blocked","J13":"sofa4","J14":"sofa4"},"vip_seats":["A1"],"couple":[],"blocked":["A5"]}');
await q(`select save_seat_type_s($1,'{"id":"sofa4","name":"Sofa 4 người","persons":4,"fixed_a":500000,"fixed_b":400000,"color":"violet","icon":"sofa"}'::jsonb)`, [ql.token]);
ok("013 loại ghế giá cứng A 500k / B 400k lưu được; giá cứng 0 bị chặn", (await q(`select fixed_a, fixed_b from seat_types where id='sofa4'`))[0].fixed_b == 400000 && /bad_input/.test(await err(`select save_seat_type_s($1,'{"id":"sofa4","name":"X","fixed_a":0}'::jsonb)`, [ql.token])));
await q(`select save_price_tier_s($1,'A','{"weekday":{"adult":150000,"u22":80000,"child":70000,"senior":90000},"wed":{"adult":90000,"u22":80000,"child":70000,"senior":90000},"weekend":{"adult":170000,"u22":80000,"child":70000,"senior":100000},"s3d":{"weekday":32000,"weekend":53000},"gold":60000,"imax":80000,"holiday":11000}'::jsonb)`, [ql.token]);
ok("015 quản lý chuỗi đặt bảng giá hạng A (người lớn 150k); quản lý rạp không được; hạng lạ bị chặn", (await q(`select prices from price_tiers where id='A'`))[0].prices.weekday.adult === 150000 && /forbidden/.test(await err(`select save_price_tier_s($1,'A','{}'::jsonb)`, [qlv.token])) && /bad_input/.test(await err(`select save_price_tier_s($1,'C','{}'::jsonb)`, [ql.token])));
ok("không xoá loại ghế mặc định", /builtin_type/.test(await err(`select delete_seat_type_s($1,'vip')`, [ql.token])));
await q(`select delete_seat_type_s($1,'sofa4')`, [ql.token]);
ok("xoá loại tự tạo → ghế mang loại đó về thường, loại biến mất", JSON.stringify((await q(`select seat_map from rooms where id='086-R2'`))[0].seat_map) === '{"A1":"vip","A5":"blocked"}' && (await q(`select count(*)::int n from seat_types where id='sofa4'`))[0].n === 0);
await q(`select save_cinema_prices_s($1,'086','{"weekday":{"adult":75000,"u22":60000,"child":50000,"senior":50000},"wed":{"adult":65000,"u22":60000,"child":50000,"senior":60000},"weekend":{"adult":90000,"u22":60000,"child":58000,"senior":58000},"s3d":{"weekday":30000,"weekend":30000},"gold":40000,"imax":60000,"holiday":10000}'::jsonb)`, [qlv.token]);
ok("quản lý rạp đặt bảng giá riêng cho rạp mình; không đặt cho rạp khác; giá người lớn 0 bị chặn", ((await q(`select prices from cinemas where id='086'`))[0].prices.weekday.adult === 75000) && /wrong_cinema/.test(await err(`select save_cinema_prices_s($1,'035','{}'::jsonb)`, [qlv.token])) && /bad_input/.test(await err(`select save_cinema_prices_s($1,'086','{"weekday":{"adult":0,"u22":1,"child":1,"senior":1},"wed":{"adult":1,"u22":1,"child":1,"senior":1},"weekend":{"adult":1,"u22":1,"child":1,"senior":1}}'::jsonb)`, [qlv.token])));
await q(`select save_cinema_prices_s($1,'086',null)`, [qlv.token]);
ok("bỏ bảng giá riêng → prices null", (await q(`select prices from cinemas where id='086'`))[0].prices === null);
// ---- 012: ghế bảo trì không bán được; không đánh dấu bảo trì ghế đã bán
await q(`select add_show_s($1,'X5','f1','086-R2',now()+interval '12h',now()+interval '14h')`, [qlv.token]);
ok("012 hold_seat ghế bảo trì (086-R2/A5) → false ở máy chủ; ghế thường bên cạnh → true", (await q(`select hold_seat('X5','A5','H12',now()+interval '5 min') r`))[0].r === false && (await q(`select hold_seat('X5','A6','H12',now()+interval '5 min') r`))[0].r === true);
ok("012 đánh dấu bảo trì ghế đã bán sắp chiếu (X3/A1) → seat_sold_blocked A1", /seat_sold_blocked A1/.test(await err(`select save_room_s($1,'{"id":"086-R1","cinema_id":"086","rows":8,"cols":12,"seat_map":{"A1":"blocked"}}'::jsonb)`, [kt.token])));
ok("xoá phòng còn vé sắp chiếu → room_in_use; quản lý rạp không xoá cơ sở", /room_in_use/.test(await err(`select delete_room_s($1,'086-R1')`, [qlv.token])) && /forbidden/.test(await err(`select delete_cinema_s($1,'099')`, [qlv.token])));
await q(`select delete_cinema_s($1,'099')`, [ql.token]);
ok("quản lý chuỗi xoá cơ sở chưa có vé", (await q(`select count(*)::int n from cinemas where id='099'`))[0].n === 0);
await q(`select create_user($1,'kt035','abc12345','Kỹ thuật 035','kythuat','035')`, [ql.token]);
ok("tạo tài khoản kỹ thuật gắn rạp; nhật ký quản trị ghi lại", (await q(`select role, cinema_id from app_users where username='kt035'`))[0].role === "kythuat" && (await q(`select count(*)::int n from audit_logs where type='admin'`))[0].n >= 8);
await q(`select reset_demo_s($1)`, [ql.token]);
ok("012 reset_demo: suất/vé/khoá/thẻ quà tặng/lượt mã về 0, điểm khách về 120, tài khoản kiểm thử bị xoá", (await q(`select (select count(*) from shows) + (select count(*) from tickets) + (select count(*) from seat_locks) + (select count(*) from vouchers where kind='gift') + (select count(*) from voucher_uses) as n`))[0].n == 0 && (await q(`select points from app_users where username='khach'`))[0].points === 120 && (await q(`select count(*)::int n from app_users where display_name='Khách Kiểm Thử'`))[0].n === 0);
// ---- 014: hồ sơ chính chủ
const own1 = await j(`select register('tu.khai','matkhau1','Nguyễn Tự Khai','tukhai@example.com','0988000111') j`);
ok("014 khai hồ sơ: ngày sinh / căn cước sai bị chặn", /bad_dob/.test(await err(`select register_citizen_s($1,'Nguyễn Tự Khai','2025-01-01','040099000111')`, [own1.token])) && /bad_id_number/.test(await err(`select register_citizen_s($1,'Nguyễn Tự Khai','1999-05-05','12345')`, [own1.token])));
const rc = await j(`select register_citizen_s($1,'Nguyễn Tự Khai','1999-05-05','040099000111') j`, [own1.token]);
ok("014 khai hồ sơ chính chủ → key u_<user>, chưa có ảnh gốc", rc.key === "u_tu.khai" && rc.has_template === false);
ok("014 căn cước trùng với người khác → id_taken", /id_taken/.test(await err(`select register_citizen_s($1,'X Y','1999-05-05','040099000111')`, [reg.token])));
const fc = await j(`select face_check('u_tu.khai', $1, 'dev1', 'tu.khai', 'ảnh', true) j`, [Array.from({ length: 128 }, (_, i) => Math.sin(i) / 7)]);
await q(`select link_vneid($1,'u_tu.khai','ảnh',$2)`, [own1.token, fc.id]);
ok("014 ghi ảnh gốc + liên kết → tài khoản có citizen_key u_tu.khai, ngày sinh theo khai báo", (await j(`select session_info($1) j`, [own1.token])).citizen_key === "u_tu.khai" && (await j(`select session_info($1) j`, [own1.token])).dob === "1999-05-05");
const lv = await j(`select login_vneid2('040099000111', $1, 'dev2') j`, [Array.from({ length: 128 }, (_, i) => Math.sin(i) / 7)]);
ok("014 đăng nhập VNeID bằng số căn cước + đúng khuôn mặt → phiên của tu.khai", lv.ok === true && lv.username === "tu.khai");
ok("014 đăng nhập VNeID với khuôn mặt khác → từ chối; căn cước lạ → vneid_not_linked", (await j(`select login_vneid2('040099000111', $1, 'dev2') j`, [Array.from({ length: 128 }, (_, i) => Math.cos(i * 3) / 2)])).ok === false && /vneid_not_linked/.test(await err(`select login_vneid2('000000000000', $1, 'dev2')`, [Array.from({ length: 128 }, () => 0.1)])));
ok("014 nhân viên tra hồ sơ khách theo căn cước / SĐT", (await j(`select citizen_lookup_s($1,'040099000111') j`, [nvv.token])).username === "tu.khai" && (await j(`select citizen_lookup_s($1,'0988000111') j`, [nvv.token])).key === "u_tu.khai");
ok("014 đổi ngày sinh → ảnh gốc bị xoá (phải chụp lại)", (await j(`select register_citizen_s($1,'Nguyễn Tự Khai','1998-05-05','040099000111') j`, [own1.token])).has_template === false);
// ---- 016: nhân sự, tài khoản, ca làm việc, chấm công, nghỉ phép, thưởng/phạt, hiệu suất
const pv = await j(`select login('phucvu','phucvu123') j`);
ok("016 vai trò phục vụ đăng nhập, gắn rạp 086", pv.role === "phucvu" && pv.cinema_id === "086");
await q(`select staff_save_s($1,'{"username":"nv.moi","pass":"abc12345","name":"Nguyễn Văn Mới","role":"nhanvien","cinema_id":"086","phone":"0911 222 333","email":"moi@example.com","dob":"2000-02-02","position":"Bán vé","hourly_rate":35000,"bonus_pct":1,"contract_type":"thử việc"}'::jsonb)`, [qlv.token]);
const sl = await q(`select * from staff_list_s($1,'moi')`, [qlv.token]);
ok("016 quản lý rạp thêm nhân viên có hồ sơ; tìm theo tên", sl.length === 1 && sl[0].username === "nv.moi" && sl[0].phone === "0911222333" && sl[0].position === "Bán vé" && Number(sl[0].hourly_rate) === 35000);
ok("016 quản lý rạp không thêm nhân viên rạp khác; sai SĐT bị chặn", /wrong_cinema/.test(await err(`select staff_save_s($1,'{"username":"nv.035","pass":"abc12345","name":"X Y","role":"nhanvien","cinema_id":"035"}'::jsonb)`, [qlv.token])) && /bad_phone/.test(await err(`select staff_save_s($1,'{"username":"nv.sdt","pass":"abc12345","name":"X Y","role":"nhanvien","cinema_id":"086","phone":"123"}'::jsonb)`, [qlv.token])));
await q(`select staff_save_s($1,'{"username":"nv.moi","name":"Nguyễn Văn Mới","role":"nhanvien","cinema_id":"086","active":false}'::jsonb)`, [qlv.token]);
ok("016 khoá tài khoản → không đăng nhập được, phiên cũ mất", /account_disabled/.test(await err(`select login('nv.moi','abc12345')`)));
await q(`select account_set_s($1,'nv.moi',true,'matkhaumoi')`, [ql.token]);
const nvm = await j(`select login('nv.moi','matkhaumoi') j`);
ok("016 mở khoá + đặt lại mật khẩu từ Quản lý tài khoản", nvm.username === "nv.moi");
ok("016 account_list_s tìm khách theo email; quản lý rạp không khoá khách", (await q(`select * from account_list_s($1,'minh.anh',null)`, [ql.token])).some(x => x.username === "minh.anh") && /wrong_cinema/.test(await err(`select account_set_s($1,'minh.anh',false)`, [qlv.token])));
const d0 = "2026-10-20";
const sh1 = (await q(`select shift_save_s($1, $2::jsonb) id`, [qlv.token, JSON.stringify({ cinema_id: "086", username: "nv.moi", start_at: d0 + "T01:00:00Z", end_at: d0 + "T06:00:00Z", kind: "sang", duty: "quay" })]))[0].id;
ok("016 phân ca sáng 08:00–13:00 (giờ VN) cho nhân viên rạp mình", sh1 > 0 && (await q(`select day, duty from shifts where id=$1`, [sh1]))[0].duty === "quay");
ok("016 ca trùng giờ → shift_overlap; nhân viên rạp khác → wrong_cinema", /shift_overlap/.test(await err(`select shift_save_s($1, $2::jsonb)`, [qlv.token, JSON.stringify({ cinema_id: "086", username: "nv.moi", start_at: d0 + "T05:00:00Z", end_at: d0 + "T09:00:00Z" })])) && /wrong_cinema/.test(await err(`select shift_save_s($1, $2::jsonb)`, [qlv.token, JSON.stringify({ cinema_id: "035", username: "nv.moi", start_at: d0 + "T10:00:00Z", end_at: d0 + "T12:00:00Z" })])));
await q(`select shift_confirm_s($1,$2,true)`, [nvm.token, sh1]);
ok("016 nhân viên xác nhận ca của mình; không xác nhận hộ người khác", (await q(`select status from shifts where id=$1`, [sh1]))[0].status === "confirmed" && /forbidden/.test(await err(`select shift_confirm_s($1,$2,true)`, [pv.token, sh1])));
const shNow = (await q(`select shift_save_s($1, $2::jsonb) id`, [qlv.token, JSON.stringify({ cinema_id: "086", username: "phucvu", start_at: new Date(Date.now() - 20 * 60000).toISOString(), end_at: new Date(Date.now() + 4 * 3600000).toISOString(), kind: "chieu", duty: "phucvu" })]))[0].id;
const att = await j(`select attend_s($1,$2,'in','face',null) j`, [pv.token, shNow]);
ok("016 chấm công vào ca đang diễn ra: ghi giờ vào, tính trễ ≈ 20 phút", att.check_in && att.late_min >= 19 && att.late_min <= 21, JSON.stringify(att));
ok("016 ra ca khi chưa vào → not_checked_in; vào ca của người khác → forbidden", /not_checked_in/.test(await err(`select attend_s($1,$2,'out')`, [nvm.token, sh1])) && /forbidden/.test(await err(`select attend_s($1,$2,'in')`, [nvm.token, shNow])));
ok("016 lịch ca: quản lý thấy cả rạp kèm chấm công; nhân viên chỉ thấy ca mình", (await q(`select * from shifts_list_s($1,'2026-10-01','2026-12-31',null)`, [qlv.token])).length >= 2 && (await q(`select * from shifts_list_s($1,'2026-10-01','2026-12-31',null)`, [nvm.token])).every(x => x.username === "nv.moi"));
const lvq = (await q(`select leave_request_s($1,'{"kind":"nghi","day_from":"2026-10-25","day_to":"2026-10-26","reason":"Việc gia đình"}'::jsonb) id`, [nvm.token]))[0].id;
await q(`select leave_decide_s($1,$2,'approved')`, [qlv.token, lvq]);
ok("016 nghỉ phép: nhân viên gửi, quản lý duyệt", (await q(`select status, decided_by from leaves where id=$1`, [lvq]))[0].status === "approved");
await q(`select staff_note_s($1,'{"username":"nv.moi","kind":"reward","amount":200000,"note":"Bán vé tốt"}'::jsonb)`, [qlv.token]);
await q(`select staff_note_s($1,'{"username":"nv.moi","kind":"violation","amount":50000,"note":"Đi trễ"}'::jsonb)`, [qlv.token]);
await q(`select add_show_s($1,'X7','f1','086-R1',now()+interval '20h',now()+interval '22h')`, [qlv.token]);
await q(`select hold_seat('X7','C1','HPOS',now()+interval '5 min')`);
await q(`select sell_order_u($1,'X7','HPOS','[{"code":"VPOS1","seat":"C1","price":70000,"channel":"Quầy"}]'::jsonb)`, [nvm.token]);
const stt = (await q(`select * from staff_stats_s($1,'2026-10-01','2026-12-31')`, [qlv.token])).find(x => x.username === "nv.moi");
ok("016 hiệu suất: vé quầy ghi người bán, thưởng/phạt, nghỉ phép đã duyệt, ca xác nhận", stt && stt.tickets === 1 && Number(stt.revenue) === 70000 && Number(stt.rewards) === 200000 && Number(stt.violations) === 50000 && stt.leaves_approved === 1 && stt.confirmed === 1, JSON.stringify(stt && { t: stt.tickets, r: stt.revenue, rw: stt.rewards, v: stt.violations, c: stt.confirmed }));
await q(`select account_update_s($1,'{"username":"abc.def","name":"Nguyễn Lên Chức","role":"nhanvien","cinema_id":"035","active":true}'::jsonb)`, [ql.token]);
ok("017 quản lý chuỗi nâng khách lên nhân viên rạp 035, đổi tên", (await q(`select role, cinema_id, display_name from app_users where username='abc.def'`))[0].role === "nhanvien" && (await q(`select cinema_id from app_users where username='abc.def'`))[0].cinema_id === "035");
ok("017 quản lý rạp 086 không sửa nhân viên rạp 035, không sửa khách; không tự hạ quyền", /wrong_cinema/.test(await err(`select account_update_s($1,'{"username":"abc.def","role":"khach"}'::jsonb)`, [qlv.token])) && /wrong_cinema/.test(await err(`select account_update_s($1,'{"username":"minh.anh","role":"khach"}'::jsonb)`, [qlv.token])) && /bad_input/.test(await err(`select account_update_s($1,'{"username":"quanly","role":"nhanvien","cinema_id":"086"}'::jsonb)`, [ql.token])));
await q(`select account_update_s($1,'{"username":"abc.def","role":"khach","pass":"matkhau9"}'::jsonb)`, [ql.token]);
ok("017 hạ về khách (bỏ rạp) + đặt lại mật khẩu → đăng nhập bằng mật khẩu mới", (await q(`select role, cinema_id from app_users where username='abc.def'`))[0].cinema_id === null && (await j(`select login('abc.def','matkhau9') j`)).role === "khach");
const rq = (await q(`select shift_request_s($1, $2::jsonb) id`, [pv.token, JSON.stringify({ start_at: new Date(Date.now() + 2 * 864e5).toISOString(), end_at: new Date(Date.now() + 2 * 864e5 + 5 * 3600000).toISOString(), kind: "sang", duty: "phucvu", note: "xin ca sáng" })]))[0].id;
ok("018 nhân viên tự đăng ký ca → trạng thái requested, gắn rạp của mình", (await q(`select status, cinema_id, created_by from shifts where id=$1`, [rq]))[0].status === "requested" && (await q(`select cinema_id from shifts where id=$1`, [rq]))[0].cinema_id === "086");
ok("018 đăng ký trùng giờ → shift_overlap; ca trong quá khứ → bad_input", /shift_overlap/.test(await err(`select shift_request_s($1, $2::jsonb)`, [pv.token, JSON.stringify({ start_at: new Date(Date.now() + 2 * 864e5 + 3600000).toISOString(), end_at: new Date(Date.now() + 2 * 864e5 + 3 * 3600000).toISOString() })])) && /bad_input/.test(await err(`select shift_request_s($1, $2::jsonb)`, [pv.token, JSON.stringify({ start_at: new Date(Date.now() - 5 * 3600000).toISOString(), end_at: new Date(Date.now() - 3600000).toISOString() })])));
await q(`select shift_approve_s($1,$2,true)`, [qlv.token, rq]);
ok("018 quản lý rạp duyệt ca đăng ký → confirmed; nhân viên không duyệt được", (await q(`select status from shifts where id=$1`, [rq]))[0].status === "confirmed" && /forbidden/.test(await err(`select shift_approve_s($1,$2,true)`, [pv.token, rq])));
// ---- 019: khoá chính số, mã nghiệp vụ UNIQUE, khoá ngoại
const pkOf = async t => (await q(`select string_agg(a.attname, ',' order by a.attnum) k from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey) where c.conrelid = ('public.' || $1)::regclass and c.contype = 'p'`, [t]))[0].k;
ok("019 PK số (id) cho app_users, tickets, vouchers, groups, group_members, mock_citizens, seat_locks, voucher_uses, cinema_films", (await Promise.all(["app_users", "tickets", "vouchers", "groups", "group_members", "mock_citizens", "seat_locks", "voucher_uses", "cinema_films"].map(pkOf))).every(k => k === "id"));
ok("019 mã nghiệp vụ vẫn duy nhất: trùng tên đăng nhập / mã vé bị chặn, giữ ghế trùng vẫn trả false", /username_taken/.test(await err(`select register('khach','x12345678','Trùng Tên')`)) && (await q(`select hold_seat('X7','C1','H-ANOTHER',now()+interval '5 min') r`))[0].r === false);
ok("019 khoá ngoại: vé của tài khoản không tồn tại bị chặn; xoá tài khoản → ca làm việc đi theo", /violates foreign key/.test(await err(`insert into tickets (code, show_id, seat, owner_user) values ('VFK1','X7','D1','khong.co.user')`)) && (await q(`select count(*)::int n from shifts where username='nv.moi'`))[0].n > 0 && (await q(`delete from app_users where username='nv.moi' returning 1`)).length === 1 && (await q(`select count(*)::int n from shifts where username='nv.moi'`))[0].n === 0);
// ---- 020: kho phim demo CGV
ok("020 nạp 60 phim CGV (27 đang chiếu, 33 sắp chiếu) kèm ngày khởi chiếu, tóm tắt; chạy lại không nhân đôi", (await q(`select count(*)::int n, count(*) filter (where status='soon')::int s, count(*) filter (where synopsis is not null)::int d from films where source='cgv'`))[0].n === 60 && (await q(`select count(*) filter (where status='soon')::int s from films where source='cgv'`))[0].s === 33);
// phân phối cho cơ sở: lúc chạy migration chưa có rạp (rạp do ensure_cinemas gieo khi mở web) → ensure_films lo phân phối khi khởi động
// ---- 021: mua vé không cần tài khoản: OTP (demo / Supabase Auth), chặn email dùng một lần, mail vé qua Edge Function, tra cứu, nâng cấp
ok("021 otp_mode mặc định demo", (await q(`select otp_mode() m`))[0].m === "demo");
ok("021 email dùng một lần bị chặn (kể cả tên miền con)", /email_disposable/.test(await err(`select guest_email_check('ai@10minutemail.com','Lan',null)`)) && /email_disposable/.test(await err(`select guest_email_check('ai@x.yopmail.com','Lan',null)`)));
ok("021 email sai / thiếu tên bị chặn", /bad_email/.test(await err(`select guest_email_check('abc','Lan',null)`)) && /bad_name/.test(await err(`select guest_email_check('x@y.vn','L',null)`)));
ok("021 email đã có tài khoản thật → email_registered (mời đăng nhập)", /email_registered/.test(await err(`select guest_email_check('minh.anh@example.com','Ai Đó',null)`)));
const o1 = await j(`select guest_email_check(' Lan.Vang@Example.com ','Lan Vãng Lai','0987 654 321') j`);
ok("021 demo: trả mã 6 số, hết hạn 10 phút", o1.email === "lan.vang@example.com" && o1.mode === "demo" && /^\d{6}$/.test(o1.demo_code) && (new Date(o1.expires_at) - Date.now()) < 10.1 * 60e3, JSON.stringify(o1));
ok("021 mã lưu băm bcrypt, không lưu mã thô", (await q(`select code_hash from email_otps where email='lan.vang@example.com' order by id desc limit 1`))[0].code_hash.startsWith("$2"));
const wrong = await j(`select guest_verify('lan.vang@example.com','000000') j`);
ok("021 sai mã → ok=false otp_wrong, còn 4 lần, lần thử được ghi", wrong.ok === false && wrong.error === "otp_wrong" && wrong.attempts_left === 4 && (await q(`select attempts from email_otps where email='lan.vang@example.com' order by id desc limit 1`))[0].attempts === 1);
const g1 = await j(`select guest_verify('LAN.VANG@example.com', $1) j`, [o1.demo_code.slice(0, 3) + " " + o1.demo_code.slice(3)]);
ok("021 đúng mã (có khoảng trắng) → tài khoản khách g_<băm>, guest=true, 0 điểm, SĐT, phiên 2 giờ", /^g_[0-9a-f]{12}$/.test(g1.username) && g1.guest === true && g1.points === 0 && g1.phone === "0987654321" && g1.name === "Lan Vãng Lai" && (new Date(g1.expires_at) - Date.now()) < 2.1 * 3600e3, JSON.stringify({ u: g1.username }));
ok("021 mã đã dùng không dùng lại được", /otp_missing/.test(await err(`select guest_verify('lan.vang@example.com', $1)`, [o1.demo_code])));
const o2 = await j(`select guest_email_check('lan.vang@example.com','Lan Mới',null) j`); const g2 = await j(`select guest_verify('lan.vang@example.com', $1) j`, [o2.demo_code]);
ok("021 cùng email lần sau → cùng tài khoản khách, cập nhật tên, phiên mới", g2.username === g1.username && g2.name === "Lan Mới" && g2.token !== g1.token);
await q(`select guest_email_check('lan.vang@example.com','Lan',null)`);
ok("021 quá 3 yêu cầu / 10 phút → too_many_requests", /too_many_requests/.test(await err(`select guest_email_check('lan.vang@example.com','Lan',null)`)));
// chế độ auth: Supabase Auth gửi mã; web verifyOtp xong gọi guest_verify_auth() với JWT (giả lập claims)
await q(`update app_config set v='auth' where k='otp_mode'`);
const oa = await j(`select guest_email_check('hoa.auth@example.com','Hoa Auth','0911222333') j`);
ok("021 auth: bước 1 không trả mã, chỉ ghi tên/SĐT chờ", oa.mode === "auth" && oa.demo_code === undefined && (await q(`select code_hash, name from email_otps where email='hoa.auth@example.com' order by id desc limit 1`))[0].code_hash === "");
ok("021 auth: không có JWT → not_logged_in", /not_logged_in/.test(await err(`select guest_verify_auth()`)));
ok("021 auth: JWT role anon → not_logged_in", /not_logged_in/.test(await err(`select set_config('request.jwt.claims', '{"role":"anon","email":"hoa.auth@example.com"}', true), guest_verify_auth()`)));
const ga = (await q(`select set_config('request.jwt.claims', '{"role":"authenticated","email":"Hoa.Auth@example.com"}', true) s, guest_verify_auth() j`))[0].j;
ok("021 auth: JWT authenticated có email → tài khoản khách với tên/SĐT đã khai, phiên 2 giờ", /^g_/.test(ga.username) && ga.guest === true && ga.name === "Hoa Auth" && ga.phone === "0911222333" && ga.email === "hoa.auth@example.com");
ok("021 auth: email trong JWT thuộc danh sách chặn → email_disposable", /email_disposable/.test(await err(`select set_config('request.jwt.claims', '{"role":"authenticated","email":"x@mailinator.com"}', true), guest_verify_auth()`)));
ok("021 auth: email đã có tài khoản thật trong JWT → email_registered", /email_registered/.test(await err(`select set_config('request.jwt.claims', '{"role":"authenticated","email":"minh.anh@example.com"}', true), guest_verify_auth()`)));
await q(`select set_config('request.jwt.claims', null, true)`); await q(`update app_config set v='demo' where k='otp_mode'`);
// thanh toán + mail vé
await q(`select add_show_s($1,'SG1','f1','086-R1',now()+interval '6h',now()+interval '8h')`, [ql.token]);
await q(`select hold_seat('SG1','C1','HG1',now()+interval '5 min')`); await q(`select hold_seat('SG1','C2','HG1',now()+interval '5 min')`);
const gpay = await j(`select sell_order_u($1,'SG1','HG1','[{"code":"VG1","order_id":"HG1","seat":"C1","price":85000,"channel":"Online","viewer_name":"Lan Mới"},{"code":"VG2","order_id":"HG1","seat":"C2","price":85000,"channel":"Online"}]'::jsonb,null,50) j`, [g2.token]);
ok("021 khách vãng lai thanh toán: không dùng/tích điểm, trả đủ, mailed_to = email", gpay.points_used === 0 && gpay.points_earned === 0 && Number(gpay.paid) === 170000 && gpay.mailed_to === "lan.vang@example.com", JSON.stringify(gpay));
ok("021 vé thuộc tài khoản khách", (await q(`select count(*)::int n from tickets where owner_user=$1 and order_id='HG1'`, [g2.username]))[0].n === 2);
const mb = await q(`select * from mail_outbox where username=$1 and kind='ticket'`, [g2.username]);
ok("021 mail vé xếp vào outbox pending: đủ ghế, mã vé, tổng tiền, link tra cứu", mb.length === 1 && mb[0].status === "pending" && mb[0].to_email === "lan.vang@example.com" && /C1/.test(mb[0].html) && /VG2/.test(mb[0].html) && /170\.000/.test(mb[0].html) && /#\/tracuu\?ma=HG1/.test(mb[0].html) && /^Vé CineVin/.test(mb[0].subject), mb[0] && mb[0].subject);
const tk = await q(`select * from mail_take($1, 'HG1')`, [g2.token]);
ok("021 Edge Function mail_take: lấy mail của chủ phiên, đánh dấu queued; lấy lần 2 rỗng", tk.length === 1 && tk[0].to_email === "lan.vang@example.com" && tk[0].html.includes("<table") && (await q(`select status from mail_outbox where id=$1`, [tk[0].id]))[0].status === "queued" && (await q(`select count(*)::int n from mail_take($1, 'HG1')`, [g2.token]))[0].n === 0);
ok("021 mail_mark cần service_role: anon/authenticated bị forbidden", /forbidden/.test(await err(`select set_config('request.jwt.claims', '{"role":"authenticated"}', true), mail_mark($1, true, null)`, [tk[0].id])));
await q(`select set_config('request.jwt.claims', '{"role":"service_role"}', true), mail_mark($1, false, 'SMTP 535 auth failed')`, [tk[0].id]);
ok("021 mail_mark gửi lỗi → failed + lý do; mail_take lấy lại được để thử lần nữa", (await q(`select status, error from mail_outbox where id=$1`, [tk[0].id]))[0].error === "SMTP 535 auth failed" && (await q(`select count(*)::int n from mail_take($1, null)`, [g2.token]))[0].n === 1);
await q(`select set_config('request.jwt.claims', '{"role":"service_role"}', true), mail_mark($1, true, null)`, [tk[0].id]);
ok("021 mail_mark gửi thành công → sent, có sent_at", (await q(`select status, sent_at from mail_outbox where id=$1`, [tk[0].id]))[0].status === "sent");
await q(`select set_config('request.jwt.claims', null, true)`);
ok("021 anon không gọi được mail_take / mail_mark", !(await q(`select has_function_privilege('anon','public.mail_take(uuid,text)','execute') p`))[0].p && !(await q(`select has_function_privilege('anon','public.mail_mark(bigint,boolean,text)','execute') p`))[0].p && (await q(`select has_function_privilege('service_role','public.mail_take(uuid,text)','execute') p`))[0].p);
const mm = await q(`select * from my_mails($1, null)`, [g2.token]);
ok("021 my_mails trả mail vé của tôi kèm trạng thái sent", mm.length === 1 && mm[0].ref === "HG1" && mm[0].status === "sent" && mm[0].html.includes("<table"));
ok("021 khach chưa có email → không có mail", (await q(`select count(*)::int n from mail_outbox where username='khach'`))[0].n === 0);
const lk = await j(`select lookup_order('vg1','LAN.VANG@example.com') j`);
ok("021 tra cứu bằng mã vé + email → phiên khách mới, biết mã đơn", lk.username === g2.username && lk.order === "HG1" && lk.ticket === "VG1" && lk.token !== g2.token);
ok("021 tra cứu bằng mã đơn cũng được", (await j(`select lookup_order('HG1','lan.vang@example.com') j`)).order === "HG1");
ok("021 sai email → unknown_ticket (không lộ vé người khác)", /unknown_ticket/.test(await err(`select lookup_order('VG1','khac@example.com')`)));
ok("021 vé của tài khoản thật → use_login", /use_login/.test(await err(`select lookup_order('VT01','minh.anh@example.com')`)) || /unknown_ticket/.test(await err(`select lookup_order('VT01','x@y.z')`)));
ok("021 QR vé lấy được bằng phiên tra cứu", /^CV1\.VG1\./.test((await j(`select ticket_qr($1,'VG1') j`, [lk.token])).payload));
const up = await j(`select register('lanvang','matkhau1','Lan Vãng Lai','lan.vang@example.com','0987654321') j`);
ok("021 đăng ký bằng email đã mua vãng lai → tài khoản thật, vé chuyển sang, tài khoản khách bị xoá, 120 điểm", up.username === "lanvang" && up.guest === false && up.points === 120 && (await q(`select count(*)::int n from tickets where owner_user='lanvang' and order_id='HG1'`))[0].n === 2 && (await q(`select count(*)::int n from app_users where username=$1`, [g2.username]))[0].n === 0 && (await q(`select count(*)::int n from mail_outbox where username='lanvang'`))[0].n === 1);
ok("021 tên đăng nhập dạng g_… và email dùng một lần bị cấm khi đăng ký", /bad_username/.test(await err(`select register('g_abcdef123456','matkhau1','X Y',null,null)`)) && /email_disposable/.test(await err(`select register('tamthoi','matkhau1','X Y','a@mailinator.com',null)`)));
await q(`select hold_seat('SG1','C3','HG2',now()+interval '5 min')`);
const pay3 = await j(`select sell_order_u($1,'SG1','HG2','[{"code":"VG3","order_id":"HG2","seat":"C3","price":85000,"channel":"Online"}]'::jsonb,null,0) j`, [up.token]);
ok("021 tài khoản thật có email: thanh toán tích điểm và có mail vé", pay3.points_earned === 4 && pay3.mailed_to === "lan.vang@example.com" && (await q(`select count(*)::int n from mail_outbox where username='lanvang'`))[0].n === 2);
await q(`select blocklist_set_s($1,'Spam-Tam.Xyz',true)`, [ql.token]);
ok("021 quản lý thêm tên miền chặn → có hiệu lực; bỏ → hết chặn", /email_disposable/.test(await err(`select guest_email_check('a@spam-tam.xyz','Ai',null)`)) && (await q(`select blocklist_set_s($1,'spam-tam.xyz',false)`, [ql.token]), !/email_disposable/.test(await err(`select guest_email_check('a@spam-tam.xyz','Ai',null)`) || "")));
ok("021 anon không gọi được _email_check / _mail_order / _guest_session", !(await q(`select has_function_privilege('anon','public._email_check(text)','execute') p`))[0].p && !(await q(`select has_function_privilege('anon','public._mail_order(text,text)','execute') p`))[0].p && !(await q(`select has_function_privilege('anon','public._guest_session(text,text,text)','execute') p`))[0].p);
ok("huỷ liên kết VNeID", (await j(`select unlink_vneid($1) j`, [kh.token])).citizen_key === null);
ok("anon không gọi được _find_user", !(await q(`select has_function_privilege('anon','public._find_user(text)','execute') p`))[0].p);
console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
