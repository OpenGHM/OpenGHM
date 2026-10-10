import { DEFAULT_COMMUNITY_SETTINGS } from "@/lib/community/settings";
import type {
  CommunityPage,
  Publication,
  TutorialCard,
  Workshop,
  WorkshopCard,
} from "@/lib/community/types";

/** Content as the backend's `/community` route sends it, for the Community components' tests. */

const META = {
  state: "published" as const,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-02T00:00:00Z",
  updated_by: "admin-1",
};

export function workshopCard(over: Partial<WorkshopCard> = {}): WorkshopCard {
  return {
    ...META,
    id: "w-1",
    slug: "first-openghm-workshop",
    title: "First OpenGHM Workshop Announcement!",
    summary: "We are excited to announce the first OpenGHM training online workshop.",
    date: "2027-02-01",
    end_date: null,
    when_label: "February–March 2027",
    format: "Online",
    location: null,
    cover: { url: "https://example.org/workshop.jpg", alt: "A workshop", caption: null },
    signup: null,
    status: "upcoming",
    material_count: 0,
    ...over,
  };
}

export function pastWorkshopCard(over: Partial<WorkshopCard> = {}): WorkshopCard {
  return workshopCard({
    id: "w-2",
    slug: "agu-2024-workshop",
    title: "AGU Fall Meeting 2024 Workshop",
    summary: "",
    date: "2024-12-10",
    when_label: null,
    format: "In person",
    location: "San Francisco",
    cover: null,
    status: "past",
    material_count: 2,
    ...over,
  });
}

export function workshop(over: Partial<Workshop> = {}): Workshop {
  return {
    ...workshopCard(),
    details: [{ label: "Computing", value: "NSF ACCESS resource Anvil" }],
    materials: [],
    body: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "We are excited to announce the first workshop." }] },
      ],
    },
    signup: { label: "Sign up for updates here!", url: "https://example.org/signup" },
    ...over,
  };
}

export function tutorialCard(over: Partial<TutorialCard> = {}): TutorialCard {
  return {
    ...META,
    id: "t-1",
    slug: "run-your-first-snapshot",
    title: "Run your first snapshot",
    summary: "Start from the WBM v2.0.0 CONUS tutorial and submit it to Anvil.",
    kind: "gateway",
    minutes: 20,
    level: "beginner",
    snippet: "Workspace → New snapshot\n  period  2000 → 2001",
    action_label: null,
    url: null,
    position: 0,
    has_body: true,
    ...over,
  };
}

export function publication(over: Partial<Publication> = {}): Publication {
  return {
    ...META,
    id: "p-1",
    year: 2022,
    type: "paper",
    title: "Water balance model (WBM) v.1.0.0",
    authors: "Grogan, D. S., Zuidema, S.",
    venue: "Geoscientific Model Development, 15, 7287–7323",
    link_label: "DOI",
    link_url: "https://doi.org/10.5194/gmd-15-7287-2022",
    citation: null,
    ...over,
  };
}

/** A page with something in every section. */
export function communityPage(over: Partial<CommunityPage> = {}): CommunityPage {
  return {
    settings: { ...DEFAULT_COMMUNITY_SETTINGS },
    workshops: [workshopCard(), pastWorkshopCard()],
    tutorials: [
      tutorialCard(),
      tutorialCard({
        id: "t-2",
        slug: "open-zarr",
        title: "Open ZARR inputs with the Python Toolkit",
        kind: "notebook",
        level: "intermediate",
        minutes: 15,
        has_body: false,
        url: "https://example.org/nb.ipynb",
        snippet: "",
      }),
      tutorialCard({ id: "t-3", slug: "no-link", title: "A tutorial with no link", level: "advanced", has_body: false, url: null }),
    ],
    publications: [
      publication(),
      publication({ id: "p-2", year: 2025, type: "software", title: "OpenGHM Toolkit", link_label: null, link_url: null, citation: "OpenGHM Project (2025). Toolkit." }),
    ],
    ...over,
  };
}
