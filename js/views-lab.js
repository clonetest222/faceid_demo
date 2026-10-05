/* Kiểm thử (quản lý): mỗi nhóm FaceID / Haar / QR / NFC / VNeID + passkey có danh sách ca kiểm thử,
   tự đánh dấu Đạt / Không đạt theo kết quả thật trên thiết bị; mọi lần quét đều lưu bản ghi lên Supabase (bảng verifications). */
"use strict";
const LAB = { cam: null, citizens: null, loading: false, expect: "same", nfc: { on: false, stop: null, last: null, err: "" }, chip: null, qr: { samples: null, busy: false, last: null }, haar: { stop: null, stats: null, img: null, err: "" }, filter: "all", pk: null };
FaceKit.hasCamera().then(v => { LAB.cam = v; if (CUR_ROUTE === "kiemthu") scheduleRender(); });
const CASES = {
  face: ["FaceID", [["f-enroll", "Lần quét đầu lưu ảnh gốc trên máy chủ"], ["f-same", "Cùng người → khớp (tương đồng ≥ 88%)"], ["f-other", "Người khác → từ chối"], ["f-live", "Camera: kiểm tra người thật (quay đầu / chớp mắt)"], ["f-saved", "Kết quả có mã bản ghi trên Supabase"]]],
  haar: ["Haar (OpenCV)", [["h-face", "Phát hiện khuôn mặt"], ["h-eyes", "Phát hiện đủ 2 mắt trong vùng mặt"], ["h-blink", "Đếm được chớp mắt (camera)"], ["h-speed", "Đo tốc độ Haar so với TinyFace"]]],
  qr: ["QR vé", [["q-ok", "QR động vừa tạo → hợp lệ"], ["q-exp", "QR cũ hơn 30 giây (ảnh chụp màn hình) → hết hạn"], ["q-forged", "QR bị sửa mã vé → sai chữ ký"], ["q-static", "Mã tĩnh / gõ tay → cảnh báo đối chiếu"], ["q-image", "Đọc QR từ ảnh chọn trong máy"], ["q-cam", "Đọc QR bằng camera"]]],
  nfc: ["NFC", [["n-read", "Đọc thẻ NDEF"], ["n-write", "Ghi mã vé vào thẻ trống"], ["n-chip", "Chip CCCD (mô phỏng) → lưu bản ghi"], ["n-why", "Thiết bị không hỗ trợ → báo rõ lý do"]]],
  vneid: ["VNeID + passkey", [["v-link", "Đồng ý chia sẻ họ tên, ngày sinh → lưu bản ghi VNeID"], ["p-create", "Tạo passkey (Face ID / vân tay của máy)"], ["p-verify", "Xác thực passkey: chữ ký hợp lệ"]]],
};
const labCases = () => S.labCases || (S.labCases = {});
function setCase(id, ok, note = "") { labCases()[id] = { ok, note, at: new Date().toISOString() }; save(); }
function caseList(group) {
  const c = labCases();
  return `<ul class="mt-4 grid border-t border-border pt-2">${CASES[group][1].map(([id, name]) => { const r = c[id];
    return `<li class="flex items-start gap-3 py-2 text-sm" data-case="${id}" data-case-state="${r ? (r.ok ? "pass" : "fail") : "todo"}"><span class="mt-px grid size-5 shrink-0 place-items-center rounded-full ${!r ? "border border-border-strong" : r.ok ? "bg-success-bg text-success" : "bg-err-bg text-err"}">${!r ? "" : ic(r.ok ? "check" : "x", "size-3")}</span><span class="min-w-0 flex-1"><span class="block ${r ? "" : "text-muted"}">${name}</span>${r && r.note ? `<span class="block text-pretty text-xs text-muted">${esc(r.note)}</span>` : ""}</span>${r ? `<span class="shrink-0 text-xs tabular-nums text-muted">${hhmm(r.at)}</span>` : ""}</li>`; }).join("")}</ul>`;
}
const caseCount = g => { const c = labCases(), ids = CASES[g][1].map(x => x[0]); return [ids.filter(i => c[i] && c[i].ok).length, ids.length, ids.some(i => c[i] && !c[i].ok)]; };
function labCard(group, desc, inner) {
  const [n, t, bad] = caseCount(group);
  return `<section class="rounded-xl border border-border bg-surface p-4 sm:p-5" id="lab-${group}"><div class="flex flex-wrap items-center gap-2"><h2 class="min-w-0 flex-1 text-base font-semibold">${CASES[group][0]}</h2>${tone(`${n}/${t} ca đạt`, n === t ? "ok" : bad ? "bad" : "neutral")}</div><p class="mt-1 text-pretty text-sm text-muted">${desc}</p>${inner}${caseList(group)}</section>`;
}
async function loadCitizens() {
  if (!Remote.v2 || LAB.loading) return; LAB.loading = true;
  try { LAB.citizens = await Remote.rpc("citizen_status", {}); } catch (e) { LAB.citizens = []; }
  LAB.loading = false; scheduleRender();
}
const KIND_TXT = { faceid: "FaceID", vneid: "VNeID", nfc: "NFC", passkey: "Passkey", doc: "Giấy tờ", qr: "QR", login: "Đăng nhập" };
function verifDetail(v) {
  const d = v.detail || {};
  if (v.kind === "faceid") return (d.enrolled ? "Lưu làm ảnh gốc" : `Tương đồng ${v.score ?? "–"}% · khoảng cách ${v.distance ?? "–"}`) + (v.liveness ? " · người thật" : "") + (v.method ? ` · ${v.method}` : "");
  if (v.kind === "nfc") return `${v.method || ""}${d.serial ? " · UID " + d.serial : ""}${d.text ? " · " + d.text : ""}`;
  if (v.kind === "qr") return `${d.code || ""} · ${({ ok: "hợp lệ", expired: `hết hạn (${d.age_seconds}s)`, forged: "sai chữ ký", static: "mã tĩnh" })[d.status] || d.status || ""}`;
  return `${v.method || ""}${d.msg ? " · " + d.msg : ""}`;
}
function vKiemThu() {
  if (Remote.v2 && !LAB.citizens) loadCitizens();
  if (!Nfc.supported() && !(labCases()["n-why"])) setCase("n-why", true, Nfc.why());
  const yes = (ok, a, b) => ok ? tone(a, "ok") : tone(b, "warn");
  const cap = [
    ["Máy chủ Supabase", netBadge()],
    ["Lưu kết quả xác thực (002)", yes(Remote.v2, "Đã có", "Chưa chạy 002")],
    ["Đăng nhập + QR ký (004)", yes(Remote.v4, "Đã có", "Chưa chạy 004")],
    ["Camera", LAB.cam == null ? tone("Đang kiểm tra", "neutral") : yes(LAB.cam, "Có", "Không có / chưa HTTPS")],
    [`Sinh trắc của máy (${esc(Passkey.label())})`, yes(PK.avail, "Dùng được", "Không có")],
    ["Web NFC", yes(Nfc.supported(), "Dùng được", "Không hỗ trợ")],
  ];
  const total = Object.keys(CASES).reduce((a, g) => { const [n, t] = caseCount(g); return [a[0] + n, a[1] + t]; }, [0, 0]);

  // FaceID
  const citizens = !Remote.v2 ? banner("warn", "", "Chạy migration 002 để ảnh gốc nằm trên máy chủ.") : !LAB.citizens ? `<div class="mt-3 grid gap-2">${skelRows(2, "h-10")}</div>` :
    `<div class="mt-3 overflow-hidden rounded-xl border border-border">${LAB.citizens.map(c => `<div class="flex items-center gap-3 border-b border-border px-3 py-2.5 last:border-0"><span class="min-w-0 flex-1"><span class="block text-sm font-medium">${esc(c.name)}</span><span class="block text-xs text-muted">${dmy(c.dob)}${c.has_template ? ` · ảnh gốc ${new Date(c.template_at).toLocaleString("vi-VN")} (${esc(c.template_source || "")})` : ""}</span></span>${c.has_template ? `${tone("Có ảnh gốc", "ok")}<button type="button" class="${B.icon} size-8" data-act="lab-reset-face" data-key="${c.key}" aria-label="Xoá ảnh gốc ${esc(c.name)}" title="Xoá để đăng ký lại">${ic("rotate-ccw")}</button>` : tone("Chưa có", "neutral")}</div>`).join("")}</div>`;
  const face = labCard("face", "Chọn hồ sơ dân cư mẫu, quét bằng camera máy này, điện thoại hoặc ảnh. Trình duyệt chỉ gửi vector 128 số; máy chủ so với ảnh gốc, lưu kết quả và trả về mã bản ghi.",
    `<div class="mt-4 flex flex-wrap items-center gap-3"><span class="text-sm text-muted">Kỳ vọng</span>${seg([["same", "Cùng người"], ["other", "Người khác"]], LAB.expect, "lab-expect")}<button type="button" class="${B.primary} ml-auto" data-act="lab-face">${ic("scan-face")}Quét & so khớp</button></div>
     <p class="mt-2 text-xs text-muted">Thử "Người khác": quét ảnh của một người khác với hồ sơ đã có ảnh gốc – hệ thống phải từ chối.</p>${citizens}`);

  // Haar
  const hs = LAB.haar.stats;
  const haar = labCard("haar", "Theo bài OpenCV: ảnh xám → face_cascade.detectMultiScale → tìm mắt trong vùng mặt. Haar chỉ tìm khuôn mặt (không biết là ai) – dùng để so tốc độ, đếm chớp mắt chống ảnh tĩnh.",
    `<div class="mt-4 flex flex-wrap gap-2">${LAB.haar.stop ? `<button type="button" class="${B.outline}" data-act="haar-stop">${ic("square")}Dừng camera</button>` : `<button type="button" class="${B.primary}" data-act="haar-cam" ${LAB.cam ? "" : "disabled"}>${ic("camera")}Mở camera</button>`}<label class="${B.outline}">${ic("image")}Chọn ảnh<input type="file" accept="image/*" id="haar-file" class="sr-only"></label></div>
     ${LAB.haar.err ? `<div class="mt-3">${banner("bad", "", esc(LAB.haar.err))}</div>` : ""}
     ${LAB.haar.stop ? `<div id="haar-stage" class="cam-stage mirror mt-3 aspect-[4/3] w-full max-w-[420px]"></div>` : LAB.haar.img ? `<img src="${LAB.haar.img}" alt="Kết quả Haar" class="mt-3 w-full max-w-[420px] rounded-xl">` : ""}
     <div class="mt-3 grid grid-cols-3 gap-2 text-center sm:grid-cols-6" id="haar-stats">${haarStats(hs)}</div>`);

  // QR
  const sm = LAB.qr.samples;
  const qrTile = (k, label, hint) => sm && sm[k] ? `<div class="grid justify-items-center gap-2 rounded-xl border border-border p-3 text-center"><div class="qr-box size-28">${qrSvg(sm[k], "H")}</div><p class="text-sm font-medium">${label}</p><p class="text-xs text-muted">${hint}</p><div class="flex gap-1"><button type="button" class="${B.outline} min-h-8 px-3 text-xs" data-act="qr-check" data-k="${k}">Kiểm tra</button><a class="${B.ghost} min-h-8 px-3 text-xs" download="qr-${k}.png" href="${qrPng(sm[k])}" aria-label="Tải ảnh PNG">${ic("download")}</a></div></div>` : "";
  const qr = labCard("qr", "Mã QR trên vé đổi mỗi 15 giây, máy chủ ký HMAC bằng khoá bí mật. Máy soát chỉ nhận mã có chữ ký đúng và chưa quá 30 giây – ảnh chụp màn hình gửi cho người khác sẽ bị từ chối.",
    !Remote.v4 ? `<div class="mt-4">${banner("warn", "Cần migration 004", "Chạy supabase/004_auth_qr.sql để bật QR ký bởi máy chủ.")}</div>` :
    `<div class="mt-4 flex flex-wrap gap-2"><button type="button" class="${B.primary}" data-act="qr-make" ${LAB.qr.busy ? "disabled" : ""}>${ic("qr-code")}${sm ? "Tạo lại mẫu" : "Tạo mẫu QR"}</button><label class="${B.outline} ${sm ? "" : "pointer-events-none opacity-50"}">${ic("image-up")}Quét từ ảnh<input type="file" accept="image/*" id="qr-file" class="sr-only" ${sm ? "" : "disabled"}></label><button type="button" class="${B.outline}" data-act="qr-cam" ${sm && LAB.cam ? "" : "disabled"}>${ic("camera")}Quét bằng camera</button></div>
     ${sm ? `<p class="mt-2 text-xs text-muted">Vé thử <b class="font-mono">${esc(sm.code)}</b> · mẫu tạo lúc ${hhmmss(sm.at)}. Tải PNG rồi dùng "Ảnh QR" ở màn Soát vé để thử như máy soát thật.</p><div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">${qrTile("ok", "Hợp lệ", "vừa ký")}${qrTile("expired", "Hết hạn", "ký 45 giây trước")}${qrTile("forged", "Bị sửa", "đổi mã vé")}${qrTile("static", "Mã tĩnh", "chỉ có mã vé")}</div>` : ""}
     ${LAB.qr.last ? `<div class="mt-3">${banner(LAB.qr.last.status === "ok" ? "ok" : LAB.qr.last.status === "static" ? "warn" : "bad", `Kết quả: ${({ ok: "hợp lệ", expired: "hết hạn", forged: "giả / bị sửa", static: "mã tĩnh" })[LAB.qr.last.status]}`, `${esc(LAB.qr.last.via)} · ${esc(LAB.qr.last.code)}${LAB.qr.last.age_seconds != null ? ` · ký cách đây ${LAB.qr.last.age_seconds} giây` : ""} · lưu bản ghi #${LAB.qr.last.record_id}`)}</div>` : ""}`);

  // NFC
  const n = LAB.nfc;
  const nfc = labCard("nfc", "Web NFC chỉ có trên Chrome Android. Đọc/ghi được thẻ NDEF (sticker, thẻ học sinh). Chip CCCD theo chuẩn ICAO 9303 phải mở khoá bằng MRZ (BAC/PACE) và lệnh APDU – chỉ app gốc như VNeID làm được, nên phần chip là mô phỏng.",
    `${Nfc.supported() ? `<div class="mt-4 flex flex-wrap items-center gap-2">${n.on ? `<button type="button" class="${B.outline}" data-act="nfc-stop">Dừng đọc</button><span class="text-sm text-muted">Đang chờ thẻ…</span>` : `<button type="button" class="${B.primary}" data-act="nfc-read">${ic("nfc")}Đọc thẻ</button>`}</div>
       ${n.err ? `<div class="mt-3">${banner("bad", "", esc(n.err))}</div>` : ""}${n.last ? `<div class="mt-3">${banner("ok", "Đã đọc thẻ", `UID ${esc(n.last.serial || "–")} · ${n.last.records.map(r => esc(r.type + ": " + r.text)).join(" · ") || "thẻ trống"}`)}</div>` : ""}
       <div class="mt-3 flex flex-wrap items-end gap-2"><div class="min-w-[180px] flex-1">${field("Ghi vào thẻ trống", input("nfc-text", (S.tickets.find(t => t.status === "valid") || {}).code || "", `placeholder="Mã vé, ví dụ VFN885V" class="${INPUT} font-mono"`))}</div><button type="button" class="${B.outline} min-h-11 md:min-h-10" data-act="nfc-write">Ghi thẻ</button></div>`
     : `<div class="mt-4">${banner("warn", "Thiết bị này không có Web NFC", esc(Nfc.why()))}</div>`}
     <div class="mt-4 flex flex-wrap items-end gap-2"><div class="min-w-[180px] flex-1">${field("Chip CCCD (mô phỏng)", selectBox("chip-key", IDENTITIES.map(i => [i.key, i.name]), LAB.chipKey || "an", { act: "chip-key" }))}</div><button type="button" class="${B.outline} min-h-11 md:min-h-10" data-act="lab-chip">Đọc chip</button></div>
     ${LAB.chip ? `<div class="mt-3 rounded-xl border border-border p-3 text-sm"><p><b>${esc(LAB.chip.name)}</b> · sinh ${dmy(LAB.chip.dob)} · ${ageAt(LAB.chip.dob, new Date())} tuổi</p><p class="text-xs text-muted">Số định danh ••••••••${esc(String(LAB.chip.id_number).slice(-4))}</p></div><div class="mt-2">${savedLine(LAB.chip.saved)}</div>` : ""}`);

  // VNeID + passkey
  const vn = labCard("vneid", "Liên kết VNeID: người dùng đồng ý chia sẻ họ tên, ngày sinh (không chia sẻ ảnh, số căn cước). Passkey: thiết bị ký bằng khoá riêng sau khi quét Face ID/vân tay – máy chủ chỉ giữ khoá công khai.",
    `<div class="mt-4 flex flex-wrap gap-2"><button type="button" class="${B.outline}" data-act="lab-vneid">${ic("badge-check")}Liên kết VNeID</button>${PK.avail ? `<button type="button" class="${B.outline}" data-act="lab-pk-create">${ic("fingerprint")}Tạo passkey</button><button type="button" class="${B.outline}" data-act="lab-pk-verify" ${LAB.pk ? "" : "disabled"}>Xác thực passkey</button>` : `<span class="self-center text-sm text-muted">Máy này không có sinh trắc tích hợp – thử trên điện thoại.</span>`}</div>`);

  const filters = [["all", "Tất cả"], ["faceid", "FaceID"], ["vneid", "VNeID"], ["qr", "QR"], ["nfc", "NFC"], ["passkey", "Passkey"], ["doc", "Giấy tờ"]];
  const vs = (S.verifs || []).filter(v => LAB.filter === "all" || v.kind === LAB.filter).slice(0, 40);
  const records = `<section class="mt-4 rounded-xl border border-border bg-surface">
    <div class="flex flex-wrap items-center gap-3 p-4 sm:px-5"><h2 class="min-w-0 flex-1 text-lg font-semibold">Bản ghi đã lưu trên Supabase</h2><span class="text-sm text-muted">${Remote.v2 ? "Cập nhật realtime" : "Chưa có bảng verifications"}</span></div>
    <div class="overflow-x-auto px-4 pb-3 scrollbar-clean sm:px-5"><div class="flex w-max items-center gap-2">${filters.map(([k, l]) => `<button type="button" data-act="lab-filter" data-v="${k}" aria-pressed="${LAB.filter === k}" class="h-8 cursor-pointer rounded-full px-3 text-sm ${LAB.filter === k ? "bg-foreground text-surface" : "bg-secondary text-foreground hover:bg-secondary-hover"}">${l}</button>`).join("")}</div></div>
    ${!Remote.v2 ? `<div class="px-4 pb-4 sm:px-5">${banner("warn", "", "Chạy migration 002 để thấy bản ghi tại đây.")}</div>` : !vs.length ? emptyState("database", "Chưa có bản ghi", "Thử quét khuôn mặt, QR hoặc NFC ở trên – mỗi lần quét hiện thêm một dòng ở đây.")
      : `<div id="lab-records">${vs.map(v => `<div class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-t border-border px-4 py-3 sm:grid-cols-[56px_72px_96px_80px_minmax(0,1fr)] sm:px-5" data-rec="${v.id}">
          <span class="font-mono text-sm font-medium">#${v.id}</span>
          <span class="text-xs tabular-nums text-muted sm:order-none">${hhmmss(v.created_at)} <span class="sm:hidden">· ${KIND_TXT[v.kind] || esc(v.kind)}</span></span>
          <span class="row-span-2 sm:row-span-1">${v.ok ? tone("Đạt", "ok") : tone("Không đạt", "bad")}</span>
          <span class="hidden text-sm sm:block">${KIND_TXT[v.kind] || esc(v.kind)}</span>
          <span class="col-span-2 min-w-0 text-xs text-muted sm:col-span-1 sm:text-sm sm:text-foreground"><span class="block truncate">${esc(v.account_name || "")}${v.citizen_key ? ` (${esc(v.citizen_key)})` : ""}${v.device_id === Remote.DEVICE ? " · máy này" : ""}</span><span class="block truncate text-xs text-muted">${esc(verifDetail(v))}</span></span>
        </div>`).join("")}</div>`}
  </section>`;

  const body = `<div class="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">${kpi("Ca đã đạt", `${total[0]}/${total[1]}`, "list-checks")}${kpi("Bản ghi hôm nay", (S.verifs || []).filter(v => dayKey(v.created_at) === dayKey(new Date())).length, "database")}${kpi("Camera", LAB.cam ? "Có" : LAB.cam === false ? "Không" : "…", "camera")}${kpi("Web NFC", Nfc.supported() ? "Có" : "Không", "nfc")}</div>
    <div class="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2 xl:items-start">
      <div class="grid gap-4">${face}${qr}${vn}</div>
      <div class="grid gap-4">${haar}${nfc}${card(`<h2 class="mb-3 text-base font-semibold">Thiết bị này</h2><div class="grid gap-2">${cap.map(([k, v]) => `<div class="flex items-center justify-between gap-3 text-sm"><span class="text-muted">${k}</span>${v}</div>`).join("")}</div><p class="mt-3 font-mono text-xs text-muted">Mã thiết bị ${esc(Remote.DEVICE)}</p>`)}</div>
    </div>${records}`;
  return staffShell("kiemthu", "Kiểm thử", "FaceID · Haar · QR · NFC · VNeID", `<button type="button" class="${B.ghost}" data-act="lab-clear">${ic("eraser")}<span class="hidden sm:inline">Xoá kết quả ca</span></button>`, body);
}
function haarStats(s) {
  const cell = (l, v) => `<div class="rounded-lg bg-background px-2 py-2"><p class="text-xs text-muted">${l}</p><p class="text-sm font-semibold tabular-nums">${v}</p></div>`;
  if (s && s.status) return `<p class="col-span-full text-sm text-muted">${esc(s.status)}</p>`;
  return [["Khung/giây", s && s.fps != null ? s.fps : "–"], ["Haar", s && s.ms != null ? s.ms + " ms" : "–"], ["TinyFace", s && s.tinyMs != null ? s.tinyMs + " ms" : "–"], ["Khuôn mặt", s ? s.faces : "–"], ["Mắt", s ? s.eyes : "–"], ["Chớp mắt", s && s.blinks != null ? s.blinks : "–"]].map(([l, v]) => cell(l, v)).join("");
}
