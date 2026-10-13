import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CmsImage } from "@/components/community/cms-image";
import { RichText, isRichTextEmpty } from "@/components/community/rich-text";
import { FormatPill, StatusPill } from "@/components/community/workshop-pills";
import { MaterialsList, WorkshopDetails } from "@/components/community/workshop-parts";
import { Footer } from "@/components/landing/footer";
import { PageBody, PageHero } from "@/components/layout/page-hero";
import { getWorkshop } from "@/lib/community/data";
import { whenLabel } from "@/lib/community/format";
import { safeImageSrc } from "@/lib/community/links";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  // A metadata failure must not take the page with it; the page shows its own error.
  const workshop = await getWorkshop(slug).catch(() => null);
  if (!workshop) return { title: "Workshop | OpenGHM" };
  return { title: `${workshop.title} | OpenGHM`, description: workshop.summary || undefined };
}

export default async function WorkshopPage({ params }: Params) {
  const { slug } = await params;
  const workshop = await getWorkshop(slug);
  if (!workshop) notFound();

  const when = whenLabel(workshop);
  const cover = workshop.cover && safeImageSrc(workshop.cover.url) ? workshop.cover : null;
  const hasBody = !isRichTextEmpty(workshop.body);

  return (
    <div className="flex min-h-screen flex-col">
      <PageHero
        size="page"
        breadcrumb={[
          { label: "Community", href: "/community" },
          { label: "Workshops", href: "/community?tab=workshops" },
          { label: workshop.title },
        ]}
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={workshop.status} on="hero" />
            {workshop.format && <FormatPill on="hero">{workshop.format}</FormatPill>}
          </div>
        }
        title={workshop.title}
        subtitle={<span className="font-mono text-[15px] text-hero-eyebrow">{when}</span>}
      />
      <PageBody className="flex-1">
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          {cover && workshop.cover && (
            // The picture runs to the card's edges, at 16:9 (2:1 on a wide
            // screen), cropped to that shape rather than set in a frame.
            <figure className="overflow-hidden rounded-card bg-card shadow-raised lg:col-span-2">
              <CmsImage
                src={cover.url}
                alt={cover.alt}
                loading="eager"
                className="block aspect-video max-h-[520px] w-full bg-accent object-cover lg:aspect-[2/1]"
              />
              {workshop.cover.caption && (
                <figcaption className="px-5 py-3 text-[13px] leading-normal text-muted-foreground">
                  {workshop.cover.caption}
                </figcaption>
              )}
            </figure>
          )}

          <div className="flex min-w-0 flex-col gap-4">
            <article
              className={`flex flex-col gap-[18px] rounded-card bg-card p-[clamp(26px,3.6vw,48px)] ${cover ? "shadow-card" : "shadow-raised"}`}
            >
              {hasBody ? (
                <RichText doc={workshop.body} />
              ) : (
                // A workshop with no written body still says what it is.
                <p className="max-w-[720px] text-[clamp(19px,1.6vw,22px)] leading-[1.45] font-[550] tracking-[-0.015em] text-pretty">
                  {workshop.summary}
                </p>
              )}
            </article>

            <MaterialsList materials={workshop.materials} />
          </div>

          <WorkshopDetails workshop={workshop} when={when} />
        </div>
      </PageBody>
      <Footer />
    </div>
  );
}
