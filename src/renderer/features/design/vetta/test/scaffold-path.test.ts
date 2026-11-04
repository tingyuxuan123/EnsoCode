import type { PluginFsApi } from "@vetta-org/plugin-sdk";
import { expect, it, vi } from "vitest";
import { scaffoldDesign } from "../src/vetd/scaffold";

it("scaffolds a uniquely named design directly under a Windows drive root", async () => {
	const stat = vi.fn(async (path: string) => path === "C:/设计.vetd" ? { size: 1 } : null);
	const writeFile = vi.fn(async () => {});
	const fs = { stat, writeFile, createDirectory: async () => {} } as unknown as PluginFsApi;
	expect(await scaffoldDesign(fs, "C:/", "设计")).toEqual({ vetdPath: "C:/设计-1.vetd", dirPath: "C:/设计-1.vetd" });
	expect(writeFile).toHaveBeenCalledWith("C:/设计-1.vetd/design.json", expect.any(String));
});
