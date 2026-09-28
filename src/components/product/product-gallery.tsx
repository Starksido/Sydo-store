"use client";

import Image from "next/image";
import { useState } from "react";

// Mobile/tablet: full-bleed swipeable carousel. Desktop: lead image full width, the rest two-up.
export function ProductGallery({ images, name }: { images: string[]; name: string }) {
  const [active, setActive] = useState(0);
  const count = images.length;
  // Keep the desktop grid free of a lone half-width image at the end.
  const lastSpansFull = (count - 1) % 2 === 1;

  return (
    <div>
      <ul
        aria-label={`${name} images`}
        className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] lg:grid lg:grid-cols-2 lg:gap-0.5 lg:overflow-visible [&::-webkit-scrollbar]:hidden"
        onScroll={(event) => {
          const el = event.currentTarget;
          setActive(Math.round(el.scrollLeft / el.clientWidth));
        }}
      >
        {images.map((src, index) => {
          const fullWidth = index === 0 || (lastSpansFull && index === count - 1);
          return (
            <li
              key={src}
              className={`w-full shrink-0 snap-start lg:w-auto ${fullWidth ? "lg:col-span-2" : ""}`}
            >
              <div className="media-frame">
                <Image
                  src={src}
                  alt={`${name}, image ${index + 1} of ${count}`}
                  fill
                  priority={index === 0}
                  sizes={fullWidth ? "(width >= 64rem) 58vw, 100vw" : "(width >= 64rem) 29vw, 100vw"}
                />
              </div>
            </li>
          );
        })}
      </ul>

      {count > 1 && (
        <div aria-hidden="true" className="mt-4 flex justify-center gap-1.5 lg:hidden">
          {images.map((src, index) => (
            <span
              key={src}
              className={`h-px w-6 transition-colors ${index === active ? "bg-ink" : "bg-line"}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
