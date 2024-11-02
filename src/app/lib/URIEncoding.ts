export function customEncodeURI(itemName: string) {
  const custom = itemName.replace(/-/g, "_").replace(/ /g, "-");

  const encoded = encodeURIComponent(custom);

  return encoded;
}

export function customDecodeURI(itemName: string) {
  const decoded = decodeURIComponent(itemName);

  const custom = decoded.replace(/-/g, " ").replace(/_/g, "-");

  return custom;
}
