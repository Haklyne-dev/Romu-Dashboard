

// GET API wrapper for frc.nexus

//check for jquery
if (typeof jQuery === 'undefined') {
    throw new Error('Nexus.js requires jQuery');
}

//constants
const EVENT_INDEX = 1;
const TEAM_INDEX = 2;

const NEXUS_API_URL = 'https://frc.nexus/api/v1/';
const THEBLUEALLIANCE_API_URL = 'https://www.thebluealliance.com/api/v3/';
const STATBOTICS_API_URL = 'https://www.statbotics.io/api/v1/';

// local variables
var nexusKey;

var selectedEvent;
var selectedTeam;

var selectedEventData;
var selectedTeamData;

function parseURL() {
    //get the event code from the url
    var url = window.location.href;
    var splitURL = url.split('/');
    var eventCode = splitURL[EVENT_INDEX];
    var teamNumber = splitURL[TEAM_INDEX];
    return {
        eventCode: eventCode,
        teamNumber: teamNumber
    };
}

function setNexusKey(key) {
    localStorage.setItem('nexusKey', key);
}

function getNexusKey() {
    return localStorage.getItem('nexusKey');
}

function getSelectedTeam() {
    var urlData = parseURL();
    return urlData.teamNumber;
}

function getSelectedEvent() {
    var urlData = parseURL();
    return urlData.eventCode;
}

function URLHasTeam() {
    var urlData = parseURL();
    return urlData.teamNumber !== undefined;
}

function URLHasEvent() {
    var urlData = parseURL();
    return urlData.eventCode !== undefined;
}

function getAllEvents() {
    return $.ajax({
        url: NEXUS_API_URL + 'events',
        headers: {
            'Nexus-Api-Key': prompt('Enter your Nexus API key to view events:')
        }
    });
}

function getEventData(eventCode) {
    return $.ajax({
        url: NEXUS_API_URL + 'event/' + eventCode,
        headers: {
            'Nexus-Api-Key': getNexusKey()
        }
    });
}

function getTeamsAtCurrentEvent() {
    let teams = [];

    if (selectedEvent === undefined) {
        return Promise.reject('No event selected');
    }

    if (selectedEventData === undefined) {
        getEventData(selectedEvent);
    }

    for (match in selectedEventData.matches) {
        var matchTeams = match.redTeams.concat(match.blueTeams);
        for (team in matchTeams) {
            if (!teams.includes(team)) {
                teams.push(team);
            }
        }
        return teams;
    }
}

window.addEventListener('load', function() {
    // initialize app containers
    appContainer = $('#app');


    //check if the url has an event code and team number
    if (URLHasEvent()) {
        selectedEvent = getSelectedEvent();
        getEventData(selectedEvent).then(function(data) {
            selectedEventData = data;
        });
    } else {
        appContainer.html('<h1>Select an Event</h1><div class="constrained-center"><div id="event-list"></div></div>');

        getAllEvents().then(function(data) {
            //sort events by date
            data.sort(function(a, b) {
                return new Date(b.startDate) - new Date(a.startDate);
            });

            for (evt in data) {
                var event = data[evt];
                $('#event-list').append('<a href="' + event.key + '" class="event-link"><div class="event-card"><h2>' + event.name + '</h2><p class="event-details">' + event.key + '</p></div></a>');
            }
        });
    }

    if (URLHasTeam()) {
        selectedTeam = getSelectedTeam();
    }
});