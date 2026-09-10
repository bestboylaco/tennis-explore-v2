// the one AWS client this project builds (TENISE-12 / E2-06).
//
// deliberately narrow. it constructs a TextractClient and nothing else -- no S3,
// no shared "aws" module, no credential plumbing of its own. two reasons:
//
//   1. the project has textract:AnalyzeDocument and nothing more. s3:PutObject
//      was tested and came back AccessDenied, which is what ruled out the
//      asynchronous StartDocumentAnalysis path (it only accepts an S3Object,
//      never Bytes) and left the synchronous API as the only way in. a client
//      module that implied broader access would misrepresent what we can do.
//
//   2. src/config/s3.client.js is an empty placeholder belonging to a
//      teammate's unpushed storage work. writing into it, or building a shared
//      aws config it would have to adopt, would collide with that branch.
//
// credentials are never read here. the SDK's default provider chain finds them
// in the environment or ~/.aws/credentials, which means nothing secret is ever
// named in this repo's code and a developer without credentials gets a clear
// SDK error rather than a confusing empty string.

import { TextractClient } from "@aws-sdk/client-textract";

// the region the corpus bucket lives in. it matters beyond latency: Textract is
// a regional service, and CloudTrail's lookup-events is regional too -- running
// analysis in one region and looking for the audit event in another returns an
// empty result that reads exactly like "the call never happened".
export const TEXTRACT_REGION = process.env.AWS_REGION || "ap-southeast-2";

let client = null;

/**
 * the shared TextractClient, built on first use.
 *
 * lazy rather than module-scope so that importing anything downstream of this
 * file -- the extraction service, the chunker, the tests -- does not require
 * AWS credentials to be present. only actually sending a page does.
 */
export function textractClient() {
  client ??= new TextractClient({
    region: TEXTRACT_REGION,
    // retries are owned entirely by textract.service.js, so the SDK does none.
    //
    // these used to be stacked: three SDK attempts underneath our own loop of
    // five, which multiplies to fifteen real requests for a single throttled
    // page -- and the SDK's short default backoff walks straight back into the
    // rate limit it just hit, burning its attempts before ours ever waits. our
    // loop already classifies and retries the transport-level failures the SDK
    // would have covered (InternalServerError, ServiceUnavailable) with a much
    // longer, jittered backoff, so one attempt here is the whole request.
    maxAttempts: 1,
  });

  return client;
}

/**
 * whether the environment is set up to call Textract at all.
 *
 * checked before a run rather than discovered on the first request, so an
 * unconfigured machine is told in a second instead of after rendering a page.
 * a profile in ~/.aws/credentials is equally valid, so a missing key here is a
 * warning for the caller to weigh, not a hard failure.
 */
export function textractCredentialSummary() {
  const hasStaticKeys = Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
  const hasProfile = Boolean(process.env.AWS_PROFILE);

  return {
    region: TEXTRACT_REGION,
    hasStaticKeys,
    hasProfile,
    // the SDK can also pick up an instance role or SSO cache we cannot see from
    // here, so "neither" is reported as unknown rather than as absent.
    configured: hasStaticKeys || hasProfile,
  };
}
