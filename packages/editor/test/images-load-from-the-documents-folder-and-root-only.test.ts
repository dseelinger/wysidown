import type { Resources } from "@wysidown/core";
import { describe, expect, test } from "vitest";
import { imageSource, noResources } from "../src/images.ts";

const resources: Resources = {
  base: "https://files.test/c%3A/repo/docs/",
  root: "https://files.test/c%3A/repo/",
  remoteImages: true,
};
const load = (url: string) => ({ kind: "load", url });
const missing = { kind: "missing" };
const remote = { kind: "remote" };

describe("images load from the document's folder and root only", () => {
  test.each([
    ["images/pipeline.png", load("https://files.test/c%3A/repo/docs/images/pipeline.png")],
    ["./images/my pic.png", load("https://files.test/c%3A/repo/docs/images/my%20pic.png")],
    ["../assets/logo.png", load("https://files.test/c%3A/repo/assets/logo.png")],
    ["/assets/logo.png", load("https://files.test/c%3A/repo/assets/logo.png")],
    ["data:image/png;base64,iVBORw0KGgo=", load("data:image/png;base64,iVBORw0KGgo=")],
    ["https://example.com/badge.svg", load("https://example.com/badge.svg")],
    ["//example.com/badge.svg", load("https://example.com/badge.svg")],
  ])("%s loads", (src, expected) => {
    expect(imageSource(src, resources)).toEqual(expected);
  });

  test.each([
    "../../outside.png",
    "/../outside.png",
    "file:///C:/repo/docs/images/pipeline.png",
    "C:/repo/docs/images/pipeline.png",
    "\\\\server\\share\\pipeline.png",
    "javascript:alert(1)",
    "data:text/html,<p>",
    "",
  ])("%s is missing", (src) => {
    expect(imageSource(src, resources)).toEqual(missing);
  });

  test("images from the web are placeholders while they are off", () => {
    const off = { ...resources, remoteImages: false };
    expect(imageSource("https://example.com/badge.svg", off)).toEqual(remote);
    expect(imageSource("http://example.com/badge.svg", off)).toEqual(remote);
    expect(imageSource("images/pipeline.png", off)).toEqual(
      load("https://files.test/c%3A/repo/docs/images/pipeline.png"),
    );
  });

  test("a document with no file loads no relative image", () => {
    expect(imageSource("images/pipeline.png", { ...noResources, remoteImages: true })).toEqual(missing);
    expect(imageSource("https://example.com/badge.svg", noResources)).toEqual(remote);
  });
});
