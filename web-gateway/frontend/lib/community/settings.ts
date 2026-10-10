import type { CommunitySettings } from "@/lib/community/types";

/** What the page says until an admin writes their own words (and when the
 *  backend leaves a field out). */
export const DEFAULT_COMMUNITY_SETTINGS: CommunitySettings = {
  hero_title: "Learn, publish and work together",
  hero_intro:
    "Workshops, tutorials and publications from the OpenGHM project, and groups where researchers discuss the snapshots they run.",
  show_groups: true,
  groups_title: "Discussion groups",
  groups_intro:
    "Create a group for your lab, course or study region. Share a snapshot or a snapshot draft into the conversation and others can open it, compare settings, and start a new run from it.",
  updated_at: null,
  updated_by: null,
};
