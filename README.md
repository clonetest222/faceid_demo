# CineVin – bán vé xem phim, xác thực tuổi bằng VNeID + FaceID

Demo đồ án PTTKHTTT – Nhóm 05, ĐH Vinh.

**Bài toán:** rạp bị phạt 60–80 triệu đồng nếu để người xem sai độ tuổi, nhưng hiện chỉ kiểm tra giấy tờ bằng mắt ở cửa; trẻ em thường chưa có căn cước; đoàn 1 giáo viên – 50 học sinh thì không thể kiểm tra từng em.

**Giải pháp:**
- Xác thực **một lần** bằng VNeID + khuôn mặt → hệ thống biết ngày sinh thật, tự áp giá theo tuổi và **chặn ngay khi bán** vé T13/T16/T18.
- Trẻ chưa có căn cước → **hồ sơ người phụ thuộc** của cha mẹ đã xác thực.
- Vé đoàn → chỉ xác thực sinh trắc **giáo viên**, kiểm tra tuổi **theo danh sách**, một QR cho cả đoàn; phim P chỉ đếm người, phim từ T13 quét thẻ QR từng em + kiểm tra ngẫu nhiên. Không thu thập khuôn mặt trẻ em.

## Tính năng đã chạy thật
| Tính năng | Cách làm |
|---|---|
| FaceID | Camera trình duyệt + [face-api](https://github.com/vladmandic/face-api): phát hiện khuôn mặt → kiểm tra người thật (quay đầu rồi nhìn thẳng) → so khớp 1:1, ngưỡng khoảng cách 0,5 |
| Máy không có camera | Máy tính hiện QR, điện thoại quét → xác thực trên điện thoại → kết quả về máy tính **theo thời gian thực** (WebRTC/PeerJS) |
| Soát vé | Quét QR vé / thẻ học sinh bằng camera sau (BarcodeDetector hoặc jsQR) |
| Đồng bộ | Mở nhiều tab (Khách hàng, Soát vé…) trên cùng máy: dữ liệu cập nhật ngay |
| Responsive | Dùng được trên điện thoại 360px trở lên |

**Mô phỏng:** dữ liệu dân cư VNeID (4 hồ sơ mẫu), cổng thanh toán. "Ảnh gốc" thay cho ảnh trong CSDL quốc gia là vector đặc trưng 128 số lưu trên chính thiết bị (xoá được ở trang Tài khoản).

## Chạy
- Online: bật GitHub Pages (Settings → Pages → Deploy from branch `main`, thư mục `/`), mở `https://<chủ-repo>.github.io/faceid_demo/`.
- Trên máy: `python -m http.server 8000` rồi mở `http://localhost:8000` (camera chỉ chạy trên HTTPS hoặc localhost).
- Mở thẳng vai trò: `#kh`, `#gv`, `#pos`, `#gate`, `#ql`. Ghép nối điện thoại: `?pair=MÃ`.

## Kịch bản demo 5 phút
1. Laptop không camera → **Liên kết VNeID** → chọn hồ sơ → **Dùng điện thoại** → điện thoại quét QR, quét khuôn mặt → laptop nhận kết quả ngay.
2. Đặt phim T16 với hồ sơ 15 tuổi → bị chặn khi bán.
3. Tài khoản → thêm con 9 tuổi → phim K chỉ cho con bị chặn, thêm vé bố/mẹ thì được.
4. Giáo viên → vé đoàn lớp 8A phim T13 → phát hiện 1 em 12 tuổi → phụ huynh xác nhận → QR đoàn + thẻ từng em.
5. Điện thoại mở `#gate` → quét thẻ bằng camera, thử quét lại (bị chặn) → kiểm tra ngẫu nhiên → hoàn tất.

## Tiếp theo
Supabase (Postgres + Realtime) để dữ liệu dùng chung giữa các máy; lớp `Store` trong `js/app.js` là điểm thay thế.
