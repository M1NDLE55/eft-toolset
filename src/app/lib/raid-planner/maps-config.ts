import type { MapConfig } from "./types";

export const mapConfigs: MapConfig[] = [
  {
    "key": "streets-of-tarkov",
    "name": "Streets of Tarkov",
    "strategy": "svg",
    "svgPath": "https://assets.tarkov.dev/maps/svg/StreetsOfTarkov.svg",
    "svgLayer": "Ground_Level",
    "tileSize": 256,
    "minZoom": 1,
    "maxZoom": 5,
    "transform": [
      0.38,
      0,
      0.38,
      0
    ],
    "coordinateRotation": 180,
    "bounds": [
      [
        323,
        -295
      ],
      [
        -280,
        532
      ]
    ],
    "heightRange": [
      -6,
      10
    ],
    "floors": [
      {
        "id": "2nd-floor",
        "name": "2nd Floor",
        "svgLayer": "Second_Floor",
        "extents": [
          {
            "height": [
              10,
              15
            ]
          },
          {
            "height": [
              5,
              10
            ],
            "bounds": [
              [
                [
                  -190,
                  222
                ],
                [
                  -162,
                  237.5
                ]
              ]
            ]
          }
        ]
      },
      {
        "id": "3rd-floor",
        "name": "3rd Floor",
        "svgLayer": "Third_Floor",
        "extents": [
          {
            "height": [
              15,
              20
            ]
          }
        ]
      },
      {
        "id": "4th-floor",
        "name": "4th Floor",
        "svgLayer": "Fourth_Floor",
        "extents": [
          {
            "height": [
              20,
              25
            ]
          }
        ]
      },
      {
        "id": "5th-floor",
        "name": "5th Floor",
        "svgLayer": "Fifth_Floor",
        "extents": [
          {
            "height": [
              25,
              10000
            ]
          }
        ]
      },
      {
        "id": "underground",
        "name": "Underground",
        "svgLayer": "Underground_Level",
        "extents": [
          {
            "height": [
              -10000,
              -6
            ]
          },
          {
            "height": [
              -10000,
              0
            ],
            "bounds": [
              [
                [
                  -13,
                  -16
                ],
                [
                  28,
                  33
                ]
              ]
            ]
          },
          {
            "height": [
              -10000,
              2
            ],
            "bounds": [
              [
                [
                  151,
                  344
                ],
                [
                  275,
                  418
                ]
              ]
            ]
          }
        ]
      }
    ],
    "labels": [
      {
        "text": "Primorsky Ave.",
        "position": [
          9,
          308
        ],
        "size": 80,
        "rotation": -90
      },
      {
        "text": "Primorsky Ave.",
        "position": [
          9,
          104
        ],
        "size": 80,
        "rotation": -90
      },
      {
        "text": "Primorsky Ave.",
        "position": [
          9,
          -80
        ],
        "size": 80,
        "rotation": -90
      },
      {
        "text": "Kilmov St.",
        "position": [
          125,
          10
        ],
        "size": 80
      },
      {
        "text": "Kilmov St.",
        "position": [
          -104,
          28
        ],
        "size": 80,
        "rotation": 10
      },
      {
        "text": "Nikitskaya St.",
        "position": [
          -125,
          210
        ],
        "size": 80
      },
      {
        "text": "Verhnyaya St.",
        "position": [
          -112,
          361
        ],
        "size": 80
      },
      {
        "text": "Malevecha St.",
        "position": [
          -200,
          290
        ],
        "size": 80,
        "rotation": -64
      },
      {
        "text": "Chekannaya St.",
        "position": [
          111,
          251
        ],
        "size": 80
      },
      {
        "text": "Nizhnyaya St.",
        "position": [
          -101,
          441
        ],
        "size": 80
      },
      {
        "text": "Razvedchikov St.",
        "position": [
          174,
          430
        ],
        "size": 80,
        "rotation": -30
      },
      {
        "text": "Zmejskij Alley",
        "position": [
          140,
          150
        ],
        "size": 80,
        "rotation": -68
      },
      {
        "text": "Kamchatskaya St.",
        "position": [
          232,
          100
        ],
        "size": 80,
        "rotation": -90
      },
      {
        "text": "Kilmov Shopping Mall",
        "position": [
          -128,
          -35
        ],
        "size": 90
      },
      {
        "text": "Beluga",
        "position": [
          -45,
          -52
        ],
        "size": 90
      },
      {
        "text": "Cardinal Apartments",
        "position": [
          99,
          -71
        ],
        "size": 90
      },
      {
        "text": "Construction",
        "position": [
          230,
          295
        ],
        "size": 90
      },
      {
        "text": "Lexos",
        "position": [
          66,
          305
        ],
        "size": 90
      },
      {
        "text": "Sparja Grocery",
        "position": [
          140,
          300
        ],
        "size": 90
      },
      {
        "text": "Cinema",
        "position": [
          -175,
          400
        ],
        "size": 90
      },
      {
        "text": "Shestyorochka",
        "position": [
          -218,
          135
        ],
        "size": 90
      },
      {
        "text": "Pinewood Hotel",
        "position": [
          -35,
          64
        ],
        "size": 90
      },
      {
        "text": "Teppakot / Koener",
        "position": [
          65,
          398
        ],
        "size": 70
      },
      {
        "text": "Concordia",
        "position": [
          140,
          362
        ],
        "size": 70
      },
      {
        "text": "Cardinal Bank",
        "position": [
          89,
          -20
        ],
        "size": 70
      },
      {
        "text": "LERM Expo",
        "position": [
          239,
          -60
        ],
        "size": 70
      },
      {
        "text": "Sparja Express",
        "position": [
          -64,
          166
        ],
        "size": 70
      },
      {
        "text": "Burger Spot",
        "position": [
          -30,
          138
        ],
        "size": 70
      },
      {
        "text": "Post Office",
        "position": [
          42,
          97
        ],
        "size": 70
      },
      {
        "text": "Pharmacy 1",
        "position": [
          42,
          160
        ],
        "size": 70
      },
      {
        "text": "Office",
        "position": [
          -173,
          226
        ],
        "size": 70
      },
      {
        "text": "Corner Restaurant",
        "position": [
          -197,
          340
        ],
        "size": 70
      },
      {
        "text": "Pharmacy 2",
        "position": [
          -43,
          335
        ],
        "size": 70
      },
      {
        "text": "Pharmacy 3",
        "position": [
          90,
          -277
        ],
        "size": 70
      },
      {
        "text": "Tarbank",
        "position": [
          67,
          230
        ],
        "size": 70
      },
      {
        "text": "School",
        "position": [
          211,
          129
        ],
        "size": 70
      },
      {
        "text": "Vet Clinic",
        "position": [
          222,
          173
        ],
        "size": 70
      },
      {
        "text": "Hive",
        "position": [
          -212,
          300
        ],
        "size": 70
      },
      {
        "text": "Family Market",
        "position": [
          -223,
          279
        ],
        "size": 70
      },
      {
        "text": "Marked Hotel",
        "position": [
          -200,
          248
        ],
        "size": 70
      },
      {
        "text": "South Hotel",
        "position": [
          -175,
          297
        ],
        "size": 70
      },
      {
        "text": "Abandon Factory",
        "position": [
          -119,
          287
        ],
        "size": 70
      },
      {
        "text": "Diner",
        "position": [
          -80,
          235
        ],
        "size": 70
      },
      {
        "text": "Primorskij 49",
        "position": [
          -13,
          244
        ],
        "size": 70
      },
      {
        "text": "Prestigio Cafe",
        "position": [
          39,
          230
        ],
        "size": 60,
        "rotation": -45
      },
      {
        "text": "Bilbo Coffee",
        "position": [
          -70,
          343
        ],
        "size": 60
      }
    ],
    "author": "Shebuka",
    "authorLink": "https://github.com/the-hideout/tarkov-dev-svg-maps/"
  },
  {
    "key": "ground-zero",
    "name": "Ground Zero",
    "strategy": "tile",
    "tilePath": "https://assets.tarkov.dev/maps/groundzero/main_summer/{z}/{x}/{y}.png",
    "tileSize": 256,
    "minZoom": 1,
    "maxZoom": 6,
    "transform": [
      0.524,
      167.3,
      0.524,
      65.1
    ],
    "coordinateRotation": 180,
    "bounds": [
      [
        249,
        -124
      ],
      [
        -99,
        364
      ]
    ],
    "heightRange": [
      -1000,
      28
    ],
    "floors": [
      {
        "id": "2nd-floor",
        "name": "2nd Floor",
        "tilePath": "https://assets.tarkov.dev/maps/groundzero/2nd/{z}/{x}/{y}.png",
        "extents": [
          {
            "height": [
              28,
              32.3
            ]
          },
          {
            "height": [
              26,
              31
            ],
            "bounds": [
              [
                [
                  98,
                  216
                ],
                [
                  91,
                  228
                ]
              ]
            ]
          }
        ]
      },
      {
        "id": "3rd-floor",
        "name": "3rd Floor",
        "tilePath": "https://assets.tarkov.dev/maps/groundzero/3rd/{z}/{x}/{y}.png",
        "extents": [
          {
            "height": [
              32.3,
              1000
            ]
          }
        ]
      },
      {
        "id": "garage",
        "name": "Garage",
        "tilePath": "https://assets.tarkov.dev/maps/groundzero/garage/{z}/{x}/{y}.png",
        "extents": [
          {
            "height": [
              -1000,
              21
            ],
            "bounds": [
              [
                [
                  117,
                  -100
                ],
                [
                  43,
                  190
                ]
              ],
              [
                [
                  143,
                  49
                ],
                [
                  117,
                  80
                ]
              ]
            ]
          }
        ]
      }
    ],
    "labels": [
      {
        "text": "TerraGroup",
        "position": [
          -50,
          0
        ]
      },
      {
        "text": "Skyside",
        "position": [
          150,
          1
        ]
      },
      {
        "text": "Fusion",
        "position": [
          141,
          142
        ]
      },
      {
        "text": "Empire",
        "position": [
          14,
          201
        ]
      },
      {
        "text": "Capital Insight",
        "position": [
          115,
          285
        ]
      },
      {
        "text": "Nakatani",
        "position": [
          2,
          324
        ]
      },
      {
        "text": "Elemental Global",
        "position": [
          80,
          -118
        ]
      },
      {
        "text": "Oasis",
        "position": [
          115,
          104
        ],
        "size": 70,
        "top": 30,
        "bottom": 22
      },
      {
        "text": "ASAP Winery",
        "position": [
          115,
          30
        ],
        "size": 70,
        "top": 27,
        "bottom": 22
      },
      {
        "text": "Tarbank",
        "position": [
          43,
          150
        ],
        "size": 70
      },
      {
        "text": "GAGRIN Hotel",
        "position": [
          58,
          234
        ],
        "size": 70
      },
      {
        "text": "M Showroom",
        "position": [
          97,
          223
        ],
        "size": 70
      },
      {
        "text": "Science Office",
        "position": [
          -13,
          48
        ],
        "size": 60,
        "top": 28,
        "bottom": 28
      }
    ],
    "author": "Shebuka",
    "authorLink": "https://github.com/the-hideout/tarkov-dev-svg-maps/",
    "tileGrid": {
      "1": [
        2,
        2
      ],
      "2": [
        4,
        4
      ],
      "3": [
        8,
        8
      ],
      "4": [
        16,
        16
      ],
      "5": [
        32,
        32
      ],
      "6": [
        64,
        64
      ]
    }
  },
  {
    "key": "icebreaker",
    "name": "Icebreaker",
    "strategy": "tile",
    "tilePath": "https://assets.tarkov.dev/maps/icebreaker/06_infirmary/{z}/{x}/{y}.png",
    "tileSize": 256,
    "minZoom": 1,
    "maxZoom": 5,
    "transform": [
      2,
      125,
      3.5,
      91
    ],
    "coordinateRotation": 180,
    "bounds": [
      [
        77,
        -64.5
      ],
      [
        -65.5,
        67.4
      ]
    ],
    "heightRange": [
      18.92,
      19.56
    ],
    "baseFloorName": "Infirmary",
    "floors": [
      {
        "id": "helipad",
        "name": "Helipad",
        "tilePath": "https://assets.tarkov.dev/maps/icebreaker/07_helipad/{z}/{x}/{y}.png",
        "extents": [
          {
            "height": [
              19.57,
              22.1
            ]
          }
        ]
      },
      {
        "id": "gym-canteen",
        "name": "Gym/Canteen",
        "tilePath": "https://assets.tarkov.dev/maps/icebreaker/08_gym-canteen/{z}/{x}/{y}.png",
        "extents": [
          {
            "height": [
              22.2,
              25.2
            ]
          }
        ]
      },
      {
        "id": "accommodation-lower",
        "name": "Accommodation (lower)",
        "tilePath": "https://assets.tarkov.dev/maps/icebreaker/09_accommodation_lower/{z}/{x}/{y}.png",
        "extents": [
          {
            "height": [
              25.3,
              28.2
            ]
          }
        ]
      },
      {
        "id": "accommodation-mid",
        "name": "Accommodation (mid)",
        "tilePath": "https://assets.tarkov.dev/maps/icebreaker/10_accommodation_mid/{z}/{x}/{y}.png",
        "extents": [
          {
            "height": [
              28.3,
              31.3
            ]
          }
        ]
      },
      {
        "id": "accommodation-upper",
        "name": "Accommodation (upper)",
        "tilePath": "https://assets.tarkov.dev/maps/icebreaker/11_accommodation_upper/{z}/{x}/{y}.png",
        "extents": [
          {
            "height": [
              31.4,
              34.4
            ]
          }
        ]
      },
      {
        "id": "officers-deck",
        "name": "Officers' Deck",
        "tilePath": "https://assets.tarkov.dev/maps/icebreaker/12_officers_deck/{z}/{x}/{y}.png",
        "extents": [
          {
            "height": [
              34.5,
              37.5
            ]
          }
        ]
      },
      {
        "id": "stairs-blocked",
        "name": "Stairs (blocked)",
        "tilePath": "https://assets.tarkov.dev/maps/icebreaker/13_stairs_blocked/{z}/{x}/{y}.png",
        "extents": [
          {
            "height": [
              37.6,
              40.6
            ]
          }
        ]
      },
      {
        "id": "bridge",
        "name": "Bridge",
        "tilePath": "https://assets.tarkov.dev/maps/icebreaker/14_bridge/{z}/{x}/{y}.png",
        "extents": [
          {
            "height": [
              40.7,
              43.7
            ]
          }
        ]
      },
      {
        "id": "bridge-roof",
        "name": "Bridge Roof",
        "tilePath": "https://assets.tarkov.dev/maps/icebreaker/15_bridge_roof/{z}/{x}/{y}.png",
        "extents": [
          {
            "height": [
              43.8,
              10000
            ]
          }
        ]
      },
      {
        "id": "control-room",
        "name": "Control Room",
        "tilePath": "https://assets.tarkov.dev/maps/icebreaker/00_control_room/{z}/{x}/{y}.png",
        "extents": [
          {
            "height": [
              -10000,
              3.5
            ]
          }
        ]
      },
      {
        "id": "engine-room",
        "name": "Engine Room",
        "tilePath": "https://assets.tarkov.dev/maps/icebreaker/01_engine_room/{z}/{x}/{y}.png",
        "extents": [
          {
            "height": [
              3.6,
              5.6
            ]
          }
        ]
      },
      {
        "id": "engine-room-upper",
        "name": "Engine Room (upper)",
        "tilePath": "https://assets.tarkov.dev/maps/icebreaker/02_engine_room_upper/{z}/{x}/{y}.png",
        "extents": [
          {
            "height": [
              5.7,
              8.7
            ]
          }
        ]
      },
      {
        "id": "fuel-pumps-lower",
        "name": "Fuel Pumps (lower)",
        "tilePath": "https://assets.tarkov.dev/maps/icebreaker/03_fuel_pumps_lower/{z}/{x}/{y}.png",
        "extents": [
          {
            "height": [
              8.8,
              11.8
            ]
          }
        ]
      },
      {
        "id": "fuel-pumps",
        "name": "Fuel Pumps",
        "tilePath": "https://assets.tarkov.dev/maps/icebreaker/04_fuel_pumps/{z}/{x}/{y}.png",
        "extents": [
          {
            "height": [
              11.9,
              14.9
            ]
          }
        ]
      },
      {
        "id": "storage-security",
        "name": "Storage/Security",
        "tilePath": "https://assets.tarkov.dev/maps/icebreaker/05_storage_ecurity/{z}/{x}/{y}.png",
        "extents": [
          {
            "height": [
              15,
              18.93
            ]
          }
        ]
      }
    ],
    "author": "TarkovBOT.eu",
    "authorLink": "https://tarkovbot.eu/",
    "tileGrid": {
      "1": [
        2,
        2
      ],
      "2": [
        4,
        4
      ],
      "3": [
        8,
        8
      ],
      "4": [
        16,
        16
      ],
      "5": [
        32,
        32
      ]
    }
  },
  {
    "key": "customs",
    "name": "Customs",
    "strategy": "tile",
    "tilePath": "https://assets.tarkov.dev/maps/customs_0.16/main/{z}/{x}/{y}.png",
    "tileSize": 256,
    "minZoom": 2,
    "maxZoom": 6,
    "transform": [
      0.239,
      168.65,
      0.239,
      136.35
    ],
    "coordinateRotation": 180,
    "bounds": [
      [
        698,
        -307
      ],
      [
        -372,
        237
      ]
    ],
    "heightRange": [
      -1000,
      1000
    ],
    "floors": [
      {
        "id": "2nd-floor",
        "name": "2nd Floor",
        "tilePath": "https://assets.tarkov.dev/maps/customs_0.16/2nd/{z}/{x}/{y}.png",
        "extents": [
          {
            "height": [
              2.7,
              6.5
            ],
            "bounds": [
              [
                [
                  243,
                  190
                ],
                [
                  165,
                  125
                ]
              ],
              [
                [
                  116,
                  -83
                ],
                [
                  72,
                  -170
                ]
              ],
              [
                [
                  356,
                  -30
                ],
                [
                  341,
                  -84
                ]
              ],
              [
                [
                  334,
                  -52
                ],
                [
                  321,
                  -59
                ]
              ],
              [
                [
                  589,
                  10
                ],
                [
                  577,
                  -1
                ]
              ],
              [
                [
                  580,
                  -104
                ],
                [
                  532,
                  -134
                ]
              ],
              [
                [
                  625,
                  -120
                ],
                [
                  599,
                  -139
                ]
              ]
            ]
          },
          {
            "height": [
              5.7,
              1000
            ],
            "bounds": [
              [
                [
                  580,
                  -104
                ],
                [
                  532,
                  -134
                ]
              ],
              [
                [
                  -199,
                  -90
                ],
                [
                  -223,
                  -131
                ]
              ],
              [
                [
                  239,
                  3
                ],
                [
                  169,
                  -160
                ]
              ],
              [
                [
                  336,
                  -56
                ],
                [
                  316,
                  -95
                ]
              ],
              [
                [
                  584,
                  -46
                ],
                [
                  556,
                  -92
                ]
              ],
              [
                [
                  93,
                  0
                ],
                [
                  65,
                  -22
                ]
              ]
            ]
          },
          {
            "height": [
              14,
              15
            ],
            "bounds": [
              [
                [
                  497,
                  -44
                ],
                [
                  450,
                  -90
                ]
              ]
            ]
          },
          {
            "height": [
              3.9,
              7.6
            ],
            "bounds": [
              [
                [
                  73,
                  57
                ],
                [
                  22,
                  -38
                ]
              ]
            ]
          },
          {
            "height": [
              4.4,
              6.5
            ],
            "bounds": [
              [
                [
                  119,
                  -57
                ],
                [
                  100,
                  -42
                ]
              ]
            ]
          },
          {
            "height": [
              4.6,
              7.9
            ],
            "bounds": [
              [
                [
                  279,
                  -79
                ],
                [
                  246,
                  -1.4
                ]
              ]
            ]
          }
        ]
      },
      {
        "id": "3rd-floor",
        "name": "3rd Floor",
        "tilePath": "https://assets.tarkov.dev/maps/customs_0.16/3rd/{z}/{x}/{y}.png",
        "extents": [
          {
            "height": [
              5.7,
              1000
            ],
            "bounds": [
              [
                [
                  243,
                  190
                ],
                [
                  165,
                  125
                ]
              ]
            ]
          },
          {
            "height": [
              7.7,
              11.3
            ],
            "bounds": [
              [
                [
                  73,
                  -73
                ],
                [
                  22,
                  -38
                ]
              ]
            ]
          },
          {
            "height": [
              6.7,
              11.6
            ],
            "bounds": [
              [
                [
                  126,
                  -64
                ],
                [
                  88,
                  -35
                ]
              ]
            ]
          },
          {
            "height": [
              8,
              11.1
            ],
            "bounds": [
              [
                [
                  279,
                  -79
                ],
                [
                  246,
                  -1.4
                ]
              ]
            ]
          }
        ]
      },
      {
        "id": "4th-floor",
        "name": "4th Floor",
        "tilePath": "https://assets.tarkov.dev/maps/customs_0.16/4th/{z}/{x}/{y}.png",
        "extents": [
          {
            "height": [
              11.2,
              54.7
            ],
            "bounds": [
              [
                [
                  279,
                  -79
                ],
                [
                  246,
                  -1.4
                ]
              ]
            ]
          }
        ]
      },
      {
        "id": "underground",
        "name": "Underground",
        "tilePath": "https://assets.tarkov.dev/maps/customs_0.16/underground/{z}/{x}/{y}.png",
        "extents": [
          {
            "height": [
              -1000,
              0.5
            ],
            "bounds": [
              [
                [
                  635,
                  -137
                ],
                [
                  620,
                  -125
                ]
              ],
              [
                [
                  473,
                  -122
                ],
                [
                  458,
                  -110
                ]
              ],
              [
                [
                  314,
                  -173
                ],
                [
                  308,
                  -184
                ]
              ],
              [
                [
                  349,
                  -88
                ],
                [
                  323,
                  -32
                ]
              ],
              [
                [
                  219,
                  -158
                ],
                [
                  193,
                  -137
                ]
              ],
              [
                [
                  122,
                  -61
                ],
                [
                  88,
                  -40
                ]
              ]
            ]
          }
        ]
      }
    ],
    "labels": [
      {
        "text": "Big Red",
        "position": [
          -215,
          -119
        ]
      },
      {
        "text": "Dorms",
        "position": [
          200,
          150
        ]
      },
      {
        "text": "New Gas",
        "position": [
          404,
          31
        ]
      },
      {
        "text": "Old Gas",
        "position": [
          331,
          -173
        ]
      },
      {
        "text": "Fortress",
        "position": [
          201,
          -127
        ]
      },
      {
        "text": "Crackhouse",
        "position": [
          83,
          -153
        ]
      },
      {
        "text": "Streamer House",
        "position": [
          567,
          -67
        ],
        "size": 90
      },
      {
        "text": "Main Bridge",
        "position": [
          -69,
          9
        ],
        "size": 90
      },
      {
        "text": "Sniper Hill",
        "position": [
          110,
          85
        ],
        "size": 90
      },
      {
        "text": "Storage",
        "position": [
          -288,
          -134
        ],
        "size": 90
      },
      {
        "text": "Trailer Park",
        "position": [
          -211,
          -219
        ],
        "size": 90
      },
      {
        "text": "Junk Bridge",
        "position": [
          -66,
          46
        ],
        "size": 90
      },
      {
        "text": "Repair Shop",
        "position": [
          106,
          -90
        ],
        "size": 90
      },
      {
        "text": "Sniper Ridge",
        "position": [
          491,
          63
        ]
      },
      {
        "text": "Old Construction",
        "position": [
          75,
          -9
        ],
        "size": 90
      },
      {
        "text": "Skeleton",
        "position": [
          200,
          -13
        ]
      },
      {
        "text": "Warehouse 3",
        "position": [
          390,
          -94
        ]
      },
      {
        "text": "Depot",
        "position": [
          472,
          -67
        ]
      },
      {
        "text": "Warehouse 7",
        "position": [
          555,
          -118
        ]
      },
      {
        "text": "Military Checkpoint",
        "position": [
          572,
          0
        ]
      },
      {
        "text": "Bus Station",
        "position": [
          238,
          53
        ],
        "size": 90
      },
      {
        "text": "Warehouse 4",
        "position": [
          333,
          -67
        ]
      },
      {
        "text": "Powerline Tower",
        "position": [
          497,
          110
        ]
      },
      {
        "text": "Warehouse 17",
        "position": [
          46,
          -59
        ],
        "size": 90
      }
    ],
    "author": "Shebuka",
    "authorLink": "https://github.com/the-hideout/tarkov-dev-svg-maps/",
    "tileGrid": {
      "2": [
        4,
        4
      ],
      "3": [
        8,
        8
      ],
      "4": [
        16,
        16
      ],
      "5": [
        32,
        32
      ],
      "6": [
        64,
        64
      ]
    }
  },
  {
    "key": "factory",
    "name": "Factory",
    "strategy": "tile",
    "tilePath": "https://assets.tarkov.dev/maps/factory/main/{z}/{x}/{y}.png",
    "tileSize": 256,
    "minZoom": 1,
    "maxZoom": 6,
    "transform": [
      1.629,
      119.9,
      1.629,
      139.3
    ],
    "coordinateRotation": 90,
    "bounds": [
      [
        77,
        -64.5
      ],
      [
        -65.5,
        67.4
      ]
    ],
    "heightRange": [
      -1,
      3
    ],
    "floors": [
      {
        "id": "2nd-floor",
        "name": "2nd Floor",
        "tilePath": "https://assets.tarkov.dev/maps/factory/2nd/{z}/{x}/{y}.png",
        "extents": [
          {
            "height": [
              3,
              6
            ]
          }
        ]
      },
      {
        "id": "3rd-floor",
        "name": "3rd Floor",
        "tilePath": "https://assets.tarkov.dev/maps/factory/3rd/{z}/{x}/{y}.png",
        "extents": [
          {
            "height": [
              6,
              10000
            ]
          }
        ]
      },
      {
        "id": "tunnels",
        "name": "Tunnels",
        "tilePath": "https://assets.tarkov.dev/maps/factory/tunnels/{z}/{x}/{y}.png",
        "extents": [
          {
            "height": [
              -10000,
              -1
            ]
          }
        ]
      }
    ],
    "labels": [
      {
        "text": "Office Building",
        "position": [
          21,
          39
        ],
        "size": 80,
        "top": 10000,
        "bottom": -1
      },
      {
        "text": "Main Office",
        "position": [
          15.5,
          39
        ],
        "size": 80,
        "top": 10000,
        "bottom": 6
      },
      {
        "text": "Breach Room",
        "position": [
          24.5,
          39
        ],
        "size": 80,
        "top": 10000,
        "bottom": 6
      },
      {
        "text": "Locked Office",
        "position": [
          30.5,
          39
        ],
        "size": 80,
        "top": 10000,
        "bottom": 6
      },
      {
        "text": "North Stairs",
        "position": [
          35,
          39
        ],
        "size": 80,
        "top": 10000,
        "bottom": -1
      },
      {
        "text": "South Stairs",
        "position": [
          9,
          39
        ],
        "size": 80,
        "top": 10000,
        "bottom": -1
      },
      {
        "text": "Sky Bridge",
        "position": [
          34,
          26
        ],
        "size": 80,
        "top": 10000,
        "bottom": 6
      },
      {
        "text": "Connector",
        "position": [
          29.5,
          17
        ],
        "size": 80,
        "top": 10000,
        "bottom": -1
      },
      {
        "text": "Locker Rooms",
        "position": [
          29,
          41
        ],
        "size": 80,
        "top": 5,
        "bottom": 3
      },
      {
        "text": "Sinks",
        "position": [
          15,
          41
        ],
        "size": 80,
        "top": 5,
        "bottom": 3
      },
      {
        "text": "Hole",
        "position": [
          20,
          42
        ],
        "size": 80,
        "top": 5,
        "bottom": 3
      },
      {
        "text": "Platform",
        "position": [
          -3,
          37
        ],
        "size": 80,
        "top": 5,
        "bottom": -1
      },
      {
        "text": "Servers",
        "position": [
          -21,
          27
        ],
        "size": 80,
        "top": 5,
        "bottom": 3
      },
      {
        "text": "Med Tent",
        "position": [
          -18,
          -29
        ],
        "size": 80,
        "top": 2,
        "bottom": -1
      },
      {
        "text": "Silos",
        "position": [
          4.5,
          10.5
        ],
        "top": 2,
        "bottom": -1
      },
      {
        "text": "Heli Crash",
        "position": [
          30,
          -8.5
        ],
        "size": 80,
        "top": 10000,
        "bottom": -1
      },
      {
        "text": "Pit",
        "position": [
          -1,
          16
        ],
        "size": 80,
        "top": -2,
        "bottom": -10000
      },
      {
        "text": "Underground Stash",
        "position": [
          -2,
          -24.5
        ],
        "size": 80,
        "top": -2,
        "bottom": -10000
      },
      {
        "text": "Scav Bunker",
        "position": [
          -20.5,
          23
        ],
        "size": 80,
        "top": 2,
        "bottom": -1
      },
      {
        "text": "Blue Containers",
        "position": [
          -18,
          50
        ],
        "top": 2,
        "bottom": -1
      },
      {
        "text": "Wood Room",
        "position": [
          -45.5,
          61
        ],
        "size": 80,
        "top": 2,
        "bottom": -1
      },
      {
        "text": "Glass Hall",
        "position": [
          68.25,
          -20
        ],
        "size": 80,
        "top": 2,
        "bottom": -1
      },
      {
        "text": "Boilers",
        "position": [
          56,
          5
        ],
        "size": 80,
        "top": 5,
        "bottom": -1
      },
      {
        "text": "Pumping Station",
        "position": [
          41,
          -11
        ],
        "size": 80,
        "top": 5,
        "bottom": -1
      },
      {
        "text": "East Halls",
        "position": [
          44,
          -36
        ],
        "size": 80,
        "top": 2,
        "bottom": -1
      },
      {
        "text": "Forklifts",
        "position": [
          66,
          -42
        ],
        "size": 80,
        "top": 2,
        "bottom": -1
      },
      {
        "text": "Rafters",
        "position": [
          18,
          4
        ],
        "top": 10000,
        "bottom": 6
      }
    ],
    "author": "Shebuka",
    "authorLink": "https://github.com/the-hideout/tarkov-dev-svg-maps/",
    "tileGrid": {
      "1": [
        2,
        2
      ],
      "2": [
        4,
        4
      ],
      "3": [
        8,
        8
      ],
      "4": [
        16,
        16
      ],
      "5": [
        32,
        32
      ],
      "6": [
        64,
        64
      ]
    }
  },
  {
    "key": "interchange",
    "name": "Interchange",
    "strategy": "svg",
    "svgPath": "https://assets.tarkov.dev/maps/svg/Interchange.svg",
    "svgLayer": "Ground_Level",
    "tileSize": 256,
    "minZoom": 1,
    "maxZoom": 6,
    "transform": [
      0.265,
      150.6,
      0.265,
      134.6
    ],
    "coordinateRotation": 180,
    "bounds": [
      [
        598,
        -442
      ],
      [
        -433,
        426
      ]
    ],
    "heightRange": [
      -1000,
      25
    ],
    "floors": [
      {
        "id": "2nd-floor",
        "name": "2nd Floor",
        "svgLayer": "First_Floor",
        "show": true,
        "extents": [
          {
            "height": [
              25,
              34
            ],
            "bounds": [
              [
                [
                  120,
                  218
                ],
                [
                  -222,
                  -327
                ]
              ]
            ]
          }
        ]
      },
      {
        "id": "3rd-floor",
        "name": "3rd Floor",
        "svgLayer": "Second_Floor",
        "extents": [
          {
            "height": [
              34,
              1000
            ],
            "bounds": [
              [
                [
                  120,
                  218
                ],
                [
                  -222,
                  -327
                ]
              ]
            ]
          }
        ]
      }
    ],
    "labels": [
      {
        "text": "Power Station",
        "position": [
          -186.4,
          -318.7
        ],
        "size": 100,
        "top": 10,
        "bottom": -1
      },
      {
        "text": "Go Kart",
        "position": [
          155,
          -253
        ],
        "size": 80,
        "top": 10,
        "bottom": -1
      },
      {
        "text": "Four Camp",
        "position": [
          158,
          -78.5
        ],
        "size": 80,
        "top": 10,
        "bottom": -1
      },
      {
        "text": "Cargo Containers",
        "position": [
          68.2,
          312.9
        ],
        "size": 80,
        "top": 10,
        "bottom": -1
      },
      {
        "text": "Wall Break",
        "position": [
          -260.2,
          123.8
        ],
        "size": 80,
        "top": 10,
        "bottom": -1
      },
      {
        "text": "Ramps",
        "position": [
          -175.5,
          145.1
        ],
        "size": 80,
        "top": 10,
        "bottom": -1
      },
      {
        "text": "Oli Tower",
        "position": [
          202.3,
          219.4
        ],
        "size": 80,
        "top": 10,
        "bottom": -1
      },
      {
        "text": "Idea Tower",
        "position": [
          46.5,
          -358.5
        ],
        "size": 80,
        "top": 10,
        "bottom": -1
      },
      {
        "text": "Scav Camp",
        "position": [
          263.2,
          -11.1
        ],
        "size": 80,
        "top": 10,
        "bottom": -1
      },
      {
        "text": "Highway Construction",
        "position": [
          373.5,
          -391.2
        ],
        "top": 10,
        "bottom": -1
      },
      {
        "text": "Garage A",
        "position": [
          33,
          -222
        ],
        "size": 80,
        "top": 24,
        "bottom": -1000
      },
      {
        "text": "Garage B",
        "position": [
          47,
          -112
        ],
        "size": 80,
        "top": 24,
        "bottom": -1000
      },
      {
        "text": "Garage C",
        "position": [
          0,
          47
        ],
        "size": 80,
        "top": 24,
        "bottom": -1000
      },
      {
        "text": "Garage D",
        "position": [
          20,
          138
        ],
        "size": 80,
        "top": 24,
        "bottom": -1000
      },
      {
        "text": "IDEA",
        "position": [
          -34,
          -235
        ],
        "size": 80,
        "top": 33,
        "bottom": 25
      },
      {
        "text": "Goshan",
        "position": [
          -115,
          -45
        ],
        "size": 80,
        "top": 33,
        "bottom": 25
      },
      {
        "text": "OLI",
        "position": [
          -28,
          140
        ],
        "size": 80,
        "top": 33,
        "bottom": 25
      },
      {
        "text": "Nortex",
        "position": [
          87,
          -165
        ],
        "size": 65,
        "top": 33,
        "bottom": 25
      },
      {
        "text": "TRend",
        "position": [
          60,
          -152
        ],
        "size": 65,
        "top": 33,
        "bottom": 25
      },
      {
        "text": "Mode7",
        "position": [
          69.5,
          -134
        ],
        "size": 65,
        "top": 33,
        "bottom": 25
      },
      {
        "text": "TTS",
        "position": [
          19,
          -129
        ],
        "size": 65,
        "top": 33,
        "bottom": 25
      },
      {
        "text": "Book Store",
        "position": [
          -38,
          -129
        ],
        "size": 65,
        "top": 33,
        "bottom": 25
      },
      {
        "text": "Dino Clothes",
        "position": [
          91,
          -119
        ],
        "size": 65,
        "top": 33,
        "bottom": 25
      },
      {
        "text": "EMERCOM",
        "position": [
          18,
          -103
        ],
        "size": 65,
        "top": 33,
        "bottom": 25
      },
      {
        "text": "Kostin",
        "position": [
          -28,
          -103
        ],
        "size": 65,
        "top": 33,
        "bottom": 25
      },
      {
        "text": "Bizarro",
        "position": [
          -65,
          -103
        ],
        "size": 65,
        "top": 33,
        "bottom": 25
      },
      {
        "text": "Spiel",
        "position": [
          92,
          -87
        ],
        "size": 65,
        "top": 33,
        "bottom": 25
      },
      {
        "text": "Voyage",
        "position": [
          -18,
          -87
        ],
        "size": 65,
        "top": 33,
        "bottom": 25
      },
      {
        "text": "Viking",
        "position": [
          57,
          -66
        ],
        "size": 65,
        "top": 33,
        "bottom": 25
      },
      {
        "text": "Mantis",
        "position": [
          13,
          -66
        ],
        "size": 65,
        "top": 33,
        "bottom": 25
      },
      {
        "text": "German",
        "position": [
          -18,
          -72
        ],
        "size": 65,
        "top": 33,
        "bottom": 25
      },
      {
        "text": "The National",
        "position": [
          57,
          -32
        ],
        "size": 65,
        "top": 33,
        "bottom": 25
      },
      {
        "text": "Brutal",
        "position": [
          13,
          -32
        ],
        "size": 65,
        "top": 33,
        "bottom": 25
      },
      {
        "text": "Kiba",
        "position": [
          -18,
          -25
        ],
        "size": 65,
        "top": 33,
        "bottom": 25
      },
      {
        "text": "Pretty Lights",
        "position": [
          -34,
          -20
        ],
        "size": 65,
        "top": 33,
        "bottom": 25
      },
      {
        "text": "Telespot",
        "position": [
          92,
          -18
        ],
        "size": 65,
        "top": 33,
        "bottom": 25
      },
      {
        "text": "Revis",
        "position": [
          62,
          -12
        ],
        "size": 65,
        "top": 33,
        "bottom": 25
      },
      {
        "text": "ADIK",
        "position": [
          19,
          -6
        ],
        "size": 65,
        "top": 33,
        "bottom": 25
      },
      {
        "text": "Generic",
        "position": [
          -28,
          0.5
        ],
        "size": 65,
        "top": 33,
        "bottom": 25
      },
      {
        "text": "Top Brand",
        "position": [
          92,
          15
        ],
        "size": 65,
        "top": 33,
        "bottom": 25
      },
      {
        "text": "Sports",
        "position": [
          61,
          15
        ],
        "size": 65,
        "top": 33,
        "bottom": 25
      },
      {
        "text": "Yushka",
        "position": [
          70,
          32
        ],
        "size": 65,
        "top": 33,
        "bottom": 25
      },
      {
        "text": "Rasmussen",
        "position": [
          19.5,
          26
        ],
        "size": 65,
        "top": 33,
        "bottom": 25
      },
      {
        "text": "Avokado",
        "position": [
          -37,
          26
        ],
        "size": 65,
        "top": 33,
        "bottom": 25
      },
      {
        "text": "Boots 4 Life",
        "position": [
          91,
          55
        ],
        "size": 65,
        "top": 33,
        "bottom": 25
      },
      {
        "text": "Texho",
        "position": [
          61,
          50
        ],
        "size": 65,
        "top": 33,
        "bottom": 25
      },
      {
        "text": "Dom",
        "position": [
          6,
          49
        ],
        "size": 65,
        "top": 33,
        "bottom": 25
      },
      {
        "text": "Father & Sons",
        "position": [
          38,
          -170
        ],
        "size": 65,
        "top": 999,
        "bottom": 34
      },
      {
        "text": "Tarkovstar",
        "position": [
          69,
          -150
        ],
        "size": 65,
        "top": 999,
        "bottom": 34
      },
      {
        "text": "Eastland",
        "position": [
          26,
          -149
        ],
        "size": 65,
        "top": 999,
        "bottom": 34
      },
      {
        "text": "Arena",
        "position": [
          71,
          -130
        ],
        "size": 65,
        "top": 999,
        "bottom": 34
      },
      {
        "text": "ТАРЗДРАВ",
        "position": [
          54,
          -128
        ],
        "size": 65,
        "top": 999,
        "bottom": 34
      },
      {
        "text": "МЕБЕЛЬ МК",
        "position": [
          20,
          -128
        ],
        "size": 65,
        "top": 999,
        "bottom": 34
      },
      {
        "text": "Intourist",
        "position": [
          69,
          -116
        ],
        "size": 65,
        "top": 999,
        "bottom": 34
      },
      {
        "text": "Burger Spot",
        "position": [
          -27,
          -103
        ],
        "size": 65,
        "top": 999,
        "bottom": 34
      },
      {
        "text": "FCK",
        "position": [
          70,
          -94
        ],
        "size": 65,
        "top": 999,
        "bottom": 34
      },
      {
        "text": "McDaniels",
        "position": [
          70,
          -87
        ],
        "size": 65,
        "top": 999,
        "bottom": 34
      },
      {
        "text": "Tarducks",
        "position": [
          64,
          -69
        ],
        "size": 65,
        "top": 999,
        "bottom": 34
      },
      {
        "text": "Coffee Joy",
        "position": [
          43,
          -69
        ],
        "size": 65,
        "top": 999,
        "bottom": 34
      },
      {
        "text": "Jacob & Jacob",
        "position": [
          15,
          -74
        ],
        "size": 65,
        "top": 999,
        "bottom": 34
      },
      {
        "text": "ПУШКИН",
        "position": [
          -34,
          -79
        ],
        "size": 65,
        "top": 999,
        "bottom": 34
      },
      {
        "text": "Sushi Huyushi",
        "position": [
          64,
          -34
        ],
        "size": 65,
        "top": 999,
        "bottom": 34
      },
      {
        "text": "Underway",
        "position": [
          -17,
          -32
        ],
        "size": 65,
        "top": 999,
        "bottom": 34
      },
      {
        "text": "Burger House",
        "position": [
          67,
          -23.5
        ],
        "size": 65,
        "top": 999,
        "bottom": 34
      },
      {
        "text": "Philly Cute",
        "position": [
          -34,
          -24
        ],
        "size": 65,
        "top": 999,
        "bottom": 34
      },
      {
        "text": "Shiccos",
        "position": [
          67,
          -16
        ],
        "size": 65,
        "top": 999,
        "bottom": 34
      },
      {
        "text": "МУЗЕЙ ИСТОРИИ",
        "position": [
          17,
          0
        ],
        "size": 65,
        "top": 999,
        "bottom": 34
      },
      {
        "text": "Papillon",
        "position": [
          92,
          17
        ],
        "size": 65,
        "top": 999,
        "bottom": 34
      },
      {
        "text": "ЗАКРЫТО НА РЕМОНТ",
        "position": [
          58,
          13
        ],
        "size": 60,
        "top": 999,
        "bottom": 34
      },
      {
        "text": "НА-СВЯЗИ",
        "position": [
          70,
          27
        ],
        "size": 65,
        "top": 999,
        "bottom": 34
      },
      {
        "text": "СКОРО ОТКРЫТИЕ",
        "position": [
          54,
          24
        ],
        "size": 65,
        "top": 999,
        "bottom": 34
      },
      {
        "text": "Figaro",
        "position": [
          19,
          26
        ],
        "size": 65,
        "top": 999,
        "bottom": 34
      },
      {
        "text": "АПТЕКА",
        "position": [
          71,
          47
        ],
        "size": 65,
        "top": 999,
        "bottom": 34
      },
      {
        "text": "SARA",
        "position": [
          53,
          47
        ],
        "size": 65,
        "top": 999,
        "bottom": 34
      },
      {
        "text": "Urban Clothes",
        "position": [
          26,
          46
        ],
        "size": 65,
        "top": 999,
        "bottom": 34
      },
      {
        "text": "TECHLIGHT",
        "position": [
          91,
          54
        ],
        "size": 65,
        "top": 999,
        "bottom": 34
      },
      {
        "text": "Fashion Store",
        "position": [
          39,
          67
        ],
        "size": 65,
        "top": 999,
        "bottom": 34
      }
    ],
    "author": "Shebuka",
    "authorLink": "https://github.com/the-hideout/tarkov-dev-svg-maps/"
  },
  {
    "key": "the-lab",
    "name": "The Lab",
    "strategy": "tile",
    "tilePath": "https://assets.tarkov.dev/maps/labs_v4/1st/{z}/{x}/{y}.png",
    "tileSize": 175,
    "minZoom": 2,
    "maxZoom": 6,
    "transform": [
      0.575,
      281.2,
      0.575,
      193.7
    ],
    "coordinateRotation": 270,
    "bounds": [
      [
        -80,
        -477
      ],
      [
        -287,
        -193
      ]
    ],
    "heightRange": [
      -0.9,
      3
    ],
    "baseFloorName": "1st Floor",
    "floors": [
      {
        "id": "second-level",
        "name": "2nd Floor",
        "tilePath": "https://assets.tarkov.dev/maps/labs_v4/2nd/{z}/{x}/{y}.png",
        "extents": [
          {
            "height": [
              3,
              10000
            ],
            "bounds": [
              [
                [
                  -101,
                  -422
                ],
                [
                  -271,
                  -270
                ]
              ]
            ]
          }
        ]
      },
      {
        "id": "technical",
        "name": "Technical",
        "tilePath": "https://assets.tarkov.dev/maps/labs_v4/technical/{z}/{x}/{y}.png",
        "extents": [
          {
            "height": [
              -10000,
              -0.9
            ]
          }
        ]
      }
    ],
    "labels": [
      {
        "text": "Parking",
        "position": [
          -230,
          -400
        ],
        "size": 90,
        "top": 2,
        "bottom": -0.8
      },
      {
        "text": "Vestibules #1",
        "position": [
          -246,
          -379
        ],
        "size": 90,
        "top": 2,
        "bottom": -0.8
      },
      {
        "text": "Vestibules #2",
        "position": [
          -216,
          -379
        ],
        "size": 90,
        "top": 2,
        "bottom": -0.8
      },
      {
        "text": "Main Working Area",
        "position": [
          -172,
          -342
        ],
        "size": 90,
        "top": 2,
        "bottom": -0.8
      },
      {
        "text": "Negotiation Room",
        "position": [
          -148,
          -398
        ],
        "size": 90,
        "top": 2,
        "bottom": -0.8
      },
      {
        "text": "Infirmary Lvl 1",
        "position": [
          -130,
          -398
        ],
        "size": 90,
        "top": 2,
        "bottom": -0.8
      },
      {
        "text": "Test Room",
        "position": [
          -130,
          -356
        ],
        "size": 90,
        "top": 2,
        "bottom": -0.8
      },
      {
        "text": "Server Room",
        "position": [
          -125,
          -308
        ],
        "size": 90,
        "top": 2,
        "bottom": -0.8
      },
      {
        "text": "Warehouse Tunnels",
        "position": [
          -116,
          -266
        ],
        "size": 90,
        "top": 2,
        "bottom": -0.8
      },
      {
        "text": "Warehouse",
        "position": [
          -163,
          -269
        ],
        "size": 90,
        "top": 2,
        "bottom": -0.8
      },
      {
        "text": "Warehouse Gate",
        "position": [
          -170,
          -248
        ],
        "size": 90,
        "top": 2,
        "bottom": -0.8
      },
      {
        "text": "Lecture Hall",
        "position": [
          -207,
          -305
        ],
        "size": 90,
        "top": 2,
        "bottom": -0.8
      },
      {
        "text": "Recreation Area",
        "position": [
          -221,
          -343
        ],
        "size": 90,
        "top": 2,
        "bottom": -0.8
      },
      {
        "text": "Gym",
        "position": [
          -236,
          -302
        ],
        "size": 90,
        "top": 2,
        "bottom": -0.8
      },
      {
        "text": "Men's Locker Room",
        "position": [
          -241,
          -280
        ],
        "size": 90,
        "top": 2,
        "bottom": -0.8
      },
      {
        "text": "Women's Locker Room",
        "position": [
          -232,
          -280
        ],
        "size": 90,
        "top": 2,
        "bottom": -0.8
      },
      {
        "text": "Boiler Room",
        "position": [
          -259,
          -366
        ],
        "size": 90,
        "top": 2,
        "bottom": -1000
      },
      {
        "text": "Security Barracks",
        "position": [
          -260,
          -319
        ],
        "size": 90,
        "top": 2,
        "bottom": -0.8
      },
      {
        "text": "Reception",
        "position": [
          -260,
          -342
        ],
        "size": 90,
        "top": 2,
        "bottom": -0.8
      },
      {
        "text": "Administrative Office",
        "position": [
          -260,
          -364
        ],
        "size": 90,
        "top": 1000,
        "bottom": 3
      },
      {
        "text": "Security Office",
        "position": [
          -254,
          -320
        ],
        "size": 90,
        "top": 1000,
        "bottom": 3
      },
      {
        "text": "Security #1",
        "position": [
          -244,
          -378
        ],
        "size": 90,
        "top": 1000,
        "bottom": 3
      },
      {
        "text": "Security #2",
        "position": [
          -215,
          -379
        ],
        "size": 90,
        "top": 1000,
        "bottom": 3
      },
      {
        "text": "Conference Room",
        "position": [
          -229,
          -343
        ],
        "size": 90,
        "top": 1000,
        "bottom": 3
      },
      {
        "text": "Cafeteria",
        "position": [
          -219,
          -302
        ],
        "size": 90,
        "top": 1000,
        "bottom": 3
      },
      {
        "text": "Offices #1",
        "position": [
          -189,
          -401
        ],
        "size": 90,
        "top": 1000,
        "bottom": 3
      },
      {
        "text": "Offices #2",
        "position": [
          -149,
          -401
        ],
        "size": 90,
        "top": 1000,
        "bottom": 3
      },
      {
        "text": "Infirmary Lvl 2",
        "position": [
          -130,
          -401
        ],
        "size": 90,
        "top": 1000,
        "bottom": 3
      },
      {
        "text": "Sterile Laboratory",
        "position": [
          -130,
          -361
        ],
        "size": 90,
        "top": 1000,
        "bottom": 3
      },
      {
        "text": "Control Room",
        "position": [
          -169,
          -288
        ],
        "size": 90,
        "top": 1000,
        "bottom": 3
      },
      {
        "text": "Corridor To Building #2",
        "position": [
          -250,
          -281
        ],
        "size": 90,
        "top": 1000,
        "bottom": 3
      }
    ],
    "author": "Tarkov.dev",
    "authorLink": "https://tarkov.dev",
    "tileGrid": {
      "2": [
        4,
        4
      ],
      "3": [
        8,
        8
      ],
      "4": [
        16,
        16
      ],
      "5": [
        32,
        32
      ],
      "6": [
        64,
        64
      ]
    }
  },
  {
    "key": "the-labyrinth",
    "name": "The Labyrinth",
    "strategy": "tile",
    "tilePath": "https://assets.tarkov.dev/maps/labyrinth/main/{z}/{x}/{y}.png",
    "tileSize": 256,
    "minZoom": 1,
    "maxZoom": 6,
    "transform": [
      2.115,
      85.5,
      2.115,
      128
    ],
    "coordinateRotation": 270,
    "bounds": [
      [
        -52,
        -37
      ],
      [
        53,
        76
      ]
    ],
    "floors": [],
    "author": "Tarkov.dev",
    "authorLink": "https://tarkov.dev",
    "tileGrid": {
      "1": [
        2,
        2
      ],
      "2": [
        4,
        4
      ],
      "3": [
        8,
        8
      ],
      "4": [
        16,
        16
      ],
      "5": [
        32,
        32
      ],
      "6": [
        64,
        64
      ]
    }
  },
  {
    "key": "lighthouse",
    "name": "Lighthouse",
    "strategy": "svg",
    "svgPath": "https://assets.tarkov.dev/maps/svg/Lighthouse.svg",
    "svgLayer": "Ground_Level",
    "tileSize": 256,
    "minZoom": 1,
    "maxZoom": 6,
    "transform": [
      0.2,
      0,
      0.2,
      0
    ],
    "coordinateRotation": 180,
    "bounds": [
      [
        515,
        -998
      ],
      [
        -545,
        725
      ]
    ],
    "floors": [],
    "labels": [
      {
        "text": "Train Yard",
        "position": [
          -30,
          -882
        ]
      },
      {
        "text": "Drug Lab",
        "position": [
          -120,
          -841
        ]
      },
      {
        "text": "Water Treatment",
        "position": [
          -65,
          -600
        ]
      },
      {
        "text": "Plant 1",
        "position": [
          40,
          -618
        ]
      },
      {
        "text": "Plant 2",
        "position": [
          -97,
          -737
        ]
      },
      {
        "text": "Plant 3",
        "position": [
          -189,
          -665
        ]
      },
      {
        "text": "Pipes",
        "position": [
          -182,
          -552
        ]
      },
      {
        "text": "Gunner Nest",
        "position": [
          18,
          -453
        ]
      },
      {
        "text": "Island",
        "position": [
          -177,
          -356
        ]
      },
      {
        "text": "Cabins",
        "position": [
          -278,
          -323
        ]
      },
      {
        "text": "Cottages",
        "position": [
          -162,
          -225
        ]
      },
      {
        "text": "Convenience",
        "position": [
          -55,
          -288
        ]
      },
      {
        "text": "Red Brick",
        "position": [
          -75,
          -284
        ]
      },
      {
        "text": "Hillside",
        "position": [
          -151,
          -243
        ]
      },
      {
        "text": "Boathouses",
        "position": [
          125,
          -153
        ]
      },
      {
        "text": "Dead Tree",
        "position": [
          62,
          -60
        ]
      },
      {
        "text": "Construction",
        "position": [
          0,
          -188
        ]
      },
      {
        "text": "Pikes Peak Resort",
        "position": [
          -107,
          -53
        ]
      },
      {
        "text": "Grand Chalet",
        "position": [
          -133,
          100
        ]
      },
      {
        "text": "Tennis Court",
        "position": [
          -70,
          129
        ]
      },
      {
        "text": "Lightkeeper Island",
        "position": [
          382,
          496
        ]
      },
      {
        "text": "Crash Site",
        "position": [
          -125,
          296
        ]
      }
    ],
    "author": "Shebuka",
    "authorLink": "https://github.com/the-hideout/tarkov-dev-svg-maps/"
  },
  {
    "key": "reserve",
    "name": "Reserve",
    "strategy": "tile",
    "tilePath": "https://assets.tarkov.dev/maps/reserve/main/{z}/{x}/{y}.png",
    "tileSize": 256,
    "minZoom": 2,
    "maxZoom": 6,
    "transform": [
      0.395,
      122,
      0.395,
      137.65
    ],
    "coordinateRotation": 180,
    "bounds": [
      [
        289,
        -293
      ],
      [
        -303,
        244
      ]
    ],
    "heightRange": [
      -7,
      10000
    ],
    "floors": [
      {
        "id": "2nd-floor",
        "name": "2nd Floor",
        "tilePath": "https://assets.tarkov.dev/maps/reserve/2nd/{z}/{x}/{y}.png",
        "extents": [
          {
            "height": [
              22.1,
              25.7
            ],
            "bounds": [
              [
                [
                  1,
                  164
                ],
                [
                  -17,
                  199
                ]
              ]
            ]
          },
          {
            "height": [
              -3.5,
              -0.64
            ],
            "bounds": [
              [
                [
                  -77,
                  26
                ],
                [
                  -177,
                  106
                ]
              ],
              [
                [
                  62,
                  59
                ],
                [
                  51,
                  108
                ]
              ]
            ]
          },
          {
            "height": [
              -3.5,
              -0.64
            ],
            "bounds": [
              [
                [
                  -104,
                  -37
                ],
                [
                  -177,
                  5
                ]
              ]
            ]
          },
          {
            "height": [
              -3.9,
              -0.6
            ],
            "bounds": [
              [
                [
                  -47,
                  -47
                ],
                [
                  -85,
                  -18
                ]
              ]
            ]
          },
          {
            "height": [
              -4.3,
              -2.2
            ],
            "bounds": [
              [
                [
                  -19.91,
                  -13
                ],
                [
                  -78,
                  39
                ]
              ]
            ]
          },
          {
            "height": [
              -3.8,
              -1.1
            ],
            "bounds": [
              [
                [
                  99,
                  -50
                ],
                [
                  -2,
                  7
                ]
              ]
            ]
          },
          {
            "height": [
              -1.9,
              11.3
            ],
            "bounds": [
              [
                [
                  191,
                  -175
                ],
                [
                  137,
                  -120
                ]
              ]
            ]
          },
          {
            "height": [
              1,
              8
            ],
            "bounds": [
              [
                [
                  -109,
                  -156
                ],
                [
                  -119,
                  -147
                ]
              ],
              [
                [
                  289,
                  -92
                ],
                [
                  299,
                  -82
                ]
              ],
              [
                [
                  3,
                  -210
                ],
                [
                  -7,
                  -200
                ]
              ],
              [
                [
                  195,
                  -260
                ],
                [
                  185,
                  -250
                ]
              ],
              [
                [
                  276,
                  17
                ],
                [
                  266,
                  27
                ]
              ]
            ]
          },
          {
            "height": [
              -4.1,
              -1.2
            ],
            "bounds": [
              [
                [
                  -128,
                  -139
                ],
                [
                  -146,
                  -120
                ]
              ]
            ]
          }
        ]
      },
      {
        "id": "3rd-floor",
        "name": "3rd Floor",
        "tilePath": "https://assets.tarkov.dev/maps/reserve/3rd/{z}/{x}/{y}.png",
        "extents": [
          {
            "height": [
              25.7,
              29.3
            ],
            "bounds": [
              [
                [
                  1,
                  164
                ],
                [
                  -17,
                  199
                ]
              ]
            ]
          },
          {
            "height": [
              -0.64,
              2.23
            ],
            "bounds": [
              [
                [
                  -77,
                  26
                ],
                [
                  -177,
                  106
                ]
              ]
            ]
          },
          {
            "height": [
              -0.64,
              2.23
            ],
            "bounds": [
              [
                [
                  -104,
                  -37
                ],
                [
                  -177,
                  5
                ]
              ]
            ]
          },
          {
            "height": [
              -0.6,
              10
            ],
            "bounds": [
              [
                [
                  -47,
                  -47
                ],
                [
                  -85,
                  -18
                ]
              ]
            ]
          },
          {
            "height": [
              -2.2,
              2.14
            ],
            "bounds": [
              [
                [
                  -19.91,
                  -13
                ],
                [
                  -78,
                  39
                ]
              ]
            ]
          },
          {
            "height": [
              -1.1,
              1.6
            ],
            "bounds": [
              [
                [
                  99,
                  -50
                ],
                [
                  -2,
                  7
                ]
              ]
            ]
          }
        ]
      },
      {
        "id": "4th-floor",
        "name": "4th Floor",
        "tilePath": "https://assets.tarkov.dev/maps/reserve/4th/{z}/{x}/{y}.png",
        "extents": [
          {
            "height": [
              29.3,
              36
            ],
            "bounds": [
              [
                [
                  1,
                  164
                ],
                [
                  -17,
                  199
                ]
              ]
            ]
          },
          {
            "height": [
              2.23,
              5
            ],
            "bounds": [
              [
                [
                  -77,
                  26
                ],
                [
                  -177,
                  106
                ]
              ]
            ]
          },
          {
            "height": [
              2.15,
              6.6
            ],
            "bounds": [
              [
                [
                  -19.91,
                  -13
                ],
                [
                  -78,
                  39
                ]
              ]
            ]
          },
          {
            "height": [
              1.6,
              4.7
            ],
            "bounds": [
              [
                [
                  99,
                  -50
                ],
                [
                  -2,
                  7
                ]
              ]
            ]
          }
        ]
      },
      {
        "id": "5th-floor",
        "name": "5th Floor",
        "tilePath": "https://assets.tarkov.dev/maps/reserve/5th/{z}/{x}/{y}.png",
        "extents": [
          {
            "height": [
              5,
              9.5
            ],
            "bounds": [
              [
                [
                  -77,
                  26
                ],
                [
                  -177,
                  106
                ]
              ]
            ]
          }
        ]
      },
      {
        "id": "bunkers",
        "name": "Bunkers",
        "tilePath": "https://assets.tarkov.dev/maps/reserve/bunkers/{z}/{x}/{y}.png",
        "extents": [
          {
            "height": [
              -10000,
              -7.27
            ],
            "bounds": [
              [
                [
                  128,
                  -208
                ],
                [
                  18,
                  -33
                ]
              ],
              [
                [
                  -46,
                  -42
                ],
                [
                  -176,
                  127
                ]
              ]
            ]
          },
          {
            "height": [
              -10000,
              -12
            ],
            "bounds": [
              [
                [
                  -40,
                  124
                ],
                [
                  -124,
                  189
                ]
              ]
            ]
          },
          {
            "height": [
              -10000,
              18
            ],
            "bounds": [
              [
                [
                  23,
                  173
                ],
                [
                  -65,
                  189
                ]
              ]
            ]
          },
          {
            "height": [
              -7.27,
              -3.2
            ],
            "bounds": [
              [
                [
                  74,
                  -196
                ],
                [
                  19,
                  -149
                ]
              ]
            ]
          },
          {
            "height": [
              -11,
              -4.6
            ],
            "bounds": [
              [
                [
                  -246,
                  -79
                ],
                [
                  -274,
                  -53
                ]
              ],
              [
                [
                  238,
                  -26
                ],
                [
                  126,
                  45
                ]
              ]
            ]
          }
        ]
      }
    ],
    "labels": [
      {
        "text": "K Buildings",
        "position": [
          28,
          -102
        ],
        "bottom": -6
      },
      {
        "text": "White Queen",
        "position": [
          -25,
          180
        ],
        "rotation": -15,
        "bottom": -6
      },
      {
        "text": "White Pawn",
        "position": [
          -104,
          93
        ],
        "rotation": 14,
        "bottom": -6
      },
      {
        "text": "Black Bishop",
        "position": [
          -140,
          -14.5
        ],
        "rotation": 14,
        "bottom": -6
      },
      {
        "text": "White Bishop",
        "position": [
          -67,
          -30
        ],
        "rotation": 14,
        "bottom": -6
      },
      {
        "text": "White King",
        "position": [
          -49.5,
          15.5
        ],
        "rotation": 14,
        "bottom": -6
      },
      {
        "text": "Black Knight",
        "position": [
          14.5,
          -10.8
        ],
        "bottom": -6
      },
      {
        "text": "White Knight",
        "position": [
          82.2,
          -30.2
        ],
        "bottom": -6
      },
      {
        "text": "White Rook",
        "position": [
          149,
          -124
        ],
        "bottom": -6
      },
      {
        "text": "Train Station",
        "position": [
          161,
          -149
        ],
        "size": 80,
        "rotation": 14,
        "bottom": -6
      },
      {
        "text": "Black Pawn",
        "position": [
          -165,
          57
        ],
        "rotation": -75,
        "bottom": -6
      },
      {
        "text": "Barracks",
        "position": [
          167,
          -222
        ],
        "bottom": -6
      },
      {
        "text": "E1 Bunkers",
        "position": [
          -220,
          -13
        ],
        "bottom": -6
      },
      {
        "text": "E2 Bunkers",
        "position": [
          173,
          -3
        ],
        "bottom": -6
      },
      {
        "text": "д - Warehouse Bunkers",
        "position": [
          80,
          -167
        ],
        "rotation": 14,
        "bottom": -6
      },
      {
        "text": "Garage",
        "position": [
          96,
          30
        ],
        "size": 80,
        "rotation": -75,
        "bottom": -6
      },
      {
        "text": "Mechanic",
        "position": [
          55.5,
          60.6
        ],
        "size": 80,
        "bottom": -6
      },
      {
        "text": "Gas Station",
        "position": [
          29.7,
          29.5
        ],
        "size": 80,
        "rotation": 14,
        "bottom": -6
      },
      {
        "text": "Shipping Yard",
        "position": [
          -31,
          -150
        ],
        "size": 80,
        "rotation": 14,
        "bottom": -6
      },
      {
        "text": "K1",
        "position": [
          -1,
          -71
        ],
        "size": 80,
        "rotation": 14,
        "bottom": -6
      },
      {
        "text": "K2",
        "position": [
          66,
          -90
        ],
        "size": 80,
        "rotation": 14,
        "bottom": -6
      },
      {
        "text": "K3",
        "position": [
          -5.5,
          -94
        ],
        "size": 80,
        "rotation": 14,
        "bottom": -6
      },
      {
        "text": "K4",
        "position": [
          60,
          -112
        ],
        "size": 80,
        "rotation": 14,
        "bottom": -6
      },
      {
        "text": "K5",
        "position": [
          -10.5,
          -115
        ],
        "size": 80,
        "rotation": 14,
        "bottom": -6
      },
      {
        "text": "K6",
        "position": [
          54,
          -132
        ],
        "size": 80,
        "rotation": 14,
        "bottom": -6
      },
      {
        "text": "Dome",
        "position": [
          -8.5,
          175
        ],
        "size": 80,
        "bottom": -6
      },
      {
        "text": "Tarmac",
        "position": [
          -120,
          37
        ],
        "size": 80,
        "rotation": 14,
        "bottom": -6
      }
    ],
    "author": "Shebuka",
    "authorLink": "https://github.com/the-hideout/tarkov-dev-svg-maps/",
    "tileGrid": {
      "2": [
        4,
        4
      ],
      "3": [
        8,
        8
      ],
      "4": [
        16,
        16
      ],
      "5": [
        32,
        32
      ],
      "6": [
        64,
        64
      ]
    }
  },
  {
    "key": "shoreline",
    "name": "Shoreline",
    "strategy": "svg",
    "svgPath": "https://assets.tarkov.dev/maps/svg/Shoreline.svg",
    "svgLayer": "Ground_Level",
    "tileSize": 256,
    "minZoom": 2,
    "maxZoom": 6,
    "transform": [
      0.16,
      83.2,
      0.16,
      111.1
    ],
    "coordinateRotation": 180,
    "bounds": [
      [
        504,
        -415
      ],
      [
        -1056,
        618
      ]
    ],
    "heightRange": [
      -1000,
      -1
    ],
    "floors": [
      {
        "id": "2nd-floor",
        "name": "2nd Floor",
        "svgLayer": "Second_Floor",
        "extents": [
          {
            "height": [
              -1,
              2
            ]
          }
        ]
      },
      {
        "id": "3rd-floor",
        "name": "3rd Floor",
        "svgLayer": "Third_Floor",
        "extents": [
          {
            "height": [
              2,
              1000
            ]
          }
        ]
      },
      {
        "id": "underground",
        "name": "Underground",
        "svgLayer": "Underground_Level",
        "extents": [
          {
            "height": [
              -1000,
              -5
            ],
            "bounds": [
              [
                [
                  -137,
                  -68
                ],
                [
                  -237,
                  -104
                ]
              ],
              [
                [
                  -234,
                  -134
                ],
                [
                  -268,
                  -163
                ]
              ]
            ]
          }
        ]
      }
    ],
    "labels": [
      {
        "text": "Resort",
        "position": [
          -258.2,
          -71.2
        ],
        "size": 100,
        "top": -2,
        "bottom": -4
      },
      {
        "text": "Power Station",
        "position": [
          -215.8,
          178.4
        ],
        "top": -2,
        "bottom": -4
      },
      {
        "text": "Gas Station",
        "position": [
          -189.3,
          420
        ],
        "top": -2,
        "bottom": -4
      },
      {
        "text": "Weather Station",
        "position": [
          -496,
          257
        ],
        "top": -2,
        "bottom": -4
      },
      {
        "text": "Radio Tower",
        "position": [
          -708.9,
          93.91
        ],
        "top": -2,
        "bottom": -4
      },
      {
        "text": "Swamp",
        "position": [
          326,
          -118.5
        ],
        "top": -2,
        "bottom": -4
      },
      {
        "text": "Village",
        "position": [
          418.4,
          118
        ],
        "top": -2,
        "bottom": -4
      },
      {
        "text": "Cabins",
        "position": [
          288,
          144
        ],
        "top": -2,
        "bottom": -4
      },
      {
        "text": "Cottages",
        "position": [
          128,
          93
        ],
        "top": -2,
        "bottom": -4
      },
      {
        "text": "Tank Bridge",
        "position": [
          -355,
          188
        ],
        "top": -2,
        "bottom": -4
      },
      {
        "text": "Pier",
        "position": [
          -338.6,
          525
        ],
        "top": -2,
        "bottom": -4
      },
      {
        "text": "Scav Island",
        "position": [
          216,
          424
        ],
        "top": -2,
        "bottom": -4
      },
      {
        "text": "Bus Stop",
        "position": [
          -96,
          -6
        ],
        "top": -2,
        "bottom": -4
      },
      {
        "text": "Construction",
        "position": [
          52,
          134
        ],
        "top": -2,
        "bottom": -4
      },
      {
        "text": "Bunker",
        "position": [
          -153,
          -290
        ],
        "top": -2,
        "bottom": -4
      },
      {
        "text": "Crane",
        "position": [
          -625,
          484
        ],
        "top": -2,
        "bottom": -4
      },
      {
        "text": "Scav Farm",
        "position": [
          -622,
          -202
        ],
        "top": -2,
        "bottom": -4
      },
      {
        "text": "West Wing",
        "position": [
          -171,
          -83
        ],
        "top": 100,
        "bottom": -100
      },
      {
        "text": "East Wing",
        "position": [
          -329,
          -83
        ],
        "top": 100,
        "bottom": -100
      },
      {
        "text": "Admin",
        "position": [
          -252,
          -146
        ],
        "top": 100,
        "bottom": -100
      }
    ],
    "author": "Shebuka",
    "authorLink": "https://github.com/the-hideout/tarkov-dev-svg-maps/"
  },
  {
    "key": "terminal",
    "name": "Terminal",
    "strategy": "svg",
    "svgPath": "https://assets.tarkov.dev/maps/svg/Terminal.svg",
    "svgLayer": "Ground_Level",
    "tileSize": 256,
    "minZoom": 2,
    "maxZoom": 6,
    "transform": [
      0.2,
      0,
      0.2,
      0
    ],
    "coordinateRotation": 180,
    "bounds": [
      [
        463,
        -580
      ],
      [
        -433,
        475
      ]
    ],
    "floors": [],
    "author": "Shebuka",
    "authorLink": "https://github.com/the-hideout/tarkov-dev-svg-maps/"
  },
  {
    "key": "woods",
    "name": "Woods",
    "strategy": "tile",
    "tilePath": "https://assets.tarkov.dev/maps/woods/main_0.16/{z}/{x}/{y}.png",
    "tileSize": 256,
    "minZoom": 2,
    "maxZoom": 6,
    "transform": [
      0.1855,
      112.95,
      0.1855,
      167.85
    ],
    "coordinateRotation": 180,
    "bounds": [
      [
        646,
        -914
      ],
      [
        -761,
        442
      ]
    ],
    "floors": [],
    "labels": [
      {
        "text": "Sawmill",
        "position": [
          10,
          -3
        ]
      },
      {
        "text": "Scav Town",
        "position": [
          -485,
          -390
        ]
      },
      {
        "text": "Old Sawmill",
        "position": [
          -517,
          -210
        ]
      },
      {
        "text": "Cultist Village",
        "position": [
          -80,
          -680
        ]
      },
      {
        "text": "USEC Camp",
        "position": [
          290,
          -475
        ]
      },
      {
        "text": "Military Camp",
        "position": [
          -188,
          235
        ]
      },
      {
        "text": "Ponds",
        "position": [
          -5,
          -515
        ],
        "size": 80
      },
      {
        "text": "Crash Site",
        "position": [
          -252,
          -37
        ],
        "size": 80
      },
      {
        "text": "Checkpoint",
        "position": [
          239,
          -65
        ],
        "size": 70
      },
      {
        "text": "Shack",
        "position": [
          244,
          125
        ],
        "size": 70
      },
      {
        "text": "Lumber",
        "position": [
          -16,
          -122
        ],
        "size": 70
      },
      {
        "text": "Cabins",
        "position": [
          -3,
          -74
        ],
        "size": 70
      },
      {
        "text": "Bus Stop",
        "position": [
          -234,
          357
        ],
        "size": 70
      },
      {
        "text": "Jaeger's Camp",
        "position": [
          -327,
          19
        ],
        "size": 70
      },
      {
        "text": "Sniper Rock",
        "position": [
          85,
          -147
        ],
        "size": 70
      },
      {
        "text": "Convoy",
        "position": [
          200,
          -606
        ],
        "size": 70
      }
    ],
    "author": "Shebuka",
    "authorLink": "https://github.com/the-hideout/tarkov-dev-svg-maps/",
    "tileGrid": {
      "2": [
        4,
        4
      ],
      "3": [
        8,
        8
      ],
      "4": [
        16,
        16
      ],
      "5": [
        32,
        32
      ],
      "6": [
        64,
        64
      ]
    }
  }
];

export function getMapConfig(key: string): MapConfig | undefined {
  return mapConfigs.find((config) => config.key === key);
}
