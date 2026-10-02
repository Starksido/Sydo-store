# Sydo

An online fashion store for Kenya: a storefront with sizes, a bag (for guests too), wishlists,
reviews and discount codes, checkout with M-Pesa or card through Paystack, order emails, and an
admin for products, stock, orders, refunds, reviews, discounts and admins.

Built with Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, Better Auth, Drizzle ORM
and Postgres on Neon. Payments: Paystack. Email: Resend. Images: Vercel Blob. Hosting: Vercel.

Working notes for the codebase (architecture, conventions, data rules) are in [`CLAUDE.md`](CLAUDE.md).

## Run it locally

You need Node.js 20 or later, npm, and a [Neon](https://neon.tech) account (the free plan is enough).

1. Install: `npm install`
2. Create two Neon databases in the same project: one for the store (e.g. `sydo`) and an **empty**
   one for tests whose name ends in `_test` (e.g. `sydo_test`).
3. Copy `.env.example` to `.env.local` and fill it in (see [Environment variables](#environment-variables)).
   For tests, put `TEST_DATABASE_URL` in `.env.test.local`.
4. Create the tables: `npm run db:migrate`
5. Add the sample catalog (optional, development only): `npm run db:seed`
6. Start: `npm run dev`, then open http://localhost:3000

Without a Resend key, development prints emails (with their links) to the terminal, so you can
confirm accounts and reset passwords locally.

### Make yourself an admin

Sign up on the site and confirm your email, then run this on the store database in the Neon SQL
editor:

```sql
update "user" set role = 'admin' where email = 'you@example.com';
```

Sign out and in again, then open `/admin`. From there, admins add and remove other admins on
`/admin/users`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server on http://localhost:3000 |
| `npm run build` / `npm run start` | Production build, and serving it |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | Typecheck (run `npm run build` or `npx next typegen` first on a fresh checkout) |
| `npm run test` | Tests, against `TEST_DATABASE_URL` only (they refuse any database not named `*_test`) |
| `npm run db:generate` | Write a migration after changing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` |
| `npm run db:seed` | Add the sample catalog (never on production) |

## Environment variables

| Variable | Where it comes from |
| --- | --- |
| `DATABASE_URL` | Neon → Connection Details (pooled). Needed at build time too. |
| `BETTER_AUTH_SECRET` | `npx auth secret`. At least 32 random bytes; the app refuses to start otherwise. |
| `BETTER_AUTH_URL` | The site's public URL, e.g. `https://shop.example.com` (`http://localhost:3000` locally). |
| `NEXT_PUBLIC_BETTER_AUTH_URL` | The same URL. Built into the browser code, so set it before building. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional: "Continue with Google". See [Google sign-in](#google-sign-in). Without them the button is hidden. |
| `PAYSTACK_SECRET_KEY` | Paystack → Settings → API Keys & Webhooks. `sk_test_…` until you go live. |
| `PAYSTACK_MODE` | Empty for test mode; `live` (production only) with an `sk_live_…` key. |
| `RESEND_API_KEY`, `EMAIL_FROM` | Resend → API Keys; `EMAIL_FROM` on a domain verified in Resend, e.g. `Sydo <orders@example.com>`. |
| `BLOB_READ_WRITE_TOKEN` | Vercel → Storage → Blob. Set for you when the store is connected to the project. |
| `CRON_SECRET` | Any long random string (`npx auth secret` works). Also stored as a GitHub secret. |
| `TEST_DATABASE_URL` | In `.env.test.local` only: the empty `*_test` database. |

## Google sign-in

Optional. Customers can then sign up and sign in with their Google account; Google has already
confirmed their email, so they skip the code. A Google login is linked to an existing account with
the same email only if that account's email is confirmed.

1. In [Google Cloud Console](https://console.cloud.google.com), create a project (or pick one).
2. **APIs & Services → OAuth consent screen**: choose **External**, fill in the app name (Sydo),
   support email and logo, and add the scopes `openid`, `email` and `profile` only.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**, type **Web
   application**. Under **Authorized redirect URIs**, add
   `http://localhost:3000/api/auth/callback/google` for development and
   `https://<your domain>/api/auth/callback/google` for the live site.
4. Copy the client ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (`.env.local`, and
   later Vercel), then restart the app.
5. While the consent screen is in **Testing**, only the test users you list there can sign in.
   **Publish** it before launch (email and profile access don't need Google's review).

## Database changes

Edit `src/db/schema.ts`, run `npm run db:generate`, review the SQL in `drizzle/`, then
`npm run db:migrate`. Commit the `drizzle/` folder. Don't use `db:push` on a shared or production
database. Browse data in the Neon SQL editor; don't run Drizzle Studio (`drizzle-kit studio`): its
local server runs any SQL sent to it and allows any website's requests, so a page open in your
browser could read the database. Tests apply the committed migrations to the test database themselves.

## Deploy (Vercel)

1. **Production database.** Create a separate Neon database for production (not a branch of your
   development data). Run the migrations against it: put its URL in `DATABASE_URL` temporarily and
   run `npm run db:migrate`, then restore your local value. Don't seed it.
2. **Vercel project.** Import the GitHub repository. Under Settings → Environment Variables, add
   every variable above for Production (not `TEST_DATABASE_URL`), with `BETTER_AUTH_URL` and
   `NEXT_PUBLIC_BETTER_AUTH_URL` set to your domain.
3. **Images.** Vercel → Storage → create a Blob store and connect it to the project; this adds
   `BLOB_READ_WRITE_TOKEN`. Admins can then upload product and category images.
4. **Domain.** Add your domain in Vercel, then redeploy so the build picks up the URLs.
5. **Email.** Add the domain in Resend and set the DNS records it lists (SPF and DKIM), then set
   `EMAIL_FROM` on that domain.
6. **Google sign-in** (optional). Add the live redirect URI to your Google OAuth client and set
   `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in Vercel (see [Google sign-in](#google-sign-in)).
7. **Paystack.** In the dashboard, set the webhook URL to `https://<your domain>/api/webhooks/paystack`
   and the callback domain to your domain.
8. **Cron.** In GitHub → Settings → Secrets and variables → Actions, add the variable `SITE_URL`
   (`https://<your domain>`, no trailing slash) and the secret `CRON_SECRET` (the same value as in
   Vercel). The workflow in `.github/workflows/expire-orders.yml` then calls
   `/api/cron/expire-orders` every 15 minutes: it expires unpaid orders after 60 minutes (returning
   their stock and discount uses) and deletes guest bags untouched for 30 days. Run it by hand from
   the Actions tab to check it.
9. **First admin.** Sign up on the live site, confirm your email, and run the SQL in
   [Make yourself an admin](#make-yourself-an-admin) on the production database.

## Going live with real payments

Until then, keep test keys everywhere: the app refuses a live key unless `PAYSTACK_MODE=live`, and
only in a production build on an https URL.

1. Complete Paystack's business verification.
2. In Paystack's **live** dashboard, set the same webhook URL and callback domain.
3. In Vercel (Production only), set `PAYSTACK_SECRET_KEY` to the `sk_live_…` key and
   `PAYSTACK_MODE=live`, and redeploy.
4. Add your real products, images and delivery details, and your privacy, terms and returns pages.
5. Place a small real order, then refund it in the Paystack dashboard and record the refund on
   `/admin/refunds`, to check the whole flow.
