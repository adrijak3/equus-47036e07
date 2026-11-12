# Cloudflare Turnstile for Equus (no paid plan required)

## Do not turn on Supabase CAPTCHA before the frontend has its sitekey

1. Open Cloudflare Dashboard > Turnstile > Add widget. Choose **Managed**, name it "Equus", and add hostname **equusjm.pages.dev**. Add any custom production domain. Preview deployment hostnames may require separate configured hostnames or a separate preview widget.
2. Copy the **Site Key** (public value). In Cloudflare Pages > equusjm > Settings > Variables and Secrets, set **Production** build environment variable `VITE_TURNSTILE_SITE_KEY` to that site key. Do not put the Secret Key into GitHub, HTML or a VITE variable.
3. Redeploy production; inspect the login and create-account forms. The widget should display and return a token.
4. Only AFTER the widget is deployed, in **Supabase Dashboard > Authentication > Bot and Abuse Protection > CAPTCHA protection**, select Cloudflare Turnstile, enter the **Secret Key** from the widget, then save/enable protection.
5. Test sign-in and account creation in an incognito window using authorized non-destructive test accounts; also test a deliberately invalid CAPTCHA to confirm the server rejects it.
6. Keep the existing 10-users-per-Lithuania-day Auth trigger. Turnstile adds a second barrier; it does not replace quota or firewall rules.

### Limits
- This integration covers Supabase Auth email/password signup and login (the `captchaToken` is passed to Auth).
- Google OAuth and the separate first-lesson public registration form need their own bot-abuse review.
- Supabase custom password-reset functions may not be protected by the Auth CAPTCHA setting.
- A sitekey alone is not protection; it only becomes secure once the server enforces token verification.
- Secret credentials must never be committed to source code.

Reference: https://supabase.com/docs/guides/auth/auth-captcha
Cloudflare: https://developers.cloudflare.com/turnstile/get-started/widget-management/dashboard/
