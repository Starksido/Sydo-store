import Image from "next/image";
import Link from "next/link";

import { featuredCollections } from "@/lib/catalog";

export function FeaturedCollections() {
  return (
    <section aria-labelledby="featured-heading" className="section container-page">
      <h2 id="featured-heading" className="sr-only">
        Featured collections
      </h2>
      <div className="grid-split gap-y-10">
        {featuredCollections.map((collection) => (
          <Link key={collection.slug} href={collection.href} className="group block">
            <div className="media-frame aspect-editorial">
              <Image
                src={collection.image}
                alt=""
                fill
                sizes="(width >= 48rem) 50vw, 100vw"
                className="transition-transform duration-700 ease-out-soft group-hover:scale-[1.03]"
              />
            </div>
            <div className="mt-5 text-center">
              <p className="eyebrow text-muted">{collection.eyebrow}</p>
              <h3 className="heading-2 mt-2">{collection.title}</h3>
              <span className="label link mt-4 inline-block">Shop now</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
