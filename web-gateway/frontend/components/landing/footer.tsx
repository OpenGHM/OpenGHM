import Image from "next/image";

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
    <footer className="bg-hero pt-12 pb-10 text-white lg:pt-20">
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-10">
        <div className="mb-12 grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-[2fr_1fr_1fr_1fr] lg:gap-16">
          <div className="col-span-2 sm:col-span-3 lg:col-span-1">
            <Image
              src="/images/logo_dark_new.webp"
              alt="OpenGHM Logo"
              width={180}
              height={48}
              className="mb-6 h-16 w-auto"
            />
            <p className="max-w-[300px] leading-relaxed text-slate-400">
              An open-source platform democratizing access to global hydrologic
              data and modeling capabilities. Built for the future of water
              science.
            </p>
          </div>

          <FooterColumn title="Platform" links={PLATFORM_LINKS} />
          <FooterColumn title="Community" links={COMMUNITY_LINKS} />
          <FooterColumn title="Legal" links={LEGAL_LINKS} />
        </div>

        <div className="border-t border-white/10 pt-8 text-center text-sm text-slate-500">
          <p>
            &copy; 2025 OpenGHM Project. This material is based upon work
            supported by the{" "}
            <a
              href="https://www.nsf.gov/funding/opportunities/cssi-cyberinfrastructure-sustained-scientific-innovation"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-slate-600 underline-offset-2 transition-colors hover:text-white"
            >
              National Science Foundation
            </a>
            <br />
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
      <h5 className="mb-6 text-base font-semibold text-white">{title}</h5>
      <ul className="space-y-3">
        {links.map((link) => (
          <li key={link}>
            <a
              href="#"
              className="text-sm text-slate-400 transition-colors hover:text-white"
            >
              {link}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
