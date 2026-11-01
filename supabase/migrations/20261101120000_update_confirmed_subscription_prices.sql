-- EQUUS: Update the active subscription price matrix to the latest confirmed prices.
-- These exact rows are used by client requests, QR purchases and admin purchases.

UPDATE public.subscription_prices
SET price_eur = CASE
  WHEN lessons_total = 3 AND package_type = 'po2' AND horse_type = 'school' THEN 127.00
  WHEN lessons_total = 5 AND package_type = 'po2' AND horse_type = 'school' THEN 212.00
  WHEN lessons_total = 7 AND package_type = 'po2' AND horse_type = 'school' THEN 297.00
  WHEN lessons_total = 9 AND package_type = 'po2' AND horse_type = 'own' THEN 337.00
  WHEN lessons_total = 11 AND package_type = 'group' AND horse_type = 'own' THEN 357.00
  WHEN lessons_total = 11 AND package_type = 'po2' AND horse_type = 'own' THEN 412.00
  ELSE price_eur
END,
updated_at = now()
WHERE (lessons_total, package_type, horse_type) IN (
  (3, 'po2', 'school'),
  (5, 'po2', 'school'),
  (7, 'po2', 'school'),
  (9, 'po2', 'own'),
  (11, 'group', 'own'),
  (11, 'po2', 'own')
);
