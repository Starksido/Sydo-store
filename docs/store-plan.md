# Sydo store: plan for the remaining work

## Context
The admin build (docs/admin-plan.md, steps 1–5) is done and pushed. The user asked for a plan covering everything still left:
1. deleting products and categories
2. managing admins in the app
3. email
4. storefront features (guest carts, wishlists, reviews, discounts)
5. stock per size (variants)
6. going live

Decisions already made:
- **Email:** Resend.
- **Hosting:** Vercel Hobby, with a GitHub Actions cron.
- **Stock-per-size migration:** split each product's stock evenly across its available sizes.
- **Reviews:** verified buyers only, published straight away, and admins can hide them.

We work the same way as the admin build:
- Each step ends at a stop with changes left uncommitted. The user tests, then commits.
- Every step runs `npx tsc --noEmit`, `npm run lint`, `npm run test` and `npm run build`. UI steps are also checked in the browser at phone and desktop widths, against the test database on :3001.
- Migrations are generated and reviewed, and reach only the test database through tests. `db:migrate` against the store database needs the user's go-ahead each time.
- CLAUDE.md is updated in the same step as the change it describes, including relaxing the line "Don't add guest carts, discounts, reviews, wishlists or product variants".
- On approval, this plan is first saved as `docs/store-plan.md` and committed on its own, like the admin plan was.

Order and reasons: the small admin gaps come first. Email follows, since the admin guard in step 2 and the order emails depend on it. Stock per size comes before guest carts, wishlists and discounts because all three touch cart and order lines. Going live is last.

---

## Step 1: Delete products and categories (admin)
- **`deleteProduct(id)`** in `src/lib/admin/products.ts`. It is one statement, allowed only when the product:
  - is archived,
  - has no `order_items` rows (a product that has ever been ordered stays archived for good), and
  - has no `pending_payment` orders.
  The same statement deletes its `stock_adjustments`. Cart lines turn into "No longer available" through the existing `set null`.
- **Result:** `{ok}` or `{ok:false, reason:"not-archived"|"ordered"|"not-found"}`.
- **`deleteCategory(id)`** in `src/lib/admin/categories.ts`. It is refused when any product uses the category (including archived ones; the FK is already `restrict`, and a `23503` becomes the reason) or when its slug is linked from `src/lib/catalog.ts` (nav, hero, collections). Export those slugs as a set from catalog.ts so the check can't drift.
- **Actions** in `src/app/admin/products/actions.ts` and `src/app/admin/categories/actions.ts`: `requireAdmin` first, then delete, `revalidateStorefront()`, and redirect to the list with `?saved=deleted`.
- **UI:** a "Delete" section on the edit pages. It shows only when a delete is allowed, otherwise says why not, and asks for an inline confirmation (a second button, not `window.confirm`). Reuse `listAdminCategories`' product counts.
- **Tests:** `src/lib/admin/products.test.ts`, a new `categories.test.ts`, and the `admin/actions.test.ts` access checks.

## Step 2: Manage admins in the app
- **Plain SQL, not Better Auth's admin plugin.** The plugin's `role` clashes with our field and adds schema we don't need.
- **`src/lib/admin/users.ts`:**
  - `listUsers({q, page})` searches by email or name and shows the role and order count.
  - `setUserRole(actorId, userId, role)` is one conditional statement. It refuses to demote yourself or the last admin, and refuses to promote a user whose `email_verified` is false (this is what step 3 feeds).
  - On demotion it deletes that user's `session` rows. The role is already read fresh from the database on every request, so this is extra protection.
- **New table `role_changes`** (who, whom, from, to, at) as an audit trail, inserted in the same statement. This needs a migration.
- **Pages:** `/admin/users` (search, list, promote/demote with inline confirmation) and a "Users" entry in `AdminNav`. `adminMetadata()` is used as usual.
- **Docs:** CLAUDE.md's "no in-app way to become an admin" becomes "the first admin is still made in SQL, after that `/admin/users`".

## Step 3: Email (Resend)
- **Env:** `RESEND_API_KEY` and `EMAIL_FROM` (an address on a domain verified in Resend). Add both to `.env.example`, with fixed fakes in `tests/setup.ts`.
- **`src/lib/email/send.ts`:** a Resend REST client over `fetch` with a 15s timeout, like `paystack.ts`. In development, when no key is set, it logs the email instead of sending it. In production a missing key is an error.
- **Templates:** `src/lib/email/templates.ts`. Plain functions return `{subject, html, text}`, monochrome to match the store, with user data HTML-escaped. There's no react-email dependency.
- **Mocking:** tests mock Resend with a `tests/resend-mock.ts` that has the same shape as `paystack-mock.ts`.
- **Auth** (`src/lib/auth.ts`, `nextCookies()` stays last):
  - `emailVerification.sendVerificationEmail`, with `sendOnSignUp: true` and `autoSignInAfterVerification: true`.
  - `emailAndPassword.requireEmailVerification: true`, `sendResetPassword`, `revokeSessionsOnPasswordReset: true`.
  - `onExistingUserSignUp` emails the real account owner, so sign-up no longer reveals whether an email is registered. Update the comment in `auth-error.ts`.
- **Existing accounts:** a data migration marks them `email_verified = true` so current users aren't locked out. On the store database that is only the user's own account and `claude-test@example.com`.
- **New pages under `(store)/(auth)`:**
  - `/verify-email`: check your inbox, resend with a cooldown.
  - `/forgot-password` and `/reset-password`: the latter reads `?token=`.
- **AuthForm:** handles the "email not verified" error with a resend link, and gets a "Forgot password?" link. `authErrorMessage` gains the new codes and modes.
- **Account page:** adds "Change password" (`authClient.changePassword`).
- **Order emails:** sent with `after()`, never throwing into the caller. The triggers only fire on a real change, so there are no repeats:
  - Paid: `confirmPayment` returns `"paid"`, which happens only when this call applied it. Send from all three callers through one helper, `notifyOrderPaid(reference)`.
  - Shipped (carrier and tracking when set) and cancelled (with the customer-facing reason and a refund note when one is due): `changeOrderStatus` returns `ok:true`.
  - Refunded: `recordRefund` returns true.
  - A small system loader `getOrderForEmail(reference)` joins `user.email` and the order lines. It is not `"use server"`.
- **Tests:** the auth flows through the real Better Auth instance with the mocked Resend (`requireEmailVerification`, reset token), and each order email firing once and only on a real change.

## Step 4: Stock per size (variants)
**Schema** (two migrations in this step: expand + backfill, then contract):
- **New table `product_variants`:**
  - columns: `id` identity, `product_id` (FK, cascade), `label` (null = one size), `stock int >= 0`, `position`
  - unique index on `(product_id, coalesce(lower(label),''))`
- **Backfill:**
  - One-size products get one variant holding the product's stock.
  - Sized products get one variant per size, with the stock **split evenly across available sizes** (the remainder goes to the first size). Unavailable sizes get 0.
- **Line columns:**
  - `cart_items.variant_id` and `order_items.variant_id` (FK, set null), backfilled by matching product + size label. `size` stays as the copied label.
  - The cart unique index becomes `(cart_id, variant_id)`.
  - `stock_adjustments.variant_id` is also set null, and history stays readable per product.
- **Contract:** drop `products.stock` and `products.sizes`. The product's total stock becomes a `sum()` over its variants in the queries.

**Code:**
- `src/lib/stock.ts`: `stockDecrementCtes`/`stockIncrementCtes` take `req(variant_id, quantity)` and lock variants in id order. Remove the unused `decrementStock`, or re-key it.
- Every call site switches from product id to variant id: `placeOrder` and the cancel in `src/lib/orders.ts`, the late payment and expiry in `src/lib/payments.ts`, and `adjustStock`/`setStockTo`.
- `src/lib/cart.ts`: `heldBefore` is partitioned by variant. `addCartItem` and `setCartItemQuantity` check the variant's stock. `addToCart` takes a `variantId`.
- `src/lib/products.ts`: `Product` gets `variants: {id,label,stock}[]` plus a derived total `stock`. ProductCard, `stockState` and `/admin/stock` read the total.
- `ProductPurchase`: a size sells out when its variant's stock is 0. The `available` flag goes away, because 0 stock means sold out.
- **Admin:**
  - `SizeRows` edits labels and order. A size can only be removed while its stock is 0.
  - The stock panel on `/admin/products/[id]` adjusts per variant, with history.
  - `/admin/stock` lists low-stock sizes.
  - `product-input.ts` validation is updated.
- **Seed:** `src/db/seed.ts` creates variants.
- **Tests:** the stock, cart, orders, payments, stock-adjustments and seed tests are re-keyed. New cases: the backfill split, two sizes of one product with separate stock, and a race on the last unit of one size.

## Step 5: Guest carts
- **Schema:** `carts.user_id` becomes nullable, plus `token_hash text unique` and `updated_at`. A check makes sure exactly one of the two is set.
- **Guest identity:** a random 32-byte `cart` cookie (httpOnly, secure, sameSite=lax, 30 days). Only its SHA-256 hash is stored, and the cart row is created on the first add only.
- **Access:** `/cart` leaves the list of routes `src/proxy.ts` protects, and `addToCart`/`updateCartItem`/`removeFromCart` work without a session. `/checkout` still requires sign-in, and the cart page shows "Sign in to check out" (with `?next=/checkout`) to guests.
- **Cart functions:** they take an owner `{userId}|{tokenHash}`. `/api/cart/count` counts guest carts too.
- **Merge on sign-in and sign-up:** a Better Auth `hooks.after` (`createAuthMiddleware`) on the sign-in, sign-up and verify-email paths reads the cookie. `mergeGuestCart` is one statement that adds guest lines into the user's cart, capping each line at the variant's stock and 99, deletes the guest cart, and clears the cookie.
- **Cleanup:** the expiry cron also deletes guest carts untouched for 30 days.
- **Tests:** guest add, the merge (overlapping lines, the stock cap, a sold-out line), a forged or unknown token, and cleanup.

## Step 6: Wishlists
- **Table `wishlist_items`:** `user_id` (cascade), `product_id` (cascade), `created_at`, unique on the pair.
- **UI:**
  - A heart toggle on the product page. For guests it links to sign-in with `?next=`.
  - `/account/wishlist` lists saved products, skipping archived ones, with a "Move to bag" button when there's a single size.
  - A link from the account page, and `/account` is already protected.
- **Code:** `src/lib/wishlist.ts` and Server Functions with `requireSession`.
- **Tests:** toggle, archived products hidden, cascade.

## Step 7: Reviews
- **Table `reviews`:**
  - columns: `product_id` (cascade), `user_id` (cascade), `rating 1–5`, `title ≤ 120`, `body ≤ 2000`, `hidden_at`, `hidden_by`, timestamps
  - unique `(product_id, user_id)`
- **Who can review:** one statement inserts or edits a review only if the user has a `delivered` order containing the product.
- **Product page:** shows the average rating and count and the visible reviews (paged). When the viewer can review, a "Write a review" form appears. The page is revalidated after a write, and ISR stays.
- **`/admin/reviews`:** the newest reviews first, with hide and unhide (`requireAdmin`), plus a nav entry.
- **Tests:** eligibility (not delivered, other user's order), one per user, hidden reviews excluded from the average.

## Step 8: Discounts
- **Table `discount_codes`:**
  - columns: `code` (unique on `upper(code)`), `kind percent|fixed`, `value`, `min_subtotal`, `starts_at`, `ends_at`, `max_redemptions`, `redemptions`, `once_per_customer`, `active`
  - money in whole-shilling cents
- **Order columns:**
  - `orders` gets `subtotal bigint`, `discount bigint default 0`, `discount_code_id` (FK restrict) and a copied `discount_code text`.
  - Backfill `subtotal = total`.
  - Check `total = subtotal - discount`.
- **Apply at checkout:**
  - The checkout form gets a code field ("Apply" re-renders the summary with a preview).
  - `placeOrder` re-validates inside its single statement: it locks the code row, checks active, the time window, the limits and the minimum, and increments `redemptions`.
  - The discount is rounded down to a whole shilling and capped so the total stays at least KES 1 or more.
  - `startPayment`/`confirmPayment` need no change, because they read `orders.total`.
- **Releasing a code:** expiry gives the redemption back in the expiry statement. Cancelling a paid order doesn't.
- **Display:** `OrderSummary`, the order pages and the emails show subtotal, discount and total.
- **`/admin/discounts`:** list, new, edit, deactivate (never delete once used), plus a nav entry.
- **Tests:** each rule, two checkouts racing for the last redemption, expiry giving it back, `total = subtotal - discount`.

## Step 9: Go live
**Code:**
- **Paystack guard:**
  - Allow `sk_live_` only when `PAYSTACK_MODE=live` and `BETTER_AUTH_URL` is `https://`.
  - Keep refusing `sk_live_` in tests and development.
  - Update `src/lib/paystack.test.ts` and the wording in CLAUDE.md and `.env.example`.
- **Product images:** real products can't use Unsplash. Add uploads to Vercel Blob (`@vercel/blob`):
  - an admin-only upload action that checks type and size
  - allow the Blob host in `product-input.ts` and in `next.config.ts` `images.remotePatterns`
- **Headers and config** in `next.config.ts`:
  - `headers()`: HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'`, and a CSP that allows Paystack, Unsplash and Blob
  - `metadataBase`, plus `src/app/robots.ts` and `src/app/sitemap.ts` (on-sale products and categories, no admin or account pages)
  - Better Auth: `baseURL`, `trustedOrigins`, and `rateLimit: {storage: "database"}` (in-memory limits don't work on serverless). That needs a generated `rateLimit` table and migration.
- **Cron:** `.github/workflows/expire-orders.yml` runs every 15 minutes and calls `/api/cron/expire-orders` with `CRON_SECRET`, stored as a GitHub secret.
- **README:** replace the create-next-app template with setup, environment variables, migrations, how to make the first admin, deploy, and the cron.

**Launch checklist** (user actions, which I'll document and help with; they're not done by me):
- Complete Paystack business verification, then set the live webhook URL and callback domain in the live dashboard.
- Create a separate production Neon database, run `db:migrate` against it with explicit approval, and don't seed it. Create the first admin with SQL there.
- Set up a Vercel project with all the environment variables (including `NEXT_PUBLIC_BETTER_AUTH_URL` and `DATABASE_URL` at build time), a domain, and verify that domain in Resend (SPF/DKIM).
- Add store content: real products, images, delivery details, and privacy/terms/returns pages (the copy is the user's to supply).
- Smoke test on production with a small real payment, then refund it in Paystack and record the refund in `/admin/refunds`.

---

## Verification (every step)
- `npx tsc --noEmit`, `npm run lint`, `npm run test` (test database only) and `npm run build`.
- For UI steps, a browser check at phone width (a 390px iframe) and desktop width, against the build served on 127.0.0.1:3001 with the test database, as recorded in memory.
- For email steps, Resend is mocked in tests. For a manual check, dev mode logs the emails, or they go to the user's own address with a real key.
- A stop after each step: I summarise the changes, the files and anything unresolved, and the user tests and commits.
