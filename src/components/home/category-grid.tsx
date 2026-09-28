import Image from "next/image";
import Link from "next/link";

import { categoryHref } from "@/lib/catalog";
import { getCategories } from "@/lib/products";

export async function CategoryGrid() {
  const categories = await getCategories();

  return (
    <section aria-labelledby="categories-heading" className="section container-page">
      <h2 id="categories-heading" className="heading-2 mb-8 text-center md:mb-12">
        Shop by Category
      </h2>
      <ul className="grid grid-cols-2 gap-x-0.5 gap-y-8 lg:grid-cols-4">
        {categories.map((category) => (
          <li key={category.slug}>
            <Link href={categoryHref(category.slug)} className="group block">
              <div className="media-frame aspect-square">
                <Image
                  src={category.image}
                  alt=""
                  fill
                  sizes="(width >= 64rem) 25vw, 50vw"
                  className="transition-transform duration-700 ease-out-soft group-hover:scale-[1.03]"
                />
              </div>
              <p className="label mt-4 text-center">{category.name}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
