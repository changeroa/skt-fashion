import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

let home: string;
let observation: { sku: string; profileVersion: string; image: string; imageSha256: string; length: string; fabric: { verified: boolean; drape: string } };
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "fashion-cards-"));
  const raw = JSON.stringify({ updated: "fixture", sizes: null, fitPreference: "루즈핏", photos: [] });
  await Bun.write(join(home, "profile/body-profile.json"), raw);
  await Bun.write(join(home, "profile/style-preferences.json"), JSON.stringify({ upperBodyBuild: "muscular", genre: "street" }));
  const image = join(home, "fixture.webp");
  const bytes = "fixture image content";
  await Bun.write(image, bytes);
  observation = {
    sku: "OWN-001", profileVersion: createHash("sha256").update(raw).digest("hex").slice(0, 16),
    image, imageSha256: createHash("sha256").update(bytes).digest("hex"),
    length: "cropped", fabric: { verified: true, drape: "structured" },
  };
  await Bun.write(join(home, "observed.json"), JSON.stringify(observation));
});
afterAll(async () => { await rm(home, { recursive: true, force: true }); });
async function cli(command: string, path: string) {
  const p = Bun.spawn([process.execPath, join(import.meta.dir, "../src/cli.ts"), command,
    "--source", "own", "--sku", "OWN-001", "--observation", path], {
    env: { ...process.env, FASHION_HOME: home }, stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited,
  ]);
  return JSON.parse(exit === 0 ? stdout : stderr) as unknown;
}
test("uses the bound image, declared preference and fabric-length rules on the real fit CLI", async () => {
  // Given
  const path = join(home, "observed.json");
  // When
  const card = z.object({
    image: z.string(), styleRuleIds: z.array(z.string()), fabricRuleIds: z.array(z.string()),
    styleBasis: z.string(), fabricBasis: z.string(), sizeChart: z.null(),
  }).parse(await cli("fit_card", path));
  // Then
  expect(card.image).toBe(observation.image);
  expect(card.styleRuleIds).toEqual(["ST01", "ST27"]);
  expect(card.fabricRuleIds).toEqual(expect.arrayContaining(["FA18", "FA22", "FA28"]));
  expect(card.styleBasis).toBe("image-and-product");
  expect(card.fabricBasis).toBe("image-estimate");
  expect(card.sizeChart).toBeNull();
});
test("uses the same labeled image evidence for the price card", async () => {
  // Given
  const path = join(home, "observed.json");
  // When
  const card = z.object({ fabricBasis: z.string(), fabricRuleIds: z.array(z.string()) })
    .parse(await cli("price_card", path));
  // Then
  expect(card.fabricBasis).toBe("image-estimate");
  expect(card.fabricRuleIds).toContain("FA18");
});
test("rejects an observation belonging to another profile", async () => {
  // Given
  const path = join(home, "stale.json");
  await Bun.write(path, JSON.stringify({ ...observation, profileVersion: "another" }));
  // When
  const result = z.object({ code: z.string() }).parse(await cli("fit_card", path));
  // Then
  expect(result.code).toBe("stale_observation");
});
test("rejects an observation when the image bytes have changed", async () => {
  // Given
  const path = join(home, "modified.json");
  await Bun.write(path, JSON.stringify({ ...observation, imageSha256: "0".repeat(64) }));
  // When
  const result = z.object({ code: z.string() }).parse(await cli("fit_card", path));
  // Then
  expect(result.code).toBe("stale_observation");
});
