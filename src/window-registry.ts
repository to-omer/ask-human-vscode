import { promises as fs } from "fs";
import path from "path";

export interface WindowRegistration {
  instanceId: string;
  port: number;
  workspaceFolders: string[];
}

export class WindowRegistry {
  private readonly registryDir: string;

  constructor(storagePath: string) {
    this.registryDir = path.join(storagePath, "windows");
  }

  public async upsert(registration: WindowRegistration): Promise<void> {
    await fs.mkdir(this.registryDir, { recursive: true });
    await fs.writeFile(
      this.getRegistrationPath(registration.instanceId),
      `${JSON.stringify(registration, null, 2)}\n`,
      "utf8",
    );
  }

  public async remove(instanceId: string): Promise<void> {
    await fs.unlink(this.getRegistrationPath(instanceId)).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    });
  }

  public async findByWorkspacePath(
    workspacePath: string,
  ): Promise<WindowRegistration | undefined> {
    const normalizedPath = path.resolve(workspacePath);
    const candidates = (await this.read()).map((registration, index) => ({
      index,
      registration,
      score: Math.max(
        ...registration.workspaceFolders.map((folder) => {
          const resolved = path.resolve(folder);
          return this.isSameOrChildPath(normalizedPath, resolved)
            ? resolved.length
            : -1;
        }),
      ),
    }));

    return candidates
      .filter((candidate) => candidate.score >= 0)
      .sort((a, b) => b.score - a.score || b.index - a.index)[0]
      ?.registration;
  }

  private isSameOrChildPath(targetPath: string, parentPath: string): boolean {
    const relativePath = path.relative(parentPath, targetPath);
    return (
      relativePath === "" ||
      (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
    );
  }

  private async read(): Promise<WindowRegistration[]> {
    try {
      const files = await fs.readdir(this.registryDir);
      const registrations = await Promise.all(
        files
          .filter((file) => file.endsWith(".json"))
          .map((file) =>
            this.readRegistration(path.join(this.registryDir, file)),
          ),
      );
      return registrations.filter(
        (registration): registration is WindowRegistration =>
          registration !== undefined,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  private async readRegistration(
    filePath: string,
  ): Promise<WindowRegistration | undefined> {
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
      if (
        typeof parsed?.instanceId === "string" &&
        typeof parsed?.port === "number" &&
        Array.isArray(parsed?.workspaceFolders)
      ) {
        return {
          instanceId: parsed.instanceId,
          port: parsed.port,
          workspaceFolders: parsed.workspaceFolders.filter(
            (folder: unknown): folder is string => typeof folder === "string",
          ),
        };
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  private getRegistrationPath(instanceId: string): string {
    return path.join(this.registryDir, `${encodeURIComponent(instanceId)}.json`);
  }
}
