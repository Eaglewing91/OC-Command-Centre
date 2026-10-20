// ==UserScript==
// @name         OC Command Centre
// @namespace    https://www.torn.com/profiles.php?XID=571041
// @version      4.1.1
// @description  Organized crime toolkit for Torn factions: CPR rules and Join blocking on the crimes page for every member, plus a live OC dashboard, reports, item costs and OC BREACH alerts for leaders.
// @author       Eaglewing [571041]
// @homepageURL  https://github.com/Eaglewing91/OC-Command-Centre
// @supportURL   https://github.com/Eaglewing91/OC-Command-Centre/issues
// @updateURL    https://raw.githubusercontent.com/Eaglewing91/OC-Command-Centre/main/OC-Command-Centre.user.js
// @downloadURL  https://raw.githubusercontent.com/Eaglewing91/OC-Command-Centre/main/OC-Command-Centre.user.js
// @match        https://www.torn.com/*
// @grant        GM.xmlHttpRequest
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.registerMenuCommand
// @grant        GM.notification
// @connect      api.torn.com
// @connect      tornprobability.com
// @run-at       document-idle
// @noframes
// @license      MIT
// ==/UserScript==

// OC Command Centre
// Copyright (c) 2026 Eaglewing [571041]. Released under the MIT licence (see LICENSE).
//
// Credits
// Created by Eaglewing [571041].
// With thanks to Flamer, Allenone, Verboten, Darrelia, Kohnago, pawl, Qfiffle,
// JohnNash, callmericky [3299880] and whatdoesthespacebardo, whose earlier
// work this script builds on. MIT-licensed work is used under its licence and
// its copyright remains with its authors. Role weights and estimated success
// use Allenone's Torn Probability (tornprobability.com).
// Please keep these credits when sharing or adapting this script.
//
// Works in Tampermonkey, Violentmonkey and Torn PDA. In Torn PDA there is no
// userscript menu, so members open the CPR settings from the crimes-page card.
//
// Torn scripting rules: this script only uses the Torn API (api.torn.com) and
// the page you are viewing. It never clicks, joins, leaves or submits anything
// for you and makes no non-API requests to Torn. Only API calls run on a timer.
// Newsletter auto-import only reads a faction newsletter you open yourself on
// messages.php (the page you are viewing). It makes no requests, reads no other
// mail, and keeps only the settings code and the sender's name/ID, saved locally.
//
// Terms of Service
// - Data Storage: Only locally. Key, settings, CPR rules, hidden members, price
//   caches and alert state are kept in your userscript manager; join-tracking
//   history is kept in this browser's storage. Nothing is stored elsewhere.
// - Data Sharing: Nobody. Role weights are downloaded from tornprobability.com
//   without sending anything about you. Optional and off by default: if a leader
//   turns on Estimated success, OC names and slot pass rates (open slots counted
//   at the minimum CPR) are sent to tornprobability.com.
// - Purpose of Use: Non-malicious statistical analysis and public community
//   tools (faction OC management and item cost audit).
// - Key Storage & Sharing: Stored / used only for automation (live refresh and
//   breach checks). Kept locally and sent only to api.torn.com, in the request
//   header. Regular members do not need a key.
// - Key Access Level: Custom: Minimal with Faction API access. Selections:
//   faction basic, members, crimes; torn items.

(function () {
    'use strict';
    const VERSION = '4.1.1';
    const NAME = 'OC Command Centre';
    // Local, per-userscript storage prefix. No API key is bundled in this file.
    const PREFIX = 'eaglewing_oc_command_centre_v1_';
    const API = 'https://api.torn.com/v2/';
    const TP_API = 'https://tornprobability.com:3000/';
    const OUTCOME_START = Date.UTC(2025, 6, 26) / 1000;
    const EXECUTION_START = Date.UTC(2025, 0, 15) / 1000;
    const PRICE_TTL = 6 * 60 * 60 * 1000;
    const LIVE_TTL = 60 * 1000;
    const COMPLETED_STATUSES = ['successful', 'failure', 'failed'];
    const DEFAULT_SETTINGS = { lowPass: 50, inactiveHours: 96, lastOcWarnHours: 24, lastOcAlertHours: 48,
        ignored: [], successChance: false, cardPos: 'top', cardCompact: true, autoRefresh: true,
        breachAlerts: true, breachDesktop: false, breachMinutes: 5, breachItems: true, breachAway: true, launcherEverywhere: false, rules: null,
        onPage: true, hideDeclined: true, moveEmpty: true, joinPolicy: 'auto', blockJoins: true, tpWeights: true, scope: null };

    // ── CPR rules ─────────────────────────────────────────────────────────
    // No faction's rules are built in. An admin sets the rules in CPR settings
    // and shares them as a settings code; members import that code.
    // Rules: { createdAt, joinPolicy, waitLimit, scopeBelow,
    //          ocs: { name: { all, declined, deprioritise, roles: { ROLE: { min, max, late, exception } } } } }
    //   joinPolicy: the faction uses the joining policy; waitLimit: an OC may be joined
    //   while at most this many members have not started planning; scopeBelow: when the
    //   faction's scope is below this, join the established OC with the least planning
    //   left (null = off); deprioritise: list this OC last when starting new ones;
    //   declined ("Hide crime"): nobody should join; hidden on the crimes page while
    //   empty, shown with a red overlay (and Join blocked, breach alert) if someone joins
    //   late:      the role's maximum is lifted when the OC is under 48 hours from initiation
    //   exception: the role may be joined regardless of the joining policy, if the CPR fits
    // OC difficulty levels (Torn wiki), used to group OCs in Settings.
    const OC_LEVELS = {
        1: ['First Aid and Abet', 'Mob Mentality', 'Pet Project'],
        2: ['Thou Shalt Not Steal', 'Cash Me If You Can', 'Best of the Lot'],
        3: ['Smoke and Wing Mirrors', 'Market Forces', 'Gaslight the Way'],
        4: ['Snow Blind', 'Plucking the Lotus Petal', 'Stage Fright'],
        5: ['Guardian Ángels', 'Honey Trap', 'Counter Offer', 'No Reserve'],
        6: ['Bidding War', 'Leave No Trace', 'Dish It Out', 'Sneaky Git Grab'],
        7: ['Blast from the Past', 'Window of Opportunity', 'Cleared for Takeoff'],
        8: ['Break the Bank', 'Ship Happens', 'Clinical Precision', 'Stacking the Deck', 'Lock Stock', 'Manifest Cruelty'],
        9: ['Ace in the Hole', 'Gone Fission', 'Hostile Takeover'],
        10: ['Crane Reaction'],
    };
    // Known roles per OC (Torn data, used to pre-fill the editor).
    const OC_ROLES = {
        "Gaslight the Way": ["LOOTER #1", "LOOTER #2", "LOOTER #3", "IMITATOR #1", "IMITATOR #2", "IMITATOR #3"],
        "Stage Fright": ["MUSCLE #1", "MUSCLE #2", "MUSCLE #3", "ENFORCER", "LOOKOUT", "SNIPER"],
        "Bidding War": ["ROBBER #1", "BOMBER #1", "ROBBER #2", "ROBBER #3", "BOMBER #2", "DRIVER"],
        "Dish It Out": ["ASSASSIN", "MUSCLE", "SABOTEUR #1", "SABOTEUR #2", "ENGINEER"],
        "Sneaky Git Grab": ["IMITATOR", "PICKPOCKET", "HACKER", "TECHIE"],
        "Blast from the Past": ["PICKLOCK #1", "HACKER", "ENGINEER", "BOMBER", "MUSCLE", "PICKLOCK #2"],
        "Window of Opportunity": ["ENGINEER", "LOOTER #1", "LOOTER #2", "MUSCLE #1", "MUSCLE #2"],
        "Cleared for Takeoff": ["IMITATOR", "TECHIE", "PICKPOCKET", "LOOKOUT", "ASSASSIN", "INTERROGATOR"],
        "Break the Bank": ["THIEF #1", "MUSCLE #2", "MUSCLE #3", "ROBBER", "THIEF #2", "MUSCLE #1"],
        "Clinical Precision": ["ASSASSIN", "CAT BURGLAR", "CLEANER", "IMITATOR"],
        "Stacking the Deck": ["DRIVER", "CAT BURGLAR", "HACKER", "IMITATOR"],
        "Lock Stock": ["ASSASSIN", "SMUGGLER", "HACKER", "MUSCLE #1", "MUSCLE #2"],
        "Ship Happens": ["INTERROGATOR", "SPY", "HUSTLER", "ENGINEER", "ASSASSIN"],
        "Manifest Cruelty": ["HACKER", "INTERROGATOR", "REVIVER", "CAT BURGLAR"],
        "Ace in the Hole": ["IMITATOR", "MUSCLE #1", "MUSCLE #2", "HACKER", "DRIVER"],
        "Gone Fission": ["BOMBER", "HIJACKER", "ENGINEER", "PICKPOCKET", "IMITATOR"],
        "Hostile Takeover": ["HACKER", "ENGINEER", "CAT BURGLAR", "KIDNAPPER", "NEGOTIATOR", "MUSCLE"],
        "Crane Reaction": ["SNIPER", "LOOKOUT", "ENGINEER", "BOMBER", "MUSCLE #1", "MUSCLE #2"],
    };
    const DECLINED_CPR = 101;
    const normalize = str => String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const validCpr = x => Number.isInteger(x) && x >= 0 && x <= DECLINED_CPR;
    const emptyRules = () => ({ createdAt: 0, joinPolicy: false, waitLimit: 1, scopeBelow: null, ocs: {} });

    function cleanRules(raw) {
        const out = emptyRules();
        if (!raw || typeof raw !== 'object') return out;
        out.createdAt = Number.isSafeInteger(raw.createdAt) && raw.createdAt > 0 ? raw.createdAt : 0;
        out.joinPolicy = raw.joinPolicy === true;
        out.waitLimit = Number.isInteger(raw.waitLimit) && raw.waitLimit >= 0 && raw.waitLimit <= 9 ? raw.waitLimit : 1;
        out.scopeBelow = Number.isInteger(raw.scopeBelow) && raw.scopeBelow >= 1 && raw.scopeBelow <= 999 ? raw.scopeBelow : null;
        const ocs = raw.ocs && typeof raw.ocs === 'object' ? raw.ocs : {};
        for (const [name, entry] of Object.entries(ocs).slice(0, 200)) {
            const ocName = String(name).trim().slice(0, 60);
            if (!ocName || !entry || typeof entry !== 'object') continue;
            const roles = {};
            for (const [role, rule] of Object.entries(entry.roles && typeof entry.roles === 'object' ? entry.roles : {}).slice(0, 20)) {
                const roleName = String(role).trim().toUpperCase().slice(0, 40);
                const min = validCpr(rule?.min) ? rule.min : null, max = validCpr(rule?.max) ? rule.max : null;
                const late = rule?.late === true, exception = rule?.exception === true;
                if (roleName && (min != null || max != null || exception)) roles[roleName] = { min, max, late, exception };
            }
            out.ocs[ocName] = { all: validCpr(entry.all) ? entry.all : null, declined: entry.declined === true || entry.hidden === true, deprioritise: entry.deprioritise === true, roles };
        }
        return out;
    }
    const rulesActive = rules => !!rules && Object.keys(rules.ocs || {}).length > 0;
    function ocRule(rules, ocName) {
        const k = Object.keys(rules?.ocs || {}).find(name => normalize(name) === normalize(ocName));
        return k ? rules.ocs[k] : null;
    }
    // Requirement for one role, or null when the rules say nothing about it
    // (OCs without rules are not checked). Returns { min, max, source, waived }.
    function cprRequirement(rules, ocName, role, hoursToReady) {
        if (!rulesActive(rules)) return null;
        const entry = ocRule(rules, ocName);
        if (!entry) return null;
        if (entry.declined) return { min: DECLINED_CPR, max: null, source: 'rules' };
        const rule = entry.roles?.[String(role || '').toUpperCase()];
        if (rule && (rule.min != null || rule.max != null)) {
            const waived = rule.late && rule.max != null && hoursToReady != null && Number.isFinite(hoursToReady) && hoursToReady < 48;
            return { min: rule.min ?? entry.all ?? 0, max: waived ? null : rule.max, source: 'rules', waived };
        }
        if (entry.all != null) return { min: entry.all, max: null, source: 'rules' };
        return null;
    }
    const isExceptionRule = (rules, ocName, role) => ocRule(rules, ocName)?.roles?.[String(role || '').toUpperCase()]?.exception === true;

    // ── Settings codes ────────────────────────────────────────────────────
    // OCC1.<p|z>.<base64url data>.<checksum>. "z" data is deflate-compressed.
    // The checksum catches codes that were cut short or changed.
    const CODE_PREFIX = 'OCC1';
    function toBase64Url(bytes) {
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    function fromBase64Url(text) {
        const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4));
        return Uint8Array.from(bin, ch => ch.charCodeAt(0));
    }
    function checksum(bytes) {
        let h = 0x811c9dc5;
        for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; }
        return h.toString(16).padStart(8, '0');
    }
    async function pipeBytes(bytes, stream) {
        return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
    }
    // First settings code found in a block of text (whitespace and line breaks ignored).
    function findCodeInText(text) {
        const m = String(text || '').replace(/\s+/g, '').match(/OCC1\.[pz]\.[A-Za-z0-9_-]+\.[0-9a-f]{8}/);
        return m ? m[0] : null;
    }
    async function encodeRules(rules) {
        const r = cleanRules(rules);
        const compact = { t: r.createdAt, j: r.joinPolicy ? 1 : 0, w: r.waitLimit, s: r.scopeBelow,
            o: Object.entries(r.ocs).map(([name, e]) => [name, e.all, (e.declined ? 1 : 0) | (e.deprioritise ? 2 : 0),
                Object.entries(e.roles).map(([role, x]) => [role, x.min, x.max, (x.late ? 1 : 0) | (x.exception ? 2 : 0)])]) };
        const bytes = new TextEncoder().encode(JSON.stringify(compact));
        let body = bytes, mode = 'p';
        if (typeof CompressionStream === 'function') {
            try { body = await pipeBytes(bytes, new CompressionStream('deflate-raw')); mode = 'z'; } catch (_) { body = bytes; mode = 'p'; }
        }
        return [CODE_PREFIX, mode, toBase64Url(body), checksum(bytes)].join('.');
    }
    async function decodeRules(code) {
        const parts = String(code || '').replace(/\s+/g, '').split('.');
        if (parts.length !== 4 || parts[0] !== CODE_PREFIX || !['p', 'z'].includes(parts[1]) || !/^[A-Za-z0-9_-]+$/.test(parts[2])) {
            throw new Error('This is not an OC Command Centre settings code.');
        }
        let bytes;
        try {
            bytes = fromBase64Url(parts[2]);
            if (parts[1] === 'z') {
                if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot read compressed settings codes. Ask your admin for an uncompressed code.');
                bytes = await pipeBytes(bytes, new DecompressionStream('deflate-raw'));
            }
        } catch (error) {
            throw new Error(/browser cannot/.test(error.message) ? error.message : 'The settings code is damaged. Copy it again.');
        }
        if (checksum(bytes) !== parts[3]) throw new Error('The settings code is incomplete or was changed. Copy it again.');
        let c;
        try { c = JSON.parse(new TextDecoder().decode(bytes)); } catch (_) { throw new Error('The settings code is damaged. Copy it again.'); }
        const ocs = {};
        for (const item of Array.isArray(c?.o) ? c.o : []) {
            if (!Array.isArray(item)) continue;
            const [name, all, declined, roleList] = item, roles = {};
            for (const r of Array.isArray(roleList) ? roleList : []) {
                if (Array.isArray(r)) roles[r[0]] = { min: r[1], max: r[2], late: !!(r[3] & 1), exception: !!(r[3] & 2) };
            }
            ocs[name] = { all, declined: !!(declined & 1) || !!(declined & 4), deprioritise: !!(declined & 2), roles };
        }
        return cleanRules({ createdAt: c?.t, joinPolicy: c?.j === 1,
            waitLimit: c?.w ?? 1, scopeBelow: c?.s ?? null, ocs });
    }

    const sleep = (ms, signal) => new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new Error('Cancelled'));
        const finish = () => { signal?.removeEventListener('abort', cancel); resolve(); };
        const timer = setTimeout(finish, ms);
        const cancel = () => { clearTimeout(timer); reject(new Error('Cancelled')); };
        signal?.addEventListener('abort', cancel, { once: true });
    });
    const validId = x => Number.isSafeInteger(Number(x)) && Number(x) > 0;
    const priceNumber = x => typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null;
    const stamp = x => typeof x === 'number' && Number.isSafeInteger(x) && x > 0 ? x : null;
    const percent = x => typeof x === 'number' && Number.isFinite(x) ? x : null;
    const utcDay = date => date.toISOString().slice(0, 10);
    const timeText = seconds => new Date(seconds * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' TCT';
    const money = n => n == null ? 'Unavailable' : '$' + Math.round(n).toLocaleString('en-US');
    const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

    function duration(seconds) {
        const total = Math.max(0, Math.floor(seconds));
        const d = Math.floor(total / 86400), h = Math.floor(total % 86400 / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
        if (d) return d + 'd ' + h + 'h';
        if (h) return h + 'h ' + String(m).padStart(2, '0') + 'm';
        if (m) return m + 'm ' + String(s).padStart(2, '0') + 's';
        return s + 's';
    }

    function dateRange(start, end, now = Math.floor(Date.now() / 1000)) {
        function parse(s) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('Choose valid start and end dates.');
            const ms = Date.parse(s + 'T00:00:00Z');
            if (!Number.isFinite(ms) || utcDay(new Date(ms)) !== s) throw new Error('Invalid date.');
            return ms / 1000;
        }
        const from = parse(start), endStart = parse(end);
        if (from > endStart) throw new Error('The start date must be before the end date.');
        if (from > now) throw new Error('The start date cannot be in the future.');
        if (from < EXECUTION_START) throw new Error('Execution-date reports begin on 15 January 2025, when Torn started recording executed_at.');
        return { from, to: Math.min(endStart + 86399, now), start, end };
    }

    // ── Item audit ────────────────────────────────────────────────────────
    function makeRecords(crimes, range) {
        // IMPORTANT: Always count all completed OCs independently of item outcomes.
        // A crime with no lost items must still be included in the completed OC count.
        const records = [], seen = new Set();
        let undated = 0, incomplete = 0, outside = 0, selectedCrimes = 0;
        let unknownConsumption = 0, missingOutcomeItemId = 0;
        for (const crime of crimes) {
            if (!validId(crime?.id) || seen.has(Number(crime.id))) continue;
            seen.add(Number(crime.id));
            if (!COMPLETED_STATUSES.includes(String(crime.status).toLowerCase())) continue;
            const when = stamp(crime.executed_at);
            if (when == null) { undated++; continue; }
            if (when < range.from || when > range.to) { outside++; continue; }
            selectedCrimes++;
            if (!Array.isArray(crime.slots)) { incomplete++; continue; }
            crime.slots.forEach((slot, index) => {
                const req = slot?.item_requirement;
                const io = slot?.user?.item_outcome;
                const actualId = validId(io?.item_id) ? Number(io.item_id) : null;
                const requiredId = validId(req?.id) ? Number(req.id) : null;
                const outcome = String(io?.outcome || '').toLowerCase();

                // The API distinguishes lost (explicitly lost) and used (which may
                // be consumable). Do not infer any loss from an item requirement or
                // from missing/unused outcomes.
                if (outcome !== 'lost' && outcome !== 'used') return;
                if (!actualId) { missingOutcomeItemId++; return; }
                const reusable = actualId === requiredId && typeof req?.is_reusable === 'boolean' ? req.is_reusable : null;
                const lost = outcome === 'lost';
                const consumed = outcome === 'used' && reusable === false;
                if (outcome === 'used' && reusable === null) unknownConsumption++;
                if (!lost && !consumed) return; // reusable used items never need replacing

                const owner = ['faction', 'user'].includes(io?.owned_by) ? io.owned_by : 'unknown';
                const note = requiredId && actualId !== requiredId ? 'Outcome item differs from requirement' : '';
                records.push({ crimeId: Number(crime.id), crime: String(crime.name || 'Unnamed OC'), status: String(crime.status),
                    executed: when, slot: String(slot.position_info?.label || slot.position || 'Slot ' + (index + 1)),
                    slotIndex: index, userId: validId(slot.user?.id) ? Number(slot.user.id) : null,
                    itemId: actualId, itemUid: io?.item_uid ?? null, requiredItemId: requiredId,
                    owner, outcome, reason: lost ? 'Lost' : 'Consumed', reusable, note });
            });
        }
        return { records, undated, incomplete, outside, selectedCrimes, unknownConsumption, missingOutcomeItemId };
    }

    function aggregate(records, itemInfo) {
        const map = new Map();
        for (const rec of records) {
            if (rec.reason !== 'Lost' && rec.reason !== 'Consumed') continue;
            if (!map.has(rec.itemId)) map.set(rec.itemId, { id: rec.itemId, name: itemInfo(rec.itemId).name,
                lost: 0, consumed: 0, depleted: 0,
                factionDepleted: 0, userDepleted: 0, unknownDepleted: 0, crimes: new Set() });
            const row = map.get(rec.itemId);
            if (rec.reason === 'Lost') row.lost++;
            else row.consumed++;
            row.depleted++;
            row.crimes.add(rec.crimeId);
            row[rec.owner === 'faction' ? 'factionDepleted' : rec.owner === 'user' ? 'userDepleted' : 'unknownDepleted']++;
        }
        return [...map.values()].map(row => {
            const info = itemInfo(row.id), price = priceNumber(info.price);
            return { ...row, crimes: row.crimes.size, price, source: info.source, pricedAt: info.at,
                cost: price == null ? null : row.depleted * price,
                factionCost: !row.factionDepleted ? 0 : price == null ? null : row.factionDepleted * price };
        });
    }

    // ── Participation ─────────────────────────────────────────────────────
    // Completed OCs per member within the report range. Current members with
    // no OCs are included; people who have since left are marked as former.
    function participation(crimes, range, members) {
        const rows = new Map(), seen = new Set();
        const row = (id, name, current) => {
            if (!rows.has(id)) rows.set(id, { id, name: name || 'Former member', current, total: 0, success: 0, fail: 0, last: null });
            return rows.get(id);
        };
        for (const m of members || []) if (validId(m?.id)) row(Number(m.id), String(m.name || 'ID ' + m.id), true);
        for (const crime of crimes || []) {
            if (!validId(crime?.id) || seen.has(Number(crime.id))) continue;
            seen.add(Number(crime.id));
            const status = String(crime.status).toLowerCase();
            if (!COMPLETED_STATUSES.includes(status)) continue;
            const when = stamp(crime.executed_at);
            if (when == null || when < range.from || when > range.to || !Array.isArray(crime.slots)) continue;
            const counted = new Set();
            for (const slot of crime.slots) {
                const id = validId(slot?.user?.id) ? Number(slot.user.id) : null;
                if (!id || counted.has(id)) continue;
                counted.add(id);
                const r = row(id, null, false);
                r.total++;
                if (status === 'successful') r.success++; else r.fail++;
                if (r.last == null || when > r.last) r.last = when;
            }
        }
        return [...rows.values()];
    }

    // ── Live overview ─────────────────────────────────────────────────────
    function roleLabels(slots) {
        const base = slots.map((slot, i) => String(slot?.position_info?.label || slot?.position || 'Slot ' + (i + 1)));
        const counts = {}, seen = {};
        base.forEach(label => { counts[label] = (counts[label] || 0) + 1; });
        return base.map(label => {
            if (counts[label] < 2 || /#\d+$/.test(label)) return label;
            seen[label] = (seen[label] || 0) + 1;
            return label + ' #' + seen[label];
        });
    }

    function analyseLive(members, crimes, recentCompleted, options, now = Math.floor(Date.now() / 1000)) {
        const lowPass = Number.isFinite(Number(options?.lowPass)) ? Number(options.lowPass) : 50;
        const requirement = typeof options?.requirement === 'function' ? options.requirement : null;
        const itemName = id => (typeof options?.itemName === 'function' && options.itemName(id)) || 'Item #' + id;
        const ignored = new Set((options?.ignored || []).map(Number));
        const memberMap = new Map();
        for (const m of members || []) if (validId(m?.id)) memberMap.set(Number(m.id), m);

        // Latest completed OC per member, from the most recent completed crimes.
        const lastOC = new Map();
        for (const crime of recentCompleted || []) {
            if (!COMPLETED_STATUSES.includes(String(crime?.status).toLowerCase()) || !Array.isArray(crime.slots)) continue;
            const when = stamp(crime.executed_at) ?? stamp(crime.ready_at);
            if (when == null) continue;
            for (const slot of crime.slots) {
                const id = validId(slot?.user?.id) ? Number(slot.user.id) : null;
                if (id && (!lastOC.has(id) || lastOC.get(id) < when)) lastOC.set(id, when);
            }
        }

        const inOC = new Map(), rows = [];
        let openSlots = 0, soonFree = 0;
        for (const crime of crimes || []) {
            const status = String(crime?.status || '');
            if (!validId(crime?.id) || (status !== 'Recruiting' && status !== 'Planning')) continue;
            const slots = Array.isArray(crime.slots) ? crime.slots : [];
            const labels = roleLabels(slots);
            const slotRows = slots.map((slot, i) => {
                const rawId = slot?.user?.id ?? slot?.user_id;
                const userId = validId(rawId) ? Number(rawId) : null;
                const member = userId ? memberMap.get(userId) : null;
                const req = slot?.item_requirement;
                return { role: labels[i], userId,
                    name: member ? String(member.name || 'ID ' + userId) : userId ? 'ID ' + userId : null,
                    memberState: member?.status?.state ? String(member.status.state) : null,
                    memberStatus: member?.status?.description ? String(member.status.description).trim() : '',
                    memberUntil: Number.isFinite(Number(member?.status?.until)) && Number(member.status.until) > 0 ? Number(member.status.until) : null,
                    progress: percent(slot?.user?.progress), joined: stamp(slot?.user?.joined_at), pass: percent(slot?.checkpoint_pass_rate),
                    itemId: validId(req?.id) ? Number(req.id) : null, itemReusable: req?.is_reusable === true,
                    itemAvailable: typeof req?.is_available === 'boolean' ? req.is_available : null };
            });
            const filled = slotRows.filter(s => s.userId);
            const stage = status === 'Planning' ? 'planning' : crime.planning_at ? 'recruiting' : 'new';
            const readyAt = stamp(crime.ready_at), expiresAt = stamp(crime.expired_at);
            const hoursToReady = readyAt != null ? (readyAt - now) / 3600 : null;
            if (requirement) for (const s of slotRows) s.req = requirement(String(crime.name || ''), s.role, hoursToReady);
            const timer = stage === 'planning' ? { label: 'Ready', late: 'Delayed', at: readyAt }
                : stage === 'recruiting' ? { label: 'Needs member', late: 'Stalled', at: readyAt }
                : { label: 'Expires', late: 'Expired', at: expiresAt };
            const issues = [];
            const issue = (type, severity, title, items = []) => issues.push({ type, severity, title, items,
                text: title + (items.length ? ': ' + items.join('; ') : '') });
            const late = stage !== 'new' && readyAt != null && readyAt <= now;
            if (late && stage === 'recruiting') issue('stalled', 3, 'Stalled: needs members');
            if (late && stage === 'planning') issue('delayed', 2, 'Delayed: waiting to start');
            const away = stage === 'planning' && (late || (readyAt != null && readyAt - now <= 3600))
                ? filled.filter(s => awayAtStart(s, readyAt, now)) : [];
            if (away.length) issue('away', 2, 'Unavailable', away.map(s => s.name + ' (' + s.role + ') ' + (s.memberStatus || s.memberState)));
            for (const s of slotRows) if (s.itemId) s.itemName = itemName(s.itemId);
            const missing = filled.filter(s => s.itemId && s.itemAvailable === false);
            if (missing.length) issue('item', 2, 'Missing item', missing.map(s => s.name + ' (' + s.role + '): ' + s.itemName));
            const who = s => s.name + ' (' + s.role + ') ' + s.pass;
            if (requirement) {
                const declined = filled.filter(s => s.req && s.req.min >= DECLINED_CPR);
                const below = filled.filter(s => s.pass != null && s.req && s.req.min < DECLINED_CPR && s.pass < s.req.min);
                const above = filled.filter(s => s.pass != null && s.req && s.req.max != null && s.pass > s.req.max);
                if (declined.length) issue('declined', 2, 'Hidden crime, joined by', declined.map(s => s.name + ' (' + s.role + ')'));
                if (below.length) issue('pass', 2, 'Below CPR', below.map(s => who(s) + ', needs ' + s.req.min));
                if (above.length) issue('over', 1, 'Above CPR max', above.map(s => who(s) + ', max ' + s.req.max));
            } else {
                const low = filled.filter(s => s.pass != null && s.pass < lowPass);
                if (low.length) issue('pass', 1, 'Low pass rate', low.map(who));
            }
            // Joining policy (only if the faction uses one): the latest joiner arrived while more
            // earlier members than the wait limit were still at 0% planning. Same check as the
            // LAST JOIN banner on the crimes page.
            const policy = options?.earlyJoin;
            if (policy && filled.length >= 2) {
                const times = filled.map(s => s.joined).filter(t => t != null);
                if (times.length === filled.length) {
                    const latestAt = Math.max(...times), latest = filled.filter(s => s.joined === latestAt);
                    const earlierZero = filled.filter(s => s.joined < latestAt && s.progress === 0).length;
                    if (latest.length === 1 && earlierZero > policy.waitLimit && !policy.isException(String(crime.name || ''), latest[0].role)) {
                        const when = new Date(latestAt * 1000).toISOString().slice(0, 16).replace('T', ' ');
                        issue('early', 2, 'Possible early join', [latest[0].name + ' (' + latest[0].role + ') joined ' + when + ' TCT, ' + earlierZero + ' earlier members not planning']);
                    }
                }
            }
            if (stage === 'new' && expiresAt != null && expiresAt > now && expiresAt - now <= 86400) {
                issue('expiring', 1, 'Expires within 24h');
            }
            for (const s of filled) inOC.set(s.userId, { crimeId: Number(crime.id), crime: String(crime.name || 'OC'), stage, readyAt });
            openSlots += slotRows.length - filled.length;
            if (stage === 'planning' && readyAt != null && readyAt - now <= 86400) soonFree += filled.length;
            rows.push({ id: Number(crime.id), name: String(crime.name || 'Unnamed OC'), level: Number(crime.difficulty) || null,
                stage, readyAt, slots: slotRows, filled: filled.length, size: slotRows.length, timer, issues,
                severity: issues.reduce((max, issue) => Math.max(max, issue.severity), 0) });
        }
        rows.sort((a, b) => b.severity - a.severity || (a.timer.at ?? Infinity) - (b.timer.at ?? Infinity) || a.id - b.id);

        const free = [];
        let recruits = 0, fallen = 0, hidden = 0;
        for (const [id, m] of memberMap) {
            if (m?.status?.state === 'Fallen') { fallen++; continue; }
            if (m?.position === 'Recruit') { recruits++; continue; }
            if (inOC.has(id)) continue;
            if (ignored.has(id)) { hidden++; continue; }
            free.push({ id, name: String(m.name || 'ID ' + id), state: String(m?.status?.state || 'Unknown'),
                statusText: String(m?.status?.description || ''), lastAction: stamp(m?.last_action?.timestamp),
                lastOC: lastOC.get(id) ?? null });
        }
        return { crimes: rows, free, inOC, lastOC, openSlots, soonFree, recruits, fallen, hidden,
            members: memberMap.size - fallen - recruits, active: inOC.size,
            attention: rows.filter(r => r.severity >= 2).length };
    }

    // Policy breaches in a live analysis: a member below their role's minimum,
    // above its maximum, or in an OC the faction declines. One entry per member.
    // Optional extra alerts (no rules needed) for an OC due to start within the
    // hour: a member missing their item, or a member who is not available.
    const SOON_SECONDS = 3600;
    function startsText(readyAt, now) {
        const left = readyAt - now;
        return left <= 0 ? 'is due to start now' : 'starts in ' + Math.max(1, Math.round(left / 60)) + 'm';
    }
    // A member counts as unavailable only if they will still be away when the OC
    // is due to start (5-minute margin). Hospital and jail give an end time; travel
    // does not, so travelling members always count.
    const AWAY_MARGIN = 300;
    function awayAtStart(s, readyAt, now) {
        if (!s?.memberState || s.memberState === 'Okay') return false;
        if (s.memberUntil == null || readyAt == null) return true;
        return s.memberUntil + AWAY_MARGIN > Math.max(readyAt, now);
    }
    function findBreaches(analysis, options = {}, now = Math.floor(Date.now() / 1000)) {
        const { cpr = true, items = false, away = false } = options;
        const out = [];
        for (const crime of analysis?.crimes || []) {
            const soon = crime.stage === 'planning' && crime.readyAt != null && crime.readyAt - now <= SOON_SECONDS;
            for (const s of crime.slots) {
                if (!s.userId || !soon) continue;
                const base = { crimeId: crime.id, crime: crime.name, userId: s.userId, name: s.name, role: s.role, pass: s.pass };
                if (items && s.itemId && s.itemAvailable === false) out.push({ ...base, type: 'item', key: crime.id + ':' + s.userId + ':item:' + s.itemId,
                    text: 'Missing item: ' + s.name + ' (' + s.role + ') needs ' + (s.itemName || 'Item #' + s.itemId) + ', ' + crime.name + ' ' + startsText(crime.readyAt, now) });
                if (away && awayAtStart(s, crime.readyAt, now)) out.push({ ...base, type: 'away', key: crime.id + ':' + s.userId + ':away:' + s.memberState,
                    text: 'Unavailable: ' + s.name + ' (' + s.role + ') ' + (s.memberStatus || s.memberState) + ', ' + crime.name + ' ' + startsText(crime.readyAt, now) });
            }
            if (!cpr) continue;
            for (const s of crime.slots) {
                if (!s.userId || !s.req) continue;
                const base = { crimeId: crime.id, crime: crime.name, userId: s.userId, name: s.name, role: s.role, pass: s.pass };
                if (s.req.min >= DECLINED_CPR) out.push({ ...base, type: 'declined', key: crime.id + ':' + s.userId + ':declined',
                    text: s.name + ' joined ' + crime.name + ' (' + s.role + '), a hidden crime' });
                else if (s.pass != null && s.pass < s.req.min) out.push({ ...base, type: 'below', key: crime.id + ':' + s.userId + ':below',
                    text: s.name + ' (' + s.role + ') ' + s.pass + ' in ' + crime.name + ', needs ' + s.req.min });
                else if (s.pass != null && s.req.max != null && s.pass > s.req.max) out.push({ ...base, type: 'above', key: crime.id + ':' + s.userId + ':above',
                    text: s.name + ' (' + s.role + ') ' + s.pass + ' in ' + crime.name + ', max ' + s.req.max });
            }
        }
        return out;
    }

    // Inputs for a Torn Probability estimate, in that scenario's role order
    // (matched by role name, e.g. "Picklock 1" = "PICKLOCK #1"). Filled slots use
    // the member's pass rate; open slots use the role's minimum CPR from the
    // rules, which makes the estimate a projection. Returns { params, projected }
    // or { reason } when it cannot be estimated.
    function chanceInput(crime, model, rules) {
        if (!model) return { reason: 'Torn Probability does not support this crime' };
        const params = [];
        let projected = false;
        for (const role of model.order) {
            const slot = crime.slots.find(s => normalize(s.role) === role);
            if (!slot) return { reason: 'Role names do not match Torn Probability' };
            if (slot.userId) {
                if (slot.pass == null) return { reason: 'A pass rate is missing' };
                params.push(slot.pass);
                continue;
            }
            const req = cprRequirement(rules, crime.name, slot.role, null);
            if (!req || !(req.min > 0) || req.min >= DECLINED_CPR) return { reason: 'An open role has no minimum CPR to project with' };
            params.push(req.min);
            projected = true;
        }
        return { params, projected };
    }

    // What changed between two rule sets, as short lines for members.
    function diffRules(before, after) {
        const a = cleanRules(before), b = cleanRules(after), lines = [];
        const roleName = r => String(r).toLowerCase().replace(/(^|[\s#])([a-z])/g, (m, p, c) => p + c.toUpperCase());
        const val = v => v == null ? '—' : String(v);
        if (!rulesActive(a)) {
            const names = Object.keys(b.ocs), hidden = names.filter(n => b.ocs[n].declined).length;
            return rulesActive(b) ? ['First CPR rules: ' + names.length + ' OCs (' + hidden + ' hidden)' + (b.joinPolicy ? ', joining policy on' : '')] : [];
        }
        if (!rulesActive(b)) return ['All CPR rules removed'];
        if (!!a.joinPolicy !== !!b.joinPolicy) lines.push('Joining policy turned ' + (b.joinPolicy ? 'on' : 'off'));
        if (b.joinPolicy && a.joinPolicy) {
            if (a.waitLimit !== b.waitLimit) lines.push('Joining policy wait limit ' + val(a.waitLimit) + ' → ' + val(b.waitLimit));
            if (a.scopeBelow !== b.scopeBelow) lines.push('Low-scope fallback ' + val(a.scopeBelow) + ' → ' + val(b.scopeBelow));
        }
        const key = name => normalize(name);
        const oldByKey = new Map(Object.keys(a.ocs).map(n => [key(n), a.ocs[n]]));
        const newKeys = new Set(Object.keys(b.ocs).map(key));
        for (const name of Object.keys(b.ocs).sort()) {
            const o = oldByKey.get(key(name)), n = b.ocs[name];
            if (!o) { lines.push(name + ': ' + (n.declined ? 'now hidden' : 'new rules added')); continue; }
            if (o.declined !== n.declined) { lines.push(name + ': ' + (n.declined ? 'now hidden' : 'no longer hidden')); if (n.declined) continue; }
            if (n.declined) continue;
            const parts = [];
            if (o.all !== n.all) parts.push('all roles ' + val(o.all) + ' → ' + val(n.all));
            if (o.deprioritise !== n.deprioritise) parts.push(n.deprioritise ? 'now started last' : 'no longer started last');
            const roles = new Set([...Object.keys(o.roles), ...Object.keys(n.roles)]);
            for (const role of [...roles].sort()) {
                const x = o.roles[role] || {}, y = n.roles[role] || {};
                if ((x.min ?? null) !== (y.min ?? null)) parts.push(roleName(role) + ' ' + val(x.min) + ' → ' + val(y.min));
                if ((x.max ?? null) !== (y.max ?? null)) parts.push(roleName(role) + ' max ' + val(x.max) + ' → ' + val(y.max));
                if (!!x.late !== !!y.late) parts.push(roleName(role) + ' no max <48h ' + (y.late ? 'on' : 'off'));
                if (!!x.exception !== !!y.exception) parts.push(roleName(role) + ' exception ' + (y.exception ? 'on' : 'off'));
            }
            if (parts.length) lines.push(name + ': ' + parts.join(', '));
        }
        for (const name of Object.keys(a.ocs).sort()) if (!newKeys.has(key(name))) lines.push(name + ': ' + (a.ocs[name].declined ? 'no longer hidden (rules removed)' : 'rules removed'));
        return lines;
    }

    function csvCell(value) {
        let s = String(value ?? '');
        // Prevent spreadsheet formula injection, including leading whitespace.
        if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
        return '"' + s.replace(/"/g, '""') + '"';
    }
    const csv = rows => '﻿' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
    function unitPriceFromTT(text) {
        // TornTools writes "$unit | Nx = $total" for stacks and "$unit" for single items.
        // Do not guess shortened values (e.g. "$1.2m") or confuse a total with a unit price.
        const t = String(text).trim();
        const match = t.match(/^\$([\d,]+(?:\.\d{1,2})?)\s*(?:\|\s*\d+x\s*=\s*\$[\d,.]+)?$/i);
        if (!match) return null;
        return priceNumber(Number(match[1].replace(/,/g, '')));
    }

    async function fetchHistory(request, range, signal, progress) {
        const crimes = new Map();
        const windows = [{ from: range.from, to: range.to }];
        let requests = 0;
        async function page(from, to, offset = 0) {
            if (signal?.aborted) throw new Error('Cancelled');
            if (requests >= 500) throw new Error('Request safety limit reached; report is partial. Use a shorter range.');
            const parameters = { cat: 'completed', filters: 'executed_at', from, to, sort: 'DESC', limit: 100 };
            // Normal history retrieval does not rely on offsets. They are only needed if
            // at least 100 crimes share one exact second, which cannot be split further.
            if (offset) parameters.offset = offset;
            requests++;
            const data = await request('faction/crimes', parameters, signal);
            if (!Array.isArray(data?.crimes)) throw new Error('Torn did not return a crimes array.');
            const rows = data.crimes;
            if (rows.some(crime => !validId(crime?.id))) throw new Error('Crime records have missing IDs; report would be incomplete.');
            if (new Set(rows.map(crime => Number(crime.id))).size !== rows.length) throw new Error('Torn returned duplicate crime IDs within a page.');
            // Reject ignored date filters rather than reporting a false complete result.
            if (rows.some(crime => stamp(crime.executed_at) == null || crime.executed_at < from || crime.executed_at > to)) {
                throw new Error('Torn returned crimes outside the requested execution-time window. Date filtering was not respected; report is partial.');
            }
            for (const crime of rows) crimes.set(Number(crime.id), crime);
            progress(requests, crimes.size);
            return rows;
        }
        try {
            while (windows.length) {
                const window = windows.pop();
                const rows = await page(window.from, window.to);
                if (rows.length < 100) continue;
                if (window.from < window.to) {
                    // Full windows may hide older records. Split into disjoint inclusive
                    // halves and verify both. No second is dropped at a page boundary.
                    const midpoint = window.from + Math.floor((window.to - window.from) / 2);
                    windows.push({ from: window.from, to: midpoint });
                    windows.push({ from: midpoint + 1, to: window.to });
                    continue;
                }
                let offset = rows.length;
                const sameSecond = new Set(rows.map(crime => Number(crime.id)));
                while (true) {
                    const more = await page(window.from, window.to, offset);
                    if (!more.length) break;
                    let added = 0;
                    for (const crime of more) if (!sameSecond.has(Number(crime.id))) {
                        sameSecond.add(Number(crime.id)); added++;
                    }
                    if (!added) throw new Error('At least 100 OCs share one execution second and Torn repeated its offset page. That second cannot be fully verified; report is partial.');
                    if (more.length < 100) break;
                    offset += more.length;
                }
            }
            return [...crimes.values()].sort((a, b) => b.executed_at - a.executed_at || Number(b.id) - Number(a.id));
        } catch (error) {
            error.partial = [...crimes.values()];
            throw error;
        }
    }

    const core = { dateRange, makeRecords, aggregate, participation, analyseLive, roleLabels, duration, cprRequirement, chanceInput, diffRules, cleanRules, rulesActive, encodeRules, decodeRules, findCodeInText, findBreaches,
        unitPriceFromTT, csv, csvCell, fetchHistory, priceNumber };
    if (typeof module !== 'undefined' && module.exports) { module.exports = core; return; }

    // ══ Runtime ═══════════════════════════════════════════════════════════
    // Userscript manager adapter. Tampermonkey and Violentmonkey provide GM.*;
    // older managers provide GM_*; Torn PDA provides GM.* through its built-in
    // GMforPDA layer, or PDA_httpGet/PDA_httpPost in older versions. Requests
    // only ever go to api.torn.com and tornprobability.com either way.
    const G = typeof GM !== 'undefined' && GM ? GM : {};
    const isPDA = typeof window.flutter_inappwebview !== 'undefined' || typeof window.PDA_httpGet === 'function';
    // Last-resort storage (no userscript storage at all, e.g. very old Torn PDA).
    // The API key is never written to the page's localStorage, where other scripts
    // on torn.com could read it: it is kept in memory for this session only.
    const memoryOnly = new Map(), isSecret = k => /_key$/.test(k);
    const lsGet = (k, d) => { if (isSecret(k)) return memoryOnly.has(k) ? memoryOnly.get(k) : d; try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } };
    const lsSet = (k, v) => { if (isSecret(k)) { memoryOnly.set(k, v); return; } localStorage.setItem(k, JSON.stringify(v)); };
    const gmGet = typeof G.getValue === 'function' ? (k, d) => G.getValue(k, d)
        : typeof GM_getValue === 'function' ? async (k, d) => GM_getValue(k, d) : async (k, d) => lsGet(k, d);
    const gmSet = typeof G.setValue === 'function' ? (k, v) => G.setValue(k, v)
        : typeof GM_setValue === 'function' ? async (k, v) => GM_setValue(k, v) : async (k, v) => lsSet(k, v);
    function pdaRequest(o) {
        let done = false;
        const end = (fn, value) => { if (done) return; done = true; clearTimeout(timer); fn?.(value); };
        const timer = setTimeout(() => end(o.ontimeout), o.timeout || 30000);
        const call = String(o.method).toUpperCase() === 'POST' ? window.PDA_httpPost(o.url, o.headers || {}, o.data ?? '') : window.PDA_httpGet(o.url, o.headers || {});
        Promise.resolve(call).then(r => end(o.onload, { status: Number(r?.status) || 0, responseText: String(r?.responseText ?? '') }), () => end(o.onerror));
        return { abort: () => end(o.onabort) };
    }
    const gmRequest = typeof G.xmlHttpRequest === 'function' ? o => G.xmlHttpRequest(o)
        : typeof GM_xmlhttpRequest === 'function' ? o => GM_xmlhttpRequest(o)
        : typeof window.PDA_httpGet === 'function' ? pdaRequest
        : () => { throw new Error('Your userscript manager cannot make API requests.'); };
    // Torn PDA shows notifications as blocking dialogs, so the in-page alert is used there instead.
    const gmNotify = isPDA ? null : typeof G.notification === 'function' ? o => G.notification(o) : typeof GM_notification === 'function' ? o => GM_notification(o) : null;
    const gmMenu = typeof G.registerMenuCommand === 'function' ? (n, f) => G.registerMenuCommand(n, f)
        : typeof GM_registerMenuCommand === 'function' ? (n, f) => GM_registerMenuCommand(n, f) : null;

    let key = '', catalog = { at: 0, items: {} }, ttPrices = {}, preferTT = true, settings = { ...DEFAULT_SETTINGS };
    let report = null, busy = false, controller = null, lastRequest = 0, detailPage = 0;
    let host, root, panel, launcher, cardHost, cardRoot;
    let sortBy = 'cost', sortDirection = -1, currentView = 'live', launcherPos = 'hidden';
    let partSort = { by: 'total', dir: -1 }, freeSort = { by: 'lastOC', dir: 1 }, stageFilter = 'all';
    let liveRaw = null, live = null, liveBusy = false, liveError = '', liveFetchedAt = 0;
    let scenarios = null, chancesBusy = false;
    const chances = new Map(), expanded = new Set();
    // 'hidden' (the default) removes the floating button; open from the crimes card, an alert or the userscript menu.
    const LAUNCHER_POSITIONS = ['hidden', 'bottom-right', 'bottom-left', 'middle-right'];
    const REPORT_VIEWS = ['overview', 'participation', 'costs', 'activity'];
    const VIEWS = ['live', ...REPORT_VIEWS, 'cpr', 'settings'];
    const read = async (name, fallback) => {
        try { return await gmGet(PREFIX + name, fallback); } catch (_) { return fallback; }
    };
    // GM storage belongs to the userscript manager in this browser profile.
    const save = (name, value) => gmSet(PREFIX + name, value);
    const $ = selector => root.querySelector(selector);
    const nowSec = () => Math.floor(Date.now() / 1000);
    function message(text, bad = false) { $('#status-text').textContent = text; $('#status').classList.toggle('bad', bad); }
    function safeError(error) { return String(error?.message || 'Unknown error').split(key || '\u0000').join('[key redacted]'); }
    function info(id) {
        const item = catalog.items?.[id], tt = ttPrices[id];
        const freshTT = preferTT && tt && Date.now() - tt.at < PRICE_TTL && priceNumber(tt.price) != null;
        const freshAPI = Date.now() - catalog.at < PRICE_TTL && priceNumber(item?.price) != null;
        return { name: item?.name || 'Item #' + id,
            price: freshTT ? tt.price : freshAPI ? item.price : null,
            source: freshTT ? 'TornTools visible price' : freshAPI ? 'Torn API market value' : 'Unavailable / expired',
            at: freshTT ? tt.at : freshAPI ? catalog.at : null };
    }

    // One queue for every Torn API call, so the live view and a running report
    // never fire requests closer together than 2.1 seconds.
    let apiGate = Promise.resolve();
    function waitTurn(signal) {
        const turn = apiGate.then(async () => {
            await sleep(Math.max(0, 2100 - (Date.now() - lastRequest)), signal);
            lastRequest = Date.now();
        });
        apiGate = turn.catch(() => {});
        return turn;
    }
    async function apiRequest(path, parameters = {}, signal) {
        if (!/^[A-Za-z0-9/,]+$/.test(path)) throw new Error('Invalid API path.');
        for (let attempt = 0; attempt < 4; attempt++) {
            if (signal?.aborted) throw new Error('Cancelled');
            await waitTurn(signal);
            if (signal?.aborted) throw new Error('Cancelled');
            const url = new URL(API + path);
            Object.entries({ ...parameters, comment: 'Eaglewing OC Command Centre' }).forEach(([k, v]) => url.searchParams.set(k, v));
            const response = await new Promise((resolve, reject) => {
                let handle, ended = false;
                const finish = (fn, result) => {
                    if (ended) return; ended = true;
                    signal?.removeEventListener('abort', abort); fn(result);
                };
                const abort = () => { try { handle?.abort(); } catch (_) {} finish(reject, new Error('Cancelled')); };
                signal?.addEventListener('abort', abort, { once: true });
                try {
                    handle = gmRequest({ method: 'GET', url: url.href,
                        headers: { Authorization: 'ApiKey ' + key }, timeout: 25000,
                        onload: r => finish(resolve, r), onerror: () => finish(reject, new Error('API connection failed.')),
                        ontimeout: () => finish(reject, new Error('API request timed out.')), onabort: () => finish(reject, new Error('Cancelled')) });
                } catch (_) { finish(reject, new Error('API request could not start.')); }
            });
            let data = null, invalidJSON = false;
            try { data = JSON.parse(response.responseText); } catch (_) { invalidJSON = true; }
            const code = Number(data?.error?.code);
            // 5 = rate limited, 17 = temporary Torn backend error: both are worth retrying.
            const retry = response.status === 429 || code === 5 || code === 17 || (response.status >= 500 && response.status <= 599);
            if (retry && attempt < 3) {
                const seconds = code === 5 || response.status === 429 ? 30 : 5 * (attempt + 1);
                if (root) message((code === 17 ? 'Torn had a temporary server error.' : 'Torn is busy or rate-limited.') + ' Retrying in ' + seconds + ' seconds…');
                await sleep(seconds * 1000, signal); continue;
            }
            if (invalidJSON) throw new Error('Torn returned a non-JSON response (HTTP ' + response.status + ').');
            if (data?.error) {
                if (code === 17) throw Object.assign(new Error('Torn API is having temporary server problems (error 17). Nothing is wrong with your key; try again in a few minutes.'), { code });
                const hint = [2, 16].includes(code) ? ' Check the key and permissions for faction (basic, members, crimes) and torn/items. Your faction position must grant API access.' : '';
                throw Object.assign(new Error('Torn API ' + code + ': ' + String(data.error.error || data.error.message || 'request denied') + hint), { code });
            }
            if (response.status !== 200) throw new Error('Torn API HTTP ' + response.status + '.');
            return data;
        }
        throw new Error('Torn API retries exhausted.');
    }
    async function loadPrices(force, signal) {
        if (!force && Date.now() - catalog.at < PRICE_TTL && Object.keys(catalog.items || {}).length) return;
        const data = await apiRequest('torn/items', {}, signal);
        if (!Array.isArray(data.items)) throw new Error('Torn did not return the v2 items catalogue.');
        const items = {};
        for (const item of data.items) if (validId(item?.id)) {
            items[item.id] = { name: String(item.name || 'Item #' + item.id), price: priceNumber(item.value?.market_price) };
        }
        if (!Object.keys(items).length) throw new Error('The item catalogue is empty.');
        catalog = { at: Date.now(), items }; await save('catalog', catalog);
    }

    // Optional Torn Probability lookup (off by default). Sends only the OC name
    // and each slot's pass rate.
    function tpRequest(method, path, body) {
        return new Promise(resolve => {
            try {
                gmRequest({ method, url: TP_API + path, timeout: 8000,
                    headers: body ? { 'Content-Type': 'application/json' } : {},
                    data: body ? JSON.stringify(body) : undefined,
                    onload: r => { try { resolve(r.status >= 200 && r.status < 300 ? JSON.parse(r.responseText) : null); } catch (_) { resolve(null); } },
                    onerror: () => resolve(null), ontimeout: () => resolve(null) });
            } catch (_) { resolve(null); }
        });
    }
    // Torn Probability models: { normalizedName: { name, order: [normalized role names] } }
    let tpModels = null;
    async function loadTPModels() {
        const [list, roles] = await Promise.all([tpRequest('GET', 'api/GetSupportedScenarios'), tpRequest('GET', 'api/GetRoleNames')]);
        if (!Array.isArray(list) || !roles || typeof roles !== 'object') return null;
        const models = {};
        for (const scenario of list) {
            const map = roles[scenario?.name];
            if (!map || typeof map !== 'object' || !Number.isInteger(scenario.parameters)) continue;
            const order = Object.keys(map).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
                .slice(0, scenario.parameters).map(k => normalize(map[k]));
            if (order.length === scenario.parameters) models[normalize(scenario.name)] = { name: String(scenario.name), order };
        }
        return models;
    }
    const chanceState = crime => {
        const input = chanceInput(crime, tpModels?.[normalize(crime.name)], settings.rules);
        return input.params ? { ...input, key: crime.id + ':' + input.params.join(',') } : input;
    };
    async function updateChances() {
        if (!settings.successChance || !live || chancesBusy) return;
        chancesBusy = true;
        try {
            if (!tpModels) { tpModels = await loadTPModels(); if (!tpModels) return; renderLive(); }
            let changed = false;
            for (const crime of live.crimes) {
                if (!settings.successChance) break;
                const state = chanceState(crime);
                if (!state.params || chances.has(state.key)) continue;
                const scenario = tpModels[normalize(crime.name)].name, shared = scenario + ':' + state.params.join(',');
                let value = pageChances.get(shared);
                if (value === undefined) {
                    const result = await tpRequest('POST', 'api/CalculateSuccess', { scenario, parameters: state.params });
                    value = Number.isFinite(Number(result?.successChance)) ? Number(result.successChance) : null;
                    pageChances.set(shared, value);
                }
                chances.set(state.key, value == null ? null : value * 100);
                changed = true;
            }
            if (changed) { renderLive(); renderCard(); }
        } finally { chancesBusy = false; }
    }

    // ── Access ────────────────────────────────────────────────────────────
    // The dashboard is only for members whose faction position gives API
    // access: their key must be able to read the faction's members and crimes.
    // Torn enforces this on its side too; without that access the data cannot
    // be fetched at all. Everyone else gets the crimes-page helpers only.
    let access = { ok: false, checkedAt: 0 };
    const ACCESS_ERRORS = [2, 7, 16, 18];
    const hasAccess = () => !!key && access.ok === true;
    async function checkAccess(candidate) {
        const previous = key;
        key = candidate;
        try {
            const data = await apiRequest('faction/basic,members,crimes', { cat: 'available' });
            if (!Array.isArray(data?.members) || !Array.isArray(data?.crimes)) throw Object.assign(new Error('This key cannot read your faction\'s organized crimes.'), { code: 7 });
            return { ok: true, faction: String(data.basic?.name || 'your faction') };
        } catch (error) {
            return { ok: false, error: ACCESS_ERRORS.includes(error.code)
                ? 'This key has no faction API access. Ask your faction leader for a position with "Faction API access".'
                : safeError(error) };
        } finally { key = previous; }
    }
    async function grantAccess(candidate) {
        key = candidate; access = { ok: true, checkedAt: Date.now() };
        await save('key', key); await save('access', access);
        report = null; liveRaw = null; live = null; liveFetchedAt = 0;
    }
    async function revokeAccess(reason) {
        key = ''; access = { ok: false, checkedAt: Date.now() };
        try { await save('key', ''); await save('access', access); } catch (_) {}
        report = null; liveRaw = null; live = null; liveFetchedAt = 0; liveError = '';
        if (root) {
            if (!panel.hidden) close();
            launcher.hidden = true; hideBreach();
            if (reason) memberStatus(reason, true);
        }
        renderCard(); scheduleScan();
    }
    const accessLost = error => ACCESS_ERRORS.includes(error?.code);

    // ── Live data ─────────────────────────────────────────────────────────
    function earlyJoinOptions() {
        return joinPolicyActive() ? { waitLimit: waitLimit(), isException: (oc, role) => isExceptionRule(settings.rules, oc, role) } : null;
    }
    function requirementFn() {
        return rulesActive(settings.rules) ? (oc, role, hours) => cprRequirement(settings.rules, oc, role, hours) : null;
    }
    function recomputeLive() {
        if (!liveRaw) { live = null; return; }
        live = analyseLive(liveRaw.members, liveRaw.crimes, liveRaw.recent, { ...settings, requirement: requirementFn(), itemName: id => catalog.items?.[id]?.name, earlyJoin: earlyJoinOptions() }, nowSec());
    }
    async function refreshLive(force = false) {
        if (!hasAccess() || liveBusy) return;
        if (!force && liveRaw && Date.now() - liveFetchedAt < LIVE_TTL) return;
        liveBusy = true; liveError = ''; renderLiveState();
        try {
            const main = await apiRequest('faction/basic,members,crimes', { cat: 'available' });
            if (!Array.isArray(main?.members) || !Array.isArray(main?.crimes)) throw new Error('Torn did not return faction members and crimes. Check faction API access.');
            const recent = await apiRequest('faction/crimes', { cat: 'completed', sort: 'DESC', limit: 100 });
            liveRaw = { faction: { id: Number(main.basic?.id) || null, name: String(main.basic?.name || 'Faction') },
                members: main.members, crimes: main.crimes, recent: Array.isArray(recent?.crimes) ? recent.crimes : [] };
            liveFetchedAt = Date.now();
            recomputeLive();
            save('breachCheckAt', Date.now()).catch(() => {});
            updateChances();
            // Item names load in the background so the dashboard shows straight away;
            // breach alerts wait for them so they can name the missing item.
            ensureItemNames(main.crimes).catch(() => {}).then(() => {
                if (liveRaw?.crimes !== main.crimes) return;
                recomputeLive(); handleBreaches(live); renderLive(); renderCard();
            });
        } catch (error) {
            liveError = safeError(error);
            if (accessLost(error)) revokeAccess('Your key no longer has faction API access, so OC Command Centre is locked.');
        } finally {
            liveBusy = false;
            renderLive(); renderCard(); scheduleScan();
        }
    }

    // ── Report ────────────────────────────────────────────────────────────
    function setBusy(value) {
        busy = value;
        root.querySelectorAll('[data-lock]').forEach(el => { el.disabled = value; });
        $('#cancel').hidden = !value;
        $('#fetch').innerHTML = value ? 'Fetching…' : 'Fetch report <span aria-hidden="true">↗</span>';
    }
    async function runReport() {
        if (busy) return;
        let range;
        try { range = dateRange($('#from').value, $('#to').value); } catch (err) { return message(safeError(err), true); }
        if (!key) { showView('settings'); $('#key').focus(); return message('Save your own Torn API key first.', true); }
        controller = new AbortController(); const signal = controller.signal;
        setBusy(true); report = null; detailPage = 0; if (currentView === 'live' || currentView === 'settings') currentView = 'overview'; render();
        let faction = null, members = [], priceWarning = '', crimes = [];
        try {
            message('Checking your faction and API access…');
            const basic = await apiRequest('faction/basic,members', {}, signal);
            if (!validId(basic?.basic?.id)) throw new Error('This key has no valid faction.');
            faction = { id: Number(basic.basic.id), name: String(basic.basic.name || 'Faction') };
            members = Array.isArray(basic.members) ? basic.members.filter(m => m?.status?.state !== 'Fallen') : [];
            crimes = await fetchHistory(apiRequest, range, signal, (page, count) => message('Fetched ' + count + ' completed OCs · API request ' + page + '…'));
            message('Loading item names and market values…');
            try { await loadPrices(false, signal); } catch (error) {
                if (signal.aborted) throw error;
                priceWarning = safeError(error);
            }
            report = { range, faction, members, crimes, complete: true, fetchedAt: Date.now(), priceWarning };
            message('Report ready. ' + crimes.length + ' completed OCs fetched; ' + makeRecords(crimes, range).records.length + ' lost/consumed item records.' + (priceWarning ? ' Some item values are unavailable.' : ''), !!priceWarning);
        } catch (error) {
            // A failure before completion must never publish a complete-looking result.
            if (faction) report = { range, faction, members, crimes: error.partial || crimes, complete: false, fetchedAt: Date.now(), priceWarning, error: safeError(error) };
            message((signal.aborted ? 'Cancelled.' : safeError(error)) + (report ? ' Showing a clearly marked partial report.' : ''), true);
        } finally { controller = null; setBusy(false); updateCrimeFilter(); render(); }
    }
    // The crime filter applies to the Item costs and Activity tabs (and their CSVs);
    // the Overview always shows every crime in the period.
    function filtered(byCrime = true) {
        if (!report) return { records: [], selectedCrimes: 0 };
        const result = makeRecords(report.crimes, report.range);
        const crime = $('#crime').value;
        if (byCrime && crime !== 'all') result.records = result.records.filter(r => r.crime === crime);
        return result;
    }
    // Ownership bar and legend. "Unknown owner" (Torn gave no owner) only shows when it occurs.
    function ownershipHTML(records) {
        const owners = { faction: 0, user: 0, unknown: 0 };
        for (const rec of records) owners[rec.owner]++;
        const total = records.length;
        const fraction = type => total ? owners[type] * 100 / total : 0;
        const kinds = [['faction', 'Faction-owned', 'ownership-faction'], ['user', 'Member-owned', 'ownership-member'], ['unknown', 'Unknown owner', 'ownership-unknown']]
            .filter(([id]) => id !== 'unknown' || owners.unknown > 0);
        return '<div class="ownership-bar" title="' + kinds.map(k => k[1]).join(' / ') + '">' +
            kinds.map(([id, , color]) => '<span class="' + color + '" style="width:' + fraction(id) + '%"></span>').join('') + '</div>' +
            '<div class="ownership-legend">' + kinds.map(([id, name, color]) => '<div class="legend-row"' + (id === 'unknown' ? ' title="Torn did not record who owned these items"' : '') +
            '><span class="legend-name"><span class="legend-dot ' + color + '"></span>' + name + '</span><strong>' + owners[id].toLocaleString('en-US') +
            ' <span class="muted">(' + fraction(id).toFixed(1) + '%)</span></strong></div>').join('') + '</div>';
    }
    function updateCrimeFilter() {
        const select = $('#crime');
        select.innerHTML = '<option value="all">All crimes</option>';
        for (const name of [...new Set((report ? makeRecords(report.crimes, report.range).records : []).map(r => r.crime))].sort()) {
            const option = document.createElement('option'); option.value = name; option.textContent = name; select.append(option);
        }
    }
    function totals(rows) {
        return rows.reduce((t, r) => {
            t.lost += r.lost; t.consumed += r.consumed; t.depleted += r.depleted;
            t.cost += r.cost || 0; t.factionCost += r.factionCost || 0;
            t.unpriced += r.price == null ? r.depleted : 0;
            return t;
        }, { lost: 0, consumed: 0, depleted: 0, cost: 0, factionCost: 0, unpriced: 0 });
    }
    const metricHTML = ([name, value, caption]) => '<div class="metric"><span>' + escape(name) + '</span><strong>' + escape(value) + '</strong><small>' + escape(caption) + '</small></div>';
    function render() {
        const result = filtered(), rows = aggregate(result.records, info);
        const all = filtered(false), t = totals(aggregate(all.records, info)); // Overview: every crime
        const available = !!report;
        $('#exports').hidden = !available;
        $('#report-body').hidden = !available;
        $('#empty').hidden = available;
        updateConnection();
        updateView();
        renderParticipation();
        if (!available) {
            $('#report-state').textContent = 'No report loaded';
            $('#report-state').className = 'report-state';
            return;
        }
        $('#report-state').textContent = report.complete ? 'Verified report' : 'Partial report';
        $('#report-state').className = 'report-state ' + (report.complete ? 'ready' : 'partial');
        $('#heading').textContent = report.faction.name + ' [' + report.faction.id + '] · ' + (report.complete ? 'OC report' : 'PARTIAL REPORT');
        $('#heading').classList.toggle('bad', !report.complete);
        $('#period').textContent = timeText(report.range.from) + ' → ' + timeText(report.range.to) + ' · fetched ' + new Date(report.fetchedAt).toISOString().replace('T', ' ').slice(0, 19) + ' TCT';
        const people = participation(report.crimes, report.range, report.members);
        $('#summary').innerHTML = [
            ['Completed OCs', all.selectedCrimes, 'All completed OCs in range'],
            ['Members with no OC', people.filter(p => p.current && !p.total).length, 'Current members, this period'],
            ['Lost items', t.lost, 'Explicitly lost outcomes'],
            ['Total item cost', money(t.cost), t.unpriced ? t.unpriced + ' events excluded: unpriced' : 'Current market value'],
            ['Faction item cost', money(t.factionCost), 'Faction-owned depleted items']
        ].map(metricHTML).join('');
        const warnings = [];
        if (!report.complete) warnings.push('PARTIAL: ' + (report.error || 'Fetch did not finish') + '. Counts and costs cover fetched records only.');
        if (report.range.from < OUTCOME_START) warnings.push('Item outcomes only exist for crimes executed after 25 July 2025. Earlier crimes are included in OC totals but their unavailable item outcomes cannot be counted.');
        if (result.undated) warnings.push(result.undated + ' crimes excluded because execution timestamps were missing.');
        if (result.incomplete) warnings.push(result.incomplete + ' crimes have missing or invalid slots. Item totals may be incomplete.');
        if (result.outside) warnings.push(result.outside + ' crimes outside the selected execution period were excluded.');
        if (all.unknownConsumption) warnings.push(all.unknownConsumption + ' used item outcomes have unknown reusable status and are excluded from item cost calculations.');
        if (all.missingOutcomeItemId) warnings.push(all.missingOutcomeItemId + ' used/lost item outcomes have no valid item ID and cannot be assigned to an item.');
        if (t.unpriced) warnings.push(t.unpriced + ' lost/consumed items have no current price; their costs are excluded from the displayed subtotal.');
        if (report.priceWarning) warnings.push('Price lookup: ' + report.priceWarning);
        $('#warnings').textContent = warnings.map(w => '• ' + w).join('\n');
        $('#warnings').hidden = !warnings.length;
        $('#price-note').textContent = 'All completed OCs are counted, even those without item losses. Only LOST outcomes and USED non-reusable items contribute to item costs. Reusable used items, unused items, and unknown outcomes are excluded. Costs use current market values, not historical purchase prices. Owner and crime filters affect item costs, not the completed OC count.';
        $('#ownership').innerHTML = ownershipHTML(all.records);
        $('#costs-ownership').innerHTML = ownershipHTML(result.records);
        rows.sort((a, b) => {
            const av = a[sortBy], bv = b[sortBy];
            if (av == null) return bv == null ? a.id - b.id : 1;
            if (bv == null) return -1;
            return (typeof av === 'string' ? av.localeCompare(bv) : av - bv) * sortDirection || a.id - b.id;
        });
        root.querySelectorAll('[data-sort]').forEach(th => {
            const active = th.dataset.sort === sortBy;
            th.setAttribute('aria-sort', active ? (sortDirection === 1 ? 'ascending' : 'descending') : 'none');
            th.querySelector('.sort-arrow').textContent = !active ? '↕' : sortDirection === 1 ? '↑' : '↓';
        });
        $('#item-count').textContent = rows.length.toLocaleString('en-US') + ' item ' + (rows.length === 1 ? 'type' : 'types');
        $('#items').innerHTML = rows.length ? rows.map(r => '<tr><td><span class="primary-cell">' + escape(r.name) + '</span><span class="secondary-cell">Item #' + r.id + '</span></td>' +
            '<td class="t-right value-lost">' + r.lost + '</td><td class="t-right value-used">' + r.consumed + '</td>' +
            '<td class="t-right" title="' + escape(r.source + (r.pricedAt ? ' · ' + new Date(r.pricedAt).toISOString() : '')) + '"><span class="value-strong">' + money(r.price) + '</span><span class="secondary-cell">' + escape(r.source) + '</span></td>' +
            '<td class="t-right value-strong">' + money(r.cost) + '</td><td class="t-right value-accent">' + money(r.factionCost) + '</td><td class="t-right">' + r.crimes + '</td></tr>').join('') : '<tr><td class="empty-row" colspan="7">No lost or consumed items match the selected filters.</td></tr>';
        renderDetails(result.records);
    }
    function renderDetails(records) {
        const ordered = records.slice().sort((a, b) => b.executed - a.executed || b.crimeId - a.crimeId || a.slotIndex - b.slotIndex);
        const pages = Math.max(1, Math.ceil(ordered.length / 100)); detailPage = Math.min(Math.max(0, detailPage), pages - 1);
        const names = memberNames();
        $('#details-body').innerHTML = ordered.slice(detailPage * 100, (detailPage + 1) * 100).map(r => '<tr><td><span class="primary-cell">' + escape(timeText(r.executed).replace(' TCT', '')) + '</span><span class="secondary-cell">TCT</span></td>' +
            '<td><span class="primary-cell">' + escape(r.crime) + '</span><span class="secondary-cell">OC #' + r.crimeId + ' · ' + escape(r.status) + '</span></td>' +
            '<td><span class="primary-cell">' + escape(r.slot) + '</span><span class="secondary-cell">' + (r.userId ? escape((names.get(r.userId) || 'XID') + ' [' + r.userId + ']') : 'Member unknown') + '</span></td>' +
            '<td><span class="primary-cell">' + escape(info(r.itemId).name) + '</span><span class="secondary-cell">Item #' + r.itemId + '</span></td>' +
            '<td><span class="pill ' + (r.reason === 'Lost' ? 'pill-lost' : 'pill-consumed') + '">' + escape(r.reason) + '</span></td>' +
            '<td><span class="pill ' + (r.owner === 'faction' ? 'pill-faction' : r.owner === 'user' ? 'pill-user' : 'pill-unknown') + '">' + escape(r.owner === 'user' ? 'Member' : r.owner === 'faction' ? 'Faction' : 'Unknown') + '</span></td>' +
            '<td class="muted">' + escape(r.note || '—') + '</td></tr>').join('') || '<tr><td class="empty-row" colspan="7">No matching losses or consumed items.</td></tr>';
        $('#detail-count').textContent = ordered.length.toLocaleString('en-US') + ' records · Page ' + (detailPage + 1) + ' of ' + pages;
        $('#prev').disabled = detailPage === 0; $('#next').disabled = detailPage >= pages - 1;
    }
    function memberNames() {
        const names = new Map();
        for (const m of [...(liveRaw?.members || []), ...(report?.members || [])]) if (validId(m?.id)) names.set(Number(m.id), String(m.name || ''));
        return names;
    }
    function participationRows() {
        if (!report) return [];
        const rows = participation(report.crimes, report.range, report.members);
        const { by, dir } = partSort;
        return rows.sort((a, b) => {
            const av = by === 'rate' ? (a.total ? a.success / a.total : -1) : a[by], bv = by === 'rate' ? (b.total ? b.success / b.total : -1) : b[by];
            if (av == null) return bv == null ? a.name.localeCompare(b.name) : 1;
            if (bv == null) return -1;
            return (typeof av === 'string' ? av.localeCompare(bv) : av - bv) * dir || a.name.localeCompare(b.name);
        });
    }
    function renderParticipation() {
        if (!report) { $('#part-body').innerHTML = ''; return; }
        const rows = participationRows();
        root.querySelectorAll('[data-psort]').forEach(th => {
            const active = th.dataset.psort === partSort.by;
            th.setAttribute('aria-sort', active ? (partSort.dir === 1 ? 'ascending' : 'descending') : 'none');
            th.querySelector('.sort-arrow').textContent = !active ? '↕' : partSort.dir === 1 ? '↑' : '↓';
        });
        $('#part-count').textContent = rows.length.toLocaleString('en-US') + ' members';
        $('#part-body').innerHTML = rows.map(r => {
            const now = live?.inOC.get(r.id);
            const current = !r.current ? '<span class="muted">Left faction</span>' : !live ? '<span class="muted">Open Live to check</span>'
                : now ? escape(now.crime) + '<span class="secondary-cell">' + escape(stageName(now.stage)) + '</span>' : '<span class="value-used">Not in an OC</span>';
            return '<tr><td><a class="member-link" href="https://www.torn.com/profiles.php?XID=' + r.id + '" target="_blank" rel="noopener noreferrer">' + escape(r.name) + '</a><span class="secondary-cell">[' + r.id + ']</span></td>' +
                '<td class="t-right value-strong">' + r.total + '</td><td class="t-right">' + r.success + '</td><td class="t-right">' + r.fail + '</td>' +
                '<td class="t-right">' + (r.total ? Math.round(r.success * 100 / r.total) + '%' : '—') + '</td>' +
                '<td>' + (r.last ? escape(timeText(r.last).replace(' TCT', '')) : '<span class="value-lost">None in period</span>') + '</td><td>' + current + '</td></tr>';
        }).join('') || '<tr><td class="empty-row" colspan="7">No members found.</td></tr>';
    }

    // ── Live rendering ────────────────────────────────────────────────────
    const stageName = stage => stage === 'planning' ? 'Planning' : stage === 'recruiting' ? 'Recruiting' : 'Not started';
    function statusPill(state, text) {
        const s = String(state || 'Unknown');
        const cls = s === 'Okay' ? 'pill-ok' : s === 'Hospital' ? 'pill-lost' : (s === 'Traveling' || s === 'Abroad') ? 'pill-user'
            : (s === 'Jail' || s === 'Federal') ? 'pill-consumed' : 'pill-unknown';
        return '<span class="pill ' + cls + '" title="' + escape(text || s) + '">' + escape(s) + '</span>';
    }
    function timerHTML(timer) {
        if (!timer?.at) return '<span class="muted">—</span>';
        return '<span class="timer" data-at="' + timer.at + '" data-label="' + escape(timer.label) + '" data-late="' + escape(timer.late) + '"></span>';
    }
    function tickTimers(scope) {
        const now = nowSec();
        scope.querySelectorAll('.timer[data-at]').forEach(el => {
            const diff = Number(el.dataset.at) - now;
            el.textContent = diff >= 0 ? el.dataset.label + ' in ' + duration(diff) : el.dataset.late + ' ' + duration(-diff);
            el.classList.toggle('timer-late', diff < 0);
            el.classList.toggle('timer-soon', diff >= 0 && diff < 6 * 3600);
        });
    }
    function passHTML(pass, req, filled) {
        if (pass == null) return '<span class="muted">—</span>';
        if (!req) {
            const cls = pass < settings.lowPass ? 'value-lost' : pass <= 75 ? 'value-used' : 'value-good';
            return '<span class="' + cls + '">' + pass + '</span>';
        }
        const need = req.min >= DECLINED_CPR ? 'Hidden crime' : (req.min ? 'min ' + req.min : '') + (req.max != null ? (req.min ? ' · ' : '') + 'max ' + req.max : '')
            + (req.waived ? ' · max waived (<48h)' : '') + (req.source === 'default' ? ' (default)' : '');
        const bad = req.min >= DECLINED_CPR || pass < req.min, over = req.max != null && pass > req.max;
        const cls = !filled ? 'muted' : bad ? 'value-lost' : over ? 'value-used' : 'value-good';
        return '<span class="' + cls + '">' + pass + '</span><span class="secondary-cell">' + escape(need) + '</span>';
    }
    function sinceHTML(ts, warnHours, alertHours, emptyText) {
        if (!ts) return '<span class="value-lost">' + escape(emptyText) + '</span>';
        const hours = (nowSec() - ts) / 3600;
        const cls = hours >= alertHours ? 'value-lost' : hours >= warnHours ? 'value-used' : '';
        return '<span class="' + cls + '" title="' + escape(timeText(ts)) + '">' + duration(nowSec() - ts) + ' ago</span>';
    }
    function crimeLink(crime) {
        return '<a class="member-link" href="https://www.torn.com/factions.php?step=your#/tab=crimes&crimeId=' + crime.id + '" target="_blank" rel="noopener noreferrer">' + escape(crime.name) + '</a>';
    }
    function issueTags(crime) {
        if (!crime.issues.length) return '<span class="value-good">No issues</span>';
        return crime.issues.map(issue => '<div class="issue issue-' + issue.type + '"><span class="issue-title">' + escape(issue.title) + '</span>' +
            (issue.items.length ? '<ul class="issue-items">' + issue.items.map(item => '<li>' + escape(item) + '</li>').join('') + '</ul>' : '') + '</div>').join('');
    }
    function chanceHTML(crime) {
        if (!settings.successChance) return '<span class="muted" title="Turn on success chances in Settings">—</span>';
        if (!tpModels) return '<span class="muted">…</span>';
        const state = chanceState(crime);
        if (!state.params) return '<span class="muted" title="' + escape(state.reason) + '">—</span>';
        if (!chances.has(state.key)) return '<span class="muted">…</span>';
        const value = chances.get(state.key);
        if (value == null) return '<span class="muted" title="Torn Probability could not estimate this crime">n/a</span>';
        return state.projected
            ? '<span class="value-projected" title="Projected: open slots counted at their minimum CPR. Real joiners are usually higher.">≥' + value.toFixed(1) + '%</span>'
            : '<span class="value-strong" title="Torn Probability estimate from the members\' pass rates">' + value.toFixed(1) + '%</span>';
    }
    function renderLiveState() {
        if (!root) return;
        const state = $('#live-state');
        if (!key) { state.textContent = 'No API key saved'; state.className = 'report-state'; }
        else if (liveBusy) { state.textContent = 'Updating…'; state.className = 'report-state'; }
        else if (liveError) { state.textContent = 'Update failed'; state.className = 'report-state partial'; }
        else if (liveFetchedAt) { state.textContent = 'Live · updated ' + new Date(liveFetchedAt).toLocaleTimeString(); state.className = 'report-state ready'; }
        else { state.textContent = 'Not loaded'; state.className = 'report-state'; }
        $('#live-refresh').disabled = !key || liveBusy;
    }
    function renderLive() {
        if (!root) return;
        renderLiveState();
        $('#live-error').hidden = !liveError;
        $('#live-error').textContent = liveError;
        const hasData = !!live;
        $('#live-empty').hidden = hasData;
        $('#live-body').hidden = !hasData;
        if (!key) $('#live-empty-text').textContent = 'Save your Torn API key in Settings to load the live overview. It needs faction API access.';
        else $('#live-empty-text').textContent = liveBusy ? 'Loading faction members and crimes…' : 'Choose Refresh to load the live overview.';
        if (!hasData) return;
        recomputeLive();
        $('#live-heading').textContent = liveRaw.faction.name + (liveRaw.faction.id ? ' [' + liveRaw.faction.id + ']' : '') + ' · live organized crimes';
        $('#live-summary').innerHTML = [
            ['Not in an OC', live.free.length, live.hidden ? live.hidden + ' hidden members not counted' : 'Of ' + live.members + ' eligible members'],
            ['Open slots', live.openSlots, 'Across recruiting and new OCs'],
            ['Active in OCs', live.active, live.soonFree + ' free again within 24h'],
            ['Need attention', live.attention, 'Stalled, delayed, CPR, missing items'],
            ['Recruits', live.recruits, 'Cannot join OCs yet']
        ].map(metricHTML).join('');

        const attention = live.crimes.filter(c => c.severity >= 1);
        $('#attention').innerHTML = attention.length ? attention.map(c => '<li class="attention-row"><div><span class="primary-cell">' + crimeLink(c) +
            ' <span class="muted">Lv ' + (c.level ?? '?') + '</span></span><span class="secondary-cell">' + escape(stageName(c.stage)) + ' · ' + c.filled + '/' + c.size + ' members · ' + timerHTML(c.timer) + '</span></div>' +
            '<div class="issue-list">' + issueTags(c) + '</div></li>').join('')
            : '<li class="attention-row"><span class="value-good">Nothing needs attention right now.</span></li>';

        const free = live.free.slice().sort((a, b) => {
            const { by, dir } = freeSort;
            const av = by === 'name' ? a.name.toLowerCase() : a[by] ?? 0, bv = by === 'name' ? b.name.toLowerCase() : b[by] ?? 0;
            return (typeof av === 'string' ? av.localeCompare(bv) : av - bv) * dir || a.name.localeCompare(b.name);
        });
        root.querySelectorAll('[data-fsort]').forEach(th => {
            const active = th.dataset.fsort === freeSort.by;
            th.setAttribute('aria-sort', active ? (freeSort.dir === 1 ? 'ascending' : 'descending') : 'none');
            th.querySelector('.sort-arrow').textContent = !active ? '↕' : freeSort.dir === 1 ? '↑' : '↓';
        });
        $('#free-count').textContent = free.length + (free.length === 1 ? ' member' : ' members') + (live.hidden ? ' · ' + live.hidden + ' hidden' : '');
        $('#free-body').innerHTML = free.map(m => '<tr><td><a class="member-link" href="https://www.torn.com/profiles.php?XID=' + m.id + '" target="_blank" rel="noopener noreferrer">' + escape(m.name) + '</a><span class="secondary-cell">[' + m.id + ']</span></td>' +
            '<td>' + statusPill(m.state, m.statusText) + '</td>' +
            '<td>' + sinceHTML(m.lastAction, settings.inactiveHours, settings.inactiveHours, 'Unknown') + '</td>' +
            '<td>' + sinceHTML(m.lastOC, settings.lastOcWarnHours, settings.lastOcAlertHours, 'None in last 100 OCs') + '</td>' +
            '<td class="t-right"><div class="row-actions">' +
            // A normal link: opening it is your own click, and Torn's compose page sends nothing until you press Send.
            '<a class="btn btn-outline mini" href="https://www.torn.com/messages.php#/p=compose&XID=' + m.id + '" target="_blank" rel="noopener noreferrer" title="Write a mail to ' + escape(m.name) + ' (opens in a new tab)">Mail</a>' +
            '<button class="btn btn-outline mini" data-hide="' + m.id + '" title="Hide this member from the list">Hide</button></div></td></tr>').join('')
            || '<tr><td class="empty-row" colspan="5">Every eligible member is in an OC.</td></tr>';

        const crimes = live.crimes.filter(c => stageFilter === 'all' || c.stage === stageFilter);
        $('#crime-count').textContent = crimes.length + (crimes.length === 1 ? ' crime' : ' crimes');
        $('#crimes-body').innerHTML = crimes.map(c => {
            const open = expanded.has(c.id);
            const main = '<tr class="crime-row" data-crime="' + c.id + '" tabindex="0" aria-expanded="' + open + '"><td><span class="primary-cell"><span class="caret">' + (open ? '▾' : '▸') + '</span> ' + crimeLink(c) + '</span><span class="secondary-cell">Level ' + (c.level ?? '?') + ' · OC #' + c.id + '</span></td>' +
                '<td>' + escape(stageName(c.stage)) + '</td><td class="t-right">' + c.filled + '/' + c.size + '</td><td>' + timerHTML(c.timer) + '</td>' +
                '<td class="t-right">' + chanceHTML(c) + '</td><td><div class="issue-list">' + issueTags(c) + '</div></td></tr>';
            if (!open) return main;
            const slots = c.slots.map(s => {
                const item = s.itemId ? escape(info(s.itemId).name) + (s.itemReusable ? ' <span class="muted">(reusable)</span>' : '') +
                    (s.userId ? s.itemAvailable === false ? ' <span class="value-lost">· missing</span>' : s.itemAvailable ? ' <span class="value-good">· has item</span>' : '' : '') : '<span class="muted">None</span>';
                return '<tr><td>' + escape(s.role) + '</td><td>' + (s.userId ? '<a class="member-link" href="https://www.torn.com/profiles.php?XID=' + s.userId + '" target="_blank" rel="noopener noreferrer">' + escape(s.name) + '</a>' : '<span class="muted">Open</span>') + '</td>' +
                    '<td>' + (s.userId ? statusPill(s.memberState, s.memberStatus) : '') + '</td><td class="t-right">' + (s.progress != null ? s.progress + '%' : '<span class="muted">—</span>') + '</td>' +
                    '<td class="t-right">' + passHTML(s.pass, s.req, !!s.userId) + '</td><td>' + item + '</td></tr>';
            }).join('');
            return main + '<tr class="detail-row"><td colspan="6"><table class="slot-table"><thead><tr><th>Role</th><th>Member</th><th>Status</th><th class="t-right">Planning</th><th class="t-right">CPR</th><th>Item</th></tr></thead><tbody>' + slots + '</tbody></table></td></tr>';
        }).join('') || '<tr><td class="empty-row" colspan="6">No crimes in this category.</td></tr>';
        tickTimers(root);
        renderIgnored();
    }
    function renderIgnored() {
        if (!root) return;
        const names = memberNames();
        $('#ignored-list').innerHTML = settings.ignored.length ? settings.ignored.map(id => '<div class="ignored-row"><span>' + escape(names.get(Number(id)) || 'Member') + ' <span class="muted">[' + escape(id) + ']</span></span><button class="btn btn-outline mini" data-unhide="' + escape(id) + '">Show again</button></div>').join('')
            : '<p class="note" style="margin:0">No hidden members. Use Hide in the live member list to leave someone out, for example a member on leave.</p>';
    }

    // ── OC breach alerts ──────────────────────────────────────────────────
    // Every few minutes one tab makes a single API call (faction members and
    // available crimes) and alerts on breaches it has not alerted on before.
    // Tabs share the check time and the alert through userscript storage, so
    // several open tabs do not multiply API calls or alerts.
    const ALERT_TTL = 6 * 60 * 60 * 1000;
    let shownAlertAt = 0;
    const breachWanted = () => settings.breachAlerts && (rulesActive(settings.rules) || settings.breachItems || settings.breachAway);
    async function handleBreaches(analysis) {
        if (!hasAccess() || !breachWanted() || !analysis) return;
        const current = findBreaches(analysis, { cpr: rulesActive(settings.rules), items: settings.breachItems, away: settings.breachAway }, nowSec());
        const seenStored = await read('breachSeen', {});
        const seen = seenStored && typeof seenStored === 'object' ? seenStored : {};
        const fresh = current.filter(b => !seen[b.key]);
        const next = {};
        for (const b of current) next[b.key] = seen[b.key] || Date.now();
        await save('breachSeen', next);
        if (!fresh.length) return;
        const previous = await read('breachAlert', null), dismissed = Number(await read('breachDismissed', 0)) || 0;
        let items = fresh.map(b => b.text);
        if (previous?.at > dismissed && Date.now() - previous.at < ALERT_TTL && Array.isArray(previous.items)) {
            items = [...new Set([...items, ...previous.items.map(String)])];
        }
        const alert = { at: Date.now(), items: items.slice(0, 25) };
        await save('breachAlert', alert);
        showBreach(alert);
        if (settings.breachDesktop && gmNotify) {
            try {
                gmNotify({ title: 'OC BREACH', text: fresh.map(b => b.text).join('\n'),
                    onclick: () => { try { window.focus(); } catch (_) {} currentView = 'live'; open(); } });
            } catch (_) {}
        }
    }
    // Item names come from the cached torn/items catalogue (one API call, at most once per cache period).
    async function ensureItemNames(crimes) {
        const needed = (crimes || []).some(c => Array.isArray(c?.slots) && c.slots.some(s => validId(s?.item_requirement?.id) && !catalog.items?.[s.item_requirement.id]));
        if (needed) { try { await loadPrices(false); } catch (_) {} }
    }
    async function breachCheck() {
        if (!hasAccess() || !breachWanted() || liveBusy) return;
        const last = Number(await read('breachCheckAt', 0)) || 0;
        if (Date.now() - last < settings.breachMinutes * 60000 - 5000) return;
        await save('breachCheckAt', Date.now());
        try {
            const data = await apiRequest('faction/basic,members,crimes', { cat: 'available' });
            if (!Array.isArray(data?.members) || !Array.isArray(data?.crimes)) return;
            if (settings.breachItems) await ensureItemNames(data.crimes);
            await handleBreaches(analyseLive(data.members, data.crimes, [], { ...settings, requirement: requirementFn(), itemName: id => catalog.items?.[id]?.name, earlyJoin: earlyJoinOptions() }, nowSec()));
        } catch (error) {
            if (accessLost(error)) revokeAccess('Your key no longer has faction API access, so OC Command Centre is locked.');
            console.warn('[' + NAME + '] Breach check failed:', safeError(error));
        }
    }
    function showBreach(alert) {
        if (!root) return;
        shownAlertAt = alert.at;
        $('#breach-time').textContent = new Date(alert.at).toLocaleTimeString();
        $('#breach-list').innerHTML = alert.items.map(item => '<li>' + escape(item) + '</li>').join('');
        $('#breach').hidden = false;
    }
    function hideBreach() { if (root) $('#breach').hidden = true; shownAlertAt = 0; }
    // Show or clear the shared alert in this tab (storage read only, no requests).
    async function syncBreach() {
        if (!settings.breachAlerts || !hasAccess()) { hideBreach(); return; }
        const alert = await read('breachAlert', null), dismissed = Number(await read('breachDismissed', 0)) || 0;
        const active = alert && Array.isArray(alert.items) && alert.at > dismissed && Date.now() - alert.at < ALERT_TTL;
        if (!active) { if (shownAlertAt) hideBreach(); return; }
        if (alert.at !== shownAlertAt) showBreach(alert);
    }

    // ── CPR rules editor & settings codes ─────────────────────────────────
    let cprEditOC = '';
    const cprExtraRoles = {};
    const cprAddedOCs = [];
    function liveRolesFor(ocName) {
        const roles = [];
        for (const crime of liveRaw?.crimes || []) {
            if (normalize(crime?.name) !== normalize(ocName) || !Array.isArray(crime.slots)) continue;
            for (const role of roleLabels(crime.slots)) if (!roles.includes(role.toUpperCase())) roles.push(role.toUpperCase());
        }
        return roles;
    }
    function cprOCNames() {
        const names = new Map();
        const add = name => { if (name && !names.has(normalize(name))) names.set(normalize(name), String(name)); };
        Object.values(OC_LEVELS).flat().forEach(add);
        Object.keys(settings.rules.ocs).forEach(add);
        cprAddedOCs.forEach(add);
        return [...names.values()].sort((a, b) => a.localeCompare(b));
    }
    // Level for grouping: the known table first, then any open crime's difficulty.
    function ocLevel(name) {
        for (const [level, names] of Object.entries(OC_LEVELS)) if (names.some(n => normalize(n) === normalize(name))) return Number(level);
        const open = (liveRaw?.crimes || []).find(c => normalize(c?.name) === normalize(name) && Number(c?.difficulty));
        return open ? Number(open.difficulty) : null;
    }
    function knownRoles(ocName) {
        const k = Object.keys(OC_ROLES).find(n => normalize(n) === normalize(ocName));
        return k ? OC_ROLES[k] : [];
    }
    function rulesSummary(rules) {
        if (!rulesActive(rules)) return 'No CPR rules set yet.';
        const n = Object.keys(rules.ocs).length;
        return n + ' OC' + (n === 1 ? '' : 's') + ' with rules' + (rules.joinPolicy ? ', joining policy on' : '')
            + (rules.createdAt ? ' · code from ' + new Date(rules.createdAt * 1000).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
    }
    function cprMessage(text, bad = false) { $('#cpr-msg').textContent = text; $('#cpr-msg').className = 'note' + (bad ? ' value-lost' : ''); }
    // A newsletter that members can read and that their scripts import from.
    function fillNewsletter(code) {
        const when = new Date((settings.rules.createdAt || Math.floor(Date.now() / 1000)) * 1000)
            .toLocaleString([], { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        $('#cpr-mail-subject').value = 'OC CPR requirements updated';
        $('#cpr-mail-body').value = [
            'Our OC CPR requirements have been updated (' + when + ').',
            '',
            'If you use OC Command Centre, you don\'t need to do anything else: your script updates itself as soon as you open this newsletter, and a green "CPR RULES" message confirms it.',
            '',
            'If it doesn\'t update, open the faction crimes tab, choose Settings on the OC CPR requirements card, paste the code below into "Settings code" and choose Import code.',
            '',
            'Settings code:',
            code,
            '',
            'The script greys out Join buttons for roles you shouldn\'t take. If you play on a device without the script, please check the requirements before joining.'
        ].join('\n');
        $('#cpr-mail-wrap').hidden = false;
    }
    async function copyText(text, what) {
        try { await navigator.clipboard.writeText(text); codeMessage(what + ' copied to your clipboard.'); }
        catch (_) { codeMessage('Select the ' + what.toLowerCase() + ' and copy it.', true); }
    }
    function codeMessage(text, bad = false) { $('#cpr-code-msg').textContent = text; $('#cpr-code-msg').className = 'note' + (bad ? ' value-lost' : ''); }
    function renderCprEditor() {
        if (!root) return;
        const rules = settings.rules;
        const names = cprOCNames();
        if (!cprEditOC || !names.some(n => normalize(n) === normalize(cprEditOC))) cprEditOC = names[0] || '';
        const option = n => '<option value="' + escape(n) + '"' + (normalize(n) === normalize(cprEditOC) ? ' selected' : '') + '>' +
            escape(n) + (ocRule(rules, n) ? ' ✓' : '') + (ocRule(rules, n)?.declined ? ' (hidden)' : '') + '</option>';
        const groups = new Map();
        for (const n of names) {
            const level = ocLevel(n);
            if (!groups.has(level)) groups.set(level, []);
            groups.get(level).push(n);
        }
        $('#cpr-oc').innerHTML = [...groups.keys()].sort((x, y) => (x ?? 99) - (y ?? 99))
            .map(level => '<optgroup label="' + (level ? 'Level ' + level : 'Other / new') + '">' + groups.get(level).map(option).join('') + '</optgroup>').join('');
        $('#cpr-level').textContent = ocLevel(cprEditOC) ? 'Level ' + ocLevel(cprEditOC) : 'Level unknown';
        const saved = ocRule(rules, cprEditOC);
        const entry = saved || { all: null, declined: false, roles: {} };
        $('#cpr-source').textContent = saved ? 'Rules set (✓)' : 'No rules yet: this OC is not checked';
        $('#cpr-reset').disabled = !saved;
        $('#cpr-all').value = entry.all ?? '';
        $('#cpr-deprioritise').checked = !!entry.deprioritise;
        $('#cpr-hidden').checked = !!entry.declined;
        $('#cpr-detail').hidden = !!entry.declined;
        const roles = [...Object.keys(entry.roles)];
        for (const role of [...knownRoles(cprEditOC), ...liveRolesFor(cprEditOC), ...(cprExtraRoles[normalize(cprEditOC)] || [])]) if (!roles.includes(role)) roles.push(role);
        $('#cpr-roles').innerHTML = roles.map(role => {
            const rule = entry.roles[role] || {}, r = escape(role);
            return '<tr><td class="value-strong">' + r + '</td>' +
                '<td><input type="number" min="0" max="100" step="1" data-cpr-role="' + r + '" data-cpr-field="min" value="' + (rule.min ?? '') + '" placeholder="—" aria-label="' + r + ' minimum"></td>' +
                '<td><input type="number" min="0" max="100" step="1" data-cpr-role="' + r + '" data-cpr-field="max" value="' + (rule.max ?? '') + '" placeholder="—" aria-label="' + r + ' maximum"></td>' +
                '<td class="t-center"><input type="checkbox" data-cpr-role="' + r + '" data-cpr-field="late"' + (rule.late ? ' checked' : '') + ' aria-label="' + r + ': no maximum in the last 48 hours"></td>' +
                '<td class="t-center policy-col"><input type="checkbox" data-cpr-role="' + r + '" data-cpr-field="exception"' + (rule.exception ? ' checked' : '') + ' aria-label="' + r + ': joining-policy exception"></td></tr>';
        }).join('') || '<tr><td class="empty-row" colspan="5">No roles known yet. Use "All roles", add a role below, or open the live overview while this OC is available.</td></tr>';
        $('#cpr-roles-wrap').classList.toggle('is-off', !!entry.declined);
        // Joining-policy options only show for factions that use one (values are kept either way).
        $('#cpr-view').classList.toggle('no-policy', !rules.joinPolicy);
        $('#cpr-policy').checked = !!rules.joinPolicy;
        $('#cpr-policy-detail').hidden = !rules.joinPolicy;
        $('#cpr-wait').value = rules.waitLimit ?? 1;
        $('#cpr-scope').value = rules.scopeBelow ?? '';
    }
    function readCprField(input) {
        const raw = input.value.trim();
        if (raw === '') return { ok: true, value: null };
        const n = Number(raw);
        return Number.isInteger(n) && n >= 0 && n <= 100 ? { ok: true, value: n } : { ok: false };
    }
    function afterRulesChange() { renderLive(); renderCard(); rescanAll(); }
    async function saveCprOC() {
        if (!cprEditOC) return;
        if ($('#cpr-hidden').checked) {
            for (const k of Object.keys(settings.rules.ocs)) if (normalize(k) === normalize(cprEditOC)) delete settings.rules.ocs[k];
            settings.rules.ocs[cprEditOC] = { all: null, declined: true, deprioritise: false, roles: {} };
            settings.rules = cleanRules(settings.rules);
            await saveSettings(); renderCprEditor(); afterRulesChange();
            return cprMessage('Saved ' + cprEditOC + ' as hidden. Generate a new settings code to share the change.');
        }
        const all = readCprField($('#cpr-all'));
        if (!all.ok) return cprMessage('"All roles" must be a whole number from 0 to 100, or blank.', true);
        const roles = {};
        for (const input of root.querySelectorAll('[data-cpr-role]')) {
            const role = input.dataset.cprRole, field = input.dataset.cprField;
            const rule = roles[role] ||= { min: null, max: null, late: false, exception: false };
            if (input.type === 'checkbox') { rule[field] = input.checked; continue; }
            const value = readCprField(input);
            if (!value.ok) return cprMessage(role + ': CPR must be a whole number from 0 to 100, or blank.', true);
            rule[field] = value.value;
        }
        for (const [role, rule] of Object.entries(roles)) {
            if (rule.min != null && rule.max != null && rule.max < rule.min) return cprMessage(role + ': the maximum is below the minimum.', true);
            if (rule.late && rule.max == null) rule.late = false;
            if (rule.min == null && rule.max == null && !rule.exception) delete roles[role];
        }
        for (const k of Object.keys(settings.rules.ocs)) if (normalize(k) === normalize(cprEditOC)) delete settings.rules.ocs[k];
        settings.rules.ocs[cprEditOC] = { all: all.value, declined: false, deprioritise: $('#cpr-deprioritise').checked, roles };
        settings.rules = cleanRules(settings.rules);
        delete cprExtraRoles[normalize(cprEditOC)];
        await saveSettings(); renderCprEditor(); afterRulesChange();
        cprMessage('Saved ' + cprEditOC + '. Generate a new settings code to share the change.');
    }
    async function resetCprOC() {
        for (const k of Object.keys(settings.rules.ocs)) if (normalize(k) === normalize(cprEditOC)) delete settings.rules.ocs[k];
        await saveSettings(); renderCprEditor(); afterRulesChange();
        cprMessage('Removed the rules for ' + cprEditOC + '.');
    }
    // Import a settings code into this script (members and admins alike).
    async function importRulesCode(text) {
        const rules = await decodeRules(text);
        if (!rulesActive(rules) && !confirm('This settings code contains no CPR rules. Import it anyway and clear your current rules?')) return null;
        const changes = diffRules(settings.rules, rules);
        await save('rulesUndo', { rules: settings.rules, from: settings.rulesFrom });
        settings.rules = rules; settings.rulesFrom = { name: '', id: null, via: 'manual', at: Date.now() };
        await saveSettings(); afterRulesChange();
        showRulesNotice('CPR rules imported from a pasted code (' + rulesSummary(rules) + ').', true, changes);
        return rules;
    }

    // ── Crimes-tab summary card ───────────────────────────────────────────
    function onCrimesPage() {
        return (location.pathname === '/factions.php' && /tab=crimes/.test(location.hash)) || location.pathname === '/organizedcrimes.php';
    }
    // Live API data is useful on the crimes page for the card and LAST JOIN banners.
    function pageWantsLive() { return cardWanted() || (onCrimesPage() && settings.onPage && !!document.querySelector('[data-oc-id]')); }
    // Torn PDA has no userscript menu, so there the card always shows (it opens settings).
    function cardWanted() { return (settings.cardPos !== 'off' || !gmMenu) && onCrimesPage() && !!document.querySelector('[data-oc-id]'); }
    function placeCard() {
        if (!cardWanted()) { cardHost?.remove(); return; }
        const container = document.querySelector('[data-oc-id]')?.parentElement;
        if (!container?.parentElement) return;
        if (!cardHost) {
            cardHost = document.createElement('div'); cardHost.id = 'eaglewing-oc-command-card';
            cardRoot = cardHost.attachShadow({ mode: 'closed' });
            cardRoot.innerHTML = `<style>
:host { all: initial; display:block; margin: 0 0 10px; font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Arial, sans-serif; font-size: 12px; color: #e9eef7; }
.card { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; padding:9px 12px; background:#151c26; border:1px solid #344050; border-left:3px solid #d64b5f; border-radius:8px; }
.title { font-weight:800; letter-spacing:-.01em; }
.stats { display:flex; flex-wrap:wrap; gap:6px 14px; color:#aab6c6; }
.stats b { color:#f2f5fa; }
.warn b { color:#ffb9c1; }
button { font:inherit; cursor:pointer; padding:6px 11px; color:#fff; background:#bb344b; border:1px solid #dd5266; border-radius:7px; font-weight:700; }
button:hover { background:#d04258; }
.muted { color:#8394a7; }
.legend { display:flex; flex-wrap:wrap; gap:4px 10px; margin-top:5px; color:#aab6c6; font-size:11px; }
.legend span { display:inline-flex; align-items:center; gap:5px; }
.sw { width:11px; height:11px; border-radius:3px; border:1px solid #ffffff33; }
.notice { margin-top:5px; color:#ffd297; font-size:11px; }
.actions { display:flex; gap:6px; }
button.ghost { background:transparent; border-color:#344050; color:#aab6c6; padding:6px 9px; }
button.ghost:hover { background:#1e2733; }
.card.compact { padding:5px 8px 5px 10px; }
.card.compact .top { display:flex; flex-wrap:wrap; align-items:baseline; gap:2px 12px; }
.card.compact .legend { display:none; }
.card.compact button { padding:4px 9px; }
</style><div class="card" id="card"><div><div class="top"><div class="title" id="title">${NAME}</div><div class="stats" id="stats"></div></div>
<div class="legend" id="legend" hidden><span><i class="sw" style="background:rgba(23,116,19,.85)"></i>CPR fine</span><span><i class="sw" style="background:rgba(153,0,0,.85)"></i>CPR too low</span><span><i class="sw" style="background:rgba(200,130,0,.85)"></i>CPR too high</span><span><i class="sw" style="background:repeating-linear-gradient(-45deg,#000 0,#000 2px,#f0c828 2px,#f0c828 4px)"></i>Other player, wrong CPR</span><span><i class="sw" style="background:rgba(30,90,170,.85)"></i>Missing item</span></div>
<div class="notice" id="notice" hidden></div></div><div class="actions"><button id="more" class="ghost" type="button"></button><button id="open" type="button">Open</button></div></div>`;
            cardRoot.getElementById('open').addEventListener('click', () => { currentView = 'live'; open(); });
            cardRoot.getElementById('more').addEventListener('click', async () => { settings.cardCompact = !settings.cardCompact; await saveSettings(); renderCard(); });
        }
        if (settings.cardPos === 'bottom' && gmMenu) {
            if (cardHost.previousElementSibling !== container) container.parentElement.insertBefore(cardHost, container.nextSibling);
        } else if (cardHost.nextElementSibling !== container) {
            container.parentElement.insertBefore(cardHost, container);
        }
        renderCard();
    }
    function renderCard() {
        if (!cardRoot) return;
        // Compact (default): one slim line. Details adds the colour legend and notices.
        const compact = settings.cardCompact;
        cardRoot.getElementById('card').classList.toggle('compact', compact);
        const more = cardRoot.getElementById('more');
        more.textContent = compact ? '▾' : '▴';
        more.title = compact ? 'Show details' : 'Hide details';
        more.setAttribute('aria-label', more.title);
        cardRoot.getElementById('legend').hidden = !(settings.onPage && rulesActive(settings.rules) && !helperDetected);
        const notice = cardRoot.getElementById('notice');
        // The other-helper warning always shows; the no-rules hint moves into the compact line.
        notice.hidden = helperDetected ? false : compact || rulesActive(settings.rules);
        notice.textContent = helperDetected ? 'Another OC helper script is running, so on-page colours and banners are paused. Disable it to use them here.'
            : !rulesActive(settings.rules) ? (hasAccess() ? 'No CPR rules yet: set them in CPR settings.' : 'No CPR rules yet: choose Settings and import the settings code from your faction.') : '';
        const stats = cardRoot.getElementById('stats');
        cardRoot.getElementById('title').textContent = hasAccess() ? NAME : 'OC CPR requirements';
        cardRoot.getElementById('open').textContent = hasAccess() ? 'Open' : 'Settings';
        if (!hasAccess()) {
            stats.innerHTML = rulesActive(settings.rules) ? '<span class="muted">' + (compact ? 'CPR rules active' : 'Slots are coloured by your faction\'s CPR rules.') + '</span>'
                : compact ? '<span class="muted">No CPR rules yet</span>' : '';
            return;
        }
        if (!live) { stats.innerHTML = '<span class="muted">' + (liveError ? escape(liveError) : 'Loading live OC status…') + '</span>'; return; }
        const stalled = live.crimes.filter(c => c.issues.some(i => i.type === 'stalled')).length;
        const items = live.crimes.filter(c => c.issues.some(i => i.type === 'item')).length;
        stats.innerHTML = '<span><b>' + live.free.length + '</b> not in an OC</span><span><b>' + live.openSlots + '</b> open slots</span>' +
            '<span class="' + (stalled ? 'warn' : '') + '"><b>' + stalled + '</b> stalled</span><span class="' + (items ? 'warn' : '') + '"><b>' + items + '</b> missing items</span>';
    }
    function scheduleCard() { scheduleScan(); }

    // ══ On-page helpers ═══════════════════════════════════════════════════
    // Builds on earlier work by Flamer, Allenone, Verboten, Darrelia, Kohnago, pawl,
    // Qfiffle and JohnNash (see Credits), made faction-neutral. Everything here
    // only reads and decorates the crimes page you are viewing: colours, labels,
    // ordering and greying out Join buttons. It never clicks or submits anything.
    const SEL_OC_PANEL = '[data-oc-id]';
    const SEL_PANEL_TITLE = '[class^="panelTitle___"]';
    const SEL_SLOT_HEADER = '[class^="slotHeader___"]';
    const SEL_SLOT_BODY = '[class^="slotBody___"]';
    const SEL_SUCCESS_CHANCE = '[class^="successChance___"]';
    const SEL_PHASE = '[class^="phase___"]';
    const SEL_JOIN_CONTAINER = '[class^="joinContainer___"]';
    const SEL_PLANNING_TIME = '[class^="planningTime___"][aria-label]';
    const SEL_CONFIRM_BUTTONS = '[class^="confirmButtons___"]';
    const SEL_ROLE_TITLE = '[class^="slotHeader___"] [class^="title___"]';
    const AUDIT_STORAGE_KEY = 'eaglewingOCC.joinAudit.v1';
    const AUDIT_SNAPSHOT_KEY = 'eaglewingOCC.joinSnapshots.v1';
    const AUDIT_SNAPSHOT_TTL = 30 * 60 * 1000;
    const pq = (s, r = document) => r.querySelector(s);
    const pqa = (s, r = document) => Array.from(r.querySelectorAll(s));

    let helperDetected = false, liveAudit = [], lastMemberSignature = '', lastSignatureRefresh = 0;
    const tpWeights = {};
    let tpState = 'idle';

    const onOCPagePath = () => location.pathname === '/factions.php' || location.pathname === '/organizedcrimes.php';
    function onFactionCrimesTab() {
        return location.pathname === '/factions.php' && location.search.includes('step=your') && /tab=crimes/.test(location.hash);
    }
    // Another OC helper script may decorate the same page. If one is running, pause these
    // features so nothing is drawn twice.
    function detectHelper() {
        if (!helperDetected && document.querySelector('.oc-settings-wrap, .oc-weight-box, .oc-policy-banner, .oc-policy-text')) helperDetected = true;
        return helperDetected;
    }
    const onPageActive = () => settings.onPage && !helperDetected;
    // 'auto' follows the faction's settings code; members can force it on or off.
    function joinPolicyActive() {
        if (!rulesActive(settings.rules) || settings.joinPolicy === 'off') return false;
        return settings.joinPolicy === 'on' || settings.rules.joinPolicy === true;
    }
    function getScope() { return Number.isInteger(settings.scope) ? settings.scope : null; }
    function pageRequirement(ocName, roleName, panel) {
        return cprRequirement(settings.rules, ocName, roleName, panel ? getTimeUntilReadyHours(panel) : null);
    }
    const isDeclineOC = ocName => !!ocName && !!ocRule(settings.rules, ocName)?.declined;

    // ── Torn Probability weights (GET only; nothing about you is sent) ───
    async function loadWeights() {
        if (tpState !== 'idle' || !settings.tpWeights) return;
        tpState = 'loading';
        const weights = await tpRequest('GET', 'api/GetRoleWeights');
        if (weights && typeof weights === 'object') {
            for (const [oc, roleSet] of Object.entries(weights)) {
                const ocKey = normalize(oc); tpWeights[ocKey] = {};
                for (const [role, value] of Object.entries(roleSet || {})) if (typeof value === 'number' && Number.isFinite(value)) tpWeights[ocKey][normalize(role)] = value;
            }
        }
        tpState = 'ready';
        pqa(SEL_OC_PANEL).forEach(p => p.classList.remove('occ-processed'));
        scheduleScan();
    }
    function addWeight(slot, ocName, roleName) {
        const existing = slot.querySelector('.occ-weight-box');
        const weight = settings.tpWeights ? tpWeights[normalize(ocName)]?.[normalize(roleName)] : null;
        if (weight == null) { existing?.remove(); return; }
        if (existing) return;
        const box = document.createElement('div');
        box.className = 'occ-weight-box';
        const label = document.createElement('div'); label.className = 'label'; label.textContent = 'WEIGHT';
        const value = document.createElement('div'); value.className = 'value'; value.textContent = weight.toFixed(1) + '%';
        box.append(label, value);
        slot.appendChild(box);
    }
    // Torn Probability results shared by the dashboard (the crimes page shows no success chance).
    const pageChances = new Map();
    function removeSuccess(panel) { pq('.occ-success-display', panel)?.remove(); delete panel.dataset.occChanceKey; }

    function getSlots(panel) { return pqa(SEL_SLOT_HEADER, panel).map(h => h.parentElement).filter(Boolean); }
    function getPlayerName() { return document.querySelector('script[playername]')?.getAttribute('playername')?.trim() || null; }

    function applyCPR(slot, required, chance, onCompletedTab, playerName) {
        const header = slot.querySelector(SEL_SLOT_HEADER), body = slot.querySelector(SEL_SLOT_BODY), weightBox = slot.querySelector('.occ-weight-box');
        if (!required) {
            if (header) header.style.background = '';
            if (body) body.style.background = '';
            if (weightBox) weightBox.style.background = '';
            return;
        }
        const { min, max } = required;
        const tooLow = chance < min, tooHigh = max != null && chance > max;
        const hasOccupant = !slot.querySelector(SEL_JOIN_CONTAINER);
        const knownAsOther = hasOccupant && playerName && !isSelfSlot(slot, playerName);
        let bg, weightBg;
        if (knownAsOther && (tooLow || tooHigh)) {
            bg = 'repeating-linear-gradient(-45deg, rgba(0,0,0,0.55) 0, rgba(0,0,0,0.55) 10px, rgba(240,200,40,0.55) 10px, rgba(240,200,40,0.55) 20px)';
            weightBg = 'repeating-linear-gradient(-45deg, rgba(0,0,0,0.25) 0, rgba(0,0,0,0.25) 6px, rgba(240,200,40,0.30) 6px, rgba(240,200,40,0.30) 12px)';
        } else if (tooLow) { bg = 'rgba(153,0,0,0.6)'; weightBg = 'rgba(153,0,0,0.3)'; }
        else if (tooHigh) { bg = 'rgba(200,130,0,0.6)'; weightBg = 'rgba(200,130,0,0.3)'; }
        else if (!onCompletedTab && header && header.querySelector('g[transform]')) { bg = 'rgba(30,90,170,0.6)'; weightBg = 'rgba(30,90,170,0.3)'; }
        else { bg = 'rgba(23,116,19,0.6)'; weightBg = 'rgba(23,116,19,0.3)'; }
        if (header) header.style.background = bg;
        if (body) body.style.background = bg;
        if (weightBox) weightBox.style.background = weightBg;
    }

    function ocContainsPlayer(panel, playerName) {
        const bodies = panel.querySelectorAll(SEL_SLOT_BODY);
        for (const body of bodies) for (const btn of body.querySelectorAll('button')) if ((btn.textContent || '').trim() === 'Leave Role') return true;
        if (!playerName) return false;
        for (const body of bodies) {
            for (const link of body.querySelectorAll('a[href*="profiles.php"]')) if ((link.textContent || '').trim() === playerName) return true;
            for (const ht of body.querySelectorAll('span.honor-text:not(.honor-text-svg)')) if ((ht.textContent || '').trim() === playerName) return true;
            for (const img of body.querySelectorAll('img[alt]')) if ((img.getAttribute('alt') || '').trim() === playerName) return true;
        }
        return false;
    }
    function isSelfSlot(slot, playerName) {
        if (!playerName) return false;
        for (const ht of slot.querySelectorAll('span.honor-text:not(.honor-text-svg)')) if ((ht.textContent || '').trim() === playerName) return true;
        for (const img of slot.querySelectorAll('img[alt]')) if ((img.getAttribute('alt') || '').trim() === playerName) return true;
        for (const link of slot.querySelectorAll('a[href*="profiles.php"]')) if ((link.textContent || '').trim() === playerName) return true;
        return false;
    }

    // ── Time until needed (based on work by Qfiffle and JohnNash) ─────────
    function parseDurationHours(text) {
        if (!text) return null;
        const t = String(text).trim().toLowerCase();
        const hrsShort = t.match(/(\d+(?:\.\d+)?)\s*hr?s\b/);
        if (hrsShort) return parseFloat(hrsShort[1]);
        const days = t.match(/(\d+(?:\.\d+)?)\s*day?s?\b/), hours = t.match(/(\d+(?:\.\d+)?)\s*hour?s?\b/);
        const minutes = t.match(/(\d+(?:\.\d+)?)\s*minute?s?\b/), seconds = t.match(/(\d+(?:\.\d+)?)\s*second?s?\b/);
        if (!days && !hours && !minutes && !seconds) return null;
        return (days ? parseFloat(days[1]) : 0) * 24 + (hours ? parseFloat(hours[1]) : 0)
            + (minutes ? parseFloat(minutes[1]) : 0) / 60 + (seconds ? parseFloat(seconds[1]) : 0) / 3600;
    }
    function getTimeUntilReadyHours(panel) {
        const title = panel.querySelector(SEL_PHASE + ' [class^="title___"][aria-label]');
        if (title) {
            const label = (title.getAttribute('aria-label') || '').trim();
            if (label && /stalled/i.test(label)) return Infinity;
            const parsed = parseDurationHours(label);
            if (parsed != null) return parsed;
        }
        const visible = panel.querySelector(SEL_PHASE + ' [class^="title___"]');
        if (visible && /stalled/i.test((visible.textContent || '').trim())) return Infinity;
        return null;
    }
    function getEmptySlotsPlanningHours(panel) {
        let total = 0, emptyCount = 0;
        for (const s of pqa(SEL_SLOT_BODY, panel)) {
            const join = s.querySelector(SEL_JOIN_CONTAINER);
            if (!join) continue;
            emptyCount++;
            total += parseDurationHours(join.querySelector(SEL_PLANNING_TIME)?.getAttribute('aria-label')) ?? 24;
        }
        return { emptyCount, totalHours: total };
    }
    function isOCEmpty(panel) {
        const slots = pqa(SEL_SLOT_BODY, panel);
        return slots.length > 0 && slots.every(s => s.querySelector(SEL_JOIN_CONTAINER));
    }
    function calculateTimeUntilNeeded(panel) {
        const { emptyCount, totalHours } = getEmptySlotsPlanningHours(panel);
        if (emptyCount === 0) return Infinity;
        const readyHours = getTimeUntilReadyHours(panel);
        if (readyHours == null || !isFinite(readyHours)) return 0;
        return Math.max(0, readyHours - totalHours);
    }
    const HOURS_CACHE = new WeakMap();
    function timeUntilNeededCached(panel) {
        const now = performance.now(), cached = HOURS_CACHE.get(panel);
        if (cached && now - cached.t < 250) return cached.v;
        const v = calculateTimeUntilNeeded(panel);
        HOURS_CACHE.set(panel, { v, t: now });
        return v;
    }
    function isCompletedTab(scope) {
        for (const s of scope.querySelectorAll(SEL_PHASE + ' [class^="title___"] span')) {
            const t = (s.textContent || '').trim().toLowerCase();
            if (t === 'success' || t === 'fail') return true;
        }
        return false;
    }
    function isLeaveConfirmOpen() {
        return !!document.querySelector(['#yesButton', '#noButton', '[aria-labelledby*="leaveConfirmationText"]', SEL_CONFIRM_BUTTONS].join(','));
    }

    // Planning state of an occupied slot: Torn's conic-gradient circle (0deg
    // waiting, 360deg complete), explicit numeric progress, or the inactive icon
    // shown when a member lacks an item. Anything else is unknown.
    function readPlanningProgress(slot, body) {
        const angle = pq(SEL_SLOT_HEADER + ' [class^="planning___"]', slot)?.getAttribute('style')?.match(/--oc-clock-planning-bg\)\s*(\d+(?:\.\d+)?)deg/i);
        if (angle) {
            const degrees = Number(angle[1]);
            if (degrees >= 0 && degrees <= 360) return degrees === 0 ? 'waiting' : degrees >= 359.99 ? 'complete' : 'planning';
        }
        for (const el of pqa('[role="progressbar"],progress,[aria-valuenow],[class*="planningProgress"],[class*="planningCircle"],[class*="progressCircle"],[aria-label*="planning" i]', body)) {
            const value = el.getAttribute('aria-valuenow') ?? el.getAttribute('value') ?? el.getAttribute('data-progress');
            let pct = value !== null && value !== '' ? Number(value) : NaN;
            if (!Number.isFinite(pct)) {
                const m = (el.getAttribute('aria-label') || '').match(/(\d+(?:\.\d+)?)\s*%/)
                    || ((el.textContent || '').trim().length < 16 ? (el.textContent || '').match(/^\s*(\d+(?:\.\d+)?)\s*%\s*$/) : null);
                pct = m ? Number(m[1]) : NaN;
            }
            if (Number.isFinite(pct) && pct >= 0 && pct <= 100) return pct === 0 ? 'waiting' : pct >= 100 ? 'complete' : 'planning';
        }
        if (pq(SEL_SLOT_HEADER + ' [class^="inactive___"]', slot)) return 'missing_item';
        return 'unknown';
    }
    function readOccupant(body) {
        const link = pq('a[href*="profiles.php"]', body);
        const linkName = (link?.textContent || '').trim();
        const name = (pq('span.honor-text:not(.honor-text-svg)', body)?.textContent
            || (linkName.toLowerCase() === 'view profile' ? '' : linkName) || pq('img[alt]', body)?.getAttribute('alt') || '').trim();
        const id = link?.getAttribute('href')?.match(/[?&]XID=(\d+)/i)?.[1] || '';
        return { name, id, key: id ? 'id:' + id : name ? 'name:' + name : '' };
    }
    function readOCQueue(panel) {
        const slots = getSlots(panel).map(slot => {
            const body = pq(SEL_SLOT_BODY, slot), role = pq(SEL_ROLE_TITLE, slot)?.textContent?.trim() || '';
            if (!body || !role) return null;
            const empty = !!pq(SEL_JOIN_CONTAINER, body);
            return { role, empty, occupant: empty ? null : readOccupant(body), element: slot,
                state: empty ? 'empty' : readPlanningProgress(slot, body), chance: parseFloat(pq(SEL_SUCCESS_CHANCE, slot)?.textContent || '') };
        }).filter(Boolean);
        const occupied = slots.filter(s => !s.empty);
        return { slots,
            waiting: occupied.filter(s => s.state === 'waiting' || s.state === 'missing_item').length,
            unknown: occupied.filter(s => s.state === 'unknown').length,
            empty: slots.filter(s => s.empty).length };
    }

    // ── Joining policy (optional; numbers come from the faction's rules) ──
    const waitLimit = () => settings.rules?.waitLimit ?? 1;
    const tooManyWaiting = queue => queue.waiting > waitLimit();
    const isExceptionRole = (ocName, role) => isExceptionRule(settings.rules, ocName, role);
    function isEligibleSlot(ocName, slot, panel) {
        if (!slot.empty || !Number.isFinite(slot.chance)) return false;
        const req = pageRequirement(ocName, slot.role, panel);
        return !!req && slot.chance >= req.min && (req.max == null || slot.chance <= req.max);
    }
    const originalJoinAria = new WeakMap();
    function setJoinButtonBlocked(button, reason) {
        if (!button) return;
        if (reason) {
            if (!originalJoinAria.has(button)) originalJoinAria.set(button, button.getAttribute('aria-disabled'));
            button.classList.add('occ-join-disabled');
            button.setAttribute('aria-disabled', 'true');
        } else if (originalJoinAria.has(button)) {
            button.classList.remove('occ-join-disabled');
            const original = originalJoinAria.get(button);
            if (original === null) button.removeAttribute('aria-disabled'); else button.setAttribute('aria-disabled', original);
            originalJoinAria.delete(button);
        }
    }
    // Stops your own click on a greyed-out Join button before Torn handles it.
    // This prevents a request; it never makes one.
    document.addEventListener('click', event => {
        if (event.target instanceof Element && event.target.closest('button.occ-join-disabled')) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    }, true);
    // A short reason under a greyed-out Join button (display only).
    function showJoinReason(slotEl, button, reason) {
        let lock = pq('.occ-lock', slotEl);
        const advice = pq('.occ-join-advice', slotEl);
        if (!reason) {
            lock?.remove();
            advice?.classList.remove('occ-advice-hidden');
            if (button?.dataset.occReason) { button.removeAttribute('title'); delete button.dataset.occReason; }
            return;
        }
        if (!lock) { lock = document.createElement('div'); lock.className = 'occ-lock'; }
        // Prefer the script's own weight box (plain block layout); otherwise sit on its
        // own line below the timer/Join row, which is too narrow to hold it.
        const weightBox = pq('.occ-weight-box', slotEl);
        if (weightBox) { if (weightBox.firstElementChild !== lock) weightBox.prepend(lock); }
        else {
            let row = pq(SEL_JOIN_CONTAINER, slotEl);
            while (row && row.parentElement && row.parentElement !== slotEl) row = row.parentElement;
            if (row && row.parentElement === slotEl) { if (lock.previousElementSibling !== row) row.insertAdjacentElement('afterend', lock); }
            else if (lock.parentElement !== slotEl) slotEl.append(lock);
        }
        // "Main|detail": the main reason in bold, the detail on a smaller second line.
        const [main, detail] = reason.split('|');
        if (lock.dataset.reason !== reason) {
            lock.innerHTML = '<span class="occ-lock-main">🔒 ' + escape(main) + '</span>' + (detail ? '<span class="occ-lock-detail">' + escape(detail) + '</span>' : '');
            lock.dataset.reason = reason;
        }
        lock.dataset.kind = /^(Wait|Not yet)/.test(reason) ? 'wait' : 'block';
        advice?.classList.add('occ-advice-hidden');
        if (button && button.dataset.occReason !== reason) { button.title = 'Greyed out by OC Command Centre: ' + reason.replace('|', ', '); button.dataset.occReason = reason; }
    }
    function updateJoinButtons(info, queue, hasEligibleExisting) {
        const { panel, ocName, policy, hasMe } = info;
        for (const slot of queue.slots) {
            const button = pq('button[class*="joinButton___"]', slot.element);
            if (!button || !slot.empty) continue;
            const req = pageRequirement(ocName, slot.role, panel);
            const wrongCPR = !!req && Number.isFinite(slot.chance) && (slot.chance < req.min || (req.max != null && slot.chance > req.max));
            const exception = isExceptionRole(ocName, slot.role) && isEligibleSlot(ocName, slot, panel);
            const reason = !settings.blockJoins ? null
                : isDeclineOC(ocName) ? 'Hidden crime'
                : hasMe ? 'You are in this OC'
                : wrongCPR && slot.chance < req.min ? 'Needs ' + req.min + '|you have ' + slot.chance
                : wrongCPR ? 'Max ' + req.max + '|you have ' + slot.chance
                : policy && tooManyWaiting(queue) && !exception && policy.state !== 'fallback' ? 'Wait|' + queue.waiting + ' not planning'
                : policy && queue.empty === queue.slots.length && hasEligibleExisting ? 'Not yet|join an existing OC'
                : null;
            setJoinButtonBlocked(button, reason);
            // Your own OC: the status bar already says YOUR OC, so no label on every slot.
            showJoinReason(slot.element, button, reason === 'You are in this OC' ? null : reason);
            if (reason === 'You are in this OC' && button) { button.title = 'You are already in this OC'; button.dataset.occReason = reason; }
        }
    }
    function classifyOC(panel, ocName, queue, hours, hasMe, declined) {
        const eligible = queue.slots.filter(s => isEligibleSlot(ocName, s, panel));
        const exception = eligible.some(s => isExceptionRole(ocName, s.role));
        if (declined) return { rank: 10, state: 'blocked', label: 'DO NOT JOIN: hidden crime' };
        if (hasMe) return { rank: 6, state: 'own', label: 'YOUR OC: ' + queue.waiting + ' waiting to start' + (queue.unknown ? ' · planning unknown' : '') };
        if (!queue.slots.length) return { rank: 9, state: 'unknown', label: 'PLANNING UNKNOWN: check Torn' };
        if (queue.empty === 0 || eligible.length === 0) return { rank: 8, state: 'wait', label: 'NO ELIGIBLE OPEN ROLE' };
        if (queue.empty === queue.slots.length) {
            const later = ocRule(settings.rules, ocName)?.deprioritise === true;
            return { rank: later ? 5 : 4, state: 'new', label: later ? 'START NEW: deprioritised' : 'START NEW: if no existing OC qualifies' };
        }
        if (tooManyWaiting(queue) && !exception) return { rank: 8, state: 'wait', label: 'WAIT: ' + queue.waiting + ' members have not started planning' };
        if (queue.unknown && !exception) return { rank: 7, state: 'unknown', label: 'PLANNING UNKNOWN: ' + queue.unknown + ' unreadable' };
        if (getTimeUntilReadyHours(panel) === Infinity) return { rank: 0, state: 'stalled', label: 'STALLED: JOIN NOW' };
        if (exception && tooManyWaiting(queue)) return { rank: 3, state: 'exception', label: 'EXCEPTION ROLE AVAILABLE: ' + queue.waiting + ' waiting' };
        if (queue.unknown) return { rank: 7, state: 'unknown', label: 'PLANNING UNKNOWN: ' + queue.unknown + ' unreadable' };
        return { rank: 1, state: 'join', label: 'OK TO JOIN: ' + queue.waiting + ' waiting to start' };
    }
    function isBoxedPolicy(policy) {
        const label = policy?.label || '';
        return (policy?.state === 'join' && label.startsWith('OK TO JOIN:'))
            || (policy?.state === 'new' && label === 'START NEW: if no existing OC qualifies')
            || (policy?.state === 'wait' && label === 'NO ELIGIBLE OPEN ROLE');
    }
    const scenarioRow = panel => pq('[class^="contentLayer___"] > [class^="scenario___"]', panel);
    function updatePolicyMarker(panel, policy) {
        let el = pq('.occ-policy-text', panel);
        if (!policy || (scenarioRow(panel) && (isBoxedPolicy(policy) || (policy.state === 'wait' && policy.label.startsWith('WAIT:'))))) {
            el?.remove();
            if (policy) panel.classList.remove('occ-urgent');
            return;
        }
        if (!el) { el = document.createElement('div'); el.className = 'occ-policy-text'; }
        placeIn(panel, el, 'main');
        if (el.textContent !== policy.label) el.textContent = policy.label;
        el.dataset.state = policy.state;
        panel.classList.remove('occ-urgent');
    }
    // One status bar per OC: join status on the left, stall timer and success
    // chance on the right, LAST JOIN / JOINED TOO EARLY on a smaller line below.
    function statusBar(panel) {
        const anchor = scenarioRow(panel) || pq(SEL_PANEL_TITLE, panel);
        let bar = pq('.occ-status', panel);
        if (!bar) {
            bar = document.createElement('div'); bar.className = 'occ-status';
            bar.innerHTML = '<div class="occ-status-row"><div class="occ-status-main"></div><div class="occ-status-side"></div></div><div class="occ-status-sub"></div>';
        }
        if (anchor && bar.previousElementSibling !== anchor) anchor.insertAdjacentElement('afterend', bar);
        return bar;
    }
    function statusZone(panel, zone) { return pq('.occ-status-' + zone, statusBar(panel)); }
    function placeIn(panel, el, zone) {
        const box = statusZone(panel, zone);
        if (box && el.parentElement !== box) box.appendChild(el);
        return el;
    }
    // Colours the bar from its main status, and removes it when it has nothing to show.
    function tidyStatus(panel) {
        const bar = pq('.occ-status', panel);
        if (!bar) return;
        if (!bar.querySelector('.occ-status-main > *, .occ-status-side > *, .occ-status-sub > *')) { bar.remove(); return; }
        const main = bar.querySelector('.occ-status-main > .occ-decision-banner') || bar.querySelector('.occ-status-main > .occ-wait-banner') || bar.querySelector('.occ-status-main > .occ-policy-text');
        const state = main?.dataset.state || 'none';
        if (bar.dataset.state !== state) bar.dataset.state = state;
        bar.classList.toggle('occ-status-nomain', !main);
    }
    function banner(panel, cls, zone) {
        let el = pq('.' + cls, panel);
        if (!el) { el = document.createElement('div'); el.className = 'occ-policy-banner ' + cls; }
        return placeIn(panel, el, zone);
    }
    function updatePolicyBanners(panel, ocName, queue, declined, policy = null) {
        const scenario = scenarioRow(panel);
        let decision = pq('.occ-decision-banner', panel);
        if (scenario && queue && !declined && isBoxedPolicy(policy)) {
            decision = banner(panel, 'occ-decision-banner', 'main');
            if (decision.textContent !== policy.label) decision.textContent = policy.label;
            decision.dataset.state = policy.state;
        } else { decision?.remove(); decision = null; }
        const waiting = pq('.occ-wait-banner', panel);
        const exceptionOpen = queue?.slots.some(s => isExceptionRole(ocName, s.role) && isEligibleSlot(ocName, s, panel));
        if (!scenario || !queue || declined || policy?.state === 'fallback' || policy?.label === 'NO ELIGIBLE OPEN ROLE'
            || !tooManyWaiting(queue) || queue.empty === 0 || exceptionOpen) { waiting?.remove(); return; }
        const el = banner(panel, 'occ-wait-banner', 'main');
        const text = 'WAIT: ' + queue.waiting + ' members have not started planning';
        if (el.textContent !== text) el.textContent = text;
        el.dataset.state = 'wait';
    }
    function updateEarlyJoinBanner(panel, queue, history) {
        const scenario = scenarioRow(panel);
        if (!queue || !scenario) { pq('.occ-early-join-banner', panel)?.remove(); return; }
        const ocId = panel.getAttribute('data-oc-id'), faction = '';
        const events = history.filter(e => e.faction === faction && e.ocId === ocId);
        const names = queue.slots.filter(s => !s.empty && s.occupant?.id).flatMap(s => {
            const latest = events.find(e => e.role === s.role && e.xid === s.occupant.id);
            return latest?.result === 'Joined too early' || latest?.result === 'Possible early join' ? [{ name: s.occupant.name || s.occupant.id, event: latest }] : [];
        });
        if (!names.length) { pq('.occ-early-join-banner', panel)?.remove(); return; }
        const el = banner(panel, 'occ-early-join-banner', 'sub');
        const text = names.map(({ name, event }) => (event.result === 'Joined too early' ? 'JOINED TOO EARLY' : 'POSSIBLE EARLY JOIN') + ': ' + name + ' (' + event.waitingBefore + ' waiting before)').join('; ');
        if (el.textContent !== text) el.textContent = text;
        el.dataset.state = 'early';
    }
    // Latest joiner from the live API data (needs a key with faction access).
    // Every occupied slot is matched by XID so stale data cannot mislabel a card.
    function getAPILastJoin(panel, ocName, queue) {
        if (!hasAccess() || !liveRaw || Date.now() - liveFetchedAt > 180000 || !queue) return null;
        const crime = (liveRaw.crimes || []).find(c => String(c?.id) === panel.getAttribute('data-oc-id'));
        if (!crime || normalize(crime.name) !== normalize(ocName) || !Array.isArray(crime.slots)) return null;
        const occupied = queue.slots.filter(s => !s.empty), apiSlots = crime.slots.filter(s => s?.user);
        if (occupied.length < 2 || apiSlots.length !== occupied.length) return null;
        const byXid = new Map();
        for (const s of occupied) { if (!s.occupant?.id || byXid.has(s.occupant.id)) return null; byXid.set(s.occupant.id, s); }
        const members = [];
        for (const s of apiSlots) {
            const id = String(s.user.id), joined = Number(s.user.joined_at);
            if (!byXid.has(id) || !Number.isFinite(joined) || joined < 1000000000) return null;
            members.push({ id, joined, progress: Number(s.user.progress), slot: byXid.get(id) });
        }
        if (new Set(members.map(m => m.id)).size !== occupied.length) return null;
        const joined = Math.max(...members.map(m => m.joined));
        return { latest: members.filter(m => m.joined === joined), joined, earlierZero: members.filter(m => m.joined < joined && m.progress === 0).length };
    }
    function updateLastJoinBanner(panel, ocName, queue) {
        const scenario = scenarioRow(panel);
        const last = scenario && getAPILastJoin(panel, ocName, queue);
        const needsOrder = scenario && queue && tooManyWaiting(queue) && queue.slots.filter(s => !s.empty).length >= 2;
        const hint = needsOrder && !last && hasAccess() && liveError ? 'LAST JOIN: check the key in OC Command Centre settings' : '';
        if (!last && !hint) { pq('.occ-last-join-banner', panel)?.remove(); return; }
        const el = banner(panel, 'occ-last-join-banner', 'sub');
        if (hint) { if (el.textContent !== hint) el.textContent = hint; el.dataset.state = 'last-join'; el.title = ''; return; }
        const names = last.latest.map(m => m.slot.occupant.name || m.id).join(', ');
        const when = new Date(last.joined * 1000).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        const possibleEarly = joinPolicyActive() && last.latest.length === 1 && last.earlierZero > waitLimit() && !isExceptionRole(ocName, last.latest[0].slot.role);
        const text = 'LAST JOIN: ' + names + ', ' + when + (possibleEarly ? '; POSSIBLE EARLY JOIN' : '');
        if (el.textContent !== text) el.textContent = text;
        el.dataset.state = possibleEarly ? 'early' : 'last-join';
        el.title = [last.latest.map(m => (m.slot.occupant.name || m.id) + ' (' + m.slot.role + ')').join(', '),
            last.latest.length > 1 ? 'Members share the latest join timestamp' : '',
            last.earlierZero > waitLimit() ? last.earlierZero + ' earlier members still at 0% planning' : ''].filter(Boolean).join('; ');
    }
    function updateSlotAdvice(panel, ocName, queue, declined, policy = null) {
        getSlots(panel).forEach(slot => {
            const data = queue?.slots.find(s => s.element === slot), existing = pq('.occ-join-advice', slot);
            if (!data?.empty) { existing?.remove(); return; }
            const exception = isExceptionRole(ocName, data.role) && isEligibleSlot(ocName, data, panel);
            const fallbackHere = policy?.state === 'fallback' && isEligibleSlot(ocName, data, panel);
            const text = declined ? 'DO NOT JOIN: hidden crime'
                : fallbackHere ? 'SCOPE BELOW ' + settings.rules.scopeBelow + ': FALLBACK JOIN HERE'
                : policy?.label === 'NO ELIGIBLE OPEN ROLE' || !policy ? null
                : tooManyWaiting(queue) && !exception ? (pq('.occ-wait-banner', panel) ? null : 'WAIT:')
                : queue.unknown && !exception ? 'PLANNING UNKNOWN: check before joining' : null;
            if (!text) { existing?.remove(); return; }
            let badge = existing;
            if (!badge) { badge = document.createElement('div'); badge.className = 'occ-join-advice'; pq(SEL_JOIN_CONTAINER, slot)?.insertAdjacentElement('afterend', badge); }
            if (badge.textContent !== text) badge.textContent = text;
            badge.classList.toggle('occ-join-advice-box', text === 'WAIT:');
            badge.title = text === 'WAIT:' ? 'WAIT: ' + queue.waiting + ' members have not started planning' : '';
            badge.dataset.state = declined ? 'blocked' : fallbackHere ? 'fallback' : 'wait';
        });
    }
    function applyScopeFallback(infos) {
        const scope = getScope();
        const below = settings.rules?.scopeBelow;
        if (below == null || scope === null || scope >= below || !infos.length) return;
        // Hidden or unreadable planning cannot prove that no existing OC is available.
        if (infos.some(i => i.policy && ([0, 1, 3].includes(i.policy.rank) || i.policy.state === 'new' || i.policy.state === 'unknown'))) return;
        const candidates = infos.filter(i => !i.isEmpty && !i.hasMe && i.queue && !isDeclineOC(i.ocName)
            && tooManyWaiting(i.queue) && i.queue.unknown === 0 && Number.isFinite(i.hours)
            && i.queue.slots.some(s => isEligibleSlot(i.ocName, s, i.panel)));
        candidates.sort((a, b) => a.hours - b.hours);
        if (candidates.length) candidates[0].policy = { rank: 4, state: 'fallback', label: 'SCOPE ' + scope + ': FALLBACK JOIN THIS OC' };
    }

    // ── Join audit (observed in this browser) ─────────────────────────────
    let auditSnapshots = new Map(), auditFaction = '', lastSnapshotWrite = 0;
    function getAuditHistory() {
        try { const saved = JSON.parse(localStorage.getItem(AUDIT_STORAGE_KEY) || '[]'); return Array.isArray(saved) ? saved : []; } catch (_) { return []; }
    }
    function getStoredSnapshots() {
        try {
            const rows = JSON.parse(sessionStorage.getItem(AUDIT_SNAPSHOT_KEY) || '[]');
            if (!Array.isArray(rows)) return new Map();
            const now = Date.now();
            return new Map(rows.filter(([k, snap]) => typeof k === 'string' && Array.isArray(snap?.slots) && Number.isFinite(snap.seenAt)
                && now >= snap.seenAt && now - snap.seenAt <= AUDIT_SNAPSHOT_TTL).map(([k, snap]) => [k, { ...snap, slots: new Map(snap.slots) }]));
        } catch (_) { return new Map(); }
    }
    function saveSnapshots(snapshots, changed) {
        if (!changed && Date.now() - lastSnapshotWrite < 60000) return;
        try {
            sessionStorage.setItem(AUDIT_SNAPSHOT_KEY, JSON.stringify([...snapshots].slice(-200).map(([k, snap]) => [k, { ...snap, slots: [...snap.slots] }])));
            lastSnapshotWrite = Date.now();
        } catch (_) {}
    }
    function observeJoinEvents(infos) {
        const faction = '';
        if (auditFaction !== faction) { auditSnapshots.clear(); auditFaction = faction; }
        const now = Date.now(), remembered = getStoredSnapshots(), next = new Map(), events = [];
        let changed = false;
        for (const { panel, ocName, queue, policy } of infos) {
            const id = panel.getAttribute('data-oc-id');
            if (!id) continue;
            const k = faction + ':' + id, candidate = auditSnapshots.get(k) || remembered.get(k);
            const before = candidate && now - candidate.seenAt <= AUDIT_SNAPSHOT_TTL ? candidate : null;
            if (!queue.slots.length || (before && queue.slots.length < before.slots.size)) { if (before) next.set(k, before); continue; }
            const slots = new Map(queue.slots.map(s => [s.role, { empty: s.empty, state: s.state, occupantKey: s.occupant?.key || '' }]));
            const current = { ocName, slots, waiting: queue.waiting, unknown: queue.unknown, fallback: policy?.state === 'fallback', seenAt: now, occupied: queue.slots.length - queue.empty };
            if (!before || before.waiting !== current.waiting || before.unknown !== current.unknown || before.fallback !== current.fallback
                || [...slots].some(([role, s]) => { const old = before.slots.get(role); return !old || old.empty !== s.empty || old.occupantKey !== s.occupantKey; })) changed = true;
            next.set(k, current); remembered.set(k, current);
            if (!before) continue; // Opening the page is not a joining event.
            const additions = queue.slots.filter(s => !s.empty && s.occupant?.key && before.slots.get(s.role)?.empty);
            for (const slot of additions) {
                const hasBaseline = before.unknown === 0 && additions.length === 1 && queue.slots.length === before.slots.size
                    && queue.slots.length - queue.empty === before.occupied + 1
                    && queue.slots.every(s => { const old = before.slots.get(s.role); return old && (old.empty || (!s.empty && old.occupantKey === s.occupant?.key)); });
                const stillWaiting = queue.slots.filter(s => {
                    const old = before.slots.get(s.role);
                    return old && (old.state === 'waiting' || old.state === 'missing_item') && old.occupantKey && old.occupantKey === s.occupant?.key
                        && (s.state === 'waiting' || s.state === 'missing_item');
                }).length;
                const result = isDeclineOC(ocName) ? 'Hidden crime: do not join' : !hasBaseline ? 'Unverified'
                    : isExceptionRole(ocName, slot.role) ? 'Exception role: verify CPR' : before.fallback ? 'Scope fallback: verify eligibility'
                    : before.waiting > waitLimit() ? (stillWaiting > waitLimit() ? 'Joined too early' : 'Possible early join') : 'Within joining rule';
                events.push({ faction, ocId: id, ocName, role: slot.role, player: slot.occupant.name || slot.occupant.id, xid: slot.occupant.id,
                    observedAt: new Date().toISOString(), waitingBefore: hasBaseline ? before.waiting : null, result });
            }
        }
        auditSnapshots = next;
        saveSnapshots(remembered, changed);
        if (events.length) {
            try { localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify([...events, ...getAuditHistory()].slice(0, 200))); } catch (_) {}
        }
        return events;
    }

    // ── Stall labels and ordering ─────────────────────────────────────────
    function stallText(hours) {
        if (hours <= 0) return 'MEMBERS NEEDED NOW'; // already stalled, or will stall unless its open roles are filled
        const minutes = Math.max(1, Math.round(hours * 60));
        if (minutes < 60) return 'Stalls in ' + minutes + 'm';
        const d = Math.floor(minutes / 1440), h = Math.floor((minutes % 1440) / 60), m = minutes % 60;
        return 'Stalls in ' + (d ? d + 'd ' + h + 'h' : h + 'h' + (m ? ' ' + m + 'm' : ''));
    }
    function updateUrgentMarker(panel, hours) {
        const titleEl = pq(SEL_PANEL_TITLE, panel), existing = pq('.occ-needed-text', panel);
        if (hours === null || !Number.isFinite(hours)) {
            panel.classList.remove('occ-urgent');
            if (existing) { existing.remove(); delete panel.dataset.occUrgency; }
            return;
        }
        if (!titleEl) return;
        panel.classList.toggle('occ-urgent', hours <= 48 && hours >= 0);
        let el = existing;
        if (!el) { el = document.createElement('div'); el.className = 'occ-needed-text'; el.title = 'Time until this OC stalls if its open roles are not filled'; }
        placeIn(panel, el, 'side');
        const text = stallText(hours);
        el.dataset.level = hours <= 0 ? 'stalled' : hours <= 24 ? 'red' : hours <= 48 ? 'amber' : 'calm';
        if (panel.dataset.occUrgency !== text) { el.textContent = text; panel.dataset.occUrgency = text; }
    }
    function reorder(container, ordered) {
        const current = Array.from(container.children).filter(n => n.matches(SEL_OC_PANEL));
        if (current.length === ordered.length && ordered.every((n, i) => current[i] === n)) return;
        for (let i = 0; i < ordered.length; i++) {
            if (current[i] !== ordered[i]) {
                container.insertBefore(ordered[i], current[i] || null);
                const from = current.indexOf(ordered[i]);
                if (from !== -1) current.splice(from, 1);
                current.splice(i, 0, ordered[i]);
            }
        }
    }

    function processOC(panel, onCompletedTab, playerName) {
        const ocName = pq(SEL_PANEL_TITLE, panel)?.textContent?.trim();
        if (!ocName) return;
        getSlots(panel).forEach(slot => {
            const role = pq(SEL_ROLE_TITLE, slot)?.textContent?.trim();
            if (!role) return;
            addWeight(slot, ocName, role);
            applyCPR(slot, pageRequirement(ocName, role, panel), parseFloat(pq(SEL_SUCCESS_CHANCE, slot)?.textContent) || 0, onCompletedTab, playerName);
        });
        removeSuccess(panel);
    }

    // Remove every on-page change (feature switched off, or the Helper found).
    function clearOnPage() {
        for (const el of pqa('.occ-weight-box, .occ-success-display, .occ-policy-text, .occ-policy-banner, .occ-join-advice, .occ-needed-text, .occ-status, .occ-lock')) el.remove();
        for (const panelEl of pqa(SEL_OC_PANEL)) {
            panelEl.classList.remove('occ-urgent', 'occ-mine', 'occ-processed', 'occ-declined-visible');
            if (panelEl.dataset.occHidden) { panelEl.style.display = ''; delete panelEl.dataset.occHidden; }
            getSlots(panelEl).forEach(slot => {
                applyCPR(slot, null);
                const b = pq('button[class*="joinButton___"]', slot);
                setJoinButtonBlocked(b, false);
                if (b?.dataset.occReason) { b.removeAttribute('title'); delete b.dataset.occReason; }
            });
        }
        liveAudit = [];
    }

    function scanPage() {
        if (!onOCPagePath()) return;
        if (detectHelper() || !settings.onPage) { clearOnPage(); return; }
        const panels = pqa(SEL_OC_PANEL);
        if (!panels.length) return;
        if (settings.tpWeights && tpState === 'idle') loadWeights();
        const onCrimes = onFactionCrimesTab(), tracking = joinPolicyActive(), playerName = getPlayerName();
        const onCompletedTab = isCompletedTab(document.body);
        const originalIndex = new Map(panels.map((p, i) => [p, i]));
        const ocInfo = panels.map(panelEl => {
            const ocName = pq(SEL_PANEL_TITLE, panelEl)?.textContent?.trim();
            const isEmpty = isOCEmpty(panelEl), declined = !!(ocName && isDeclineOC(ocName));
            // Hide a hidden crime only while it is still empty; once someone has
            // joined, keep it visible with the red overlay.
            if (onCrimes && declined && isEmpty && settings.hideDeclined) {
                panelEl.style.display = 'none'; panelEl.dataset.occHidden = '1';
                panelEl.classList.remove('occ-declined-visible');
                updatePolicyMarker(panelEl, null); updatePolicyBanners(panelEl, ocName, null, declined);
                updateEarlyJoinBanner(panelEl, null, []); updateLastJoinBanner(panelEl, ocName, null); updateSlotAdvice(panelEl, ocName, null, declined);
                return null;
            }
            if (panelEl.dataset.occHidden) { panelEl.style.display = ''; delete panelEl.dataset.occHidden; }
            panelEl.classList.toggle('occ-declined-visible', declined);
            processOC(panelEl, onCompletedTab, playerName);
            const hours = !isEmpty ? timeUntilNeededCached(panelEl) : null; // stall timer shows for everyone
            updateUrgentMarker(panelEl, hours);
            const hasMe = ocContainsPlayer(panelEl, playerName);
            panelEl.classList.toggle('occ-mine', hasMe);
            const queue = tracking && onCrimes && !onCompletedTab ? readOCQueue(panelEl) : null;
            const policy = queue ? classifyOC(panelEl, ocName, queue, hours, hasMe, declined) : null;
            updatePolicyMarker(panelEl, policy);
            updatePolicyBanners(panelEl, ocName, queue, declined, policy);
            updateSlotAdvice(panelEl, ocName, queue, declined, policy);
            return { panel: panelEl, ocName, queue, policy, hours, hasMe, isEmpty };
        }).filter(Boolean);

        if (tracking && onCrimes && !onCompletedTab) {
            applyScopeFallback(ocInfo);
            const fallback = ocInfo.find(i => i.policy?.state === 'fallback');
            if (fallback) {
                updatePolicyMarker(fallback.panel, fallback.policy);
                updatePolicyBanners(fallback.panel, fallback.ocName, fallback.queue, false, fallback.policy);
                updateSlotAdvice(fallback.panel, fallback.ocName, fallback.queue, false, fallback.policy);
            }
            const history = [...observeJoinEvents(ocInfo.filter(i => i.queue)), ...getAuditHistory()];
            ocInfo.forEach(i => updateEarlyJoinBanner(i.panel, i.queue, history));
            liveAudit = ocInfo.filter(i => i.queue && !i.isEmpty).map(i => ({ ocName: i.ocName, waiting: i.queue.waiting, unknown: i.queue.unknown, label: i.policy?.label || 'Unknown' }));
        } else {
            auditSnapshots.clear();
            panels.forEach(p => updateEarlyJoinBanner(p, null, []));
            liveAudit = [];
        }

        if (onCrimes && !onCompletedTab && rulesActive(settings.rules)) {
            const visible = ocInfo.map(info => ({ info, queue: info.queue || readOCQueue(info.panel) }));
            const hasEligibleExisting = ocInfo.some(i => !i.isEmpty && i.policy && [0, 1, 3].includes(i.policy.rank) && i.queue?.slots.some(s => {
                const button = pq('button[class*="joinButton___"]', s.element);
                return button && !button.disabled && isEligibleSlot(i.ocName, s, i.panel);
            }));
            visible.forEach(({ info, queue }) => updateJoinButtons(info, queue, hasEligibleExisting));
        } else {
            panels.forEach(p => getSlots(p).forEach(slot => { const b = pq('button[class*="joinButton___"]', slot); setJoinButtonBlocked(b, false); showJoinReason(slot, b, null); }));
        }

        if (!onCompletedTab) {
            const visible = ocInfo.map(info => ({ info, queue: info.queue || readOCQueue(info.panel) }));
            const signature = settings.rules.createdAt + ':' + visible.map(({ info, queue }) => info.panel.getAttribute('data-oc-id') + ':' +
                queue.slots.filter(s => !s.empty).map(s => s.occupant?.id || '?').sort().join(',')).sort().join('|');
            // A member joined or left: refresh the API data for the LAST JOIN banner (at most every 10 s).
            if (signature !== lastMemberSignature) {
                const first = !lastMemberSignature;
                lastMemberSignature = signature;
                if (!first && hasAccess() && Date.now() - lastSignatureRefresh > 10000) { lastSignatureRefresh = Date.now(); refreshLive(true); }
            }
            visible.forEach(({ info, queue }) => updateLastJoinBanner(info.panel, info.ocName, queue));
        } else {
            panels.forEach(p => updateLastJoinBanner(p, null, null));
        }
        panels.forEach(tidyStatus);

        // Order: join policy → policy tier then time to stall; otherwise empty OCs last.
        if ((tracking || settings.moveEmpty) && !onCompletedTab && !isLeaveConfirmOpen()) {
            if (tracking) {
                ocInfo.sort((a, b) => {
                    if (a.policy && b.policy) {
                        if (a.policy.rank !== b.policy.rank) return a.policy.rank - b.policy.rank;
                        const delta = (a.hours ?? Infinity) - (b.hours ?? Infinity);
                        if (!Number.isNaN(delta) && delta !== 0) return delta;
                    } else {
                        if (a.isEmpty !== b.isEmpty) return a.isEmpty - b.isEmpty;
                        if (a.hasMe !== b.hasMe) return b.hasMe - a.hasMe;
                    }
                    return (originalIndex.get(a.panel) ?? 0) - (originalIndex.get(b.panel) ?? 0);
                });
            } else {
                ocInfo.sort((a, b) => (a.isEmpty - b.isEmpty) || ((originalIndex.get(a.panel) ?? 0) - (originalIndex.get(b.panel) ?? 0)));
            }
            const container = panels[0]?.parentNode;
            if (container) reorder(container, ocInfo.map(x => x.panel));
        }
    }

    // Styles for Torn's own page elements (outside the dashboard).
    function injectPageStyles() {
        if (document.getElementById('occ-page-styles')) return;
        const style = document.createElement('style');
        style.id = 'occ-page-styles';
        style.textContent = `
.occ-weight-box{width:100%;text-align:center;margin-top:8px;padding:4px 0;border-radius:4px;background:rgba(0,0,0,0.15);display:block}
.occ-weight-box .label{font-size:12px;letter-spacing:1px;opacity:0.8}
.occ-weight-box .value{font-size:20px;font-weight:700}
.occ-urgent{outline:2px solid #ffea00 !important;box-shadow:0 0 8px rgba(255,234,0,0.6) !important;border-radius:6px}
.occ-status{grid-column:1 / -1;box-sizing:border-box;width:calc(100% - 20px);margin:4px 10px 6px;border:1px solid #4d5560;border-left-width:4px;border-radius:5px;background:rgba(30,34,40,0.95);overflow:hidden;font-size:12px;line-height:1.3;user-select:text;-webkit-user-select:text}
.occ-status-row{display:flex;align-items:center;justify-content:space-between;gap:6px 10px;flex-wrap:wrap;padding:5px 8px}
.occ-status-nomain .occ-status-row{justify-content:flex-end}
.occ-status-main{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto}
.occ-status-side{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end;flex:0 0 auto}
.occ-status-sub{display:flex;flex-direction:column}
.occ-status-sub:empty{display:none}
.occ-status .occ-policy-banner,.occ-status .occ-policy-text{display:block;width:auto;margin:0;padding:0;border:0;background:none;text-align:left;font-size:12px;font-weight:800;letter-spacing:.02em}
.occ-status .occ-decision-banner{order:1}.occ-status .occ-wait-banner{order:2}.occ-status .occ-policy-text{order:3}
.occ-status-sub .occ-policy-banner{padding:3px 8px;border-top:1px solid rgba(255,255,255,0.08);font-size:11px;font-weight:650;letter-spacing:0}
.occ-status-sub .occ-early-join-banner{order:1;background:rgba(90,24,24,0.7);color:#ffb3b3}
.occ-status-sub .occ-last-join-banner{order:2;background:rgba(19,39,57,0.7);color:#b9dbff}
.occ-status-sub .occ-last-join-banner[data-state="early"]{background:rgba(90,24,24,0.7);color:#ffb3b3}
.occ-status[data-state="join"],.occ-status[data-state="stalled"]{border-color:#68db73;background:rgba(16,48,23,0.95)}
.occ-status[data-state="wait"],.occ-status[data-state="unknown"]{border-color:#ffbf64;background:rgba(52,35,12,0.95)}
.occ-status[data-state="blocked"]{border-color:#ff6868;background:rgba(68,24,24,0.95)}
.occ-status[data-state="new"],.occ-status[data-state="own"]{border-color:#bfc5cc;background:rgba(41,47,54,0.95)}
.occ-status[data-state="exception"],.occ-status[data-state="fallback"]{border-color:#ce9dff;background:rgba(45,30,66,0.95)}
.occ-status .occ-wait-banner{color:#ffbf64}
.occ-needed-text,.occ-success-display{margin:0;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:750;white-space:nowrap;background:rgba(255,255,255,0.08);color:#d5dbe2}
.occ-needed-text{order:1}.occ-success-display{order:2}
.occ-success-display[data-projected="1"]{font-style:italic;color:#b8c2cc}
.occ-needed-text[data-level="amber"]{background:rgba(255,191,100,0.16);color:#ffcf7a}
.occ-needed-text[data-level="red"]{background:rgba(255,77,77,0.18);color:#ff8f8f}
.occ-needed-text[data-level="stalled"]{background:#d63c3c;color:#fff}
.occ-lock{display:block;box-sizing:border-box;flex:0 0 auto;align-self:start;justify-self:stretch;height:auto !important;min-height:0;max-height:none;margin:4px 4px 0;padding:2px 4px;width:calc(100% - 8px);border-radius:4px;font-size:11px;font-weight:700;line-height:1.3;text-align:center;white-space:normal;overflow:hidden;background:rgba(255,104,104,0.14);color:#ff9b9b;border:1px solid rgba(255,104,104,0.55)}
.occ-lock[data-kind="wait"]{background:rgba(255,191,100,0.14);color:#ffcf7a;border-color:rgba(255,191,100,0.55)}
.occ-advice-hidden{display:none !important}
.occ-weight-box > .occ-lock{margin:0 4px 6px}
.occ-lock-main{display:block;white-space:normal}
.occ-lock-detail{display:block;font-size:10px;font-weight:600;opacity:0.85;white-space:normal}
.occ-policy-text{text-align:center;font-weight:700;margin-top:5px;font-size:12px}
.occ-policy-text[data-state="join"],.occ-policy-text[data-state="stalled"]{color:#68db73}
.occ-policy-text[data-state="exception"],.occ-policy-text[data-state="fallback"]{color:#ce9dff}
.occ-policy-text[data-state="wait"],.occ-policy-text[data-state="unknown"]{color:#ffbf64}
.occ-policy-text[data-state="blocked"]{color:#ff6868}
.occ-policy-text[data-state="new"],.occ-policy-text[data-state="own"]{color:#bfc5cc}
.occ-join-advice{color:#ffbf64;text-align:center;font-size:12px;font-weight:700;padding:5px 3px}
.occ-policy-banner{display:block;box-sizing:border-box;flex:0 0 auto;grid-column:1 / -1;width:calc(100% - 20px);margin:4px 10px 6px;padding:5px 8px;border:1px solid #ffbf64;border-radius:4px;background:rgba(52,35,12,0.94);color:#ffbf64;font-size:12px;font-weight:700;line-height:1.3;text-align:center;user-select:text;-webkit-user-select:text}
.occ-policy-banner + .occ-policy-banner{margin-top:0}
.occ-policy-banner[data-state="join"]{border-color:#68db73;background:rgba(16,48,23,0.94);color:#68db73}
.occ-policy-banner[data-state="new"]{border-color:#bfc5cc;background:rgba(41,47,54,0.94);color:#bfc5cc}
.occ-policy-banner[data-state="early"]{border-color:#ff7777;background:rgba(68,24,24,0.94);color:#ffb3b3}
.occ-policy-banner[data-state="last-join"]{border-color:#85baf0;background:rgba(19,39,57,0.94);color:#b9dbff}
.occ-join-advice.occ-join-advice-box{display:block;box-sizing:border-box;width:max-content;max-width:calc(100% - 8px);margin:2px auto 0;padding:1px 5px;border:1px solid #ffbf64;border-radius:4px;background:rgba(52,35,12,0.94);font-size:11px;line-height:1.2;white-space:nowrap;user-select:text;-webkit-user-select:text}
.occ-join-advice[data-state="blocked"]{color:#ff6868}
.occ-join-advice[data-state="fallback"]{color:#ce9dff}
button.occ-join-disabled{filter:grayscale(1);opacity:0.45;cursor:not-allowed !important}
.occ-mine{border-radius:6px}
[data-oc-id].occ-declined-visible{position:relative}
[data-oc-id].occ-declined-visible::after{content:"";position:absolute;inset:0;background:rgba(200,30,30,0.22);outline:2px solid rgba(200,30,30,0.85);outline-offset:-2px;pointer-events:none;z-index:998;border-radius:inherit}
[data-oc-id].occ-mine [class*="shadowLayer___"]{background:rgba(40,96,50,0.45) !important;background-image:none !important;box-shadow:none !important}
[data-oc-id].occ-mine [class*="crimeBorderLayer___"]{background:rgb(40,96,50) !important;background-image:none !important}
`;
        document.head.appendChild(style);
    }

    let pageObserver = null, scanScheduled = false;
    function scheduleScan() {
        if (scanScheduled || !onOCPagePath()) return;
        scanScheduled = true;
        requestAnimationFrame(() => {
            scanScheduled = false;
            // Our own changes must not trigger another scan.
            pageObserver?.disconnect();
            try { placeCard(); scanPage(); } catch (error) { console.warn('[' + NAME + '] Page scan failed:', error); }
            finally { pageObserver?.observe(document.body, { childList: true, subtree: true }); }
        });
    }
    function rescanAll() { pqa(SEL_OC_PANEL).forEach(p => p.classList.remove('occ-processed')); scheduleScan(); }

    // ── Settings codes from faction newsletters ───────────────────────────
    // When you open a faction newsletter, Torn starts the mail body with its own
    // line "This is a newsletter from your faction:" followed by the newsletter
    // text. If that text contains a settings code newer than your rules, it is
    // imported at once (no request is made: the mail is already on your screen).
    // An Undo restores your previous rules.
    const NEWSLETTER_MARK = 'This is a newsletter from your faction:';
    let lastMailCode = '';
    function readNewsletter() {
        const body = document.querySelector('.reply-mail-container > .unreset.editor-content');
        const mark = body?.firstElementChild;
        if (!mark || mark.tagName !== 'P' || !mark.classList.contains('bold') || (mark.textContent || '').trim() !== NEWSLETTER_MARK) return null;
        const content = mark.nextElementSibling;
        if (!content || content.tagName !== 'DIV') return null;
        const code = findCodeInText(content.textContent);
        if (!code) return null;
        const link = document.querySelector('.reply-mail-container > p.bold a[href*="profiles.php?XID="]');
        const id = link?.getAttribute('href')?.match(/XID=(\d+)/)?.[1];
        return { code, name: (link?.textContent || 'your faction').trim().slice(0, 40), id: id ? Number(id) : null };
    }
    async function checkNewsletter() {
        if (location.pathname !== '/messages.php') return;
        const found = readNewsletter();
        if (!found || found.code === lastMailCode) return;
        lastMailCode = found.code;
        let rules;
        try { rules = await decodeRules(found.code); } catch (error) { return showRulesNotice('This newsletter has a settings code that could not be read: ' + error.message, false); }
        if (!rulesActive(rules) || rules.createdAt <= (settings.rules?.createdAt || 0)) return; // same or older rules
        const changes = diffRules(settings.rules, rules);
        await save('rulesUndo', { rules: settings.rules, from: settings.rulesFrom });
        settings.rules = rules; settings.rulesFrom = { name: found.name, id: found.id, via: 'newsletter', at: Date.now() };
        await saveSettings(); afterRulesChange();
        if (root && !$('#member-panel').hidden) syncMemberPanel();
        showRulesNotice('CPR rules updated from ' + found.name + '\'s faction newsletter (' + rulesSummary(rules) + ').', true, changes);
    }
    const NOTICE_CHANGES = 12;
    function showRulesNotice(text, canUndo, changes = null) {
        if (!root) return;
        $('#rules-notice-text').textContent = text;
        const list = $('#rules-notice-list');
        if (Array.isArray(changes)) {
            const shown = changes.length ? changes.slice(0, NOTICE_CHANGES) : ['No rule changes: same rules as before.'];
            list.innerHTML = '<li class="changes-head">What changed</li>' + shown.map(line => '<li>' + escape(line) + '</li>').join('')
                + (changes.length > NOTICE_CHANGES ? '<li class="muted">and ' + (changes.length - NOTICE_CHANGES) + ' more changes (see CPR rules)</li>' : '');
            list.hidden = false;
        } else { list.innerHTML = ''; list.hidden = true; }
        $('#rules-undo').hidden = !canUndo;
        $('#rules-notice').hidden = false;
    }
    async function undoRulesUpdate() {
        const undo = await read('rulesUndo', null);
        if (!undo) return;
        settings.rules = cleanRules(undo.rules); settings.rulesFrom = undo.from || null;
        await save('rulesUndo', null);
        await saveSettings(); afterRulesChange();
        if (root && !$('#member-panel').hidden) syncMemberPanel();
        showRulesNotice('Your previous CPR rules are back.', false);
    }

    // ── Member settings (no dashboard access) ─────────────────────────────
    function memberStatus(text, bad = false) { if (!root) return; $('#m-key-status').textContent = text; $('#m-key-status').className = 'note' + (bad ? ' value-lost' : ''); }
    function renderImportStatus() {
        const box = $('#m-import-status'), active = rulesActive(settings.rules), from = settings.rulesFrom;
        const when = from?.at ? ' on ' + new Date(from.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
        box.className = active ? 'import-ok' : 'import-none';
        box.textContent = !active ? 'No CPR settings imported yet. Paste your faction\'s code below, or open the faction newsletter that contains it.'
            : '✓ CPR settings imported' + (from?.via === 'newsletter' ? ' from ' + from.name + '\'s faction newsletter' : from?.via === 'manual' ? ' from a pasted code' : '') + when + '.';
        $('#m-summary').textContent = active ? rulesSummary(settings.rules) : '';
        $('#m-summary').hidden = !active;
    }
    function syncMemberPanel() {
        renderImportStatus(); $('#m-onpage').checked = settings.onPage; $('#m-weights').checked = settings.tpWeights;
        $('#m-block').checked = settings.blockJoins; $('#m-hide-declined').checked = settings.hideDeclined; $('#m-move-empty').checked = settings.moveEmpty; $('#m-card').value = settings.cardPos;
        $('#m-joinpolicy').value = settings.joinPolicy; $('#m-scope').value = getScope() ?? '';
    }
    function openMember() {
        if (!root) return;
        syncMemberPanel();
        $('#member-panel').hidden = false; $('#m-backdrop').hidden = false;
        $('#m-close').focus();
    }
    function closeMember() { $('#member-panel').hidden = true; $('#m-backdrop').hidden = true; }
    // Dashboard controls mirror settings that members can also change.
    function syncDashboardControls() {
        $('#set-onpage').checked = settings.onPage; $('#set-weights').checked = settings.tpWeights; $('#set-block').checked = settings.blockJoins;
        $('#set-hide-declined').checked = settings.hideDeclined; $('#set-move-empty').checked = settings.moveEmpty;
        $('#set-joinpolicy').value = settings.joinPolicy; $('#set-scope').value = getScope() ?? '';
    }

    // ── Settings & misc ───────────────────────────────────────────────────
    async function importTTPrices() {
        if (busy) return;
        let count = 0;
        const additions = {};
        for (const el of document.querySelectorAll('.tt-item-price')) {
            const row = el.closest('li[data-item]');
            // Only accept verified item IDs. Faction armory React row IDs are not item IDs.
            if (!row || !validId(row.dataset.item) || !el.getClientRects().length) continue;
            const price = unitPriceFromTT(el.textContent);
            if (price == null) continue;
            additions[Number(row.dataset.item)] = { price, at: Date.now() };
        }
        count = Object.keys(additions).length;
        if (!count) return message('No readable TornTools prices found. Open Items, enable TornTools item values, select a category and use ' + NAME + ' → Import visible prices. API prices still work.');
        // Merge against current storage so an inventory tab does not erase another tab's prices.
        ttPrices = { ...(await read('ttPrices', {})), ...additions };
        await save('ttPrices', ttPrices); render(); renderLive();
        message('Imported ' + count + ' visible TornTools unit prices. Cache lasts 6 hours. No API requests were needed.');
    }
    function setSelectedPreset(days) {
        root.querySelectorAll('[data-days]').forEach(el => {
            const selected = Number(el.dataset.days) === days;
            el.classList.toggle('is-selected', selected);
            el.setAttribute('aria-pressed', String(selected));
        });
    }
    function preset(days) {
        const now = new Date(), from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        from.setUTCDate(from.getUTCDate() - days + 1);
        $('#from').value = utcDay(from); $('#to').value = utcDay(now);
        setSelectedPreset(days);
    }
    function updateConnection() {
        if (!root) return;
        $('#connection-text').textContent = key ? 'API key saved' : 'No API key saved';
        $('#connection-dot').classList.toggle('connected', !!key);
        $('#key').placeholder = key ? 'Key saved. Enter a new key to replace it.' : 'Enter your 16-character Torn API key';
    }
    function updateView() {
        if (!root) return;
        if (!report && ['participation', 'costs', 'activity'].includes(currentView)) currentView = 'overview';
        root.querySelectorAll('[data-view]').forEach(button => {
            button.disabled = ['participation', 'costs', 'activity'].includes(button.dataset.view) && !report;
            const active = button.dataset.view === currentView;
            button.classList.toggle('is-active', active);
            if (active) button.setAttribute('aria-current', 'page');
            else button.removeAttribute('aria-current');
        });
        root.querySelectorAll('[data-view-panel]').forEach(section => { section.hidden = section.dataset.viewPanel !== currentView; });
        $('#report-controls').hidden = !REPORT_VIEWS.includes(currentView);
        $('#crime-field').hidden = !['costs', 'activity'].includes(currentView);
        $('#status').hidden = ['live', 'cpr'].includes(currentView);
        $('#report-state').hidden = !REPORT_VIEWS.includes(currentView);
        $('#live-state').hidden = currentView !== 'live';
        const titles = {
            live: ['Live overview', 'Who is free, which crimes need members, and what needs attention right now.'],
            overview: ['Report overview', 'Completed OCs, participation and item costs for a chosen period.'],
            participation: ['Member participation', 'Completed OCs per member in the report period.'],
            costs: ['Item cost breakdown', 'See item quantities, unit prices, total value, and faction costs.'],
            activity: ['OC activity log', 'Inspect individual item loss and consumption records.'],
            cpr: ['CPR settings', 'Set your faction\'s CPR rules and share them with members as a settings code.'],
            settings: ['Settings', 'Manage your API connection, live view, alerts, item values and display.']
        };
        $('#view-title').textContent = titles[currentView][0];
        $('#view-subtitle').textContent = titles[currentView][1];
    }
    function showView(view) {
        if (['participation', 'costs', 'activity'].includes(view) && !report) return;
        if (!VIEWS.includes(view)) return;
        currentView = view;
        updateView();
        $('#main-scroll').scrollTop = 0;
        if (view === 'live') { renderLive(); refreshLive(false); }
        if (view === 'cpr') renderCprEditor();
    }
    function applyLauncherPos() {
        if (!launcher) return;
        LAUNCHER_POSITIONS.forEach(pos => launcher.classList.toggle('pos-' + pos, pos === launcherPos));
    }
    function open() {
        if (!hasAccess()) { openMember(); return; }
        syncDashboardControls();
        panel.hidden = false; $('#backdrop').hidden = false; launcher.hidden = true;
        showView(currentView === 'settings' || VIEWS.includes(currentView) ? currentView : 'live');
        $('#close').focus();
    }
    const onOCPage = () => /^\/(factions|organizedcrimes|item)\.php$/.test(location.pathname);
    function launcherShown() { return hasAccess() && launcherPos !== 'hidden' && (onOCPage() || settings.launcherEverywhere); }
    function close() { panel.hidden = true; $('#backdrop').hidden = true; launcher.hidden = !launcherShown(); if (!launcher.hidden) launcher.focus(); }
    async function saveSettings() {
        try { await save('settings', settings); } catch (_) { message('Could not save settings.', true); }
    }
    function readSettings(stored) {
        const s = stored && typeof stored === 'object' ? stored : {};
        const num = (v, d, min, max) => Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max ? Number(v) : d;
        return { lowPass: num(s.lowPass, 50, 0, 100), inactiveHours: num(s.inactiveHours, 96, 1, 2000),
            lastOcWarnHours: num(s.lastOcWarnHours, 24, 1, 2000), lastOcAlertHours: num(s.lastOcAlertHours, 48, 1, 2000),
            ignored: Array.isArray(s.ignored) ? s.ignored.filter(validId).map(Number) : [],
            successChance: s.successChance === true, autoRefresh: s.autoRefresh !== false,
            cardPos: ['top', 'bottom', 'off'].includes(s.cardPos) ? s.cardPos : s.crimesCard === false ? 'off' : 'top', cardCompact: s.cardCompact !== false,
            breachAlerts: s.breachAlerts !== false, breachDesktop: s.breachDesktop === true, breachItems: s.breachItems !== false, breachAway: s.breachAway !== false,
            breachMinutes: num(s.breachMinutes, 5, 1, 60), launcherEverywhere: s.launcherEverywhere === true,
            onPage: s.onPage !== false, hideDeclined: s.hideDeclined !== false, moveEmpty: s.moveEmpty !== false,
            joinPolicy: ['auto', 'on', 'off'].includes(s.joinPolicy) ? s.joinPolicy : 'auto', blockJoins: s.blockJoins !== false, tpWeights: s.tpWeights !== false,
            scope: Number.isInteger(s.scope) && s.scope >= 0 && s.scope <= 999 ? s.scope : null,
            rules: cleanRules(s.rules),
            rulesFrom: s.rulesFrom && typeof s.rulesFrom === 'object' && typeof s.rulesFrom.name === 'string'
                ? { name: s.rulesFrom.name.slice(0, 40), id: validId(s.rulesFrom.id) ? Number(s.rulesFrom.id) : null,
                    via: s.rulesFrom.via === 'manual' ? 'manual' : s.rulesFrom.name ? 'newsletter' : 'manual',
                    at: Number.isFinite(s.rulesFrom.at) && s.rulesFrom.at > 0 ? s.rulesFrom.at : null } : null };
    }
    function downloadFile(content, type, suffix) {
        const prefix = report?.complete === false ? 'PARTIAL-' : '';
        const filename = prefix + 'OC-Command-Centre-' + (report?.faction?.id || 'faction') + '-' + (report?.range?.start || utcDay(new Date())) + '-' + (report?.range?.end || '') + '-' + suffix;
        const url = URL.createObjectURL(new Blob([content], { type }));
        // Local file download of data already on screen; no request is made to Torn.
        const link = document.createElement('a'); link.href = url; link.download = filename;
        link.style.display = 'none'; document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
    function metaColumns() {
        return [report.complete ? 'Complete' : 'PARTIAL', report.faction.id, report.faction.name,
            timeText(report.range.from), timeText(report.range.to), $('#crime').value];
    }
    const metaHeaders = ['Report completeness', 'Faction ID', 'Faction', 'Range from TCT', 'Range to TCT', 'Crime filter'];
    function exportSummary() {
        if (!report) return;
        const rows = aggregate(filtered().records, info);
        const headers = [...metaHeaders, 'Item ID', 'Item', 'Lost', 'Consumed (used non-reusable)',
            'Unit market value', 'Price source', 'Price captured UTC', 'Total item cost', 'Faction item cost', 'OC count'];
        downloadFile(csv([headers, ...rows.map(r => [...metaColumns(), r.id, r.name, r.lost, r.consumed, r.price ?? '', r.source,
            r.pricedAt ? new Date(r.pricedAt).toISOString() : '', r.cost ?? '', r.factionCost ?? '', r.crimes])]),
            'text/csv;charset=utf-8', 'items.csv');
    }
    function exportDetails() {
        if (!report) return;
        const names = memberNames();
        const headers = [...metaHeaders, 'OC ID', 'OC', 'Status', 'Executed TCT', 'Slot', 'Member XID', 'Member', 'Item ID', 'Item', 'Item UID',
            'Owner', 'Torn item outcome', 'Cost reason', 'Unit market value', 'Price source', 'Price captured UTC', 'Item cost', 'Note'];
        downloadFile(csv([headers, ...filtered().records.map(r => {
            const item = info(r.itemId);
            return [...metaColumns(), r.crimeId, r.crime, r.status, timeText(r.executed), r.slot, r.userId, names.get(r.userId) || '', r.itemId, item.name,
                r.itemUid, r.owner, r.outcome, r.reason, item.price ?? '', item.source,
                item.at ? new Date(item.at).toISOString() : '', item.price ?? '', r.note];
        })]), 'text/csv;charset=utf-8', 'details.csv');
    }
    function exportParticipation() {
        if (!report) return;
        const headers = ['Report completeness', 'Faction ID', 'Faction', 'Range from TCT', 'Range to TCT', 'Member XID', 'Member', 'Current member',
            'Completed OCs', 'Successful', 'Failed', 'Success rate', 'Last OC TCT'];
        downloadFile(csv([headers, ...participationRows().map(r => [report.complete ? 'Complete' : 'PARTIAL', report.faction.id, report.faction.name,
            timeText(report.range.from), timeText(report.range.to), r.id, r.name, r.current ? 'Yes' : 'No', r.total, r.success, r.fail,
            r.total ? Math.round(r.success * 100 / r.total) + '%' : '', r.last ? timeText(r.last) : ''])]), 'text/csv;charset=utf-8', 'participation.csv');
    }

    function buildUI() {
        host = document.createElement('div'); host.id = 'eaglewing-oc-command-centre';
        // A closed shadow root keeps the panel's contents out of reach of page scripts.
        root = host.attachShadow({ mode: 'closed' }); document.body.append(host);
        root.innerHTML = `<style>
:host { all: initial; color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Arial, sans-serif; font-size: 13px; color: #e9eef7; }
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
button, input, select { font: inherit; }
button { cursor: pointer; transition: background .16s, color .16s, border-color .16s, transform .16s; }
button:disabled { opacity: .45; cursor: not-allowed; transform: none !important; }
button:focus-visible, input:focus-visible, select:focus-visible, a:focus-visible, summary:focus-visible, tr:focus-visible { outline: 2px solid #ff7b84; outline-offset: 2px; }
button, select { -webkit-tap-highlight-color: transparent; }
#launcher { position: fixed; right: 22px; bottom: 74px; z-index: 2147483646; display: flex; align-items: center; gap: 10px; padding: 10px 15px 10px 10px; color: #fff; font-size: 12px; font-weight: 750; letter-spacing: .015em; background: #a52a3c; border: 1px solid #eb6878; border-radius: 14px; box-shadow: 0 12px 38px #0009, 0 0 0 3px #9e203a18; }
#launcher:hover { background: #bc354a; transform: translateY(-2px); }
#launcher.pos-bottom-left { right: auto; left: 22px; }
#launcher.pos-middle-right { bottom: auto; top: 50%; transform: translateY(-50%); }
#launcher.pos-middle-right:hover { transform: translateY(calc(-50% - 2px)); }
.launcher-mark, .brand-mark { display: inline-grid; place-items: center; flex-shrink: 0; background: linear-gradient(145deg,#fc6678,#9b2037); color: #fff; font-weight: 850; letter-spacing: -.06em; border: 1px solid #ffffff20; }
.launcher-mark { width: 28px; height: 28px; border-radius: 9px; background: #ffffff1d; }
#backdrop { position: fixed; inset: 0; z-index: 2147483644; background: #03060bc9; backdrop-filter: blur(5px); }
#panel { position: fixed; z-index: 2147483646; left: 50%; top: 50%; transform: translate(-50%,-50%); width: min(1490px, calc(100vw - 44px)); height: min(94vh, 1020px); display: flex; flex-direction: column; overflow: hidden; background: #10151e; border: 1px solid #344050; border-radius: 17px; box-shadow: 0 25px 90px #000d, 0 0 0 1px #ffffff08; }
#panel::before { content: ''; height: 3px; width: 100%; flex-shrink: 0; background: linear-gradient(90deg,#f46b76,#ae2c45 48%,#342635); }
.topbar { display: flex; align-items: center; justify-content: space-between; gap: 14px; min-height: 70px; padding: 12px 22px; background: #151c26; border-bottom: 1px solid #2b3543; }
.brand { display: flex; align-items: center; gap: 12px; }
.brand-mark { width: 39px; height: 39px; border-radius: 11px; font-size: 14px; }
.brand-name { font-size: 15px; font-weight: 790; letter-spacing: -.025em; }
.brand-sub { margin-top: 2px; font-size: 11px; color: #94a2b5; }
.topbar-actions { display:flex; align-items:center; gap: 11px; }
.version-label { padding: 5px 9px; font-size: 11px; font-weight: 650; color: #aebcce; border: 1px solid #303c4d; border-radius: 7px; }
.icon-close { width: 34px; height: 34px; display: grid; place-items: center; background: #222c39; color: #c2cbd7; border: 1px solid #364457; border-radius: 9px; font-size: 22px; line-height: 1; }
.icon-close:hover { background: #343f4e; color: #fff; }
.shell { min-height: 0; flex: 1; display: grid; grid-template-columns: 219px minmax(0,1fr); }
.sidebar { display: flex; flex-direction: column; min-height: 0; padding: 22px 12px 17px; background: #131923; border-right: 1px solid #2b3542; }
.nav-eyebrow { padding: 0 13px 12px; color: #79899e; font-size: 10px; font-weight: 800; letter-spacing: .15em; text-transform: uppercase; }
.nav-eyebrow.second { padding-top: 6px; }
.nav-item { display:flex; align-items:center; width:100%; gap: 12px; padding: 12px 14px; margin: 2px 0; background: transparent; color: #aab6c6; border: 1px solid transparent; border-radius: 10px; text-align: left; font-size: 13px; font-weight: 640; }
.nav-item svg { width: 17px; height: 17px; flex-shrink: 0; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.nav-item:hover:not(:disabled) { color:#f2f5fa; background:#242e3c; }
.nav-item.is-active { color: #fff; background: linear-gradient(95deg,#81283b66,#51233525); border-color: #a743554f; }
.nav-item.is-active svg { color:#ff7587; }
.nav-rule { margin: 14px 12px; border-top: 1px solid #2a3442; }
.nav-bottom { margin-top: auto; padding: 16px 11px 0; border-top: 1px solid #2a3442; }
.connection-label { display: flex; align-items: center; gap: 8px; color: #9eacbe; font-size: 11px; }
.connection-dot { width: 7px; height: 7px; border-radius: 50%; background: #7c8594; box-shadow: 0 0 0 3px #7c85941b; }
.connection-dot.connected { background: #61cc9b; box-shadow:0 0 0 3px #61cc9b1b; }
.author { margin-top: 11px; color: #6e7e92; font-size: 10px; line-height: 1.6; }
.main { min-width:0; min-height:0; display:flex; flex-direction:column; overflow-y:auto; overscroll-behavior:contain; scrollbar-color: #485567 transparent; scrollbar-width: thin; }
.main-inner { width:100%; max-width: 1380px; margin: 0 auto; padding: 26px clamp(18px,3vw,38px) 36px; }
.workspace-head { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:20px; }
.eyebrow { color:#f07887; font-size:10px; font-weight:800; letter-spacing:.16em; text-transform:uppercase; margin-bottom:6px; }
h1, h2, h3, p { margin-top: 0; }
h1 { font-size: clamp(22px,2.3vw,29px); letter-spacing: -.04em; line-height:1.16; margin-bottom: 7px; font-weight: 790; }
h2 { font-size: 16px; letter-spacing:-.015em; margin: 0; font-weight: 740; }
h3 { font-size: 13px; letter-spacing:-.01em; margin: 0; }
.subtitle { color: #8e9eaf; font-size:12px; line-height:1.6; margin:0; }
.report-state { display: inline-flex; align-items:center; gap:7px; white-space:nowrap; border: 1px solid #364153; background: #1d2633; border-radius: 30px; padding: 8px 12px; font-size: 11px; color: #afbdce; font-weight: 720; }
.report-state::before { content:''; width:6px; height:6px; background:#8795a5; border-radius:50%; }
.report-state.ready { color: #8ee1bb; border-color: #2e644d; background: #173328; }
.report-state.ready::before { background: #72dba8; }
.report-state.partial { color: #ffd297; border-color: #705237; background:#36271d; }
.report-state.partial::before { background:#fbbf76; }
.section-card { border:1px solid #303c4b; border-radius:12px; background:#171f2b; box-shadow: 0 4px 16px #0208121f; }
.report-builder { padding:16px 18px; margin-bottom: 12px; }
.toolbar { display:flex; align-items:end; justify-content:space-between; gap:14px; flex-wrap:wrap; }
.toolbar-primary { display:flex; align-items:end; flex-wrap:wrap; gap:12px; }
.field { display:flex; flex-direction:column; gap:6px; min-width:0; }
.field-label { color:#99a9bb; font-size:10px; font-weight:750; text-transform: uppercase; letter-spacing:.065em; }
.presets { display: flex; gap:5px; padding:4px; background:#101722; border:1px solid #323e4e; border-radius:9px; }
.preset { padding:9px 12px; background:transparent; color:#9cabbc; border:1px solid transparent; border-radius:6px; white-space:nowrap; font-size:11px; font-weight:730; }
.preset:hover:not(:disabled) { color:#fff; background:#253244; }
.preset.is-selected { color:#fff; background:#363f50; border-color:#4d5b71; box-shadow:0 1px 4px #0004; }
input, select { background:#101722; color:#edf2fb; border:1px solid #374457; border-radius:8px; padding:10px 11px; min-width:0; outline:none; }
input:hover, select:hover { border-color:#586a82; }
input[type=date] { width: 146px; min-height: 38px; color-scheme:dark; }
input[type=password] { width:min(390px,100%); }
input[type=number] { width: 92px; }
input[type=text] { width:min(260px,100%); }
textarea { display:block; width:100%; margin-top:10px; background:#101722; color:#edf2fb; border:1px solid #374457; border-radius:8px; padding:10px 11px; font:11px/1.5 ui-monospace, Consolas, monospace; resize:vertical; outline:none; }
.cpr-table th { position:static; }
.cpr-table td { padding:7px 12px; }
.t-center { text-align:center; }
.cpr-table input[type=checkbox] { width:15px; }
.no-policy .policy-col, .no-policy .policy-only { display:none !important; }
.cpr-table input { width:80px; padding:6px 8px; }
#cpr-roles-wrap.is-off { opacity:.45; }
input[type=checkbox] { accent-color:#d64b5f; width:15px; height:15px; margin:0; }
select { max-width: 280px; }
.btn { display:inline-flex; justify-content:center; align-items:center; gap:8px; padding:10px 13px; color:#d4dfea; background:#263141; border:1px solid #3c4d61; border-radius:8px; font-size:12px; font-weight:710; line-height:1.25; white-space:nowrap; }
.btn:hover:not(:disabled) { background:#354456; border-color:#66758a; color:#fff; }
.btn-primary { background:#bb344b; color:#fff; border-color:#dd5266; box-shadow:inset 0 1px 0 #ffffff14; }
.btn-primary:hover:not(:disabled) { background:#d04258; border-color:#f16d7f; }
.btn-outline { background:transparent; color:#b8c5d4; }
.btn-danger { color:#ffb9c1; border-color:#7d3f4d; background:#3b2530; }
.btn-danger:hover:not(:disabled) { background:#57303c; }
.btn-big { min-height:38px; }
.btn.mini { padding:5px 9px; font-size:11px; }
a.btn { text-decoration:none; }
.row-actions { display:inline-flex; gap:6px; justify-content:flex-end; }
.toolbar-caption { font-size:11px; color:#7d90a4; margin:11px 0 0; line-height:1.5; }
.filter-strip { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin: 0 0 12px; padding: 12px 15px; }
.filter-set, .export-set { display:flex; align-items:center; gap:9px; flex-wrap:wrap; }
.filter-set .field { flex-direction:row; align-items:center; gap:8px; }
.filter-set .field-label { white-space:nowrap; }
.filter-set select { padding:8px 28px 8px 11px; font-size:12px; }
.exports-label { color:#8e9eb1; font-size:10px; text-transform:uppercase; font-weight:740; letter-spacing:.09em; }
.export-set .btn { padding:8px 10px; font-size:11px; }
.status-bar { display:flex; align-items:flex-start; gap:10px; margin-bottom: 20px; padding: 11px 14px; background:#1b2533; border:1px solid #344356; border-radius:9px; color:#aab9ce; font-size:11px; line-height:1.6; }
.status-icon { display:inline-grid; place-items:center; width:17px; height:17px; flex-shrink:0; border-radius:50%; background:#334a64; color:#a9d2ff; font-size:11px; font-weight:900; }
.status-bar.bad { color:#ffb6b9; background:#351f2b; border-color:#7d3d49; }
.status-bar.bad .status-icon { background:#7b3142; color:#ffdee1; }
.section-heading { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin:2px 0 14px; }
.section-tag { color:#aab8cb; padding:6px 10px; border-radius:7px; border:1px solid #344154; font-size:11px; font-weight:650; }
#heading, #live-heading { font-size:16px; font-weight:730; color:#eaf0f9; margin:0; }
#heading.bad { color:#ffb6ab; }
#period, #live-period { margin: 6px 0 0; color:#899caf; font-size:11px; line-height:1.6; }
.summary-grid { display:grid; grid-template-columns: repeat(5,minmax(0,1fr)); gap:11px; margin: 17px 0 20px; }
.metric { padding:16px; min-width:0; border:1px solid #354153; border-radius:11px; background:linear-gradient(160deg,#222d3b,#1b2431); }
.metric span { display:block; color:#9cacbe; font-size:11px; font-weight:630; line-height:1.5; }
.metric strong { display:block; color:#f7f9fe; font-size:clamp(16px,1.7vw,23px); font-weight:760; margin-top:8px; letter-spacing:-.04em; overflow-wrap:anywhere; font-variant-numeric:tabular-nums; }
.metric:nth-child(4) { background:linear-gradient(160deg,#382832,#25212e); border-color:#684152; }
.metric:nth-child(4) strong { color:#ffcad1; }
.metric small { display:block; color:#8194ab; font-size:10px; font-weight:500; margin-top:5px; line-height:1.45; }
.warning-box { white-space:pre-line; padding:13px 15px 13px 18px; margin: 0 0 17px; color:#ffd5a6; background:#33291e; border:1px solid #715537; border-left:3px solid #e8a966; border-radius:9px; font-size:11px; line-height:1.75; }
.error-box { padding:12px 15px; margin:0 0 16px; color:#ffb6b9; background:#351f2b; border:1px solid #7d3d49; border-radius:9px; font-size:11px; line-height:1.6; }
.overview-grid { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:12px; }
.info-card { padding:20px; min-width:0; }
.costs-ownership { margin-bottom:16px; }
.costs-ownership .ownership-legend { grid-template-columns:repeat(auto-fit, minmax(170px, 1fr)); }
.info-card h2 { margin-bottom:11px; }
.info-card p { margin-bottom:12px; color:#97a7b9; font-size:12px; line-height:1.8; }
.inline-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:17px; }
.info-card .btn { font-size:11px; }
.muted { color:#8394a7; }
.ownership-bar { display:flex; overflow:hidden; border-radius:9px; height:11px; background:#354252; margin:17px 0; }
.ownership-bar > span { height:100%; min-width:0; }
.ownership-faction { background:#e46678; }
.ownership-member { background:#728ddc; }
.ownership-unknown { background:#7a8796; }
.ownership-legend { display:grid; gap:10px; }
.legend-row { display:flex; justify-content:space-between; gap:10px; color:#9dacc0; font-size:12px; }
.legend-row strong { color:#ecf1fa; font-variant-numeric:tabular-nums; }
.legend-name { display:flex; align-items:center; gap:8px; }
.legend-dot { width:8px; height:8px; border-radius:3px; flex-shrink:0; }
.note { color:#94a4b8; font-size:11px; line-height:1.75; }
#price-note { margin:17px 0 0; padding:13px 15px; background:#141d29; border:1px solid #303e4e; border-radius:9px; }
.table-card { overflow:hidden; margin-bottom:12px; }
.table-intro { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; padding:17px 19px; gap:10px; border-bottom:1px solid #303c4b; }
.table-intro h2 { margin-bottom:5px; }
.table-intro p { margin:0; color:#8fa0b2; font-size:11px; }
.table-scroll { max-height: min(56vh,590px); overflow:auto; scrollbar-width:thin; scrollbar-color:#4c596c transparent; }
table { width:100%; border-collapse:separate; border-spacing:0; font-size:12px; font-variant-numeric: tabular-nums; }
th { position:sticky; top:0; z-index:1; background:#212b39; border-bottom:1px solid #3c4b5e; color:#9eafc1; font-weight:730; font-size:10px; letter-spacing:.04em; text-align:left; white-space:nowrap; padding:13px 15px; }
td { padding:13px 15px; background:#171f2b; border-bottom:1px solid #2a3543; color:#cbd5e2; vertical-align:middle; line-height:1.5; }
tbody tr:hover td { background:#202b3a; }
tbody tr:last-child td { border-bottom:0; }
.t-right { text-align:right; }
.primary-cell { display:block; font-weight:700; color:#f1f5fa; font-size:12px; }
.secondary-cell { display:block; margin-top:4px; color:#8194aa; font-size:10px; font-weight:520; }
.value-strong { color:#f0f3f9; font-weight:740; }
.value-accent { color:#ffc6ce; font-weight:750; }
.value-lost { color:#f68a97; font-weight:750; }
.value-used { color:#f0c37f; font-weight:720; }
.value-good { color:#8ee1bb; font-weight:700; }
.value-projected { color:#aab6c6; font-weight:650; font-style:italic; }
.info-callout { margin:12px 0 4px; padding:10px 13px; border:1px solid rgba(110,170,240,.45); border-left:3px solid #6ea8f0; border-radius:8px; background:rgba(60,110,180,.12); color:#cfe0f5; font-size:12px; line-height:1.55; }
.info-callout strong { color:#e6f0fb; }
#m-import-status.import-ok { margin:0 0 6px; color:#5fd68f; font-weight:700; }
#m-import-status.import-none { margin:0 0 6px; color:#aab6c6; }
.key-warning { margin:10px 0 12px; padding:10px 12px; border:1px solid rgba(240,180,60,.55); background:rgba(240,180,60,.12); color:#ffd88a; border-radius:8px; line-height:1.45; }
.key-warning strong { color:#ffe2a6; }
.key-req { margin:8px 0; padding-left:18px; line-height:1.55; }
.key-req li { margin:2px 0; }
.pill { display:inline-flex; align-items:center; justify-content:center; padding:4px 8px; border-radius:6px; font-size:10px; font-weight:720; white-space:nowrap; }
.pill-lost { background:#5b2c3a; color:#ffc0ca; }
.pill-consumed { background:#4d3a24; color:#f6d199; }
.pill-faction { background:#4b2b39; color:#f2b2c0; }
.pill-user { background:#263b5d; color:#b7d5ff; }
.pill-unknown { background:#33404b; color:#bdc7d1; }
.pill-ok { background:#1f3d31; color:#9fe6c3; }
.sort-col { cursor:pointer; user-select:none; }
.sort-col:hover { color:#fff; background:#2c394a; }
.sort-arrow { opacity:.5; padding-left:4px; font-size:10px; }
.sort-col[aria-sort=ascending] .sort-arrow, .sort-col[aria-sort=descending] .sort-arrow { opacity:1; color:#fb7b8e; }
.empty-row { padding:35px 18px; color:#91a2b5; text-align:center !important; }
.table-foot { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; border-top:1px solid #303b49; padding:13px 18px; color:#8b9caf; font-size:11px; }
.pager { display:flex; align-items:center; gap:9px; }
.pager .btn { padding:7px 11px; font-size:11px; }
.member-link { color:#f1f5fa; text-decoration:none; font-weight:700; }
.member-link:hover { color:#ff9aa6; text-decoration:underline; text-underline-offset:3px; }
.crime-row { cursor:pointer; }
.caret { color:#ff7587; font-size:10px; }
.detail-row > td { background:#121923; padding:6px 15px 14px 30px; }
.slot-table th { position:static; background:#1a2330; }
.slot-table td { background:#141c27; padding:9px 12px; }
.issue-list { display:flex; flex-direction:column; align-items:flex-start; gap:5px; min-width:0; }
.issue { display:block; max-width:100%; padding:5px 9px; border-radius:6px; font-size:10px; font-weight:700; line-height:1.5; background:#33404b; color:#d3dbe4; overflow-wrap:anywhere; }
.issue-items { margin:3px 0 0; padding:0 0 0 14px; font-weight:600; }
.issue-items li { margin:1px 0; }
.issue-stalled { background:#5b2c3a; color:#ffc0ca; }
.issue-delayed, .issue-away { background:#4d3a24; color:#f6d199; }
.issue-item { background:#263b5d; color:#b7d5ff; }
.issue-early { background:#5b2c3a; color:#ffc0ca; }
.issue-pass, .issue-declined { background:#5b2c3a; color:#ffc0ca; }
.issue-over, .issue-expiring { background:#3a3346; color:#d9c8f3; }
.timer { white-space:nowrap; }
.timer-soon { color:#f0c37f; font-weight:700; }
.timer-late { color:#f68a97; font-weight:750; }
.attention-card { padding:6px 0; margin-bottom:12px; }
.attention-card h2 { padding:12px 19px 8px; }
.attention-list { list-style:none; margin:0; padding:0; max-height:280px; overflow:auto; }
.attention-row { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap; padding:11px 19px; border-top:1px solid #2a3543; }
.attention-row > .issue-list { align-items:flex-end; max-width:min(520px,100%); }
@media (max-width: 820px) { .attention-row > .issue-list { align-items:flex-start; max-width:100%; } }
.live-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:12px; padding:12px 15px; }
.settings-grid { display:grid; gap:14px; }
.settings-card { padding:20px; }
.settings-card h2 { margin-bottom:7px; }
.settings-card p { color:#92a5ba; font-size:12px; line-height:1.8; margin:0 0 15px; }
.settings-card .row { display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin:12px 0 0; }
.settings-card a { color:#ff9aa6; font-size:12px; text-underline-offset:3px; }
.checkbox-label { display:flex; align-items:center; gap:9px; color:#d9e1eb; font-size:12px; }
.number-label { display:flex; align-items:center; gap:9px; color:#d9e1eb; font-size:12px; }
.settings-subheading { color:#dce6f3; font-weight:720; margin-top:19px; font-size:12px; }
.tos-table th { position:static; }
.tos-table td { vertical-align:top; font-size:11px; }
.ignored-row { display:flex; justify-content:space-between; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid #2a3543; font-size:12px; }
.empty-state { padding:65px 24px; text-align:center; border:1px dashed #405064; border-radius:12px; background:radial-gradient(ellipse at top,#2931418c,#151e2b 65%); }
.empty-symbol { display:inline-grid; place-items:center; width:58px; height:58px; margin-bottom:18px; color:#ff9caa; font-size:25px; font-weight:850; border-radius:17px; border:1px solid #894355; background:#572c3b; }
.empty-state h2 { font-size:19px; margin-bottom:8px; }
.empty-state p { max-width:470px; margin: 0 auto; color:#91a1b5; font-size:12px; line-height:1.9; }
.footer-copy { margin-top:23px; color:#6a7e92; font-size:10px; }
@media (max-width: 1190px) { .summary-grid { grid-template-columns:repeat(3,minmax(0,1fr)); } .toolbar { align-items:stretch; } }
@media (max-width: 820px) { #panel { width:calc(100vw - 12px); height:calc(100dvh - 12px); border-radius:12px; } .shell { grid-template-columns:1fr; grid-template-rows:auto minmax(0,1fr); } .sidebar { flex-direction:row; align-items:center; gap:4px; overflow-x:auto; padding:7px 10px; border-right:0; border-bottom:1px solid #344052; } .sidebar .nav-eyebrow,.sidebar .nav-rule,.sidebar .nav-bottom { display:none; } .nav-item { width:auto; min-width:max-content; padding:9px 11px; margin:0; gap:7px; } .nav-item svg { width:15px; height:15px; } .main-inner { padding:19px 15px 28px; } .summary-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } .overview-grid { grid-template-columns:1fr; } .table-scroll { max-height:45vh; } .detail-row > td { padding-left:15px; } }
@media (max-width: 530px) { .topbar { padding:11px 13px; min-height:62px; } .brand-mark { width:33px; height:33px; } .brand-name { font-size:13px; } .version-label { display:none; } .sidebar { gap:1px; padding:7px 6px; } .nav-item { font-size:10px; gap:4px; padding:9px 6px; } .nav-item svg { width:13px; height:13px; } .toolbar-primary:first-child { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:10px; width:100%; } .toolbar-primary:first-child > .field:first-child { grid-column:1/-1; } .toolbar-primary:first-child > .field { width:100%; min-width:0; } .toolbar-primary:last-child { width:100%; } .toolbar-primary:last-child .btn { width:100%; } input[type=date] { width:100%; } .presets { width:100%; } .presets .preset { flex:1; } .report-builder { padding:13px; } .metric { padding:12px; } .metric strong { font-size:20px; } .filter-strip { padding:11px; } .filter-set { width:100%; } .filter-set .field { width:100%; justify-content:space-between; } .filter-set select { flex:1; width:50%; max-width:none; } .summary-grid { gap:7px; } .settings-card { padding:15px; } .settings-card input[type=password] { width:100%; } td, th { padding:10px; } }
#m-backdrop { position: fixed; inset: 0; z-index: 2147483644; background: #03060bc9; backdrop-filter: blur(5px); }
#member-panel { position: fixed; z-index: 2147483646; left: 50%; top: 50%; transform: translate(-50%,-50%); width: min(640px, calc(100vw - 24px)); max-height: 92vh; display: flex; flex-direction: column; overflow: hidden; background: #10151e; border: 1px solid #344050; border-radius: 15px; box-shadow: 0 25px 90px #000d; }
#member-panel .topbar { min-height: 60px; }
.m-body { overflow-y: auto; padding: 16px; scrollbar-width: thin; }
#breach { position: fixed; top: 16px; right: 16px; z-index: 2147483645; width: min(420px, calc(100vw - 32px)); padding: 13px 15px; color: #ffe3e6; background: #3d1720; border: 1px solid #e0566a; border-left: 4px solid #ff4d63; border-radius: 11px; box-shadow: 0 14px 40px #000a; }
.breach-head { display:flex; justify-content:space-between; align-items:baseline; gap:10px; }
.breach-title { font-size: 15px; font-weight: 850; letter-spacing: .08em; color: #ff8a99; }
#breach-time { font-size: 10px; color: #d8a3ab; }
#breach-list { margin: 8px 0 10px; padding: 0 0 0 16px; max-height: 220px; overflow: auto; font-size: 12px; line-height: 1.55; }
.breach-actions { display:flex; gap:8px; justify-content:flex-end; }
#rules-notice { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 2147483647; width: min(460px, calc(100vw - 32px)); padding: 12px 15px; color: #dff7ea; background: #13301f; border: 1px solid #3f9a68; border-left: 4px solid #61cc9b; border-radius: 11px; box-shadow: 0 14px 40px #000a; }
.rules-title { font-size: 13px; font-weight: 850; letter-spacing: .08em; color: #8ee1bb; }
#rules-notice-text { margin: 6px 0 10px; font-size: 12px; line-height: 1.55; }
#rules-notice-list { margin: 0 0 10px; padding: 0 0 0 16px; max-height: 240px; overflow: auto; font-size: 12px; line-height: 1.55; }
#rules-notice-list .changes-head { list-style: none; margin-left: -16px; font-weight: 750; color: #9fe8c0; }
#rules-notice-list .muted { list-style: none; margin-left: -16px; color: #9fb3a8; }
@media (prefers-reduced-motion:reduce) { button { transition:none; } }
</style>
<div id="rules-notice" role="status" hidden><div class="breach-head"><span class="rules-title">CPR RULES</span></div><p id="rules-notice-text"></p><ul id="rules-notice-list" hidden></ul><div class="breach-actions"><button id="rules-undo" class="btn mini">Undo</button><button id="rules-close" class="btn btn-primary mini">OK</button></div></div>
<div id="breach" role="alert" hidden><div class="breach-head"><span class="breach-title">OC BREACH</span><span id="breach-time"></span></div><ul id="breach-list"></ul><div class="breach-actions"><button id="breach-view" class="btn btn-primary mini">View</button><button id="breach-dismiss" class="btn mini">Dismiss</button></div></div>
<div id="m-backdrop" hidden></div>
<section id="member-panel" hidden role="dialog" aria-modal="true" aria-label="OC CPR requirements settings">
 <div class="topbar"><div class="brand"><span class="brand-mark">OC</span><div><div class="brand-name">OC CPR requirements</div><div class="brand-sub">Crimes page helper · ${NAME} v${VERSION}</div></div></div><button id="m-close" class="icon-close" aria-label="Close" title="Close">×</button></div>
 <div class="m-body"><div class="settings-grid">
  <div class="settings-card section-card"><div class="eyebrow">Your faction</div><h2>CPR rules</h2><p>Paste the settings code from your faction's admins and choose Import. Your crimes page then colours slots and greys out Join buttons using those rules. Importing a newer code replaces the old rules.</p>
   <p id="m-import-status" class="import-none"></p>
   <p id="m-summary" class="note" style="margin:0 0 10px"></p>
   <textarea id="m-code" rows="3" spellcheck="false" aria-label="Settings code" placeholder="Paste your faction's settings code"></textarea>
   <div class="row"><button id="m-import" class="btn btn-primary">Import code</button><button id="m-clear" class="btn btn-danger">Remove rules</button><button id="m-undo" class="btn">Undo last update</button></div>
   <p class="note" style="margin:8px 0 0">Rules also update by themselves when you open a faction newsletter containing a newer settings code. The script only reads the newsletter you open yourself: it makes no requests and sends nothing anywhere, like copying the code into the box above.</p>
   <p id="m-code-msg" class="note" style="margin:10px 0 0"></p></div>
  <div class="settings-card section-card"><div class="eyebrow">Crimes page</div><h2>Display</h2>
   <div class="row"><label class="checkbox-label"><input id="m-onpage" type="checkbox"> Show CPR colours, role weights and your-OC highlight</label></div>
   <div class="row"><label class="checkbox-label"><input id="m-weights" type="checkbox"> Show role weights from Torn Probability (nothing about you is sent)</label></div>
   <div class="row"><label class="checkbox-label"><input id="m-block" type="checkbox"> Grey out Join buttons I should not use</label></div>
   <div class="row"><label class="checkbox-label"><input id="m-hide-declined" type="checkbox"> Hide crimes my faction has hidden (while nobody has joined)</label></div>
   <div class="row"><label class="checkbox-label"><input id="m-move-empty" type="checkbox"> Move empty OCs to the bottom</label></div>
   <div class="row"><label class="number-label">Summary card <select id="m-card" aria-label="Summary card position"><option value="top">Top of the list</option><option value="bottom">Bottom of the list</option><option value="off">Off</option></select></label></div>
   <p class="note" style="margin:0 0 6px">Torn PDA has no userscript menu, so there the card stays at the top: it's how you open these settings.</p>
   <div class="row"><label class="number-label">Joining policy <select id="m-joinpolicy" aria-label="Joining policy"><option value="auto">As set by my faction's code</option><option value="on">Always</option><option value="off">Never</option></select></label><label class="number-label"><input id="m-scope" type="number" min="0" max="999" step="1" placeholder="Unknown"> Current OC scope</label> <span class="note">(only used by the low-scope fallback, if your faction's code turns it on; ask your OC admins)</span></div></div>
  <div class="settings-card section-card"><div class="eyebrow">Leaders</div><h2>OC Command Centre</h2><div class="key-warning"><strong>Regular members: you do not need an API key.</strong> CPR colours, Join blocking and newsletter imports all work without one. Leave this box empty.</div>
   <p>The full dashboard (live overview, reports, breach alerts and CPR editing) is only for faction leaders and officers.</p>
   <ul class="key-req"><li><strong>Who:</strong> members whose faction position has <strong>Faction API access</strong> (set by your faction leader under faction positions).</li><li><strong>Key level:</strong> <strong>Minimal</strong>, or a custom key with only faction basic, members, crimes and torn items.</li></ul>
   <p>A key without faction API access is rejected and not saved.</p>
   <div class="row"><input id="m-key" type="password" autocomplete="off" spellcheck="false" placeholder="16-character Torn API key" aria-label="Torn API key"><button id="m-check" class="btn btn-primary">Check access</button><a href="https://www.torn.com/preferences.php#tab=api" target="_blank" rel="noopener noreferrer">Create a key ↗</a></div>
   <p id="m-key-status" class="note" style="margin:10px 0 0"></p>
   <div class="table-scroll" style="max-height:none;margin-top:10px"><table class="tos-table" aria-label="Terms of service"><tbody>
    <tr><td class="value-strong">Data Storage</td><td>Only locally, and only once access is confirmed: key and settings in your userscript manager.</td></tr>
    <tr><td class="value-strong">Data Sharing</td><td>Nobody. The key is sent only to api.torn.com.</td></tr>
    <tr><td class="value-strong">Purpose of Use</td><td>Public community tools: faction OC management.</td></tr>
    <tr><td class="value-strong">Key Storage &amp; Sharing</td><td>Stored / Used only for automation (live refresh and breach checks).</td></tr>
    <tr><td class="value-strong">Key Access Level</td><td>Custom: Minimal with faction API access (faction basic, members, crimes; torn items).</td></tr>
   </tbody></table></div></div>
  <p class="note" style="margin:0">Created by Eaglewing [571041].</p>
 </div></div>
</section>
<button id="launcher" aria-label="Open ${NAME}"><span class="launcher-mark">OC</span> Command</button>
<div id="backdrop" hidden></div>
<section id="panel" hidden aria-label="${NAME}" role="dialog" aria-modal="true">
 <div class="topbar"><div class="brand"><span class="brand-mark">OC</span><div><div class="brand-name">${NAME}</div><div class="brand-sub">Organized crime management · Torn</div></div></div><div class="topbar-actions"><span class="version-label">v${VERSION}</span><button id="close" class="icon-close" aria-label="Close" title="Close">×</button></div></div>
 <div class="shell">
  <aside class="sidebar" aria-label="Navigation">
   <div class="nav-eyebrow">Now</div>
   <button class="nav-item is-active" data-view="live" aria-current="page"><svg viewBox="0 0 24 24"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>Live overview</button>
   <div class="nav-rule"></div>
   <div class="nav-eyebrow second">Reports</div>
   <button class="nav-item" data-view="overview"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="5" rx="1"/><rect x="13" y="10" width="8" height="11" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/></svg>Report overview</button>
   <button class="nav-item" data-view="participation" disabled><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 11a3 3 0 1 0 0-6M18 20c0-2.4-1-4.4-2.5-5.5"/></svg>Participation</button>
   <button class="nav-item" data-view="costs" disabled><svg viewBox="0 0 24 24"><path d="M3 7h18M3 12h18M3 17h18M7 4v16M17 4v16"/></svg>Item costs</button>
   <button class="nav-item" data-view="activity" disabled><svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>Activity log</button>
   <div class="nav-rule"></div>
   <button class="nav-item" data-view="cpr"><svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>CPR settings</button>
   <button class="nav-item" data-view="settings"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a2 2 0 0 0 .4 2.2l-2.6 2.6a2 2 0 0 0-2.2-.4l-1.2.5-.5 2h-3.6l-.5-2L8 19.4a2 2 0 0 0-2.2.4l-2.6-2.6A2 2 0 0 0 3.6 15L3 13.8l-2-.5V9.7l2-.5L3.6 8a2 2 0 0 0-.4-2.2l2.6-2.6A2 2 0 0 0 8 3.6L9.2 3l.5-2h3.6l.5 2 1.2.6a2 2 0 0 0 2.2-.4l2.6 2.6a2 2 0 0 0-.4 2.2l.5 1.2 2 .5v3.6l-2 .5z" transform="translate(1 1) scale(.92)"/></svg>Settings</button>
   <div class="nav-bottom"><div class="connection-label"><span id="connection-dot" class="connection-dot"></span><span id="connection-text">No API key saved</span></div><div class="author">Created by Eaglewing [571041]<div>Read-only API requests · v${VERSION}</div></div></div>
  </aside>
  <main class="main" id="main-scroll"><div class="main-inner">
   <div class="workspace-head"><div><div class="eyebrow">Organized crime management</div><h1 id="view-title">Live overview</h1><p id="view-subtitle" class="subtitle"></p></div><span id="report-state" class="report-state" hidden>No report loaded</span><span id="live-state" class="report-state">Not loaded</span></div>

   <section id="live-view" data-view-panel="live">
    <div class="live-toolbar section-card"><div class="filter-set"><label class="field"><span class="field-label">Crimes</span><select id="stage-filter"><option value="all">All crimes</option><option value="planning">Planning</option><option value="recruiting">Recruiting</option><option value="new">Not started</option></select></label></div>
     <div class="export-set"><span class="note" id="live-note">Refreshes automatically every minute while open.</span><button id="live-refresh" class="btn btn-primary">Refresh</button></div></div>
    <div id="live-error" class="error-box" hidden></div>
    <div id="live-empty" class="empty-state"><div class="empty-symbol">OC</div><h2>Live overview</h2><p id="live-empty-text">Save your Torn API key in Settings to load the live overview.</p><div class="footer-copy">Read-only Torn API access · No automated actions on Torn pages</div></div>
    <div id="live-body" hidden>
     <div class="section-heading"><div><h2 id="live-heading"></h2><p id="live-period">Members and crimes from the Torn API. Last OC uses your faction's 100 most recent completed crimes.</p></div><span class="section-tag">Live data</span></div>
     <div id="live-summary" class="summary-grid"></div>
     <section class="attention-card section-card"><h2>Needs attention</h2><ul id="attention" class="attention-list"></ul></section>
     <section class="table-card section-card"><div class="table-intro"><div><h2>Members not in an OC</h2><p>Recruits and fallen members are left out. Hide members who should not be counted, for example those on leave.</p></div><span class="section-tag" id="free-count">0 members</span></div><div class="table-scroll"><table aria-label="Members not in an OC"><thead><tr>
      <th class="sort-col" data-fsort="name" aria-sort="none" tabindex="0">Member <span class="sort-arrow">↕</span></th><th>Status</th><th class="sort-col" data-fsort="lastAction" aria-sort="none" tabindex="0">Last action <span class="sort-arrow">↕</span></th><th class="sort-col" data-fsort="lastOC" aria-sort="ascending" tabindex="0">Last OC <span class="sort-arrow">↑</span></th><th class="t-right">Actions</th>
     </tr></thead><tbody id="free-body"></tbody></table></div></section>
     <section class="table-card section-card"><div class="table-intro"><div><h2>Crimes</h2><p>Most urgent first. Select a crime to see its slots, planning progress, pass rates against your CPR rules, and items.</p></div><span class="section-tag" id="crime-count">0 crimes</span></div><div class="table-scroll"><table aria-label="Crimes"><thead><tr>
      <th>Crime</th><th>Stage</th><th class="t-right">Members</th><th>Timer</th><th class="t-right" title="Torn Probability estimates. ≥ means projected: open slots counted at their minimum CPR.">Estimated success</th><th>Issues</th>
     </tr></thead><tbody id="crimes-body"></tbody></table></div></section>
    </div>
   </section>

   <div id="report-controls" hidden>
    <section class="report-builder section-card" aria-label="Report period"><div class="toolbar"><div class="toolbar-primary">
     <div class="field"><span class="field-label">Quick range</span><div class="presets"><button class="preset" data-days="7" data-lock>7 days</button><button class="preset" data-days="14" data-lock>14 days</button><button class="preset is-selected" data-days="30" data-lock>30 days</button></div></div>
     <label class="field"><span class="field-label">From (TCT)</span><input id="from" type="date" min="2025-01-15" data-lock></label>
     <label class="field"><span class="field-label">To (TCT)</span><input id="to" type="date" min="2025-01-15" data-lock></label>
    </div><div class="toolbar-primary"><button id="fetch" class="btn btn-primary btn-big" data-lock>Fetch report <span aria-hidden="true">↗</span></button><button id="cancel" class="btn btn-danger btn-big" hidden>Cancel fetch</button></div></div>
    <p class="toolbar-caption">UTC / Torn City Time · Presets include today · Each fetch reads the selected period afresh.</p>
    </section>
    <section class="filter-strip section-card" aria-label="Data filters and exports"><div class="filter-set"><label class="field" id="crime-field"><span class="field-label">Crime type</span><select id="crime"><option value="all">All crimes</option></select></label></div>
    <div class="export-set" id="exports" hidden><span class="exports-label">Export</span><button id="export-participation" class="btn btn-outline" title="Export completed OCs per member">Participation CSV</button><button id="export-summary" class="btn btn-outline" title="Export item cost totals">Items CSV</button><button id="export-details" class="btn btn-outline" title="Export slot-level details">Details CSV</button></div></section>
   </div>
   <div id="status" class="status-bar" role="status" aria-live="polite" hidden><span class="status-icon" aria-hidden="true">i</span><span id="status-text">Choose a date range and fetch a report.</span></div>

   <section id="overview-view" data-view-panel="overview" hidden>
    <div id="empty" class="empty-state"><div class="empty-symbol">OC</div><h2>Your report is ready to build</h2><p>Select a period above and choose <strong>Fetch report</strong> to review every completed OC, member participation, item losses, consumption, ownership and estimated market costs.</p><div class="footer-copy">No automated actions · Read-only Torn API access</div></div>
    <div id="report-body" hidden><div class="section-heading"><div><h2 id="heading"></h2><p id="period"></p></div><span class="section-tag">Calculated from OC outcomes</span></div>
     <div id="warnings" class="warning-box" hidden></div>
     <div id="summary" class="summary-grid"></div>
     <div class="overview-grid"><section class="info-card section-card"><h2>Ownership breakdown</h2><p>Lost and consumed items by recorded ownership. This represents item events, not the number of crimes.</p><div id="ownership"></div></section>
      <section class="info-card section-card"><h2>Explore the report</h2><p>See completed OCs per member, item-level quantities and costs, or the individual OC slots behind every loss and consumption event.</p><div class="inline-actions"><button class="btn btn-primary" data-jump="participation">View participation <span aria-hidden="true">→</span></button><button class="btn" data-jump="costs">View item costs</button><button class="btn" data-jump="activity">View activity log</button></div></section></div>
     <p id="price-note" class="note"></p></div>
   </section>
   <section id="participation-view" data-view-panel="participation" hidden><div class="table-card section-card"><div class="table-intro"><div><h2>Member participation</h2><p>Completed OCs per member in the report period. Current OC comes from the live overview.</p></div><span class="section-tag" id="part-count">0 members</span></div><div class="table-scroll"><table aria-label="Member participation"><thead><tr>
    <th class="sort-col" data-psort="name" aria-sort="none" tabindex="0">Member <span class="sort-arrow">↕</span></th><th class="sort-col t-right" data-psort="total" aria-sort="descending" tabindex="0">OCs <span class="sort-arrow">↓</span></th><th class="sort-col t-right" data-psort="success" aria-sort="none" tabindex="0">Successful <span class="sort-arrow">↕</span></th><th class="sort-col t-right" data-psort="fail" aria-sort="none" tabindex="0">Failed <span class="sort-arrow">↕</span></th><th class="sort-col t-right" data-psort="rate" aria-sort="none" tabindex="0">Success rate <span class="sort-arrow">↕</span></th><th class="sort-col" data-psort="last" aria-sort="none" tabindex="0">Last OC (TCT) <span class="sort-arrow">↕</span></th><th>Current OC</th>
    </tr></thead><tbody id="part-body"></tbody></table></div><div class="table-foot">Members who left during the period are shown as former members.</div></div></section>
   <section id="costs-view" data-view-panel="costs" hidden><section class="info-card section-card costs-ownership"><h2>Ownership breakdown</h2><p>Lost and consumed items by recorded ownership, for the crimes shown below.</p><div id="costs-ownership"></div></section><div class="table-card section-card"><div class="table-intro"><div><h2>Item cost breakdown</h2><p>Sort any column to compare depleted items, prices and replacement cost.</p></div><span class="section-tag" id="item-count">0 item types</span></div><div class="table-scroll"><table aria-label="Item cost breakdown"><thead><tr>
    <th class="sort-col" data-sort="name" aria-sort="none" tabindex="0">Item <span class="sort-arrow">↕</span></th><th class="sort-col t-right" data-sort="lost" aria-sort="none" tabindex="0">Lost <span class="sort-arrow">↕</span></th><th class="sort-col t-right" data-sort="consumed" aria-sort="none" tabindex="0">Consumed <span class="sort-arrow">↕</span></th><th class="sort-col t-right" data-sort="price" aria-sort="none" tabindex="0">Unit value <span class="sort-arrow">↕</span></th><th class="sort-col t-right" data-sort="cost" aria-sort="descending" tabindex="0">Total cost <span class="sort-arrow">↓</span></th><th class="sort-col t-right" data-sort="factionCost" aria-sort="none" tabindex="0">Faction cost <span class="sort-arrow">↕</span></th><th class="sort-col t-right" data-sort="crimes" aria-sort="none" tabindex="0">OCs <span class="sort-arrow">↕</span></th>
    </tr></thead><tbody id="items"></tbody></table></div><div class="table-foot">Unit prices are current estimates, not historical purchase prices.</div></div></section>
   <section id="activity-view" data-view-panel="activity" hidden><div class="table-card section-card"><div class="table-intro"><div><h2>OC item activity</h2><p>Every recorded loss or non-reusable item consumption, grouped by individual slot.</p></div><span class="section-tag">100 records / page</span></div><div class="table-scroll"><table aria-label="OC item activity"><thead><tr><th>Executed (TCT)</th><th>Organized crime</th><th>Slot / member</th><th>Item</th><th>Event</th><th>Owner</th><th>Notes</th></tr></thead><tbody id="details-body"></tbody></table></div><div class="table-foot"><span id="detail-count">0 records</span><div class="pager"><button id="prev" class="btn btn-outline">← Previous</button><button id="next" class="btn btn-outline">Next →</button></div></div></div></section>

   <section id="cpr-view" data-view-panel="cpr" hidden><div class="settings-grid">
    <div class="settings-card section-card"><div class="eyebrow">Requirements</div><h2>CPR requirements</h2><p>Choose an OC, set the CPR each role needs, then <strong>Save OC</strong>. A blank role uses "All roles"; OCs with no rules are not checked. <strong>No max &lt;48h</strong> removes a role's maximum in the last 2 days before initiation. <strong>Hide crime</strong> hides an OC nobody should join.</p>
     <div class="info-callout"><strong>What members see:</strong> once members import your settings code, the script on their crimes page colours each role against these requirements and <strong>greys out the Join button</strong> on any role they don't qualify for, showing the reason (for example "Needs 70"). Hidden crimes are removed from their list. Members can turn blocking off in their own settings; if anyone joins outside the rules, leaders get an OC BREACH alert.</div>
     <div class="row"><label class="field"><span class="field-label">Organized crime</span><select id="cpr-oc" aria-label="Organized crime"></select></label><span id="cpr-level" class="section-tag"></span><span id="cpr-source" class="note"></span></div>
     <div class="row"><input id="cpr-newoc" type="text" maxlength="60" placeholder="New OC name, e.g. a newly released crime" aria-label="New OC name"><button id="cpr-addoc" class="btn">Add OC</button></div>
     <div class="row"><label class="checkbox-label"><input id="cpr-hidden" type="checkbox"> <strong>Hide crime</strong> (nobody should join; no CPR needed)</label></div>
     <div id="cpr-detail">
     <div class="row"><label class="number-label"><input id="cpr-all" type="number" min="0" max="100" step="1" placeholder="—"> All roles minimum</label><label class="checkbox-label policy-only"><input id="cpr-deprioritise" type="checkbox"> Start this OC last (joining policy)</label></div>
     <div id="cpr-roles-wrap" class="table-scroll" style="max-height:none;margin-top:12px"><table id="cpr-table" class="cpr-table" aria-label="Role requirements"><thead><tr><th>Role</th><th>Minimum</th><th>Maximum</th><th class="t-center">No max &lt;48h</th><th class="t-center policy-col">Exception</th></tr></thead><tbody id="cpr-roles"></tbody></table></div>
     <div class="row"><input id="cpr-newrole" type="text" maxlength="40" placeholder="Role name, e.g. Muscle #3" aria-label="New role name"><button id="cpr-addrole" class="btn">Add role</button></div>
     </div>
     <div class="row"><span style="flex:1"></span><button id="cpr-reset" class="btn btn-danger">Remove OC rules</button><button id="cpr-save" class="btn btn-primary">Save OC</button></div>
     <p id="cpr-msg" class="note" style="margin:10px 0 0"></p></div>
    <div class="settings-card section-card"><div class="eyebrow">Optional</div><h2>Joining policy</h2>
     <p><strong>Most factions do not use this. Leave it off</strong> unless your faction has a written rule about <em>when</em> members may join an OC, not just which CPR they need.</p>
     <div class="row"><label class="checkbox-label"><input id="cpr-policy" type="checkbox"> My faction uses a joining policy</label></div>
     <div id="cpr-policy-detail" hidden>
      <p class="note" style="margin:8px 0 0">With the policy on, members get OK TO JOIN / WAIT / START NEW banners, LAST JOIN and JOINED TOO EARLY warnings, and Join buttons are greyed out when joining would break the policy. Each OC also gets a <strong>Start this OC last</strong> option, and roles get an <strong>Exception</strong> column (that role may be joined whatever the policy says, if the CPR fits).</p>
      <div class="row"><label class="number-label"><input id="cpr-wait" type="number" min="0" max="9" step="1"> Wait limit</label></div>
      <p class="note" style="margin:6px 0 0">How many members in an OC can be sitting at 0% planning before others must <strong>WAIT</strong>. Example with 1: if one member hasn't started planning yet, the OC is still OK TO JOIN; if two haven't, new joiners are told to wait until someone starts.</p>
      <div class="row"><label class="number-label"><input id="cpr-scope" type="number" min="1" max="999" step="1" placeholder="Off"> Low-scope fallback: scope below (blank = off)</label></div>
      <p class="note" style="margin:6px 0 0">If every OC says WAIT, there are no empty OCs to start, and scope is below this number, the script unlocks <strong>one</strong> OC (the closest to finishing planning) so members can still join. Members must enter the current scope in their settings for it to work. Leave blank if your policy has no low-scope rule.</p>
     </div>
     <p id="cpr-policy-msg" class="note" style="margin:10px 0 0"></p></div>
    <div class="settings-card section-card"><div class="eyebrow">Share</div><h2>Settings code</h2><p>After changing rules, generate a new code and send it to your members in a <strong>faction newsletter</strong>: their scripts import it automatically when they open the newsletter (it only needs to be somewhere in the text). You can also post it elsewhere for members to import by hand. Importing a code gives a member exactly these rules and replaces any rules they had. You can also import a code from another admin here.</p>
     <textarea id="cpr-code" rows="3" spellcheck="false" aria-label="Settings code" placeholder="Generate a code, or paste one to import"></textarea>
     <div class="row"><button id="cpr-generate" class="btn btn-primary">Generate settings code</button><button id="cpr-import-code" class="btn">Import code</button><span style="flex:1"></span><button id="cpr-clear-all" class="btn btn-danger">Clear all rules</button></div>
     <p id="cpr-code-msg" class="note" style="margin:10px 0 0"></p>
     <div id="cpr-mail-wrap" hidden>
      <div class="settings-subheading">Ready-to-send faction newsletter</div>
      <p class="note" style="margin:6px 0 0">Copy these into a new faction newsletter and send it. Members' scripts update when they open it. Keep the code on its own line and don't edit it.</p>
      <div class="row"><label class="field" style="flex:1"><span class="field-label">Subject</span><input id="cpr-mail-subject" type="text" readonly aria-label="Newsletter subject"></label><button id="cpr-copy-subject" class="btn">Copy subject</button></div>
      <label class="field" style="margin-top:10px"><span class="field-label">Message</span><textarea id="cpr-mail-body" rows="11" readonly spellcheck="false" aria-label="Newsletter message"></textarea></label>
      <div class="row"><button id="cpr-copy-body" class="btn btn-primary">Copy message</button></div>
     </div></div>
   </div></section>
   <section id="settings" data-view-panel="settings" hidden><div class="settings-grid">
    <div class="settings-card section-card"><div class="eyebrow">Connection</div><h2>Torn API key</h2><ul class="key-req"><li><strong>Who:</strong> faction leaders and officers whose position has <strong>Faction API access</strong>. Regular members do not need a key.</li><li><strong>Key level:</strong> <strong>Minimal</strong>, or a custom key with only <strong>faction: basic, members, crimes</strong> and <strong>torn: items</strong>.</li></ul><p> Your key is saved locally in your userscript manager, is never shown on the page after saving, and is sent only to api.torn.com over HTTPS in the Authorization header.</p><div class="row"><input id="key" type="password" autocomplete="off" spellcheck="false" placeholder="Enter your 16-character Torn API key" aria-label="Torn API key" data-lock><button id="save-key" class="btn btn-primary" data-lock>Save key</button><button id="forget-key" class="btn btn-danger" data-lock>Remove key</button><a href="https://www.torn.com/preferences.php#tab=api" target="_blank" rel="noopener noreferrer">Create a key ↗</a></div>
     <div class="settings-subheading">Terms of service</div>
     <div class="table-scroll" style="max-height:none;margin-top:10px"><table class="tos-table" aria-label="Terms of service"><tbody>
      <tr><td class="value-strong">Data Storage</td><td>Only locally: key, settings, hidden members, price caches and breach alert state in your userscript manager; the join audit history in this browser's storage. OC data is kept in memory only while the page is open.</td></tr>
      <tr><td class="value-strong">Data Sharing</td><td>Nobody. Role weights are downloaded from tornprobability.com without sending anything about you. If you turn on success chances (off by default), the name and slot pass rates of each OC (open slots as their minimum CPR) are sent to tornprobability.com (<a href="https://www.torn.com/forums.php#/p=threads&f=67&t=16449999" target="_blank" rel="noopener noreferrer">Allenone's Torn Probability</a>). No names, IDs or API key are sent.</td></tr>
      <tr><td class="value-strong">Purpose of Use</td><td>Non malicious statistical analysis and public community tools: faction OC management and item cost audit.</td></tr>
      <tr><td class="value-strong">Key Storage &amp; Sharing</td><td>Stored / Used only for automation: stored locally, used for the automatic live refresh and breach checks, sent only to api.torn.com.</td></tr>
      <tr><td class="value-strong">Key Access Level</td><td>Custom: Minimal with faction API access. Selections: faction basic, members, crimes; torn items.</td></tr>
     </tbody></table></div></div>
    <div class="settings-card section-card"><div class="eyebrow">Live overview</div><h2>Warnings and refresh</h2><p>Thresholds for the live overview. The live view refreshes from the Torn API at most once a minute, only while it is open or the crimes-tab summary is visible.</p>
     <div class="row"><label class="number-label"><input id="set-inactive" type="number" min="1" max="2000" step="1"> Inactive after (hours since last action)</label></div>
     <div class="row"><label class="number-label"><input id="set-ocwarn" type="number" min="1" max="2000" step="1"> Last OC amber after (hours)</label><label class="number-label"><input id="set-ocalert" type="number" min="1" max="2000" step="1"> red after (hours)</label></div>
     <div class="row"><label class="checkbox-label"><input id="set-autorefresh" type="checkbox"> Refresh the live overview automatically</label></div>
     <div class="row"><label class="number-label">Summary card on the crimes page <select id="set-card" aria-label="Summary card position"><option value="top">Top of the list</option><option value="bottom">Bottom of the list</option><option value="off">Off</option></select></label></div>
     <div class="row"><label class="checkbox-label"><input id="set-chance" type="checkbox"> Show estimated success in the dashboard's Crimes table (sends OC names and pass rates to tornprobability.com; open roles count as your minimum CPR)</label></div></div>
    <div class="settings-card section-card"><div class="eyebrow">Crimes page</div><h2>On the crimes page</h2><p>Helpers drawn on Torn's own crimes page, using your CPR settings. They only colour, label, reorder and grey out buttons on the page you are viewing; nothing is clicked or sent for you.</p>
     <div class="row"><label class="checkbox-label"><input id="set-onpage" type="checkbox"> Show CPR colours, role weights and your-OC highlight on OC cards</label></div>
     <div class="row"><label class="checkbox-label"><input id="set-weights" type="checkbox"> Show role weights from Torn Probability (downloads weights; nothing about you is sent)</label></div>
     <div class="row"><label class="checkbox-label"><input id="set-block" type="checkbox"> Grey out Join buttons you should not use (wrong CPR, hidden crime, already in an OC, and joining-policy rules)</label></div>
     <div class="row"><label class="checkbox-label"><input id="set-hide-declined" type="checkbox"> Hide crimes set to "Hide crime" while nobody has joined</label></div>
     <div class="row"><label class="checkbox-label"><input id="set-move-empty" type="checkbox"> Move empty OCs to the bottom of the list</label></div>
     <div class="settings-subheading">Joining policy</div>
     <p class="note" style="margin:6px 0 0">A joining policy: join an OC only while few enough members have not started planning, prioritise stalled crimes, start new ones only when nothing qualifies, and an optional low-scope fallback. Your faction's settings code sets the numbers. Adds OK TO JOIN / WAIT / START NEW banners, policy ordering, LAST JOIN and JOINED TOO EARLY warnings. Most factions do not follow these rules, so by default they are only used when your faction's settings code turns them on (leaders: CPR settings → Joining policy).</p>
     <div class="row"><label class="number-label">Use joining policy <select id="set-joinpolicy" aria-label="Use joining policy"><option value="auto">As set by my faction's code</option><option value="on">Always</option><option value="off">Never</option></select></label><label class="number-label"><input id="set-scope" type="number" min="0" max="999" step="1" placeholder="Unknown"> Current OC scope</label> <span class="note">(only used by the low-scope fallback, if your faction's code turns it on; ask your OC admins)</span></div></div>
    <div class="settings-card section-card"><div class="eyebrow">Alerts</div><h2>OC breach alerts</h2><p>Checks your faction's open OCs in the background on any Torn page and shows an <strong>OC BREACH</strong> alert when a member breaks your CPR rules: below their role's minimum, above a maximum, or in a hidden OC (needs CPR rules). It can also warn about an OC due to start within the hour. Each alert shows once. Each check is one Torn API call, shared across all your open Torn tabs.</p>
     <div class="row"><label class="checkbox-label"><input id="set-breach" type="checkbox"> Show OC breach alerts</label></div>
     <div class="row"><label class="checkbox-label"><input id="set-breach-items" type="checkbox"> Alert when an OC starting within the hour has a missing item</label></div>
     <div class="row"><label class="checkbox-label"><input id="set-breach-away" type="checkbox"> Alert when an OC starting within the hour has a member in hospital, jail or travelling</label></div>
     <div class="row"><label class="number-label"><input id="set-breach-min" type="number" min="1" max="60" step="1"> Check every (minutes)</label></div>
     <div class="row"><label class="checkbox-label"><input id="set-breach-desktop" type="checkbox"> Also show a desktop notification</label></div>
</div>
    <div class="settings-card section-card"><div class="eyebrow">Live overview</div><h2>Hidden members</h2><div id="ignored-list"></div></div>
    <div class="settings-card section-card"><div class="eyebrow">Display</div><h2>Launcher button</h2><p>The floating button is off by default. Open ${NAME} from the summary card above the faction crimes list, the View button on an OC BREACH alert, or your userscript manager's menu. Turn the button on here if you want it, for example to import TornTools prices from the Items page.</p><div class="row"><select id="launcher-pos" aria-label="Launcher button"><option value="hidden">Off</option><option value="bottom-right">Bottom right</option><option value="bottom-left">Bottom left</option><option value="middle-right">Middle right</option></select></div><div class="row"><label class="checkbox-label"><input id="set-launcher-all" type="checkbox"> When on, show it on every Torn page (otherwise faction, OC and item pages only)</label></div></div>
    <div class="settings-card section-card"><div class="eyebrow">Valuation</div><h2>Item prices &amp; TornTools</h2><p>Torn API market values are used by default. You can import item unit prices currently visible on the Items page through TornTools; those values are preferred when enabled. This script cannot access TornTools' private extension storage.</p><label class="checkbox-label"><input id="prefer-tt" type="checkbox" checked data-lock>Prefer imported TornTools unit prices</label><div class="settings-subheading">Price management</div><div class="row"><button id="import-tt" class="btn" data-lock>Import visible prices</button><button id="reload-tt" class="btn" data-lock>Reload imported prices</button><button id="refresh-prices" class="btn" data-lock>Refresh API prices</button><button id="clear-prices" class="btn btn-danger" data-lock>Clear price cache</button></div><p class="note" style="margin-top:13px">To import TornTools prices, open the Items page, select an inventory category with visible unit values, then use Import visible prices here. Each category must be imported separately. Imported and API price data expire after 6 hours.</p></div>
    <div class="settings-card section-card"><div class="eyebrow">Methodology</div><h2>How costs are calculated</h2><p>Only Torn's explicit <strong>lost</strong> outcomes and <strong>used</strong> outcomes for non-reusable item requirements count as depleted items. Unused items and reusable items do not contribute to the estimates. The total OC count still includes completed crimes without item losses.</p><p style="margin:0">Historical OC data is fetched through sequential, read-only API requests. Owner and crime filters change the item records and costs, but not the completed OC count or participation.</p></div>
    <div class="settings-card section-card"><div class="eyebrow">About</div><h2>Credits</h2><p style="margin:0">${NAME} is built by <a href="https://www.torn.com/profiles.php?XID=571041" target="_blank" rel="noopener noreferrer">Eaglewing [571041]</a>.</p><p style="margin:10px 0 0">With thanks to Flamer, Allenone, Verboten, Darrelia, Kohnago, pawl, Qfiffle, JohnNash, callmericky and whatdoesthespacebardo, whose earlier work this script builds on. Role weights and estimated success use Allenone's Torn Probability.</p></div>
   </div></section>
  </div></main>
 </div>
</section>`;
        panel = $('#panel'); launcher = $('#launcher');
        launcher.addEventListener('click', open);
        $('#close').addEventListener('click', close);
        $('#backdrop').addEventListener('click', close);
        root.addEventListener('keydown', e => {
            if (panel.hidden) return;
            if (e.key === 'Escape') return close();
            if (e.key !== 'Tab') return;
            // Keep keyboard focus inside the open dialog.
            const focusable = [...panel.querySelectorAll('button, input, select, a[href], [tabindex]:not([tabindex="-1"])')]
                .filter(el => !el.disabled && el.getClientRects().length);
            if (!focusable.length) return;
            const first = focusable[0], last = focusable[focusable.length - 1], active = root.activeElement;
            if (e.shiftKey && (active === first || !panel.contains(active))) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && (active === last || !panel.contains(active))) { e.preventDefault(); first.focus(); }
        });
        root.querySelectorAll('[data-view]').forEach(el => el.addEventListener('click', () => showView(el.dataset.view)));
        root.querySelectorAll('[data-jump]').forEach(el => el.addEventListener('click', () => showView(el.dataset.jump)));
        $('#fetch').addEventListener('click', runReport);
        $('#cancel').addEventListener('click', () => controller?.abort());
        root.querySelectorAll('[data-days]').forEach(el => el.addEventListener('click', () => preset(Number(el.dataset.days))));
        for (const selector of ['#crime']) $(selector).addEventListener('change', () => { detailPage = 0; render(); });
        for (const selector of ['#from', '#to']) $(selector).addEventListener('change', () => setSelectedPreset(null));
        const sortable = (attr, apply) => root.querySelectorAll('[' + attr + ']').forEach(th => {
            const select = () => apply(th);
            th.addEventListener('click', select);
            th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } });
        });
        sortable('data-sort', th => {
            if (sortBy === th.dataset.sort) sortDirection *= -1;
            else { sortBy = th.dataset.sort; sortDirection = sortBy === 'name' ? 1 : -1; }
            render();
        });
        sortable('data-psort', th => {
            if (partSort.by === th.dataset.psort) partSort.dir *= -1;
            else partSort = { by: th.dataset.psort, dir: th.dataset.psort === 'name' ? 1 : -1 };
            renderParticipation();
        });
        sortable('data-fsort', th => {
            if (freeSort.by === th.dataset.fsort) freeSort.dir *= -1;
            else freeSort = { by: th.dataset.fsort, dir: 1 };
            renderLive();
        });

        // Live view interactions (all local; refresh is an API call).
        $('#live-refresh').addEventListener('click', () => refreshLive(true));
        $('#stage-filter').addEventListener('change', () => { stageFilter = $('#stage-filter').value; renderLive(); });
        const toggleCrime = row => {
            const id = Number(row.dataset.crime);
            if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
            renderLive();
        };
        $('#crimes-body').addEventListener('click', e => {
            if (e.target.closest('a')) return;
            const row = e.target.closest('tr.crime-row');
            if (row) toggleCrime(row);
        });
        $('#crimes-body').addEventListener('keydown', e => {
            const row = e.target.closest('tr.crime-row');
            if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleCrime(row); }
        });
        $('#free-body').addEventListener('click', async e => {
            const button = e.target.closest('[data-hide]');
            if (!button) return;
            const id = Number(button.dataset.hide);
            if (validId(id) && !settings.ignored.includes(id)) settings.ignored.push(id);
            await saveSettings(); renderLive(); renderCard();
        });
        $('#ignored-list').addEventListener('click', async e => {
            const button = e.target.closest('[data-unhide]');
            if (!button) return;
            settings.ignored = settings.ignored.filter(id => id !== Number(button.dataset.unhide));
            await saveSettings(); renderLive(); renderCard();
        });

        // Settings
        $('#save-key').addEventListener('click', async () => {
            const next = $('#key').value.trim();
            if (!/^[a-zA-Z0-9]{16}$/.test(next)) return message('Enter a valid 16-character Torn API key.', true);
            message('Checking faction API access…');
            const result = await checkAccess(next);
            $('#key').value = '';
            if (!result.ok) return message(result.error + ' Your current key is unchanged.', true);
            try {
                await grantAccess(next);
                render(); updateConnection(); message('Key saved. Loading the live overview…'); showView('live');
            } catch (_) { message('Could not save the API key.', true); }
        });
        $('#forget-key').addEventListener('click', async () => {
            if (!confirm('Remove your key? OC Command Centre will lock until a key with faction API access is entered again.')) return;
            await revokeAccess('Key removed. OC Command Centre is locked.');
        });
        const numberSetting = (selector, name, min, max) => $(selector).addEventListener('change', async () => {
            const value = Number($(selector).value);
            if (!Number.isFinite(value) || value < min || value > max) { $(selector).value = settings[name]; return; }
            settings[name] = value; await saveSettings(); renderLive();
        });
        numberSetting('#set-inactive', 'inactiveHours', 1, 2000);
        numberSetting('#set-ocwarn', 'lastOcWarnHours', 1, 2000);
        numberSetting('#set-ocalert', 'lastOcAlertHours', 1, 2000);
        $('#cpr-oc').addEventListener('change', () => { cprEditOC = $('#cpr-oc').value; cprMessage(''); renderCprEditor(); });
        $('#cpr-save').addEventListener('click', saveCprOC);
        const policyMessage = (text, bad = false) => { $('#cpr-policy-msg').textContent = text; $('#cpr-policy-msg').className = 'note' + (bad ? ' value-lost' : ''); };
        $('#cpr-policy').addEventListener('change', async () => {
            settings.rules.joinPolicy = $('#cpr-policy').checked;
            settings.rules = cleanRules(settings.rules);
            await saveSettings(); renderCprEditor(); afterRulesChange();
            policyMessage(settings.rules.joinPolicy ? 'Joining policy on. Generate a new settings code to share it with members.' : 'Joining policy off. Generate a new settings code so members stop using it too.');
        });
        $('#cpr-wait').addEventListener('change', async () => {
            const n = Number($('#cpr-wait').value);
            if (!Number.isInteger(n) || n < 0 || n > 9) { renderCprEditor(); return policyMessage('The wait limit must be a whole number from 0 to 9.', true); }
            settings.rules.waitLimit = n; await saveSettings(); afterRulesChange();
            policyMessage('Wait limit saved. Generate a new settings code to share it.');
        });
        $('#cpr-scope').addEventListener('change', async () => {
            const raw = $('#cpr-scope').value.trim(), n = Number(raw);
            if (raw !== '' && (!Number.isInteger(n) || n < 1 || n > 999)) { renderCprEditor(); return policyMessage('The scope fallback must be a whole number from 1 to 999, or blank for off.', true); }
            settings.rules.scopeBelow = raw === '' ? null : n; await saveSettings(); afterRulesChange();
            policyMessage((raw === '' ? 'Low-scope fallback off.' : 'Low-scope fallback saved.') + ' Generate a new settings code to share it.');
        });
        $('#cpr-hidden').addEventListener('change', () => { $('#cpr-detail').hidden = $('#cpr-hidden').checked; });
        $('#cpr-reset').addEventListener('click', resetCprOC);
        $('#cpr-addoc').addEventListener('click', () => {
            const name = $('#cpr-newoc').value.trim().slice(0, 60);
            if (!name) return;
            const existing = cprOCNames().find(n => normalize(n) === normalize(name));
            if (!existing) cprAddedOCs.push(name);
            cprEditOC = existing || name;
            $('#cpr-newoc').value = ''; renderCprEditor();
            cprMessage(existing ? existing + ' is already listed.' : 'Added ' + name + '. Set its CPR, then choose Save OC to keep it.');
        });
        $('#cpr-addrole').addEventListener('click', () => {
            const role = $('#cpr-newrole').value.trim().toUpperCase().slice(0, 40);
            if (!role || !cprEditOC) return;
            const list = cprExtraRoles[normalize(cprEditOC)] ||= [];
            if (!list.includes(role)) list.push(role);
            $('#cpr-newrole').value = ''; renderCprEditor();
            cprMessage('Added ' + role + '. Set its CPR, then choose Save OC.');
        });
        $('#cpr-generate').addEventListener('click', async () => {
            if (!rulesActive(settings.rules)) return codeMessage('Set rules for at least one OC first.', true);
            settings.rules.createdAt = Math.floor(Date.now() / 1000);
            await saveSettings(); renderCprEditor();
            const code = await encodeRules(settings.rules);
            $('#cpr-code').value = code; $('#cpr-code').select();
            let copied = false;
            try { await navigator.clipboard.writeText(code); copied = true; } catch (_) {}
            codeMessage((copied ? 'Copied to your clipboard. ' : 'Select the code above and copy it. ') + code.length + ' characters. A ready-to-send newsletter is below.');
            fillNewsletter(code);
        });
        $('#cpr-copy-subject').addEventListener('click', () => copyText($('#cpr-mail-subject').value, 'Subject'));
        $('#cpr-copy-body').addEventListener('click', () => copyText($('#cpr-mail-body').value, 'Message'));
        $('#cpr-import-code').addEventListener('click', async () => {
            const text = $('#cpr-code').value.trim();
            if (!text) return codeMessage('Paste a settings code into the box first.', true);
            if (rulesActive(settings.rules) && !confirm('Importing replaces all of your current CPR rules. Continue?')) return;
            try {
                const rules = await importRulesCode(text);
                if (!rules) return;
                renderCprEditor(); codeMessage('Imported. ' + rulesSummary(rules));
            } catch (error) { codeMessage(error.message, true); }
        });
        $('#cpr-clear-all').addEventListener('click', async () => {
            if (!confirm('Clear all CPR rules in this script? Members keep whatever code they imported.')) return;
            settings.rules = emptyRules();
            await saveSettings(); renderCprEditor(); afterRulesChange();
            codeMessage('All CPR rules cleared.');
        });
        $('#rules-close').addEventListener('click', () => { $('#rules-notice').hidden = true; });
        $('#rules-undo').addEventListener('click', undoRulesUpdate);
        $('#m-undo').addEventListener('click', undoRulesUpdate);
        $('#m-close').addEventListener('click', closeMember);
        $('#m-backdrop').addEventListener('click', closeMember);
        $('#member-panel').addEventListener('keydown', e => { if (e.key === 'Escape') closeMember(); });
        const mCodeMessage = (text, bad = false) => { $('#m-code-msg').textContent = text; $('#m-code-msg').className = 'note' + (bad ? ' value-lost' : ''); };
        $('#m-import').addEventListener('click', async () => {
            const text = $('#m-code').value.trim();
            if (!text) return mCodeMessage('Paste the settings code from your faction first.', true);
            try {
                const rules = await importRulesCode(text);
                if (!rules) return;
                $('#m-code').value = ''; syncMemberPanel();
                mCodeMessage('Imported. Your crimes page now uses these rules.');
            } catch (error) { mCodeMessage(error.message, true); }
        });
        $('#m-clear').addEventListener('click', async () => {
            if (!confirm('Remove your CPR rules? Slots will no longer be coloured until you import a code again.')) return;
            settings.rules = emptyRules(); settings.rulesFrom = null;
            await saveSettings(); afterRulesChange(); syncMemberPanel();
            mCodeMessage('CPR rules removed.');
        });
        for (const [id, name] of [['#m-onpage', 'onPage'], ['#m-weights', 'tpWeights'], ['#m-block', 'blockJoins'], ['#m-hide-declined', 'hideDeclined'], ['#m-move-empty', 'moveEmpty']]) {
            $(id).addEventListener('change', async () => { settings[name] = $(id).checked; await saveSettings(); renderCard(); rescanAll(); });
        }
        $('#m-card').addEventListener('change', async () => {
            settings.cardPos = ['top', 'bottom', 'off'].includes($('#m-card').value) ? $('#m-card').value : 'top';
            await saveSettings(); if ($('#set-card')) $('#set-card').value = settings.cardPos; scheduleCard();
        });
        $('#m-joinpolicy').addEventListener('change', async () => {
            settings.joinPolicy = ['auto', 'on', 'off'].includes($('#m-joinpolicy').value) ? $('#m-joinpolicy').value : 'auto';
            await saveSettings(); rescanAll();
        });
        $('#m-scope').addEventListener('change', async () => {
            const raw = $('#m-scope').value.trim();
            if (raw === '') settings.scope = null;
            else if (/^\d+$/.test(raw) && Number(raw) <= 999) settings.scope = Number(raw);
            else { $('#m-scope').value = getScope() ?? ''; return; }
            await saveSettings(); rescanAll();
        });
        $('#m-check').addEventListener('click', async () => {
            const candidate = $('#m-key').value.trim();
            if (!/^[a-zA-Z0-9]{16}$/.test(candidate)) return memberStatus('Enter a valid 16-character Torn API key.', true);
            $('#m-check').disabled = true; memberStatus('Checking faction API access…');
            const result = await checkAccess(candidate);
            $('#m-check').disabled = false; $('#m-key').value = '';
            if (!result.ok) return memberStatus(result.error, true);
            await grantAccess(candidate);
            memberStatus('Access confirmed for ' + result.faction + '.');
            closeMember(); renderCard(); updateConnection(); launcher.hidden = !launcherShown();
            currentView = 'live'; open();
        });
        const pageToggle = (selector, name) => $(selector).addEventListener('change', async () => {
            settings[name] = $(selector).checked; await saveSettings(); renderCard(); rescanAll();
        });
        pageToggle('#set-onpage', 'onPage'); pageToggle('#set-weights', 'tpWeights'); pageToggle('#set-block', 'blockJoins');
        pageToggle('#set-hide-declined', 'hideDeclined'); pageToggle('#set-move-empty', 'moveEmpty');
        $('#set-joinpolicy').addEventListener('change', async () => {
            settings.joinPolicy = ['auto', 'on', 'off'].includes($('#set-joinpolicy').value) ? $('#set-joinpolicy').value : 'auto';
            await saveSettings(); rescanAll();
        });
        $('#set-scope').addEventListener('change', async () => {
            const raw = $('#set-scope').value.trim();
            if (raw === '') settings.scope = null;
            else if (/^\d+$/.test(raw) && Number(raw) <= 999) settings.scope = Number(raw);
            else { $('#set-scope').value = getScope() ?? ''; return; }
            await saveSettings(); rescanAll();
        });
        $('#breach-view').addEventListener('click', () => { currentView = 'live'; open(); });
        $('#breach-dismiss').addEventListener('click', async () => {
            hideBreach();
            try { await save('breachDismissed', Date.now()); } catch (_) {}
        });
        $('#set-breach').addEventListener('change', async () => { settings.breachAlerts = $('#set-breach').checked; await saveSettings(); syncBreach(); });
        numberSetting('#set-breach-min', 'breachMinutes', 1, 60);
        $('#set-breach-desktop').addEventListener('change', async () => { settings.breachDesktop = $('#set-breach-desktop').checked; await saveSettings(); });
        $('#set-breach-items').addEventListener('change', async () => { settings.breachItems = $('#set-breach-items').checked; await saveSettings(); syncBreach(); });
        $('#set-breach-away').addEventListener('change', async () => { settings.breachAway = $('#set-breach-away').checked; await saveSettings(); syncBreach(); });
        $('#set-launcher-all').addEventListener('change', async () => {
            settings.launcherEverywhere = $('#set-launcher-all').checked; await saveSettings();
            if (panel.hidden) launcher.hidden = !launcherShown();
        });
        $('#set-autorefresh').addEventListener('change', async () => { settings.autoRefresh = $('#set-autorefresh').checked; await saveSettings(); });
        $('#set-card').addEventListener('change', async () => { settings.cardPos = ['top', 'bottom', 'off'].includes($('#set-card').value) ? $('#set-card').value : 'top'; await saveSettings(); scheduleCard(); });
        $('#set-chance').addEventListener('change', async () => {
            settings.successChance = $('#set-chance').checked; await saveSettings();
            if (settings.successChance) updateChances(); else chances.clear();
            renderLive();
        });
        $('#launcher-pos').addEventListener('change', async () => {
            launcherPos = LAUNCHER_POSITIONS.includes($('#launcher-pos').value) ? $('#launcher-pos').value : 'hidden';
            applyLauncherPos();
            if (panel.hidden) launcher.hidden = !launcherShown();
            try { await save('launcherPos', launcherPos); message('Launcher position saved.'); }
            catch (_) { message('Could not save launcher position.', true); }
        });
        $('#prefer-tt').addEventListener('change', async () => {
            preferTT = $('#prefer-tt').checked;
            try { await save('preferTT', preferTT); render(); renderLive(); } catch (_) { message('Could not save price preference.', true); }
        });
        $('#import-tt').addEventListener('click', () => importTTPrices().catch(() => message('Could not save TornTools prices.', true)));
        $('#reload-tt').addEventListener('click', async () => { ttPrices = await read('ttPrices', {}); render(); renderLive(); message('Imported price cache reloaded.'); });
        $('#clear-prices').addEventListener('click', async () => {
            try { await save('catalog', { at: 0, items: {} }); await save('ttPrices', {}); catalog = { at: 0, items: {} }; ttPrices = {}; render(); renderLive(); message('Price cache cleared. Refresh API prices to refill it.'); }
            catch (_) { message('Could not clear all price data.', true); }
        });
        $('#refresh-prices').addEventListener('click', async () => {
            if (busy) return;
            if (!key) return message('Save a Torn API key first.', true);
            controller = new AbortController(); setBusy(true); message('Refreshing Torn API prices…');
            try { await loadPrices(true, controller.signal); if (report) report.priceWarning = ''; message('API market values refreshed.'); }
            catch (error) { message(safeError(error), true); }
            finally { controller = null; setBusy(false); render(); renderLive(); }
        });
        $('#prev').addEventListener('click', () => { detailPage--; render(); });
        $('#next').addEventListener('click', () => { detailPage++; render(); });
        $('#export-summary').addEventListener('click', exportSummary);
        $('#export-details').addEventListener('click', exportDetails);
        $('#export-participation').addEventListener('click', exportParticipation);

        preset(30); $('#prefer-tt').checked = preferTT;
        $('#set-inactive').value = settings.inactiveHours;
        $('#set-ocwarn').value = settings.lastOcWarnHours; $('#set-ocalert').value = settings.lastOcAlertHours;
        $('#set-onpage').checked = settings.onPage; $('#set-weights').checked = settings.tpWeights; $('#set-block').checked = settings.blockJoins;
        $('#set-hide-declined').checked = settings.hideDeclined; $('#set-move-empty').checked = settings.moveEmpty;
        $('#set-joinpolicy').value = settings.joinPolicy; $('#set-scope').value = getScope() ?? '';
        $('#set-breach').checked = settings.breachAlerts; $('#set-breach-min').value = settings.breachMinutes;
        $('#set-breach-desktop').checked = settings.breachDesktop; $('#set-breach-desktop').closest('.row').hidden = !gmNotify; $('#set-breach-items').checked = settings.breachItems; $('#set-breach-away').checked = settings.breachAway; $('#set-launcher-all').checked = settings.launcherEverywhere;
        launcher.hidden = !launcherShown();
        renderCprEditor();
        $('#set-autorefresh').checked = settings.autoRefresh; $('#set-card').value = settings.cardPos; $('#set-chance').checked = settings.successChance;
        $('#launcher-pos').value = launcherPos; applyLauncherPos();
        currentView = key ? 'live' : 'settings';
        updateConnection(); updateView(); renderLive(); renderIgnored();
        if (location.pathname === '/item.php') message('TornTools import: open an inventory category, then choose Import visible prices in Settings.');
        if (gmMenu) gmMenu('OC Command Centre / CPR settings', open);
    }

    function startTimers() {
        // Countdown text only; no requests.
        setInterval(() => {
            if (root && !panel.hidden && currentView === 'live') tickTimers(root);
        }, 1000);
        // Automatic refresh from the Torn API (allowed for API calls), only while
        // the live view or the crimes-tab card is on screen and the tab is visible.
        setInterval(() => {
            if (!hasAccess() || !settings.autoRefresh || document.hidden) return;
            const liveOpen = root && !panel.hidden && currentView === 'live';
            if (liveOpen || pageWantsLive()) refreshLive(false);
        }, 15000);
        // Breach checks (one API call per interval across all tabs) and the
        // shared alert display (storage reads only).
        setInterval(breachCheck, 30000);
        setInterval(syncBreach, 10000);
        setTimeout(breachCheck, 5000);
        syncBreach();
        if (location.pathname === '/messages.php') {
            // Opened mails render after page load; check each change (DOM only).
            let mailScheduled = false;
            new MutationObserver(() => {
                if (mailScheduled) return;
                mailScheduled = true;
                requestAnimationFrame(() => { mailScheduled = false; checkNewsletter(); });
            }).observe(document.body, { childList: true, subtree: true });
            window.addEventListener('hashchange', () => { lastMailCode = ''; checkNewsletter(); });
            checkNewsletter();
        }
        if (!onOCPagePath()) return;
        // On-page helpers and the summary card follow Torn's re-renders (DOM only).
        injectPageStyles();
        pageObserver = new MutationObserver(scheduleScan);
        pageObserver.observe(document.body, { childList: true, subtree: true });
        window.addEventListener('hashchange', () => { scheduleScan(); if (pageWantsLive() && settings.autoRefresh) refreshLive(false); });
        scheduleScan();
        if (pageWantsLive() && settings.autoRefresh) refreshLive(false);
    }

    async function init() {
        key = await read('key', ''); if (typeof key !== 'string') key = '';
        catalog = await read('catalog', { at: 0, items: {} });
        if (!catalog || typeof catalog.items !== 'object' || !catalog.items || typeof catalog.at !== 'number') catalog = { at: 0, items: {} };
        ttPrices = await read('ttPrices', {}); if (!ttPrices || typeof ttPrices !== 'object') ttPrices = {};
        preferTT = (await read('preferTT', true)) === true;
        settings = readSettings(await read('settings', {}));
        const storedAccess = await read('access', null);
        access = storedAccess && storedAccess.ok === true ? { ok: true, checkedAt: Number(storedAccess.checkedAt) || 0 } : { ok: false, checkedAt: 0 };
        const pos = await read('launcherPos', 'hidden');
        launcherPos = LAUNCHER_POSITIONS.includes(pos) ? pos : 'hidden';
        buildUI();
        startTimers();
        // Keys saved by an earlier version: confirm faction access once (one API call).
        if (key && !access.ok) {
            const result = await checkAccess(key);
            if (result.ok) { await grantAccess(key); launcher.hidden = !launcherShown(); renderCard(); scheduleScan(); if (pageWantsLive()) refreshLive(false); }
            else if (!/connection|timed out|retries|busy/i.test(result.error)) await revokeAccess('');
        }
    }
    init().catch(error => console.error('[' + NAME + '] Could not initialize. Check userscript permissions.', error));
})();
