// img — proxy public des images Storage, sans en-tête X-Robots-Tag.
//
// Supabase Storage renvoie "x-robots-tag: none" sur toutes ses URLs publiques,
// ce qui interdit toute indexation dans Google Images. Cette fonction relaie le
// point d accès de TRANSFORMATION (render/image) et ne réémet jamais cet en-tête.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "https://uctaxgfqdoxtcidllyjv.supabase.co";
const BUCKET = "product-images";

// Liste blanche stricte : sans elle, la fonction devient un service gratuit de
// redimensionnement que n importe qui peut solliciter à la charge du projet.
const ALLOWED_WIDTHS = [400, 800, 1200];
const DEFAULT_WIDTH = 800;
const QUALITY = 70; // fixé côté fonction, non pilotable par l URL

// Caractères autorisés dans le chemin : ni backslash, ni deux-points, ni espace.
const SAFE_PATH = /^[A-Za-z0-9._/-]+$/;

function deny(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return deny(405, "Method not allowed");
  }

  const url = new URL(req.url);

  // 1. path est obligatoire
  let path = (url.searchParams.get("path") ?? "").trim();
  while (path.startsWith("/")) path = path.slice(1);

  if (!path) return deny(400, "Missing path");
  if (path.includes("..")) return deny(400, "Invalid path");
  if (!SAFE_PATH.test(path)) return deny(400, "Invalid path");

  // 2. w : uniquement 400 / 800 / 1200, sinon repli sur 800
  const requested = Number(url.searchParams.get("w"));
  const width = ALLOWED_WIDTHS.includes(requested) ? requested : DEFAULT_WIDTH;

  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const upstream = SUPABASE_URL + "/storage/v1/render/image/public/" + BUCKET + "/" +
    encoded + "?width=" + width + "&quality=" + QUALITY + "&resize=contain";

  let res: Response;
  try {
    res = await fetch(upstream);
  } catch (_e) {
    return deny(502, "Upstream unreachable");
  }

  // 7. propager le code réel renvoyé par Storage
  if (!res.ok) {
    let status = res.status;
    try {
      const payload = await res.json();
      const real = Number(payload?.statusCode);
      if (Number.isInteger(real) && real >= 400 && real <= 599) status = real;
    } catch (_e) {
      // corps non JSON : on garde le code HTTP amont
    }
    return deny(status, "Image unavailable");
  }

  const bytes = await res.arrayBuffer();

  // En-têtes construits de zéro : le X-Robots-Tag amont n est jamais recopié.
  const headers = new Headers();
  headers.set("Content-Type", res.headers.get("content-type") ?? "application/octet-stream");
  headers.set("Content-Length", String(bytes.byteLength));
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("Access-Control-Allow-Origin", "*");

  return new Response(req.method === "HEAD" ? null : bytes, { status: 200, headers });
});
