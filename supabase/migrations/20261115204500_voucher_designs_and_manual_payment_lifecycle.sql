-- Preview images are public; voucher requests remain private.
create table if not exists public.gift_voucher_designs (
 id uuid primary key default gen_random_uuid(),
 label text not null check(char_length(label) between 2 and 90),
 image_path text not null unique,
 active boolean not null default true,
 created_at timestamptz not null default now()
);
alter table public.gift_voucher_designs enable row level security;
revoke all on public.gift_voucher_designs from anon,authenticated;
grant select on public.gift_voucher_designs to anon,authenticated;
grant insert,update,delete on public.gift_voucher_designs to authenticated;
drop policy if exists "Active voucher designs readable" on public.gift_voucher_designs;
create policy "Active voucher designs readable" on public.gift_voucher_designs for select to anon,authenticated using(active or public.has_role((select auth.uid()),'admin'::public.app_role));
drop policy if exists "Admin can manage voucher designs" on public.gift_voucher_designs;
create policy "Admin can manage voucher designs" on public.gift_voucher_designs for all to authenticated
using(public.has_role((select auth.uid()),'admin'::public.app_role))
with check(public.has_role((select auth.uid()),'admin'::public.app_role));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('gift-voucher-designs','gift-voucher-designs',true,8000000,array['image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=true,file_size_limit=8000000,allowed_mime_types=array['image/png','image/jpeg','image/webp'];
drop policy if exists "Admin uploads voucher design images" on storage.objects;
create policy "Admin uploads voucher design images" on storage.objects for insert to authenticated with check(bucket_id='gift-voucher-designs' and public.has_role((select auth.uid()),'admin'::public.app_role));
drop policy if exists "Admin removes voucher design images" on storage.objects;
create policy "Admin removes voucher design images" on storage.objects for delete to authenticated using(bucket_id='gift-voucher-designs' and public.has_role((select auth.uid()),'admin'::public.app_role));
alter table public.gift_voucher_requests add column if not exists payment_instructions_sent_at timestamptz;
alter table public.gift_voucher_requests add column if not exists payment_confirmed_at timestamptz;
alter table public.gift_voucher_requests add column if not exists delivery_queued_at timestamptz;
-- Durable guard against repeated voucher emails. A paid voucher is issued only
-- after Gmail reports successful send, never when a button is merely clicked.
create unique index if not exists email_events_event_key_unique_gift
on public.email_events(event_key) where event_type in ('gift_voucher_payment','gift_voucher_issued');
