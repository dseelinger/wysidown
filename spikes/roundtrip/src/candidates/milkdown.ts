import "./dom.ts";
import { Editor, parserCtx, serializerCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import type { Node } from "@milkdown/kit/prose/model";

let parse: (src: string) => Node;
let serialize: (doc: Node) => string;

export const milkdown = {
  name: "milkdown",
  async init(): Promise<void> {
    const editor = await Editor.make().use(commonmark).use(gfm).create();
    editor.action((ctx) => {
      parse = ctx.get(parserCtx);
      serialize = ctx.get(serializerCtx);
    });
  },
  roundTrip(src: string): string {
    return serialize(parse(src));
  },
};
