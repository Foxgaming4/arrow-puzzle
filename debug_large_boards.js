const { chromium } = require('playwright');

async function run() {
  console.log("Launching browser...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('console', msg => {
    if (msg.type() === 'error') console.log(`PAGE ERROR [${msg.type()}]:`, msg.text());
  });
  page.on('pageerror', err => {
    console.log('PAGE ERROR:', err.message);
  });

  console.log("Navigating to game...");
  await page.goto('http://localhost:8000/index.html');
  await page.waitForTimeout(3000); // wait for intro+splash

  // Test multiple levels with increasing sizes
  const testLevels = [
    { level: 1, expectedSize: 4, label: "Early" },
    { level: 11, expectedSize: 7, label: "Medium (7x7)" },
    { level: 26, expectedSize: 10, label: "Medium (10x10)" },
    { level: 35, expectedSize: 10, label: "Advanced (10x10)" },
    { level: 45, expectedSize: 12, label: "Advanced (12x12)" },
    { level: 55, expectedSize: 14, label: "Advanced (14x14)" },
    { level: 65, expectedSize: 15, label: "Expert (15x15)" },
    { level: 85, expectedSize: 16, label: "Expert (16x16)" },
    { level: 105, expectedSize: 20, label: "Expert (20x20)" },
  ];

  for (const test of testLevels) {
    console.log(`\n--- Testing Level ${test.level} (${test.label}) ---`);
    const startMs = Date.now();
    
    const data = await page.evaluate((lvl) => {
      // Unlock the level for testing
      AP.Player.story.highestUnlocked = Math.max(AP.Player.story.highestUnlocked, lvl);
      AP.game.startLevel(lvl);
      
      const board = document.getElementById('board');
      const buttons = board.querySelectorAll('button.arrow');
      const zoomBtn = document.getElementById('btn-zoom');
      const guideBtn = document.getElementById('btn-guide');
      const guideLines = board.querySelector('.guide-lines');
      
      return {
        remaining: AP.game.remaining,
        piecesCount: AP.game.pieces.size,
        domButtons: buttons.length,
        zoomVisible: zoomBtn ? zoomBtn.style.display !== 'none' : false,
        guideExists: !!guideBtn,
        guideLinesExist: !!guideLines,
        guideLinesCount: guideLines ? guideLines.children.length : 0,
      };
    }, test.level);
    
    const elapsed = Date.now() - startMs;
    console.log(`  Board generated in ${elapsed}ms`);
    console.log(`  Remaining: ${data.remaining}`);
    console.log(`  Pieces: ${data.piecesCount}`);
    console.log(`  DOM Buttons: ${data.domButtons}`);
    console.log(`  Zoom visible: ${data.zoomVisible}`);
    console.log(`  Guide button exists: ${data.guideExists}`);
    console.log(`  Guide grid lines exist: ${data.guideLinesExist} (${data.guideLinesCount} cells)`);
    
    // Validate
    if (data.remaining !== data.piecesCount || data.remaining !== data.domButtons) {
      console.log(`  ❌ MISMATCH: remaining=${data.remaining} pieces=${data.piecesCount} dom=${data.domButtons}`);
    } else {
      console.log(`  ✅ All counts match: ${data.remaining}`);
    }
    
    // Check zoom visibility
    const shouldShowZoom = test.expectedSize >= 10;
    if (data.zoomVisible !== shouldShowZoom) {
      console.log(`  ❌ ZOOM: expected visible=${shouldShowZoom} but got ${data.zoomVisible}`);
    } else {
      console.log(`  ✅ Zoom visibility correct: ${data.zoomVisible}`);
    }
  }

  await browser.close();
  console.log("\n=== All tests complete ===");
}

run().catch(err => {
  console.error("Execution error:", err);
});
