-- CineVin – migration 017: sửa từng tài khoản ở "Tài khoản & quyền". Chạy SAU 016. Chạy lại nhiều lần không sao.
--   Đổi họ tên, vai trò (phân quyền: khách ↔ nhân viên / kỹ thuật / phục vụ / quản lý), cơ sở, khoá / mở, đặt lại mật khẩu.
--   Quản lý chuỗi: mọi tài khoản (trừ tự hạ quyền / tự khoá). Quản lý cơ sở: chỉ nhân sự rạp mình, không nâng lên quản lý chuỗi.
create or replace function public.account_update_s(p_token uuid, p jsonb)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare u app_users; ex app_users; un text := lower(trim(p->>'username')); r text := p->>'role'; cid text := nullif(p->>'cinema_id', ''); act boolean := coalesce((p->>'active')::boolean, true);
begin
  u := _need(p_token, array['quanly']);
  select * into ex from app_users where username = un;
  if ex.username is null then raise exception 'unknown_user'; end if;
  r := coalesce(r, ex.role);
  if r not in ('khach', 'nhanvien', 'kythuat', 'phucvu', 'quanly') then raise exception 'bad_role'; end if;
  if r = 'khach' then cid := null; end if;
  if u.cinema_id is not null then
    if ex.role = 'khach' and r = 'khach' then raise exception 'wrong_cinema'; end if;             -- quản lý rạp không quản lý khách
    if (ex.cinema_id is not null and ex.cinema_id <> u.cinema_id) or (r <> 'khach' and cid <> u.cinema_id) then raise exception 'wrong_cinema'; end if;
    if r = 'quanly' and cid is null then raise exception 'forbidden'; end if;                      -- không tạo quản lý chuỗi
  end if;
  if ex.username = u.username and (r <> u.role or not act or cid is distinct from u.cinema_id) then raise exception 'bad_input'; end if;   -- không tự đổi quyền / tự khoá
  if cid is not null and not exists (select 1 from cinemas where id = cid) then raise exception 'unknown_cinema'; end if;
  if length(coalesce(p->>'pass', '')) > 0 then
    if length(p->>'pass') < 6 then raise exception 'weak_password'; end if;
    update app_users set pass_hash = extensions.crypt(p->>'pass', extensions.gen_salt('bf', 8)) where username = un;
    delete from sessions where username = un and token <> p_token;
    perform _admin_log(u.username, 'đặt lại mật khẩu @' || un);
  end if;
  update app_users set display_name = coalesce(nullif(left(trim(p->>'name'), 60), ''), display_name), role = r, cinema_id = cid, active = act where username = un;
  if not act then delete from sessions where username = un; end if;
  perform _admin_log(u.username, format('tài khoản @%s: %s%s%s', un, r, case when cid is not null then ', rạp ' || cid else '' end, case when act then '' else ', KHOÁ' end));
end $$;
grant execute on function public.account_update_s(uuid, jsonb) to anon, authenticated;
