// Two simulated agents meet on the plaza: join, collide on a name, move,
// talk, hear, leave. Usage: node scripts/plaza-smoke.mjs [wss://host/api/plaza]
import WebSocket from 'ws';

const base = process.argv[2] ?? 'ws://localhost:8787/api/plaza';
const url = `${base}?room=smoke-test`;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

function connect(tag) {
  const ws = new WebSocket(url);
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw));
    inbox.push(msg);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].pred(msg)) waiters.splice(i, 1)[0].resolve(msg);
    }
  });
  const waitFor = (pred, ms = 5000) =>
    new Promise((resolve, reject) => {
      const hit = inbox.find(pred);
      if (hit) return resolve(hit);
      const timer = setTimeout(() => reject(new Error(`${tag}: timeout waiting`)), ms);
      waiters.push({ pred, resolve: (m) => { clearTimeout(timer); resolve(m); } });
    });
  const send = (m) => ws.send(JSON.stringify(m));
  const open = new Promise((resolve) => ws.on('open', resolve));
  return { ws, send, waitFor, open, inbox };
}

const alice = connect('alice');
await alice.open;
alice.send({ t: 'hello', name: 'Alice', kind: 'agent', color: 0xf06d9a, x: 10, z: 12 });
const w1 = await alice.waitFor((m) => m.t === 'welcome');
check('alice joins, gets welcome', w1.agents.length === 1 && w1.agents[0].name === 'Alice');

const bob = connect('bob');
await bob.open;
bob.send({ t: 'hello', name: 'alice', kind: 'agent', x: 20, z: 20 });
const err = await bob.waitFor((m) => m.t === 'error');
check('duplicate name rejected', err.code === 'name-taken');

bob.send({ t: 'hello', name: 'Bob', kind: 'agent', color: 0x5aa4e8, x: 20, z: 20 });
const w2 = await bob.waitFor((m) => m.t === 'welcome');
check('bob joins, sees alice', w2.agents.some((a) => a.name === 'Alice'));
const joined = await alice.waitFor((m) => m.t === 'joined');
check('alice notified of bob', joined.agent.name === 'Bob');

bob.send({ t: 'move', x: 11, z: 12, layer: 'surface' });
const moved = await alice.waitFor((m) => m.t === 'moved');
check('movement broadcast', moved.x === 11 && moved.z === 12);

bob.send({ t: 'say', text: 'Hello Alice, nice plaza!' });
const said = await alice.waitFor((m) => m.t === 'said');
check('chat broadcast with position', said.name === 'Bob' && said.x === 11 && said.text.includes('nice plaza'));

alice.send({ t: 'say', text: 'Welcome, Bob 👋' });
const reply = await bob.waitFor((m) => m.t === 'said' && m.name === 'Alice');
check('reply heard by bob', reply.text.includes('Welcome'));

// late joiner receives the backlog
const carol = connect('carol');
await carol.open;
carol.send({ t: 'hello', name: 'Carol', kind: 'human', x: 5, z: 5 });
const w3 = await carol.waitFor((m) => m.t === 'welcome');
check('late joiner gets msg backlog', w3.msgs.some((m) => m.text?.includes('nice plaza')), `${w3.msgs.length} msgs`);
check('late joiner sees both agents', w3.agents.length === 3);

// reconnect inside the grace window: same identity, zero left/arrived churn
const bobId = joined.agent.id;
bob.ws.close();
await new Promise((r) => setTimeout(r, 1200));
const bob2 = connect('bob2');
await bob2.open;
bob2.send({ t: 'hello', name: 'Bob', kind: 'agent', x: 11, z: 12 });
const w4 = await bob2.waitFor((m) => m.t === 'welcome');
check('grace reconnect keeps the same id', w4.agents.some((a) => a.name === 'Bob' && a.id === bobId));

// a real departure (carol) is announced after the grace period; bob's blip is not
carol.ws.close();
const carolLeft = await alice.waitFor((m) => m.t === 'left' && m.name === 'Carol', 15000);
check('real leave announced after grace', !!carolLeft);
check('reconnect blip stayed silent', !alice.inbox.some((m) => m.t === 'left' && m.name === 'Bob'));

// tool usage reaches the activity log
bob2.send({ t: 'tool', tool: 'walk_to' });
const toolMsg = await alice.waitFor((m) => m.t === 'tool');
check('tool usage broadcast', toolMsg.name === 'Bob' && toolMsg.text === 'walk_to' && toolMsg.kind === 'tool');

const bad = connect('bad');
await bad.open;
bad.send({ t: 'say', text: 'sneaky' });
const notJoined = await bad.waitFor((m) => m.t === 'error');
check('talking before hello rejected', notJoined.code === 'not-joined');

for (const c of [alice, bob2, bad]) c.ws.close();
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
process.exit(failed.length ? 1 : 0);
