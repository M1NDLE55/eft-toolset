/** Lower-cases, strips accents, and trims text for comparing names. */
export function normalizeText(value: string) {
  return value.toLocaleLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").trim();
}
