/** Midnight Pulse - desktop sidebar breakpoint */
export const DESKTOP_SIDEBAR_BREAKPOINT = 1024;

/** Sidebar width when expanded */
export const SIDEBAR_WIDTH_EXPANDED = 240;

/** Sidebar width when collapsed (icon rail) */
export const SIDEBAR_WIDTH_COLLAPSED = 72;

/** Gap between sidebar and main content */
export const SIDEBAR_CONTENT_GAP = 0;

export function getMainContentWidth(
  windowWidth: number,
  isWeb: boolean,
  sidebarCollapsed: boolean
) {
  if (!isWeb || windowWidth < DESKTOP_SIDEBAR_BREAKPOINT) {
    return windowWidth;
  }
  const sidebarWidth = sidebarCollapsed
    ? SIDEBAR_WIDTH_COLLAPSED
    : SIDEBAR_WIDTH_EXPANDED;
  return Math.max(360, windowWidth - sidebarWidth - SIDEBAR_CONTENT_GAP);
}

/** Legacy aliases for gradual migration */
export const DESKTOP_TAB_RAIL_BREAKPOINT = DESKTOP_SIDEBAR_BREAKPOINT;
export const DESKTOP_TAB_RAIL_WIDTH = SIDEBAR_WIDTH_COLLAPSED;
export const DESKTOP_TAB_RAIL_GAP = SIDEBAR_CONTENT_GAP;

export function getTabContentWidth(windowWidth: number, isWeb: boolean) {
  return getMainContentWidth(windowWidth, isWeb, false);
}
