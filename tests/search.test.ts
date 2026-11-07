import { describe, expect, test } from "bun:test";
import { searchCatalog, skuSchema } from "../src/catalog";
import type { Catalog, Product } from "../src/catalog";

// Synthetic records only: never loadCatalog or read FASHION_HOME.
function product(
  id: string,
  label: string,
  type: string,
  price: number,
  overrides: Partial<Product> = {},
): Product {
  return {
    product_id: skuSchema.parse(id),
    label,
    category: "top",
    color_family: "navy",
    product_type: type,
    age_group: "adult",
    sample_unit_price_krw: price,
    image: "fixture.png",
    ...overrides,
  };
}

const catalog: Catalog = {
  source: "F&F sample",
  root: "/fixture",
  asOf: "2026-11-07",
  products: [
    product("TOP-001", "MLB basic", "sweatshirt", 40000),
    product("TOP-002", "Discovery light", "jacket", 70000),
    product("TOP-003", "MLB light", "windbreaker", 90000),
    product("TOP-004", "Discovery warm", "맨투맨", 50000),
    product("TOP-005", "MLB kids light", "jacket", 10000, { age_group: "kids" }),
    product("TOP-006", "Other light", "바람막이", 60000),
    product("TOP-007", "Other spare", "jacket", 65000),
    product("TOP-008", "Other hooded", "hoodie", 30000),
    product("TOP-009", "Other tee", "t-shirt", 20000),
  ],
};

describe("tolerant specific-item search", () => {
  test("requires brand and item tokens regardless of order or case", () => {
    const result = searchCatalog(catalog, { budget: 100000, item: "  바람막이 mLb  " });
    expect(result.candidates.map((p) => p.product_id)).toEqual([skuSchema.parse("TOP-003")]);
    expect(result.availability).toBe("found");
    expect(result.alternatives).toEqual([]);
    expect(result.matchedCount).toBe(1);
  });

  test.each([
    ["엠엘비 맨투맨", "TOP-001"],
    ["DISCOVERY 바람막이", "TOP-002"],
    ["디스커버리 SWEATSHIRT", "TOP-004"],
    ["Other 후드티", "TOP-008"],
    ["Other 티셔츠", "TOP-009"],
    ["other T-SHIRT", "TOP-009"],
    ["top-003", "TOP-003"],
    ["F & F MLB 바람막이", "TOP-003"],
  ])("matches aliases and normalized tokens: %s", (item, id) => {
    const result = searchCatalog(catalog, { budget: 100000, item });
    expect(result.candidates.map((p) => p.product_id)).toEqual([skuSchema.parse(id)]);
  });

  test("applies category synonyms together with item brand tokens", () => {
    const result = searchCatalog(catalog, {
      budget: 100000,
      category: "바람막이",
      item: "discovery",
    });
    expect(result.candidates.map((p) => p.product_id)).toEqual([skuSchema.parse("TOP-002")]);
  });

  test("never counts a brand-only overlap as an exact specific item", () => {
    const result = searchCatalog(catalog, { budget: 100000, item: "MLB hoodie" });
    expect(result.status).toBe("empty");
    expect(result.matchedCount).toBe(0);
    expect(result.candidates).toEqual([]);
    expect(result.availability).toBe("not_in_catalog");
    expect(result.alternatives[0]?.product_id).toBe(skuSchema.parse("TOP-008"));
    expect(result.nextSteps.map((step) => step.action)).toEqual([
      "view_alternatives", "change_item", "stop",
    ]);
  });

  test("reports over-budget separately and ranks affordable adult types first", () => {
    const result = searchCatalog(catalog, { budget: 70000, item: "MLB 바람막이" });
    expect(result.status).toBe("empty");
    expect(result.availability).toBe("over_budget");
    expect(result.candidates).toEqual([]);
    expect(result.matchedCount).toBe(0);
    expect(result.alternatives.map((p) => p.product_id)).toEqual([
      skuSchema.parse("TOP-006"), skuSchema.parse("TOP-007"), skuSchema.parse("TOP-002"),
    ]);
    expect(result.alternatives.every((p) =>
      p.age_group === "adult" && p.sample_unit_price_krw <= result.budget,
    )).toBe(true);
    expect(result.nextSteps).toContainEqual({
      action: "adjust_budget", label: "예산 조정", minimumBudget: 90000,
    });
  });

  test("does not confuse a missing item or a kids-only match with over-budget", () => {
    const kidsOnly: Catalog = {
      ...catalog,
      products: [product("TOP-010", "MLB", "hoodie", 20000, { age_group: "kids" })],
    };
    const result = searchCatalog(kidsOnly, { budget: 10000, item: "MLB hoodie" });
    expect(result.availability).toBe("not_in_catalog");
    expect(result.candidates).toEqual([]);
    expect(result.alternatives).toEqual([]);
    expect(result.nextSteps.map((step) => step.action)).toEqual(["change_item", "stop"]);
  });

  test("keeps own-design separate even when its label mentions an F&F brand", () => {
    const own: Catalog = {
      ...catalog,
      source: "own-design",
      products: [product("OWN-001", "MLB inspired", "jacket", 10000)],
    };
    for (const item of ["F&F 바람막이", "MLB 바람막이", "디스커버리 바람막이"]) {
      const result = searchCatalog(own, { budget: 100000, item });
      expect(result.source).toBe("own-design");
      expect(result.availability).toBe("not_in_catalog");
      expect(result.candidates).toEqual([]);
      expect(result.alternatives).toEqual([]);
    }
  });

  test("allows an explicitly selected own-design search without brand substitution", () => {
    const own: Catalog = {
      ...catalog,
      source: "own-design",
      products: [product("OWN-001", "자체 디자인", "맨투맨", 10000)],
    };
    expect(searchCatalog(own, { budget: 10000, item: "sweatshirt" }).candidates)
      .toEqual([...own.products]);
  });

  test("preserves legacy metadata, price ordering, count and candidate limit", () => {
    const result = searchCatalog(catalog, { budget: 70000, category: "TOP" });
    expect(result.source).toBe(catalog.source);
    expect(result.asOf).toBe(catalog.asOf);
    expect(result.status).toBe("found");
    expect(result.priceBasis).toBe("sample_reference");
    expect(result.finalTotalKnown).toBe(false);
    expect(result.matchedCount).toBe(7);
    expect(result.candidates.map((p) => p.sample_unit_price_krw)).toEqual([20000, 30000, 40000]);
    expect(typeof result.notice).toBe("string");
  });

  test("keeps the budget inclusive and validates invalid budgets", () => {
    const result = searchCatalog(catalog, { budget: 90000, item: "MLB windbreaker" });
    expect(result.availability).toBe("found");
    expect(result.candidates.map((p) => p.product_id)).toEqual([skuSchema.parse("TOP-003")]);
    for (const budget of [-1, NaN, Infinity]) {
      expect(() => searchCatalog(catalog, { budget })).toThrow();
    }
  });

  test("handles empty catalogs without inventing candidates or next-step prices", () => {
    const result = searchCatalog({ ...catalog, products: [] }, { budget: 0, item: "jacket" });
    expect(result.availability).toBe("not_in_catalog");
    expect(result.alternatives).toEqual([]);
    expect(result.candidates).toEqual([]);
    expect(result.nextSteps).toHaveLength(2);
  });
});
