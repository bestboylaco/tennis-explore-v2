import express from "express";
import fs from "node:fs";
import path from "node:path";

import asyncHandler from "../../middleware/asyncHandler.js";
import { grantsForRole, isPermitted } from "../../shared/constants/accessControl.js";
import { loadIndex } from "../retrieval/retrieval.service.js";
import { buildAssetRegistry } from "../retrieval/assetLink.service.js";

const router = express.Router();

// the registry is derived from the index, so it can never drift from what was
// actually ingested: if a citation points at it, this can serve it, and nothing
// else is reachable.
let registry = null;

async function getRegistry() {
  if (!registry) {
    const index = await loadIndex();
    registry = buildAssetRegistry(index.store.chunks);
  }

  return registry;
}

/**
 * GET /api/assets/:docId
 *
 * Serves the original file behind a citation so the frontend can open it in a
 * side panel at the cited page, slide or timestamp.
 *
 * The access check is repeated here and that is deliberate, not redundant.
 * Retrieval already filtered what the caller could see -- but this endpoint is
 * reachable directly with any docId, and "the UI only shows links they are
 * allowed to click" is not access control. Anyone can type a URL.
 */
router.get(
  "/:docId",
  asyncHandler(async (req, res) => {
    const assets = await getRegistry();
    const asset = assets.get(req.params.docId);

    if (!asset) {
      return res.status(404).json({
        success: false,
        error: { code: "ASSET_NOT_FOUND", message: "No indexed asset with that id." },
      });
    }

    // in a real deployment the role comes off the authenticated session. taking
    // it from a query parameter is fine for the local demo and must not survive
    // into anything the partner can reach -- a caller who picks their own role
    // is a caller with every role.
    const roleId = req.query.role ?? "analyst";

    let grants;

    try {
      grants = grantsForRole(roleId);
    } catch {
      return res.status(400).json({
        success: false,
        error: { code: "UNKNOWN_ROLE", message: `Unknown role "${roleId}".` },
      });
    }

    if (!isPermitted(asset.aclGroups, grants)) {
      // 403 rather than 404. the caller already knows the document exists --
      // they got here from a citation -- so hiding its existence achieves
      // nothing and a clear "you may not open this" is more useful.
      return res.status(403).json({
        success: false,
        error: {
          code: "ASSET_FORBIDDEN",
          message: `The role "${roleId}" may not open this ${asset.sensitivity} document.`,
        },
      });
    }

    if (!fs.existsSync(asset.path)) {
      // the index is committed but the raw files are not, so a teammate who
      // pulled the repo has citations pointing at files they do not have. that
      // is expected, and saying so plainly is better than a stack trace.
      return res.status(410).json({
        success: false,
        error: {
          code: "ASSET_NOT_LOCAL",
          message:
            "This asset was indexed on another machine and its source file is not present here. " +
            "The citation text and metadata are still available; ask the person who built the index for the file.",
          title: asset.title,
        },
      });
    }

    return res.sendFile(path.resolve(asset.path));
  }),
);

export default router;
