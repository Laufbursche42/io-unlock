'use strict';
/*
 * Laufbursche IO HAWK Tool - general Web Bluetooth frontend for the Tuya BLE Secure protocol.
 * Connects any Tuya IO HAWK model, shows per-model telemetry + settings + advanced settings, and
 * keeps a full lb-tool-web-style protocol log. Every protocol building block is proven from the
 * decompiled Tuya SDK of the IO HAWK app. The page speaks only locally over Bluetooth; nothing
 * goes to any server. Numeric dpIds, value ranges and scaling are cloud-provisioned (Tuya
 * SchemaBean) and per-device localKey is cloud-side, so both are user-supplied and gated - never
 * invented here.
 */

const BUILD = 'v2';
const $ = (id) => document.getElementById(id);

const LS = {
  theme: 'iohawk_theme', lang: 'iohawk_lang', lk: 'iohawk_localkey', model: 'iohawk_model',
  schema: 'iohawk_schema', publicLog: 'iohawk_publiclog',
  dpid: 'iohawk_dpid', mdpid: 'iohawk_mode_dpid', m1: 'iohawk_m1', m2: 'iohawk_m2', m3: 'iohawk_m3'
};

// --------------------------- GATT profile (proven: TuyaUUIDs.java / dbpbdpb.java) ---------------------------
// Per device the app uses EITHER the 0x1910 profile OR the alt SIG 0xfd50 profile; wire both.
const TUYA = { service: 0x1910, write: 0x2b11, notify: 0x2b10 };
const uuid16 = (x) => '0000' + x.toString(16).padStart(4, '0') + '-0000-1000-8000-00805f9b34fb';
const ALT = {
  service: uuid16(0xfd50),
  write: '00000001-0000-1001-8001-00805f9b07d0',
  notify: '00000002-0000-1001-8001-00805f9b07d0'
};

// --------------------------- byte helpers ---------------------------
function hex(bytes) { return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' '); }
function hexToBytes(s) {
  const clean = (s || '').replace(/0x/gi, '').replace(/[^0-9a-fA-F]/g, '');
  if (clean.length % 2 !== 0) throw new Error('hex length odd');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
function strToBytes(s) { return new TextEncoder().encode(s); }
function concatBytes() {
  const arrs = Array.prototype.slice.call(arguments);
  let n = 0; arrs.forEach((a) => n += a.length);
  const out = new Uint8Array(n); let o = 0;
  arrs.forEach((a) => { out.set(a, o); o += a.length; });
  return out;
}

// --------------------------- state ---------------------------
const state = {
  lang: 'de',
  publicLog: true,   // anonymize on the way out (default on)
  diag: false,       // raw-frame decode + extra taps (off each session)
  logBuffer: [],     // { raw, cls }; raw keeps \x01 sentinels, anonymized on display/copy/save
  model: 'auto',
  schema: {},        // code -> { dpId, type?, pv? }  (user-supplied; nothing invented)
  connected: false,
  deviceId: '',
  tileEls: {}        // code -> value element, for live updates
};

// --------------------------- log + redaction (lb-tool-web style; copy/save use the same text) ---------------------------
function ts() { return new Date().toISOString().slice(11, 19); }   // HH:MM:SS
function redact(text) {
  let s = String(text);
  if (state.deviceId) s = s.split(state.deviceId).join('[redacted-id]');
  s = s.replace(/\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g, '[redacted-mac]');
  s = s.replace(/\b(secret|token|key|aes|localkey|pwd|password|pin|mac|serial|srand|uid|imei)\b(\s*[:=]\s*)("?)([^\s",]+)\3/gi,
    function (m, k, sep) { return k + sep + '[redacted]'; });
  s = s.replace(/\b[0-9A-Fa-f]{16,}\b/g, '[redacted-hex]');
  return s;
}
// Mask driver-marked sensitive spans (\x01..\x01) + generic redaction, but only when Public Log is on.
function anonymize(s) {
  if (state.publicLog === false) return s.replace(/\x01/g, '');
  return redact(s.replace(/\x01[^\x01]*\x01/g, 'XX').replace(/\x01/g, ''));
}
function log(msg, cls) {
  const raw = '[' + ts() + '] ' + msg;
  state.logBuffer.push({ raw: raw, cls: cls || '' });
  const pre = $('log');
  if (pre) {
    const span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = anonymize(raw) + '\n';
    pre.appendChild(span);
    pre.scrollTop = pre.scrollHeight;
  }
}
function renderLog() {
  const pre = $('log'); if (!pre) return;
  pre.textContent = '';
  state.logBuffer.forEach((e) => {
    const span = document.createElement('span');
    if (e.cls) span.className = e.cls;
    span.textContent = anonymize(e.raw) + '\n';
    pre.appendChild(span);
  });
  pre.scrollTop = pre.scrollHeight;
}
function logHeader() {
  const nav = (typeof navigator !== 'undefined') ? navigator : {};
  log('=== io-unlock diagnostic ===');
  log('build: ' + BUILD);
  log('webBluetooth: ' + (nav.bluetooth ? 'yes' : 'no'));
  log('speechSynthesis: ' + ((typeof speechSynthesis !== 'undefined') ? 'yes' : 'no'));
  log('============================');
}
function clearLog() { state.logBuffer = []; const pre = $('log'); if (pre) pre.textContent = ''; logHeader(); log('log cleared'); }
async function copyLog() {
  const text = state.logBuffer.map((e) => anonymize(e.raw)).join('\n');
  let ok = false;
  try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); ok = true; } } catch (e) { ok = false; }
  if (!ok) {
    try {
      const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.top = '-1000px'; document.body.appendChild(ta);
      ta.select(); ta.setSelectionRange(0, text.length); ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (e) { ok = false; }
  }
  log(ok ? 'log copied (' + state.logBuffer.length + ' lines)' : 'log copy failed', ok ? 'log-ok' : 'log-err');
}
function saveLog() {
  const text = state.logBuffer.map((e) => anonymize(e.raw)).join('\n');
  try {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'io-unlock-log.txt';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => { URL.revokeObjectURL(url); }, 1000);
    log('log saved', 'log-ok');
  } catch (e) { log('save failed: ' + e.message, 'log-err'); }
}

// --------------------------- MD5 (secretKey5 = MD5(localKey || srand)) ---------------------------
function md5(bytes) {
  const rol = (x, c) => (x << c) | (x >>> (32 - c));
  const add = (a, b) => (a + b) | 0;
  const s = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22, 5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
             4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23, 6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  const K = new Int32Array(64);
  for (let i = 0; i < 64; i++) K[i] = (Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296)) | 0;
  const ml = bytes.length, padLen = ((ml + 1 + 8 + 63) & ~63);
  const buf = new Uint8Array(padLen); buf.set(bytes); buf[ml] = 0x80;
  const bitLen = ml * 8;
  buf[padLen - 8] = bitLen & 0xff; buf[padLen - 7] = (bitLen >>> 8) & 0xff;
  buf[padLen - 6] = (bitLen >>> 16) & 0xff; buf[padLen - 5] = (bitLen >>> 24) & 0xff;
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const M = new Int32Array(16);
  for (let off = 0; off < padLen; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = buf[off+i*4] | (buf[off+i*4+1]<<8) | (buf[off+i*4+2]<<16) | (buf[off+i*4+3]<<24);
    let A=a0,B=b0,C=c0,D=d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i<16){F=(B&C)|(~B&D);g=i;} else if(i<32){F=(D&B)|(~D&C);g=(5*i+1)&15;}
      else if(i<48){F=B^C^D;g=(3*i+5)&15;} else {F=C^(B|~D);g=(7*i)&15;}
      F=add(add(add(F,A),K[i]),M[g]); A=D;D=C;C=B;B=add(B,rol(F,s[i]));
    }
    a0=add(a0,A);b0=add(b0,B);c0=add(c0,C);d0=add(d0,D);
  }
  const out = new Uint8Array(16);
  [a0,b0,c0,d0].forEach((v,i)=>{out[i*4]=v&0xff;out[i*4+1]=(v>>>8)&0xff;out[i*4+2]=(v>>>16)&0xff;out[i*4+3]=(v>>>24)&0xff;});
  return out;
}

// --------------------------- AES-128 (DP channel: AES/ECB) ---------------------------
const AES = (function () {
  const sbox = new Uint8Array(256), inv = new Uint8Array(256);
  (function () {
    let p = 1, q = 1;
    do {
      p = p ^ ((p << 1) & 0xff) ^ ((p & 0x80) ? 0x1b : 0);
      q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xff; if (q & 0x80) q ^= 0x09;
      sbox[p] = (q ^ ((q<<1)|(q>>>7)) ^ ((q<<2)|(q>>>6)) ^ ((q<<3)|(q>>>5)) ^ ((q<<4)|(q>>>4)) ^ 0x63) & 0xff;
    } while (p !== 1);
    sbox[0] = 0x63;
    for (let i = 0; i < 256; i++) inv[sbox[i]] = i;
  })();
  const xt = (a) => ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff;
  function expand(key) {
    const w = new Uint8Array(176); w.set(key.subarray(0, 16));
    const rcon = [0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36];
    let n = 16, r = 0; const t = new Uint8Array(4);
    while (n < 176) {
      for (let i = 0; i < 4; i++) t[i] = w[n-4+i];
      if (n % 16 === 0) { const tmp=t[0]; t[0]=sbox[t[1]]^rcon[r++]; t[1]=sbox[t[2]]; t[2]=sbox[t[3]]; t[3]=sbox[tmp]; }
      for (let i = 0; i < 4; i++) { w[n] = w[n-16] ^ t[i]; n++; }
    }
    return w;
  }
  function encBlock(inp, w) {
    const st = new Uint8Array(inp.subarray(0, 16));
    const ark = (o) => { for (let i=0;i<16;i++) st[i]^=w[o+i]; };
    const sub = () => { for (let i=0;i<16;i++) st[i]=sbox[st[i]]; };
    const shift = () => { const t=st.slice();
      st[1]=t[5];st[5]=t[9];st[9]=t[13];st[13]=t[1];
      st[2]=t[10];st[6]=t[14];st[10]=t[2];st[14]=t[6];
      st[3]=t[15];st[7]=t[3];st[11]=t[7];st[15]=t[11]; };
    const mix = () => { for (let c=0;c<4;c++){const i=c*4,a0=st[i],a1=st[i+1],a2=st[i+2],a3=st[i+3];
      st[i]=xt(a0)^(xt(a1)^a1)^a2^a3; st[i+1]=a0^xt(a1)^(xt(a2)^a2)^a3;
      st[i+2]=a0^a1^xt(a2)^(xt(a3)^a3); st[i+3]=(xt(a0)^a0)^a1^a2^xt(a3);} };
    ark(0);
    for (let round=1; round<10; round++){ sub(); shift(); mix(); ark(round*16); }
    sub(); shift(); ark(160);
    return st;
  }
  function decBlock(inp, w) {
    const isbox = inv;
    const st = new Uint8Array(inp.subarray(0, 16));
    const ark = (o) => { for (let i=0;i<16;i++) st[i]^=w[o+i]; };
    const invSub = () => { for (let i=0;i<16;i++) st[i]=isbox[st[i]]; };
    const invShift = () => { const t=st.slice();
      st[1]=t[13];st[5]=t[1];st[9]=t[5];st[13]=t[9];
      st[2]=t[10];st[6]=t[14];st[10]=t[2];st[14]=t[6];
      st[3]=t[7];st[7]=t[11];st[11]=t[15];st[15]=t[3]; };
    const mul = (a,b) => { let r=0; for (let i=0;i<8;i++){ if(b&1) r^=a; const hi=a&0x80; a=(a<<1)&0xff; if(hi) a^=0x1b; b>>=1; } return r&0xff; };
    const invMix = () => { for (let c=0;c<4;c++){const i=c*4,a0=st[i],a1=st[i+1],a2=st[i+2],a3=st[i+3];
      st[i]=mul(a0,14)^mul(a1,11)^mul(a2,13)^mul(a3,9);
      st[i+1]=mul(a0,9)^mul(a1,14)^mul(a2,11)^mul(a3,13);
      st[i+2]=mul(a0,13)^mul(a1,9)^mul(a2,14)^mul(a3,11);
      st[i+3]=mul(a0,11)^mul(a1,13)^mul(a2,9)^mul(a3,14);} };
    ark(160);
    for (let round=9; round>0; round--){ invShift(); invSub(); ark(round*16); invMix(); }
    invShift(); invSub(); ark(0);
    return st;
  }
  function pad(data) { const p = 16 - (data.length % 16); const out = new Uint8Array(data.length + p); out.set(data); out.fill(p, data.length); return out; }
  return {
    encryptEcb(data, key, doPad) {
      const w = expand(key); const src = doPad ? pad(data) : data;
      if (src.length % 16 !== 0) throw new Error('ECB length');
      const out = new Uint8Array(src.length);
      for (let o = 0; o < src.length; o += 16) out.set(encBlock(src.subarray(o, o+16), w), o);
      return out;
    },
    decryptEcb(data, key) {
      const w = expand(key);
      if (data.length % 16 !== 0) throw new Error('ECB length');
      const out = new Uint8Array(data.length);
      for (let o = 0; o < data.length; o += 16) out.set(decBlock(data.subarray(o, o+16), w), o);
      return out;
    },
    encryptBlockRaw(block, key) { return encBlock(block, expand(key)); }
  };
})();

// --------------------------- CRC-16/MODBUS, varint, DP ---------------------------
function crc16Modbus(bytes) {
  let crc = 0xffff;
  for (let i = 0; i < bytes.length; i++) { crc ^= bytes[i]; for (let b=0;b<8;b++){ if (crc&1) crc=(crc>>>1)^0xa001; else crc>>>=1; } }
  return crc & 0xffff;
}
function varint(n) { const out=[]; do { let b=n&0x7f; n>>>=7; if(n) b|=0x80; out.push(b);} while(n); return new Uint8Array(out); }
function readVarint(bytes, pos) {
  let shift = 0, result = 0, i = pos;
  while (i < bytes.length) {
    const b = bytes[i++]; result |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return [result >>> 0, i];
    shift += 7;
  }
  return [result >>> 0, i];
}

const DP_TYPE = { raw: 0, bool: 1, value: 2, string: 3, enum: 4 };
const DP_TYPE_NAME = { 0: 'raw', 1: 'bool', 2: 'value', 3: 'string', 4: 'enum' };
function encodeDp(dpId, dpType, value, pv) {
  let val;
  if (dpType === DP_TYPE.value) { const v = value>>>0; val = new Uint8Array([(v>>>24)&0xff,(v>>>16)&0xff,(v>>>8)&0xff,v&0xff]); }
  else if (dpType === DP_TYPE.enum || dpType === DP_TYPE.bool) { val = new Uint8Array([value & 0xff]); }
  else if (dpType === DP_TYPE.string) { val = strToBytes(String(value)); }
  else { val = hexToBytes(String(value)); }
  let lenField;
  if (pv === 4) lenField = new Uint8Array([(val.length>>>8)&0xff, val.length&0xff]);
  else lenField = new Uint8Array([val.length & 0xff]);
  return concatBytes(new Uint8Array([dpId & 0xff, dpType & 0xff]), lenField, val);
}

const CMD_DPS = 2;
const CMD_DEVICE_INFO = 0;
const CMD_DEVICE_STATUS = 3;
const CMD_FUN_RECEIVE_DP = 0x8001;
let seqCounter = 1;
function buildInnerFrame(seq, cmd, flag, data) {
  const head = new Uint8Array([(seq>>>8)&0xff, seq&0xff, cmd&0xff, flag&0xff]);
  const body = concatBytes(head, data);
  const crc = crc16Modbus(body);
  return concatBytes(body, new Uint8Array([(crc>>>8)&0xff, crc&0xff]));
}
const controlByte = (enc, ver) => (((enc?1:0)<<7) | ((ver&0x07)<<4)) & 0xff;
function splitGatt(control, payload) {
  const full = concatBytes(new Uint8Array([control]), payload);
  const packets = []; const MTU = 20; let idx = 0, off = 0;
  while (off < full.length) {
    const prefix = idx === 0 ? concatBytes(varint(0), varint(full.length)) : varint(idx);
    const room = MTU - prefix.length;
    const chunk = full.subarray(off, off + room);
    packets.push(concatBytes(prefix, chunk));
    off += chunk.length; idx++;
  }
  return packets;
}
function buildDpCommand(seq, dpFrames, sessionKey, version) {
  const data = concatBytes.apply(null, dpFrames);
  const inner = buildInnerFrame(seq, CMD_DPS, 0x00, data);
  const enc = AES.encryptEcb(inner, sessionKey, true);
  return splitGatt(controlByte(true, version), enc);
}
const deriveSecretKey5 = (lk, sr) => md5(concatBytes(lk, sr));

// --------------------------- DP catalog + model registry ---------------------------
// All DP CODE names are proven referenced in the Tuya `ddzxc` category. Every numeric dpId, enum
// range, scale and unit is cloud-side (SchemaBean) = UNKNOWN, so type here is the app-observed wire
// type (best candidate) only; nothing numeric is invented. group tags the BMS/battery fields so the
// BMS-only Legacy 2.0 profile can be scoped to them.
const DP_CATALOG = {
  speed:               { type: 'value',  group: 'ride' },
  avgspeed_once:       { type: 'value',  group: 'ride' },
  mileage_once:        { type: 'value',  group: 'ride' },
  mileage_total:       { type: 'value',  group: 'ride' },
  ridetime_once:       { type: 'value',  group: 'ride' },
  endurance_mileage:   { type: 'value',  group: 'ride' },
  mode:                { type: 'enum',   group: 'ride' },
  level:               { type: 'enum',   group: 'ride' },
  unit_set:            { type: 'enum',   group: 'ride' },
  battery_percentage:  { type: 'value',  group: 'battery' },
  battery_percentage_2:{ type: 'value',  group: 'battery' },
  battery_status:      { type: 'raw',    group: 'battery' },
  battery_status_2:    { type: 'raw',    group: 'battery' },
  battery_info:        { type: 'raw',    group: 'battery' },
  battery_info_2:      { type: 'raw',    group: 'battery' },
  voltage_current_2:   { type: 'raw',    group: 'battery' },
  cur_current_2:       { type: 'value',  group: 'battery' },
  battery_temp_2:      { type: 'value',  group: 'battery' },
  battery_capacity_2:  { type: 'value',  group: 'battery' },
  battery_cycle_times_2:{ type: 'value', group: 'battery' },
  battery_cycletimes_2:{ type: 'value',  group: 'battery' },
  bms1_chartime:       { type: 'value',  group: 'battery' },
  bms2_chartime:       { type: 'value',  group: 'battery' },
  fault_detection:     { type: 'raw',    group: 'ride' },
  gps_signal_strength: { type: 'value',  group: 'ride' },
  signal_strength:     { type: 'value',  group: 'ride' },
  '4g_signal_strength':{ type: 'value',  group: 'ride' },
  blelock_switch:      { type: 'bool',   group: 'lock' },
  bucket_lock:         { type: 'bool',   group: 'lock' },
  tail_box_lock:       { type: 'bool',   group: 'lock' },
  colour_data:         { type: 'string', group: 'led' },
  speed_limit_e:       { type: 'value',  group: 'ride' },
  speed_limit_enum:    { type: 'enum',   group: 'ride' },
  headlight_switch:    { type: 'bool',   group: 'light' },
  taillight_switch:    { type: 'bool',   group: 'light' },
  switch_led:          { type: 'bool',   group: 'led' },
  cruise_switch:       { type: 'bool',   group: 'ride' },
  zero_start:          { type: 'bool',   group: 'ride' },
  start_mode:          { type: 'enum',   group: 'ride' },
  not_zero_start:      { type: 'bool',   group: 'ride' },
  energy_recovery_level:{ type: 'enum',  group: 'ride' },
  boost:               { type: 'bool',   group: 'ride' },
  anti_thef_sensitivity:{ type: 'enum',  group: 'alarm' },
  sensitivity_set:     { type: 'value',  group: 'alarm' },
  angle_dip:           { type: 'value',  group: 'calib' },
  gyro_calibration:    { type: 'bool',   group: 'calib' },
  sleep_time:          { type: 'value',  group: 'power' },
  self_balance:        { type: 'bool',   group: 'calib' },
  back_fast_alarm:     { type: 'bool',   group: 'alarm' },
  battery_lock:        { type: 'bool',   group: 'battery' },
  auto_lock:           { type: 'bool',   group: 'lock' },
  auto_unlock:         { type: 'bool',   group: 'lock' },
  auto_unlock_distance:{ type: 'value',  group: 'lock' },
  auto_unlock_pair:    { type: 'raw',    group: 'lock' },
  lose_mode:           { type: 'bool',   group: 'alarm' },
  move_alarm:          { type: 'bool',   group: 'alarm' },
  search:              { type: 'bool',   group: 'alarm' },
  nfc_id:              { type: 'string', group: 'access' },
  nfc_id_input:        { type: 'raw',    group: 'access' },
  nfc_id_delete:       { type: 'raw',    group: 'access' },
  nfc_id_reset:        { type: 'bool',   group: 'access' },
  nfc_id_sync:         { type: 'bool',   group: 'access' },
  pass_id:             { type: 'string', group: 'access' },
  password_creat:      { type: 'raw',    group: 'access' },
  password_change:     { type: 'raw',    group: 'access' },
  password_delete:     { type: 'raw',    group: 'access' },
  password_sync:       { type: 'bool',   group: 'access' },
  hid_bind:            { type: 'raw',    group: 'alarm' },
  fortify_distance_record:  { type: 'value', group: 'alarm' },
  disarm_distance_record:   { type: 'value', group: 'alarm' }
};

const TELEMETRY_CODES = ['speed','avgspeed_once','mileage_once','mileage_total','ridetime_once',
  'endurance_mileage','mode','level','unit_set','battery_percentage','battery_percentage_2',
  'battery_status','battery_status_2','battery_info','battery_info_2','voltage_current_2',
  'cur_current_2','battery_temp_2','battery_capacity_2','battery_cycle_times_2','battery_cycletimes_2',
  'bms1_chartime','bms2_chartime','fault_detection','gps_signal_strength',
  'signal_strength','4g_signal_strength','blelock_switch','bucket_lock','tail_box_lock','colour_data'];
const SETTINGS_CODES = ['speed_limit_e','speed_limit_enum','mode','level','headlight_switch',
  'taillight_switch','switch_led','unit_set','cruise_switch','zero_start','start_mode',
  'not_zero_start','energy_recovery_level','boost'];
const ADVANCED_CODES = ['anti_thef_sensitivity','sensitivity_set','angle_dip','gyro_calibration',
  'sleep_time','self_balance','back_fast_alarm','battery_lock','auto_lock','auto_unlock',
  'auto_unlock_distance','auto_unlock_pair','lose_mode','move_alarm','search','blelock_switch',
  'bucket_lock','tail_box_lock','nfc_id','nfc_id_input','nfc_id_delete','nfc_id_reset','nfc_id_sync',
  'pass_id','password_creat','password_change','password_delete','password_sync','hid_bind',
  'fortify_distance_record','disarm_distance_record','colour_data'];
// Writes that also trip the confirm dialog even after both gates pass.
const RISKY_CODES = new Set(['speed_limit_e','speed_limit_enum','boost','blelock_switch','bucket_lock',
  'tail_box_lock','battery_lock','auto_lock','auto_unlock','self_balance','gyro_calibration']);

const batteryOnly = (codes) => codes.filter((c) => DP_CATALOG[c] && DP_CATALOG[c].group === 'battery');
const PROFILES = {
  auto:    { ble: true,  telemetry: TELEMETRY_CODES, settings: SETTINGS_CODES, advanced: ADVANCED_CODES, boost: true,  hintKey: 'modelHintAuto' },
  elitex2: { ble: true,  telemetry: TELEMETRY_CODES, settings: SETTINGS_CODES, advanced: ADVANCED_CODES, boost: true,  hintKey: 'modelHintElitex2' },
  legacy2: { ble: false, telemetry: batteryOnly(TELEMETRY_CODES), settings: [], advanced: [], boost: false, hintKey: 'modelHintLegacy2', bannerKey: 'legacyBanner2' },
  legacy1: { ble: false, telemetry: [], settings: [], advanced: [], boost: false, hintKey: 'modelHintLegacy1', bannerKey: 'legacyBanner1' }
};
const profile = () => PROFILES[state.model] || PROFILES.auto;

// --------------------------- i18n ---------------------------
function table() { return (window.I18N && window.I18N[state.lang]) || {}; }
function t(key) { const v = table()[key]; return (typeof v === 'string') ? v : ''; }
function dpLabel(code) { const d = table().dp || {}; return d[code] || code; }

// --------------------------- schema (user-supplied dpId map) ---------------------------
function schemaEntry(code) { return state.schema[code] || null; }
function schemaDpId(code) { const e = schemaEntry(code); return e ? e.dpId : null; }
function schemaType(code) {
  const e = schemaEntry(code);
  if (e && e.type && DP_TYPE[e.type] !== undefined) return e.type;
  return (DP_CATALOG[code] && DP_CATALOG[code].type) || 'value';
}
function schemaPv(code) { const e = schemaEntry(code); return (e && e.pv) ? (parseInt(e.pv, 10) || 3) : 3; }
function reverseSchema() {
  const map = {};
  Object.keys(state.schema).forEach((code) => { const id = state.schema[code].dpId; if (id != null) map[id] = code; });
  return map;
}
function loadSchema() {
  const raw = ($('schema-in') && $('schema-in').value.trim()) || '';
  if (!raw) { state.schema = {}; try { localStorage.removeItem(LS.schema); } catch (e) {} log('schema cleared'); renderModel(); return; }
  let obj;
  try { obj = JSON.parse(raw); } catch (e) { log('schema JSON error: ' + e.message, 'log-err'); return; }
  const next = {};
  Object.keys(obj).forEach((code) => {
    const v = obj[code];
    if (typeof v === 'number') next[code] = { dpId: v };
    else if (v && typeof v === 'object' && typeof v.dpId === 'number') next[code] = { dpId: v.dpId, type: v.type, pv: v.pv };
  });
  state.schema = next;
  try { localStorage.setItem(LS.schema, JSON.stringify(next)); } catch (e) {}
  log('schema loaded: ' + Object.keys(next).length + ' dpIds', 'log-ok');
  renderModel();
}
function clearSchema() { state.schema = {}; if ($('schema-in')) $('schema-in').value = ''; try { localStorage.removeItem(LS.schema); } catch (e) {} log('schema cleared'); renderModel(); }

// --------------------------- Web Bluetooth ---------------------------
let bleDevice = null, writeChar = null, notifyChar = null;

function statusLabel(s) {
  const map = { disconnected:'stDisconnected', connecting:'stConnecting', linking:'stLinking',
    connected:'stConnected', 'no-service':'stNoService', 'no-char':'stNoChar', 'no-ble':'stNoBle' };
  return t(map[s] || 'stDisconnected') || s;
}
function setStatus(s) {
  const el = $('status'); if (el) { el.dataset.state = s; el.textContent = statusLabel(s); }
  const cb = $('btn-conn');
  if (cb) {
    if (!profile().ble) { cb.textContent = t('btnConnect'); cb.dataset.act = 'connect'; cb.disabled = true; cb.title = t('reasonLegacy'); return; }
    cb.disabled = false; cb.title = '';
    const on = (s === 'connecting' || s === 'linking' || s === 'connected');
    cb.textContent = on ? t('btnDisconnect') : t('btnConnect');
    cb.dataset.act = on ? 'disconnect' : 'connect';
  }
}

async function connect() {
  if (!profile().ble) { log('model has no Tuya BLE control', 'log-err'); return; }
  if (!navigator.bluetooth) { log('no Web Bluetooth in this browser', 'log-err'); return; }
  try {
    setStatus('connecting');
    log('requestDevice (filter service 0x1910, optional 0xfd50)');
    bleDevice = await navigator.bluetooth.requestDevice({
      filters: [{ services: [uuid16(TUYA.service)] }, { services: [ALT.service] }],
      optionalServices: [uuid16(TUYA.service), ALT.service]
    });
    state.deviceId = bleDevice.id || '';
    const dev = $('devinfo'); if (dev) dev.textContent = t('devPrefix') + ' ' + (bleDevice.name || '(no name)');
    log('device: ' + '\x01' + (bleDevice.name || '(no name)') + '\x01' + ' id=' + '\x01' + bleDevice.id + '\x01');
    bleDevice.addEventListener('gattserverdisconnected', () => { state.connected = false; setStatus('disconnected'); updateGates(); log('disconnected', 'log-err'); });
    const server = await bleDevice.gatt.connect();
    setStatus('linking');
    // Try the 0x1910 profile first, then the alt SIG 0xfd50 profile (the app uses one or the other).
    let svc = null, useAlt = false;
    try { svc = await server.getPrimaryService(uuid16(TUYA.service)); }
    catch (e) { svc = await server.getPrimaryService(ALT.service); useAlt = true; }
    if (useAlt) {
      writeChar = await svc.getCharacteristic(ALT.write);
      notifyChar = await svc.getCharacteristic(ALT.notify);
      log('using alt SIG profile 0xfd50');
    } else {
      writeChar = await svc.getCharacteristic(uuid16(TUYA.write));
      notifyChar = await svc.getCharacteristic(uuid16(TUYA.notify));
    }
    await notifyChar.startNotifications();
    notifyChar.addEventListener('characteristicvaluechanged', onNotify);
    if (state.diag) tapExtraNotify(server);
    state.connected = true;
    setStatus('connected');
    updateGates();
    log('connected, notify active (' + (useAlt ? '0xfd50' : '0x2b10') + ')', 'log-ok');
  } catch (e) { state.connected = false; setStatus('disconnected'); updateGates(); log('connect error: ' + e.message, 'log-err'); }
}
function disconnect() { try { if (bleDevice && bleDevice.gatt.connected) bleDevice.gatt.disconnect(); } catch (e) {} }

// Extra notify/indicate taps for diagnostics, so DPs on side channels still surface.
async function tapExtraNotify(server) {
  try {
    const svcs = await server.getPrimaryServices();
    for (const s of svcs) {
      let cs = []; try { cs = await s.getCharacteristics(); } catch (e) { continue; }
      for (const c of cs) {
        if (c === notifyChar) continue;
        const p = c.properties || {};
        if (p.notify || p.indicate) {
          try {
            await c.startNotifications();
            c.addEventListener('characteristicvaluechanged', (ev) => {
              const b = new Uint8Array(ev.target.value.buffer);
              log('RX[' + c.uuid.slice(4, 8) + '] (' + b.length + '): ' + hex(b), 'log-rx');
            });
            log('diag tap: notify ' + c.uuid);
          } catch (e) {}
        }
      }
    }
  } catch (e) {}
}

// --------------------------- notification decode (reassemble -> decrypt -> DP entries) ---------------------------
const rxAsm = { buf: null, total: 0 };
function onNotify(ev) {
  try {
    const bytes = new Uint8Array(ev.target.value.buffer);
    log('RX (' + bytes.length + '): ' + hex(bytes), 'log-rx');
    feedReassembler(bytes);
  } catch (e) { log('rx decode error: ' + e.message, 'log-err'); }
}
function feedReassembler(bytes) {
  let [idx, pos] = readVarint(bytes, 0);
  if (idx === 0) {
    let total; [total, pos] = readVarint(bytes, pos);
    rxAsm.buf = []; rxAsm.total = total;
    for (let i = pos; i < bytes.length; i++) rxAsm.buf.push(bytes[i]);
  } else if (rxAsm.buf) {
    for (let i = pos; i < bytes.length; i++) rxAsm.buf.push(bytes[i]);
  } else { return; }
  if (rxAsm.total && rxAsm.buf.length >= rxAsm.total) {
    const full = new Uint8Array(rxAsm.buf.slice(0, rxAsm.total));
    rxAsm.buf = null; rxAsm.total = 0;
    handleFrame(full);
  }
}
function sessionKeyOrNull() {
  try {
    const lk = $('localkey-in') && $('localkey-in').value.trim();
    const sr = $('srand-in') && $('srand-in').value.trim();
    if (!lk || !sr) return null;
    const lkBytes = lk.length === 16 ? strToBytes(lk) : hexToBytes(lk);
    return deriveSecretKey5(lkBytes, hexToBytes(sr));
  } catch (e) { return null; }
}
// AES-ECB of the whole inner frame is PKCS7-padded before encrypt, so a decrypted RX payload carries
// trailing pad after the CRC. Strip it before the CRC check.
function stripPkcs7(data) {
  if (!data.length) return data;
  const p = data[data.length - 1];
  if (p >= 1 && p <= 16 && p <= data.length) {
    let ok = true;
    for (let i = data.length - p; i < data.length; i++) if (data[i] !== p) { ok = false; break; }
    if (ok) return data.subarray(0, data.length - p);
  }
  return data;
}
function handleFrame(full) {
  const control = full[0];
  const enc = (control >> 7) & 1;
  const pv = (control >> 4) & 7;
  let payload = full.subarray(1);
  if (enc) {
    const key = sessionKeyOrNull();
    if (!key || payload.length % 16 !== 0) {
      if (state.diag) log('decoded: encrypted frame (pv' + pv + '), needs the DP session key (secretKey5) - path unconfirmed', 'log-rx');
      return;
    }
    try { payload = stripPkcs7(AES.decryptEcb(payload, key)); } catch (e) { if (state.diag) log('decoded: decrypt failed', 'log-err'); return; }
  }
  if (payload.length < 6) return;
  const seq = (payload[0] << 8) | payload[1];
  const cmd1 = payload[2];                          // 1-byte cmd (the shape the tool itself builds)
  const cmd16 = (payload[2] << 8) | payload[3];     // 16-bit transport cmd (e.g. 0x8001 report)
  const crcGot = (payload[payload.length - 2] << 8) | payload[payload.length - 1];
  const crcCalc = crc16Modbus(payload.subarray(0, payload.length - 2));
  const crcOk = (crcGot === crcCalc);
  if (state.diag) log('decoded: seq=' + seq + ' cmd1=0x' + cmd1.toString(16) + ' cmd16=0x' + cmd16.toString(16) + ' crc=' + (crcOk ? 'ok' : 'bad'), crcOk ? 'log-rx' : 'log-err');
  if (!crcOk) return;   // wrong key / RX framing / padding -> never present guessed values as fact
  // The exact RX report framing is not fully proven, so try the proven DP-entry shapes and only apply
  // a candidate that parses to the very end (strict). CRC already validated the frame as a whole.
  const candidates = [];
  if (cmd16 === CMD_FUN_RECEIVE_DP) {                 // 2-byte cmd + flag, then report header version|sn|btype|flag
    const body = payload.subarray(5, payload.length - 2);
    if (body.length > 7) candidates.push(body.subarray(7));
    candidates.push(body);
  }
  if (cmd1 === CMD_DPS || cmd1 === CMD_DEVICE_STATUS) candidates.push(payload.subarray(4, payload.length - 2));
  for (const data of candidates) {
    const entries = parseDpEntries(data, pv, true);
    if (entries && entries.length) { applyDpEntries(entries); return; }
  }
}
function parseDpEntries(data, pv, strict) {
  const out = []; let i = 0;
  while (i + 3 <= data.length) {
    const dpId = data[i]; const dpType = data[i + 1];
    let len, valStart;
    if (pv === 4) { if (i + 4 > data.length) break; len = (data[i + 2] << 8) | data[i + 3]; valStart = i + 4; }
    else { len = data[i + 2]; valStart = i + 3; }
    if (valStart + len > data.length) break;
    const val = data.subarray(valStart, valStart + len);
    let num = null;
    if (dpType === DP_TYPE.value) { num = 0; for (let k = 0; k < val.length; k++) num = (num << 8) | val[k]; num = num >>> 0; }
    else if (dpType === DP_TYPE.bool || dpType === DP_TYPE.enum) { num = val[0]; }
    out.push({ dpId: dpId, dpType: dpType, raw: val, num: num });
    i = valStart + len;
  }
  if (strict && i !== data.length) return null;   // leftover bytes -> this framing guess is wrong
  return out;
}
function applyDpEntries(entries) {
  const rev = reverseSchema();
  entries.forEach((e) => {
    const code = rev[e.dpId];
    if (state.diag) log('  DP dpId=' + e.dpId + ' type=' + (DP_TYPE_NAME[e.dpType] || e.dpType) + ' raw=' + hex(e.raw) + (code ? ' (' + code + ')' : ' (unmapped)'), 'log-rx');
    if (!code) return;
    const el = state.tileEls[code];
    if (!el) return;
    const disp = (e.num != null) ? String(e.num) : hex(e.raw);
    el.textContent = disp;
    const tile = el.closest('.tile');
    if (tile) setTileBadge(tile, 'unconfirmed');
  });
}

// --------------------------- session key + DP send ---------------------------
function currentSessionKey() {
  const localKey = $('localkey-in').value.trim();
  if (!localKey) throw new Error('localKey missing');
  const srandHex = $('srand-in').value.trim();
  if (!srandHex) throw new Error('srand missing');
  const lkBytes = localKey.length === 16 ? strToBytes(localKey) : hexToBytes(localKey);
  const sk = deriveSecretKey5(lkBytes, hexToBytes(srandHex));
  const dk = $('derived-key'); if (dk) dk.textContent = '\x01' + hex(sk) + '\x01';
  return sk;
}
function sessionReady() {
  if (!state.connected) return false;
  const lk = $('localkey-in') && $('localkey-in').value.trim();
  const sr = $('srand-in') && $('srand-in').value.trim();
  return !!(lk && sr);
}
async function sendDp(dpId, dpType, value, pv, label, armedFlag) {
  const sessionKey = currentSessionKey();
  const dp = encodeDp(dpId, dpType, value, pv);
  const seq = seqCounter++;
  const packets = buildDpCommand(seq, [dp], sessionKey, pv);
  log((label ? label + ' ' : '') + 'DP ' + hex(dp) + ' (dpId=' + dpId + ' val=' + value + ' seq=' + seq + ' ' + packets.length + 'pkt)');
  if (!armedFlag) { log('preview only (arm to send)'); return false; }
  if (!writeChar) { log('not connected', 'log-err'); return false; }
  for (const p of packets) { await writeChar.writeValueWithoutResponse(p); log('TX ' + hex(p), 'log-tx'); }
  return true;
}

// --------------------------- raw DP write (escape hatch: user supplies dpId, Gate A only) ---------------------------
function rawArmed() { return $('arm-in') && $('arm-in').value === '1'; }
async function sendRaw() {
  try {
    const dpId = parseInt($('dpid-in').value, 10);
    if (!(dpId >= 1 && dpId <= 255)) { log('dpId invalid (1..255)', 'log-err'); return; }
    const dpType = DP_TYPE[$('dptype-in').value];
    const raw = $('dpval-in').value.trim();
    const pv = parseInt($('pv-in').value, 10) || 3;
    const value = (dpType === DP_TYPE.string || dpType === DP_TYPE.raw) ? raw : parseInt(raw, 10);
    const doSend = async () => {
      const ok = await sendDp(dpId, dpType, value, pv, 'raw', rawArmed());
      if (ok) log('DP sent. If no reaction the DP channel may need the native session key path.', 'log-ok');
    };
    if (rawArmed()) confirmThen(doSend); else await doSend();
    try { localStorage.setItem(LS.dpid, String(dpId)); } catch (e) {}
  } catch (e) { log('raw write error: ' + e.message, 'log-err'); }
}

// --------------------------- per-model rendering: telemetry tiles + settings/advanced rows ---------------------------
function setTileBadge(tile, kind) {
  const badge = tile.querySelector('.tile-badge');
  if (!badge) return;
  if (kind === 'unconfirmed') { badge.textContent = t('badgeUnconfirmed'); badge.title = t('tipRaw'); badge.dataset.kind = 'unconfirmed'; }
  else { badge.textContent = '?'; badge.title = t('tipWaiting'); badge.dataset.kind = 'waiting'; }
}
function buildTile(code) {
  const tile = document.createElement('div');
  tile.className = 'tile'; tile.dataset.code = code;
  const val = document.createElement('b'); val.textContent = '-';
  const small = document.createElement('small'); small.textContent = dpLabel(code);
  const badge = document.createElement('span'); badge.className = 'tile-badge';
  tile.appendChild(val); tile.appendChild(small); tile.appendChild(badge);
  state.tileEls[code] = val;
  setTileBadge(tile, 'waiting');
  return tile;
}
function buildDpControl(code) {
  const type = schemaType(code);
  let ctrl;
  if (type === 'bool') {
    ctrl = document.createElement('select');
    [['1', t('optOn')], ['0', t('optOff')]].forEach(([v, label]) => { const o = document.createElement('option'); o.value = v; o.textContent = label; ctrl.appendChild(o); });
  } else if (type === 'value' || type === 'enum') {
    ctrl = document.createElement('input'); ctrl.type = 'number';
  } else {
    ctrl = document.createElement('input'); ctrl.type = 'text';
  }
  ctrl.className = 'dp-ctrl';
  return ctrl;
}
function buildDpRow(code) {
  const row = document.createElement('div');
  row.className = 'dp-row'; row.dataset.code = code;
  const head = document.createElement('div'); head.className = 'dp-row-head';
  const label = document.createElement('label'); label.textContent = dpLabel(code);
  const badge = document.createElement('span'); badge.className = 'badge';
  head.appendChild(label); head.appendChild(badge);
  const ctrlWrap = document.createElement('div'); ctrlWrap.className = 'dp-row-ctrl';
  const ctrl = buildDpControl(code);
  const setBtn = document.createElement('button'); setBtn.type = 'button'; setBtn.className = 'dp-set'; setBtn.textContent = t('lblSet');
  setBtn.addEventListener('click', () => onDpSet(code, ctrl));
  ctrlWrap.appendChild(ctrl); ctrlWrap.appendChild(setBtn);
  row.appendChild(head); row.appendChild(ctrlWrap);
  return row;
}
function onDpSet(code, ctrl) {
  try {
    if (!sessionReady()) { log(code + ': ' + t('reasonSession'), 'log-err'); return; }
    const dpId = schemaDpId(code);
    if (dpId == null) { log(code + ': ' + t('reasonSchema'), 'log-err'); return; }
    const type = schemaType(code);
    const pv = schemaPv(code);
    let value = ctrl.value.trim();
    if (type !== 'string' && type !== 'raw') value = parseInt(value, 10);
    const doSend = async () => {
      const ok = await sendDp(dpId, DP_TYPE[type], value, pv, code, true);
      if (ok) log(code + ' sent (dpId=' + dpId + ')', 'log-ok');
    };
    if (RISKY_CODES.has(code)) confirmThen(doSend); else doSend();
  } catch (e) { log(code + ' error: ' + e.message, 'log-err'); }
}
function renderModel() {
  const p = profile();
  // model hint + legacy banner + connect availability
  { const el = $('model-hint'); if (el) el.textContent = t(p.hintKey); }
  { const el = $('legacy-banner'); if (el) { if (p.bannerKey) { el.textContent = t(p.bannerKey); el.hidden = false; } else el.hidden = true; } }
  // telemetry tiles
  const grid = $('telemetry-grid');
  if (grid) {
    grid.textContent = ''; state.tileEls = {};
    if (!p.telemetry.length) { const em = document.createElement('p'); em.className = 'hint'; em.textContent = t('telemetryEmpty'); grid.appendChild(em); }
    else p.telemetry.forEach((code) => grid.appendChild(buildTile(code)));
  }
  // settings + advanced cards
  fillRows($('settings-rows'), p.settings);
  fillRows($('advanced-rows'), p.advanced);
  // Card visibility (profile + connection state) is owned by updateGates(), which also runs
  // on connect/disconnect, so device-specific cards stay hidden until the scooter is linked.
  updateGates();
  setStatus(state.connected ? 'connected' : (p.ble ? 'disconnected' : 'no-ble'));
}
function fillRows(container, codes) {
  if (!container) return;
  container.textContent = '';
  codes.forEach((code) => container.appendChild(buildDpRow(code)));
}
// Gate A (session) + Gate B (schema dpId): reflect both as disabled state + a specific reason.
function updateGates() {
  const p = profile();
  const conn = state.connected;
  // Hide everything device-specific until the scooter is connected: only after a link do we
  // know what it actually reports, so schema/keys/telemetry/settings are not front-loaded.
  { const c = $('telemetry-card'); if (c) c.hidden = !p.telemetry.length || !conn; }
  { const c = $('settings-card');  if (c) c.hidden = !p.settings.length  || !conn; }
  { const c = $('advanced-card');  if (c) c.hidden = !p.advanced.length  || !conn; }
  { const c = $('boost-card');     if (c) c.hidden = !p.boost            || !conn; }
  { const c = $('raw-card');       if (c) c.hidden = !p.ble              || !conn; }
  { const c = $('keys-card');      if (c) c.hidden = !p.ble              || !conn; }
  { const c = $('schema-card');    if (c) c.hidden = !p.ble              || !conn; }
  { const el = $('preconnect-hint'); if (el) el.hidden = conn || !p.ble; }
  const ready = sessionReady();
  document.querySelectorAll('.dp-row').forEach((row) => {
    const code = row.dataset.code;
    const dpId = schemaDpId(code);
    const ctrl = row.querySelector('.dp-ctrl');
    const btn = row.querySelector('.dp-set');
    const badge = row.querySelector('.badge');
    let reason = '';
    if (dpId == null) { badge.textContent = t('badgeSchema'); badge.dataset.kind = 'schema'; reason = t('reasonSchema'); }
    else if (!ready) { badge.textContent = t('badgeSession'); badge.dataset.kind = 'session'; reason = t('reasonSession'); }
    else { badge.textContent = t('dpIdPrefix') + ' ' + dpId; badge.dataset.kind = 'ok'; reason = ''; }
    const disabled = (dpId == null) || !ready;
    if (ctrl) { ctrl.disabled = disabled; ctrl.title = reason; }
    if (btn) { btn.disabled = disabled; btn.title = reason; }
  });
  // raw write + boost need Gate A (session) only; inputs stay editable, the send buttons gate.
  const sr = sessionReady();
  { const b = $('btn-sendspeed'); if (b) { b.disabled = !sr; b.title = sr ? '' : t('reasonSession'); } }
  ['btn-auto', 'btn-boost', 'btn-secure', 'btn-mode1', 'btn-mode2', 'btn-mode3'].forEach((id) => {
    const b = $(id); if (b) { b.disabled = !sr; b.title = sr ? '' : t('reasonSession'); }
  });
}

// --------------------------- confirm dialog ---------------------------
let confirmCb = null;
function confirmThen(cb) {
  confirmCb = cb;
  const dlg = $('confirm'); const body = $('confirm-body');
  if (body) body.textContent = t('confirmBody');
  if (dlg && dlg.showModal) { try { dlg.showModal(); } catch (e) { if (confirmCb) { confirmCb(); confirmCb = null; } } }
  else if (confirmCb) { confirmCb(); confirmCb = null; }
}

// --------------------------- voice + boost sequencer ---------------------------
function speak(key) {
  try {
    if ($('voice-in') && $('voice-in').value !== '1') return;
    if (typeof speechSynthesis === 'undefined') return;
    const u = new SpeechSynthesisUtterance(t(key));
    u.lang = (state.lang === 'de') ? 'de-DE' : 'en-US';
    u.rate = 1.05;
    speechSynthesis.speak(u);
  } catch (e) {}
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function modeParams() {
  const dpId = parseInt($('mode-dpid').value, 10);
  if (!(dpId >= 1 && dpId <= 255)) throw new Error('mode dpId invalid (1..255)');
  const dpType = DP_TYPE[$('mode-dptype').value];
  const m1 = parseInt($('mode-v1').value, 10), m2 = parseInt($('mode-v2').value, 10), m3 = parseInt($('mode-v3').value, 10);
  const hold = parseInt($('boost-delay').value, 10) || 700;
  const pv = parseInt($('pv-in').value, 10) || 3;
  return { dpId, dpType, m1, m2, m3, hold, pv };
}
async function autoBoost() {
  try {
    const p = modeParams();
    currentSessionKey();
    log('== AUTO-BOOST: follow the voice for the throttle ==');
    speak('spReady');
    await sleep(1400);
    await sendDp(p.dpId, p.dpType, p.m1, p.pv, 'boost mode1', true);
    speak('spMode1');
    await sleep(p.hold);
    await sendDp(p.dpId, p.dpType, p.m3, p.pv, 'boost mode3', true);
    speak('spMode3');
    await sleep(350);
    speak('spSecuring');
    await sendDp(p.dpId, p.dpType, p.m2, p.pv, 'secure mode2', true);
    await sleep(150);
    await sendDp(p.dpId, p.dpType, p.m3, p.pv, 'secure mode3', true);
    speak('spSecured');
    log('== AUTO-BOOST done ==', 'log-ok');
  } catch (e) { log('auto-boost error: ' + e.message, 'log-err'); }
}
async function seqBoost() {
  try { const p = modeParams(); await sendDp(p.dpId,p.dpType,p.m1,p.pv,'boost mode1',true); await sleep(p.hold); await sendDp(p.dpId,p.dpType,p.m3,p.pv,'boost mode3',true); }
  catch (e) { log('boost error: ' + e.message, 'log-err'); }
}
async function seqSecure() {
  try { const p = modeParams(); await sendDp(p.dpId,p.dpType,p.m2,p.pv,'secure mode2',true); await sleep(150); await sendDp(p.dpId,p.dpType,p.m3,p.pv,'secure mode3',true); }
  catch (e) { log('secure error: ' + e.message, 'log-err'); }
}
async function seqMode(which) {
  try { const p = modeParams(); const v = which===1?p.m1:which===2?p.m2:p.m3; await sendDp(p.dpId,p.dpType,v,p.pv,'mode'+which,true); }
  catch (e) { log('mode error: ' + e.message, 'log-err'); }
}

// --------------------------- diagnostics (scan all devices) ---------------------------
async function scanAllDevicesDiagnostic() {
  if (!navigator.bluetooth) { log('no Web Bluetooth', 'log-err'); return; }
  try {
    logHeader();
    const d = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [uuid16(TUYA.service), ALT.service] });
    state.deviceId = d.id || '';
    log('DIAG device: name=' + '\x01' + (d.name || '(none)') + '\x01' + ' id=' + '\x01' + d.id + '\x01');
    const server = await d.gatt.connect();
    const svcs = await server.getPrimaryServices();
    for (const s of svcs) {
      log('DIAG service ' + s.uuid);
      try { const cs = await s.getCharacteristics(); for (const c of cs) log('DIAG   char ' + c.uuid); } catch (e) {}
    }
    log('DIAG done. Copy the log. For name plus manufacturer data use nRF Connect on Android.', 'log-ok');
    try { d.gatt.disconnect(); } catch (e) {}
  } catch (e) { log('DIAG error: ' + e.message, 'log-err'); }
}

// --------------------------- self-test ---------------------------
function runSelfTest() {
  const H = (b) => hex(b).replace(/ /g, '');
  const checks = [];
  const add = (name, got, want) => checks.push([name, got === want, got, want]);
  add('MD5 empty', H(md5(strToBytes(''))), 'd41d8cd98f00b204e9800998ecf8427e');
  add('MD5 abc', H(md5(strToBytes('abc'))), '900150983cd24fb0d6963f7d28e17f72');
  add('AES block', H(AES.encryptBlockRaw(hexToBytes('00112233445566778899aabbccddeeff'), hexToBytes('000102030405060708090a0b0c0d0e0f'))), '69c4e0d86a7b0430d8cdb78070b4c55a');
  add('AES decrypt', H(AES.decryptEcb(hexToBytes('69c4e0d86a7b0430d8cdb78070b4c55a'), hexToBytes('000102030405060708090a0b0c0d0e0f'))), '00112233445566778899aabbccddeeff');
  add('CRC16 modbus', crc16Modbus(strToBytes('123456789')).toString(16).padStart(4,'0'), '4b37');
  add('varint 300', hex(varint(300)), 'ac 02');
  add('varint rt', String(readVarint(varint(300), 0)[0]), '300');
  add('DP value', hex(encodeDp(4, DP_TYPE.value, 1000, 3)), '04 02 04 00 00 03 e8');
  let allOk = true;
  checks.forEach(([name, ok, got, want]) => { if (!ok) allOk = false; log('selftest ' + (ok ? 'OK ' : 'FAIL ') + name + (ok ? '' : (' got=' + got + ' want=' + want)), ok ? 'log-ok' : 'log-err'); });
  log(allOk ? 'selftest: all ' + checks.length + ' vectors OK' : 'selftest: FAILURES', allOk ? 'log-ok' : 'log-err');
}

// --------------------------- i18n apply ---------------------------
function applyLang() {
  document.documentElement.lang = state.lang;
  document.querySelectorAll('[data-t]').forEach((n) => {
    const v = t(n.getAttribute('data-t'));
    if (/[<&]/.test(v)) n.innerHTML = v; else n.textContent = v;   // scan-ok: own i18n table, values are not user input
  });
  document.querySelectorAll('[data-t-ph]').forEach((n) => { const v = t(n.getAttribute('data-t-ph')); if (v) n.setAttribute('placeholder', v); });
  { const el = $('link-guide'); if (el) el.href = docFile('GUIDE'); }
  { const el = $('link-readme'); if (el) el.href = docFile('README'); }
  { const el = $('link-license'); if (el) el.href = docFile('LICENSE'); }
  { const el = $('link-privacy'); if (el) el.href = docFile('PRIVACY'); }
  { const el = $('link-trademarks'); if (el) el.href = docFile('TRADEMARKS'); }
  { const el = $('langs'); if (el) el.setAttribute('aria-label', t('langGroup')); }
  { const dark = document.documentElement.getAttribute('data-theme') !== 'light'; const el = $('btn-theme'); if (el) { el.setAttribute('aria-label', t(dark ? 'themeToLight' : 'themeToDark')); el.title = el.getAttribute('aria-label'); } }
  { const el = $('build-ver'); if (el) el.textContent = t('buildLabel') + ' ' + BUILD; }
  document.querySelectorAll('#langs button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === state.lang)));
  renderModel();
}
function initLangSwitch() {
  document.querySelectorAll('#langs button').forEach((b) => b.addEventListener('click', () => { state.lang = b.dataset.lang; try { localStorage.setItem(LS.lang, state.lang); } catch (e) {} applyLang(); }));
}

// --------------------------- theme ---------------------------
function applyTheme(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const b = $('btn-theme');
  if (b) { b.innerHTML = dark ? '&#9728;' : '&#9790;'; b.setAttribute('aria-label', t(dark ? 'themeToLight' : 'themeToDark')); b.title = b.getAttribute('aria-label'); } // scan-ok: fixed sun/moon glyph, not user input
  try { localStorage.setItem(LS.theme, dark ? 'dark' : 'light'); } catch (e) {}
}
function initTheme() {
  let saved = null; try { saved = localStorage.getItem(LS.theme); } catch (e) {}
  applyTheme(saved !== 'light');
  const b = $('btn-theme'); if (b) b.addEventListener('click', () => applyTheme(document.documentElement.getAttribute('data-theme') === 'light'));
}

// --------------------------- help modals ---------------------------
const HELP = { key: ['keyTitle', 'keyHelp'], schema: ['schemaTitle', 'schemaHelp'], raw: ['rawTitle', 'rawHelp'],
  boost: ['boostTitle', 'boostHelp'], publiclog: ['publicLogLabel', 'publicLogHelp'], diaglog: ['diagLogLabel', 'diagLogHelp'],
  disclaimer: ['footDisclaimer', 'disclaimerText'] };
function openHelp(key) {
  const m = HELP[key]; if (!m) return;
  const dlg = $('help'); if (!dlg) return;
  const ti = $('help-title'); if (ti) ti.textContent = t(m[0]);
  const bo = $('help-body'); if (bo) bo.textContent = t(m[1]);
  if (dlg.showModal) { try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); } } else dlg.setAttribute('open', '');
}
function closeHelp() { const dlg = $('help'); if (!dlg) return; if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); }

// --------------------------- document viewer ---------------------------
const DOC_TITLES = {
  'GUIDE.de.md': 'footGuide', 'GUIDE.en.md': 'footGuide',
  'PRIVACY.de.md': 'footPrivacy', 'PRIVACY.md': 'footPrivacy',
  'LICENSE.de.md': 'footLicense', 'LICENSE.md': 'footLicense',
  'TRADEMARKS.de.md': 'footTrademarks', 'TRADEMARKS.md': 'footTrademarks',
  'README.md': 'footReadme'
};
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const slug = (s) => s.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/ /g, '-');
function mdToHtml(src) {
  const inline = (s) => escHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (all, text, href) => {
      if (DOC_TITLES[href]) return '<a href="' + href + '" data-docfile="' + href + '">' + text + '</a>';
      if (href.charAt(0) === '#') return '<a href="' + href + '" data-anchor="' + href.slice(1) + '">' + text + '</a>';
      return '<a href="' + href + '" target="_blank" rel="noopener">' + text + '</a>';
    });
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const out = []; let listKind = null, li = null, para = [], inFence = false;
  const sink = () => (li ? li.parts : out);
  const flushPara = () => { if (para.length) { sink().push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } };
  const closeNested = () => { if (li && li.nested) { li.parts.push('</ul>'); li.nested = false; } };
  const closeLi = () => { if (!li) return; flushPara(); closeNested(); out.push('<li>' + li.parts.join('\n') + '</li>'); li = null; };
  const closeList = () => { closeLi(); if (listKind) { out.push('</' + listKind + '>'); listKind = null; } };
  const block = () => { flushPara(); closeList(); };
  const openList = (kind) => { flushPara(); if (listKind !== kind) { closeList(); out.push('<' + kind + '>'); listKind = kind; } else closeLi(); };
  const cells = (l) => l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], body = l.trim(), indented = /^ {2,}\S/.test(l);
    if (inFence) { if (body.startsWith('```')) { sink().push('</code></pre>'); inFence = false; } else sink().push(escHtml(l)); continue; }
    if (body.startsWith('```')) { if (li) { flushPara(); closeNested(); } else block(); sink().push('<pre><code>'); inFence = true; continue; }
    if (body === '') { if (li && /^ {2,}\S/.test(lines[i+1] || '')) flushPara(); else block(); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(body)) { block(); out.push('<hr>'); continue; }
    if (body.startsWith('|') && /^\|[\s:|-]+\|?\s*$/.test((lines[i+1] || '').trim())) {
      if (li) { flushPara(); closeNested(); } else block();
      sink().push('<div class="doc-table"><table><thead><tr>' + cells(body).map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>');
      i++;
      while (i+1 < lines.length && lines[i+1].trim().startsWith('|')) sink().push('<tr>' + cells(lines[++i].trim()).map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>');
      sink().push('</tbody></table></div>'); continue;
    }
    let m;
    if ((m = body.match(/^(#{1,4})\s+(.*)$/))) { block(); const n = m[1].length; out.push('<h' + n + ' id="' + slug(m[2]) + '">' + inline(m[2]) + '</h' + n + '>'); continue; }
    if ((m = body.match(/^>\s?(.*)$/))) { if (li) { flushPara(); closeNested(); } else block(); sink().push('<blockquote>' + inline(m[1]) + '</blockquote>'); continue; }
    if (indented && li && (m = body.match(/^[-*]\s+(.*)$/))) { flushPara(); if (!li.nested) { li.parts.push('<ul class="nested">'); li.nested = true; } li.parts.push('<li>' + inline(m[1]) + '</li>'); continue; }
    if ((m = body.match(/^[-*]\s+(.*)$/)) && !indented) { openList('ul'); li = { parts: [inline(m[1])], nested: false }; continue; }
    if ((m = body.match(/^\d+\.\s+(.*)$/)) && !indented) { openList('ol'); li = { parts: [inline(m[1])], nested: false }; continue; }
    if (li && !indented) closeList();
    if (li) closeNested();
    para.push(body);
  }
  if (inFence) sink().push('</code></pre>');
  block();
  return out.join('\n').replace(/<pre><code>\n/g, '<pre><code>');
}
const docCache = {};
const docFile = (name) => { if (name === 'GUIDE') return 'GUIDE.' + state.lang + '.md'; if (name === 'README') return 'README.md'; return state.lang === 'de' ? name + '.de.md' : name + '.md'; };
function openDocFile(file, anchor, titleKey) {
  const dlg = $('doc'), body = $('doc-body'); if (!dlg || !body) return;
  const mark = (state.lang === 'de' && !file.includes('.de.') && file !== 'README.md') ? ' ' + t('docEnglish') : '';
  $('doc-title').textContent = (t(titleKey || DOC_TITLES[file] || '') || file) + mark;
  if (typeof dlg.showModal === 'function') dlg.showModal();
  const show = (html) => { body.innerHTML = html; const h1 = body.querySelector('h1'); if (h1) { $('doc-title').textContent = h1.textContent.trim() + mark; h1.remove(); } body.scrollTop = 0; // scan-ok: html is produced by mdToHtml, which escapes all text
    if (anchor) { const target = body.querySelector('#' + (window.CSS && CSS.escape ? CSS.escape(anchor) : anchor)); if (target) body.scrollTop = target.offsetTop - body.offsetTop; } };
  if (docCache[file]) { show(docCache[file]); return; }
  body.innerHTML = '<p>' + escHtml(t('docLoading')) + '</p>';   // scan-ok: escHtml-wrapped literal
  fetch(file + '?v=' + BUILD).then((r) => { if (!r.ok) throw new Error(r.status + ' ' + r.statusText); return r.text(); })
    .then((txt) => { docCache[file] = mdToHtml(txt); show(docCache[file]); })
    .catch((e) => { body.innerHTML = '<p>' + escHtml(t('docFail')) + '</p><pre>' + escHtml(file + ': ' + (e && e.message ? e.message : e)) + '</pre>'; });   // scan-ok: escHtml-wrapped operands only
}
function openDoc(name, anchor, titleKey) { openDocFile(docFile(name), anchor, titleKey); }
function wireDocViewer() {
  document.addEventListener('click', (e) => {
    if (!e.target.closest) return;
    const jump = e.target.closest('[data-anchor]');
    if (jump) { e.preventDefault(); const body = $('doc-body'); const target = body && body.querySelector('#' + CSS.escape(jump.getAttribute('data-anchor'))); if (target) body.scrollTop = target.offsetTop - body.offsetTop; return; }
    const disc = e.target.closest('[data-open-disclaimer]'); if (disc) { e.preventDefault(); openHelp('disclaimer'); return; }
    const a = e.target.closest('[data-doc], [data-docfile]'); if (!a) return;
    e.preventDefault();
    const file = a.getAttribute('data-docfile'); const titleKey = a.getAttribute('data-t') || '';
    if (file) openDocFile(file, '', titleKey); else openDoc(a.getAttribute('data-doc'), '', titleKey);
  });
  ['doc-x', 'doc-close'].forEach((id) => { const b = $(id); if (b) b.addEventListener('click', () => { const d = $('doc'); if (d) d.close(); }); });
}

// --------------------------- persistence ---------------------------
function restore() {
  try { const v = localStorage.getItem(LS.lk); if (v && $('localkey-in')) $('localkey-in').value = v; } catch (e) {}
  try { const v = localStorage.getItem(LS.model); if (v && PROFILES[v]) state.model = v; } catch (e) {}
  try { const v = localStorage.getItem(LS.publicLog); if (v === '0') state.publicLog = false; } catch (e) {}
  try {
    const v = localStorage.getItem(LS.schema);
    if (v) { state.schema = JSON.parse(v); if ($('schema-in')) $('schema-in').value = v; }
  } catch (e) {}
  const pairs = [[LS.dpid,'dpid-in'],[LS.mdpid,'mode-dpid'],[LS.m1,'mode-v1'],[LS.m2,'mode-v2'],[LS.m3,'mode-v3']];
  pairs.forEach(([k, id]) => { try { const v = localStorage.getItem(k); if (v && $(id)) $(id).value = v; } catch (e) {} });
  if ($('model-in')) $('model-in').value = state.model;
}
function persistInputs() {
  const save = (id, k) => { const el = $(id); if (el) el.addEventListener('change', () => { try { localStorage.setItem(k, el.value); } catch (e) {} }); };
  save('localkey-in', LS.lk); save('dpid-in', LS.dpid); save('mode-dpid', LS.mdpid); save('mode-v1', LS.m1); save('mode-v2', LS.m2); save('mode-v3', LS.m3);
}

// --------------------------- init ---------------------------
window.addEventListener('DOMContentLoaded', () => {
  try { const s = localStorage.getItem(LS.lang); if (s === 'de' || s === 'en') state.lang = s; } catch (e) {}
  initTheme(); initLangSwitch(); restore(); persistInputs();
  if (!navigator.bluetooth) { const pn = $('platform-note'); if (pn) pn.hidden = false; }
  applyLang();
  wireDocViewer();
  document.querySelectorAll('.help-btn').forEach((btn) => btn.addEventListener('click', () => openHelp(btn.getAttribute('data-help'))));
  ['help-x', 'help-close'].forEach((id) => { const b = $(id); if (b) b.addEventListener('click', closeHelp); });
  { const b = $('link-disclaimer'); if (b) b.addEventListener('click', (e) => { e.preventDefault(); openHelp('disclaimer'); }); }
  { const s = $('model-in'); if (s) s.addEventListener('change', () => { state.model = s.value; try { localStorage.setItem(LS.model, state.model); } catch (e) {} renderModel(); }); }
  { const c = $('btn-conn'); if (c) c.addEventListener('click', () => { if (c.dataset.act === 'disconnect') disconnect(); else connect(); }); }
  { const b = $('btn-load-schema'); if (b) b.addEventListener('click', loadSchema); }
  { const b = $('btn-clear-schema'); if (b) b.addEventListener('click', clearSchema); }
  { const b = $('btn-sendspeed'); if (b) b.addEventListener('click', sendRaw); }
  { const b = $('srand-in'); if (b) b.addEventListener('change', () => { try { currentSessionKey(); } catch (e) {} updateGates(); }); }
  { const b = $('localkey-in'); if (b) b.addEventListener('change', () => { try { currentSessionKey(); } catch (e) {} updateGates(); }); }
  { const b = $('btn-auto'); if (b) b.addEventListener('click', autoBoost); }
  { const b = $('btn-boost'); if (b) b.addEventListener('click', seqBoost); }
  { const b = $('btn-secure'); if (b) b.addEventListener('click', seqSecure); }
  { const b = $('btn-mode1'); if (b) b.addEventListener('click', () => seqMode(1)); }
  { const b = $('btn-mode2'); if (b) b.addEventListener('click', () => seqMode(2)); }
  { const b = $('btn-mode3'); if (b) b.addEventListener('click', () => seqMode(3)); }
  { const b = $('btn-copy-log'); if (b) b.addEventListener('click', copyLog); }
  { const b = $('btn-clear-log'); if (b) b.addEventListener('click', clearLog); }
  { const b = $('btn-save-log'); if (b) b.addEventListener('click', saveLog); }
  { const b = $('btn-diag'); if (b) b.addEventListener('click', scanAllDevicesDiagnostic); }
  { const b = $('btn-selftest'); if (b) b.addEventListener('click', runSelfTest); }
  {
    const cb = $('public-log');
    if (cb) { cb.checked = state.publicLog; cb.addEventListener('change', () => { state.publicLog = cb.checked; try { localStorage.setItem(LS.publicLog, cb.checked ? '1' : '0'); } catch (e) {} renderLog(); }); }
  }
  {
    const cb = $('diag-log');
    if (cb) { cb.checked = false; cb.addEventListener('change', () => { state.diag = cb.checked; log(state.diag ? 'diagnostics on' : 'diagnostics off', 'log-rx'); }); }
  }
  {
    const dlg = $('confirm');
    const done = (go) => { if (dlg && dlg.close) dlg.close(); const cb = confirmCb; confirmCb = null; if (go && cb) cb(); };
    { const b = $('confirm-yes'); if (b) b.addEventListener('click', () => done(true)); }
    { const b = $('confirm-no'); if (b) b.addEventListener('click', () => done(false)); }
    { const b = $('confirm-x'); if (b) b.addEventListener('click', () => done(false)); }
  }
  setStatus(profile().ble ? 'disconnected' : 'no-ble');
  logHeader();
  runSelfTest();
});
