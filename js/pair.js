/* Pair – chuyển bước quét khuôn mặt sang điện thoại theo thời gian thực (WebRTC qua PeerJS).
   Máy tính tạo mã 6 ký tự + QR; điện thoại mở link ?pair=MÃ, chạy FaceID bằng camera của nó,
   kết quả trả ngay về máy tính. Không cần backend riêng; khi có Supabase có thể thay bằng Realtime channel. */
"use strict";
const Pair = (() => {
  const PREFIX = "cinevin-v1-";
  const newCode = () => rid("", 6);
  const ok = () => typeof Peer === "function";

  /** Máy tính: chờ điện thoại kết nối. job gửi sang điện thoại. */
  function host(job, { onStatus, onResult }) {
    if (!ok()) { onStatus("error", "Không tải được PeerJS"); return { close() {} }; }
    const code = newCode();
    const peer = new Peer(PREFIX + code, { debug: 0 });
    let conn = null, done = false;
    peer.on("open", () => onStatus("ready", code));
    peer.on("error", e => onStatus("error", e.type === "network" || e.type === "server-error" ? "Mất kết nối máy chủ ghép nối" : e.type));
    peer.on("connection", c => {
      if (conn) { c.close(); return; }
      conn = c;
      c.on("open", () => { onStatus("connected"); c.send({ type: "job", job }); });
      c.on("data", d => {
        if (d && d.type === "progress") onStatus("progress", d.text);
        if (d && d.type === "result" && !done) { done = true; onResult(d.result); setTimeout(() => peer.destroy(), 800); }
      });
      c.on("close", () => { if (!done) onStatus("lost"); conn = null; });
    });
    return { code, url: baseUrl() + "?pair=" + code, close() { done = true; try { peer.destroy(); } catch (e) {} } };
  }

  /** Điện thoại: kết nối tới máy tính theo mã. */
  function join(code, { onStatus, onJob }) {
    if (!ok()) { onStatus("error", "Không tải được PeerJS"); return; }
    const peer = new Peer({ debug: 0 });
    peer.on("error", e => onStatus("error", e.type === "peer-unavailable" ? "Không tìm thấy máy tính với mã này. Mã có thể đã hết hạn." : e.type));
    peer.on("open", () => {
      const c = peer.connect(PREFIX + code.toUpperCase(), { reliable: true });
      c.on("open", () => onStatus("connected"));
      c.on("data", d => {
        if (d && d.type === "job") onJob(d.job, {
          progress: t => c.send({ type: "progress", text: t }),
          result: r => { c.send({ type: "result", result: r }); setTimeout(() => peer.destroy(), 1500); },
        });
      });
      c.on("close", () => onStatus("closed"));
    });
  }
  return { host, join };
})();
