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
| Tìm kiếm | Ô tìm kiếm ở Cơ sở & phòng (cơ sở, tỉnh, địa chỉ, phòng), Kho phim, Tài khoản & quyền, Nhân sự |

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
- Supabase: chạy lần lượt trong SQL Editor `supabase/schema.sql`, `002_verification.sql`, `003_fix_reset.sql`, `004_auth_qr.sql`, `005_customer.sql`, `006_chain.sql` (rồi `select reset_demo()` để xoá suất kiểu cũ), `007_promo.sql` (mã khuyến mãi dùng chung: mỗi khách một lần), `008_admin.sql` (quản trị chuỗi), `009_seats.sql` (loại ghế theo từng ghế: VIP, đôi, bảo trì), `010_seat_info.sql` (tra cứu ghế: vé, người mua, đơn), `011_seat_types.sql` (loại ghế tự định nghĩa, bảng giá riêng từng rạp), `012_zero.sql` (ghế bảo trì không bán được ở máy chủ; `reset_demo` xoá thêm thẻ quà tặng, lượt mã, tài khoản kiểm thử), `013_fixed_price.sql` (giá cứng cho loại ghế), `014_own_identity.sql` (VNeID/FaceID theo chính chủ: khai hồ sơ, đăng nhập bằng căn cước + mặt, nhân viên tra khách theo căn cước/SĐT), `015_price_tiers.sql` (bảng giá hạng A/B sửa được), `016_hr.sql` (nhân sự: hồ sơ, khoá tài khoản, ca làm việc, chấm công, nghỉ phép, thưởng/phạt, hiệu suất & lương), `017_account.sql` (sửa từng tài khoản: tên, phân quyền, cơ sở, khoá, mật khẩu). Muốn về 0: Tổng quan → **Đặt lại dữ liệu demo** (hoặc `select reset_demo();`). Web chỉ dùng publishable key trong `js/config.js` (không bao giờ đặt secret key vào repo).
- Trên máy: `python -m http.server 8000` rồi mở `http://localhost:8000` (camera chỉ chạy trên HTTPS hoặc localhost).
- Ghép nối điện thoại: `?pair=MÃ`.

## Kiểm thử
- **Trang Kiểm thử** (tài khoản quản lý): 27 ca cho FaceID, Haar, QR, kiểm tuổi tại cửa, NFC, VNeID + passkey, tự đánh dấu Đạt/Không đạt.
- SQL (PGlite): `node tools/sqltest.mjs` (cần `npm i --prefix tools/.pg @electric-sql/pglite`) – 132 ca: đăng ký/đăng nhập email·SĐT·FaceID·VNeID, liên kết VNeID, voucher, điểm, hoàn vé, vé theo hồ sơ, một QR cho cả đơn, chuỗi rạp (nhân viên sai rạp, quản lý rạp/chuỗi, doanh thu theo rạp), quản trị (kỹ thuật khoá ghế, phân phối phim, đổi/huỷ suất hoàn tiền, xoá phòng/cơ sở).
- Đầu-cuối (Edge headless): đăng nhập 3 vai, chặn quyền, mua vé, QR động, soát vé bằng ảnh/mã, FaceID qua ảnh, Haar.
- `node tools/e2e-customer.mjs [URL] [ảnh] [thư mục ảnh mặt]`: 36 bước nghiệp vụ khách hàng, gồm bạn đi cùng có tài khoản và cửa soát đơn nhiều vé (cần 005).
- `node tools/e2e-more.mjs [URL]`: mua thêm vé cùng suất, một QR cho cả đơn / tách từng vé (10 bước).
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
