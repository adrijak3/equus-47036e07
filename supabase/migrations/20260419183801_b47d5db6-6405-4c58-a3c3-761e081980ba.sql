
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'process-lessons-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url:='https://tkksskpvpartlhpnctzu.supabase.co/functions/v1/process-lessons',
    headers:='{"Content-Type":"application/json"}'::jsonb,
    body:='{}'::jsonb
  ) AS request_id;
  $$
);
