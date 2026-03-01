window.APP = {
  template: '#app_template',
  name: 'app',
  data() {
    return {
      // ── Core chat ──────────────────────────────
      style: CONFIG.style,
      showInput: false,
      showWindow: false,
      shouldHide: true,
      backingSuggestions: [],
      removedSuggestions: [],
      templates: CONFIG.templates,
      message: '',
      messages: [],
      oldMessages: [],
      oldMessagesIndex: -1,
      tplBackups: [],
      msgTplBackups: [],
      pressedKeys: {},
      selectedSuggestionIdx: 0,

      // ── Settings panel ─────────────────────────
      showSettings:      false,
      settingsPosition:  'left',
      settingsBgColor:   '#134855',
      settingsTextColor: '#dcdcdc',

      // ── Color picker ───────────────────────────
      showColorPicker:   false,
      colorPickerTarget: null,   // 'bg' | 'text'
      cpHue:        0,
      cpSaturation: 100,
      cpBrightness: 100,
      cpHex:        '#ff0000',
    };
  },

  destroyed() {
    clearInterval(this.focusTimer);
    window.removeEventListener('message', this.listener);
  },

  mounted() {
    post('http://ef-chat/loaded', JSON.stringify({}));
    this.listener = window.addEventListener('message', (event) => {
      const item = event.data || event.detail;
      if (this[item.type]) {
        this[item.type](item);
      }
    });
  },

  watch: {
    messages() {
      if (this.showWindowTimer) clearTimeout(this.showWindowTimer);
      this.showWindow = true;
      this.resetShowWindowTimer();
      const messagesObj = this.$refs.messages;
      this.$nextTick(() => { messagesObj.scrollTop = messagesObj.scrollHeight; });
    },
    message() {
      this.selectedSuggestionIdx = 0;
    },
  },

  computed: {
    emptySuggestions() {
      if (this.message === '') return true;
      const list = this._buildSuggestionList();
      return list.length === 0;
    },
    suggestions() {
      return this.backingSuggestions.filter(
        (el) => this.removedSuggestions.indexOf(el.name) <= -1
      );
    },
  },

  methods: {

    // ══════════════════════════════════════════════
    // NUI message handlers
    // ══════════════════════════════════════════════

    ON_SCREEN_STATE_CHANGE({ shouldHide }) {
      this.shouldHide = shouldHide;
    },

    ON_OPEN() {
      this.showInput = true;
      this.showWindow = true;
      if (this.showWindowTimer) clearTimeout(this.showWindowTimer);
      this.focusTimer = setInterval(() => {
        if (this.$refs.input) {
          this.$refs.input.focus();
        } else {
          clearInterval(this.focusTimer);
        }
      }, 100);
    },

    ON_MESSAGE({ message }) {
      this.messages.push(message);
    },

    // BUG CORRIGIDO: o Lua enviava { action = "clear" } em vez de { type = "ON_CLEAR" }.
    // O listener em mounted() verifica item.type, por isso o método nunca era chamado.
    // Corrigido no cl_chat.lua para enviar type = 'ON_CLEAR'. O handler aqui estava correto.
    ON_CLEAR() {
      this.messages        = [];
      this.oldMessages     = [];
      this.oldMessagesIndex = -1;
    },

    ON_SUGGESTION_ADD({ suggestion }) {
      const dup = this.backingSuggestions.find(a => a.name == suggestion.name);
      if (dup) {
        if (suggestion.help || suggestion.params) {
          dup.help   = suggestion.help   || '';
          dup.params = suggestion.params || [];
        }
        return;
      }
      if (!suggestion.params) suggestion.params = [];
      if (this.removedSuggestions.find(a => a.name == suggestion.name)) {
        this.removedSuggestions.splice(this.removedSuggestions.indexOf(suggestion.name), 1);
      }
      this.backingSuggestions.push(suggestion);
    },

    ON_SUGGESTION_REMOVE({ name }) {
      if (this.removedSuggestions.indexOf(name) <= -1) {
        this.removedSuggestions.push(name);
      }
    },

    ON_COMMANDS_RESET() {
      console.log('Resetting Command Suggestions');
      this.removedSuggestions = [];
      this.backingSuggestions = [];
    },

    ON_TEMPLATE_ADD({ template }) {
      if (this.templates[template.id]) {
        this.warn(`Tried to add duplicate template '${template.id}'`);
      } else {
        this.templates[template.id] = template.html;
      }
    },

    ON_UPDATE_THEMES({ themes }) {
      this.removeThemes();
      this.setThemes(themes);
    },

    // ── Settings NUI handlers ─────────────────────

    OPEN_SETTINGS({ settings }) {
      if (settings) {
        this.settingsPosition  = settings.position  || 'left';
        this.settingsBgColor   = settings.bgColor   || '#134855';
        this.settingsTextColor = settings.textColor || '#dcdcdc';
      }
      this.showSettings = true;
    },

    APPLY_SETTINGS({ settings }) {
      if (!settings) return;
      this.settingsPosition  = settings.position  || 'left';
      this.settingsBgColor   = settings.bgColor   || '#134855';
      this.settingsTextColor = settings.textColor || '#dcdcdc';
      this.applyCssSettings();
    },

    // ══════════════════════════════════════════════
    // Settings panel methods
    // ══════════════════════════════════════════════

    closeSettings() {
      this.showSettings    = false;
      this.showColorPicker = false;
      post('http://ef-chat/closeSettings', JSON.stringify({}));
    },

    saveSettings() {
      const settings = {
        position:  this.settingsPosition,
        bgColor:   this.settingsBgColor,
        textColor: this.settingsTextColor,
      };
      post('http://ef-chat/saveSettings', JSON.stringify(settings));
      this.applyCssSettings();
      this.closeSettings();
    },

    applyCssSettings() {
      const root   = document.documentElement;
      const bgRgb  = this.hexToRgb(this.settingsBgColor);
      if (bgRgb) {
        root.style.setProperty(
          '--chat-bg-primary',
          `rgba(${bgRgb.r}, ${bgRgb.g}, ${bgRgb.b}, 0.85)`
        );
        const r2 = Math.max(0, bgRgb.r - 24);
        const g2 = Math.max(0, bgRgb.g - 24);
        const b2 = Math.max(0, bgRgb.b - 24);
        root.style.setProperty(
          '--chat-bg-secondary',
          `rgba(${r2}, ${g2}, ${b2}, 0.70)`
        );
      }
      root.style.setProperty('--chat-text-main', this.settingsTextColor);
    },

    validateHexInput(target) {
      const val = target === 'bg' ? this.settingsBgColor : this.settingsTextColor;
      if (/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(val)) {
        if (val.length === 4) {
          const expanded = '#' + val[1]+val[1] + val[2]+val[2] + val[3]+val[3];
          if (target === 'bg') this.settingsBgColor   = expanded;
          else                  this.settingsTextColor = expanded;
        }
      }
    },

    // ══════════════════════════════════════════════
    // Color picker methods
    // ══════════════════════════════════════════════

    openColorPicker(target) {
      this.colorPickerTarget = target;
      const currentHex       = target === 'bg' ? this.settingsBgColor : this.settingsTextColor;
      const hsv              = this.hexToHsv(currentHex);
      this.cpHue             = hsv.h;
      this.cpSaturation      = hsv.s;
      this.cpBrightness      = hsv.v;
      this.cpHex             = this.normaliseHex(currentHex);
      this.showColorPicker   = true;
    },

    closeColorPicker() {
      this.showColorPicker = false;
    },

    confirmColorPicker() {
      if (this.colorPickerTarget === 'bg') {
        this.settingsBgColor   = this.cpHex;
      } else {
        this.settingsTextColor = this.cpHex;
      }
      this.showColorPicker = false;
    },

    onCpGradientMousedown(e) {
      e.preventDefault();
      this.updateCpFromMouseEvent(e);

      const onMove = (ev) => { this.updateCpFromMouseEvent(ev); };
      const onUp   = ()   => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    },

    updateCpFromMouseEvent(e) {
      const el   = this.$refs.cpGradient;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      let x = (e.clientX - rect.left) / rect.width  * 100;
      let y = (e.clientY - rect.top)  / rect.height * 100;
      x = Math.max(0, Math.min(100, x));
      y = Math.max(0, Math.min(100, y));
      this.cpSaturation = x;
      this.cpBrightness = 100 - y;
      this.cpUpdateHex();
    },

    onCpHueInput(e) {
      this.cpHue = Number(e.target.value);
      this.cpUpdateHex();
    },

    // BUG CORRIGIDO: o método chamava-se onCpHexInput mas o template usava
    // @change="onCpHexInputChange". Renomeado para onCpHexInputChange em ambos os lados
    // para garantir consistência total.
    onCpHexInputChange() {
      const hex = this.normaliseHex(this.cpHex);
      if (!hex) return;
      this.cpHex        = hex;
      const hsv         = this.hexToHsv(hex);
      this.cpHue        = hsv.h;
      this.cpSaturation = hsv.s;
      this.cpBrightness = hsv.v;
    },

    // ── Utilitários de cor ────────────────────────

    cpUpdateHex() {
      this.cpHex = this.hsvToHex(
        Number(this.cpHue),
        Number(this.cpSaturation),
        Number(this.cpBrightness)
      );
    },

    hsvToHex(h, s, v) {
      s /= 100;
      v /= 100;
      const c = v * s;
      const x = c * (1 - Math.abs((h / 60) % 2 - 1));
      const m = v - c;
      let r = 0, g = 0, b = 0;
      if      (h <  60) { r = c; g = x; b = 0; }
      else if (h < 120) { r = x; g = c; b = 0; }
      else if (h < 180) { r = 0; g = c; b = x; }
      else if (h < 240) { r = 0; g = x; b = c; }
      else if (h < 300) { r = x; g = 0; b = c; }
      else              { r = c; g = 0; b = x; }
      const toHex = (n) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
      return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    },

    hexToHsv(hex) {
      const clean = this.normaliseHex(hex);
      if (!clean) return { h: 0, s: 100, v: 100 };
      const r = parseInt(clean.substr(1, 2), 16) / 255;
      const g = parseInt(clean.substr(3, 2), 16) / 255;
      const b = parseInt(clean.substr(5, 2), 16) / 255;
      const max   = Math.max(r, g, b);
      const min   = Math.min(r, g, b);
      const delta = max - min;
      let h = 0, s = 0;
      const v = max * 100;
      if (delta !== 0) {
        s = (delta / max) * 100;
        if      (max === r) h = ((g - b) / delta) % 6;
        else if (max === g) h = (b - r)  / delta  + 2;
        else                h = (r - g)  / delta  + 4;
        h = Math.round(h * 60);
        if (h < 0) h += 360;
      }
      return { h, s, v };
    },

    hexToRgb(hex) {
      const clean = this.normaliseHex(hex);
      if (!clean) return null;
      return {
        r: parseInt(clean.substr(1, 2), 16),
        g: parseInt(clean.substr(3, 2), 16),
        b: parseInt(clean.substr(5, 2), 16),
      };
    },

    normaliseHex(hex) {
      if (!hex) return null;
      hex = hex.trim();
      if (!hex.startsWith('#')) hex = '#' + hex;
      if (/^#[0-9A-Fa-f]{3}$/.test(hex)) {
        hex = '#' + hex[1]+hex[1] + hex[2]+hex[2] + hex[3]+hex[3];
      }
      if (/^#[0-9A-Fa-f]{6}$/.test(hex)) return hex.toLowerCase();
      return null;
    },

    // ══════════════════════════════════════════════
    // Themes
    // ══════════════════════════════════════════════

    removeThemes() {
      for (let i = 0; i < document.styleSheets.length; i++) {
        const ss   = document.styleSheets[i];
        const node = ss.ownerNode;
        if (node.getAttribute('data-theme')) node.parentNode.removeChild(node);
      }
      this.tplBackups.reverse();
      for (const [elem, oldData] of this.tplBackups) elem.innerText = oldData;
      this.tplBackups = [];
      this.msgTplBackups.reverse();
      for (const [id, oldData] of this.msgTplBackups) this.templates[id] = oldData;
      this.msgTplBackups = [];
    },

    setThemes(themes) {
      for (const [id, data] of Object.entries(themes)) {
        if (data.style) {
          const style = document.createElement('style');
          style.type  = 'text/css';
          style.setAttribute('data-theme', id);
          style.appendChild(document.createTextNode(data.style));
          document.head.appendChild(style);
        }
        if (data.styleSheet) {
          const link = document.createElement('link');
          link.rel   = 'stylesheet';
          link.type  = 'text/css';
          link.href  = data.baseUrl + data.styleSheet;
          link.setAttribute('data-theme', id);
          document.head.appendChild(link);
        }
        if (data.templates) {
          for (const [tplId, tpl] of Object.entries(data.templates)) {
            const elem = document.getElementById(tplId);
            if (elem) {
              this.tplBackups.push([elem, elem.innerText]);
              elem.innerText = tpl;
            }
          }
        }
        if (data.script) {
          const script = document.createElement('script');
          script.type  = 'text/javascript';
          script.src   = data.baseUrl + data.script;
          document.head.appendChild(script);
        }
        if (data.msgTemplates) {
          for (const [tplId, tpl] of Object.entries(data.msgTemplates)) {
            this.msgTplBackups.push([tplId, this.templates[tplId]]);
            this.templates[tplId] = tpl;
          }
        }
      }
    },

    // ══════════════════════════════════════════════
    // Chat input / message history
    // ══════════════════════════════════════════════

    warn(msg) {
      this.messages.push({ args: [msg], template: '^3<b>CHAT-WARN</b>: ^0{0}' });
    },

    clearShowWindowTimer() {
      clearTimeout(this.showWindowTimer);
    },

    resetShowWindowTimer() {
      this.clearShowWindowTimer();
      this.showWindowTimer = setTimeout(() => {
        if (!this.showInput) this.showWindow = false;
      }, CONFIG.fadeTimeout);
    },

    // Scroll do rato: navega sugestões (quando visíveis), setas mantêm histórico
    onWheel(e) {
      if (this.emptySuggestions) return;
      e.preventDefault();
      if (e.deltaY > 0) {
        this.switchSuggestionDown();
      } else {
        this.switchSuggestionUp();
      }
    },

    keyUp(e) {
      this.resize();
      delete this.pressedKeys[e.which];
    },

    keyDown(e) {
      this.pressedKeys[e.which] = true;
      // Setas ↑↓ sem Ctrl → navegação no histórico de mensagens
      if (this.pressedKeys[17] === undefined && (e.which === 38 || e.which === 40)) {
        e.preventDefault();
        this.moveOldMessageIndex(e.which === 38);
      } else if (e.which == 33) {
        var buf = document.getElementsByClassName('chat-messages')[0];
        buf.scrollTop = buf.scrollTop - 100;
      } else if (e.which == 34) {
        var buf = document.getElementsByClassName('chat-messages')[0];
        buf.scrollTop = buf.scrollTop + 100;
      }
    },

    moveOldMessageIndex(up) {
      if (up && this.oldMessages.length > this.oldMessagesIndex + 1) {
        this.oldMessagesIndex += 1;
        this.message = this.oldMessages[this.oldMessagesIndex];
      } else if (!up && this.oldMessagesIndex - 1 >= 0) {
        this.oldMessagesIndex -= 1;
        this.message = this.oldMessages[this.oldMessagesIndex];
      } else if (!up && this.oldMessagesIndex - 1 === -1) {
        this.oldMessagesIndex = -1;
        this.message = '';
      }
    },

    resize() {
      // placeholder — textarea resize desativado intencionalmente
    },

    send(e) {
      if (this.message !== '') {
        post('http://ef-chat/chatResult', JSON.stringify({ message: this.message }));
        this.oldMessages.unshift(this.message);
        this.oldMessagesIndex = -1;
        this.hideInput();
      } else {
        this.hideInput(true);
      }
    },

    hideInput(canceled = false) {
      if (canceled) {
        post('http://ef-chat/chatResult', JSON.stringify({ canceled }));
      }
      this.message   = '';
      this.showInput = false;
      clearInterval(this.focusTimer);
      this.resetShowWindowTimer();
    },

    // ══════════════════════════════════════════════
    // Suggestions — helper centralizado
    // BUG CORRIGIDO: emptySuggestions (computed) e _buildSuggestionList (método)
    // usavam lógica de filtragem duplicada e ligeiramente inconsistente.
    // Agora ambos chamam _buildSuggestionList, garantindo fonte única de verdade.
    // ══════════════════════════════════════════════

    _buildSuggestionList() {
      if (this.message === '') return [];
      const slashMessage   = this.message;
      const suggestionList = this.backingSuggestions.filter(
        (el) => this.removedSuggestions.indexOf(el.name) <= -1
      );
      return suggestionList.filter((s) => {
        if (!s.name.startsWith(slashMessage)) {
          const ss = s.name.split(' ');
          const ms = slashMessage.split(' ');
          for (let i = 0; i < ms.length; i++) {
            if (i >= ss.length) return i < ss.length + s.params.length;
            if (ss[i] !== ms[i]) return false;
          }
        }
        return true;
      }).slice(0, CONFIG.suggestionLimit);
    },

    completeSuggestion() {
      const list = this._buildSuggestionList();
      const top  = list[this.selectedSuggestionIdx];
      if (top) this.message = top.name;
    },

    switchSuggestionDown() {
      if (this.message === '') return;
      const list = this._buildSuggestionList();
      this.selectedSuggestionIdx = (this.selectedSuggestionIdx + 1) % (list.length || 1);
    },

    switchSuggestionUp() {
      if (this.message === '') return;
      const list = this._buildSuggestionList();
      let prev   = this.selectedSuggestionIdx - 1;
      if (prev < 0) prev = list.length - 1;
      if (prev < 0) prev = 0;
      this.selectedSuggestionIdx = prev;
    },

  },
};
