import { Metadata } from "next";
import Image from "next/image";
import { Mail } from "lucide-react";
import { Footer } from "@/components/landing/footer";
import { PanelDots, SectionEyebrow, SectionTitle } from "@/components/landing/section-parts";
import { PageBody, PageHero } from "@/components/layout/page-hero";
import { Button } from "@/components/ui/button";
import { CONTACT_EMAIL } from "@/lib/contact";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "About Us | OpenGHM Gateway",
  description:
    "Learn about the OpenGHM team, mission, and partners advancing open hydrologic science.",
};

const TEAM_MEMBERS = [
  {
    name: "Danielle Grogan",
    role: "PI",
    affiliation: "University of New Hampshire",
    affiliationLogo: "/images/logos/unh.svg",
    initials: "DG",
  },
  {
    name: "Lan Zhao",
    role: "Co-PI",
    affiliation: "Purdue University",
    affiliationLogo: "/images/logos/purdue.svg",
    initials: "LZ",
  },
  {
    name: "Carol X Song",
    role: "Collaborator",
    affiliation: "Purdue University",
    affiliationLogo: "/images/logos/purdue.svg",
    initials: "CS",
  },
  {
    name: "Alexander Prusevich",
    role: "Senior Personnel",
    affiliation: "University of New Hampshire",
    affiliationLogo: "/images/logos/unh.svg",
    initials: "AP",
  },
  {
    name: "Elizabeth Burakowski",
    role: "Senior Personnel",
    affiliation: "University of New Hampshire",
    affiliationLogo: "/images/logos/unh.svg",
    initials: "EB",
  },
  {
    name: "Jessica Scheick",
    role: "Senior Personnel",
    affiliation: "University of New Hampshire",
    affiliationLogo: "/images/logos/unh.svg",
    initials: "JS",
  },
  {
    name: "Shan Zuidema",
    role: "Senior Personnel",
    affiliation: "University of New Hampshire",
    affiliationLogo: "/images/logos/unh.svg",
    initials: "SZ",
  },
  {
    name: "I Luk Kim",
    role: "Senior Personnel",
    affiliation: "Purdue University",
    affiliationLogo: "/images/logos/purdue.svg",
    initials: "IK",
  },
  {
    name: "Xiao Liu",
    role: "Lead Developer",
    affiliation: "Purdue University",
    affiliationLogo: "/images/logos/purdue.svg",
    initials: "XL",
  },
  {
    name: "Iman Haqiqi",
    role: "Collaborator",
    affiliation: "Purdue University",
    affiliationLogo: "/images/logos/purdue.svg",
    initials: "IH",
  },
];

const FUNDING_LOGOS = [
  { src: "/images/logos/nsf.svg", alt: "National Science Foundation" },
  { src: "/images/logos/access.svg", alt: "ACCESS" },
  { src: "/images/logos/purdue.svg", alt: "Purdue University" },
  { src: "/images/logos/unh.svg", alt: "University of New Hampshire" },
];

/** The PI and Co-PI get the dark avatar and the filled role pill. */
const LEAD_ROLES = ["PI", "Co-PI"];

export default function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow="Our Mission"
        title="Making global hydrologic science FAIR, reproducible, and accessible to all."
        subtitle="We are building the next generation of open-source tools to help researchers, policymakers, and communities understand water systems at a planetary scale."
        contentClassName="pt-16 lg:pt-24"
        className="pb-[140px]"
      />

      <PageBody className="-mt-20 flex flex-col gap-24">
        <section className="flex flex-wrap gap-3 rounded-panel bg-card p-3 shadow-raised">
          <div className="flex-[1_1_380px] self-center overflow-hidden rounded-[20px] bg-accent">
            <Image
              src="/images/usecase-researchers.jpg"
              alt="OpenGHM Team Collaboration"
              width={600}
              height={450}
              sizes="(min-width: 1024px) 40vw, 100vw"
              className="block h-auto w-full"
            />
          </div>
          <blockquote className="flex flex-[999_1_420px] flex-col justify-center gap-6 px-6 py-10 sm:px-11 sm:py-12">
            <span
              aria-hidden="true"
              className="h-8 text-[72px] leading-[0.6] font-bold text-primary"
            >
              &ldquo;
            </span>
            <p className="text-[clamp(22px,2.4vw,30px)] leading-[1.35] font-medium tracking-[-0.02em] text-pretty">
              By democratizing access to models and data, we empower
              communities worldwide to make better decisions about water
              resources.
            </p>
          </blockquote>
        </section>

        <section className="flex flex-col gap-9">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="flex flex-col gap-3.5">
              <SectionEyebrow>Team</SectionEyebrow>
              <SectionTitle>Meet the Team</SectionTitle>
            </div>
            <p className="max-w-[440px] text-base leading-[1.6] text-pretty text-muted-foreground">
              A multidisciplinary group of hydrologists, software engineers,
              and data scientists dedicated to open science.
            </p>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(240px,100%),1fr))] gap-3">
            {TEAM_MEMBERS.map((member) => {
              const lead = LEAD_ROLES.includes(member.role);
              return (
                <article
                  key={member.name}
                  className="flex min-w-0 flex-col gap-[18px] rounded-[20px] bg-card p-[22px] transition-[transform,box-shadow] duration-200 hover:shadow-lift motion-safe:hover:-translate-y-0.5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div
                      aria-hidden="true"
                      className={cn(
                        "grid size-[52px] shrink-0 place-items-center rounded-full text-base font-semibold tracking-[0.02em]",
                        lead ? "bg-hero text-white" : "bg-secondary text-secondary-foreground",
                      )}
                    >
                      {member.initials}
                    </div>
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-1 text-xs font-semibold",
                        lead ? "bg-primary text-white" : "bg-muted text-foreground/80",
                      )}
                    >
                      {member.role}
                    </span>
                  </div>
                  <h3 className="text-lg font-[650] tracking-[-0.02em]">
                    {member.name}
                  </h3>
                  <div className="flex items-center gap-2.5 border-t border-border/70 pt-3.5">
                    <div className="relative h-[22px] w-7 shrink-0">
                      <Image
                        src={member.affiliationLogo}
                        alt={member.affiliation}
                        fill
                        className="object-contain object-left"
                        unoptimized
                      />
                    </div>
                    <span className="text-[13px] text-muted-foreground">
                      {member.affiliation}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <div className="flex flex-wrap gap-3">
          <section className="flex flex-[999_1_560px] flex-col gap-7 rounded-panel bg-card px-6 py-10 sm:px-11 sm:py-12">
            <div className="flex flex-col gap-3.5">
              <SectionEyebrow>Funding &amp; Partners</SectionEyebrow>
              <SectionTitle className="text-[clamp(30px,3.6vw,42px)]">
                Supported By
              </SectionTitle>
              <p className="max-w-[640px] text-base leading-[1.65] text-pretty text-muted-foreground">
                OpenGHM is made possible through generous support from the{" "}
                <a
                  href="https://www.nsf.gov/funding/opportunities/cssi-cyberinfrastructure-sustained-scientific-innovation"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-primary underline-offset-2 hover:underline"
                >
                  National Science Foundation
                </a>{" "}
                (NSF Grant Elements: OpenGHM: Enhancing reproducibility in
                global hydrologic modeling, Grant OAC-2513891) and partner
                institutions.
              </p>
            </div>
            <ul className="mt-auto grid grid-cols-[repeat(auto-fit,minmax(min(140px,100%),1fr))] gap-2.5">
              {FUNDING_LOGOS.map((logo) => (
                <li
                  key={logo.alt}
                  className="relative h-24 rounded-2xl bg-muted"
                >
                  <Image
                    src={logo.src}
                    alt={logo.alt}
                    fill
                    className="object-contain p-4"
                    unoptimized
                  />
                </li>
              ))}
            </ul>
          </section>

          {/* One address, so the panel is a call to action rather than a
              list: a short line at the top, the address and its button at
              the bottom. Kept short so it never sets the row's height. */}
          <section
            aria-labelledby="contact-heading"
            className="relative flex flex-[1_1_340px] flex-col gap-6 overflow-hidden rounded-panel bg-hero px-6 py-10 text-white sm:px-10 sm:py-12"
          >
            <PanelDots alpha={0.07} />
            <div className="relative flex flex-col gap-3">
              <h2
                id="contact-heading"
                className="text-[28px] font-bold tracking-[-0.03em]"
              >
                Get in touch
              </h2>
              <p className="text-base leading-[1.6] text-pretty text-white/70">
                Questions, ideas or collaborations: write to the team.
              </p>
            </div>
            <div className="relative mt-auto flex flex-col gap-5 border-t border-white/[0.14] pt-6">
              <div className="flex flex-col gap-1">
                <span className="font-mono text-[11.5px] tracking-[0.06em] text-hero-eyebrow uppercase">
                  Email
                </span>
                <span className="text-[19px] font-medium break-words">
                  {CONTACT_EMAIL}
                </span>
              </div>
              <Button asChild variant="on-dark" size="xl" className="w-full">
                <a href={`mailto:${CONTACT_EMAIL}`}>
                  <Mail aria-hidden="true" />
                  Email us
                </a>
              </Button>
            </div>
          </section>
        </div>
      </PageBody>

      <Footer />
    </>
  );
}
