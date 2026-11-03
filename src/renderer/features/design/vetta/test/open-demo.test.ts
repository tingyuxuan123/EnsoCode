import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("EnsoCode demo host boundary", () => {
	it("does not retain the upstream Node/temporary-file/external-command opener", () => {
		const source = readFileSync(resolve(process.cwd(), "src/renderer/features/design/vetta/src/gallery/open-demo.ts"), "utf8");
		expect(source).toContain("openDesignDemoPreview");
		for (const forbidden of ["command.run", "child_process", "writeFileSync", "OPEN_DEMO_SCRIPT", "openExternal"]) {
			expect(source).not.toContain(forbidden);
		}
	});
});
