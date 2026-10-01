import { describe, expect, it } from "vitest";

import { stockAdjustmentReason } from "@/db/schema";
import {
  EMPTY_PRODUCT_FORM,
  isUnsplashUrl,
  parseCategoryInput,
  parseProductInput,
  parseStockInput,
  productFormValues,
  readProductForm,
  slugify,
  STOCK_REASONS,
  type ProductFormValues,
} from "@/lib/admin/product-input";
import { STOCK_ADJUSTMENT_REASONS } from "@/lib/stock";

const IMAGE = "https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=1200&q=80";

const valid: ProductFormValues = {
  ...EMPTY_PRODUCT_FORM,
  name: "Floral silk wrap dress",
  sku: "SY-W-24102",
  categoryId: "3",
  description: "A fluid midi wrap dress.",
  price: "318500",
  image: IMAGE,
};

function errorsFor(values: Partial<ProductFormValues>) {
  const result = parseProductInput({ ...valid, ...values });
  if (result.ok) throw new Error(`Expected errors for ${JSON.stringify(values)}`);
  return result.errors;
}

describe("parseProductInput", () => {
  it("turns the form into what's stored: cents, trimmed text, lists and nulls", () => {
    const result = parseProductInput({
      ...valid,
      name: "  Floral silk wrap dress ",
      sku: " sy-w-24102 ",
      price: "318,500",
      sizes: [
        { id: "12", label: " S " },
        { id: "", label: "" },
        { id: "", label: "M" },
      ],
      gallery: `${IMAGE}\n\n  ${IMAGE}&h=1600  \n`,
      details: "100% silk\r\n\r\nDry clean only\n",
      badge: " New ",
    });
    expect(result).toEqual({
      ok: true,
      input: {
        name: "Floral silk wrap dress",
        slug: "floral-silk-wrap-dress",
        sku: "SY-W-24102",
        categoryId: 3,
        description: "A fluid midi wrap dress.",
        price: 31_850_000,
        sizes: [
          { id: 12, label: "S" },
          { id: null, label: "M" },
        ],
        image: IMAGE,
        altImage: null,
        gallery: [IMAGE, `${IMAGE}&h=1600`],
        details: ["100% silk", "Dry clean only"],
        badge: "New",
      },
    });
  });

  it("stores no sizes as one-size, and keeps a slug that was given", () => {
    const result = parseProductInput({ ...valid, slug: "wrap-dress", sizes: [{ id: "", label: " " }] });
    expect(result).toMatchObject({ ok: true, input: { slug: "wrap-dress", sizes: [] } });
  });

  it("requires the name, SKU, category, description, price and main image", () => {
    expect(Object.keys(errorsFor({ name: "", sku: "", categoryId: "", description: " ", price: "", image: "" })).sort()).toEqual(
      ["categoryId", "description", "image", "name", "price", "sku", "slug"],
    );
  });

  it("refuses badly formed slugs and SKUs", () => {
    for (const slug of ["Wrap-Dress", "wrap--dress", "-wrap", "wrap dress", "wrap_dress", "a".repeat(101)]) {
      expect(errorsFor({ slug }), slug).toHaveProperty("slug");
    }
    for (const sku of ["SY W 1", "SY--1", "-SY", "SY_1", "A".repeat(41)]) {
      expect(errorsFor({ sku }), sku).toHaveProperty("sku");
    }
  });

  it("takes prices in whole shillings from 1 to 10,000,000", () => {
    for (const price of ["0", "-5", "12.50", "1e3", "abc", "10000001", "99999999999"]) {
      expect(errorsFor({ price }), price).toHaveProperty("price");
    }
    expect(parseProductInput({ ...valid, price: "1" })).toMatchObject({ ok: true, input: { price: 100 } });
    expect(parseProductInput({ ...valid, price: "10,000,000" })).toMatchObject({
      ok: true,
      input: { price: 1_000_000_000 },
    });
  });

  it("only takes images.unsplash.com URLs", () => {
    for (const url of [
      "http://images.unsplash.com/photo-1",
      "https://unsplash.com/photos/1",
      "https://images.unsplash.com.evil.com/photo-1",
      "https://evil.com/?https://images.unsplash.com/photo-1",
      "javascript:alert(1)",
      "https://images.unsplash.com/",
    ]) {
      expect(errorsFor({ image: url, altImage: url, gallery: url }), url).toMatchObject({
        image: expect.any(String),
        altImage: expect.any(String),
        gallery: expect.any(String),
      });
    }
  });

  it("refuses duplicate or overlong sizes and too many lines", () => {
    expect(
      errorsFor({
        sizes: [
          { id: "", label: "M" },
          { id: "", label: "m" },
        ],
      }),
    ).toHaveProperty("sizes");
    expect(
      errorsFor({
        sizes: [
          { id: "4", label: "S" },
          { id: "4", label: "M" },
        ],
      }),
    ).toHaveProperty("sizes");
    expect(errorsFor({ sizes: [{ id: "", label: "x".repeat(21) }] })).toHaveProperty("sizes");
    expect(errorsFor({ details: Array.from({ length: 21 }, (_, i) => `Line ${i}`).join("\n") })).toHaveProperty("details");
    expect(errorsFor({ gallery: Array(13).fill(IMAGE).join("\n") })).toHaveProperty("gallery");
    expect(errorsFor({ badge: "x".repeat(31) })).toHaveProperty("badge");
  });
});

describe("readProductForm", () => {
  it("reads size rows in row order, with their saved ids", () => {
    const form = new FormData();
    form.set("name", "Dress");
    form.set("sizes.10.label", "L");
    form.set("sizes.2.label", "S");
    form.set("sizes.2.id", "7");
    expect(readProductForm(form)).toMatchObject({
      name: "Dress",
      sku: "",
      sizes: [
        { id: "7", label: "S" },
        { id: "", label: "L" },
      ],
    });
  });

  it("round-trips a stored product with its sizes", () => {
    const parsed = parseProductInput({
      ...valid,
      sizes: [
        { id: "3", label: "S" },
        { id: "5", label: "M" },
      ],
    });
    if (!parsed.ok) throw new Error("valid product refused");
    const { sizes, ...stored } = parsed.input;
    const variants = sizes.map((size) => ({ id: size.id!, label: size.label }));
    expect(parseProductInput(productFormValues({ ...stored, variants }))).toEqual(parsed);
  });

  it("shows a one-size product with no size rows", () => {
    const parsed = parseProductInput(valid);
    if (!parsed.ok) throw new Error("valid product refused");
    expect(productFormValues({ ...parsed.input, variants: [{ id: 9, label: null }] }).sizes).toEqual([]);
  });
});

describe("parseCategoryInput", () => {
  it("makes the slug from the name and defaults the position to 0", () => {
    expect(parseCategoryInput({ name: " Evening wear ", slug: "", image: "", position: "" })).toEqual({
      ok: true,
      input: { name: "Evening wear", slug: "evening-wear", image: null, position: 0 },
    });
  });

  it("refuses a bad slug, image or position", () => {
    const result = parseCategoryInput({ name: "", slug: "Bad Slug", image: "https://evil.com/a.jpg", position: "-1" });
    expect(result).toEqual({
      ok: false,
      errors: {
        name: expect.any(String),
        slug: expect.any(String),
        image: expect.any(String),
        position: expect.any(String),
      },
    });
  });
});

describe("helpers", () => {
  it("slugify strips accents and punctuation", () => {
    expect(slugify("  Crêpe & Silk: Été '26!  ")).toBe("crepe-silk-ete-26");
    expect(slugify("---")).toBe("");
  });

  it("isUnsplashUrl accepts only https images.unsplash.com paths", () => {
    expect(isUnsplashUrl(IMAGE)).toBe(true);
    expect(isUnsplashUrl("not a url")).toBe(false);
  });
});

describe("parseStockInput", () => {
  const base = { variantId: "8", mode: "add", quantity: "5", reason: "received", note: "", expected: "3" };

  it("turns add and remove into a relative change, and set into one checked against what was shown", () => {
    expect(parseStockInput({ ...base, note: " Invoice 42 " })).toEqual({
      ok: true,
      input: { variantId: 8, mode: "adjust", delta: 5, reason: "received", note: "Invoice 42" },
    });
    expect(parseStockInput({ ...base, mode: "remove", quantity: "1,000", reason: "damaged" })).toEqual({
      ok: true,
      input: { variantId: 8, mode: "adjust", delta: -1000, reason: "damaged", note: null },
    });
    expect(parseStockInput({ ...base, mode: "set", quantity: "0", reason: "correction" })).toEqual({
      ok: true,
      input: { variantId: 8, mode: "set", stock: 0, expected: 3, reason: "correction", note: null },
    });
  });

  it("refuses a missing size and bad modes, quantities, reasons and notes", () => {
    const errors = (values: Partial<typeof base>) => {
      const result = parseStockInput({ ...base, ...values });
      return result.ok ? {} : result.errors;
    };
    for (const variantId of ["", "0", "x", "1.5"]) {
      expect(errors({ variantId }), variantId).toHaveProperty("variantId");
    }
    expect(errors({ mode: "double" })).toHaveProperty("mode");
    for (const quantity of ["", "0", "-1", "1.5", "abc", "1000001"]) {
      expect(errors({ quantity }), quantity).toHaveProperty("quantity");
    }
    expect(errors({ mode: "set", quantity: "0" })).toEqual({});
    expect(errors({ reason: "" })).toHaveProperty("reason");
    expect(errors({ reason: "stolen" })).toHaveProperty("reason");
    expect(errors({ note: "x".repeat(501) })).toHaveProperty("note");
    expect(errors({ mode: "set", expected: "" })).toHaveProperty("expected");
    // A relative change doesn't need what was shown.
    expect(errors({ expected: "" })).toEqual({});
  });

  it("offers exactly the reasons the database accepts", () => {
    expect(STOCK_REASONS.map((r) => r.value)).toEqual([...STOCK_ADJUSTMENT_REASONS]);
    expect(STOCK_REASONS.map((r) => r.value)).toEqual(stockAdjustmentReason.enumValues);
  });
});
