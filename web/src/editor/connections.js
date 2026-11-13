// The editor's "Подключения": the smart home platforms House Control can link the plan's
// lamps and ACs to (Smart Life, Home Assistant, Philips Hue, Apple Home), the screens that
// connect each one, and the pickers that link a lamp or an AC to one of their devices.
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { isNative, call } from '../bridge.js';
import { SERVICES, linkOf } from '../config.js';

const ORDER = ['smartlife', 'homeassistant', 'hue', 'homekit'];
const LOOK = {
  smartlife: { icon: 'plug', tint: '#ff7a3d', blurb: 'Tuya, Smart Life and the many brands built on them' },
  homeassistant: { icon: 'homeassistant', tint: '#18bcf2', blurb: 'Всё, что в нём есть: Zigbee, Matter, Xiaomi, Tuya…' },
  hue: { icon: 'bulb', tint: '#c38bff', blurb: 'A Hue Bridge on this network. No account needed' },
  homekit: { icon: 'home', tint: '#ffb340', blurb: 'HomeKit and Matter accessories, through your iPhone' },
};
const KIND_TITLES = { light: 'Свет, розетки и выключатели', ac: 'Климат', sensor: 'Датчики температуры' };

export function createConnections({ rerender, toast, usedBy, onOpen }) {
  const boot = window.__HOUSE_BOOT__ || {};
  const state = {
    info: boot.services || {},
    devices: null,
    errors: {},
    loading: false,
    found: {},       // service -> discovered servers / bridges
    scanning: {},
    pairing: null,   // { host, until } while waiting for the Hue button
  };

  // The platforms this app offers: the native side lists them (the iPhone's App Store
  // edition has no Smart Life). A plain browser shows them all.
  const offered = () => (isNative && boot.services ? ORDER.filter((id) => id in state.info) : ORDER);
  const connected = (id) => Boolean(state.info[id]?.connected);
  const anyConnected = () => offered().some(connected);
  const devicesOf = (id) => (state.devices || []).filter((d) => d.service === id);

  async function refreshInfo() {
    if (!isNative) return;
    try { state.info = await call('services.info'); } catch { /* keep what we had */ }
  }

  async function load({ quiet = false } = {}) {
    if (!isNative || !anyConnected()) { state.devices = null; rerender(); return; }
    state.loading = true;
    if (!quiet) rerender();
    try {
      const r = await call('devices.all');
      state.devices = r.devices;
      state.errors = r.errors || {};
    } catch (e) {
      state.errors = { all: e.message };
    }
    state.loading = false;
    rerender();
  }

  // The Mac pushes this when the paired iPhone sent its Apple Home devices.
  window.house = window.house || {};
  window.house.servicesChanged = (info) => { state.info = info; load({ quiet: true }); };

  /* ---------- sidebar ---------- */

  function sidebarRow(active, select) {
    const n = offered().filter(connected).length;
    return h(`button.row.tuya-row${active ? '.active' : ''}`, { onclick: select },
      icon('link', 15), h('span.row-name', 'Подключения'),
      h(`span.pill${n ? '.on' : ''}`, n ? `подключено: ${n}` : 'Демо'));
  }

  /* ---------- overview ---------- */

  function tile(id, size = 34) {
    return h('span.svc-tile', { vars: { '--tint': LOOK[id].tint, '--size': `${size}px` } }, icon(LOOK[id].icon, Math.round(size * 0.52), 2));
  }

  function statusText(id) {
    const info = state.info[id] || {};
    if (id === 'homekit' && info.remote) {
      return info.connected ? `${info.count} devices from ${info.from || 'your iPhone'}` : 'Set up on your iPhone';
    }
    if (!info.connected) return 'Не подключено';
    const count = devicesOf(id).length;
    const name = id === 'homeassistant' ? info.name : id === 'hue' ? info.name : id === 'smartlife' ? info.account : '';
    return [name, state.devices ? `устройств: ${count}` : null].filter(Boolean).join(' · ') || 'Подключено';
  }

  function overview() {
    if (anyConnected() && !state.devices && !state.loading) setTimeout(() => load(), 0);
    return [
      h('div.svc-cards', offered().map((id) => h('button.svc-card', { onclick: () => onOpen(id) },
        tile(id),
        h('div.svc-text', h('b', SERVICES[id].name), h('span', LOOK[id].blurb)),
        h(`span.svc-status${connected(id) ? '.on' : ''}`, connected(id) ? icon('ok', 13, 2.4) : null, statusText(id)),
        icon('next', 16)))),
      h('p.note', 'Светильники и климат остаются условными, пока не привязаны: выберите объект на плане и укажите устройство в разделе «Устройство».'),
      isNative ? null : h('p.note.bad', 'Connecting works inside the House Control app (this is the browser preview).'),
    ];
  }

  /* ---------- shared pieces ---------- */

  const section = (title, ...nodes) => h('section.block', h('h3', title), nodes);

  function deviceList(id) {
    if (state.loading) return h('p.note.busy', icon('spinner', 13), 'Запрашиваю устройства…');
    if (state.errors[id]) return h('p.note.bad', state.errors[id]);
    const list = devicesOf(id);
    if (!state.devices) return null;
    if (!list.length) return h('p.note', 'Подключено, но светильников, климата и датчиков температуры не найдено.');
    const used = usedBy();
    const groups = ['light', 'ac', 'sensor'].map((kind) => [kind, list.filter((d) => d.kind === kind)]).filter(([, l]) => l.length);
    return h('div.devices-list', groups.map(([kind, items]) => [
      h('h3', `${KIND_TITLES[kind]} · ${items.length}`),
      items.map((d) => h('div.device',
        h(`span.dot${d.online ? '.on' : ''}`, { title: d.online ? 'В сети' : 'Не в сети' }),
        h('div', h('b', d.name), h('span', [d.room, d.detail].filter(Boolean).join(' · ') || d.id)),
        used.get(`${d.service}|${d.id}`) ? h('span.pill.on', used.get(`${d.service}|${d.id}`)) : null)),
    ]));
  }

  function connectedHeader(id, title, name, line) {
    return section(title,
      h('div.device', h('span.dot.on'), h('div', h('b', name), h('span', line))),
      h('div.fields',
        h('button.btn', { onclick: () => load() }, 'Refresh devices'),
        h('button.btn', { onclick: () => disconnect(id) }, 'Отключить')));
  }

  async function disconnect(id) {
    try {
      state.info = await call('service.disconnect', { service: id });
      state.devices = state.devices?.filter((d) => d.service !== id) ?? null;
      toast(`${SERVICES[id].name} disconnected`);
    } catch (e) { toast(e.message, true); }
    rerender();
  }

  async function scan(id) {
    if (!isNative || state.scanning[id]) return;
    state.scanning[id] = true;
    rerender();
    try {
      state.found[id] = (await call('services.discover', { service: id })).found;
    } catch { state.found[id] = []; }
    state.scanning[id] = false;
    rerender();
  }

  /* ---------- Home Assistant ---------- */

  const ha = { url: '', token: '', error: null, busy: false };

  function homeAssistant() {
    const info = state.info.homeassistant || {};
    if (info.connected) {
      if (!state.devices && !state.loading) setTimeout(() => load(), 0);
      return [connectedHeader('homeassistant', 'Сервер', info.name, [info.url, info.version && `version ${info.version}`].filter(Boolean).join(' · ')),
        deviceList('homeassistant')];
    }
    if (!state.found.homeassistant && !state.scanning.homeassistant) setTimeout(() => scan('homeassistant'), 0);
    const url = h('input', { type: 'url', spellcheck: 'false', placeholder: 'http://homeassistant.local:8123', value: ha.url });
    const token = h('input', { type: 'password', autocomplete: 'off', placeholder: 'Long-lived access token', value: ha.token });
    const ready = () => isNative && !ha.busy && ha.url.trim() && ha.token.trim();
    url.addEventListener('input', () => { ha.url = url.value; button.disabled = !ready(); });
    token.addEventListener('input', () => { ha.token = token.value; button.disabled = !ready(); });
    const connect = async () => {
      ha.busy = true; ha.error = null; rerender();
      try {
        state.info = await call('homeassistant.connect', { url: ha.url, token: ha.token });
        ha.token = '';
        toast(`Connected to ${state.info.homeassistant?.name || 'Home Assistant'}`);
        await load();
      } catch (e) { ha.error = e.message; }
      ha.busy = false;
      rerender();
    };
    const button = h('button.btn.primary.wide', { onclick: connect, disabled: !ready() }, ha.busy ? 'Connecting…' : 'Connect');
    const found = state.found.homeassistant || [];
    return [
      section('On your network',
        state.scanning.homeassistant ? h('p.note.busy', icon('spinner', 13), 'Looking for Home Assistant…')
          : found.length ? found.map((s) => h('div.device',
            h('span.dot.on'), h('div', h('b', s.name), h('span', [s.url, s.version && `version ${s.version}`].filter(Boolean).join(' · '))),
            h('button.btn', { onclick: () => { ha.url = s.url; rerender(); } }, ha.url === s.url ? 'Selected' : 'Use')))
            : h('p.note', 'None found by itself. Type its address below.'),
        state.scanning.homeassistant ? null : h('button.btn.link', { onclick: () => scan('homeassistant') }, icon('radar', 13), 'Look again')),
      section('Connect',
        h('label.field', h('span', 'Address'), url),
        h('label.field', h('span', 'Access token'), token),
        h('ol.steps',
          h('li', 'In Home Assistant, open your profile (your name at the bottom left) → Security.'),
          h('li', 'Under “Long-lived access tokens” press Create token, name it “House Control”, copy it here.')),
        button,
        ha.error ? h('p.note.bad', ha.error) : null,
        h('p.note', 'The token stays on this Mac (and goes to the iPhones you paired, over their encrypted link). Lights, switches, climate devices and temperature sensors appear here.')),
    ];
  }

  /* ---------- Philips Hue ---------- */

  let pairTimer = 0;
  function stopPairing() { clearInterval(pairTimer); pairTimer = 0; state.pairing = null; }

  function pairHue(bridge) {
    stopPairing();
    state.pairing = { ...bridge, until: Date.now() + 60_000, error: null };
    const attempt = async () => {
      if (!state.pairing) return;
      if (Date.now() > state.pairing.until) {
        state.pairing.error = 'Nobody pressed the button in time. Try again.';
        clearInterval(pairTimer);
        rerender();
        return;
      }
      try {
        const r = await call('hue.pair', { host: bridge.host, bridgeId: bridge.bridgeId, name: bridge.name });
        if (r.waiting) { rerender(); return; }
        stopPairing();
        state.info = r;
        toast(`Paired with ${state.info.hue?.name || 'the Hue Bridge'}`);
        await load();
      } catch (e) {
        if (state.pairing) state.pairing.error = e.message;
        clearInterval(pairTimer);
      }
      rerender();
    };
    attempt();
    pairTimer = setInterval(attempt, 2000);
    rerender();
  }

  const hueManual = { host: '' };

  function hue() {
    const info = state.info.hue || {};
    if (info.connected) {
      if (!state.devices && !state.loading) setTimeout(() => load(), 0);
      return [connectedHeader('hue', 'Bridge', info.name, [info.host, info.bridgeId].filter(Boolean).join(' · ')),
        deviceList('hue')];
    }
    if (state.pairing) {
      const left = Math.max(0, Math.ceil((state.pairing.until - Date.now()) / 1000));
      return [section('Pairing',
        h('div.press',
          h('div.press-button', h('span')),
          h('div', h('b', 'Press the round button on the bridge'), h('span', state.pairing.error || `${state.pairing.name || state.pairing.host} · waiting ${left} s`))),
        h('div.fields',
          state.pairing.error ? h('button.btn', { onclick: () => pairHue(state.pairing) }, 'Try again') : null,
          h('button.btn', { onclick: () => { stopPairing(); rerender(); } }, 'Отмена')),
        h('p.note', 'The big button on top of the Hue Bridge lets one app in for 30 seconds. House Control keeps the key it gets, on this Mac.'))];
    }
    if (!state.found.hue && !state.scanning.hue) setTimeout(() => scan('hue'), 0);
    const found = state.found.hue || [];
    const host = h('input', { type: 'text', spellcheck: 'false', placeholder: 'e.g. 192.168.1.20', value: hueManual.host });
    const pairButton = h('button.btn.wide', { onclick: () => pairHue({ host: hueManual.host.trim(), name: 'Hue Bridge' }), disabled: !isNative || !hueManual.host.trim() }, 'Pair');
    host.addEventListener('input', () => { hueManual.host = host.value; pairButton.disabled = !isNative || !host.value.trim(); });
    return [
      section('On your network',
        state.scanning.hue ? h('p.note.busy', icon('spinner', 13), 'Looking for Hue Bridges…')
          : found.length ? found.map((b) => h('div.device',
            h('span.dot.on'), h('div', h('b', b.name), h('span', [b.host, b.bridgeId].filter(Boolean).join(' · '))),
            h('button.btn.primary', { onclick: () => pairHue(b), disabled: !isNative }, 'Pair')))
            : h('p.note', 'No bridge found by itself. Type its address below (the Hue app shows it under Settings → My Hue system).'),
        state.scanning.hue ? null : h('button.btn.link', { onclick: () => scan('hue') }, icon('radar', 13), 'Look again')),
      section('Or by address',
        h('label.field', h('span', 'Bridge address'), host),
        pairButton),
    ];
  }

  /* ---------- Apple Home ---------- */

  function homeKit() {
    const info = state.info.homekit || {};
    const nodes = [];
    if (info.connected) {
      if (!state.devices && !state.loading) setTimeout(() => load(), 0);
      const when = info.updated ? new Date(info.updated * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
      nodes.push(section('From your iPhone',
        h('div.device', h('span.dot.on'), h('div', h('b', info.from || 'iPhone'), h('span', `${info.count} devices · sent ${when}`))),
        h('div.fields', h('button.btn', { onclick: () => disconnect('homekit') }, 'Forget this list'))),
      deviceList('homekit'));
    }
    nodes.push(section(info.connected ? 'Как это работает' : 'Set it up on your iPhone',
      h('ol.steps',
        h('li', 'Pair your iPhone with this Mac: right-click the menu bar icon → Pair Phone….'),
        h('li', 'On the iPhone: House Control → Settings → Apple Home → Connect, and allow access to your Home data.'),
        h('li', 'Its lamps, air conditioners and thermometers appear here. Link them like any other device.')),
      h('p.note', 'Apple lets only iPhone, iPad and App Store apps use HomeKit, so the iPhone app switches these devices. On the Mac they show what you set, but stay simulated.')));
    return nodes;
  }

  /* ---------- detail screen ---------- */

  function detail(id, smartLifePanel) {
    if (id === 'smartlife') return smartLifePanel();
    if (id === 'homeassistant') return homeAssistant();
    if (id === 'hue') return hue();
    return homeKit();
  }

  /* ---------- linking a lamp or an AC ---------- */

  function optionLabel(d) {
    return `${d.name}${d.room ? ` — ${d.room}` : ''}${d.online ? '' : ' (не в сети)'}`;
  }

  function picker(kind, current, include = () => true) {
    const select = h('select');
    select.append(h('option', { value: '' }, kind === 'sensor' ? 'Нет — оценка' : 'Не привязано — условное'));
    let found = false;
    for (const id of offered()) {
      const list = devicesOf(id).filter((d) => d.kind === kind && include(d));
      if (!list.length) continue;
      select.append(h('optgroup', { label: SERVICES[id].name }, list.map((d) => {
        const value = `${d.service}|${d.id}`;
        if (value === current) found = true;
        return h('option', { value }, optionLabel(d));
      })));
    }
    if (current && !found) {
      const [service, id] = current.split('|');
      select.append(h('option', { value: current }, `${SERVICES[service]?.short || service}: ${id} (сейчас не найдено)`));
    }
    select.value = current;
    return select;
  }

  const find = (value) => (state.devices || []).find((d) => `${d.service}|${d.id}` === value);

  /** The "Устройство" section of a lamp or an AC. `onLinked(device)` adapts the item. */
  function deviceSection(item, kind, { snapshot, changed }) {
    const link = linkOf(item);
    const current = link ? `${link.service}|${link.id}` : '';
    if (!anyConnected()) {
      return section('Устройство',
        h('p.note', 'Условное. Подключите платформу, чтобы управлять настоящим устройством.'),
        h('button.btn.wide', { onclick: () => onOpen(null) }, icon('link', 14), 'Открыть подключения'));
    }
    if (!state.devices && !state.loading) setTimeout(() => load({ quiet: true }), 0);
    const select = picker(kind, current);
    select.addEventListener('change', () => {
      snapshot();
      const value = select.value;
      delete item.link;
      if (item.tuya) { delete item.tuya.deviceId; if (!Object.keys(item.tuya).length) delete item.tuya; }
      const device = find(value);
      if (value) {
        const [service, id] = value.split('|');
        if (service === 'smartlife') item.tuya = { ...(item.tuya || {}), deviceId: id };
        else item.link = { service, id };
        // Smart Life sensors only work beside a Smart Life AC.
        if (service !== 'smartlife' && item.tuya) delete item.tuya;
      }
      let note = null;
      if (device && kind === 'light' && device.capabilities) {
        item.capabilities = [...device.capabilities];
        note = device.capabilities.length ? `Возможности взяты с устройства: ${device.capabilities.join(', ').replace('brightness', 'яркость').replace('temp', 'температура белого').replace('color', 'цвет')}` : 'Определено: простой выключатель';
      }
      if (device && kind === 'ac' && device.min != null) { item.min = Math.round(device.min); item.max = Math.round(device.max); }
      changed(note);
    });
    const device = find(current);
    const info = device ? [SERVICES[device.service].name, device.detail, device.room].filter(Boolean).join(' · ')
      : current && state.devices ? 'Сейчас это устройство не найдено.'
        : state.loading ? 'Загружаю устройства…' : '';
    const offline = device && !device.online;
    return section('Устройство',
      h('label.field', h('span', 'Устройство'), select),
      info ? h(`p.note${offline ? '.bad' : ''}`, offline ? `${info} · не в сети` : info) : null,
      device?.service === 'homekit' && state.info.homekit?.remote ? h('p.note', 'Switched from your iPhone; simulated on this Mac.') : null,
      Object.keys(state.errors).length ? h('p.note.bad', Object.entries(state.errors).map(([s, e]) => `${SERVICES[s]?.name || s}: ${e}`).join(' · ')) : null);
  }

  /** An AC's thermometer: any platform's sensor (a Smart Life one only beside a Smart Life AC). */
  function sensorSection(item, { snapshot, changed }) {
    const link = linkOf(item);
    const current = item.sensor?.id ? `${item.sensor.service}|${item.sensor.id}`
      : item.tuya?.sensorId ? `smartlife|${item.tuya.sensorId}` : '';
    const select = picker('sensor', current, (d) => d.service !== 'smartlife' || link?.service === 'smartlife');
    select.addEventListener('change', () => {
      snapshot();
      delete item.sensor;
      if (item.tuya) delete item.tuya.sensorId;
      const [service, id] = select.value ? select.value.split('|') : [];
      if (service === 'smartlife') item.tuya = { ...(item.tuya || {}), sensorId: id };
      else if (service) item.sensor = { service, id };
      changed();
    });
    return section('Температура в комнате',
      h('label.field', h('span', 'Термометр'), select),
      h('p.note', 'Датчик температуры в той же комнате. Без него берутся показания самого устройства или оценка.'));
  }

  /**
   * A plain entity of the connected platform that the plan only reads (a room's thermometer, the
   * weather): a picker of the devices of that kind. `onPick(id)` gets the entity id, or '' for none.
   */
  function entityField(label, kind, currentId, onPick, none = 'Нет') {
    if (!state.devices && !state.loading && anyConnected()) setTimeout(() => load({ quiet: true }), 0);
    const select = h('select');
    select.append(h('option', { value: '' }, none));
    let found = false;
    for (const d of (state.devices || []).filter((x) => x.kind === kind)) {
      if (d.id === currentId) found = true;
      select.append(h('option', { value: d.id }, optionLabel(d)));
    }
    if (currentId && !found) select.append(h('option', { value: currentId }, currentId));
    select.value = currentId || '';
    select.addEventListener('change', () => onPick(select.value));
    return h('label.field', h('span', label), select);
  }

  /** "id → plan item name" for every device the plan links, to mark them in the lists. */
  function usedMap(doc) {
    const out = new Map();
    for (const d of [...doc.lights, ...doc.acs]) {
      const l = linkOf(d);
      if (l) out.set(`${l.service}|${l.id}`, d.name || d.id);
      if (d.sensor?.id) out.set(`${d.sensor.service}|${d.sensor.id}`, `${d.name || d.id} · комната`);
      if (d.tuya?.sensorId) out.set(`smartlife|${d.tuya.sensorId}`, `${d.name || d.id} · комната`);
    }
    return out;
  }

  return {
    state, load, refreshInfo, sidebarRow, overview, detail, tile, deviceSection, sensorSection, entityField, usedMap,
    connected, stopPairing,
    title: (id) => SERVICES[id]?.name,
    blurb: (id) => LOOK[id]?.blurb,
  };
}
