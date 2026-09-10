export function createFrameCaptionProvider({
  name,

  model,

  generate,
} = {}) {
  if (
    typeof name !== "string" ||
    name.trim().length === 0
  ) {
    throw new TypeError(
      "Caption provider name is required.",
    );
  }


  if (
    typeof model !== "string" ||
    model.trim().length === 0
  ) {
    throw new TypeError(
      "Caption provider model is required.",
    );
  }


  if (typeof generate !== "function") {
    throw new TypeError(
      "Caption provider generate function is required.",
    );
  }


  return {
    name:
      name.trim(),

    model:
      model.trim(),

    generate,
  };
}