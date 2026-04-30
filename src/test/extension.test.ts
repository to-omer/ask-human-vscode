import * as assert from "assert";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from "vscode";
// import * as myExtension from '../../extension';
import { WindowRegistry } from "../window-registry";

suite("Extension Test Suite", () => {
  vscode.window.showInformationMessage("Start all tests.");

  test("Sample test", () => {
    assert.strictEqual(-1, [1, 2, 3].indexOf(5));
    assert.strictEqual(-1, [1, 2, 3].indexOf(0));
  });

  test("WindowRegistry preserves concurrent registrations", async () => {
    const storagePath = await fs.mkdtemp(
      path.join(os.tmpdir(), "ask-human-registry-"),
    );
    const registry = new WindowRegistry(storagePath);
    const workspaceA = path.join(storagePath, "workspace-a");
    const workspaceB = path.join(storagePath, "workspace-b");

    await Promise.all([
      registry.upsert({
        instanceId: "window-a",
        port: 11911,
        workspaceFolders: [workspaceA],
      }),
      registry.upsert({
        instanceId: "window-b",
        port: 11912,
        workspaceFolders: [workspaceB],
      }),
    ]);

    assert.strictEqual(
      (await registry.findByWorkspacePath(path.join(workspaceA, "src")))?.port,
      11911,
    );
    assert.strictEqual(
      (await registry.findByWorkspacePath(path.join(workspaceB, "src")))?.port,
      11912,
    );
  });
});
