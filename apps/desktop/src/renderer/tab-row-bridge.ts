/** One tab as the tab row shows it. */
export interface TabRowItem {
  /** The id the main process issued for the tab. */
  id: number;
  /** The document's name. */
  name: string;
  /** True when the document has unsaved changes. */
  dirty: boolean;
  /** True for the tab the pane shows. */
  active: boolean;
}

/** One pane's tab row: where it is drawn, in page pixels, and its tabs in order. */
export interface TabRowPane {
  x: number;
  width: number;
  /** True for the pane that menu actions and the tab keys act on. */
  focused: boolean;
  tabs: TabRowItem[];
}

/** What the tab row's preload script exposes to its page as `window.wysidownTabs`. */
export interface TabRowBridge {
  /** Calls `listener` with the window's panes, left to right, each time they or their tabs change. */
  onTabs(listener: (panes: TabRowPane[]) => void): void;
  /** Shows the tab `id`. */
  select(id: number): void;
  /** Closes the tab `id`, asking first when it has unsaved changes. */
  close(id: number): void;
  /** Opens a new untitled document in a tab of pane `pane`, counted from the left. */
  newTab(pane: number): void;
  /** Makes pane `pane` the focused pane. */
  focusPane(pane: number): void;
  /** Starts dragging the splitter; the page is raised above the documents until `dragEnd`. */
  dragStart(): void;
  /** Moves the splitter to `x`, in page pixels, keeping each pane at least its minimum width. */
  drag(x: number): void;
  dragEnd(): void;
  /** Makes the panes equal width. */
  equalPanes(): void;
}

declare global {
  interface Window {
    wysidownTabs: TabRowBridge;
  }
}
