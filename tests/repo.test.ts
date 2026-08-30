import { expect, test } from "vitest";
import { parseRepoInput } from "../src/lib/repo";

test("parses a full https repo URL", () => {
  expect(parseRepoInput("https://github.com/acme-studio/marketing-site")).toEqual({
    owner: "acme-studio",
    repo: "marketing-site",
    branch: "main",
  });
});

test("parses repo URL with a /tree/ branch", () => {
  expect(parseRepoInput("https://github.com/acme/site/tree/develop")).toEqual({
    owner: "acme",
    repo: "site",
    branch: "develop",
  });
});

test("parses blob URL with branch and path", () => {
  expect(parseRepoInput("https://github.com/acme/site/blob/dev/src/index.html")).toEqual({
    owner: "acme",
    repo: "site",
    branch: "dev",
    path: "src/index.html",
  });
});

test("parses tree URL with branch and subfolder", () => {
  expect(parseRepoInput("https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react")).toEqual({
    owner: "vitejs",
    repo: "vite",
    branch: "main",
    path: "packages/create-vite/template-react",
  });
});

test("parses owner/repo shorthand", () => {
  expect(parseRepoInput("spuds0588/edgeqa")).toEqual({
    owner: "spuds0588",
    repo: "edgeqa",
    branch: "main",
  });
});

test("normalizes owner to lowercase", () => {
  expect(parseRepoInput("https://github.com/Acme-Studio/Site").owner).toBe("acme-studio");
});

test("ignores query/hash suffixes", () => {
  expect(parseRepoInput("acme/site#readme")).toEqual({ owner: "acme", repo: "site", branch: "main" });
});

test("returns null for empty or unparseable input", () => {
  expect(parseRepoInput("")).toBeNull();
  expect(parseRepoInput("   ")).toBeNull();
  expect(parseRepoInput("just-a-single-word")).toBeNull();
});