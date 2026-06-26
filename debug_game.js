const { chromium } = require('playwright');

async function run() {
  console.log("Launching browser...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // Capture page console logs
  page.on('console', msg => {
    console.log(`PAGE LOG [${msg.type()}]:`, msg.text());
  });
  
  page.on('pageerror', err => {
    console.log('PAGE ERROR:', err.message);
  });

  console.log("Navigating to game...");
  await page.goto('http://localhost:8000/index.html');
  
  console.log("Waiting for splash screen to disappear...");
  await page.waitForTimeout(2000);
  
  console.log("Clicking Play button...");
  await page.click('#btn-play');
  await page.waitForTimeout(1000);
  
  // Inspect game state and DOM
  const data = await page.evaluate(() => {
    const board = document.getElementById('board');
    const buttons = Array.from(board.querySelectorAll('button.arrow'));
    const buttonData = buttons.map(btn => ({
      id: btn.dataset.id,
      label: btn.getAttribute('aria-label'),
      display: btn.style.display,
      visibility: window.getComputedStyle(btn).visibility,
      left: btn.style.left,
      top: btn.style.top
    }));
    
    return {
      remainingCounter: document.getElementById('remaining-count').textContent,
      domButtonsCount: buttons.length,
      buttonDetails: buttonData,
      gameStateRemaining: window.AP.game.remaining,
      gameStatePiecesCount: window.AP.game.pieces.size
    };
  });
  
  console.log("--- RESULTS ---");
  console.log("Remaining Counter text:", data.remainingCounter);
  console.log("DOM Buttons Count:", data.domButtonsCount);
  console.log("Game State remaining:", data.gameStateRemaining);
  console.log("Game State pieces count:", data.gameStatePiecesCount);
  console.log("Button Details:", JSON.stringify(data.buttonDetails, null, 2));
  
  await browser.close();
}

run().catch(err => {
  console.error("Execution error:", err);
});
