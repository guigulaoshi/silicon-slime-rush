import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Reporter, TestCase, TestResult, FullConfig, Suite } from '@playwright/test/reporter';

/**
 * Writes a line to a file as each test starts and ends.
 *
 * The point is being able to tell "slow" from "stuck" while the suite is running. Playwright's own
 * reporters write to stdout, and stdout into a pipe is buffered by Node until the process exits --
 * so from outside, a suite grinding through eleven routes and a suite wedged on the first one look
 * identical for half an hour. This file is flushed on every write.
 *
 * It deliberately does not live in test-results/: Playwright empties that directory as it starts
 * up, which quietly deleted the first version of this log every single run.
 */
export default class ProgressReporter implements Reporter {
  private path = 'test-progress.log';
  private started = Date.now();
  private done = 0;
  private total = 0;

  onBegin(_config: FullConfig, suite: Suite): void {
    this.total = suite.allTests().length;
    mkdirSync(dirname(resolve(this.path)), { recursive: true });
    this.write(`=== ${this.total} tests, started ${new Date().toISOString()}`);
  }

  onTestBegin(test: TestCase): void {
    this.write(`>>> ${test.title}`);
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.done += 1;
    const secs = (result.duration / 1000).toFixed(0);
    this.write(`${result.status === 'passed' ? 'ok ' : 'FAIL'} ${this.done}/${this.total} `
      + `${test.title} (${secs}s)`);
    if (result.status !== 'passed' && result.error?.message) {
      this.write(`     ${result.error.message.split('\n')[0]}`);
    }
  }

  onEnd(): void {
    this.write(`=== finished in ${((Date.now() - this.started) / 60_000).toFixed(1)} min`);
  }

  private write(line: string): void {
    const at = ((Date.now() - this.started) / 60_000).toFixed(1).padStart(5);
    appendFileSync(this.path, `[${at}m] ${line}\n`);
  }
}
