"use client";

import Image from "next/image";
import Link from "next/link";
import { Image as ImageIcon, PanelsTopLeft, Video } from "lucide-react";
import { motion } from "motion/react";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useCloudSession } from "@/components/cloud-session-gate";

export type ProductRoute = "image" | "video" | "canvas";

const PRODUCT_LINKS: Array<{
  route: ProductRoute;
  label: string;
  href: string;
  icon: typeof ImageIcon;
}> = [
  { route: "image", label: "生图", href: "/image", icon: ImageIcon },
  { route: "video", label: "生视频", href: "/video", icon: Video },
  { route: "canvas", label: "画布", href: "/canvas", icon: PanelsTopLeft },
];

export function ProductShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user } = useCloudSession();
  const [open, setOpen] = useState(false);

  return (
    <div className="product-shell" data-sidebar-open={open}>
      <motion.aside
        aria-label="Zora Star 产品导航"
        className="product-sidebar"
        animate={{ width: open ? 240 : 60 }}
        transition={{ duration: 0.24, ease: "easeInOut" }}
      >
        <button
          aria-expanded={open}
          aria-label={open ? "收起产品侧栏" : "展开产品侧栏"}
          className="product-brand"
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          <Image
            alt="Zora Star"
            className="product-brand-mark"
            height={38}
            priority
            src="/zora-star.png"
            width={38}
          />
          <motion.span
            aria-hidden={!open}
            className="product-brand-name"
            animate={{ opacity: open ? 1 : 0 }}
          >
            Zora Star
          </motion.span>
        </button>

        <nav className="product-nav">
          {PRODUCT_LINKS.map(({ label, href, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                aria-current={active ? "page" : undefined}
                aria-label={label}
                className={`product-nav-link${active ? " is-active" : ""}`}
                href={href}
                key={href}
              >
                <Icon aria-hidden="true" />
                <motion.span
                  aria-hidden={!open}
                  animate={{ opacity: open ? 1 : 0, x: open ? 0 : -4 }}
                >
                  {label}
                </motion.span>
              </Link>
            );
          })}
        </nav>

        <div className="product-sidebar-footer">
          <span className="product-avatar">{(user?.username ?? "XY").slice(0, 2).toUpperCase()}</span>
          <motion.span
            aria-hidden={!open}
            className="product-account-copy"
            animate={{ opacity: open ? 1 : 0 }}
          >
            <strong>{user?.username ?? "xiaoyu"}</strong>
            <small>{user ? "个人工作空间" : "本地工作空间"}</small>
          </motion.span>
        </div>
      </motion.aside>
      <div className="product-main">{children}</div>
    </div>
  );
}
