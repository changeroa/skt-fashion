import { describe, expect, test } from "bun:test";
import { fabricAdvice, fabricSchema, imageObservationSchema } from "../src/fabric";
import type { Fabric, FabricAdviceInput } from "../src/fabric";

describe("fabric rules", () => {
  const cases: readonly (readonly [string, Fabric, readonly string[]])[] = [
    ["cotton", { material: "cotton" }, ["FA01"]],
    ["fleece without inferred cotton", { construction: "fleece" }, ["FA02"]],
    ["French terry", { construction: "french-terry" }, ["FA03"]],
    ["loopback alias", { construction: "loopback" }, ["FA03"]],
    ["light denim below boundary", { construction: "denim", oz: 11.9 }, ["FA04"]],
    ["medium denim at lower boundary", { construction: "denim", oz: 12 }, ["FA05"]],
    ["medium denim at upper boundary", { construction: "denim", oz: 16 }, ["FA05"]],
    ["heavy denim including fractional weight", { construction: "denim", oz: 16.5 }, ["FA06"]],
    ["nylon ripstop", { material: "nylon", construction: "ripstop" }, ["FA07", "FA08"]],
    ["wool flannel", { material: "wool", construction: "flannel" }, ["FA09", "FA10"]],
    ["cotton flannel", { material: "cotton", construction: "flannel" }, ["FA01", "FA10"]],
    ["coarse knit boundary", { construction: "knit", gauge: 7, gaugeUnit: "needles-per-inch" }, ["FA11"]],
    ["fine knit boundary", { construction: "knit", gauge: 12, gaugeUnit: "needles-per-inch" }, ["FA12"]],
    ["fully fashioned unit conversion", { construction: "knit", gauge: 18, gaugeUnit: "needles-per-1.5-inches" }, ["FA12"]],
    ["knit without gauge unit", { construction: "knit", gauge: 3 }, ["FA40"]],
    ["light GSM boundary", { gsm: 180 }, ["FA14"]],
    ["middle GSM lower edge", { gsm: 181 }, ["FA15"]],
    ["middle GSM upper edge", { gsm: 349 }, ["FA15"]],
    ["heavy GSM boundary", { gsm: 350 }, ["FA16"]],
    ["polyester", { material: "polyester" }, ["FA37"]],
    ["jersey without inferred weight", { construction: "jersey" }, ["FA38"]],
    ["woven", { construction: "woven" }, ["FA39"]],
    ["denim without inferred weight", { construction: "denim" }, ["FA41"]],
  ];
  test.each(cases)("routes %s from actual metadata", (_name, fabric, ids) => {
    // Given
    const input = { fabric: fabricSchema.parse(fabric) };
    // When
    const result = fabricAdvice(input);
    // Then
    expect(result.basis).toBe("product");
    expect(result.ruleIds).toEqual(expect.arrayContaining(ids));
    expect(result.ruleIds).not.toContain("FA18");
  });

  test("uses composition instead of a conflicting material label", () => {
    // Given
    const fabric = fabricSchema.parse({
      material: "wool",
      composition: [{ fiber: "cotton", percent: 60 }, { fiber: "polyester", percent: 40 }],
    });
    // When
    const result = fabricAdvice({ fabric });
    // Then
    expect(result.ruleIds).toContain("FA13");
    expect(result.ruleIds).not.toContain("FA09");
    expect(result.ruleIds).not.toContain("FA01");
  });

  test("does not apply a fiber rule to zero percent", () => {
    // Given
    const fabric = fabricSchema.parse({
      composition: [{ fiber: "cotton", percent: 0 }, { fiber: "polyester", percent: 100 }],
    });
    // When
    const result = fabricAdvice({ fabric });
    // Then
    expect(result.ruleIds).toContain("FA37");
    expect(result.ruleIds).not.toContain("FA13");
    expect(result.ruleIds).not.toContain("FA01");
  });

  test("converts GSM to denim ounces without generic GSM rules", () => {
    // Given
    const fabric = { construction: "denim", gsm: 12 * 33.9057 } as const;
    // When
    const result = fabricAdvice({ fabric });
    // Then
    expect(result.ruleIds).toContain("FA05");
    expect(result.ruleIds).not.toContain("FA16");
  });

  test("prefers declared denim ounces over contradictory GSM", () => {
    // Given
    const fabric = { construction: "denim", gsm: 700, oz: 10 } as const;
    // When
    const result = fabricAdvice({ fabric });
    // Then
    expect(result.ruleIds).toContain("FA04");
    expect(result.ruleIds).not.toContain("FA06");
  });

  test("converts ounces to GSM for non-denim", () => {
    // Given
    const fabric = { construction: "fleece", oz: 12 } as const;
    // When
    const result = fabricAdvice({ fabric, length: "cropped" });
    // Then
    expect(result.ruleIds).toEqual(expect.arrayContaining(["FA16", "FA20", "FA22"]));
  });
});

describe("silhouette and comfort", () => {
  const matrix: readonly (readonly [
    NonNullable<Fabric["drape"]>,
    NonNullable<FabricAdviceInput["length"]>,
    string,
  ])[] = [
    ["structured", "cropped", "FA22"], ["structured", "regular", "FA23"],
    ["structured", "long", "FA24"], ["fluid", "cropped", "FA25"],
    ["fluid", "regular", "FA26"], ["fluid", "long", "FA27"],
  ];
  test.each(matrix)("combines %s fabric and %s length", (drape, length, id) => {
    // Given
    const input = { fabric: { drape }, length };
    // When
    const result = fabricAdvice(input);
    // Then
    expect(result.ruleIds).toContain(id);
    expect(result.basis).toBe("product");
  });

  test("combines heavy cropped fleece with broad build and sleeve stacking", () => {
    // Given
    const input: FabricAdviceInput = {
      fabric: { construction: "fleece", gsm: 400, stretch: "low", breathability: "low" },
      length: "cropped", upperBodyBuild: "broad", sleeveBreak: "below-wrist",
    };
    // When
    const result = fabricAdvice(input);
    // Then
    expect(result.ruleIds).toEqual(expect.arrayContaining(["FA16", "FA22", "FA29", "FA32", "FA34", "FA36"]));
    expect(result.ruleIds).not.toContain("FA01");
  });

  test("combines long lightweight jersey with muscular build and movement properties", () => {
    // Given
    const input: FabricAdviceInput = {
      fabric: { construction: "jersey", gsm: 150, stretch: "high", breathability: "high" },
      length: "long", upperBodyBuild: "muscular", sleeveBreak: "above-wrist",
    };
    // When
    const result = fabricAdvice(input);
    // Then
    expect(result.ruleIds).toEqual(expect.arrayContaining(["FA14", "FA27", "FA28", "FA30", "FA33", "FA35"]));
    expect(result.ruleIds).not.toContain("FA01");
  });

  test("prefers declared fluid drape to heavy-fleece tendency and image", () => {
    // Given
    const input: FabricAdviceInput = {
      fabric: { construction: "fleece", gsm: 400, drape: "fluid" },
      imageObservation: { verified: true, drape: "structured" },
      length: "cropped", sleeveBreak: "at-wrist",
    };
    // When
    const result = fabricAdvice(input);
    // Then
    expect(result.ruleIds).toEqual(expect.arrayContaining(["FA25", "FA31"]));
    expect(result.ruleIds).not.toContain("FA22");
    expect(result.ruleIds).not.toContain("FA18");
    expect(result.basis).toBe("product");
  });

  test("does not infer stiffness from GSM alone", () => {
    // Given
    const input: FabricAdviceInput = { fabric: { gsm: 400 }, length: "cropped" };
    // When
    const result = fabricAdvice(input);
    // Then
    expect(result.ruleIds).toContain("FA19");
    expect(result.ruleIds).not.toContain("FA22");
  });

  test("does not replace missing product drape with an image estimate", () => {
    // Given
    const input: FabricAdviceInput = {
      fabric: { material: "cotton" },
      imageObservation: { verified: true, drape: "fluid" }, length: "long",
    };
    // When
    const result = fabricAdvice(input);
    // Then
    expect(result.basis).toBe("product");
    expect(result.ruleIds).toContain("FA19");
    expect(result.ruleIds).not.toContain("FA27");
  });
});

describe("evidence and output contract", () => {
  test.each([{}, { fabric: {} }, { fabric: { material: "other" } }, {
    length: "long", upperBodyBuild: "muscular",
  }] satisfies readonly FabricAdviceInput[])("keeps missing fabric evidence unknown: %j", (input) => {
    // Given / When
    const result = fabricAdvice(input);
    // Then
    expect(result.basis).toBe("unknown");
    expect(result.ruleIds).toEqual(["FA17"]);
  });

  test("uses only verified drape when product metadata is unavailable", () => {
    // Given
    const input: FabricAdviceInput = {
      fabric: {}, imageObservation: { verified: true, drape: "fluid" }, length: "long",
    };
    // When
    const result = fabricAdvice(input);
    // Then
    expect(result.basis).toBe("image-estimate");
    expect(result.ruleIds).toEqual(["FA18", "FA21", "FA27"]);
  });

  test.each([
    { verified: false, drape: "fluid" },
    { verified: true, drape: "fluid", gsm: 150 },
    { verified: true, drape: "fluid", material: "cotton" },
    { drape: "fluid" },
  ])("rejects unverified or fabricated observation fields: %j", (input) => {
    // Given / When
    const result = imageObservationSchema.safeParse(input);
    // Then
    expect(result.success).toBe(false);
  });

  test.each([
    { gsm: 0 }, { gsm: Number.POSITIVE_INFINITY }, { oz: -1 }, { gauge: 3.5 },
    { composition: [{ fiber: "cotton", percent: 101 }] },
    { composition: [{ fiber: "cotton", percent: 60 }, { fiber: "polyester", percent: 50 }] },
    { composition: [{ fiber: "cotton", percent: 50 }, { fiber: "cotton", percent: 50 }] },
  ])("rejects invalid fabric measurements and composition: %j", (input) => {
    // Given / When
    const result = fabricSchema.safeParse(input);
    // Then
    expect(result.success).toBe(false);
  });

  test("accepts partial known composition without filling missing fibers", () => {
    // Given
    const input = { composition: [{ fiber: "cotton", percent: 30 }] };
    // When
    const result = fabricAdvice({ fabric: fabricSchema.parse(input) });
    // Then
    expect(result.ruleIds).toContain("FA01");
    expect(result.ruleIds).not.toContain("FA13");
  });

  test.each([
    {},
    { imageObservation: { verified: true, drape: "fluid" }, length: "long" },
    { fabric: { material: "wool", construction: "knit", stretch: "high" }, upperBodyBuild: "broad" },
  ] satisfies readonly FabricAdviceInput[])("returns three nonempty single lines and unique rules: %j", (input) => {
    // Given / When
    const result = fabricAdvice(input);
    // Then
    for (const line of [result.opinion, result.valueOpinion, result.silhouetteOpinion]) {
      expect(line.length).toBeGreaterThan(0);
      expect(/[\r\n]/u.test(line)).toBe(false);
    }
    expect(new Set(result.ruleIds).size).toBe(result.ruleIds.length);
  });

  test("leaves frozen inputs unchanged and returns deterministic results", () => {
    // Given
    const fabric = Object.freeze({ material: "cotton", construction: "fleece", gsm: 400 } as const);
    const input = Object.freeze({ fabric, length: "cropped", upperBodyBuild: "muscular" } as const);
    const before = structuredClone(input);
    // When
    const results = [fabricAdvice(input), fabricAdvice(input)];
    // Then
    expect(results[0]).toEqual(results[1]);
    expect(input).toEqual(before);
  });
});
