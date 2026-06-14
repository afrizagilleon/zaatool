import { test, expect } from '@playwright/test';

const API_URL = 'http://localhost:4000';
const UI_URL = 'http://localhost:5173';

test.describe('Tier 2: Boundary Value Analysis', () => {

  test.describe('API payload boundaries', () => {
    test('POST /api/run with massive payload (1000 nodes)', async ({ request }) => {
      const massiveNodes = Array.from({ length: 1000 }).map((_, i) => ({ id: `n${i}`, type: 'code' }));
      const response = await request.post(`${API_URL}/api/run`, {
        data: { nodes: massiveNodes, edges: [] }
      });
      expect(response.status()).toBe(200);
    });

    test('POST /api/run with deeply nested node configs', async ({ request }) => {
      const response = await request.post(`${API_URL}/api/run`, {
        data: { nodes: [{ id: '1', type: 'code', data: { nested: { nested: { val: true } } } }], edges: [] }
      });
      expect(response.status()).toBe(200);
    });

    test('POST /api/run with special characters in node IDs', async ({ request }) => {
      const response = await request.post(`${API_URL}/api/run`, {
        data: { nodes: [{ id: '!@#$%^&*()', type: 'code' }], edges: [] }
      });
      expect(response.status()).toBe(200);
    });

    test('POST /api/run with empty nodes but existing edges', async ({ request }) => {
      const response = await request.post(`${API_URL}/api/run`, {
        data: { nodes: [], edges: [{ id: 'e1', source: 'n1', target: 'n2' }] }
      });
      // It passes the basic schema check, returns 200
      expect(response.status()).toBe(200);
    });

    test('POST /api/run with completely empty JSON object', async ({ request }) => {
      const response = await request.post(`${API_URL}/api/run`, { data: {} });
      expect(response.status()).toBe(400);
    });
  });

  test.describe('UI Canvas Boundaries', () => {
    test('Canvas allows placing nodes', async ({ page }) => {
      await page.goto(UI_URL);
      const codeNode = page.getByText(/^Code$/).first();
      const canvas = page.locator('.react-flow__pane').first();
      await codeNode.dragTo(canvas, { targetPosition: { x: -100, y: -100 } });
      await expect(page.locator('.react-flow__node').first()).toBeVisible();
    });

    test('Canvas handles rapid dragging of nodes', async ({ page }) => {
      await page.goto(UI_URL);
      const codeNode = page.getByText(/^Code$/).first();
      const canvas = page.locator('.react-flow__pane').first();
      await codeNode.dragTo(canvas);
      await codeNode.dragTo(canvas);
      await codeNode.dragTo(canvas);
      await expect(page.locator('.react-flow__node')).toHaveCount(3);
    });
  });

  test.describe('Code Editor Boundaries', () => {
    test('Editor accepts extremely long code strings (10,000+ chars)', async ({ page }) => {
      await page.goto(UI_URL);
      const codeNode = page.getByText(/^Code$/).first();
      const canvas = page.locator('.react-flow__pane').first();
      await codeNode.dragTo(canvas);
      await page.locator('.react-flow__node').first().click();
      
      const textarea = page.locator('textarea');
      const longString = 'a'.repeat(10000);
      await textarea.fill(longString);
      await expect(textarea).toHaveValue(longString);
    });

    test('Editor handles unicode/emoji characters correctly', async ({ page }) => {
      await page.goto(UI_URL);
      const codeNode = page.getByText(/^Code$/).first();
      const canvas = page.locator('.react-flow__pane').first();
      await codeNode.dragTo(canvas);
      await page.locator('.react-flow__node').first().click();
      
      const textarea = page.locator('textarea');
      await textarea.fill('🚀 Hello 🌎');
      await expect(textarea).toHaveValue('🚀 Hello 🌎');
    });

    test('Editor gracefully handles empty code strings', async ({ page }) => {
      await page.goto(UI_URL);
      const codeNode = page.getByText(/^Code$/).first();
      const canvas = page.locator('.react-flow__pane').first();
      await codeNode.dragTo(canvas);
      await page.locator('.react-flow__node').first().click();
      
      const textarea = page.locator('textarea');
      await textarea.fill('');
      await expect(textarea).toHaveValue('');
    });
  });

});
