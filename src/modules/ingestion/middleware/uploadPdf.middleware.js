import path from "node:path";

import multer from "multer";

/*
 * Demo scope from the user story:
 *
 * PDF only.
 * Maximum size 20 MB.
 */
export const MAX_UPLOAD_BYTES =
    20 * 1024 * 1024;

const upload =
    multer({
        /*
         * The upload is held in backend memory only until all request-level
         * validation has succeeded.
         *
         * It is not written to backend storage before validation.
         */
        storage:
            multer.memoryStorage(),

        limits: {
            fileSize:
                MAX_UPLOAD_BYTES,

            files:
                1,
        },

        fileFilter(
            req,
            file,
            callback,
        ) {
            const extension =
                path
                    .extname(
                        file.originalname,
                    )
                    .toLowerCase();

            if (
                extension !==
                ".pdf" ||
                file.mimetype !==
                "application/pdf"
            ) {
                const error =
                    new Error(
                        "Only PDF files are accepted.",
                    );

                error.code =
                    "UNSUPPORTED_FILE_TYPE";

                error.statusCode =
                    415;

                callback(
                    error,
                );

                return;
            }

            callback(
                null,
                true,
            );
        },
    });

export function uploadSinglePdf(
    req,
    res,
    next,
) {
    upload.single(
        "file",
    )(
        req,
        res,
        (
            error,
        ) => {
            if (!error) {
                next();
                return;
            }

            if (
                error instanceof
                multer.MulterError &&
                error.code ===
                "LIMIT_FILE_SIZE"
            ) {
                return res
                    .status(
                        413,
                    )
                    .json({
                        success:
                            false,

                        error: {
                            code:
                                "FILE_TOO_LARGE",

                            message:
                                "PDF files must be 20 MB or smaller.",
                        },
                    });
            }

            return res
                .status(
                    error.statusCode ??
                    400,
                )
                .json({
                    success:
                        false,

                    error: {
                        code:
                            error.code ??
                            "UPLOAD_REJECTED",

                        message:
                            error.message ??
                            "The file could not be uploaded.",
                    },
                });
        },
    );
}