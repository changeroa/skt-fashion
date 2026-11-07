import { join, resolve, sep } from "node:path";
import { z } from "zod";

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

export function searchCatalog(
  catalog: Catalog,
  input: { readonly budget: number; readonly category?: string; readonly item?: string },
) {
  const budget = z.number().finite().nonnegative().parse(input.budget);
  const matches = catalog.products
    .filter(
      (p) =>
        p.age_group === "adult" &&
        p.sample_unit_price_krw <= budget &&
        (!input.category || p.category === input.category || p.product_type === input.category) &&
        (!input.item ||
          p.product_id === input.item ||
          p.label.includes(input.item) ||
          p.product_type.includes(input.item)),
    )
    .toSorted((a, b) => a.sample_unit_price_krw - b.sample_unit_price_krw);
  return {
    source: catalog.source,
    asOf: catalog.asOf,
    status: matches.length ? "found" : "empty",
    budget,
    priceBasis: "sample_reference",
    finalTotalKnown: false,
    matchedCount: matches.length,
    candidates: matches.slice(0, 3),
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
  return {
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
