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

class JsonlAuditSink implements AuditSink {
  #fd: number;
  readonly #path: string;
  readonly #onReopen: AuditSinkOptions["onReopen"];
  #queue: string[] = [];
  #draining: Promise<void> | null = null;
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
    this.#queue.push(`${JSON.stringify(record)}\n`);
    void this.#drain();
  }

  #drain(): Promise<void> {
    if (this.#draining) return this.#draining;
    const run = (async () => {
      while (this.#queue.length > 0) {
        const batch = this.#queue.splice(0).join("");
        await writeAll(this.#fd, batch);
      }
    })();
    this.#draining = run.finally(() => {
      this.#draining = null;
    });
    return this.#draining;
  }

  async flush(): Promise<void> {
    while (this.#queue.length > 0 || this.#draining) {
      await this.#drain();
    }
    await fsyncFd(this.#fd);
  }

  async reopen(): Promise<void> {
    if (this.#closed) return;
    await this.flush();
    const previousFd = this.#fd;
    this.#fd = openSync(this.#path, "a");
    await closeFd(previousFd);
    this.#onReopen?.({ previousFd, fd: this.#fd });
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
    this.#closePromise = (async () => {
      await this.flush();
      await closeFd(this.#fd);
    })();
    await this.#closePromise;
  }
}

export function createAuditSink(options: AuditSinkOptions): AuditSink {
  return new JsonlAuditSink(options);
}
