# Admin side: build plan

Based on [admin-findings.md](admin-findings.md) and the decisions recorded there. Five steps, each ending
at a stop: I verify, then you test and commit before the next one starts.

**Every step**
- Run `npx tsc --noEmit`, `npm run lint`, `npm run test` and `npm run build`.
- UI steps are also checked in the browser at phone and desktop widths.
- Migrations are generated and reviewed here and applied to the test database by the test run. I won't run
  `db:migrate` against the store database without your go-ahead.
- CLAUDE.md is updated in the same step as the change it describes.

---

## Step 1: Move the storefront into a `(store)` route group

No URL changes; only file locations and layouts.

**Changes**
- `git mv` into `src/app/(store)/`: `page.tsx`, `(auth)/`, `account/`, `cart/`, `checkout/`,
  `collections/`, `orders/`, `products/`.
  - These stay where they are: `api/`, `globals.css`, `favicon.ico` and the root `layout.tsx`.
- **Root `layout.tsx`:** keeps `<html>`, `<body>`, the font, `globals.css` and the default metadata.
  `CartCountProvider`, `SiteHeader`, `<main>` and `SiteFooter` move to a new `src/components/store-shell.tsx`.
- **New `src/app/(store)/layout.tsx`:** renders `<StoreShell>{children}</StoreShell>`.
- **New `src/app/not-found.tsx`:** wraps a short 404 message in `StoreShell`.
  - Why it's needed: unmatched URLs and `notFound()` render under the root layout, which will no longer have
    the header. Without this file, 404s would lose the storefront chrome.
  - It also means a non-admin who hits `/admin` sees the normal store 404.
  - Visible change: our own styled 404 replaces Next's default text.
- **Import paths:**
  - `@/app/cart|checkout|orders/actions` becomes `@/app/(store)/…` in `cart-line-controls.tsx`,
    `checkout-form.tsx`, `pay-button.tsx` and `product-purchase.tsx`, plus two tests.
  - The relative `tests/` imports in the moved tests get one more `../`.
- **CLAUDE.md:** update the paths it mentions.

**Verify**
- Run `npm run build`, then `npm run start`, and request every storefront URL. Check the status code and
  that the header and footer are present:
  - `/`, `/collections/new-in`, every `/collections/<slug>` and every `/products/<slug>` from the database
  - `/sign-in`, `/sign-up`
  - `/account`, `/cart`, `/checkout`, `/orders/<ref>`, `/orders/<ref>/payment`, `/account/orders/<ref>`
    (signed out, these should redirect to `/sign-in?next=…`)
  - `/api/cart/count`, `/api/auth/get-session`
  - `/products/does-not-exist` and `/does-not-exist` (404 with header)
- Browser check of the home, collection, product, sign-in and 404 pages at 390px and 1440px, including the
  mobile menu and cart count.
- Signed-in pages (account, cart, checkout, order) need an account. See the questions at the end.

---

## Step 2: Admin access

**Schema** (migration `0007`)
- `src/lib/auth.ts` gets
  `user.additionalFields.role = { type: "string", required: true, defaultValue: "user", input: false }`.
- Regenerate `src/db/auth-schema.ts` with the `npx auth generate` command.
- Expected SQL: `ALTER TABLE "user" ADD COLUMN "role" text DEFAULT 'user' NOT NULL;`. Existing users become
  `user`. I'll check that the generated column really is `not null` with that default before generating the
  migration.
- `input: false` means sign-up replaces any `role` sent with the default, and update-user rejects it. A test
  proves both against the real Better Auth instance, which needs a fixed fake `BETTER_AUTH_SECRET` added to
  `tests/setup.ts`.

**Guard**
- `requireAdmin(returnTo)` in `src/lib/session.ts`:
  - signed out: `requireSession` redirect to sign-in
  - `session.user.role !== "admin"`: `notFound()`
  - otherwise returns the session
- It is called by:
  - `src/app/admin/layout.tsx` (the shell)
  - every `page.tsx` under `admin/`, because layouts don't protect nested pages
  - the first line of every exported function in `src/app/admin/**/actions.ts`
- `src/proxy.ts` matcher adds `/admin/:path*`. This is a cookie check only.
- `/admin` sits outside `(store)`, so it gets no storefront header.

**Shell**
- `src/app/admin/layout.tsx`: a slim `header-bar` with "Sydo Admin", nav (Products, Categories, Stock; Orders
  comes later), "View store" and the existing `SignOutButton`.
  - Nav links use `link-quiet` with `aria-current`.
  - `metadata.robots` set to noindex.
- `src/app/admin/page.tsx`: an overview linking to each section, with product, archived and low-stock counts
  once those exist.
- The account page shows an "Admin" link to users with the admin role.

**First admin**
- There is no in-app way to become one. Sign up normally, then run once on the store database (Neon SQL
  editor or `db:studio`):
  `update "user" set role = 'admin' where email = '<your email>';`
- I'll document this in CLAUDE.md. I won't run it myself.

**Tests**
- `requireAdmin` with no session, with a customer and with an admin.
- Sign-up and update-user can't set `role`.
- One admin action that refuses a customer and writes nothing. This pattern gets reused in steps 3 and 4.

---

## Step 3: Products (with categories), archive only

**Schema** (migration `0008`)
- `products.archived_at timestamptz null`.

**Storefront: archived products disappear**
- `src/lib/products.ts`: every query adds `archived_at is null`. That covers `getProductSlugs`,
  `getProductBySlug` (so the page 404s), new arrivals, related and category products.
- `src/lib/cart.ts`:
  - `getCart` joins only unarchived products, so an archived product's line shows as "No longer available"
    like a deleted one, and checkout leaves it out.
  - `getCartProduct`, `addCartItem`, `setCartItemQuantity` and `reconcileCart` ignore archived products.
- `placeOrder`: a line whose product was archived after checkout loaded counts as unmatched, so the customer
  sees "Your bag has changed".
- Stock steps and `confirmPayment` don't look at `archived_at`. A late payment for an order that contains an
  archived product still works.
- Unarchiving brings the product and its cart lines back.

**Data layer**
New `src/lib/admin/products.ts` and `src/lib/admin/categories.ts`: server-only, not `"use server"`,
following the existing `src/lib` rule.
- Products:
  - `listAdminProducts({ q, categoryId, status: "active" | "archived" | "all", page })`
  - `getAdminProduct(id)`
  - `createProduct(input)`: stock starts at 0; step 4 adds stock.
  - `updateProduct(id, input)`: never touches stock.
  - `setProductArchived(id, archived)`
- Categories: `listAdminCategories` (with product counts), `createCategory`, `updateCategory`. No delete.
- `src/lib/admin/product-input.ts` parses form data into a typed input or field errors, and is unit-tested:
  - `name`
  - `slug`: kebab-case, generated from the name if left blank
  - `sku`: upper-case letters, digits and `-`
  - `categoryId`
  - `description`
  - `price`: entered in whole shillings, stored ×100
  - `sizes`: label plus available rows, or none for one size
  - `image`, `altImage`, `gallery[]`: `https://images.unsplash.com/…` only
  - `details[]`: one per line
  - `badge`
- Duplicate slug or SKU (`23505` on `products_slug_unique` / `products_sku_unique`) becomes an error on that
  field.

**Server Functions**
- `src/app/admin/products/actions.ts` and `src/app/admin/categories/actions.ts`. Each one:
  1. calls `requireAdmin`
  2. parses the input
  3. calls the lib function
  4. revalidates the affected paths
  5. redirects with `?saved=1`
- Revalidated paths: `/`, `/collections/new-in`, `/products/<old and new slug>`,
  `/collections/<old and new category>`.

**Pages**
- `/admin/products`: table with thumbnail, name, SKU, category, price, stock, status badge; search, category
  and status filters; Newer/Older paging like the account page.
- `/admin/products/new` and `/admin/products/[id]`: the form, with an image preview, a link to the live page,
  and Archive/Unarchive behind a two-step confirm.
- `/admin/categories`, `/admin/categories/new`, `/admin/categories/[id]`.

**UI primitives**
- `globals.css`: `.input`, `.field-error`, `.field-hint`, `.badge` (neutral, success and error tones) and
  `.table-data`.
- `src/components/admin/`: `Field`, `StatusBadge`, `ProductForm`, `SizeRows`, `ImagePreview`, `SavedNotice`,
  `ConfirmButton`.
- The three existing storefront forms keep their own input class. Switching them to `.input` is a separate
  clean-up.

**Seed**
- Products and categories switch to `onConflictDoNothing`. Category ids are then read back by slug.
- Re-seeding only adds missing items and never changes existing ones.
- Update the Seed line in CLAUDE.md.

**Tests**
- Archived products are hidden from every storefront query, cart write and `placeOrder`.
- Create, update, archive and unarchive.
- Duplicate slug and SKU.
- Validation cases.
- Admin-only enforcement on each action.
- The seed doesn't overwrite changes. Tested with a changed price and name, through a seed function exported
  for the test.

---

## Step 4: Stock

**Schema** (migration `0009`)
- New table `stock_adjustments`:

| Column | Type | Rules |
|---|---|---|
| `id` | integer identity | primary key |
| `product_id` | integer | FK to products, `on delete set null` |
| `user_id` | text | FK to user, `on delete restrict`: the admin who made it |
| `delta` | integer | not null, check `<> 0` |
| `previous_stock` | integer | not null |
| `new_stock` | integer | not null, check `>= 0` |
| `reason` | enum `stock_adjustment_reason` | `received`, `correction`, `damaged`, `returned`, `other` |
| `note` | text | nullable, 500 characters at most |
| `created_at` | timestamptz | |

- Index on `(product_id, created_at)`.
- Checkout, expiry and late payments are not logged here; the table only records manual adjustments. Those
  flows go into `order_events` in the orders slice.

**`src/lib/stock.ts`**
Keeps the "only stock.ts changes stock" rule. Not `"use server"`.
- `adjustStock({ productId, delta, reason, note, userId })`
  - One statement: lock the product row `for update`, update `stock = stock + delta` only if the result is
    `>= 0`, and insert the log row from the update's `returning`. The change and its record are atomic.
  - Returns `{ ok: true, stock }`, or `{ ok: false, reason: "insufficient" | "not-found", current }`.
- `setStockTo({ productId, expected, stock, reason, note, userId })`
  - Same statement, conditional on `stock = expected`.
  - Returns `stale` with the current value if a sale happened since the admin loaded the page.
  - A no-op (same value) writes nothing.
- `getStockHistory(productId, limit)`.
- Both writes validate ids and amounts (safe integers, delta not 0, within ±1,000,000) and throw on invalid
  input, like `decrementStock`.

**UI**
- Stock panel on `/admin/products/[id]`:
  - current stock
  - a form: "Add / Remove N" or "Set to N" (sends the value shown as `expected`), plus reason and note
  - a history table: when, who, change, before → after, reason, note
- `/admin/stock`: sold-out and low-stock products (at or below `LOW_STOCK_THRESHOLD`), lowest first, each
  linking to its stock panel.
- `adjustStockAction` in `src/app/admin/products/actions.ts`: `requireAdmin`, parse, call, revalidate the
  product's pages. A stale or insufficient result shows the current value and asks the admin to try again.

**Tests**
- Raise and lower.
- A negative result is refused and changes and logs nothing.
- A stale set is refused and reports the current value.
- Invalid input throws.
- The log row matches the change.
- Races, using the existing `Promise.all` and lock-holding helpers in `stock.test.ts` / `payments.test.ts`:
  - against `decrementStock` and `placeOrder`
  - against the expiry sweep
  - while another transaction holds the row lock
- Admin-only enforcement.
- `resetCatalog` also truncates `stock_adjustments`.

---

## Step 5: Orders

Decisions from your answers (2026-09-30) are built in below.

**Schema** (migration `0010`)
- New table `order_events`, one row per status change:

| Column | Type | Rules |
|---|---|---|
| `id` | integer identity | primary key |
| `order_id` | integer | not null, FK to orders, `on delete restrict` |
| `user_id` | text | FK to user, `on delete restrict`; null for changes the system makes |
| `from_status` | `order_status` | not null |
| `to_status` | `order_status` | not null, check `<> from_status` |
| `note` | text | nullable, 500 characters at most; admin-only |
| `created_at` | timestamptz | |

- Index on `order_events (order_id, created_at)`, and on `orders (status, created_at)` for the admin list.
- `orders` gets:
  - `cancel_reason`: new enum `order_cancel_reason` (`out_of_stock`, `payment_issue`, `customer_request`,
    `other`). Shown to the customer. Check: set exactly when the status is `cancelled`.
  - `shipping_carrier` and `tracking_number`: text, both optional, 100 characters at most. Shown to the
    customer only when filled in.
- `payments` gets refund tracking:
  - `refund_status`: new enum `refund_status` (`due`, `refunded`), nullable
  - `refund_reason`: new enum `refund_reason`:
    - `order_cancelled`: an admin cancelled the paid order
    - `duplicate_payment`: the order was already paid by another attempt
    - `order_unavailable`: the order was cancelled or expired and sold out when the payment landed
    - `mismatch`: Paystack's record didn't match the order (amount, currency or order)
  - `refund_detail`: text, what the system saw (e.g. the mismatch)
  - `refund_reference`: text, the Paystack refund reference the admin enters
  - `refunded_on`: date, entered by the admin
  - `refund_recorded_by`: FK to user, `on delete restrict`; `refund_recorded_at`: timestamptz
  - Checks:
    - `refund_reason` is set exactly when `refund_status` is.
    - `refunded` requires the reference, the date and who recorded it.

**Allowed changes**

| From | To | Stock | Condition |
|---|---|---|---|
| `paid` | `processing` | unchanged | |
| `processing` | `shipped` | unchanged | optional carrier and tracking number |
| `shipped` | `delivered` | unchanged | |
| `pending_payment` | `cancelled` | returned | no payment attempt still `pending` |
| `paid`, `processing` | `cancelled` | returned | the paying payment becomes refund `due` |

- Forward only. Nothing leaves `delivered` or `cancelled`, and shipped orders can't be cancelled. A return after
  delivery is a stock adjustment with the "Customer return" reason.
- Cancelling needs a customer-facing reason from the list, and takes an optional internal note.
- Carrier and tracking number can be corrected later on shipped and delivered orders. Corrections aren't in the
  timeline, which only records status changes.
- Unpaid orders with an open attempt can't be cancelled: the page says the customer may be paying and the order
  expires by itself after `PAYMENT_WINDOW_MINUTES` if unpaid. `startPayment` locks the order row, so a cancel and
  a new payment attempt can't interleave.

**`src/lib/orders.ts`**
- `changeOrderStatus({ orderId, expected, to, cancelReason, note, carrier, trackingNumber, userId })`, one
  statement:
  - locks the order row `for update`
  - applies the change only if the status is still `expected`, the change is allowed, and (for an unpaid cancel)
    no attempt is pending
  - for a cancel, returns the stock with `stockIncrementCtes`, like the expiry sweep, and for a paid cancel
    marks the paying payment refund `due` (`order_cancelled`)
  - inserts the `order_events` row
  - returns `{ ok: true }` or `{ ok: false, reason: "stale", current }` / `"payment-open"` / `"not-allowed"` /
    `"not-found"`; throws on invalid input
- `setTracking({ orderId, carrier, trackingNumber })` for corrections on shipped and delivered orders.
- A payment that lands while an admin cancels: both lock the order row, so exactly one wins. If the cancel
  wins, `confirmPayment` marks the payment refund `due` (`order_unavailable`). If the payment wins, the cancel
  is refused as stale.

**Payment changes**
- `confirmPayment` records its problem outcomes on the payment instead of only logging them:
  - `mismatch`: refund `due` (`mismatch`), with the mismatch in `refund_detail`
  - `needs-refund`: refund `due` (`duplicate_payment` or `order_unavailable`)
  - It's called repeatedly, so it never overwrites a refund that's already recorded.
- `confirmPayment` (paid, and expired → paid) and `expireUnpaidOrders` add an `order_events` row with no user, in
  the statements they already run.

**Data layer** (`src/lib/admin/orders.ts`, server-only, not `"use server"`)
- `listAdminOrders({ q, status, refund, page })`
  - search by reference, customer name, email or phone
  - filter by status, and by "has a refund due"
- `getAdminOrder(reference)`: items, delivery, customer, tracking, every payment attempt with its refund
  fields, and the events.
- `listRefundsDue()`: payments with refund `due`, oldest first.
- `recordRefund({ paymentId, reference, refundedOn, userId })`: conditional on the refund still being `due`.
- `countOrdersToFulfil()` (paid + processing) and `countRefundsDue()` for the overview.

**Server Functions** (`src/app/admin/orders/actions.ts`)
- `changeOrderStatusAction`, `setTrackingAction` and `recordRefundAction`: `requireAdmin` first, parse, call,
  then redirect with `?saved=`, like steps 3 and 4. A stale result shows the current status.

**Pages**
- `/admin/orders`: reference, date, customer, total, status badge, and a "Refund due" badge. Search, status and
  refund filters, Newer/Older paging.
- `/admin/orders/[reference]`:
  - items and totals (reusing `OrderSummary`), delivery details, customer name and email
  - the next step as one button behind the two-step confirm; "Mark as shipped" has the two optional fields
  - Cancel, with the reason list and an internal note, only where allowed
  - tracking, editable once shipped
  - every payment attempt: status, channel, amount, refund status, and a "Record refund" form (Paystack refund
    reference and date) on refunds due
  - the timeline from `order_events`, with internal notes
- `/admin/refunds`: "Needs refund", each linking to its order, oldest first.
- Nav gets Orders and Refunds. The overview gets "to fulfil" and "refunds due" counts.

**Customers** (`/orders/[reference]` and `/account/orders/[reference]`)
- The new statuses show through the existing labels.
- Cancelled: the reason as a sentence (e.g. "Cancelled: an item is out of stock").
- Refunds on the order's payments: "Refund pending" or "Refunded on 2 October 2026".
- Shipped or delivered: carrier and tracking number, each only if filled in.
- Internal notes and the timeline stay admin-only.

**Tests**
- Each allowed change, each refused one (stale, payment open, not allowed, unknown order) and invalid input.
- Cancel returns the stock exactly once, including racing the expiry sweep, `confirmPayment` and
  `startPayment`.
- Cancelling a paid order marks its payment refund `due`; recording the refund, and recording it twice.
- `confirmPayment` records mismatches and refunds once and never overwrites a recorded refund.
- Events recorded for admin, payment and expiry changes, with the right user or none.
- Tracking set when shipping and corrected later; the customer page shows only what's filled in.
- Admin-only enforcement on every action.
- `resetCatalog` also truncates `order_events`.

**Not included**
- Refunds through Paystack's API, emails to customers, editing an order's items or address, partial
  cancellations or refunds.

## Questions before step 1

1. **Categories in step 3:** create and edit only, no delete or archive. Is that enough?
2. **Signed-in checks:** checking the signed-in storefront pages in the browser needs an account on the store
   database. Can I create a throwaway one (e.g. `admin-test+<date>@example.com`) through the normal sign-up,
   or would you rather check those pages yourself?
