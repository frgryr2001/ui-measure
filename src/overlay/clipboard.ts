/**
 * Writes `text` to the clipboard; call it from a key handler, whose user activation both paths need.
 * The copy command goes first: it also works on http pages, where `navigator.clipboard` is missing.
 * Resolves false when neither path wrote anything.
 */
export async function copyText(text: string): Promise<boolean> {
  let wrote = false;
  const onCopy = (e: ClipboardEvent) => {
    if (!e.clipboardData) return;
    e.clipboardData.setData('text/plain', text);
    wrote = true;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  window.addEventListener('copy', onCopy, { capture: true });
  try {
    document.execCommand('copy');
  } catch {
    // the page broke the copy command; navigator.clipboard may still work
  } finally {
    window.removeEventListener('copy', onCopy, { capture: true });
  }
  if (wrote || !window.isSecureContext) return wrote;
  return navigator.clipboard.writeText(text).then(
    () => true,
    () => false,
  );
}
