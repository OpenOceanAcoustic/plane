export function requestMobileNavigation(navigate: () => void) {
  const event = new CustomEvent("mobileNavigate", { cancelable: true, detail: { navigate } });
  window.dispatchEvent(event);
  if (!event.defaultPrevented) navigate();
}
