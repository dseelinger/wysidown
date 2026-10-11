/** One tab as the tab row shows it. */
export interface TabRowItem {
  /** The id the main process issued for the tab. */
  id: number;
  /** The document's name. */
  name: string;
  /** True when the document has unsaved changes. */
  dirty: boolean;
  /** True for the tab the window shows. */
  active: boolean;
}

/** What the tab row's preload script exposes to its page as `window.wysidownTabs`. */
export interface TabRowBridge {
  /** Calls `listener` with the window's tabs, in order, each time they change. */
  onTabs(listener: (tabs: TabRowItem[]) => void): void;
  /** Shows the tab `id`. */
  select(id: number): void;
  /** Closes the tab `id`, asking first when it has unsaved changes. */
  close(id: number): void;
  /** Opens a new untitled document in a tab. */
  newTab(): void;
}

declare global {
  interface Window {
    wysidownTabs: TabRowBridge;
  }
}
