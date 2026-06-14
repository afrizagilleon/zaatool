import { runFlow } from './runner/flow-runner.js';
import { EventEmitter } from 'events';
import { GraphJson } from '@zaa-tool/shared';

const graph: GraphJson = {
    "version": "1.0",
    "id": "test_graph",
    "name": "Test Graph",
    "nodes": [
        {
            "id": "node1",
            "type": "code",
            "runtime": "node",
            "position": { "x": 0, "y": 0 },
            "data": {
                "label": "JS Node",
                "code": "function main(inputs) { console.log('hello from JS'); return { out: 'test' }; }",
                "inputsSchema": [],
                "outputsSchema": []
            }
        }
    ],
    "edges": []
};

const ee = new EventEmitter();
ee.on('node:start', console.log);
ee.on('node:log', console.log);
ee.on('node:done', console.log);
ee.on('node:error', console.log);
ee.on('flow:done', console.log);

runFlow(graph, ee).catch(console.error);
