import WebSocket from 'ws';
const ws = new WebSocket('ws://localhost:4000');

ws.on('open', function open() {
  console.log('connected');
});

ws.on('message', function incoming(data) {
  console.log('ws event:', data.toString());
});
