#!/usr/bin/env python3
"""Tiny Firefox Remote Debugging Protocol client for KaiOS 4.
Setup: adb forward tcp:6000 localfilesystem:/data/local/firefox-debugger-socket
Usage: rdp.py tabs | rdp.py eval <url-substring|parent> '<js>'
"""
import json, socket, sys

class RDP:
    def __init__(self, port=6000):
        self.s = socket.create_connection(("127.0.0.1", port), timeout=30)
        self.buf = b""
        self.hello = self.recv()

    def recv(self):
        while b":" not in self.buf:
            c = self.s.recv(65536)
            if not c: raise EOFError
            self.buf += c
        n, rest = self.buf.split(b":", 1)
        n = int(n)
        while len(rest) < n:
            rest += self.s.recv(65536)
        self.buf = rest[n:]
        return json.loads(rest[:n])

    def send(self, msg):
        d = json.dumps(msg).encode()
        self.s.sendall(str(len(d)).encode() + b":" + d)

    def req(self, to, type_, **kw):
        self.send(dict(to=to, type=type_, **kw))
        while True:
            m = self.recv()
            if m.get("from") == to:
                return m

    def tabs(self):
        return self.req("root", "listTabs")["tabs"]

    def target(self, where):
        if where == "parent":
            d = self.req("root", "getProcess", id=0)["processDescriptor"]
            return self.req(d["actor"], "getTarget")["process"]
        for t in self.tabs():
            if where in (t.get("url") or ""):
                return self.req(t["actor"], "getTarget")["frame"]
        raise SystemExit(f"no tab matching {where!r}")

    def eval(self, target, js):
        ca = target["consoleActor"]
        r = self.req(ca, "evaluateJSAsync", text=js, mapped={"await": True})
        rid = r.get("resultID")
        while True:
            m = self.recv()
            if m.get("type") == "evaluationResult" and m.get("resultID") == rid:
                if m.get("exceptionMessage"):
                    return "EXCEPTION: " + str(m["exceptionMessage"])
                v = m.get("result")
                if isinstance(v, dict):
                    if v.get("type") == "longString":
                        full = self.req(v["actor"], "substring", start=0, end=v["length"])
                        return full["substring"]
                    return v.get("preview") or v.get("type")
                return v

if __name__ == "__main__":
    r = RDP()
    if sys.argv[1] == "tabs":
        for t in r.tabs(): print(t["actor"], t.get("url"))
    elif sys.argv[1] == "eval":
        js = sys.argv[3] if sys.argv[3] != "-" else sys.stdin.read()
        if sys.argv[2] != "parent":
            from wake import wake
            wake(r)
        print(r.eval(r.target(sys.argv[2]), js))
