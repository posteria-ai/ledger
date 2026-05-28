import {
  close as fsClose,
  fsync as fsFsync,
  openSync,
  statSync,
  write as fsWrite,
} from "node:fs";
import { dirname } from "node:path";

export interface AuditSinkOptions {
  /** Append-only target file. Its parent directory MUST already exist. */
  path: string;
  /**
   * Re-open the file descriptor on SIGHUP to support external log-rotation
   * tooling. Defaults to `true`. The handler is removed on `close()`.
   */
  handleSighup?: boolean;
  /** Invoked after each successful re-open (e.g. on SIGHUP). */
  onReopen?: (info: { previousFd: number; fd: number }) => void;
}

export interface AuditSink {
  /** Current underlying file descriptor (changes across a re-open). */
  readonly fd: number;
  /** Serialize `record` to a single NDJSON line and enqueue it (fire-and-forget). */
  write(record: unknown): void;
  /** Drain all queued writes and fsync them durably to disk. */
  flush(): Promise<void>;
  /** Drain, fsync, then close the file. Re-opens a fresh fd at the same path. */
  reopen(): Promise<void>;
  /** Flush and close the underlying file. Idempotent. */
  close(): Promise<void>;
}

function writeAll(fd: number, data: string): Promise<void> {
  const buf = Buffer.from(data, "utf8");
  return new Promise((resolve, reject) => {
    const step = (offset: number): void => {
      if (offset >= buf.length) {
        resolve();
        return;
      }
      fsWrite(fd, buf, offset, buf.length - offset, null, (err, written) => {
        if (err) {
          reject(err);
          return;
        }
        step(offset + written);
      });
    };
    step(0);
  });
}

function fsyncFd(fd: number): Promise<void> {
  return new Promise((resolve, reject) => {
    fsFsync(fd, (err) => (err ? reject(err) : resolve()));
  });
}

function closeFd(fd: number): Promise<void> {
  return new Promise((resolve, reject) => {
    fsClose(fd, (err) => (err ? reject(err) : resolve()));
  });
}

type Command =
  | { kind: "write"; line: string }
  | {
      kind: "flush" | "reopen" | "close";
      resolve: () => void;
      reject: (err: unknown) => void;
    };

class JsonlAuditSink implements AuditSink {
  #fd: number;
  readonly #path: string;
  readonly #onReopen: AuditSinkOptions["onReopen"];
  // A single FIFO command stream. Writes coalesce into one syscall; flush /
  // reopen / close act as ordering barriers, so a write enqueued after a
  // reopen request can never be drained into the pre-rotation descriptor.
  #commands: Command[] = [];
  #pumping = false;
  #closed = false;
  #closePromise: Promise<void> | null = null;
  #sighupHandler: (() => void) | null = null;

  constructor(options: AuditSinkOptions) {
    this.#path = options.path;
    this.#onReopen = options.onReopen;

    const dir = dirname(this.#path);
    let stat;
    try {
      stat = statSync(dir);
    } catch {
      throw new Error(
        `audit sink parent directory does not exist: ${dir} (Observer does not auto-create directories)`,
      );
    }
    if (!stat.isDirectory()) {
      throw new Error(`audit sink parent path is not a directory: ${dir}`);
    }

    this.#fd = openSync(this.#path, "a");

    if (options.handleSighup !== false) {
      this.#sighupHandler = () => {
        void this.reopen();
      };
      process.on("SIGHUP", this.#sighupHandler);
    }
  }

  get fd(): number {
    return this.#fd;
  }

  write(record: unknown): void {
    if (this.#closed) {
      throw new Error("cannot write to a closed audit sink");
    }
    const json = JSON.stringify(record);
    if (json === undefined) {
      throw new Error(
        "audit record is not JSON-serializable (undefined, function, or symbol)",
      );
    }
    this.#commands.push({ kind: "write", line: `${json}\n` });
    this.#pump();
  }

  #barrier(kind: "flush" | "reopen"): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.#commands.push({ kind, resolve, reject });
      this.#pump();
    });
  }

  flush(): Promise<void> {
    return this.#barrier("flush");
  }

  reopen(): Promise<void> {
    if (this.#closed) return Promise.resolve();
    return this.#barrier("reopen");
  }

  async close(): Promise<void> {
    if (this.#closePromise) {
      await this.#closePromise;
      return;
    }
    this.#closed = true;
    if (this.#sighupHandler) {
      process.removeListener("SIGHUP", this.#sighupHandler);
      this.#sighupHandler = null;
    }
    this.#closePromise = new Promise<void>((resolve, reject) => {
      this.#commands.push({ kind: "close", resolve, reject });
      this.#pump();
    });
    await this.#closePromise;
  }

  #pump(): void {
    if (this.#pumping) return;
    this.#pumping = true;
    queueMicrotask(() => {
      void this.#run();
    });
  }

  async #run(): Promise<void> {
    try {
      while (this.#commands.length > 0) {
        if (this.#commands[0]!.kind === "write") {
          // On write failure, stop pumping: records stay queued for retry on
          // the next write/flush/close, avoiding a busy-loop on a stuck disk.
          if (!(await this.#drainWrites())) break;
        } else {
          await this.#runBarrier(
            this.#commands.shift() as Extract<Command, { kind: "flush" }>,
          );
        }
      }
    } finally {
      this.#pumping = false;
    }
  }

  /** Coalesce the leading run of write commands into one append. Returns false on failure. */
  async #drainWrites(): Promise<boolean> {
    const lines: string[] = [];
    while (this.#commands[0]?.kind === "write") {
      lines.push((this.#commands.shift() as { line: string }).line);
    }
    try {
      await writeAll(this.#fd, lines.join(""));
      return true;
    } catch (err) {
      // Preserve unwritten records at the front of the stream so they are
      // never silently dropped, and surface the failure to any pending
      // flush/reopen/close so callers are not left hanging.
      for (let i = lines.length - 1; i >= 0; i--) {
        this.#commands.unshift({ kind: "write", line: lines[i]! });
      }
      this.#rejectBarriers(err);
      return false;
    }
  }

  async #runBarrier(
    cmd: Extract<Command, { kind: "flush" | "reopen" | "close" }>,
  ): Promise<void> {
    try {
      await fsyncFd(this.#fd);
      if (cmd.kind === "reopen") {
        const previousFd = this.#fd;
        this.#fd = openSync(this.#path, "a");
        await closeFd(previousFd);
        this.#onReopen?.({ previousFd, fd: this.#fd });
      } else if (cmd.kind === "close") {
        await closeFd(this.#fd);
      }
      cmd.resolve();
    } catch (err) {
      cmd.reject(err);
    }
  }

  /** Reject and drop every queued barrier, leaving writes queued for retry. */
  #rejectBarriers(err: unknown): void {
    this.#commands = this.#commands.filter((cmd) => {
      if (cmd.kind === "write") return true;
      cmd.reject(err);
      return false;
    });
  }
}

export function createAuditSink(options: AuditSinkOptions): AuditSink {
  return new JsonlAuditSink(options);
}
