# CineVin – bán vé xem phim, xác thực tuổi bằng VNeID + FaceID

Demo đồ án PTTKHTTT – Nhóm 05, ĐH Vinh. Đề tài 20: lịch chiếu, chọn ghế, thanh toán, quản lý suất chiếu.

**Bài toán:** rạp bị phạt 60–80 triệu đồng nếu để người xem sai độ tuổi, nhưng hiện chỉ kiểm tra giấy tờ bằng mắt ở cửa; trẻ em thường chưa có căn cước; đoàn 1 giáo viên – 50 học sinh thì không thể kiểm tra từng em; vé điện tử chụp màn hình là gửi cho người khác dùng được.

**Giải pháp:**
- Xác thực **một lần** bằng VNeID + khuôn mặt → hệ thống biết ngày sinh thật, tự áp giá theo tuổi và **chặn ngay khi bán** vé T13/T16/T18.
- Trẻ chưa có căn cước → **hồ sơ người phụ thuộc** của cha mẹ đã xác thực.
- Vé đoàn → chỉ xác thực sinh trắc **giáo viên**, kiểm tra tuổi **theo danh sách**, một QR cho cả đoàn; phim P chỉ đếm người, phim từ T13 quét thẻ QR từng em + kiểm tra ngẫu nhiên.
- **QR vé đổi mỗi 15 giây**, máy chủ ký HMAC; máy soát chỉ nhận mã chưa quá 30 giây → ảnh chụp màn hình bị từ chối.

## Đăng nhập & phân quyền
| Tài khoản demo | Mật khẩu | Vai trò | Vào được |
|---|---|---|---|
| `khach` | `khach123` | Khách hàng | Lịch chiếu, chọn ghế, thanh toán, vé của tôi, vé đoàn, tài khoản |
| `giaovien` | `giaovien123` | Khách hàng | như trên (dùng để thử vé đoàn) |
| `nhanvien` | `nhanvien123` | Nhân viên | Soát vé, bán tại quầy |
| `quanly` | `quanly123` | Quản lý | Tất cả + tổng quan, suất chiếu, kiểm thử, tài khoản & quyền |

Mật khẩu băm bcrypt trên máy chủ; mỗi hàm nhạy cảm nhận token phiên và **tự kiểm vai trò ở máy chủ** (khách gọi thẳng API thêm suất → `forbidden`). Khách tự đăng ký được; tài khoản nhân viên do quản lý tạo.

## Tính năng đã chạy thật
| Tính năng | Cách làm |
|---|---|
| FaceID | Camera trình duyệt + [face-api](https://github.com/vladmandic/face-api): phát hiện → người thật (quay đầu **hoặc chớp mắt**) → so khớp 1:1 ở máy chủ, ngưỡng 0,5. Bước theo dõi chỉ chạy phát hiện + điểm mốc (160px), vector 128 số chỉ tính lúc chụp; mô hình tải trước khi mở hộp thoại |
| Haar cascade (OpenCV) | Theo bài [Face Detection using Haar Cascades](https://docs.opencv.org/4.0.0/d7/d8b/tutorial_py_face_detection.html): ảnh xám → tìm mặt → tìm mắt trong vùng mặt; đếm chớp mắt; so tốc độ với TinyFace (trang Kiểm thử). Haar chỉ tìm mặt, không nhận ra là ai |
| Máy không có camera | Máy tính hiện QR, điện thoại quét → xác thực trên điện thoại → kết quả về máy tính theo thời gian thực (WebRTC/PeerJS) |
| QR vé chống chụp màn hình | Mã `CV1.<vé>.<khung 15 giây>.<HMAC>` do máy chủ ký; watermark sọc chạy + đồng hồ giây + vòng đếm ngược; vé T13+ mở QR bằng passkey |
| Soát vé | Camera (quét liên tục), **chọn ảnh QR** / kéo thả, NFC, gõ mã. Phân biệt: hợp lệ, hết hạn, giả/bị sửa, mã tĩnh, đã dùng |
| NFC | Web NFC (Chrome Android) đọc/ghi thẻ NDEF; chip CCCD là mô phỏng (cần BAC/PACE – chỉ app gốc làm được) |
| Lưu kết quả | Mọi lần quét FaceID / VNeID / QR / NFC / passkey ghi vào bảng `verifications`, trang Kiểm thử hiện realtime kèm mã bản ghi |
| Dữ liệu dùng chung | Supabase Postgres + Realtime: giữ ghế, bán vé, soát vé là hàm nguyên tử phía máy chủ |

**Mô phỏng:** dữ liệu dân cư VNeID (4 hồ sơ mẫu), cổng thanh toán, chip CCCD. Ảnh poster là ảnh mẫu Unsplash.

## Chạy
- Online: https://clonetest222.github.io/faceid_demo/
- Supabase: chạy lần lượt trong SQL Editor `supabase/schema.sql`, `002_verification.sql`, `003_fix_reset.sql`, `004_auth_qr.sql`. Web chỉ dùng publishable key trong `js/config.js` (không bao giờ đặt secret key vào repo).
- Trên máy: `python -m http.server 8000` rồi mở `http://localhost:8000` (camera chỉ chạy trên HTTPS hoặc localhost).
- Ghép nối điện thoại: `?pair=MÃ`.

## Kiểm thử
- **Trang Kiểm thử** (tài khoản quản lý): 22 ca cho FaceID, Haar, QR, NFC, VNeID + passkey, tự đánh dấu Đạt/Không đạt.
- SQL (PGlite): 46 ca – đăng nhập, phân quyền, QR hợp lệ/hết hạn/giả/tĩnh, chủ vé, hoàn vé.
- Đầu-cuối (Edge headless): đăng nhập 3 vai, chặn quyền, mua vé, QR động, soát vé bằng ảnh/mã, FaceID qua ảnh, Haar.

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
