import { z } from "zod";

const materialSchema = z.enum(["cotton", "polyester", "nylon", "wool", "other"]);
const drapeSchema = z.enum(["structured", "fluid"]);

export const fabricSchema = z.object({
  material: materialSchema.optional(),
  construction: z.enum([
    "fleece", "french-terry", "loopback", "jersey", "denim",
    "ripstop", "flannel", "knit", "woven",
  ]).optional(),
  gsm: z.number().positive().optional(),
  oz: z.number().positive().optional(),
  gauge: z.number().int().positive().optional(),
  gaugeUnit: z.enum(["needles-per-inch", "needles-per-1.5-inches"]).optional(),
  composition: z.array(z.object({
    fiber: materialSchema,
    percent: z.number().min(0).max(100),
  })).refine(
    (parts) => parts.reduce((sum, part) => sum + part.percent, 0) <= 100 + 1e-8
      && new Set(parts.map((part) => part.fiber)).size === parts.length,
    "Composition must have unique fibers totaling no more than 100%.",
  ).optional(),
  drape: drapeSchema.optional(),
  stretch: z.enum(["low", "high"]).optional(),
  breathability: z.enum(["low", "high"]).optional(),
});

export type Fabric = Readonly<z.infer<typeof fabricSchema>>;

export const imageObservationSchema = z.strictObject({
  verified: z.literal(true),
  drape: drapeSchema,
});

export type FabricAdviceInput = {
  readonly fabric?: Fabric | undefined;
  readonly imageObservation?: Readonly<z.infer<typeof imageObservationSchema>> | undefined;
  readonly length?: "cropped" | "regular" | "long" | "unknown" | undefined;
  readonly sleeveBreak?: "above-wrist" | "at-wrist" | "below-wrist" | "unknown" | undefined;
  readonly upperBodyBuild?: "muscular" | "broad" | "unspecified" | undefined;
};

export type FabricAdvice = {
  readonly opinion: string;
  readonly valueOpinion: string;
  readonly silhouetteOpinion: string;
  readonly basis: "product" | "image-estimate" | "unknown";
  readonly ruleIds: readonly string[];
};

const shapeByLength = {
  structured: {
    cropped: ["FA22", "짧고 가로가 살아 박시한 쪽, 허리선이 드러나 다리 비율을 강조할 수 있어요"],
    regular: ["FA23", "몸에서 떠 직선적인 쪽, 어깨·품 여유를 확인하세요"],
    long: ["FA24", "몸통 부피가 커 보이는 쪽, 엉덩이 덮임을 확인하세요"],
    unknown: ["FA20", "형태가 서는 쪽, 총장을 확인하면 비율을 고르기 쉬워요"],
  },
  fluid: {
    cropped: ["FA25", "짧게 흘러 허리·복부 선이 드러날 수 있어요"],
    regular: ["FA26", "몸선을 따라 자연스럽게 흐르는 쪽이에요"],
    long: ["FA27", "길게 흐르며 가슴·복부에 붙거나 밑단이 쌓일 수 있어요"],
    unknown: ["FA21", "유연하게 흐르는 쪽, 총장과 몸선 드러남을 확인하세요"],
  },
} as const;

// Parsed product metadata is authoritative; category names and images are not fiber evidence.
export function fabricAdvice(input: FabricAdviceInput): FabricAdvice {
  const fabric = input.fabric;
  const composition = fabric?.composition?.filter((part) => part.percent > 0) ?? [];
  const hasFiber = (fiber: z.infer<typeof materialSchema>): boolean =>
    composition.length > 0
      ? composition.some((part) => part.fiber === fiber)
      : fabric?.material === fiber;
  const gsm = fabric?.gsm ?? (fabric?.oz === undefined ? undefined : fabric.oz * 33.9057);
  // Local accumulators build the three card lines without mutating inputs.
  const opinions: string[] = [];
  const values: string[] = [];
  const ruleIds: string[] = [];
  const apply = (id: string, opinion: string, value: string): void => {
    ruleIds.push(id);
    opinions.push(opinion);
    values.push(value);
  };

  if (hasFiber("cotton") && hasFiber("polyester")) {
    apply("FA13", "면·폴리 혼방은 촉감과 건조·관리의 절충형이에요", "혼방률과 세탁 후 형태 유지를 함께 비교하세요");
  } else if (hasFiber("cotton")) {
    apply("FA01", "면은 부드러운 일상 착용에 좋고 젖으면 건조가 느린 편이에요", "혼용률과 세탁 후 치수·구김 관리를 비교하세요");
  }
  if (hasFiber("nylon")) {
    apply("FA07", "나일론은 건조·마찰 대응을 살필 소재예요", "통기성·방수 가공 사양을 따로 비교하세요");
  }
  if (hasFiber("wool")) {
    apply("FA09", "울은 습도 조절·구김 회복이 장점이며 세탁 라벨을 따라 관리하세요", "울 함량과 관리 비용을 함께 비교하세요");
  }
  if (hasFiber("polyester") && !hasFiber("cotton")) {
    apply("FA37", "폴리에스터는 빠른 건조를 살필 소재이며 통기성은 조직에 따라 달라요", "섬유 이름보다 조직·가공 사양을 비교하세요");
  }

  const construction = fabric?.construction;
  switch (construction) {
    case "fleece":
      apply("FA02", "기모 조직은 포근해 서늘한 계절 레이어에 맞는 쪽이에요", "기모 마감과 세탁 후 형태를 비교하세요");
      break;
    case "french-terry":
    case "loopback":
      apply("FA03", "비기모 루프 조직은 부드러운 간절기 레이어에 맞는 쪽이에요", "루프 마감과 중량을 같은 조직끼리 비교하세요");
      break;
    case "denim": {
      const oz = fabric?.oz ?? (gsm === undefined ? undefined : gsm / 33.9057);
      if (oz !== undefined) {
        if (oz < 12) {
          apply("FA04", "가벼운 데님 쪽이라 움직임·따뜻한 계절 착용을 살펴볼 만해요", "가벼운 온스가 저품질이라는 뜻은 아니에요");
        } else if (oz <= 16) {
          apply("FA05", "중간 중량 데님으로 일상 착용과 형태감의 균형을 살펴보세요", "같은 온스대의 가공·봉제를 비교하세요");
        } else {
          apply("FA06", "묵직한 데님 쪽이라 길들이기와 활동성을 확인하세요", "높은 온스만으로 가격 프리미엄을 인정하진 마세요");
        }
      } else {
        apply("FA41", "데님은 온스와 신축을 함께 확인하면 착용감을 고르기 쉬워요", "온스·가공·봉제를 같은 용도 제품과 비교하세요");
      }
      break;
    }
    case "ripstop":
      apply("FA08", "립스톱은 찢김 확산 억제를 노린 보강 조직이에요", "립스톱 이름보다 보강·코팅 사양을 비교하세요");
      break;
    case "flannel":
      apply("FA10", "플란넬의 기모 표면은 부드러운 촉감 쪽이에요", "섬유 함량과 워셔블 가공 여부를 확인하세요");
      break;
    case "knit": {
      const gauge = fabric?.gaugeUnit === undefined || fabric.gauge === undefined
        ? undefined
        : fabric.gauge / (fabric.gaugeUnit === "needles-per-1.5-inches" ? 1.5 : 1);
      if (gauge !== undefined && gauge <= 7) {
        apply("FA11", "낮은 게이지의 굵은 조직은 시각적 볼륨이 있는 쪽이에요", "굵기보다 원사·조직·마감을 함께 비교하세요");
      } else if (gauge !== undefined && gauge >= 12) {
        apply("FA12", "높은 게이지의 고운 조직은 레이어링 후보예요", "고게이지만으로 고급 여부를 정하진 마세요");
      } else {
        apply("FA40", "니트는 조직·원사 굵기에 따라 부피와 착용감이 달라요", "게이지 단위와 원사·마감을 함께 비교하세요");
      }
      break;
    }
    case "jersey":
      apply("FA38", "저지의 움직임과 몸선 드러남은 두께·핏에 따라 달라요", "중량·신축과 세탁 후 형태를 비교하세요");
      break;
    case "woven":
      apply("FA39", "직물은 조직과 실측 여유를 함께 확인하세요", "조직 밀도·마감과 관리 방법을 비교하세요");
      break;
    case undefined:
      break;
    default:
      construction satisfies never;
  }

  if (fabric?.construction !== "denim" && gsm !== undefined) {
    if (gsm <= 180) {
      apply("FA14", "같은 조직 안에서는 가벼운 중량 쪽이에요", "가벼움보다 용도와 마감을 기준으로 비교하세요");
    } else if (gsm < 350) {
      apply("FA15", "같은 조직 안에서는 중간 중량으로 레이어링 후보예요", "중량이 비슷한 제품의 마감을 비교하세요");
    } else {
      apply("FA16", "같은 조직 안에서는 묵직해 부피와 실내 착용을 살펴보세요", "높은 GSM만으로 고급·내구성을 판단하진 마세요");
    }
  }

  let drape = fabric?.drape;
  if (drape === undefined && gsm !== undefined) {
    if (gsm >= 350 && ["fleece", "french-terry", "loopback"].includes(fabric?.construction ?? "")) {
      drape = "structured";
    } else if (gsm <= 180 && fabric?.construction === "jersey") {
      drape = "fluid";
    }
  }
  const productEvidence = opinions.length > 0 || drape !== undefined
    || fabric?.stretch !== undefined || fabric?.breathability !== undefined;
  const image = !productEvidence && input.imageObservation?.verified === true
    ? input.imageObservation : undefined;
  const basis = productEvidence ? "product" : image ? "image-estimate" : "unknown";
  if (basis === "unknown") {
    return {
      opinion: "혼용률이나 소재표를 확인하면 계절·관리 방법을 고를 수 있어요.",
      valueOpinion: "소재표를 확인해 같은 조직 제품과 가격을 비교하세요.",
      silhouetteOpinion: "총장·소매 실측과 원단 떨어짐을 확인하세요.",
      basis,
      ruleIds: ["FA17"],
    };
  }
  const prefix = image ? "사진 추정: " : "";
  if (image) {
    drape = image.drape;
    ruleIds.push("FA18");
  }
  const silhouette: string[] = [];
  if (drape) {
    const drapeId = drape === "structured" ? "FA20" : "FA21";
    ruleIds.push(drapeId);
    const [lengthId, text] = shapeByLength[drape][input.length ?? "unknown"];
    ruleIds.push(lengthId);
    silhouette.push(text);
  } else {
    ruleIds.push("FA19");
    silhouette.push("총장과 원단 떨어짐을 확인하면 실루엣을 고르기 쉬워요");
  }
  switch (input.upperBodyBuild) {
    case "muscular":
      ruleIds.push("FA28");
      silhouette.push("가슴·상완 여유를 확인하세요");
      break;
    case "broad":
      ruleIds.push("FA29");
      silhouette.push("어깨선·가슴 여유를 확인하세요");
      break;
    case "unspecified":
    case undefined:
      break;
    default:
      input.upperBodyBuild satisfies never;
  }
  switch (input.sleeveBreak) {
    case "above-wrist":
      ruleIds.push("FA30");
      silhouette.push("손목이 드러나 끝선이 가벼운 쪽이에요");
      break;
    case "at-wrist":
      ruleIds.push("FA31");
      silhouette.push("소매가 손목에서 정돈되는 쪽이에요");
      break;
    case "below-wrist":
      ruleIds.push("FA32");
      silhouette.push("손등 덮임·소매 주름으로 볼륨이 더해질 수 있어요");
      break;
    case "unknown":
    case undefined:
      break;
    default:
      input.sleeveBreak satisfies never;
  }
  if (fabric?.stretch !== undefined) {
    ruleIds.push(fabric.stretch === "high" ? "FA33" : "FA34");
    silhouette.push(fabric.stretch === "high" ? "신축성이 움직임 여유에 유리한 쪽이에요" : "신축이 적어 실측 여유가 중요해요");
  }
  if (fabric?.breathability !== undefined) {
    ruleIds.push(fabric.breathability === "high" ? "FA35" : "FA36");
    silhouette.push(fabric.breathability === "high" ? "열·습기 배출에 유리한 쪽이에요" : "더운 실내 답답함을 확인하세요");
  }
  return {
    opinion: prefix + (opinions.join("; ") || (drape === "structured" ? "형태가 서는 원단 쪽이에요" : drape === "fluid" ? "유연하게 흐르는 원단 쪽이에요" : "착용 특성은 실루엣·착용감 항목에서 확인하세요")),
    valueOpinion: image
      ? "소재표를 확인해 같은 조직 제품과 가격을 비교하세요."
      : values.join("; ") || "소재·가공 사양을 같은 용도 제품과 비교하세요.",
    silhouetteOpinion: prefix + silhouette.join("; "),
    basis,
    ruleIds: [...new Set(ruleIds)],
  };
}
