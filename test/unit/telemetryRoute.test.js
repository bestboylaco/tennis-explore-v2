import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveRoute } from "../../src/middleware/telemetry.middleware.js";

// resolveRoute reconstructs the mount prefix from originalUrl rather than
// reading req.baseUrl, which Express has already reset by the time the
// response finishes on an error path. These cases cover the reconstruction;
// the integration suite covers the Express lifecycle that made it necessary.

function req(originalUrl, routePath) {
  return {
    originalUrl,
    route: routePath === undefined ? undefined : { path: routePath },
  };
}

test("recovers the mount prefix for a nested route", () => {
  assert.equal(
    resolveRoute(req("/api/sources/6a717cfb6b9fed5077d21ef8/ingest", "/:sourceId/ingest")),
    "/api/sources/:sourceId/ingest",
  );
});

test("produces the same pattern whether or not the request succeeded", () => {
  // The defect was that these two diverged: a failed request recorded
  // /:sourceId/ingest and a successful one /api/sources/:sourceId/ingest.
  const succeeded = resolveRoute(
    req("/api/sources/6a717cfb6b9fed5077d21ef8/ingest", "/:sourceId/ingest"),
  );
  const failed = resolveRoute(
    req("/api/sources/000000000000000000000000/ingest", "/:sourceId/ingest"),
  );

  assert.equal(succeeded, failed);
});

test("handles a router root route", () => {
  assert.equal(resolveRoute(req("/api/sources", "/")), "/api/sources/");
  assert.equal(resolveRoute(req("/api/sources/", "/")), "/api/sources/");
});

test("handles a single parameter route", () => {
  assert.equal(
    resolveRoute(req("/api/sources/6a717cfb6b9fed5077d21ef8", "/:sourceId")),
    "/api/sources/:sourceId",
  );
});

test("strips the query string", () => {
  assert.equal(
    resolveRoute(req("/api/sources?limit=5&from=2026-01-01", "/")),
    "/api/sources/",
  );
});

test("falls back to the concrete path when no route matched", () => {
  // A 404 never populates req.route, so there is no pattern to report.
  assert.equal(resolveRoute(req("/api/not-real", undefined)), "/api/not-real");
  assert.equal(resolveRoute(req("/api/not-real?x=1", undefined)), "/api/not-real");
});

test("falls back when the route path is not a string", () => {
  // router.get(["/a", "/b"]) gives an array, and a RegExp route gives neither.
  assert.equal(resolveRoute(req("/a", ["/a", "/b"])), "/a");
  assert.equal(resolveRoute(req("/a", /x/)), "/a");
});

test("does not invent a prefix when the route is longer than the request", () => {
  // Optional parameters can match fewer segments than the pattern declares.
  assert.equal(resolveRoute(req("/x", "/:a?/:b?")), "/:a?/:b?");
});

test("works at any router depth", () => {
  assert.equal(
    resolveRoute(req("/api/v2/admin/sources/42/audit", "/:id/audit")),
    "/api/v2/admin/sources/:id/audit",
  );
});
