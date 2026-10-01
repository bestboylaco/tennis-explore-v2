import {
    ingestUploadedMatchReport,
} from "../services/uploadIngestion.service.js";

export async function uploadMatchReportController(
    req,
    res,
    next,
) {
    try {
        /*
         * Some existing middleware exposes the trusted account as req.user,
         * while the session itself always carries req.session.user.
         *
         * Supporting both keeps this controller compatible with the current auth
         * middleware without accepting identity information from the request body.
         */
        const user =
            req.user ??
            req.session
                ?.user;

        const result =
            await ingestUploadedMatchReport({
                file:
                    req.file,

                user,
            });

        return res
            .status(
                201,
            )
            .json({
                success:
                    true,

                data:
                    result,
            });
    } catch (error) {
        return next(
            error,
        );
    }
}