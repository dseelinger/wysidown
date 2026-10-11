// The tab rows of a window's panes and the splitter between them. The page lies behind the
// documents, so only the rows and the splitter show; it tells the main process which tab to show,
// close or add, which pane has the focus, and where the splitter is dragged.
import type { TabRowItem } from "./tab-row-bridge.ts";

const bridge = window.wysidownTabs;
const panes = document.querySelector<HTMLElement>("#panes")!;
const splitter = document.querySelector<HTMLElement>("#splitter")!;

function tabItem(tab: TabRowItem): HTMLElement {
  const item = document.createElement("div");
  item.className = "tab";
  item.classList.toggle("dirty", tab.dirty);
  item.setAttribute("role", "tab");
  item.setAttribute("aria-selected", String(tab.active));
  item.title = tab.name;
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = tab.name;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "close";
  close.tabIndex = -1;
  close.setAttribute("aria-label", `Close ${tab.name}`);
  item.append(name, close);
  item.addEventListener("click", (event) => {
    event.stopPropagation();
    bridge.select(tab.id);
  });
  // The middle button closes the tab and does not start scrolling.
  item.addEventListener("mousedown", (event) => {
    if (event.button === 1) event.preventDefault();
  });
  item.addEventListener("auxclick", (event) => {
    if (event.button === 1) bridge.close(tab.id);
  });
  close.addEventListener("click", (event) => {
    event.stopPropagation();
    bridge.close(tab.id);
  });
  return item;
}

bridge.onTabs((state) => {
  panes.replaceChildren(
    ...state.map((pane, index) => {
      const row = document.createElement("div");
      row.className = "pane";
      row.classList.toggle("focused", pane.focused);
      row.style.left = `${String(pane.x)}px`;
      row.style.width = `${String(pane.width)}px`;
      const list = document.createElement("div");
      list.className = "tabs";
      list.setAttribute("role", "tablist");
      list.setAttribute("aria-label", state.length === 1 ? "Open documents" : index === 0 ? "Left pane" : "Right pane");
      list.append(...pane.tabs.map(tabItem));
      const add = document.createElement("button");
      add.type = "button";
      add.className = "new";
      add.title = "New (Ctrl+N)";
      add.setAttribute("aria-label", "New document");
      add.textContent = "+";
      add.addEventListener("click", (event) => {
        event.stopPropagation();
        bridge.newTab(index);
      });
      row.append(list, add);
      row.addEventListener("click", () => {
        bridge.focusPane(index);
      });
      return row;
    }),
  );
  const left = state[0];
  splitter.hidden = state.length < 2 || left === undefined;
  if (left) splitter.style.left = `${String(left.x + left.width)}px`;
  for (const active of panes.querySelectorAll('[aria-selected="true"]')) {
    active.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
});

let dragging = false;

splitter.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  dragging = true;
  splitter.setPointerCapture(event.pointerId);
  bridge.dragStart();
});

const endDrag = (): void => {
  if (!dragging) return;
  dragging = false;
  bridge.dragEnd();
};

// The page lies above the documents while dragging, so it sees every move until the button is released.
window.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  if (event.buttons === 0) endDrag();
  else bridge.drag(event.clientX);
});
window.addEventListener("pointerup", endDrag);

splitter.addEventListener("dblclick", () => {
  bridge.equalPanes();
});
