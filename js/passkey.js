/* Passkey – dùng Face ID (iPhone), vân tay/khuôn mặt (Android), Windows Hello… qua chuẩn WebAuthn.
   Web KHÔNG nhận dữ liệu khuôn mặt: thiết bị tự xác thực rồi ký một "challenge" bằng khoá riêng nằm trong chip bảo mật.
   Ở đây chữ ký được kiểm tra bằng WebCrypto ngay trong trình duyệt (bản demo); khi triển khai thật bước kiểm tra
   này chạy ở máy chủ (ví dụ Supabase Edge Function) với khoá công khai đã lưu. */
"use strict";
const Passkey = (() => {
  const enc = new TextEncoder();
  const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unb64u = s => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
  const rand = n => crypto.getRandomValues(new Uint8Array(n));
  const sha256 = async data => new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

  /** Thiết bị có trình xác thực tích hợp (Face ID, vân tay, Windows Hello) không */
  async function available() {
    try { return !!(window.PublicKeyCredential && window.isSecureContext && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); }
    catch (e) { return false; }
  }
  const label = () => /iPhone|iPad/.test(navigator.userAgent) ? "Face ID / Touch ID" : /Mac/.test(navigator.userAgent) ? "Touch ID" : /Android/.test(navigator.userAgent) ? "vân tay / khuôn mặt" : /Windows/.test(navigator.userAgent) ? "Windows Hello" : "khoá sinh trắc của thiết bị";

  // ---- CBOR tối giản để đọc khoá COSE khi trình duyệt không có getPublicKey() ----
  function cbor(buf) {
    let p = 0; const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const len = ai => ai < 24 ? ai : ai === 24 ? dv.getUint8(p++) : ai === 25 ? (p += 2, dv.getUint16(p - 2)) : ai === 26 ? (p += 4, dv.getUint32(p - 4)) : (() => { throw new Error("cbor"); })();
    function item() {
      const b = dv.getUint8(p++), mt = b >> 5, ai = b & 31;
      if (mt === 0) return len(ai);
      if (mt === 1) return -1 - len(ai);
      if (mt === 2) { const n = len(ai); const v = buf.slice(p, p + n); p += n; return v; }
      if (mt === 3) { const n = len(ai); const v = new TextDecoder().decode(buf.slice(p, p + n)); p += n; return v; }
      if (mt === 4) { const n = len(ai); return Array.from({ length: n }, item); }
      if (mt === 5) { const n = len(ai), m = new Map(); for (let i = 0; i < n; i++) { const k = item(); m.set(k, item()); } return m; }
      if (mt === 7) return ai === 20 ? false : ai === 21 ? true : null;
      throw new Error("cbor type " + mt);
    }
    return { item, get pos() { return p; } };
  }
  /** Lấy khoá công khai dạng JWK từ phản hồi đăng ký */
  async function publicJwk(resp, alg) {
    if (resp.getPublicKey) {
      const spki = resp.getPublicKey();
      if (spki) {
        const k = alg === -7 ? await crypto.subtle.importKey("spki", spki, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"])
          : await crypto.subtle.importKey("spki", spki, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, true, ["verify"]);
        return crypto.subtle.exportKey("jwk", k);
      }
    }
    const att = cbor(new Uint8Array(resp.attestationObject)).item();
    const ad = att.get("authData");
    const credLen = (ad[53] << 8) | ad[54];
    const cose = cbor(ad.slice(55 + credLen)).item();
    if (cose.get(3) === -7) return { kty: "EC", crv: "P-256", x: b64u(cose.get(-2)), y: b64u(cose.get(-3)), ext: true };
    return { kty: "RSA", n: b64u(cose.get(-1)), e: b64u(cose.get(-2)), alg: "RS256", ext: true };
  }
  // chữ ký ECDSA từ WebAuthn ở dạng DER → dạng r||s 64 byte cho WebCrypto
  function derToRaw(der) {
    let p = 2; const rl = der[p + 1]; let r = der.slice(p + 2, p + 2 + rl); p += 2 + rl; const sl = der[p + 1]; let s = der.slice(p + 2, p + 2 + sl);
    const fix = x => { while (x.length > 32 && x[0] === 0) x = x.slice(1); const o = new Uint8Array(32); o.set(x, 32 - x.length); return o; };
    const out = new Uint8Array(64); out.set(fix(r), 0); out.set(fix(s), 32); return out;
  }

  /** Tạo passkey cho tài khoản (bật Face ID). Trả về bản ghi lưu được: {id, jwk, alg, rpId, createdAt, label} */
  async function register({ userKey, name }) {
    const opts = {
      publicKey: {
        challenge: rand(32),
        rp: { name: "CineVin" },
        user: { id: enc.encode(("cinevin-" + userKey).slice(0, 60)), name: name, displayName: name },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
        attestation: "none", timeout: 60000,
      },
    };
    const cred = await navigator.credentials.create(opts);
    const alg = cred.response.getPublicKeyAlgorithm ? cred.response.getPublicKeyAlgorithm() : -7;
    const jwk = await publicJwk(cred.response, alg);
    return { id: cred.id, jwk, alg, rpId: location.hostname, createdAt: new Date().toISOString(), label: label() };
  }

  /** Yêu cầu Face ID và kiểm tra chữ ký. reason chỉ để hiển thị trong log. Trả về {ok, message} */
  async function verify(pk) {
    const challenge = rand(32);
    let a;
    try {
      a = await navigator.credentials.get({ publicKey: { challenge, allowCredentials: [{ type: "public-key", id: unb64u(pk.id) }], userVerification: "required", timeout: 60000 } });
    } catch (e) { return { ok: false, message: e.name === "NotAllowedError" ? "Đã huỷ hoặc không xác thực được." : "Thiết bị không dùng được passkey: " + e.message }; }
    const r = a.response, cd = JSON.parse(new TextDecoder().decode(r.clientDataJSON)), ad = new Uint8Array(r.authenticatorData);
    if (cd.type !== "webauthn.get") return { ok: false, message: "Sai loại phản hồi." };
    if (cd.challenge !== b64u(challenge)) return { ok: false, message: "Challenge không khớp (chống phát lại)." };
    if (cd.origin !== location.origin) return { ok: false, message: "Sai nguồn trang." };
    if (!eq(ad.slice(0, 32), await sha256(enc.encode(pk.rpId)))) return { ok: false, message: "Sai tên miền đăng ký." };
    if (!(ad[32] & 0x04)) return { ok: false, message: "Thiết bị chưa xác minh sinh trắc / mật mã." };
    const signed = new Uint8Array(ad.length + 32); signed.set(ad, 0); signed.set(await sha256(r.clientDataJSON), ad.length);
    let ok;
    if (pk.alg === -7) {
      const key = await crypto.subtle.importKey("jwk", pk.jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
      ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, derToRaw(new Uint8Array(r.signature)), signed);
    } else {
      const key = await crypto.subtle.importKey("jwk", pk.jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
      ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, r.signature, signed);
    }
    return ok ? { ok: true, message: "Chữ ký hợp lệ" } : { ok: false, message: "Chữ ký không hợp lệ." };
  }
  return { available, register, verify, label };
})();
