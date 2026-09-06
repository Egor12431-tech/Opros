import { Hono } from "hono";
import { cors } from "hono/cors";
import { Pool } from "pg";

// ============================================================
// 1. ДИАГНОСТИКА ПРИ ЗАПУСКЕ
// ============================================================

console.log("=== ДИАГНОСТИКА ===");
console.log("PORT:", process.env.PORT);
console.log("DATABASE_URL exists:", !!process.env.DATABASE_URL);
if (process.env.DATABASE_URL) {
  console.log("DATABASE_URL starts with:", process.env.DATABASE_URL.substring(0, 40) + "...");
}
console.log("=== КОНЕЦ ДИАГНОСТИКИ ===");

// ============================================================
// 2. ПОДКЛЮЧЕНИЕ К БАЗЕ ДАННЫХ
// ============================================================

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: true,
});

// Создание таблиц
await pool.query(`
  CREATE TABLE IF NOT EXISTS survey_responses (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP DEFAULT NOW(),
    -- Раздел А (10)
    a1 INT, a2 INT, a3 INT, a4 INT, a5 INT,
    a6 INT, a7 INT, a8 INT, a9 INT, a10 INT,
    -- Оценки коллег (JSONB)
    colleagues JSONB,
    -- Раздел В: Социометрия
    v1 TEXT, v2 TEXT, v3 TEXT, v4 TEXT, v5 TEXT, v6 TEXT,
    -- Раздел Г: Дополнительно
    g1 TEXT, g2 TEXT, g3 INT, g4 INT, g5 TEXT
  );

  CREATE TABLE IF NOT EXISTS colleague_aggregates (
    id SERIAL PRIMARY KEY,
    colleague_name TEXT UNIQUE,
    total_ratings INT DEFAULT 0,
    avg_advocacy FLOAT DEFAULT 0,
    avg_support FLOAT DEFAULT 0,
    avg_mindset FLOAT DEFAULT 0,
    avg_reporting FLOAT DEFAULT 0,
    avg_reluctance FLOAT DEFAULT 0,
    category TEXT,
    updated_at TIMESTAMP DEFAULT NOW()
  );
`);

console.log("✅ База данных готова");

// ============================================================
// 3. ВСЕ ВОПРОСЫ
// ============================================================

const SECTION_A_QUESTIONS = [
  { id: "a1", text: "Как вы оцениваете отношение к безопасности на вашем участке?", options: [1, 2, 3, 4] },
  { id: "a2", text: "Ваш руководитель демонстрирует личный пример соблюдения правил безопасности?", options: [1, 2, 3, 4] },
  { id: "a3", text: "Сотрудники активно участвуют в обсуждении вопросов безопасности?", options: [1, 2, 3, 4] },
  { id: "a4", text: "Вы доверяете руководству в вопросах безопасности?", options: [1, 2, 3, 4] },
  { id: "a5", text: "Информация по безопасности доступна и понятна?", options: [1, 2, 3, 4] },
  { id: "a6", text: "Нарушения безопасности фиксируются и разбираются?", options: [1, 2, 3, 4] },
  { id: "a7", text: "В вашем подразделении регулярно проводятся встречи по безопасности?", options: [1, 2, 3, 4] },
  { id: "a8", text: "Встречи по безопасности эффективны и приводят к изменениям?", options: [1, 2, 3, 4] },
  { id: "a9", text: "Сотрудники проявляют инициативу в вопросах безопасности?", options: [1, 2, 3, 4] },
  { id: "a10", text: "Уровень доверия между работниками и руководством в вопросах безопасности высок?", options: [1, 2, 3, 4] },
];

const SECTION_B_QUESTIONS = [
  // Б1: Advocacy (6)
  { id: "b1_1", text: "Часто говорит коллегам о том, как сделать работу безопаснее", factor: "advocacy" },
  { id: "b1_2", text: "Предлагает руководству идеи по улучшению безопасности", factor: "advocacy" },
  { id: "b1_3", text: "Активно участвует в обсуждении вопросов безопасности", factor: "advocacy" },
  { id: "b1_4", text: "Берёт на себя инициативу, когда видит опасность", factor: "advocacy" },
  { id: "b1_5", text: "Делится с коллегами информацией о новых правилах", factor: "advocacy" },
  { id: "b1_6", text: "Поощряет других высказываться о безопасности", factor: "advocacy" },
  // Б2: Support (6)
  { id: "b2_1", text: "К нему приходят за советом по безопасности", factor: "support" },
  { id: "b2_2", text: "Помогает новым работникам освоить правила", factor: "support" },
  { id: "b2_3", text: "Готов прийти на помощь, если видит небезопасные действия", factor: "support" },
  { id: "b2_4", text: "Отзывчив на проблемы безопасности коллег", factor: "support" },
  { id: "b2_5", text: "Даёт практические советы по безопасности", factor: "support" },
  { id: "b2_6", text: "Поддерживает тех, кто сообщает о нарушениях", factor: "support" },
  // Б3: Mindset (6)
  { id: "b3_1", text: "Понимает, почему правила безопасности важны", factor: "mindset" },
  { id: "b3_2", text: "Безопасность для него — личный приоритет", factor: "mindset" },
  { id: "b3_3", text: "Может объяснить последствия нарушений", factor: "mindset" },
  { id: "b3_4", text: "Знает, как действовать в нештатной ситуации", factor: "mindset" },
  { id: "b3_5", text: "Уверен в своих знаниях по охране труда", factor: "mindset" },
  { id: "b3_6", text: "Считает безопасность не менее важной, чем план", factor: "mindset" },
  // Б4: Reporting (6)
  { id: "b4_1", text: "Сообщает о нарушениях, чтобы их исправить", factor: "reporting" },
  { id: "b4_2", text: "Не боится говорить о проблемах безопасности", factor: "reporting" },
  { id: "b4_3", text: "Поощряет сообщать о «почти-инцидентах»", factor: "reporting" },
  { id: "b4_4", text: "Честно рассказывает о своих ошибках", factor: "reporting" },
  { id: "b4_5", text: "Поддерживает культуру открытости", factor: "reporting" },
  { id: "b4_6", text: "Считает важным документировать все инциденты", factor: "reporting" },
  // Б5: Reluctance (6) — ОБРАТНАЯ ШКАЛА
  { id: "b5_1", text: "Редко участвует в инициативах по безопасности", factor: "reluctance", reverse: true },
  { id: "b5_2", text: "Неохотно обсуждает безопасность, если это не касается его лично", factor: "reluctance", reverse: true },
  { id: "b5_3", text: "Редко делится информацией по безопасности", factor: "reluctance", reverse: true },
  { id: "b5_4", text: "Не вмешивается в вопросы безопасности других", factor: "reluctance", reverse: true },
  { id: "b5_5", text: "Считает, что безопасность — дело руководителя", factor: "reluctance", reverse: true },
  { id: "b5_6", text: "Избегает ответственности за безопасность", factor: "reluctance", reverse: true },
];

const SECTION_V_QUESTIONS = [
  { id: "v1", text: "К кому из коллег вы обратились бы за советом по безопасности?" },
  { id: "v2", text: "Кого вы НЕ хотели бы видеть в роли лидера безопасности?" },
  { id: "v3", text: "С кем вы хотели бы работать над улучшением безопасности?" },
  { id: "v4", text: "Кто из коллег лучше всех знает правила безопасности?" },
  { id: "v5", text: "Кто чаще всего подаёт пример безопасного поведения?" },
  { id: "v6", text: "Кого вы НЕ хотели бы видеть в рабочей группе по безопасности?" },
];

const SECTION_G_QUESTIONS = [
  { id: "g1", text: "Ваш стаж работы в компании", options: ["менее 1 года", "1-3 года", "3-5 лет", "5-10 лет", "более 10 лет"] },
  { id: "g2", text: "Ваше подразделение (цех, участок)", type: "text" },
  { id: "g3", text: "Как часто вы участвуете в мероприятиях по безопасности?", options: ["Всегда", "Часто", "Иногда", "Редко", "Не участвую"] },
  { id: "g4", text: "Как вы оцениваете доступность инструкций по безопасности?", options: ["Отлично", "Хорошо", "Удовлетворительно", "Плохо", "Не знаю"] },
  { id: "g5", text: "Что мешает соблюдать правила безопасности?", options: ["Нехватка времени", "Сложность оборудования", "Неудобство СИЗ", "Непонимание правил", "Отсутствие контроля", "Давление руководства"] },
];

// ============================================================
// 4. ФУНКЦИЯ АНАЛИЗА ДЛЯ ОДНОГО КОЛЛЕГИ
// ============================================================

function analyzeColleague(scores: Record<string, number>) {
  const factors = {
    advocacy: 0,
    support: 0,
    mindset: 0,
    reporting: 0,
    reluctance: 0,
  };

  let count = 0;
  for (const [key, value] of Object.entries(scores)) {
    if (key.startsWith("b1_")) { factors.advocacy += value; count++; }
    else if (key.startsWith("b2_")) { factors.support += value; count++; }
    else if (key.startsWith("b3_")) { factors.mindset += value; count++; }
    else if (key.startsWith("b4_")) { factors.reporting += value; count++; }
    else if (key.startsWith("b5_")) { factors.reluctance += value; count++; }
  }

  for (const key of Object.keys(factors)) {
    factors[key as keyof typeof factors] = Math.round((factors[key as keyof typeof factors] / 6) * 100) / 100;
  }

  let category = "Нейтральный";
  if (
    factors.advocacy >= 4.0 &&
    factors.support >= 4.0 &&
    factors.mindset >= 4.0 &&
    factors.reporting >= 4.0 &&
    factors.reluctance >= 3.5
  ) {
    category = "Лидер безопасности";
  } else if (
    factors.advocacy >= 3.5 &&
    factors.support >= 3.5 &&
    factors.mindset >= 3.5
  ) {
    category = "Кандидат в лидеры";
  } else if (factors.reluctance < 3.0) {
    category = "Лидер сопротивления";
  }

  return { factors, category };
}

// ============================================================
// 5. СОХРАНЕНИЕ И АГРЕГАЦИЯ
// ============================================================

async function saveResponse(data: any) {
  const query = `
    INSERT INTO survey_responses (
      a1, a2, a3, a4, a5, a6, a7, a8, a9, a10,
      colleagues,
      v1, v2, v3, v4, v5, v6,
      g1, g2, g3, g4, g5
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11,
      $12, $13, $14, $15, $16, $17,
      $18, $19, $20, $21, $22
    )
  `;

  const params = [
    data.a1, data.a2, data.a3, data.a4, data.a5,
    data.a6, data.a7, data.a8, data.a9, data.a10,
    JSON.stringify(data.colleagues || []),
    data.v1 || "", data.v2 || "", data.v3 || "",
    data.v4 || "", data.v5 || "", data.v6 || "",
    data.g1, data.g2, data.g3, data.g4, data.g5,
  ];

  await pool.query(query, params);
}

async function updateAggregates(colleagues: any[]) {
  for (const col of colleagues) {
    const name = col.name;
    if (!name || name.trim() === "") continue;

    const analysis = analyzeColleague(col.scores);

    // Проверяем, есть ли уже запись
    const existing = await pool.query(
      "SELECT * FROM colleague_aggregates WHERE colleague_name = $1",
      [name]
    );

    if (existing.rows.length > 0) {
      const current = existing.rows[0];
      const total = current.total_ratings + 1;
      const avgAdvocacy = ((current.avg_advocacy * current.total_ratings) + analysis.factors.advocacy) / total;
      const avgSupport = ((current.avg_support * current.total_ratings) + analysis.factors.support) / total;
      const avgMindset = ((current.avg_mindset * current.total_ratings) + analysis.factors.mindset) / total;
      const avgReporting = ((current.avg_reporting * current.total_ratings) + analysis.factors.reporting) / total;
      const avgReluctance = ((current.avg_reluctance * current.total_ratings) + analysis.factors.reluctance) / total;

      // Пересчёт категории на основе средних
      let category = "Нейтральный";
      if (avgAdvocacy >= 4.0 && avgSupport >= 4.0 && avgMindset >= 4.0 && avgReporting >= 4.0 && avgReluctance >= 3.5) {
        category = "Лидер безопасности";
      } else if (avgAdvocacy >= 3.5 && avgSupport >= 3.5 && avgMindset >= 3.5) {
        category = "Кандидат в лидеры";
      } else if (avgReluctance < 3.0) {
        category = "Лидер сопротивления";
      }

      await pool.query(
        `UPDATE colleague_aggregates SET
          total_ratings = $1,
          avg_advocacy = $2,
          avg_support = $3,
          avg_mindset = $4,
          avg_reporting = $5,
          avg_reluctance = $6,
          category = $7,
          updated_at = NOW()
        WHERE colleague_name = $8`,
        [total, avgAdvocacy, avgSupport, avgMindset, avgReporting, avgReluctance, category, name]
      );
    } else {
      // Новая запись
      await pool.query(
        `INSERT INTO colleague_aggregates (
          colleague_name, total_ratings,
          avg_advocacy, avg_support, avg_mindset, avg_reporting, avg_reluctance,
          category
        ) VALUES ($1, 1, $2, $3, $4, $5, $6, $7)`,
        [name,
          analysis.factors.advocacy,
          analysis.factors.support,
          analysis.factors.mindset,
          analysis.factors.reporting,
          analysis.factors.reluctance,
          analysis.category
        ]
      );
    }
  }
}

// ============================================================
// 6. МАРШРУТЫ
// ============================================================

const app = new Hono();
app.use("/*", cors());

app.get("/", async (c) => c.text("🛡️ ISL Survey API"));

app.get("/api/health", async (c) => c.json({ status: "ok" }));

// СТРАНИЦА ОПРОСНИКА
app.get("/survey", async (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ISL Опросник</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Segoe UI',sans-serif; background:linear-gradient(135deg,#1a2a6c,#2d4373); min-height:100vh; padding:30px 20px; }
    .container { max-width:900px; margin:0 auto; background:white; border-radius:20px; padding:40px; box-shadow:0 20px 60px rgba(0,0,0,0.3); }
    h1 { color:#1a2a6c; font-size:28px; }
    .subtitle { color:#666; }
    .badge { display:inline-block; background:#1a2a6c; color:white; padding:4px 16px; border-radius:20px; font-size:13px; margin-bottom:20px; }
    .section-title { color:#1a2a6c; font-size:20px; margin:30px 0 15px 0; border-bottom:2px solid #e8f0fe; padding-bottom:5px; }
    .section-desc { color:#666; font-size:14px; margin-bottom:15px; }
    .question-block { background:#f8f9fa; padding:15px 20px; border-radius:10px; margin-bottom:12px; border-left:4px solid #1a2a6c; }
    .question-block .qtext { font-weight:500; margin-bottom:8px; font-size:15px; }
    .options { display:flex; gap:15px; flex-wrap:wrap; }
    .options label { display:flex; align-items:center; gap:5px; cursor:pointer; font-size:14px; }
    .text-input { padding:8px 12px; border:1px solid #ccc; border-radius:6px; width:100%; max-width:400px; font-size:14px; }
    .text-input:focus { outline:none; border-color:#1a2a6c; }
    .btn { padding:12px 24px; border:none; border-radius:10px; font-size:16px; font-weight:600; cursor:pointer; }
    .btn-success { background:#28a745; color:white; }
    .btn-success:hover { transform:translateY(-2px); }
    .btn-danger { background:#dc3545; color:white; }
    .btn-danger:hover { transform:translateY(-2px); }
    .btn-submit { display:block; width:100%; padding:16px; background:linear-gradient(135deg,#1a2a6c,#2d4373); color:white; border:none; border-radius:12px; font-size:18px; font-weight:600; cursor:pointer; margin-top:30px; }
    .btn-submit:hover { transform:translateY(-2px); }
    .btn-submit:disabled { opacity:0.6; cursor:not-allowed; }
    .colleague-block { background:#e8f0fe; border-radius:12px; padding:20px; margin:20px 0; border:2px dashed #1a2a6c; }
    .colleague-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; }
    .result { margin-top:25px; padding:25px; border-radius:12px; display:none; }
    .result.success { background:#e8f5e9; border-left:4px solid #28a745; display:block; }
    .result.error { background:#fce4ec; border-left:4px solid #dc3545; display:block; }
    .progress { background:#e0e0e0; border-radius:10px; height:8px; margin-bottom:20px; overflow:hidden; }
    .progress-bar { height:100%; background:linear-gradient(135deg,#1a2a6c,#2d4373); border-radius:10px; transition:width 0.3s; width:0%; }
    .footer { text-align:center; margin-top:20px; color:#999; font-size:12px; }
    .anonymity-badge { background:#e8f5e9; padding:10px 16px; border-radius:8px; margin-bottom:20px; border-left:4px solid #28a745; }
    .anonymity-badge strong { color:#1a2a6c; }
    @media (max-width:600px) { .container { padding:20px; } .options { gap:10px; } }
  </style>
</head>
<body>
<div class="container">
  <h1>🛡️ ISL Опросник</h1>
  <p class="subtitle">Оценка неформального лидерства в безопасности</p>
  <span class="badge">Оренбургский филиал ООО «Газпромтранс»</span>

  <div class="anonymity-badge">
    <strong>🔒 Анонимный опрос</strong> — ваши ответы не привязаны к вашей фамилии.
  </div>

  <div class="progress"><div class="progress-bar" id="progressBar"></div></div>

  <form id="surveyForm">
    <input type="hidden" id="colleaguesData" name="colleaguesData">

    <!-- Раздел А -->
    <div class="section-title">📋 Раздел А. Культура безопасности</div>
    <div id="sectionA"></div>

    <!-- Раздел Б -->
    <div class="section-title">📌 Раздел Б. Оценка коллег</div>
    <div class="section-desc">Добавьте каждого коллегу, которого хотите оценить.</div>
    <div id="colleaguesContainer"></div>
    <button type="button" class="btn btn-success" onclick="addColleague()">➕ Добавить коллегу</button>

    <!-- Раздел В -->
    <div class="section-title">👥 Раздел В. Социометрия</div>
    <div id="sectionV"></div>

    <!-- Раздел Г -->
    <div class="section-title">ℹ️ Раздел Г. Дополнительная информация</div>
    <div id="sectionG"></div>

    <p style="color:#999;font-size:13px;margin:15px 0;border-top:1px solid #eee;padding-top:15px;">
      ⏱ Время: 20-30 мин · <span id="answeredCount">0</span>/<span id="totalCount">0</span>
    </p>

    <button type="submit" class="btn-submit" id="submitBtn">📤 Отправить ответы</button>
  </form>

  <div id="result" class="result"></div>
  <div class="footer">© ООО «Газпромтранс» · Оренбургский филиал · 2026</div>
</div>

<script>
  const sectionAQuestions = ${JSON.stringify(SECTION_A_QUESTIONS)};
  const sectionBQuestions = ${JSON.stringify(SECTION_B_QUESTIONS)};
  const sectionVQuestions = ${JSON.stringify(SECTION_V_QUESTIONS)};
  const sectionGQuestions = ${JSON.stringify(SECTION_G_QUESTIONS)};

  let colleagueCount = 0;

  function renderSectionA() {
    const container = document.getElementById('sectionA');
    let html = '';
    sectionAQuestions.forEach((q, i) => {
      html += \`
        <div class="question-block">
          <div class="qtext">\${i+1}. \${q.text}</div>
          <div class="options">
            \${q.options.map(opt => \`
              <label><input type="radio" name="\${q.id}" value="\${opt}" onchange="updateProgress()"> \${opt}</label>
            \`).join('')}
          </div>
        </div>
      \`;
    });
    container.innerHTML = html;
  }

  function renderSectionV() {
    const container = document.getElementById('sectionV');
    let html = '';
    sectionVQuestions.forEach((q, i) => {
      html += \`
        <div class="question-block">
          <div class="qtext">\${i+1}. \${q.text}</div>
          <input type="text" class="text-input" id="\${q.id}" name="\${q.id}" placeholder="Введите фамилии через запятую..." onchange="updateProgress()">
        </div>
      \`;
    });
    container.innerHTML = html;
  }

  function renderSectionG() {
    const container = document.getElementById('sectionG');
    let html = '';
    sectionGQuestions.forEach((q, i) => {
      html += \`
        <div class="question-block">
          <div class="qtext">\${i+1}. \${q.text}</div>
      \`;
      if (q.type === 'text') {
        html += \`<input type="text" class="text-input" id="\${q.id}" name="\${q.id}" placeholder="Введите ответ..." onchange="updateProgress()">\`;
      } else if (q.options) {
        html += \`<div class="options">\${q.options.map(opt => \`
          <label><input type="radio" name="\${q.id}" value="\${opt}" onchange="updateProgress()"> \${opt}</label>
        \`).join('')}</div>\`;
      }
      html += \`</div>\`;
    });
    container.innerHTML = html;
  }

  function renderColleagueBlock(index, name = '') {
    const container = document.getElementById('colleaguesContainer');
    const div = document.createElement('div');
    div.className = 'colleague-block';
    div.id = \`colleague-\${index}\`;

    let html = \`
      <div class="colleague-header">
        <h3 style="color:#1a2a6c;">👤 Коллега #\${index+1}</h3>
        <button type="button" class="btn btn-danger" onclick="removeColleague(\${index})">✕ Удалить</button>
      </div>
      <div class="question-block" style="border-left-color:#1a2a6c;">
        <div class="qtext">Фамилия, имя, отчество коллеги</div>
        <input type="text" class="text-input" id="colleague_name_\${index}" name="colleague_name_\${index}" placeholder="Петров Петр Петрович" value="\${name}" onchange="updateProgress()">
      </div>
    \`;

    sectionBQuestions.forEach((q, qi) => {
      const factorLabels = {
        'advocacy': 'Инициативность',
        'support': 'Поддержка',
        'mindset': 'Осознанность',
        'reporting': 'Открытость',
        'reluctance': 'Избегание (обратная шкала)'
      };
      const label = factorLabels[q.factor] || '';
      const isReverse = q.reverse ? ' ⚠️ (1→5)' : '';
      html += \`
        <div class="question-block" style="border-left-color:#0077b6;">
          <div class="qtext">\${qi+1}. \${q.text} <span style="color:#999;font-size:12px;">[\${label}\${isReverse}]</span></div>
          <div class="options">
            \${[1,2,3,4,5].map(opt => \`
              <label><input type="radio" name="col_\${index}_\${q.id}" value="\${opt}" onchange="updateProgress()"> \${opt}</label>
            \`).join('')}
          </div>
        </div>
      \`;
    });

    div.innerHTML = html;
    container.appendChild(div);
  }

  function addColleague(name = '') {
    const index = colleagueCount;
    colleagueCount++;
    renderColleagueBlock(index, name);
    updateProgress();
  }

  function removeColleague(index) {
    const el = document.getElementById(\`colleague-\${index}\`);
    if (el) el.remove();
    updateProgress();
  }

  function updateProgress() {
    const form = document.getElementById('surveyForm');
    let answered = 0;
    let total = 0;

    sectionAQuestions.forEach(q => {
      total++;
      if (form.querySelector(\`input[name="\${q.id}"]:checked\`)) answered++;
    });

    const colleagueBlocks = document.querySelectorAll('.colleague-block');
    colleagueBlocks.forEach((block, idx) => {
      total++;
      const nameInput = block.querySelector(\`input[name="colleague_name_\${idx}"]\`);
      if (nameInput && nameInput.value.trim() !== '') answered++;

      sectionBQuestions.forEach(q => {
        total++;
        if (block.querySelector(\`input[name="col_\${idx}_\${q.id}"]:checked\`)) answered++;
      });
    });

    sectionVQuestions.forEach(q => {
      total++;
      const input = document.getElementById(q.id);
      if (input && input.value.trim() !== '') answered++;
    });

    sectionGQuestions.forEach(q => {
      total++;
      if (q.type === 'text') {
        const input = document.getElementById(q.id);
        if (input && input.value.trim() !== '') answered++;
      } else {
        if (form.querySelector(\`input[name="\${q.id}"]:checked\`)) answered++;
      }
    });

    document.getElementById('answeredCount').textContent = Math.min(answered, total);
    document.getElementById('totalCount').textContent = total;
    document.getElementById('progressBar').style.width = Math.min((answered / total) * 100, 100) + '%';
  }

  document.getElementById('surveyForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const formData = new FormData(e.target);
    const data = {};

    for (let [key, value] of formData.entries()) {
      if (value === '') continue;
      const num = Number(value);
      data[key] = isNaN(num) ? value : num;
    }

    const colleagueBlocks = document.querySelectorAll('.colleague-block');
    if (colleagueBlocks.length === 0) {
      const resultDiv = document.getElementById('result');
      resultDiv.className = 'result error';
      resultDiv.innerHTML = '❌ Добавьте хотя бы одного коллегу для оценки.';
      return;
    }

    const colleaguesData = [];
    colleagueBlocks.forEach((block, idx) => {
      const name = block.querySelector(\`input[name="colleague_name_\${idx}"]\`)?.value || '';
      const scores = {};
      sectionBQuestions.forEach(q => {
        const input = block.querySelector(\`input[name="col_\${idx}_\${q.id}"]:checked\`);
        if (input) {
          let val = parseInt(input.value);
          if (q.reverse) val = 6 - val;
          scores[q.id] = val;
        }
      });
      colleaguesData.push({ name, scores });
    });

    data.colleaguesData = JSON.stringify(colleaguesData);

    if (Object.keys(data).length < 3) {
      const resultDiv = document.getElementById('result');
      resultDiv.className = 'result error';
      resultDiv.innerHTML = '❌ Пожалуйста, ответьте на все обязательные вопросы.';
      return;
    }

    const resultDiv = document.getElementById('result');
    resultDiv.className = 'result';
    resultDiv.innerHTML = '⏳ Отправка данных...';
    resultDiv.style.display = 'block';

    const btn = document.getElementById('submitBtn');
    btn.disabled = true;

    try {
      const response = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      const result = await response.json();

      if (result.status === 'success') {
        resultDiv.className = 'result success';
        resultDiv.innerHTML = \`
          <h3>✅ Спасибо за ответы!</h3>
          <p>Ваши ответы успешно сохранены.</p>
          <p style="color:#666;font-size:14px;">Все оценки коллег будут обработаны и представлены на итоговом совещании.</p>
        \`;
        document.getElementById('surveyForm').reset();
        document.getElementById('colleaguesContainer').innerHTML = '';
        colleagueCount = 0;
      } else {
        resultDiv.className = 'result error';
        resultDiv.innerHTML = \`❌ Ошибка: \${result.message}\`;
      }
    } catch (error) {
      resultDiv.className = 'result error';
      resultDiv.innerHTML = \`❌ Ошибка: \${error.message}\`;
    }
    btn.disabled = false;
  });

  renderSectionA();
  renderSectionV();
  renderSectionG();
  addColleague();

  document.addEventListener('change', updateProgress);
  document.addEventListener('input', updateProgress);
</script>
</body>
</html>`);
});

// ============================================================
// 7. ОТПРАВКА ОТВЕТОВ
// ============================================================

app.post("/api/submit", async (c) => {
  try {
    const data = await c.req.json();
    if (!data || Object.keys(data).length === 0) {
      return c.json({ status: "error", message: "Нет данных" }, 400);
    }

    let colleagues = [];
    if (data.colleaguesData) {
      try {
        colleagues = JSON.parse(data.colleaguesData);
      } catch (e) {
        console.error("Ошибка парсинга colleaguesData:", e);
      }
    }

    const saveData = {
      a1: data.a1, a2: data.a2, a3: data.a3, a4: data.a4, a5: data.a5,
      a6: data.a6, a7: data.a7, a8: data.a8, a9: data.a9, a10: data.a10,
      colleagues: colleagues,
      v1: data.v1, v2: data.v2, v3: data.v3,
      v4: data.v4, v5: data.v5, v6: data.v6,
      g1: data.g1, g2: data.g2, g3: data.g3, g4: data.g4, g5: data.g5,
    };

    await saveResponse(saveData);
    await updateAggregates(colleagues);

    return c.json({
      status: "success",
      id: Date.now(),
      message: "Спасибо за ответы!"
    });
  } catch (error: any) {
    console.error("Ошибка:", error);
    return c.json({ status: "error", message: error.message }, 500);
  }
});

// ============================================================
// 8. СТРАНИЦА РЕЗУЛЬТАТОВ ДЛЯ СОЗДАТЕЛЯ
// ============================================================

app.get("/results", async (c) => {
  const result = await pool.query(`
    SELECT
      colleague_name,
      total_ratings,
      avg_advocacy,
      avg_support,
      avg_mindset,
      avg_reporting,
      avg_reluctance,
      category,
      updated_at
    FROM colleague_aggregates
    ORDER BY
      CASE category
        WHEN 'Лидер безопасности' THEN 1
        WHEN 'Кандидат в лидеры' THEN 2
        WHEN 'Нейтральный' THEN 3
        WHEN 'Лидер сопротивления' THEN 4
        ELSE 5
      END,
      total_ratings DESC
  `);

  return c.html(`<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Результаты опроса ISL</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Segoe UI',sans-serif; background:#f5f7fa; padding:30px; }
    .container { max-width:1200px; margin:0 auto; background:white; border-radius:16px; padding:30px; box-shadow:0 4px 20px rgba(0,0,0,0.08); }
    h1 { color:#1a2a6c; margin-bottom:5px; }
    .subtitle { color:#666; margin-bottom:20px; font-size:14px; }
    .stats { display:grid; grid-template-columns:repeat(auto-fit, minmax(150px,1fr)); gap:15px; margin-bottom:25px; }
    .stat-card { background:#f8f9fa; padding:15px; border-radius:10px; text-align:center; border-left:4px solid #1a2a6c; }
    .stat-card .number { font-size:28px; font-weight:700; color:#1a2a6c; }
    .stat-card .label { font-size:13px; color:#666; }
    table { width:100%; border-collapse:collapse; font-size:14px; }
    th { background:#1a2a6c; color:white; padding:10px 12px; text-align:left; position:sticky; top:0; }
    td { padding:8px 12px; border-bottom:1px solid #eee; }
    .badge { display:inline-block; padding:3px 14px; border-radius:20px; font-size:13px; font-weight:600; }
    .badge.leader { background:#d4edda; color:#155724; }
    .badge.candidate { background:#cce5ff; color:#004085; }
    .badge.neutral { background:#e2e3e5; color:#383d41; }
    .badge.resistance { background:#f8d7da; color:#721c24; }
    .empty { text-align:center; color:#999; padding:40px; }
    .footer { margin-top:20px; text-align:center; color:#999; font-size:12px; border-top:1px solid #eee; padding-top:15px; }
    .table-wrap { overflow-x:auto; max-height:600px; overflow-y:auto; }
    .export-btn { padding:8px 16px; background:#1a2a6c; color:white; border:none; border-radius:6px; cursor:pointer; margin-bottom:15px; font-size:14px; }
    .export-btn:hover { opacity:0.8; }
  </style>
</head>
<body>
<div class="container">
  <h1>📊 Результаты опроса ISL</h1>
  <p class="subtitle">Оренбургский филиал ООО «Газпромтранс»</p>

  <div class="stats" id="stats"></div>

  <button class="export-btn" onclick="exportCSV()">📥 Скачать CSV</button>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Коллега</th>
          <th>Оценок</th>
          <th>Advocacy</th>
          <th>Support</th>
          <th>Mindset</th>
          <th>Reporting</th>
          <th>Reluctance</th>
          <th>Категория</th>
          <th>Обновлено</th>
        </tr>
      </thead>
      <tbody id="resultsBody"></tbody>
    </table>
  </div>

  <div class="footer">© ООО «Газпромтранс» · Оренбургский филиал · 2026</div>
</div>

<script>
  const results = ${JSON.stringify(result.rows)};

  function getBadgeClass(category) {
    const map = {
      'Лидер безопасности': 'leader',
      'Кандидат в лидеры': 'candidate',
      'Нейтральный': 'neutral',
      'Лидер сопротивления': 'resistance'
    };
    return map[category] || 'unknown';
  }

  function renderStats() {
    const total = results.length;
    const categories = {};
    results.forEach(r => {
      const cat = r.category || 'Не определена';
      categories[cat] = (categories[cat] || 0) + 1;
    });

    let html = '<div class="stat-card"><div class="number">' + total + '</div><div class="label">Всего коллег оценено</div></div>';
    const order = ['Лидер безопасности', 'Кандидат в лидеры', 'Нейтральный', 'Лидер сопротивления'];
    for (const cat of order) {
      if (categories[cat]) {
        const cls = getBadgeClass(cat);
        html += '<div class="stat-card"><div class="number">' + categories[cat] + '</div><div class="label"><span class="badge ' + cls + '">' + cat + '</span></div></div>';
      }
    }
    document.getElementById('stats').innerHTML = html;
  }

  function renderTable() {
    const tbody = document.getElementById('resultsBody');
    if (results.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" class="empty">Пока нет ни одного ответа</td></tr>';
      return;
    }
    let html = '';
    results.forEach((r, i) => {
      const cls = getBadgeClass(r.category);
      const date = r.updated_at ? new Date(r.updated_at).toLocaleDateString('ru-RU') : '—';
      html += '<tr>' +
        '<td>' + (i+1) + '</td>' +
        '<td><strong>' + r.colleague_name + '</strong></td>' +
        '<td>' + r.total_ratings + '</td>' +
        '<td>' + (r.avg_advocacy ? r.avg_advocacy.toFixed(2) : '—') + '</td>' +
        '<td>' + (r.avg_support ? r.avg_support.toFixed(2) : '—') + '</td>' +
        '<td>' + (r.avg_mindset ? r.avg_mindset.toFixed(2) : '—') + '</td>' +
        '<td>' + (r.avg_reporting ? r.avg_reporting.toFixed(2) : '—') + '</td>' +
        '<td>' + (r.avg_reluctance ? r.avg_reluctance.toFixed(2) : '—') + '</td>' +
        '<td><span class="badge ' + cls + '">' + (r.category || 'Не определена') + '</span></td>' +
        '<td>' + date + '</td>' +
        '</tr>';
    });
    tbody.innerHTML = html;
  }

  function exportCSV() {
    if (results.length === 0) {
      alert('Нет данных для экспорта');
      return;
    }
    let csv = 'Коллега,Оценок,Advocacy,Support,Mindset,Reporting,Reluctance,Категория\n';
    results.forEach(r => {
      csv += r.colleague_name + ',' + r.total_ratings + ',' + (r.avg_advocacy || '') + ',' + (r.avg_support || '') + ',' + (r.avg_mindset || '') + ',' + (r.avg_reporting || '') + ',' + (r.avg_reluctance || '') + ',' + (r.category || '') + '\n';
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'isl_results_' + new Date().toISOString().slice(0,10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  renderStats();
  renderTable();
</script>
</body>
</html>`);
});

// ============================================================
// 9. ЗАПУСК
// ============================================================

const PORT = parseInt(process.env.PORT || "3000");

console.log("🚀 ISL Survey API запущен на порту " + PORT);
console.log("🔗 /survey — опросник");
console.log("📊 /results — результаты для создателя");

export default {
  port: PORT,
  fetch: app.fetch,
};