const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // Capture console messages
  page.on('console', msg => console.log('CONSOLE:', msg.type(), msg.text()));
  
  await page.goto('http://127.0.0.1:5179/');
  await page.waitForTimeout(1000);
  
  // Click "Get Started"
  const getStarted = await page.locator('text=Get Started').first();
  if (await getStarted.isVisible()) {
    await getStarted.click();
    console.log('Clicked Get Started');
    await page.waitForTimeout(500);
  }
  
  // Check if onboarding subject selection is visible
  const subjectHeading = await page.locator('text=Select your subjects').first();
  if (await subjectHeading.isVisible()) {
    console.log('Onboarding visible');
    
    // Select AQA Biology
    const biology = await page.locator('text=AQA Biology').first();
    if (await biology.isVisible()) {
      await biology.click();
      console.log('Selected AQA Biology');
      await page.waitForTimeout(300);
    }
    
    // Click Continue/Save
    const continueBtn = await page.locator('button:has-text("Continue"), button:has-text("Save")').first();
    if (await continueBtn.isVisible()) {
      await continueBtn.click();
      console.log('Clicked Continue');
      await page.waitForTimeout(500);
    }
  }
  
  // Take screenshot of current state
  await page.screenshot({ path: '/tmp/past-paper-worker-onboarding.png' });
  console.log('Screenshot saved to /tmp/past-paper-worker-onboarding.png');
  
  // Look for upload area
  const uploadArea = await page.locator('text=Upload a past paper').first();
  if (await uploadArea.isVisible()) {
    console.log('Upload area visible - app is working');
  }
  
  await browser.close();
})();
