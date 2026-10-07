"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FeedIcon, GridIcon, LibraryIcon, PlusIcon } from "@/components/icons";

const ITEMS = [
  { href: "/", label: "Feed", Icon: FeedIcon },
  { href: "/add", label: "Add", Icon: PlusIcon },
  { href: "/library", label: "Library", Icon: LibraryIcon },
  { href: "/domains", label: "Domains", Icon: GridIcon },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="flex shrink-0 border-t border-white/10 bg-zinc-950 pb-[env(safe-area-inset-bottom)]"
    >
      {ITEMS.map(({ href, label, Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition ${
              active ? "text-white" : "text-zinc-500"
            }`}
          >
            <Icon width={22} height={22} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
