import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { CmsImage } from "@/components/community/cms-image";
import { formatLongDate } from "@/lib/community/format";
import { isExternalHref, safeHref } from "@/lib/community/links";
import { FALLBACK_IMAGE, TAG_CLASS } from "@/lib/home/format";
import type { FeedItem } from "@/lib/home/types";

/**
 * One card of the home page's "Latest Datasets & News", and of `/news`: a
 * picture, the coloured tag, the title, the summary and, when it leads
 * anywhere, a link. A card with no picture of its own shows the kind's. The
 * link text is stretched over the whole card; an address that leaves the site
 * opens in a new tab, and one that is not safe makes the card a plain one.
 */
export function UpdateCard({ item, showDate = false }: { item: FeedItem; showDate?: boolean }) {
  const href = safeHref(item.href);
  const external = href ? isExternalHref(href) : false;
  const LinkIcon = external ? ArrowUpRight : ArrowRight;

  return (
    <article className="relative flex h-full min-w-0 flex-col rounded-card bg-card p-2 transition-[transform,box-shadow] duration-200 hover:shadow-lift has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring motion-safe:hover:-translate-y-[3px]">
      <div className="relative aspect-[16/10] overflow-hidden rounded-2xl bg-accent">
        {item.image ? (
          <CmsImage
            src={item.image.url}
            alt={item.image.alt || item.title}
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <Image
            src={FALLBACK_IMAGE[item.kind]}
            alt=""
            fill
            sizes="(min-width: 1360px) 440px, (min-width: 768px) 33vw, 100vw"
            className="object-cover"
          />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2.5 px-3.5 pt-[18px] pb-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className={`self-start rounded-full px-2.5 py-1 text-xs font-semibold ${TAG_CLASS[item.tag]}`}>
            {item.tag_label}
          </span>
          {showDate && (
            <time dateTime={item.date} className="font-mono text-xs text-muted-foreground">
              {formatLongDate(item.date)}
            </time>
          )}
        </div>
        <h3 className="text-lg leading-[1.3] font-[650] tracking-[-0.02em] text-pretty">{item.title}</h3>
        {item.summary && (
          <p className="text-sm leading-[1.6] text-pretty text-muted-foreground">{item.summary}</p>
        )}
        {href && (
          <Link
            href={href}
            {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className="mt-auto inline-flex items-center gap-1.5 pt-2 text-sm font-semibold text-primary after:absolute after:inset-0 after:rounded-[inherit] hover:text-primary-hover focus-visible:outline-none"
          >
            {item.link_label || "Read more"}
            <LinkIcon aria-hidden="true" className="size-4" />
            {external && <span className="sr-only"> (opens in a new tab)</span>}
          </Link>
        )}
      </div>
    </article>
  );
}
