import { CampaignBanner } from "@/components/home/campaign-banner";
import { CategoryGrid } from "@/components/home/category-grid";
import { FeaturedCollections } from "@/components/home/featured-collections";
import { Hero } from "@/components/home/hero";
import { NewArrivals } from "@/components/home/new-arrivals";
import { ServicesStrip } from "@/components/home/services-strip";

// Regenerate at most once a minute so stock and new products show up without a rebuild.
export const revalidate = 60;

export default function Home() {
  return (
    <>
      <Hero />
      <FeaturedCollections />
      <NewArrivals />
      <CampaignBanner />
      <CategoryGrid />
      <ServicesStrip />
    </>
  );
}
