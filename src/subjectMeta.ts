import {
  Atom,
  Binary,
  BookOpenText,
  BriefcaseBusiness,
  Calculator,
  Clapperboard,
  Cpu,
  FlaskConical,
  Globe2,
  Landmark,
  PenLine,
  Scale,
  Sigma,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import {
  supportedSubjects,
  unsupportedSubjects,
  type SelectableSubject,
  type SupportedSubject,
  type UnsupportedSubject,
} from "./subjects";

type SubjectMetaBase = {
  id: string;
  label: SelectableSubject;
  shortLabel: string;
  Icon: LucideIcon;
  accent: string;
  supported: boolean;
};

export type SupportedSubjectMeta = SubjectMetaBase & {
  label: SupportedSubject;
  examBoard: "AQA" | "OCR" | "Pearson Edexcel";
  level: string;
  specCode?: string;
  specUrl: string;
  supported: true;
};

export type UnsupportedSubjectMeta = SubjectMetaBase & {
  label: UnsupportedSubject;
  supported: false;
  statusNote: string;
};

export type SubjectMeta = SupportedSubjectMeta | UnsupportedSubjectMeta;

export const subjectMeta: Record<SupportedSubject, SupportedSubjectMeta> = {
  "AQA GCSE Biology": {
    id: "aqa-gcse-biology",
    label: "AQA GCSE Biology",
    shortLabel: "Biology",
    examBoard: "AQA",
    level: "GCSE",
    specCode: "8461",
    Icon: Atom,
    accent: "#6ee7b7",
    specUrl: "https://www.aqa.org.uk/subjects/science/gcse/biology-8461/specification",
    supported: true,
  },
  "AQA GCSE Chemistry": {
    id: "aqa-gcse-chemistry",
    label: "AQA GCSE Chemistry",
    shortLabel: "Chemistry",
    examBoard: "AQA",
    level: "GCSE",
    specCode: "8462",
    Icon: FlaskConical,
    accent: "#93c5fd",
    specUrl: "https://www.aqa.org.uk/subjects/science/gcse/chemistry-8462/specification",
    supported: true,
  },
  "AQA GCSE Physics": {
    id: "aqa-gcse-physics",
    label: "AQA GCSE Physics",
    shortLabel: "Physics",
    examBoard: "AQA",
    level: "GCSE",
    specCode: "8463",
    Icon: Binary,
    accent: "#c4b5fd",
    specUrl: "https://www.aqa.org.uk/subjects/science/gcse/physics-8463/specification",
    supported: true,
  },
  "OCR GCSE Computer Science J277": {
    id: "ocr-gcse-computer-science-j277",
    label: "OCR GCSE Computer Science J277",
    shortLabel: "Computer Science",
    examBoard: "OCR",
    level: "GCSE",
    specCode: "J277",
    Icon: Cpu,
    accent: "#60a5fa",
    specUrl: "https://www.ocr.org.uk/qualifications/gcse/computer-science-j277-from-2020/",
    supported: true,
  },
};

export const unsupportedSubjectMeta: Record<UnsupportedSubject, UnsupportedSubjectMeta> = {
  "Pearson Edexcel GCSE Mathematics": {
    id: "pearson-edexcel-gcse-mathematics",
    label: "Pearson Edexcel GCSE Mathematics",
    shortLabel: "Maths",
    Icon: Calculator,
    accent: "#f6c453",
    supported: false,
    statusNote: "Not supported yet",
  },
  "Pearson Edexcel Level 2 Extended Mathematics Certificate": {
    id: "pearson-edexcel-level-2-extended-mathematics-certificate",
    label: "Pearson Edexcel Level 2 Extended Mathematics Certificate",
    shortLabel: "Extended Maths",
    Icon: Sigma,
    accent: "#fde68a",
    supported: false,
    statusNote: "Not supported yet",
  },
  "OCR GCSE Geography A": {
    id: "ocr-gcse-geography-a",
    label: "OCR GCSE Geography A",
    shortLabel: "Geography",
    Icon: Globe2,
    accent: "#67e8f9",
    supported: false,
    statusNote: "Not supported yet",
  },
  "OCR Cambridge Nationals Creative iMedia J834": {
    id: "ocr-cambridge-nationals-creative-imedia-j834",
    label: "OCR Cambridge Nationals Creative iMedia J834",
    shortLabel: "Creative iMedia",
    Icon: Clapperboard,
    accent: "#f0abfc",
    supported: false,
    statusNote: "Not supported yet",
  },
  "AQA GCSE English Literature": {
    id: "aqa-gcse-english-literature",
    label: "AQA GCSE English Literature",
    shortLabel: "English Literature",
    Icon: BookOpenText,
    accent: "#fda4af",
    supported: false,
    statusNote: "Not supported yet",
  },
  "AQA GCSE English Language": {
    id: "aqa-gcse-english-language",
    label: "AQA GCSE English Language",
    shortLabel: "English Language",
    Icon: PenLine,
    accent: "#fb7185",
    supported: false,
    statusNote: "Not supported yet",
  },
  History: {
    id: "history",
    label: "History",
    shortLabel: "History",
    Icon: Landmark,
    accent: "#f59e42",
    supported: false,
    statusNote: "Not supported yet",
  },
  "Religious Studies": {
    id: "religious-studies",
    label: "Religious Studies",
    shortLabel: "Religious Studies",
    Icon: BookOpenText,
    accent: "#fca5a5",
    supported: false,
    statusNote: "Not supported yet",
  },
  "Combined Science": {
    id: "combined-science",
    label: "Combined Science",
    shortLabel: "Combined Science",
    Icon: Sparkles,
    accent: "#5eead4",
    supported: false,
    statusNote: "Not supported yet",
  },
  "Business Studies": {
    id: "business-studies",
    label: "Business Studies",
    shortLabel: "Business Studies",
    Icon: BriefcaseBusiness,
    accent: "#94a3b8",
    supported: false,
    statusNote: "Not supported yet",
  },
  Psychology: {
    id: "psychology",
    label: "Psychology",
    shortLabel: "Psychology",
    Icon: Sparkles,
    accent: "#c084fc",
    supported: false,
    statusNote: "Not supported yet",
  },
  Sociology: {
    id: "sociology",
    label: "Sociology",
    shortLabel: "Sociology",
    Icon: BookOpenText,
    accent: "#fb7185",
    supported: false,
    statusNote: "Not supported yet",
  },
  "Film Studies": {
    id: "film-studies",
    label: "Film Studies",
    shortLabel: "Film Studies",
    Icon: Clapperboard,
    accent: "#f472b6",
    supported: false,
    statusNote: "Not supported yet",
  },
  Economics: {
    id: "economics",
    label: "Economics",
    shortLabel: "Economics",
    Icon: BriefcaseBusiness,
    accent: "#2dd4bf",
    supported: false,
    statusNote: "Not supported yet",
  },
  "Food and Nutrition": {
    id: "food-and-nutrition",
    label: "Food and Nutrition",
    shortLabel: "Food and Nutrition",
    Icon: Sparkles,
    accent: "#fb923c",
    supported: false,
    statusNote: "Not supported yet",
  },
  "Citizenship Studies": {
    id: "citizenship-studies",
    label: "Citizenship Studies",
    shortLabel: "Citizenship",
    Icon: Scale,
    accent: "#38bdf8",
    supported: false,
    statusNote: "Not supported yet",
  },
  "Design and Technology": {
    id: "design-and-technology",
    label: "Design and Technology",
    shortLabel: "Design and Technology",
    Icon: Sparkles,
    accent: "#a3e635",
    supported: false,
    statusNote: "Not supported yet",
  },
  "Physical Education": {
    id: "physical-education",
    label: "Physical Education",
    shortLabel: "Physical Education",
    Icon: Sparkles,
    accent: "#f97316",
    supported: false,
    statusNote: "Not supported yet",
  },
  "A-Level subjects": {
    id: "a-level-subjects",
    label: "A-Level subjects",
    shortLabel: "A-Level subjects",
    Icon: Sparkles,
    accent: "#7dd3fc",
    supported: false,
    statusNote: "Not supported yet",
  },
};

export const selectableSubjectMeta: Record<SelectableSubject, SubjectMeta> = {
  ...subjectMeta,
  ...unsupportedSubjectMeta,
};

export const subjectMetaList = supportedSubjects.map((subject) => subjectMeta[subject]);

export { unsupportedSubjects };

export function subjectMetaForLabel(subject: string): SubjectMeta | null {
  return subject in selectableSubjectMeta ? selectableSubjectMeta[subject as SelectableSubject] : null;
}
