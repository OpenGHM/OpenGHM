import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { LevelGlyph } from "@/components/community/level-glyph";
import { RichText, isRichTextEmpty } from "@/components/community/rich-text";
import { Footer } from "@/components/landing/footer";
import { PageBody, PageHero } from "@/components/layout/page-hero";
import { Button } from "@/components/ui/button";
import { getTutorial } from "@/lib/community/data";
import { KIND_LABEL, LEVEL_LABEL, minutesLabel, tutorialActionLabel } from "@/lib/community/format";
import { isExternalHref, safeHref } from "@/lib/community/links";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  // A metadata failure must not take the page with it; the page shows its own error.
  const tutorial = await getTutorial(slug).catch(() => null);
  if (!tutorial) return { title: "Tutorial | OpenGHM" };
  return { title: `${tutorial.title} | OpenGHM`, description: tutorial.summary || undefined };
}

export default async function TutorialPage({ params }: Params) {
  const { slug } = await params;
  const tutorial = await getTutorial(slug);
  if (!tutorial) notFound();

  const minutes = minutesLabel(tutorial.minutes);
  const href = safeHref(tutorial.url);
  const external = href ? isExternalHref(href) : false;
  const ActionIcon = external ? ArrowUpRight : ArrowRight;
  const hasBody = !isRichTextEmpty(tutorial.body);

  return (
    <div className="flex min-h-screen flex-col">
      <PageHero
        size="page"
        breadcrumb={[
          { label: "Community", href: "/community" },
          { label: "Tutorials", href: "/community?tab=tutorials" },
          { label: tutorial.title },
        ]}
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs tracking-[0.06em] text-hero-eyebrow">{KIND_LABEL[tutorial.kind]}</span>
            <span className="inline-flex items-center gap-[7px] rounded-full border border-white/16 bg-white/8 px-[11px] py-[5px] text-[12.5px] font-semibold text-hero-text">
              <LevelGlyph level={tutorial.level} on />
              {LEVEL_LABEL[tutorial.level]}
            </span>
            {minutes && <span className="font-mono text-xs text-hero-faint">{minutes}</span>}
          </div>
        }
        title={tutorial.title}
        subtitle={tutorial.summary || undefined}
        actions={
          href && (
            <Button asChild size="xl" className="shadow-float">
              <a href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                {tutorialActionLabel(tutorial)}
                <ActionIcon aria-hidden="true" />
                {external && <span className="sr-only"> (opens in a new tab)</span>}
              </a>
            </Button>
          )
        }
      />
      <PageBody className="flex-1">
        <article className="rounded-card bg-card p-[clamp(26px,3.6vw,48px)] shadow-raised">
          {hasBody ? (
            <RichText doc={tutorial.body} className="max-w-[760px]" />
          ) : (
            <p className="text-[15px] text-muted-foreground">
              This tutorial has no written steps yet.
              {href ? " Use the button above to open it." : ""}
            </p>
          )}
        </article>
      </PageBody>
      <Footer />
    </div>
  );
}
