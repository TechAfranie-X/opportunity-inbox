import { readAsset } from "@/lib/brand/cache";

/** Serves one cached first-party brand asset (a company's own published icon, fetched once and stored locally). Read-only; never triggers a fetch. */
export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const data = readAsset(file);
  if (!data) return new Response("Not found", { status: 404 });
  const svg = file.endsWith(".svg");
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": svg ? "image/svg+xml" : "image/png",
      "cache-control": "public, max-age=86400",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
