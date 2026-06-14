import { test, expect } from '@playwright/test';

const UI_URL = 'http://localhost:5173';
const API_URL = 'http://localhost:4000';

test.describe('Tier 4: Realistic Application Scenarios', () => {

  test('Scenario 1: Simple flow (code -> code) run via API', async ({ request }) => {
    const simpleFlow = {
      nodes: [
        { id: '1', type: 'code', data: { code: 'console.log("first")' } },
        { id: '2', type: 'code', data: { code: 'console.log("second")' } }
      ],
      edges: [
        { id: 'e1-2', source: '1', target: '2' }
      ]
    };
    
    const response = await request.post(`${API_URL}/api/run`, { data: simpleFlow });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ status: 'started' });
  });

  test('Scenario 2: Visual flow creation and execution from UI', async ({ page }) => {
    await page.goto(UI_URL);
    const codeNode = page.getByText(/^Code$/).first();
    const canvas = page.locator('.react-flow__pane').first();
    
    // Drag nodes
    await codeNode.dragTo(canvas, { targetPosition: { x: 100, y: 100 } });
    
    // Edit code in editor
    await page.locator('.react-flow__node').first().click();
    await page.locator('textarea').fill('console.log("hello from UI")');
    
    // Click Run
    await page.getByRole('button', { name: 'Run Flow' }).click();
    
    // Verify Console logs
    await expect(page.locator('text=Starting flow execution...')).toBeVisible();
    await expect(page.getByText(/\[flow:done\]/)).toBeVisible();
  });

  test('Scenario 3: Developing a flow with an If condition via API', async ({ request }) => {
    const complexFlow = {
      nodes: [
        { id: '1', type: 'code', data: { code: 'return { value: 10 }' } },
        { id: '2', type: 'if', data: { condition: 'input.value > 5' } }
      ],
      edges: [
        { id: 'e1-2', source: '1', target: '2' }
      ]
    };
    
    const response = await request.post(`${API_URL}/api/run`, { data: complexFlow });
    expect(response.status()).toBe(200);
  });

  test('Scenario 4: Recovering from execution error during flow build', async ({ page }) => {
    await page.goto(UI_URL);
    const codeNode = page.getByText(/^Code$/).first();
    const canvas = page.locator('.react-flow__pane').first();
    await codeNode.dragTo(canvas);
    
    await page.locator('.react-flow__node').first().click();
    await page.locator('textarea').fill('throw new Error("test error")');
    
    await page.getByRole('button', { name: 'Run Flow' }).click();
    
    // See error in console
    await expect(page.getByText(/test error/)).toBeVisible();
    
    // Fix error
    await page.locator('textarea').fill('console.log("fixed")');
    await page.getByRole('button', { name: 'Run Flow' }).click();
    
    // Success
    await expect(page.getByText(/fixed/)).toBeVisible();
  });

});
