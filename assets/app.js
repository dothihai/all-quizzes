// ===== AUTH =====

const _AK = '2af95d32474da3080656fa4ed0d9043a00daf8b21cf521c30f3cdb40709072f6';
const _S = 'hX9!mQ3#wZ';

function _hash(s) {
    var text = _S + s.trim() + _S;
    var h = 0x811c9dc5;
    for (var i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    var out = '';
    var v = h;
    for (var r = 0; r < 8; r++) {
        v = (v ^ ((v << 13) >>> 0)) >>> 0;
        v = (v ^ (v >>> 7)) >>> 0;
        v = (v ^ ((v << 17) >>> 0)) >>> 0;
        out += ('00000000' + v.toString(16)).slice(-8);
    }
    return out;
}

function checkAuth(quizId) {
    try {
        if (localStorage.getItem('_qa') === _AK) {
            loadAndShowQuiz(quizId);
            return;
        }
    } catch (e) { /* ignore */ }
    showAuthModal(quizId);
}

function showAuthModal(quizId) {
    const modal = document.getElementById('auth-modal');
    modal.dataset.quizId = quizId;
    modal.style.display = 'flex';
    document.getElementById('auth-input').value = '';
    document.getElementById('auth-error').style.display = 'none';
    setTimeout(function () { document.getElementById('auth-input').focus(); }, 60);
}

function submitActivationCode() {
    const val = document.getElementById('auth-input').value;
    if (_hash(val) === _AK) {
        try { localStorage.setItem('_qa', _AK); } catch (e) { /* ignore */ }
        const quizId = document.getElementById('auth-modal').dataset.quizId;
        document.getElementById('auth-modal').style.display = 'none';
        loadAndShowQuiz(quizId);
    } else {
        document.getElementById('auth-error').style.display = 'block';
        document.getElementById('auth-input').value = '';
        document.getElementById('auth-input').focus();
    }
}

// ===== ROUTER =====

function getQuizIdFromUrl() {
    return new URLSearchParams(window.location.search).get('quiz');
}

window.addEventListener('load', function () {
    const quizId = getQuizIdFromUrl();
    if (quizId) {
        checkAuth(quizId);
    } else {
        showMenu();
    }
});

// ===== MENU =====

function showMenu() {
    document.getElementById('menu-section').style.display = '';
    document.getElementById('quiz-section').style.display = 'none';
    document.title = 'Quiz Library';
    loadMenuData();
}

async function loadMenuData() {
    const listEl = document.getElementById('quiz-list');
    try {
        const res = await fetch('quizzes.json');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const quizzes = await res.json();
        renderQuizCards(listEl, quizzes);
    } catch (e) {
        listEl.innerHTML = '<div class="menu-status">Không thể tải danh sách bài học.</div>';
    }
}

function renderCard(q) {
    const icon = q.icon || '📝';
    const desc = q.description || '';
    const title = escapeHtml(q.title);
    if (q.url) {
        const href = encodeURI(q.url);
        return `<a class="quiz-card" href="${href}" target="_blank" rel="noopener noreferrer">
            <div class="quiz-card-icon">${icon}</div>
            <div class="quiz-card-title">${title}</div>
            <div class="quiz-card-desc">${escapeHtml(desc)}</div>
            <div class="quiz-card-ext-badge">↗ liên kết ngoài</div>
        </a>`;
    }
    const countText = q.count != null ? q.count + ' câu hỏi' : '';
    const id = encodeURIComponent(q.id);
    return `<a class="quiz-card" href="?quiz=${id}">
        <div class="quiz-card-icon">${icon}</div>
        <div class="quiz-card-title">${title}</div>
        <div class="quiz-card-desc">${escapeHtml(desc)}</div>
        <div class="quiz-card-count">${escapeHtml(countText)}</div>
    </a>`;
}

function renderQuizCards(container, quizzes) {
    if (!quizzes || quizzes.length === 0) {
        container.innerHTML = '<div class="menu-status">Không có bài học nào.</div>';
        return;
    }
    // Group by category then subcategory, preserving insertion order
    const catGroups = {};
    const catOrder = [];
    quizzes.forEach(function (q) {
        const cat = q.category || '';
        const sub = q.subcategory || '';
        if (!catGroups[cat]) { catGroups[cat] = { subOrder: [], subGroups: {} }; catOrder.push(cat); }
        if (!catGroups[cat].subGroups[sub]) { catGroups[cat].subGroups[sub] = []; catGroups[cat].subOrder.push(sub); }
        catGroups[cat].subGroups[sub].push(q);
    });
    const hasCategories = catOrder.some(function (c) { return c !== ''; });
    let html = '';
    catOrder.forEach(function (cat) {
        if (hasCategories && cat) {
            html += '<div class="quiz-section-title">' + escapeHtml(cat) + '</div>';
        }
        const { subOrder, subGroups } = catGroups[cat];
        const hasSubs = subOrder.some(function (s) { return s !== ''; });
        subOrder.forEach(function (sub) {
            if (hasSubs && sub) {
                html += '<div class="quiz-subsection-title">' + escapeHtml(sub) + '</div>';
            }
            subGroups[sub].forEach(function (q) { html += renderCard(q); });
        });
    });
    container.innerHTML = html;
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ===== QUIZ LOADER =====

let currentQuizId = null;
let allQuestions = [];
let questions = [];
let currentQuestionIndex = 0;
let viewMode = 'all';
let favorites = new Set();
let stats = { correct: 0, incorrect: 0, answered: new Set() };

function storageKey(suffix) {
    return 'quiz-' + currentQuizId + '-' + suffix;
}

function loadAndShowQuiz(quizId) {
    // Prevent path traversal
    if (!/^[a-zA-Z0-9_\-]+$/.test(quizId)) {
        showMenu();
        return;
    }

    currentQuizId = quizId;
    let questionsData = [];
    try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'questions/' + quizId + '.json', false);
        xhr.send(null);
        if (xhr.status === 200) {
            const raw = JSON.parse(xhr.responseText);
            questionsData = raw.map(function (q, idx) {
                q.id = String(idx + 1);
                return q;
            });
        } else {
            console.error('Failed to load quiz, status:', xhr.status);
        }
    } catch (err) {
        console.error('Failed to load quiz:', err);
    }

    document.getElementById('menu-section').style.display = 'none';
    document.getElementById('quiz-section').style.display = '';

    // Set a preliminary title, then update once metadata loads
    document.title = quizId;
    document.getElementById('quiz-title').textContent = '🧪 ' + quizId;
    fetchQuizMeta(quizId);

    initQuiz(questionsData);
}

async function fetchQuizMeta(quizId) {
    try {
        const res = await fetch('quizzes.json');
        if (!res.ok) return;
        const quizzes = await res.json();
        const meta = quizzes.find(function (q) { return q.id === quizId; });
        if (meta && meta.title) {
            document.title = meta.title;
            document.getElementById('quiz-title').textContent = '🧪 ' + meta.title;
        }
    } catch (e) { /* ignore */ }
}

// ===== QUIZ LOGIC =====

function initQuiz(questionsData) {
    allQuestions = questionsData;
    currentQuestionIndex = 0;
    viewMode = 'all';
    favorites = new Set();
    stats = { correct: 0, incorrect: 0, answered: new Set() };
    updateStats();

    try {
        const favRaw = localStorage.getItem(storageKey('favs'));
        if (favRaw) {
            const arr = JSON.parse(favRaw);
            if (Array.isArray(arr)) favorites = new Set(arr);
        }
    } catch (e) { /* ignore */ }

    try {
        const savedMode = localStorage.getItem(storageKey('view'));
        if (savedMode === 'favorites' || savedMode === 'all') viewMode = savedMode;
    } catch (e) { /* ignore */ }

    applyViewMode();

    try {
        const raw = localStorage.getItem(storageKey('pos'));
        if (raw !== null) {
            const savedId = parseInt(raw, 10);
            if (!isNaN(savedId)) {
                const idx = questions.findIndex(function (q) { return parseInt(q.id, 10) === savedId; });
                if (idx >= 0) currentQuestionIndex = idx;
            }
        }
    } catch (e) { /* ignore */ }

    // Re-attach jump input listeners (clone to clear any old ones)
    const jumpInput = document.getElementById('question-jump');
    const newJump = jumpInput.cloneNode(true);
    jumpInput.parentNode.replaceChild(newJump, jumpInput);
    newJump.addEventListener('change', handleJump);
    newJump.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { handleJump(); newJump.blur(); }
    });

    updateFavCount();
    updateViewToggleButtons();
    displayQuestion();
}

function applyViewMode() {
    if (viewMode === 'favorites') {
        questions = allQuestions.filter(function (q) { return favorites.has(q.id); });
    } else {
        questions = allQuestions;
    }
    if (currentQuestionIndex >= questions.length) {
        currentQuestionIndex = Math.max(0, questions.length - 1);
    }
}

function setViewMode(mode) {
    if (mode === viewMode) return;
    const currentId = questions[currentQuestionIndex] && questions[currentQuestionIndex].id;
    viewMode = mode;
    try { localStorage.setItem(storageKey('view'), mode); } catch (e) { /* ignore */ }
    applyViewMode();
    if (currentId != null) {
        const idx = questions.findIndex(function (q) { return q.id === currentId; });
        currentQuestionIndex = idx >= 0 ? idx : 0;
    } else {
        currentQuestionIndex = 0;
    }
    updateViewToggleButtons();
    displayQuestion();
}

function updateViewToggleButtons() {
    document.getElementById('view-all-button').classList.toggle('active', viewMode === 'all');
    document.getElementById('view-fav-button').classList.toggle('active', viewMode === 'favorites');
}

function updateFavCount() {
    document.getElementById('fav-count').textContent = favorites.size;
}

function saveFavorites() {
    try {
        localStorage.setItem(storageKey('favs'), JSON.stringify(Array.from(favorites)));
    } catch (e) { /* ignore */ }
}

function toggleFavorite() {
    const question = questions[currentQuestionIndex];
    if (!question) return;
    if (favorites.has(question.id)) {
        favorites.delete(question.id);
    } else {
        favorites.add(question.id);
    }
    saveFavorites();
    updateFavCount();
    updateFavButton();
    if (viewMode === 'favorites') {
        const currentId = question.id;
        applyViewMode();
        const idx = questions.findIndex(function (q) { return q.id === currentId; });
        if (idx >= 0) {
            currentQuestionIndex = idx;
        } else if (currentQuestionIndex >= questions.length) {
            currentQuestionIndex = Math.max(0, questions.length - 1);
        }
        displayQuestion();
    }
}

function updateFavButton() {
    const btn = document.getElementById('fav-button');
    const question = questions[currentQuestionIndex];
    if (!question) {
        btn.textContent = '☆';
        btn.classList.remove('active');
        return;
    }
    const isFav = favorites.has(question.id);
    btn.textContent = isFav ? '★' : '☆';
    btn.classList.toggle('active', isFav);
}

function saveProgress() {
    const question = questions[currentQuestionIndex];
    if (!question) return;
    try { localStorage.setItem(storageKey('pos'), question.id); } catch (e) { /* ignore */ }
}

function handleJump() {
    const jumpInput = document.getElementById('question-jump');
    let val = parseInt(jumpInput.value, 10);
    if (isNaN(val)) { jumpInput.value = currentQuestionIndex + 1; return; }
    val = Math.max(1, Math.min(questions.length, val));
    currentQuestionIndex = val - 1;
    displayQuestion();
}

function lastQuestion() {
    currentQuestionIndex = questions.length - 1;
    displayQuestion();
}

function displayQuestion() {
    document.getElementById('total-questions').textContent = questions.length;
    document.getElementById('question-total').textContent = questions.length;
    const jumpInput = document.getElementById('question-jump');
    jumpInput.max = Math.max(1, questions.length);

    if (questions.length === 0) {
        document.getElementById('question-number').textContent = 'No questions';
        jumpInput.value = '';
        jumpInput.disabled = true;
        document.getElementById('question-text').textContent =
            viewMode === 'favorites'
                ? 'No favorite questions yet. Star a question to add it here.'
                : 'No questions available.';
        document.getElementById('options-container').innerHTML = '';
        document.getElementById('check-button').disabled = true;
        document.getElementById('result').className = 'result';
        document.getElementById('prev-button').disabled = true;
        document.getElementById('next-button').disabled = true;
        document.getElementById('random-button').disabled = true;
        document.getElementById('last-button').disabled = true;
        updateFavButton();
        return;
    }
    jumpInput.disabled = false;

    const question = questions[currentQuestionIndex];
    document.getElementById('question-number').textContent = 'Question ' + question.id;
    jumpInput.value = currentQuestionIndex + 1;
    document.getElementById('question-text').textContent = question.question;

    const optionsContainer = document.getElementById('options-container');
    optionsContainer.innerHTML = '';

    const isMultiple = question.correct_answer.length > 1;
    const inputType = isMultiple ? 'checkbox' : 'radio';
    for (const [key, value] of Object.entries(question.options)) {
        const option = document.createElement('label');
        option.className = 'option';
        const input = document.createElement('input');
        input.type = inputType;
        input.name = 'answer';
        input.value = key;
        const span = document.createElement('span');
        const strong = document.createElement('strong');
        strong.textContent = key + '.';
        span.appendChild(strong);
        span.appendChild(document.createTextNode(' ' + value));
        option.appendChild(input);
        option.appendChild(span);
        optionsContainer.appendChild(option);
    }

    document.getElementById('result').className = 'result';
    document.getElementById('check-button').disabled = false;
    document.getElementById('prev-button').disabled = currentQuestionIndex === 0;
    document.getElementById('random-button').disabled = questions.length <= 1;
    document.getElementById('next-button').disabled = currentQuestionIndex === questions.length - 1;
    document.getElementById('last-button').disabled = currentQuestionIndex === questions.length - 1;
    updateFavButton();
    saveProgress();
}

function checkAnswer() {
    const question = questions[currentQuestionIndex];
    const isMultiple = question.correct_answer.length > 1;
    let answer;
    if (isMultiple) {
        const checked = document.querySelectorAll('input[name="answer"]:checked');
        if (checked.length === 0) { alert('Please select an answer!'); return; }
        answer = Array.from(checked).map(function (cb) { return cb.value; }).sort().join('');
    } else {
        const selectedOption = document.querySelector('input[name="answer"]:checked');
        if (!selectedOption) { alert('Please select an answer!'); return; }
        answer = selectedOption.value;
    }
    const isCorrect = answer === question.correct_answer;

    if (!stats.answered.has(question.id)) {
        stats.answered.add(question.id);
        if (isCorrect) { stats.correct++; } else { stats.incorrect++; }
        updateStats();
    }

    const resultDiv = document.getElementById('result');
    resultDiv.className = 'result show ' + (isCorrect ? 'correct' : 'incorrect');

    const baseMsg = isCorrect
        ? '✅ Correct! Well done!'
        : '❌ Incorrect. The correct answer is <strong>' + escapeHtml(question.correct_answer) + '</strong>';

    const optionsText = Object.entries(question.options)
        .map(function ([k, v]) { return k + '. ' + v; }).join('\n');
    const promptText = 'Dịch vào giải thích đáp án: ' + question.question + '\n' + optionsText + '\nĐáp án đúng: ' + question.correct_answer;
    const chatgptUrl = 'https://chatgpt.com/?prompt=' + encodeURIComponent(promptText);
    resultDiv.innerHTML = baseMsg + '<br><a href="' + chatgptUrl + '" target="_blank" rel="noopener noreferrer" class="explain-button">💬 Giải thích bằng ChatGPT</a>';

    const correctLetters = new Set(question.correct_answer.split(''));
    document.querySelectorAll('.option').forEach(function (option) {
        const input = option.querySelector('input');
        option.classList.add('disabled');
        input.disabled = true;
        if (correctLetters.has(input.value)) {
            option.classList.add('correct');
        } else if (input.checked) {
            option.classList.add('incorrect');
        }
    });

    document.getElementById('check-button').disabled = true;
}

function updateStats() {
    document.getElementById('correct-count').textContent = stats.correct;
    document.getElementById('incorrect-count').textContent = stats.incorrect;
    const total = stats.correct + stats.incorrect;
    document.getElementById('accuracy').textContent =
        (total > 0 ? Math.round((stats.correct / total) * 100) : 0) + '%';
}

function randomQuestion() {
    if (questions.length <= 1) return;
    let idx;
    do {
        idx = Math.floor(Math.random() * questions.length);
    } while (idx === currentQuestionIndex);
    currentQuestionIndex = idx;
    displayQuestion();
}

function nextQuestion() {
    if (currentQuestionIndex < questions.length - 1) {
        currentQuestionIndex++;
        displayQuestion();
    }
}

function previousQuestion() {
    if (currentQuestionIndex > 0) {
        currentQuestionIndex--;
        displayQuestion();
    }
}

document.addEventListener('keydown', function (e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (document.getElementById('quiz-section').style.display === 'none') return;
    if (e.key === 'ArrowRight' && currentQuestionIndex < questions.length - 1) nextQuestion();
    else if (e.key === 'ArrowLeft' && currentQuestionIndex > 0) previousQuestion();
});

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js');
}
