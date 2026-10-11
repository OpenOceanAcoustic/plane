/** The last dialog in DOM order is the visible overlay, including nested sheet families. */
export function isTopDialog(dialog: Element | null): boolean {
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter(
    (element) => element.getClientRects().length > 0
  );
  return dialog !== null && dialogs[dialogs.length - 1] === dialog;
}

/** Visible keyboard targets; hidden form backing controls must never receive focus. */
export function dialogFocusTargets(root: Element | null): HTMLElement[] {
  return Array.from(
    root?.querySelectorAll<HTMLElement>("button,input,select,textarea,a[href],[tabindex]") ?? []
  ).filter(
    (element) =>
      element.tabIndex >= 0 && !element.matches(":disabled,[aria-hidden='true']") && element.getClientRects().length > 0
  );
}
