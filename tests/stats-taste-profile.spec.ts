import { test, expect } from '@playwright/test';

// Test credentials
const TEST_EMAIL = 'jrmilloch2@gmail.com';
const TEST_PASSWORD = 'mshome11';

test.describe('Stats Page - Taste Profile', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to login page
    await page.goto('http://localhost:3000/auth/login');
    
    // Wait for the login form to be visible
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    
    // Fill in login credentials
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASSWORD);
    
    // Click login button
    await page.click('button[type="submit"]');
    
    // Wait for navigation after login (should redirect to home or dashboard)
    await page.waitForURL(/\/(suggest|library|stats|import)?$/, { timeout: 15000 });
    
    // Navigate to stats page
    await page.goto('http://localhost:3000/stats');
    
    // Wait for stats page to load
    await page.waitForSelector('text=Stats', { timeout: 10000 });
  });

  test('should display the Taste Profile section', async ({ page }) => {
    // Wait for TMDB details to load (this can take time)
    // The loading indicator should disappear
    await page.waitForFunction(() => {
      const loadingText = document.body.innerText;
      return !loadingText.includes('Loading TMDB details');
    }, { timeout: 60000 });

    // Check if Taste Profile section exists
    const tasteProfile = page.locator('text=Your Taste Profile');
    
    // Wait for taste profile with a reasonable timeout
    await expect(tasteProfile).toBeVisible({ timeout: 30000 });
    
    console.log('✅ Taste Profile section is visible');
  });

  test('should display genre preferences', async ({ page }) => {
    // Wait for loading to complete
    await page.waitForFunction(() => {
      const loadingText = document.body.innerText;
      return !loadingText.includes('Loading TMDB details');
    }, { timeout: 60000 });

    // Check for Top Genre Preferences section
    const genreSection = page.locator('text=Top Genre Preferences');
    await expect(genreSection).toBeVisible({ timeout: 30000 });
    
    // Check that at least one genre badge exists
    const genreBadges = page.locator('.bg-green-600, .bg-green-400, .bg-green-200');
    const count = await genreBadges.count();
    
    console.log(`✅ Found ${count} genre badges`);
    expect(count).toBeGreaterThan(0);
  });

  test('should display preference strength breakdown', async ({ page }) => {
    // Wait for loading to complete
    await page.waitForFunction(() => {
      const loadingText = document.body.innerText;
      return !loadingText.includes('Loading TMDB details');
    }, { timeout: 60000 });

    // Check for preference strength cards
    const absoluteFavorites = page.locator('text=Absolute Favorites');
    const highlyRated = page.locator('text=Highly Rated');
    const likedFilms = page.locator('text=Liked Films');
    
    await expect(absoluteFavorites).toBeVisible({ timeout: 30000 });
    await expect(highlyRated).toBeVisible({ timeout: 30000 });
    await expect(likedFilms).toBeVisible({ timeout: 30000 });
    
    console.log('✅ Preference strength breakdown is visible');
  });

  test('should display rewatch rate in Algorithm Insights', async ({ page }) => {
    // Wait for loading to complete
    await page.waitForFunction(() => {
      const loadingText = document.body.innerText;
      return !loadingText.includes('Loading TMDB details');
    }, { timeout: 60000 });

    // Check for Algorithm Insights section
    const algorithmInsights = page.locator('text=Algorithm Insights');
    await expect(algorithmInsights).toBeVisible({ timeout: 30000 });
    
    // Check for Rewatch Rate
    const rewatchRate = page.locator('text=Rewatch Rate');
    await expect(rewatchRate).toBeVisible({ timeout: 10000 });
    
    // Get the rewatch rate value
    const rewatchValue = page.locator('div:has-text("Rewatch Rate") >> xpath=following-sibling::div[1] | div:has-text("Rewatch Rate") >> xpath=../div[contains(@class, "text-2xl")]');
    
    // Check that it shows a percentage
    const rateText = await page.locator('.bg-green-50').first().textContent();
    console.log(`✅ Rewatch Rate section content: ${rateText?.substring(0, 100)}...`);
    
    expect(rateText).toContain('%');
  });

  test('should show stats summary cards', async ({ page }) => {
    // Wait for basic stats to load
    await page.waitForSelector('text=Watched', { timeout: 30000 });
    
    // Check for main stat cards
    const watchedCard = page.locator('text=Watched');
    const ratedCard = page.locator('text=Rated');
    const likedCard = page.locator('text=Liked');
    const watchlistCard = page.locator('text=On Watchlist');
    
    await expect(watchedCard).toBeVisible();
    await expect(ratedCard).toBeVisible();
    await expect(likedCard).toBeVisible();
    await expect(watchlistCard).toBeVisible();
    
    console.log('✅ Stats summary cards are visible');
  });
});
