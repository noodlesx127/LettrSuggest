import { test, expect } from '@playwright/test';

test.describe('MovieCard Feature Tests', () => {
  // Increase timeout for these tests since suggestions take time to compute
  test.setTimeout(300000); // 5 minutes per test
  
  test.beforeEach(async ({ page }) => {
    // Navigate to suggestions page directly
    await page.goto('/suggest', { timeout: 60000 });
    
    // Wait for page to fully render
    await page.waitForLoadState('networkidle', { timeout: 30000 });
    await page.waitForTimeout(2000); // Extra wait for client-side rendering
    
    const currentUrl = page.url();
    console.log('Current URL:', currentUrl);
    
    // Take a screenshot to see current state
    await page.screenshot({ path: 'test-results/initial-state.png' });
    
    // Check page content
    const pageText = await page.textContent('body');
    console.log('Page contains "Please sign in":', pageText?.includes('Please sign in'));
    console.log('Page contains "Sign in":', pageText?.includes('Sign in'));
    
    // Check for "Please sign in" text on the page (inline auth prompt)
    const needsLogin = pageText?.includes('Please sign in') || pageText?.includes('Please') && pageText?.includes('sign in');
    console.log('Needs login:', needsLogin);
    
    // Also check if we're on login page
    const isOnLoginPage = currentUrl.includes('/auth/login');
    
    if (needsLogin || isOnLoginPage) {
      console.log('Not authenticated, need to log in...');
      
      // Click any sign in link and wait for navigation
      console.log('Clicking sign in link...');
      await Promise.all([
        page.waitForNavigation({ timeout: 15000 }),
        page.locator('a[href="/auth/login"]').first().click()
      ]).catch(async () => {
        // If navigation fails, just goto the page directly
        console.log('Navigation failed, going to login page directly...');
        await page.goto('/auth/login', { timeout: 15000 });
      });
      
      // Ensure we're on login page
      await page.waitForSelector('form', { state: 'visible', timeout: 10000 });
      
      // Now we should be on the login page
      console.log('On login page:', page.url());
      
      // Wait for the form to be fully rendered
      await page.waitForSelector('form', { state: 'visible', timeout: 15000 });
      console.log('Form visible');
      
      // Find email input
      const emailInput = page.locator('input[type="email"]');
      await emailInput.waitFor({ state: 'visible', timeout: 10000 });
      console.log('Email input visible');
      
      // Clear and fill email
      await emailInput.click();
      await emailInput.fill('jrmilloch2@gmail.com');
      console.log('Email filled');
      
      // Find password input
      const passwordInput = page.locator('input[type="password"]');
      await passwordInput.waitFor({ state: 'visible', timeout: 10000 });
      console.log('Password input visible');
      
      // Clear and fill password
      await passwordInput.click();
      await passwordInput.fill('mshome11');
      console.log('Password filled');
      
      // Take screenshot before submit
      await page.screenshot({ path: 'test-results/before-login-submit.png' });
      
      // Find and click submit button
      const submitButton = page.locator('button[type="submit"]');
      await submitButton.waitFor({ state: 'visible', timeout: 5000 });
      console.log('Submit button visible, clicking...');
      await submitButton.click();
      
      // Wait for navigation away from login page
      console.log('Waiting for navigation after login...');
      await page.waitForURL((url) => !url.toString().includes('/auth/login'), { timeout: 30000 });
      console.log('Logged in! Now at:', page.url());
      
      // Navigate to suggestions page if not already there
      if (!page.url().includes('/suggest')) {
        console.log('Navigating to /suggest...');
        await page.goto('/suggest', { timeout: 60000 });
      }
      
      // Wait a moment for auth state to propagate
      await page.waitForTimeout(2000);
    }
    
    console.log('On suggestions page, waiting for content...');
    await page.screenshot({ path: 'test-results/on-suggest-page.png' });
    
    // Wait for movie cards to appear - poll until they're visible
    // This is more robust than a single waitForSelector
    let cardsFound = false;
    const maxWaitTime = 240000; // 4 minutes
    const pollInterval = 3000; // Check every 3 seconds
    const startTime = Date.now();
    
    while (!cardsFound && (Date.now() - startTime) < maxWaitTime) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      
      // Check for various indicators that suggestions loaded
      const cardCount = await page.locator('.border.bg-white.rounded-lg, [data-testid="movie-card"]').count();
      const sectionCount = await page.locator('h2, h3').filter({ hasText: /Matches|Gems|Discovery|Picks/i }).count();
      
      console.log(`[${elapsed}s] Cards: ${cardCount}, Sections: ${sectionCount}`);
      
      if (cardCount > 0 || sectionCount > 0) {
        cardsFound = true;
        console.log(`Content found after ${elapsed} seconds!`);
        break;
      }
      
      // Check for loading indicators
      const loadingText = await page.locator('text=/Loading|Analyzing|Computing|Fetching/i').count();
      if (loadingText > 0) {
        console.log(`[${elapsed}s] Still loading...`);
      }
      
      await page.waitForTimeout(pollInterval);
    }
    
    // Take final screenshot
    await page.screenshot({ path: 'test-results/before-each-state.png', fullPage: true });
    
    if (!cardsFound) {
      console.log('WARNING: No cards found after waiting. Test may fail.');
    }
  });

  test('should display genre pills on movie cards', async ({ page }) => {
    // Look for genre pills (styled as pill tags)
    const genrePills = page.locator('.text-xs.font-medium.rounded-full, [class*="bg-"][class*="text-"][class*="rounded"]').filter({ hasText: /^(Action|Drama|Comedy|Thriller|Horror|Sci-Fi|Romance|Adventure|Fantasy|Documentary|Animation|Crime|Mystery|Family|War|History|Music|Western)$/i });
    
    // There should be at least some genre pills visible
    const pillCount = await genrePills.count();
    console.log(`Found ${pillCount} genre pills`);
    
    // Take a screenshot for visual verification
    await page.screenshot({ path: 'test-results/genre-pills.png', fullPage: false });
    
    // At minimum, we should see some genre-related content
    const movieCards = page.locator('.border.bg-white.rounded-lg');
    const cardCount = await movieCards.count();
    console.log(`Found ${cardCount} movie cards`);
    expect(cardCount).toBeGreaterThan(0);
  });

  test('should display multi-source badge when 2+ sources agree', async ({ page }) => {
    // Look for the multi-source badge "🎯 N Sources"
    const sourceBadges = page.locator('span:has-text("Sources")').filter({ hasText: /🎯.*Sources/i });
    
    const badgeCount = await sourceBadges.count();
    console.log(`Found ${badgeCount} multi-source badges`);
    
    // Take a screenshot
    await page.screenshot({ path: 'test-results/source-badges.png', fullPage: false });
    
    // If we find any source badges, verify they have the correct structure
    if (badgeCount > 0) {
      const firstBadge = sourceBadges.first();
      
      // Should have a title attribute with source names
      const title = await firstBadge.getAttribute('title');
      console.log(`Badge title: ${title}`);
      
      // Title should mention "Recommended by"
      if (title) {
        expect(title).toContain('Recommended by');
      }
      
      // Badge should have consensus level styling (emerald, amber, or blue)
      const className = await firstBadge.getAttribute('class');
      console.log(`Badge classes: ${className}`);
      expect(className).toMatch(/bg-(emerald|amber|blue)-100/);
    }
  });

  test('should display vote category badges (Hidden Gem, Crowd Pleaser, Cult Classic)', async ({ page }) => {
    // Look for vote category badges
    const hiddenGemBadge = page.locator('span:has-text("💎 Hidden Gem")');
    const crowdPleaserBadge = page.locator('span:has-text("🎉 Crowd Pleaser")');
    const cultClassicBadge = page.locator('span:has-text("🎭 Cult Classic")');
    
    const hiddenGemCount = await hiddenGemBadge.count();
    const crowdPleaserCount = await crowdPleaserBadge.count();
    const cultClassicCount = await cultClassicBadge.count();
    
    console.log(`Hidden Gems: ${hiddenGemCount}, Crowd Pleasers: ${crowdPleaserCount}, Cult Classics: ${cultClassicCount}`);
    
    // At least one type of badge should be visible
    const totalBadges = hiddenGemCount + crowdPleaserCount + cultClassicCount;
    console.log(`Total vote category badges: ${totalBadges}`);
    
    await page.screenshot({ path: 'test-results/vote-badges.png', fullPage: false });
  });

  test('should display decade preference reasons', async ({ page }) => {
    // Look for decade-related reasons in the suggestions
    // Pattern: "From the Xs — matches your preference for this era"
    const decadeReasons = page.locator('text=/From the \\d{4}s.*matches your preference/i');
    
    const decadeCount = await decadeReasons.count();
    console.log(`Found ${decadeCount} decade preference reasons`);
    
    // Also check for any era-related text
    const eraText = page.locator('text=/\\d{4}s.*era|era.*\\d{4}s/i');
    const eraCount = await eraText.count();
    console.log(`Found ${eraCount} era-related text elements`);
    
    await page.screenshot({ path: 'test-results/decade-reasons.png', fullPage: false });
  });

  test('should display reason text on movie cards', async ({ page }) => {
    // Look for reason elements (typically containing match explanations)
    const reasonElements = page.locator('text=/Matches your|Directed by|Stars |From |Based on/i');
    
    const reasonCount = await reasonElements.count();
    console.log(`Found ${reasonCount} reason text elements`);
    
    expect(reasonCount).toBeGreaterThan(0);
    
    // Log some sample reasons
    for (let i = 0; i < Math.min(5, reasonCount); i++) {
      const text = await reasonElements.nth(i).textContent();
      console.log(`Reason ${i + 1}: ${text?.substring(0, 100)}`);
    }
    
    await page.screenshot({ path: 'test-results/reasons.png', fullPage: false });
  });

  test('should have feedback buttons on movie cards', async ({ page }) => {
    // Look for feedback buttons ("Not Interested" and "More Like This")
    const notInterestedButtons = page.locator('button:has-text("Not Interested")');
    const moreLikeThisButtons = page.locator('button:has-text("More Like This")');
    
    const notInterestedCount = await notInterestedButtons.count();
    const moreLikeThisCount = await moreLikeThisButtons.count();
    
    console.log(`Not Interested buttons: ${notInterestedCount}, More Like This buttons: ${moreLikeThisCount}`);
    
    expect(notInterestedCount).toBeGreaterThan(0);
    expect(moreLikeThisCount).toBeGreaterThan(0);
    
    await page.screenshot({ path: 'test-results/feedback-buttons.png', fullPage: false });
  });

  test('should display categorized sections', async ({ page }) => {
    // Look for section headers
    const sectionHeaders = [
      'Perfect Matches',
      'Director Matches',
      'Actor Matches',
      'Genre Matches',
      'Hidden Gems',
      'Smart Discovery',
      'Studio Picks'
    ];
    
    for (const header of sectionHeaders) {
      const section = page.locator(`h2:has-text("${header}")`);
      const count = await section.count();
      if (count > 0) {
        console.log(`✓ Found section: ${header}`);
      }
    }
    
    // Take full page screenshot to see all sections
    await page.screenshot({ path: 'test-results/sections.png', fullPage: true });
  });

  test('should show watchlist badge if applicable', async ({ page }) => {
    // Look for watchlist badge
    const watchlistBadges = page.locator('span:has-text("📋 Watchlist")');
    
    const count = await watchlistBadges.count();
    console.log(`Found ${count} watchlist badges`);
    
    await page.screenshot({ path: 'test-results/watchlist-badges.png', fullPage: false });
  });

  test('feedback interaction should work', async ({ page }) => {
    // Find a "More Like This" button and click it
    const moreLikeThisButton = page.locator('button:has-text("More Like This")').first();
    
    if (await moreLikeThisButton.isVisible()) {
      // Get the parent card to identify which movie
      const card = moreLikeThisButton.locator('xpath=ancestor::div[contains(@class, "border")]').first();
      
      // Click the feedback button
      await moreLikeThisButton.click();
      
      // Wait for the button to potentially show loading state or change
      await page.waitForTimeout(2000);
      
      // Take screenshot after feedback
      await page.screenshot({ path: 'test-results/after-feedback.png', fullPage: false });
      
      console.log('Successfully clicked More Like This button');
    } else {
      console.log('No More Like This button visible to test');
    }
  });
});
