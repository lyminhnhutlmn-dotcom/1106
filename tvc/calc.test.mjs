import assert from "node:assert/strict";
import {
  buildCashflow,
  demoProject,
  duplicateProject,
  formatVnd,
  normalizeProject,
  parseMoney,
  parseQty,
  summarize,
  templateProject,
} from "./calc.mjs";

const demo = demoProject();
const s = summarize(demo);

assert.equal(parseMoney("15.000.000"), 15000000);
assert.equal(parseMoney("15,000,000"), 15000000);
assert.equal(parseMoney("-2.500"), -2500);
assert.equal(parseMoney(""), 0);
assert.equal(parseQty("1,5"), 1.5);
assert.equal(formatVnd(83200000), "83.200.000");
assert.equal(formatVnd(-14000000), "-14.000.000");

assert.equal(s.contractGross, 194400000);
assert.equal(s.contractVat, 14400000);
assert.equal(s.budgetNet, 160150000);
assert.equal(s.budgetVat, 11212000);
assert.equal(s.budgetGross, 171362000);
assert.equal(s.spent, 14000000);
assert.equal(s.received, 97200000);
assert.equal(s.cash, 83200000);
assert.equal(s.receivable, 97200000);
assert.equal(s.budgetLeft, 157362000);
assert.equal(s.margin, 23038000);
assert.equal(s.byLine["ln-director"].gross, 27000000);
assert.equal(s.byLine["ln-director"].spent, 10000000);
assert.equal(s.byLine["ln-talent"].vat, 0);
assert.equal(s.byPhase.pre.spent, 3000000);
assert.equal(s.byPhase.prod.spent, 11000000);

const pending = normalizeProject({
  meta: { contractValue: 1000000, vatMode: "none", vatRate: 0 },
  expenses: [{ amount: 500000, status: "pending", name: "Chờ" }, { amount: 200000, status: "paid", name: "Đã chi" }],
  incomes: [{ name: "Thu", expected: 1000000, received: 1000000 }],
});
const sp = summarize(pending);
assert.equal(sp.spent, 200000);
assert.equal(sp.spentPending, 500000);
assert.equal(sp.cash, 800000);

const included = summarize(normalizeProject({
  meta: { contractValue: 108000000, vatMode: "included", vatRate: 8 },
}));
assert.equal(included.contractGross, 108000000);
assert.equal(included.contractNet, 100000000);
assert.equal(included.contractVat, 8000000);

const rows = buildCashflow(demo);
const actual = rows.filter((row) => row.actual);
assert.deepEqual(actual.map((row) => [row.date, row.kind, row.amount, row.balance]), [
  ["2026-03-28", "in", 97200000, 97200000],
  ["2026-04-02", "out", 10000000, 87200000],
  ["2026-04-05", "out", 3000000, 84200000],
  ["2026-04-08", "out", 1000000, 83200000],
]);
assert.equal(actual.at(-1).balance, s.cash);
const forecastOut = rows.filter((row) => !row.actual && row.kind === "out");
assert.ok(forecastOut.some((row) => row.name.includes("Color")));
assert.ok(rows.some((row) => row.name.includes("Quyết toán")));
assert.equal(rows.at(-1).forecastBalance, s.received + (s.expectedIn - s.received) - s.spent - (s.budgetGross - s.spent));

const copy = duplicateProject(demo);
assert.notEqual(copy.id, demo.id);
assert.equal(copy.cloud, null);
assert.equal(copy.lines.length, demo.lines.length);
assert.notEqual(copy.lines[0].id, demo.lines[0].id);
assert.equal(summarize(copy).cash, s.cash);

const blank = templateProject();
assert.ok(blank.lines.length >= 15);
assert.equal(summarize(blank).budgetGross, 0);

const dirty = normalizeProject({ meta: { name: "<script>" }, lines: [{ unitPrice: "12.000", qty: "2", vat: true }] });
assert.equal(dirty.meta.name, "<script>");
assert.equal(dirty.lines[0].unitPrice, 12);
assert.equal(dirty.lines[0].qty, 2);

console.log("calc.test.mjs ok", {
  contract: s.contractGross,
  budget: s.budgetGross,
  cash: s.cash,
  rows: rows.length,
});
