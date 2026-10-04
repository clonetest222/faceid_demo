/* Tiện ích dùng chung (biến toàn cục, không cần bundler để chạy thẳng trên GitHub Pages). */
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const vnd = n => Math.round(n).toLocaleString("vi-VN") + " đ";
const pad = n => String(n).padStart(2, "0");
const hhmm = d => pad(new Date(d).getHours()) + ":" + pad(new Date(d).getMinutes());
const ddmm = d => { const x = new Date(d); return pad(x.getDate()) + "/" + pad(x.getMonth() + 1); };
const dmy = d => { const x = new Date(d); return pad(x.getDate()) + "/" + pad(x.getMonth() + 1) + "/" + x.getFullYear(); };
const rid = (p, n = 6) => p + Array.from({ length: n }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.random() * 32 | 0]).join("");
const ageAt = (dob, when) => { const b = new Date(dob), w = new Date(when); let a = w.getFullYear() - b.getFullYear(); if (w.getMonth() < b.getMonth() || (w.getMonth() === b.getMonth() && w.getDate() < b.getDate())) a--; return a; };
const ICON_FACE = '<svg width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><circle cx="12" cy="9" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>';
const ICON_OK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';
const ICON_NO = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

function qrSvg(text, cell = 3) {
  try { const q = qrcode(0, "M"); q.addData(text); q.make(); return q.createSvgTag(cell, 0); }
  catch (e) { return '<div class="mono small" style="padding:16px;color:#000">' + esc(text) + "</div>"; }
}
function toast(msg) {
  $$(".toast").forEach(t => t.remove());
  const t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}
/** Mở một hộp thoại; trả về {el, close}. html là nội dung bên trong .sheet */
function openSheet(html, { wide = false, label = "Hộp thoại", onClose } = {}) {
  const root = $("#modal-root");
  root.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(label)}"><div class="sheet${wide ? " wide" : ""}">${html}</div></div>`;
  const el = $(".sheet", root);
  const close = () => { root.innerHTML = ""; root.onclick = null; root.onchange = null; onClose && onClose(); };
  root.onclick = e => { if (e.target.classList.contains("modal")) close(); };
  const f = el.querySelector("button,a,input,select"); f && f.focus({ preventScroll: true });
  return { el, close, set(html2) { el.innerHTML = html2; } };
}
/** Địa chỉ gốc của trang (dùng cho link ghép nối điện thoại) */
function baseUrl() { return location.origin + location.pathname.replace(/index\.html$/, ""); }
