import assert from "node:assert/strict";
import { demoProject, summarize } from "./calc.mjs";
import {
  decodeSnapshot,
  deleteRemote,
  encodeSnapshot,
  generateEk,
  openCloud,
  packProject,
  publishProject,
  unpackProject,
} from "./store.mjs";

const demo = demoProject();
const ek = await generateEk();
const packed = await packProject(demo, ek);
const opened = await unpackProject(packed, ek);
assert.equal(opened.meta.name, demo.meta.name);
assert.equal(summarize(opened).cash, summarize(demo).cash);
await assert.rejects(async () => unpackProject(packed, await generateEk()), /badkey/);

const snapshot = await encodeSnapshot(demo);
const fromSnap = await decodeSnapshot(snapshot);
assert.equal(fromSnap.id, demo.id);
assert.equal(fromSnap.cloud, undefined);
assert.ok(snapshot.length < 20000, `snapshot length ${snapshot.length}`);

const project = demoProject();
project.updatedAt = new Date().toISOString();
const cloud = await publishProject(project);
assert.match(cloud.ns, /^tvc[a-f0-9]{16}$/);
assert.match(cloud.wk, /^[a-f0-9]{64}$/);
project.cloud = { ns: cloud.ns, wk: cloud.wk, ek: cloud.ek };

const remote = await openCloud(cloud.ns, cloud.wk, cloud.ek);
assert.equal(remote.meta.client, "Công ty Lumina");
assert.equal(summarize(remote).budgetGross, 171362000);

remote.meta.note = "đã cập nhật từ máy khác";
remote.updatedAt = new Date().toISOString();
remote.cloud = project.cloud;
await publishProject(remote);
const again = await openCloud(cloud.ns, cloud.wk, cloud.ek);
assert.equal(again.meta.note, "đã cập nhật từ máy khác");

await deleteRemote(cloud.ns, cloud.wk);
await assert.rejects(() => openCloud(cloud.ns, cloud.wk, cloud.ek));
console.log("store.test.mjs ok", { ns: cloud.ns, snapshot: snapshot.length, body: JSON.stringify(packed).length });
