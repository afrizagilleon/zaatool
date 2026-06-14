import { create } from 'zustand/vanilla';
import { useFlowStore } from './src/store/flowStore.js';

console.log("Creating store instance...");
const store = useFlowStore.getState();

console.log("Initial activeNodeId:", store.activeNodeId);

store.addNode({
  id: "node_1",
  type: "code",
  position: { x: 0, y: 0 },
  data: {
    label: "Node 1",
    inputsSchema: [{ name: "input1", type: "string" }],
    outputsSchema: [{ name: "output1", type: "number" }],
  }
});

store.addNode({
  id: "node_2",
  type: "code",
  position: { x: 100, y: 0 },
  data: {
    label: "Node 2",
    inputsSchema: [{ name: "input1", type: "string" }],
    outputsSchema: [{ name: "output1", type: "string" }],
  }
});

console.log("Nodes count:", useFlowStore.getState().nodes.length);
console.log("GraphJSON:", JSON.stringify(useFlowStore.getState().getGraphJson(), null, 2));

store.setActiveNodeId("node_1");
console.log("Active node:", useFlowStore.getState().activeNodeId);

store.updateNodeData("node_1", { code: "console.log('hello');" });
console.log("Node 1 code after update:", useFlowStore.getState().nodes.find(n => n.id === "node_1")?.data.code);

console.log("Testing connection validation logic (extracted from App.tsx)...");

const nodes = useFlowStore.getState().nodes;

const isValidConnection = (connection: any) => {
    const { source, target, sourceHandle, targetHandle } = connection;
    if (!source || !target || !sourceHandle || !targetHandle) return false;

    const sourceNode = nodes.find((n) => n.id === source);
    const targetNode = nodes.find((n) => n.id === target);

    if (!sourceNode || !targetNode) return false;

    const outField = sourceNode.data.outputsSchema?.find((f: any) => f.name === sourceHandle);
    const inField = targetNode.data.inputsSchema?.find((f: any) => f.name === targetHandle);

    if (!outField || !inField) return false;

    return outField.type === inField.type;
};

const validConn = { source: "node_2", sourceHandle: "output1", target: "node_1", targetHandle: "input1" }; // string -> string
const invalidConn = { source: "node_1", sourceHandle: "output1", target: "node_2", targetHandle: "input1" }; // number -> string

console.log("Valid string -> string connection:", isValidConnection(validConn));
console.log("Invalid number -> string connection:", isValidConnection(invalidConn));

if (isValidConnection(validConn) === true && isValidConnection(invalidConn) === false) {
    console.log("SUCCESS");
} else {
    console.log("FAILURE");
    process.exit(1);
}
