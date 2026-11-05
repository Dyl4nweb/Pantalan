import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const COUNT_API_BASE = "https://countapi.mileshilliard.com/api/v1";
const UNIQUE_KEY = "pantalan_dylan_unique_visitors_prod";
const TOTAL_KEY = "pantalan_dylan_total_views_prod";

async function fetchCount(endpoint: "hit" | "get", key: string): Promise<number | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const res = await fetch(`${COUNT_API_BASE}/${endpoint}/${key}`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as { value?: number };
    return typeof data.value === "number" ? data.value : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const requestedUnique = url.searchParams.get("unique") === "1";
  const hasVisitedCookie = req.cookies.has("pantalan_visited");

  const isActuallyNew = requestedUnique && !hasVisitedCookie;

  // Track or read unique visitors
  const uniquePromise = isActuallyNew
    ? fetchCount("hit", UNIQUE_KEY)
    : fetchCount("get", UNIQUE_KEY);

  // Track total views on every page load
  const totalPromise = fetchCount("hit", TOTAL_KEY);

  const [uniqueRes, totalRes] = await Promise.all([uniquePromise, totalPromise]);

  // Graceful fallback counts if network/service has momentary hiccup
  const uniqueVisitors = uniqueRes ?? 1;
  const totalViews = totalRes ?? Math.max(uniqueVisitors, 1);

  const response = NextResponse.json({
    uniqueVisitors,
    totalViews,
    isNewVisitor: isActuallyNew,
  });

  // Set long-lived 1-year cookie so repeat visits within 1 year are not double-counted as unique
  if (isActuallyNew) {
    response.cookies.set({
      name: "pantalan_visited",
      value: "1",
      maxAge: 60 * 60 * 24 * 365, // 1 year
      path: "/",
      sameSite: "lax",
      httpOnly: false,
    });
  }

  return response;
}

