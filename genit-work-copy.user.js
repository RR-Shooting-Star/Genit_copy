// ==UserScript==
// @name         젠잇 작품 복사
// @namespace    genit-work-copy
// @version      0.6.0
// @description  젠잇 컨텐츠 수정 화면에 '작품 복사' 버튼을 추가합니다. 텍스트 항목을 새 비공개 작품의 임시 저장 1번으로 복사합니다. (이미지·표지·장르 제외)
// @match        https://genit.ai/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

// 젠잇 작품 복사 — 컨텐츠 수정 화면에서 텍스트 항목을 새 비공개 작품으로 복사합니다.
// 이미지(표지, 에셋 이미지, 캐릭터 프로필, 시작 상황 커버)는 복사하지 않습니다.
(() => {
  'use strict';
  if (window.__genitWorkCopy) return;
  window.__genitWorkCopy = true;

  const API = 'https://api.genit.ai/api';
  const EDIT_RE = /\/contents\/([0-9a-f-]{36})\/edit/i;

  // ---------------------------------------------------------------------------
  // 1. 젠잇이 자기 API를 부를 때 쓰는 인증 헤더를 그대로 빌려 씁니다.
  //    (값은 이 탭의 메모리에만 두고, api.genit.ai 외에는 어디에도 보내지 않습니다)
  // ---------------------------------------------------------------------------
  const auth = { headers: {}, unsafe: null, withCredentials: false };
  const isUnsafe = (m) => !/^(GET|HEAD|OPTIONS)$/i.test(m || 'GET');
  const SKIP = new Set(['content-type', 'accept', 'content-length']);
  const isApi = (url) => {
    try { return new URL(url, location.href).origin === 'https://api.genit.ai'; }
    catch { return false; }
  };
  const remember = (name, value) => {
    const key = String(name).toLowerCase();
    if (!SKIP.has(key)) auth.headers[key] = String(value);
  };

  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSet = XMLHttpRequest.prototype.setRequestHeader;
  const xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__gwcApi = isApi(url);
    this.__gwcMethod = method;
    this.__gwcOwn = {};
    return xhrOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this.__gwcApi) {
      remember(name, value);
      const key = String(name).toLowerCase();
      if (!SKIP.has(key) && this.__gwcOwn) this.__gwcOwn[key] = String(value);
    }
    return xhrSet.call(this, name, value);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    if (this.__gwcApi) {
      auth.withCredentials = !!this.withCredentials;
      // 저장·생성처럼 내용을 바꾸는 요청에 젠잇이 붙이는 헤더 묶음을 따로 기억
      if (isUnsafe(this.__gwcMethod)) auth.unsafe = { ...this.__gwcOwn };
    }
    return xhrSend.apply(this, args);
  };

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || String(input);
      if (isApi(url)) {
        const h = new Headers((init && init.headers) || (input instanceof Request ? input.headers : undefined));
        h.forEach((v, k) => remember(k, v));
        const method = (init && init.method) || (input instanceof Request ? input.method : 'GET');
        if (isUnsafe(method)) {
          const own = {};
          h.forEach((v, k) => { if (!SKIP.has(k.toLowerCase())) own[k.toLowerCase()] = v; });
          auth.unsafe = own;
        }
        const cred = (init && init.credentials) || (input instanceof Request ? input.credentials : '');
        if (cred === 'include') auth.withCredentials = true;
      }
    } catch { /* 가로채기 실패는 무시 */ }
    return origFetch.apply(this, arguments);
  };

  const api = (path, options = {}) => {
    const base = isUnsafe(options.method) && auth.unsafe ? auth.unsafe : auth.headers;
    const headers = { ...base, ...(options.headers || {}) };
    if (headers['x-request-id'] && crypto.randomUUID) headers['x-request-id'] = crypto.randomUUID();
    return origFetch(API + path, {
      ...options,
      headers,
      credentials: auth.withCredentials ? 'include' : 'same-origin',
    });
  };

  // ---------------------------------------------------------------------------
  // 2. 원본 작품 데이터 → 저장용 폼
  // ---------------------------------------------------------------------------
  const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k] ?? '']));

  function buildForm(src, title, replaceId) {
    const v = src.latest_version || {};
    const fix = (text) =>
      replaceId && typeof text === 'string' ? text.split(src.id).join(replaceId) : text;

    const greetings = (v.greetings || src.greetings || []).map((g, i) => ({
      title: g.title || '',
      content: fix(g.content || ''),
      background: g.background || '',
      volatility_background: g.volatility_background || '',
      sample_questions: g.sample_questions || [],
      description: g.description || '',
      cover_image: '', // 커버는 원본 작품에 묶여 있어 복사하지 않음
      is_active: g.is_active !== false,
      display_order: g.display_order ?? i,
    }));

    const lorebooks = (src.lorebooks || []).map((l) => ({
      title: l.title || '',
      description: l.description || '',
      keywords: l.keywords || [],
      category: l.category || '',
      recall_cue: l.recall_cue || '',
      status: l.status || '',
      is_active: l.is_active !== false,
      is_hidden: !!l.is_hidden,
      is_pinned: !!l.is_pinned,
    }));

    const templates = (v.html_templates || []).map((t) => ({
      id: t.id,
      html: fix(t.html || ''),
      name: t.name || '',
      slots: t.slots || [],
      template_type: t.template_type || 'html',
    }));

    const cast = (v.cast_members || []).map((c, i) => ({
      name: c.name || '',
      codename: c.codename || '',
      history: c.history || '',
      introduction: c.introduction || '',
      initial_journal: c.initial_journal || '',
      background: c.background || '',
      aliases: c.aliases || [],
      keywords: c.keywords || [],
      profile_url: '', // 프로필 이미지는 복사하지 않음
      is_active: c.is_active !== false,
      display_order: c.display_order ?? i,
      originalIndex: i,
    }));

    const info = (v.info_values || []).map((x) => ({
      ...pick(x, ['name', 'name_ko', 'name_en', 'codename', 'description', 'description_en']),
      description_ko: x.description_ko ?? x.description ?? '',
      is_character_variable: !!x.is_character_variable,
      is_protected: x.codename === 'T' || x.codename === 'L',
      initial_value: x.initial_value ?? '',
      initial_value_map: x.initial_value_map ?? null,
    }));

    const tags = src.tags || [];
    const fd = new FormData();
    const put = (k, val) => fd.append(k, typeof val === 'string' ? val : JSON.stringify(val));

    put('title', title);
    put('name', title);
    put('short_intro', src.short_intro || '');
    put('type', src.type || 'simulation');
    put('prompt_type', src.prompt_type || 'custom');
    (src.default_model_tiers || []).forEach((t) => put('default_model_tiers', String(t)));
    put('gender', src.gender || 'other');
    put('publish_type', '3'); // 항상 비공개로 생성
    put('is_active', 'true');
    put('use_submodel', String(!!v.use_submodel));
    put('description', fix(src.description || ''));
    put('character_prompt', v.character_prompt || src.character_prompt || '');
    put('use_tier_prompts', String(!!v.use_tier_prompts));
    put('tier_prompts', v.tier_prompts || []);
    put('usage_guide', v.usage_guide || '');
    tags.forEach((t) => put('tags', t.id));
    put('tags_detail', tags.map((t) => pick(t, ['id', 'name', 'name_ko', 'name_en', 'is_non_removable'])));
    put('greetings', greetings);
    put('lorebooks', lorebooks);
    put('html_templates', templates);
    put('template_values', v.template_values_data || []);
    put('cast_members', cast);
    put('info_values', info);
    put('description_images_meta', []);
    put('profile_images_meta', []);
    put('image_source_urls', []);
    put('image_source_usage_types', []);
    put('draft_images', []);
    return fd;
  }

  // 생성 응답은 "data: {...}" 줄이 이어지는 진행 상황 스트림입니다.
  function readCreateResult(text) {
    let found = null;
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^data:\s*(.+)$/);
      if (!m) continue;
      try {
        const j = JSON.parse(m[1]);
        if (j.result && j.result.id) found = j.result;
        if (j.stage === 'error' || j.error) throw new Error(JSON.stringify(j));
      } catch (e) {
        if (e.message.startsWith('{')) throw e;
      }
    }
    if (found) return found;
    try {
      const j = JSON.parse(text);
      if (j.id) return j;
    } catch { /* 스트림도 JSON도 아님 */ }
    return null;
  }

  // ---------------------------------------------------------------------------
  // 3. 복사 실행
  // ---------------------------------------------------------------------------
  async function copyWork(srcId, say) {
    if (!Object.keys(auth.headers).length && !auth.withCredentials) {
      // 다른 창에 갔다 오면 젠잇이 알림 확인 요청을 보내므로 그때 인증 정보를 얻습니다.
      throw new Error('로그인 정보를 아직 읽지 못했습니다. 다른 탭에 잠깐 갔다가 돌아온 뒤 다시 눌러주세요.');
    }

    if (!auth.unsafe) {
      throw new Error('준비가 한 번 필요합니다.\n이 화면 아래의 "임시 저장" 버튼을 한 번 누른 뒤, 다시 "작품 복사"를 눌러주세요.\n(젠잇이 저장할 때 쓰는 헤더를 그때 읽어옵니다)');
    }

    say('원본 작품을 불러오는 중…');
    const res = await api(`/characters/${srcId}/?lang=ko`);
    if (!res.ok) throw new Error(`원본 불러오기 실패 (${res.status})\n${(await res.text()).slice(0, 300)}`);
    const src = await res.json();

    const title = prompt('새 작품 제목을 입력하세요. (비공개로 생성됩니다)', `${src.name} (복사)`);
    if (!title || !title.trim()) return null;

    const name = title.trim();

    // 세이프티/언세이프티는 생성 후 바꿀 수 없으므로 만들 때 고릅니다.
    const srcKind = src.is_adult ? '언세이프티' : '세이프티';
    const pickKind = prompt(`새 작품의 연령 설정을 고르세요. (원본: ${srcKind})\n1 = 세이프티\n2 = 언세이프티`, src.is_adult ? '1' : '2');
    if (pickKind === null) return null;
    if (!/^[12]$/.test(pickKind.trim())) throw new Error('1 또는 2를 입력해 주세요.');
    const adult = pickKind.trim() === '2';

    // 1단계: 화면의 "생성하기"가 보내는 것과 똑같은 형식으로 빈 비공개 작품을 만듭니다.
    say('새 작품을 만드는 중…');
    const cf = new FormData();
    const info = ((src.latest_version || {}).info_values || [])
      .filter((x) => x.codename === 'T' || x.codename === 'L')
      .map((x) => ({
        name: x.name, name_ko: x.name_ko, name_en: x.name_en, codename: x.codename,
        description: null, description_en: '', description_ko: null,
        is_character_variable: false, initial_value: '', initial_value_map: null,
      }));
    const fields = {
      name, name_ko: name, short_intro: '', usage_guide: '',
      html_templates: '[]', template_values: '[]', info_values: JSON.stringify(info),
      description_images_meta: '[]', profile_images_meta: '[]',
      character_prompt: '', tier_prompts: '[]', use_tier_prompts: 'false', use_submodel: 'false',
      type: src.type || 'simulation', prompt_type: src.prompt_type || 'custom',
      default_model_tiers: '[]', gender: src.gender || 'other',
      publish_type: '3', is_adult: String(adult), is_active: 'true',
    };
    Object.entries(fields).forEach(([k, val]) => cf.append(k, val));

    const created = await api('/characters/', { method: 'POST', body: cf, headers: { accept: 'text/event-stream' } });
    const body = await created.text();
    if (!created.ok) throw new Error(`생성 실패 (${created.status})\n${body.slice(0, 400)}\n\n[진단] 보낸 헤더 이름: ${Object.keys(auth.unsafe || {}).join(', ') || '없음'} / 쿠키 포함: ${auth.withCredentials}`);
    const made = readCreateResult(body);
    if (!made) throw new Error(`생성 응답에서 새 작품 ID를 찾지 못했습니다.\n${body.slice(0, 400)}`);

    // 2단계: 내용 전체를 새 작품의 임시 저장 1번에 넣습니다. (이미지 주소는 새 작품 ID로 교체)
    say('임시 저장에 내용을 넣는 중…');
    const fd = buildForm(src, name, made.id);
    fd.append('slot', '1');
    fd.append('is_adult', String(adult));
    const d = await api(`/characters/${made.id}/drafts/1/`, { method: 'PUT', body: fd });
    if (!d.ok) {
      throw new Error(`빈 작품은 만들어졌지만 임시 저장에 실패했습니다 (${d.status})\n${(await d.text()).slice(0, 300)}\n새 작품 ID: ${made.id}`);
    }
    const v = src.latest_version || {};
    return {
      id: made.id, title: name,
      lines: [
        `${made.is_adult === adult ? '✅' : '⚠️'} 연령 설정: 요청 ${adult ? '언세이프티' : '세이프티'} → 서버 ${made.is_adult ? '언세이프티' : '세이프티'}`,
        `설정집 ${(src.lorebooks || []).length} · 캐릭터 ${(v.cast_members || []).length} · 에셋 ${(v.html_templates || []).length} · 시작 상황 ${(v.greetings || []).length}`,
        '📝 내용은 새 작품의 임시 저장 1번에 들어 있습니다.',
        '새 작품 열기 → 임시 저장 목록에서 불러오기 → 저장',
      ],
    };
  }

  // ---------------------------------------------------------------------------
  // 4. 화면 버튼
  // ---------------------------------------------------------------------------
  let box = null;
  function ensureUi() {
    const m = location.pathname.match(EDIT_RE);
    if (!m) { if (box) box.style.display = 'none'; return; }
    if (!document.body) return;
    if (!box) {
      box = document.createElement('div');
      box.style.cssText = 'position:fixed;left:96px;bottom:20px;z-index:99999;font:14px/1.5 system-ui,sans-serif;max-width:340px;';
      box.innerHTML =
        '<div data-out style="display:none;margin-bottom:8px;padding:12px 14px;border-radius:10px;background:#111827;color:#e5e7eb;border:1px solid #374151;white-space:pre-wrap;word-break:break-all;"></div>' +
        '<button data-btn style="padding:10px 16px;border:0;border-radius:10px;background:#14b8a6;color:#fff;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.4);">📋 작품 복사</button>';
      document.body.appendChild(box);
      const btn = box.querySelector('[data-btn]');
      const out = box.querySelector('[data-out]');
      const say = (t) => { out.style.display = 'block'; out.textContent = t; };
      btn.addEventListener('click', async () => {
        const id = (location.pathname.match(EDIT_RE) || [])[1];
        if (!id || btn.disabled) return;
        btn.disabled = true; btn.style.opacity = '.6';
        try {
          const r = await copyWork(id, say);
          if (!r) { out.style.display = 'none'; return; }
          out.textContent = `"${r.title}" 생성 완료\n${r.lines.join('\n')}\n\n이미지·표지·장르는 직접 넣어주세요.\n`;
          const a = document.createElement('a');
          a.href = `/ko/contents/${r.id}/edit`;
          a.target = '_blank';
          a.textContent = '→ 새 작품 수정 화면 열기';
          a.style.cssText = 'color:#5eead4;font-weight:700;';
          out.appendChild(a);
        } catch (e) {
          say(`❌ ${e.message}`);
        } finally {
          btn.disabled = false; btn.style.opacity = '1';
        }
      });
    }
    box.style.display = 'block';
  }
  setInterval(ensureUi, 800);
})();
