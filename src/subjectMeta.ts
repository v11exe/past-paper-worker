import {
  Atom,
  Binary,
  BookOpenText,
  Calculator,
  Clapperboard,
  Cpu,
  FlaskConical,
  Globe2,
  PenLine,
  Sigma,
  type LucideIcon,
} from "lucide-react";

import { supportedSubjects, type SupportedSubject } from "./subjects";

export type SubjectMeta = {
  id: string;
  label: SupportedSubject;
  shortLabel: string;
  examBoard: "AQA" | "OCR" | "Pearson Edexcel";
  level: string;
  specCode?: string;
  Icon: LucideIcon;
  accent: string;
  specUrl: string;
  supported: true;
};

export const subjectMeta: Record<SupportedSubject, SubjectMeta> = {
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
  "Pearson Edexcel GCSE Mathematics": {
    id: "pearson-edexcel-gcse-mathematics",
    label: "Pearson Edexcel GCSE Mathematics",
    shortLabel: "Maths",
    examBoard: "Pearson Edexcel",
    level: "GCSE",
    specCode: "1MA1",
    Icon: Calculator,
    accent: "#fcd34d",
    specUrl: "https://qualifications.pearson.com/en/qualifications/edexcel-gcses/mathematics-2015.html",
    supported: true,
  },
  "Pearson Edexcel Level 2 Extended Mathematics Certificate": {
    id: "pearson-edexcel-level-2-extended-mathematics-certificate",
    label: "Pearson Edexcel Level 2 Extended Mathematics Certificate",
    shortLabel: "Extended Maths",
    examBoard: "Pearson Edexcel",
    level: "Level 2",
    Icon: Sigma,
    accent: "#fde68a",
    specUrl: "https://qualifications.pearson.com/",
    supported: true,
  },
  "OCR GCSE Geography A": {
    id: "ocr-gcse-geography-a",
    label: "OCR GCSE Geography A",
    shortLabel: "Geography",
    examBoard: "OCR",
    level: "GCSE A",
    specCode: "J383",
    Icon: Globe2,
    accent: "#67e8f9",
    specUrl: "https://www.ocr.org.uk/qualifications/gcse/geography-a-geographical-themes-j383-from-2016/",
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
  "OCR Cambridge Nationals Creative iMedia J834": {
    id: "ocr-cambridge-nationals-creative-imedia-j834",
    label: "OCR Cambridge Nationals Creative iMedia J834",
    shortLabel: "Creative iMedia",
    examBoard: "OCR",
    level: "Cambridge National",
    specCode: "J834",
    Icon: Clapperboard,
    accent: "#f0abfc",
    specUrl: "https://www.ocr.org.uk/qualifications/cambridge-nationals/creative-imedia-level-1-2-award-certificate-j834/",
    supported: true,
  },
  "AQA GCSE English Literature": {
    id: "aqa-gcse-english-literature",
    label: "AQA GCSE English Literature",
    shortLabel: "English Literature",
    examBoard: "AQA",
    level: "GCSE",
    specCode: "8702",
    Icon: BookOpenText,
    accent: "#fda4af",
    specUrl: "https://www.aqa.org.uk/subjects/english/gcse/english-literature-8702/specification",
    supported: true,
  },
  "AQA GCSE English Language": {
    id: "aqa-gcse-english-language",
    label: "AQA GCSE English Language",
    shortLabel: "English Language",
    examBoard: "AQA",
    level: "GCSE",
    specCode: "8700",
    Icon: PenLine,
    accent: "#fb7185",
    specUrl: "https://www.aqa.org.uk/subjects/english/gcse/english-language-8700/specification",
    supported: true,
  },
};

export const subjectMetaList = supportedSubjects.map((subject) => subjectMeta[subject]);

export const unsupportedSubjects = [
  "History",
  "Religious Studies",
  "Combined Science",
  "Business Studies",
  "Psychology",
  "Sociology",
  "Film Studies",
  "Economics",
  "Food and Nutrition",
  "Citizenship Studies",
  "Design and Technology",
  "Physical Education",
  "A-Level subjects",
];

export function subjectMetaForLabel(subject: string): SubjectMeta | null {
  return supportedSubjects.includes(subject as SupportedSubject) ? subjectMeta[subject as SupportedSubject] : null;
}
