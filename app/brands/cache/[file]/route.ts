import { auth } from "@/auth";
import { readAsset } from "@/lib/brand/cache";

/**
 * Serves one cached first-party brand asset (a company's own published icon, fetched once and stored locally). Read-only; never triggers a fetch.
 * Signed-in users only: the cache is shared on an install and the existence of a file would otherwise reveal that someone there has applied to that company.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const session = await auth();
  if (!session?.user) return new Response("Not found", { status: 404 });
  const { file } = await ctx.params;
  const data = readAsset(file);
  if (!data) return new Response("Not found", { status: 404 });
  const svg = file.endsWith(".svg");
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": svg ? "image/svg+xml" : "image/png",
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
