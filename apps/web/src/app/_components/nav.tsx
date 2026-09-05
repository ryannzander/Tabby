"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Wallet" },
  { href: "/chat", label: "Chat" },
];

export function Nav() {
  const path = usePathname();

  return (
    <header className="border-b border-rule">
      <nav className="mx-auto flex max-w-3xl items-baseline gap-8 px-6 py-5">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Tappy
        </Link>

        <div className="flex gap-6">
          {LINKS.map((link) => {
            const active = path === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "border-b-2 border-amber pb-0.5 text-ink"
                    : "border-b-2 border-transparent pb-0.5 text-ink-soft hover:text-ink"
                }
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
