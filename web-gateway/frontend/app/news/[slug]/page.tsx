import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { CmsImage } from "@/components/community/cms-image";
import { RichText } from "@/components/community/rich-text";
import { Footer } from "@/components/landing/footer";
import { PageBody, PageHero } from "@/components/layout/page-hero";
import { Button } from "@/components/ui/button";
import { formatLongDate } from "@/lib/community/format";
import { isExternalHref, safeHref } from "@/lib/community/links";
import { getNews } from "@/lib/home/data";
import { NEWS_TAGS } from "@/lib/home/format";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  // A metadata failure must not take the page with it; the page shows its own error.
  const post = await getNews(slug).catch(() => null);
  if (!post) return { title: "News | OpenGHM" };
  return { title: `${post.title} | OpenGHM`, description: post.summary || undefined };
}

/** A news post that has page text. A post without it has no page: its card links to its address. */
export default async function NewsPostPage({ params }: Params) {
  const { slug } = await params;
  const post = await getNews(slug);
  if (!post) notFound();

  const tag = NEWS_TAGS.find((t) => t.value === post.tag)?.label ?? "News";
  const href = safeHref(post.link_url);
  const external = href ? isExternalHref(href) : false;
  const ActionIcon = external ? ArrowUpRight : ArrowRight;

  return (
    <div className="flex min-h-screen flex-col">
      <PageHero
        size="page"
        breadcrumb={[{ label: "Home", href: "/" }, { label: "News", href: "/news" }, { label: post.title }]}
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs tracking-[0.06em] text-hero-eyebrow uppercase">{tag}</span>
            <time dateTime={post.date} className="font-mono text-xs text-hero-faint">
              {formatLongDate(post.date)}
            </time>
          </div>
        }
        title={post.title}
        subtitle={post.summary || undefined}
        actions={
          href && (
            <Button asChild size="xl" className="shadow-float">
              <a href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                {post.link_label || "Read more"}
                <ActionIcon aria-hidden="true" />
                {external && <span className="sr-only"> (opens in a new tab)</span>}
              </a>
            </Button>
          )
        }
      />
      <PageBody className="flex-1">
        <article className="rounded-card bg-card p-[clamp(26px,3.6vw,48px)] shadow-raised">
          {post.cover && (
            <CmsImage
              src={post.cover.url}
              alt={post.cover.alt}
              className="mb-8 aspect-[16/7] w-full max-w-[760px] rounded-2xl object-cover"
            />
          )}
          <RichText doc={post.body} className="max-w-[760px]" />
        </article>
      </PageBody>
      <Footer />
    </div>
  );
}
