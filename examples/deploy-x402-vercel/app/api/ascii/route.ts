import { withX402Protection } from "../../../lib/x402-handler.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ASCII_ARTS: Record<string, string> = {
  cat: `
 /\\_/\\ 
( o.o )
 > ^ < 
`,
  owl: `
 (\\_/)
 (o.o)
 (">")
`,
  robot: `
  [o_o]
  /|_|\\
  /   \\
`,
  rocket: `
   /\\  
  /  \\ 
 |  || 
 |  || 
 /====\\
  //\\\\ 
`,
};

export const GET = withX402Protection(
  {
    priceUsdc: "$0.01",
    description: "Paid ASCII Art Generator Endpoint",
    resource: "/api/ascii",
  },
  async (req: Request) => {
    const url = new URL(req.url);
    const style = url.searchParams.get("style") || "cat";
    const art = ASCII_ARTS[style] || ASCII_ARTS["cat"];

    return Response.json({
      ok: true,
      service: "x402 ASCII Art Generator",
      style,
      art,
      timestamp: new Date().toISOString(),
    });
  }
);
