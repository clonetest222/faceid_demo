// CineVin – Edge Function `send-mail`: gửi mail vé đang chờ trong mail_outbox qua SMTP (Gmail) – không cần dịch vụ mail bên thứ ba.
// Web gọi sau khi thanh toán: supabase.functions.invoke("send-mail", { body: { token: <phiên khách>, ref: <mã đơn> } })
// Hàm lấy mail bằng RPC mail_take (service role, chỉ mail của chủ phiên), gửi, rồi báo kết quả bằng mail_mark.
// Deploy ngay trên Dashboard: Edge Functions → Deploy a new function → Via Editor → tên `send-mail` → dán file này → Deploy.
// Secrets (Edge Functions → Secrets):  SMTP_USER = gmail của bạn, SMTP_PASS = mật khẩu ứng dụng 16 ký tự (Google → Bảo mật → Xác minh 2 bước → Mật khẩu ứng dụng),
//   MAIL_FROM = "CineVin <gmail của bạn>" (tuỳ chọn). SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY có sẵn.
import { createClient } from "npm:@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { token, ref } = await req.json();
    if (!token) return json({ error: "missing token" }, 400);
    const user = Deno.env.get("SMTP_USER"), pass = Deno.env.get("SMTP_PASS");
    if (!user || !pass) return json({ error: "smtp_not_configured" }, 500);
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: rows, error } = await sb.rpc("mail_take", { p_token: token, p_ref: ref ?? null });
    if (error) return json({ error: error.message }, 400);
    if (!rows?.length) return json({ sent: [] });
    // địa chỉ gửi: bỏ dấu nháy / khoảng trắng thừa, lấy email trong <…>; sai dạng thì dùng SMTP_USER. Tên hiển thị chỉ giữ ASCII (thư viện SMTP kiểm tra chặt)
    const clean = (Deno.env.get("MAIL_FROM") || "").replace(/["'“”]/g, "").trim();
    const fm = clean.match(/<\s*([^<>\s]+@[^<>\s]+)\s*>/); const fromMail = (fm ? fm[1] : clean).trim();
    const okMail = (x: string) => /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(x);
    const fromName = (fm ? clean.slice(0, fm.index) : "").replace(/[^ -~]/g, "").trim() || "CineVin";
    const from = `${fromName} <${okMail(fromMail) ? fromMail : user.trim()}>`;
    const client = new SMTPClient({ connection: { hostname: Deno.env.get("SMTP_HOST") || "smtp.gmail.com", port: Number(Deno.env.get("SMTP_PORT") || 465), tls: true, auth: { username: user, password: pass } } });
    // tiêu đề: thư viện SMTP mã hoá chữ có dấu thành một encoded-word dài, Gmail hiện thô "=?utf-8?Q?…" → gửi tiêu đề không dấu (nội dung mail vẫn có dấu)
    const ascii = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D")
      .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, "...").replace(/[·–—]/g, "-").replace(/[^ -~]/g, "").replace(/\s+/g, " ").trim();
    const out: { id: number; ok: boolean; error?: string }[] = [];
    for (const m of rows) {
      try {
        await client.send({ from, to: m.to_email.trim(), subject: ascii(m.subject), content: "auto", html: m.html });
        await sb.rpc("mail_mark", { p_id: m.id, p_ok: true, p_error: null }); out.push({ id: m.id, ok: true });
      } catch (e) {
        const msg = String((e as Error)?.message || e).slice(0, 300);
        await sb.rpc("mail_mark", { p_id: m.id, p_ok: false, p_error: msg }); out.push({ id: m.id, ok: false, error: msg });
      }
    }
    try { await client.close(); } catch { /* bỏ qua */ }
    return json({ sent: out });
  } catch (e) { return json({ error: String((e as Error)?.message || e) }, 400); }
});
