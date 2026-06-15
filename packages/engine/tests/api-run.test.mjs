import { WebSocket } from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const graphPath = path.join(__dirname, '..', 'src', 'fixtures', 'log-flow.json');
const graphJson = JSON.parse(fs.readFileSync(graphPath, 'utf8'));

const ws = new WebSocket('ws://localhost:4000');

ws.on('open', async () => {
    console.log('WS connected. Sending run request...');
    const res = await fetch('http://localhost:4000/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(graphJson)
    });
    console.log('Run response:', res.status);
});

let messageCount = 0;
ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    console.log('WS Msg:', msg);
    messageCount++;
    if (msg.type === 'flow:done' || msg.type === 'flow:error') {
        console.log(`Received ${messageCount} messages. Exiting.`);
        ws.close();
        process.exit(0);
    }
});

setTimeout(() => {
    console.log('Timeout. Exiting.');
    ws.close();
    process.exit(1);
}, 10000);
