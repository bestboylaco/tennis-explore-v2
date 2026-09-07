export const FRAME_CAPTION_PROMPT_VERSION =
  "frame-caption-v1";


export const FRAME_CAPTION_PROMPT = `
Describe only what is directly visible in this image.

Rules:
- Do not guess a person's identity.
- Do not guess brands, organisations, locations, or events from appearance alone.
- Only name a brand or organisation when its name is clearly readable in the image.
- Do not infer actions, intentions, emotions, relationships, or context that are not visibly supported.
- Preserve clearly readable on-screen text when useful.
- If text is unclear, do not reconstruct or guess it.
- Use neutral, factual language.
- Be concise.
- If an important detail is uncertain, omit it rather than guessing.
`.trim();