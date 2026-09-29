# Admin side: investigation findings

What the app did before any admin work, as of commit `5fe9a4b` (2026-09-30). Five read-only investigations,
combined. The build plan is in [admin-plan.md](admin-plan.md).

## Products, categories and the data model

**Today**
- `categories`: `slug` (unique), `name`, `image` (nullable; categories without one are left out of the home
  grid), `position`. No active or archived flag.
- `products`: `category_id` (`on delete restrict`), unique `slug` and `sku`, `name`, `description`, `price`
  (KES cents), `stock`, `sizes` (display-only jsonb), `image`, `alt_image`, `gallery[]`, `details[]`, `badge`,
  `created_at`, `updated_at`.
- Checks: `price >= 0`, `price % 100 = 0` (whole shillings), `stock >= 0`.
- `cart_items.product_id` and `order_items.product_id` are `on delete set null`, and both keep a copy of the
  name. Order items also keep the SKU and unit price. A deleted product never breaks order history; the cart
  shows it as "No longer available".
- `src/lib/products.ts` only reads. There are no write functions, no admin or list-all queries, and `Product`
  doesn't expose `categoryId`, `createdAt` or `updatedAt`.
- Storefront pages use ISR (`revalidate = 60`) with `generateStaticParams` and default `dynamicParams`, so a new
  slug renders on first request. Nothing calls `revalidatePath`, so an edit can take up to 60s to show.
- `next.config.ts` only allows `images.unsplash.com`.
- `src/db/seed.ts` upserts on `slug` and overwrites every seeded field, including price, stock and `created_at`.

**Constraints for the admin**
- Prices are entered in shillings and stored ×100, otherwise the check fails.
- Duplicate slug or SKU is Postgres `23505`; show it on the field. Changing a slug breaks old URLs.
- A category with products can't be deleted (`23503`).
- Stock changes only through `src/lib/stock.ts`.
- Writes must call `revalidatePath` for the product page (old and new slug), both category pages,
  `/collections/new-in` and `/`.

**Gaps**
- No way to hide a product without deleting it.
- No visibility filter anywhere: storefront queries, `addCartItem`, `getCartProduct` and `placeOrder` all read
  every product.

## Stock and inventory

**Today**
- One integer per product, shared by all sizes, `>= 0`.
- It changes in three places only, all in single statements that lock products in id order and update all
  or none:
  - `placeOrder` takes stock (`stockDecrementCtes`).
  - `expireUnpaidOrders` returns it (`stockIncrementCtes`).
  - `confirmPayment` takes it again when an expired order is paid late.
- Carts check stock in the same statement as each write. `reconcileCart` only lowers saved quantities, and
  sold-out lines stay in the bag.
- Display: `stockState` / `stockLabel` in `src/lib/catalog.ts` (sold out at 0, "Only N left" at 3 or fewer).

**Gaps**
- No production "set stock" function (only the test fixture `setStock`).
- No record of why stock changed.

**Risk**
- "Set stock to N" from a stale read silently overwrites a concurrent sale.
- A change by a number of units (+N / −N), or a set that checks the value the admin saw, can't.

## Authentication and admin access

**Today**
- Better Auth 1.7.6 with email and password, no email verification, plugins `nextCookies()` only.
- Auth tables are in `src/db/auth-schema.ts` (migration `0001`).
- `src/lib/session.ts`:
  - `getSession`: cached per request.
  - `requireSession(returnTo)`: redirects to `/sign-in?next=`.
  - `safeRedirect`: same-origin only.
- Every protected page and Server Function calls `requireSession` itself.
- `src/proxy.ts` only checks the cookie, for `/account`, `/cart`, `/checkout` and `/orders`.
- No role concept.

**Constraints (Next 16 docs)**
- Server Functions are public POST endpoints: authorize inside each one.
- Proxy (formerly middleware) is an optimistic check only.
- Layout checks don't protect nested pages or actions.
- `forbidden()` / `unauthorized()` are experimental.

**Options**
- Better Auth admin plugin: about 15 endpoints including impersonation and password resets; too much surface.
- Admin email allowlist: unsafe without email verification, since anyone can register an allowlisted address
  that isn't registered yet.
- `role` via `user.additionalFields` with `input: false`: sign-up replaces any value sent with the default, and
  update-user rejects it with `FIELD_NOT_ALLOWED`.

## Orders, payments and the order lifecycle

**Today**
- `order_status`: `pending_payment`, `paid`, `processing`, `shipped`, `delivered`, `cancelled`, `expired`.
- Transitions in code:
  - `pending_payment` → `paid` (`confirmPayment`)
  - `expired` → `paid` (`confirmPayment`, if the stock can be taken again)
  - `pending_payment` → `expired` (`expireUnpaidOrders`)
- `processing`, `shipped`, `delivered` and `cancelled` have no code path.
- `payments`: one row per attempt (`pending`, `success`, `failed`, `abandoned`).
- Only `confirmPayment` marks an order paid, after Paystack's verify API matches reference, order id, amount
  and KES. It's idempotent.
- `orders.user_id` and `payments.order_id` are `on delete restrict`.

**Blind spots**
- **Mismatch:** a successful Paystack transaction that doesn't match its order leaves the attempt `pending`
  and is only logged.
- **Needs refund:** a success that can't be applied (order already paid, cancelled, or expired and sold out)
  sets the attempt to `success` and logs `REFUND NEEDED`. It's findable only by querying successful payments
  that aren't their order's `payment_reference`.
- Reversals after success aren't recorded.

**Gaps**
- No list of all orders, and no index on status.
- The order query loads only the paying payment.
- No fulfilment steps, cancel, refund tracking or history of who changed an order.

## UI patterns

**Reuse**
- Utilities: `btn*`, `label`, `eyebrow`, `heading-*`, `container-*`.
- Lists and details:
  - the account page's list rows and Newer/Older paging
  - `dl.divide-y` detail rows
  - `OrderSummary`
  - the notice box (`border p-4 text-sm`)
- Forms: the checkout form pattern (`useActionState`, `field()` with `aria-invalid` / `aria-describedby`,
  echoed values) and `useTransition` for inline actions.
- Helpers: `formatPrice`, `formatOrderDate`, `orderStatusLabel`.

**Missing**
- Shared input, select, table and badge styles. The input class is copy-pasted in three forms.
- Confirm step, saved-message notice.
- `loading.tsx`, `error.tsx` and `not-found.tsx` anywhere.

**Layout**
- The root layout wraps every route in `CartCountProvider`, `SiteHeader` and `SiteFooter`.
- An admin area needs the storefront moved into a `(store)` route group.

## Decisions (2026-09-30)

1. **Build order:** admin access, products and stock first; orders in a later slice. Build in steps, stopping
   after each for testing and a commit:
   1. route group move
   2. admin access
   3. products
   4. stock
2. **Removing products:** archive only, no hard delete.
3. **History tables:** `stock_adjustments` now; `order_events` in the orders slice.
4. **Layout:** move the storefront into `(store)` first, and verify every storefront URL still works.
5. **Images:** Unsplash URLs only.
6. **Docs and data:**
   - Update CLAUDE.md to the current state.
   - The seed must never overwrite existing products.
   - In the orders slice, record mismatched and needs-refund payments in the database.
