import Image from "next/image";
import Link from "next/link";

import { campaign } from "@/lib/catalog";

export function CampaignBanner() {
  return (
    <section aria-labelledby="campaign-heading" className="grid bg-surface md:grid-cols-12">
      <div className="relative aspect-editorial md:col-span-7 md:aspect-auto md:min-h-[42rem]">
        <Image
          src={campaign.image}
          alt={campaign.imageAlt}
          fill
          sizes="(width >= 48rem) 58vw, 100vw"
          className="object-cover"
        />
      </div>
      <div className="flex flex-col justify-center px-gutter py-section md:col-span-5 md:px-12 xl:px-20">
        <p className="eyebrow text-muted">{campaign.eyebrow}</p>
        <h2 id="campaign-heading" className="heading-1 mt-3">
          {campaign.title}
        </h2>
        <p className="mt-5 max-w-sm text-muted">{campaign.body}</p>
        <div className="mt-8">
          <Link href={campaign.cta.href} className="btn btn-secondary">
            {campaign.cta.label}
          </Link>
        </div>
      </div>
    </section>
  );
}
