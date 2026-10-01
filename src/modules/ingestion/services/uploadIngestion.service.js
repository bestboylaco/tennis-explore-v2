import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";

import {
    retrievalConfig,
} from "../../../config/retrieval.config.js";

import {
    grantsForDocument,
} from "../../../shared/constants/accessControl.js";

import {
    INGESTION_STAGES,
} from "../../../shared/constants/telemetry.js";

import Source from "../../sources/models/source.model.js";

import {
    buildIndex,
} from "../indexBuilder.service.js";

import {
    runIngestion,
} from "../ingestion.service.js";

import {
    PRIVATE_UPLOAD_PREFIX,
    classificationForPrivateUploadRole,
} from "../metadata.service.js";

/*
 * This path belongs to the backend server.
 *
 * During local development the backend server happens to be the developer's
 * machine. When deployed, this path belongs to the cloud/backend host or its
 * persistent volume.
 */
const UPLOAD_ROOT =
    process.env.USER_UPLOAD_DIR ||
    "data/uploads";

function createHttpError(
    message,
    {
        code,
        statusCode,
    },
) {
    const error =
        new Error(
            message,
        );

    error.code =
        code;

    error.statusCode =
        statusCode;

    return error;
}

function safeOriginalName(
    value,
) {
    const extension =
        path
            .extname(
                value,
            )
            .toLowerCase();

    const basename =
        path.basename(
            value,
            extension,
        );

    const cleaned =
        basename
            .replace(
                /[^A-Za-z0-9._-]+/g,
                "_",
            )
            .replace(
                /^_+|_+$/g,
                "",
            )
            .slice(
                0,
                100,
            );

    return (
        cleaned ||
        "match-report"
    );
}

/*
 * Extension and MIME type are checked by Multer.
 *
 * This check verifies the actual bytes so a DOCX renamed to .pdf does not
 * reach MongoDB or the ingestion pipeline.
 */
function assertPdfSignature(
    buffer,
) {
    if (
        !Buffer.isBuffer(
            buffer,
        ) ||
        buffer.length <
        5
    ) {
        throw createHttpError(
            "Only PDF files are accepted.",
            {
                code:
                    "INVALID_PDF",

                statusCode:
                    415,
            },
        );
    }

    const signature =
        buffer
            .subarray(
                0,
                5,
            )
            .toString(
                "ascii",
            );

    if (
        signature !==
        "%PDF-"
    ) {
        throw createHttpError(
            "Only PDF files are accepted.",
            {
                code:
                    "INVALID_PDF",

                statusCode:
                    415,
            },
        );
    }
}

async function readManifestChunkCount(
    directory,
) {
    try {
        const raw =
            await fsp.readFile(
                path.join(
                    directory,
                    "manifest.json",
                ),
                "utf8",
            );

        const manifest =
            JSON.parse(
                raw,
            );

        return Number(
            manifest.chunkCount ??
            0,
        );
    } catch {
        return 0;
    }
}

export async function ingestUploadedMatchReport({
    file,
    user,

    runIngestionFn =
    runIngestion,

    buildIndexFn =
    buildIndex,

    SourceModel =
    Source,
} = {}) {
    if (!file) {
        throw createHttpError(
            "Choose a PDF file to upload.",
            {
                code:
                    "FILE_REQUIRED",

                statusCode:
                    400,
            },
        );
    }

    if (
        !user?.id ||
        !user?.roleId
    ) {
        throw createHttpError(
            "Authenticated user information is required.",
            {
                code:
                    "AUTH_REQUIRED",

                statusCode:
                    401,
            },
        );
    }

    /*
     * Important acceptance-criterion boundary:
     *
     * This check runs before:
     * - writing the file
     * - Source.create()
     * - runIngestion()
     */
    assertPdfSignature(
        file.buffer,
    );

    /*
     * Determine the uploader's ACL from trusted backend session information.
     *
     * The browser never sends acl_groups.
     */
    let classification;

    try {
        classification =
            classificationForPrivateUploadRole(
                user.roleId,
            );
    } catch (cause) {
        throw createHttpError(
            cause.message,
            {
                code:
                    "UPLOAD_ROLE_NOT_ALLOWED",

                statusCode:
                    403,
            },
        );
    }

    const expectedAclGroups =
        grantsForDocument(
            classification,
        );

    const uploadId =
        crypto.randomUUID();

    /*
     * One directory per upload means buildIndex({ append: true }) sees exactly
     * one new file rather than every previous user upload.
     */
    const uploadDirectory =
        path.resolve(
            UPLOAD_ROOT,
            String(
                user.id,
            ),
            uploadId,
        );

    const originalBase =
        safeOriginalName(
            file.originalname,
        );

    /*
     * The role marker is generated only on the backend.
     *
     * metadata.service.js recognises this marker during the existing classify
     * stage and applies the uploader's existing ACL classification.
     *
     * "match-report" is also kept in the name so the existing extraction
     * source-type guess remains semantically correct.
     */
    const storedFileName =
        `${PRIVATE_UPLOAD_PREFIX}${user.roleId}--${uploadId}--match-report--${originalBase}.pdf`;

    const filePath =
        path.join(
            uploadDirectory,
            storedFileName,
        );

    let source =
        null;

    try {
        await fsp.mkdir(
            uploadDirectory,
            {
                recursive:
                    true,
            },
        );

        await fsp.writeFile(
            filePath,
            file.buffer,
        );

        /*
         * Source creation occurs only after format and signature validation.
         *
         * Therefore rejected DOCX / invalid PDF requests create no source record.
         */
        source =
            await SourceModel.create({
                title:
                    file.originalname,

                description:
                    "Private match report uploaded through TennisExplore.",

                sourceType:
                    "match_report",

                storageType:
                    "local",

                storageKey:
                    filePath,

                processingStatus:
                    "uploaded",
            });

        const ingestion =
            await runIngestionFn(
                source._id,
                {
                    handlers: {
                        /*
                         * TENISE-11's existing buildIndex() already performs:
                         *
                         * extract
                         * -> chunk
                         * -> classify + ACL
                         * -> schema gate
                         * -> embed
                         * -> vector index
                         * -> BM25
                         *
                         * append=true adds this upload to the SAME existing on-disk index.
                         */
                        [INGESTION_STAGES.INDEX]:
                            async () => {
                                const beforeChunkCount =
                                    await readManifestChunkCount(
                                        retrievalConfig
                                            .index
                                            .dir,
                                    );

                                const result =
                                    await buildIndexFn({
                                        sourceDirs: [
                                            uploadDirectory,
                                        ],

                                        outputDir:
                                            retrievalConfig
                                                .index
                                                .dir,

                                        resume:
                                            false,

                                        append:
                                            true,
                                    });

                                const afterChunkCount =
                                    Number(
                                        result
                                            .manifest
                                            ?.chunkCount ??
                                        beforeChunkCount,
                                    );

                                const addedChunks =
                                    Math.max(
                                        0,
                                        afterChunkCount -
                                        beforeChunkCount,
                                    );

                                if (
                                    addedChunks ===
                                    0
                                ) {
                                    const reason =
                                        result
                                            .skipped
                                            ?.[0]
                                            ?.reason;

                                    throw createHttpError(
                                        reason
                                            ? `The PDF could not be indexed: ${reason}`
                                            : "The PDF produced no searchable content.",
                                        {
                                            code:
                                                "UPLOAD_INDEX_EMPTY",

                                            statusCode:
                                                422,
                                        },
                                    );
                                }

                                return {
                                    apiCalls:
                                        0,

                                    documents:
                                        1,

                                    bytes:
                                        file.size,

                                    chunks:
                                        addedChunks,

                                    failures:
                                        result
                                            .skipped
                                            ?.length ??
                                        0,
                                };
                            },
                    },
                },
            );

        return {
            source: {
                id:
                    String(
                        source._id,
                    ),

                title:
                    source.title,

                sourceType:
                    source.sourceType,

                storedFileName,

                expectedAclGroups,
            },

            ingestion,
        };
    } catch (error) {
        /*
         * If MongoDB never created a Source record, clean up the backend file.
         *
         * Once Source exists, runIngestion() owns lifecycle status and records a
         * failed ingestion rather than silently pretending the accepted upload
         * never existed.
         */
        if (!source) {
            await fsp.rm(
                uploadDirectory,
                {
                    recursive:
                        true,

                    force:
                        true,
                },
            );
        }

        throw error;
    }
}