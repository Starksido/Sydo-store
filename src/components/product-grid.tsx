import { ProductCard } from "@/components/product-card";
import type { Product } from "@/lib/products";

export function ProductGrid({ products }: { products: Product[] }) {
  // The tablet grid has 3 columns: hide any trailing items that would sit in a partial row.
  const tabletCount = Math.floor(products.length / 3) * 3 || products.length;

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
