import { saveSettingsDebounced } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { download, getFileText, getSortableDelay, showFontAwesomePicker } from '../../../utils.js';
import { callGenericPopup, POPUP_RESULT, POPUP_TYPE } from '../../../popup.js';
import { addLocaleData, getCurrentLocale, t } from '../../../i18n.js';

const MODULE_NAME = 'custom_md_buttons';
const EXTENSION_PATH = '/scripts/extensions/third-party/st-markdown-toolbar';
const DEFAULT_ICON = 'fa-star';

// 기호만 넣어도 어울리는 아이콘이 붙도록 (btn.icon 이 비어 있을 때만 쓰임)
const ICON_BY_SYMBOL = {
    '"': 'fa-comment',
    '\'': 'fa-comment',
    '*': 'fa-italic',
    '**': 'fa-bold',
    '***': 'fa-bold',
    '_': 'fa-italic',
    '__': 'fa-underline',
    '~': 'fa-strikethrough',
    '~~': 'fa-strikethrough',
    '`': 'fa-code',
    '```': 'fa-file-code',
    '>': 'fa-quote-left',
    '#': 'fa-heading',
    '##': 'fa-heading',
    '###': 'fa-heading',
    '-': 'fa-list-ul',
    '+': 'fa-list-ul',
    '1.': 'fa-list-ol',
    '---': 'fa-minus',
    '===': 'fa-minus',
    '[': 'fa-square',
    '(': 'fa-comment-dots',
    '!': 'fa-exclamation',
    '!!': 'fa-exclamation',
    '{{': 'fa-at',
    '<': 'fa-code',
};

// 확장이 들고 있는 번역을 현재 언어에 얹는다. 없으면 영어 원문이 그대로 쓰인다.
// ST 가 알려주는 값은 'ko' 일 수도 'ko-kr' 일 수도 있어서 앞부분까지 맞춰 본다
async function loadLocale() {
    const locale = getCurrentLocale();
    if (!locale || locale.startsWith('en')) return;

    try {
        const available = await fetch(`${EXTENSION_PATH}/i18n/locales.json`).then(res => res.ok ? res.json() : []);
        const language = locale.split('-')[0];
        const match = available.find(id => id === locale) || available.find(id => id.split('-')[0] === language);
        // 경로에 그대로 들어가는 값이라 언어 코드 형태만 통과시킨다
        if (!match || !/^[a-z]{2,3}(-[a-z]{2,4})?$/i.test(match)) return;

        const data = await fetch(`${EXTENSION_PATH}/i18n/${match}.json`).then(res => res.ok ? res.json() : null);
        if (data) addLocaleData(locale, data);
    } catch (error) {
        console.debug('[custom_md_buttons] locale data not loaded', error);
    }
}

// 기본 버튼의 이름은 설정에 저장되므로, 만들 때의 언어로 굳는다
function getDefaultButtons() {
    return [
        { id: 1, icon: 'fa-comment', label: '', left: '"', right: '"', title: t`Dialogue`, action: 'wrap', enabled: true },
        { id: 2, icon: 'fa-italic', label: '', left: '*', right: '*', title: t`Action`, action: 'wrap', enabled: true },
        { id: 3, icon: 'fa-bold', label: '', left: '**', right: '**', title: t`Emphasis`, action: 'wrap', enabled: true },
        { id: 4, icon: 'fa-strikethrough', label: '', left: '~~', right: '~~', title: t`Strikethrough`, action: 'wrap', enabled: true },
        { id: 5, icon: 'fa-quote-left', label: '', left: '> ', right: '', title: t`OOC / Quote`, action: 'prefix', enabled: true },
    ];
}

function loadSettings() {
    extension_settings[MODULE_NAME] = extension_settings[MODULE_NAME] || {};
    const settings = extension_settings[MODULE_NAME];

    if (settings.enabled === undefined) {
        settings.enabled = true;
    }

    if (settings.visibleCount === undefined) {
        settings.visibleCount = 0;
    }

    // 설정 파일이 손상돼 있어도 확장이 통째로 죽지는 않게
    if (!Array.isArray(settings.buttons)) {
        settings.buttons = getDefaultButtons();
    }

    settings.buttons = settings.buttons.filter(btn => btn && typeof btn === 'object');
}

function suggestIcon(btn) {
    return ICON_BY_SYMBOL[(btn.left || '').trim()] || DEFAULT_ICON;
}

// 아이콘 클래스는 속성값으로 그대로 들어가므로, 설정 파일이 손상되거나 조작돼도
// 속성 밖으로 빠져나가지 못하도록 형태를 확인한다
function getIconClass(btn) {
    const icon = btn.icon || suggestIcon(btn);
    return /^fa-[a-z0-9-]+$/i.test(icon) ? icon : DEFAULT_ICON;
}

// 버튼에 내용을 채운다. 직접 입력은 평문으로만 다루므로 HTML 이 실행될 여지가 없다
function applyButtonContent(element, btn) {
    const label = btn.label?.trim();

    if (label) {
        element.text(label);
        return;
    }

    element.empty().append($('<i></i>').addClass('fa-solid').addClass(getIconClass(btn)));
}

// 눌러도 아무 일이 없는 버튼. 줄 기호 모드는 앞 기호만 쓰므로 뒤 기호는 쳐주지 않는다
function isBlankButton(btn) {
    if (btn.action === 'prefix' || btn.action === 'newline') {
        return !btn.left;
    }

    return !btn.left && !btn.right;
}

// 삽입 결과 미리보기 ('|' 는 삽입 후 커서가 놓이는 자리)
function getInsertPreview(btn) {
    const sample = t`text`;
    const left = btn.left || '';
    const right = btn.right || '';

    if (btn.action === 'prefix') return `${left}${sample}`;
    if (btn.action === 'newline') return `↵${left}|`;

    return `${left}${sample}|${right}`;
}

// textarea.value 에 직접 대입하면 브라우저의 실행취소 기록이 날아가서 Ctrl+Z 가 먹지 않는다.
// execCommand 는 '사용자가 직접 친 것'으로 기록되므로 되돌리기가 그대로 동작한다
function replaceRange(textarea, start, end, text) {
    textarea.focus();
    textarea.setSelectionRange(start, end);

    const done = text === ''
        ? (start !== end && document.execCommand('delete'))
        : document.execCommand('insertText', false, text);

    if (done) return;

    // execCommand 를 막아 둔 환경 대비 (되돌리기는 포기)
    const value = textarea.value;
    textarea.value = value.slice(0, start) + text + value.slice(end);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

// 커서가 단어 한가운데 있으면 그 단어의 범위를 돌려준다.
// 줄 끝이나 띄어쓰기 옆이면 감쌀 단어가 없다고 본다
function findWordAt(value, caret) {
    const before = value[caret - 1];
    const after = value[caret];
    if (!before || !after || /\s/.test(before) || /\s/.test(after)) return null;

    let start = caret;
    let end = caret;

    while (start > 0 && !/\s/.test(value[start - 1])) start--;
    while (end < value.length && !/\s/.test(value[end])) end++;

    return { start, end };
}

// 이미 감싸져 있으면 벗겨낼 범위를 돌려준다. 기호가 고른 글 안에 있을 수도 ('**글**' 를 통째로 선택),
// 고른 글 바로 바깥에 있을 수도 ('**' 안쪽의 '글' 만 선택) 있어서 둘 다 본다
function findWrapped(value, start, end, left, right) {
    const inner = value.slice(start, end);

    if (inner.length >= left.length + right.length && inner.startsWith(left) && inner.endsWith(right)) {
        const text = inner.slice(left.length, inner.length - right.length);
        // '*하나* 와 *둘*' 을 통째로 고른 경우. 양 끝만 떼면 가운데 기호가 짝을 잃으므로 그냥 감싼다
        if (!(left && text.includes(left)) && !(right && text.includes(right))) {
            return { start, end, text };
        }
    }

    const outerStart = start - left.length;
    if (outerStart >= 0 && value.startsWith(left, outerStart) && value.startsWith(right, end)) {
        return { start: outerStart, end: end + right.length, text: inner };
    }

    return null;
}

// 선택한 글을 기호로 감싼다. 이미 감싸져 있으면 떼어낸다.
// 고른 글이 없으면 커서가 놓인 단어를 대신 감싼다 (ST 의 Ctrl+B 와 같은 동작)
function wrapSelection(textarea, left, right) {
    const value = textarea.value;
    const caret = textarea.selectionStart;
    const hasSelection = caret !== textarea.selectionEnd;

    const word = hasSelection ? null : findWordAt(value, caret);
    const start = word ? word.start : caret;
    const end = word ? word.end : textarea.selectionEnd;

    const wrapped = findWrapped(value, start, end, left, right);

    if (wrapped) {
        replaceRange(textarea, wrapped.start, wrapped.end, wrapped.text);

        // 고른 글이 있었으면 다시 고른 채로 둔다. 그래야 한 번 더 눌러 되감을 수 있다
        if (hasSelection) {
            textarea.setSelectionRange(wrapped.start, wrapped.start + wrapped.text.length);
            return;
        }

        // 커서만 있었으면 앞 기호가 빠진 만큼 당겨서 쓰던 자리에 그대로 둔다
        const limit = wrapped.start + wrapped.text.length;
        const moved = Math.min(Math.max(caret - left.length, wrapped.start), limit);
        textarea.setSelectionRange(moved, moved);
        return;
    }

    const selected = value.slice(start, end);
    replaceRange(textarea, start, end, left + selected + right);

    // 고른 글이 있었으면 닫는 기호 바로 앞, 아니면 앞 기호만큼만 밀어 쓰던 자리에 둔다
    const cursor = hasSelection ? start + left.length + selected.length : caret + left.length;
    textarea.setSelectionRange(cursor, cursor);
}

// 선택한 줄들의 맨 앞에 기호를 붙인다. 이미 전부 붙어 있으면 떼어낸다
function prefixLines(textarea, prefix) {
    if (!prefix) return;

    const value = textarea.value;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    // 커서가 걸쳐 있는 줄 전체를 대상으로 삼는다
    const blockStart = value.lastIndexOf('\n', start - 1) + 1;
    const blockEnd = value.indexOf('\n', end) === -1 ? value.length : value.indexOf('\n', end);

    const lines = value.slice(blockStart, blockEnd).split('\n');
    const isMultiline = lines.length > 1;
    // 여러 줄일 때만 빈 줄을 건너뛴다 (빈 줄 하나에서 눌렀으면 거기에 붙여야 하므로)
    const targets = lines.filter(line => !isMultiline || line.trim() !== '');
    const remove = targets.length > 0 && targets.every(line => line.startsWith(prefix));

    const updated = lines.map(line => {
        if (isMultiline && line.trim() === '') return line;
        if (remove) return line.slice(prefix.length);
        // 이미 붙어 있는 줄에 또 붙이지 않는다 ('> > 인용' 방지)
        return line.startsWith(prefix) ? line : prefix + line;
    });

    const block = updated.join('\n');
    replaceRange(textarea, blockStart, blockEnd, block);

    // 첫 줄의 길이 변화로 시작점을, 전체 길이 변화로 끝점을 보정한다
    const firstDelta = updated[0].length - lines[0].length;
    const totalDelta = block.length - (blockEnd - blockStart);
    textarea.setSelectionRange(Math.max(blockStart, start + firstDelta), end + totalDelta);
}

// 커서가 있는 줄 다음에 새 줄을 만들고 기호를 붙인다
function appendLine(textarea, prefix) {
    if (!prefix) return;

    const value = textarea.value;
    const end = textarea.selectionEnd;
    const lineStart = value.lastIndexOf('\n', end - 1) + 1;
    const lineEnd = value.indexOf('\n', end) === -1 ? value.length : value.indexOf('\n', end);

    // 지금 줄이 비어 있으면 굳이 새 줄을 만들지 않고 그 자리에 넣는다
    const isBlank = value.slice(lineStart, lineEnd).trim() === '';
    const at = isBlank ? lineStart : lineEnd;
    const insertion = isBlank ? prefix : '\n' + prefix;

    replaceRange(textarea, at, at, insertion);

    const cursor = at + insertion.length;
    textarea.setSelectionRange(cursor, cursor);
}

// 커서가 마지막으로 놓였던 입력칸. 메시지를 고쳐 쓰는 중이면 그 편집창이 된다
let lastFocused = null;

// 툴바가 손댈 곳. 고쳐 쓰던 편집창은 편집이 끝나면 통째로 사라지므로 그때는 입력창으로 돌아간다
function getActiveTextarea() {
    return lastFocused?.isConnected ? lastFocused : document.getElementById('send_textarea');
}

// ST 는 입력창과 메시지 편집창을 같은 서식 대상으로 친다 (양쪽 다 mdHotkeys 가 붙는다).
// 툴바도 같이 따라가도록, 커서가 놓인 쪽을 기억해 둔다
function watchFocusedTextarea() {
    document.addEventListener('focusin', event => {
        const el = event.target;
        if (!(el instanceof HTMLTextAreaElement)) return;
        if (el.id !== 'send_textarea' && !el.classList.contains('edit_textarea')) return;

        lastFocused = el;
    });
}

function runButton(btn, textarea) {
    if (!textarea) return;

    if (btn.action === 'prefix') {
        prefixLines(textarea, btn.left || '');
    } else if (btn.action === 'newline') {
        appendLine(textarea, btn.left || '');
    } else {
        wrapSelection(textarea, btn.left || '', btn.right || '');
    }

    textarea.focus();
}

// 넘침 메뉴는 width: max-content 라서 '한 줄로 폈을 때의 폭'으로 잡힌다.
// 줄바꿈이 일어나면 오른쪽에 빈 공간이 남으므로, 실제로 쓰인 폭까지 줄여 준다
function fitMenuWidth(menu) {
    const element = menu[0];
    element.style.width = '';

    const items = [...element.children];
    if (!items.length) return;

    const style = getComputedStyle(element);
    const trailing = (parseFloat(style.paddingRight) || 0) + (parseFloat(style.borderRightWidth) || 0);
    const left = element.getBoundingClientRect().left;
    const right = Math.max(...items.map(item => item.getBoundingClientRect().right));

    element.style.width = `${Math.ceil(right - left + trailing)}px`;
}

function makeToolbarButton(btn) {
    const el = $('<button type="button" class="menu_button text_button"></button>');
    // 아이콘만 있는 버튼은 화면 낭독기에 읽을 것이 없다. title 은 읽히지 않으므로 따로 단다.
    // 이름을 안 지었으면 기호라도 읽히는 편이 아무 말도 없는 것보다 낫다
    const name = btn.title?.trim() || btn.label?.trim() || btn.left || '';
    el.attr({ title: btn.title || '', 'aria-label': name });
    applyButtonContent(el, btn);
    el.on('click', () => runButton(btn, getActiveTextarea()));
    return el;
}

function renderToolbar() {
    $('#custom-md-toolbar').remove();
    $(document).off('.qsgOverflow');

    const settings = extension_settings[MODULE_NAME];
    if (!settings.enabled) return;

    const usable = settings.buttons.filter(btn => btn && btn.enabled !== false && !isBlankButton(btn));
    if (!usable.length) return;

    const toolbar = $('<div id="custom-md-toolbar"></div>');

    // 0 이면 전부 펼치고, 그 외에는 앞의 N 개만 남기고 나머지를 '⋯' 안으로 넣는다
    const limit = Number(settings.visibleCount) || 0;
    const overflowing = limit > 0 && usable.length > limit;
    const shown = overflowing ? usable.slice(0, limit) : usable;
    const hidden = overflowing ? usable.slice(limit) : [];

    shown.forEach(btn => toolbar.append(makeToolbarButton(btn)));

    if (hidden.length) {
        const wrapper = $('<div class="qsg-overflow-wrapper"></div>');
        const trigger = $('<button type="button" class="menu_button fa-solid fa-ellipsis qsg-overflow-trigger"></button>');
        const menu = $('<div class="qsg-overflow-menu qsg-off"></div>');

        trigger.attr({ title: t`More`, 'aria-label': t`More`, 'aria-expanded': 'false', 'aria-haspopup': 'true' });
        hidden.forEach(btn => menu.append(makeToolbarButton(btn)));

        function setMenuOpen(open) {
            menu.toggleClass('qsg-off', !open);
            trigger.attr('aria-expanded', String(open));
            // 폭은 보이는 상태에서만 잴 수 있다
            if (open) fitMenuWidth(menu);
        }

        trigger.on('click', event => {
            event.stopPropagation();
            setMenuOpen(menu.hasClass('qsg-off'));
        });

        // 마우스 없이도 메뉴 안으로 들어갈 수 있어야 한다.
        // 툴바는 mousedown 을 막아 두지만 키보드로 연 경우에는 포커스를 옮겨 준다
        trigger.on('keydown', event => {
            if (event.key !== 'ArrowDown' && event.key !== 'Enter' && event.key !== ' ') return;
            if (event.key === 'ArrowDown') event.preventDefault();
            if (menu.hasClass('qsg-off')) setMenuOpen(true);
            if (event.key === 'ArrowDown') menu.children('button').first().trigger('focus');
        });

        // 눌러서 연 경우에는 포커스가 입력창에 남으므로, Esc 는 툴바가 아니라 문서에서 받아야 한다.
        // 메뉴가 열려 있을 때만 가로채서, ST 가 Esc 로 하는 다른 일을 방해하지 않는다
        $(document).on('keydown.qsgOverflow', event => {
            if (event.key !== 'Escape' || menu.hasClass('qsg-off')) return;

            event.stopPropagation();
            const inside = $.contains(menu[0], document.activeElement);
            setMenuOpen(false);
            // 메뉴 안에 있던 포커스만 되돌린다. 입력창에 있었다면 건드리지 않는다
            if (inside) trigger.trigger('focus');
        });

        // 바깥을 누르면 닫는다
        $(document).on('click.qsgOverflow', () => setMenuOpen(false));

        wrapper.append(trigger, menu);
        toolbar.append(wrapper);
    }

    // 버튼을 눌러도 쓰던 입력칸에서 커서가 빠져나가지 않게 한다.
    // 고쳐 쓰던 편집창을 대상으로 삼을 수 있는 건 이 덕분이다
    toolbar.on('mousedown', event => event.preventDefault());

    // #send_form 은 order 로 줄을 쌓는 wrap 플렉스다. 입력 줄(order 25) 위에 자기 줄을 차지하게 둔다
    $('#send_form').append(toolbar);
}

// ---------- 버튼 세트 주고받기 ----------

// 남이 만든 파일을 읽어들이므로, 우리 파일이 맞는지 볼 표시를 하나 넣어 둔다
const EXPORT_TYPE = 'st-markdown-toolbar';
const EXPORT_NAME = 'markdown-toolbar-buttons.json';
const ACTIONS = ['wrap', 'prefix', 'newline'];

// 설정에 들어가도 되는 형태로만 추린다. 파일은 남이 만든 것이라 값의 종류부터 의심한다.
// 글자가 아닌 값이 left 에 들어오면 감쌀 때 터지고, 길이를 안 자르면 설정 파일이 부풀어 오른다
function normalizeButton(raw, index) {
    if (!raw || typeof raw !== 'object') return null;

    const text = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '';

    return {
        id: Date.now() + index,
        // 아이콘 클래스는 속성값으로 그대로 들어가므로 여기서도 형태를 확인한다
        icon: /^fa-[a-z0-9-]+$/i.test(raw.icon) ? raw.icon : '',
        label: text(raw.label, 32),
        left: text(raw.left, 64),
        right: text(raw.right, 64),
        title: text(raw.title, 64),
        action: ACTIONS.includes(raw.action) ? raw.action : 'wrap',
        enabled: raw.enabled !== false,
    };
}

function buildExportFile() {
    const settings = extension_settings[MODULE_NAME];

    return JSON.stringify({
        type: EXPORT_TYPE,
        version: 1,
        visibleCount: Number(settings.visibleCount) || 0,
        buttons: settings.buttons.map(normalizeButton).filter(Boolean),
    }, null, 4);
}

// 파일에서 쓸 만한 버튼만 꺼내 온다. 못 쓰는 파일이면 이유를 들고 예외를 던진다
async function readButtonFile(file) {
    let data;

    // ST 의 parseJsonFile 은 JSON.parse 를 FileReader 의 onload 안에서 부른다.
    // 깨진 파일이면 예외가 이벤트 쪽으로 새서 약속이 영영 끝나지 않으므로, 글만 읽어와 여기서 해석한다
    try {
        data = JSON.parse(await getFileText(file));
    } catch {
        throw new Error(t`That file is not JSON.`);
    }

    if (!data || typeof data !== 'object' || data.type !== EXPORT_TYPE) {
        throw new Error(t`That file is not a Markdown Toolbar button set.`);
    }

    // 눌러도 아무 일이 없는 버튼은 받아 봐야 목록만 어지럽힌다
    const buttons = Array.isArray(data.buttons)
        ? data.buttons.map(normalizeButton).filter(btn => btn && !isBlankButton(btn))
        : [];

    if (!buttons.length) throw new Error(t`There are no usable buttons in that file.`);

    return { buttons, visibleCount: Number(data.visibleCount) || 0 };
}

function renderSettingsUI() {
    const settings = extension_settings[MODULE_NAME];
    const container = $('<div class="custom-md-settings"></div>');

    const toggleRow = $('<label class="checkbox_label"><input type="checkbox"/><span></span></label>');
    toggleRow.find('span').text(t`Enable markdown toolbar`);
    toggleRow.find('input').prop('checked', !!settings.enabled).on('change', function() {
        settings.enabled = this.checked;
        saveSettingsDebounced();
        renderToolbar();
    });
    container.append(toggleRow);

    const countRow = $('<label class="qsg-field"><span></span><input type="number" class="text_pole qsg-visible-count" min="0" max="30" step="1"/><small class="qsg-note"></small></label>');
    countRow.find('span').text(t`Buttons shown in the toolbar`);
    countRow.find('small').text(t`0 shows them all. Otherwise the rest go into a "..." menu.`);
    countRow.find('input').val(Number(settings.visibleCount) || 0).on('change input', function() {
        settings.visibleCount = Math.max(0, Number($(this).val()) || 0);
        saveSettingsDebounced();
        renderToolbar();
    });
    container.append(countRow);

    const listContainer = $('<div class="qsg-list"></div>');

    function refreshList() {
        listContainer.empty();

        settings.buttons.forEach((btn, index) => {
            const item = $(`
                <div class="qsg-item" data-index="${index}">
                    <div class="qsg-item-head">
                        <div class="drag-handle ui-sortable-handle fa-solid fa-grip-vertical"></div>
                        <div class="menu_button qsg-icon"></div>
                        <div class="qsg-summary">
                            <div class="qsg-name"></div>
                            <div class="qsg-preview"></div>
                        </div>
                        <div class="qsg-expand fa-solid fa-chevron-down"></div>
                    </div>
                    <div class="qsg-item-detail">
                        <label class="qsg-field">
                            <span class="qsg-label-name"></span>
                            <input type="text" class="text_pole" value="${escapeAttr(btn.title)}" data-field="title">
                        </label>
                        <label class="qsg-field">
                            <span class="qsg-label-custom"></span>
                            <input type="text" class="text_pole" value="${escapeAttr(btn.label)}" data-field="label">
                            <small class="qsg-note qsg-custom-note"></small>
                        </label>
                        <div class="qsg-field">
                            <span class="qsg-label-action"></span>
                            <select class="text_pole qsg-action">
                                <option value="wrap" ${btn.action !== 'prefix' && btn.action !== 'newline' ? 'selected' : ''}></option>
                                <option value="prefix" ${btn.action === 'prefix' ? 'selected' : ''}></option>
                                <option value="newline" ${btn.action === 'newline' ? 'selected' : ''}></option>
                            </select>
                        </div>
                        <div class="qsg-field">
                            <span class="qsg-label-symbols"></span>
                            <input type="text" class="text_pole qsg-symbol" value="${escapeAttr(btn.left)}" data-field="left">
                            <input type="text" class="text_pole qsg-symbol qsg-right" value="${escapeAttr(btn.right)}" data-field="right">
                            <small class="qsg-note qsg-symbol-note"></small>
                        </div>
                        <div class="qsg-field qsg-preview-row">
                            <span class="qsg-label-result"></span>
                            <code class="qsg-preview qsg-preview-lg"></code>
                        </div>
                        <div class="qsg-field qsg-detail-foot">
                            <label class="checkbox_label">
                                <input type="checkbox" class="qsg-enabled" ${btn.enabled === false ? '' : 'checked'}/>
                                <span class="qsg-label-use"></span>
                            </label>
                            <button type="button" class="menu_button qsg-delete"></button>
                        </div>
                    </div>
                </div>
            `);

            item.find('.drag-handle').attr('title', t`Drag to reorder`);
            item.find('.qsg-label-name').text(t`Name`);
            item.find('[data-field="title"]').attr('placeholder', t`e.g. Dialogue`);
            item.find('.qsg-label-custom').text(t`Custom label`);
            item.find('[data-field="label"]').attr('placeholder', t`e.g. 💬`);
            item.find('.qsg-custom-note').text(t`Fill this in and the button shows it instead of the icon.`);
            item.find('.qsg-label-action').text(t`Insert`);
            item.find('.qsg-action option').eq(0).text(t`around the selection`);
            item.find('.qsg-action option').eq(1).text(t`at the start of this line`);
            item.find('.qsg-action option').eq(2).text(t`at the start of a new line`);
            item.find('.qsg-label-symbols').text(t`Symbols`);
            item.find('.qsg-right').attr('placeholder', t`after`);
            item.find('.qsg-label-result').text(t`You get`);
            item.find('.qsg-label-use').text(t`Use this button`);
            item.find('.qsg-delete').text(t`Delete`);

            function refreshItem() {
                const blank = isBlankButton(btn);
                const overridden = !!btn.label?.trim();

                item.toggleClass('qsg-item-disabled', btn.enabled === false);
                item.toggleClass('qsg-item-blank', blank);

                applyButtonContent(item.find('.qsg-icon'), btn);
                item.find('.qsg-icon')
                    .attr('title', overridden ? t`The custom label is showing instead of the icon` : t`Change icon`);

                // 이름이 없으면 자리만 차지하므로 감추고, 아래 미리보기가 식별을 맡는다
                item.find('.qsg-name').text(btn.title).toggleClass('qsg-off', !btn.title);

                item.find('.qsg-preview')
                    .text(blank ? t`Add a symbol to make this work` : getInsertPreview(btn))
                    .attr('title', blank ? '' : t`| is where the cursor lands`);
            }

            const ACTION_NOTES = {
                wrap: () => t`For paired symbols like " or **. Press again to undo. The second box can stay empty.`,
                prefix: () => t`Turns the line you are on into a quote or a list item. Press again to undo.`,
                newline: () => t`Starts a fresh line, for an OOC note or a --- scene break.`,
            };

            function applyAction() {
                const isWrap = btn.action !== 'prefix' && btn.action !== 'newline';
                item.find('.qsg-right').toggleClass('qsg-off', !isWrap);
                item.find('[data-field="left"]').attr('placeholder', isWrap ? t`before` : t`symbol`);
                item.find('.qsg-symbol-note').text((ACTION_NOTES[btn.action] || ACTION_NOTES.wrap)());
            }

            refreshItem();
            applyAction();

            item.find('.qsg-action').on('change', function() {
                btn.action = $(this).val();
                applyAction();
                refreshItem();
                saveSettingsDebounced();
                renderToolbar();
            });

            item.find('.qsg-icon').on('click', async () => {
                const icon = await showFontAwesomePicker();
                if (!icon) return;

                btn.icon = icon;

                // 직접 입력이 차 있으면 고른 아이콘이 가려진다. 그냥 넘기지 않고 물어본다
                if (btn.label?.trim()) {
                    const clear = await callGenericPopup(
                        t`The custom label is filled in, so the icon you picked will not show. Clear it and use the icon?`,
                        POPUP_TYPE.CONFIRM,
                        '',
                        { okButton: t`Use the icon`, cancelButton: t`Leave it` },
                    );

                    if (clear === POPUP_RESULT.AFFIRMATIVE) {
                        btn.label = '';
                        item.find('[data-field="label"]').val('');
                    }
                }

                refreshItem();
                saveSettingsDebounced();
                renderToolbar();
            });

            // 요약 줄 아무 곳이나 눌러서 상세 펼치기 (드래그 핸들과 아이콘 버튼 제외)
            item.find('.qsg-item-head').on('click', function(e) {
                if ($(e.target).closest('.drag-handle, .qsg-icon').length) return;

                item.toggleClass('qsg-item-open');
                item.find('.qsg-item-detail').stop().slideToggle(150);
            });

            item.find('input[data-field]').on('change input', function() {
                const field = $(this).data('field');
                if (!['title', 'label', 'left', 'right'].includes(field)) return;

                btn[field] = $(this).val();
                refreshItem();
                saveSettingsDebounced();
                renderToolbar();
            });

            item.find('.qsg-enabled').on('change', function() {
                btn.enabled = this.checked;
                refreshItem();
                saveSettingsDebounced();
                renderToolbar();
            });

            item.find('.qsg-delete').on('click', async () => {
                const name = btn.title || t`this button`;
                // 문자열로 넘기면 ST 가 innerHTML 로 그린다. 요소로 만들어 본문을 텍스트로 고정
                const message = document.createElement('div');
                message.textContent = t`Delete ${name}?`;

                const confirmed = await callGenericPopup(
                    message,
                    POPUP_TYPE.CONFIRM,
                    '',
                    { okButton: t`Delete`, cancelButton: t`Cancel` },
                );

                if (confirmed !== POPUP_RESULT.AFFIRMATIVE) return;

                settings.buttons.splice(Number(item.attr('data-index')), 1);
                saveSettingsDebounced();
                renderToolbar();
                refreshList();
            });

            listContainer.append(item);
        });
    }

    refreshList();

    listContainer.sortable({
        handle: '.drag-handle',
        delay: getSortableDelay(),
        stop: () => {
            const previous = settings.buttons.slice();
            settings.buttons = listContainer.children('.qsg-item').map((newIndex, el) => {
                const moved = previous[Number(el.getAttribute('data-index'))];
                el.setAttribute('data-index', String(newIndex));
                return moved;
            }).get();
            saveSettingsDebounced();
            renderToolbar();
        },
    });

    container.append($('<h4></h4>').text(t`Buttons`));
    container.append($('<small class="qsg-hint"></small>').text(t`Tap a row to open it, drag the handle on the left to reorder.`));
    container.append(listContainer);

    const listActions = $('<div class="qsg-list-actions"></div>');
    // 자주 쓰는 '추가' 만 글자로 두고, 나머지는 아이콘으로 묶어 오른쪽에 붙인다
    const sideActions = $('<div class="qsg-list-actions-side"></div>');

    // 아이콘만 있는 버튼은 화면 낭독기에 읽을 것이 없으므로 이름을 따로 달아 준다
    function makeIconAction(icon, label) {
        return $('<button type="button" class="menu_button fa-solid qsg-quiet-button"></button>')
            .addClass(icon)
            .attr({ title: label, 'aria-label': label });
    }

    const addBtn = $('<button type="button" class="menu_button"></button>').text(t`+ Add button`);
    addBtn.on('click', () => {
        settings.buttons.push({
            id: Date.now(),
            icon: '',
            label: '',
            left: '',
            right: '',
            title: '',
            action: 'wrap',
            enabled: true,
        });
        saveSettingsDebounced();
        renderToolbar();
        refreshList();

        // 새 항목은 바로 채워 넣을 수 있게 펼치고 커서까지 옮겨 준다
        const added = listContainer.children('.qsg-item').last();
        added.addClass('qsg-item-open');
        added.find('.qsg-item-detail').show();
        added.find('[data-field="title"]').trigger('focus');
        added[0]?.scrollIntoView({ block: 'nearest' });
    });
    listActions.append(addBtn);

    // 기본 버튼은 첫 설치 때만 들어가므로, 나중에 다시 받을 길을 열어 둔다
    const resetBtn = makeIconAction('fa-undo', t`Restore defaults`);
    resetBtn.on('click', async () => {
        const confirmed = await callGenericPopup(
            t`Replace the list with the default buttons? Buttons you made yourself will be gone.`,
            POPUP_TYPE.CONFIRM,
            '',
            { okButton: t`Restore`, cancelButton: t`Cancel` },
        );

        if (confirmed !== POPUP_RESULT.AFFIRMATIVE) return;

        settings.buttons = getDefaultButtons();
        saveSettingsDebounced();
        renderToolbar();
        refreshList();
    });
    sideActions.append(resetBtn);

    const exportBtn = makeIconAction('fa-file-export', t`Export`);
    exportBtn.on('click', () => download(buildExportFile(), EXPORT_NAME, 'application/json'));
    sideActions.append(exportBtn);

    // 파일 창을 여는 용도라서 화면에는 두지 않는다
    const fileInput = $('<input type="file" accept="application/json,.json" hidden>');
    const importBtn = makeIconAction('fa-file-import', t`Import`);

    importBtn.on('click', () => fileInput.trigger('click'));

    fileInput.on('change', async function() {
        const file = this.files?.[0];
        // 같은 파일을 다시 골라도 change 가 오도록 비워 둔다
        this.value = '';
        if (!file) return;

        let loaded;

        try {
            loaded = await readButtonFile(file);
        } catch (error) {
            // 문자열로 넘기면 ST 가 innerHTML 로 그린다. 요소로 만들어 본문을 텍스트로 고정
            const reason = document.createElement('div');
            reason.textContent = error.message;
            await callGenericPopup(reason, POPUP_TYPE.TEXT);
            return;
        }

        const count = loaded.buttons.length;
        const message = document.createElement('div');
        message.textContent = t`Found ${count} buttons.`;

        const choice = await callGenericPopup(message, POPUP_TYPE.CONFIRM, '', {
            okButton: t`Replace my list`,
            cancelButton: t`Cancel`,
            customButtons: [{ text: t`Add to the end`, result: POPUP_RESULT.CUSTOM1 }],
        });

        if (choice === POPUP_RESULT.AFFIRMATIVE) {
            settings.buttons = loaded.buttons;
            // 몇 개를 펼쳐 둘지도 세트를 만든 사람이 정한 값이 있다
            settings.visibleCount = loaded.visibleCount;
            countRow.find('input').val(settings.visibleCount);
        } else if (choice === POPUP_RESULT.CUSTOM1) {
            settings.buttons = settings.buttons.concat(loaded.buttons);
        } else {
            return;
        }

        saveSettingsDebounced();
        renderToolbar();
        refreshList();
    });

    sideActions.append(importBtn, fileInput);
    listActions.append(sideActions);

    container.append(listActions);

    return container;
}

// 속성값에 그대로 넣기 위한 최소 이스케이프
function escapeAttr(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

jQuery(async function() {
    await loadLocale();
    loadSettings();
    renderToolbar();
    watchFocusedTextarea();

    const drawer = $(`
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b class="qsg-drawer-title"></b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content"></div>
        </div>
    `);
    drawer.find('.qsg-drawer-title').text(t`Markdown Toolbar`);
    drawer.find('.inline-drawer-content').append(renderSettingsUI());

    $('#extensions_settings').append(
        $('<div id="custom_md_buttons_container" class="extension_container"></div>').append(drawer)
    );
});
