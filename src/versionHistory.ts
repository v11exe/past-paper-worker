export type VersionHistoryEntry = {
  version: string;
  title: string;
  date: string;
  changes: string[];
};

export const versionHistory: VersionHistoryEntry[] = [
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
