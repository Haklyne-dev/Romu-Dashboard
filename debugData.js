const MOCK_DATA = {
  nexus: {
    "eventKey": "2024mock",
    "dataAsOfTime": Date.now(),
    "nowQueuing": "Qualification 10",
    "matches": [
      {
        "label": "Qualification 9",
        "status": "Completed",
        "redTeams": ["254", "1678", "1323"],
        "blueTeams": ["118", "4414", "5940"],
        "times": { "actualOnFieldTime": Date.now() - 300000 }
      },
      {
        "label": "Qualification 10",
        "status": "Now queuing",
        "redTeams": ["5907", "604", "115"],
        "blueTeams": ["971", "254", "1678"],
        "times": { "estimatedStartTime": Date.now() + 600000 }
      },
      {
        "label": "Qualification 11",
        "status": "Scheduled",
        "redTeams": ["1323", "118", "4414"],
        "blueTeams": ["5940", "5907", "604"],
        "times": { "estimatedStartTime": Date.now() + 1200000 }
      }
    ],
    "announcements": [
      {
        "id": "mock-1",
        "postedTime": Date.now(),
        "announcement": "DEBUG MODE ENABLED: Using simulated event data."
      }
    ]
  },
  tba: {
    team: { "nickname": "The Cheesy Poofs", "team_number": 254 },
    event: { "name": "Silicon Valley Regional (Mock)", "city": "San Jose" },
    status: { "pit_location": "A12" }
  },
  statbotics: {
    teamEvent: { "epa": { "recent": 55.4 }, "rank": 1 },
    matches: [
      { "status": "completed", "red_1": 254, "red_2": 1678, "red_3": 1323, "red_score": 120, "blue_score": 100 },
      { "status": "upcoming", "blue_1": 971, "blue_2": 254, "blue_3": 1678, "red_score": 0, "blue_score": 0 }
    ],
    epaHistory: [
      { "year": 2022, "epa": { "recent": 48.2 } },
      { "year": 2023, "epa": { "recent": 52.1 } },
      { "year": 2024, "epa": { "recent": 55.4 } }
    ]
  }
};