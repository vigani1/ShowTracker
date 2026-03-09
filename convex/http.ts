import { httpRouter } from "convex/server";
import { httpAction } from "@/convex/_generated/server";
import { auth } from "@/convex/auth";

const http = httpRouter();

const anilistUrl =
  process.env.EXPO_PUBLIC_ANILIST_URL ?? "https://graphql.anilist.co";
const anilistProxyBaseDelayMs = 750;
const anilistProxyMaxAttempts = 4;
const allowLocalhostOrigins = process.env.ALLOW_LOCALHOST_ORIGINS === "true";

const configuredWebOrigins = [
  process.env.SHOWTRACKER_WEB_ORIGINS,
  process.env.WEB_APP_ORIGINS,
]
  .flatMap((value) => value?.split(",") ?? [])
  .map((value) => value.trim())
  .filter(Boolean);

const corsBaseHeaders = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  Vary: "Origin",
};

function createAbortError() {
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

async function waitWithAbort(ms: number, signal: AbortSignal) {
  if (signal.aborted) {
    throw createAbortError();
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeoutId);
      reject(createAbortError());
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function isLocalDevOrigin(origin: string) {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }

    return (
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

function getCorsHeaders(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) {
    return null;
  }

  const isAllowedOrigin =
    configuredWebOrigins.includes(origin) ||
    (allowLocalhostOrigins && isLocalDevOrigin(origin));

  if (!isAllowedOrigin) {
    return null;
  }

  const headers = new Headers(corsBaseHeaders);
  headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

auth.addHttpRoutes(http);

http.route({
  path: "/anilist",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, request) => {
    const corsHeaders = getCorsHeaders(request);
    if (!corsHeaders) {
      return Response.json(
        { error: "Origin not allowed." },
        {
          status: 403,
          headers: corsBaseHeaders,
        }
      );
    }

    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }),
});

http.route({
  path: "/anilist",
  method: "POST",
  handler: httpAction(async (_ctx, request) => {
    const corsHeaders = getCorsHeaders(request);
    if (!corsHeaders) {
      return Response.json(
        { error: "Origin not allowed." },
        {
          status: 403,
          headers: corsBaseHeaders,
        }
      );
    }

    try {
      const body = await request.json();
      if (!body || typeof body !== "object" || typeof body.query !== "string") {
        return Response.json(
          { error: "Invalid AniList payload." },
          {
            status: 400,
            headers: corsHeaders,
          }
        );
      }

      const payload = JSON.stringify({
        query: body.query,
        variables:
          body.variables && typeof body.variables === "object"
            ? body.variables
            : {},
      });

      for (let attempt = 1; attempt <= anilistProxyMaxAttempts; attempt += 1) {
        const upstream = await fetch(anilistUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: payload,
          signal: request.signal,
        });

        if (upstream.status !== 429 || attempt === anilistProxyMaxAttempts) {
          const headers = new Headers(corsHeaders);
          headers.set(
            "Content-Type",
            upstream.headers.get("content-type") ?? "application/json"
          );

          const retryAfter = upstream.headers.get("retry-after");
          if (retryAfter) {
            headers.set("Retry-After", retryAfter);
          }

          return new Response(await upstream.text(), {
            status: upstream.status,
            headers,
          });
        }

        const retryAfter = upstream.headers.get("retry-after");
        const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : NaN;
        const delayMs = Number.isFinite(retryAfterMs)
          ? retryAfterMs
          : anilistProxyBaseDelayMs * 2 ** (attempt - 1);
        await waitWithAbort(delayMs, request.signal);
      }

      return Response.json(
        { error: "AniList proxy request failed." },
        {
          status: 500,
          headers: new Headers(corsHeaders),
        }
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return new Response(null, {
          status: 499,
          headers: new Headers(corsHeaders),
        });
      }
      console.error("AniList proxy failed", error);
      return Response.json(
        { error: "AniList proxy request failed." },
        {
          status: 500,
          headers: corsHeaders,
        }
      );
    }
  }),
});

export default http;
