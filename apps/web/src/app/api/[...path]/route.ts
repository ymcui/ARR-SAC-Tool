import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const HOP_BY_HOP_REQUEST_HEADERS = new Set(["connection", "content-length", "host", "transfer-encoding"]);
const HOP_BY_HOP_RESPONSE_HEADERS = new Set(["connection", "content-encoding", "content-length", "transfer-encoding"]);
const API_PROXY_TIMEOUT_MS = 5 * 60 * 1000;

function apiOrigin(): string {
  const configured = process.env.ARR_SAC_API_ORIGIN?.trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }

  const host = process.env.ARR_SAC_API_HOST?.trim() || "127.0.0.1";
  const port = process.env.ARR_SAC_API_PORT?.trim() || "8001";
  return `http://${host}:${port}`;
}

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const target = new URL(`/api/${path.map(encodeURIComponent).join("/")}`, apiOrigin());
  target.search = request.nextUrl.search;

  const headers = new Headers(request.headers);
  for (const header of HOP_BY_HOP_REQUEST_HEADERS) {
    headers.delete(header);
  }

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(API_PROXY_TIMEOUT_MS)
    });
    const responseHeaders = new Headers(upstream.headers);
    for (const header of HOP_BY_HOP_RESPONSE_HEADERS) {
      responseHeaders.delete(header);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders
    });
  } catch {
    return Response.json(
      { detail: "Could not reach the local API service." },
      { status: 502 }
    );
  }
}

export const DELETE = proxy;
export const GET = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;
export const PATCH = proxy;
export const POST = proxy;
export const PUT = proxy;
