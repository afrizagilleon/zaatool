import { runFlow } from '../src/core/flow-runner.js';
import { EventEmitter } from 'events';
import { GraphJson } from '@zaa-tool/shared';

const graph: GraphJson = {
    "version": "1.0",
    "id": "test_graph",
    "name": "Test Graph",
    "nodes": [
        {
            "id": "node_py",
            "type": "code",
            "runtime": "python",
            "position": { "x": 0, "y": 0 },
            "data": {
                "label": "PY Node",
                "code": "def main(inputs):\n    import sys\n    print('hello from py err', file=sys.stderr)\n    return {'out': 'test_py'}",
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
