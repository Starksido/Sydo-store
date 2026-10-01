// Parses and validates the admin product and category forms. No database access, so the client-side
// forms can import the types and `isUnsplashUrl`. Uniqueness (slug, SKU) is checked by the database.

/** A size row as submitted: `id` is the saved size's (variant's) id, or "" for a new size. */
export type SizeRowValues = { id: string; label: string };

/** A size to keep (`id`, renamed to `label`) or to add (`id` null), in display order. */
export type SizeInput = { id: number | null; label: string };

/** Form fields as submitted, kept as strings so a form that fails validation can be shown again. */
export type ProductFormValues = {
  name: string;
  slug: string;
  sku: string;
  categoryId: string;
  description: string;
  /** Whole shillings, e.g. "375700". */
  price: string;
  sizes: SizeRowValues[];
  image: string;
  altImage: string;
  /** One URL per line. */
  gallery: string;
  /** One detail per line. */
  details: string;
  badge: string;
};

export type ProductField = keyof ProductFormValues;

/** What `createProduct` / `updateProduct` store. Stock isn't part of it: sizes start at 0. */
export type ProductInput = {
  name: string;
  slug: string;
  sku: string;
  categoryId: number;
  description: string;
  /** KES cents, whole shillings. */
  price: number;
  /** In display order. Empty for a one-size item. */
  sizes: SizeInput[];
  image: string;
  altImage: string | null;
  gallery: string[];
  details: string[];
  badge: string | null;
};

export type FieldErrors<F extends string> = Partial<Record<F, string>>;

export type ParseResult<T, F extends string> = { ok: true; input: T } | { ok: false; errors: FieldErrors<F> };

export const EMPTY_PRODUCT_FORM: ProductFormValues = {
  name: "",
  slug: "",
  sku: "",
  categoryId: "",
  description: "",
  price: "",
  sizes: [],
  image: "",
  altImage: "",
  gallery: "",
  details: "",
  badge: "",
};

/** Highest price accepted, in whole shillings; `products.price` is an integer number of cents. */
export const MAX_PRICE_SHILLINGS = 10_000_000;
const MAX_SIZES = 30;
const MAX_GALLERY = 12;
const MAX_DETAILS = 20;
const MAX_URL = 1000;
/** Longest value read from any form field; longer input is cut before validation. */
const MAX_FIELD = 10_000;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKU = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

/** Only images.unsplash.com over https, the one host `next.config.ts` allows images from. */
export function isUnsplashUrl(value: string) {
  if (value.length > MAX_URL) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "images.unsplash.com" && url.pathname.length > 1;
  } catch {
    return false;
  }
}

/** A URL slug from a name: "Floral silk wrap dress" → "floral-silk-wrap-dress". */
export function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
    .replace(/-+$/, "");
}

function text(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.slice(0, MAX_FIELD) : "";
}

function lines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Reads the product form. Size rows are `sizes.<n>.id` / `sizes.<n>.label`, in row order. */
export function readProductForm(formData: FormData): ProductFormValues {
  const rows = new Set<number>();
  for (const key of formData.keys()) {
    const match = /^sizes\.(\d{1,3})\.label$/.exec(key);
    if (match) rows.add(Number(match[1]));
  }
  const sizes = [...rows]
    .sort((a, b) => a - b)
    .map((row) => ({
      id: text(formData, `sizes.${row}.id`).slice(0, 20),
      label: text(formData, `sizes.${row}.label`).slice(0, 100),
    }));

  return {
    name: text(formData, "name"),
    slug: text(formData, "slug"),
    sku: text(formData, "sku"),
    categoryId: text(formData, "categoryId"),
    description: text(formData, "description"),
    price: text(formData, "price"),
    sizes,
    image: text(formData, "image"),
    altImage: text(formData, "altImage"),
    gallery: text(formData, "gallery"),
    details: text(formData, "details"),
    badge: text(formData, "badge"),
  };
}

function parseId(value: string) {
  return /^\d{1,9}$/.test(value.trim()) && Number(value) > 0 ? Number(value) : null;
}

function parseSlug(value: string, name: string): [string | null, string | undefined] {
  const slug = value.trim() || slugify(name);
  if (!slug) return [null, "Enter a slug, or a name to make one from."];
  if (slug.length > 100 || !SLUG.test(slug)) {
    return [null, "Use lower-case letters, digits and single hyphens, e.g. silk-wrap-dress."];
  }
  return [slug, undefined];
}

export function parseProductInput(values: ProductFormValues): ParseResult<ProductInput, ProductField> {
  const errors: FieldErrors<ProductField> = {};

  const name = values.name.trim();
  if (!name) errors.name = "Enter a name.";
  else if (name.length > 200) errors.name = "Use 200 characters or fewer.";

  const [slug, slugError] = parseSlug(values.slug, name);
  if (slugError) errors.slug = slugError;

  const sku = values.sku.trim().toUpperCase();
  if (!sku) errors.sku = "Enter a SKU.";
  else if (sku.length > 40 || !SKU.test(sku)) errors.sku = "Use letters, digits and single hyphens, e.g. SY-W-24102.";

  const categoryId = parseId(values.categoryId);
  if (!categoryId) errors.categoryId = "Choose a category.";

  const description = values.description.trim();
  if (!description) errors.description = "Enter a description.";
  else if (description.length > 5000) errors.description = "Use 5,000 characters or fewer.";

  const priceText = values.price.trim().replace(/,/g, "");
  const shillings = Number(priceText);
  if (!priceText) errors.price = "Enter a price in shillings.";
  else if (!/^\d+$/.test(priceText)) errors.price = "Enter whole shillings, without cents, e.g. 375700.";
  else if (shillings < 1 || shillings > MAX_PRICE_SHILLINGS) {
    errors.price = `Enter a price from KES 1 to KES ${MAX_PRICE_SHILLINGS.toLocaleString("en-KE")}.`;
  }

  const sizes = values.sizes
    .map((size) => ({ id: parseId(size.id), label: size.label.trim() }))
    .filter((size) => size.label);
  const labels = new Set(sizes.map((size) => size.label.toLowerCase()));
  const ids = sizes.flatMap((size) => (size.id ? [size.id] : []));
  if (sizes.length > MAX_SIZES) errors.sizes = `Use ${MAX_SIZES} sizes or fewer.`;
  else if (sizes.some((size) => size.label.length > 20)) errors.sizes = "Keep each size to 20 characters or fewer.";
  else if (labels.size !== sizes.length || new Set(ids).size !== ids.length) {
    errors.sizes = "Each size can only be listed once.";
  }

  const image = values.image.trim();
  if (!image) errors.image = "Enter the main image URL.";
  else if (!isUnsplashUrl(image)) errors.image = "Use an https://images.unsplash.com/… URL.";

  const altImage = values.altImage.trim();
  if (altImage && !isUnsplashUrl(altImage)) errors.altImage = "Use an https://images.unsplash.com/… URL.";

  const gallery = lines(values.gallery);
  if (gallery.length > MAX_GALLERY) errors.gallery = `Use ${MAX_GALLERY} images or fewer.`;
  else if (!gallery.every(isUnsplashUrl)) errors.gallery = "Put one https://images.unsplash.com/… URL on each line.";

  const details = lines(values.details);
  if (details.length > MAX_DETAILS) errors.details = `Use ${MAX_DETAILS} lines or fewer.`;
  else if (details.some((detail) => detail.length > 200)) errors.details = "Keep each line to 200 characters or fewer.";

  const badge = values.badge.trim();
  if (badge.length > 30) errors.badge = "Use 30 characters or fewer.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    input: {
      name,
      slug: slug!,
      sku,
      categoryId: categoryId!,
      description,
      price: shillings * 100,
      sizes,
      image,
      altImage: altImage || null,
      gallery,
      details,
      badge: badge || null,
    },
  };
}

/** The form values for an existing product, with its sizes (variants) in display order. */
export function productFormValues(
  product: Omit<ProductInput, "sizes"> & { variants: { id: number; label: string | null }[] },
): ProductFormValues {
  return {
    name: product.name,
    slug: product.slug,
    sku: product.sku,
    categoryId: String(product.categoryId),
    description: product.description,
    price: String(product.price / 100),
    sizes: product.variants.flatMap((variant) =>
      variant.label === null ? [] : [{ id: String(variant.id), label: variant.label }],
    ),
    image: product.image,
    altImage: product.altImage ?? "",
    gallery: product.gallery.join("\n"),
    details: product.details.join("\n"),
    badge: product.badge ?? "",
  };
}

// ---------- Categories ----------

export type CategoryFormValues = { name: string; slug: string; image: string; position: string };

export type CategoryField = keyof CategoryFormValues;

export type CategoryInput = { name: string; slug: string; image: string | null; position: number };

export const EMPTY_CATEGORY_FORM: CategoryFormValues = { name: "", slug: "", image: "", position: "0" };

export function readCategoryForm(formData: FormData): CategoryFormValues {
  return {
    name: text(formData, "name"),
    slug: text(formData, "slug"),
    image: text(formData, "image"),
    position: text(formData, "position"),
  };
}

export function parseCategoryInput(values: CategoryFormValues): ParseResult<CategoryInput, CategoryField> {
  const errors: FieldErrors<CategoryField> = {};

  const name = values.name.trim();
  if (!name) errors.name = "Enter a name.";
  else if (name.length > 100) errors.name = "Use 100 characters or fewer.";

  const [slug, slugError] = parseSlug(values.slug, name);
  if (slugError) errors.slug = slugError;

  const image = values.image.trim();
  if (image && !isUnsplashUrl(image)) errors.image = "Use an https://images.unsplash.com/… URL.";

  const positionText = values.position.trim() || "0";
  const position = /^\d{1,4}$/.test(positionText) ? Number(positionText) : NaN;
  if (!Number.isInteger(position) || position > 1000) errors.position = "Enter a whole number from 0 to 1,000.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, input: { name, slug: slug!, image: image || null, position } };
}

// ---------- Stock adjustments ----------

// Kept in step with `STOCK_ADJUSTMENT_REASONS` in `@/lib/stock`, which this client-safe module can't import.
export const STOCK_REASONS = [
  { value: "received", label: "Received stock" },
  { value: "correction", label: "Count correction" },
  { value: "damaged", label: "Damaged or lost" },
  { value: "returned", label: "Customer return" },
  { value: "other", label: "Other" },
] as const;

export type StockReason = (typeof STOCK_REASONS)[number]["value"];

export type StockMode = "add" | "remove" | "set";

export type StockFormValues = { variantId: string; mode: string; quantity: string; reason: string; note: string };

export type StockField = keyof StockFormValues;

export type StockInput = { variantId: number; reason: StockReason; note: string | null } & (
  | { mode: "adjust"; delta: number }
  | { mode: "set"; stock: number; expected: number }
);

const MAX_STOCK = 1_000_000;

export function readStockForm(formData: FormData): StockFormValues & { expected: string } {
  return {
    variantId: text(formData, "variantId"),
    mode: text(formData, "mode"),
    quantity: text(formData, "quantity"),
    reason: text(formData, "reason"),
    note: text(formData, "note"),
    expected: text(formData, "expected"),
  };
}

/**
 * "Add N" and "Remove N" become a relative change; "Set to N" becomes an absolute one that only
 * applies if stock is still `expected`, the number the admin was shown.
 */
export function parseStockInput(
  values: StockFormValues & { expected: string },
): ParseResult<StockInput, StockField | "expected"> {
  const errors: FieldErrors<StockField | "expected"> = {};

  const variantId = parseId(values.variantId);
  if (!variantId) errors.variantId = "Choose a size.";

  const mode = (["add", "remove", "set"] as const).find((m) => m === values.mode);
  if (!mode) errors.mode = "Choose add, remove or set.";

  const quantityText = values.quantity.trim().replace(/,/g, "");
  const quantity = Number(quantityText);
  const min = mode === "set" ? 0 : 1;
  if (!quantityText) errors.quantity = "Enter a number of units.";
  else if (!/^\d+$/.test(quantityText)) errors.quantity = "Enter a whole number of units.";
  else if (quantity < min || quantity > MAX_STOCK) {
    errors.quantity = `Enter ${min} to ${MAX_STOCK.toLocaleString("en-KE")}.`;
  }

  const reason = STOCK_REASONS.find((r) => r.value === values.reason)?.value;
  if (!reason) errors.reason = "Choose a reason.";

  const note = values.note.trim();
  if (note.length > 500) errors.note = "Use 500 characters or fewer.";

  const expected = /^\d{1,7}$/.test(values.expected.trim()) ? Number(values.expected) : NaN;
  if (mode === "set" && !(expected <= MAX_STOCK)) errors.expected = "Reload the page and try again.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const meta = { variantId: variantId!, reason: reason!, note: note || null };
  return {
    ok: true,
    input:
      mode === "set"
        ? { ...meta, mode: "set", stock: quantity, expected }
        : { ...meta, mode: "adjust", delta: mode === "add" ? quantity : -quantity },
  };
}
