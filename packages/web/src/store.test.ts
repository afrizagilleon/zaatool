import { describe, it, expect, beforeEach } from 'vitest';
import { useFlowStore } from './store/flowStore';

describe('Flow Store and Canvas Validation', () => {
  beforeEach(() => {
    // Reset store
    useFlowStore.setState({ nodes: [], edges: [], activeNodeId: null });
  });

  it('adds nodes and gets graph json correctly', () => {
    const store = useFlowStore.getState();
    store.addNode({
      id: 'node-1',
      type: 'code',
      position: { x: 0, y: 0 },
      data: {
        label: 'My Code',
        inputsSchema: [{ name: 'in1', type: 'string' }],
        outputsSchema: [{ name: 'out1', type: 'number' }],
      }
    } as any);

    const updatedStore = useFlowStore.getState();
    expect(updatedStore.nodes.length).toBe(1);
    expect(updatedStore.nodes[0].data.label).toBe('My Code');

    const graphJson = updatedStore.getGraphJson();
    expect(graphJson.nodes.length).toBe(1);
    expect(graphJson.nodes[0].type).toBe('code');
  });

  it('validates schema correctly using the App.tsx logic', () => {
    const store = useFlowStore.getState();
    
    // Add a source node and a target node
    store.addNode({
      id: 'source-node',
      type: 'code',
      position: { x: 0, y: 0 },
      data: {
        outputsSchema: [
          { name: 'out-str', type: 'string' },
          { name: 'out-num', type: 'number' }
        ],
      }
    } as any);

    store.addNode({
      id: 'target-node',
      type: 'code',
      position: { x: 100, y: 0 },
      data: {
        inputsSchema: [
          { name: 'in-str', type: 'string' },
          { name: 'in-num', type: 'number' }
        ],
      }
    } as any);

    // Reproduce isValidConnection from App.tsx
    const isValidConnection = (connection: any) => {
      const { source, target, sourceHandle, targetHandle } = connection;
      if (!source || !target || !sourceHandle || !targetHandle) return false;

      const sourceNode = useFlowStore.getState().nodes.find((n) => n.id === source);
      const targetNode = useFlowStore.getState().nodes.find((n) => n.id === target);

      if (!sourceNode || !targetNode) return false;

      const outField = sourceNode.data.outputsSchema?.find((f: any) => f.name === sourceHandle);
      const inField = targetNode.data.inputsSchema?.find((f: any) => f.name === targetHandle);

      if (!outField || !inField) return false;

      return outField.type === inField.type;
    };

    // Valid connections
    expect(isValidConnection({
      source: 'source-node',
      target: 'target-node',
      sourceHandle: 'out-str',
      targetHandle: 'in-str'
    })).toBe(true);

    expect(isValidConnection({
      source: 'source-node',
      target: 'target-node',
      sourceHandle: 'out-num',
      targetHandle: 'in-num'
    })).toBe(true);

    // Invalid connections (type mismatch)
    expect(isValidConnection({
      source: 'source-node',
      target: 'target-node',
      sourceHandle: 'out-str',
      targetHandle: 'in-num'
    })).toBe(false);

    expect(isValidConnection({
      source: 'source-node',
      target: 'target-node',
      sourceHandle: 'out-num',
      targetHandle: 'in-str'
    })).toBe(false);

    // Invalid connections (missing handles)
    expect(isValidConnection({
      source: 'source-node',
      target: 'target-node',
      sourceHandle: 'out-missing',
      targetHandle: 'in-str'
    })).toBe(false);
  });
});
