export const ACHIEVEMENTS = [
  { id: "first_upload", label: "First Paper", desc: "Uploaded your first paper", icon: "Upload" },
  { id: "first_mark", label: "First Marks", desc: "Got your first paper marked", icon: "Check" },
  { id: "first_perfect", label: "Full Marks", desc: "Scored full marks on a question", icon: "Star" },
  { id: "ten_questions", label: "Ten Questions", desc: "Answered 10 questions across any paper", icon: "ListChecks" },
  { id: "three_streak", label: "3-Day Streak", desc: "Used the app 3 days in a row", icon: "Flame" },
  { id: "all_subjects", label: "All Subjects", desc: "Attempted a paper in all 4 subjects", icon: "Grid" },
  { id: "high_score", label: "Top Marks", desc: "Scored 80% or above on a paper", icon: "Trophy" },
] as const;

export type AchievementId = (typeof ACHIEVEMENTS)[number]["id"];
