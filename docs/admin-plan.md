# Admin side: build plan

Based on [admin-findings.md](admin-findings.md) and the decisions recorded there. Four steps, each ending
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

## Later: the orders slice

Outline only; it gets its own detailed plan after step 4.
- `order_events`: who, from status, to status, note, when.
- Admin order list and detail, with all payment attempts.
- Allowed changes: paid → processing → shipped → delivered, and cancel with stock return. Each change is
  conditional on the expected current status.
- Record mismatched and needs-refund payments in the database (a problem column or table on `payments`), and
  give admins a list of them.
- Index on `orders (status, created_at)`.

## Questions before step 1

1. **Categories in step 3:** create and edit only, no delete or archive. Is that enough?
2. **Signed-in checks:** checking the signed-in storefront pages in the browser needs an account on the store
   database. Can I create a throwaway one (e.g. `admin-test+<date>@example.com`) through the normal sign-up,
   or would you rather check those pages yourself?
