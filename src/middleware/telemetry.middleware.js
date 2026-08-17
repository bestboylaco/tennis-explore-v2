import {
  QUERY_CLASSES,
  RUN_STATUSES,
  TELEMETRY_RUN_TYPES,
} from "../shared/constants/telemetry.js";
import {
  createNoopTelemetryRun,
  startTelemetryRun,
} from "../modules/telemetry/services/telemetryRecorder.service.js";
import { telemetryConfig } from "../modules/telemetry/telemetry.config.js";

// Health checks and telemetry reads are excluded: they are polled, and
// recording them would bury real runs in noise.
const EXCLUDED_PREFIXES = ["/api/health", "/api/telemetry"];

function isExcluded(path) {
  return EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

// The route pattern this request matched, e.g. /api/sources/:sourceId/ingest.
//
// req.baseUrl cannot be used here. As an error unwinds out of a sub-router
// towards the app level error handler, Express restores baseUrl to "" while
// req.route survives, and this runs on finish/close — after that unwind. So
// `${req.baseUrl}${req.route.path}` yielded the full pattern for a request
// that succeeded and a prefix-less one for the same endpoint when it failed,
// splitting a single route into two keys exactly along the success/failure
// line. Error rate per route was then wrong in both directions.
//
// req.route.path always matches the tail of the request, so whatever precedes
// that tail is the mount prefix — recoverable by segment count, at any router
// depth, without depending on state Express has already torn down.
export function resolveRoute(req) {
  const requestPath = (req.originalUrl || "").split("?")[0];
  const routePath = req.route?.path;

  // No route matched (a 404), or the path is an array/RegExp rather than a
  // string. Nothing to reconstruct, so report the concrete path.
  if (typeof routePath !== "string") {
    return requestPath;
  }

  const requestSegments = requestPath.split("/").filter(Boolean);
  const routeSegments = routePath.split("/").filter(Boolean);

  const prefix = requestSegments
    .slice(0, Math.max(0, requestSegments.length - routeSegments.length))
    .map((segment) => `/${segment}`)
    .join("");

  return `${prefix}${routePath}`;
}

// Records one telemetry record per API request, so the part of the system that
// exists in Sprint 1 does not run unrecorded.
export function telemetryMiddleware(req, res, next) {
  if (!telemetryConfig.enabled || !telemetryConfig.httpEnabled || isExcluded(req.path)) {
    // Downstream handlers can attach stages to req.telemetry unconditionally,
    // so it is always present. Switching telemetry off must not break routes.
    req.telemetry = createNoopTelemetryRun();

    return next();
  }

  const run = startTelemetryRun({
    runType: TELEMETRY_RUN_TYPES.API_REQUEST,
    queryClass: QUERY_CLASSES.NOT_APPLICABLE,
    http: { method: req.method, route: req.path },
  });

  req.telemetry = run;

  // "close" also fires when the client goes away mid-response, which "finish"
  // never does. Both are wired so an abandoned request still leaves a record;
  // finish() ignores the second call.
  let settled = false;

  function completeRun() {
    if (settled) {
      return;
    }

    settled = true;

    // An aborted response never produced a meaningful status code, so it is
    // left null rather than reported as whatever was staged on the response.
    const aborted = !res.writableEnded;

    run.setHttp({
      route: resolveRoute(req),
      statusCode: aborted ? null : res.statusCode,
    });

    let status;

    if (aborted) {
      run.note("clientAborted", true);
      status = RUN_STATUSES.PARTIAL;
    } else if (res.statusCode >= 500) {
      status = RUN_STATUSES.FAILED;
    } else {
      status = RUN_STATUSES.SUCCESS;
    }

    // Telemetry must never surface as an unhandled rejection on the process.
    run.finish(status).catch((error) => {
      console.warn(`Telemetry finish failed (${run.recordId}):`, error.message);
    });
  }

  res.on("finish", completeRun);
  res.on("close", completeRun);

  return next();
}
