import { Metadata } from "next";
import Image from "next/image";
import { Header } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import { Mail, ArrowRight } from "lucide-react";

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

const AVATAR_COLORS = [
  "bg-sky-600",
  "bg-teal-600",
  "bg-indigo-600",
  "bg-amber-600",
  "bg-rose-600",
  "bg-emerald-600",
  "bg-violet-600",
  "bg-cyan-600",
  "bg-orange-600",
];

export default function AboutPage() {
  return (
    <>
      <Header />

      {/* Hero Section */}
      <section className="bg-gradient-to-b from-slate-50 to-white py-16 pb-12">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10">
          <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-[1.4fr_1fr] lg:gap-16">
            <div>
              <p className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-primary">
                Our Mission
              </p>
              <h1 className="mb-5 text-4xl font-bold leading-tight tracking-tight text-foreground">
                Making global hydrologic science FAIR, reproducible, and
                accessible to all.
              </h1>
              <p className="mb-6 text-lg text-muted-foreground">
                We are building the next generation of open-source tools to help
                researchers, policymakers, and communities understand water
                systems at a planetary scale.
              </p>
              <blockquote className="border-l-4 border-secondary pl-4 text-[15px] italic text-foreground">
                &ldquo;By democratizing access to models and data, we empower
                communities worldwide to make better decisions about floods,
                droughts, and water security.&rdquo;
              </blockquote>
            </div>
            <div className="overflow-hidden rounded-xl shadow-xl">
              <Image
                src="/images/usecase-researchers.jpg"
                alt="OpenGHM Team Collaboration"
                width={600}
                height={450}
                className="h-auto w-full max-w-full object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Main Content */}
      <main className="py-16 pb-20">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10">
          <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[3fr_1fr] lg:gap-16">
            {/* Left Column */}
            <div>
              {/* Team Section */}
              <section className="mb-16">
                <h2 className="mb-3 text-2xl font-semibold text-foreground">
                  Meet the Team
                </h2>
                <p className="mb-8 max-w-[600px] text-[15px] text-muted-foreground">
                  A multidisciplinary group of hydrologists, software engineers,
                  and data scientists dedicated to open science.
                </p>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5">
                  {TEAM_MEMBERS.map((member, i) => (
                    <div
                      key={member.name}
                      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5 transition-all hover:border-primary hover:shadow-md"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${AVATAR_COLORS[i % AVATAR_COLORS.length]}`}
                        >
                          {member.initials}
                        </div>
                        <div>
                          <h3 className="text-[15px] font-semibold">
                            {member.name}
                          </h3>
                          <p className="text-[12px] font-medium text-primary">
                            {member.role}
                          </p>
                        </div>
                      </div>
                      <div className="mt-auto flex items-center gap-3 border-t border-border pt-3">
                        <div className="relative h-5 w-16">
                          <Image
                            src={member.affiliationLogo}
                            alt={member.affiliation}
                            fill
                            style={{ objectFit: "contain", objectPosition: "left" }}
                            className="opacity-60"
                            unoptimized
                          />
                        </div>
                        <span className="text-[11px] text-muted-foreground">
                          {member.affiliation}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Funding Section */}
              <section className="rounded-xl bg-slate-50 p-6 sm:p-10">
                <h2 className="mb-3 text-2xl font-semibold text-foreground">
                  Supported By
                </h2>
                <p className="max-w-[600px] text-[15px] text-muted-foreground">
                  OpenGHM is made possible through generous support from the{" "}
                  <a
                    href="https://www.nsf.gov/funding/opportunities/cssi-cyberinfrastructure-sustained-scientific-innovation"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    National Science Foundation
                  </a>{" "}
                  (NSF Grant Elements: OpenGHM: Enhancing reproducibility in
                  global hydrologic modeling, Grant OAC-2513891) and partner
                  institutions.
                </p>
                <div className="mt-8 grid grid-cols-2 items-center justify-items-center gap-6 sm:grid-cols-4 sm:gap-8">
                  {FUNDING_LOGOS.map((logo) => (
                    <div
                      key={logo.alt}
                      className="relative h-[60px] w-full max-w-[160px]"
                    >
                      <Image
                        src={logo.src}
                        alt={logo.alt}
                        fill
                        style={{ objectFit: "contain" }}
                        className="opacity-50 grayscale transition-all hover:opacity-100 hover:grayscale-0"
                        unoptimized
                      />
                    </div>
                  ))}
                </div>
              </section>
            </div>

            {/* Right Sidebar */}
            <aside className="flex flex-col gap-8 lg:sticky lg:top-24">
              {/* Contact */}
              <div className="rounded-lg border border-border bg-card p-6">
                <h4 className="mb-4 flex items-center gap-2 text-sm font-semibold">
                  <Mail size={16} className="text-primary" />
                  Contact
                </h4>
                <div className="flex flex-col gap-3">
                  <div className="flex items-start gap-2.5 text-[13px] text-muted-foreground">
                    <ArrowRight
                      size={14}
                      className="mt-0.5 shrink-0 text-primary"
                    />
                    <span className="min-w-0 break-words">General: info@openghm.org</span>
                  </div>
                  <div className="flex items-start gap-2.5 text-[13px] text-muted-foreground">
                    <ArrowRight
                      size={14}
                      className="mt-0.5 shrink-0 text-primary"
                    />
                    <span className="min-w-0 break-words">Support: help@openghm.org</span>
                  </div>
                  <div className="flex items-start gap-2.5 text-[13px] text-muted-foreground">
                    <ArrowRight
                      size={14}
                      className="mt-0.5 shrink-0 text-primary"
                    />
                    <span className="min-w-0 break-words">Press: media@openghm.org</span>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </main>

      <Footer />
    </>
  );
}
