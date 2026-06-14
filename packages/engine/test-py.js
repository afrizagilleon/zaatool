const graph = {
    "nodes": [
        {
            "id": "node_py",
            "type": "code",
            "runtime": "python",
            "data": {
                "label": "PY Node",
                "code": "def main(inputs):\n    import sys\n    print('hello from py err', file=sys.stderr)\n    return {'out': 'test_py'}"
            }
        }
    ],
    "edges": []
};

fetch('http://localhost:4000/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(graph)
}).then(res => res.json()).then(console.log).catch(console.error);
