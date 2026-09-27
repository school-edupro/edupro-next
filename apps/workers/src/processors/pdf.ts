import type { Browser } from 'playwright';

export interface PdfOptions {
  landscape?: boolean;
  /** Explicit page size (for cards and receipts); A4 when omitted. */
  width?: string;
  height?: string;
}

export interface PdfEngine {
  render(html: string, options?: PdfOptions): Promise<Buffer>;
  close(): Promise<void>;
}

/**
 * Chromium through Playwright (S3-03). The browser starts on first use and is reused; report cards and
 * receipts in later sprints render through the same engine.
 */
export class PlaywrightPdfEngine implements PdfEngine {
  private browser: Browser | null = null;

  private async browserInstance(): Promise<Browser> {
    if (!this.browser) {
      const { chromium } = await import('playwright');
      this.browser = await chromium.launch({ headless: true });
    }
    return this.browser;
  }

  async render(html: string, options: PdfOptions = {}): Promise<Buffer> {
    const browser = await this.browserInstance();
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      const pdf = await page.pdf({
        ...(options.width && options.height
          ? { width: options.width, height: options.height }
          : { format: 'A4' }),
        landscape: options.landscape ?? false,
        printBackground: true,
        preferCSSPageSize: true,
      });
      return Buffer.from(pdf);
    } finally {
      await context.close();
    }
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
  }
}

/** Used where no browser is available (EXPORT_PDF_ENGINE=none): PDF requests fail with a clear message. */
export class NoPdfEngine implements PdfEngine {
  async render(): Promise<Buffer> {
    throw new Error('PDF export is disabled on this worker (EXPORT_PDF_ENGINE=none)');
  }
  async close(): Promise<void> {}
}
