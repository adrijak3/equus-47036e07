alter table public.profiles add column if not exists receive_subscription_emails boolean not null default true;
comment on column public.profiles.receive_subscription_emails is 'Optional subscription reminder and warning emails only. Transactional security and administrator important notices always continue.';
