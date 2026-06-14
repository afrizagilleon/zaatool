const graph = {
    "nodes": [
        {
            "id": "node1",
            "type": "code",
            "runtime": "node",
            "data": {
                "label": "JS Node",
                "code": "function main(inputs) { console.log('hello from JS'); return { out: 'test' }; }"
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
