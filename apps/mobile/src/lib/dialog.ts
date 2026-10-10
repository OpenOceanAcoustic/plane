/** The last dialog in DOM order is the visible overlay, including nested sheet families. */
export function isTopDialog(dialog: Element | null): boolean {
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter(
    (element) => element.getClientRects().length > 0
  );
  return dialog !== null && dialogs[dialogs.length - 1] === dialog;
}
