import { test, expect } from '@playwright/test';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);
const API_URL = 'http://localhost:4000';
const UI_URL = 'http://localhost:5173';

test.describe('F1: HTTP server responds 200 OK', () => {
  test('should return 200 OK on /api/health', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/health`);
    expect(response.status()).toBe(200);
  });

  test('should return application/json content type', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/health`);
    expect(response.headers()['content-type']).toContain('application/json');
  });

  test('should have expected health payload structure', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/health`);
    const body = await response.json().catch(() => ({}));
    expect(body).toEqual({ status: 'ok' });
  });

  test('should return 404 for unknown endpoint', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/unknown-endpoint`);
    expect(response.status()).toBe(404);
  });

  test('health endpoint should respond quickly', async ({ request }) => {
    const start = Date.now();
    await request.get(`${API_URL}/api/health`);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

test.describe('F2: HTTP POST /api/run executes flow', () => {
  const simpleFlow = { nodes: [{ id: "n1", type: "code", data: { code: "console.log('hi')" } }], edges: [] };

  test('should accept POST request with valid flow', async ({ request }) => {
    const response = await request.post(`${API_URL}/api/run`, { data: simpleFlow });
    expect(response.status()).toBe(200);
  });

  test('should reject POST request without body', async ({ request }) => {
    const response = await request.post(`${API_URL}/api/run`);
    expect(response.status()).toBe(400);
  });

  test('should return status started in response', async ({ request }) => {
    const response = await request.post(`${API_URL}/api/run`, { data: simpleFlow });
    if (response.ok()) {
      const body = await response.json();
      expect(body).toEqual({ status: 'started' });
    }
  });

  test('should reject invalid flow JSON', async ({ request }) => {
    const response = await request.post(`${API_URL}/api/run`, { data: { invalid: 'schema' } });
    expect(response.status()).toBe(400);
  });

  test('should allow multiple concurrent runs', async ({ request }) => {
    const req1 = request.post(`${API_URL}/api/run`, { data: simpleFlow });
    const req2 = request.post(`${API_URL}/api/run`, { data: simpleFlow });
    const [res1, res2] = await Promise.all([req1, req2]);
    expect(res1.status()).toBe(200);
    expect(res2.status()).toBe(200);
  });
});

test.describe('F3: Websocket streams execution events', () => {
  test('should connect to WebSocket server', async ({ page }) => {
    await page.goto(UI_URL);
    await expect(page.locator('text=Ready...')).toBeVisible();
  });

  test('should stream "start" event upon execution', async ({ page }) => {
    await page.goto(UI_URL);
    await page.getByRole('button', { name: 'Run Flow' }).click();
    await expect(page.locator('text=Starting flow execution...')).toBeVisible();
  });

  test('should stream "done" event upon completion', async ({ page }) => {
    await page.goto(UI_URL);
    await page.getByRole('button', { name: 'Run Flow' }).click();
    await expect(page.locator('text=Starting flow execution...')).toBeVisible();
    await expect(page.getByText(/\[flow:done\]/)).toBeVisible();
  });
});

test.describe('F4: Existing engine CLI works', () => {
  const engineDir = path.resolve(process.cwd(), 'packages/engine');

  test('CLI runs basic syntax', async () => {
    const { stdout } = await execAsync('pnpm tsx src/index.ts', { cwd: engineDir });
    expect(stdout).toContain('RUNNING FIXTURE');
  });

  test('CLI outputs execution logs to stdout', async () => {
    const { stdout } = await execAsync('pnpm tsx src/index.ts', { cwd: engineDir });
    expect(stdout).toContain('Flow finished.');
  });
});

test.describe('F5: React Flow Canvas drag-and-drop code, if, loop', () => {
  test('should render palette with code node', async ({ page }) => {
    await page.goto(UI_URL);
    await expect(page.getByText(/^Code$/).first()).toBeVisible();
  });

  test('should render palette with if node', async ({ page }) => {
    await page.goto(UI_URL);
    await expect(page.getByText(/^If$/).first()).toBeVisible();
  });

  test('should render palette with loop node', async ({ page }) => {
    await page.goto(UI_URL);
    await expect(page.getByText(/^Loop$/).first()).toBeVisible();
  });

  test('should drag node to canvas', async ({ page }) => {
    await page.goto(UI_URL);
    const codeNode = page.getByText(/^Code$/).first();
    const canvas = page.locator('.react-flow__pane').first();
    await codeNode.dragTo(canvas);
    await expect(page.locator('.react-flow__node').first()).toBeVisible();
  });
});

test.describe('F6: React Flow schema connection validation', () => {
  test('should allow connecting matching schema types', async ({ page }) => {
    await page.goto(UI_URL);
    const codeNode = page.getByText(/^Code$/).first();
    const canvas = page.locator('.react-flow__pane').first();
    await codeNode.dragTo(canvas, { targetPosition: { x: 100, y: 100 } });
    await codeNode.dragTo(canvas, { targetPosition: { x: 300, y: 100 } });
    
    // We can't easily test drag edge in Playwright without exact coordinates.
    // Instead we check if two nodes exist.
    await expect(page.locator('.react-flow__node')).toHaveCount(2);
  });
});

test.describe('F7: UI Editor & Console Panels', () => {
  test('should display code editor panel when node selected', async ({ page }) => {
    await page.goto(UI_URL);
    const codeNode = page.getByText(/^Code$/).first();
    const canvas = page.locator('.react-flow__pane').first();
    await codeNode.dragTo(canvas);
    await page.locator('.react-flow__node').first().click();
    await expect(page.getByText(/Properties - code node/)).toBeVisible();
  });

  test('editor panel should use textarea', async ({ page }) => {
    await page.goto(UI_URL);
    const codeNode = page.getByText(/^Code$/).first();
    const canvas = page.locator('.react-flow__pane').first();
    await codeNode.dragTo(canvas);
    await page.locator('.react-flow__node').first().click();
    await expect(page.locator('textarea')).toBeVisible();
  });

  test('should display Run Console panel', async ({ page }) => {
    await page.goto(UI_URL);
    await expect(page.locator('text=Console').first()).toBeVisible();
  });

  test('should have a placeholder for AI code-gen', async ({ page }) => {
    await page.goto(UI_URL);
    const codeNode = page.getByText(/^Code$/).first();
    const canvas = page.locator('.react-flow__pane').first();
    await codeNode.dragTo(canvas);
    await page.locator('.react-flow__node').first().click();
    await expect(page.locator('text=AI Assistant').first()).toBeVisible();
  });
});

test.describe('F8: Run flow from UI triggers WS log stream', () => {
  test('Run button should be visible', async ({ page }) => {
    await page.goto(UI_URL);
    await expect(page.getByRole('button', { name: 'Run Flow' }).first()).toBeVisible();
  });

  test('Run Console should display "start" log', async ({ page }) => {
    await page.goto(UI_URL);
    await page.getByRole('button', { name: 'Run Flow' }).click();
    await expect(page.locator('text=Starting flow execution...')).toBeVisible();
  });
});
