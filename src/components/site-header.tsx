"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { AccountIcon, BagIcon, CloseIcon, MenuIcon, SearchIcon } from "@/components/icons";
import { primaryNav } from "@/lib/catalog";

const secondaryNav = [
  { label: "My account", href: "/account" },
  { label: "Client services", href: "/client-services" },
  { label: "Store locator", href: "/stores" },
];

const iconButton = "inline-flex size-10 items-center justify-center transition-opacity hover:opacity-60";

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    // The drawer is mobile-only; close it if the viewport grows past `lg`.
    const desktop = window.matchMedia("(width >= 64rem)");
    const onResize = () => desktop.matches && setOpen(false);

    window.addEventListener("keydown", onKeyDown);
    desktop.addEventListener("change", onResize);
    const openButton = openRef.current;
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      desktop.removeEventListener("change", onResize);
      openButton?.focus();
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <>
      <div className="bg-ink text-paper">
        <p className="container-page eyebrow flex h-8 items-center justify-center">
          <span className="truncate">Complimentary shipping and returns</span>
        </p>
      </div>

      <header className="header-bar">
        <div className="container-page grid h-full grid-cols-[1fr_auto_1fr] items-center gap-4">
          <div className="flex items-center">
            <button
              ref={openRef}
              type="button"
              className={`${iconButton} -ml-2.5 lg:hidden`}
              aria-label="Open menu"
              aria-expanded={open}
              aria-controls="mobile-menu"
              onClick={() => setOpen(true)}
            >
              <MenuIcon />
            </button>
            <nav aria-label="Primary" className="hidden lg:block">
              <ul className="flex gap-6 xl:gap-8">
                {primaryNav.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} className="label link-quiet">
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>

          <Link
            href="/"
            aria-label="Sydo home"
            className="pl-[0.4em] text-lg font-medium uppercase tracking-[0.4em] md:text-xl"
          >
            Sydo
          </Link>

          <div className="-mr-2.5 flex items-center justify-end">
            <Link href="/search" aria-label="Search" className={iconButton}>
              <SearchIcon />
            </Link>
            <Link
              href="/account"
              aria-label="Account"
              className={`${iconButton} hidden sm:inline-flex`}
            >
              <AccountIcon />
            </Link>
            <Link href="/cart" aria-label="Shopping bag, 0 items" className={iconButton}>
              <BagIcon />
            </Link>
          </div>
        </div>
      </header>

      <div
        id="mobile-menu"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        hidden={!open}
        className="fixed inset-0 z-50 flex flex-col bg-paper lg:hidden"
      >
        <div className="container-page flex h-header shrink-0 items-center justify-between border-b">
          <span className="eyebrow">Menu</span>
          <button
            ref={closeRef}
            type="button"
            className={`${iconButton} -mr-2.5`}
            aria-label="Close menu"
            onClick={close}
          >
            <CloseIcon />
          </button>
        </div>
        <nav aria-label="Mobile" className="container-page flex-1 overflow-y-auto py-8">
          <ul className="space-y-5">
            {primaryNav.map((item) => (
              <li key={item.href}>
                <Link href={item.href} onClick={close} className="heading-2 block">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          <ul className="mt-10 space-y-4 border-t pt-8">
            {secondaryNav.map((item) => (
              <li key={item.href}>
                <Link href={item.href} onClick={close} className="link-quiet text-sm">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </>
  );
}
