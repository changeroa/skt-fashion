import { createHash } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { findProduct, privateHome } from "./catalog";
import type { Catalog, SKU } from "./catalog";

const profileSchema = z.object({
  updated: z.string(),
  profileId: z.string().optional(),
  version: z.number().int().optional(),
  sizes: z.unknown().nullable(),
  fitPreference: z.string().nullable(),
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
  return {
    ...profile,
    profileId: profile.profileId ?? "local-owner",
    version: createHash("sha256").update(raw).digest("hex").slice(0, 16),
  };
}

export async function fitCard(catalog: Catalog, sku: SKU) {
  const product = findProduct(catalog, sku);
  const profile = await loadProfile();
  return {
    card: "fit",
    source: catalog.source,
    sku,
    label: product.label,
    profileId: profile.profileId,
    profileVersion: profile.version,
    readySlots: profile.photos.filter((p) => p.status === "usable").map((p) => p.slot),
    sizing: "핏 미확인",
    sizeChart: null,
    usualSizeProvided: profile.sizes !== null,
    fitPreferenceProvided: profile.fitPreference !== null,
    pastPreferences: "과거 선호 없음",
    styleEvidence: `상품 텍스트의 ${product.color_family} 색상, ${product.product_type}만 확인했습니다.`,
    uncertainties: [
      "상품 실측표가 없어 사이즈를 추천하지 않습니다.",
      "예상 착장은 실제 착용감·사이즈 보장이 아닙니다.",
      "A.X는 이미지를 보거나 외관을 평가하지 않습니다.",
    ],
    next: "선호 / 다른 옵션 / 사이즈 확인 / 보류",
  };
}
