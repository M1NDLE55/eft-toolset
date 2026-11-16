/** "1,234,567 ₽": plain grouping that reads well in search results, unlike the UI's ru-RU format. */
export function formatRoubles(value: number) {
  return `${Math.round(value).toLocaleString("en-US")} ₽`;
}

export function plural(count: number, word: string, pluralWord = `${word}s`) {
  return `${count} ${count === 1 ? word : pluralWord}`;
}
