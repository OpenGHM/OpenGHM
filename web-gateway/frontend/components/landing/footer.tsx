import Image from "next/image";
import { CurrentYear } from "./current-year";

const PLATFORM_LINKS = [
  "Data Repository",
  "Simulation Engine",
  "Python Toolkit",
  "Documentation",
];
const COMMUNITY_LINKS = [
  "Workshops",
  "GitHub Discussions",
  "Contributors",
  "Code of Conduct",
];
const LEGAL_LINKS = [
  "Privacy Policy",
  "Terms of Service",
  "Data Citation",
  "Contact Us",
];

export function Footer() {
  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto max-w-[1360px] px-4 pt-12 pb-8 sm:px-7 lg:pt-16">
        <div className="mb-12 grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-[2fr_1fr_1fr_1fr] lg:gap-12">
          <div className="col-span-2 sm:col-span-3 lg:col-span-1">
            <Image
              src="/images/logo_light4.webp"
              alt="OpenGHM Logo"
              width={384}
              height={98}
              className="mb-4 h-12 w-auto"
            />
            <p className="max-w-[380px] text-sm leading-relaxed text-pretty text-[#4a5a66]">
              An open-source platform democratizing access to global hydrologic
              data and modeling capabilities. Built for the future of water
              science.
            </p>
          </div>

          <FooterColumn title="Platform" links={PLATFORM_LINKS} />
          <FooterColumn title="Community" links={COMMUNITY_LINKS} />
          <FooterColumn title="Legal" links={LEGAL_LINKS} />
        </div>

        <div className="border-t border-border pt-6 text-[13px] leading-relaxed text-pretty text-muted-foreground">
          <p>
            &copy; <CurrentYear /> OpenGHM Project. This material is based upon work
            supported by the{" "}
            <a
              href="https://www.nsf.gov/funding/opportunities/cssi-cyberinfrastructure-sustained-scientific-innovation"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary transition-colors hover:text-primary-hover hover:underline"
            >
              National Science Foundation
            </a>{" "}
            under NSF Grant Elements: OpenGHM: Enhancing reproducibility in
            global hydrologic modeling (Grant OAC-2513891).
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: string[];
}) {
  return (
    <div>
      <h5 className="mb-4 font-mono text-xs font-medium tracking-[0.06em] text-primary uppercase">
        {title}
      </h5>
      <ul className="space-y-3">
        {links.map((link) => (
          <li key={link}>
            <a
              href="#"
              className="text-sm text-[#3a4a56] transition-colors hover:text-primary"
            >
              {link}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
