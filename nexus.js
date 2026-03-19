// --- Configuration & Constants ---
const EVENT_INDEX = 0;
const TEAM_INDEX = 1;

const API_CONFIG = {
    NEXUS: 'https://frc.nexus/api/v1/',
    STATBOTICS: 'https://api.statbotics.io/v3/',
    TBA: 'https://www.thebluealliance.com/api/v3/'
};

// --- State Management ---
let state = {
    eventCode: null,
    teamNumber: null,
    refreshInterval: null,
    tba: {
        team: null,
        event: null,
        matches: [],
        record: null,
    },
    nexus: {
        event: null,
        matches: [],
        announcements: [],
        partRequests: [],
        nowQueuing: null
    },
    statbotics: {
        event: null,
        matches: [],
        epaHistory: []
    },
    lastUpdate: null
};

// --- Storage Helpers ---
const storage = {
    get: (key) => localStorage.getItem(key),
    set: (key, val) => localStorage.setItem(key, val),
    getNexusKey: () => localStorage.getItem('nexusKey'),
    getTBAKey: () => localStorage.getItem('tbaKey'),
    isDebug: () => localStorage.getItem('debugMode') === 'true',
    setDebug: (val) => localStorage.setItem('debugMode', val),
    getLayout: () => {
        const layout = localStorage.getItem('dashboardLayout');
        return layout ? JSON.parse(layout) : null;
    },
    setLayout: (layout) => localStorage.setItem('dashboardLayout', JSON.stringify(layout))
};

$.ajaxSetup({
    error: (jqXHR, textStatus, errorThrown) => {
        console.error('AJAX Error:', textStatus, errorThrown);
    },
    headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
    }
});

// --- URL & State Helpers ---
const getBaseURL = () => {
    const segments = window.location.pathname.split('/').filter(Boolean);
    const dashIndex = segments.indexOf('dashboard');
    if (dashIndex !== -1) {
        // Return path up to and including 'dashboard'
        return '/' + segments.slice(0, dashIndex + 1).join('/') + '/';
    }
    // Fallback if 'dashboard' isn't in URL yet
    if (window.location.hostname.includes('github.io')) {
        return '/' + segments[0] + '/dashboard/';
    }
    return '/dashboard/';
};

function parseURL() {
    const segments = window.location.pathname.split('/').filter(Boolean);
    const hasDebug = window.location.search.includes('debug=true') || storage.isDebug();

    // On GitHub Pages, the first segment is the repo name (e.g. /Romu-Dashboard/)
    // Our target structure is .../dashboard/2026mibro/5907
    // Let's find the index of "dashboard" and use subsequent segments
    const dashIndex = segments.indexOf('dashboard');

    let eventCode = null;
    let teamNumber = null;

    if (dashIndex !== -1) {
        eventCode = segments[dashIndex + 1] || null;
        teamNumber = segments[dashIndex + 2] || null;
    } else {
        // Fallback to previous logic: last two segments
        teamNumber = segments.length >= 2 ? segments[segments.length - 1] : null;
        eventCode = segments.length >= 1 ? segments[segments.length - (teamNumber ? 2 : 1)] : null;
    }

    return {
        eventCode,
        teamNumber,
        debug: hasDebug
    };
}

const URLHasTeam = () => { const d = parseURL(); return !!d.teamNumber; };
const URLHasEvent = () => { const d = parseURL(); return !!d.eventCode; };

// --- UI Components & Utilities ---
function smoothUpdate(selector, newHtml, onHalfway) {
    return new Promise((resolve) => {
        const $el = $(selector);
        if ($el.html() === newHtml) {
            resolve();
            return;
        }

        $el.addClass('transitioning fade-out-up');

        setTimeout(() => {
            if (onHalfway) onHalfway();
            $el.html(newHtml).removeClass('fade-out-up').addClass('fade-in-up');

            setTimeout(() => {
                $el.removeClass('transitioning fade-in-up');
                resolve();
            }, 400);
        }, 300);
    });
}

const createCard = (title, details, link) => `
  <a href="${link}" class="card-link">
    <div class="card">
      <h3>${title}</h3>
      ${details ? `<div class="card-details">${details}</div>` : ''}
    </div>
  </a>`;

const createSearchUI = (id, placeholder) => `
  <div id="controls">
    <input type="text" id="${id}" class="search-input" placeholder="${placeholder}">
  </div>`;

// --- API Wrappers ---
const api = {
    fetchNexus: async (endpoint) => {
        if (storage.isDebug()) return MOCK_DATA.nexus;
        const key = storage.getNexusKey();
        if (!key) throw new Error('Missing Nexus Key');

        const response = await fetch(API_CONFIG.NEXUS + endpoint, {
            method: 'GET',
            headers: { 'Nexus-Api-Key': key }
        });
        if (!response.ok) throw new Error(`Nexus API Error: ${response.status}`);
        return response.json();
    },
    fetchTBA: async (endpoint) => {
        if (storage.isDebug()) {
            if (endpoint.includes('team/')) return MOCK_DATA.tba.team;
            if (endpoint.includes('event/')) return MOCK_DATA.tba.event;
            if (endpoint.includes('status')) return MOCK_DATA.tba.status;
            return {};
        }
        const key = storage.getTBAKey();
        if (!key) throw new Error('Missing TBA Key');

        const response = await fetch(API_CONFIG.TBA + endpoint, {
            method: 'GET',
            headers: { 'X-TBA-Auth-Key': key }
        });
        if (!response.ok) throw new Error(`TBA API Error: ${response.status}`);
        return response.json();
    },
    fetchStatbotics: async (endpoint) => {
        if (storage.isDebug()) {
            if (endpoint.includes('team_event/')) return MOCK_DATA.statbotics.teamEvent;
            if (endpoint.includes('matches?')) return MOCK_DATA.statbotics.matches;
            if (endpoint.includes('team_years?')) return MOCK_DATA.statbotics.epaHistory;
            return MOCK_DATA.statbotics.event;
        }
        // Statbotics v3 supports CORS on GET requests
        // Note: setting mode: 'no-cors' will prevent you from reading the JSON response.
        const response = await fetch(API_CONFIG.STATBOTICS + endpoint, {
            method: 'GET',
            mode: 'cors'
        });
        if (!response.ok) throw new Error(`Statbotics API Error: ${response.status}`);
        return response.json();
    }
};

// --- Core Data & UI Logic ---
async function updateEventInfo(eventCode, teamNumber) {
    try {
        const eventData = await api.fetchNexus(`event/${eventCode}`);
        state.nexus.event = eventData;

        await smoothUpdate('#team-loading-status', 'Loading TBA Data...');

        const teamMatchData = await api.fetchTBA(`team/frc${teamNumber}/event/${eventCode}/matches`);
        state.tba.event = teamMatchData;
        state.tba.record = {
            wins: teamMatchData.filter(m => m.score_breakdown && m.score_breakdown.alliances.red.teams.includes(`frc${teamNumber}`) && m.winning_alliance === 'red').length +
                teamMatchData.filter(m => m.score_breakdown && m.score_breakdown.alliances.blue.teams.includes(`frc${teamNumber}`) && m.winning_alliance === 'blue').length,
            losses: teamMatchData.filter(m => m.score_breakdown && m.score_breakdown.alliances.red.teams.includes(`frc${teamNumber}`) && m.winning_alliance === 'blue').length +
                teamMatchData.filter(m => m.score_breakdown && m.score_breakdown.alliances.blue.teams.includes(`frc${teamNumber}`) && m.winning_alliance === 'red').length,
            ties: teamMatchData.filter(m => m.score_breakdown && (m.winning_alliance === '' || m.winning_alliance === null)).length
        };

        await smoothUpdate('#team-loading-status', 'Loading Statbotics Data...');

        const statboticsData = await api.fetchStatbotics(`event/${eventCode}`);
        state.statbotics.event = statboticsData;
        state.lastUpdate = new Date();
        await smoothUpdate('#team-loading-status', 'Loading dashboard...');
        await smoothUpdate('#content', generateDashboardHTML(), () => $('#content').removeClass('vertically-centered'));
        displayEventInfo();
        window.setInterval(() => {
            updateEventInfo(eventCode, teamNumber);
            displayEventInfo();
        }, 30 * 1000); // Refresh every 30 seconds
    } catch (err) {
        console.error('Error updating event info:', err);
        await smoothUpdate('#team-loading-status', `<span class="error">Error loading data. Check API keys and console for details.</span>`);
    }
}

function displayEventInfo() {
    const dashboardHtml = generateDashboardHTML();
    smoothUpdate('#content', dashboardHtml, () => {
        $('#content').removeClass('vertically-centered');
    });
}

function createWidget(title, content, classes = "") {
    return `
        <div class="widget ${classes}">
            <div class="widget-header">
                <span class="widget-title">${title}</span>
            </div>
            <div class="widget-content">
                ${content}
            </div>
        </div>
    `;
}

function generateDashboardHTML() {
    // Determine user's record
    const recordText = state.tba.record 
        ? `${state.tba.record.wins} - ${state.tba.record.losses} - ${state.tba.record.ties}` 
        : "N/A";

    const eventName = state.nexus.event?.name || "Event Dashboard";

    // Build Widgets with Grid Positioning
    const widgets = [
        createWidget("Team Info", `
            <h2>Team ${state.teamNumber}</h2>
            <p>${state.nexus.event?.name || ""}</p>
            <p>Record: <strong>${recordText}</strong></p>
        `, "r1 c1 w4 h3"),

        createWidget("Next Matches", `
            <div id="match-list">Loading matches...</div>
        `, "r4 c1 w4 h6"),

        createWidget("Event Announcements", `
            <div id="announcement-list">No announcements.</div>
        `, "r1 c5 w8 h4"),

        createWidget("EPA Stats", `
            <div id="epa-stats">Statbotics data loading...</div>
        `, "r5 c5 w4 h5"),

        createWidget("Pit Status", `
            <div id="pit-status">Pit info loading...</div>
        `, "r5 c9 w4 h5")
    ];

    return `
        <div id="dashboard" class="free-grid">
            ${widgets.join('')}
        </div>
    `;
}

// --- Page Renderers ---
async function renderEventSelection() {
    try {
        const data = await api.fetchNexus('events');
        const currentYear = new Date().getFullYear();
        const events = Object.entries(data)
            .map(([code, info]) => ({ code, name: info.name, year: parseInt(code.substring(0, 4)) }))
            .filter(e => e.year >= currentYear);

        const ui = `<h1>Select an Event</h1>${createSearchUI('event-search', 'Search events...')}<div class="grid-list" id="event-list"></div>`;

        await smoothUpdate('#content', ui, () => $('#content').removeClass('vertically-centered'));

        const render = (filter = '') => {
            const items = events.filter(e => e.name.toLowerCase().includes(filter.toLowerCase()) || e.code.includes(filter.toLowerCase()));
            const baseUrl = getBaseURL();
            $('#event-list').html(items.map(e => createCard(e.name, e.code, `${baseUrl}${e.code}`)).join(''));
        };
        render();
        $('#event-search').on('input', function () { render($(this).val()); });

    } catch (err) {
        await smoothUpdate('#content', `<div class="center-content error"><h1>Error loading events. Check API keys.</h1></div>`, () => $('#content').addClass('vertically-centered'));
    }
}

async function renderTeamSelection(eventCode) {
    try {
        const data = await api.fetchTBA(`event/${eventCode}/teams`);
        // Collect and sort teams from TBA data (array of team objects)
        const teams = data.sort((a, b) => a.team_number - b.team_number);

        const ui = `<h1>Select a Team</h1>${createSearchUI('team-search', 'Search teams by number or name...')}<div class="grid-list" id="team-list"></div>`;

        await smoothUpdate('#content', ui, () => $('#content').removeClass('vertically-centered'));

        const render = (filter = '') => {
            const query = filter.toLowerCase();
            const items = teams.filter(t =>
                t.team_number.toString().includes(query) ||
                (t.nickname && t.nickname.toLowerCase().includes(query))
            );

            const baseUrl = getBaseURL();
            $('#team-list').html(items.map(t =>
                createCard(`Team ${t.team_number}`, t.nickname || '', `${baseUrl}${eventCode}/${t.team_number}`)
            ).join(''));
        };

        render();
        $('#team-search').on('input', function () { render($(this).val()); });
    } catch (err) {
        console.error('TBA API Error:', err);
        const errorMsg = err === 'Missing TBA Key'
            ? 'Please set your TBA API key in settings to view teams.'
            : 'Error loading teams from The Blue Alliance.';
        await smoothUpdate('#content', `<div class="center-content error"><h1>${errorMsg}</h1></div>`, () => $('#content').addClass('vertically-centered'));
    }
}

function checkEventExists(eventCode) {
    return api.fetchNexus('events').then(data => {
        return Object.keys(data).includes(eventCode);
    }).catch(err => {
        console.error('API Error:', err);
        return false;
    });
}

function checkTeamAtEvent(eventCode, teamNumber) {
    return api.fetchTBA(`event/${eventCode}/teams/keys`).then(keys => {
        return keys.includes(`frc${teamNumber}`);
    }).catch(err => {
        console.error('TBA API Error (checkTeamAtEvent):', err);
        return false;
    });
}

// --- Main Init ---
$(async () => {
    // Settings Logic
    // ...existing code...
    if (!storage.getNexusKey() && !storage.isDebug()) $('#settings-menu').removeClass('hidden');

    // Routing
    const { eventCode, teamNumber } = parseURL();

    if (storage.isDebug()) {
        const mockEvent = MOCK_DATA.nexus.eventKey;
        const mockTeam = MOCK_DATA.tba.team.team_number;
        await smoothUpdate('#content', `<h1>Team ${mockTeam} Dashboard (Debug)</h1><p id="team-loading-status">Loading Debug Data...</p>`, () => $('#content').removeClass('vertically-centered'));
        updateEventInfo(mockEvent, mockTeam);
        return;
    }

    if (teamNumber) {
        await smoothUpdate('#content', `<h1>Team ${teamNumber} Dashboard</h1><p id="team-loading-status">Checking Team Status...</p>`, () => $('#content').removeClass('vertically-centered'));

        const exists = await checkTeamAtEvent(eventCode, teamNumber);
        if (exists) {
            await smoothUpdate('#team-loading-status', 'Loading Nexus Data...');
            updateEventInfo(eventCode, teamNumber);
        } else {
            await smoothUpdate('#team-loading-status', `<span class="error">Team ${teamNumber} is not registered for event ${eventCode}.</span>`);
        }
    } else if (eventCode) {
        try {
            const exists = await checkEventExists(eventCode);
            if (exists) {
                renderTeamSelection(eventCode);
            } else {
                renderEventSelection();
            }
        } catch (err) {
            console.error('Error checking event existence:', err);
            await smoothUpdate('#content', `<div class="center-content error"><h1>Error loading event data. Check API keys.</h1></div>`, () => $('#content').addClass('vertically-centered'));
        }
    } else {
        renderEventSelection();
    }
});
