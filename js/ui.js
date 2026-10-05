/* UI – công thức thành phần lấy từ wireframe đã duyệt (skill ui-ux: button, card, badge, segmented, input, select, empty, banner).
   Mỗi hàm trả về chuỗi HTML dùng class Tailwind; màu chỉ qua token. */
"use strict";
const BTN = "inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl min-h-10 px-4 py-2 text-sm font-medium transition-colors max-w-full text-center leading-tight outline-hidden disabled:cursor-not-allowed disabled:opacity-50";
const B = {
  primary: `${BTN} bg-primary text-primary-foreground hover:bg-primary-hover`,
  outline: `${BTN} border border-border-strong bg-surface text-foreground hover:bg-button-hover`,
  secondary: `${BTN} bg-secondary text-foreground hover:bg-secondary-hover`,
  ghost: `${BTN} bg-transparent text-muted hover:bg-foreground/5 hover:text-foreground`,
  danger: `${BTN} bg-transparent text-[var(--danger)] hover:bg-[var(--danger-bg)]`,
  icon: "inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl text-muted outline-hidden hover:bg-foreground/5 hover:text-foreground",
};
const ic = (n, c = "size-4") => `<i data-lucide="${n}" class="${c} shrink-0" aria-hidden="true"></i>`;
const badge = (txt, cls) => `<span class="inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-md px-2 text-xs font-medium ${cls}">${txt}</span>`;
const TONE = { ok: "bg-success-bg text-success", warn: "bg-warning-bg text-warning", bad: "bg-err-bg text-err", neutral: "bg-neutral-bg text-neutral", info: "bg-neutral-bg text-neutral" };
const tone = (txt, t) => badge(txt, TONE[t] || TONE.neutral);
const RATE_CLS = { P: TONE.ok, K: TONE.ok, T13: TONE.neutral, T16: TONE.warn, T18: TONE.bad };
const rate = r => `<span title="${esc(RATING_TXT[r] || "")}">${badge(r, RATE_CLS[r] || TONE.neutral)}</span>`;
const card = (inner, cls = "") => `<section class="rounded-xl border border-border bg-surface p-4 sm:p-5 ${cls}">${inner}</section>`;
const h2 = (t, right = "") => `<div class="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 class="text-lg font-semibold">${t}</h2>${right}</div>`;
const pageHead = (title, sub = "", right = "") => `<div class="mb-4 flex flex-wrap items-end justify-between gap-3"><div class="min-w-0"><h1 class="text-xl font-semibold">${title}</h1>${sub ? `<p class="mt-1 text-sm text-muted">${sub}</p>` : ""}</div>${right}</div>`;
/** segmented: items [[key,label,icon?]], act = data-act, cur = đang chọn */
const seg = (items, cur, act, extra = "") => `<div role="tablist" class="inline-flex shrink-0 gap-0.5 rounded-xl bg-background p-1 [box-shadow:var(--shadow-segment-track)]">${items.map(([k, l, i]) => `<button type="button" role="tab" aria-selected="${k === cur}" data-act="${act}" data-v="${k}" ${extra} class="inline-flex h-8 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm ${k === cur ? "bg-surface font-medium text-foreground [box-shadow:var(--shadow-segment-thumb)]" : "text-muted hover:text-foreground"}">${i ? ic(i, "hidden size-4 sm:block") : ""}${l}</button>`).join("")}</div>`;
const INPUT = "h-11 md:h-10 w-full rounded-xl border border-border-strong bg-surface px-3 text-base md:text-sm outline-hidden placeholder:text-muted focus:border-focus focus:ring-2 focus:ring-focus aria-invalid:border-[var(--error)] aria-invalid:ring-2 aria-invalid:ring-[var(--error-ring,rgb(251_44_54/0.1))]";
const field = (label, inner, hint = "", bad = false, id = "") => `<label class="grid gap-1.5" ${id ? `for="${id}"` : ""}><span class="text-sm font-medium">${label}</span>${inner}${hint ? `<span class="text-xs ${bad ? "text-[var(--error-text)]" : "text-muted"}">${hint}</span>` : ""}</label>`;
const input = (id, value = "", attrs = "") => `<input id="${id}" value="${esc(value)}" class="${INPUT}" ${attrs}>`;
/** Ô chọn dạng nút + danh sách nổi (không dùng <select> gốc). opts [[value,label]]. Giá trị đọc ở data-value. */
function selectBox(id, opts, value, { act = "", placeholder = "Chọn…", extra = "" } = {}) {
  const cur = opts.find(o => String(o[0]) === String(value));
  return `<div class="relative" data-select="${id}" data-value="${esc(value ?? "")}" ${act ? `data-sel-act="${act}"` : ""} ${extra}>
    <button type="button" id="${id}" aria-haspopup="listbox" aria-expanded="false" class="flex h-11 md:h-10 w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-border-strong bg-surface px-3 text-left text-base md:text-sm outline-hidden hover:bg-button-hover aria-expanded:border-focus aria-expanded:ring-2 aria-expanded:ring-focus" data-sel-open><span class="truncate ${cur ? "" : "text-muted"}">${esc(cur ? cur[1] : placeholder)}</span>${ic("chevron-down", "size-4 text-muted")}</button>
    <div role="listbox" hidden class="ov-dialog absolute left-0 right-0 top-full z-40 mt-1 grid max-h-72 gap-0.5 overflow-y-auto rounded-xl border border-border bg-surface-overlay p-1 shadow-popover">${opts.map(([v, l]) => `<button type="button" role="option" aria-selected="${String(v) === String(value)}" data-sel-opt="${esc(v)}" class="flex min-h-9 cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-item-hover aria-selected:font-medium"><span>${esc(l)}</span>${String(v) === String(value) ? ic("check", "size-4") : ""}</button>`).join("")}</div>
  </div>`;
}
const selVal = id => { const el = document.querySelector(`[data-select="${id}"]`); return el ? el.dataset.value : ""; };
const emptyState = (icon, title, text, action = "") => `<div class="grid justify-items-center gap-3 px-4 py-12 text-center"><span class="grid size-12 place-items-center rounded-xl bg-secondary text-muted">${ic(icon, "size-5")}</span><div><p class="text-base font-semibold">${title}</p><p class="mt-1 max-w-sm text-pretty text-sm text-muted">${text}</p></div>${action}</div>`;
const banner = (t, title, text, action = "") => {
  const map = { bad: ["border-err-border bg-err-bg text-err", "circle-alert"], warn: ["border-[color-mix(in_srgb,var(--warning)_25%,transparent)] bg-warning-bg text-warning", "triangle-alert"], ok: ["border-[color-mix(in_srgb,var(--success)_25%,transparent)] bg-success-bg text-success", "circle-check"], info: ["border-border bg-surface text-foreground", "info"] }[t] || [];
  return `<div role="${t === "bad" ? "alert" : "status"}" class="flex items-start gap-3 rounded-xl border p-4 ${map[0]}">${ic(map[1], "size-5 mt-px")}<div class="min-w-0 flex-1">${title ? `<p class="font-medium">${title}</p>` : ""}${text ? `<p class="${title ? "mt-0.5 " : ""}text-pretty text-sm">${text}</p>` : ""}</div>${action}</div>`;
};
const skelRows = (n, h = "h-16") => Array.from({ length: n }, () => `<div class="skel ${h} rounded-xl"></div>`).join("");
const LOGO = `<span class="flex items-center gap-2"><span class="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">${ic("clapperboard", "size-4")}</span><span class="text-base font-semibold">CineVin</span></span>`;
const avatar = name => { const p = String(name || "?").trim().split(/\s+/); const t = (p.length > 1 ? p[p.length - 2][0] + p[p.length - 1][0] : p[0].slice(0, 2)).toUpperCase(); return `<span class="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-sm font-medium">${esc(t)}</span>`; };
const sheetHead = (title, sub = "") => `<header class="flex items-start gap-3"><div class="min-w-0 flex-1"><h2 class="text-lg font-semibold">${title}</h2>${sub ? `<p class="mt-0.5 text-sm text-muted">${sub}</p>` : ""}</div><button type="button" class="${B.icon} -mr-2 -mt-2" data-m="close" aria-label="Đóng">${ic("x", "size-5")}</button></header>`;
const choiceCard = (m, icon, title, text, disabled = false) => `<button type="button" data-m="${m}" ${disabled ? 'aria-disabled="true"' : ""} class="flex w-full cursor-pointer items-start gap-3 rounded-xl border border-border-strong bg-surface p-4 text-left hover:bg-button-hover aria-disabled:cursor-not-allowed aria-disabled:opacity-50"><span class="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-muted">${ic(icon)}</span><span class="min-w-0"><span class="block font-medium">${title}</span><span class="mt-0.5 block text-pretty text-xs text-muted">${text}</span></span></button>`;
const savedLine = r => r && r.recordId
  ? banner("ok", "", `Đã lưu lên Supabase: bản ghi <b class="font-mono">#${r.recordId}</b> (bảng verifications) lúc ${new Date(r.savedAt).toLocaleTimeString("vi-VN")}.`)
  : banner("warn", "", `Chưa lưu lên máy chủ – ${!Remote.hasClient ? "đang ngoại tuyến" : "chưa chạy migration 002"}. Kết quả chỉ nằm trên thiết bị này.`);

/* vẽ icon lucide mỗi khi DOM có thẻ <i data-lucide> mới (điều kiện chặn vòng lặp vô hạn) */
new MutationObserver(() => { if (window.lucide && document.querySelector("i[data-lucide]")) lucide.createIcons({ attrs: { "stroke-width": 2 } }); })
  .observe(document.documentElement, { childList: true, subtree: true });

/* ô chọn: mở / chọn / đóng (bấm ngoài hoặc Esc) */
document.addEventListener("click", e => {
  const open = e.target.closest("[data-sel-open]");
  $$("[data-select] [role=listbox]:not([hidden])").forEach(l => { if (!open || l.parentElement !== open.parentElement) { l.hidden = true; l.parentElement.querySelector("[data-sel-open]").setAttribute("aria-expanded", "false"); } });
  if (open) { const l = open.parentElement.querySelector("[role=listbox]"); l.hidden = !l.hidden; open.setAttribute("aria-expanded", String(!l.hidden)); return; }
  const opt = e.target.closest("[data-sel-opt]");
  if (opt) {
    const box = opt.closest("[data-select]"); box.dataset.value = opt.dataset.selOpt;
    box.querySelector("[data-sel-open] span").textContent = opt.querySelector("span").textContent;
    box.querySelector("[data-sel-open] span").classList.remove("text-muted");
    box.querySelectorAll("[data-sel-opt]").forEach(o => o.setAttribute("aria-selected", String(o === opt)));
    box.querySelector("[role=listbox]").hidden = true; box.querySelector("[data-sel-open]").setAttribute("aria-expanded", "false");
    box.dispatchEvent(new CustomEvent("sel-change", { bubbles: true, detail: { id: box.dataset.select, value: box.dataset.value } }));
  }
}, true);
document.addEventListener("keydown", e => { if (e.key === "Escape") $$("[data-select] [role=listbox]:not([hidden])").forEach(l => { l.hidden = true; }); });
