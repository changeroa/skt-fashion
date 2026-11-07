import { expect, test } from "bun:test";
import { skuSchema } from "../src/catalog";
import type { Product } from "../src/catalog";
import { observationSchema, styleAdvice, stylePreferencesSchema } from "../src/style";

const product: Product = {
  product_id: skuSchema.parse("OWN-001"), label: "Fixture", category: "top",
  color_family: "navy", product_type: "sweatshirt", age_group: "adult",
  sample_unit_price_krw: 50000, image: "fixture.png",
};
const observation = observationSchema.parse({
  sku: "OWN-001", profileVersion: "fixture", image: "/fixture.webp",
  imageSha256: "0".repeat(64), topVolume: "oversized", bottomVolume: "slim",
});
test("uses stated upper-body build without deriving a body type from product attributes", () => {
  // Given
  const preferences = { ...stylePreferencesSchema.parse({ upperBodyBuild: "muscular" }), fitPreference: null };
  // When
  const result = styleAdvice(product, preferences, observation);
  // Then
  expect(result.ruleIds).toEqual(["ST01"]);
  expect(result.basis).toBe("image-and-product");
});
test("uses a conditional outfit proposal when neither image nor personal preference exists", () => {
  // Given
  const preferences = { ...stylePreferencesSchema.parse({}), fitPreference: null };
  // When
  const result = styleAdvice(product, preferences, null);
  // Then
  expect(result.ruleIds).toEqual(["ST32"]);
  expect(result.basis).toBe("product");
});
test("changes the rule when a confirmed volume imbalance matches the stated goal", () => {
  // Given
  const preferences = { ...stylePreferencesSchema.parse({ silhouetteGoal: "balanced" }), fitPreference: null };
  // When
  const result = styleAdvice(product, preferences, observation);
  // Then
  expect(result.ruleIds).toEqual(["ST06"]);
});
test("does not turn unknown bottom volume into observed imbalance", () => {
  // Given
  const preferences = { ...stylePreferencesSchema.parse({ silhouetteGoal: "balanced" }), fitPreference: null };
  // When
  const result = styleAdvice(product, preferences, { ...observation, bottomVolume: "unknown" });
  // Then
  expect(result.ruleIds).toEqual(["ST32"]);
});
test.each([
  ["amekaji", "ST26"], ["street", "ST27"], ["classic", "ST28"], ["minimal", "ST29"],
  ["gorpcore", "ST30"], ["workwear", "ST31"], ["sporty", "ST32"],
])("uses the explicitly requested genre %s", (genre, ruleId) => {
  // Given
  const preferences = { ...stylePreferencesSchema.parse({ genre }), fitPreference: null };
  // When
  const result = styleAdvice(product, preferences, null);
  // Then
  expect(result.ruleIds).toEqual([ruleId]);
});
test("prioritizes observed upper-body pull over a silhouette goal", () => {
  // Given
  const preferences = { ...stylePreferencesSchema.parse({ silhouetteGoal: "balanced" }), fitPreference: null };
  // When
  const result = styleAdvice(product, preferences, { ...observation, shoulderChest: "tight" });
  // Then
  expect(result.ruleIds).toEqual(["ST33"]);
});
test("uses requested contrast rather than inferring personal color from the image", () => {
  // Given
  const preferences = { ...stylePreferencesSchema.parse({ contrast: "low" }), fitPreference: null };
  // When
  const result = styleAdvice(product, preferences, observation);
  // Then
  expect(result.ruleIds).toEqual(["ST32", "ST18"]);
});
