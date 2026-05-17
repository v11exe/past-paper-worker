export type VersionHistoryEntry = {
  version: string;
  title: string;
  date: string;
  changes: string[];
};

export const versionHistory: VersionHistoryEntry[] = [
  {
    version: "v1.4.1",
    title: "Rollback and targeted parser fixes",
    date: "2026-05-17",
    changes: [
      "Reverted the expensive v1.4.0 processing pipeline.",
      "Restored fast deterministic paper processing.",
      "Fixed greedy mark-scheme section matching.",
      "Tightened multiple-choice parsing.",
      "Fixed visual references to avoid random figure pages.",
      "Kept Claude as the default marking model.",
    ],
  },
  {
    version: "v1.4.0",
    title: "Alignment and question intelligence",
    date: "2026-05-16",
    changes: [
      "Improved mark-scheme row alignment.",
      "Added Claude-assisted mark-scheme recovery before marking questions as issues.",
      "Added automatic diagnostic reports for unresolved alignment issues.",
      "Improved figure, table and graph detection.",
      "Added cropped figure display and rendered table display.",
      "Revamped multiple-choice and unsupported-question detection.",
      "Improved question text formatting for steps, notation and scientific symbols.",
    ],
  },
  {
    version: "v1.3.5",
    title: "Claude Sonnet migration",
    date: "2026-05-15",
    changes: [
      "Switched default processing and marking to Claude Sonnet.",
      "Kept Gemini available as a fallback and Dev mode option.",
      "Added model/provider labels after processing and marking.",
      "Improved examiner-style marking prompts for stricter GCSE feedback.",
    ],
  },
  {
    version: "v1.3.4",
    title: "Marking layout fix",
    date: "2026-05-15",
    changes: [
      "Fixed excess vertical spacing in the marking workspace.",
      "Kept marking progress visible without needing to scroll.",
    ],
  },
  {
    version: "v1.3.3",
    title: "Marking workspace and quota fixes",
    date: "2026-05-15",
    changes: [
      "Moved submitted, marking, and review screens into the v1.3 product shell.",
      "Stopped quota and rate-limit failures being saved as accepted zero marks.",
      "Added retry/backoff handling for Gemini rate limits during marking.",
      "Improved marking progress states and partial-mark handling.",
    ],
  },
  {
    version: "v1.3.2",
    title: "Sidebar and typewriter fixes",
    date: "2026-05-15",
    changes: [
      "Fixed unreadable dropdown menus.",
      "Tightened sidebar subject spacing.",
      "Removed sidebar horizontal scrolling.",
      "Fixed the landing-page typewriter rotation timing.",
    ],
  },
  {
    version: "v1.3.1",
    title: "Polish and marking fixes",
    date: "2026-05-15",
    changes: [
      "Tightened supported-subject handling.",
      "Improved sidebar spacing and subject grouping.",
      "Smoothed landing-page and dashboard animations.",
      "Fixed multiple-choice answer handling.",
      "Moved remaining old review/marking screens into the v1.3 layout.",
      "Improved unsupported-question detection.",
    ],
  },
  {
    version: "v1.3",
    title: "Product redesign",
    date: "2026-05-15",
    changes: [
      "Added the scrollable landing page.",
      "Moved setup into subject onboarding.",
      "Rebuilt the dashboard around subjects and papers.",
      "Moved debug tools into Dev mode.",
      "Improved multiple-choice and unsupported-question handling.",
    ],
  },
  {
    version: "v1.22",
    title: "Gemini and visual refresh",
    date: "2026-05-09",
    changes: [
      "Moved AI calls through the Gemini Worker proxy.",
      "Added the blue-purple theme and updated branding.",
      "Kept papers and attempts stored locally.",
    ],
  },
];

export const currentVersionEntry = versionHistory[0];
