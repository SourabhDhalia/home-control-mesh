import os, json, time, uuid, subprocess
import paho.mqtt.client as mqtt

BROKER=os.getenv("BROKER","127.0.0.1")
PORT=int(os.getenv("PORT","1883"))
USER=os.getenv("MQTT_USER","homeuser")
PASS=os.getenv("MQTT_PASS","changeme")
ROOM=os.getenv("ROOM","office")
DEVICE=os.getenv("DEVICE_ID","deskpc")

REQ=f"home/{ROOM}/{DEVICE}/rpc/req"
HB=f"home/{ROOM}/{DEVICE}/hb"
STATUS=f"home/{ROOM}/{DEVICE}/status"

def reply(client, req_body, req_meta):
    corr = req_meta.get("corr") or str(uuid.uuid4())
    rt = req_meta.get("reply_to", f"home/resp/{DEVICE}/{corr}")
    client.publish(rt, json.dumps(req_body), qos=1)

def on_message(client, _, message):
    meta = {}
    resp = {"ok": False, "corr": None}
    try:
        meta = json.loads(message.payload.decode())
        resp["corr"] = meta.get("corr")
        cmd = meta.get("cmd"); args = meta.get("args", {})
        if cmd == "wol":
            mac = args["mac"]
            subprocess.check_call(["etherwake", mac])
            resp.update(ok=True, data={"sent": mac})
        elif cmd == "run":
            out = subprocess.check_output(args["sh"], shell=True,
                                          stderr=subprocess.STDOUT, timeout=30)
            resp.update(ok=True, data={"out": out.decode()})
        elif cmd == "ping":
            resp.update(ok=True, data={"pong": True})
        else:
            resp.update(ok=False, error=f"unknown cmd {cmd}")
    except Exception as e:
        resp.update(ok=False, error=str(e))
    finally:
        reply(client, resp, meta)

client = mqtt.Client(client_id=f"pc-{DEVICE}")
client.username_pw_set(USER, PASS)
client.will_set(STATUS, "offline", retain=True)
client.connect(BROKER, PORT, 60)
client.subscribe(REQ, qos=1)
client.on_message = on_message
client.publish(STATUS, "online", retain=True)

while True:
    client.publish(HB, json.dumps({"ts": int(time.time())}), retain=True)
    client.loop(timeout=1.0); time.sleep(10)
