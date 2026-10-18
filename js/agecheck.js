/* Kiểm tra tuổi tại cửa / quầy bằng giấy tờ điện tử – dùng chung cho Soát vé, Bán tại quầy, Kiểm thử.
   Bốn cách, đều tự tính tuổi TẠI NGÀY CHIẾU và so với nhãn phim:
   1. QR trên mặt sau thẻ căn cước gắn chip (camera)   2. Ảnh chụp QR căn cước
   3. Chip căn cước qua NFC (mô phỏng – web chưa đọc được chip ICAO 9303)   4. FaceID qua VNeID
   Chống mượn vé: so họ tên trên giấy tờ với tên người xem ghi trên vé (nếu vé có tên).
   Rạp chỉ lưu: đạt/không, tuổi, cách kiểm, 4 số cuối định danh – không lưu ảnh, không lưu số định danh đầy đủ. */
"use strict";
/* Mã QR căn cước: số định danh|số CMND cũ|họ tên|ngày sinh ddmmyyyy|giới tính|địa chỉ|ngày cấp ddmmyyyy */
function parseCccd(text) {
  const p = String(text || "").split("|");
  if (p.length < 6 || !/^\d{12}$/.test(p[0]) || !/^\d{8}$/.test(p[3])) return null;
  const dob = `${p[3].slice(4)}-${p[3].slice(2, 4)}-${p[3].slice(0, 2)}`;
  if (isNaN(new Date(dob))) return null;
  return { id: p[0], name: p[2].trim(), dob, sex: p[4], issued: p[6] || "" };
}
const CCCD_IDS = { an: "040204001234", binh: "040311005678", cuc: "040158009012", gv: "040190003456" };
/** QR căn cước mẫu cho hồ sơ dân cư mô phỏng (để thử khi không có thẻ thật) */
function cccdSample(key) {
  const i = IDENTITIES.find(x => x.key === key), d = i.dob.split("-");
  return `${CCCD_IDS[key]}||${i.name}|${d[2]}${d[1]}${d[0]}|${key === "binh" || key === "cuc" || key === "gv" ? "Nữ" : "Nam"}|Phường Hưng Dũng, TP Vinh, Nghệ An|01062021`;
}
const normName = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/\s+/g, " ").trim();
/** Đánh giá một người theo nhãn phim tại ngày chiếu */
function judgeAge(person, rating, when, expectName) {
  const age = ageAt(person.dob, when), min = RATINGS[rating] || 0;
  const nameKnown = expectName && !/^(Người đi cùng|Khách tại quầy|Vé kiểm thử)/.test(expectName) && !/chưa xác thực/.test(expectName);
  const nameMatch = !nameKnown || normName(person.name) === normName(expectName);
  if (min && age < min) return { ok: false, age, min, nameMatch, nameKnown, reason: `Chưa đủ ${min} tuổi tại ngày chiếu (${age} tuổi)` };
  if (rating === "K" && age < 13) return { ok: null, age, min, nameMatch, nameKnown, reason: "Phim K: dưới 13 tuổi – chỉ cho vào khi có cha mẹ/người giám hộ đi cùng" };
  if (!nameMatch) return { ok: null, age, min, nameMatch, nameKnown, reason: `Tên trên giấy tờ (${person.name}) khác tên trên vé (${expectName}) – có thể vé mua hộ hoặc mượn vé` };
  return { ok: true, age, min, nameMatch, nameKnown, reason: min ? `Đủ ${min} tuổi (${age} tuổi tại ngày chiếu)` : `${age} tuổi` };
}
/**
 * Mở hộp thoại kiểm tra tuổi.
 * opts: { rating, when, expectName, title, mode?: 'qr-cam'|'qr-img'|'chip'|'face', onResult(r), onBad?(msg) }
 * r: { ok, age, name, dob, method, idLast4, reason, recordId }
 */
function openAgeCheck(opts) {
  const { rating, when, expectName = "", title = "Kiểm tra tuổi", onResult = () => {}, onBad = () => {} } = opts;
  const min = RATINGS[rating] || 0;
  const sub = `Phim ${rating} – ${esc(RATING_TXT[rating] || "")}${min ? " tại ngày chiếu " + ddmm(when) : ""}${expectName ? ` · vé của <b class="text-foreground">${esc(expectName)}</b>` : ""}`;
  let stop = null;
  const sh = openSheet("", { label: title, wide: true, onClose: () => { stop && stop(); } });
  const halt = () => { stop && stop(); stop = null; };
  const choose = () => { halt(); sh.set(`${sheetHead(title, sub)}
    <div class="grid gap-2 sm:grid-cols-2">
      ${choiceCard("qr-cam", "scan-qr-code", "Quét QR trên căn cước", "Mặt sau thẻ căn cước gắn chip có mã QR chứa họ tên và ngày sinh. Dùng camera sau.")}
      ${choiceCard("qr-img", "image", "Chọn ảnh QR căn cước", "Ảnh chụp mặt sau thẻ, hoặc ảnh QR khách gửi trên điện thoại.")}
      ${choiceCard("chip", "nfc", "Chạm chip căn cước (NFC)", "Mô phỏng: web chưa đọc được chip – cần app gốc như VNeID.")}
      ${choiceCard("face", "scan-face", "FaceID qua VNeID", "Khách đồng ý chia sẻ ngày sinh, đối chiếu khuôn mặt với ảnh gốc.")}
    </div>
    <p class="text-pretty text-xs text-muted">Rạp chỉ ghi đạt/không, tuổi, cách kiểm và 4 số cuối định danh – không lưu ảnh hay số giấy tờ đầy đủ.</p>`); };
  const show = (person, method, extra = {}) => {
    halt();
    const j = judgeAge(person, rating, when, expectName);
    const t = j.ok === true ? "ok" : j.ok === false ? "bad" : "warn";
    const res = { ...j, name: person.name, dob: person.dob, method, idLast4: person.id ? String(person.id).slice(-4) : "", key: extra.key || null };
    sh.set(`${sheetHead(title, sub)}
      <div class="flex items-start gap-4 rounded-xl border border-border p-4" data-age-result="${t}">
        <span class="grid size-12 shrink-0 place-items-center rounded-xl ${TONE[t]}">${ic(t === "ok" ? "check" : t === "bad" ? "x" : "triangle-alert", "size-6")}</span>
        <div class="min-w-0 flex-1"><p class="text-lg font-semibold ${t === "ok" ? "text-success" : t === "bad" ? "text-err" : "text-warning"}">${t === "ok" ? "Đủ điều kiện" : t === "bad" ? "Không đủ tuổi" : "Cần nhân viên quyết định"}</p>
          <p class="mt-1 text-sm"><b>${esc(person.name)}</b> · sinh ${dmy(person.dob)} · <b>${j.age} tuổi</b> tại ngày chiếu</p>
          <p class="mt-1 text-pretty text-sm">${esc(j.reason)}</p>
          <p class="mt-1 text-xs text-muted">Qua ${esc(method)}${res.idLast4 ? ` · định danh ••••••••${esc(res.idLast4)}` : ""}${j.nameKnown ? (j.nameMatch ? " · tên khớp với vé" : "") : " · vé không ghi tên người xem"}</p></div></div>
      <div class="flex flex-wrap gap-2">${j.ok === false ? `<button type="button" class="${B.primary}" data-m="deny">Từ chối</button>` : j.ok === true ? `<button type="button" class="${B.primary}" data-m="allow">Cho vào</button>` : `<button type="button" class="${B.primary}" data-m="allow">Đã xác minh – cho vào</button><button type="button" class="${B.outline}" data-m="deny">Từ chối</button>`}<button type="button" class="${B.ghost}" data-m="choose">Kiểm cách khác</button></div>`);
    sh.el.dataset.result = JSON.stringify(res);
  };
  const finish = async allow => {
    const r = JSON.parse(sh.el.dataset.result || "{}"); r.ok = allow;
    const saved = await logVerif("doc", allow, { key: r.key, method: r.method, detail: { rating, age: r.age, id: r.idLast4 ? "••••" + r.idLast4 : null, name_match: r.nameMatch, msg: r.reason } });
    r.recordId = saved && saved.id;
    log("doc", `Kiểm tuổi ${rating} qua ${r.method}: ${r.name}, ${r.age} tuổi – ${allow ? "cho vào" : "từ chối"}`, allow);
    sh.close(); onResult(r);
  };
  const fromQr = (text, via) => {
    const c = parseCccd(text);
    if (!c) { onBad("Mã QR không phải QR căn cước"); halt(); sh.set(`${sheetHead(title, sub)}${banner("bad", "Không phải mã QR căn cước", "Mã đọc được không theo định dạng QR trên thẻ căn cước gắn chip (số định danh|…|họ tên|ngày sinh|…). Thử lại hoặc kiểm cách khác.")}<div class="flex flex-wrap gap-2"><button type="button" class="${B.primary}" data-m="${via}">Thử lại</button><button type="button" class="${B.ghost}" data-m="choose">Kiểm cách khác</button></div>`); return; }
    const key = Object.keys(CCCD_IDS).find(k => CCCD_IDS[k] === c.id) || null;
    show(c, via === "qr-cam" ? "QR căn cước (camera)" : "QR căn cước (ảnh)", { key });
  };
  const run = m => {
    halt();
    if (m === "qr-cam") {
      sh.set(`${sheetHead("Quét QR trên căn cước", sub)}<div class="cam-stage aspect-[4/3] w-full" id="age-stage"><div class="frame"></div></div><p class="text-sm text-muted" id="age-msg">Đưa mã QR ở mặt sau thẻ căn cước vào khung.</p><button type="button" class="${B.ghost}" data-m="choose">Kiểm cách khác</button>`);
      stop = Scan.start($("#age-stage", sh.el), code => { stop = null; fromQr(code, "qr-cam"); }, err => { const x = $("#age-msg", sh.el); if (x) { x.textContent = err + " Dùng “Chọn ảnh QR căn cước”."; x.className = "text-sm text-[var(--error-text)]"; } });
    } else if (m === "qr-img") {
      sh.set(`${sheetHead("Chọn ảnh QR căn cước", sub)}<label class="drop grid cursor-pointer place-items-center gap-3 rounded-xl border border-dashed border-border-strong bg-surface px-4 py-10 text-center hover:bg-surface-hover"><span class="grid size-11 place-items-center rounded-xl bg-secondary text-muted">${ic("image-up", "size-5")}</span><span class="text-sm font-medium">Chọn ảnh mặt sau thẻ căn cước</span><span class="text-xs text-muted">Ảnh chỉ đọc trong trình duyệt, không gửi đi, không lưu.</span><input type="file" accept="image/*" id="age-file" class="sr-only"></label><p class="text-sm text-muted" id="age-msg"></p><button type="button" class="${B.ghost}" data-m="choose">Kiểm cách khác</button>`);
    } else if (m === "chip") {
      sh.set(`${sheetHead("Chip căn cước (NFC)", sub)}${banner("warn", "Mô phỏng", "Chip căn cước theo chuẩn ICAO 9303: phải mở khoá bằng dải MRZ (BAC/PACE) rồi gửi lệnh APDU – trình duyệt chưa làm được, chỉ app gốc (VNeID, app ngân hàng). Dưới đây mô phỏng dữ liệu chip trả về.")}
        ${field("Thẻ khách chạm", selectBox("age-chip", IDENTITIES.map(i => [i.key, `${i.name} – ${i.note}`]), "an"))}
        <div class="flex flex-wrap gap-2"><button type="button" class="${B.primary}" data-m="chip-read">${ic("nfc")}Đọc chip</button><button type="button" class="${B.ghost}" data-m="choose">Kiểm cách khác</button></div>`);
    } else if (m === "face") {
      sh.close();
      verifyFace({ who: "gate-viewer", title: "Kiểm tuổi qua VNeID + FaceID", onDone(id) {
        const j = judgeAge({ name: id.name, dob: id.dob }, rating, when, expectName);
        // FaceID đã đối chiếu đúng người: không đủ tuổi thì từ chối luôn; đủ tuổi (kể cả lệch tên vé) để nhân viên quyết
        const allow = j.ok !== false;
        logVerif("doc", allow, { key: id.key, method: "VNeID + FaceID", detail: { rating, age: j.age, name_match: j.nameMatch, msg: j.reason } });
        log("doc", `Kiểm tuổi ${rating} qua VNeID + FaceID: ${id.name}, ${j.age} tuổi – ${allow ? "cho vào" : "từ chối"}`, allow);
        setTimeout(() => onResult({ ...j, ok: allow, name: id.name, dob: id.dob, method: "VNeID + FaceID", key: id.key }), 0);
      } });
    }
  };
  sh.el.addEventListener("click", async e => {
    const a = e.target.closest("[data-m]"); if (!a || a.getAttribute("aria-disabled") === "true") return;
    const m = a.dataset.m;
    if (m === "close") return sh.close();
    if (m === "choose") return choose();
    if (m === "allow") return finish(true);
    if (m === "deny") return finish(false);
    if (m === "chip-read") {
      const key = selVal("age-chip") || "an"; let d = null;
      if (Remote.v2) { try { d = await Remote.rpc("mock_chip_read", { p_key: key }); } catch (err) {} }
      if (!d) { const i = IDENTITIES.find(x => x.key === key); d = { name: i.name, dob: i.dob, id_number: CCCD_IDS[key] }; }
      return show({ name: d.name, dob: d.dob, id: d.id_number }, "chip căn cước (mô phỏng)", { key });
    }
    run(m);
  });
  sh.el.addEventListener("change", async e => {
    if (e.target.id !== "age-file" || !e.target.files[0]) return;
    const msg = $("#age-msg", sh.el); if (msg) msg.textContent = "Đang đọc mã QR…";
    const t = await decodeQrImage(e.target.files[0]);
    if (!t) { onBad("Không thấy mã QR trong ảnh"); if (msg) { msg.textContent = "Không thấy mã QR trong ảnh – chụp rõ, đủ sáng rồi thử lại."; msg.className = "text-sm text-[var(--error-text)]"; } return; }
    fromQr(t, "qr-img");
  });
  opts.mode ? run(opts.mode) : choose();
  return sh;
}
