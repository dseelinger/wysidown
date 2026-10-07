import { describe, expect, test } from "vitest";
import { imageExtension, maxImageBytes, saveImageRequest } from "../src/index.ts";

const bytes = (text: string): Uint8Array => Uint8Array.from(text, (c) => c.charCodeAt(0));

describe("a pasted image is saved only when its bytes are an image", () => {
  test.each([
    ["\x89PNG\r\n\x1a\n\0\0\0\rIHDR", "png"],
    ["\xff\xd8\xff\xe0\0\x10JFIF", "jpg"],
    ["GIF87a\x01\0\x01\0", "gif"],
    ["GIF89a\x01\0\x01\0", "gif"],
    ["RIFF\x24\0\0\0WEBPVP8 ", "webp"],
  ])("an image's signature names its extension: %j", (signature, extension) => {
    expect(imageExtension(bytes(signature))).toBe(extension);
  });

  test.each([
    "",
    "\x89PNG",
    "<svg xmlns='http://www.w3.org/2000/svg'/>",
    "BM\x36\0\0\0",
    "RIFF\x24\0\0\0WAVEfmt ",
    "MZ\x90\0",
    "\0\0\0",
  ])("anything else has none: %j", (content) => {
    expect(imageExtension(bytes(content))).toBeNull();
  });

  test("a saveImage message with an integer id and base64 data is a request", () => {
    expect(saveImageRequest({ type: "saveImage", id: 3, data: "iVBORw0KGgo=" })).toEqual({
      id: 3,
      data: "iVBORw0KGgo=",
    });
    expect(saveImageRequest({ type: "saveImage", id: 0, data: "" })).toEqual({ id: 0, data: "" });
  });

  test.each([
    null,
    "saveImage",
    { type: "open", id: 1, data: "AAAA" },
    { type: "saveImage", id: "1", data: "AAAA" },
    { type: "saveImage", id: 1.5, data: "AAAA" },
    { type: "saveImage", id: 1 },
    { type: "saveImage", id: 1, data: "AAA" },
    { type: "saveImage", id: 1, data: "AA\nA" },
    { type: "saveImage", id: 1, data: "../../" },
    { type: "saveImage", id: 1, data: "A===" },
  ])("anything else is not: %j", (message) => {
    expect(saveImageRequest(message)).toBeNull();
  });

  test("data longer than the largest image is not a request", () => {
    const largest = "A".repeat(Math.ceil(maxImageBytes / 3) * 4);
    expect(saveImageRequest({ type: "saveImage", id: 1, data: largest })).not.toBeNull();
    expect(saveImageRequest({ type: "saveImage", id: 1, data: largest + "AAAA" })).toBeNull();
  });
});
