export function isSafeTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
}

export function escapeDiscordText(value: string) {
  return value
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\\`*_~|>#[\]()<:-]/g, (character) => `\\${character}`)
    .replace(/@/g, "@​")
    .replace(/https?:\/\//gi, (scheme) => scheme.replace("://", ":​//"));
}
