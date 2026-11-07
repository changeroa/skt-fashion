import { createHash } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { FashionError, findProduct, privateHome } from "./catalog";
import type { Catalog, SKU } from "./catalog";
import { observationSchema, styleAdvice, stylePreferencesSchema } from "./style";
import { fabricAdvice } from "./fabric";

const profileSchema = z.object({
  updated: z.string(),
  profileId: z.string().optional(),
  version: z.number().int().optional(),
  sizes: z.unknown().nullable(),
  fitPreference: z.string().nullable(),
  heightCm: z.number().positive().optional(),
  weightKg: z.number().positive().optional(),
  skeletalMuscleKg: z.number().positive().optional(),
  bodyFatPct: z.number().min(0).max(100).optional(),
  photos: z.array(
    z.object({
      slot: z.string(),
      file: z.string(),
      status: z.string(),
    }),
  ),
});

export async function loadProfile() {
  const raw = await Bun.file(join(privateHome(), "profile/body-profile.json")).text();
  const profile = profileSchema.parse(JSON.parse(raw));
  const styleFile = Bun.file(join(privateHome(), "profile/style-preferences.json"));
  const styleRaw = await styleFile.exists() ? await styleFile.text() : "{}";
  return {
    ...profile,
    profileId: profile.profileId ?? "local-owner",
    version: createHash("sha256").update(raw).digest("hex").slice(0, 16),
    decisionVersion: createHash("sha256").update(raw + styleRaw).digest("hex").slice(0, 16),
    stylePreferences: stylePreferencesSchema.parse(JSON.parse(styleRaw)),
  };
}

export async function fitCard(catalog: Catalog, sku: SKU, observationPath?: string) {
  const product = findProduct(catalog, sku);
  const profile = await loadProfile();
  const observationFile = Bun.file(observationPath ?? join(privateHome(), `demo/${sku}.style.json`));
  const observation = await observationFile.exists() ? observationSchema.parse(await observationFile.json()) : null;
  if (observation) {
    if (observation.sku !== sku || observation.profileVersion !== profile.version) {
      throw new FashionError("stale_observation", "현재 상품·프로필의 착장을 다시 확인하세요.");
    }
    const image = Bun.file(observation.image);
    if (!(await image.exists()) || createHash("sha256").update(new Uint8Array(await image.arrayBuffer())).digest("hex") !== observation.imageSha256) {
      throw new FashionError("stale_observation", "착장 이미지가 변경됐습니다. 다시 확인하세요.");
    }
  }
  const style = styleAdvice(product, { ...profile.stylePreferences, fitPreference: profile.fitPreference }, observation);
  const fabric = fabricAdvice({
    fabric: product.fabric,
    imageObservation: observation?.fabric,
    length: observation?.length,
    sleeveBreak: observation?.sleeve === "wrist" ? "at-wrist"
      : observation?.sleeve === "short" ? "above-wrist"
      : observation?.sleeve === "over-hand" ? "below-wrist" : "unknown",
    upperBodyBuild: profile.stylePreferences.upperBodyBuild,
  });
  const alternative = catalog.products
    .filter((p) => p.product_id !== sku && p.age_group === product.age_group && p.product_type === product.product_type)
    .toSorted((a, b) => a.sample_unit_price_krw - b.sample_unit_price_krw)[0];
  return {
    summary: style.opinion,
    image: observation?.image ?? null,
    styleOpinion: style.opinion,
    styleRuleIds: style.ruleIds,
    styleBasis: style.basis,
    fabricOpinion: fabric.opinion,
    fabricValueOpinion: fabric.valueOpinion,
    silhouetteComfort: fabric.silhouetteOpinion,
    fabricBasis: fabric.basis,
    fabricRuleIds: fabric.ruleIds,
    alternativeDifference: alternative
      ? `${alternative.label}은 ${alternative.color_family} 색으로 바뀌고 참고가격은 ${alternative.sample_unit_price_krw - product.sample_unit_price_krw}원 차이예요.`
      : "같은 종류의 대안이 없어 다른 색·핏을 검색해 볼 수 있어요.",
    card: "fit",
    source: catalog.source,
    sku,
    label: product.label,
    profileId: profile.profileId,
    profileVersion: profile.version,
    decisionVersion: profile.decisionVersion,
    readySlots: profile.photos.filter((p) => p.status === "usable").map((p) => p.slot),
    sizing: "핏 미확인",
    sizeChart: null,
    usualSizeProvided: profile.sizes !== null,
    fitPreferenceProvided: profile.fitPreference !== null,
    pastPreferences: profile.fitPreference ?? "등록된 핏 선호 없음",
    styleEvidence: style.opinion,
    uncertainties: [
      "상품 실측표가 없어 사이즈를 추천하지 않습니다.",
      "예상 착장은 실제 착용감·사이즈 보장이 아닙니다.",
      "A.X는 이미지를 보거나 외관을 평가하지 않습니다.",
    ],
    next: "선호 / 다른 옵션 / 사이즈 확인 / 보류",
  };
}
