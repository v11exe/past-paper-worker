import { describe, expect, it } from "vitest";

import { extractChoiceStructure, normalizeChoiceInstructionText } from "./choiceParsing";

describe("choice parsing", () => {
  it("normalizes broken tick-box glyph instructions", () => {
    expect(normalizeChoiceInstructionText("Tick (☐) one box")).toBe("Tick one box");
    expect(normalizeChoiceInstructionText("Tick (3) one box")).toBe("Tick one box");
  });

  it("extracts clean A/B/C/D single-choice options", () => {
    const extracted = extractChoiceStructure("Tick one box. A nucleus B ribosome C cell wall D cytoplasm");

    expect(extracted.quality).toBe("deterministic");
    expect(extracted.promptText).toBe("Choose the correct answer.");
    expect(extracted.options).toEqual(["A. nucleus", "B. ribosome", "C. cell wall", "D. cytoplasm"]);
  });

  it("does not split ordinary prose like Cell cycle into fake options", () => {
    const extracted = extractChoiceStructure("This question is about the Cell cycle.", true);

    expect(extracted.options).toEqual([]);
    expect(extracted.quality).not.toBe("deterministic");
  });

  it("treats corrupted inline multiple-choice text with no separators as ambiguous", () => {
    const extracted = extractChoiceStructure("Tick one box. A Bacterial cell wall cell membrane nucleus", true);

    expect(extracted.options).toEqual([]);
    expect(extracted.quality).not.toBe("deterministic");
  });

  it("supports clean lozenge questions and leaves row-by-row rejection to the support guardrails", () => {
    const clean = extractChoiceStructure("Shade one lozenge. A ionic B covalent C metallic D giant ionic");
    const rowByRow = extractChoiceStructure("Tick one box in each row. A yes B no C maybe D unsure", true);

    expect(clean.quality).toBe("deterministic");
    expect(clean.options).toEqual(["A. ionic", "B. covalent", "C. metallic", "D. giant ionic"]);
    expect(rowByRow.options).toEqual(["A. yes", "B. no", "C. maybe", "D. unsure"]);
  });
});
