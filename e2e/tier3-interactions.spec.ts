import { test, expect } from '@playwright/test';

const UI_URL = 'http://localhost:5173';

test.describe('Tier 3: Pairwise Interactions', () => {

  test('UI Editor + Node Selection: editing code updates node data', async ({ page }) => {
    await page.goto(UI_URL);
    const codeNode = page.getByText(/^Code$/).first();
    const canvas = page.locator('.react-flow__pane').first();
    await codeNode.dragTo(canvas);
    
    await page.locator('.react-flow__node').first().click();
    const textarea = page.locator('textarea');
    await textarea.fill('console.log("updated")');
    
    // Click away and click back to ensure state is maintained
    await canvas.click({ position: { x: 10, y: 10 } });
    await page.locator('.react-flow__node').first().click();
    await expect(textarea).toHaveValue('console.log("updated")');
  });

  test('WebSocket Console + Execution: UI run triggers socket stream to console', async ({ page }) => {
    await page.goto(UI_URL);
    await page.getByRole('button', { name: 'Run Flow' }).click();
    await expect(page.locator('text=Starting flow execution...')).toBeVisible();
    await expect(page.getByText(/\[flow:done\]/)).toBeVisible();
  });

  test('Palette Drag + Canvas Drop: Dropping node correctly initializes default properties', async ({ page }) => {
    await page.goto(UI_URL);
    const codeNode = page.getByText(/^Code$/).first();
    const canvas = page.locator('.react-flow__pane').first();
    await codeNode.dragTo(canvas);
    
    await page.locator('.react-flow__node').first().click();
    const labelInput = page.locator('input[value="code node"]');
    await expect(labelInput).toBeVisible();
  });

  test('Node deletion: Deleting a node removes it', async ({ page }) => {
    await page.goto(UI_URL);
    const codeNode = page.getByText(/^Code$/).first();
    const canvas = page.locator('.react-flow__pane').first();
    await codeNode.dragTo(canvas);
    
    await page.locator('.react-flow__node').first().click();
    await page.keyboard.press('Backspace');
    await expect(page.locator('.react-flow__node')).toHaveCount(0);
  });

});
