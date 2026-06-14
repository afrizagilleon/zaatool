import { create } from 'zustand/vanilla';
import { useEngineStore } from './src/store/engineStore.js';
import { EventEmitter } from 'events';

// Mock fetch
global.fetch = async (url, options) => {
    return { ok: true, status: 200 } as any;
};

// Mock WebSocket
class MockWebSocket extends EventEmitter {
    constructor(url: string) {
        super();
        setTimeout(() => {
            this.onopen && this.onopen();
            this.onmessage({ data: JSON.stringify({ event: 'node:start', nodeId: 'node_1' }) });
            this.onmessage({ data: JSON.stringify({ event: 'node:log', nodeId: 'node_1', payload: 'Hello' }) });
            this.onmessage({ data: JSON.stringify({ event: 'flow:done', payload: { executionId: '123' } }) });
        }, 10);
    }
    close() {
        this.onclose && this.onclose();
    }
    onopen() {}
    onmessage(event: any) {}
    onclose() {}
    onerror() {}
}
(global as any).WebSocket = MockWebSocket;

const store = useEngineStore.getState();
console.log("Initial isRunning:", store.isRunning);
console.log("Initial logs:", store.logs);

store.runFlow({ version: "1.0", id: "flow-1", name: "Flow", nodes: [], edges: [] });

console.log("After runFlow isRunning:", useEngineStore.getState().isRunning);

setTimeout(() => {
    const finalStore = useEngineStore.getState();
    console.log("Final isRunning:", finalStore.isRunning);
    console.log("Final logs:");
    finalStore.logs.forEach(log => console.log(log));
    
    if (!finalStore.isRunning && finalStore.logs.length >= 3) {
        console.log("ENGINE STORE SUCCESS");
    } else {
        console.log("ENGINE STORE FAILURE");
        process.exit(1);
    }
}, 50);
