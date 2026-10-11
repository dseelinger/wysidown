// The tab row: shows the window's tabs and tells the main process which one to show, close or add.
import type {} from "./tab-row-bridge.ts";

const bridge = window.wysidownTabs;
const list = document.querySelector<HTMLElement>("#tabs")!;

bridge.onTabs((tabs) => {
  list.replaceChildren(
    ...tabs.map((tab) => {
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
      item.addEventListener("click", () => {
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
    }),
  );
  list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
});

document.querySelector("#new")!.addEventListener("click", () => {
  bridge.newTab();
});
