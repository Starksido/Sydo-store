import Image from "next/image";
import Link from "next/link";

import { hero } from "@/lib/catalog";

export function Hero() {
  return (
    <section className="relative isolate flex h-[calc(100svh-var(--header-h)-2rem)] min-h-[34rem] items-end overflow-hidden bg-ink text-paper">
      <Image
        src={hero.image}
        alt={hero.imageAlt}
        fill
        priority
        sizes="100vw"
        className="-z-10 object-cover object-[center_35%]"
      />
      <div className="absolute inset-0 -z-10 bg-linear-to-t from-ink/70 via-ink/15 to-transparent" />

      <div className="container-page pb-12 md:pb-20">
        <p className="eyebrow">{hero.eyebrow}</p>
        <h1 className="heading-display mt-4 max-w-[10ch]">{hero.title}</h1>
        <p className="mt-5 max-w-md text-md">{hero.body}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href={hero.primary.href} className="btn btn-inverse">
            {hero.primary.label}
          </Link>
          <Link href={hero.secondary.href} className="btn btn-inverse">
            {hero.secondary.label}
          </Link>
        </div>
      </div>
    </section>
  );
}
