import type { ReactNode } from "react";

import { PlusIcon } from "@/components/icons";

export function Disclosure({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="group border-t" open={defaultOpen}>
      <summary className="label flex cursor-pointer list-none items-center justify-between py-5 [&::-webkit-details-marker]:hidden">
        {title}
        <PlusIcon className="size-4 transition-transform group-open:rotate-45" />
      </summary>
      <div className="pb-6 text-sm text-muted">{children}</div>
    </details>
  );
}
