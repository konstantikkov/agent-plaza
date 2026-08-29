import WebSocket from 'ws';
const U = 'wss://foto-attacks-privacy-schedule.trycloudflare.com/api/plaza?room=soak';
const t0 = Date.now();
let pings = 0;
const ws = new WebSocket(U);
ws.on('open', () => { ws.send(JSON.stringify({t:'hello',name:'Soaker',kind:'agent',x:20,z:20})); setInterval(()=>{ws.send(JSON.stringify({t:'ping'}));pings++;}, 25000); });
ws.on('close', () => { console.log(`[${new Date().toISOString()}] CLOSED after ${((Date.now()-t0)/60000).toFixed(1)} min, ${pings} pings`); process.exit(0); });
ws.on('error', (e) => console.log('err', String(e).slice(0,80)));
setTimeout(() => { console.log(`[${new Date().toISOString()}] STILL UP after 16 min, ${pings} pings — persistent WS confirmed`); process.exit(0); }, 16*60000);
