# Unit tests

No external services (MongoDB, S3, Bedrock, OpenSearch, Textract, Nova Pro). Mock or stub anything that would otherwise cross the network. Runs on every push with no secrets required — see `.github/workflows/ci.yml`.

Files matching `*.test.js`, picked up by `node --test test/unit`.
