/* Tiện ích dùng chung (biến toàn cục, không cần bundler để chạy thẳng trên GitHub Pages). */
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const vnd = n => Math.round(n).toLocaleString("vi-VN") + " đ";
const pad = n => String(n).padStart(2, "0");
const hhmm = d => pad(new Date(d).getHours()) + ":" + pad(new Date(d).getMinutes());
const hhmmss = d => hhmm(d) + ":" + pad(new Date(d).getSeconds());
const ddmm = d => { const x = new Date(d); return pad(x.getDate()) + "/" + pad(x.getMonth() + 1); };
const dmy = d => { const x = new Date(d); return pad(x.getDate()) + "/" + pad(x.getMonth() + 1) + "/" + x.getFullYear(); };
const rid = (p, n = 6) => p + Array.from({ length: n }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.random() * 32 | 0]).join("");
const ageAt = (dob, when) => { const b = new Date(dob), w = new Date(when); let a = w.getFullYear() - b.getFullYear(); if (w.getMonth() < b.getMonth() || (w.getMonth() === b.getMonth() && w.getDate() < b.getDate())) a--; return a; };
const WEEKDAY = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];

/** QR dạng SVG co giãn theo khung chứa. Mức sửa lỗi H để watermark/đồng hồ quanh mã không làm hỏng việc quét. */
function qrSvg(text, level = "M") {
  try { const q = qrcode(0, level); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); }
  catch (e) { return `<div class="p-4 font-mono text-xs">${esc(text)}</div>`; }
}
/** QR ra ảnh PNG (data URL) – để tải về thử tính năng "Ảnh QR" ở máy soát vé */
function qrPng(text, size = 360) {
  const q = qrcode(0, "H"); q.addData(text); q.make();
  const n = q.getModuleCount(), quiet = 4, cell = Math.floor(size / (n + quiet * 2)), dim = cell * (n + quiet * 2);
  const c = document.createElement("canvas"); c.width = c.height = dim; const x = c.getContext("2d");
  x.fillStyle = "#fff"; x.fillRect(0, 0, dim, dim); x.fillStyle = "#000";
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) x.fillRect((k + quiet) * cell, (r + quiet) * cell, cell, cell);
  return c.toDataURL("image/png");
}
/** Đọc QR trong một ảnh (tệp người dùng chọn). BarcodeDetector nếu có, không thì jsQR. Trả về chuỗi hoặc null. */
async function decodeQrImage(file) {
  const img = new Image(); img.src = URL.createObjectURL(file);
  try { await img.decode(); } catch (e) { return null; }
  if ("BarcodeDetector" in window) { try { const r = await new BarcodeDetector({ formats: ["qr_code"] }).detect(img); if (r[0]) return r[0].rawValue; } catch (e) {} }
  if (!window.jsQR) return null;
  // thử vài cỡ: ảnh chụp màn hình rất lớn hoặc QR rất nhỏ trong ảnh
  for (const max of [1000, 1600, 600]) {
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)), w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
    const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(img, 0, 0, w, h);
    const r = jsQR(x.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "attemptBoth" });
    if (r && r.data) return r.data;
  }
  return null;
}
function toast(msg, tone = "") {
  const root = $("#toast-root"); if (!root) return;
  root.innerHTML = "";
  const t = document.createElement("div");
  t.setAttribute("role", "status");
  t.className = "ov-dialog flex max-w-md items-center gap-2 rounded-xl border border-border bg-surface-overlay px-4 py-3 text-sm shadow-popover" + (tone === "bad" ? " text-err" : "");
  t.textContent = msg; root.appendChild(t);
  clearTimeout(toast._t); toast._t = setTimeout(() => t.remove(), 3200);
}
/** Mở hộp thoại (sheet từ đáy trên điện thoại, modal giữa màn từ sm). Trả về {el, close, set}. */
function openSheet(html, { wide = false, label = "Hộp thoại", onClose } = {}) {
  const root = $("#modal-root");
  root.innerHTML = `<div class="ov-scrim" data-scrim></div>
    <div class="pointer-events-none fixed inset-0 z-[61] flex items-end justify-center sm:items-center sm:p-6">
      <div role="dialog" aria-modal="true" aria-label="${esc(label)}" class="ov-dialog pointer-events-auto grid max-h-[92vh] w-full ${wide ? "sm:max-w-2xl" : "sm:max-w-md"} content-start gap-4 overflow-y-auto rounded-t-2xl border border-border bg-surface p-5 shadow-modal sm:rounded-2xl" data-sheet>${html}</div>
    </div>`;
  const el = $("[data-sheet]", root);
  const close = () => { root.innerHTML = ""; document.removeEventListener("keydown", onKey); onClose && onClose(); };
  const onKey = e => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  $("[data-scrim]", root).onclick = close;
  const f = el.querySelector("input,select,textarea"); f && f.focus({ preventScroll: true });
  return { el, close, set(html2) { el.innerHTML = html2; } };
}
/** Địa chỉ gốc của trang (dùng cho link ghép nối điện thoại) */
function baseUrl() { return location.origin + location.pathname.replace(/index\.html$/, ""); }
