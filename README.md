# CineVin – bán vé xem phim, xác thực tuổi bằng VNeID + FaceID

Demo đồ án PTTKHTTT – Nhóm 05, ĐH Vinh. Đề tài 20: lịch chiếu, chọn ghế, thanh toán, quản lý suất chiếu.

**Bài toán:** rạp bị phạt 60–80 triệu đồng nếu để người xem sai độ tuổi, nhưng hiện chỉ kiểm tra giấy tờ bằng mắt ở cửa; trẻ em thường chưa có căn cước; đoàn 1 giáo viên – 50 học sinh thì không thể kiểm tra từng em; vé điện tử chụp màn hình là gửi cho người khác dùng được.

**Giải pháp:**
- Xác thực **một lần** bằng VNeID + khuôn mặt → hệ thống biết ngày sinh thật, tự áp giá theo tuổi và **chặn ngay khi bán** vé T13/T16/T18.
- Trẻ chưa có căn cước → **hồ sơ người phụ thuộc** của cha mẹ đã xác thực.
- Vé đoàn → chỉ xác thực sinh trắc **giáo viên**, kiểm tra tuổi **theo danh sách**, một QR cho cả đoàn; phim P chỉ đếm người, phim từ T13 quét thẻ QR từng em + kiểm tra ngẫu nhiên.
- **QR vé đổi mỗi 15 giây**, máy chủ ký HMAC; máy soát chỉ nhận mã chưa quá 30 giây → ảnh chụp màn hình bị từ chối.

## Sơ đồ nghiệp vụ
![Sơ đồ nghiệp vụ CineVin](docs/nghiep-vu.png)

Bản HTML để sửa: `docs/nghiep-vu.html` → xuất lại ảnh bằng `node tools/render-png.mjs docs/nghiep-vu.html docs/nghiep-vu.png`.

## Trang chủ công khai (khách vãng lai)
Vào `/` không cần đăng nhập, giống trang chủ cgv.vn: **coverflow 3D** phim nổi bật (poster giữa nét, hai bên xoay phối cảnh, thẻ xa mờ + blur, nền tối phát sáng đỏ; tự xoay 4,5 giây, kéo/vuốt, phím mũi tên, bấm thẻ giữa → chi tiết), **đặt vé nhanh** (rạp → phim → ngày → suất) trên nền glass, tab **Đang chiếu / Sắp chiếu** (phim sắp chiếu có ngày khởi chiếu, nút Nhắc tôi), ưu đãi & tiện ích, "ba bước là có vé", footer có địa chỉ rạp. Popup khuyến mại hiện một lần mỗi phiên (đóng khi chuyển trang). Trang **chi tiết phim** (`#/chitiet`) có mô tả, lịch 10 ngày theo từng cơ sở. Khách vãng lai xem được lịch chiếu; bấm suất → đăng nhập → vào thẳng chọn ghế của suất đó. Lịch mẫu sinh **10 ngày** (trước là 3). SEO: title/description/OG/JSON-LD MovieTheater trong `index.html`, `<h1>` và heading theo mục. Chụp lại màn: `node tools/shots-home.mjs`. Trước khi commit đổi JS/CSS chạy `node tools/bump-version.mjs` (đổi `?v=` trong `index.html`, tránh trình duyệt dùng bản cũ).

## Phòng chiếu 3D khi chọn ghế (three.js)
Trang chọn ghế có hai chế độ **Sơ đồ 2D | Phòng 3D** (`js/seat3d.js`; three.js + RoundedBoxGeometry + mergeGeometries nạp bằng importmap trong `index.html`, không build). Nghiệp vụ và hình học theo các rạp ảo (đo bằng REA trên cinemaplay.live): phòng dựng từ chính sơ đồ phòng (hàng × ghế, lối đi giữa, bước ghế 0,58 m, bước hàng 1 m, bậc 0,25 m, hàng cong, ghế xoay về tâm); ghế có đệm – lưng – tựa đầu – tay vịn – chân; thảm, bậc, tường sọc, sân khấu, rèm, loa, đèn hông, đèn lối đi; màn hình 1,85:1 chiếu poster phim (giữ tỷ lệ trên nền mờ). **Ghế đã bán có người ngồi** (thân, chân, đầu, tóc, tay; màu áo/da/tóc ổn định theo mã ghế). **Từ ghế**: máy quay ở mắt người ngồi (1,18 m), kéo để nhìn quanh, bấm đúp nhìn thẳng. **Đứng dậy**: nhân vật đứng tại ghế, máy quay phía sau trên cao, kéo xoay – lăn chuột lùi/tiến – bấm ghế để chọn/bỏ. Mỗi ghế có **bộ số đo** từ vị trí mắt tới tâm và 4 cạnh màn hình: khoảng cách, góc ngang, góc dọc, độ rộng màn hình trong tầm nhìn (mục tiêu 40°), immersion (% của 120°), **điểm hình học 0–100** theo 4 ưu tiên (Cân bằng / Đắm chìm / Thoải mái / Chính giữa, trọng số fov–góc–dọc–giữa); xếp loại ≥0,78 rất tốt · ≥0,55 tốt · còn lại kém; kèm ưu/nhược điểm. Sơ đồ 2D chấm màu mức góc nhìn trên ghế trống; **Chọn ghế tốt nhất** lấy ghế trống điểm cao nhất (nhóm ghế đôi phải trống). Ở 2D, khung "Góc nhìn từ ghế" nằm dưới "Đơn của bạn" (điện thoại: dưới sơ đồ). Không có WebGL thì báo và vẫn chọn ghế 2D. Kiểm thử: `node tools/e2e-seat3d.mjs` (Edge headless + SwiftShader).

**Vào rạp** (nút "Vào rạp · <ghế>", như Enter theatre của rạp ảo): phòng 3D phủ kín màn hình (nút toàn màn hình; điện thoại cố khoá xoay ngang), ba chế độ **Từ ghế / Đứng dậy / Đi lại**. Đi lại theo đúng cơ chế đã đo: W A S D hoặc mũi tên, Shift chạy (2,4 / 4,4 m/s), kéo chuột để nhìn (nhạy 0,0032 rad/px, ngước ±43°), ngôi thứ nhất (mắt 1,55 m, lắc nhẹ khi đi) / thứ ba (máy quay sau 2,4 m, phím V), đi trong giới hạn phòng, độ cao theo bậc hàng, tới gần ghế trống hoặc ghế đang chọn trong 1,35 m thì có vòng sáng + "Ngồi xuống (E)" → giữ ghế và về góc nhìn từ ghế; Esc thoát. Điện thoại: joystick cảm ứng bên trái, vuốt để nhìn, nút đổi ngôi nhìn và nút chạy bên phải; xoay dọc / ngang đều tự co giãn (ResizeObserver), thanh điều khiển gọn khi màn thấp. Kiểm thử: `node tools/e2e-theatre.mjs` (PC phím + điện thoại dọc / ngang, 11 bước).

## Mua vé không cần tài khoản (migration 021)
Khách vãng lai bấm suất → **vào thẳng sơ đồ ghế** (giữ ghế không cần đăng nhập) → ở trang thanh toán nhập **email + họ tên** (SĐT tuỳ chọn) → máy chủ kiểm email (`guest_email_check`: định dạng, **chặn email dùng một lần** theo bảng `email_blocklist` ~150 tên miền kể cả tên miền con, email đã có tài khoản thật thì mời đăng nhập, tối đa 3 yêu cầu/10 phút) → **Supabase Auth gửi mã 6 số** (`signInWithOtp`) → nhập mã (`verifyOtp`) → `guest_verify_auth()` đọc email đã xác minh trong JWT → tài khoản khách ẩn (`g_<băm email>`, `guest = true`, 0 điểm) + phiên 2 giờ → nút Thanh toán hiện ra. Thanh toán xong, khách có email nhận **mail vé** (phim, rạp, phòng, ghế, giờ, mã vé, nút mở QR) do Edge Function `send-mail` gửi qua **SMTP Gmail của bạn** (không dùng dịch vụ mail bên thứ ba; mật khẩu nằm trong secret của Supabase). Chưa cấu hình → chế độ demo: mã xác nhận hiện ngay trên trang, mail vé nằm `pending` và xem được bằng "Xem email" (có nút Gửi lại). **Tra cứu vé** (`#/tracuu`, link trong mail `#/tracuu?ma=<mã đơn>`): mã vé / mã đơn + email → phiên khách mới 2 giờ → QR, mua thêm, hoàn vé. Đăng nhập giữa chừng thì ghế đang giữ vẫn còn. Tạo tài khoản bằng đúng email → vé đã mua chuyển sang tài khoản mới. Kiểm thử: `node tools/e2e-guest.mjs` (chạy ở chế độ demo).

**Bật gửi mail thật bằng Supabase + Gmail (làm một lần, ~10 phút):**
1. Google: Tài khoản → Bảo mật → bật *Xác minh 2 bước* → *Mật khẩu ứng dụng* → tạo một mật khẩu 16 ký tự (dùng cho cả hai bước dưới).
2. Supabase → **Authentication → Emails → tab SMTP Settings** → Enable Custom SMTP: Sender email = Gmail của bạn, Sender name = CineVin, Host `smtp.gmail.com`, Port `465`, Username = Gmail, Password = mật khẩu ứng dụng. (Mặc định Supabase chỉ gửi tới email thành viên dự án, 2 mail/giờ – khai SMTP mới gửi được cho khách bất kỳ.) *Authentication → Rate Limits* nâng "emails sent" nếu cần.
3. **Authentication → Emails → tab Templates**: sửa CẢ HAI mẫu **Magic Link** và **Confirm signup** (email lần đầu dùng nhận mẫu Confirm signup; hoặc tắt "Confirm email" ở Sign In / Providers → Email để luôn dùng Magic Link). Nội dung: thay nội dung bằng `<h2>Mã xác nhận CineVin</h2><p style="font-size:32px;letter-spacing:8px;font-family:monospace"><b>{{ .Token }}</b></p><p>Mã có hiệu lực 10 phút. Không đặt vé tại CineVin thì bỏ qua email này.</p>` (không có `{{ .Token }}` thì mail chỉ có link; web vẫn chấp nhận: khách bấm link → về web kèm token → tự xác nhận và quay lại thanh toán). Subject: `Mã xác nhận CineVin`.
4. **Edge Functions → Deploy a new function → Via Editor**: tên `send-mail`, dán `supabase/functions/send-mail/index.ts`, Deploy. Rồi **Edge Functions → Secrets**: `SMTP_USER` = Gmail, `SMTP_PASS` = mật khẩu ứng dụng, `MAIL_FROM` = `CineVin <gmail của bạn>` (tuỳ chọn).
5. SQL Editor: `update app_config set v = 'auth' where k = 'otp_mode';` (về demo: `'demo'`). Theo dõi: `select to_email, status, error, created_at from mail_outbox order by id desc;`

## Đăng nhập & phân quyền
| Tài khoản demo | Mật khẩu | Vai trò | Vào được |
|---|---|---|---|
| `khach` | `khach123` | Khách hàng | Lịch chiếu, chọn ghế, thanh toán, vé của tôi, vé đoàn, tài khoản |
| `giaovien` | `giaovien123` | Khách hàng | như trên (dùng để thử vé đoàn) |
| `nhanvien` | `nhanvien123` | Nhân viên · rạp 086 Vinh Centre | Soát vé, bán tại quầy (chỉ suất của rạp mình) |
| `kythuat` | `kythuat123` | Kỹ thuật · 086 Vinh Centre | Phòng chiếu: kích thước, loại phòng, ghế bảo trì, tạm ngưng phòng (chỉ rạp mình) |
| `phucvu` | `phucvu123` | Phục vụ · 086 Vinh Centre | Ca của tôi: nhận ca, chấm công, xin nghỉ |
| `quanlyvinh` | `quanlyvinh123` | Quản lý rạp · 086 Vinh Centre | Tổng quan, suất chiếu, quầy, soát vé, tạo nhân viên **cho rạp mình** |
| `quanly` | `quanly123` | Quản lý chuỗi | Mọi rạp: bảng toàn chuỗi theo tỉnh → rạp, đổi rạp đang thao tác, tạo tài khoản cho rạp bất kỳ |

Mật khẩu băm bcrypt trên máy chủ; mỗi hàm nhạy cảm nhận token phiên và **tự kiểm vai trò ở máy chủ** (khách gọi thẳng API thêm suất → `forbidden`). Khách tự đăng ký được; tài khoản nhân viên do quản lý tạo.

## Chuỗi nhiều rạp (migration 006)
Mô hình **Tỉnh/Thành → Rạp (mã 3 số) → Phòng → Suất**, 7 rạp ở 4 tỉnh/thành; Nghệ An có **2 cơ sở cùng TP Vinh** (086 Vinh Centre, 087 Hưng Dũng) để thử tình huống "một nơi nhiều cơ sở".

| Việc | Cách làm |
|---|---|
| Khách chọn rạp | Nút rạp trên đầu trang: Tỉnh/Thành → rạp (địa chỉ, số phòng, giá từ). Nhớ trên thiết bị. Lịch xem **theo rạp** (ngày → phim → suất theo định dạng 2D/3D/GOLD) hoặc **theo phim** (phim → ngày → tỉnh → từng rạp → suất) |
| Giá vé theo rạp | Hạng A (Hà Nội, TP.HCM) / hạng B (tỉnh); ngày thường · thứ Tư · cuối tuần × người lớn / U22 / trẻ em / người cao tuổi; phụ thu ghế VIP, 3D, phòng GOLD. Giá tính ở `seatPrice(suất, ghế, đối tượng)`; đối tượng lấy từ tuổi **đã xác thực VNeID** nên bán được vé U22/trẻ em/cao tuổi online |
| Mã suất, mã phòng | `YYYYMMDD-<rạp>-n`, phòng `<rạp>-R1` → mọi suất, vé, QR đều mang mã rạp; máy chủ chưa chạy 006 vẫn suy ra rạp từ mã phòng |
| Nhân viên gắn rạp | `app_users.cinema_id`; soát vé / quầy / thêm suất ở rạp khác → máy chủ trả `wrong_cinema`; màn soát vé báo "Vé của rạp khác" kèm tên rạp đúng |
| Quản lý chuỗi | `cinema_id = null`: tổng quan toàn chuỗi (suất, ghế bán, lấp đầy, doanh thu theo tỉnh → rạp), ô đổi rạp đang thao tác trên thanh tiêu đề; `chain_stats(ngày)` tính ở máy chủ |

## Quản trị chuỗi (migration 008)
| Việc | Cách làm |
|---|---|
| Cơ sở | **Cơ sở & phòng**: thêm/sửa/xoá cơ sở (mã 3 số, địa chỉ, hotline, hạng giá, tạm ngưng). Quản lý rạp chỉ sửa rạp mình; xoá chỉ khi chưa bán vé |
| Phòng chiếu | Thêm/sửa/xoá phòng: số hàng × ghế, loại 2D / 3D / GOLD / IMAX (phụ thu theo loại), **tạm ngưng phòng** (không xếp suất). Không thu nhỏ phòng dưới ghế đã bán. Kỹ thuật và quản lý làm được |
| Sơ đồ ghế (009) | Trong hộp sửa phòng là **sơ đồ ghế giống màn khách chọn ghế**: chọn một loại ghế làm công cụ rồi bấm ghế, hoặc bấm chữ hàng để áp cả hàng. Ghế bảo trì: khách bấm vào báo "đang bảo trì – không chọn được" |
| Loại ghế tự định nghĩa (011, 013) | Thẻ **Loại ghế** (quản lý chuỗi): tạo loại mới – tên, **số người ngồi** (ghế đôi 2, ghế 3, sofa 4…), cách tính giá: **phụ thu hạng A / B** cộng vào giá cơ bản, hoặc **giá cứng** A / B (giá cố định cho mỗi ghế; ghế đôi = giá cứng × 2), màu, biểu tượng, bán hay không bán. Ghế nhiều chỗ **chiếm n ghế liền trong hàng**: trên sơ đồ là một nút rộng (A1–A2), khách bấm một lần lấy cả n ghế vào đơn; giá nhóm = giá cơ bản × n + phụ thu |
| Ghế bảo trì (012) | Máy chủ từ chối giữ/bán ghế không bán (`hold_seat` → false); không đánh dấu bảo trì ghế đã bán / đang giữ cho suất sắp chiếu (báo rõ ghế nào – hoàn/đổi vé trước). Lịch mẫu không còn gieo ghế "đã bán": mọi số liệu đi từ 0 và chỉ đến từ giao dịch thật |
| Hạng giá A / B (015) | Nút **Hạng A (Thành phố)** / **Hạng B (Cơ bản)** trong thẻ Loại ghế: quản lý chuỗi sửa giá ghế thường của từng hạng (ví dụ hạng A người lớn ngày thường 115.000 → 150.000); mọi cơ sở thuộc hạng đó áp theo, trừ cơ sở có bảng giá riêng |
| Bảng giá riêng (011) | Nút **Bảng giá** trên mỗi cơ sở: 3 loại ngày × 4 đối tượng + phụ thu 3D / GOLD / IMAX / lễ; trống = dùng bảng hạng A/B |
| Kho phim | **Kho phim** dùng chung: thêm/sửa phim (nhãn tuổi, thời lượng, poster), ngừng chiếu. **Phân phối phim → cơ sở** bằng ma trận; phim chưa phân phối không xếp suất được ở rạp đó (`film_not_at_cinema`) |
| Suất chiếu | Bấm vào suất trên lưới: ghế bán, vé qua hệ thống, **đổi ngày/giờ/phòng** (đã bán vé thì chỉ đổi giờ – máy chủ kiểm trùng), **huỷ suất** kèm lý do → mọi vé còn hiệu lực hoàn vào thẻ quà tặng của từng khách, ghế nhả, suất ẩn khỏi lịch khách |
| Tra cứu ghế (010) | Trong hộp suất (hôm qua / hôm nay / ngày mai) và ở quầy có **sơ đồ ghế**: bấm ghế đã bán / đang giữ → máy chủ trả **dữ liệu thật**: mã vé, đơn (mấy vé cùng chủ), người mua (tài khoản, SĐT/email che bớt, đã xác thực VNeID), người xem, kiểm tuổi, giá, kênh, giờ mua, giờ vào phòng, vé đoàn, lịch sử hoàn. Chỉ nhân viên/quản lý của đúng rạp; kỹ thuật không xem được |
| Báo cáo | **Báo cáo & phân tích**: doanh thu/ghế bán/lấp đầy theo phim, giờ cao điểm, ghế VIP so ghế thường, suất đông nhất, theo kênh, theo cơ sở; lọc toàn chuỗi / rạp, hôm nay / ngày mai |
| Nhật ký | `audit_logs` ghi **đăng nhập** và **thao tác quản trị** (cơ sở, phòng, phim, suất, tài khoản) ở máy chủ; xem và lọc trong Báo cáo |

## Nhân sự (migration 016)
| Việc | Cách làm |
|---|---|
| Nhân viên | Trang **Nhân sự → Nhân viên**: hồ sơ (họ tên, ngày sinh, SĐT, email), chức vụ, phòng ban, cơ sở, vai trò (bán vé / kỹ thuật / **phục vụ** / quản lý), hợp đồng (loại, ngày vào, hạn), lương cứng, lương giờ, % thưởng doanh thu quầy, bảo hiểm; tạo tài khoản kèm mật khẩu, đặt lại mật khẩu, khoá (tài khoản bị khoá bị đăng xuất và mọi hàm máy chủ từ chối). Ô tìm kiếm theo tên / tài khoản / SĐT / email / chức vụ. Quản lý cơ sở chỉ thấy rạp mình |
| Bảng ca | **Bảng ca** theo **Ngày** (dòng nhân viên × trục giờ, như board trực ca), **Tuần**, **Tháng**; bấm chỗ trống để thêm ca, bấm ca để sửa / xoá; vị trí Quầy / Soát vé / Kỹ thuật / Phục vụ / Quản lý ca; lặp cả tuần; máy chủ chặn ca trùng giờ. Nét đứt = chờ nhân viên xác nhận |
| Ca của tôi | Nhân viên (mọi vai trò) vào **Ca của tôi**: nhận / từ chối ca, **vào ca bằng FaceID** (đối chiếu khuôn mặt đã liên kết, có bản ghi) hoặc thủ công, ra ca; xin nghỉ phép / đăng ký tăng ca |
| Chấm công | Tab **Chấm công & nghỉ phép**: vào / ra, đi trễ (phút), vắng; quản lý chấm hộ; duyệt / từ chối nghỉ phép, tăng ca; mọi lần chấm ghi `audit_logs` |
| Hiệu suất & lương | Theo tháng: ca xác nhận, giờ chấm công, trễ, vắng, **vé bán tại quầy theo nhân viên** (`tickets.sold_by`), doanh thu quầy, thưởng / vi phạm (ghi nhận kèm tiền), **lương ước tính** = lương cứng + giờ × lương giờ + % doanh thu quầy + thưởng − phạt; xuất CSV |
| Tài khoản & quyền | Tìm kiếm; từng tài khoản có **Sửa** (tên, **phân quyền** khách ↔ nhân viên / kỹ thuật / phục vụ / quản lý, cơ sở, mật khẩu, khoá), khoá / mở nhanh, đặt lại mật khẩu; bảng quyền 5 vai trò (017) |
| Nhân viên tự chọn ca (018) | Ca của tôi → **Đăng ký ca**: ngày, ca sáng / chiều / tối hoặc giờ tuỳ chỉnh, vị trí, lặp 7 ngày → trạng thái "NV đăng ký – chờ duyệt"; quản lý duyệt / từ chối ngay trên Bảng ca; máy chủ chặn trùng giờ |
| Tìm kiếm | Ô tìm kiếm lọc ngay khi gõ ở **mọi mục**: khách (Lịch chiếu theo phim / thể loại / nhãn tuổi, Vé của tôi theo phim / mã / ghế / rạp / ngày), quản lý & nhân viên (Tổng quan, Suất chiếu, Bán tại quầy, Soát vé, Cơ sở & phòng, Kho phim, Nhân sự, Tài khoản & quyền, Nhật ký báo cáo) |

## Nghiệp vụ khách hàng (migration 005)
| Bước | Cách làm |
|---|---|
| Đăng ký | Họ tên, email, SĐT, tên đăng nhập, mật khẩu (kiểm định dạng và trùng ở máy chủ). Tạo xong được mời **xác thực VNeID + FaceID** ngay, có thể để sau |
| Đăng nhập | **Mật khẩu** (tên đăng nhập / email / SĐT) · **FaceID** (camera hoặc ảnh → máy chủ so vector với ảnh gốc của chính chủ; thất bại cũng ghi bản ghi) · **VNeID** (014: nhập **số căn cước** đã khai khi liên kết + quét khuôn mặt của chính mình – mô phỏng app VNeID) |
| Hồ sơ | Liên kết VNeID theo **chính chủ tài khoản** (014): khai họ tên, ngày sinh, số căn cước của mình (mô phỏng VNeID trả hồ sơ thật), khuôn mặt của mình được ghi làm ảnh gốc – không chọn hồ sơ mẫu nữa; số căn cước là duy nhất, đổi ngày sinh phải chụp lại. Liên kết **lưu trên máy chủ** (đổi thiết bị vẫn còn; một hồ sơ chỉ gắn một tài khoản); điểm thưởng; lịch sử đặt vé; voucher; tuỳ chọn "xác nhận mỗi lần đặt vé bằng passkey" |
| Người đi cùng | Ở bước thanh toán chọn "Bạn đi cùng có tài khoản" → nhập email/SĐT/tên đăng nhập → máy chủ trả tên, đã xác thực VNeID chưa, tuổi tại ngày chiếu (không lộ ngày sinh). Bạn đã xác thực → vé `verified`, **ở cửa không cần giấy tờ**, chưa đủ tuổi thì chặn ngay; vé hiện trong "Vé của tôi" của bạn đó kèm QR riêng |
| Đặt vé | Mã khuyến mãi (`CHAONHOM05` −10%) / thẻ quà tặng + điểm thưởng (1 điểm = 1.000 đ) tính ở máy chủ; cộng 5% điểm; phim T13+ dùng tuổi đã xác thực thì quét passkey |
| Hoàn vé | Tiền vào **thẻ quà tặng** của chính chủ (180 ngày) |
| Vào rạp | **Một QR cho cả đơn** (mua nhiều vé cùng suất: nhân viên quét một lần, tick người có mặt, cho vào một lượt; "Tách từng vé" khi bạn bè đến lẻ) · kiểm tuổi bằng căn cước/VNeID · **quên vé**: nhân viên bấm "Khách quên vé" → khách FaceID → hệ thống tìm vé hôm nay theo hồ sơ VNeID → cho vào |

## Tính năng đã chạy thật
| Tính năng | Cách làm |
|---|---|
| FaceID | Camera trình duyệt + [face-api](https://github.com/vladmandic/face-api): phát hiện → người thật (quay đầu **hoặc chớp mắt**) → so khớp 1:1 ở máy chủ, ngưỡng 0,5. Bước theo dõi chỉ chạy phát hiện + điểm mốc (160px), vector 128 số chỉ tính lúc chụp; mô hình tải trước khi mở hộp thoại |
| Haar cascade (OpenCV) | Theo bài [Face Detection using Haar Cascades](https://docs.opencv.org/4.0.0/d7/d8b/tutorial_py_face_detection.html): ảnh xám → tìm mặt → tìm mắt trong vùng mặt; đếm chớp mắt; so tốc độ với TinyFace (trang Kiểm thử). Haar chỉ tìm mặt, không nhận ra là ai |
| Máy không có camera | Máy tính hiện QR, điện thoại quét → xác thực trên điện thoại → kết quả về máy tính theo thời gian thực (WebRTC/PeerJS) |
| QR vé chống chụp màn hình | Mã `CV1.<vé>.<khung 15 giây>.<HMAC>` do máy chủ ký; watermark sọc chạy + đồng hồ giây + vòng đếm ngược; vé T13+ mở QR bằng passkey |
| Soát vé | Camera (quét liên tục), **chọn ảnh QR** / kéo thả, NFC, gõ mã. Phân biệt: hợp lệ, hết hạn, giả/bị sửa, mã tĩnh, đã dùng, chưa đến giờ (mở cửa trước 30 phút), suất đã kết thúc |
| Kiểm tuổi tại cửa / quầy | Vé chưa xác thực tuổi: **quét QR mặt sau căn cước** (camera hoặc ảnh), chip căn cước NFC (mô phỏng), FaceID qua VNeID, hoặc giấy tờ khác bằng mắt. Tự tính tuổi tại ngày chiếu so với nhãn phim, so tên giấy tờ với tên trên vé (chống mượn vé) |
| Ghế | Giữ 5 phút, người khác thấy "đang giữ"; bỏ dở thì ghế tự trống lại trên mọi màn hình; trả tiền sau khi hết giữ bị máy chủ từ chối; ghế đã mua hiện "ghế của bạn"; quầy bấm ghế để tra vé, người mua, đã vào chưa |
| Bằng chứng thanh tra | Tổng quan → Nhật ký kiểm tra độ tuổi → **Xuất CSV** (không có ảnh hay số giấy tờ) |
| NFC | Web NFC (Chrome Android) đọc/ghi thẻ NDEF; chip CCCD là mô phỏng (cần BAC/PACE – chỉ app gốc làm được) |
| Lưu kết quả | Mọi lần quét FaceID / VNeID / QR / NFC / passkey ghi vào bảng `verifications`, trang Kiểm thử hiện realtime kèm mã bản ghi |
| Dữ liệu dùng chung | Supabase Postgres + Realtime: giữ ghế, bán vé, soát vé là hàm nguyên tử phía máy chủ |

**Mô phỏng:** dữ liệu dân cư VNeID (4 hồ sơ mẫu), cổng thanh toán, chip CCCD. Ảnh poster là ảnh mẫu Unsplash.

## Chạy
- Online: https://clonetest222.github.io/faceid_demo/
- Supabase **cài mới**: chạy một lần `supabase/schema_full.sql` (gộp mọi migration, sinh bởi `node tools/build-schema.mjs`). Dự án đang chạy: chạy tiếp các file còn thiếu theo thứ tự số.
- Khoá dữ liệu (019): mọi bảng có PRIMARY KEY `id bigint identity`; tên đăng nhập, mã vé, mã voucher, mã đoàn, hồ sơ dân cư là UNIQUE (hàm / QR vẫn dùng mã); giữ khoá text có chủ đích cho mã nghiệp vụ ngắn in trên vé / URL: rạp (086), phòng (086-R1), phim, suất, loại ghế, hạng giá; đủ khoá ngoại (vé → tài khoản, suất → rạp, ca → nhân viên…) và chỉ mục.
- Supabase (từng file): chạy lần lượt trong SQL Editor `supabase/schema.sql`, `002_verification.sql`, `003_fix_reset.sql`, `004_auth_qr.sql`, `005_customer.sql`, `006_chain.sql` (rồi `select reset_demo()` để xoá suất kiểu cũ), `007_promo.sql` (mã khuyến mãi dùng chung: mỗi khách một lần), `008_admin.sql` (quản trị chuỗi), `009_seats.sql` (loại ghế theo từng ghế: VIP, đôi, bảo trì), `010_seat_info.sql` (tra cứu ghế: vé, người mua, đơn), `011_seat_types.sql` (loại ghế tự định nghĩa, bảng giá riêng từng rạp), `012_zero.sql` (ghế bảo trì không bán được ở máy chủ; `reset_demo` xoá thêm thẻ quà tặng, lượt mã, tài khoản kiểm thử), `013_fixed_price.sql` (giá cứng cho loại ghế), `014_own_identity.sql` (VNeID/FaceID theo chính chủ: khai hồ sơ, đăng nhập bằng căn cước + mặt, nhân viên tra khách theo căn cước/SĐT), `015_price_tiers.sql` (bảng giá hạng A/B sửa được), `016_hr.sql` (nhân sự: hồ sơ, khoá tài khoản, ca làm việc, chấm công, nghỉ phép, thưởng/phạt, hiệu suất & lương), `017_account.sql` (sửa từng tài khoản: tên, phân quyền, cơ sở, khoá, mật khẩu), `018_shift_request.sql` (nhân viên tự đăng ký ca, quản lý duyệt), `019_keys.sql` (khoá chính số, UNIQUE, khoá ngoại, chỉ mục), `020_films_cgv.sql` (kho phim demo 60 phim lấy từ cgv.vn 25/10/2026: 27 đang chiếu + 33 sắp chiếu, kèm ngày khởi chiếu, tóm tắt, đạo diễn, diễn viên, poster; lịch mẫu 10 ngày xếp đủ mọi phim đang chiếu tới 22:00), `021_guest.sql` (mua vé không cần tài khoản: chọn ghế trước, xác nhận email bằng mã 6 số của Supabase Auth, chặn email dùng một lần, mail vé qua Edge Function `send-mail` + SMTP Gmail, tra cứu vé, chuyển vé khi đăng ký). Muốn về 0: Tổng quan → **Đặt lại dữ liệu demo** (hoặc `select reset_demo();`). Web chỉ dùng publishable key trong `js/config.js` (không bao giờ đặt secret key vào repo).
- Trên máy: `python -m http.server 8000` rồi mở `http://localhost:8000` (camera chỉ chạy trên HTTPS hoặc localhost).
- Ghép nối điện thoại: `?pair=MÃ`.

## Kiểm thử
- **Trang Kiểm thử** (tài khoản quản lý): 27 ca cho FaceID, Haar, QR, kiểm tuổi tại cửa, NFC, VNeID + passkey, tự đánh dấu Đạt/Không đạt.
- SQL (PGlite): `node tools/sqltest.mjs` (cần `npm i --prefix tools/.pg @electric-sql/pglite`) – 132 ca: đăng ký/đăng nhập email·SĐT·FaceID·VNeID, liên kết VNeID, voucher, điểm, hoàn vé, vé theo hồ sơ, một QR cho cả đơn, chuỗi rạp (nhân viên sai rạp, quản lý rạp/chuỗi, doanh thu theo rạp), quản trị (kỹ thuật khoá ghế, phân phối phim, đổi/huỷ suất hoàn tiền, xoá phòng/cơ sở).
- Đầu-cuối (Edge headless): đăng nhập 3 vai, chặn quyền, mua vé, QR động, soát vé bằng ảnh/mã, FaceID qua ảnh, Haar.
- `node tools/e2e-customer.mjs [URL] [ảnh] [thư mục ảnh mặt]`: 36 bước nghiệp vụ khách hàng, gồm bạn đi cùng có tài khoản và cửa soát đơn nhiều vé (cần 005).
- `node tools/e2e-more.mjs [URL]`: mua thêm vé cùng suất, một QR cho cả đơn / tách từng vé (10 bước).
- `node tools/e2e-guest.mjs [URL]`: mua vé không cần tài khoản: chọn ghế → email + mã xác nhận (chặn email dùng một lần) → thanh toán → mail vé → tra cứu → tạo tài khoản, vé chuyển sang (cần migration 021; 23 bước).
- `node tools/e2e-seats.mjs [URL]`: 13 bước với 2 trình duyệt cùng tranh một suất (đang giữ, đã bán, huỷ, hết hạn giữ, trả tiền muộn, đăng xuất, tra cứu ghế ở quầy).
- `node tools/e2e-age.mjs [URL]`: 16 bước nghiệp vụ kiểm tuổi tại cửa (QR căn cước 22 tuổi cho vào, 15 tuổi từ chối, mã không phải căn cước, chip, giờ vào cửa, xuất CSV).

## Kiểm thử tải (Supabase gói miễn phí)
`node tools/loadtest.mjs 1000 100` – 1000 khách ảo, 100 đồng thời, tranh 420 ghế (cần tài khoản quản lý để tạo suất thử và dọn dữ liệu):

| Chỉ số | Kết quả |
|---|---|
| Thời gian | 4,6 giây |
| Vé bán / ghế có | 414 / 420 |
| Ghế bị bán trùng | 0 |
| Lỗi máy chủ | 0 |
| Giữ ghế p50 / p95 | 158 ms / 356 ms |

## Giới hạn
- VNeID, cổng thanh toán, chip CCCD là mô phỏng; chữ ký passkey kiểm tra ở trình duyệt (bản thật: kiểm tra ở máy chủ).
- Web không chặn được thao tác chụp màn hình; QR đổi 15 giây làm ảnh chụp vô dụng, nhưng quay màn hình rồi phát trực tiếp vẫn lách được → phim T18 nên đối chiếu FaceID tại cửa.
- Đọc bảng vé (`tickets`) đang mở cho mọi người (RLS read_all) để realtime chạy; bản thật nên giới hạn theo chủ vé.
