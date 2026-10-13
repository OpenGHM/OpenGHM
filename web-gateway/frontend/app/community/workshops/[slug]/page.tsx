import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CoverImage } from "@/components/community/cover-image";
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
        {/* On a wide screen a normal photo sits in the right column above the
            details, where it fits, and the text takes the left; a wide banner
            goes across the top. The photo says which once it has loaded
            (`data-wide`), and the grid places the three parts to match. In a
            single column the order is the source order. */}
        <div className="group grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[auto_1fr]">
          {cover && workshop.cover && (
            <figure className="flex flex-col rounded-card bg-card p-2 shadow-raised lg:col-start-2 lg:row-start-1 lg:has-[[data-wide=true]]:col-span-2 lg:has-[[data-wide=true]]:col-start-1">
              <CoverImage
                src={cover.url}
                alt={cover.alt}
                loading="eager"
                backdrop={false}
                className="h-auto w-full rounded-[18px]"
              />
              {workshop.cover.caption && (
                <figcaption className="px-3.5 pt-3 pb-1.5 text-[13px] leading-normal text-muted-foreground">
                  {workshop.cover.caption}
                </figcaption>
              )}
            </figure>
          )}

          <div
            className={`flex min-w-0 flex-col gap-4 lg:col-start-1 lg:row-start-1 ${cover ? "lg:row-span-2 lg:group-has-[[data-wide=true]]:row-span-1 lg:group-has-[[data-wide=true]]:row-start-2" : ""}`}
          >
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

          <WorkshopDetails
            workshop={workshop}
            when={when}
            className={cover ? "lg:col-start-2 lg:row-start-2" : "lg:col-start-2 lg:row-start-1"}
          />
        </div>
      </PageBody>
      <Footer />
    </div>
  );
}
