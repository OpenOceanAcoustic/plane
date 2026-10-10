/** The last dialog in DOM order is the visible overlay, including nested sheet families. */
export function isTopDialog(dialog: Element | null): boolean {
  const dialogs = document.querySelectorAll('[role="dialog"]');
  return dialog !== null && dialogs.item(dialogs.length - 1) === dialog;
}
