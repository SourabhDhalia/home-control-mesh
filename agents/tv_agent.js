const mqtt = require('mqtt');
const { execFile, exec } = require('child_process');

const BROKER = process.env.BROKER || '127.0.0.1';
const PORT   = parseInt(process.env.PORT || '1883', 10);
const USER   = process.env.MQTT_USER || 'homeuser';
const PASS   = process.env.MQTT_PASS || 'changeme';
const ROOM   = process.env.ROOM || 'livingroom';
const DEV    = process.env.DEVICE || 'androidtv';
const TVIP   = process.env.TV_IP || '192.168.29.120';

const REQ    = `home/${ROOM}/${DEV}/rpc/req`;
const HB     = `home/${ROOM}/${DEV}/hb`;
const STATUS = `home/${ROOM}/${DEV}/status`;

const client = mqtt.connect(`mqtt://${BROKER}:${PORT}`, { username: USER, password: PASS, clientId: `tv-${DEV}` });

function reply(meta, body) {
  const corr = (meta && meta.corr) || `${Date.now()}`;
  const rt = (meta && meta.reply_to) || `home/resp/${DEV}/${corr}`;
  client.publish(rt, JSON.stringify({ corr, ...body }), { qos: 1 });
}

function adb(args, cb) {
  execFile('adb', args, { timeout: 6000 }, cb);
}

client.on('connect', () => {
  client.subscribe(REQ, { qos: 1 });
  client.publish(STATUS, 'online', { retain: true });
  setInterval(() => client.publish(HB, JSON.stringify({ ts: Math.floor(Date.now()/1000) }), { retain: true }), 10000);
  exec(`adb connect ${TVIP}`);
});

client.on('message', (_topic, payload) => {
  let p = {};
  try { p = JSON.parse(payload.toString()); } catch { return; }
  if (p.cmd === 'launch_app') {
    const app = p.args?.app || 'com.google.android.youtube.tv';
    adb(['shell','monkey','-p', app, '-c','android.intent.category.LAUNCHER','1'], (e) =>
      reply(p, e ? { ok:false, error:String(e) } : { ok:true, data:{ app }})
    );
  } else if (p.cmd === 'key') {
    const key = p.args?.code || 'KEYCODE_HOME';
    adb(['shell','input','keyevent', key], (e) => reply(p, e ? { ok:false, error:String(e) } : { ok:true, data:{ key }}));
  } else if (p.cmd === 'power') {
    adb(['shell','input','keyevent','KEYCODE_POWER'], (e) => reply(p, e ? { ok:false, error:String(e) } : { ok:true }));
  } else if (p.cmd === 'ping') {
    reply(p, { ok:true, data:{ pong:true } });
  } else {
    reply(p, { ok:false, error:`unknown cmd ${p.cmd}` });
  }
});
