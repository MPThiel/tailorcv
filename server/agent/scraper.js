const puppeteer = require('puppeteer');
const cheerio = require('cheerio');

async function scrape(url) {
  console.log('[scraper] Starting scrape for URL:', url);
  let browser;
  try {
    console.log('[scraper] Launching Puppeteer...');
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
    console.log('[scraper] Puppeteer launched. Opening page...');
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    console.log('[scraper] Navigating to URL...');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('[scraper] Page loaded. Extracting content...');
    const html = await page.content();

    const $ = cheerio.load(html);
    $('script, style, nav, header, footer, [aria-hidden="true"]').remove();

    const text = $('body').text().replace(/\s+/g, ' ').trim();
    console.log(`[scraper] Done. Extracted ${text.length} characters.`);

    const blockSignals = ['redirecting', 'sign in', 'log in', 'login', 'captcha', 'please enable', 'javascript required'];
    const isBlocked = text.length < 200 || blockSignals.some(signal => text.toLowerCase().includes(signal));
    if (isBlocked) {
      throw new Error('SCRAPE_BLOCKED');
    }

    return text;
  } finally {
    if (browser) {
      console.log('[scraper] Closing browser.');
      await browser.close();
    }
  }
}

module.exports = { scrape };
