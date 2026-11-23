// eft-toolset.com → https://www.eft-toolset.com, keeping the path and query, as Vercel did (308).
// A separate Worker because the site's Worker serves static assets before its code runs, so it
// can't redirect the apex for prerendered pages and files.
export default {
  fetch(request: Request): Response {
    const url = new URL(request.url);
    return new Response(null, {
      status: 308,
      headers: { Location: `https://www.eft-toolset.com${url.pathname}${url.search}`, "Cache-Control": "public, max-age=3600" },
    });
  },
};
