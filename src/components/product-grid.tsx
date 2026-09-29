import { ProductCard } from "@/components/product-card";
import type { Product } from "@/lib/products";

export function ProductGrid({
  products,
  trimPartialRow = true,
}: {
  products: Product[];
  /** Hide tablet items that would sit in a partial last row. Turn off on full listings. */
  trimPartialRow?: boolean;
}) {
  // The tablet grid has 3 columns: hide any trailing items that would sit in a partial row.
  const tabletCount = trimPartialRow
    ? Math.floor(products.length / 3) * 3 || products.length
    : products.length;

  return (
    <ul className="grid-products">
      {products.map((product, index) => (
        <li key={product.id} className={index >= tabletCount ? "md:max-xl:hidden" : undefined}>
          <ProductCard product={product} />
        </li>
      ))}
    </ul>
  );
}
