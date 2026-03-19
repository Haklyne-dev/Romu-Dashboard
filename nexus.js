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
    getLayout: () => {
        const layout = localStorage.getItem('dashboardLayout');
        return layout ? JSON.parse(layout) : null;
    },
    setLayout: (layout) => localStorage.setItem('dashboardLayout', JSON.stringify(layout)),
    saveKeys: (nexus, tba) => {
        localStorage.setItem('nexusKey', nexus || '');
        localStorage.setItem('tbaKey', tba || '');
    }
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
        teamNumber
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

// --- Widget Registry ---
// This centralizes all widget definitions for easy addition/maintenance
const WIDGET_REGISTRY = {
    'team-info': {
        title: 'Team Info',
        defaultSize: { w: 300, h: 180 },
        render: (state) => {
            const recordText = state.tba.record 
                ? `${state.tba.record.wins} - ${state.tba.record.losses} - ${state.tba.record.ties}` 
                : "N/A";
            return `
                <h1>Team ${state.teamNumber}</h1>
                <p>${state.tba.event?.name || ""}</p>
                <p>Record: <strong>${recordText}</strong></p>
            `;
        }
    },
    'next-matches': {
        title: 'Next Matches',
        defaultSize: { w: 300, h: 400 },
        render: (state) => `<div id="match-list">Loading matches...</div>`
    },
    'announcements': {
        title: 'Event Announcements',
        defaultSize: { w: 600, h: 250 },
        render: (state) => `<div id="announcement-list">No announcements.</div>`
    },
    'epa-stats': {
        title: 'EPA Stats',
        defaultSize: { w: 300, h: 330 },
        render: (state) => `<div id="epa-stats">Statbotics data loading...</div>`
    },
    'pit-status': {
        title: 'Pit Status',
        defaultSize: { w: 280, h: 330 },
        render: (state) => `<div id="pit-status">Pit info loading...</div>`
    }
};
// Add any new widgets to this object ^^^

// --- API Wrappers ---
const api = {
    fetchNexus: async (endpoint) => {
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
let dataRefreshInterval = null;

async function updateEventInfo(eventCode, teamNumber, silent = false) {
    if (!silent && dataRefreshInterval) clearInterval(dataRefreshInterval);

    try {
        if (!silent) await smoothUpdate('#team-loading-status', 'Loading Nexus Data...');

        const eventData = await api.fetchNexus(`event/${eventCode}`);
        state.nexus.event = eventData;

        if (!silent) await smoothUpdate('#team-loading-status', 'Loading TBA Data...');

        const teamMatchData = await api.fetchTBA(`team/frc${teamNumber}/event/${eventCode}/matches`);
        // Note: Preserving original logic where event is temporarily matches
        state.tba.event = teamMatchData;
        state.tba.record = {
            wins: teamMatchData.filter(m => m.score_breakdown && m.score_breakdown.alliances.red.teams.includes(`frc${teamNumber}`) && m.winning_alliance === 'red').length +
                teamMatchData.filter(m => m.score_breakdown && m.score_breakdown.alliances.blue.teams.includes(`frc${teamNumber}`) && m.winning_alliance === 'blue').length,
            losses: teamMatchData.filter(m => m.score_breakdown && m.score_breakdown.alliances.red.teams.includes(`frc${teamNumber}`) && m.winning_alliance === 'blue').length +
                teamMatchData.filter(m => m.score_breakdown && m.score_breakdown.alliances.blue.teams.includes(`frc${teamNumber}`) && m.winning_alliance === 'red').length,
            ties: teamMatchData.filter(m => m.score_breakdown && (m.winning_alliance === '' || m.winning_alliance === null)).length
        };

        const eventDataTBA = await api.fetchTBA(`event/${eventCode}`);
        state.tba.event = eventDataTBA;

        if (!silent) await smoothUpdate('#team-loading-status', 'Loading Statbotics Data...');

        const statboticsData = await api.fetchStatbotics(`event/${eventCode}`);
        state.statbotics.event = statboticsData;
        state.lastUpdate = new Date();
        state.eventCode = eventCode;
        state.teamNumber = teamNumber;

        if (!silent) {
            await smoothUpdate('#team-loading-status', 'Loading dashboard...');
            displayEventInfo(true); // Animate first load
            
            // Start usage interval
            dataRefreshInterval = setInterval(() => {
                updateEventInfo(eventCode, teamNumber, true);
            }, 30 * 1000);
        } else {
            displayEventInfo(false); // Silent update
        }
        
    } catch (err) {
        console.error('Error updating event info:', err);
        if (!silent) await smoothUpdate('#team-loading-status', `<span class="error">Error loading data. Check API keys and console for details.</span>`);
    }
}

function updateDashboardContent() {
    $('.widget').each(function() {
        const $el = $(this);
        const id = $el.data('id');
        
        let baseId = id;
        const knownType = Object.keys(WIDGET_REGISTRY).find(key => id === key || id.startsWith(key + '-'));
        if (knownType) baseId = knownType;

        const widgetDef = WIDGET_REGISTRY[baseId];
        
        if (widgetDef && typeof widgetDef.render === 'function') {
             const newContent = widgetDef.render(state);
             // Efficiently update only the content area, preserving the header/controls
             $el.find('.widget-content').html(newContent);
        }
    });
}

function displayEventInfo(animate = true, forceRebuild = false) {
    if (animate) {
        // Full initial render with animation
        const dashboardHtml = generateDashboardHTML();
        smoothUpdate('#content', dashboardHtml, () => {
            $('#content').removeClass('vertically-centered');
            $('#edit-layout-btn').show().removeClass('hidden');
            initInteractions();
        });
    } else {
        // Silent update loop
        // If the dashboard doesn't exist yet (e.g. rapid navigation) or forced, build it
        if (forceRebuild || $('#dashboard').length === 0) {
            const dashboardHtml = generateDashboardHTML();
            $('#content').html(dashboardHtml).removeClass('vertically-centered');
            $('#edit-layout-btn').show().removeClass('hidden');
            initInteractions();
        } else {
            // Smart update: only update inner HTML of existing widgets
            updateDashboardContent();
            // Note: We do NOT re-init interactions here because DOM elements are preserved
        }
    }
}

function createWidget(widget, isEditing = false) {
    const { id, title, content, pos } = widget;
    
    // Validate position properties to prevent "undefined" errors
    // Now supporting absolute pixel/relative values as well
    const x = pos?.x ?? 0;
    const y = pos?.y ?? 0;
    const w = pos?.w ?? 300;
    const h = pos?.h ?? 200;

    const style = `left: ${x}px; top: ${y}px; width: ${w}px; height: ${h}px; position: absolute;`;
    return `
        <div class="widget" data-id="${id}" style="${style}">
            <div class="widget-header">
                <span class="widget-title">${title}</span>
                <div class="widget-controls">
                    <button class="widget-remove-btn" data-id="${id}">✕</button>
                </div>
            </div>
            <div class="widget-content">
                ${content || 'No content'}
            </div>
            <div class="resize-handle"></div>
        </div>
    `;
}

function generateDefaultLayout() {
    const W = Math.max($(window).width(), 1024); // Assume at least tablet size
    
    // Account for header height to ensure widgets fit within the visible area
    const headerHeight = $('#main-header').outerHeight() || 60;
    const H = Math.max($(window).height() - headerHeight, 600);
    
    const gap = 20;

    // Grid System: 12 columns
    // Use relative percentages but map to pixels for absolute positioning
    
    // Column 1: "Sidebar" style (30%)
    const c1X = gap;
    const c1W = Math.floor((W - 3*gap) * 0.3);
    
    // Column 2: "Main" style (70%)
    const c2X = c1X + c1W + gap;
    const c2W = W - c2X - gap;

    // Vertical splits
    const h1 = 180; // Team Info height
    // Announcements: Top right
    const h2 = Math.min(300, Math.floor(H * 0.35)); 

    const layout = [
        // Team Info: Top Left
        {
            id: 'team-info',
            pos: { x: c1X, y: gap, w: c1W, h: h1 }
        },
        // Match List: Bottom Left (Rest of height)
        {
            id: 'next-matches',
            pos: { x: c1X, y: gap + h1 + gap, w: c1W, h: H - (gap*3 + h1) }
        },
        // Announcements: Top Right
        {
            id: 'announcements',
            pos: { x: c2X, y: gap, w: c2W, h: h2 }
        }
    ];

    // Bottom Right Split (EPA / Pit)
    const bottomY = gap + h2 + gap;
    const bottomH = H - bottomY - gap;
    const splitW = (c2W - gap) / 2;

    layout.push({
        id: 'epa-stats',
        pos: { x: c2X, y: bottomY, w: splitW, h: bottomH }
    });

    layout.push({
        id: 'pit-status',
        pos: { x: c2X + splitW + gap, y: bottomY, w: splitW, h: bottomH }
    });

    return layout.map(w => {
        const def = WIDGET_REGISTRY[w.id];
        return {
             id: w.id,
             title: def ? def.title : w.id,
             pos: w.pos
        };
    });
}


function getValidLayout() {
    const layout = storage.getLayout();
    
    // Check if layout is a non-empty array
    if (!Array.isArray(layout)) {
        const defaults = generateDefaultLayout();
        storage.setLayout(defaults);
        return defaults;
    }

    // If editing and layout is empty, we allow it (don't force defaults)
    const isEditing = $('#edit-layout-btn').hasClass('editing');
    if (layout.length === 0 && !isEditing) {
        const defaults = generateDefaultLayout();
        storage.setLayout(defaults);
        return defaults;
    } else if (layout.length === 0 && isEditing) {
        return [];
    }

    // Strict validation: check if every widget has a valid position
    const isValid = layout.every(w => 
        w && 
        w.pos && 
        typeof w.pos.x === 'number' && 
        typeof w.pos.y === 'number' && 
        typeof w.pos.w === 'number' && 
        typeof w.pos.h === 'number'
    );

    if (!isValid) {
        console.warn("Invalid layout detected in storage. Resetting to defaults.");
        const defaults = generateDefaultLayout();
        storage.setLayout(defaults);
        return defaults;
    }

    return layout;
}

function generateDashboardHTML() {
    const isEditing = $('#edit-layout-btn').hasClass('editing');
    
    // Ensure the edit layout button is visible when the dashboard is generated
    $('#edit-layout-btn').show().removeClass('hidden');
    if (isEditing) {
        $('#edit-layout-btn').text('Finish Editing').addClass('editing');
    } else {
        $('#edit-layout-btn').text('Edit Layout').removeClass('editing');
    }

    const savedLayout = getValidLayout();
    
    // Create widgets HTML
    const widgetsHtml = savedLayout.map(w => {
        // Robustly determine type by checking registry for matching prefix
        // This handles cases like 'team-info' where split('-')[0] would mistakenly return 'team'
        let baseId = w.id;
        const knownType = Object.keys(WIDGET_REGISTRY).find(key => w.id === key || w.id.startsWith(key + '-'));
        if (knownType) baseId = knownType;

        const widgetDef = WIDGET_REGISTRY[baseId];
        
        // Dynamically find content from registry or fallback
        w.content = widgetDef ? (typeof widgetDef.render === 'function' ? widgetDef.render(state) : widgetDef.render) : "Unknown Widget";
        return createWidget(w);
    }).join('');

    // Dynamically generate menu items from registry
    const menuItems = Object.keys(WIDGET_REGISTRY).map(key => {
        const def = WIDGET_REGISTRY[key];
        // Use delegated event listener pattern instead of onclick attribute to keep DOM clean
        return `<button class="add-widget-btn" data-type="${key}">${def.title}</button>`;
    }).join('');

    return `
        <!-- Add Widget Modal (Hidden by default) -->
        <div id="add-widget-menu" class="hidden">
            <div class="menu-header">
                <span>Add Widget</span>
                <button id="close-add-widget">✕</button>
            </div>
            <div class="menu-items">
                ${menuItems}
            </div>
        </div>
        
        <!-- Controls Bar -->
        <div id="dashboard-controls" class="add-widget-container" style="${isEditing ? 'display:flex;' : 'display:none;'}">
            <button id="toggle-add-widget" class="add-widget-btn">+ Add Widget</button>
        </div>
        
        <!-- Dashboard Canvas -->
        <div id="dashboard" class="free-layout ${isEditing ? 'editing' : ''}">
            ${widgetsHtml}
        </div>
    `;
}

function removeWidget(id) {
    let layout = getValidLayout();
    layout = layout.filter(w => w.id !== id);
    storage.setLayout(layout);
    // Force rebuild to remove widget from DOM instantly without animation
    displayEventInfo(false, true);
}

function resizeWidget(id, dw, dh) {
    // This function is now deprecated in favor of cursor interactions
}

function addWidget(type) {
    let layout = getValidLayout();
    
    // Position the new widget slightly lower/right than the last added one to cascade
    // Or center it. Let's Center it for visibility.
    const scrollTop = $(window).scrollTop() || 0;
    const dashboardWidth = $('#dashboard').width() || 1000;
    const centerX = (dashboardWidth - 300) / 2; 
    const centerY = (scrollTop > 100 ? scrollTop : 100) + 50; 

    // Retrieve default size from registry if available
    const def = WIDGET_REGISTRY[type];
    const defaultW = def && def.defaultSize ? def.defaultSize.w : 300;
    const defaultH = def && def.defaultSize ? def.defaultSize.h : 200;
    const widgetTitle = def ? def.title : type.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');


    // Use a unique timestamp key but keep the type prefix for content mapping
    const newWidget = {
        id: type + '-' + Date.now().toString(36), 
        title: widgetTitle,
        pos: { x: Math.max(20, centerX), y: centerY, w: defaultW, h: defaultH }
    };
    layout.push(newWidget);
    storage.setLayout(layout);
    
    // Refresh to show new widget, effectively hides the menu since HTML is regenerated
    // Force rebuild to add widget to DOM instantly without animation
    displayEventInfo(false, true);
    
    // Ensure the menu stays hidden after adding (it will be by default from generateDashboardHTML)
    $('#add-widget-menu').addClass('hidden');
}

function initSortable() {
    // Deprecated for absolute positioning
}

function initInteractions() {
    const isEditing = $('#edit-layout-btn').hasClass('editing');
    
    // Safely cleanup existing interactions
    // Note: interact.isSet is not available in v1.10+, causing potential errors if accessed.
    // We just call unset() which handles cleanup idempotently.
    try {
        interact('.widget').unset();
    } catch (e) {
        console.warn("Interact cleanup warning:", e);
    }

    if (!isEditing) {
        return;
    }

    const gridSize = 20;

    interact('.widget')
        .draggable({
            modifiers: [
                interact.modifiers.snap({
                    targets: [
                        interact.createSnapGrid({ x: gridSize, y: gridSize })
                    ],
                    range: Infinity,
                    relativePoints: [ { x: 0, y: 0 } ]
                }),
                interact.modifiers.restrictRect({
                    restriction: 'parent',
                    endOnly: true
                })
            ],
            listeners: {
                start(event) {
                    // Bring to front on start drag
                    $('.widget').css('z-index', 1);
                    $(event.target).css('z-index', 100);
                },
                move(event) {
                    const target = event.target;
                    const x = (parseFloat(target.getAttribute('data-x')) || 0) + event.dx;
                    const y = (parseFloat(target.getAttribute('data-y')) || 0) + event.dy;

                    target.style.transform = `translate(${x}px, ${y}px)`;
                    target.setAttribute('data-x', x);
                    target.setAttribute('data-y', y);
                },
                end(event) {
                    saveCurrentLayout();
                }
            }
        })
        .resizable({
            edges: { left: false, right: true, bottom: true, top: false },
            modifiers: [
                // Use snapSize for resizing if available, otherwise fallback to regular snap or none
                interact.modifiers.snapSize ? interact.modifiers.snapSize({
                    targets: [
                        interact.createSnapGrid({ x: gridSize, y: gridSize })
                    ],
                }) : null,
                interact.modifiers.restrictSize({
                    min: { width: 200, height: 150 },
                    max: { width: 1200, height: 800 }
                })
            ].filter(Boolean), // Filter out nulls if snapSize wasn't found
            listeners: {
                start(event) {
                    $('.widget').css('z-index', 1);
                    $(event.target).css('z-index', 100);
                },
                move(event) {
                    const target = event.target;
                    let x = (parseFloat(target.getAttribute('data-x')) || 0);
                    let y = (parseFloat(target.getAttribute('data-y')) || 0);

                    // Update the element's style
                    target.style.width = event.rect.width + 'px';
                    target.style.height = event.rect.height + 'px';

                    // Translate when resizing from top or left edges
                    x += event.deltaRect.left;
                    y += event.deltaRect.top;

                    target.style.transform = `translate(${x}px, ${y}px)`;
                    target.setAttribute('data-x', x);
                    target.setAttribute('data-y', y);
                },
                end(event) {
                    saveCurrentLayout();
                }
            }
        });
}

function saveCurrentLayout() {
    const widgets = [];
    const $dashboard = $('#dashboard');
    const dashOffset = $dashboard.offset();
    
    // Ensure dashboard offset is valid
    if (!dashOffset) return;

    $dashboard.find('.widget').each(function() {
        const $w = $(this);
        const id = $w.data('id');
        const title = $w.find('.widget-title').text();
        
        // Get visual position
        const offset = $w.offset();
        const relativeX = offset.left - dashOffset.left;
        const relativeY = offset.top - dashOffset.top;
        
        const w = $w.outerWidth();
        const h = $w.outerHeight();

        widgets.push({
            id: id,
            title: title,
            pos: {
                x: relativeX,
                y: relativeY,
                w: w,
                h: h
            }
        });
    });
    storage.setLayout(widgets);
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
    $('#settings-btn').on('click', () => $('#settings-menu').toggleClass('hidden'));
    $('#close-settings-btn').on('click', () => $('#settings-menu').addClass('hidden'));
    
    // Fill initial values
    $('#nexus-key-input').val(storage.getNexusKey());
    $('#tba-key-input').val(storage.getTBAKey());

    $('#save-settings-btn').on('click', () => {
        const nexusKey = $('#nexus-key-input').val();
        const tbaKey = $('#tba-key-input').val();
        
        storage.set('nexusKey', nexusKey);
        storage.set('tbaKey', tbaKey);
        
        $('#settings-menu').addClass('hidden');
        window.location.reload();
    });

    // Make sure we always delegate this check
    // Fix: We must unbind first to avoid duplicate listeners if init re-runs, and use delegation
    // because #edit-layout-btn IS recreated by generateDashboardHTML
    $(document).off('click', '#edit-layout-btn').on('click', '#edit-layout-btn', function() {
        const $this = $(this);
        const isEditing = $this.hasClass('editing');
        
        if (isEditing) {
            // TURNING OFF EDITING
            $this.removeClass('editing').text('Edit Layout');
            $('#dashboard').removeClass('editing');
            $('#add-widget-menu').addClass('hidden');
            $('#dashboard-controls').hide(); // Hide the "Add Widget" container
            saveCurrentLayout();
            // Re-render to reflect changes or load defaults if empty
            displayEventInfo(false);
        } else {
            // TURNING ON EDITING
            $this.addClass('editing').text('Finish Editing');
            $('#dashboard').addClass('editing');
            $('#dashboard-controls').show().css('display', 'flex'); // Show the "Add Widget" container
        }
        
        if (isEditing) {
            if (interact.isSet('.widget')) {
                interact('.widget').unset();
            }
        } else {
            initInteractions();
        }
    });

    // Add Widget Menu Button Logic (Delegate for dynamically created elements)
    $(document).off('click', '#toggle-add-widget').on('click', '#toggle-add-widget', function() {
         $('#add-widget-menu').toggleClass('hidden');
    });

    $(document).off('click', '#close-add-widget').on('click', '#close-add-widget', function() {
         $('#add-widget-menu').addClass('hidden');
    });
    
    // Also handle menu close inside the menu
    $(document).off('click', '#add-widget-menu .add-widget-btn').on('click', '#add-widget-menu .add-widget-btn', function() {
        const type = $(this).data('type');
        if (type) {
            addWidget(type);
        }
    });

    // Handle widget removal (Delegate for dynamically created widgets)
    $(document).off('click', '.widget-remove-btn').on('click', '.widget-remove-btn', function() {
        const id = $(this).data('id');
        if (id) {
            removeWidget(id);
        }
    });

    // Routing
    const { eventCode, teamNumber } = parseURL();

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
