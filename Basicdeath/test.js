const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:8081/');
  await page.waitForTimeout(2000);
  const hasCanvas = await page.$('canvas');
  const gl = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    return c ? !!c.getContext('webgl2') : false;
  });
  console.log('Canvas:', !!hasCanvas, 'WebGL2:', gl);
  await page.screenshot({ path: 'verify.png', fullPage: true });
  await browser.close();
})();
