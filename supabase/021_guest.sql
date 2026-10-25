-- CineVin – migration 021: mua vé KHÔNG CẦN TÀI KHOẢN (khách vãng lai), xác nhận email bằng mã OTP của Supabase Auth, gửi vé về email.
-- Chạy SAU 020. Chạy lại nhiều lần không sao.
--   • Khách chọn suất, chọn ghế (giữ ghế không cần đăng nhập) → ở bước thanh toán nhập email + họ tên (SĐT tuỳ chọn)
--     → guest_email_check(): kiểm định dạng, CHẶN EMAIL DÙNG MỘT LẦN (bảng email_blocklist), email đã có tài khoản thật → mời đăng nhập
--     → web gọi Supabase Auth signInWithOtp → Supabase gửi mã 6 số (SMTP tuỳ chỉnh = Gmail của bạn)
--     → verifyOtp → guest_verify_auth() đọc email đã xác minh trong JWT → tài khoản khách ẩn (g_<băm email>, guest = true, 0 điểm) + phiên 2 giờ.
--   • Chế độ demo (otp_mode = 'demo', mặc định khi chưa cấu hình SMTP): máy chủ tự sinh mã, trả về cho web hiện trên trang.
--   • Thanh toán xong, khách có email nhận MAIL VÉ: xếp vào mail_outbox; Edge Function `send-mail` (supabase/functions/send-mail)
--     lấy bằng mail_take(), gửi qua SMTP Gmail, báo kết quả bằng mail_mark(). Chưa deploy function → mail 'pending', web vẫn xem được nội dung.
--   • Tra cứu vé: mã vé / mã đơn + email → phiên khách 2 giờ → QR, mua thêm, hoàn vé.
--   • Đăng ký tài khoản bằng đúng email đã mua vãng lai → vé chuyển sang tài khoản mới.
-- BẬT GỬI MAIL THẬT (xem README mục "Mua vé không cần tài khoản"): Authentication → Emails → SMTP Settings (Gmail + mật khẩu ứng dụng),
--   Authentication → Emails → Templates → Magic Link thêm {{ .Token }}, deploy Edge Function send-mail với secret SMTP_USER / SMTP_PASS, rồi:
--   update app_config set v = 'auth' where k = 'otp_mode';
--   update app_config set v = 'https://clonetest222.github.io/faceid_demo/' where k = 'site_url';
--   Theo dõi mail: select id, to_email, status, error, created_at from mail_outbox order by id desc;

alter table public.app_users add column if not exists guest boolean not null default false;

create table if not exists public.app_config (k text primary key, v text);
alter table public.app_config enable row level security;
insert into public.app_config (k, v) values
  ('site_url', 'https://clonetest222.github.io/faceid_demo/'),
  ('otp_mode', 'demo')                                   -- 'demo' (mã hiện trên trang) | 'auth' (Supabase Auth gửi mã qua SMTP đã cấu hình)
on conflict (k) do nothing;
delete from public.app_config where k in ('mail_from', 'mail_provider');   -- bản trước (Brevo/Resend) không dùng nữa
drop function if exists public.mail_dispatch(); drop function if exists public.mail_sync(); drop function if exists public.mail_ready();
drop function if exists public.guest_start(text, text, text); drop function if exists public.guest_otp_send(text, text, text);

create table if not exists public.mail_outbox (
  id bigint generated always as identity primary key,
  to_email text not null, to_name text, username text,
  subject text not null, html text not null,
  kind text not null default 'ticket', ref text,                 -- ref = mã đơn
  status text not null default 'pending' check (status in ('pending', 'queued', 'sent', 'failed')),
  request_id bigint, error text,
  created_at timestamptz not null default now(), sent_at timestamptz
);
create index if not exists mail_outbox_user on public.mail_outbox (username, id desc);
alter table public.mail_outbox enable row level security;   -- không policy: chỉ qua hàm

-- email dùng một lần: chặn theo tên miền (và tên miền con)
create table if not exists public.email_blocklist (domain text primary key, note text, created_at timestamptz not null default now());
alter table public.email_blocklist enable row level security;
insert into public.email_blocklist (domain, note) select d, 'email dùng một lần' from unnest(array[
  '10minutemail.com','10minutemail.net','10minemail.com','10mail.org','20minutemail.com','minuteinbox.com','tempmail.com','temp-mail.org','temp-mail.io',
  'tempmail.net','tempmail.plus','tempmail.dev','tempmail.ninja','tempmailo.com','tempmailaddress.com','tempr.email','tempail.com','tempemail.co','tempinbox.com',
  'tempsky.com','tmpmail.org','tmpmail.net','tmail.ws','tmails.net','mailtemp.net','mailtemp.top','mail-temp.com','emltmp.com','mytemp.email',
  'guerrillamail.com','guerrillamail.net','guerrillamail.org','guerrillamail.biz','guerrillamail.de','guerrillamail.info','guerrillamailblock.com','sharklasers.com','grr.la','spam4.me',
  'mailinator.com','mailinator.net','maildrop.cc','yopmail.com','yopmail.fr','yopmail.net','cool.fr.nf','jetable.fr.nf','nospam.ze.tc','nomail.xl.cx',
  'mega.zik.dj','speed.1s.fr','courriel.fr.nf','moncourrier.fr.nf','monemail.fr.nf','monmail.fr.nf','discard.email','dispostable.com','fakeinbox.com','fakemail.net',
  'getnada.com','nada.email','mohmal.com','mohmal.in','throwawaymail.com','throwam.com','trashmail.com','trashmail.me','trashmail.net','trash-mail.com',
  'kurzepost.de','objectmail.com','proxymail.eu','rcpt.at','wegwerfmail.de','wegwerfmail.net','wegwerfmail.org','mailnesia.com','mailcatch.com','mintemail.com',
  'burnermail.io','emailondeck.com','inboxkitten.com','harakirimail.com','spamgourmet.com','mailexpire.com','mailsac.com','emailfake.com','generator.email','crazymailing.com',
  '33mail.com','anonbox.net','luxusmail.org','1secmail.com','1secmail.net','1secmail.org','esiix.com','wwjmp.com','xojxe.com','yoggm.com',
  'dropmail.me','spymail.one','firemailbox.club','mailpoof.com','emailtemporanea.com','correotemporal.org','mailnull.com','spamfree24.org','mailtothis.com','bupmail.com',
  'zetmail.com','getairmail.com','mailhazard.com','inboxbear.com','pokemail.net','spam.la','mailme.lv','instantemailaddress.com','moakt.com','moakt.cc',
  'disbox.net','eyepaste.com','meltmail.com','incognitomail.com','mailforspam.com','spamherelots.com','mailzilla.com','filzmail.com','deadaddress.com','emailsensei.com',
  'mailscrap.com','jnxjn.com','cuvox.de','dayrep.com','einrot.com','fleckens.hu','gustr.com','jourrapide.com','rhyta.com','superrito.com','teleworm.us','armyspy.com'
]) d on conflict (domain) do nothing;

-- kiểm tra email: định dạng + không thuộc danh sách dùng một lần
create or replace function public._email_check(p_email text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text := nullif(lower(trim(coalesce(p_email, ''))), ''); d text;
begin
  if v is null or v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'bad_email'; end if;
  d := split_part(v, '@', 2);
  if exists (select 1 from email_blocklist b where d = b.domain or d like '%.' || b.domain) then raise exception 'email_disposable'; end if;
  return v;
end $$;

-- yêu cầu mua vãng lai đang chờ xác nhận: tên/SĐT khách khai + (chế độ demo) mã băm bcrypt, 10 phút, 5 lần thử
create table if not exists public.email_otps (
  id bigint generated always as identity primary key,
  email text not null, code_hash text not null default '', name text, phone text,
  attempts int not null default 0, expires_at timestamptz not null, used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.email_otps alter column code_hash set default '';
create index if not exists email_otps_email on public.email_otps (email, id desc);
alter table public.email_otps enable row level security;

-- phiên: thêm cờ khách vãng lai
create or replace function public._session_json(p_token uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('token', s.token, 'username', u.username, 'role', u.role, 'name', u.display_name, 'expires_at', s.expires_at,
    'email', u.email, 'phone', u.phone, 'citizen_key', u.citizen_key, 'dob', u.dob, 'vneid_verified_at', u.vneid_verified_at,
    'vneid_method', u.vneid_method, 'points', u.points, 'confirm_every', u.confirm_every, 'cinema_id', u.cinema_id, 'guest', u.guest)
  from sessions s join app_users u on u.username = s.username where s.token = p_token;
$$;

-- tạo / dùng lại tài khoản khách theo email (dùng chung cho hai chế độ)
create or replace function public._guest_session(p_email text, p_name text, p_phone text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u app_users; t uuid; v_user text; v_phone text := p_phone;
begin
  select * into u from app_users where lower(email) = p_email;
  if u.username is not null and not u.guest then raise exception 'email_registered'; end if;
  if u.username is not null and not coalesce(u.active, true) then raise exception 'account_disabled'; end if;
  if v_phone is not null and exists (select 1 from app_users where phone = v_phone and username is distinct from u.username) then v_phone := null; end if;
  if u.username is null then
    v_user := 'g_' || left(md5(p_email), 12);
    insert into app_users (username, pass_hash, role, display_name, email, phone, points, guest)
    values (v_user, extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf', 8)), 'khach', coalesce(nullif(p_name, ''), 'Khách'), p_email, v_phone, 0, true);
  else
    v_user := u.username;
    update app_users set display_name = coalesce(nullif(p_name, ''), display_name), phone = coalesce(v_phone, phone) where username = v_user;
  end if;
  delete from sessions where username = v_user and expires_at < now();
  insert into sessions (username, expires_at) values (v_user, now() + interval '2 hours') returning token into t;
  insert into audit_logs (type, msg, ok) values ('login', format('Khách vãng lai %s (%s) xác nhận email, bắt đầu thanh toán', coalesce(p_name, ''), p_email), true);
  return _session_json(t);
end $$;

-- ---------- bước 1: kiểm tra email + ghi tên/SĐT; chế độ demo thì sinh mã luôn ----------
create or replace function public.guest_email_check(p_email text, p_name text, p_phone text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_email text; v_name text := left(trim(coalesce(p_name, '')), 60); v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  u app_users; mode text; code text; exp timestamptz := now() + interval '10 minutes';
begin
  v_email := _email_check(p_email);
  if length(v_name) < 2 then raise exception 'bad_name'; end if;
  if v_phone is not null and v_phone !~ '^(\+84|0)[0-9]{9}$' then raise exception 'bad_phone'; end if;
  select * into u from app_users where lower(email) = v_email;
  if u.username is not null and not u.guest then raise exception 'email_registered'; end if;   -- đã có tài khoản → đăng nhập
  if u.username is not null and not coalesce(u.active, true) then raise exception 'account_disabled'; end if;
  if (select count(*) from email_otps where email = v_email and created_at > now() - interval '10 minutes') >= 3 then raise exception 'too_many_requests'; end if;
  select v into mode from app_config where k = 'otp_mode'; mode := coalesce(mode, 'demo');
  update email_otps set used_at = now() where email = v_email and used_at is null;   -- yêu cầu cũ hết hiệu lực
  if mode = 'demo' then
    code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    insert into email_otps (email, code_hash, name, phone, expires_at) values (v_email, extensions.crypt(code, extensions.gen_salt('bf', 6)), v_name, v_phone, exp);
    insert into audit_logs (type, msg, ok) values ('login', format('Mã xác nhận (demo) cho %s', v_email), true);
    return jsonb_build_object('email', v_email, 'mode', 'demo', 'expires_at', exp, 'demo_code', code);
  end if;
  insert into email_otps (email, name, phone, expires_at) values (v_email, v_name, v_phone, now() + interval '1 hour');
  insert into audit_logs (type, msg, ok) values ('login', format('Yêu cầu mã xác nhận Supabase Auth cho %s', v_email), true);
  return jsonb_build_object('email', v_email, 'mode', 'auth', 'expires_at', exp);
end $$;

-- ---------- bước 2 (demo): nhập mã do máy chủ sinh ----------
create or replace function public.guest_verify(p_email text, p_code text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_email text := lower(trim(coalesce(p_email, ''))); o email_otps;
begin
  select * into o from email_otps where email = v_email and used_at is null and code_hash <> '' order by id desc limit 1;
  if o.id is null then raise exception 'otp_missing'; end if;
  if o.expires_at < now() then raise exception 'otp_expired'; end if;
  if o.attempts >= 5 then raise exception 'otp_locked'; end if;
  if o.code_hash <> extensions.crypt(regexp_replace(coalesce(p_code, ''), '\D', '', 'g'), o.code_hash) then
    -- sai mã: trả về ok=false (không raise, để lần thử được ghi lại – raise sẽ huỷ cả update)
    update email_otps set attempts = attempts + 1 where id = o.id;
    return jsonb_build_object('ok', false, 'error', 'otp_wrong', 'attempts_left', 5 - o.attempts - 1);
  end if;
  update email_otps set used_at = now() where id = o.id;
  return _guest_session(v_email, o.name, o.phone);
end $$;

-- ---------- bước 2 (auth): web đã verifyOtp với Supabase Auth → JWT có email đã xác minh ----------
create or replace function public.guest_verify_auth()
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare claims jsonb; v_email text; o email_otps;
begin
  begin claims := current_setting('request.jwt.claims', true)::jsonb; exception when others then claims := null; end;
  v_email := lower(trim(coalesce(claims ->> 'email', '')));
  if v_email = '' or coalesce(claims ->> 'role', '') <> 'authenticated' then raise exception 'not_logged_in'; end if;
  v_email := _email_check(v_email);
  select * into o from email_otps where email = v_email and used_at is null and code_hash = '' order by id desc limit 1;   -- tên/SĐT đã khai ở bước 1
  if o.id is not null then update email_otps set used_at = now() where id = o.id; end if;
  return _guest_session(v_email, o.name, o.phone);
end $$;

-- ---------- đăng ký bằng email đã mua vãng lai → chuyển vé sang tài khoản mới ----------
create or replace function public.register(p_user text, p_pass text, p_name text, p_email text default null, p_phone text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare t uuid; g text; v_user text := lower(trim(p_user)); v_email text := nullif(lower(trim(p_email)), ''); v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
begin
  if v_user !~ '^[a-z0-9_.]{3,32}$' then raise exception 'bad_username'; end if;
  if v_user like 'g\_%' then raise exception 'bad_username'; end if;
  if length(coalesce(p_pass, '')) < 6 then raise exception 'weak_password'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'bad_name'; end if;
  if v_email is not null then v_email := _email_check(v_email); end if;
  if v_phone is not null and v_phone !~ '^(\+84|0)[0-9]{9}$' then raise exception 'bad_phone'; end if;
  if v_email is not null then select username into g from app_users where lower(email) = v_email and guest; end if;
  if v_email is not null and g is null and exists (select 1 from app_users where lower(email) = v_email) then raise exception 'email_taken'; end if;
  if v_phone is not null and exists (select 1 from app_users where phone = v_phone and username is distinct from g) then raise exception 'phone_taken'; end if;
  if exists (select 1 from app_users where username = v_user) then raise exception 'username_taken'; end if;
  if g is not null then update app_users set email = null, phone = null where username = g; end if;    -- nhường email/SĐT cho tài khoản mới
  insert into app_users (username, pass_hash, role, display_name, email, phone)
  values (v_user, extensions.crypt(p_pass, extensions.gen_salt('bf', 8)), 'khach', left(trim(p_name), 60), v_email, v_phone);
  if g is not null then
    -- chuyển vé TRƯỚC khi xoá tài khoản khách (khoá ngoại on delete set null – xoá trước thì vé mất chủ)
    update tickets set owner_user = v_user where owner_user = g;
    update tickets set viewer_user = v_user where viewer_user = g;
    update mail_outbox set username = v_user where username = g;
    delete from app_users where username = g;
    insert into audit_logs (type, msg, ok) values ('login', format('@%s tạo tài khoản từ khách vãng lai %s – vé đã chuyển sang', v_user, v_email), true);
  end if;
  insert into sessions (username) values (v_user) returning token into t;
  return _session_json(t);
exception when unique_violation then raise exception 'username_taken';
end $$;

-- ---------- mail vé ----------
create or replace function public._mail_ticket_html(p_order text, p_name text)
returns text language plpgsql stable security definer set search_path = public as $$
declare rows_html text; head record; site text; total numeric;
begin
  select coalesce(f.title, s.film_id) as film, c.name as cinema, c.address, r.name as room, s.format,
         to_char(s.start_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI') as hm,
         to_char(s.start_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY') as dmy
    into head
    from tickets t join shows s on s.id = t.show_id
    left join films f on f.id = s.film_id left join rooms r on r.id = s.room_id left join cinemas c on c.id = coalesce(s.cinema_id, r.cinema_id)
    where t.order_id = p_order limit 1;
  if not found then return null; end if;
  select string_agg(format('<tr><td style="padding:8px 12px;border-top:1px solid #eee;font-family:monospace;font-weight:600">%s</td><td style="padding:8px 12px;border-top:1px solid #eee">%s</td><td style="padding:8px 12px;border-top:1px solid #eee;font-family:monospace">%s</td><td style="padding:8px 12px;border-top:1px solid #eee;text-align:right">%s đ</td></tr>',
                           t.seat, coalesce(t.viewer_name, ''), t.code, replace(to_char(t.price, 'FM999,999,999'), ',', '.')), '' order by t.seat), sum(t.price)
    into rows_html, total from tickets t where t.order_id = p_order and t.status <> 'refunded';
  select v into site from app_config where k = 'site_url';
  return format($h$<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <div style="background:#e11d48;color:#fff;border-radius:16px 16px 0 0;padding:18px 20px;font-size:20px;font-weight:700">CineVin · Vé xem phim</div>
  <div style="background:#fff;border-radius:0 0 16px 16px;padding:20px">
    <p style="margin:0 0 12px">Xin chào <b>%s</b>, cảm ơn bạn đã đặt vé. Đây là vé của bạn, đưa mã QR ở link bên dưới cho nhân viên khi vào rạp.</p>
    <h2 style="margin:16px 0 4px;font-size:18px">%s</h2>
    <p style="margin:0;color:#52525b">%s · %s · %s</p>
    <p style="margin:4px 0 16px;color:#52525b">Suất <b style="color:#18181b">%s</b> ngày <b style="color:#18181b">%s</b> · phòng %s</p>
    <table style="width:100%%;border-collapse:collapse;font-size:14px"><thead><tr style="text-align:left;color:#52525b"><th style="padding:6px 12px">Ghế</th><th style="padding:6px 12px">Người xem</th><th style="padding:6px 12px">Mã vé</th><th style="padding:6px 12px;text-align:right">Giá</th></tr></thead><tbody>%s</tbody></table>
    <p style="margin:12px 0 0;text-align:right;font-weight:700">Tổng %s đ · mã đơn <span style="font-family:monospace">%s</span></p>
    <p style="margin:20px 0 0"><a href="%s#/tracuu?ma=%s" style="display:inline-block;background:#e11d48;color:#fff;text-decoration:none;padding:12px 20px;border-radius:12px;font-weight:600">Mở vé &amp; mã QR</a></p>
    <p style="margin:12px 0 0;font-size:12px;color:#71717a">QR đổi mỗi 15 giây nên không in được – mở link này trên điện thoại khi tới rạp (nhập email để xác nhận). Vé mua online hoàn được trước giờ chiếu 30 phút trong mục Vé của tôi.</p>
  </div>
  <p style="margin:12px 0 0;text-align:center;font-size:12px;color:#a1a1aa">CineVin · Đồ án Nhóm 05 ĐH Vinh · mail tự động, không trả lời</p>
</div></body></html>$h$,
    coalesce(p_name, 'bạn'), head.film, coalesce(head.cinema, 'CineVin'), coalesce(head.address, ''), coalesce(head.format, '2D'),
    head.hm, head.dmy, coalesce(head.room, '?'), coalesce(rows_html, ''), replace(to_char(coalesce(total, 0), 'FM999,999,999'), ',', '.'), p_order,
    coalesce(site, 'https://clonetest222.github.io/faceid_demo/'), p_order);
end $$;

-- Xếp mail vé cho đơn p_order vào outbox (Edge Function send-mail sẽ lấy đi gửi)
create or replace function public._mail_order(p_user text, p_order text)
returns void language plpgsql security definer set search_path = public as $$
declare u app_users; h text; subj text;
begin
  select * into u from app_users where username = p_user;
  if u.email is null then return; end if;
  h := _mail_ticket_html(p_order, u.display_name); if h is null then return; end if;
  select format('Vé CineVin · %s · %s', coalesce(f.title, s.film_id), to_char(s.start_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM')) into subj
    from tickets t join shows s on s.id = t.show_id left join films f on f.id = s.film_id where t.order_id = p_order limit 1;
  insert into mail_outbox (to_email, to_name, username, subject, html, kind, ref) values (u.email, u.display_name, u.username, subj, h, 'ticket', p_order);
end $$;

-- Thanh toán (ghi đè bản 016): khách vãng lai không tích/dùng điểm; có email thì xếp mail vé
create or replace function public.sell_order_u(p_token uuid, p_show text, p_hold text, p_tickets jsonb, p_voucher text default null, p_points int default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u app_users; v vouchers; gross numeric; disc numeric := 0; pts int := 0; paid numeric; earn int;
begin
  u := _need(p_token, array['khach', 'nhanvien', 'quanly']);
  select coalesce(sum((x->>'price')::numeric), 0) into gross from jsonb_array_elements(p_tickets) x;
  if p_voucher is not null and p_voucher <> '' then
    select * into v from vouchers where code = upper(trim(p_voucher)) for update;
    if not _voucher_ok(v, u.username) then raise exception 'voucher_invalid'; end if;
    disc := case when v.kind = 'gift' then least(v.amount, gross) else round(gross * v.percent / 100) end;
  end if;
  pts := case when u.guest then 0 else least(greatest(coalesce(p_points, 0), 0), u.points, floor((gross - disc) / 1000)::int) end;
  paid := greatest(0, gross - disc - pts * 1000);
  perform sell_order(p_show, p_hold, p_tickets);
  update tickets set owner_user = u.username
  where code in (select x->>'code' from jsonb_array_elements(p_tickets) x) and coalesce(channel, '') <> 'Quầy';
  update tickets set sold_by = u.username where code in (select x->>'code' from jsonb_array_elements(p_tickets) x) and u.role <> 'khach';
  perform _apply_companions(u.username, p_show, p_tickets);
  if v.code is not null then
    if v.kind = 'promo' and v.owner_user is null then insert into voucher_uses (code, username) values (v.code, u.username);
    else update vouchers set used_at = now(), used_by = u.username where code = v.code; end if;
  end if;
  earn := case when u.role = 'khach' and not u.guest then floor(paid * 0.05 / 1000)::int else 0 end;
  update app_users set points = points - pts + earn where username = u.username;
  insert into audit_logs (type, msg, ok) values ('pay', format('@%s thanh toán %s đ (giảm %s đ, dùng %s điểm, +%s điểm)%s', u.username, paid, disc, pts, earn, case when u.guest then ' – khách vãng lai ' || u.email else '' end), true);
  if u.role = 'khach' and u.email is not null then perform _mail_order(u.username, p_hold); end if;
  return jsonb_build_object('gross', gross, 'discount', disc, 'points_used', pts, 'paid', paid, 'points_earned', earn, 'points', u.points - pts + earn,
    'mailed_to', case when u.role = 'khach' then u.email end);
end $$;

-- Edge Function send-mail (service role) lấy mail chờ gửi của chủ phiên p_token (đánh dấu 'queued'); thử lại được mail 'failed'
drop function if exists public.mail_take(uuid, text);
create or replace function public.mail_take(p_token uuid, p_ref text default null)
returns table (id bigint, to_email text, to_name text, subject text, html text)
language plpgsql security definer set search_path = public as $$
declare u app_users;
begin
  u := _need(p_token, array['khach']);
  return query update mail_outbox m set status = 'queued', request_id = coalesce(m.request_id, 0) + 1
    where m.username = u.username and m.status in ('pending', 'failed') and (p_ref is null or m.ref = p_ref)
    returning m.id, m.to_email, m.to_name, m.subject, m.html;
end $$;

-- Edge Function báo kết quả gửi (chỉ service_role gọi được)
create or replace function public.mail_mark(p_id bigint, p_ok boolean, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
declare claims jsonb;
begin
  begin claims := current_setting('request.jwt.claims', true)::jsonb; exception when others then claims := null; end;
  if coalesce(claims ->> 'role', '') <> 'service_role' then raise exception 'forbidden'; end if;
  update mail_outbox set status = case when p_ok then 'sent' else 'failed' end, error = case when p_ok then null else left(p_error, 300) end, sent_at = case when p_ok then now() else sent_at end where id = p_id;
end $$;

-- Mail vé của tôi (xem lại nội dung / trạng thái trên web). Bản trước trả cột khác → phải drop rồi tạo lại
drop function if exists public.my_mails(uuid, text);
create or replace function public.my_mails(p_token uuid, p_ref text default null)
returns table (id bigint, to_email text, subject text, html text, status text, error text, ref text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare u app_users;
begin
  u := _need(p_token, array['khach']);
  return query select m.id, m.to_email, m.subject, m.html, m.status, m.error, m.ref, m.created_at from mail_outbox m
    where m.username = u.username and m.kind = 'ticket' and (p_ref is null or m.ref = p_ref) order by m.id desc limit 20;
end $$;

-- ---------- tra cứu vé: mã vé / mã đơn + email → phiên khách 2 giờ ----------
create or replace function public.lookup_order(p_code text, p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t tickets; u app_users; tok uuid; v_code text := upper(trim(p_code)); v_email text := lower(trim(p_email));
begin
  select * into t from tickets where code = v_code or order_id = v_code order by created_at desc limit 1;
  if t.code is null then raise exception 'unknown_ticket'; end if;
  select * into u from app_users where username = t.owner_user;
  if u.username is null or lower(coalesce(u.email, '')) <> v_email then raise exception 'unknown_ticket'; end if;   -- không lộ vé của người khác
  if not u.guest then raise exception 'use_login'; end if;
  if not coalesce(u.active, true) then raise exception 'account_disabled'; end if;
  delete from sessions where username = u.username and expires_at < now();
  insert into sessions (username, expires_at) values (u.username, now() + interval '2 hours') returning token into tok;
  insert into audit_logs (type, msg, ok) values ('login', format('Khách vãng lai %s tra cứu vé %s', v_email, v_code), true);
  return _session_json(tok) || jsonb_build_object('order', t.order_id, 'ticket', t.code);
end $$;

-- Quản lý: thêm/bớt tên miền email bị chặn; đổi chế độ mã xác nhận
create or replace function public.blocklist_set_s(p_token uuid, p_domain text, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
declare d text := lower(trim(coalesce(p_domain, '')));
begin
  perform _need(p_token, array['quanly']);
  if d !~ '^[a-z0-9.-]+\.[a-z]{2,}$' then raise exception 'bad_input'; end if;
  if p_on then insert into email_blocklist (domain, note) values (d, 'quản lý thêm') on conflict (domain) do nothing; else delete from email_blocklist where domain = d; end if;
end $$;
create or replace function public.otp_mode()
returns text language sql stable security definer set search_path = public as $$ select coalesce((select v from app_config where k = 'otp_mode'), 'demo') $$;

grant execute on function public.guest_email_check(text, text, text), public.guest_verify(text, text), public.guest_verify_auth(), public.lookup_order(text, text),
  public.my_mails(uuid, text), public.register(text, text, text, text, text), public.sell_order_u(uuid, text, text, jsonb, text, int),
  public.blocklist_set_s(uuid, text, boolean), public.otp_mode() to anon, authenticated;
grant execute on function public.mail_take(uuid, text), public.mail_mark(bigint, boolean, text) to service_role;
revoke execute on function public.mail_take(uuid, text), public.mail_mark(bigint, boolean, text) from public, anon, authenticated;
revoke execute on function public._mail_order(text, text), public._mail_ticket_html(text, text), public._email_check(text), public._guest_session(text, text, text) from public, anon, authenticated;
