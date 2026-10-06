import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { TaskList, TaskItem } from "@tiptap/extension-list";

const manager = new MarkdownManager({
  extensions: [StarterKit, TableKit, TaskList, TaskItem.configure({ nested: true })],
});

export const tiptap = {
  name: "tiptap",
  roundTrip(src: string): string {
    return manager.serialize(manager.parse(src));
  },
};
