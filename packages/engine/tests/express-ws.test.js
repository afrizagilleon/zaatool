import express from 'express';
import { WebSocketServer } from 'ws';
const app = express();
const server = app.listen(4001, () => console.log('Listening'));
const wss = new WebSocketServer({ server });
console.log('WSS setup done');
