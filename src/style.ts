import { z } from "zod";
import { skuSchema } from "./catalog";
import type { Product } from "./catalog";
import { imageObservationSchema } from "./fabric";

export const stylePreferencesSchema = z.object({
  upperBodyBuild: z.enum(["muscular", "broad", "unspecified"]).default("unspecified"),
  genre: z.enum(["amekaji", "street", "classic", "minimal", "gorpcore", "workwear", "sporty"]).optional(),
  occasion: z.enum(["casual", "office", "formal", "outdoor"]).optional(),
  contrast: z.enum(["low", "high"]).optional(),
  silhouetteGoal: z.enum(["balanced", "relaxed", "leg-line"]).optional(),
});
export type StylePreferences = z.infer<typeof stylePreferencesSchema>;
export const observationSchema = z.object({
  sku: skuSchema,
  profileVersion: z.string(),
  image: z.string(),
  imageSha256: z.string().regex(/^[a-f0-9]{64}$/),
  shoulderChest: z.enum(["relaxed", "tight", "unknown"]).default("unknown"),
  topVolume: z.enum(["regular", "oversized", "unknown"]).default("unknown"),
  bottomVolume: z.enum(["slim", "straight", "wide", "unknown"]).default("unknown"),
  length: z.enum(["cropped", "regular", "long", "unknown"]).default("unknown"),
  sleeve: z.enum(["wrist", "over-hand", "short", "unknown"]).default("unknown"),
  contrast: z.enum(["low", "high", "unknown"]).default("unknown"),
  fabric: imageObservationSchema.optional(),
});
export type StyleObservation = z.infer<typeof observationSchema>;

const genres = {
  amekaji: ["ST26", "인디고 데님·워크 재킷으로 아메카지 조합을 권해요"],
  street: ["ST27", "여유 있는 하의에 그래픽이나 스니커즈 한 곳으로 스트릿 포인트를 주세요"],
  classic: ["ST28", "밝은 셔츠·회색 슬랙스·네이비 재킷으로 클래식 조합을 권해요"],
  minimal: ["ST29", "비슷한 톤의 무지 하의와 소재·길이 차이로 미니멀하게 묶어 보세요"],
  gorpcore: ["ST30", "셸이나 트레일화 한 곳에 차분한 하의를 연결해 보세요"],
  workwear: ["ST31", "워크 재킷·무지 이너·스트레이트 팬츠로 표면감을 살려 보세요"],
  sporty: ["ST32", "단순한 하의·스니커즈로 스포티하게 묶어 보세요"],
} as const;

export function styleAdvice(
  product: Product,
  preferences: StylePreferences & { readonly fitPreference: string | null },
  observation: StyleObservation | null,
) {
  const prefix = observation ? "착장상" : "상품 기준";
  const item = `${product.color_family} ${product.product_type}`;
  const preferredRelaxed = /오버|여유|루즈|relaxed|oversiz/i.test(preferences.fitPreference ?? "")
    || preferences.silhouetteGoal === "relaxed";
  const genre = preferences.genre ?? (/맨투맨|sweatshirt|후드|hoodie/i.test(product.product_type) ? "sporty" : "minimal");
  const [genreRule, genreAdvice] = genres[genre];
  let ruleId: string = genreRule;
  let advice = `${item} 코디는 ${genreAdvice}`;
  if (observation?.shoulderChest === "tight") {
    ruleId = "ST33";
    advice = `${item}의 상체가 당겨 보여 가슴 여유를 먼저 비교해 보세요`;
  } else if (preferences.upperBodyBuild !== "unspecified") {
    ruleId = "ST01";
    advice = `${item}은 ${observation?.shoulderChest === "relaxed" ? "현재 어깨·가슴 여유를 살리고" : "상체를 편하게 입으려면 어깨·가슴 여유를 남기고"} ${preferredRelaxed ? "선호한 루즈핏" : "레귤러·릴랙스드 핏"}을 비교하세요`;
  } else if (preferredRelaxed && observation?.sleeve === "over-hand") {
    ruleId = "ST08";
    advice = `${item}은 선호한 넉넉한 품을 유지하고 손을 덮는 소매 길이부터 비교해 보세요`;
  } else if (preferences.silhouetteGoal === "balanced" && observation?.topVolume === "oversized" && observation.bottomVolume === "slim") {
    ruleId = "ST06";
    advice = `${item}에 하의를 스트레이트로 바꾸면 원한 상하 볼륨 균형을 만들기 좋아요`;
  } else if (preferences.silhouetteGoal === "leg-line" && observation?.length === "long") {
    ruleId = "ST14";
    advice = `${item}의 긴 밑단을 넣거나 짧은 대안으로 허리선을 드러내 보세요`;
  }
  const ruleIds = [ruleId];
  if (preferences.genre && ruleId !== genreRule) {
    advice += `; ${genreAdvice}`;
    ruleIds.push(genreRule);
  }
  if (preferences.contrast) {
    advice += preferences.contrast === "low" ? "; 하의도 비슷한 밝기로" : "; 밝고 어두운 상하의 대비로";
    ruleIds.push("ST18");
  }
  if (preferences.occasion === "formal") {
    advice += "; 초대장의 복장 규정부터 확인하세요";
    ruleIds.push("ST34");
  }
  return { opinion: `${prefix} ${advice} [${ruleIds.join(", ")}]`, ruleIds, basis: observation ? "image-and-product" : "product" };
}
