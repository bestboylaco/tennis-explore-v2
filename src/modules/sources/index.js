import sourcesRouter from "./routes/source.routes.js";

export {
  createSource,
  getAllSources,
  getSourceById,
} from "./services/source.service.js";

export default sourcesRouter;