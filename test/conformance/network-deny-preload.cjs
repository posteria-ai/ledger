const Module = require("node:module");
const dgram = require("node:dgram");
const dns = require("node:dns");
const dnsPromises = require("node:dns/promises");
const http = require("node:http");
const http2 = require("node:http2");
const https = require("node:https");
const net = require("node:net");
const tls = require("node:tls");

const blocked = [];

const block = (target, method, label) => {
  const original = target[method];
  if (typeof original !== "function") return;
  target[method] = function blockedNetworkPrimitive() {
    blocked.push(label);
    throw new Error(`network-deny-preload blocked ${label}`);
  };
};

const isResolverFn = (name) =>
  name.startsWith("resolve") ||
  name === "reverse" ||
  name === "lookup" ||
  name === "lookupService";

const blockResolverFns = (target, prefix) => {
  for (const name of Object.getOwnPropertyNames(target)) {
    if (!isResolverFn(name)) continue;
    const desc = Object.getOwnPropertyDescriptor(target, name);
    if (desc && typeof desc.value === "function" && desc.writable) {
      block(target, name, `${prefix}.${name}`);
    }
  }
};

block(net.Socket.prototype, "connect", "net.Socket#connect");
block(net, "createConnection", "net.createConnection");
block(net, "connect", "net.connect");
block(http, "request", "http.request");
block(http, "get", "http.get");
block(https, "request", "https.request");
block(https, "get", "https.get");
block(http2, "connect", "http2.connect");
blockResolverFns(dns, "dns");
blockResolverFns(dnsPromises, "dns.promises");
blockResolverFns(dns.Resolver.prototype, "dns.Resolver#");
blockResolverFns(dnsPromises.Resolver.prototype, "dns.promises.Resolver#");
block(dgram, "createSocket", "dgram.createSocket");
block(tls, "connect", "tls.connect");

if (typeof globalThis.fetch === "function") {
  block(globalThis, "fetch", "fetch");
}

Module.syncBuiltinESMExports();

process.on("exit", () => {
  if (blocked.length > 0) {
    process.exitCode = 1;
    process.stderr.write(
      `network-deny-preload blocked calls: ${blocked.join(", ")}\n`,
    );
  }
});
