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
        status: null
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
        teamEvent: null,
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
    const $el = $(selector);
    if ($el.html() === newHtml) return;

    $el.addClass('transitioning fade-out-up');

    setTimeout(() => {
        if (onHalfway) onHalfway();
        $el.html(newHtml).removeClass('fade-out-up').addClass('fade-in-up');

        setTimeout(() => $el.removeClass('transitioning fade-in-up'), 400);
    }, 300);
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
    fetchNexus: (endpoint) => {
        if (storage.isDebug()) return Promise.resolve(MOCK_DATA.nexus);
        const key = storage.getNexusKey();
        if (!key) return Promise.reject('Missing Nexus Key');
        return $.ajax({
            url: API_CONFIG.NEXUS + endpoint,
            headers: { 'Nexus-Api-Key': key },
            crossDomain: true
        });
    },
    fetchTBA: (endpoint) => {
        if (storage.isDebug()) {
            if (endpoint.includes('team/')) return Promise.resolve(MOCK_DATA.tba.team);
            if (endpoint.includes('event/')) return Promise.resolve(MOCK_DATA.tba.event);
            if (endpoint.includes('status')) return Promise.resolve(MOCK_DATA.tba.status);
            return Promise.resolve({});
        }
        const key = storage.getTBAKey();
        if (!key) return Promise.reject('Missing TBA Key');
        return $.ajax({
            url: API_CONFIG.TBA + endpoint,
            headers: { 'X-TBA-Auth-Key': key },
            crossDomain: true
        });
    },
    fetchStatbotics: (endpoint) => {
        if (storage.isDebug()) {
            if (endpoint.includes('team_event/')) return Promise.resolve(MOCK_DATA.statbotics.teamEvent);
            if (endpoint.includes('matches?')) return Promise.resolve(MOCK_DATA.statbotics.matches);
            if (endpoint.includes('team_years?')) return Promise.resolve(MOCK_DATA.statbotics.epaHistory);
            return Promise.resolve(MOCK_DATA.statbotics.event);
        }
        // Statbotics v3 expects team as integer, event as string
        return $.ajax({
            url: API_CONFIG.STATBOTICS + endpoint,
            crossDomain: true
        });
    }
};

// --- Core Data & UI Logic ---
async function updateEventInfo(eventCode, teamNumber) {
    api.fetchNexus(`event/${eventCode}`).then(eventData => {
        state.nexus.event = eventData;
        return api.fetchTBA(`team/frc${teamNumber}/event/${eventCode}`);
    }).then(teamEventData => {
        state.tba.event = teamEventData;
        return api.fetchTBA(`team/frc${teamNumber}/status`);
    }).then(teamStatus => {
        state.tba.status = teamStatus;
        return api.fetchStatbotics(`team_event/${teamNumber}/${eventCode}`);
    }).then(statboticsData => {
        state.statbotics.teamEvent = statboticsData;
        state.lastUpdate = new Date();
        displayEventInfo();
    }).catch(err => {
        console.error('Error updating event info:', err);
        smoothUpdate('#team-loading-status', `<span class="error">Error loading data. Check API keys and console for details.</span>`);
    }
    );
}

function displayEventInfo() {

}

// --- Page Renderers ---
function renderEventSelection() {
    api.fetchNexus('events').then(data => {
        const currentYear = new Date().getFullYear();
        const events = Object.entries(data)
            .map(([code, info]) => ({ code, name: info.name, year: parseInt(code.substring(0, 4)) }))
            .filter(e => e.year >= currentYear);

        const ui = `<h1>Select an Event</h1>${createSearchUI('event-search', 'Search events...')}<div class="grid-list" id="event-list"></div>`;

        smoothUpdate('#content', ui, () => $('#content').removeClass('vertically-centered'));

        setTimeout(() => {
            const render = (filter = '') => {
                const items = events.filter(e => e.name.toLowerCase().includes(filter.toLowerCase()) || e.code.includes(filter.toLowerCase()));
                const baseUrl = getBaseURL();
                $('#event-list').html(items.map(e => createCard(e.name, e.code, `${baseUrl}${e.code}`)).join(''));
            };
            render();
            $('#event-search').on('input', function () { render($(this).val()); });
        }, 400);
    }).catch(err => {
        smoothUpdate('#content', `<div class="center-content error"><h1>Error loading events. Check API keys.</h1></div>`, () => $('#content').addClass('vertically-centered'));
    });
}

function renderTeamSelection(eventCode) {
    api.fetchTBA(`event/${eventCode}/teams`).then(data => {
        // Collect and sort teams from TBA data (array of team objects)
        const teams = data.sort((a, b) => a.team_number - b.team_number);

        const ui = `<h1>Select a Team</h1>${createSearchUI('team-search', 'Search teams by number or name...')}<div class="grid-list" id="team-list"></div>`;

        smoothUpdate('#content', ui, () => $('#content').removeClass('vertically-centered'));

        setTimeout(() => {
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
        }, 400);
    }).catch(err => {
        console.error('TBA API Error:', err);
        const errorMsg = err === 'Missing TBA Key'
            ? 'Please set your TBA API key in settings to view teams.'
            : 'Error loading teams from The Blue Alliance.';
        smoothUpdate('#content', `<div class="center-content error"><h1>${errorMsg}</h1></div>`, () => $('#content').addClass('vertically-centered'));
    });
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
$(() => {
    // Settings Logic
    $('#settings-btn').on('click', () => {
        $('#settings-menu').toggleClass('hidden');
        $('#nexus-key-input').val(storage.getNexusKey() || '');
        $('#tba-key-input').val(storage.getTBAKey() || '');
        $('#debug-mode-toggle').prop('checked', storage.isDebug());
    });

    $('#save-settings-btn').on('click', () => {
        storage.set('nexusKey', $('#nexus-key-input').val().trim());
        storage.set('tbaKey', $('#tba-key-input').val().trim());
        storage.setDebug($('#debug-mode-toggle').is(':checked'));
        location.reload();
    });

    if (!storage.getNexusKey() && !storage.isDebug()) $('#settings-menu').removeClass('hidden');

    // Routing
    const { eventCode, teamNumber } = parseURL();

    if (storage.isDebug()) {
        const mockEvent = MOCK_DATA.nexus.eventKey;
        const mockTeam = MOCK_DATA.tba.team.team_number;
        smoothUpdate('#content', `<h1>Team ${mockTeam} Dashboard (Debug)</h1><p id="team-loading-status">Loading Debug Data...</p>`, () => $('#content').removeClass('vertically-centered'));
        setTimeout(() => {
            updateEventInfo(mockEvent, mockTeam);
        }, 500);
        return;
    }

    if (teamNumber) {
        smoothUpdate('#content', `<h1>Team ${teamNumber} Dashboard</h1><p id="team-loading-status">Checking Team Status...</p>`, () => $('#content').removeClass('vertically-centered'));

        checkTeamAtEvent(eventCode, teamNumber).then(exists => {
            if (exists) {
                setTimeout(() => {
                    smoothUpdate('#team-loading-status', 'Loading event information...');
                    updateEventInfo(eventCode, teamNumber);
                }, 800);
            } else {
                setTimeout(() => {
                    smoothUpdate('#team-loading-status', `<span class="error">Team ${teamNumber} is not registered for event ${eventCode}.</span>`);
                }, 800);
            }
        });
    } else if (eventCode) {
        checkEventExists(eventCode).then(exists => {
            if (exists) {
                renderTeamSelection(eventCode);
            } else {
                renderEventSelection();
            }
        }).catch(err => {
            console.error('Error checking event existence:', err);
            smoothUpdate('#content', `<div class="center-content error"><h1>Error loading event data. Check API keys.</h1></div>`, () => $('#content').addClass('vertically-centered'));
        });
    } else {
        renderEventSelection();
    }
});
