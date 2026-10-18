-- CineVin – migration 007: mã khuyến mãi dùng chung (promo) mỗi khách dùng một lần, không "cháy" sau người đầu tiên.
--   Thẻ quà tặng (gift) vẫn dùng một lần. Chạy SAU 006. Chạy lại nhiều lần không sao.

create table if not exists public.voucher_uses (
  code text not null references public.vouchers(code) on delete cascade,
  username text not null,
  used_at timestamptz not null default now(),
  primary key (code, username)
);
alter table public.voucher_uses enable row level security;
-- mã promo đã bị đánh dấu dùng bởi người đầu tiên → chuyển sang bảng lượt dùng
insert into public.voucher_uses (code, username, used_at)
select code, used_by, used_at from public.vouchers where kind = 'promo' and owner_user is null and used_at is not null and used_by is not null
on conflict do nothing;
update public.vouchers set used_at = null, used_by = null where kind = 'promo' and owner_user is null;

-- promo: hợp lệ nếu người này chưa dùng; gift: chưa dùng và đúng chủ
create or replace function public._voucher_ok(v public.vouchers, p_user text)
returns boolean language sql stable as $$
  select v.code is not null
    and (v.expires_at is null or v.expires_at > now())
    and case when v.kind = 'promo' and v.owner_user is null
             then not exists (select 1 from voucher_uses x where x.code = v.code and x.username = p_user)
             else v.used_at is null and (v.owner_user is null or v.owner_user = p_user) end;
$$;

create or replace function public.voucher_check(p_token uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u app_users; v vouchers;
begin
  u := _need(p_token, array['khach', 'nhanvien', 'quanly']);
  select * into v from vouchers where code = upper(trim(p_code));
  if v.code is null then raise exception 'voucher_unknown'; end if;
  if v.expires_at is not null and v.expires_at < now() then raise exception 'voucher_expired'; end if;
  if v.owner_user is not null and v.owner_user <> u.username then raise exception 'voucher_not_yours'; end if;
  if not _voucher_ok(v, u.username) then raise exception 'voucher_used'; end if;
  return jsonb_build_object('code', v.code, 'kind', v.kind, 'amount', v.amount, 'percent', v.percent, 'expires_at', v.expires_at);
end $$;

drop function if exists public.my_vouchers(uuid);
create or replace function public.my_vouchers(p_token uuid)
returns table (code text, kind text, amount numeric, percent int, expires_at timestamptz, used_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare u app_users;
begin
  u := _need(p_token, array['khach', 'nhanvien', 'quanly']);
  return query select v.code, v.kind, v.amount, v.percent, v.expires_at,
      case when v.kind = 'promo' and v.owner_user is null then (select x.used_at from voucher_uses x where x.code = v.code and x.username = u.username) else v.used_at end
    from vouchers v
    where v.owner_user = u.username or (v.owner_user is null and v.kind = 'promo' and (v.expires_at is null or v.expires_at > now()))
    order by 6 nulls first, v.created_at desc;
end $$;

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
  pts := least(greatest(coalesce(p_points, 0), 0), u.points, floor((gross - disc) / 1000)::int);
  paid := greatest(0, gross - disc - pts * 1000);
  perform sell_order(p_show, p_hold, p_tickets);
  update tickets set owner_user = u.username
  where code in (select x->>'code' from jsonb_array_elements(p_tickets) x) and coalesce(channel, '') <> 'Quầy';
  perform _apply_companions(u.username, p_show, p_tickets);
  if v.code is not null then
    if v.kind = 'promo' and v.owner_user is null then insert into voucher_uses (code, username) values (v.code, u.username);
    else update vouchers set used_at = now(), used_by = u.username where code = v.code; end if;
  end if;
  earn := case when u.role = 'khach' then floor(paid * 0.05 / 1000)::int else 0 end;
  update app_users set points = points - pts + earn where username = u.username;
  insert into audit_logs (type, msg, ok) values ('pay', format('@%s thanh toán %s đ (giảm %s đ, dùng %s điểm, +%s điểm)', u.username, paid, disc, pts, earn), true);
  return jsonb_build_object('gross', gross, 'discount', disc, 'points_used', pts, 'paid', paid, 'points_earned', earn, 'points', u.points - pts + earn);
end $$;

revoke execute on function public._voucher_ok(public.vouchers, text) from public, anon, authenticated;
grant execute on function public.voucher_check(uuid, text), public.my_vouchers(uuid), public.sell_order_u(uuid, text, text, jsonb, text, int) to anon, authenticated;
