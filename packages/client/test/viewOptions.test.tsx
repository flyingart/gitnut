import { afterAll, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, renderHook } from "@testing-library/react";
import * as vo from "../src/viewOptions";

beforeAll(() => GlobalRegistrator.register({ url: "http://localhost/" }));
afterAll(() => GlobalRegistrator.unregister());

test("R-LIST-2: view options persist in localStorage", () => {
  vo.setViewOptionsStorageKey("test.vo");
  expect(vo.getViewOptions().changesMode).toBe("tree");
  vo.setViewOptions({ changesMode: "flat", diffMode: "unified" });
  expect(JSON.parse(localStorage.getItem("test.vo")!).changesMode).toBe("flat");
  vo.setViewOptionsStorageKey("test.vo"); // reload from storage
  expect(vo.getViewOptions().diffMode).toBe("unified");
});

test("R-SDK-4: props fix options and lock their toggles", () => {
  vo.setViewOptions({ changesMode: "flat", ignoreWhitespace: false });
  const { result } = renderHook(() => vo.useViewOptions({ changesMode: "tree", diffMode: undefined }));
  expect(result.current.options.changesMode).toBe("tree");
  expect(result.current.locked("changesMode")).toBe(true);
  expect(result.current.locked("diffMode")).toBe(false);
  act(() => result.current.set("ignoreWhitespace", true));
  expect(result.current.options.ignoreWhitespace).toBe(true);
  expect(vo.getViewOptions().changesMode).toBe("flat");
});
