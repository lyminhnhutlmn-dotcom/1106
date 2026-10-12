/** Pure money math for the TVC production ledger. No DOM. */

export const PHASES = [
  { id: "pre", label: "Tiền kỳ" },
  { id: "prod", label: "Ngày quay" },
  { id: "post", label: "Hậu kỳ" },
  { id: "other", label: "Chung" },
];

export const STATUSES = [
  { id: "quote", label: "Báo giá" },
  { id: "locked", label: "Đã chốt" },
  { id: "pre", label: "Tiền kỳ" },
  { id: "shoot", label: "Ngày quay" },
  { id: "post", label: "Hậu kỳ" },
  { id: "settle", label: "Quyết toán" },
  { id: "closed", label: "Đã đóng" },
];

export const EXP_STATUSES = [
  { id: "paid", label: "Đã chi" },
  { id: "advance", label: "Tạm ứng" },
  { id: "pending", label: "Chờ duyệt" },
];

export const METHODS = ["Chuyển khoản", "Tiền mặt", "Thẻ", "Khác"];

export const UNITS = ["gói", "ngày", "ca", "suất", "người", "chiếc", "job", "tháng"];

export const CATEGORIES = [
  "Kịch bản", "Storyboard", "Location", "Casting", "Đạo diễn", "Quay phim",
  "Máy móc", "Ánh sáng", "Mỹ thuật", "Diễn viên", "Trang phục", "Makeup",
  "Cơm nước", "Xe", "Dựng", "Color", "Âm thanh", "Nhạc", "VFX", "Master",
  "Dự phòng", "Khác",
];

export const TEMPLATE = [
  ["pre", "Kịch bản", "Kịch bản / treatment", "gói"],
  ["pre", "Storyboard", "Storyboard", "gói"],
  ["pre", "Location", "Đi tìm bối", "ngày"],
  ["pre", "Casting", "Casting", "gói"],
  ["prod", "Đạo diễn", "Đạo diễn", "job"],
  ["prod", "Quay phim", "DOP / quay phim", "job"],
  ["prod", "Máy móc", "Thuê máy quay", "ngày"],
  ["prod", "Ánh sáng", "Đèn và gaffer", "ngày"],
  ["prod", "Mỹ thuật", "Mỹ thuật và đạo cụ", "gói"],
  ["prod", "Diễn viên", "Diễn viên chính", "người"],
  ["prod", "Makeup", "Makeup / hair", "ngày"],
  ["prod", "Cơm nước", "Cơm nước ekip", "suất"],
  ["prod", "Xe", "Xe đưa đón", "chiếc"],
  ["post", "Dựng", "Dựng hình", "gói"],
  ["post", "Color", "Color grading", "gói"],
  ["post", "Âm thanh", "Âm thanh và nhạc", "gói"],
  ["post", "VFX", "VFX / motion", "gói"],
  ["post", "Master", "Master bàn giao", "gói"],
  ["other", "Dự phòng", "Dự phòng", "gói"],
];

export function uid(prefix = "id") {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hex}`;
}

export function roundMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x);
}

export function formatVnd(n) {
  const v = roundMoney(n);
  const digits = Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (v < 0 ? "-" : "") + digits;
}

export function parseMoney(s) {
  const t = String(s ?? "").trim();
  if (!t) return 0;
  const neg = t.startsWith("-") || t.startsWith("−");
  const digits = t.replace(/[^\d]/g, "");
  if (!digits) return 0;
  return (neg ? -1 : 1) * Number(digits);
}

export function parseQty(s) {
  const t = String(s ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (!t) return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

export function defaultMeta() {
  return {
    name: "TVC mới",
    code: "",
    client: "",
    brand: "",
    agency: "",
    producer: "",
    director: "",
    pm: "",
    status: "quote",
    shootDate: "",
    deliveryDate: "",
    contractValue: 0,
    vatRate: 8,
    vatMode: "add",
    note: "",
  };
}

export function blankLine(phase = "prod", category = "Khác", name = "", unit = "gói") {
  return {
    id: uid("ln"),
    phase: PHASES.some((p) => p.id === phase) ? phase : "other",
    category: category || "Khác",
    name: name || category || "Hạng mục mới",
    vendor: "",
    qty: 1,
    unit: unit || "gói",
    unitPrice: 0,
    vat: category !== "Diễn viên",
    note: "",
    dueDate: "",
  };
}

export function blankExpense(partial = {}) {
  return {
    id: uid("ex"),
    date: new Date().toISOString().slice(0, 10),
    budgetLineId: "",
    name: "",
    vendor: "",
    amount: 0,
    vatIncluded: false,
    method: "Chuyển khoản",
    status: "paid",
    note: "",
    ...partial,
    id: partial.id || uid("ex"),
  };
}

export function blankIncome(partial = {}) {
  return {
    id: uid("in"),
    name: partial.name || "Đợt thu",
    expectedDate: "",
    date: "",
    expected: 0,
    received: 0,
    method: "Chuyển khoản",
    note: "",
    ...partial,
    id: partial.id || uid("in"),
  };
}

function cleanLine(raw) {
  const line = blankLine(raw?.phase, raw?.category, raw?.name, raw?.unit);
  if (raw?.id) line.id = String(raw.id).slice(0, 80);
  line.vendor = String(raw?.vendor ?? "").slice(0, 200);
  line.qty = parseQty(raw?.qty ?? 1);
  line.unitPrice = roundMoney(raw?.unitPrice);
  line.vat = raw?.vat !== false && raw?.category !== undefined ? !!raw.vat : line.vat;
  if (typeof raw?.vat === "boolean") line.vat = raw.vat;
  line.note = String(raw?.note ?? "").slice(0, 500);
  line.dueDate = isoDate(raw?.dueDate);
  line.name = String(raw?.name || line.name).slice(0, 200);
  line.category = String(raw?.category || line.category).slice(0, 80);
  return line;
}

function cleanExpense(raw) {
  const exp = blankExpense();
  if (raw?.id) exp.id = String(raw.id).slice(0, 80);
  exp.date = isoDate(raw?.date);
  exp.budgetLineId = String(raw?.budgetLineId ?? "").slice(0, 80);
  exp.name = String(raw?.name ?? "").slice(0, 200);
  exp.vendor = String(raw?.vendor ?? "").slice(0, 200);
  exp.amount = roundMoney(raw?.amount);
  exp.vatIncluded = !!raw?.vatIncluded;
  exp.method = METHODS.includes(raw?.method) ? raw.method : "Chuyển khoản";
  exp.status = EXP_STATUSES.some((s) => s.id === raw?.status) ? raw.status : "paid";
  exp.note = String(raw?.note ?? "").slice(0, 500);
  return exp;
}

function cleanIncome(raw) {
  const inc = blankIncome();
  if (raw?.id) inc.id = String(raw.id).slice(0, 80);
  inc.name = String(raw?.name || "Đợt thu").slice(0, 200);
  inc.expectedDate = isoDate(raw?.expectedDate);
  inc.date = isoDate(raw?.date);
  inc.expected = roundMoney(raw?.expected);
  inc.received = roundMoney(raw?.received);
  inc.method = METHODS.includes(raw?.method) ? raw.method : "Chuyển khoản";
  inc.note = String(raw?.note ?? "").slice(0, 500);
  return inc;
}

export function isoDate(value) {
  const s = String(value ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

export function normalizeProject(raw) {
  const meta = { ...defaultMeta(), ...(raw?.meta && typeof raw.meta === "object" ? raw.meta : {}) };
  meta.name = String(meta.name || "TVC mới").slice(0, 160);
  meta.code = String(meta.code || "").slice(0, 40);
  meta.client = String(meta.client || "").slice(0, 160);
  meta.brand = String(meta.brand || "").slice(0, 160);
  meta.agency = String(meta.agency || "").slice(0, 160);
  meta.producer = String(meta.producer || "").slice(0, 160);
  meta.director = String(meta.director || "").slice(0, 160);
  meta.pm = String(meta.pm || "").slice(0, 160);
  meta.status = STATUSES.some((s) => s.id === meta.status) ? meta.status : "quote";
  meta.shootDate = isoDate(meta.shootDate);
  meta.deliveryDate = isoDate(meta.deliveryDate);
  meta.contractValue = roundMoney(meta.contractValue);
  meta.vatRate = Math.min(30, Math.max(0, Number(meta.vatRate) || 0));
  meta.vatMode = ["add", "included", "none"].includes(meta.vatMode) ? meta.vatMode : "add";
  meta.note = String(meta.note || "").slice(0, 2000);
  const cloud = raw?.cloud && /^tvc[a-f0-9]{16}$/.test(raw.cloud.ns)
    ? {
        ns: raw.cloud.ns,
        wk: String(raw.cloud.wk || ""),
        ek: String(raw.cloud.ek || ""),
      }
    : null;
  return {
    schema: 1,
    id: raw?.id ? String(raw.id).slice(0, 80) : uid("p"),
    demo: !!raw?.demo,
    updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
    syncedAt: typeof raw?.syncedAt === "string" ? raw.syncedAt : null,
    cloud,
    meta,
    lines: Array.isArray(raw?.lines) ? raw.lines.slice(0, 400).map(cleanLine) : [],
    expenses: Array.isArray(raw?.expenses) ? raw.expenses.slice(0, 800).map(cleanExpense) : [],
    incomes: Array.isArray(raw?.incomes) ? raw.incomes.slice(0, 80).map(cleanIncome) : [],
  };
}

export function contractFigures(meta) {
  const rate = Number(meta.vatRate) || 0;
  const entered = roundMoney(meta.contractValue);
  if (meta.vatMode === "none" || rate === 0) {
    return { net: entered, vat: 0, gross: entered };
  }
  if (meta.vatMode === "included") {
    const net = roundMoney(entered / (1 + rate / 100));
    return { net, vat: entered - net, gross: entered };
  }
  const vat = roundMoney(entered * rate / 100);
  return { net: entered, vat, gross: entered + vat };
}

export function lineFigures(line, rate) {
  const net = roundMoney((Number(line.qty) || 0) * (Number(line.unitPrice) || 0));
  const vat = line.vat ? roundMoney(net * rate / 100) : 0;
  return { net, vat, gross: net + vat };
}

export function expenseCounts(exp) {
  return exp.status !== "pending";
}

export function expenseVatPortion(exp, rate) {
  if (!exp.vatIncluded || !expenseCounts(exp)) return 0;
  const amount = roundMoney(exp.amount);
  if (!rate) return 0;
  return amount - roundMoney(amount / (1 + rate / 100));
}

export function summarize(project) {
  const rate = Number(project.meta.vatRate) || 0;
  const contract = contractFigures(project.meta);
  const byPhase = {};
  for (const phase of PHASES) byPhase[phase.id] = { net: 0, vat: 0, gross: 0, spent: 0 };
  const byLine = {};
  let budgetNet = 0;
  let budgetVat = 0;
  for (const line of project.lines) {
    const fig = lineFigures(line, rate);
    const phase = byPhase[line.phase] ? line.phase : "other";
    byPhase[phase].net += fig.net;
    byPhase[phase].vat += fig.vat;
    byPhase[phase].gross += fig.gross;
    budgetNet += fig.net;
    budgetVat += fig.vat;
    byLine[line.id] = { ...fig, spent: 0, remain: fig.gross };
  }
  let spent = 0;
  let spentPending = 0;
  let spentVat = 0;
  let unassignedSpent = 0;
  for (const exp of project.expenses) {
    const amount = roundMoney(exp.amount);
    if (!expenseCounts(exp)) {
      spentPending += amount;
      continue;
    }
    spent += amount;
    spentVat += expenseVatPortion(exp, rate);
    if (byLine[exp.budgetLineId]) {
      byLine[exp.budgetLineId].spent += amount;
      const row = byLine[exp.budgetLineId];
      row.remain = row.gross - row.spent;
      const line = project.lines.find((l) => l.id === exp.budgetLineId);
      const phase = line && byPhase[line.phase] ? line.phase : "other";
      byPhase[phase].spent += amount;
    } else {
      unassignedSpent += amount;
    }
  }
  const received = project.incomes.reduce((sum, inc) => sum + roundMoney(inc.received), 0);
  const expectedIn = project.incomes.reduce((sum, inc) => sum + roundMoney(inc.expected), 0);
  const budgetGross = budgetNet + budgetVat;
  const cash = received - spent;
  const receivable = contract.gross - received;
  const budgetLeft = budgetGross - spent;
  const margin = contract.gross - budgetGross;
  const alerts = [];
  if (budgetGross > 0 && spent > budgetGross) {
    alerts.push({ level: "bad", text: `Đã chi vượt dự toán ${formatVnd(spent - budgetGross)} ₫.` });
  }
  if (cash < 0) {
    alerts.push({ level: "bad", text: `Quỹ đang âm ${formatVnd(cash)} ₫. Tiền đã chi nhiều hơn tiền đã thu.` });
  }
  const over = project.lines.filter((line) => byLine[line.id] && byLine[line.id].gross > 0 && byLine[line.id].spent > byLine[line.id].gross);
  if (over.length) {
    const names = over.slice(0, 3).map((line) => line.name).join(", ");
    alerts.push({ level: "warn", text: `Hạng mục vượt giá: ${names}${over.length > 3 ? "…" : ""}.` });
  }
  if (["settle", "closed"].includes(project.meta.status) && receivable > 0) {
    alerts.push({ level: "warn", text: `Còn phải thu ${formatVnd(receivable)} ₫ trong khi job đang ở bước quyết toán.` });
  }
  if (expectedIn && expectedIn !== contract.gross) {
    alerts.push({
      level: "info",
      text: `Tổng các đợt thu (${formatVnd(expectedIn)} ₫) khác giá trị hợp đồng (${formatVnd(contract.gross)} ₫).`,
    });
  }
  return {
    contractNet: contract.net,
    contractVat: contract.vat,
    contractGross: contract.gross,
    budgetNet,
    budgetVat,
    budgetGross,
    spent,
    spentPending,
    spentVat,
    unassignedSpent,
    received,
    expectedIn,
    cash,
    receivable,
    budgetLeft,
    margin,
    byPhase,
    byLine,
    alerts,
  };
}

export function buildCashflow(project) {
  const summary = summarize(project);
  const rows = [];
  for (const inc of project.incomes) {
    const received = roundMoney(inc.received);
    if (received > 0) {
      rows.push({
        date: inc.date || inc.expectedDate || "",
        actual: true,
        kind: "in",
        name: inc.name || "Thu tiền",
        amount: received,
      });
    }
    const gap = roundMoney(inc.expected) - received;
    if (gap > 0) {
      rows.push({
        date: inc.expectedDate || inc.date || project.meta.deliveryDate || "",
        actual: false,
        kind: "in",
        name: `${inc.name || "Thu tiền"} (dự kiến)`,
        amount: gap,
      });
    }
  }
  for (const exp of project.expenses) {
    if (!expenseCounts(exp)) continue;
    rows.push({
      date: exp.date || "",
      actual: true,
      kind: "out",
      name: exp.name || "Chi",
      amount: roundMoney(exp.amount),
    });
  }
  let undated = 0;
  for (const line of project.lines) {
    const remain = summary.byLine[line.id]?.remain || 0;
    if (remain <= 0) continue;
    if (line.dueDate) {
      rows.push({
        date: line.dueDate,
        actual: false,
        kind: "out",
        name: `${line.name} (còn phải chi)`,
        amount: remain,
      });
    } else {
      undated += remain;
    }
  }
  if (undated > 0) {
    rows.push({
      date: project.meta.deliveryDate || project.meta.shootDate || "",
      actual: false,
      kind: "out",
      name: "Hạng mục chưa có hạn chi",
      amount: undated,
    });
  }
  rows.sort((a, b) => {
    const da = a.date || "9999-99-99";
    const db = b.date || "9999-99-99";
    if (da !== db) return da < db ? -1 : 1;
    if (a.actual !== b.actual) return a.actual ? -1 : 1;
    if (a.kind !== b.kind) return a.kind === "in" ? -1 : 1;
    return a.name.localeCompare(b.name, "vi");
  });
  let actualBalance = 0;
  let forecastBalance = 0;
  for (const row of rows) {
    const signed = row.kind === "in" ? row.amount : -row.amount;
    forecastBalance += signed;
    row.forecastBalance = forecastBalance;
    if (row.actual) {
      actualBalance += signed;
      row.balance = actualBalance;
    } else {
      row.balance = null;
    }
  }
  return rows;
}

export function duplicateProject(project) {
  const map = {};
  const copy = normalizeProject(JSON.parse(JSON.stringify(project)));
  copy.id = uid("p");
  copy.demo = false;
  copy.cloud = null;
  copy.syncedAt = null;
  copy.updatedAt = new Date().toISOString();
  copy.meta.name = `${copy.meta.name} (bản sao)`.slice(0, 160);
  copy.lines = copy.lines.map((line) => {
    const id = uid("ln");
    map[line.id] = id;
    return { ...line, id };
  });
  copy.expenses = copy.expenses.map((exp) => ({
    ...exp,
    id: uid("ex"),
    budgetLineId: map[exp.budgetLineId] || "",
  }));
  copy.incomes = copy.incomes.map((inc) => ({ ...inc, id: uid("in") }));
  return copy;
}

export function templateProject() {
  const project = normalizeProject({
    meta: { name: "TVC mới", status: "quote", vatRate: 8, vatMode: "add" },
    lines: TEMPLATE.map(([phase, category, name, unit]) => blankLine(phase, category, name, unit)),
    incomes: [
      blankIncome({ name: "Tạm ứng" }),
      blankIncome({ name: "Quyết toán" }),
    ],
  });
  return project;
}

export function demoProject() {
  const line = (id, phase, category, name, qty, unit, unitPrice, vat, dueDate = "") => ({
    id, phase, category, name, vendor: "", qty, unit, unitPrice, vat, note: "", dueDate,
  });
  return normalizeProject({
    id: "p_demo_lumina",
    demo: true,
    updatedAt: "2026-04-08T02:00:00.000Z",
    meta: {
      name: "TVC Lumina 30s",
      code: "LUM-30",
      client: "Công ty Lumina",
      brand: "Lumina Sparkling",
      agency: "Nhà Đồng",
      producer: "ANNAHOUSE",
      director: "Trần Quang",
      pm: "Mai Chi",
      status: "shoot",
      shootDate: "2026-04-18",
      deliveryDate: "2026-04-28",
      contractValue: 180000000,
      vatRate: 8,
      vatMode: "add",
      note: "Số liệu ví dụ để xem sổ. Xóa hoặc tạo dự án mới khi nhập job thật.",
    },
    lines: [
      line("ln-script", "pre", "Kịch bản", "Kịch bản / treatment", 1, "gói", 8000000, true),
      line("ln-board", "pre", "Storyboard", "Storyboard", 1, "gói", 6000000, true),
      line("ln-scout", "pre", "Location", "Đi tìm bối", 2, "ngày", 1500000, true, "2026-04-05"),
      line("ln-cast", "pre", "Casting", "Casting", 1, "gói", 4000000, true),
      line("ln-director", "prod", "Đạo diễn", "Đạo diễn", 1, "job", 25000000, true),
      line("ln-dop", "prod", "Quay phim", "DOP", 1, "job", 18000000, true),
      line("ln-cam", "prod", "Máy móc", "Thuê máy quay", 1, "ngày", 12000000, true, "2026-04-16"),
      line("ln-light", "prod", "Ánh sáng", "Đèn và gaffer", 1, "ngày", 8000000, true, "2026-04-16"),
      line("ln-art", "prod", "Mỹ thuật", "Mỹ thuật và đạo cụ", 1, "gói", 15000000, true, "2026-04-15"),
      line("ln-talent", "prod", "Diễn viên", "Diễn viên chính", 1, "người", 20000000, false, "2026-04-20"),
      line("ln-makeup", "prod", "Makeup", "Makeup / hair", 1, "ngày", 3000000, true, "2026-04-18"),
      line("ln-catering", "prod", "Cơm nước", "Cơm nước ekip", 25, "suất", 150000, true, "2026-04-18"),
      line("ln-car", "prod", "Xe", "Xe đưa đón", 2, "chiếc", 1200000, true, "2026-04-18"),
      line("ln-edit", "post", "Dựng", "Dựng hình", 1, "gói", 10000000, true, "2026-04-24"),
      line("ln-color", "post", "Color", "Color grading", 1, "gói", 8000000, true, "2026-04-25"),
      line("ln-sound", "post", "Âm thanh", "Âm thanh và nhạc", 1, "gói", 7000000, true, "2026-04-26"),
      line("ln-master", "post", "Master", "Master bàn giao", 1, "gói", 2000000, true, "2026-04-28"),
      line("ln-reserve", "other", "Dự phòng", "Dự phòng", 1, "gói", 5000000, true),
    ],
    expenses: [
      { id: "ex-director", date: "2026-04-02", budgetLineId: "ln-director", name: "Tạm ứng đạo diễn", vendor: "Trần Quang", amount: 10000000, vatIncluded: true, method: "Chuyển khoản", status: "advance", note: "" },
      { id: "ex-scout", date: "2026-04-05", budgetLineId: "ln-scout", name: "Công tìm bối", vendor: "Ekip location", amount: 3000000, vatIncluded: true, method: "Tiền mặt", status: "paid", note: "" },
      { id: "ex-food", date: "2026-04-08", budgetLineId: "ln-catering", name: "Đặt cọc cơm nước", vendor: "Bếp Gỗ", amount: 1000000, vatIncluded: true, method: "Chuyển khoản", status: "paid", note: "" },
    ],
    incomes: [
      { id: "in-deposit", name: "Tạm ứng 50%", expectedDate: "2026-03-28", date: "2026-03-28", expected: 97200000, received: 97200000, method: "Chuyển khoản", note: "" },
      { id: "in-final", name: "Quyết toán", expectedDate: "2026-05-05", date: "", expected: 97200000, received: 0, method: "Chuyển khoản", note: "" },
    ],
  });
}

export function toCsv(project) {
  const s = summarize(project);
  const lines = [];
  const cell = (value) => {
    const text = String(value ?? "");
    if (/[;"\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };
  const row = (...cols) => lines.push(cols.map(cell).join(";"));
  row("Sổ dòng tiền TVC", project.meta.name);
  row("Mã", project.meta.code);
  row("Khách hàng", project.meta.client);
  row("Giá trị hợp đồng", s.contractGross);
  row("Dự toán", s.budgetGross);
  row("Đã chi", s.spent);
  row("Đã thu", s.received);
  row("Số dư", s.cash);
  row("");
  row("DỰ TOÁN");
  row("Giai đoạn", "Hạng mục", "Diễn giải", "Nhà cung cấp", "SL", "ĐVT", "Đơn giá", "VAT", "Thành tiền", "Đã chi", "Còn lại", "Hạn chi", "Ghi chú");
  for (const line of project.lines) {
    const fig = s.byLine[line.id];
    const phase = PHASES.find((p) => p.id === line.phase)?.label || line.phase;
    row(phase, line.category, line.name, line.vendor, line.qty, line.unit, line.unitPrice, line.vat ? "có" : "không", fig.gross, fig.spent, fig.remain, line.dueDate, line.note);
  }
  row("");
  row("THỰC CHI");
  row("Ngày", "Diễn giải", "Nhà cung cấp", "Số tiền", "Gồm VAT", "Hình thức", "Trạng thái", "Gắn dự toán", "Ghi chú");
  for (const exp of project.expenses) {
    const linked = project.lines.find((line) => line.id === exp.budgetLineId);
    const status = EXP_STATUSES.find((item) => item.id === exp.status)?.label || exp.status;
    row(exp.date, exp.name, exp.vendor, exp.amount, exp.vatIncluded ? "có" : "không", exp.method, status, linked ? linked.name : "", exp.note);
  }
  row("");
  row("THU TIỀN");
  row("Tên đợt", "Ngày dự kiến", "Ngày về", "Phải thu", "Đã thu", "Hình thức", "Ghi chú");
  for (const inc of project.incomes) {
    row(inc.name, inc.expectedDate, inc.date, inc.expected, inc.received, inc.method, inc.note);
  }
  return `\uFEFF${lines.join("\n")}`;
}

export function statusLabel(id) {
  return STATUSES.find((s) => s.id === id)?.label || id;
}
