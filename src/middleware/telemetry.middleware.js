import {
  QUERY_CLASSES,
  RUN_STATUSES,
  TELEMETRY_RUN_TYPES,
} from "../shared/constants/telemetry.js";
import { startTelemetryRun } from "../modules/telemetry/services/telemetryRecorder.service.js";
import { telemetryConfig } from "../modules/telemetry/telemetry.config.js";

// Health checks and telemetry reads are excluded: they are polled, and
// recording them would bury real runs in noise.
const EXCLUDED_PREFIXES = ["/api/health", "/api/telemetry"];

function isExcluded(path) {
  return EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

// Records one telemetry record per API request, so the part of the system that
// exists in Sprint 1 does not run unrecorded.
export function telemetryMiddleware(req, res, next) {
  if (!telemetryConfig.enabled || !telemetryConfig.httpEnabled || isExcluded(req.path)) {
    return next();
  }

  const run = startTelemetryRun({
    runType: TELEMETRY_RUN_TYPES.API_REQUEST,
    queryClass: QUERY_CLASSES.NOT_APPLICABLE,
    http: { method: req.method, route: req.path },
  });

  // Downstream handlers can attach stages to the request's run.
  req.telemetry = run;

  res.on("finish", () => {
    run.setHttp({
      // req.route is only populated once a route has matched.
      route: req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path,
      statusCode: res.statusCode,
    });

    const status =
      res.statusCode >= 500 ? RUN_STATUSES.FAILED : RUN_STATUSES.SUCCESS;

    void run.finish(status);
  });

  return next();
}
