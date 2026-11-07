import { join, resolve, sep } from "node:path";
import { z } from "zod";
import { fabricAdvice, fabricSchema } from "./fabric";

export class FashionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FashionError";
  }
}

export const skuSchema = z.string().regex(/^[A-Z]+-[0-9]{3}$/).brand<"SKU">();
export type SKU = z.infer<typeof skuSchema>;
export const productSchema = z.object({
  product_id: skuSchema,
  label: z.string(),
  category: z.string(),
  color_family: z.string(),
  product_type: z.string(),
  age_group: z.enum(["adult", "kids"]),
  sample_unit_price_krw: z.number().int().nonnegative(),
  image: z.string(),
  fabric: fabricSchema.optional(),
});
export type Product = Readonly<z.infer<typeof productSchema>>;
export type Catalog = {
  readonly source: "F&F sample" | "own-design";
  readonly root: string;
  readonly asOf: string;
  readonly products: readonly Product[];
};

export function privateHome(): string {
  const home = process.env["FASHION_HOME"];
  if (!home) throw new FashionError("configuration", "FASHION_HOME을 지정하세요.");
  return resolve(home);
}

export function localAsset(root: string, relative: string): string {
  const target = resolve(root, relative);
  if (!target.startsWith(`${resolve(root)}${sep}`)) {
    throw new FashionError("asset_path", "에셋 경로가 지정 폴더 밖입니다.");
  }
  return target;
}

export async function loadCatalog(source: Catalog["source"]): Promise<Catalog> {
  const root =
    source === "F&F sample"
      ? join(privateHome(), "ff-data/package/participant-kit")
      : join(import.meta.dir, "../assets/own");
  const file =
    source === "F&F sample" ? join(root, "data/products.json") : join(root, "products.json");
  const products = z.array(productSchema).parse(await Bun.file(file).json());
  const asOf =
    source === "F&F sample"
      ? z.object({ as_of: z.string() }).parse(await Bun.file(join(root, "data/snapshot.json")).json()).as_of
      : "2026-11-07";
  return { source, root, products, asOf };
}

const searchAliases = [
  ["바람막이", "windbreaker", "windbreakers", "jacket", "jackets", "재킷", "자켓"],
  ["맨투맨", "sweatshirt", "sweatshirts"],
  ["후드", "후드티", "hoodie", "hoodies"],
  ["티셔츠", "tshirt", "tshirts", "티"],
  ["바지", "pants", "trousers"],
  ["니트", "knit", "knitwear"],
  ["패딩", "puffer"],
  ["엠엘비", "mlb"],
  ["디스커버리", "discovery"],
  ["에프앤에프", "f&f", "fnf"],
] as const;

function searchTokens(value: string): readonly string[] {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/t-shirts?/g, "tshirt")
    .replace(/f\s*&\s*f/g, "f&f")
    .split(/[^\p{L}\p{N}&-]+/u)
    .filter(Boolean)
    .map((token) => searchAliases.find((aliases) => aliases.some((alias) => alias === token))?.[0] ?? token);
}

export function searchCatalog(
  catalog: Catalog,
  input: { readonly budget: number; readonly category?: string; readonly item?: string },
) {
  const budget = z.number().finite().nonnegative().parse(input.budget);
  const categoryTokens = searchTokens(input.category ?? "");
  const itemTokens = searchTokens(input.item ?? "");
  const queryTokens = [...categoryTokens, ...itemTokens];
  const sourceRequested = queryTokens.includes("에프앤에프");
  const ffBrandRequested = queryTokens.some((token) =>
    ["에프앤에프", "엠엘비", "디스커버리"].includes(token),
  );
  // Provenance is a catalog property, not a label match or a fallback catalog.
  const sourceMatches = catalog.source === "F&F sample" || !ffBrandRequested;
  const adults = catalog.products.filter((p) => p.age_group === "adult");
  const indexed = adults.map((product) => ({
    product,
    types: searchTokens(`${product.category} ${product.product_type}`),
    tokens: searchTokens(
      `${product.product_id} ${product.label} ${product.category} ${product.product_type} ${product.color_family}`,
    ),
  }));
  const exact = indexed.filter(({ tokens, types }) =>
    sourceMatches &&
    categoryTokens.every((token) =>
      token === "에프앤에프" ? sourceMatches : types.includes(token),
    ) &&
    itemTokens.every((token) =>
      token === "에프앤에프" ? sourceMatches : tokens.includes(token),
    ),
  );
  const matches = exact
    .map(({ product }) => product)
    .filter((p) => p.sample_unit_price_krw <= budget)
    .toSorted((a, b) => a.sample_unit_price_krw - b.sample_unit_price_krw);
  const availability = matches.length
    ? "found"
    : exact.length
      ? "over_budget"
      : "not_in_catalog";
  const alternatives = matches.length || !sourceMatches
    ? []
    : indexed
      .filter(({ product }) => product.sample_unit_price_krw <= budget)
      .map(({ product, tokens, types }) => ({
        product,
        score: queryTokens.reduce(
          (score, token) => score + (types.includes(token) ? 4 : tokens.includes(token) ? 1 : 0),
          0,
        ),
      }))
      .toSorted((a, b) =>
        b.score - a.score || a.product.sample_unit_price_krw - b.product.sample_unit_price_krw,
      )
      .slice(0, 3)
      .map(({ product }) => product);
  const nextSteps = matches.length
    ? [
        { action: "select_candidate", label: "상품 선택" },
        { action: "change_item", label: "다른 상품 검색" },
        { action: "stop", label: "종료" },
      ]
    : [
        ...(alternatives.length ? [{ action: "view_alternatives", label: "가까운 대안 보기" }] : []),
        availability === "over_budget"
          ? {
              action: "adjust_budget",
              label: "예산 조정",
              minimumBudget: Math.min(...exact.map(({ product }) => product.sample_unit_price_krw)),
            }
          : { action: "change_item", label: sourceRequested ? "F&F 카탈로그·검색어 확인" : "검색어 변경" },
        { action: "stop", label: "종료" },
      ];
  return {
    summary: matches.length
      ? `예산 내 성인 일치 상품 ${matches.length}개입니다.`
      : `${availability === "over_budget"
          ? "이 카탈로그의 요청 상품은 예산을 초과합니다."
          : "요청 상품은 이 카탈로그에 없습니다."} ${alternatives.length
          ? `예산 내 가까운 성인 대안 ${alternatives.length}개입니다.`
          : "예산 내 성인 대안도 없습니다."}`,
    candidates: matches.slice(0, 3),
    alternatives,
    availability,
    nextSteps,
    source: catalog.source,
    asOf: catalog.asOf,
    status: matches.length ? "found" : "empty",
    budget,
    priceBasis: "sample_reference",
    finalTotalKnown: false,
    matchedCount: matches.length,
    notice:
      catalog.source === "F&F sample"
        ? "F&F 정적 샘플 참고가격입니다. 실제 판매가·할인·총 결제액이 아닙니다."
        : "자체 디자인 가상 상품입니다. 가격은 시연용 설정이며 판매·배송되지 않습니다.",
  };
}

export function findProduct(catalog: Catalog, sku: SKU): Product {
  const product = catalog.products.find((p) => p.product_id === sku);
  if (!product) throw new FashionError("unknown_sku", `상품을 찾지 못했습니다: ${sku}`);
  return product;
}

export function priceCard(catalog: Catalog, sku: SKU, budget?: number) {
  const product = findProduct(catalog, sku);
  const fabric = fabricAdvice({ fabric: product.fabric });
  return {
    summary: `${product.label} · 참고가격 ${product.sample_unit_price_krw.toLocaleString("ko-KR")}원`,
    image: localAsset(catalog.root, product.image),
    fabricOpinion: fabric.valueOpinion,
    fabricBasis: fabric.basis,
    fabricRuleIds: fabric.ruleIds,
    card: "price",
    source: catalog.source,
    asOf: catalog.asOf,
    product,
    referencePriceKrw: product.sample_unit_price_krw,
    shippingKrw: null,
    taxKrw: null,
    discountKrw: null,
    finalTotalKrw: null,
    approvalForRealPurchase: false,
    budgetRemainingOnReferenceOnly:
      budget === undefined ? null : budget - product.sample_unit_price_krw,
    alternatives: catalog.products
      .filter(
        (p) =>
          p.product_id !== sku &&
          p.age_group === product.age_group &&
          p.product_type === product.product_type,
      )
      .toSorted((a, b) => a.sample_unit_price_krw - b.sample_unit_price_krw)
      .slice(0, 2),
    unknowns: ["실제 판매가", "배송비", "세금", "쿠폰", "반품비", "가격 이력", "소재·내구성"],
    notice: "참고가격 비교만 가능합니다. 최저가·할인율·실제 총액을 주장하지 않습니다.",
    next: "가격 납득 / 대안 보기 / 판단 보류",
  };
}
