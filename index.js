import { saveSettingsDebounced } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { getSortableDelay, showFontAwesomePicker } from '../../../utils.js';
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

// 선택한 글을 기호로 감싼다
function wrapSelection(textarea, left, right) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.substring(start, end);

    replaceRange(textarea, start, end, left + selected + right);

    // 닫는 기호 바로 앞 (닫는 기호가 없으면 삽입한 내용 뒤)
    const cursor = start + left.length + selected.length;
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

function runButton(btn) {
    const textarea = document.getElementById('send_textarea');
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
    el.attr('title', btn.title || '');
    applyButtonContent(el, btn);
    el.on('click', () => runButton(btn));
    return el;
}

function renderToolbar() {
    $('#custom-md-toolbar').remove();
    $(document).off('click.qsgOverflow');

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

        trigger.attr('title', t`More`);
        hidden.forEach(btn => menu.append(makeToolbarButton(btn)));

        trigger.on('click', event => {
            event.stopPropagation();

            const opening = menu.hasClass('qsg-off');
            menu.toggleClass('qsg-off');
            // 폭은 보이는 상태에서만 잴 수 있다
            if (opening) fitMenuWidth(menu);
        });

        // 바깥을 누르면 닫는다
        $(document).on('click.qsgOverflow', () => menu.addClass('qsg-off'));

        wrapper.append(trigger, menu);
        toolbar.append(wrapper);
    }

    // #send_form 은 order 로 줄을 쌓는 wrap 플렉스다. 입력 줄(order 25) 위에 자기 줄을 차지하게 둔다
    $('#send_form').append(toolbar);
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
                wrap: () => t`For paired symbols like " or **. The second box can stay empty.`,
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
    const resetBtn = $('<button type="button" class="menu_button qsg-quiet-button"></button>').text(t`Restore defaults`);
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
    listActions.append(resetBtn);

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
