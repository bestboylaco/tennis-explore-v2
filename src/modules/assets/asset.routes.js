import express from "express";
import fs from "node:fs";
import path from "node:path";

import asyncHandler from "../../middleware/asyncHandler.js";
import { env } from "../../config/env.js";
import { grantsForRole, isPermitted } from "../../shared/constants/accessControl.js";
import { loadIndex } from "../retrieval/retrieval.service.js";
import { buildAssetRegistry } from "../retrieval/assetLink.service.js";
import { getObject, objectExists } from "../../infrastructure/storage/storage.service.js";
import { toStorageKey } from "../../infrastructure/storage/storageKey.service.js";
import { getTables } from "../structured/tableStore.service.js";

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
 * Structured/table answers cite a table by its docId (e.g.
 * "utr-international-2026-01-07"), but that docId never went through
 * indexBuilder.service.js -- tableStore.service.js reads the CSV directly for
 * every query and never turns it into a chunk. So it can never appear in the
 * chunk-derived registry above, and this endpoint 404'd on every table
 * citation regardless of storage provider. Falling back to the live table
 * list gives it the same (path, aclGroups, sensitivity) shape a chunk-backed
 * asset has, so everything below -- the permission check and the S3/local
 * branch -- treats it identically.
 */
async function findStructuredAsset(docId) {
  const tables = await getTables();
  const table = tables.find((entry) => entry.name === docId);

  if (!table) return null;

  return {
    docId: table.name,
    title: table.title,
    path: table.sourceUri,
    sensitivity: table.classification.sensitivity,
    aclGroups: table.aclGroups,
  };
}

/**
 * Shared by both the HEAD and GET handlers below: finds the asset and checks
 * whether the caller's role may open it. Returns either { asset } or
 * { errorStatus, errorBody } so both routes can react to a miss the same way
 * without duplicating the lookup or the permission logic.
 */
async function resolveAsset(docId, roleId) {
  const assets = await getRegistry();
  const asset = assets.get(docId) ?? (await findStructuredAsset(docId));

  if (!asset) {
    return {
      errorStatus: 404,
      errorBody: { success: false, error: { code: "ASSET_NOT_FOUND", message: "No indexed asset with that id." } },
    };
  }

  // the role comes off the authenticated session (requireAuth populates
  // req.user), never a caller-supplied value -- a caller who picks their
  // own role is a caller with every role (threat model T-01). This used to
  // read req.query.role, which meant anyone could open any document by
  // appending ?role=admin to a citation URL, logged in or not.
  const grants = grantsForRole(roleId);

  if (!isPermitted(asset.aclGroups, grants)) {
    // 403 rather than 404. the caller already knows the document exists --
    // they got here from a citation -- so hiding its existence achieves
    // nothing and a clear "you may not open this" is more useful.
    return {
      errorStatus: 403,
      errorBody: {
        success: false,
        error: {
          code: "ASSET_FORBIDDEN",
          message: `The role "${roleId}" may not open this ${asset.sensitivity} document.`,
        },
      },
    };
  }

  return { asset };
}

/**
 * HEAD /api/assets/:docId
 *
 * Same lookup and permission check as the GET below, but answers with only
 * the X-Asset-Storage / X-Asset-S3-Key headers -- no body. Exists so the
 * frontend can show "this citation is served from S3" the moment the source
 * panel opens, without downloading the file just to read a header off it (a
 * plain GET here would pull the whole object, table CSVs included, just to
 * throw the body away). S3 mode answers from a HeadObjectCommand
 * (objectExists), not a real download; local mode answers from fs.statSync.
 */
router.head(
  "/:docId",
  asyncHandler(async (req, res) => {
    const { asset, errorStatus } = await resolveAsset(req.params.docId, req.user.roleId);

    if (errorStatus) return res.status(errorStatus).end();

    if (env.storage.provider === "s3") {
      const key = toStorageKey(asset.path, env.storage.assetSourceRoot);
      const exists = await objectExists(key);

      res.set("X-Asset-Storage", "s3");
      res.set("X-Asset-S3-Key", key);

      return res.status(exists ? 200 : 410).end();
    }

    res.set("X-Asset-Storage", "local");

    return res.status(fs.existsSync(asset.path) ? 200 : 410).end();
  }),
);

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
    const { asset, errorStatus, errorBody } = await resolveAsset(req.params.docId, req.user.roleId);

    if (errorStatus) return res.status(errorStatus).json(errorBody);

    if (env.storage.provider === "s3") {
      return serveFromS3(asset, req, res);
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

    // exposed so it is visible in devtools/curl which branch actually served
    // the file -- otherwise "is this coming from S3?" is unanswerable without
    // reading server logs or source.
    res.set("X-Asset-Storage", "local");

    // express's sendFile already honours a Range header on its own, which is
    // what lets a video citation seek straight to its cited timestamp instead
    // of downloading from the start.
    return res.sendFile(path.resolve(asset.path));
  }),
);

/**
 * S3-mode counterpart to the local branch above. asset.path still holds the
 * local path recorded by the current index -- toStorageKey derives the S3
 * key the same file would use once uploaded, so this works against today's
 * index with no rebuild. Once ingestion writes sourceUri as an S3 key
 * directly, this can read asset.path as the key verbatim instead.
 */
async function serveFromS3(asset, req, res) {
  const key = toStorageKey(asset.path, env.storage.assetSourceRoot);

  if (!(await objectExists(key))) {
    // same situation as ASSET_NOT_LOCAL above, one bucket over: the index
    // knows about this file but nothing has uploaded it (yet).
    return res.status(410).json({
      success: false,
      error: {
        code: "ASSET_NOT_IN_BUCKET",
        message:
          "This asset was indexed but has not been uploaded to the configured S3 bucket. " +
          "The citation text and metadata are still available.",
        title: asset.title,
      },
    });
  }

  const range = req.headers.range || undefined;
  const object = await getObject(key, { range });

  res.status(object.statusCode);
  res.set("X-Asset-Storage", "s3");
  res.set("X-Asset-S3-Key", key);
  if (object.contentType) res.set("Content-Type", object.contentType);
  if (object.contentRange) res.set("Content-Range", object.contentRange);
  if (object.contentLength !== undefined) res.set("Content-Length", String(object.contentLength));
  if (range) res.set("Accept-Ranges", "bytes");

  object.body.pipe(res);
}

export default router;
