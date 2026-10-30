import { expect, test } from '@playwright/test';

test('protected pages require the family login', async ({ page }) => {
  await page.goto('/ask');
  await expect(page).toHaveURL(/\/login$/u);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByRole('link', { name: /create account|sign up/iu })).toHaveCount(0);
});

test('login offers password recovery and has no public registration flow', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Forgot password?' })).toBeVisible();
  await expect(page.getByRole('link', { name: /create account|sign up/iu })).toHaveCount(0);
});

test('the development preview keeps the home screen simple and event timing visible', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-30T12:00:00.000Z') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?preview=home');
  await expect(page.getByRole('heading', { name: 'What would you like to do?' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Remember something/iu })).toBeVisible();
  await expect(page.getByRole('link', { name: /Ask your memory/iu })).toBeVisible();
  await expect(page.getByText('Bank appointment')).toBeVisible();
  await expect(page.getByText('Tomorrow')).toBeVisible();
});
