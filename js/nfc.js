/* Nfc – Web NFC (Chrome trên Android). Đọc/ghi thẻ NDEF: sticker NFC, thẻ học sinh, thẻ vé.
   Không đọc được chip CCCD: chip theo chuẩn ICAO 9303 cần mở khoá BAC/PACE bằng dải MRZ và lệnh APDU,
   trình duyệt không cho làm – chỉ app gốc (như VNeID, app ngân hàng) mới đọc được. */
"use strict";
const Nfc = (() => {
  const supported = () => "NDEFReader" in window && window.isSecureContext;
  const decode = rec => {
    try {
      if (rec.recordType === "text") return new TextDecoder(rec.encoding || "utf-8").decode(rec.data);
      if (rec.recordType === "url" || rec.recordType === "absolute-url") return new TextDecoder().decode(rec.data);
      return `(${rec.recordType}, ${rec.data ? rec.data.byteLength : 0} byte)`;
    } catch (e) { return "(không giải mã được)"; }
  };
  /** Bắt đầu nghe thẻ. Trả về hàm dừng. onTag({serial, records:[{type,text}], text}) */
  async function read({ onTag, onError }) {
    const reader = new NDEFReader(), ctrl = new AbortController();
    await reader.scan({ signal: ctrl.signal });
    reader.onreading = e => { const records = [...e.message.records].map(r => ({ type: r.recordType, text: decode(r) })); onTag({ serial: e.serialNumber || "", records, text: (records.find(r => r.type === "text") || records[0] || {}).text || "" }); };
    reader.onreadingerror = () => onError("Không đọc được nội dung thẻ. Thẻ không chứa dữ liệu NDEF (chip CCCD, thẻ ngân hàng) hoặc chạm chưa đủ lâu.");
    return () => ctrl.abort();
  }
  /** Ghi một dòng chữ (mã vé / mã thẻ học sinh) vào thẻ NFC trống */
  async function write(text) { await new NDEFReader().write({ records: [{ recordType: "text", lang: "vi", data: text }] }); }
  const why = () => !window.isSecureContext ? "Trang phải chạy HTTPS." : /iPhone|iPad/.test(navigator.userAgent) ? "Safari trên iPhone/iPad chưa hỗ trợ Web NFC (Apple chỉ mở NFC cho app gốc)." : "Trình duyệt này chưa hỗ trợ Web NFC – dùng Chrome trên Android.";
  return { supported, read, write, why };
})();
