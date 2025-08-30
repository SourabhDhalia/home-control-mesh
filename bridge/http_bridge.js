const http = require('http');
const mqtt = require('mqtt');
const { v4: uuid } = require('uuid');

const BROKER = process.env.BROKER || '127.0.0.1';
const PORT   = parseInt(process.env.PORT || '1883', 10);
const USER   = process.env.MQTT_USER || 'homeuser';
const PASS   = process.env.MQTT_PASS || 'changeme';
const HTTPP  = parseInt(process.env.HTTP_PORT || '8080', 10);

const mq = mqtt.connect(`mqtt://${BROKER}:${PORT}`, { username: USER, password: PASS });

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'use POST' });
  const m = req.url.match(/^\/rpc\/([^/]+)\/([^/]+)$/);
  if (!m) return json(res, 404, { error: 'use /rpc/:room/:device' });

  const room = m[1], device = m[2];
  let body = '';
  req.on('data', d => body += d);
  req.on('end', () => {
    try {
      const payload = JSON.parse(body || '{}');
      const corr = uuid();
      const replyTo = `home/resp/http/${corr}`;
      const reqTopic = `home/${room}/${device}/rpc/req`;
      const timeout = Math.min(Math.max(payload.timeout_ms || 5000, 100), 20000);

      const handler = (topic, buf) => {
        if (topic !== replyTo) return;
        mq.removeListener('message', handler);
        clearTimeout(timer);
        try { json(res, 200, JSON.parse(buf.toString())); } catch { json(res, 200, { raw: buf.toString() }); }
      };

      mq.subscribe(replyTo, { qos: 1 }, () => {
        mq.on('message', handler);
        mq.publish(reqTopic, JSON.stringify({ ...payload, corr, reply_to: replyTo, timeout_ms: timeout }), { qos: 1 });
        timer = setTimeout(() => {
          mq.removeListener('message', handler);
          json(res, 504, { corr, ok:false, error:'timeout' });
        }, timeout);
      });

      var timer;
    } catch (e) {
      json(res, 400, { error: String(e) });
    }
  });
});

server.listen(HTTPP, () => console.log(`HTTP → MQTT bridge on :${HTTPP}`));
