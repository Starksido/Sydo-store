import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CollectionListing } from "@/components/collection-listing";
import { getCategoryBySlug, getCategoryProducts, getCategorySlugs } from "@/lib/products";

// Regenerate at most once a minute so stock and new products show up without a rebuild.
export const revalidate = 60;

export async function generateStaticParams() {
  const slugs = await getCategorySlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/collections/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  if (!category) return {};
  return {
    title: category.name,
    description: `Shop ${category.name.toLowerCase()} at Sydo.`,
  };
}

export default async function CategoryPage({ params }: PageProps<"/collections/[slug]">) {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  if (!category) notFound();

  const products = await getCategoryProducts(category.id);

  return <CollectionListing title={category.name} products={products} />;
}
