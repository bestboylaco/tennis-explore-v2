import {
  env,
} from "../../config/env.js";

import {
  bootstrapStatisticsProviders,
} from "./statisticsBootstrap.js";

import {
  developmentStatisticsProvider,
} from "./providers/developmentStatisticsProvider.js";


export function initializeStatistics() {
  const providers = [];


  // Synthetic development data must never
  // be registered in production.
  if (
    env.nodeEnv !== "production"
  ) {
    providers.push(
      developmentStatisticsProvider
    );
  }


  return bootstrapStatisticsProviders({
    providers,
  });
}