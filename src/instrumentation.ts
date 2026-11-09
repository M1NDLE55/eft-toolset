export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.WARM_TARKOV_CACHE === "0") return;
  const { warmTarkovCache } = await import("@/app/lib/api/tarkov-server");
  void warmTarkovCache().catch(() => undefined);
}
