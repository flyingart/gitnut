/** localStorage value of `key`, falling back to the key from before the rename (gitty.* to gitnut.*). */
export function readStored(key: string): string | null {
  return localStorage.getItem(key) ?? localStorage.getItem(key.replace(/^gitnut\./, "gitty."));
}
