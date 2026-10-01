import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Disclosure } from "@/components/disclosure";
import { ProductGallery } from "@/components/product/product-gallery";
import { ProductPurchase } from "@/components/product/product-purchase";
import { StockStatus } from "@/components/product/stock-status";
import { ProductGrid } from "@/components/product-grid";
import { categoryHref, formatPrice } from "@/lib/catalog";
import { getProductBySlug, getProductSlugs, getRelatedProducts } from "@/lib/products";

// Regenerate at most once a minute so stock and price changes show up without a rebuild.
export const revalidate = 60;

export async function generateStaticParams() {
  const slugs = await getProductSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/products/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return {};
  return {
    title: product.name,
    description: product.description,
    openGraph: { images: [product.image] },
  };
}

export default async function ProductPage({ params }: PageProps<"/products/[slug]">) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  const images = [product.image, product.altImage, ...product.gallery].filter(
    (src): src is string => Boolean(src),
  );
  const related = await getRelatedProducts(product);

  return (
    <>
      <article className="container-page pb-section lg:pt-10">
        <div className="grid gap-y-8 lg:grid-cols-12 lg:gap-x-10 xl:gap-x-16">
          <div className="-mx-gutter lg:col-span-7 lg:mx-0">
            <ProductGallery images={images} name={product.name} />
          </div>

          <div className="lg:col-span-5 xl:col-span-4 xl:col-start-9">
            <div className="lg:sticky lg:top-[calc(var(--header-h)+2.5rem)]">
              <nav aria-label="Breadcrumb">
                <ol className="eyebrow flex flex-wrap gap-2 text-muted">
                  <li>
                    <Link href="/" className="link-quiet">
                      Home
                    </Link>
                  </li>
                  <li aria-hidden="true">/</li>
                  <li>
                    <Link href={categoryHref(product.category.slug)} className="link-quiet">
                      {product.category.name}
                    </Link>
                  </li>
                </ol>
              </nav>

              {product.badge && <p className="eyebrow mt-6">{product.badge}</p>}
              <h1 className={`heading-2 ${product.badge ? "mt-2" : "mt-6"}`}>{product.name}</h1>
              <p className="mt-3 text-md">{formatPrice(product.price)}</p>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
                <StockStatus stock={product.stock} />
                <p className="text-xs text-muted">Style {product.sku}</p>
              </div>

              <ProductPurchase stock={product.stock} variants={product.variants} />

              <p className="mt-10 text-muted">{product.description}</p>

              <div className="mt-8 border-b">
                <Disclosure title="Details & care" defaultOpen>
                  <ul className="space-y-1.5">
                    {product.details.map((detail) => (
                      <li key={detail}>{detail}</li>
                    ))}
                  </ul>
                </Disclosure>
                <Disclosure title="Shipping & returns">
                  <p>
                    Complimentary standard shipping on every order, delivered in 2–4 business
                    days. Returns and exchanges are free within 30 days of delivery.
                  </p>
                </Disclosure>
                <Disclosure title="Gifting">
                  <p>Every order arrives in signature packaging.</p>
                </Disclosure>
              </div>
            </div>
          </div>
        </div>
      </article>

      <section aria-labelledby="related-heading" className="section container-page border-t">
        <div className="mb-8 flex items-end justify-between gap-6 md:mb-12">
          <div>
            <p className="eyebrow text-muted">Discover more</p>
            <h2 id="related-heading" className="heading-2 mt-2">
              You May Also Like
            </h2>
          </div>
          <Link href="/collections/new-in" className="label link shrink-0">
            View all
          </Link>
        </div>
        <ProductGrid products={related} />
      </section>
    </>
  );
}
