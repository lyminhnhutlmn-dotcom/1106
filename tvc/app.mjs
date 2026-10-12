import {
  CATEGORIES,
  EXP_STATUSES,
  METHODS,
  PHASES,
  STATUSES,
  UNITS,
  blankExpense,
  blankIncome,
  blankLine,
  buildCashflow,
  demoProject,
  duplicateProject,
  formatVnd,
  normalizeProject,
  parseMoney,
  parseQty,
  statusLabel,
  summarize,
  templateProject,
  toCsv,
  uid,
} from "./calc.mjs";
import {
  cloudHash,
  decodeSnapshot,
  deleteRemote,
  encodeSnapshot,
  openCloud,
  publishProject,
} from "./store.mjs";

const LS_KEY = "tvc-ledger-v1";

const state = {
  projects: [],
  activeId: null,
  tab: "overview",
  forecast: true,
  autoSync: true,
  query: "",
  syncTimer: null,
  syncing: false,
  syncQueued: false,
  pendingRemote: null,
  syncLabel: "Đã lưu trên máy này",
  syncOk: true,
};

const $ = (sel) => document.querySelector(sel);

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function active() {
  return state.projects.find((project) => project.id === state.activeId) || null;
}

function money(n) {
  return `${formatVnd(n)} ₫`;
}

function fmtDate(iso) {
  if (!iso) return "Chưa có ngày";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function fmtTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("vi-VN", { hour12: false });
}

function projectLabel(project) {
  const code = project.meta.code ? `${project.meta.code} · ` : "";
  return `${code}${project.meta.name || "TVC mới"}`;
}

function slug(name) {
  return String(name || "du-an")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "du-an";
}

function toast(text) {
  const el = $("#toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 3200);
}

function setSync(text, ok = true) {
  state.syncLabel = text;
  state.syncOk = ok;
  const el = $("#syncStatus");
  el.textContent = text;
  el.dataset.ok = ok ? "1" : "0";
  const link = $("#cloudLink");
  const project = active();
  if (link && project?.cloud?.ek) link.value = shareUrl(cloudHash(project.cloud));
}

function saveLocal() {
  const data = {
    autoSync: state.autoSync,
    activeId: state.activeId,
    projects: state.projects,
  };
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}

function loadLocal() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || "null");
    if (!raw?.projects?.length) return false;
    state.autoSync = raw.autoSync !== false;
    state.projects = raw.projects.map(normalizeProject);
    state.activeId = raw.activeId;
    return true;
  } catch {
    return false;
  }
}

function shareUrl(hash) {
  const url = new URL(location.href);
  url.search = "";
  url.hash = hash;
  return url.toString();
}

function syncAddress() {
  const project = active();
  if (project?.cloud?.ns && project.cloud.ek) {
    history.replaceState(null, "", `${location.pathname}${location.search}#${cloudHash(project.cloud)}`);
  } else {
    history.replaceState(null, "", `${location.pathname}${location.search}`);
  }
}

function options(list, value, placeholder = "") {
  const head = placeholder ? `<option value="">${esc(placeholder)}</option>` : "";
  return head + list.map((item) => {
    const id = typeof item === "string" ? item : item.id;
    const label = typeof item === "string" ? item : item.label;
    return `<option value="${esc(id)}"${id === value ? " selected" : ""}>${esc(label)}</option>`;
  }).join("");
}

function renderSelect() {
  const select = $("#projectSelect");
  const current = select.value;
  select.innerHTML = state.projects.map((project) => (
    `<option value="${esc(project.id)}">${esc(projectLabel(project))}</option>`
  )).join("");
  if (active()) select.value = state.activeId;
  else if (current) select.value = current;
}

function renderBanner() {
  const el = $("#banner");
  const project = active();
  const bits = [];
  if (state.pendingRemote) {
    bits.push(`<p>Link vừa mở có bản lưu ${esc(fmtTime(state.pendingRemote.updatedAt))}. Bản trên máy này mới hơn.</p>
      <div class="row"><button type="button" class="btn primary" id="useRemote">Lấy bản trên link</button>
      <button type="button" class="btn" id="keepLocal">Giữ bản trên máy</button></div>`);
  } else if (project?.demo) {
    bits.push(`<p>Đây là dự án ví dụ Lumina để xem cách sổ tính. Tạo dự án mới khi nhập job thật.</p>
      <div class="row"><button type="button" class="btn" id="dismissDemo">Ẩn ghi chú</button>
      <button type="button" class="btn primary" id="bannerNew">Dự án mới</button></div>`);
  }
  el.hidden = bits.length === 0;
  el.innerHTML = bits.join("");
}

function renderTabs() {
  document.querySelectorAll(".tab").forEach((button) => {
    const on = button.dataset.tab === state.tab;
    button.classList.toggle("on", on);
    button.setAttribute("aria-selected", on ? "true" : "false");
  });
}

function field(label, control, wide = false) {
  return `<label class="field${wide ? " wide" : ""}"><span>${label}</span>${control}</label>`;
}

function textInput(kind, id, fieldName, value, extra = "") {
  return `<input data-kind="${kind}" data-id="${esc(id)}" data-field="${fieldName}" value="${esc(value)}" ${extra}>`;
}

function renderOverview(project, summary) {
  const meta = project.meta;
  const phases = PHASES.map((phase) => {
    const row = summary.byPhase[phase.id];
    const pct = row.gross > 0 ? Math.min(100, Math.round((row.spent / row.gross) * 100)) : 0;
    return `<div class="bar-row">
      <strong>${esc(phase.label)}</strong>
      <div class="track"><i data-out="bar-${phase.id}" style="width:${pct}%"></i></div>
      <div class="bar-meta num"><span data-out="spent-${phase.id}">${esc(money(row.spent))}</span> / <span data-out="gross-${phase.id}">${esc(money(row.gross))}</span></div>
    </div>`;
  }).join("");
  return `<section class="panel">
    <div id="alerts" class="alerts"></div>
    <div class="form-grid">
      ${field("Tên dự án", textInput("meta", "", "name", meta.name))}
      ${field("Mã job", textInput("meta", "", "code", meta.code, 'placeholder="LUM-30"'))}
      ${field("Trạng thái", `<select data-kind="meta" data-field="status">${options(STATUSES, meta.status)}</select>`)}
      ${field("Khách hàng", textInput("meta", "", "client", meta.client))}
      ${field("Nhãn hàng", textInput("meta", "", "brand", meta.brand))}
      ${field("Agency", textInput("meta", "", "agency", meta.agency))}
      ${field("Đạo diễn", textInput("meta", "", "director", meta.director))}
      ${field("Producer / PM", textInput("meta", "", "pm", meta.pm))}
      ${field("Nhà sản xuất", textInput("meta", "", "producer", meta.producer))}
      ${field("Ngày quay", `<input type="date" data-kind="meta" data-field="shootDate" value="${esc(meta.shootDate)}">`)}
      ${field("Ngày giao", `<input type="date" data-kind="meta" data-field="deliveryDate" value="${esc(meta.deliveryDate)}">`)}
      ${field("Thuế VAT (%)", `<input data-kind="meta" data-field="vatRate" data-num="1" value="${esc(meta.vatRate)}">`)}
      ${field("Giá trị hợp đồng", `<input data-kind="meta" data-field="contractValue" data-money="1" value="${esc(formatVnd(meta.contractValue))}">`)}
      ${field("Cách tính VAT", `<select data-kind="meta" data-field="vatMode" data-rerender="1">${options([
        { id: "add", label: "Cộng VAT vào giá" },
        { id: "included", label: "Giá đã gồm VAT" },
        { id: "none", label: "Không VAT" },
      ], meta.vatMode)}</select>`)}
      ${field("Ghi chú", `<textarea data-kind="meta" data-field="note">${esc(meta.note)}</textarea>`, true)}
    </div>
    <p class="muted" data-out="contract-hint"></p>
    <div class="bars">${phases}</div>
    <p class="muted" data-out="unassigned"></p>
    <div class="modal-actions" style="justify-content:flex-start">
      <button type="button" class="btn" id="btnPrint">In báo cáo</button>
      <button type="button" class="btn" id="btnDup">Nhân bản</button>
      <button type="button" class="btn danger" id="btnDelete">Xóa dự án</button>
    </div>
  </section>`;
}

function renderBudget(project, summary) {
  const groups = PHASES.map((phase) => {
    const lines = project.lines.filter((line) => line.phase === phase.id);
    const body = lines.map((line) => budgetRow(line, summary)).join("") || `<tr><td colspan="10" class="empty">Chưa có hạng mục.</td></tr>`;
    const row = summary.byPhase[phase.id];
    return `<section class="phase">
      <div class="phase-head">
        <h2>${esc(phase.label)}</h2>
        <p class="num">${esc(money(row.gross))} dự toán · đã chi <span data-out="spent-${phase.id}">${esc(money(row.spent))}</span></p>
      </div>
      <div class="table-scroll"><table>
        <thead><tr>
          <th>Diễn giải</th><th>Hạng mục</th><th>Nhà cung cấp</th>
          <th class="right">SL</th><th>ĐVT</th><th class="right">Đơn giá</th><th>VAT</th>
          <th class="right">Thành tiền</th><th class="right">Đã chi</th><th></th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table></div>
      <button type="button" class="btn" data-action="add-line" data-phase="${phase.id}">Thêm hạng mục ${esc(phase.label.toLowerCase())}</button>
    </section>`;
  }).join("");
  return `<section class="panel">${groups}
    <p class="muted">Đơn giá là giá chưa VAT. Thành tiền cộng VAT nếu ô VAT được chọn. Diễn viên thường không chịu VAT của nhà sản xuất.</p>
  </section>`;
}

function budgetRow(line, summary) {
  const fig = summary.byLine[line.id];
  const over = fig.gross > 0 && fig.spent > fig.gross;
  return `<tr data-line-row="${esc(line.id)}" class="${over ? "over" : ""}">
    <td>
      ${textInput("line", line.id, "name", line.name)}
      <select data-kind="line" data-id="${esc(line.id)}" data-field="phase" data-rerender="1" style="margin-top:6px">${options(PHASES, line.phase)}</select>
      <input data-kind="line" data-id="${esc(line.id)}" data-field="note" value="${esc(line.note)}" placeholder="Ghi chú" style="margin-top:6px">
    </td>
    <td><input list="catList" data-kind="line" data-id="${esc(line.id)}" data-field="category" value="${esc(line.category)}"></td>
    <td>${textInput("line", line.id, "vendor", line.vendor)}</td>
    <td><input class="num" data-kind="line" data-id="${esc(line.id)}" data-field="qty" data-qty="1" value="${esc(line.qty)}"></td>
    <td><input list="unitList" data-kind="line" data-id="${esc(line.id)}" data-field="unit" value="${esc(line.unit)}"></td>
    <td><input class="num" data-kind="line" data-id="${esc(line.id)}" data-field="unitPrice" data-money="1" value="${esc(formatVnd(line.unitPrice))}"></td>
    <td class="checks"><input type="checkbox" data-kind="line" data-id="${esc(line.id)}" data-field="vat" ${line.vat ? "checked" : ""}></td>
    <td class="right num" data-out="gross-${line.id}">${esc(money(fig.gross))}</td>
    <td class="right num" data-out="spent-line-${line.id}">${esc(money(fig.spent))}</td>
    <td><button type="button" class="btn tiny danger" data-action="del-line" data-id="${esc(line.id)}" aria-label="Xóa hạng mục">×</button>
      <input type="date" data-kind="line" data-id="${esc(line.id)}" data-field="dueDate" value="${esc(line.dueDate)}" title="Hạn chi" style="margin-top:6px"></td>
  </tr>`;
}

function renderSpend(project) {
  const lineOptions = options(project.lines.map((line) => ({ id: line.id, label: line.name })), "", "Không gắn dự toán");
  const rows = project.expenses.map((exp) => {
    const hay = `${exp.name} ${exp.vendor} ${exp.note}`.toLowerCase();
    const hidden = state.query && !hay.includes(state.query.toLowerCase());
    return `<tr data-exp-row data-hay="${esc(hay)}" ${hidden ? "hidden" : ""}>
      <td><input type="date" data-kind="exp" data-id="${esc(exp.id)}" data-field="date" value="${esc(exp.date)}"></td>
      <td>${textInput("exp", exp.id, "name", exp.name)}
        <input data-kind="exp" data-id="${esc(exp.id)}" data-field="note" value="${esc(exp.note)}" placeholder="Ghi chú" style="margin-top:6px"></td>
      <td>${textInput("exp", exp.id, "vendor", exp.vendor)}</td>
      <td><input class="num" data-kind="exp" data-id="${esc(exp.id)}" data-field="amount" data-money="1" value="${esc(formatVnd(exp.amount))}"></td>
      <td class="checks"><input type="checkbox" data-kind="exp" data-id="${esc(exp.id)}" data-field="vatIncluded" ${exp.vatIncluded ? "checked" : ""}></td>
      <td><select data-kind="exp" data-id="${esc(exp.id)}" data-field="method">${options(METHODS, exp.method)}</select></td>
      <td><select data-kind="exp" data-id="${esc(exp.id)}" data-field="status" data-rerender="1">${options(EXP_STATUSES, exp.status)}</select></td>
      <td><select data-kind="exp" data-id="${esc(exp.id)}" data-field="budgetLineId">${options(project.lines.map((line) => ({ id: line.id, label: line.name })), exp.budgetLineId, "Không gắn")}</select></td>
      <td><button type="button" class="btn tiny danger" data-action="del-exp" data-id="${esc(exp.id)}" aria-label="Xóa khoản chi">×</button></td>
    </tr>`;
  }).join("");
  return `<section class="panel">
    <form class="entry" id="expForm">
      <label class="field"><span>Ngày</span><input type="date" name="date" value="${esc(new Date().toISOString().slice(0, 10))}"></label>
      <label class="field"><span>Diễn giải</span><input name="name" required placeholder="Tạm ứng đạo diễn"></label>
      <label class="field"><span>Số tiền đã ra</span><input class="num" name="amount" data-money="1" required placeholder="0"></label>
      <label class="field"><span>Nhà cung cấp</span><input name="vendor"></label>
      <label class="field"><span>Gắn dự toán</span><select name="budgetLineId">${lineOptions}</select></label>
      <label class="field"><span>Hình thức</span><select name="method">${options(METHODS, "Chuyển khoản")}</select></label>
      <label class="field"><span>Trạng thái</span><select name="status">${options(EXP_STATUSES, "paid")}</select></label>
      <button class="btn primary" type="submit">Thêm</button>
    </form>
    <label class="field"><span>Lọc</span><input id="expSearch" value="${esc(state.query)}" placeholder="Tìm diễn giải, nhà cung cấp"></label>
    <div class="table-scroll"><table>
      <thead><tr><th>Ngày</th><th>Diễn giải</th><th>Nhà cung cấp</th><th class="right">Số tiền</th><th>Gồm VAT</th><th>Hình thức</th><th>Trạng thái</th><th>Dự toán</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="9" class="empty">Chưa có khoản chi. Tiền chỉ tính vào số dư khi trạng thái là Đã chi hoặc Tạm ứng.</td></tr>`}</tbody>
    </table></div>
    <p class="muted">Số tiền là tiền đã rời tài khoản, kể cả VAT nếu hóa đơn đã gồm. Khoản Chờ duyệt không tính vào đã chi và số dư.</p>
  </section>`;
}

function renderIncome(project) {
  const rows = project.incomes.map((inc) => {
    const gap = Math.max(0, inc.expected - inc.received);
    const label = inc.received <= 0 ? "Chưa thu" : gap > 0 ? "Thu một phần" : "Đã thu đủ";
    return `<tr>
      <td>${textInput("inc", inc.id, "name", inc.name)}</td>
      <td><input type="date" data-kind="inc" data-id="${esc(inc.id)}" data-field="expectedDate" value="${esc(inc.expectedDate)}"></td>
      <td><input type="date" data-kind="inc" data-id="${esc(inc.id)}" data-field="date" value="${esc(inc.date)}"></td>
      <td><input class="num" data-kind="inc" data-id="${esc(inc.id)}" data-field="expected" data-money="1" value="${esc(formatVnd(inc.expected))}"></td>
      <td><input class="num" data-kind="inc" data-id="${esc(inc.id)}" data-field="received" data-money="1" value="${esc(formatVnd(inc.received))}"></td>
      <td><select data-kind="inc" data-id="${esc(inc.id)}" data-field="method">${options(METHODS, inc.method)}</select></td>
      <td><span data-out="inc-label-${esc(inc.id)}">${esc(label)}</span><div class="muted" data-out="inc-gap-${esc(inc.id)}">${esc(money(gap))} còn</div></td>
      <td><button type="button" class="btn tiny danger" data-action="del-inc" data-id="${esc(inc.id)}" aria-label="Xóa đợt thu">×</button></td>
    </tr>`;
  }).join("");
  return `<section class="panel">
    <form class="entry income" id="incForm">
      <label class="field"><span>Tên đợt</span><input name="name" required placeholder="Tạm ứng 50%"></label>
      <label class="field"><span>Ngày dự kiến</span><input type="date" name="expectedDate"></label>
      <label class="field"><span>Ngày tiền về</span><input type="date" name="date"></label>
      <label class="field"><span>Phải thu</span><input class="num" name="expected" data-money="1" placeholder="0"></label>
      <label class="field"><span>Đã về</span><input class="num" name="received" data-money="1" placeholder="0"></label>
      <label class="field"><span>Hình thức</span><select name="method">${options(METHODS, "Chuyển khoản")}</select></label>
      <button class="btn primary" type="submit">Thêm</button>
    </form>
    <div class="table-scroll"><table>
      <thead><tr><th>Đợt</th><th>Dự kiến</th><th>Tiền về</th><th class="right">Phải thu</th><th class="right">Đã thu</th><th>Hình thức</th><th>Tình trạng</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="8" class="empty">Chưa có đợt thu.</td></tr>`}</tbody>
    </table></div>
  </section>`;
}

function chartSvg(rows) {
  const used = state.forecast ? rows : rows.filter((row) => row.actual);
  if (!used.length) return `<p class="empty">Chưa có mốc tiền để vẽ.</p>`;
  const points = [{ y: 0 }, ...used.map((row) => ({ y: state.forecast ? row.forecastBalance : row.balance }))];
  const ys = points.map((point) => point.y);
  const min = Math.min(0, ...ys);
  const max = Math.max(0, ...ys);
  const span = max - min || 1;
  const W = 720;
  const H = 200;
  const pad = 18;
  const X = (i) => pad + (i / (points.length - 1 || 1)) * (W - pad * 2);
  const Y = (v) => pad + (1 - (v - min) / span) * (H - pad * 2);
  const d = points.map((point, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(point.y).toFixed(1)}`).join(" ");
  const last = points.at(-1).y;
  const color = last < 0 ? "var(--out)" : "var(--in)";
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Biểu đồ số dư dòng tiền">
    <line class="zero" x1="${pad}" x2="${W - pad}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}"></line>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"></path>
  </svg>`;
}

function renderFlow(project) {
  const rows = buildCashflow(project);
  const body = rows.map((row) => `<tr class="${row.actual ? "" : "forecast"}">
    <td>${esc(fmtDate(row.date))}</td>
    <td>${row.actual ? "Thực tế" : "Dự kiến"}</td>
    <td>${esc(row.name)}</td>
    <td class="right num in">${row.kind === "in" ? esc(money(row.amount)) : ""}</td>
    <td class="right num out">${row.kind === "out" ? esc(money(row.amount)) : ""}</td>
    <td class="right num">${row.balance == null ? "" : esc(money(row.balance))}</td>
    <td class="right num">${esc(money(row.forecastBalance))}</td>
  </tr>`).join("");
  return `<section class="panel">
    <div class="flow-tools">
      <label class="checks"><input type="checkbox" id="forecastToggle" ${state.forecast ? "checked" : ""}> Gồm các khoản dự kiến</label>
      <div class="legend"><span><b class="a"></b>Số dư đã xảy ra</span><span><b class="f"></b>Đường đang vẽ theo bộ lọc</span></div>
    </div>
    <div class="chart-wrap">${chartSvg(rows)}</div>
    <div class="table-scroll"><table>
      <thead><tr><th>Ngày</th><th>Loại</th><th>Nội dung</th><th class="right">Thu</th><th class="right">Chi</th><th class="right">Số dư thực</th><th class="right">Số dư dự kiến</th></tr></thead>
      <tbody>${body || `<tr><td colspan="7" class="empty">Chưa có dòng tiền.</td></tr>`}</tbody>
    </table></div>
    <p class="muted">Số dư thực chỉ tính tiền đã về và khoản đã chi hoặc tạm ứng. Số dư dự kiến cộng phần còn phải thu và phần dự toán chưa chi.</p>
  </section>`;
}

function renderMain() {
  const project = active();
  const main = $("#main");
  if (!project) {
    main.innerHTML = `<section class="panel"><p class="empty">Chưa có dự án.</p>
      <div class="modal-actions" style="justify-content:center">
        <button type="button" class="btn primary" id="emptyNew">Tạo dự án trống</button>
        <button type="button" class="btn" id="emptyTemplate">Bộ hạng mục TVC</button>
        <button type="button" class="btn" id="emptyDemo">Xem dự án ví dụ</button>
      </div></section>`;
    return;
  }
  const summary = summarize(project);
  const views = {
    overview: renderOverview,
    budget: renderBudget,
    spend: renderSpend,
    income: renderIncome,
    flow: renderFlow,
  };
  main.innerHTML = views[state.tab](project, summary);
  document.title = `${project.meta.name} · Sổ dòng tiền TVC`;
}

function contractHint(project, summary) {
  const rate = project.meta.vatRate;
  if (project.meta.vatMode === "none" || !rate) {
    return `Không tính VAT. Giá trị ghi nhận ${money(summary.contractGross)}.`;
  }
  if (project.meta.vatMode === "included") {
    return `Số nhập là tổng đã gồm VAT. Net ${money(summary.contractNet)} · VAT ${money(summary.contractVat)}.`;
  }
  return `Giá chưa VAT. VAT ${rate}% = ${money(summary.contractVat)} · Tổng ghi nhận ${money(summary.contractGross)}.`;
}

function refreshNumbers() {
  const project = active();
  const set = (key, value) => {
    document.querySelectorAll(`[data-out="${CSS.escape(key)}"]`).forEach((el) => {
      if (el.dataset.bar != null || el.tagName === "I") el.style.width = value;
      else el.textContent = value;
    });
  };
  if (!project) {
    ["kpi-contract", "kpi-budget", "kpi-spent", "kpi-remain", "kpi-received", "kpi-cash"].forEach((key) => set(key, "—"));
    set("kpi-sub", "");
    $("#kpi-cash").closest(".kpi").classList.remove("neg");
    return;
  }
  const summary = summarize(project);
  set("kpi-contract", money(summary.contractGross));
  set("kpi-budget", money(summary.budgetGross));
  set("kpi-spent", money(summary.spent));
  set("kpi-remain", money(summary.budgetLeft));
  set("kpi-received", money(summary.received));
  set("kpi-cash", money(summary.cash));
  $("#kpi-cash").closest(".kpi").classList.toggle("neg", summary.cash < 0);
  const marginWord = summary.margin < 0 ? "lỗ dự kiến" : "lãi gộp dự kiến";
  set("kpi-sub", `${marginWord} ${money(summary.margin)} · còn phải thu ${money(summary.receivable)}${summary.spentPending ? ` · chờ duyệt ${money(summary.spentPending)}` : ""}`);
  set("contract-hint", contractHint(project, summary));
  set("unassigned", summary.unassignedSpent ? `Có ${money(summary.unassignedSpent)} đã chi nhưng chưa gắn vào hạng mục dự toán.` : "");
  for (const phase of PHASES) {
    const row = summary.byPhase[phase.id];
    const pct = row.gross > 0 ? Math.min(100, Math.round((row.spent / row.gross) * 100)) : 0;
    set(`bar-${phase.id}`, `${pct}%`);
    set(`spent-${phase.id}`, money(row.spent));
    set(`gross-${phase.id}`, money(row.gross));
  }
  for (const line of project.lines) {
    const row = summary.byLine[line.id];
    set(`gross-${line.id}`, money(row.gross));
    set(`spent-line-${line.id}`, money(row.spent));
    const tr = document.querySelector(`[data-line-row="${CSS.escape(line.id)}"]`);
    if (tr) tr.classList.toggle("over", row.gross > 0 && row.spent > row.gross);
  }
  for (const inc of project.incomes) {
    const gap = Math.max(0, Math.round(inc.expected) - Math.round(inc.received));
    const label = inc.received <= 0 ? "Chưa thu" : gap > 0 ? "Thu một phần" : "Đã thu đủ";
    set(`inc-label-${inc.id}`, label);
    set(`inc-gap-${inc.id}`, `${money(gap)} còn`);
  }
  const alerts = $("#alerts");
  if (alerts) {
    alerts.innerHTML = summary.alerts.map((alert) => `<div class="alert ${esc(alert.level)}">${esc(alert.text)}</div>`).join("");
  }
  const option = document.querySelector(`#projectSelect option[value="${CSS.escape(project.id)}"]`);
  if (option) option.textContent = projectLabel(project);
}

function render() {
  renderSelect();
  renderBanner();
  renderTabs();
  renderMain();
  refreshNumbers();
  fillLists();
}

function fillLists() {
  $("#catList").innerHTML = CATEGORIES.map((item) => `<option value="${esc(item)}"></option>`).join("");
  $("#unitList").innerHTML = UNITS.map((item) => `<option value="${esc(item)}"></option>`).join("");
}

function findItem(list, id) {
  return list.find((item) => item.id === id);
}

function applyField(input) {
  const project = active();
  if (!project || !input.dataset.kind || !input.dataset.field) return false;
  let value;
  if (input.type === "checkbox") value = input.checked;
  else if (input.dataset.money != null) value = parseMoney(input.value);
  else if (input.dataset.qty != null) value = parseQty(input.value);
  else if (input.dataset.num != null) {
    const n = Number(input.value);
    value = Number.isFinite(n) ? n : 0;
  }
  else value = input.value;
  const { kind, field, id } = input.dataset;
  if (kind === "meta") project.meta[field] = value;
  if (kind === "line") {
    const line = findItem(project.lines, id);
    if (line) line[field] = value;
  }
  if (kind === "exp") {
    const exp = findItem(project.expenses, id);
    if (exp) exp[field] = value;
  }
  if (kind === "inc") {
    const inc = findItem(project.incomes, id);
    if (inc) inc[field] = value;
  }
  return true;
}

function touch(rerender = false) {
  const project = active();
  if (!project) return;
  project.updatedAt = new Date().toISOString();
  project.demo = false;
  saveLocal();
  if (rerender) renderMain();
  refreshNumbers();
  renderBanner();
  if (project.cloud && state.autoSync) scheduleSync(project);
  else if (project.cloud) setSync("Có thay đổi chưa đẩy lên bản chia sẻ", false);
  else setSync("Đã lưu trên máy này");
}

function scheduleSync(project) {
  clearTimeout(state.syncTimer);
  setSync("Sẽ lưu bản chia sẻ…");
  state.syncTimer = setTimeout(() => { syncCloud(project).catch(() => {}); }, 900);
}

async function syncCloud(project) {
  if (!project) return "";
  if (state.syncing) {
    state.syncQueued = true;
    return "";
  }
  state.syncing = true;
  setSync("Đang lưu bản chia sẻ…");
  try {
    const cloud = await publishProject(project);
    project.cloud = { ns: cloud.ns, wk: cloud.wk, ek: cloud.ek };
    project.syncedAt = cloud.syncedAt;
    saveLocal();
    if (active()?.id === project.id) syncAddress();
    setSync("Đã lưu bản chia sẻ");
    return shareUrl(cloudHash(cloud));
  } catch (error) {
    const tooBig = error.code === "too-big" || error.message === "too-big";
    setSync(tooBig ? "Bản online vượt dung lượng. Hãy tải file JSON." : "Chưa lưu được lên mạng. Dữ liệu vẫn nằm trên máy này.", false);
    throw error;
  } finally {
    state.syncing = false;
    if (state.syncQueued) {
      state.syncQueued = false;
      syncCloud(project).catch(() => {});
    }
  }
}

function addProject(project, { editName = false } = {}) {
  if (state.projects.some((item) => item.id === project.id)) project.id = uid("p");
  state.projects.unshift(project);
  state.activeId = project.id;
  state.tab = "overview";
  state.pendingRemote = null;
  saveLocal();
  syncAddress();
  render();
  if (editName) {
    const input = document.querySelector('[data-kind="meta"][data-field="name"]');
    input?.focus();
    input?.select();
  }
}

function openModal(title, body) {
  const root = $("#modal");
  root.hidden = false;
  root.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
    <h2 id="modalTitle">${esc(title)}</h2>
    ${body}
  </div>`;
  root.querySelector("[data-close]")?.focus();
}

function closeModal() {
  $("#modal").hidden = true;
  $("#modal").innerHTML = "";
}

function ask(message) {
  return new Promise((resolve) => {
    openModal("Xác nhận", `<p>${esc(message)}</p>
      <div class="modal-actions">
        <button type="button" class="btn" id="askNo">Hủy</button>
        <button type="button" class="btn danger" id="askYes">Xóa</button>
      </div>`);
    $("#askYes").onclick = () => { closeModal(); resolve(true); };
    $("#askNo").onclick = () => { closeModal(); resolve(false); };
  });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Đã chép");
  } catch {
    toast("Hãy chọn ô và chép thủ công");
  }
}

function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function openShare() {
  const project = active();
  if (!project) return;
  let snapshot = "";
  let snapshotNote = "Link ảnh chụp đóng băng số liệu tại thời điểm này. Người nhận mở ra thành bản trên máy họ.";
  try {
    snapshot = await encodeSnapshot(project);
  } catch {
    snapshotNote = "Dự án này dài quá, không nhét vừa một link ảnh chụp. Hãy tải file JSON.";
  }
  const cloud = project.cloud?.ek ? shareUrl(cloudHash(project.cloud)) : "";
  openModal("Chia sẻ và lưu trữ", `<div class="stack">
    <p>Bản trên máy này luôn được lưu trong trình duyệt. Bản online mã hóa nội dung trước khi gửi đi. Ai có đủ link đều xem và sửa được. Kho giữ bản đó khoảng 90 ngày kể từ lần lưu gần nhất nếu không có cập nhật mới.</p>
    <label class="checks"><input type="checkbox" id="autoSync" ${state.autoSync ? "checked" : ""}> Tự cập nhật bản online sau mỗi lần sửa</label>
    <div class="linkbox">
      <input id="cloudLink" readonly value="${esc(cloud)}" placeholder="Chưa có link online">
      <button type="button" class="btn" id="copyCloud" ${cloud ? "" : "disabled"}>Chép</button>
    </div>
    <div class="modal-actions" style="margin-top:0">
      <button type="button" class="btn primary" id="saveCloud">${cloud ? "Cập nhật bản online" : "Tạo link online"}</button>
    </div>
    <label class="field"><span>Link ảnh chụp</span>
      <div class="linkbox"><input id="snapLink" readonly value="${esc(snapshot ? shareUrl(`s=${snapshot}`) : "")}" placeholder="${esc(snapshotNote)}">
      <button type="button" class="btn" id="copySnap" ${snapshot ? "" : "disabled"}>Chép</button></div>
    </label>
    <p>${esc(snapshotNote)}</p>
    <div class="modal-actions" style="margin-top:0">
      <button type="button" class="btn" id="modalJson">Tải JSON</button>
      <button type="button" class="btn" id="modalCsv">Tải CSV</button>
      <button type="button" class="btn" id="modalImport">Nhập JSON</button>
      <button type="button" class="btn" data-close="1">Đóng</button>
    </div>
  </div>`);
}

function openNewMenu() {
  openModal("Dự án mới", `<p>Chọn cách bắt đầu sổ cho một job TVC.</p>
    <div class="modal-actions" style="justify-content:flex-start">
      <button type="button" class="btn primary" id="makeBlank">Sổ trống</button>
      <button type="button" class="btn" id="makeTemplate">Bộ hạng mục sẵn</button>
      <button type="button" class="btn" id="makeDemo">Dự án ví dụ</button>
      <button type="button" class="btn" data-close="1">Đóng</button>
    </div>`);
}

function exportJson() {
  const project = active();
  if (!project) return;
  download(`${slug(project.meta.code || project.meta.name)}.json`, JSON.stringify(project, null, 2), "application/json");
  toast("Đã tải file JSON");
}

function exportCsv() {
  const project = active();
  if (!project) return;
  download(`${slug(project.meta.code || project.meta.name)}.csv`, toCsv(project), "text/csv;charset=utf-8");
  toast("Đã tải CSV");
}

function importProjects(list) {
  const projects = list.map((item) => normalizeProject(item));
  if (!projects.length) throw new Error("File không có dự án.");
  for (const project of projects) {
    if (state.projects.some((item) => item.id === project.id)) project.id = uid("p");
    state.projects.unshift(project);
  }
  state.activeId = projects[0].id;
  state.tab = "overview";
  saveLocal();
  syncAddress();
  render();
  toast(`Đã nhập ${projects.length} dự án`);
}

function printReport() {
  const project = active();
  if (!project) return;
  const summary = summarize(project);
  const lineRows = project.lines.map((line) => {
    const fig = summary.byLine[line.id];
    const phase = PHASES.find((item) => item.id === line.phase)?.label || "";
    return `<tr><td>${esc(phase)}</td><td>${esc(line.name)}</td><td>${esc(line.vendor)}</td><td>${esc(line.qty)} ${esc(line.unit)}</td><td>${esc(money(fig.gross))}</td><td>${esc(money(fig.spent))}</td></tr>`;
  }).join("");
  const expRows = project.expenses.map((exp) => `<tr><td>${esc(fmtDate(exp.date))}</td><td>${esc(exp.name)}</td><td>${esc(money(exp.amount))}</td><td>${esc(EXP_STATUSES.find((item) => item.id === exp.status)?.label || "")}</td></tr>`).join("");
  const incRows = project.incomes.map((inc) => `<tr><td>${esc(inc.name)}</td><td>${esc(money(inc.expected))}</td><td>${esc(money(inc.received))}</td><td>${esc(fmtDate(inc.date || inc.expectedDate))}</td></tr>`).join("");
  $("#printSheet").innerHTML = `<h1>${esc(project.meta.name)}</h1>
    <p>${esc(project.meta.client)} · ${esc(statusLabel(project.meta.status))} · Quay ${esc(fmtDate(project.meta.shootDate))} · Giao ${esc(fmtDate(project.meta.deliveryDate))}</p>
    <p>Hợp đồng ${esc(money(summary.contractGross))} · Dự toán ${esc(money(summary.budgetGross))} · Đã chi ${esc(money(summary.spent))} · Đã thu ${esc(money(summary.received))} · Số dư ${esc(money(summary.cash))}</p>
    <h2>Dự toán</h2><table><thead><tr><th>Giai đoạn</th><th>Hạng mục</th><th>Nhà cung cấp</th><th>KL</th><th>Thành tiền</th><th>Đã chi</th></tr></thead><tbody>${lineRows}</tbody></table>
    <h2>Thực chi</h2><table><tbody>${expRows}</tbody></table>
    <h2>Thu tiền</h2><table><tbody>${incRows}</tbody></table>`;
  window.print();
}

async function removeProject() {
  const project = active();
  if (!project) return;
  const ok = await ask(`Xóa "${project.meta.name}" trên máy này?`);
  if (!ok) return;
  if (project.cloud?.ns) deleteRemote(project.cloud.ns, project.cloud.wk || "").catch(() => {});
  state.projects = state.projects.filter((item) => item.id !== project.id);
  state.activeId = state.projects[0]?.id || null;
  state.pendingRemote = null;
  saveLocal();
  syncAddress();
  render();
  setSync(state.projects.length ? "Đã lưu trên máy này" : "Chưa có dự án");
}

function usePendingRemote() {
  const remote = state.pendingRemote;
  if (!remote) return;
  const local = state.projects.find((project) => project.cloud?.ns === remote.cloud.ns);
  remote.id = local?.id || remote.id;
  if (local) {
    const index = state.projects.indexOf(local);
    state.projects[index] = remote;
  } else state.projects.unshift(remote);
  state.activeId = remote.id;
  state.pendingRemote = null;
  saveLocal();
  render();
  toast("Đã lấy bản trên link");
}

async function absorbCloud(ns, wk, ek) {
  const remoteRaw = await openCloud(ns, wk, ek);
  const remote = normalizeProject(remoteRaw);
  remote.cloud = { ns, wk: wk || "", ek };
  remote.syncedAt = remote.updatedAt;
  const local = state.projects.find((project) => project.cloud?.ns === ns);
  if (local && local.updatedAt > remote.updatedAt && local.syncedAt !== local.updatedAt) {
    state.pendingRemote = remote;
    state.activeId = local.id;
    return;
  }
  if (local) {
    remote.id = local.id;
    state.projects[state.projects.indexOf(local)] = remote;
  } else state.projects.unshift(remote);
  state.activeId = remote.id;
  saveLocal();
}

async function absorbSnapshot(encoded) {
  const raw = await decodeSnapshot(encoded);
  const project = normalizeProject(raw);
  project.id = uid("p");
  project.cloud = null;
  project.syncedAt = null;
  project.demo = false;
  project.updatedAt = new Date().toISOString();
  state.projects.unshift(project);
  state.activeId = project.id;
  saveLocal();
  toast("Đã mở bản chụp trên máy này");
}

document.addEventListener("input", (event) => {
  const target = event.target;
  if (target.id === "expSearch") {
    state.query = target.value;
    const q = state.query.toLowerCase();
    document.querySelectorAll("[data-exp-row]").forEach((row) => {
      row.hidden = Boolean(q) && !row.dataset.hay.includes(q);
    });
    return;
  }
  if (target.id === "autoSync") return;
  if (!applyField(target)) return;
  touch(false);
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (target.id === "projectSelect") {
    state.activeId = target.value;
    state.pendingRemote = null;
    state.query = "";
    saveLocal();
    syncAddress();
    render();
    return;
  }
  if (target.id === "forecastToggle") {
    state.forecast = target.checked;
    renderMain();
    return;
  }
  if (target.id === "autoSync") {
    state.autoSync = target.checked;
    saveLocal();
    if (state.autoSync && active()?.cloud) scheduleSync(active());
    return;
  }
  if (target.dataset?.money != null && document.activeElement !== target) {
    target.value = formatVnd(parseMoney(target.value));
  }
  if (!applyField(target)) return;
  touch(target.dataset.rerender === "1");
});

document.addEventListener("focusout", (event) => {
  const target = event.target;
  if (target?.dataset?.money != null) target.value = formatVnd(parseMoney(target.value));
});

document.addEventListener("click", async (event) => {
  const tab = event.target.closest?.(".tab");
  if (tab) {
    state.tab = tab.dataset.tab;
    renderTabs();
    renderMain();
    refreshNumbers();
    return;
  }
  const action = event.target.closest?.("[data-action]");
  if (action) {
    const project = active();
    if (action.dataset.action === "add-line" && project) {
      const line = blankLine(action.dataset.phase);
      project.lines.push(line);
      touch(true);
      document.querySelector(`[data-line-row="${CSS.escape(line.id)}"] input`)?.focus();
    }
    if (action.dataset.action === "del-line" && project) {
      project.lines = project.lines.filter((line) => line.id !== action.dataset.id);
      touch(true);
    }
    if (action.dataset.action === "del-exp" && project) {
      project.expenses = project.expenses.filter((exp) => exp.id !== action.dataset.id);
      touch(true);
    }
    if (action.dataset.action === "del-inc" && project) {
      project.incomes = project.incomes.filter((inc) => inc.id !== action.dataset.id);
      touch(true);
    }
  }
  const id = event.target.id;
  if (id === "btnNew" || id === "bannerNew" || id === "emptyNew") {
    if (id === "emptyNew") addProject(normalizeProject({ meta: { name: "TVC mới" } }), { editName: true });
    else openNewMenu();
  }
  if (id === "emptyTemplate") addProject(templateProject(), { editName: true });
  if (id === "emptyDemo") addProject(demoProject());
  if (id === "makeBlank") {
    closeModal();
    addProject(normalizeProject({ meta: { name: "TVC mới" }, incomes: [blankIncome({ name: "Tạm ứng" }), blankIncome({ name: "Quyết toán" })] }), { editName: true });
  }
  if (id === "makeTemplate") { closeModal(); addProject(templateProject(), { editName: true }); }
  if (id === "makeDemo") { closeModal(); addProject(demoProject()); }
  if (id === "btnShare") openShare();
  if (id === "btnExport" || id === "modalJson") exportJson();
  if (id === "modalCsv") exportCsv();
  if (id === "modalImport") $("#fileJson").click();
  if (id === "btnPrint") printReport();
  if (id === "btnDup" && active()) addProject(duplicateProject(active()));
  if (id === "btnDelete") removeProject();
  if (id === "dismissDemo" && active()) { active().demo = false; saveLocal(); renderBanner(); }
  if (id === "useRemote") usePendingRemote();
  if (id === "keepLocal") { state.pendingRemote = null; renderBanner(); }
  if (id === "copyCloud") copyText($("#cloudLink").value);
  if (id === "copySnap") copyText($("#snapLink").value);
  if (id === "saveCloud") {
    const button = event.target;
    button.disabled = true;
    try {
      const url = await syncCloud(active());
      if ($("#cloudLink")) $("#cloudLink").value = url;
      $("#copyCloud")?.removeAttribute("disabled");
      toast("Đã tạo bản chia sẻ");
    } catch {
      toast(state.syncLabel);
    } finally {
      button.disabled = false;
    }
  }
  if (event.target.dataset.close != null || event.target.id === "modal") {
    if (event.target.id === "modal" && event.target !== $("#modal")) return;
    if (event.target.dataset.close != null || event.target.id === "modal") closeModal();
  }
});

document.addEventListener("submit", (event) => {
  const project = active();
  if (!project) return;
  if (event.target.id === "expForm") {
    event.preventDefault();
    const data = new FormData(event.target);
    const lineId = String(data.get("budgetLineId") || "");
    const linked = project.lines.find((line) => line.id === lineId);
    project.expenses.unshift(blankExpense({
      date: String(data.get("date") || ""),
      name: String(data.get("name") || linked?.name || "Khoản chi"),
      vendor: String(data.get("vendor") || ""),
      amount: parseMoney(data.get("amount")),
      method: String(data.get("method") || "Chuyển khoản"),
      status: String(data.get("status") || "paid"),
      budgetLineId: lineId,
      vatIncluded: Boolean(linked?.vat),
    }));
    event.target.reset();
    touch(true);
    document.querySelector('#expForm input[name="name"]')?.focus();
  }
  if (event.target.id === "incForm") {
    event.preventDefault();
    const data = new FormData(event.target);
    project.incomes.push(blankIncome({
      name: String(data.get("name") || "Đợt thu"),
      expectedDate: String(data.get("expectedDate") || ""),
      date: String(data.get("date") || ""),
      expected: parseMoney(data.get("expected")),
      received: parseMoney(data.get("received")),
      method: String(data.get("method") || "Chuyển khoản"),
    }));
    event.target.reset();
    touch(true);
  }
});

$("#fileJson").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    if (file.size > 2_000_000) throw new Error("File lớn hơn 2MB.");
    const data = JSON.parse(await file.text());
    const list = Array.isArray(data) ? data : data.projects || [data];
    importProjects(list);
    closeModal();
  } catch (error) {
    toast(error.message || "Không đọc được file JSON");
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("#modal").hidden) closeModal();
});

async function boot() {
  loadLocal();
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  try {
    if (hash.get("ns")) await absorbCloud(hash.get("ns"), hash.get("wk") || "", hash.get("ek") || "");
    else if (hash.get("s")) await absorbSnapshot(hash.get("s"));
  } catch {
    toast("Không mở được link chia sẻ");
  }
  if (!state.projects.length) state.projects.push(demoProject());
  if (!active()) state.activeId = state.projects[0].id;
  saveLocal();
  render();
  syncAddress();
  setSync(active()?.cloud ? "Đã mở bản chia sẻ" : "Đã lưu trên máy này");
}

boot();
